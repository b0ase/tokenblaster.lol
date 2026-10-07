# Render hand-built parts on the chibi with the same placement the Stack Builder uses.
#   Blender -b -P check_on_chibi.py -- chibi_src.glb parts.json public_dir out_prefix id[,id...] [id,...]
# chibi_src.glb must be uncompressed (ninja-punk-girls-com/public/3D_assets/chibi_cyberpunk_final.glb;
# the stack copy is meshopt-compressed and Blender can't import it).
# Each argument after out_prefix is one combo (comma-separated part ids) -> <prefix>_<n>_{front,34}.png
# Placement (glTF / three.js frame: Y up, front +Z), in the chibi's model space:
#   horns : origin -> face anchor (head mesh centre x/z, mask centre height)
#   weapon: origin -> item.L / item.R bone head
#   then + (0, fit.y, fit.z), rotation Euler(pitch, turn, roll, 'XZY'), scale fit.scale.
import bpy, sys, json, math
from mathutils import Vector, Matrix, Euler

a = sys.argv[sys.argv.index("--") + 1:]
chibi, parts_json, pub, prefix, combos = a[0], a[1], a[2], a[3], a[4:]
parts = {p["id"]: p for p in json.load(open(parts_json))}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=chibi)
for o in list(bpy.context.scene.objects):
    if o.name == "Icosphere": bpy.data.objects.remove(o)
def bbox(name):
    o = bpy.data.objects[name]
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return Vector([min(p[i] for p in pts) for i in range(3)]), Vector([max(p[i] for p in pts) for i in range(3)])
hlo, hhi = bbox("head"); mlo, mhi = bbox("mask")
face = Vector(((hlo.x + hhi.x) / 2, (hlo.y + hhi.y) / 2, (mlo.z + mhi.z) / 2))
rig = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"][0]
sock = {s: rig.matrix_world @ rig.pose.bones[f"item.{s}"].head for s in "LR"}  # posed (= glTF node) position
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # glTF -> Blender

def place(pid):
    p = parts[pid]; f = {"scale": 1, "y": 0, "z": 0, "turn": 0, "pitch": 0, "roll": 0, **p.get("fit", {})}
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=pub + p["url"])
    new = [o for o in bpy.context.scene.objects if o not in before]
    anc = sock[p.get("socket", "L")] if p["slot"] == "weapon" else face
    Mg = Matrix.Translation((0, f["y"], f["z"])) @ Euler((f["pitch"], f["turn"], f["roll"]), "XZY").to_matrix().to_4x4() @ Matrix.Scale(f["scale"], 4)
    M = Matrix.Translation(anc) @ C @ Mg @ C.inverted()
    for o in new:
        if o.parent is None: o.matrix_world = M @ o.matrix_world
    return new

sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x = sc.render.resolution_y = 700
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.92, 0.92, 0.94, 1)
for n, rot, e in (("key", (50, 0, -35), 3.0), ("fill", (60, 0, 150), 1.2), ("rim", (110, 0, 200), 1.5)):
    l = bpy.data.lights.new(n, "SUN"); l.energy = e
    o = bpy.data.objects.new(n, l); sc.collection.objects.link(o); o.rotation_euler = [math.radians(x) for x in rot]
cam = bpy.data.cameras.new("c"); cam.type = "ORTHO"; cam.ortho_scale = 1.25
co = bpy.data.objects.new("c", cam); sc.collection.objects.link(co); sc.camera = co
ctr = Vector((0, 0, 0.5))
for i, combo in enumerate(combos):
    added = []
    for pid in combo.split(","): added += place(pid)
    bpy.data.objects["hair"].hide_render = any(parts[p].get("hidesHair") for p in combo.split(","))
    for name, d in (("front", (0, -1, 0.1)), ("34", (0.8, -0.7, 0.2))):
        d = Vector(d).normalized(); co.location = ctr + d * 3
        co.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = f"{prefix}_{i}_{name}.png"
        bpy.ops.render.render(write_still=True)
    for o in added: bpy.data.objects.remove(o, do_unlink=True)
