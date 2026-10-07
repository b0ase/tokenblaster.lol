# Small Horns (09_003): a pair of glossy black ram horns sitting on top of the head, each curling
# up from the crown, over and down to an outward-flicked tip, with ridged rings and a small fang
# horn under the inner end. Blender -b -P small_horns.py. Origin = card face centre.
import bpy, math, os, sys
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hm_common import mat, out_path, sweep, join, place_to_card, finish

OUT = out_path("09_003_small_horns")
bpy.ops.wm.read_factory_settings(use_empty=True)
BLACK = mat("black", "0e0d11", 0.15)
RIB = mat("rib", "2c2a33", 0.4)

def cubic(p0, p1, p2, p3, n):
    out = []
    for i in range(n + 1):
        t = i / n
        out.append((1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3)
    return out

parts = []
N = 14
for s in (-1, 1):
    # fat root by the middle, bulging up into a dome, down the outside and hooking up at the tip
    c = cubic(Vector((0.23 * s, 0.00, 0.0)), Vector((0.20 * s, -0.02, 0.31)),
              Vector((0.40 * s, 0.05, 0.22)), Vector((0.43 * s, 0.07, 0.04)), N)
    c += [Vector((0.46 * s, 0.08, 0.015)), Vector((0.50 * s, 0.08, 0.05)), Vector((0.505 * s, 0.07, 0.12))]
    r = [0.10 * (1 - i / (N + 2)) ** 0.8 + 0.006 for i in range(N + 1)] + [0.022, 0.014, 0.0]
    parts.append(sweep("horn", c, r, BLACK, nseg=10, squash=0.85))
    # ridge rings near the root (ram-horn ridges), slightly proud
    for k in (9, 11):
        a, b = c[k], c[k] + (c[k + 1] - c[k]) * 0.3
        parts.append(sweep("rib", [a, b], [r[k] * 1.04, r[k] * 1.04], RIB, nseg=10, squash=0.85))
    # small claw horn standing at the inner edge, curving up and outward
    f = cubic(Vector((0.10 * s, -0.04, 0.0)), Vector((0.08 * s, -0.04, 0.07)),
              Vector((0.085 * s, -0.04, 0.13)), Vector((0.11 * s, -0.03, 0.18)), 5)
    parts.append(sweep("fang", f, [0.032 * (1 - i / 5) ** 0.8 for i in range(6)], BLACK, nseg=6, squash=0.7))
ob = join(parts, "SmallHorns")
place_to_card(ob, (257, 434, 702, 562))
finish(ob, OUT, 40)
