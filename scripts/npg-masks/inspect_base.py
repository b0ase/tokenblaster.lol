import bpy, mathutils, os
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="/Volumes/2026/Projects/ninja-punk-girls-com/public/3D_assets/chibi_cyberpunk_final.glb")
for o in bpy.data.objects:
    print("OBJ", o.name, o.type, o.parent.name if o.parent else None, o.parent_type, o.parent_bone,
          [m.type for m in o.modifiers], tuple(round(v, 3) for v in o.location),
          len(o.data.vertices) if o.type == 'MESH' else '')
m = bpy.data.objects.get('mask')
if m:
    print('groups', [g.name for g in m.vertex_groups][:10], 'uv', [u.name for u in m.data.uv_layers],
          'mats', [s.material.name for s in m.material_slots])
    for n in m.material_slots[0].material.node_tree.nodes:
        if n.type == 'TEX_IMAGE':
            print('img', n.image.name, n.image.size[:])
    bb = [m.matrix_world @ mathutils.Vector(c) for c in m.bound_box]
    print('bbox', [round(min(v[i] for v in bb), 3) for i in range(3)], [round(max(v[i] for v in bb), 3) for i in range(3)])
    bb = [o.matrix_world @ mathutils.Vector(c) for o in bpy.data.objects if o.type == 'MESH' for c in o.bound_box]
    print('all', [round(min(v[i] for v in bb), 3) for i in range(3)], [round(max(v[i] for v in bb), 3) for i in range(3)])
