import glob, os
from PIL import Image, ImageDraw, ImageFont

base = '/private/tmp/claude-501/-Volumes-2026-Projects-tokenblaster-lol/71e6c512-a46b-4775-85a0-4cd4f3360013/scratchpad/build/bubbo/raw-assets/images/'
font_path = base + '../fonts/Bungee-Regular{wf}.ttf'
glyph = {'yellow': 'B', 'green': '$', 'red': 'X', 'blue': 'T'}
d = glob.glob(base + 'preload*')[0]
for color, ch in glyph.items():
    p = f'{d}/bubble-{color}.png'
    im = Image.open(p).convert('RGBA')
    w, h = im.size
    lay = Image.new('RGBA', im.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(lay)
    cx, cy = w / 2, h / 2
    r = w * 0.36
    dr.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255, 200), width=max(3, w // 30))
    f = ImageFont.truetype(font_path, int(w * 0.46))
    dr.text((cx, cy + 2), ch, font=f, fill=(255, 255, 255, 235), anchor='mm', stroke_width=max(2, w // 45), stroke_fill=(0, 0, 0, 90))
    im.alpha_composite(lay)
    im.save(p)
    print(p, im.size)
