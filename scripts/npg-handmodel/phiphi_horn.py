# Phi-Phi horn (09_001): a pink armoured cone HELMET worn over the head, built straight off the card.
#   Blender -b -P phiphi_horn.py
# The front silhouette is taken row by row from the card alpha (K m per px, origin = card face
# centre), so the helmet matches the card in the front view; every row is an ellipse (depth = D x
# width) so it is round in 3/4, side and back.
#   navy ribbed core  -> the cone, recessed under the bands (eye slots, gap between bands)
#   band A            -> upper band, pink over hot-pink, round the whole cone
#   brow band + rim   -> the big pink mask: full band above the eyes, eye slots cut either side of a
#                        central nose plate, rim band round the bottom, pointed chin tab at the front
#   brow plates       -> hot-pink plates sloping down to the nose plate over each eye slot
#   tip               -> curled pink horn on top, leaning to viewer's left
#   rivets            -> red studs down the nose plate, on band A and on the tip
# Blender Z-up, front = -Y (glTF Y-up, front +Z).
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hm_common import K, CARDS, mat, out_path, new_obj, bevel, join, finish, card_alpha, px2m

OUT = out_path("09_001_phiphi_horn")
bpy.ops.wm.read_factory_settings(use_empty=True)
CARD = CARDS + "/09-Horns/09_001_Horns_Phi-Phi-Horn.png"
AL = card_alpha(CARD)

PINK = mat("pink", "f590b4", 0.35)
HOT = mat("hotpink", "e0245f", 0.35)
NAVY = mat("navy", "2e2f56", 0.5)
RED = mat("rivet", "d0182a", 0.25)

D = 0.95          # depth / width of every ring (round helmet; head is 0.31 w x 0.30 d)
SH = 6            # shell (band) thickness, card px
Y_TIP, Y_CORE0, Y_CORE1, Y_RIM1, Y_CHIN = 158, 262, 616, 618, 695

# ---- outer profile: per card row, left/right edge (smoothed) ----
rows = {}
for y in range(150, 700):
    xs = np.nonzero(AL[y])[0]
    if len(xs): rows[y] = (float(xs.min()), float(xs.max() + 1))
def edges(y):
    y = min(max(int(round(y)), Y_TIP), Y_CHIN)
    ks = [rows[k] for k in range(y - 2, y + 3) if k in rows]
    return float(np.median([k[0] for k in ks])), float(np.median([k[1] for k in ks]))

def ring_par(y, inset=0.0):
    """(cx, a, b, z) in metres for card row y, shrunk by `inset` px all round."""
    l, r = edges(y)
    cx = (l + r) / 2
    a = max((r - l) / 2 - inset, 0.5)
    x, z = px2m(cx, y)
    return x, a * K, a * K * D, z

def P(y, th, inset=0.0):
    cx, a, b, z = ring_par(y, inset)
    return Vector((cx + a * math.cos(th), b * math.sin(th), z))

def x2th(y, xpx, inset=0.0, front=True):
    """Angle of the ring point at card x on the front (or back) of row y."""
    l, r = edges(y)
    cx, a = (l + r) / 2, (r - l) / 2 - inset
    c = max(-1.0, min(1.0, (xpx - cx) / a))
    t = math.acos(c)
    return -t if front else t   # front half: sin < 0 (-Y)

def loft(name, ys, material, inset_fn, nseg=24, cap_top=None, cap_bot=True):
    bm = bmesh.new(); R = []
    for y in ys:
        # every other column sunk 2.5 px: the card's vertical rib grooves on the navy cone
        R.append([bm.verts.new(P(y, 2 * math.pi * i / nseg, inset_fn(y) + (2.5 if i % 2 else 0.0))) for i in range(nseg)])
    for A, B in zip(R, R[1:]):
        for i in range(nseg):
            i2 = (i + 1) % nseg
            bm.faces.new((A[i], A[i2], B[i2], B[i]))
    if cap_top is not None:
        apex = bm.verts.new(cap_top)
        for i in range(nseg): bm.faces.new((R[0][(i + 1) % nseg], R[0][i], apex))
    if cap_bot: bm.faces.new(R[-1])
    return new_obj(name, bm, material)

def patch(name, grid, material, inset_out=0.0, thick=SH, wrap=False):
    """Thick shell over the profile. grid[j][i] = (y_px, theta); outer surface at inset_out px,
    inner surface `thick` px further in."""
    bm = bmesh.new()
    O = [[bm.verts.new(P(y, th, inset_out)) for y, th in row] for row in grid]
    I = [[bm.verts.new(P(y, th, inset_out + thick)) for y, th in row] for row in grid]
    nj, ni = len(grid), len(grid[0])
    cols = range(ni) if wrap else range(ni - 1)
    for j in range(nj - 1):
        for i in cols:
            i2 = (i + 1) % ni
            bm.faces.new((O[j][i], O[j][i2], O[j + 1][i2], O[j + 1][i]))
            bm.faces.new((I[j][i], I[j + 1][i], I[j + 1][i2], I[j][i2]))
    for i in cols:
        i2 = (i + 1) % ni
        bm.faces.new((O[0][i2], O[0][i], I[0][i], I[0][i2]))
        bm.faces.new((O[-1][i], O[-1][i2], I[-1][i2], I[-1][i]))
    if not wrap:
        for j in range(nj - 1):
            bm.faces.new((O[j][0], O[j + 1][0], I[j + 1][0], I[j][0]))
            bm.faces.new((O[j + 1][-1], O[j][-1], I[j][-1], I[j + 1][-1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_obj(name, bm, material)
    if not wrap: bevel(ob, 0.0012, 1, 40)
    return ob

def band_grid(y0, y1, nrow=2, nseg=20):
    return [[(y0 + (y1 - y0) * j / nrow, 2 * math.pi * i / nseg) for i in range(nseg)] for j in range(nrow + 1)]

def arc_grid(y0, y1, th_fn0, th_fn1, nrow=3, ncol=6):
    """Rows y0..y1, columns between angles th_fn0(y)..th_fn1(y)."""
    g = []
    for j in range(nrow + 1):
        y = y0 + (y1 - y0) * j / nrow
        t0, t1 = th_fn0(y), th_fn1(y)
        g.append([(y, t0 + (t1 - t0) * i / ncol) for i in range(ncol + 1)])
    return g

parts = []
# ---- band rows (card px). Bands overhang the navy core by SH px.
BA = (310, 364)            # band A: pink upper half, hot-pink lower half
BB = (436, 480)            # brow band (full ring above the eye slots)
SL = (480, 560)            # eye-slot rows
RIM = (560, Y_RIM1)        # rim band: pink upper, hot-pink lower
PL = (446, 528)            # nose plate edges (card x) between the slots
def in_band(y): return any(a - 1 <= y <= b + 1 for a, b in (BA, (BB[0], RIM[1])))

# navy core: card rows, inset under the bands so the bands sit proud of it; vertical rib grooves
core_ys = [Y_CORE0 + (Y_CORE1 - Y_CORE0) * (k / 16) ** 0.85 for k in range(17)]
core = loft("core", core_ys, NAVY, lambda y: SH if in_band(y) else 0.0, nseg=20,
            cap_top=Vector((ring_par(Y_CORE0)[0], 0, px2m(0, Y_CORE0 - 6)[1])))
parts.append(core)

# band A
parts.append(patch("bandA_hi", band_grid(BA[0], 337, 1), PINK, 0.0, SH, True))
parts.append(patch("bandA_lo", band_grid(337, BA[1], 1), HOT, 0.0, SH, True))
# brow band (full ring), then slot rows: nose plate at front + the back half
parts.append(patch("brow", band_grid(BB[0], BB[1], 1), PINK, 0.0, SH, True))
thL = lambda y: x2th(y, PL[0]); thR = lambda y: x2th(y, PL[1])
parts.append(patch("noseplate", arc_grid(SL[0] - 2, SL[1] + 2, thL, thR, 3, 4), PINK))
parts.append(patch("slotback", arc_grid(SL[0] - 2, SL[1] + 2, lambda y: -0.15, lambda y: math.pi + 0.15, 3, 14), PINK))
# rim band (pink over hot pink)
parts.append(patch("rim_hi", band_grid(RIM[0], 596, 1), PINK, 0.0, SH, True))
parts.append(patch("rim_lo", band_grid(596, RIM[1], 1), HOT, 0.0, SH, True))

# chin tab: front rows below the rim, x extents straight from the card, curving with the rim
def tab_P(y, xpx, inset):
    cx, a, b, z0 = ring_par(Y_CORE1, inset)   # the rim ring, continued down
    X = (xpx - FACE_X) * K
    c = max(-1.0, min(1.0, (X - cx) / a))
    return Vector((X, -b * math.sqrt(1 - c * c), px2m(0, y)[1]))
FACE_X = 484.5
bm = bmesh.new(); NJ, NI = 7, 8
tO, tI = [], []
for j in range(NJ + 1):
    y = Y_RIM1 - 8 + (Y_CHIN - (Y_RIM1 - 8)) * (j / NJ) ** 0.9
    l, r = rows[min(int(y), Y_CHIN)]
    l, r = max(l, 392), min(r, 580)
    if j == NJ: l = r = (l + r) / 2
    tO.append([bm.verts.new(tab_P(y, l + (r - l) * i / NI, 0)) for i in range(NI + 1)])
    tI.append([bm.verts.new(tab_P(y, l + (r - l) * i / NI, SH)) for i in range(NI + 1)])
for j in range(NJ):
    for i in range(NI):
        for A, sgn in ((tO, 1), (tI, -1)):
            q = (A[j][i], A[j][i + 1], A[j + 1][i + 1], A[j + 1][i])
            try: bm.faces.new(q if sgn > 0 else q[::-1])
            except ValueError: pass
for j in range(NJ):
    for A, B, i in ((tO, tI, 0), (tO, tI, NI)):
        try: bm.faces.new((A[j][i], A[j + 1][i], B[j + 1][i], B[j][i]))
        except ValueError: pass
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
tab = new_obj("chintab", bm, PINK); bevel(tab, 0.0012, 1, 40); parts.append(tab)
# hot-pink edge strip along the tab's lower sides (the card's two-tone rim continues round the tab)

# brow plates: hot-pink slabs over the top of each slot, sloping down toward the nose plate
def brow_plate(name, x0, x1, ytop0, ytop1, h):
    g = []
    for j in range(3):
        row = []
        for i in range(7):
            x = x0 + (x1 - x0) * i / 6
            yt = ytop0 + (ytop1 - ytop0) * i / 6
            y = yt + h * j / 2
            row.append((y, x2th(y, x)))
        g.append(row)
    return patch(name, g, HOT, -4.0, 7.0)
parts.append(brow_plate("browL", 326, PL[0] + 4, 400, 482, 56))
parts.append(brow_plate("browR", PL[1] - 4, 652, 480, 468, 42))

# tip: loft of the card rows above the cone, apex at the top
tip_ys = [Y_TIP + 2 + (Y_CORE0 + 6 - Y_TIP - 2) * (k / 9) ** 1.1 for k in range(10)]
l0, r0 = rows[Y_TIP + 1]
apex = Vector((px2m((l0 + r0) / 2, Y_TIP)[0], 0, px2m(0, Y_TIP)[1]))
bm = bmesh.new(); R = []; NS = 12
for y in tip_ys:
    cx, a, b, z = ring_par(y)
    b = a * 0.75
    R.append([bm.verts.new(Vector((cx + a * math.cos(2 * math.pi * i / NS), b * math.sin(2 * math.pi * i / NS), z))) for i in range(NS)])
for A, B in zip(R, R[1:]):
    for i in range(NS): bm.faces.new((A[i], A[(i + 1) % NS], B[(i + 1) % NS], B[i]))
av = bm.verts.new(apex)
for i in range(NS): bm.faces.new((R[0][(i + 1) % NS], R[0][i], av))
bm.faces.new(R[-1])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
tip = new_obj("tip", bm, PINK); parts.append(tip)
# hot-pink collar where the tip meets the cone
parts.append(patch("tipcollar", band_grid(Y_CORE0 - 4, Y_CORE0 + 6, 1, 16), HOT, -1.0, 4, True))

# rivets
def rivet(xpx, ypx, r=0.0068):
    th = x2th(ypx, xpx)
    p = P(ypx, th, -1.0)
    n = Vector((math.cos(th), math.sin(th) / D, 0)).normalized()
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=3, radius=r)
    for v in bm.verts: v.co.z *= 0.5
    ob = new_obj("rivet", bm, RED)
    ob.location = p
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(n)
    parts.append(ob)
for x, y in ((495, 463), (484, 514), (481, 567), (480, 613), (536, 333)):
    rivet(x, y)
# tip rivet on the tip's front face
cx, a, b, z = ring_par(225)
bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=3, radius=0.0062)
for v in bm.verts: v.co.z *= 0.5
ob = new_obj("rivet", bm, RED); ob.location = (px2m(541, 225)[0], -a * 0.75 + 0.001, z)
ob.rotation_euler = (math.radians(90), 0, 0); parts.append(ob)

horn = join(parts, "PhiPhiHorn")
finish(horn, OUT, 40)
