"""
Procedural Blender model of Koeberg Nuclear Power Station (Eskom, Melkbosstrand).

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python blender/koeberg.py -- \
      --glb public/models/koeberg.glb --anchors public/models/koeberg.anchors.json --renders /tmp/koeberg/renders

Frame: metres, X east, Y north, Z up, origin at the site centroid used by Wikipedia
(33°40'35.2"S 18°25'55.37"E). Buildings are laid out in a "plant frame" whose long axis
runs 22° west of north (measured from aerial imagery) and then rotated into the true frame,
so the exported GLB needs no rotation: place it at the site lat/lon and it lines up.

glTF export converts Blender Z-up to three.js Y-up: (x, y, z) -> (x, z, -y).
Anchor points in the JSON are already converted.

Sources for dimensions: French 900 MWe CP1 containment 37 m inner diameter, 59 m high,
0.9 m walls; Eskom fact sheet NU 0001 (reactor vessel 13 m, 3 steam generators ~21 m tall,
1 HP + 3 LP turbines, 14 m generators, 40 t/s seawater per unit); aerial measurement of
footprints (Esri World Imagery, 0.25 m/px).
"""
import bpy, bmesh, math, json, sys, os
from mathutils import Vector, Matrix

# ----------------------------------------------------------------------------- args
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
GLB_PATH = arg('--glb')
ANCHORS_PATH = arg('--anchors')
RENDER_DIR = arg('--renders')
RENDER_VIEWS = arg('--views', 'all')

# ----------------------------------------------------------------------------- constants
AXIS_DEG = 22.0                      # plant long axis, degrees west of north
PLATFORM_Z = 0.0                     # site terrace; sea level is ~8 m below it
SEA_Z = -8.0
CONT_R_OUT = 19.5                    # containment outer radius (37 m inner + 0.9 m walls, rounded)
CONT_WALL = 0.9
CONT_CYL_TOP = 46.0                  # top of cylinder above platform
CONT_DOME_RISE = 7.2                 # flat torispherical cap; apex ~53 m
DOME_R_BASE = 18.6                   # dome springs slightly inside the ring beam
UNIT_V = 44.0                        # containments at v = +44 (Unit 1, north) and v = -44 (Unit 2, south)
TH_U, TH_V, TH_W, TH_L, TH_H = 58.0, 0.0, 64.0, 176.0, 33.0   # turbine hall

def plant_to_true(u, v):
    a = math.radians(AXIS_DEG)
    return (u * math.cos(a) - v * math.sin(a), u * math.sin(a) + v * math.cos(a))

# ----------------------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
coll = bpy.data.collections.new('Koeberg')
scene.collection.children.link(coll)

ROOT = bpy.data.objects.new('koeberg', None)
ROOT.rotation_euler[2] = math.radians(AXIS_DEG)   # plant frame -> true frame
coll.objects.link(ROOT)

def group(name, parent=ROOT):
    o = bpy.data.objects.new(name, None)
    o.parent = parent
    coll.objects.link(o)
    return o

G_EXT = group('exterior')
G_INT = group('interior')
G_SITE = group('site')
G_SHARDS = group('shards')

# ----------------------------------------------------------------------------- materials
def srgb(hexstr):
    h = hexstr.lstrip('#')
    c = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    # sRGB -> linear
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

_mats = {}
def mat(name, color, rough=0.75, metal=0.0, emission=None, emission_strength=3.0, alpha=1.0):
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*srgb(color), 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*srgb(emission), 1.0)
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    if alpha < 1.0:
        bsdf.inputs['Alpha'].default_value = alpha
        if hasattr(m, 'surface_render_method'):
            m.surface_render_method = 'BLENDED'
        if hasattr(m, 'blend_method'):
            m.blend_method = 'BLEND'
    _mats[name] = m
    return m

M_CONCRETE = mat('containment_concrete', '#d8d1c2', rough=0.85)
M_CONCRETE_DARK = mat('concrete_dark', '#a9a59b', rough=0.9)
M_CLADDING = mat('cladding_light', '#cfd3d6', rough=0.55, metal=0.15)
M_CLADDING_WHITE = mat('cladding_white', '#e8e9e6', rough=0.5, metal=0.1)
M_BAND = mat('band_dark', '#23272b', rough=0.6, metal=0.2)
M_TRIM_BLUE = mat('trim_blue', '#5b7fae', rough=0.5, metal=0.2)
M_AUX = mat('aux_concrete', '#6b6f73', rough=0.9)
M_ROOF = mat('roof_grey', '#5a5e62', rough=0.9)
M_ROOF_LIGHT = mat('roof_light', '#b9bcbf', rough=0.8)
M_TANK = mat('tank_white', '#eeeeea', rough=0.45, metal=0.3)
M_STEEL = mat('steel', '#9aa0a6', rough=0.4, metal=0.8)
M_STEEL_DARK = mat('steel_dark', '#4b5157', rough=0.5, metal=0.7)
M_ROAD = mat('road', '#3d4043', rough=1.0)
M_GROUND = mat('ground_sand', '#b9a98a', rough=1.0)
M_SCRUB = mat('ground_scrub', '#7f8562', rough=1.0)
M_ROCK = mat('breakwater_rock', '#6f6a62', rough=1.0)
M_GLASS = mat('glass', '#5f7f9f', rough=0.1, metal=0.6)
M_STACK = mat('stack_white', '#f0f0ee', rough=0.5)
M_RED = mat('red', '#b7332c', rough=0.6)
# interior
M_RPV = mat('rpv_steel', '#8a4b2f', rough=0.45, metal=0.7)
M_SG = mat('sg_steel', '#b8b3a6', rough=0.4, metal=0.7)
M_PRZ = mat('pressuriser', '#c98a3a', rough=0.45, metal=0.6)
M_PUMP = mat('pump', '#3f5f8f', rough=0.5, metal=0.6)
M_HOT = mat('pipe_hot', '#d0502a', rough=0.35, metal=0.6)
M_COLD = mat('pipe_cold', '#3d78c6', rough=0.35, metal=0.6)
M_STEAM = mat('pipe_steam', '#d9d9d2', rough=0.35, metal=0.6)
M_FEED = mat('pipe_feed', '#6fae5a', rough=0.35, metal=0.6)
M_SEA = mat('pipe_sea', '#2ab5c8', rough=0.35, metal=0.4)
M_TURBINE = mat('turbine', '#c9a54a', rough=0.35, metal=0.8)
M_GEN = mat('generator', '#a83a3a', rough=0.5, metal=0.5)
M_CONDENSER = mat('condenser', '#4c7a9c', rough=0.6, metal=0.5)
M_CORE = mat('core_glow', '#ffb060', rough=0.5, emission='#ff7a1a', emission_strength=6.0)
M_FLOOR = mat('int_floor', '#8c8f93', rough=0.9)
M_WATER = mat('sea_water', '#1c5d7a', rough=0.15, metal=0.0)

# ----------------------------------------------------------------------------- mesh helpers
def finish(name, bm, material, parent, loc=(0, 0, 0), rot_z=0.0, smooth_sides=False, extra=None):
    if smooth_sides:
        # smooth the curved faces, keep caps flat; split the seam so normals stay clean
        for f in bm.faces:
            f.smooth = abs(f.normal.z) < 0.7
        seam = [e for e in bm.edges if len(e.link_faces) == 2 and e.link_faces[0].smooth != e.link_faces[1].smooth]
        if seam:
            bmesh.ops.split_edges(bm, edges=seam)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    o = bpy.data.objects.new(name, me)
    o.location = loc
    o.rotation_euler[2] = rot_z
    o.parent = parent
    coll.objects.link(o)
    if extra:
        for k, v in extra.items():
            o[k] = v
    return o

def bm_box(sx, sy, sz, z0=0.0, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0, 0, z0 + sz / 2), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=min(bevel, min(sx, sy, sz) * 0.45), segments=2, profile=0.7, affect='EDGES')
    bm.normal_update()
    return bm

def box(name, sx, sy, sz, u, v, z0=0.0, m=M_AUX, parent=G_EXT, rot=0.0, bevel=0.15, extra=None):
    return finish(name, bm_box(sx, sy, sz, z0, bevel), m, parent, loc=(u, v, 0), rot_z=math.radians(rot), extra=extra)

def bm_cyl(r, h, z0=0.0, segs=48, r_top=None, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segs, radius1=r, radius2=r if r_top is None else r_top, depth=h)
    bmesh.ops.translate(bm, vec=(0, 0, z0 + h / 2), verts=bm.verts)
    bm.normal_update()
    return bm

def cyl(name, r, h, u, v, z0=0.0, m=M_TANK, parent=G_EXT, segs=48, r_top=None, extra=None):
    return finish(name, bm_cyl(r, h, z0, segs, r_top), m, parent, loc=(u, v, 0), smooth_sides=True, extra=extra)

def bm_ring(r_in, r_out, h, z0=0.0, segs=64):
    """Hollow cylinder (tube) with flat ends."""
    bm = bmesh.new()
    vs = []
    for k, r in enumerate((r_in, r_out)):
        for zz in (z0, z0 + h):
            ring = []
            for i in range(segs):
                a = 2 * math.pi * i / segs
                ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), zz)))
            vs.append(ring)
    # vs[0]=in bottom, vs[1]=in top, vs[2]=out bottom, vs[3]=out top
    def quad_strip(a, b, flip=False):
        for i in range(segs):
            j = (i + 1) % segs
            q = (a[i], a[j], b[j], b[i])
            bm.faces.new(q[::-1] if flip else q)
    quad_strip(vs[2], vs[3])                # outer wall
    quad_strip(vs[0], vs[1], flip=True)     # inner wall
    quad_strip(vs[1], vs[3])                # top annulus
    quad_strip(vs[0], vs[2], flip=True)     # bottom annulus
    bm.normal_update()
    for f in bm.faces:
        f.smooth = abs(f.normal.z) < 0.7
    return bm

def bm_spherical_cap(r_base, rise, z0, segs=64, rings=12, thickness=0.0, a0=0.0, a1=2 * math.pi, j0=0, j1=None, R_override=None):
    """Spherical cap (dome) of base radius r_base and height rise, base at z0.
    With thickness>0 a solid shell is produced. Angular range [a0,a1] and ring range [j0,j1)
    let us cut the dome into shards."""
    R = R_override or (r_base ** 2 + rise ** 2) / (2 * rise)
    zc = z0 + rise - R                   # sphere centre
    phi0 = math.asin(min(r_base / R, 1.0))  # polar angle at base
    j1 = rings if j1 is None else j1
    full = abs((a1 - a0) - 2 * math.pi) < 1e-6
    bm = bmesh.new()
    def shell(Rr):
        rows = []
        for j in range(j0, j1 + 1):
            phi = phi0 * (1 - j / rings)
            z = zc + Rr * math.cos(phi)
            rr = Rr * math.sin(phi)
            row = []
            n = segs if full else max(2, round(segs * (a1 - a0) / (2 * math.pi)))
            for i in range(n + (0 if full else 1)):
                a = a0 + (a1 - a0) * i / n
                row.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
            rows.append(row)
        return rows
    def skin(rows, flip=False):
        for j in range(len(rows) - 1):
            ra, rb = rows[j], rows[j + 1]
            n = len(ra)
            for i in range(n if full else n - 1):
                k = (i + 1) % n
                pts = (ra[i], ra[k], rb[k], rb[i])
                if rb[k] is rb[i]:
                    pts = (ra[i], ra[k], rb[i])
                try:
                    bm.faces.new(pts[::-1] if flip else pts)
                except ValueError:
                    pass
    outer = shell(R)
    skin(outer)
    if thickness > 0:
        inner = shell(R - thickness)
        skin(inner, flip=True)
        # side walls of the shard
        def wall(ro, ri, flip):
            for j in range(len(ro) - 1):
                pts = (ro[j], ro[j + 1], ri[j + 1], ri[j])
                try:
                    bm.faces.new(pts[::-1] if flip else pts)
                except ValueError:
                    pass
        # bottom rim
        rb_o, rb_i = outer[0], inner[0]
        n = len(rb_o)
        for i in range(n if full else n - 1):
            k = (i + 1) % n
            try:
                bm.faces.new((rb_o[k], rb_o[i], rb_i[i], rb_i[k]))
            except ValueError:
                pass
        if not full:
            wall([r[0] for r in outer], [r[0] for r in inner], True)
            wall([r[-1] for r in outer], [r[-1] for r in inner], False)
        # top rim if the shard doesn't reach the apex
        if j1 < rings:
            rt_o, rt_i = outer[-1], inner[-1]
            for i in range(len(rt_o) if full else len(rt_o) - 1):
                k = (i + 1) % len(rt_o)
                try:
                    bm.faces.new((rt_o[i], rt_o[k], rt_i[k], rt_i[i]))
                except ValueError:
                    pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    for f in bm.faces:
        f.smooth = True
    return bm

def bm_tube_path(points, radius, segs=16):
    """Pipe along a polyline: a chain of cylinders with spherical elbows."""
    bm = bmesh.new()
    pts = [Vector(p) for p in points]
    for a, b in zip(pts[:-1], pts[1:]):
        d = b - a
        L = d.length
        if L < 1e-4:
            continue
        seg = bmesh.new()
        bmesh.ops.create_cone(seg, cap_ends=True, segments=segs, radius1=radius, radius2=radius, depth=L)
        rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        bmesh.ops.transform(seg, matrix=Matrix.Translation((a + b) / 2) @ rot, verts=seg.verts)
        tmp = bpy.data.meshes.new('tmp')
        seg.to_mesh(tmp); seg.free()
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    for p in pts[1:-1]:
        sph = bmesh.new()
        bmesh.ops.create_uvsphere(sph, u_segments=segs, v_segments=8, radius=radius * 1.02)
        bmesh.ops.translate(sph, vec=p, verts=sph.verts)
        tmp = bpy.data.meshes.new('tmp')
        sph.to_mesh(tmp); sph.free()
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    bm.normal_update()
    for f in bm.faces:
        f.smooth = True
    return bm

def pipe(name, points, radius, m, parent=G_INT, extra=None):
    return finish(name, bm_tube_path(points, radius), m, parent, extra=extra)

# ----------------------------------------------------------------------------- anchors
ANCHORS = {'points': {}, 'paths': {}, 'meta': {}}
def to_three(p):
    """Plant-frame Blender point -> true-frame three.js point (x east, y up, z south)."""
    x, y = plant_to_true(p[0], p[1])
    return [round(x, 3), round(p[2], 3), round(-y, 3)]
def anchor(name, p):
    ANCHORS['points'][name] = to_three(p)
def anchor_path(name, pts):
    ANCHORS['paths'][name] = [to_three(p) for p in pts]

# ============================================================================= SITE
# Terrace, roads, coast, sea, breakwaters. All hideable in the map (named site_*).
terrace = box('site_terrace', 600, 800, 8.0, 100, 0, z0=-8.0, m=M_GROUND, parent=G_SITE, bevel=0)
# land east of the coastline; big enough that its edge is never in frame
box('site_land', 4200, 8000, 7.5, 1900, 0, z0=-8.0, m=M_SCRUB, parent=G_SITE, bevel=0)
# beach slope down to the sea on the west
beach = finish('site_beach', bm_box(90, 1400, 8.0, -8.0), M_GROUND, G_SITE, loc=(-245, 0, 0))
# shear the beach top down towards the sea: move top-west verts down
me = beach.data
for vtx in me.vertices:
    if vtx.co.z > -0.1 and vtx.co.x < 0:
        vtx.co.z = -7.5
# the sea itself is drawn by three.js (Ocean shader at SEA_Z)

def breakwater(name, u0, v0, u1, v1, w=18.0, h=12.0):
    L = math.hypot(u1 - u0, v1 - v0)
    ang = math.atan2(v1 - v0, u1 - u0)
    bm = bmesh.new()
    # trapezoid prism: base w*1.8, top w
    hw, hb = w / 2, w * 0.9
    z0, z1 = SEA_Z - 10, SEA_Z + h - 8   # sits on the sea floor, ~4 m above water
    prof = [(-hb, z0), (hb, z0), (hw, z1), (-hw, z1)]
    vs0 = [bm.verts.new((0, y, z)) for y, z in prof]
    vs1 = [bm.verts.new((L, y, z)) for y, z in prof]
    bm.faces.new(vs0[::-1]); bm.faces.new(vs1)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((vs0[i], vs0[j], vs1[j], vs1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(name, bm, M_ROCK, G_SITE, loc=(u0, v0, 0), rot_z=ang)

# intake basin, measured from imagery (plant frame): a north arm running almost due -u,
# a long south arm angling north-west, a spur closing the basin, and the outfall channel
breakwater('site_breakwater_north', -180, 378, -722, 353)
breakwater('site_breakwater_south', -240, -100, -914, 332, w=20, h=13)
breakwater('site_breakwater_spur', -524, 122, -564, 25, w=14, h=11)
breakwater('site_breakwater_outfall_n', -190, -185, -351, -238, w=10, h=9)
breakwater('site_breakwater_outfall_s', -190, -212, -351, -265, w=10, h=9)
# coast: the terrace and beach end at u ~ -200 (the pump house sits on the waterline)
# roads (plant frame)
def road(name, u0, v0, u1, v1, w=8.0):
    L = math.hypot(u1 - u0, v1 - v0)
    ang = math.degrees(math.atan2(v1 - v0, u1 - u0))
    box('site_' + name, L, w, 0.15, (u0 + u1) / 2, (v0 + v1) / 2, z0=0.02, m=M_ROAD, parent=G_SITE, rot=ang, bevel=0)

road('road_main_ns', 130, -300, 130, 320)
road('road_front', 110, -140, 110, 120, w=6)
road('road_north', -120, 150, 330, 150)
road('road_south', -160, -150, 330, -150)
road('road_west', -160, -150, -160, 150)
road('road_entrance', 130, 100, 480, 100, w=10)
road('road_east_1', 250, -300, 250, 320)
road('road_pump', -160, 60, -230, 60, w=6)
# car park with shade structures (north-east)
box('site_carpark', 150, 110, 0.15, 330, 250, z0=0.02, m=M_ROAD, parent=G_SITE, bevel=0)
for i in range(5):
    for j in range(3):
        box(f'site_carport_{i}_{j}', 22, 24, 0.3, 275 + i * 28, 218 + j * 32, z0=3.0, m=M_TRIM_BLUE, parent=G_SITE, bevel=0)
# security fence line (double fence around the protected area)
fence_m = mat('fence', '#8d9195', rough=0.6, metal=0.6)
for k, inset in enumerate((0, 6)):
    for name, (u0, v0, u1, v1) in {
        'n': (-200 + inset, 330 - inset, 470 - inset, 330 - inset),
        's': (-200 + inset, -330 + inset, 470 - inset, -330 + inset),
        'e': (470 - inset, -330 + inset, 470 - inset, 330 - inset),
    }.items():
        L = math.hypot(u1 - u0, v1 - v0)
        ang = math.degrees(math.atan2(v1 - v0, u1 - u0))
        box(f'site_fence_{k}_{name}', L, 0.15, 3.0, (u0 + u1) / 2, (v0 + v1) / 2, m=fence_m, parent=G_SITE, rot=ang, bevel=0)

# ============================================================================= NUCLEAR ISLAND
def containment(unit, v):
    tag = f'u{unit}'
    # raised base ring / foundation apron
    cyl(f'ext_{tag}_apron', CONT_R_OUT + 3.0, 1.2, 0, v, m=M_CONCRETE_DARK, segs=72)
    # cylinder wall (hollow so the cutaway reveals the interior)
    finish(f'ext_{tag}_cylinder', bm_ring(CONT_R_OUT - CONT_WALL, CONT_R_OUT, CONT_CYL_TOP, 0.0, 96), M_CONCRETE, G_EXT, loc=(0, v, 0))
    # ring beam / gallery at the top of the cylinder
    finish(f'ext_{tag}_ringbeam', bm_ring(CONT_R_OUT - 1.4, CONT_R_OUT + 0.9, 1.6, CONT_CYL_TOP - 0.2, 96), M_CONCRETE, G_EXT, loc=(0, v, 0))
    finish(f'ext_{tag}_ringrail', bm_ring(CONT_R_OUT + 0.7, CONT_R_OUT + 0.9, 1.1, CONT_CYL_TOP + 1.4, 96), M_STEEL, G_EXT, loc=(0, v, 0))
    # faint vertical tendon buttresses (visible stripes on the real containments)
    for i in range(12):
        a = 2 * math.pi * i / 12 + 0.13
        box(f'ext_{tag}_tendon_{i}', 0.6, 1.2, CONT_CYL_TOP - 2.0, (CONT_R_OUT) * math.cos(a), v + (CONT_R_OUT) * math.sin(a), z0=1.0, m=M_CONCRETE, rot=math.degrees(a), bevel=0)
    # dome: unit 1 is pre-fractured into shards for the accident scene, unit 2 is one piece
    if unit == 1:
        sectors, rings_n = 10, 3
        rings = 12
        bounds = [0, 4, 8, 12]
        for s in range(sectors):
            a0 = 2 * math.pi * s / sectors
            a1 = 2 * math.pi * (s + 1) / sectors
            for r in range(rings_n):
                j0, j1 = bounds[r], bounds[r + 1]
                bm = bm_spherical_cap(DOME_R_BASE, CONT_DOME_RISE, CONT_CYL_TOP, segs=80, rings=rings, thickness=CONT_WALL, a0=a0, a1=a1, j0=j0, j1=j1)
                # move origin to the shard centroid so it can tumble in three.js
                c = Vector((0, 0, 0))
                for vv in bm.verts:
                    c += vv.co
                c /= max(1, len(bm.verts))
                bmesh.ops.translate(bm, vec=-c, verts=bm.verts)
                finish(f'shard_{tag}_{s}_{r}', bm, M_CONCRETE, G_SHARDS, loc=(c.x, v + c.y, c.z), extra={'shard': 1})
        anchor(f'{tag}_dome_apex', (0, v, CONT_CYL_TOP + CONT_DOME_RISE))
    else:
        finish(f'ext_{tag}_dome', bm_spherical_cap(DOME_R_BASE, CONT_DOME_RISE, CONT_CYL_TOP, segs=96, rings=14, thickness=CONT_WALL), M_CONCRETE, G_EXT, loc=(0, v, 0))
        anchor(f'{tag}_dome_apex', (0, v, CONT_CYL_TOP + CONT_DOME_RISE))
    # small mast on the apex and a ring walkway around the dome base
    cyl(f'ext_{tag}_mast', 0.15, 7.0, 0, v, z0=CONT_CYL_TOP + CONT_DOME_RISE - 0.2, m=M_STEEL, segs=8)
    # personnel airlock / equipment hatch bulge on the turbine hall side
    box(f'ext_{tag}_hatch', 6, 8, 9, CONT_R_OUT + 2.0, v - 6, z0=12, m=M_CONCRETE_DARK, bevel=0.2)
    # interior floor slab at grade (so the cutaway has a floor)
    cyl(f'int_{tag}_floor', CONT_R_OUT - CONT_WALL - 0.05, 0.5, 0, v, z0=0.0, m=M_FLOOR, parent=G_INT, segs=72)

containment(1, UNIT_V)
containment(2, -UNIT_V)

# Nuclear auxiliary building: wraps the west side of both containments
box('ext_nab_west', 34, 200, 22, -40, 0, m=M_AUX, bevel=0.3)
box('ext_nab_roof_plant', 20, 60, 4, -40, 20, z0=22, m=M_ROOF, bevel=0.2)
# fuel buildings, one per unit, between the containment and the NAB
box('ext_fuel_u1', 26, 30, 26, -26, UNIT_V + 26, m=M_AUX, bevel=0.3)
box('ext_fuel_u2', 26, 30, 26, -26, -UNIT_V - 26, m=M_AUX, bevel=0.3)
# safeguard / electrical buildings between the domes and the turbine hall
box('ext_elec_connect', 12, 176, 19, TH_U - TH_W / 2 - 6, 0, m=M_AUX, bevel=0.2)
box('ext_elec_mid', 20, 30, 24, 8, 0, m=M_AUX, bevel=0.3)         # between the two domes
box('ext_elec_north', 22, 28, 20, 6, UNIT_V + 36, m=M_AUX, bevel=0.3)
box('ext_elec_south', 22, 28, 20, 6, -UNIT_V - 36, m=M_AUX, bevel=0.3)
# vent stack between the domes, on the turbine hall side, nearer the south unit
STACK_U, STACK_V, STACK_H = 12.0, -14.0, 66.0
cyl('ext_stack', 1.6, STACK_H, STACK_U, STACK_V, m=M_STACK, segs=32)
cyl('ext_stack_platform', 2.6, 0.4, STACK_U, STACK_V, z0=STACK_H - 8, m=M_STEEL, segs=32)
cyl('ext_stack_cap', 1.8, 1.2, STACK_U, STACK_V, z0=STACK_H, m=M_STEEL_DARK, segs=32)
anchor('stack_top', (STACK_U, STACK_V, STACK_H + 1.2))

# ============================================================================= TURBINE HALL
th = box('ext_th_body', TH_W, TH_L, TH_H, TH_U, TH_V, m=M_CLADDING, bevel=0.3)
# dark band, blue trim, pilasters
box('ext_th_band_e', 0.5, TH_L + 0.2, 3.0, TH_U + TH_W / 2 + 0.2, TH_V, z0=20.5, m=M_BAND, bevel=0)
box('ext_th_band_w', 0.5, TH_L + 0.2, 3.0, TH_U - TH_W / 2 - 0.2, TH_V, z0=20.5, m=M_BAND, bevel=0)
box('ext_th_band_n', TH_W + 0.2, 0.5, 3.0, TH_U, TH_V + TH_L / 2 + 0.2, z0=20.5, m=M_BAND, bevel=0)
box('ext_th_band_s', TH_W + 0.2, 0.5, 3.0, TH_U, TH_V - TH_L / 2 - 0.2, z0=20.5, m=M_BAND, bevel=0)
box('ext_th_trim_top', TH_W + 0.4, TH_L + 0.4, 0.5, TH_U, TH_V, z0=TH_H - 0.5, m=M_TRIM_BLUE, bevel=0)
for i in range(7):
    vv = TH_V - TH_L / 2 + 8 + i * 26.7
    box(f'ext_th_pilaster_e_{i}', 0.5, 0.35, TH_H - 1, TH_U + TH_W / 2 + 0.2, vv, m=M_TRIM_BLUE, bevel=0)
    box(f'ext_th_pilaster_w_{i}', 0.5, 0.35, TH_H - 1, TH_U - TH_W / 2 - 0.2, vv, m=M_TRIM_BLUE, bevel=0)
# roof monitor (raised centre strip) and vents
box('ext_th_roof', TH_W - 1.0, TH_L - 1.0, 0.4, TH_U, TH_V, z0=TH_H, m=M_ROOF, bevel=0)
box('ext_th_roof_monitor', 14, TH_L - 20, 2.5, TH_U, TH_V, z0=TH_H + 0.4, m=M_ROOF_LIGHT, bevel=0.2)
for i in range(8):
    box(f'ext_th_roofvent_{i}', 3, 3, 1.6, TH_U + 18, TH_V - 70 + i * 20, z0=TH_H, m=M_ROOF, bevel=0.1)
    box(f'ext_th_roofvent_b_{i}', 3, 3, 1.6, TH_U - 18, TH_V - 70 + i * 20, z0=TH_H, m=M_ROOF, bevel=0.1)
# two white hooded annexes on the east façade (as in the photographs)
for k, vv in enumerate((TH_V + 45, TH_V - 45)):
    box(f'ext_th_annex_{k}', 8, 22, 9, TH_U + TH_W / 2 + 4, vv, m=M_CLADDING_WHITE, bevel=0.2)
    box(f'ext_th_annex_roof_{k}', 8.6, 22.6, 0.5, TH_U + TH_W / 2 + 4, vv, z0=9, m=M_TRIM_BLUE, bevel=0)
# window rows
for i in range(14):
    vv = TH_V - TH_L / 2 + 6 + i * 12.5
    box(f'ext_th_window_{i}', 0.3, 3.0, 2.0, TH_U + TH_W / 2 + 0.25, vv, z0=6, m=M_GLASS, bevel=0)
# transformer yard against the east façade (generator step-up transformers)
for k, vv in enumerate((TH_V + 20, TH_V + 5, TH_V - 20, TH_V - 35)):
    box(f'ext_transformer_{k}', 6, 9, 6, TH_U + TH_W / 2 + 16, vv, m=M_STEEL_DARK, bevel=0.2)
    box(f'ext_transformer_rad_{k}', 3, 9.5, 5, TH_U + TH_W / 2 + 20.5, vv, z0=0.5, m=M_STEEL, bevel=0.1)
    for p in range(3):
        cyl(f'ext_transformer_bush_{k}_{p}', 0.35, 3.5, TH_U + TH_W / 2 + 14.5 + p * 1.5, vv - 2 + p * 2, z0=6, m=M_CONCRETE, segs=12)
# low plinth in front of the hall and the stepped embankment
box('ext_th_plinth', 24, TH_L + 20, 4.5, TH_U + TH_W / 2 + 12, TH_V, m=M_CONCRETE_DARK, bevel=0)
box('ext_th_embankment', 30, TH_L + 40, 2.0, TH_U + TH_W / 2 + 34, TH_V, m=M_GROUND, bevel=0)

# ============================================================================= OTHER BUILDINGS
# striped-roof auxiliary block north of the turbine hall (diesels, workshops)
for i in range(4):
    box(f'ext_diesel_{i}', 78, 15, 14, 45, 106 + i * 18, m=M_CLADDING_WHITE, bevel=0.3)
    box(f'ext_diesel_roof_{i}', 78.4, 15.4, 0.6, 45, 106 + i * 18, z0=14, m=M_ROOF_LIGHT, bevel=0)
box('ext_north_block', 70, 60, 12, 70, 266, m=M_AUX, bevel=0.3)
box('ext_north_block_2', 40, 28, 16, 25, 240, m=M_AUX, bevel=0.3)
# demineralised water and reserve tanks
for k, (uu, vv, r) in enumerate(((2, 200, 7.5), (20, 198, 7.5), (-14, 212, 6.0), (-103, -35, 7.0), (-92, -52, 6.0))):
    cyl(f'ext_tank_{k}', r, 12.0, uu, vv, m=M_TANK, segs=40)
    cyl(f'ext_tank_top_{k}', r + 0.2, 0.6, uu, vv, z0=12.0, m=M_STEEL, segs=40)
# pump house on the intake basin (seawater intake, 80 t/s for both units)
PH_U, PH_V = -169.0, 61.0
box('ext_pumphouse', 36, 100, 18, PH_U, PH_V, m=M_CLADDING_WHITE, bevel=0.3)
box('ext_pumphouse_roof', 36.6, 100.6, 0.8, PH_U, PH_V, z0=18, m=M_ROOF_LIGHT, bevel=0)
box('ext_pumphouse_screens', 30, 100, 4, PH_U - 26, PH_V, z0=-4, m=M_CONCRETE_DARK, bevel=0)
box('ext_pumphouse_deck', 40, 130, 9, PH_U - 6, PH_V, z0=-8, m=M_CONCRETE_DARK, bevel=0)
for i in range(6):
    cyl(f'ext_pumphouse_screen_{i}', 2.2, 5, PH_U - 30, PH_V - 40 + i * 16, z0=-4, m=M_STEEL_DARK, segs=16)
# white store building south of the domes and warehouses to the south-east
box('ext_store_south', 40, 30, 12, -41, -96, m=M_CLADDING_WHITE, bevel=0.3)
for i in range(4):
    box(f'ext_warehouse_{i}', 26, 70, 9, 50 + i * 34, -235, m=M_CLADDING_WHITE, bevel=0.3)
    box(f'ext_warehouse_roof_{i}', 26.4, 70.4, 0.6, 50 + i * 34, -235, z0=9, m=M_ROOF_LIGHT, bevel=0)
box('ext_workshop_a', 60, 24, 10, 190, -180, m=M_AUX, bevel=0.3)
box('ext_workshop_b', 50, 24, 10, 200, -120, m=M_CLADDING_WHITE, bevel=0.3)
# admin / office blocks east of the front road
box('ext_admin_1', 45, 35, 12, 225, -6, m=M_AUX, bevel=0.3)
box('ext_admin_2', 30, 60, 15, 215, 55, m=M_CLADDING, bevel=0.3)
box('ext_admin_3', 60, 20, 12, 240, 112, m=M_CLADDING_WHITE, bevel=0.3)
box('ext_visitor_centre', 30, 30, 8, 300, 140, m=M_CLADDING_WHITE, bevel=0.3)
# indoor 400 kV switchyard (Koeberg's switchyard is enclosed) with outdoor gantries
SY_U, SY_V = 217.0, 196.0
box('ext_switchyard_hall', 120, 140, 15, SY_U, SY_V, m=M_AUX, bevel=0.4)
box('ext_switchyard_roof', 120.4, 140.4, 0.8, SY_U, SY_V, z0=15, m=M_ROOF, bevel=0)
for i in range(6):
    box(f'ext_switchyard_bushing_{i}', 4, 4, 5, SY_U - 40 + i * 16, SY_V + 60, z0=15, m=M_STEEL, bevel=0.1)
# gantry frames on the north side of the switchyard where the lines leave
for i in range(3):
    uu = SY_U - 30 + i * 30
    for du in (-8, 8):
        box(f'ext_gantry_leg_{i}_{du}', 1.2, 1.2, 24, uu + du, SY_V + 80, m=M_STEEL, bevel=0)
    box(f'ext_gantry_beam_{i}', 20, 1.0, 1.2, uu, SY_V + 80, z0=23, m=M_STEEL, bevel=0)

# transmission pylons marching away to the north-east (the iconic 400 kV lines)
def pylon(name, u, v, h=42.0, parent=G_SITE):
    g = group(name, parent)
    g.location = (u, v, 0)
    w0, w1 = 7.0, 2.2
    for sx in (-1, 1):
        for sy in (-1, 1):
            pts = [(sx * w0, sy * w0, 0), (sx * w1, sy * w1, h * 0.75), (sx * w1, sy * w1, h)]
            finish(f'{name}_leg_{sx}_{sy}', bm_tube_path(pts, 0.28, 6), M_STEEL, g)
    for z, hw in ((h * 0.62, 12.0), (h * 0.78, 10.0), (h * 0.94, 8.0)):
        finish(f'{name}_arm_{int(z)}', bm_tube_path([(-hw, 0, z), (hw, 0, z)], 0.25, 6), M_STEEL, g)
        for sx in (-1, 1):
            finish(f'{name}_brace_{int(z)}_{sx}', bm_tube_path([(sx * hw, 0, z), (sx * w1, 0, z - 5)], 0.16, 5), M_STEEL, g)
    # cross bracing
    for z0_ in range(0, int(h * 0.7), 8):
        f = 1 - z0_ / h
        ww = w0 * f + w1 * (1 - f)
        finish(f'{name}_ring_{z0_}', bm_tube_path([(-ww, -ww, z0_), (ww, -ww, z0_), (ww, ww, z0_), (-ww, ww, z0_), (-ww, -ww, z0_)], 0.14, 5), M_STEEL, g)
    return g

PYLONS = [(240, 320), (300, 430), (365, 545), (430, 660), (140, 330), (150, 450), (160, 570)]
for i, (pu, pv) in enumerate(PYLONS):
    pylon(f'site_pylon_{i}', pu, pv)
# conductors between consecutive pylons (two runs)
def conductors(run, tag):
    for k in range(len(run) - 1):
        (u0, v0), (u1, v1) = run[k], run[k + 1]
        for z, hw in ((42 * 0.62, 12.0), (42 * 0.78, 10.0), (42 * 0.94, 8.0)):
            for sx in (-1, 1):
                mid = ((u0 + u1) / 2 + sx * hw, (v0 + v1) / 2, z - 6)
                finish(f'site_wire_{tag}_{k}_{int(z)}_{sx}', bm_tube_path([(u0 + sx * hw, v0, z), mid, (u1 + sx * hw, v1, z)], 0.08, 4), M_STEEL_DARK, G_SITE)
conductors(PYLONS[:4], 'a')
conductors(PYLONS[4:], 'b')
# lines from the gantries to the first pylons
for sx in (-1, 1):
    finish(f'site_wire_gantry_a_{sx}', bm_tube_path([(SY_U - 30 + sx * 8, SY_V + 80, 23), (240 + sx * 8, 320, 42 * 0.62)], 0.08, 4), M_STEEL_DARK, G_SITE)
    finish(f'site_wire_gantry_b_{sx}', bm_tube_path([(SY_U + sx * 8, SY_V + 80, 23), (140 + sx * 8, 330, 42 * 0.62)], 0.08, 4), M_STEEL_DARK, G_SITE)

# lamp posts along the front road
for i in range(10):
    cyl(f'site_lamp_{i}', 0.18, 14, 118, -140 + i * 30, m=M_STEEL, segs=8, parent=G_SITE)

# ============================================================================= INTERIOR
# Primary circuit, one per unit. Loops at 90°, 210°, 330° around the vessel.
def primary(unit, v):
    tag = f'u{unit}'
    g = group(f'int_{tag}_primary', G_INT)
    g.location = (0, v, 0)
    # reactor pressure vessel: 4.4 m dia, 13 m tall, in a concrete cavity
    RPV_R, RPV_H, RPV_Z = 2.2, 13.0, 3.0
    finish(f'int_{tag}_rpv', bm_cyl(RPV_R, RPV_H - 2 * RPV_R, RPV_Z + RPV_R, 40), M_RPV, g, smooth_sides=True)
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=16, radius=RPV_R); bmesh.ops.translate(bm, vec=(0, 0, RPV_Z + RPV_R), verts=bm.verts)
    for f in bm.faces: f.smooth = True
    finish(f'int_{tag}_rpv_bottom', bm, M_RPV, g)
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=16, radius=RPV_R); bmesh.ops.translate(bm, vec=(0, 0, RPV_Z + RPV_H - RPV_R), verts=bm.verts)
    for f in bm.faces: f.smooth = True
    finish(f'int_{tag}_rpv_head', bm, M_RPV, g)
    # control rod drive mechanisms on the head
    for i in range(9):
        a = 2 * math.pi * i / 9
        r = 1.1 if i % 2 else 0.6
        cyl(f'int_{tag}_crdm_{i}', 0.16, 4.5, r * math.cos(a), r * math.sin(a), z0=RPV_Z + RPV_H - 0.3, m=M_STEEL, parent=g, segs=8)
    # core: 157 fuel assemblies, 3.66 m active height, ~3.4 m across
    CORE_Z = RPV_Z + 3.5
    finish(f'int_{tag}_core', bm_cyl(1.7, 3.66, CORE_Z, 32), M_CORE, g, smooth_sides=True, extra={'core': 1})
    anchor(f'{tag}_core', (0, v, CORE_Z + 1.83))
    anchor(f'{tag}_rpv_top', (0, v, RPV_Z + RPV_H))
    # concrete biological shield around the vessel
    finish(f'int_{tag}_shield', bm_ring(RPV_R + 0.6, RPV_R + 2.4, RPV_H - 1.5, RPV_Z - 1.0, 48), M_AUX, g)
    # loops
    SG_R, SG_H, SG_RAD = 2.25, 21.0, 11.5
    SG_Z = 1.5
    PRZ_R, PRZ_H = 1.25, 13.0
    for k, ang in enumerate((90, 210, 330)):
        a = math.radians(ang)
        su, sv = SG_RAD * math.cos(a), SG_RAD * math.sin(a)
        # steam generator: lower shell 3.4 m dia, upper (steam drum) 4.5 m dia
        finish(f'int_{tag}_sg{k}_lower', bm_cyl(1.7, 10.5, SG_Z, 40), M_SG, g, loc=(su, sv, 0), smooth_sides=True)
        finish(f'int_{tag}_sg{k}_cone', bm_cyl(1.7, 2.0, SG_Z + 10.5, 40, r_top=SG_R), M_SG, g, loc=(su, sv, 0), smooth_sides=True)
        finish(f'int_{tag}_sg{k}_upper', bm_cyl(SG_R, SG_H - 12.5 - SG_R, SG_Z + 12.5, 40), M_SG, g, loc=(su, sv, 0), smooth_sides=True)
        bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=16, radius=SG_R); bmesh.ops.translate(bm, vec=(su, sv, SG_Z + SG_H - SG_R), verts=bm.verts)
        for f in bm.faces: f.smooth = True
        finish(f'int_{tag}_sg{k}_head', bm, M_SG, g)
        bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=16, radius=1.7); bmesh.ops.translate(bm, vec=(su, sv, SG_Z), verts=bm.verts)
        for f in bm.faces: f.smooth = True
        finish(f'int_{tag}_sg{k}_bowl', bm, M_SG, g)
        # reactor coolant pump, offset tangentially from the SG
        t = a + math.radians(28)
        pu_, pv_ = 10.5 * math.cos(t), 10.5 * math.sin(t)
        finish(f'int_{tag}_rcp{k}_casing', bm_cyl(1.5, 3.0, 1.0, 32), M_PUMP, g, loc=(pu_, pv_, 0), smooth_sides=True)
        finish(f'int_{tag}_rcp{k}_motor', bm_cyl(1.1, 6.0, 4.0, 32), M_STEEL, g, loc=(pu_, pv_, 0), smooth_sides=True)
        # hot leg: vessel outlet nozzle -> SG inlet (bottom bowl)
        HL_Z = RPV_Z + RPV_H - 4.0     # nozzle height ~12 m
        n_u, n_v = (RPV_R + 0.2) * math.cos(a), (RPV_R + 0.2) * math.sin(a)
        hot = [(n_u, n_v, HL_Z), ((SG_RAD - 2.2) * math.cos(a), (SG_RAD - 2.2) * math.sin(a), HL_Z), ((SG_RAD - 1.2) * math.cos(a), (SG_RAD - 1.2) * math.sin(a), SG_Z - 0.3)]
        pipe(f'int_{tag}_hotleg{k}', hot, 0.38, M_HOT, g)
        # crossover leg: SG outlet -> down under -> pump inlet
        cross = [(su + 1.4 * math.cos(t), sv + 1.4 * math.sin(t), SG_Z - 0.6), (su + 1.4 * math.cos(t), sv + 1.4 * math.sin(t), -1.0), (pu_, pv_, -1.0), (pu_, pv_, 0.8)]
        pipe(f'int_{tag}_crossover{k}', cross, 0.38, M_COLD, g)
        # cold leg: pump outlet -> vessel inlet nozzle
        a2 = a + math.radians(40)
        cold = [(pu_, pv_, HL_Z - 1.0), ((RPV_R + 0.2) * math.cos(a2), (RPV_R + 0.2) * math.sin(a2), HL_Z - 1.0)]
        pipe(f'int_{tag}_coldleg{k}', [(pu_, pv_, 2.5)] + cold, 0.38, M_COLD, g)
        # anchors: full primary loop path, through the vessel (down the downcomer, up through the core)
        loop_path = [
            (0, 0, CORE_Z - 1.0), (0, 0, CORE_Z + 3.0), (0, 0, HL_Z),
            *hot,
            # up the SG tubes and back down
            (su, sv, SG_Z + 3.0), (su, sv, SG_Z + 9.5), (su + 0.9 * math.cos(t), sv + 0.9 * math.sin(t), SG_Z + 3.0),
            *cross,
            (pu_, pv_, 2.5), *cold,
            (RPV_R * 0.5 * math.cos(a2), RPV_R * 0.5 * math.sin(a2), HL_Z - 3.0), (0, 0, CORE_Z - 1.0),
        ]
        anchor_path(f'{tag}_primary_{k}', [(x, y + v, z) for x, y, z in loop_path])
        anchor(f'{tag}_sg{k}_top', (su, sv + v, SG_Z + SG_H))
        anchor(f'{tag}_sg{k}', (su, sv + v, SG_Z + SG_H * 0.6))
        anchor(f'{tag}_rcp{k}', (pu_, pv_ + v, 5.0))
    # pressuriser between loops 1 and 2 (at 150°), connected to hot leg 0 by a surge line
    pa = math.radians(150)
    PZ_U, PZ_V = 13.0 * math.cos(pa), 13.0 * math.sin(pa)
    finish(f'int_{tag}_pressuriser', bm_cyl(PRZ_R, PRZ_H - 2 * PRZ_R, 5.0 + PRZ_R, 32), M_PRZ, g, loc=(PZ_U, PZ_V, 0), smooth_sides=True)
    for zz in (5.0 + PRZ_R, 5.0 + PRZ_H - PRZ_R):
        bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=12, radius=PRZ_R); bmesh.ops.translate(bm, vec=(PZ_U, PZ_V, zz), verts=bm.verts)
        for f in bm.faces: f.smooth = True
        finish(f'int_{tag}_pressuriser_cap_{int(zz)}', bm, M_PRZ, g)
    surge = [(PZ_U, PZ_V, 5.0), (PZ_U, PZ_V, 3.0), (5.5 * math.cos(math.radians(90)), 5.5 * math.sin(math.radians(90)), 3.0), (5.5 * math.cos(math.radians(90)), 5.5 * math.sin(math.radians(90)), RPV_Z + RPV_H - 4.0)]
    pipe(f'int_{tag}_surgeline', surge, 0.18, M_HOT, g)
    anchor(f'{tag}_pressuriser', (PZ_U, PZ_V + v, 5.0 + PRZ_H * 0.5))
    # polar crane rail ring near the top of the containment
    finish(f'int_{tag}_crane_rail', bm_ring(CONT_R_OUT - CONT_WALL - 1.2, CONT_R_OUT - CONT_WALL - 0.1, 0.8, CONT_CYL_TOP - 6.0, 96), M_STEEL, g)
    finish(f'int_{tag}_crane_bridge', bm_box(2 * (CONT_R_OUT - CONT_WALL - 1.3), 3.0, 2.2, CONT_CYL_TOP - 5.5), M_STEEL_DARK, g, rot_z=math.radians(20))
    # operating deck (annular, at ~ +20 m) with a hole for the vessel and SG cubicles
    finish(f'int_{tag}_deck', bm_ring(4.5, CONT_R_OUT - CONT_WALL - 0.1, 0.8, 19.5, 72), M_FLOOR, g, extra={'deck': 1})
    # main steam lines: from each SG top, up and out through the wall towards the turbine hall (+u)
    steam_pts_all = []
    for k, ang in enumerate((90, 210, 330)):
        a = math.radians(ang)
        su, sv = SG_RAD * math.cos(a), SG_RAD * math.sin(a)
        pts = [(su, sv, SG_Z + SG_H), (su, sv, SG_Z + SG_H + 2.5), (su, sv * 0.35, SG_Z + SG_H + 2.5), (CONT_R_OUT + 2.0, sv * 0.35, SG_Z + SG_H + 2.5)]
        pipe(f'int_{tag}_steamline{k}', pts, 0.42, M_STEAM, g)
        steam_pts_all.append(pts)
    # feedwater lines back into the SGs (lower, green)
    for k, ang in enumerate((90, 210, 330)):
        a = math.radians(ang)
        su, sv = SG_RAD * math.cos(a), SG_RAD * math.sin(a)
        pts = [(CONT_R_OUT + 2.0, sv * 0.35 + 1.6, 14.5), (su * 0.7 + 3.0, sv * 0.35 + 1.6, 14.5), (su, sv + (1.6 if k == 0 else 0), 14.5), (su, sv, 14.5)]
        pipe(f'int_{tag}_feedline{k}', pts, 0.3, M_FEED, g)
    return steam_pts_all

steam_u1 = primary(1, UNIT_V)
steam_u2 = primary(2, -UNIT_V)

# Turbine hall interior: one turbo-generator per unit on a shared operating floor at +12 m.
TG_Z = 12.0
finish('int_th_floor', bm_box(TH_W - 2, TH_L - 2, 1.0, TG_Z - 1.0), M_FLOOR, G_INT, loc=(TH_U, TH_V, 0), extra={'deck': 1})
# hall crane rails
for du in (-TH_W / 2 + 2, TH_W / 2 - 2):
    finish(f'int_th_cranerail_{int(du)}', bm_box(1.0, TH_L - 4, 1.0, TH_H - 6), M_STEEL_DARK, G_INT, loc=(TH_U + du, TH_V, 0))
finish('int_th_crane', bm_box(TH_W - 6, 4.0, 2.5, TH_H - 5.5), M_STEEL_DARK, G_INT, loc=(TH_U, TH_V + 30, 0))

def turbo_generator(unit, v_centre, steam_pts):
    tag = f'u{unit}'
    g = group(f'int_{tag}_turbine_set', G_INT)
    g.location = (TH_U, v_centre, 0)
    # shaft runs along v (the long axis); HP at the containment end, then 3 LPs, then generator
    sign = 1 if unit == 1 else -1   # unit 1 set points north from the middle, unit 2 south
    # Unit 1 dome is at v=+44; its turbine set is centred on the same v. HP nearest the middle.
    order = [('hp', 8.0, 2.6, M_TURBINE), ('lp0', 9.0, 4.3, M_TURBINE), ('lp1', 9.0, 4.3, M_TURBINE), ('lp2', 9.0, 4.3, M_TURBINE), ('gen', 14.0, 2.6, M_GEN), ('exciter', 3.0, 1.2, M_STEEL)]
    total = sum(L for _, L, _, _ in order) + 3.0 * (len(order) - 1)
    pos = -total / 2
    items = {}
    for name, L, r, mm in order:
        c = pos + L / 2
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=40, radius1=r, radius2=r, depth=L)
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'X'), verts=bm.verts)
        for f in bm.faces:
            f.smooth = abs(f.normal.y) < 0.7
        # fins across the casing so the spin reads on screen
        if name != 'exciter':
            for fi in range(2):
                fin = bmesh.new()
                bmesh.ops.create_cube(fin, size=1.0)
                bmesh.ops.scale(fin, vec=(2 * r + 0.5, L * 0.85, 0.35), verts=fin.verts)
                bmesh.ops.rotate(fin, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90 * fi), 3, 'Y'), verts=fin.verts)
                tmp = bpy.data.meshes.new('tmp'); fin.to_mesh(tmp); fin.free(); bm.from_mesh(tmp); bpy.data.meshes.remove(tmp)
        finish(f'int_{tag}_{name}', bm, mm, g, loc=(0, c, TG_Z + r), extra={'rotor': 1} if name != 'exciter' else None)
        # pedestal
        finish(f'int_{tag}_{name}_pedestal', bm_box(2 * r + 1.5, L + 1.0, 1.2, TG_Z), M_FLOOR, g, loc=(0, c, 0))
        items[name] = c
        anchor(f'{tag}_{name}', (TH_U, v_centre + c, TG_Z + r))
        pos += L + 3.0
    # shaft
    finish(f'int_{tag}_shaft', bm_tube_path([(0, -total / 2 - 1.0, 0), (0, total / 2 + 1.0, 0)], 0.55, 16), M_STEEL, g, loc=(0, 0, TG_Z + 2.6))
    # condensers under the LP turbines, cooled by seawater
    for k in range(3):
        c = items[f'lp{k}']
        finish(f'int_{tag}_condenser{k}', bm_box(11.0, 8.5, 8.0, 1.5), M_CONDENSER, g, loc=(0, c, 0))
        anchor(f'{tag}_condenser{k}', (TH_U, v_centre + c, 5.5))
    # moisture separator reheaters either side of the LPs
    for du in (-7.5, 7.5):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=1.6, radius2=1.6, depth=28)
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, 'X'), verts=bm.verts)
        bmesh.ops.translate(bm, vec=(du, items['lp1'], TG_Z + 4.0), verts=bm.verts)
        for f in bm.faces: f.smooth = abs(f.normal.y) < 0.7
        finish(f'int_{tag}_msr_{int(du)}', bm, M_STEEL, g)
    # main steam header: from the containment wall (west) into the HP turbine, in world/plant coords
    hp_v = v_centre + items['hp']
    dome_v = UNIT_V if unit == 1 else -UNIT_V
    header = [(CONT_R_OUT + 2.0, dome_v, 25.0), (TH_U - TH_W / 2 - 2.0, dome_v, 25.0), (TH_U - 12, dome_v, 25.0), (TH_U - 12, hp_v, 25.0), (TH_U - 3.5, hp_v, TG_Z + 8.0), (TH_U - 2.6, hp_v, TG_Z + 3.5)]
    pipe(f'int_{tag}_mainsteam_header', header, 0.55, M_STEAM, G_INT)
    # secondary loop path for the animation: SG top -> header -> HP -> MSR -> LPs -> condenser -> feed pump -> back to SG
    sec = [
        (steam_pts[0][0][0], steam_pts[0][0][1] + dome_v, steam_pts[0][0][2]),
        (steam_pts[0][-1][0], steam_pts[0][-1][1] + dome_v, steam_pts[0][-1][2]),
        *header,
        (TH_U, hp_v, TG_Z + 2.6),
        (TH_U + 7.5, v_centre + items['lp0'] - 3, TG_Z + 4.0),
        (TH_U, v_centre + items['lp0'], TG_Z + 4.3),
        (TH_U, v_centre + items['lp1'], TG_Z + 4.3),
        (TH_U, v_centre + items['lp2'], TG_Z + 4.3),
        (TH_U, v_centre + items['lp2'], 5.5),
        (TH_U, v_centre + items['lp1'], 5.5),
        (TH_U, v_centre + items['lp0'], 4.0),
        (TH_U - 14, v_centre + items['lp0'], 4.0),
        (TH_U - 14, dome_v + 1.6, 14.5),
        (CONT_R_OUT + 2.0, dome_v + steam_pts[0][0][1] * 0.35 + 1.6, 14.5),
        (steam_pts[0][0][0], steam_pts[0][0][1] + dome_v, 14.5),
    ]
    anchor_path(f'{tag}_secondary', sec)
    # feedwater pipe from the condensers back towards the containment (green)
    pipe(f'int_{tag}_feed_return', [(TH_U - 14, v_centre + items['lp0'], 4.0), (TH_U - 14, dome_v + 1.6, 4.0), (TH_U - 14, dome_v + 1.6, 14.5), (TH_U - TH_W / 2 - 2.0, dome_v + 1.6, 14.5), (CONT_R_OUT + 2.0, dome_v + 1.6, 14.5)], 0.32, M_FEED, G_INT)
    # seawater culverts: pump house -> condensers -> outfall (tertiary loop, 40 t/s per unit)
    sea_in = [(PH_U - 20, PH_V, -4.0), (PH_U + 10, PH_V, -4.0), (PH_U + 10, v_centre + items['lp1'], -4.0), (TH_U - 8, v_centre + items['lp1'], -4.0), (TH_U - 5.5, v_centre + items['lp1'], 3.0)]
    sea_out = [(TH_U + 5.5, v_centre + items['lp1'], 3.0), (TH_U + 8, v_centre + items['lp1'], -5.0), (TH_U + 8, -140, -5.0), (-200, -140, -5.0), (-300, -220, -6.0), (-400, -285, -6.0)]
    pipe(f'int_{tag}_seawater_in', sea_in, 1.4, M_SEA, G_INT, extra={'culvert': 1})
    pipe(f'int_{tag}_seawater_out', sea_out, 1.4, M_SEA, G_INT, extra={'culvert': 1})
    anchor_path(f'{tag}_tertiary', [(PH_U - 40, PH_V, -6.0)] + sea_in + [(TH_U, v_centre + items['lp1'], 4.5)] + sea_out)
    return items

items_u1 = turbo_generator(1, UNIT_V, steam_u1)
items_u2 = turbo_generator(2, -UNIT_V, steam_u2)
anchor('pumphouse_intake', (PH_U - 30, PH_V, -4.0))
anchor('outfall', (-400, -285, -6.0))
anchor('th_centre', (TH_U, TH_V, TH_H / 2))
anchor('site_centre', (0, 0, 0))

ANCHORS['meta'] = {
    'lat': -33.67644, 'lon': 18.43205,
    'axis_deg_west_of_north': AXIS_DEG,
    'platform_height_above_sea_m': -SEA_Z,
    'containment': {'outer_radius_m': CONT_R_OUT, 'cylinder_top_m': CONT_CYL_TOP, 'apex_m': CONT_CYL_TOP + CONT_DOME_RISE, 'wall_m': CONT_WALL},
    'units': {'u1': to_three((0, UNIT_V, 0)), 'u2': to_three((0, -UNIT_V, 0))},
    'turbine_hall': to_three((TH_U, TH_V, 0)),
    'note': 'three.js frame: x east, y up, z south, metres, origin at the Wikipedia site coordinate',
}

# ----------------------------------------------------------------------------- export
if ANCHORS_PATH:
    os.makedirs(os.path.dirname(ANCHORS_PATH), exist_ok=True)
    with open(ANCHORS_PATH, 'w') as f:
        json.dump(ANCHORS, f, indent=1)
    print('wrote anchors', ANCHORS_PATH, len(ANCHORS['points']), 'points', len(ANCHORS['paths']), 'paths')

if GLB_PATH:
    os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(filepath=GLB_PATH, export_format='GLB', export_apply=True, export_yup=True,
                              export_extras=True, export_cameras=False, export_lights=False,
                              export_materials='EXPORT', export_normals=True, export_texcoords=False)
    print('wrote glb', GLB_PATH, os.path.getsize(GLB_PATH) // 1024, 'kB')

# ----------------------------------------------------------------------------- preview renders
def render_views():
    if not RENDER_DIR:
        return
    os.makedirs(RENDER_DIR, exist_ok=True)
    # lighting
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 4.0
    sun.angle = math.radians(2.0)
    so = bpy.data.objects.new('sun', sun)
    so.rotation_euler = (math.radians(50), 0, math.radians(-135 + 180))
    coll.objects.link(so)
    world = bpy.data.worlds.new('world')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.55, 0.7, 0.95, 1)
    bg.inputs[1].default_value = 1.0
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.film_transparent = False
    engines = [e for e in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'BLENDER_WORKBENCH')]
    for e in engines:
        try:
            scene.render.engine = e
            break
        except TypeError:
            continue
    if scene.render.engine.startswith('BLENDER_EEVEE'):
        try:
            scene.eevee.taa_render_samples = 16
            scene.eevee.use_shadows = True
        except Exception:
            pass
    else:
        scene.display.shading.light = 'STUDIO'
        scene.display.shading.show_shadows = True
        scene.display.shading.show_cavity = True
    cam = bpy.data.cameras.new('cam')
    cam.lens = 35
    co = bpy.data.objects.new('cam', cam)
    coll.objects.link(co)
    scene.camera = co
    def look(from_xyz, to_xyz):
        co.location = from_xyz
        d = Vector(to_xyz) - Vector(from_xyz)
        co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    views = {
        # ground-level view from the ENE, like the reference photographs
        'photo_ene': ((420, -120, 6), (20, -30, 30)),
        # oblique aerial from the south-east
        'aerial_se': ((520, -650, 320), (-20, 0, 20)),
        # oblique aerial from the north-west over the sea
        'aerial_nw': ((-650, 500, 300), (0, 0, 20)),
        # top-down
        'top': ((0, 0, 900), (0, 0.001, 0)),
        # close-up of the domes and stack
        'domes': ((140, -170, 60), (-20, 0, 40)),
    }
    if RENDER_VIEWS != 'all':
        views = {k: v for k, v in views.items() if k in RENDER_VIEWS.split(',')}
    # also an interior cutaway: hide exterior for one render
    for name, (frm, to) in views.items():
        look(frm, to)
        cam.lens = 24 if name == 'top' else 35
        scene.render.filepath = os.path.join(RENDER_DIR, f'{name}.png')
        bpy.ops.render.render(write_still=True)
        print('rendered', scene.render.filepath)
    # cutaway: hide exterior shells and shards, keep interior + site
    for o in coll.objects:
        if o.name.startswith('ext_') or o.name.startswith('shard_'):
            o.hide_render = True
    look((190, -40, 70), (15, 30, 12))
    scene.render.filepath = os.path.join(RENDER_DIR, 'cutaway.png')
    bpy.ops.render.render(write_still=True)
    print('rendered', scene.render.filepath)

render_views()
print('done')
