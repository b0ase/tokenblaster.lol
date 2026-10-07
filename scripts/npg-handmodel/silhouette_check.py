# Silhouette checker: front-view mask of a hand-built GLB vs the card's alpha mask, at the card's
# own pixel scale (K m per card px), both centred on their front-view bbox centre.
#   python3 silhouette_check.py part.glb card.png out_prefix [--tilt DEG] [--blender PATH]
# --tilt: weapons are authored shaft-up (+Z); tilt rotates them so the shaft rises DEG above
# horizontal toward viewer's right, as the card draws them (same as hm_common.tilted_bbox).
# Writes <out_prefix>_mask.png (model), <out_prefix>_diff.png (green = both, red = card only /
# missing, blue = model only / extra) and prints IoU, bbox error and IoU per horizontal third.
# The same file runs inside Blender (render stage) and in system python3 (compare stage).
import os, sys, json, subprocess

K = 0.00107
MARGIN = 24

try:
    import bpy  # noqa: F401
    IN_BLENDER = True
except ImportError:
    IN_BLENDER = False


def blender_render():
    import bpy, math
    from mathutils import Vector, Matrix
    a = sys.argv[sys.argv.index("--") + 1:]
    glb, out_png, tilt, cw, ch = a[0], a[1], float(a[2]), int(a[3]), int(a[4])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    R = Matrix.Rotation(math.radians(90 - tilt), 4, "Y") if tilt else Matrix.Identity(4)
    for o in objs:
        if o.parent is None:
            o.matrix_world = R @ o.matrix_world
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    x0, x1 = min(p.x for p in pts), max(p.x for p in pts)
    z0, z1 = min(p.z for p in pts), max(p.z for p in pts)
    mw, mh = (x1 - x0) / K, (z1 - z0) / K
    W = int(max(cw, mw)) + 2 * MARGIN
    H = int(max(ch, mh)) + 2 * MARGIN
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.render_aa = "OFF"
    sc.display.shading.light = "FLAT"
    sc.display.shading.color_type = "SINGLE"
    sc.display.shading.single_color = (1, 1, 1)
    sc.render.film_transparent = True
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    cam = bpy.data.cameras.new("c"); cam.type = "ORTHO"; cam.ortho_scale = max(W, H) * K
    co = bpy.data.objects.new("c", cam); sc.collection.objects.link(co); sc.camera = co
    co.location = ((x0 + x1) / 2, -10, (z0 + z1) / 2)
    co.rotation_euler = (math.radians(90), 0, 0)
    cam.clip_end = 100
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    json.dump({"W": W, "H": H, "mw": mw, "mh": mh}, open(out_png + ".json", "w"))


def iou(a, b):
    import numpy as np
    u = np.logical_or(a, b).sum()
    return float(np.logical_and(a, b).sum() / u) if u else 1.0


def compare(glb, card, prefix, tilt, blender):
    import numpy as np
    from PIL import Image
    im = np.asarray(Image.open(card).convert("RGBA"))
    alpha = im[:, :, 3] > 128
    ys, xs = np.nonzero(alpha)
    bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    cw, ch = bx1 - bx0, by1 - by0
    mask_png = prefix + "_mask.png"
    subprocess.run([blender, "-b", "-P", os.path.abspath(__file__), "--", glb, mask_png, str(tilt), str(cw), str(ch)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    info = json.load(open(mask_png + ".json")); os.remove(mask_png + ".json")
    W, H = info["W"], info["H"]
    m = np.asarray(Image.open(mask_png).convert("RGBA"))[:, :, 3] > 128
    # card canvas of the same size centred on the card bbox centre
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    ox, oy = int(round(cx - W / 2)), int(round(cy - H / 2))
    c = np.zeros((H, W), bool)
    sx0, sy0 = max(ox, 0), max(oy, 0)
    sx1, sy1 = min(ox + W, alpha.shape[1]), min(oy + H, alpha.shape[0])
    c[sy0 - oy:sy1 - oy, sx0 - ox:sx1 - ox] = alpha[sy0:sy1, sx0:sx1]
    # recentre the model mask on its own bbox centre (render is already centred; fix rounding)
    my, mx = np.nonzero(m)
    dx = int(round(W / 2 - (mx.min() + mx.max() + 1) / 2)); dy = int(round(H / 2 - (my.min() + my.max() + 1) / 2))
    m = np.roll(np.roll(m, dx, 1), dy, 0)
    cy_, cx_ = np.nonzero(c)
    dxc = int(round(W / 2 - (cx_.min() + cx_.max() + 1) / 2)); dyc = int(round(H / 2 - (cy_.min() + cy_.max() + 1) / 2))
    c = np.roll(np.roll(c, dxc, 1), dyc, 0)
    total = iou(m, c)
    my, mx = np.nonzero(m)
    mw, mh = mx.max() - mx.min() + 1, my.max() - my.min() + 1
    print(f"IOU {total:.4f}")
    print(f"BBOX model {mw}x{mh}px card {cw}x{ch}px  w err {100 * (mw / cw - 1):+.1f}%  h err {100 * (mh / ch - 1):+.1f}%")
    top = cy_.min() + dyc
    for name, k in (("top", 0), ("middle", 1), ("bottom", 2)):
        a0, a1 = int(top + ch * k / 3), int(top + ch * (k + 1) / 3)
        mm, cc = m[a0:a1], c[a0:a1]
        miss, extra = (cc & ~mm).sum(), (mm & ~cc).sum()
        print(f"  {name:6s} IoU {iou(mm, cc):.3f}  missing {miss}px  extra {extra}px")
    lh = (np.nonzero(c)[1].min() + np.nonzero(c)[1].max()) / 2
    for name, sl in (("left", slice(0, int(lh))), ("right", slice(int(lh), W))):
        print(f"  {name:6s} IoU {iou(m[:, sl], c[:, sl]):.3f}")
    d = np.zeros((H, W, 3), np.uint8)
    d[m & c] = (40, 200, 70); d[c & ~m] = (230, 40, 40); d[m & ~c] = (50, 90, 255)
    Image.fromarray(d).save(prefix + "_diff.png")
    return total


if IN_BLENDER:
    blender_render()
elif __name__ == "__main__":
    args = sys.argv[1:]
    tilt = 0.0; blender = "/Volumes/2026/Apps/Blender.app/Contents/MacOS/Blender"
    if "--tilt" in args:
        i = args.index("--tilt"); tilt = float(args[i + 1]); del args[i:i + 2]
    if "--blender" in args:
        i = args.index("--blender"); blender = args[i + 1]; del args[i:i + 2]
    compare(os.path.abspath(args[0]), args[1], os.path.abspath(args[2]), tilt, blender)
