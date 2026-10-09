# Mohawk hair (10_017): a hot-pink flame crest. From the front the card is a flame bulb of ~8 big
# pointed locks rising off the forehead (tallest just left of centre, outer ones curling out low);
# on the 3D head it continues as a mohawk ridge over the crown to the nape, tips sweeping back.
# Built as stylised anime hair: a scalp strip (seats the crest, fills gaps between roots) plus
# individual locks, each a cubic-Bezier centreline lofted with a lens section (sharp side edges for
# ink/rim, broad faces), bulging then tapering to a point. Roots are ray-cast onto the real chibi head.
# Per-vertex colour "Color" carries (t along the lock, across-lock position, lock random) for the
# hair style in card_bake.py (dark roots, highlight streaks along the locks).
# Origin = card face centre (hand-built convention). Blender -b -P hair_mohawk.py [-- out.glb]
import bpy, bmesh, math, os, sys, random
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hm_common import K, mat, out_path, finish, front_measure

OUT = out_path("10_017_mohawk_hair")
CHIBI = "/Volumes/2026/Projects/ninja-punk-girls-com/public/3D_assets/chibi_cyberpunk_final.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)

# --- the chibi head, moved so the face anchor (head centre x/y, mask centre z) is the origin ---
bpy.ops.import_scene.gltf(filepath=CHIBI)
dg = bpy.context.evaluated_depsgraph_get()
def world_pts(o):
    e = o.evaluated_get(dg); m = e.to_mesh()
    return [o.matrix_world @ v.co for v in m.vertices], [tuple(p.vertices) for p in m.polygons]
obs = {o.name: o for o in bpy.context.scene.objects}
hp, hf = world_pts(obs["head"]); mp, _ = world_pts(obs["mask"])
anc = Vector(((min(p.x for p in hp) + max(p.x for p in hp)) / 2, (min(p.y for p in hp) + max(p.y for p in hp)) / 2,
              (min(p.z for p in mp) + max(p.z for p in mp)) / 2))
HEAD = BVHTree.FromPolygons([p - anc for p in hp], hf)
for o in list(bpy.context.scene.objects): bpy.data.objects.remove(o, do_unlink=True)
HC = Vector((0, 0.0, 0.10))           # head sphere centre (approx), r ~0.155

def scalp(d, sink=0.008):
    """Point on the real head surface along direction d from the head centre, sunk `sink` m in."""
    d = Vector(d).normalized()
    hit = HEAD.ray_cast(HC + d * 0.4, -d)
    if hit[0] is None: return HC + d * 0.155, d
    n = hit[1] if hit[1].dot(d) > 0 else -hit[1]
    return hit[0] - n * sink, n

def ridge_dir(theta_deg, s):
    """Direction from head centre: theta from the top in the YZ plane (+ = toward the face, -Y), s = sideways."""
    t = math.radians(theta_deg)
    return Vector((s, -math.sin(t), math.cos(t)))

COLS = {
    "hair_pink": "ff2e98", "hair_light": "ff62b4", "hair_dark": "b0086c", "hair_hot": "e8147e",
    "scalp_base": "8a0656",
}
M = {k: mat(k, v, 0.5) for k, v in COLS.items()}
MI = {k: i for i, k in enumerate(COLS)}

bm = bmesh.new()
col = bm.loops.layers.float_color.new("Color")
mati = []

def px(xp, yp):  # card px -> (x, z) metres about the face centre
    return (xp - 484.5) * K, (669.5 - yp) * K

def bez(P, t):
    a, b, c, d = P
    u = 1 - t
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d

def lock(root_dir, tip, width, mname, thin=None, lift=0.45, curl=Vector((0, 0, 0)), th=0.38, n=10, seg=8, rnd=None):
    """One lock: root on the scalp along root_dir, tip (Vector), max width (m). thin: the thin-section
    axis (default: scalp normal); lift: how far the root shoots out along the normal (x length)."""
    R, nrm = scalp(root_dir)
    T = Vector(tip)
    L = (T - R).length
    P = (R, R + nrm * L * lift, T - Vector((0, 0, L * 0.28)) + curl, T)
    rnd = random.random() if rnd is None else rnd
    rings = []
    for k in range(n + 1):
        t = k / n
        c = bez(P, t)
        tg = (bez(P, min(t + 0.02, 1)) - bez(P, max(t - 0.02, 0))).normalized()
        ax = (thin or nrm) - tg * (thin or nrm).dot(tg)
        ax.normalize(); side = tg.cross(ax).normalized()
        # flame profile: full at the root, a bulge a third up, sharp point
        w = width * (0.72 + 0.45 * math.sin(math.pi * min(t / 0.75, 1) * 0.9)) * (1 - t) ** 0.85 / 1.0
        if k == n:
            rings.append([(bm.verts.new(c), 1.0, 0.5)]); continue
        ring = []
        for i in range(seg):
            ph = 2 * math.pi * i / seg
            cx = math.cos(ph); sy = math.sin(ph)
            v = bm.verts.new(c + side * cx * w * 0.5 + ax * sy * w * 0.5 * th * (1 - 0.35 * cx * cx))
            ring.append((v, t, (cx + 1) / 2 if sy >= 0 else (cx + 1) / 2))
        rings.append(ring)
    def face(vs):
        f = bm.faces.new([v[0] for v in vs]); f.material_index = MI[mname]
        for lp, v in zip(f.loops, vs): lp[col] = (v[1], v[2], rnd, 1.0)
    for A, B in zip(rings, rings[1:]):
        for i in range(seg):
            i2 = (i + 1) % seg
            if len(B) == 1: face((A[i], A[i2], B[0]))
            else: face((A[i], A[i2], B[i2], B[i]))
    face(list(reversed(rings[0])))

random.seed(17)
TOPZ = 0.2565
# ---- front group: the flame bulb as the card draws it (tips straight off the card) ----
# (root theta, root side, tip card px x, y, tip depth y m, width m, material)
FRONT = [
    (36, 0.00, 467, 262, -0.03, 0.105, "hair_pink"),      # tallest centre blade
    (34, 0.16, 497, 282, -0.02, 0.085, "hair_light"),
    (36, -0.18, 436, 310, -0.03, 0.085, "hair_light"),
    (42, -0.34, 404, 356, -0.05, 0.065, "hair_hot"),
    (42, 0.34, 545, 357, -0.05, 0.062, "hair_hot"),
    (52, -0.04, 470, 330, -0.085, 0.10, "hair_dark"),      # dark front blade over the base
]
for th_, s, xp, yp, ty, w, mn in FRONT:
    x, z = px(xp, yp)
    sx = 1 if x > 0 else -1
    lock(ridge_dir(th_, s), (x, ty, z), w, mn, lift=0.4, curl=Vector((sx * 0.012 * abs(s) * 3, 0, 0)))
# ---- the ridge over the crown: centre spike + two splayed side locks per station, tips sweeping back ----
STATIONS = [(12, 0.43, 0.03), (-14, 0.39, 0.06), (-38, 0.32, 0.08), (-60, 0.24, 0.09)]
for th_, tz, back in STATIONS:
    R, _ = scalp(ridge_dir(th_, 0))
    lock(ridge_dir(th_, 0), (R.x - 0.01, R.y + back, tz), 0.11, "hair_pink",
         thin=Vector((1, 0, 0)), lift=0.35, th=0.42)
    for sx in ((-1, 1) if th_ > -30 else ()):
        x, _ = px(475 + sx * 74, 0)
        lock(ridge_dir(th_ + 4, sx * 0.30), (x * 0.95, R.y + back * 0.7, tz - 0.09), 0.075,
             "hair_light" if sx < 0 else "hair_hot", thin=Vector((sx, 0, 0.3)), lift=0.35, th=0.42)

# ---- scalp strip: a band of the head surface under the crest, 4 mm proud ----
NS, NT = 7, 22
grid = []
for j in range(NT + 1):
    th_ = 50 - 105 * j / NT
    row = []
    for i in range(NS + 1):
        s = (-1 + 2 * i / NS) * 0.30
        p, nn = scalp(ridge_dir(th_, s), sink=-0.003)
        row.append(bm.verts.new(p))
    grid.append(row)
for j in range(NT):
    for i in range(NS):
        f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i])); f.material_index = MI["scalp_base"]
        for lp in f.loops: lp[col] = (0.0, 0.5, 0.5, 1.0)

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
me = bpy.data.meshes.new("mohawk"); bm.to_mesh(me); bm.free()
ob = bpy.data.objects.new("mohawk", me); bpy.context.collection.objects.link(ob)
for k in COLS: me.materials.append(M[k])
fm = front_measure(ob)
print(f"MEASURE front {fm['w']:.3f}x{fm['h']:.3f} h/w {fm['h/w']:.3f} | card {170 * K:.3f}x{231 * K:.3f} h/w {231 / 170:.3f}")
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))
print("TRIS", sum(len(p.vertices) - 2 for p in me.polygons))
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True,
                          export_vertex_color="ACTIVE")
