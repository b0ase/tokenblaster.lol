# Compare a 2D NPG card stack with the same parts assembled in 3D on the chibi.
#
#   python3 compare_stack.py --preview 0011 [--out DIR]          # a slot-machine preview NPG
#   python3 compare_stack.py --cards 07_009 08_005 10_011 [...]  # any card list (NN_NNN prefixes or paths)
#   python3 compare_stack.py --derive-fits [--write]             # card-derived default fits for parts.json
#
# What it does
#   1. Part list: --cards as given, or --preview: every card category is template-matched against the
#      flattened preview PNG (cards share the 961x1441 canvas, so a card matches where it is drawn).
#   2. 2D stack: the cards composited in the site's layer order (NFTCanvas.tsx), same canvas.
#   3. 3D stack: the parts that exist in 3D (hand-built, wrapped masks, hair GLBs, 08 = mirrored 07)
#      placed on the chibi exactly like the Stack Builder, rendered by Blender with an orthographic
#      front camera framed to the card canvas: 1 card px = K m, card face centre FACE_PX = face anchor.
#   4. Output: <out>/<name>_side.png (preview | 2D stack | 3D | overlay) and <name>_overlay.png (50%).
#
# --derive-fits: each hand-built part is projected at its saved fit, rasterised on the card canvas
# and compared with its card's alpha (principal angle, bbox centre, IoU). Weapons get roll (card
# angle) and x/y (card position); head parts get x/y. With --write the fits go into parts.json.
#
# Blender (one process at a time): set BLENDER or pass --blender. Hair and the chibi are read
# uncompressed from ninja-punk-girls-com (the stack copies are meshopt-compressed).
import argparse, glob, json, math, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
PUB = os.path.join(REPO, "public")
PARTS_JSON = os.path.join(PUB, "arena", "models", "npg", "stack", "parts.json")
NPG = "/Volumes/2026/Projects/ninja-punk-girls-com/public"
CARDS = NPG + "/assets"
PREVIEWS = NPG + "/slot-machine-previews"
CHIBI = NPG + "/3D_assets/chibi_cyberpunk_final.glb"
HAIR_SRC = NPG + "/3D_assets/npg_hair"
BLENDER = os.environ.get("BLENDER", "/Volumes/2026/Apps/Blender.app/Contents/MacOS/Blender")
W, H = 961, 1441
K = 0.00107  # chibi model units per card px (hm_common.K)
FACE_PX = (484.5, 669.5)  # card face centre = chibi face anchor

# Draw order, back to front (ninja-punk-girls-com src/components/canvas/NFTCanvas.tsx).
LAYERS = ["29-Background", "28-Glow", "27-Banner", "26-Decals", "24-Rear-Hair", "23-Rear-Horns", "22-Back",
          "21-Body", "20-Arms", "19-Underwear", "18-Face", "17-Shorts", "16-Bra", "15-Collar", "14-Jewellery",
          "13-Boots", "12-Top", "11-Mask", "10-Hair", "09-Horns", "08-Left-Weapon", "07-Right-Weapon",
          "06-Effects", "05-Interface", "04-Team", "02-Copyright", "01-Logo"]
# Categories a character is built from (identified in previews).
CHAR = ["24-Rear-Hair", "23-Rear-Horns", "22-Back", "21-Body", "20-Arms", "19-Underwear", "18-Face", "17-Shorts",
        "16-Bra", "15-Collar", "14-Jewellery", "13-Boots", "12-Top", "11-Mask", "10-Hair", "09-Horns",
        "08-Left-Weapon", "07-Right-Weapon"]
ALWAYS = ("21-Body", "18-Face")  # every NPG has these; accept a partly covered best match
# 3D hair GLBs (Anything.world) <- hair card. turn/fit as HAIR in StackBuilder.tsx.
HAIR3D = {
    "10_001": ("E001MiyukiHair.glb", 0.0, {}),
    "10_002": ("E002YamarashiiHair.glb", math.pi, {"scale": 1, "y": 0.29, "z": -0.06, "turn": 3.138}),
    "10_003": ("E003HikaruHair.glb", 0.0, {}),
    "10_011": ("E011NaoHair.glb", math.pi / 2, {}),
}


def card_path(c):
    if os.path.exists(c):
        return c
    hits = glob.glob(f"{CARDS}/*/{c}*.png")
    if not hits:
        sys.exit(f"no card {c}")
    return sorted(hits)[0]


def card_cat(path):
    return os.path.basename(os.path.dirname(path))


def card_id(path):
    return "_".join(os.path.basename(path).split("_")[:2])  # "07_009"


def rgba(path, s=1):
    im = Image.open(path).convert("RGBA")
    if im.size != (W, H):
        im = im.resize((W, H))
    if s > 1:
        im = im.resize((W // s, H // s), Image.BILINEAR)
    return im


# ---------- 1. identify the cards in a flattened preview ----------
def identify(preview, cats=CHAR, s=4, verbose=True):
    pv = np.asarray(rgba(preview, s)).astype(np.int16)
    got = []
    covered = np.zeros(pv.shape[:2], bool)  # opaque pixels of already-accepted higher layers
    for cat in reversed([c for c in LAYERS if c in cats]):  # front to back: occluders first
        best = []
        for f in sorted(glob.glob(f"{CARDS}/{cat}/*.png")):
            a = np.asarray(rgba(f, s)).astype(np.int16)
            m = (a[..., 3] > 220) & ~covered
            n = int(m.sum())
            if n < 15:
                continue
            d = np.abs(a[..., :3][m] - pv[..., :3][m]).max(1)
            best.append(((d < 40).mean(), n, f))
        best.sort(key=lambda b: (-b[0], -b[1]))
        if best and (best[0][0] > 0.7 or (cat in ALWAYS and best[0][0] > 0.3)):
            score, n, f = best[0]
            got.append(f)
            covered |= np.asarray(rgba(f, s))[..., 3] > 220
            if verbose:
                print(f"  {cat:16s} {os.path.basename(f):45s} match {score:.2f}")
        elif verbose:
            print(f"  {cat:16s} -" + (f" (best {os.path.basename(best[0][2])} {best[0][0]:.2f})" if best else ""))
    return got


# ---------- 2. 2D stack ----------
def composite(cards):
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    for c in sorted(cards, key=lambda p: LAYERS.index(card_cat(p)) if card_cat(p) in LAYERS else 99):
        out.alpha_composite(rgba(c))
    return out


# ---------- 3. 3D parts for a card list ----------
def load_parts():
    return json.load(open(PARTS_JSON))


def part_for_card(cid, parts):
    """Best 3D part for a card: hand-built > wrapped mask > Tripo. 08 cards ride the lweapon slot."""
    cand = [p for p in parts if p.get("card") == cid]
    rank = lambda p: (0 if p.get("handBuilt") else 1 if p.get("wrapped") else 2)
    cand.sort(key=rank)
    return cand[0] if cand else None


def job_for(cards, parts):
    items, missing = [], []
    for c in cards:
        cid, cat = card_id(c), card_cat(c)
        if cat in ("10-Hair",) and cid in HAIR3D:
            g, turn, fit = HAIR3D[cid]
            items.append({"kind": "hair", "url": os.path.join(HAIR_SRC, g), "turn": turn, "fit": fit, "card": cid})
            continue
        p = part_for_card(cid, parts)
        if p:
            items.append({"kind": "part", **p, "url": PUB + p["url"], "card": cid})
        elif cat in ("07-Right-Weapon", "08-Left-Weapon", "09-Horns", "10-Hair", "11-Mask", "23-Rear-Horns", "24-Rear-Hair",
                     "13-Boots", "15-Collar", "14-Jewellery", "22-Back"):
            missing.append(os.path.basename(c)[:-4])
    return items, missing


def blender(job, out_png=None, dump=None):
    jp = os.path.join(os.environ.get("TMPDIR", "/tmp"), f"npg_stack_job_{os.getpid()}.json")
    json.dump({"chibi": CHIBI, "items": job, "W": W, "H": H, "K": K, "face_px": FACE_PX, "png": out_png, "dump": dump}, open(jp, "w"))
    r = subprocess.run([BLENDER, "-b", "--factory-startup", "-P", os.path.join(HERE, "compare_stack_bl.py"), "--", jp],
                       capture_output=True, text=True)
    for line in r.stdout.splitlines():
        if line.startswith(("STACK", "Error", "Traceback")):
            print(" ", line)
    if r.returncode or (out_png and not os.path.exists(out_png)):
        print(r.stdout[-3000:], r.stderr[-3000:])
        sys.exit("blender failed")


def side_by_side(name, out, preview, stack2d, r3d):
    tiles = []
    if preview:
        tiles.append(rgba(preview))
    for t in (stack2d, r3d):
        bg = Image.new("RGBA", (W, H), (236, 236, 240, 255))
        bg.alpha_composite(t)
        tiles.append(bg)
    ov = Image.blend(tiles[-2], tiles[-1], 0.5)
    tiles.append(ov)
    sheet = Image.new("RGB", (W * len(tiles), H), "white")
    for i, t in enumerate(tiles):
        sheet.paste(t.convert("RGB"), (i * W, 0))
    sheet = sheet.resize((sheet.width // 2, sheet.height // 2), Image.LANCZOS)
    sheet.save(os.path.join(out, f"{name}_side.png"))
    ov.convert("RGB").save(os.path.join(out, f"{name}_overlay.png"))


# ---------- 4. card-derived fits ----------
def alpha_stats(mask):
    ys, xs = np.nonzero(mask)
    if len(xs) < 10:
        return None
    pts = np.stack([xs, -ys], 1).astype(float)
    c = pts.mean(0)
    w, v = np.linalg.eigh(np.cov((pts - c).T))
    ax = v[:, 1]
    ang = math.degrees(math.atan2(ax[1], ax[0]))
    ang = (ang + 90) % 180 - 90  # axis angle in (-90, 90]
    return {"ang": ang, "cx": (xs.min() + xs.max()) / 2, "cy": (ys.min() + ys.max()) / 2,
            "w": xs.max() - xs.min() + 1, "h": ys.max() - ys.min() + 1}


def raster(tris):
    im = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(im)
    for t in tris:
        d.polygon([tuple(p) for p in t], fill=255)
    return np.asarray(im) > 0


def iou(a, b):
    return (a & b).sum() / max(1, (a | b).sum())


def moved(tris, anchor, deg, dx, dy, s=1.0):
    """Rotate projected triangles about the anchor by deg (counter-clockwise on screen), shift, scale by s."""
    t = np.asarray(tris, float)
    ax, ay = anchor
    r = math.radians(deg)
    x, y = t[..., 0] - ax, -(t[..., 1] - ay)
    nx = ax + x * math.cos(r) - y * math.sin(r) + dx
    ny = ay - (x * math.sin(r) + y * math.cos(r)) + dy
    return np.stack([nx, ny], -1) * s


def raster_s(tris, s):
    im = Image.new("L", (int(W * s), int(H * s)), 0)
    d = ImageDraw.Draw(im)
    for t in tris:
        d.polygon([tuple(p) for p in t], fill=255)
    return np.asarray(im) > 0


def best_weapon_pose(tris, anchor, card):
    """Roll (about the grip) + shift that best overlays the card: principal-axis angle (both ways
    round, since the axis has no direction), bbox centres aligned, then a small IoU search."""
    s = 0.5
    cs = alpha_stats(card)
    small = np.asarray(Image.fromarray(card).resize((int(W * s), int(H * s)))) > 0
    ms = alpha_stats(raster(tris))
    base = ((cs["ang"] - ms["ang"]) + 90) % 180 - 90
    best = (-1, 0, 0, 0)
    score = lambda d, x, y: iou(small, raster_s(moved(tris, anchor, d, x, y, s), s))
    for d0 in (0, base, base + 180):  # keep the current roll, or turn to the card's axis either way round
        for dd in (-4, 0, 4):
            d = d0 + dd
            st = alpha_stats(raster(moved(tris, anchor, d, 0, 0)))
            if st is None:
                continue
            cx, cy = cs["cx"] - st["cx"], cs["cy"] - st["cy"]
            for ox in (-12, 0, 12):
                for oy in (-12, 0, 12):
                    sc = score(d, cx + ox, cy + oy)
                    if sc > best[0]:
                        best = (sc, d, cx + ox, cy + oy)
    for step in (6, 3):  # refine
        _, d, x, y = best
        for dd in (-step / 2, 0, step / 2):
            for ox in (-step, 0, step):
                for oy in (-step, 0, step):
                    sc = score(d + dd, x + ox, y + oy)
                    if sc > best[0]:
                        best = (sc, d + dd, x + ox, y + oy)
    return best


def derive_fits(write):
    """Card-derived default fits. Weapons: roll, x, y. Head parts: x, y, but only where no fit was
    saved by hand (owner fits, e.g. Phi-Phi worn as a helmet, are kept and only reported)."""
    parts = load_parts()
    todo = [p for p in parts if p.get("handBuilt") and p.get("card")]
    dump = os.path.join(os.environ.get("TMPDIR", "/tmp"), f"npg_stack_dump_{os.getpid()}.json")
    for rnd in range(2):  # round 1 fits, round 2 re-renders the new fits to check them
        blender([{"kind": "part", **p, "url": PUB + p["url"]} for p in todo], None, dump)
        tris = json.load(open(dump))
        print("fit" if rnd == 0 else "check")
        for p in todo:
            card = np.asarray(rgba(card_path(p["card"])))[..., 3] > 100
            cs = alpha_stats(card)
            t, anc = tris[p["id"]]["tris"], tris[p["id"]]["anchor"]
            mm = raster(t)
            ms = alpha_stats(mm)
            f = {"scale": 1, "x": 0, "y": 0, "z": 0, "turn": 0, **p.get("fit", {})}
            line = (f"  {p['id']:28s} IoU {iou(card, mm):.2f}  w/h vs card {ms['w'] / cs['w']:.2f}/{ms['h'] / cs['h']:.2f}"
                    f"  centre off {cs['cx'] - ms['cx']:+.0f},{cs['cy'] - ms['cy']:+.0f}px")
            if rnd == 0:
                if p["slot"] in ("weapon", "lweapon"):
                    sc, d, dx, dy = best_weapon_pose(t, anc, card)
                    f["roll"] = round(((f.get("roll", 0) + math.radians(d)) + math.pi) % (2 * math.pi) - math.pi, 3)
                    f["x"] = round(f["x"] + dx * K, 3)
                    f["y"] = round(f["y"] - dy * K, 3)
                    line += f"  -> roll {math.degrees(f['roll']):.0f} deg, IoU {sc:.2f}"
                elif not p.get("fit"):
                    f["x"] = round(f["x"] + (cs["cx"] - ms["cx"]) * K, 3)
                    f["y"] = round(f["y"] - (cs["cy"] - ms["cy"]) * K, 3)
                else:
                    line += "  (owner fit kept)"
                if p["slot"] in ("weapon", "lweapon") or not p.get("fit"):
                    p["fit"] = f
            print(line)
    if write:
        json.dump(parts, open(PARTS_JSON, "w"), indent=1)
        open(PARTS_JSON, "a").write("\n")
        print("wrote", PARTS_JSON)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview")
    ap.add_argument("--cards", nargs="*")
    ap.add_argument("--out", default=os.path.join(REPO, ".private", "handmodel", "stack-compare"))
    ap.add_argument("--derive-fits", action="store_true")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--blender")
    a = ap.parse_args()
    global BLENDER
    BLENDER = a.blender or BLENDER
    if a.derive_fits:
        return derive_fits(a.write)
    os.makedirs(a.out, exist_ok=True)
    preview = None
    if a.preview:
        hits = glob.glob(f"{PREVIEWS}/{a.preview}_*.png")
        preview = hits[0] if hits else a.preview
        name = os.path.basename(preview).split("_")
        name = f"{name[0]}_{name[1]}"
        print(name)
        cards = identify(preview)
    else:
        cards = [card_path(c) for c in a.cards]
        name = "cards_" + "-".join(card_id(c) for c in cards)
    stack2d = composite(cards)
    items, missing = job_for(cards, load_parts())
    png = os.path.join(a.out, f"{name}_3d.png")
    blender(items, png)
    side_by_side(name, a.out, preview, stack2d, Image.open(png).convert("RGBA"))
    rep = {"name": name, "cards": [os.path.basename(c)[:-4] for c in cards],
           "in3d": [i.get("id", i["card"]) for i in items], "missing3d": missing}
    json.dump(rep, open(os.path.join(a.out, f"{name}.json"), "w"), indent=1)
    print("  3D:", ", ".join(rep["in3d"]) or "-")
    print("  missing in 3D:", ", ".join(missing) or "-")


if __name__ == "__main__":
    main()
