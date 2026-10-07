# Render front / 3-4 / side / back of a GLB. Blender -b -P render_views.py -- in.glb outprefix
import bpy, sys, math
from mathutils import Vector

glb, prefix = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
ctr, size = (lo + hi) / 2, (hi - lo).length

sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x = sc.render.resolution_y = 600
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); sc.world = w
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
sc.render.film_transparent = False
# freestyle ink outline (toon card look)
sc.render.use_freestyle = True
sc.render.line_thickness = 1.2
fs = sc.view_layers[0].freestyle_settings
ls = fs.linesets[0] if len(fs.linesets) else fs.linesets.new('ink')
if ls.linestyle is None: ls.linestyle = bpy.data.linestyles.new('ink')
ls.linestyle.color = (0.18, 0.02, 0.04)
ls.select_by_visibility = True; ls.select_silhouette = True; ls.select_border = True; ls.select_crease = True

def light(name, rot, energy):
    l = bpy.data.lights.new(name, "SUN"); l.energy = energy
    o = bpy.data.objects.new(name, l); sc.collection.objects.link(o)
    o.rotation_euler = [math.radians(a) for a in rot]
light("key", (50, 0, -35), 3.0)
light("fill", (60, 0, 150), 1.2)
light("rim", (110, 0, 200), 1.5)

cam = bpy.data.cameras.new("c"); cam.type = "ORTHO"; cam.ortho_scale = size * 1.08
co = bpy.data.objects.new("c", cam); sc.collection.objects.link(co); sc.camera = co
# Blender Z-up after import; model front = -Y
views = {"front": (0, -1, 0.12), "34": (0.75, -0.75, 0.25), "side": (1, 0, 0.12), "back": (0, 1, 0.12)}
for name, d in views.items():
    d = Vector(d).normalized()
    co.location = ctr + d * size * 3
    co.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = f"{prefix}_{name}.png"
    bpy.ops.render.render(write_still=True)
