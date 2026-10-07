# Combine check_on_chibi.py renders into one sheet (front row, 3/4 row):
#   python3 chibi_sheet.py <prefix> <n combos> out.png
import sys
from PIL import Image

P, n, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
W = Image.new("RGB", (700 * n, 1400), "white")
for i in range(n):
    for j, v in enumerate(["front", "34"]):
        W.paste(Image.open(f"{P}_{i}_{v}.png").convert("RGB"), (700 * i, 700 * j))
W.save(out)
