# Card vs model strip: python3 compare.py card.png render_prefix [out.png]
# -> [card | front | 3/4 | side | back], 600 px tall.
import sys
from PIL import Image

card, p = sys.argv[1], sys.argv[2]
out = sys.argv[3] if len(sys.argv) > 3 else f"{p}_cmp.png"
im = Image.open(card).convert("RGBA")
c = im.crop(im.getchannel("A").getbbox())
c.thumbnail((560, 560))
s = Image.new("RGB", (3000, 600), "white")
s.paste(c, ((600 - c.width) // 2, (600 - c.height) // 2), c)
for i, v in enumerate(["front", "34", "side", "back"]):
    s.paste(Image.open(f"{p}_{v}.png").convert("RGB"), ((i + 1) * 600, 0))
s.save(out)
