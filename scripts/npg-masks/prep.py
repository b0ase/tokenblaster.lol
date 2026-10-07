"""Step 1 (system python3 + Pillow): crop every NPG mask card to the canvas region the chibi's
base mask covers, so the crop can be planar-projected front-on onto the base mask mesh.

Usage: python3 scripts/npg-masks/prep.py <cards dir> <out dir>
Writes <out>/<card-id>.png (512x256 RGBA). The crop rect is the registration (see wrap.py).
"""
import glob
import os
import sys

from PIL import Image

from register import CROP, TEX_W, TEX_H

cards, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
for f in sorted(glob.glob(os.path.join(cards, '*.png'))):
    cid = os.path.splitext(os.path.basename(f))[0]
    im = Image.open(f).convert('RGBA').crop(CROP).resize((TEX_W, TEX_H), Image.LANCZOS)
    # Bleed colour into fully transparent pixels so alpha-clip edges don't fringe dark.
    a = im.getchannel('A')
    if a.getbbox():
        solid = Image.new('RGBA', im.size)
        blur = im
        for r in (2, 6, 16):
            from PIL import ImageFilter
            blur = Image.alpha_composite(im.filter(ImageFilter.BoxBlur(r)), blur)
        rgb = Image.composite(im, blur, a.point(lambda v: 255 if v > 0 else 0)).convert('RGB')
        solid = rgb.copy()
        solid.putalpha(a)
        im = solid
    im.save(os.path.join(out, cid + '.png'), optimize=True)
    print(cid)
