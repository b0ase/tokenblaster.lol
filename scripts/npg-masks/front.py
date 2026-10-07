"""Debug: render the chibi head front-on (ortho) to see where the base mask sits. Args after --: out.png"""
import bpy, sys, mathutils
out = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="/Volumes/2026/Projects/ninja-punk-girls-com/public/3D_assets/chibi_cyberpunk_final.glb")
head = bpy.data.objects['head']
bb = [head.matrix_world @ mathutils.Vector(c) for c in head.bound_box]
print('HEAD', [round(min(v[i] for v in bb), 3) for i in range(3)], [round(max(v[i] for v in bb), 3) for i in range(3)])
for o in bpy.data.objects:
    if o.name in ('Icosphere',):
        o.hide_render = True
sc = bpy.context.scene
cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; cam.ortho_scale = 0.5
co = bpy.data.objects.new('c', cam); sc.collection.objects.link(co); sc.camera = co
co.location = (0, -3, 0.5); co.rotation_euler = (1.5708, 0, 0)
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
sc.render.resolution_x = sc.render.resolution_y = 500
w = bpy.data.worlds.new('w'); w.color = (1, 1, 1); sc.world = w
w.use_nodes = True; w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
