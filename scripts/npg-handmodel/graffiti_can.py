# Graffiti Can (07_011): magenta spray can, silver shoulder dome and valve, dark base rim and
# nozzle, pale swirl label on the front. Blender -b -P graffiti_can.py. Origin = can centre (grip).
import bpy, math, os, sys
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hm_common import mat, out_path, sweep, slab, bevel, join, fit_weapon, finish

OUT = out_path("07_011_graffiti_can")
bpy.ops.wm.read_factory_settings(use_empty=True)
MAG = mat("magenta", "a8106a", 0.35)
STEEL = mat("steel", "b8bcc4", 0.25, 0.85)
DARK = mat("plum", "5a0a38", 0.4)
LABEL = mat("label", "e9dcf2", 0.4)

R = 0.036
parts = []
body = sweep("body", [Vector((0, 0, -0.07)), Vector((0, 0, 0.054))], [R, R], MAG, nseg=16)
bevel(body, 0.002); parts.append(body)
parts.append(sweep("base", [Vector((0, 0, -0.078)), Vector((0, 0, -0.072)), Vector((0, 0, -0.066))], [R * 0.93, R + 0.0015, R + 0.0015], DARK, nseg=16))
parts.append(sweep("shoulder", [Vector((0, 0, 0.052)), Vector((0, 0, 0.06)), Vector((0, 0, 0.068)), Vector((0, 0, 0.073))],
                   [R + 0.0015, R * 0.9, R * 0.55, R * 0.4], STEEL, nseg=16))
parts.append(sweep("valve", [Vector((0, 0, 0.073)), Vector((0, 0, 0.083))], [0.011, 0.011], STEEL, nseg=10))
parts.append(sweep("nozzle", [Vector((0, 0, 0.083)), Vector((0, 0, 0.09))], [0.008, 0.007], DARK, nseg=8))
lab = []   # label: pale swirl blob, a thin plate bent round the can front
for k in range(14):
    a = 2 * math.pi * k / 14
    rr = 1 + 0.18 * math.sin(2 * a + 0.6)   # lumpy cloud-swirl blob
    lab.append((0.025 * math.cos(a) * rr, 0.024 * math.sin(a) * rr))
parts.append(slab("label", lab, 0.004, LABEL, y0=-R + 0.0005, bend=8.0))
ob = join(parts, "GraffitiCan")
fit_weapon(ob, 90, 76, 178)   # card: upright can, bbox 76 x 178 px
finish(ob, OUT, 35)
