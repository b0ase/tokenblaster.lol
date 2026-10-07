# Machete (07_020): long blackened blade with a saw-tooth spine, four angled vent holes, a pale
# bevelled cutting edge, a clipped tanto tip and a dark notched grip. Blender -b -P machete.py
# Weapon frame: blade along +Z, origin = grip, cutting edge on +X, flats to the camera.
import bpy, os, sys
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hm_common import mat, out_path, sweep, slab, bevel, join, fit_weapon, finish

OUT = out_path("07_020_machete")
bpy.ops.wm.read_factory_settings(use_empty=True)
BLADE = mat("blade", "34363c", 0.35, 0.7)
EDGE = mat("edge", "a9adb3", 0.2, 0.9)
HOLE = mat("hole", "08080a", 0.6)
GRIP = mat("grip", "1d1a1e", 0.7)

W = 0.022
spine = []
for k in range(7):   # saw teeth on the spine, z 0.05 .. 0.13
    z = 0.05 + k * 0.012
    spine += [(-W, z), (-W - 0.008, z + 0.004)]
outline = [(W, 0.0), (W, 0.2), (0.004, 0.246), (-0.012, 0.236), (-W, 0.205), (-W, 0.135)] + spine[::-1] + [(-W, 0.0)]
bl = slab("blade", outline, 0.008, BLADE); bevel(bl, 0.0015, 1, 30)
parts = [bl]
parts.append(slab("edge", [(W, 0.0), (W, 0.2), (0.004, 0.246), (-0.002, 0.24), (0.011, 0.198), (0.011, 0.0)], 0.0095, EDGE))
for k in range(4):   # vent holes: dark parallelograms set into both flats
    z = 0.10 + k * 0.03
    parts.append(slab("hole", [(-0.012, z), (0.004, z + 0.004), (0.002, z + 0.018), (-0.014, z + 0.014)], 0.0105, HOLE))
parts.append(sweep("grip", [Vector((0, 0, -0.085)), Vector((0, 0, 0.0))], [0.011, 0.012], GRIP, nseg=6, squash=0.6))
for k in range(3):   # finger ridges
    z = -0.07 + k * 0.022
    parts.append(sweep("ridge", [Vector((0.002, 0, z)), Vector((0.002, 0, z + 0.006))], [0.0135, 0.0135], GRIP, nseg=6, squash=0.6))
parts.append(slab("guard", [(-0.03, -0.004), (0.026, -0.004), (0.026, 0.006), (-0.03, 0.006)], 0.012, GRIP))
ob = join(parts, "Machete")
ob.data.transform(Matrix.Translation((0, 0, 0.042))); ob.data.update()   # origin = grip centre
fit_weapon(ob, 30, 260, 166)   # card: blade rises ~30 deg, bbox 260 x 166 px
finish(ob, OUT, 30)
