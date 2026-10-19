"""Slim and repair the NPG rigged characters in headless Blender, writing to out/npg-models/fixed/ (public/ untouched).
 - Tripo bodies come out at a fixed 90,000 tris: Decimate (collapse) to TARGET tris. UVs, texture and vertex
   groups survive the collapse, so the texture and the skinning stay as they were.
 - Close tiny holes: merge vertices closer than 0.01 mm (the non-manifold edges on Miyuki and Nao).
 - Renders a large front + 3/4 close-up of the head before and after, for an eyeball check of edge detail.
Run:  Blender -b -P scripts/npg-models/fix_models.py -- [--target 30000] [ids...]
"""
import bmesh, bpy, glob, math, os, sys
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CARDS = os.path.join(ROOT, 'public', 'npg', 'cards')
OUT = os.path.join(ROOT, 'out', 'npg-models', 'fixed'); REN = os.path.join(OUT, 'renders')


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    for o in list(bpy.data.objects):   # importer's bone-display shapes are not part of the model
        if o.type == 'MESH' and o.name.startswith('Icosphere') and not o.modifiers: bpy.data.objects.remove(o)
    return [o for o in bpy.data.objects if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers)]


def tris(meshes): return sum(len(p.vertices) - 2 for o in meshes for p in o.data.polygons)


def render(meshes, tag, mid):
    s = bpy.context.scene; s.render.engine = 'BLENDER_WORKBENCH'; s.render.resolution_x = s.render.resolution_y = 768
    s.render.film_transparent = True; s.display.shading.light = 'STUDIO'; s.display.shading.color_type = 'TEXTURE'
    s.display.shading.show_cavity = True   # cavity shading shows edge definition, which is what decimation can lose
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    head_z = lo.z + (hi.z - lo.z) * 0.72; size = (hi.z - lo.z) * 0.5   # chibi: the head is the top ~half
    cam = bpy.data.objects.get('cam') or bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    if cam.name not in s.collection.objects: s.collection.objects.link(cam)
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = size; s.camera = cam
    for view, ang in (('front', 0), ('34', 40)):
        r = 10; a = math.radians(ang)
        cam.location = (math.sin(a) * r, -math.cos(a) * r, head_z); cam.rotation_euler = (math.pi / 2, 0, a)
        s.render.filepath = os.path.join(REN, f'{mid}_{tag}_{view}.png'); bpy.ops.render.render(write_still=True)


def fix(mid, target):
    src = os.path.join(CARDS, f'{mid}-rigged.glb'); meshes = load(src); before = tris(meshes)
    render(meshes, 'before', mid)
    for o in meshes:
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5); bm.to_mesh(o.data); bm.free()
        t = sum(len(p.vertices) - 2 for p in o.data.polygons)
        share = target * t / max(before, 1)
        if t > share * 1.05:
            d = o.modifiers.new('slim', 'DECIMATE'); d.decimate_type = 'COLLAPSE'; d.ratio = share / t
            d.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = o
            # decimate must run before the armature modifier, on the rest-pose mesh
            while o.modifiers.find('slim') > 0: bpy.ops.object.modifier_move_up(modifier='slim')
            bpy.ops.object.modifier_apply(modifier='slim')
    after = tris(meshes); render(meshes, 'after', mid)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, f'{mid}-rigged.glb'), export_format='GLB', export_skins=True,
                              export_animations=False, export_image_format='WEBP', export_apply=False)
    print(f'{mid}: {before} -> {after} tris', flush=True)


if __name__ == '__main__':
    os.makedirs(REN, exist_ok=True)
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    target = int(a[a.index('--target') + 1]) if '--target' in a else 30000
    ids = [x for x in a if not x.startswith('--') and not x.isdigit()] or sorted(
        os.path.basename(p)[:-len('-rigged.glb')] for p in glob.glob(os.path.join(CARDS, '*-rigged.glb')))
    for mid in ids: fix(mid, target)
