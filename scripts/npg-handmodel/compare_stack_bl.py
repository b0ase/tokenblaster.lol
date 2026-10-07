# Blender half of compare_stack.py: assemble 3D parts on the chibi like the Stack Builder and render
# an orthographic front view framed to the 961x1441 card canvas, or dump each part's projected
# triangles in card px (for card-derived fits).
#   Blender -b --factory-startup -P compare_stack_bl.py -- job.json
# Frames (Blender: Z up, front -Y). glTF/three: Y up, front +Z. Canvas px <-> Blender:
#   X = face.x + (px - FACE_PX.x) * K      Z = face.z + (FACE_PX.y - py) * K
import bpy, sys, json, math
from mathutils import Vector, Matrix, Euler

job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
K, W, H = job["K"], job["W"], job["H"]
FX, FY = job["face_px"]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=job["chibi"])
for o in list(bpy.context.scene.objects):
    if o.name == "Icosphere":
        bpy.data.objects.remove(o)


def bbox_objs(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
    return Vector([min(p[i] for p in pts) for i in range(3)]), Vector([max(p[i] for p in pts) for i in range(3)])


obj = bpy.data.objects
hlo, hhi = bbox_objs([obj["head"]])
mlo, mhi = bbox_objs([obj["mask"]])
face = Vector(((hlo.x + hhi.x) / 2, (hlo.y + hhi.y) / 2, (mlo.z + mhi.z) / 2))
rig = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"][0]
sock = {s: rig.matrix_world @ rig.pose.bones[f"item.{s}"].head for s in "LR"}
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # glTF -> Blender


def to_px(p):
    return [FX + (p.x - face.x) / K, FY - (p.z - face.z) / K]


def imp(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.context.scene.objects if o not in before]


def apply(new, M):
    for o in new:
        if o.parent is None:
            o.matrix_world = M @ o.matrix_world
    bpy.context.view_layer.update()


def fitv(it):
    return {"scale": 1, "x": 0, "y": 0, "z": 0, "turn": 0, "pitch": 0, "roll": 0, **it.get("fit", {})}


def place(it):
    """Returns (objects, anchor) with the item placed in the chibi's space."""
    new = imp(it["url"])
    f = fitv(it)
    if it["kind"] == "hair":
        # StackBuilder place(): scaled to the base hair's width, top sunk 12% into the scalp, front on the hairline.
        obj["hair"].hide_render = True
        apply(new, Matrix.Rotation(it["turn"] + f["turn"], 4, "Z"))
        slo, shi = bbox_objs([obj["hair"]])
        lo, hi = bbox_objs(new)
        k = (shi.x - slo.x) / (hi.x - lo.x) * f["scale"]
        apply(new, Matrix.Scale(k, 4))
        lo, hi = bbox_objs(new)
        t = Vector(((slo.x + shi.x) / 2 - (lo.x + hi.x) / 2, slo.y - lo.y - f["z"], shi.z - hi.z - (shi.z - slo.z) * 0.12 + f["y"]))
        apply(new, Matrix.Translation(t))
        return new, face
    if it.get("wrapped"):
        obj["mask"].hide_render = True
        return new, face  # already in the chibi's model space
    if it.get("handBuilt"):
        if it["slot"] == "horns" and it.get("hidesHair"):
            obj["hair"].hide_render = True
        anc = sock[it.get("socket", "L")] if it["slot"] in ("weapon", "lweapon") else face
        mir = Matrix.Diagonal((-1, 1, 1, 1)) if it.get("mirror") else Matrix.Identity(4)
        Mg = (Matrix.Translation((f["x"], f["y"], f["z"])) @ Euler((f["pitch"], f["turn"], f["roll"]), "XZY").to_matrix().to_4x4()
              @ Matrix.Scale(f["scale"], 4) @ mir)
        apply(new, Matrix.Translation(anc) @ C @ Mg @ C.inverted())
        return new, anc
    # Tripo mask / horns: auto-fit to the base mask box (approximation of StackBuilder placeRigid)
    if it["slot"] == "mask":
        obj["mask"].hide_render = True
    apply(new, Euler((f["pitch"], f["roll"], f["turn"]), "XYZ").to_matrix().to_4x4())
    lo, hi = bbox_objs(new)
    if (hi.y - lo.y) > (hi.x - lo.x):
        apply(new, Matrix.Rotation(-math.pi / 2, 4, "Z"))
        lo, hi = bbox_objs(new)
    k = (mhi.x - mlo.x) * (0.9 if it["slot"] == "horns" else 1) / (hi.x - lo.x) * f["scale"]
    apply(new, Matrix.Scale(k, 4))
    lo, hi = bbox_objs(new)
    if it["slot"] == "mask":
        t = Vector(((mlo.x + mhi.x) / 2 - (lo.x + hi.x) / 2, mlo.y - lo.y - f["z"], (mlo.z + mhi.z) / 2 - (lo.z + hi.z) / 2 + f["y"]))
    else:
        slo, shi = bbox_objs([obj["hair"]])
        t = Vector(((slo.x + shi.x) / 2 - (lo.x + hi.x) / 2, (slo.y + shi.y) / 2 - (lo.y + hi.y) / 2 - f["z"], shi.z - (shi.z - slo.z) * 0.2 - lo.z + f["y"]))
    apply(new, Matrix.Translation(t))
    return new, face


if job.get("dump"):
    out = {}
    dg = bpy.context.evaluated_depsgraph_get()
    for it in job["items"]:
        new, anc = place(it)
        tris = []
        for o in new:
            if o.type != "MESH":
                continue
            ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
            me = ev.to_mesh()
            me.calc_loop_triangles()
            M = o.matrix_world
            vs = [to_px(M @ v.co) for v in me.vertices]
            tris += [[vs[i] for i in t.vertices] for t in me.loop_triangles]
            ev.to_mesh_clear()
        out[it["id"]] = {"tris": tris, "anchor": to_px(anc)}
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)
    json.dump(out, open(job["dump"], "w"))
    print("STACK dumped", len(out))
    sys.exit(0)

names = []
for it in job["items"]:
    place(it)
    names.append(it.get("id", it.get("card")))
lo, hi = bbox_objs([o for o in bpy.context.scene.objects if o.type == "MESH" and not o.hide_render])
print(f"STACK chibi bbox px x {to_px(lo)[0]:.0f}..{to_px(hi)[0]:.0f} y {to_px(hi)[1]:.0f}..{to_px(lo)[1]:.0f}")

sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y = W, H
sc.render.film_transparent = True
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.9, 0.9, 0.92, 1)
for n, rot, e in (("key", (50, 0, -35), 3.0), ("fill", (60, 0, 150), 1.2), ("rim", (110, 0, 200), 1.5)):
    l = bpy.data.lights.new(n, "SUN"); l.energy = e
    o = bpy.data.objects.new(n, l); sc.collection.objects.link(o); o.rotation_euler = [math.radians(x) for x in rot]
cam = bpy.data.cameras.new("c"); cam.type = "ORTHO"; cam.ortho_scale = H * K
co = bpy.data.objects.new("c", cam); sc.collection.objects.link(co); sc.camera = co
co.location = (face.x + (W / 2 - FX) * K, face.y - 5, face.z + (FY - H / 2) * K)
co.rotation_euler = (math.radians(90), 0, 0)
sc.render.filepath = job["png"]
bpy.ops.render.render(write_still=True)
print("STACK rendered", ", ".join(names))
