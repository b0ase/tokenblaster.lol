"""Headless Blender check for the NPG rigged characters (public/npg/cards/*-rigged.glb).

Per model: triangle count, loose verts, non-manifold edges, degenerate faces, skin weights (unweighted verts,
verts with >4 influences, weights not summing to 1), skeleton (missing core mixamorig bones), then a pose test:
the shared Mixamo clips (public/npg/anims/mixamo-anims.glb) are played on the model and a frame of each is
rendered from the front, with a check that the pose does not explode (bounding box vs rest).

Run:  /Volumes/2026/Apps/Blender.app/Contents/MacOS/Blender -b -P scripts/npg-models/check_models.py -- [ids...]
Writes out/npg-models/report.json and out/npg-models/renders/<id>_<clip>.png (sheet.py builds the contact sheet).
"""
import bmesh, bpy, glob, json, math, os, sys
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CARDS = os.environ.get('NPG_CARDS') or os.path.join(ROOT, 'public', 'npg', 'cards')
ANIMS = os.path.join(ROOT, 'public', 'npg', 'anims', 'mixamo-anims.glb')
OUT = os.environ.get('NPG_OUT') or os.path.join(ROOT, 'out', 'npg-models'); REN = os.path.join(OUT, 'renders')
CLIPS = ['Idle_Loop', 'Sprint_Loop', 'Sword_Regular_A', 'Sword_Dash', 'Hit_Chest']
CORE = ['Hips', 'Spine', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm',
        'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']
TRI_BUDGET = 30000   # whole character; parts stay at <=3k each
MAX_INFLUENCES = 4   # three.js skinning limit


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def imp(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def bbox(objs, depsgraph):
    pts = []
    for o in objs:
        if o.type != 'MESH': continue
        e = o.evaluated_get(depsgraph)
        pts += [e.matrix_world @ Vector(c) for c in e.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def mesh_checks(meshes, arm):
    r = dict(tris=0, verts=0, loose_verts=0, non_manifold_edges=0, degenerate_faces=0, unweighted_verts=0,
             over_influence_verts=0, bad_weight_sum_verts=0, materials=set())
    bones = set(b.name for b in arm.data.bones) if arm else set()
    for o in meshes:
        me = o.data; r['materials'] |= {m.name for m in me.materials if m}
        bm = bmesh.new(); bm.from_mesh(me)
        r['tris'] += sum(len(f.verts) - 2 for f in bm.faces); r['verts'] += len(bm.verts)
        r['loose_verts'] += sum(1 for v in bm.verts if not v.link_edges)
        r['non_manifold_edges'] += sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
        r['degenerate_faces'] += sum(1 for f in bm.faces if f.calc_area() < 1e-10)
        bm.free()
        names = {g.index: g.name for g in o.vertex_groups}
        for v in me.vertices:
            ws = [g.weight for g in v.groups if g.weight > 1e-4 and names.get(g.group) in bones]
            if not ws: r['unweighted_verts'] += 1
            elif len(ws) > MAX_INFLUENCES: r['over_influence_verts'] += 1
            elif abs(sum(ws) - 1) > 0.02: r['bad_weight_sum_verts'] += 1
    r['materials'] = sorted(r['materials'])
    return r


def camera_for(objs):
    dg = bpy.context.evaluated_depsgraph_get(); lo, hi = bbox(objs, dg)
    c = (lo + hi) / 2; size = max(hi.x - lo.x, hi.z - lo.z) * 1.15
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); bpy.context.scene.collection.objects.link(cam)
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = size
    cam.location = (c.x, lo.y - 10, c.z); cam.rotation_euler = (math.pi / 2, 0, 0)   # glTF front faces -Y in Blender
    bpy.context.scene.camera = cam
    return (hi - lo).length


def setup_render():
    s = bpy.context.scene; s.render.engine = 'BLENDER_WORKBENCH'
    s.render.resolution_x = s.render.resolution_y = 384; s.render.film_transparent = True
    s.display.shading.light = 'STUDIO'; s.display.shading.color_type = 'TEXTURE'


def check(mid, anim_actions):
    clear(); setup_render()
    objs = imp(os.path.join(CARDS, f'{mid}-rigged.glb'))
    arm = next((o for o in objs if o.type == 'ARMATURE'), None)
    # skinned meshes only: the glTF importer adds an 'Icosphere' bone-display shape that is not in the file
    meshes = [o for o in objs if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers)]
    loose_objs = [o.name for o in objs if o.type == 'MESH' and o not in meshes and o.users_collection]
    rep = dict(id=mid, armature=bool(arm), meshes=len(meshes))
    rep.update(mesh_checks(meshes, arm))
    rep['unskinned_meshes'] = [n for n in loose_objs if not n.startswith('Icosphere')]
    names = {b.name.split(':')[-1] for b in arm.data.bones} if arm else set()
    rep['bones'] = len(names); rep['missing_core_bones'] = [b for b in CORE if b not in names]
    rep['non_mixamo_bones'] = sorted(b.name for b in arm.data.bones if not b.name.startswith('mixamorig:'))[:10] if arm else []
    rest_diag = camera_for(meshes); rep['poses'] = {}
    bpy.context.scene.render.filepath = os.path.join(REN, f'{mid}_rest.png'); bpy.ops.render.render(write_still=True)
    if arm:
        # bring the shared clips in from the anim library (fcurves address pose.bones["mixamorig:*"] by name)
        with bpy.data.libraries.load(anim_actions['blend']) as (src, dst): dst.actions = [a for a in src.actions if a in CLIPS]
        arm.animation_data_create()
        for act in dst.actions:
            if act is None: continue
            arm.animation_data.action = act
            if hasattr(act, 'slots') and act.slots: arm.animation_data.action_slot = act.slots[0]
            f0, f1 = act.frame_range; f = int((f0 + f1) / 2); bpy.context.scene.frame_set(f)
            lo, hi = bbox(meshes, bpy.context.evaluated_depsgraph_get()); ratio = (hi - lo).length / rest_diag
            bpy.context.scene.render.filepath = os.path.join(REN, f'{mid}_{act.name}.png'); bpy.ops.render.render(write_still=True)
            rep['poses'][act.name] = dict(frame=f, bbox_vs_rest=round(ratio, 2), exploded=not (0.5 < ratio < 1.8))
    issues = []
    if not arm: issues.append('no armature')
    if rep['unskinned_meshes']: issues.append('unskinned meshes ' + ','.join(rep['unskinned_meshes']))
    if rep['tris'] > TRI_BUDGET: issues.append(f"{rep['tris']} tris > {TRI_BUDGET}")
    if rep['missing_core_bones']: issues.append('missing bones ' + ','.join(rep['missing_core_bones']))
    if rep['unweighted_verts']: issues.append(f"{rep['unweighted_verts']} unweighted verts")
    if rep['over_influence_verts']: issues.append(f"{rep['over_influence_verts']} verts >4 influences")
    if rep['bad_weight_sum_verts']: issues.append(f"{rep['bad_weight_sum_verts']} verts weights !=1")
    if rep['non_manifold_edges']: issues.append(f"{rep['non_manifold_edges']} non-manifold edges")
    if rep['loose_verts']: issues.append(f"{rep['loose_verts']} loose verts")
    for k, p in rep['poses'].items():
        if p['exploded']: issues.append(f'{k} pose explodes (bbox x{p["bbox_vs_rest"]})')
    rep['issues'] = issues
    return rep


def anim_library():
    """Import the clip GLB once and save its actions to a .blend each model check can link from."""
    clear(); imp(ANIMS)
    path = os.path.join(OUT, 'mixamo-anims.blend')
    for a in bpy.data.actions: a.use_fake_user = True
    bpy.ops.wm.save_as_mainfile(filepath=path)
    return dict(blend=path, clips=[a.name for a in bpy.data.actions])


if __name__ == '__main__':
    os.makedirs(REN, exist_ok=True)
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ids = args or sorted(os.path.basename(p)[:-len('-rigged.glb')] for p in glob.glob(os.path.join(CARDS, '*-rigged.glb')))
    lib = anim_library(); print('clips in library:', lib['clips'])
    reports = []
    for mid in ids:
        try: r = check(mid, lib)
        except Exception as e: r = dict(id=mid, issues=[f'check crashed: {e!r}'])
        reports.append(r); print(mid, 'OK' if not r['issues'] else r['issues'], flush=True)
    json.dump(reports, open(os.path.join(OUT, 'report.json'), 'w'), indent=1)
