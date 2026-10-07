# Shared helpers for the hand-modelled NPG parts (Blender 5.x).
# Scale rule: every part is authored in chibi model units with ONE factor, K metres per card px
# (see measure_card.py). The card canvas is the whole character, so a part's card pixel size
# times K is its size on the chibi. Blender Z-up, front = -Y (exports glTF Y-up, front = +Z).
import bpy, math, os, sys
from mathutils import Vector, Matrix

K = 0.00107
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
HAND_DIR = os.path.join(REPO, "public", "arena", "models", "npg", "stack", "hand")


def out_path(name):
    """Output GLB: argv after '--' if given, else public/.../stack/hand/<name>.glb."""
    if "--" in sys.argv and len(sys.argv) > sys.argv.index("--") + 1:
        return sys.argv[sys.argv.index("--") + 1]
    os.makedirs(HAND_DIR, exist_ok=True)
    return os.path.join(HAND_DIR, name + ".glb")


def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


def mat(name, hexc, rough=0.45, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(hexc), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return m


def front_xy(ob):
    """Front-view silhouette points (x, z) of a mesh object in world space."""
    return [(ob.matrix_world @ v.co) for v in ob.data.vertices]


def front_measure(ob, axis=None):
    """bbox w,h of the front view, and length/width along `axis` (a 2D unit vector in x,z)."""
    pts = front_xy(ob)
    xs = [p.x for p in pts]; zs = [p.z for p in pts]
    w, h = max(xs) - min(xs), max(zs) - min(zs)
    res = {"w": w, "h": h, "h/w": h / w}
    if axis:
        ax = Vector(axis).normalized(); pe = Vector((-ax.y, ax.x))
        a = [p.x * ax.x + p.z * ax.y for p in pts]; b = [p.x * pe.x + p.z * pe.y for p in pts]
        res.update(L=max(a) - min(a), W=max(b) - min(b), wl=(max(b) - min(b)) / (max(a) - min(a)))
    return res


def scale_about_origin(ob, k):
    ob.data.transform(Matrix.Scale(k, 4))
    ob.data.update()


def finish(ob, out, smooth=40):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth))
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    print("TRIS", ob.name, tris)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True)
    return tris


def join(parts, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


def new_obj(name, bm, material):
    import bmesh
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(material)
    return ob


def bevel(ob, w=0.002, seg=1, ang=35):
    m = ob.modifiers.new("bev", "BEVEL")
    m.width = w; m.segments = seg; m.limit_method = "ANGLE"
    m.angle_limit = math.radians(ang); m.harden_normals = True


def sweep(name, centers, radii, material, nseg=8, squash=1.0, ref=Vector((0, 1, 0)), cap=True, twist=0.0):
    """Tube along a polyline of centres with per-centre radius (0 at the end -> pointed).
    squash scales the section along `ref` (the depth axis); nseg=4 gives a crisp diamond facet."""
    import bmesh
    bm = bmesh.new(); rows = []
    n = len(centers)
    for k, c in enumerate(centers):
        a = centers[max(k - 1, 0)]; b = centers[min(k + 1, n - 1)]
        t = (b - a).normalized()
        side = ref.cross(t)
        if side.length < 1e-6: side = Vector((1, 0, 0)).cross(t)
        side.normalize(); up = t.cross(side).normalized()
        r = radii[k]
        if r <= 1e-6:
            rows.append([bm.verts.new(c)]); continue
        rows.append([bm.verts.new(c + side * math.cos(2 * math.pi * i / nseg + twist) * r
                                  + up * math.sin(2 * math.pi * i / nseg + twist) * r * squash) for i in range(nseg)])
    for A, B in zip(rows, rows[1:]):
        if len(A) == 1 and len(B) == 1: continue
        for i in range(nseg):
            i2 = (i + 1) % nseg
            if len(B) == 1: bm.faces.new((A[i], A[i2], B[0]))
            elif len(A) == 1: bm.faces.new((A[0], B[i2], B[i]))
            else: bm.faces.new((A[i], A[i2], B[i2], B[i]))
    if cap:
        if len(rows[0]) > 1: bm.faces.new(list(reversed(rows[0])))
        if len(rows[-1]) > 1: bm.faces.new(rows[-1])
    return new_obj(name, bm, material)


def slab(name, outline, depth, material, y0=0.0, bend=0.0):
    """Extrude a 2D outline [(x, z), ...] (counter-clockwise seen from the front) to `depth` along Y,
    centred on y0. bend curves it back round a head: y += bend * x^2."""
    import bmesh
    bm = bmesh.new()
    f = [bm.verts.new((x, y0 - depth / 2, z)) for x, z in outline]
    b = [bm.verts.new((x, y0 + depth / 2, z)) for x, z in outline]
    # caps as ear-clipped triangles: correct for concave outlines (hearts, crescents) and stays
    # clean when the slab is bent
    from mathutils.geometry import tessellate_polygon
    tris = tessellate_polygon([[Vector((x, z, 0)) for x, z in outline]])
    for t in tris:
        for ring, flip in ((f, True), (b, False)):
            vs = [ring[i] for i in t]
            try:
                bm.faces.new(vs[::-1] if flip else vs)
            except ValueError:
                pass
    n = len(outline)
    for i in range(n):
        i2 = (i + 1) % n
        bm.faces.new((f[i], f[i2], b[i2], b[i]))
    if bend:
        for v in bm.verts:
            v.co.y += bend * v.co.x * v.co.x
    ob = new_obj(name, bm, material)
    return ob


def place_to_card(ob, bbox_px, face_px=(484.5, 669.5), y=None):
    """Head parts: scale to the card bbox width (x K) and move so the front-view bbox sits where the
    card draws it relative to the face centre (origin = face centre). Prints the h/w match."""
    x0, y0, x1, y1 = bbox_px
    m = front_measure(ob)
    scale_about_origin(ob, (x1 - x0) * K / m["w"])
    pts = front_xy(ob)
    cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
    top = max(p.z for p in pts)
    tx = ((x0 + x1) / 2 - face_px[0]) * K - cx
    tz = (face_px[1] - y0) * K - top
    ob.data.transform(Matrix.Translation((tx, 0, tz))); ob.data.update()
    m = front_measure(ob)
    ch = (y1 - y0) / (x1 - x0)
    print(f"MEASURE model {m['w']:.3f}x{m['h']:.3f} h/w {m['h/w']:.3f} | card {(x1 - x0) * K:.3f}x{(y1 - y0) * K:.3f} "
          f"h/w {ch:.3f} | err {100 * (m['h/w'] / ch - 1):+.1f}%")


def tilted_bbox(ob, angle_deg):
    """Front-view bbox (w, h) of a vertical weapon (axis = +Z, tip up) tilted so its axis rises at
    angle_deg above horizontal toward viewer's right, as the card draws it."""
    R = Matrix.Rotation(math.radians(90 - angle_deg), 3, "Y")
    pts = [R @ (ob.matrix_world @ v.co) for v in ob.data.vertices]
    xs = [p.x for p in pts]; zs = [p.z for p in pts]
    return max(xs) - min(xs), max(zs) - min(zs)


def fit_weapon(ob, angle_deg, card_w_px, card_h_px):
    """Scale a weapon so its tilted front bbox width = card bbox width x K; print the h/w match."""
    w, h = tilted_bbox(ob, angle_deg)
    scale_about_origin(ob, card_w_px * K / w)
    w, h = tilted_bbox(ob, angle_deg)
    cw, ch = card_w_px * K, card_h_px * K
    print(f"MEASURE tilt {angle_deg}: model {w:.3f}x{h:.3f} h/w {h / w:.3f} | card {cw:.3f}x{ch:.3f} "
          f"h/w {ch / cw:.3f} | err {100 * ((h / w) / (ch / cw) - 1):+.1f}%")


CARDS = "/Volumes/2026/Projects/ninja-punk-girls-com/public/assets"
FACE_PX = (484.5, 669.5)


def card_alpha(path, thr=0.5):
    """Card alpha mask as a numpy bool array [row, col], row 0 = top of the card (thr = alpha>128)."""
    import numpy as np
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    a = px.reshape(h, w, 4)[::-1, :, 3] > thr
    bpy.data.images.remove(img)
    return a


def row_extents(alpha, y):
    """(left, right) card px of the alpha row y (right edge exclusive), or None."""
    import numpy as np
    xs = np.nonzero(alpha[int(y)])[0]
    return (float(xs.min()), float(xs.max() + 1)) if len(xs) else None


def px2m(x, y, face=FACE_PX):
    """Card px -> model (x, z) metres, origin = card face centre."""
    return (x - face[0]) * K, (face[1] - y) * K


def components(mask, min_px=30):
    """4-connected components of a bool mask -> list of bool masks (same shape), largest first."""
    import numpy as np
    from collections import deque
    lab = np.zeros(mask.shape, np.int32); n = 0; out = []
    H, W = mask.shape
    for y0, x0 in zip(*np.nonzero(mask)):
        if lab[y0, x0]: continue
        n += 1; q = deque([(y0, x0)]); lab[y0, x0] = n; cnt = 0
        while q:
            y, x = q.popleft(); cnt += 1
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < H and 0 <= xx < W and mask[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n; q.append((yy, xx))
        if cnt >= min_px: out.append(lab == n)
    return sorted(out, key=lambda m: -m.sum())


def trace(mask):
    """Outer boundary of a single-component bool mask (Moore tracing) -> [(x, y)] pixel corners-ish,
    counter-clockwise on screen (y down)."""
    import numpy as np
    ys, xs = np.nonzero(mask)
    i = np.lexsort((xs, ys))[0]
    start = (int(xs[i]), int(ys[i]))
    H, W = mask.shape
    def on(x, y): return 0 <= x < W and 0 <= y < H and mask[y, x]
    nb = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]
    pts = [start]; cur = start; d = 6
    while True:
        for k in range(8):
            dd = (d + 6 + k) % 8   # start looking back-left of the last move
            nx, ny = cur[0] + nb[dd][0], cur[1] + nb[dd][1]
            if on(nx, ny):
                cur = (nx, ny); d = dd; break
        else:
            break
        if cur == start: break
        pts.append(cur)
        if len(pts) > 200000: break
    return pts


def resample(pts, step):
    """Resample a closed polyline to ~step spacing, with a light smoothing pass."""
    import numpy as np
    P = np.array(pts, float)
    P = (np.roll(P, 1, 0) + 2 * P + np.roll(P, -1, 0)) / 4
    seg = np.linalg.norm(np.roll(P, -1, 0) - P, axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]; n = max(int(L / step), 8)
    t = np.linspace(0, L, n, endpoint=False)
    Pc = np.vstack([P, P[:1]])
    return np.stack([np.interp(t, s, Pc[:, 0]), np.interp(t, s, Pc[:, 1])], 1)


def inflate(name, mask, materials, mat_fn=None, step=7.0, grid=12.0, depth=1.0, edge=2.5,
            face=FACE_PX, bend=0.0, power=0.5):
    """Pillow mesh from a card region: outline (resampled every `step` px) + interior points on a
    `grid` px lattice, constrained-Delaunay triangulated; each vertex is pushed forward/back by a round
    profile of its distance d to the outline: h = depth * W * (1 - (1 - d/W)^2)^power + edge px, W = the
    region's max d. Front and back halves share the outline. mat_fn(x_px, y_px) -> material index for
    each front/back face (sampled at the face centre). Coordinates via px2m (origin = card face centre).
    bend: y += bend * x^2 (metres) wraps it back round the head."""
    import bmesh, numpy as np
    from mathutils.geometry import delaunay_2d_cdt
    O = resample(trace(mask), step)
    ys, xs = np.nonzero(mask)
    gx = np.arange(xs.min(), xs.max() + 1, grid); gy = np.arange(ys.min(), ys.max() + 1, grid)
    G = np.array([(x, y) for y in gy for x in gx if mask[int(y), int(x)]], float).reshape(-1, 2)
    def dist(P):
        A = O; B = np.roll(O, -1, 0); AB = B - A
        t = np.clip(((P[:, None, :] - A[None]) * AB[None]).sum(-1) / (AB * AB).sum(-1)[None], 0, 1)
        C = A[None] + t[..., None] * AB[None]
        return np.sqrt(((P[:, None, :] - C) ** 2).sum(-1)).min(1)
    if len(G):
        G = G[dist(G) > step * 0.8]
    pts = [Vector((p[0], p[1])) for p in O] + [Vector((p[0], p[1])) for p in G]
    n = len(O)
    edges = [(i, (i + 1) % n) for i in range(n)]
    vco, eo, fo, _, _, _ = delaunay_2d_cdt(pts, edges, [], 2, 1e-6)
    V = np.array([(v.x, v.y) for v in vco])
    d = dist(V); W = max(d.max(), 1.0)
    u = np.clip(d / W, 0, 1)
    h = (depth * W * np.power(np.clip(1 - (1 - u) ** 2, 0, 1), power) + edge) * K
    bm = bmesh.new()
    F, B = [], []
    for (x, y), hh in zip(V, h):
        X = (x - face[0]) * K; Z = (face[1] - y) * K
        F.append(bm.verts.new((X, -hh + bend * X * X, Z)))
        B.append(bm.verts.new((X, hh + bend * X * X, Z)))
    def fmat(f):
        if mat_fn is None: return 0
        c = V[list(f)].mean(0)
        return mat_fn(c[0], c[1])
    for f in fo:
        mi = fmat(f)
        a = bm.faces.new([F[i] for i in f]); a.material_index = mi
        b = bm.faces.new([B[i] for i in f][::-1]); b.material_index = mi
    # side wall along the open boundary of the sheet (edges used by one face)
    from collections import Counter
    cnt = Counter()
    for f in fo:
        for k in range(len(f)):
            i, j = f[k], f[(k + 1) % len(f)]
            cnt[(min(i, j), max(i, j))] += 1
    for (i, j), c in cnt.items():
        if c == 1:
            fc = bm.faces.new((F[i], F[j], B[j], B[i])); fc.material_index = fmat((i, j))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(material)
    return ob


def bevel(ob, w=0.002, seg=1, ang=35):
    m = ob.modifiers.new("bev", "BEVEL")
    m.width = w; m.segments = seg; m.limit_method = "ANGLE"
    m.angle_limit = math.radians(ang); m.harden_normals = True


def sweep(name, centers, radii, material, nseg=8, squash=1.0, ref=Vector((0, 1, 0)), cap=True, twist=0.0):
    """Tube along a polyline of centres with per-centre radius (0 at the end -> pointed).
    squash scales the section along `ref` (the depth axis); nseg=4 gives a crisp diamond facet."""
    import bmesh
    bm = bmesh.new(); rows = []
    n = len(centers)
    for k, c in enumerate(centers):
        a = centers[max(k - 1, 0)]; b = centers[min(k + 1, n - 1)]
        t = (b - a).normalized()
        side = ref.cross(t)
        if side.length < 1e-6: side = Vector((1, 0, 0)).cross(t)
        side.normalize(); up = t.cross(side).normalized()
        r = radii[k]
        if r <= 1e-6:
            rows.append([bm.verts.new(c)]); continue
        rows.append([bm.verts.new(c + side * math.cos(2 * math.pi * i / nseg + twist) * r
                                  + up * math.sin(2 * math.pi * i / nseg + twist) * r * squash) for i in range(nseg)])
    for A, B in zip(rows, rows[1:]):
        if len(A) == 1 and len(B) == 1: continue
        for i in range(nseg):
            i2 = (i + 1) % nseg
            if len(B) == 1: bm.faces.new((A[i], A[i2], B[0]))
            elif len(A) == 1: bm.faces.new((A[0], B[i2], B[i]))
            else: bm.faces.new((A[i], A[i2], B[i2], B[i]))
    if cap:
        if len(rows[0]) > 1: bm.faces.new(list(reversed(rows[0])))
        if len(rows[-1]) > 1: bm.faces.new(rows[-1])
    return new_obj(name, bm, material)


def slab(name, outline, depth, material, y0=0.0, bend=0.0):
    """Extrude a 2D outline [(x, z), ...] (counter-clockwise seen from the front) to `depth` along Y,
    centred on y0. bend curves it back round a head: y += bend * x^2."""
    import bmesh
    bm = bmesh.new()
    f = [bm.verts.new((x, y0 - depth / 2, z)) for x, z in outline]
    b = [bm.verts.new((x, y0 + depth / 2, z)) for x, z in outline]
    # caps as ear-clipped triangles: correct for concave outlines (hearts, crescents) and stays
    # clean when the slab is bent
    from mathutils.geometry import tessellate_polygon
    tris = tessellate_polygon([[Vector((x, z, 0)) for x, z in outline]])
    for t in tris:
        for ring, flip in ((f, True), (b, False)):
            vs = [ring[i] for i in t]
            try:
                bm.faces.new(vs[::-1] if flip else vs)
            except ValueError:
                pass
    n = len(outline)
    for i in range(n):
        i2 = (i + 1) % n
        bm.faces.new((f[i], f[i2], b[i2], b[i]))
    if bend:
        for v in bm.verts:
            v.co.y += bend * v.co.x * v.co.x
    ob = new_obj(name, bm, material)
    return ob


def place_to_card(ob, bbox_px, face_px=(484.5, 669.5), y=None):
    """Head parts: scale to the card bbox width (x K) and move so the front-view bbox sits where the
    card draws it relative to the face centre (origin = face centre). Prints the h/w match."""
    x0, y0, x1, y1 = bbox_px
    m = front_measure(ob)
    scale_about_origin(ob, (x1 - x0) * K / m["w"])
    pts = front_xy(ob)
    cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
    top = max(p.z for p in pts)
    tx = ((x0 + x1) / 2 - face_px[0]) * K - cx
    tz = (face_px[1] - y0) * K - top
    ob.data.transform(Matrix.Translation((tx, 0, tz))); ob.data.update()
    m = front_measure(ob)
    ch = (y1 - y0) / (x1 - x0)
    print(f"MEASURE model {m['w']:.3f}x{m['h']:.3f} h/w {m['h/w']:.3f} | card {(x1 - x0) * K:.3f}x{(y1 - y0) * K:.3f} "
          f"h/w {ch:.3f} | err {100 * (m['h/w'] / ch - 1):+.1f}%")


def tilted_bbox(ob, angle_deg):
    """Front-view bbox (w, h) of a vertical weapon (axis = +Z, tip up) tilted so its axis rises at
    angle_deg above horizontal toward viewer's right, as the card draws it."""
    R = Matrix.Rotation(math.radians(90 - angle_deg), 3, "Y")
    pts = [R @ (ob.matrix_world @ v.co) for v in ob.data.vertices]
    xs = [p.x for p in pts]; zs = [p.z for p in pts]
    return max(xs) - min(xs), max(zs) - min(zs)


def fit_weapon(ob, angle_deg, card_w_px, card_h_px):
    """Scale a weapon so its tilted front bbox width = card bbox width x K; print the h/w match."""
    w, h = tilted_bbox(ob, angle_deg)
    scale_about_origin(ob, card_w_px * K / w)
    w, h = tilted_bbox(ob, angle_deg)
    cw, ch = card_w_px * K, card_h_px * K
    print(f"MEASURE tilt {angle_deg}: model {w:.3f}x{h:.3f} h/w {h / w:.3f} | card {cw:.3f}x{ch:.3f} "
          f"h/w {ch / cw:.3f} | err {100 * ((h / w) / (ch / cw) - 1):+.1f}%")


CARDS = "/Volumes/2026/Projects/ninja-punk-girls-com/public/assets"
FACE_PX = (484.5, 669.5)


def card_alpha(path, thr=0.5):
    """Card alpha mask as a numpy bool array [row, col], row 0 = top of the card (thr = alpha>128)."""
    import numpy as np
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    a = px.reshape(h, w, 4)[::-1, :, 3] > thr
    bpy.data.images.remove(img)
    return a


def row_extents(alpha, y):
    """(left, right) card px of the alpha row y (right edge exclusive), or None."""
    import numpy as np
    xs = np.nonzero(alpha[int(y)])[0]
    return (float(xs.min()), float(xs.max() + 1)) if len(xs) else None


def px2m(x, y, face=FACE_PX):
    """Card px -> model (x, z) metres, origin = card face centre."""
    return (x - face[0]) * K, (face[1] - y) * K


def components(mask, min_px=30):
    """4-connected components of a bool mask -> list of bool masks (same shape), largest first."""
    import numpy as np
    from collections import deque
    lab = np.zeros(mask.shape, np.int32); n = 0; out = []
    H, W = mask.shape
    for y0, x0 in zip(*np.nonzero(mask)):
        if lab[y0, x0]: continue
        n += 1; q = deque([(y0, x0)]); lab[y0, x0] = n; cnt = 0
        while q:
            y, x = q.popleft(); cnt += 1
            for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= yy < H and 0 <= xx < W and mask[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n; q.append((yy, xx))
        if cnt >= min_px: out.append(lab == n)
    return sorted(out, key=lambda m: -m.sum())


def trace(mask):
    """Outer boundary of a single-component bool mask (Moore tracing) -> [(x, y)] pixel corners-ish,
    counter-clockwise on screen (y down)."""
    import numpy as np
    ys, xs = np.nonzero(mask)
    i = np.lexsort((xs, ys))[0]
    start = (int(xs[i]), int(ys[i]))
    H, W = mask.shape
    def on(x, y): return 0 <= x < W and 0 <= y < H and mask[y, x]
    nb = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]
    pts = [start]; cur = start; d = 6
    while True:
        for k in range(8):
            dd = (d + 6 + k) % 8   # start looking back-left of the last move
            nx, ny = cur[0] + nb[dd][0], cur[1] + nb[dd][1]
            if on(nx, ny):
                cur = (nx, ny); d = dd; break
        else:
            break
        if cur == start: break
        pts.append(cur)
        if len(pts) > 200000: break
    return pts


def resample(pts, step):
    """Resample a closed polyline to ~step spacing, with a light smoothing pass."""
    import numpy as np
    P = np.array(pts, float)
    P = (np.roll(P, 1, 0) + 2 * P + np.roll(P, -1, 0)) / 4
    seg = np.linalg.norm(np.roll(P, -1, 0) - P, axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]; n = max(int(L / step), 8)
    t = np.linspace(0, L, n, endpoint=False)
    Pc = np.vstack([P, P[:1]])
    return np.stack([np.interp(t, s, Pc[:, 0]), np.interp(t, s, Pc[:, 1])], 1)


def inflate(name, mask, materials, mat_fn=None, step=7.0, grid=12.0, depth=1.0, edge=2.5,
            face=FACE_PX, bend=0.0, power=0.5):
    """Pillow mesh from a card region: outline (resampled every `step` px) + interior points on a
    `grid` px lattice, constrained-Delaunay triangulated; each vertex is pushed forward/back by a round
    profile of its distance d to the outline: h = depth * W * (1 - (1 - d/W)^2)^power + edge px, W = the
    region's max d. Front and back halves share the outline. mat_fn(x_px, y_px) -> material index for
    each front/back face (sampled at the face centre). Coordinates via px2m (origin = card face centre).
    bend: y += bend * x^2 (metres) wraps it back round the head."""
    import bmesh, numpy as np
    from mathutils.geometry import delaunay_2d_cdt
    O = resample(trace(mask), step)
    ys, xs = np.nonzero(mask)
    gx = np.arange(xs.min(), xs.max() + 1, grid); gy = np.arange(ys.min(), ys.max() + 1, grid)
    G = np.array([(x, y) for y in gy for x in gx if mask[int(y), int(x)]], float).reshape(-1, 2)
    def dist(P):
        A = O; B = np.roll(O, -1, 0); AB = B - A
        t = np.clip(((P[:, None, :] - A[None]) * AB[None]).sum(-1) / (AB * AB).sum(-1)[None], 0, 1)
        C = A[None] + t[..., None] * AB[None]
        return np.sqrt(((P[:, None, :] - C) ** 2).sum(-1)).min(1)
    if len(G):
        G = G[dist(G) > step * 0.8]
    pts = [Vector((p[0], p[1])) for p in O] + [Vector((p[0], p[1])) for p in G]
    n = len(O)
    edges = [(i, (i + 1) % n) for i in range(n)]
    vco, eo, fo, _, _, _ = delaunay_2d_cdt(pts, edges, [], 2, 1e-6)
    V = np.array([(v.x, v.y) for v in vco])
    d = dist(V); W = max(d.max(), 1.0)
    u = np.clip(d / W, 0, 1)
    h = (depth * W * np.power(np.clip(1 - (1 - u) ** 2, 0, 1), power) + edge) * K
    bm = bmesh.new()
    F, B = [], []
    for (x, y), hh in zip(V, h):
        X = (x - face[0]) * K; Z = (face[1] - y) * K
        F.append(bm.verts.new((X, -hh + bend * X * X, Z)))
        B.append(bm.verts.new((X, hh + bend * X * X, Z)))
    def fmat(f):
        if mat_fn is None: return 0
        c = V[list(f)].mean(0)
        return mat_fn(c[0], c[1])
    for f in fo:
        mi = fmat(f)
        a = bm.faces.new([F[i] for i in f]); a.material_index = mi
        b = bm.faces.new([B[i] for i in f][::-1]); b.material_index = mi
    # outline: the front and back rims meet (edge > 0 leaves a thin side wall)
    outl = [i for i in range(len(V)) if d[i] < 1e-3]
    on = set(outl)
    seen = set()
    for f in fo:
        for k in range(len(f)):
            i, j = f[k], f[(k + 1) % len(f)]
            if i in on and j in on and ((i + 1) % n == j or (j + 1) % n == i) and (min(i, j), max(i, j)) not in seen:
                seen.add((min(i, j), max(i, j)))
                fc = bm.faces.new((F[j], F[i], B[i], B[j])); fc.material_index = fmat((i, j))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    for m in materials: ob.data.materials.append(m)
    return ob


def card_rgb(path):
    """Card RGBA as float numpy [row, col, 4] in sRGB 0..255, row 0 = top."""
    import numpy as np
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1] * 255


def P(x, y, d=0.0):
    """Card px (x, y) -> metres about the card face centre (Blender Z-up, front -Y); d = depth."""
    return Vector(((x - FACE_PX[0]) * K, d, (FACE_PX[1] - y) * K))


def bez(ps, n):
    """n+1 points on the Bezier curve with control points ps (de Casteljau)."""
    out = []
    for i in range(n + 1):
        t = i / n; q = list(ps)
        while len(q) > 1:
            q = [a * (1 - t) + b * t for a, b in zip(q, q[1:])]
        out.append(q[0])
    return out
