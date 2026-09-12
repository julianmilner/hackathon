"""Blend precinct crime counts into a continuous heatmap raster.

SAPS publishes counts per police precinct only. To get below that level:

1. Each precinct's twelve-month count is spread over the census enumeration
   areas (EAs) inside it in proportion to their 2021 residents. EAs are block
   sized in the city (median 0.08 km2), which gives the street-level texture.
2. The EA values are rasterised onto a 50 m grid.
3. Every grid cell is then the Gaussian-weighted sum of surrounding cases,
   w(d) = exp(-d^2 / (2 sigma^2)), sigma = 400 m, so a point is affected by
   crime nearby and progressively less by crime further away.

Two measures per category are written as 8-bit grayscale PNGs (square-root
encoded so low values keep detail) plus an index.json describing bounds,
encoding and maxima. Zero is transparent in the viewer.

    density: expected cases per km2 per year at that point
    rate:    cases per 100 000 residents, using residents smoothed with the same
             kernel; masked where fewer than MIN_POP_DENSITY people/km2 live

Inputs:  public/data/wc-crime-precincts.geojson (from build_crime_geojson.py)
         Western Cape GIS enumeration areas with population (downloaded, cached)
Outputs: public/data/heat/<category>-<measure>.png, public/data/heat/index.json
         docs/assets/crime-heatmap-cape-town.png (preview)

Usage:   .venv/bin/python scripts/crime/build_crime_raster.py [--sigma 400] [--cell 50]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import shapely
from PIL import Image
from scipy.ndimage import gaussian_filter
from shapely.geometry import box, shape

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "cache"
PRECINCTS = ROOT / "public" / "data" / "wc-crime-precincts.geojson"
OUT_DIR = ROOT / "public" / "data" / "heat"
PREVIEW = ROOT / "docs" / "assets" / "crime-heatmap-cape-town.png"

EA_URL = "https://gis.westerncape.gov.za/server2/rest/services/PDO/Population_Boundaries/MapServer/2/query"
EXTENT = (18.25, -34.42, 19.30, -33.35)  # west, south, east, north; Cape Town and surrounds

CATEGORIES = [
    "all17",
    "contact",
    "property",
    "murder",
    "sexual",
    "robbery_agg",
    "burglary_res",
    "theft_vehicle",
    "theft_from_vehicle",
    "carjacking",
]
MIN_POP_DENSITY = 200  # people per km2 below which a per-capita rate is not shown
RAMP = ["#51223f", "#8b223e", "#c2272d", "#e65001", "#fb8304", "#ffb849", "#ffe47c"]  # same as src/crime/scale.ts
SURFACE = "#101827"

M_PER_DEG_LAT = 110_574.0
M_PER_DEG_LON = 111_320.0


def norm(name: str) -> str:
    return " ".join(name.lower().split())


def fetch_eas() -> list[dict]:
    """Download every enumeration area intersecting EXTENT, 2000 per page, cached."""
    target = CACHE / "wc_population_eas_metro.geojson"
    if target.exists():
        return json.loads(target.read_text())["features"]
    features: list[dict] = []
    offset = 0
    while True:
        params = {
            "where": "1=1",
            "geometry": ",".join(str(v) for v in EXTENT),
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "OBJECTID_1,EA_CODE,SP_NAME,MN_NAME,POLICE_PRE,TOTAL_PP21,TOTAL_HH21,Shape_Area",
            "outSR": "4326",
            "geometryPrecision": "6",
            "resultOffset": str(offset),
            "resultRecordCount": "2000",
            "f": "geojson",
        }
        print(f"downloading enumeration areas {offset}+ ...")
        with urllib.request.urlopen(f"{EA_URL}?{urllib.parse.urlencode(params)}", timeout=600) as resp:
            page = json.loads(resp.read())
        if "error" in page:
            raise RuntimeError(page["error"])
        features.extend(page["features"])
        if not page.get("exceededTransferLimit") and not page.get("properties", {}).get("exceededTransferLimit"):
            break
        offset += 2000
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")))
    print(f"cached {len(features)} enumeration areas")
    return features


class Grid:
    """Equirectangular metre grid over EXTENT with square cells of `cell` metres."""

    def __init__(self, extent: tuple[float, float, float, float], cell: float):
        self.west, self.south, self.east, self.north = extent
        self.cell = cell
        self.cos_lat = math.cos(math.radians((self.south + self.north) / 2))
        self.width_m = (self.east - self.west) * self.cos_lat * M_PER_DEG_LON
        self.height_m = (self.north - self.south) * M_PER_DEG_LAT
        self.nx = int(math.ceil(self.width_m / cell))
        self.ny = int(math.ceil(self.height_m / cell))

    def to_xy(self, lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        x = (lon - self.west) * self.cos_lat * M_PER_DEG_LON
        y = (self.north - lat) * M_PER_DEG_LAT  # row 0 is the northern edge
        return x, y

    def cell_centres(self, i0: int, i1: int, j0: int, j1: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Centres of cells rows i0..i1-1, cols j0..j1-1 in lon/lat, plus their index arrays."""
        rows = np.arange(i0, i1)
        cols = np.arange(j0, j1)
        jj, ii = np.meshgrid(cols, rows)
        lon = self.west + (jj + 0.5) * self.cell / (self.cos_lat * M_PER_DEG_LON)
        lat = self.north - (ii + 0.5) * self.cell / M_PER_DEG_LAT
        return lon.ravel(), lat.ravel(), ii.ravel(), jj.ravel()

    def index_of(self, lon: float, lat: float) -> tuple[int, int]:
        x, y = self.to_xy(np.array([lon]), np.array([lat]))
        return int(y[0] // self.cell), int(x[0] // self.cell)


def rasterise_population(eas: list[dict], grid: Grid) -> tuple[np.ndarray, np.ndarray, dict[str, int]]:
    """Return (people per cell, precinct index per cell, precinct name -> index)."""
    pop = np.zeros((grid.ny, grid.nx), dtype=np.float64)
    precinct_of_cell = np.full((grid.ny, grid.nx), -1, dtype=np.int32)
    precinct_index: dict[str, int] = {}
    clip = box(grid.west, grid.south, grid.east, grid.north)
    skipped = 0
    for feat in eas:
        props = feat["properties"]
        people = props.get("TOTAL_PP21") or 0.0
        name = norm(props.get("POLICE_PRE") or "")
        if people <= 0 or not name:
            continue
        geom = shape(feat["geometry"])
        if not geom.is_valid:
            geom = geom.buffer(0)
        inside = geom.intersection(clip)
        if inside.is_empty:
            continue
        people *= inside.area / geom.area  # only the part of the EA inside the extent
        pidx = precinct_index.setdefault(name, len(precinct_index))
        minx, miny, maxx, maxy = inside.bounds
        i0, j0 = grid.index_of(minx, maxy)
        i1, j1 = grid.index_of(maxx, miny)
        i0, j0 = max(i0, 0), max(j0, 0)
        i1, j1 = min(i1 + 1, grid.ny), min(j1 + 1, grid.nx)
        if i1 <= i0 or j1 <= j0:
            skipped += 1
            continue
        lon, lat, ii, jj = grid.cell_centres(i0, i1, j0, j1)
        mask = shapely.contains_xy(inside, lon, lat)
        n = int(mask.sum())
        if n == 0:
            c = inside.representative_point()
            i, j = grid.index_of(c.x, c.y)
            if 0 <= i < grid.ny and 0 <= j < grid.nx:
                pop[i, j] += people
                precinct_of_cell[i, j] = pidx
            continue
        pop[ii[mask], jj[mask]] += people / n
        precinct_of_cell[ii[mask], jj[mask]] = pidx
    if skipped:
        print(f"  {skipped} enumeration areas fell outside the grid")
    return pop, precinct_of_cell, precinct_index


def encode_sqrt8(values: np.ndarray, vmax: float) -> np.ndarray:
    scaled = np.sqrt(np.clip(values / vmax, 0.0, 1.0))
    return np.round(scaled * 255).astype(np.uint8)


def hex_to_rgb(h: str) -> tuple[float, float, float]:
    return tuple(int(h[i : i + 2], 16) / 255 for i in (1, 3, 5))  # type: ignore[return-value]


def render_preview(density: np.ndarray, vmax: float, grid: Grid, precincts: dict, label: str, period: str, sigma: float) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LinearSegmentedColormap

    ramp = LinearSegmentedColormap.from_list("heat", [hex_to_rgb(SURFACE)] + [hex_to_rgb(c) for c in RAMP])
    fig_w = 12
    fig_h = fig_w * grid.height_m / grid.width_m + 1.4
    fig, ax = plt.subplots(figsize=(fig_w, fig_h), facecolor=SURFACE)
    ax.set_facecolor(SURFACE)
    ax.imshow(np.sqrt(np.clip(density / vmax, 0, 1)), cmap=ramp, vmin=0, vmax=1, extent=(0, grid.width_m, grid.height_m, 0), interpolation="bilinear")
    for feat in precincts["features"]:
        geom = feat["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for rings in polys:
            ring = np.array(rings[0])
            x, y = grid.to_xy(ring[:, 0], ring[:, 1])
            ax.plot(x, y, color="#f4f7fb", linewidth=0.35, alpha=0.35)
    ax.set_xlim(0, grid.width_m)
    ax.set_ylim(grid.height_m, 0)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.text(0.04, 0.965, f"{label}, cases per km² per year", color="#f4f7fb", fontsize=15, fontweight="bold", va="top")
    fig.text(
        0.04,
        0.928,
        f"Cape Town and surrounds, {period}. Precinct counts spread by residents over census blocks, blended with a {sigma:.0f} m Gaussian kernel.",
        color="#b8c4d8",
        fontsize=9.5,
        va="top",
    )
    fig.text(
        0.04,
        0.012,
        "Sources: SAPS quarterly station crime statistics; Western Cape Government GIS precinct boundaries and 2021 population by enumeration area.",
        color="#8a97ad",
        fontsize=7.5,
    )
    fig.subplots_adjust(left=0.02, right=0.98, top=0.905, bottom=0.035)
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(PREVIEW, dpi=150, facecolor=SURFACE)
    print(f"wrote {PREVIEW.relative_to(ROOT)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sigma", type=float, default=400.0, help="kernel bandwidth in metres")
    parser.add_argument("--cell", type=float, default=50.0, help="grid cell size in metres")
    args = parser.parse_args()

    precincts = json.loads(PRECINCTS.read_text())
    counts = {norm(f["properties"]["name"]): f["properties"]["counts"] for f in precincts["features"]}
    populations = {norm(f["properties"]["name"]): f["properties"]["population"] or 0 for f in precincts["features"]}

    grid = Grid(EXTENT, args.cell)
    print(f"grid {grid.nx} x {grid.ny} cells of {args.cell:.0f} m; sigma {args.sigma:.0f} m")

    eas = fetch_eas()
    pop, precinct_of_cell, precinct_index = rasterise_population(eas, grid)
    print(f"rasterised {len(eas)} enumeration areas, {pop.sum():,.0f} residents on grid, {len(precinct_index)} precincts")

    missing = [name for name in precinct_index if name not in counts]
    if missing:
        print(f"  no counts for precincts {missing}; their cells get zero crime")

    # Per-cell crime for each category: residents in cell x precinct cases per resident.
    index_to_name = {i: n for n, i in precinct_index.items()}
    per_resident = {cat: np.zeros(len(precinct_index) + 1, dtype=np.float64) for cat in CATEGORIES}
    for i, name in index_to_name.items():
        c = counts.get(name)
        p = populations.get(name, 0)
        if not c or p <= 0:
            continue
        for cat in CATEGORIES:
            per_resident[cat][i] = c[cat] / p
    lookup_index = np.where(precinct_of_cell < 0, len(precinct_index), precinct_of_cell)

    sigma_cells = args.sigma / args.cell
    cell_km2 = (args.cell / 1000) ** 2
    pop_density = gaussian_filter(pop, sigma=sigma_cells, mode="constant", truncate=4.0) / cell_km2
    rate_mask = pop_density >= MIN_POP_DENSITY

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.png"):
        old.unlink()
    layers: dict[str, dict] = {}
    preview_density = None
    preview_vmax = 0.0
    for cat in CATEGORIES:
        cases = pop * per_resident[cat][lookup_index]
        density = gaussian_filter(cases, sigma=sigma_cells, mode="constant", truncate=4.0) / cell_km2
        rate = np.where(rate_mask, density / np.maximum(pop_density, 1e-9) * 100_000, 0.0)
        for measure, values in (("density", density), ("rate", rate)):
            nonzero = values[values > 0]
            if nonzero.size == 0:
                continue
            vmax = float(np.percentile(nonzero, 99.7 if measure == "density" else 99.0))
            name = f"{cat}-{measure}"
            Image.fromarray(encode_sqrt8(values, vmax), mode="L").save(OUT_DIR / f"{name}.png", optimize=True)
            layers[name] = {
                "file": f"{name}.png",
                "category": cat,
                "measure": measure,
                "vmax": round(vmax, 3),
                "total_cases": round(float(cases.sum()), 1),
            }
            print(f"  {name:32} vmax {vmax:10.1f}  {(OUT_DIR / f'{name}.png').stat().st_size / 1024:6.0f} KB")
        if cat == "all17":
            preview_density, preview_vmax = density, layers["all17-density"]["vmax"]

    meta = precincts["metadata"]
    index = {
        "extent": list(EXTENT),
        "width": grid.nx,
        "height": grid.ny,
        "cell_m": args.cell,
        "sigma_m": args.sigma,
        "encoding": "sqrt8: value = vmax * (pixel / 255)^2; pixel 0 is no crime and drawn transparent",
        "min_pop_density": MIN_POP_DENSITY,
        "period": meta["period"],
        "categories": {cat: meta["categories"][cat] for cat in CATEGORIES},
        "measures": {
            "density": {"label": "Cases per km² per year", "short": "cases/km²"},
            "rate": {"label": "Cases per 100 000 residents", "short": "per 100 000"},
        },
        "formula": (
            "Each precinct's twelve-month count is spread over its census enumeration areas in proportion to 2021 "
            "residents, rasterised at {cell:.0f} m, then every point is the Gaussian-weighted sum of surrounding cases, "
            "w(d) = exp(-d²/2σ²) with σ = {sigma:.0f} m. Density is cases per km² per year; rate divides by residents "
            "smoothed with the same kernel and is hidden where fewer than {minpop} people/km² live."
        ).format(cell=args.cell, sigma=args.sigma, minpop=MIN_POP_DENSITY),
        "sources": meta["sources"],
        "generated": dt.date.today().isoformat(),
        "layers": layers,
    }
    (OUT_DIR / "index.json").write_text(json.dumps(index, indent=1))
    total_kb = sum(p.stat().st_size for p in OUT_DIR.iterdir()) / 1024
    print(f"wrote {OUT_DIR.relative_to(ROOT)}/index.json; {len(layers)} layers, {total_kb:,.0f} KB total")

    if preview_density is not None:
        render_preview(preview_density, preview_vmax, grid, precincts, meta["categories"]["all17"], meta["period"]["label"], args.sigma)


if __name__ == "__main__":
    main()
