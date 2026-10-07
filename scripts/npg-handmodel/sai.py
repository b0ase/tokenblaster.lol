# Sai (07_008): long pointed steel blade, two flat rose-steel side prongs (yoku) with the card's
# S-curves (the upper one kinks back then flicks up, the lower one sweeps out along the blade and
# down to a hooked tip), a guard collar, dark wrapped handle and a pointed steel pommel.
# Built off the card: every piece is swept along a centreline traced on the card (card px); at each
# station the width is measured across the card silhouette (perpendicular rays), so the front view
# matches the card at K m per px. The card points are then turned into the weapon frame (blade up
# +Z, origin = grip centre, prongs in the XZ plane) by undoing the card's 30 deg tilt.
# Blender -b -P sai.py
import bpy, math, os, sys
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hm_common import K, CARDS, mat, out_path, sweep, join, finish, card_alpha, bevel

OUT = out_path("07_008_sai")
bpy.ops.wm.read_factory_settings(use_empty=True)
AL = card_alpha(CARDS + "/07-Right-Weapon/07_008_Right-Weapon_Sai.png")
STEEL = mat("steel", "d9d2d2", 0.22, 0.85)
ROSE = mat("rose", "b8807c", 0.3, 0.7)
EDGE = mat("edge", "e9a35a", 0.3, 0.6)
WRAP = mat("wrap", "4a1a1e", 0.7)
CAP = mat("cap", "8d8f98", 0.3, 0.8)
TILT = 30.0
GRIP = (630, 936)          # card px: grip centre = weapon origin

def catmull(pts, n):
    P = [Vector(p) for p in pts]; P = [P[0]] + P + [P[-1]]; out = []
    for i in range(1, len(P) - 2):
        for k in range(n):
            t = k / n
            a, b, c, d = P[i - 1], P[i], P[i + 1], P[i + 2]
            out.append(0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3))
    out.append(P[-2]); return out

R_UNTILT = Matrix.Rotation(-math.radians(90 - TILT), 3, "Y")
def to3d(x, y):
    """card px -> weapon frame metres (blade up), origin = grip."""
    v = Vector(((x - GRIP[0]) * K, 0.0, (GRIP[1] - y) * K))
    return R_UNTILT @ v

def ray(p, n, rmax):
    d = 0.0
    while d < rmax:
        x, y = p.x + n.x * (d + 0.5), p.y + n.y * (d + 0.5)
        if not (0 <= int(y) < AL.shape[0] and 0 <= int(x) < AL.shape[1]) or not AL[int(y), int(x)]: break
        d += 0.5
    return d

def piece(name, cl, nsub, rmax, material, nseg=8, squash=0.35, ends=(None, 0.0), rmin=0.0, fit=1.0):
    pts = catmull(cl, nsub)
    C, R = [], []
    for k, p in enumerate(pts):
        a, b = pts[max(k - 1, 0)], pts[min(k + 1, len(pts) - 1)]
        t = Vector((b.x - a.x, b.y - a.y)).normalized(); n = Vector((-t.y, t.x))
        dl, dr = ray(p, -n, rmax), ray(p, n, rmax)
        r = max((dl + dr) / 2 * fit + 0.75, rmin); sh = (dr - dl) / 2
        C.append(to3d(p.x + n.x * sh, p.y + n.y * sh)); R.append(r * K)
    if ends[0] is not None: R[0] = ends[0] * K
    if ends[1] is not None: R[-1] = ends[1] * K
    return sweep(name, C, R, material, nseg=nseg, squash=squash, ref=Vector((0, 1, 0)))

parts = []
# blade: guard to tip, flat diamond
parts.append(piece("blade", [(662, 915), (700, 900), (760, 870), (800, 848), (828, 828)], 3, 22, STEEL, nseg=4,
                     squash=0.45, ends=(None, 0.0)))
# upper prong: up-left off the guard, kinks, then S-curves up to a flicked tip
parts.append(piece("prongU", [(660, 912), (647, 900), (641, 888), (649, 877), (665, 868), (679, 856), (683, 846),
                               (679, 838)], 3, 16, ROSE, nseg=6, squash=0.2, ends=(None, 0.0)))
# lower prong: out along under the blade, bellying down, to a hooked tip
parts.append(piece("prongL", [(662, 927), (678, 938), (700, 945), (725, 945), (750, 938), (772, 932), (796, 932)],
                     3, 18, ROSE, nseg=6, squash=0.2, ends=(None, 0.0)))
# guard collar
parts.append(sweep("collar", [to3d(653, 926), to3d(659, 922)], [0.014, 0.014], CAP, nseg=10))
# tine edge bands: a silver inner edge running along each tine
for nm, cl in (("U", [(658, 910), (646, 899), (643, 888), (650, 878), (664, 869), (677, 857)]),
               ("L", [(664, 924), (680, 933), (702, 939), (726, 939), (750, 933), (770, 929)])):
    pts = catmull(cl, 3)
    parts.append(sweep("edge" + nm, [to3d(p.x, p.y) for p in pts], [3.2 * K] * (len(pts) - 1) + [0.0], EDGE,
                       nseg=6, squash=1.2))
# handle: dark wrap with ridges
hcl = [(653, 928), (638, 936), (620, 944), (605, 950)]
# (the card handle is broken by highlight gaps, so it gets a constant radius instead of a ray fit)
parts.append(sweep("grip", [to3d(x, y) for x, y in hcl], [8.8 * K] * len(hcl), WRAP, nseg=8))
for k in range(4):
    f = 0.15 + 0.22 * k
    x, y = 653 + (605 - 653) * f, 928 + (950 - 928) * f
    x2, y2 = x - 3.2, y + 1.4
    parts.append(sweep("ridge", [to3d(x, y), to3d(x2, y2)], [9.6 * K, 9.6 * K], WRAP, nseg=8))
# pommel: pointed steel cap
parts.append(piece("pommel", [(605, 946), (594, 954), (585, 963), (580, 969)], 2, 12, CAP, nseg=8,
                     squash=0.95, ends=(None, 0.0)))
ob = join(parts, "Sai")
finish(ob, OUT, 35)
