# Sai (07_008): long pointed octagonal steel shaft, two side prongs (yoku) sweeping out and up
# with flicked tips, dark wrapped handle and a pointed pommel. Card steel has a warm rose sheen.
# Blender -b -P sai.py. Weapon frame: shaft along +Z, origin = grip, prongs in the XZ plane.
import bpy, math, os, sys
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hm_common import mat, out_path, sweep, join, fit_weapon, finish

OUT = out_path("07_008_sai")
bpy.ops.wm.read_factory_settings(use_empty=True)
STEEL = mat("steel", "c9bcbc", 0.2, 0.9)
ROSE = mat("rose", "c98f86", 0.25, 0.8)
WRAP = mat("wrap", "3b1518", 0.7)
CAP = mat("cap", "6d6f78", 0.3, 0.8)

def cubic(p0, p1, p2, p3, n):
    return [(1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3
            for t in (i / n for i in range(n + 1))]

parts = []
# shaft (monouchi): flat diamond section, tapering to a point
parts.append(sweep("shaft", [Vector((0, 0, 0.0)), Vector((0, 0, 0.40)), Vector((0, 0, 0.47))],
                   [0.02, 0.013, 0.0], STEEL, nseg=4, squash=0.35))  # flat diamond blade
# prongs: out from the guard, curling up, tips flicking outward
for s in (-1, 1):
    # broad flat flame-like prong: out, up, then the tip hooks back inward
    c = cubic(Vector((0, 0, 0.0)), Vector((0.10 * s, 0, -0.02)), Vector((0.09 * s, 0, 0.12)),
              Vector((0.13 * s, 0, 0.17)), 8)
    c += [Vector((0.15 * s, 0, 0.20)), Vector((0.135 * s, 0, 0.225))]
    r = [0.022 - 0.012 * i / 10 for i in range(10)] + [0.0]
    parts.append(sweep("prong", c, r, ROSE, nseg=6, squash=0.35))
# guard collar
parts.append(sweep("collar", [Vector((0, 0, -0.012)), Vector((0, 0, 0.012))], [0.017, 0.017], CAP, nseg=8))
# handle (tsuka) with wrap ridges and a pointed pommel
HL = 0.13
parts.append(sweep("grip", [Vector((0, 0, -0.012)), Vector((0, 0, -HL))], [0.014, 0.015], WRAP, nseg=8))
for k in range(5):
    z = -0.025 - k * (HL - 0.03) / 5
    parts.append(sweep("ridge", [Vector((0, 0, z)), Vector((0, 0, z - 0.008))], [0.0165, 0.0165], WRAP, nseg=8))
parts.append(sweep("pommel", [Vector((0, 0, -HL)), Vector((0, 0, -HL - 0.012)), Vector((0, 0, -HL - 0.04))],
                   [0.017, 0.016, 0.0], CAP, nseg=8))
ob = join(parts, "Sai")
ob.data.transform(Matrix.Translation((0, 0, HL * 0.5))); ob.data.update()  # origin = grip centre
fit_weapon(ob, 30, 248, 145)   # card: shaft rises ~30 deg, bbox 248 x 145 px
finish(ob, OUT, 35)
