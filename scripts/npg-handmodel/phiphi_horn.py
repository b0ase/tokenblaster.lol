# Phi-Phi horn: hand-built procedural armoured crest. Blender 5.x, run:
#   Blender -b -P phiphi_horn.py
# Blender Z-up, front = -Y. Exported glTF is Y-up, front = +Z. Origin = base centre (attach point).
# Proportions: the upper bands + tip are stretched (base width kept) until the front silhouette
# h/w matches the card (363 x 539 px -> 1.485), then the whole crest is sized by K (0.388 wide).
import bpy, bmesh, math, os, sys
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hm_common import K, out_path, front_measure, place_to_card, finish as hm_finish

OUT = out_path("09_001_phiphi_horn")
CARD_W, CARD_HW = 363 * K, 539 / 363
bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name, rgb, rough=0.45, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m

def srgb(h):
    c = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)

PINK = mat("pink", srgb("f27aa3"), 0.35)
HOT = mat("hotpink", srgb("e0245f"), 0.35)
NAVY = mat("navy", srgb("2c2d52"), 0.5)
RED = mat("rivet", srgb("d0182a"), 0.25)

R0, EY, H = 0.100, 0.90, 0.200
FRONT = -math.pi / 2

def radius(z, th, grooves=False):
    if z >= 0:
        r = R0 * max(1 - min(z / H, 1.0) ** 1.7, 0.0) ** 0.85   # full, rounded shoulders
    else:
        r = R0 * (1 - 0.15 * (-z) / H)
    return r

def surf(th, z, off=0.0):
    r = radius(z, th)
    p = Vector((r * math.cos(th), r * EY * math.sin(th), z))
    # outward normal from partial derivatives
    e = 1e-4
    r1 = radius(z + e, th)
    dz = Vector(((r1 - r) / e * math.cos(th), (r1 - r) / e * EY * math.sin(th), 1))
    dth = Vector((-r * math.sin(th), r * EY * math.cos(th), 0))
    n = dth.cross(dz).normalized()
    return p + n * off, n

def new_obj(name, bm, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(material)
    return ob

def shell(name, fn, nu, nv, wrap, off_in, thick, material):
    """Thick panel following the core. fn(u,v)->(theta,z,extra_off). u in [0,1] (wraps if wrap)."""
    bm = bmesh.new()
    cols = nu if wrap else nu + 1
    outer, inner = [], []
    for j in range(nv + 1):
        ro, ri = [], []
        for i in range(cols):
            th, z, eo = fn(i / nu, j / nv)
            pi_, _ = surf(th, z, off_in + eo)
            po, _ = surf(th, z, off_in + eo + thick)
            ro.append(bm.verts.new(po)); ri.append(bm.verts.new(pi_))
        outer.append(ro); inner.append(ri)
    def quad(a, b, c, d): bm.faces.new((a, b, c, d))
    for j in range(nv):
        for i in range(nu if wrap else nu):
            i2 = (i + 1) % cols
            quad(outer[j][i], outer[j][i2], outer[j+1][i2], outer[j+1][i])
            quad(inner[j][i], inner[j+1][i], inner[j+1][i2], inner[j][i2])
    for i in range(nu):
        i2 = (i + 1) % cols
        quad(outer[0][i], inner[0][i], inner[0][i2], outer[0][i2])
        quad(outer[nv][i2], inner[nv][i2], inner[nv][i], outer[nv][i])
    if not wrap:
        for j in range(nv):
            quad(outer[j][0], outer[j+1][0], inner[j+1][0], inner[j][0])
            quad(outer[j+1][nu], outer[j][nu], inner[j][nu], inner[j+1][nu])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj(name, bm, material)

def bevel(ob, w=0.0012, seg=1, ang=35):
    m = ob.modifiers.new("bev", "BEVEL")
    m.width = w; m.segments = seg; m.limit_method = "ANGLE"
    m.angle_limit = math.radians(ang); m.harden_normals = True
    m.miter_outer = "MITER_ARC"

# ---------- navy core (ribbed lathe) ----------
NS, NR = 24, 8
bm = bmesh.new()
rings = []
for j in range(NR + 1):
    z = -0.004 + (H * 0.93 + 0.004) * (j / NR) ** 0.9
    row = []
    for i in range(NS):
        th = 2 * math.pi * i / NS
        groove = 0.97 if i % 3 == 0 else 1.0
        p, _ = surf(th, z)
        row.append(bm.verts.new(Vector((p.x * groove, p.y * groove, z))))
    rings.append(row)
for j in range(NR):
    for i in range(NS):
        a, b = rings[j][i], rings[j][(i + 1) % NS]
        bm.faces.new((a, b, rings[j + 1][(i + 1) % NS], rings[j + 1][i]))
top = bm.verts.new(Vector((0, 0, H * 0.95)))
for i in range(NS):
    bm.faces.new((rings[NR][i], rings[NR][(i + 1) % NS], top))
bm.faces.new(list(reversed(rings[0])))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
core = new_obj("core", bm, NAVY)

parts = [core]

def angdist(th):
    d = (th - FRONT + math.pi) % (2 * math.pi) - math.pi
    return abs(d)

# ---------- bands: conical lamellae, lower edge flares out ----------
def band(name, z0, z1, tilt=0.0, flare=0.006, nu=24, lowfn=None):
    def fn(u, v):
        th = 2 * math.pi * u
        lo = lowfn(th) if lowfn else z0
        t = tilt * math.cos(th)
        z = lo + (z1 - lo) * v + t
        return th, z, flare * (1 - v)
    ob = shell(name, fn, nu, 1, True, 0.002, 0.007, PINK)
    bevel(ob, 0.0012, 2, 60); parts.append(ob); return ob

band("bandA", 0.143, 0.170, tilt=0.003, flare=0.004, nu=24)
band("bandB", 0.084, 0.122, tilt=0.006, flare=0.006, nu=24)
# band C: lower edge rises toward the sides (the "brows" over the eye slits)
band("bandC", 0.034, 0.076, flare=0.008, nu=24,
     lowfn=lambda th: 0.030 + 0.024 * min(1.0, angdist(th) / 1.1) ** 0.8
     if angdist(th) < 1.9 else 0.054)
rim = band("rim", -0.004, 0.014, flare=0.005, nu=24)

# ---------- plates: bevelled, proud, hard-edged panels laid over the bands ----------
def plate(name, th0, th1, zlo0, zlo1, h, off, material, nu=8, thick=0.006):
    """Panel from angle th0 to th1; lower edge slopes zlo0 -> zlo1, height h, sitting `off` proud."""
    def fn(u, v):
        th = th0 + (th1 - th0) * u
        return th, zlo0 + (zlo1 - zlo0) * u + h * v, 0.0
    ob = shell(name, fn, nu, 1, False, off, thick, material)
    bevel(ob, 0.0016, 1, 30); parts.append(ob); return ob

# brow plates over each eye slot: hot pink, sloping down toward the nose strap
plate("browL", FRONT - 1.45, FRONT - 0.50, 0.060, 0.040, 0.022, 0.012, HOT)
plate("browR", FRONT + 0.50, FRONT + 1.45, 0.040, 0.058, 0.019, 0.012, HOT)
# stepped band ends: short overlapping flaps that stand off the ring with an angled cut
plate("flapB", FRONT + 1.05, FRONT + 1.75, 0.080, 0.090, 0.040, 0.011, PINK, nu=5)
plate("flapA", FRONT - 1.65, FRONT - 0.95, 0.146, 0.138, 0.026, 0.010, PINK, nu=5)

# hot-pink trim lip under each band (gives the two-tone banding of the card)
def lip(name, zfn, nu=24, off=0.004):
    def fn(u, v):
        th = 2 * math.pi * u
        return th, zfn(th) - 0.007 + 0.007 * v, off + 0.005 * (1 - v)
    ob = shell(name, fn, nu, 1, True, 0.004, 0.004, HOT)
    parts.append(ob)
lip("lipB", lambda th: 0.084 + 0.006 * math.cos(th), nu=24)
lip("lipA", lambda th: 0.143 + 0.003 * math.cos(th), nu=24)

# ---------- front strap with pointed chin tab ----------
def strap_fn(u, v):
    z = 0.078 - v * (0.078 + 0.042)
    if z >= 0.0:
        half = 0.50 - 0.14 * (z / 0.078)
    else:
        k = -z / 0.042
        half = 0.50 * (1 - k) ** 1.2 + 0.03
    th = FRONT + (u - 0.5) * 2 * half
    return th, z, 0.010
strap = shell("strap", strap_fn, 8, 10, False, 0.004, 0.008, PINK)
bevel(strap, 0.0018, 1, 30)
parts.append(strap)

# ---------- tip: swept curved cone, leans to viewer's left ----------
bm = bmesh.new()
P0, P1, P2 = Vector((0.002, 0, 0.165)), Vector((0.020, 0.004, 0.212)), Vector((-0.022, 0.010, 0.245))
NSEC, NSEG = 9, 12
secs = []
for k in range(NSEC + 1):
    t = k / NSEC
    c = (1 - t) ** 2 * P0 + 2 * (1 - t) * t * P1 + t * t * P2
    tan = (2 * (1 - t) * (P1 - P0) + 2 * t * (P2 - P1)).normalized()
    side = Vector((0, 1, 0)).cross(tan).normalized()
    up = tan.cross(side).normalized()
    rad = 0.030 * (1 - t) ** 0.85 + 0.0008
    row = []
    for i in range(NSEG):
        a = 2 * math.pi * i / NSEG
        row.append(bm.verts.new(c + side * math.cos(a) * rad + up * math.sin(a) * rad * 0.8))
    secs.append(row)
for k in range(NSEC):
    for i in range(NSEG):
        i2 = (i + 1) % NSEG
        bm.faces.new((secs[k][i], secs[k][i2], secs[k + 1][i2], secs[k + 1][i]))
bm.faces.new(list(reversed(secs[0])))
apex = bm.verts.new(P2 + (P2 - P1).normalized() * 0.003)
for i in range(NSEG):
    bm.faces.new((secs[NSEC][i], secs[NSEC][(i + 1) % NSEG], apex))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
tip = new_obj("tip", bm, PINK)
parts.append(tip)
# hot pink collar where tip meets band A
lip("tipcollar", lambda th: 0.172, nu=24, off=0.002)

# ---------- rivets ----------
def rivet(pos, n, r=0.0055):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=6, v_segments=3, radius=r)
    for v in bm.verts:
        v.co.z *= 0.55
    ob = new_obj("rivet", bm, RED)
    ob.location = pos
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(n)
    parts.append(ob)

for z in (0.064, 0.040, 0.016, -0.012):
    p, n = surf(FRONT, z, 0.004 + 0.010 + 0.008)
    rivet(p, n)
for z, off, th in ((0.106, 0.002 + 0.007 + 0.003, FRONT), (0.159, 0.002 + 0.007 + 0.002, FRONT)):
    p, n = surf(th, z + 0.006 * math.cos(th) * 0, off)
    rivet(p, n)
for th in (0.0, math.pi, math.pi / 2):   # side/back rivets on band C
    p, n = surf(th, 0.058, 0.002 + 0.007 + 0.002)
    rivet(p, n, 0.0036)
# tip rivet (front face of tip)
rivet(Vector((0.006, -0.019, 0.195)), Vector((0, -1, 0.15)).normalized(), 0.0038)

# ---------- finish ----------
bpy.ops.object.select_all(action="DESELECT")
for ob in parts:
    ob.select_set(True)
bpy.context.view_layer.objects.active = core
bpy.ops.object.convert(target="MESH")
bpy.ops.object.join()
horn = bpy.context.active_object
horn.name = "PhiPhiHorn"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# stretch everything above the brow band upward (z' = z + (z - Z0) * k), base untouched
Z0 = 0.03; me = horn.data
m = front_measure(horn)
zmax = max(v.co.z for v in me.vertices)
k = 0.5 * (CARD_HW * m["w"] - m["h"]) / (zmax - Z0)   # half the card stretch: less tower
for v in me.vertices:
    if v.co.z > Z0: v.co.z += (v.co.z - Z0) * k
print(f"stretch k={k:.3f}")
# size by K and sit it where the card draws it (origin = card face centre, like every head part;
# the card draws a full helmet, so the Stack Builder's default fit lifts it onto the crown)
place_to_card(horn, (300, 157, 663, 696))
hm_finish(horn, OUT, 40)
