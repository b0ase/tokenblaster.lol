# Spiked Bat (07_026): hand-built lathe bat + helical grip tape + chrome spikes. Blender 5.x:
#   Blender -b -P spiked_bat.py [-- out.glb]
# Blender Z-up along bat axis; origin = grip centre (hand). Exported glTF Y-up.
# Barrel is oval (depth 0.75 x width) so the flat sides face the camera, like the card's 2D read.
# Final size: card principal length 443 px x K (hm_common) = 0.474 incl. spikes.
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hm_common import K, mat, out_path, front_measure, scale_about_origin, finish, tilted_bbox

OUT = out_path("07_026_spiked_bat")
CARD_LEN, CARD_WL = 443 * K, 0.289
bpy.ops.wm.read_factory_settings(use_empty=True)
FLAT = 0.75
def squash(z):  # depth factor along the bat: round handle, oval barrel
    t = min(max((z - 0.10) / 0.20, 0.0), 1.0)
    return 1 - (1 - FLAT) * (t * t * (3 - 2 * t))
WOOD = mat("wood", "f28a1a", 0.45)
TAPE = mat("tape", "c9ccd2", 0.6)
STEEL = mat("steel", "aeb4bd", 0.25, 0.85)

def link(name, bm, mats):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    for m in mats: ob.data.materials.append(m)
    return ob

# ---------- lathe body (knob, handle, taper, barrel, domed end) ----------
PROF = [(0.0, -0.122), (0.016, -0.121), (0.025, -0.117), (0.029, -0.110), (0.028, -0.103),
        (0.019, -0.097), (0.0145, -0.090), (0.0140, -0.04), (0.0145, 0.04), (0.0155, 0.10),
        (0.019, 0.18), (0.024, 0.26), (0.030, 0.36), (0.035, 0.46), (0.038, 0.55),
        (0.0385, 0.61), (0.036, 0.650), (0.030, 0.668), (0.020, 0.676), (0.0, 0.679)]
SEG = 20
bm = bmesh.new()
rings = []
for r, z in PROF:
    if r == 0:
        rings.append([bm.verts.new((0, 0, z))]); continue
    rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / SEG), r * math.sin(2 * math.pi * i / SEG), z)) for i in range(SEG)])
for a, b in zip(rings, rings[1:]):
    for i in range(SEG):
        i2 = (i + 1) % SEG
        if len(a) == 1: bm.faces.new((a[0], b[i2], b[i]))
        elif len(b) == 1: bm.faces.new((a[i], a[i2], b[0]))
        else: bm.faces.new((a[i], a[i2], b[i2], b[i]))
for v in bm.verts: v.co.y *= squash(v.co.z)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
body = link("body", bm, [WOOD])

# ---------- helical grip tape (flat ribbon with thickness) ----------
Z0, Z1, TURNS, W, T, STEPS = -0.088, 0.075, 6, 0.016, 0.0016, 14
bm = bmesh.new()
n = TURNS * STEPS
prev = None
pitch = (Z1 - Z0 - W) / TURNS
for k in range(n + 1):
    a = 2 * math.pi * k / STEPS
    zc = Z0 + W / 2 + pitch * k / STEPS
    rr = 0.0141 + 0.00001 * k
    c, s = math.cos(a), math.sin(a)
    sec = [bm.verts.new((rr * c, rr * s, zc - W / 2)), bm.verts.new(((rr + T) * c, (rr + T) * s, zc - W / 2)),
           bm.verts.new(((rr + T) * c, (rr + T) * s, zc + W / 2)), bm.verts.new((rr * c, rr * s, zc + W / 2))]
    if prev:
        for i in range(4):
            bm.faces.new((prev[i], prev[(i + 1) % 4], sec[(i + 1) % 4], sec[i]))
    else: bm.faces.new(sec[::-1]); first = sec
    prev = sec
bm.faces.new(prev)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
tape = link("tape", bm, [TAPE])

def radius_at(z):
    for (r0, z0), (r1, z1) in zip(PROF, PROF[1:]):
        if z0 <= z <= z1: return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return 0

# ---------- spikes: 8-sided cones with a hex nut collar, card-like scatter ----------
random.seed(7)
SPIKES = []
golden = math.pi * (3 - math.sqrt(5))
for k in range(18):
    z = 0.36 + 0.28 * k / 17
    a = k * golden * 1.0
    L = 0.86 * (0.06 + 0.04 * random.random() * (0.6 + 0.6 * (z - 0.33) / 0.31))
    SPIKES.append((z, a, L))
SPIKES.append((0.672, 0.0, 0.05))  # nail out the end cap, tilted
parts = [body, tape]
for z, a, L in SPIKES:
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.0085, radius2=0.0, depth=L)
    for v in bm.verts: v.co.z += L / 2
    bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.011, radius2=0.011, depth=0.004,
                          matrix=Matrix.Translation((0, 0, 0.0)))
    ob = link("spike", bm, [STEEL])
    r = radius_at(z)
    if z > 0.66:
        d = Vector((0.5, 0.2, 1)).normalized(); base = Vector((0.006, 0, z))
    else:
        d = Vector((math.cos(a), math.sin(a), 0.25)).normalized()
        base = Vector((r * math.cos(a), r * math.sin(a) * squash(z), z)) - d * 0.001
    ob.location = base
    ob.rotation_mode = "QUATERNION"; ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)
    parts.append(ob)

bpy.ops.object.select_all(action="DESELECT")
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
bat = bpy.context.active_object; bat.name = "SpikedBat"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
m = front_measure(bat, (0, 1))
scale_about_origin(bat, CARD_LEN / m["L"])
m = front_measure(bat, (0, 1))
print(f"MEASURE length {m['L']:.3f} (card {CARD_LEN:.3f})  w/l {m['wl']:.3f} (card {CARD_WL})")
tilted = tilted_bbox(bat, 39)  # card shaft rises ~39 deg; card bbox 373 x 308 px
print(f"MEASURE tilt 39: model h/w {tilted[1] / tilted[0]:.3f} | card {308 / 373:.3f}  width {tilted[0]:.3f} (card {373 * K:.3f})")
finish(bat, OUT, 45)
