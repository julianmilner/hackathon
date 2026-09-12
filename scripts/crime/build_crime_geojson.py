"""Build the Cape Town crime heatmap dataset.

Joins three sources into one GeoJSON the app can read:

1. SAPS quarterly station crime statistics (Excel, downloaded manually from
   https://www.saps.gov.za/services/crimestats.php). Monthly counts per station
   and crime category.
2. Western Cape Government GIS: SAPS police precinct polygons and station points
   (SpatialDataWarehouse/SAPS_PoliceStations).
3. Western Cape Government GIS: 2021 population per enumeration area with a
   police-precinct attribute (PDO/Population_Boundaries layer 2, GeoTerraImage),
   summed per precinct.

Usage:
    .venv/bin/python scripts/crime/build_crime_geojson.py ~/Downloads/*Quarter_WEB.xls*

Outputs:
    public/data/wc-crime-precincts.geojson   polygons with counts and rates
    public/data/wc-police-stations.geojson   station points for labels
    data/cache/                              raw downloads (re-used if present)
"""

from __future__ import annotations

import datetime as dt
import json
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

import openpyxl
from shapely.geometry import mapping, shape

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "cache"
OUT = ROOT / "public" / "data"

GIS = "https://gis.westerncape.gov.za/server2/rest/services"
PRECINCTS_URL = f"{GIS}/SpatialDataWarehouse/SAPS_PoliceStations/MapServer/3/query"
STATIONS_URL = f"{GIS}/SpatialDataWarehouse/SAPS_PoliceStations/MapServer/0/query"
POPULATION_URL = f"{GIS}/PDO/Population_Boundaries/MapServer/2/query"

# SAPS category code -> short key used in the GeoJSON. Codes come from the
# "Code" column of the RAW Data sheet. "Full 17" is the headline total SAPS
# uses for community-reported serious crime; the Cat/A codes are SAPS
# aggregates, so nothing here double counts.
CATEGORIES: dict[str, tuple[str, str]] = {
    "Full 17": ("all17", "17 community-reported serious crimes"),
    "Cat 01": ("contact", "Contact crime (crimes against the person)"),
    "Cat 03": ("property", "Property-related crime"),
    "1": ("murder", "Murder"),
    "2": ("attempted_murder", "Attempted murder"),
    "A 01": ("sexual", "Sexual offences"),
    "4": ("robbery_agg", "Robbery with aggravating circumstances"),
    "6": ("robbery_common", "Common robbery"),
    "18": ("assault_gbh", "Assault with intent to inflict grievous bodily harm"),
    "19": ("assault_common", "Common assault"),
    "21": ("burglary_res", "Burglary at residential premises"),
    "20": ("burglary_nonres", "Burglary at non-residential premises"),
    "24": ("theft_vehicle", "Theft of motor vehicle and motorcycle"),
    "25": ("theft_from_vehicle", "Theft out of or from motor vehicle"),
    "34": ("carjacking", "Carjacking"),
    "38": ("house_robbery", "Robbery at residential premises"),
    "42": ("business_robbery", "Robbery at non-residential premises"),
    "30": ("drugs", "Drug-related crime (police action)"),
    "32": ("firearms", "Illegal possession of firearms and ammunition (police action)"),
}

# Stations opened after the boundary layer was published (2019/2020). Their
# counts are folded into the precinct they were carved out of, so the polygon
# still covers the same ground as the population figure.
MERGE_INTO: dict[str, str] = {
    "Makhaza": "Harare",  # opened May 2024 inside the old Harare precinct
}

# Precincts whose residential population is too small for a per-capita rate to
# mean anything (CBD, harbour). Rates are still computed; the flag lets the
# renderer treat them differently.
MIN_POPULATION_FOR_RATE = 5_000


def norm(name: str) -> str:
    return " ".join(name.lower().replace("’", "'").split())


def fetch(url: str, params: dict[str, str], target: Path) -> dict:
    if target.exists():
        return json.loads(target.read_text())
    query = urllib.parse.urlencode(params)
    print(f"downloading {target.name} ...")
    with urllib.request.urlopen(f"{url}?{query}", timeout=300) as resp:
        data = resp.read()
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    parsed = json.loads(data)
    if "error" in parsed:
        target.unlink()
        raise RuntimeError(parsed["error"])
    return parsed


def load_saps(paths: list[Path]) -> tuple[dict, dict]:
    """Return ({(station, code): {month: count}}, {station: district})."""
    counts: dict[tuple[str, str], dict[dt.date, int]] = defaultdict(dict)
    districts: dict[str, str] = {}
    for path in sorted(paths):
        print(f"reading {path.name} ...")
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        ws = wb["RAW Data"]
        rows = ws.iter_rows(values_only=True)
        next(rows)
        next(rows)
        header = next(rows)
        month_cols = [
            (i, v.date()) for i, v in enumerate(header) if isinstance(v, dt.datetime)
        ]
        for row in rows:
            if row[2] != "Station" or row[6] != "Western Cape" or row[4] is None:
                continue
            station = str(row[4]).strip()
            code = str(row[8]).strip()
            if code not in CATEGORIES:
                continue
            districts[station] = str(row[5]).replace(" District", "")
            series = counts[(station, code)]
            for i, month in month_cols:
                value = row[i]
                if value is None or value == "":
                    continue
                series[month] = int(value)
        wb.close()
    return counts, districts


def window(months: list[dt.date], end: dt.date, n: int = 12) -> list[dt.date]:
    return [m for m in months if m <= end][-n:]


def month_label(d: dt.date) -> str:
    return d.strftime("%b %Y")


def main(argv: list[str]) -> None:
    xlsx = [Path(p).expanduser() for p in argv[1:]]
    if not xlsx:
        sys.exit(__doc__)

    counts, districts = load_saps(xlsx)
    all_months = sorted({m for s in counts.values() for m in s})
    latest = all_months[-1]
    current = window(all_months, latest)
    previous = window(all_months, current[0] - dt.timedelta(days=1))
    if len(current) != 12 or len(previous) != 12:
        sys.exit(f"need two full 12-month windows, got {len(current)} and {len(previous)}")
    print(f"current window {month_label(current[0])} – {month_label(current[-1])}")
    print(f"previous window {month_label(previous[0])} – {month_label(previous[-1])}")

    stations = sorted({s for s, _ in counts})
    per_station: dict[str, dict] = {}
    for station in stations:
        cur: dict[str, int] = {}
        prev: dict[str, int] = {}
        for code, (key, _) in CATEGORIES.items():
            series = counts.get((station, code), {})
            missing_cur = [m for m in current if m not in series]
            if missing_cur and key == "all17":
                print(f"  warning: {station} has only {12 - len(missing_cur)} of 12 months in the current window")
            cur[key] = sum(series.get(m, 0) for m in current)
            prev[key] = sum(series.get(m, 0) for m in previous)
        per_station[station] = {"counts": cur, "previous": prev, "includes": [station]}
    for child, parent in MERGE_INTO.items():
        if child not in per_station or parent not in per_station:
            continue
        for bucket in ("counts", "previous"):
            for key, value in per_station[child][bucket].items():
                per_station[parent][bucket][key] += value
        per_station[parent]["includes"].append(child)
        print(f"folded {child} into {parent}")
        del per_station[child]
    stations = sorted(per_station)

    precincts = fetch(
        PRECINCTS_URL,
        {
            "where": "1=1",
            "outFields": "OBJECTID,COMPNT_NM,PolicePrec,CREATE_DT",
            "outSR": "4326",
            "f": "geojson",
        },
        CACHE / "wc_police_precincts.geojson",
    )
    station_points = fetch(
        STATIONS_URL,
        {
            "where": "1=1",
            "outFields": "OBJECTID,COMPNT_NM,PoliceStat",
            "outSR": "4326",
            "f": "geojson",
        },
        CACHE / "wc_police_stations.geojson",
    )
    population_raw = fetch(
        POPULATION_URL,
        {
            "where": "1=1",
            "groupByFieldsForStatistics": "POLICE_PRE",
            "outStatistics": json.dumps(
                [
                    {"statisticType": "sum", "onStatisticField": "TOTAL_PP21", "outStatisticFieldName": "pop2021"},
                    {"statisticType": "sum", "onStatisticField": "TOTAL_HH21", "outStatisticFieldName": "hh2021"},
                    {"statisticType": "count", "onStatisticField": "OBJECTID_1", "outStatisticFieldName": "n_ea"},
                ]
            ),
            "returnGeometry": "false",
            "f": "json",
        },
        CACHE / "wc_precinct_population.json",
    )
    population = {
        norm(f["attributes"]["POLICE_PRE"]): round(f["attributes"]["pop2021"] or 0)
        for f in population_raw["features"]
        if f["attributes"]["POLICE_PRE"]
    }

    by_norm = {norm(s): s for s in stations}
    matched: set[str] = set()
    features = []
    for feat in precincts["features"]:
        name = feat["properties"]["PolicePrec"]
        station = by_norm.get(norm(name))
        if station is None:
            print(f"  no SAPS stats for precinct {name!r}")
            continue
        matched.add(station)
        geom = shape(feat["geometry"]).simplify(0.0004, preserve_topology=True)
        pop = population.get(norm(name))
        if pop is None:
            print(f"  no population for precinct {name!r}")
        data = per_station[station]
        rates = {
            key: (round(value / pop * 100_000, 1) if pop else None)
            for key, value in data["counts"].items()
        }
        features.append(
            {
                "type": "Feature",
                "id": station,
                "properties": {
                    "name": station,
                    "includes": data["includes"],
                    "district": districts.get(station, ""),
                    "population": pop,
                    "rate_reliable": bool(pop and pop >= MIN_POPULATION_FOR_RATE),
                    "counts": data["counts"],
                    "previous": data["previous"],
                    "rates": rates,
                },
                "geometry": json.loads(json.dumps(mapping(geom))),
            }
        )
    for station in stations:
        if station not in matched:
            c = per_station[station]["counts"]
            print(f"  dropped {station!r}: no precinct polygon (all17={c['all17']}, murder={c['murder']})")

    def rounded(coords):
        if isinstance(coords[0], (int, float)):
            return [round(coords[0], 5), round(coords[1], 5)]
        return [rounded(c) for c in coords]

    for f in features:
        f["geometry"]["coordinates"] = rounded(f["geometry"]["coordinates"])

    metadata = {
        "period": {
            "start": current[0].isoformat(),
            "end": (current[-1].replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1),
            "label": f"{month_label(current[0])} – {month_label(current[-1])}",
            "previous_label": f"{month_label(previous[0])} – {month_label(previous[-1])}",
        },
        "categories": {key: label for _, (key, label) in CATEGORIES.items()},
        "police_action_categories": ["drugs", "firearms"],
        "population_year": 2021,
        "min_population_for_rate": MIN_POPULATION_FOR_RATE,
        "sources": {
            "crime": "SAPS quarterly crime statistics per police station, saps.gov.za",
            "boundaries": "Western Cape Government GIS, SAPS Police Precincts (published 2019/2020)",
            "population": "Western Cape Government GIS, GeoTerraImage 2021 population by enumeration area, summed per precinct",
        },
        "generated": dt.date.today().isoformat(),
    }
    metadata["period"]["end"] = metadata["period"]["end"].isoformat()

    OUT.mkdir(parents=True, exist_ok=True)
    out_path = OUT / "wc-crime-precincts.geojson"
    out_path.write_text(
        json.dumps({"type": "FeatureCollection", "metadata": metadata, "features": features}, separators=(",", ":"))
    )
    print(f"wrote {out_path.relative_to(ROOT)} ({out_path.stat().st_size / 1024:.0f} KB, {len(features)} precincts)")

    points = []
    for feat in station_points["features"]:
        name = feat["properties"]["PoliceStat"]
        station = by_norm.get(norm(name))
        lon, lat = feat["geometry"]["coordinates"]
        points.append(
            {
                "type": "Feature",
                "properties": {"name": station or name},
                "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
            }
        )
    pts_path = OUT / "wc-police-stations.geojson"
    pts_path.write_text(json.dumps({"type": "FeatureCollection", "features": points}, separators=(",", ":")))
    print(f"wrote {pts_path.relative_to(ROOT)} ({pts_path.stat().st_size / 1024:.0f} KB, {len(points)} stations)")

    # Console summary for a sanity check.
    metro = [f for f in features if f["properties"]["district"] == "City of Cape Town"]
    print(f"\nCity of Cape Town precincts: {len(metro)}")
    print(f"{'precinct':22} {'pop':>8} {'all17':>7} {'rate/100k':>10} {'murder':>7} {'m/100k':>7}")
    for f in sorted(metro, key=lambda f: -(f["properties"]["rates"]["all17"] or 0))[:15]:
        p = f["properties"]
        print(
            f"{p['name']:22} {p['population'] or 0:8d} {p['counts']['all17']:7d} "
            f"{p['rates']['all17'] or 0:10.0f} {p['counts']['murder']:7d} {p['rates']['murder'] or 0:7.0f}"
        )


if __name__ == "__main__":
    main(sys.argv)
