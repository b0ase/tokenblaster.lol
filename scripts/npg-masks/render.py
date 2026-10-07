"""Render the chibi head with wrapped masks (front + 3/4) and tile a contact sheet.

  Blender -b -P scripts/npg-masks/render.py -- <chibi.glb> <masks dir> <out.png> [ids,comma,sep|ALL|BASE]

BASE renders just the chibi with its own mask (for registration checks).
"""
import bpy, glob, math, os, sys

args = sys.argv[sys.argv.index('--') + 1:]
chibi, masks, out = args[:3]
which = args[3] if len(args) > 3 else 'ALL'
SZ = 360
tmp = os.path.join(os.path.dirname(out), '_tiles')
os.makedirs(tmp, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=chibi)
for o in list(bpy.data.objects):
    if o.name in ('Icosphere', 'weapon'):
        bpy.data.objects.remove(o)
base_mask = bpy.data.objects['mask']
sc = bpy.context.scene
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
sc.render.resolution_x = sc.render.resolution_y = SZ
sc.render.film_transparent = False
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.25, 0.22, 0.22, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; cam.ortho_scale = 0.42
co = bpy.data.objects.new('c', cam); sc.collection.objects.link(co); sc.camera = co
sun = bpy.data.lights.new('s', 'SUN'); sun.energy = 2.5
so = bpy.data.objects.new('s', sun); sc.collection.objects.link(so); so.rotation_euler = (0.9, 0, -0.5)
C = (0.0, 0.0, 0.6)


def shoot(name, yaw):
    r = 3
    co.location = (C[0] + r * math.sin(yaw), C[1] - r * math.cos(yaw), C[2])
    co.rotation_euler = (math.pi / 2, 0, yaw)
    sc.render.filepath = os.path.join(tmp, name)
    bpy.ops.render.render(write_still=True)
    return sc.render.filepath


tiles = []
if which == 'BASE':
    tiles.append(('base', [shoot('base_f.png', 0), shoot('base_q.png', math.radians(35))]))
else:
    base_mask.hide_render = True
    files = sorted(glob.glob(os.path.join(masks, '*.glb')))
    if which != 'ALL':
        files = [f for f in files if os.path.splitext(os.path.basename(f))[0] in which.split(',')]
    for f in files:
        cid = os.path.splitext(os.path.basename(f))[0]
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=f)
        new = [o for o in bpy.data.objects if o not in before]
        tiles.append((cid, [shoot(cid + '_f.png', 0), shoot(cid + '_q.png', math.radians(35))]))
        for o in new:
            bpy.data.objects.remove(o)

# Contact sheet: each card = front + 3/4 side by side, 4 cards per row.
cols = 4
rows = (len(tiles) + cols - 1) // cols
SW, SH = cols * SZ * 2, rows * SZ
sheet = bpy.data.images.new('sheet', SW, SH, alpha=False)
pix = [0.0] * (SW * SH * 4)
for i, (cid, shots) in enumerate(tiles):
    cx, cy = (i % cols) * SZ * 2, (rows - 1 - i // cols) * SZ
    for k, p in enumerate(shots):
        im = bpy.data.images.load(p)
        src = im.pixels[:]
        for y in range(SZ):
            row = (cy + y) * SW + cx + k * SZ
            pix[row * 4:(row + SZ) * 4] = src[y * SZ * 4:(y + 1) * SZ * 4]
        bpy.data.images.remove(im)
    print('TILE', i, cid)
sheet.pixels = pix
sheet.filepath_raw = out
sheet.file_format = 'PNG'
sheet.save()
print('SHEET', out)
