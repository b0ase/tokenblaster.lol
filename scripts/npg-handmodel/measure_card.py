# Measure a part card's silhouette: alpha bbox, and length/width along its principal axis
# (for diagonal weapons). Sizes also given in chibi model units (K = metres per card px).
#   python3 measure_card.py card.png [...]
# K calibration (one factor for every card): the card canvas is the whole character.
#   head width: Miyuki face card 287 px  <->  chibi head mesh 0.31  -> 0.00108
#   height:     hair top..boots ~850 px  <->  chibi 0.897           -> 0.00106
K = 0.00107
import sys
import numpy as np
from PIL import Image

for f in sys.argv[1:]:
    a = np.asarray(Image.open(f).convert("RGBA"))[:, :, 3] > 40
    ys, xs = np.nonzero(a)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    pts = np.stack([xs, -ys], 1).astype(float)
    c = pts.mean(0)
    w, v = np.linalg.eigh(np.cov((pts - c).T))
    ax = v[:, 1]
    p = (pts - c) @ ax
    q = (pts - c) @ v[:, 0]
    L, Wd = p.max() - p.min(), q.max() - q.min()
    ang = np.degrees(np.arctan2(ax[1], ax[0]))
    print(f.split("/")[-1])
    print(f"  bbox {x1-x0+1}x{y1-y0+1}px  h/w {(y1-y0+1)/(x1-x0+1):.3f}  -> {(x1-x0+1)*K:.3f} x {(y1-y0+1)*K:.3f} m")
    print(f"  principal axis {ang:.1f} deg: length {L:.0f}px ({L*K:.3f} m), width {Wd:.0f}px, w/l {Wd/L:.3f}")
