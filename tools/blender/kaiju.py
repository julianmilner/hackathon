"""
Builds the Claude kaiju as a rigged, animated glTF binary, entirely from code.

    /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/kaiju.py -- \
        --out public/models/kaiju.glb --sheet tools/blender/kaiju-contact-sheet.jpg

No hand-modelling and no downloaded assets: the mesh, armature, weights, materials and every
animation clip are generated here, so the model is reproducible and free of licence questions.

Conventions
- Blender space: Z up, the kaiju faces -Y. The glTF exporter converts to Y up, so in three.js
  the kaiju faces +Z and `Object3D.lookAt` points it at a target.
- Model height is about 10 Blender units. The three.js actor scales it to a height in metres.
- Animations are exported as separate clips, all in place (no root motion):
    Idle (loop), Walk (loop), Rise, Attack, Roar, Stomp.
  Event timing used by src/simulations/kaiju/KaijuBehaviour.ts is documented in CLIP_EVENTS.

Two styles, chosen with --style:
- clawd (default): a true-to-mascot Clawd, the Claude Code mascot, at kaiju scale. A squat
  terracotta rounded blob with two small dark eyes and two stubby feet. No arms, tail or mouth.
- kaiju: the earlier Godzilla-style body in the Claude palette (cream belly and jaw, glowing
  dorsal plates, Claude starburst on the chest, mascot-style face).
Both share the same 25-bone rig and the same six clips, so the behaviour script is unchanged.
"""

STYLE = 'clawd'  # set from --style in main()

import argparse
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

# --------------------------------------------------------------------------------------------
# Palette (sRGB hex -> linear, which is what Principled BSDF and glTF expect)
# --------------------------------------------------------------------------------------------

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(h):
    h = h.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


TERRACOTTA = hex_to_linear('#D97757')
TERRACOTTA_DARK = hex_to_linear('#B85C3E')
CREAM = hex_to_linear('#F0EEE6')
CHARCOAL = hex_to_linear('#141413')

# Material order matters: face material indices below refer to this list.
MATERIALS = [
    # name,        base colour,   roughness, emission colour, emission strength
    ('KaijuBody',  TERRACOTTA,      0.75, None,  0.0),
    ('KaijuBelly', CREAM,           0.6,  None,  0.0),
    ('KaijuClaw',  CHARCOAL,        0.45, None,  0.0),
    ('KaijuGlow',  CREAM,           0.5,  CREAM, 0.35),
    ('KaijuEye',   CREAM,           0.3,  CREAM, 1.5),
]
MAT = {m[0]: i for i, m in enumerate(MATERIALS)}

# --------------------------------------------------------------------------------------------
# Skeleton (armature space, Z up, facing -Y)
# --------------------------------------------------------------------------------------------

V = Vector


def joints_kaiju():
    """Godzilla-style body, about 10 units tall."""
    return dict(
        HIPS=V((0, 0.0, 4.7)), SPINE=V((0, -0.15, 5.9)), CHEST=V((0, -0.35, 7.1)), NECK=V((0, -0.55, 8.25)),
        HEAD=V((0, -0.9, 8.95)), HEAD_END=V((0, -1.7, 9.55)), JAW=V((0, -0.9, 8.5)), JAW_END=V((0, -2.2, 8.25)),
        HIP_L=V((0.85, 0.05, 4.55)), KNEE_L=V((1.0, -0.4, 2.7)), ANKLE_L=V((1.05, 0.05, 0.95)), TOE_L=V((1.05, -1.6, 0.3)),
        SHOULDER_IN_L=V((0.45, -0.4, 7.7)), SHOULDER_L=V((1.6, -0.35, 7.55)), ELBOW_L=V((2.0, -0.7, 6.2)),
        WRIST_L=V((1.95, -1.85, 5.65)), HAND_END_L=V((1.9, -2.6, 5.35)),
        TAIL=[V((0, 0.55, 4.5)), V((0, 1.9, 4.05)), V((0, 3.3, 3.45)), V((0, 4.6, 2.7)), V((0, 5.75, 1.9)), V((0, 6.7, 1.2))],
    )


def joints_clawd():
    """Clawd: a wide loaf of a body on two stubby legs, about 4.8 units tall. The spine chain runs
    straight up the middle so the loaf can bob, twist and lean. Arm, jaw and tail bones exist for
    rig compatibility only; nothing is bound to them."""
    return dict(
        HIPS=V((0, 0, 1.9)), SPINE=V((0, 0, 2.7)), CHEST=V((0, 0, 3.5)), NECK=V((0, 0, 4.1)),
        HEAD=V((0, 0, 4.5)), HEAD_END=V((0, 0, 5.0)), JAW=V((0, -1.0, 2.6)), JAW_END=V((0, -1.8, 2.4)),
        HIP_L=V((1.1, 0.2, 1.5)), KNEE_L=V((1.15, 0.0, 0.85)), ANKLE_L=V((1.2, 0.05, 0.4)), TOE_L=V((1.2, -0.9, 0.2)),
        SHOULDER_IN_L=V((0.8, 0, 3.8)), SHOULDER_L=V((2.4, 0, 3.8)), ELBOW_L=V((2.9, -0.3, 3.0)),
        WRIST_L=V((2.9, -0.6, 2.4)), HAND_END_L=V((2.9, -0.8, 2.0)),
        TAIL=[V((0, 1.5, 2.4)), V((0, 2.1, 2.3)), V((0, 2.6, 2.2)), V((0, 3.0, 2.1)), V((0, 3.3, 2.0)), V((0, 3.5, 1.9))],
    )


def mirror(v):
    return V((-v.x, v.y, v.z))


def side_bones(side, sign):
    m = (lambda v: v) if sign > 0 else mirror
    return [
        (f'Thigh.{side}', m(HIP_L), m(KNEE_L), 'Hips'),
        (f'Shin.{side}', m(KNEE_L), m(ANKLE_L), f'Thigh.{side}'),
        (f'Foot.{side}', m(ANKLE_L), m(TOE_L), f'Shin.{side}'),
        (f'Shoulder.{side}', m(SHOULDER_IN_L), m(SHOULDER_L), 'Chest'),
        (f'UpperArm.{side}', m(SHOULDER_L), m(ELBOW_L), f'Shoulder.{side}'),
        (f'Forearm.{side}', m(ELBOW_L), m(WRIST_L), f'UpperArm.{side}'),
        (f'Hand.{side}', m(WRIST_L), m(HAND_END_L), f'Forearm.{side}'),
    ]


def configure_skeleton(style):
    """Publish the joint constants and bone tables for the chosen style as module globals."""
    globals().update(joints_kaiju() if style == 'kaiju' else joints_clawd())
    bones = [
        ('Hips', HIPS, SPINE, None),
        ('Spine', SPINE, CHEST, 'Hips'),
        ('Chest', CHEST, NECK, 'Spine'),
        ('Neck', NECK, HEAD, 'Chest'),
        ('Head', HEAD, HEAD_END, 'Neck'),
        ('Jaw', JAW, JAW_END, 'Head'),
    ]
    bones += side_bones('L', 1) + side_bones('R', -1)
    bones += [(f'Tail.{i + 1}', TAIL[i], TAIL[i + 1], 'Hips' if i == 0 else f'Tail.{i}') for i in range(5)]
    globals()['BONES'] = bones
    globals()['BONE_SEG'] = {name: (head, tail) for name, head, tail, _ in bones}
    globals()['BONE_NAMES'] = [b[0] for b in bones]



# --------------------------------------------------------------------------------------------
# Mesh construction
# --------------------------------------------------------------------------------------------

bm = bmesh.new()
BIND = []  # (bmesh vert, [bone names], mode). mode 'segment': inverse distance to the bones;
#          mode 'height': gaussian in z around each bone's midpoint, for a body that is one block.


def register(verts, material, smooth, bind, mode='segment'):
    faces = set()
    for v in verts:
        faces.update(v.link_faces)
    for f in faces:
        f.material_index = MAT[material]
        f.smooth = smooth
    for v in verts:
        BIND.append((v, list(bind), mode))


def diag(sx, sy, sz):
    return Matrix.Diagonal(V((sx, sy, sz, 1.0)))


def seg_matrix(p0, p1):
    """Matrix mapping the local Z axis (from -L/2 to +L/2) onto the segment p0 -> p1."""
    p0, p1 = V(p0), V(p1)
    d = p1 - p0
    rot = V((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    return Matrix.Translation((p0 + p1) / 2) @ rot, d.length


def tube(p0, p1, r0, r1, material='KaijuBody', bind=(), segs=14, smooth=True):
    m, length = seg_matrix(p0, p1)
    verts = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                                  radius1=r0, radius2=r1, depth=length, matrix=m)['verts']
    register(verts, material, smooth, bind)
    return verts


def ball(center, r, scale=(1, 1, 1), material='KaijuBody', bind=(), u=16, v=10, smooth=True, rot=None):
    m = Matrix.Translation(V(center)) @ (rot or Matrix.Identity(4)) @ diag(*scale)
    verts = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r, matrix=m)['verts']
    register(verts, material, smooth, bind)
    return verts


def spike(base, tip, r, material='KaijuClaw', bind=(), segs=6):
    """Round-based cone tapering to a point."""
    m, length = seg_matrix(base, tip)
    verts = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs,
                                  radius1=r, radius2=0.0, depth=length, matrix=m)['verts']
    register(verts, material, False, bind)
    return verts


def plate(base, height, base_len, tilt_deg, bind, thickness=0.18, material='KaijuGlow'):
    """Dorsal plate: a thin blade with its edge along the spine, leaning back by tilt."""
    m = (Matrix.Translation(V(base))
         @ Matrix.Rotation(math.radians(tilt_deg), 4, 'X')
         @ Matrix.Translation(V((0, 0, height / 2)))
         @ diag(thickness / base_len, 1.0, 1.0))
    verts = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=4,
                                  radius1=base_len / 2, radius2=0.0, depth=height, matrix=m)['verts']
    register(verts, material, False, bind)
    return verts


BELLY_C = V((0, -1.2, 6.1))
BELLY_R = V((0.9 * 1.2, 0.55 * 1.2, 1.45 * 1.2))


def belly_surface(x, z, lift=0.0):
    """Point on the front of the belly ellipsoid at (x, z), pushed out by lift, plus its normal."""
    u = (x / BELLY_R.x) ** 2 + ((z - BELLY_C.z) / BELLY_R.z) ** 2
    y = BELLY_C.y - BELLY_R.y * math.sqrt(max(0.0, 1.0 - u))
    p = V((x, y, z))
    n = V((x / BELLY_R.x ** 2, (y - BELLY_C.y) / BELLY_R.y ** 2, (z - BELLY_C.z) / BELLY_R.z ** 2)).normalized()
    return p + n * lift, n


def rounded_box(center, size, bevel, material='KaijuBody', bind=(), segments=5, smooth=True, mode='segment'):
    """Bevelled cube, the Claude Code mascot's silhouette. Built in a scratch bmesh so the bevel
    runs on a unit cube, then scaled into place and merged."""
    tmp = bmesh.new()
    bmesh.ops.create_cube(tmp, size=1.0)
    bmesh.ops.bevel(tmp, geom=tmp.verts[:] + tmp.edges[:], offset=bevel, segments=segments,
                    profile=0.5, affect='EDGES', clamp_overlap=True)
    bmesh.ops.transform(tmp, matrix=Matrix.Translation(V(center)) @ diag(*size), verts=tmp.verts[:])
    tmp_mesh = bpy.data.meshes.new('tmp_rounded_box')
    tmp.to_mesh(tmp_mesh)
    tmp.free()
    n0 = len(bm.verts)
    bm.from_mesh(tmp_mesh)
    bpy.data.meshes.remove(tmp_mesh)
    bm.verts.ensure_lookup_table()
    verts = bm.verts[n0:]
    register(verts, material, smooth, bind, mode)
    return verts


def starburst(cz, radius, bind, spokes=12):
    """Claude-style starburst laid onto the belly: flat blades radiating from (0, cz), each
    oriented along the local surface so the emblem hugs the curve instead of floating."""
    pattern = [1.0, 0.68, 0.86]
    for k in range(spokes):
        a = 2 * math.pi * k / spokes + 0.11 * math.sin(k * 2.3)
        dx, dz = math.sin(a), math.cos(a)
        length = radius * pattern[k % 3]
        inner = radius * 0.16
        p0, _ = belly_surface(inner * dx, cz + inner * dz, 0.03)
        p1, _ = belly_surface(length * dx, cz + length * dz, 0.03)
        mid = (inner + length) / 2
        _, n = belly_surface(mid * dx, cz + mid * dz)
        zax = (p1 - p0).normalized()
        xax = n.cross(zax).normalized()
        yax = zax.cross(xax)
        rot = Matrix((xax, yax, zax)).transposed().to_4x4()  # columns are the local axes
        m = Matrix.Translation((p0 + p1) / 2) @ rot @ diag(1.0, 0.45, 1.0)
        verts = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=4,
                                      radius1=radius * 0.16, radius2=0.0,
                                      depth=(p1 - p0).length, matrix=m)['verts']
        register(verts, 'KaijuGlow', False, bind)
    hub, n = belly_surface(0.0, cz, 0.02)
    rot = V((0, 1, 0)).rotation_difference(n).to_matrix().to_4x4()
    m = Matrix.Translation(hub) @ rot @ diag(1.0, 0.4, 1.0)
    verts = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=radius * 0.2, matrix=m)['verts']
    register(verts, 'KaijuGlow', True, bind)

def build_mesh_kaiju():
    # Torso
    ball(HIPS + V((0, 0.05, 0)), 1.3, (1.1, 0.95, 0.9), bind=['Hips', 'Spine'])
    ball((0, -0.2, 5.95), 1.5, (1.0, 1.0, 1.05), bind=['Spine', 'Hips', 'Chest'])
    ball((0, -0.4, 7.15), 1.45, (1.2, 0.95, 0.95), bind=['Chest', 'Spine'])
    ball((0, -0.55, 7.9), 1.15, (1.25, 0.8, 0.8), bind=['Chest'])
    # Cream belly plate, slightly proud of the body
    ball(BELLY_C, 1.0, tuple(BELLY_R), material='KaijuBelly', bind=['Spine', 'Chest', 'Hips'])
    # Chest emblem, laid on the belly surface
    starburst(6.6, 0.7, bind=['Chest', 'Spine'])

    # Neck and head: a friendly Claude-mascot face on a kaiju body. Rounded-box head like the
    # Claude Code mascot, big dark eyes with highlights, a cream muzzle with a smile, and a
    # rigged lower jaw that opens onto a dark mouth when it roars or bites.
    tube(NECK + V((0, 0, -0.25)), HEAD + V((0, -0.1, 0.1)), 0.82, 0.62, bind=['Neck', 'Chest', 'Head'])
    head_c = V((0, -1.3, 9.2))
    head_size = V((2.3, 1.9, 1.7))
    rounded_box(head_c, tuple(head_size), 0.24, bind=['Head'])
    front = head_c.y - head_size.y / 2
    for s in (1, -1):
        ball((s * 0.5, front + 0.02, 9.4), 0.22, (1.0, 0.45, 1.3), material='KaijuClaw', bind=['Head'], u=14, v=10)
        ball((s * 0.57, front - 0.08, 9.53), 0.06, material='KaijuEye', bind=['Head'], u=8, v=6)  # highlight
    # cream muzzle, slightly proud of the face
    muzzle_c, muzzle_r = V((0, front + 0.05, 8.72)), V((0.8, 0.3, 0.38))
    ball(muzzle_c, 1.0, tuple(muzzle_r), material='KaijuBelly', bind=['Head'])
    # smile: small dark beads along the muzzle surface, curving up at the corners
    for k in range(13):
        u = (k / 12 - 0.5) * 2
        x, z = 0.55 * u, 8.52 + 0.12 * u * u
        inside = 1 - (x / muzzle_r.x) ** 2 - ((z - muzzle_c.z) / muzzle_r.z) ** 2
        y = muzzle_c.y - muzzle_r.y * math.sqrt(max(0.0, inside)) - 0.01
        ball((x, y, z), 0.045, material='KaijuClaw', bind=['Head'], u=8, v=6)
    # dark mouth interior, hidden until the jaw drops
    rounded_box((0, -1.55, 8.37), (1.5, 1.2, 0.08), 0.02, material='KaijuClaw', bind=['Head'], segments=1)
    # lower jaw: cream chin on the Jaw bone
    rounded_box((0, -1.5, 8.3), (1.7, 1.45, 0.4), 0.15, material='KaijuBelly', bind=['Jaw'])
    # head crests keep it a kaiju
    plate((0, -0.95, 10.03), 0.45, 0.45, -35, bind=['Head'], thickness=0.12)
    for s in (1, -1):
        plate((s * 0.6, -0.75, 9.93), 0.35, 0.35, -50, bind=['Head'], thickness=0.1)

    # Limbs
    for side, sign in (('L', 1), ('R', -1)):
        m = (lambda v: v) if sign > 0 else mirror
        # Arms
        ball(m(SHOULDER_L), 0.65, bind=[f'Shoulder.{side}', f'UpperArm.{side}'])
        tube(m(SHOULDER_L), m(ELBOW_L), 0.55, 0.45, bind=[f'UpperArm.{side}'])
        ball(m(ELBOW_L), 0.46, bind=[f'UpperArm.{side}', f'Forearm.{side}'])
        tube(m(ELBOW_L), m(WRIST_L), 0.45, 0.37, bind=[f'Forearm.{side}'])
        ball(m(WRIST_L), 0.4, (1.1, 1.2, 0.8), bind=[f'Hand.{side}'])
        for dx in (-0.22, 0.0, 0.22):
            base = m(WRIST_L + V((dx, -0.1, -0.05)))
            tip = m(WRIST_L + V((dx * 1.3, -0.85, -0.35)))
            spike(base, tip, 0.11, bind=[f'Hand.{side}'])
        # Legs
        ball(m(HIP_L), 0.75, bind=['Hips', f'Thigh.{side}'])
        tube(m(HIP_L), m(KNEE_L), 0.72, 0.55, bind=[f'Thigh.{side}'])
        ball(m(KNEE_L), 0.55, bind=[f'Thigh.{side}', f'Shin.{side}'])
        tube(m(KNEE_L), m(ANKLE_L), 0.53, 0.45, bind=[f'Shin.{side}'])
        ball(m(ANKLE_L), 0.48, bind=[f'Shin.{side}', f'Foot.{side}'])
        ball(m(V((1.05, -0.75, 0.5))), 0.9, (0.7, 1.1, 0.45), bind=[f'Foot.{side}'])
        for dx in (-0.3, 0.0, 0.3):
            base = m(V((1.05 + dx, -1.6, 0.35)))
            tip = m(V((1.05 + dx * 1.4, -2.3, 0.0)))
            spike(base, tip, 0.14, bind=[f'Foot.{side}'])

    # Tail
    radii = [0.95, 0.75, 0.58, 0.42, 0.28, 0.12]
    for i in range(5):
        tube(TAIL[i], TAIL[i + 1], radii[i], radii[i + 1], bind=[f'Tail.{i + 1}'])
        if i < 4:
            ball(TAIL[i + 1], radii[i + 1], bind=[f'Tail.{i + 1}', f'Tail.{i + 2}'])

    # Dorsal plates: main row along the spine, smaller flanking row
    main = [
        ((0, 0.15, 8.5), 0.55, 0.5, -20, 'Neck'),
        ((0, 0.95, 7.6), 1.0, 0.9, -25, 'Chest'),
        ((0, 1.2, 6.3), 1.3, 1.1, -30, 'Spine'),
        ((0, 0.95, 5.6), 1.15, 1.0, -40, 'Hips'),
        ((0, 1.6, 4.85), 0.9, 0.8, -50, 'Tail.1'),
        ((0, 2.9, 4.1), 0.7, 0.65, -55, 'Tail.2'),
        ((0, 4.2, 3.3), 0.55, 0.5, -60, 'Tail.3'),
        ((0, 5.3, 2.5), 0.4, 0.4, -65, 'Tail.4'),
    ]
    for base, h, length, tilt, bone in main:
        plate(base, h, length, tilt, bind=[bone])
    flank = [
        ((0.6, 1.05, 7.0), 0.5, 0.5, -25, 'Chest'),
        ((0.65, 1.15, 5.95), 0.6, 0.55, -35, 'Spine'),
        ((0.55, 1.3, 5.2), 0.5, 0.5, -45, 'Hips'),
        ((0.4, 2.3, 4.5), 0.35, 0.35, -50, 'Tail.1'),
    ]
    for base, h, length, tilt, bone in flank:
        for s in (1, -1):
            plate((s * base[0], base[1], base[2]), h, length, tilt, bind=[bone], thickness=0.12)

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.verts.index_update()


def build_mesh_clawd():
    """Clawd, faithfully: a wide terracotta loaf with soft corners, two small dark eyes high on
    the face, two stubby legs ending in little block feet. Nothing else."""
    chain = ['Hips', 'Spine', 'Chest', 'Neck', 'Head']
    rounded_box((0, 0, 3.0), (5.8, 3.4, 3.6), 0.26, bind=chain, mode='height', segments=6)
    front = -1.7
    for s in (1, -1):
        rounded_box((s * 1.2, front, 3.7), (0.55, 0.3, 0.7), 0.15, material='KaijuClaw', bind=['Neck', 'Head'], segments=3)
    for side, sign in (('L', 1), ('R', -1)):
        m = (lambda v: v) if sign > 0 else mirror
        tube(m(HIP_L), m(KNEE_L), 0.5, 0.45, bind=[f'Thigh.{side}'])
        ball(m(KNEE_L), 0.45, bind=[f'Thigh.{side}', f'Shin.{side}'])
        tube(m(KNEE_L), m(ANKLE_L), 0.45, 0.4, bind=[f'Shin.{side}'])
        rounded_box(m(V((1.2, -0.25, 0.28))), (1.0, 1.5, 0.5), 0.3, bind=[f'Foot.{side}'], segments=4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.verts.index_update()


def build_mesh():
    build_mesh_kaiju() if STYLE == 'kaiju' else build_mesh_clawd()


# --------------------------------------------------------------------------------------------
# Scene assembly
# --------------------------------------------------------------------------------------------

def make_materials():
    out = []
    for name, base, rough, emit, strength in MATERIALS:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = (*base, 1.0)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = 0.0
        if emit is not None:
            bsdf.inputs['Emission Color'].default_value = (*emit, 1.0)
            bsdf.inputs['Emission Strength'].default_value = strength
        m.diffuse_color = (*base, 1.0)  # Workbench preview colour
        out.append(m)
    return out


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (a + ab * t - p).length


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS

    # Armature
    arm_data = bpy.data.armatures.new('ClaudeKaijuRig')
    arm_obj = bpy.data.objects.new('ClaudeKaijuRig', arm_data)
    scene.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode='EDIT')
    for name, head, tail, parent in BONES:
        eb = arm_data.edit_bones.new(name)
        eb.head = head
        eb.tail = tail
        if parent:
            eb.parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')

    # Mesh
    build_mesh()
    mesh = bpy.data.meshes.new('ClaudeKaiju')
    bm.to_mesh(mesh)
    mesh.validate()
    mesh.update()
    for m in make_materials():
        mesh.materials.append(m)
    obj = bpy.data.objects.new('ClaudeKaiju', mesh)
    scene.collection.objects.link(obj)

    # Weights: inverse-distance blend across the bones each part is allowed to bind to
    groups = {name: obj.vertex_groups.new(name=name) for name in BONE_NAMES}
    for v, bind, mode in BIND:
        if len(bind) == 1:
            groups[bind[0]].add([v.index], 1.0, 'REPLACE')
            continue
        if mode == 'height':
            centres = [(BONE_SEG[b][0].z + BONE_SEG[b][1].z) / 2 for b in bind]
            ws = [math.exp(-((v.co.z - zc) / 0.45) ** 2) for zc in centres]
        else:
            ds = [max(seg_dist(v.co, *BONE_SEG[b]), 0.05) for b in bind]
            ws = [1.0 / d ** 4 for d in ds]
        total = sum(ws) or 1.0
        for b, w in zip(bind, ws):
            if w / total > 1e-3:
                groups[b].add([v.index], w / total, 'REPLACE')

    obj.parent = arm_obj
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm_obj
    return arm_obj, obj


# --------------------------------------------------------------------------------------------
# Animation
# --------------------------------------------------------------------------------------------

FPS = 24
TAU = 2 * math.pi


def smooth(a, b, t):
    """Smoothstep from 0 at t<=a to 1 at t>=b."""
    if b <= a:
        return 1.0 if t >= b else 0.0
    s = max(0.0, min(1.0, (t - a) / (b - a)))
    return s * s * (3 - 2 * s)


def bump(a, b, t):
    """Smooth 0 -> 1 -> 0 hump between a and b."""
    mid = (a + b) / 2
    return smooth(a, mid, t) * (1 - smooth(mid, b, t))


class Pose:
    """One frame of animation, authored as rotations about armature-space axes.

    Axis meaning (armature space, kaiju faces -Y):
      rot_x: pitch. Up-pointing bones (spine, neck, head) nod forward for +deg.
             Down-pointing limbs swing backward for +deg, forward for -deg.
             Forward-pointing bones (jaw, feet) tip downward for +deg.
      rot_y: roll about the front-back axis. Left limbs swing outward for -deg, right for +deg.
      rot_z: yaw. Positive turns the bone toward the left side (+X) of the kaiju.
    """

    def __init__(self):
        self.rot = {}
        self.loc = {}
        self.scale = {}

    def _rot(self, bone, axis, deg):
        q = Quaternion(axis, math.radians(deg))
        self.rot[bone] = q @ self.rot.get(bone, Quaternion())

    def rot_x(self, bone, deg):
        self._rot(bone, V((1, 0, 0)), deg)

    def rot_y(self, bone, deg):
        self._rot(bone, V((0, 1, 0)), deg)

    def rot_z(self, bone, deg):
        self._rot(bone, V((0, 0, 1)), deg)

    def move(self, bone, x=0.0, y=0.0, z=0.0):
        self.loc[bone] = self.loc.get(bone, V((0, 0, 0))) + V((x, y, z))

    def grow(self, bone, s):
        self.scale[bone] = s

    def tail_sway(self, t, amp, freq=1.0, lag=0.75, phase=0.0):
        for i in range(1, 6):
            self.rot_z(f'Tail.{i}', amp * math.sin(TAU * freq * t - lag * i + phase))

    def tail_lift(self, deg):
        for i in range(1, 6):
            self.rot_x(f'Tail.{i}', deg)

    def both(self, fn, *args):
        for side in ('L', 'R'):
            fn(side, *args)


def pose_idle(p, t):
    breath = math.sin(TAU * t)
    p.grow('Chest', 1 + 0.03 * breath)
    p.rot_x('Chest', -2.0 * breath)
    p.rot_x('Spine', 4.0 - 1.0 * breath)
    p.move('Hips', z=0.05 * breath)
    p.rot_z('Head', 7.0 * math.sin(TAU * t + 1.0))
    p.rot_x('Head', 3.0 * math.sin(2 * TAU * t + 0.5))
    p.rot_x('Jaw', 4.0 + 3.0 * math.sin(TAU * t + 2.0))
    p.tail_sway(t, 8.0)
    for side, s in (('L', 1), ('R', -1)):
        p.rot_x(f'UpperArm.{side}', 3.0 * math.sin(TAU * t + s))
        p.rot_x(f'Forearm.{side}', -18.0 + 3.0 * breath)


def pose_walk(p, t):
    # Left leg leads. Contacts happen at about t = 0.30 (left) and 0.80 (right).
    for side, offset in (('L', 0.0), ('R', 0.5)):
        ph = t + offset
        swing = math.sin(TAU * ph)                  # +1 = thigh fully forward
        lift = max(0.0, math.cos(TAU * ph))         # peaks mid-swing
        p.rot_x(f'Thigh.{side}', -30.0 * swing + 6.0)
        p.rot_x(f'Shin.{side}', 12.0 + 48.0 * lift ** 1.3)
        p.rot_x(f'Foot.{side}', -14.0 * lift + 12.0 * max(0.0, -math.sin(TAU * (ph + 0.08))))
        # arms swing opposite to the leg on the same side
        p.rot_x(f'UpperArm.{side}', 16.0 * swing)
        p.rot_x(f'Forearm.{side}', -22.0 - 8.0 * max(0.0, swing))
    p.move('Hips', z=0.14 * math.cos(2 * TAU * t) - 0.05, x=0.08 * math.sin(TAU * t))
    p.rot_y('Hips', 4.0 * math.sin(TAU * t))
    p.rot_z('Hips', 7.0 * math.sin(TAU * t))
    p.rot_x('Spine', 8.0)
    p.rot_z('Chest', -9.0 * math.sin(TAU * t))
    p.rot_x('Chest', 2.0 * math.cos(2 * TAU * t))
    p.rot_z('Head', 5.0 * math.sin(TAU * t))
    p.rot_x('Head', -8.0 + 3.0 * math.cos(2 * TAU * t + 0.6))
    p.rot_x('Jaw', 5.0)
    p.tail_sway(t, 12.0, phase=math.pi)
    for i in range(1, 6):
        p.rot_x(f'Tail.{i}', -2.0 + 2.5 * math.sin(2 * TAU * t - 0.6 * i))


def pose_rise(p, t):
    up = smooth(0.05, 0.85, t)
    c = 1 - up  # crouch amount
    shake = bump(0.55, 0.9, t) * math.sin(TAU * 4 * t)
    crouch = 1.4 if STYLE == 'kaiju' else 0.5
    p.move('Hips', z=-crouch * c, y=0.3 * c)
    p.rot_x('Spine', 34.0 * c)
    p.rot_x('Chest', 14.0 * c)
    p.rot_x('Neck', -6.0 * c)
    p.rot_x('Head', 20.0 * c)
    p.rot_z('Head', 14.0 * shake)
    p.rot_x('Jaw', 6.0 + 20.0 * bump(0.6, 1.0, t))
    for side in ('L', 'R'):
        p.rot_x(f'Thigh.{side}', -48.0 * c)
        p.rot_x(f'Shin.{side}', 8.0 + 72.0 * c)
        p.rot_x(f'Foot.{side}', -24.0 * c)
        p.rot_x(f'UpperArm.{side}', -28.0 * c)
        p.rot_x(f'Forearm.{side}', -20.0 - 55.0 * c)
    p.tail_lift(9.0 * c)
    p.tail_sway(t, 6.0 * (1 - c), freq=2.0)


def pose_attack(p, t):
    antic = smooth(0.0, 0.28, t) * (1 - smooth(0.3, 0.45, t))
    strike = smooth(0.3, 0.45, t) * (1 - smooth(0.65, 1.0, t))
    p.rot_x('Spine', -8.0 * antic + 12.0 * strike)
    p.rot_x('Chest', -14.0 * antic + 18.0 * strike)
    p.rot_x('Neck', -8.0 * antic + 4.0 * strike)
    p.rot_x('Head', -16.0 * antic + 4.0 * strike)
    p.rot_x('Jaw', 12.0 * antic + 38.0 * strike)
    lunge = 0.6 if STYLE == 'kaiju' else 1.1  # Clawd has no arms, so the attack is a body slam
    p.move('Hips', y=0.35 * antic - lunge * strike, z=0.15 * antic - 0.3 * strike)
    for side, s, lead in (('L', 1, 0.0), ('R', -1, 0.05)):
        a = smooth(0.0, 0.28, t - lead) * (1 - smooth(0.3, 0.45, t - lead))
        k = smooth(0.3, 0.45, t - lead) * (1 - smooth(0.65, 1.0, t - lead))
        # arms rise overhead during the wind-up, then slam down to horizontal in front
        p.rot_x(f'UpperArm.{side}', -150.0 * a - 60.0 * k)
        p.rot_y(f'UpperArm.{side}', -s * (20.0 * a + 8.0 * k))
        p.rot_x(f'Forearm.{side}', -25.0 * a - 20.0 * k - 12.0)
        p.rot_x(f'Hand.{side}', 10.0 * a - 20.0 * k)
    p.rot_x('Thigh.L', -16.0 * strike)
    p.rot_x('Thigh.R', 10.0 * strike)
    p.rot_x('Shin.L', 14.0 * strike)
    p.rot_x('Shin.R', 10.0 * strike)
    p.tail_lift(-12.0 * strike + 4.0 * antic)
    p.tail_sway(t, 10.0 * (antic + strike), freq=1.0)

def pose_roar(p, t):
    open_ = smooth(0.08, 0.3, t) * (1 - smooth(0.75, 0.95, t))
    tremor = math.sin(TAU * 9 * t) * open_
    p.rot_x('Spine', -6.0 * open_)
    p.rot_x('Chest', -12.0 * open_)
    p.grow('Chest', 1 + 0.07 * open_)
    p.rot_x('Neck', -14.0 * open_)
    p.rot_x('Head', -26.0 * open_ + 1.5 * tremor)
    p.rot_x('Jaw', 40.0 * open_ + 2.5 * tremor)
    p.move('Hips', z=0.18 * open_ + 0.03 * tremor)
    for side, s in (('L', 1), ('R', -1)):
        p.rot_y(f'UpperArm.{side}', -s * 48.0 * open_)
        p.rot_x(f'UpperArm.{side}', -20.0 * open_)
        p.rot_x(f'Forearm.{side}', -18.0 - 40.0 * open_)
        p.rot_x(f'Hand.{side}', -15.0 * open_)
    p.tail_lift(-8.0 * open_)
    p.tail_sway(t, 16.0 * open_, freq=2.0)


def pose_stomp(p, t):
    lift = smooth(0.0, 0.3, t) * (1 - smooth(0.42, 0.56, t))
    slam = bump(0.52, 0.72, t)
    p.rot_x('Thigh.R', -58.0 * lift)
    p.rot_x('Shin.R', 10.0 + 74.0 * lift)
    p.rot_x('Foot.R', -22.0 * lift + 8.0 * slam)
    p.move('Hips', x=0.35 * lift, z=-0.1 * lift - 0.3 * slam)
    p.rot_y('Hips', -6.0 * lift)
    p.rot_x('Spine', 6.0 * lift + 10.0 * slam)
    p.rot_x('Chest', -6.0 * lift + 8.0 * slam)
    p.rot_x('Head', -10.0 * lift + 12.0 * slam)
    p.rot_x('Jaw', 8.0 * lift + 22.0 * slam)
    for side, s in (('L', 1), ('R', -1)):
        p.rot_x(f'UpperArm.{side}', 30.0 * lift - 20.0 * slam)
        p.rot_y(f'UpperArm.{side}', -s * 20.0 * lift)
        p.rot_x(f'Forearm.{side}', -30.0 - 20.0 * lift)
    p.tail_lift(-10.0 * lift + 6.0 * slam)
    p.tail_sway(t, 8.0, freq=1.0)


# name, seconds, loops, pose function
CLIPS = [
    ('Idle', 3.0, True, pose_idle),
    ('Walk', 1.5, True, pose_walk),
    ('Rise', 3.0, False, pose_rise),
    ('Attack', 2.0, False, pose_attack),
    ('Roar', 2.5, False, pose_roar),
    ('Stomp', 1.5, False, pose_stomp),
]

# Normalised clip times of the moments the behaviour script reacts to.
CLIP_EVENTS = {
    'Walk': {'footstep': [0.30, 0.80]},   # left, right
    'Attack': {'hit': [0.45]},
    'Roar': {'roar': [0.30]},
    'Stomp': {'hit': [0.58]},
}


def apply_pose(arm_obj, rest_quats, pose, frame):
    for name in BONE_NAMES:
        pb = arm_obj.pose.bones[name]
        r = rest_quats[name]
        q = pose.rot.get(name)
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (r.inverted() @ q @ r) if q else Quaternion()
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        if name == 'Hips':
            v = pose.loc.get(name, V((0, 0, 0)))
            pb.location = r.inverted() @ v
            pb.keyframe_insert('location', frame=frame)
        if name == 'Chest':
            s = pose.scale.get(name, 1.0)
            pb.scale = (s, s, s)
            pb.keyframe_insert('scale', frame=frame)


def build_animations(arm_obj):
    arm_obj.animation_data_create()
    rest_quats = {name: arm_obj.data.bones[name].matrix_local.to_quaternion() for name in BONE_NAMES}
    actions = {}
    for name, seconds, loops, fn in CLIPS:
        frames = int(round(seconds * FPS))
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        arm_obj.animation_data.action = act
        step = 2
        for f in list(range(0, frames, step)) + [frames]:
            t = f / frames
            p = Pose()
            fn(p, t if not loops else (t % 1.0))
            apply_pose(arm_obj, rest_quats, p, f)
        arm_obj.animation_data.action = None
        track = arm_obj.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, 0, act)
        actions[name] = act
    return actions


# --------------------------------------------------------------------------------------------
# Export and previews
# --------------------------------------------------------------------------------------------

def export_glb(path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_apply=False,
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_anim_slide_to_zero=True,
        export_optimize_animation_size=True,
        export_materials='EXPORT',
        export_image_format='NONE',
        export_extras=False,
        export_lights=False,
        export_cameras=False,
        use_selection=False,
    )


def contact_sheet(paths, out_path, columns=4):
    """Tile the rendered shots into one PNG using Blender's own image API (no PIL needed)."""
    import numpy as np
    images = [bpy.data.images.load(p) for p in paths]
    w, h = images[0].size
    rows = (len(images) + columns - 1) // columns
    sheet = np.zeros((rows * h, columns * w, 4), dtype=np.float32)
    for k, img in enumerate(images):
        px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
        if k == 0:
            sheet[:, :] = px[0, 0]  # fill unused tiles with the background colour
        r, c = divmod(k, columns)
        y0 = (rows - 1 - r) * h  # image rows are bottom-up
        sheet[y0:y0 + h, c * w:(c + 1) * w] = px
        bpy.data.images.remove(img)
    out = bpy.data.images.new('contact_sheet', columns * w, rows * h, alpha=False)
    out.pixels = sheet.ravel().tolist()
    settings = bpy.context.scene.render.image_settings
    settings.file_format = 'JPEG'
    settings.color_mode = 'RGB'
    settings.quality = 82
    out.save_render(out_path, scene=bpy.context.scene)


def render_previews(arm_obj, actions, sheet_path, shots_folder=None):
    import tempfile
    os.makedirs(os.path.dirname(os.path.abspath(sheet_path)), exist_ok=True)
    shots_folder = shots_folder or tempfile.mkdtemp(prefix='kaiju-shots-')
    os.makedirs(shots_folder, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = 360
    scene.render.resolution_y = 360
    scene.render.film_transparent = False
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.world = bpy.data.worlds.new('Preview')
    scene.world.color = (0.09, 0.12, 0.18)
    for track in arm_obj.animation_data.nla_tracks:
        track.mute = True

    cam_data = bpy.data.cameras.new('PreviewCam')
    cam_data.lens = 40
    cam = bpy.data.objects.new('PreviewCam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    if STYLE == 'kaiju':
        body, head, k = V((0, 1.2, 5.0)), V((0, -1.4, 9.0)), 1.0
    else:
        body, head, k = V((0, 0.4, 2.6)), V((0, -1.2, 3.4)), 0.62

    def look_from(pos, target):
        cam.location = V(pos) * k if target is body else V(pos)
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()

    front34 = (-13.0, -17.0, 8.5)
    closeup = (-5.0, -8.0, 10.5) if STYLE == 'kaiju' else (-4.0, -7.0, 5.5)
    shots = [
        ('rest_front34', None, 0, front34, body),
        ('rest_side', None, 0, (-24.0, 1.2, 6.0), body),
        ('rest_back34', None, 0, (12.0, 18.0, 9.0), body),
        ('head_closeup', None, 0, closeup, head),
        ('walk_mid', 'Walk', 9, front34, body),
        ('walk_side', 'Walk', 9, (-24.0, 1.2, 6.0), body),
        ('rise_start', 'Rise', 3, front34, body),
        ('attack_windup', 'Attack', 12, front34, body),
        ('attack_strike', 'Attack', 22, front34, body),
        ('roar_peak', 'Roar', 26, front34, body),
        ('stomp_lift', 'Stomp', 10, front34, body),
    ]
    rendered = []
    for name, clip, frame, pos, target in shots:
        if clip:
            arm_obj.animation_data.action = actions[clip]
            arm_obj.animation_data.action_slot = actions[clip].slots[0]
        else:
            arm_obj.animation_data.action = None
            for pb in arm_obj.pose.bones:
                pb.rotation_quaternion = Quaternion()
                pb.location = (0, 0, 0)
                pb.scale = (1, 1, 1)
        scene.frame_set(frame)
        look_from(pos, target)
        scene.render.filepath = os.path.join(shots_folder, f'{name}.png')
        bpy.ops.render.render(write_still=True)
        rendered.append(scene.render.filepath)
    arm_obj.animation_data.action = None
    contact_sheet(rendered, sheet_path)
    return shots_folder


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument('--out', default=os.path.join(here, '..', '..', 'public', 'models', 'kaiju.glb'))
    ap.add_argument('--sheet', default=None, help='write a JPEG contact sheet of preview renders here')
    ap.add_argument('--shots', default=None, help='optional folder that keeps the individual preview frames')
    ap.add_argument('--style', default='clawd', choices=['clawd', 'kaiju'], help='clawd = the Claude mascot (default); kaiju = Godzilla-style body')
    args = ap.parse_args(argv)
    global STYLE
    STYLE = args.style
    configure_skeleton(STYLE)

    arm_obj, mesh_obj = build_scene()
    actions = build_animations(arm_obj)
    export_glb(args.out)

    mesh = mesh_obj.data
    print(f'KAIJU_STATS style={STYLE} verts={len(mesh.vertices)} faces={len(mesh.polygons)} '
          f'bones={len(BONE_NAMES)} clips={",".join(actions)} out={os.path.abspath(args.out)} '
          f'bytes={os.path.getsize(args.out)}')

    if args.sheet:
        shots = render_previews(arm_obj, actions, args.sheet, args.shots)
        print(f'KAIJU_PREVIEWS sheet={os.path.abspath(args.sheet)} shots={shots}')


if __name__ == '__main__':
    main()
