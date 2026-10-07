"""Step 2 (Blender headless): paint every cropped card onto the chibi's own (Ayumi) mask mesh.

  Blender -b -P scripts/npg-masks/wrap.py -- <chibi.glb> <crops dir> <out dir>

For each crop: take the base `mask` mesh in its rest pose, in model space (same space as the
chibi glb, so the viewer can parent it to the head bone exactly where the base mask is), give it
front-on planar UVs from register.py, drop faces the card art doesn't cover (alpha), one material
with the crop as base colour + alpha (alpha-clip set in the glb JSON afterwards), export a glb.
"""
import bpy, bmesh, glob, json, math, os, struct, sys

from mathutils.bvhtree import BVHTree  # noqa: E402
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from register import CX, SX, Z0, CY, SZ, CROP  # noqa: E402

chibi, crops, out = sys.argv[sys.argv.index('--') + 1:][:3]
os.makedirs(out, exist_ok=True)
L, T, R, B = CROP


# Eye-level cards sit above the base mask; they ride on the front of the head mesh instead.
# Card canvas eye centres (405,655)/(560,655) <-> chibi eyes x -0.10/+0.05, z 0.575.
EYE_CARDS = {'11_002_Mask_Payne-Patch', '11_005_Mask_Medical', '11_009_Mask_Miami-Sunglasses',
             '11_015_Mask_Racing-Goggles', '11_020_Mask_Glasses'}
mode = 'mask'
CYL_Y, CYL_R = 0.03, 0.13  # vertical axis behind the face, radius ~ the face's curve
# Cards whose art goes above the base mask's top edge: extend upward with the face surface.
TALL_CARDS = {'11_001_Mask_Yama-Mask', '11_006_Mask_Spiked'}


def uv_of(co):
    if mode == 'eyes':
        px = 482 + (co.x + 0.025) * 1033
        py = 655 + (0.575 - co.z) * 920
    else:
        # Cylindrical, not planar: arc length round the head, so the card's outer art wraps onto
        # the cheeks instead of smearing. Same px/m as vertical (843) also matches the card width.
        theta = math.atan2(co.x, CYL_Y - co.y)
        px = CX + CYL_R * theta * SZ
        py = CY + (Z0 - co.z) * SZ
    return ((px - L) / (R - L), 1 - (py - T) / (B - T))


def patch_glb(path):
    """Set alphaMode MASK + doubleSided on every material, strip unused bits."""
    data = open(path, 'rb').read()
    jlen = struct.unpack('<I', data[12:16])[0]
    j = json.loads(data[20:20 + jlen])
    for m in j.get('materials', []):
        m['alphaMode'] = 'MASK'
        m['alphaCutoff'] = 0.5
        m['doubleSided'] = True
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    rest = data[20 + jlen:]
    body = struct.pack('<I', len(js)) + b'JSON' + js + rest
    open(path, 'wb').write(b'glTF' + struct.pack('<II', 2, 12 + len(body)) + body)


for crop in sorted(glob.glob(os.path.join(crops, '*.png'))):
    cid = os.path.splitext(os.path.basename(crop))[0]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=chibi)
    mode = 'eyes' if cid in EYE_CARDS else 'mask'
    src = bpy.data.objects['mask' if mode == 'mask' else 'head']
    me = src.data.copy()
    me.transform(src.matrix_world)  # rest pose, model space
    if mode == 'eyes':
        # Front of the face only, pushed out 3 mm so it sits on the skin.
        bm0 = bmesh.new()
        bm0.from_mesh(me)
        bm0.normal_update()
        bmesh.ops.delete(bm0, geom=[f for f in bm0.faces if f.normal.y > -0.25 or f.calc_center_median().z < 0.5], context='FACES')
        for v in bm0.verts:
            v.co += v.normal * 0.003
        bm0.to_mesh(me)
        bm0.free()
    elif cid in TALL_CARDS:
        # Front of the head from the mask up to under the eyes (and up the nose), 3 mm out,
        # merged into the mask mesh; faces the art doesn't reach are trimmed below as usual.
        h = bpy.data.objects['head']
        strip = h.data.copy()
        strip.transform(h.matrix_world)
        bm0 = bmesh.new()
        bm0.from_mesh(strip)
        bm0.normal_update()

        def keep(f):
            c = f.calc_center_median()
            top = 0.60 if abs(c.x) < 0.035 else 0.553
            return f.normal.y < -0.3 and 0.5 < c.z < top
        bmesh.ops.delete(bm0, geom=[f for f in bm0.faces if not keep(f)], context='FACES')
        for v in bm0.verts:
            v.co += v.normal * 0.003
        bm0.from_mesh(me)  # append the mask itself
        bm0.to_mesh(me)
        bm0.free()
    hd = bpy.data.objects['head'].data.copy()
    hd.transform(bpy.data.objects['head'].matrix_world)
    face_bvh = BVHTree.FromPolygons([v.co.copy() for v in hd.vertices], [list(p.vertices) for p in hd.polygons])
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    obj = bpy.data.objects.new(cid, me)
    bpy.context.scene.collection.objects.link(obj)

    img = bpy.data.images.load(crop)
    W, H = img.size
    px = img.pixels[:]

    def alpha(u, v):
        x = min(W - 1, max(0, int(u * W)))
        y = min(H - 1, max(0, int(v * H)))  # Blender pixels: row 0 = bottom, matches v
        return px[(y * W + x) * 4 + 3]

    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.verify()
    dead = []
    for f in bm.faces:
        hit = False
        cen = f.calc_center_median()
        pts = [cen] + [l.vert.co for l in f.loops] + [(cen + l.vert.co) / 2 for l in f.loops]
        for p in pts:
            u, v = uv_of(p)
            if alpha(u, v) > 0.5:
                hit = True
                break
        for l in f.loops:
            l[uvl].uv = uv_of(l.vert.co)
        if not hit:
            dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')

    # Flush: pull the outline (boundary loop) onto the face, 1.5 mm out, and the next ring half
    # way, so edges and straps don't stand proud. Interior keeps its shape (respirators etc.).
    # UVs are already set, so the art doesn't slide.
    def gap(co):
        hit = face_bvh.find_nearest(co)
        return (hit[0], hit[1], hit[3]) if hit[0] is not None else (None, None, 0.0)
    edge = {v for v in bm.verts if any(e.is_boundary for e in v.link_edges)}
    ring = {n for v in edge for e in v.link_edges for n in (e.other_vert(v),)} - edge
    for vs, k in ((edge, 1.0), (ring, 0.5)):
        for v in vs:
            loc, nrm, d = gap(v.co)
            if loc is None or d < 0.0015:
                continue
            target = loc + nrm.normalized() * 0.0015
            v.co = v.co.lerp(target, k)
    edge_gap = max((gap(v.co)[2] for v in edge), default=0)
    all_gap = max((gap(v.co)[2] for v in bm.verts), default=0)
    print('GAP', cid, 'edge_mm=%.1f' % (edge_gap * 1000), 'max_mm=%.1f' % (all_gap * 1000))
    bm.to_mesh(me)
    bm.free()
    # keep only the one UV layer, no weights
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[1] if me.uv_layers[0].active else me.uv_layers[0])
    obj.vertex_groups.clear()
    if not me.polygons:
        print('EMPTY', cid)
        continue

    mat = bpy.data.materials.new(cid)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Linear'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = 0.55
    me.materials.clear()
    me.materials.append(mat)

    path = os.path.join(out, cid + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False,
                              export_skins=False, export_animations=False, export_materials='EXPORT',
                              export_image_format='AUTO', export_yup=True)
    patch_glb(path)
    print('WROTE', cid, len(me.polygons), os.path.getsize(path))
