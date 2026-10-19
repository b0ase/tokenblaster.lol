"""Contact sheet for check_models.py: one row per model (rest + each clip), issues printed under the name.
Usage: python3 scripts/npg-models/sheet.py   ->  out/npg-models/sheet.png
"""
import json, os
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'out', 'npg-models'); REN = os.path.join(OUT, 'renders')
COLS = ['rest', 'Idle_Loop', 'Sprint_Loop', 'Sword_Regular_A', 'Sword_Dash', 'Hit_Chest']
T, LABEL = 192, 260

reports = json.load(open(os.path.join(OUT, 'report.json')))
sheet = Image.new('RGB', (LABEL + T * len(COLS), 24 + T * len(reports)), (18, 18, 24)); d = ImageDraw.Draw(sheet)
for i, c in enumerate(COLS): d.text((LABEL + i * T + 6, 6), c, fill=(170, 170, 190))
for r_i, r in enumerate(reports):
    y = 24 + r_i * T
    d.text((8, y + 8), r['id'], fill=(255, 255, 255))
    for k, line in enumerate(r['issues'][:9] or ['no issues']):
        d.text((8, y + 28 + k * 16), line[:40], fill=(255, 120, 120) if r['issues'] else (120, 220, 140))
    for i, c in enumerate(COLS):
        p = os.path.join(REN, f"{r['id']}_{c}.png")
        if os.path.exists(p):
            im = Image.open(p).convert('RGBA'); im.thumbnail((T, T))
            bg = Image.new('RGBA', im.size, (40, 40, 52, 255)); bg.alpha_composite(im); sheet.paste(bg.convert('RGB'), (LABEL + i * T, y))
sheet.save(os.path.join(OUT, 'sheet.png')); print(os.path.join(OUT, 'sheet.png'))
