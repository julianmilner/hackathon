"""
Generate low-poly fynbos plants and their burnt remnants, exported as one GLB.

Run headless:
    /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/fynbos.py -- public/models/fynbos.glb

Each plant is an Empty named after the species with mesh children, origin at ground level,
Z up in Blender (the exporter converts to Y up). Live and burnt variants:
    protea / protea_burnt, restio / restio_burnt, erica / erica_burnt
The app merges each plant's children into one instanced mesh with vertex colours.
"""
import math
import random
import sys

import bpy
from mathutils import Vector

random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)

# --- helpers ---------------------------------------------------------------------------------

def material(name, rgb, roughness=0.9):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    mat.diffuse_color = (*rgb, 1.0)
    return mat


def add(op, name, mat, parent, **kwargs):
    op(**kwargs)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(mat)
    obj.parent = parent
    return obj


def jitter(obj, amount):
    for v in obj.data.vertices:
        v.co += Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1))) * amount


def empty(name):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    return e


def tilt(obj, max_deg):
    obj.rotation_euler = (
        math.radians(random.uniform(-max_deg, max_deg)),
        math.radians(random.uniform(-max_deg, max_deg)),
        math.radians(random.uniform(0, 360)),
    )


# --- palette -----------------------------------------------------------------------------------

LEAF = material("leaf", (0.36, 0.44, 0.27))
LEAF_GREY = material("leaf_grey", (0.46, 0.50, 0.36))
BLOOM_PINK = material("bloom_pink", (0.85, 0.36, 0.50))
BLOOM_PURPLE = material("bloom_purple", (0.62, 0.40, 0.72))
RESTIO = material("restio", (0.62, 0.58, 0.32))
STEM = material("stem", (0.30, 0.22, 0.15))
CHAR = material("char", (0.07, 0.06, 0.05), roughness=1.0)
ASH = material("ash", (0.28, 0.26, 0.24), roughness=1.0)

ico = bpy.ops.mesh.primitive_ico_sphere_add
cone = bpy.ops.mesh.primitive_cone_add
cyl = bpy.ops.mesh.primitive_cylinder_add

# --- protea: woody stem, 4 leaf clusters, pink flower heads ----------------------------------

def protea():
    root = empty("protea")
    add(cyl, "protea_stem", STEM, root, vertices=6, radius=0.07, depth=0.9, location=(0, 0, 0.45))
    for k in range(4):
        a = k / 4 * math.tau + random.uniform(-0.4, 0.4)
        r = random.uniform(0.15, 0.35)
        leaf = add(ico, f"protea_leaves_{k}", LEAF if k % 2 else LEAF_GREY, root, subdivisions=1,
                   radius=random.uniform(0.38, 0.5),
                   location=(math.cos(a) * r, math.sin(a) * r, random.uniform(0.95, 1.25)))
        jitter(leaf, 0.06)
        leaf.scale = (1.0, 1.0, 0.85)
    for k in range(3):
        a = k / 3 * math.tau + 0.6
        add(cone, f"protea_bloom_{k}", BLOOM_PINK, root, vertices=6, radius1=0.14, radius2=0.03, depth=0.28,
            location=(math.cos(a) * 0.32, math.sin(a) * 0.32, 1.55))
    return root


def protea_burnt():
    root = empty("protea_burnt")
    add(cyl, "protea_burnt_stem", CHAR, root, vertices=5, radius=0.06, depth=0.9, location=(0, 0, 0.45))
    for k in range(4):
        a = k / 4 * math.tau + random.uniform(-0.5, 0.5)
        branch = add(cone, f"protea_burnt_branch_{k}", CHAR, root, vertices=4, radius1=0.035, radius2=0.005,
                     depth=random.uniform(0.5, 0.8), location=(math.cos(a) * 0.18, math.sin(a) * 0.18, 1.15))
        branch.rotation_euler = (math.radians(random.uniform(25, 45)) * math.sin(a),
                                 math.radians(random.uniform(25, 45)) * -math.cos(a), 0)
    ash = add(ico, "protea_ash", ASH, root, subdivisions=1, radius=0.45, location=(0, 0, 0.0))
    ash.scale = (1.0, 1.0, 0.12)
    return root


# --- restio: a tuft of thin reeds fanning from the base ----------------------------------------

def restio():
    root = empty("restio")
    for k in range(22):
        h = random.uniform(0.9, 1.4)
        reed = add(cone, f"restio_reed_{k}", RESTIO, root, vertices=3, radius1=0.02, radius2=0.003, depth=h,
                   location=(0, 0, h / 2))
        tilt(reed, 24)
    return root


def restio_burnt():
    root = empty("restio_burnt")
    for k in range(9):
        h = random.uniform(0.2, 0.45)
        stub = add(cone, f"restio_burnt_stub_{k}", CHAR, root, vertices=3, radius1=0.02, radius2=0.004, depth=h,
                   location=(0, 0, h / 2))
        tilt(stub, 30)
    ash = add(ico, "restio_ash", ASH, root, subdivisions=1, radius=0.35, location=(0, 0, 0.0))
    ash.scale = (1.0, 1.0, 0.1)
    return root


# --- erica: low dome with purple bells -------------------------------------------------------

def erica():
    root = empty("erica")
    dome = add(ico, "erica_dome", LEAF, root, subdivisions=1, radius=0.5, location=(0, 0, 0.32))
    jitter(dome, 0.05)
    dome.scale = (1.0, 1.0, 0.7)
    for k in range(10):
        a = random.uniform(0, math.tau)
        r = random.uniform(0.15, 0.42)
        add(ico, f"erica_bell_{k}", BLOOM_PURPLE, root, subdivisions=1, radius=0.06,
            location=(math.cos(a) * r, math.sin(a) * r, 0.32 + math.sqrt(max(0.0, 0.25 - r * r)) * 0.7 + 0.02))
    return root


def erica_burnt():
    root = empty("erica_burnt")
    for k in range(6):
        a = k / 6 * math.tau
        twig = add(cone, f"erica_burnt_twig_{k}", CHAR, root, vertices=3, radius1=0.02, radius2=0.004,
                   depth=random.uniform(0.25, 0.4), location=(math.cos(a) * 0.15, math.sin(a) * 0.15, 0.15))
        tilt(twig, 35)
    ash = add(ico, "erica_ash", ASH, root, subdivisions=1, radius=0.4, location=(0, 0, 0.0))
    ash.scale = (1.0, 1.0, 0.1)
    return root


# --- build and export --------------------------------------------------------------------------

plants = [protea(), protea_burnt(), restio(), restio_burnt(), erica(), erica_burnt()]
for i, p in enumerate(plants):
    p.location = (i * 3.0, 0, 0)  # spread out in the .blend; the app reads children relative to the empty

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "fynbos.glb"
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True)
tris = sum(sum(len(poly.vertices) - 2 for poly in o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
print(f"exported {out}: {len(plants)} plants, {tris} triangles total")
