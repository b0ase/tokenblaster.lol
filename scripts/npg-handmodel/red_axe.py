# Red Axe (07_003): long glossy red pole, a crescent blade near the top (convex cutting edge out,
# concave back toward the pole), long spikes off both blade horns, a short spike mid-edge,
# a pole spike on top and a dark pommel. Blender -b -P red_axe.py
# Weapon frame: pole along +Z, origin = grip (hand), blade on +X, flat faces to the camera (-Y).
import bpy, math, os, sys
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hm_common import mat, out_path, sweep, slab, bevel, join, fit_weapon, finish

OUT = out_path("07_003_red_axe")
bpy.ops.wm.read_factory_settings(use_empty=True)
RED = mat("red", "e3141c", 0.28)
DEEP = mat("deep", "9c0b14", 0.35)
EDGE = mat("edge", "ff6b78", 0.3)

parts = []
pole = sweep("pole", [Vector((0, 0, -0.12)), Vector((0, 0, 0.92))], [0.02, 0.018], RED, nseg=8)
parts.append(pole)
parts.append(sweep("pommel", [Vector((0, 0, -0.17)), Vector((0, 0, -0.12))], [0.022, 0.022], DEEP, nseg=8))
parts.append(sweep("cap", [Vector((0, 0, 0.92)), Vector((0, 0, 0.95)), Vector((0, 0, 1.0))], [0.022, 0.014, 0.0], RED, nseg=6))

# crescent: outer arc (cutting edge) minus an offset inner arc, horns reaching back to the pole
C, R = Vector((0.12, 0.56)), 0.36
outer = [(C.x + R * math.cos(a), C.y + R * math.sin(a)) for a in [math.radians(-95 + 190 * i / 16) for i in range(17)]]
Ci, Ri = Vector((0.0, 0.58)), 0.25
inner = [(Ci.x + Ri * math.cos(a), Ci.y + Ri * math.sin(a)) for a in [math.radians(72 - 144 * i / 10) for i in range(11)]]
crescent = outer + inner
blade = slab("blade", crescent, 0.022, RED)
bevel(blade, 0.008, 1, 30); parts.append(blade)
# lighter bevelled edge strip just inside the cutting edge (card's highlight band)
band = [(C.x + (R - 0.004) * math.cos(a), C.y + (R - 0.004) * math.sin(a)) for a in [math.radians(-70 + 140 * i / 12) for i in range(13)]]
band += [(C.x + (R - 0.06) * math.cos(a), C.y + (R - 0.06) * math.sin(a)) for a in [math.radians(70 - 140 * i / 12) for i in range(13)]]
parts.append(slab("edge", band, 0.026, EDGE))
# socket where the blade grips the pole
parts.append(sweep("socket", [Vector((0, 0, 0.84)), Vector((0, 0, 0.92))], [0.03, 0.03], DEEP, nseg=8))
parts.append(slab("tang", [(0.0, 0.20), (0.11, 0.20), (0.11, 0.28), (0.0, 0.28)], 0.018, RED))

def spike(p, d, L, r):
    d = Vector(d).normalized(); p = Vector(p)
    parts.append(sweep("spike", [p, p + d * L * 0.5, p + d * L], [r, r * 0.5, 0.0], RED, nseg=4, squash=0.6))
hx, hz = outer[-1]; lx, lz = outer[0]
spike((lx - 0.02, 0, lz + 0.03), (-1, 0, 0.12), 0.34, 0.034)   # long spike off the lower horn, back across the pole
spike((C.x + R - 0.02, 0, C.y - 0.04), (1, 0, -0.1), 0.29, 0.034)  # long spike off the cutting edge
spike((hx - 0.01, 0, hz - 0.01), (0.35, 0, 1), 0.08, 0.022)    # short spike off the upper horn
parts.append(slab("lower_tang", [(0.0, 0.84), (0.11, 0.86), (0.11, 0.93), (0.0, 0.92)], 0.018, RED))
ob = join(parts, "RedAxe")
fit_weapon(ob, 19, 351, 277)   # card: pole rises ~19 deg, bbox 351 x 277 px
finish(ob, OUT, 30)
