# Black Axe (07_004): short dark iron haft with a spike end, broad grey bearded blade with a bright
# steel cutting edge and a thin orange edge line. The card hangs it head-down from the hand.
# Blender -b -P black_axe.py. Weapon frame: haft along +Z, origin = grip, blade on +X.
import bpy, os, sys
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hm_common import mat, out_path, sweep, slab, bevel, join, fit_weapon, finish

OUT = out_path("07_004_black_axe")
bpy.ops.wm.read_factory_settings(use_empty=True)
IRON = mat("iron", "2b2b33", 0.4, 0.5)
BLADE = mat("blade", "6f7376", 0.3, 0.8)
EDGE = mat("edge", "dfe3e6", 0.2, 0.9)
ORANGE = mat("orange", "f08a2a", 0.4)

parts = []
haft = sweep("haft", [Vector((0, 0, -0.005)), Vector((0, 0, 0.215))], [0.0085, 0.0095], IRON, nseg=6)
bevel(haft, 0.0015); parts.append(haft)
parts.append(sweep("spike", [Vector((0, 0, 0.215)), Vector((0, 0, 0.235)), Vector((0, 0, 0.262))], [0.011, 0.008, 0.0], IRON, nseg=4, squash=0.7))
parts.append(sweep("butt", [Vector((0, 0, -0.015)), Vector((0, 0, -0.005))], [0.011, 0.011], IRON, nseg=6))
O = [(0.0, 0.118), (0.035, 0.122), (0.07, 0.10), (0.093, 0.082), (0.104, 0.11), (0.108, 0.145), (0.104, 0.18),
     (0.094, 0.212), (0.07, 0.205), (0.04, 0.195), (0.0, 0.198)]
X = 1.4
O = [(x * X, z) for x, z in O]
bl = slab("blade", O, 0.012, BLADE); bevel(bl, 0.003, 1, 30); parts.append(bl)
EDG0 = [(0.093, 0.082), (0.104, 0.11), (0.108, 0.145), (0.104, 0.18), (0.094, 0.212), (0.084, 0.208),
       (0.093, 0.178), (0.096, 0.145), (0.092, 0.112), (0.086, 0.09)]
EDG = [(x * X, z) for x, z in EDG0]
parts.append(slab("edge", EDG, 0.0135, EDGE))
ORL0 = [(0.086, 0.09), (0.092, 0.112), (0.096, 0.145), (0.093, 0.178), (0.084, 0.208),
       (0.079, 0.206), (0.088, 0.178), (0.091, 0.145), (0.087, 0.114), (0.081, 0.094)]
ORL = [(x * X - 0.002, z) for x, z in ORL0]
parts.append(slab("orange", ORL, 0.0128, ORANGE))
parts.append(sweep("socket", [Vector((0, 0, 0.11)), Vector((0, 0, 0.205))], [0.013, 0.013], IRON, nseg=6))
ob = join(parts, "BlackAxe")
fit_weapon(ob, -65, 151, 215)   # card: hangs head-down, axis falls ~65 deg to the right; bbox 151 x 215 px
finish(ob, OUT, 30)
