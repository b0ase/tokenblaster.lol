# Small Horns (09_003): a pair of glossy black ram horns on top of the head. Each horn rises from a
# fat root at the crown into a rounded crest, then coils outward, back and down (ridged underside)
# and hooks up to a sharp tip; a small claw horn stands beside the inner root.
# Built off the card: each horn is a tube swept along a centreline traced on the card (card px), and
# the tube radius at every station is the card's distance from that point to the horn outline, so the
# front silhouette follows the card (K m per px, origin = card face centre). The coil swings back
# so it reads as a coiled horn, not a dome, from 3/4 and side. Blender -b -P small_horns.py
import bpy, math, os, sys
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hm_common import K, CARDS, mat, out_path, join, finish, card_alpha, components, trace, resample, sweep, px2m

OUT = out_path("09_003_small_horns")
bpy.ops.wm.read_factory_settings(use_empty=True)
CARD = CARDS + "/09-Horns/09_003_Horns_Small.png"
AL = card_alpha(CARD)
BLACK = mat("black", "0d0c10", 0.12)
RIB = mat("rib", "3b3944", 0.4)
XC = 479.5                     # card mirror axis (bbox centre)

# outlines of the card pieces (for the radius fit)
OUTL = [resample(trace(m), 2.0) for m in components(AL)]
def dist(x, y):
    p = np.array([x, y])
    return min(np.sqrt(((o - p) ** 2).sum(1)).min() for o in OUTL)

def catmull(pts, n):
    P = [Vector(p) for p in pts]; P = [P[0]] + P + [P[-1]]; out = []
    for i in range(1, len(P) - 2):
        for k in range(n):
            t = k / n
            a, b, c, d = P[i - 1], P[i], P[i + 1], P[i + 2]
            out.append(0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3))
    out.append(P[-2]); return out

# left horn centreline (card x, card y, depth px: + = back). Right horn = mirror about XC.
# crest: fat root at the crown, up into the glossy crest and down its outer side
HORN = [(410, 556, -10), (398, 520, -8), (378, 488, -4), (355, 470, 2), (331, 481, 10), (319, 504, 18),
        (322, 526, 24), (340, 532, 28)]
# coil: ridged, runs out along the bottom behind the crest and hooks up to the tip
COIL = [(396, 540, 26), (370, 534, 30), (340, 534, 32), (308, 538, 26), (284, 532, 16), (270, 518, 6),
        (263, 498, -2), (262, 476, -6)]
FANG = [(448, 558, -10), (447, 530, -10), (446, 500, -8), (441, 476, -4)]
BEND = 0.9

def build(cl, side, nsub, rmax, rtip, squash, material, ribs=(), fit=1.04, pointed=True, fit_mode="dist"):
    pts = catmull([(x if side < 0 else 2 * XC - x, y, d) for x, y, d in cl], nsub)
    C, R = [], []
    for k, p in enumerate(pts):
        a, b = pts[max(k - 1, 0)], pts[min(k + 1, len(pts) - 1)]
        t = Vector((b.x - a.x, b.y - a.y)).normalized(); n = Vector((-t.y, t.x))
        def ray(sg):   # card px to the outline along +-n (capped)
            d = 0.0
            while d < rmax:
                x, y = p.x + n.x * sg * (d + 0.5), p.y + n.y * sg * (d + 0.5)
                if not (0 <= int(y) < AL.shape[0] and 0 <= int(x) < AL.shape[1]) or not AL[int(y), int(x)]: break
                d += 0.5
            return d
        dl, dr = ray(-1), ray(1)
        if fit_mode == "ray":
            r = (dl + dr) / 2 * fit; sh = (dr - dl) / 2
        else:
            r = min(dist(p.x, p.y) * fit + 1.5, rmax); sh = 0.0
        X, Z = px2m(p.x + n.x * sh, p.y + n.y * sh)
        C.append(Vector((X, p.z * K + BEND * X * X, Z)))
        R.append(r * K)
    if pointed:
        R[-1] = 0.0
        R[-2] = min(R[-2], rtip * K)
    out = [sweep("horn", C, R, material, nseg=10, squash=squash)]
    for k in ribs:   # proud ridge rings on the coil
        a = C[k]; b = C[k] + (C[k + 1] - C[k]) * 0.35
        out.append(sweep("rib", [a, b], [R[k] * 1.05, R[k] * 1.05], RIB, nseg=10, squash=squash))
    return out

parts = []
for s in (-1, 1):
    parts += build(HORN, s, 4, 62, 40, 0.62, BLACK, pointed=False)
    parts += build(COIL, s, 4, 34, 4, 0.65, BLACK, ribs=(3, 5, 7, 9, 11, 13, 15, 17))
    parts += build(FANG, s, 3, 26, 2, 0.5, BLACK, fit=1.0, fit_mode="ray")
ob = join(parts, "SmallHorns")
finish(ob, OUT, 50)
