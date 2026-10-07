# Big Red Horns (23_004, rear horns): two thick glossy red horns rising out of dark socket cuffs,
# leaning outward and rolling over at the top into a small hooked point. Blender -b -P big_red_horns.py
import bpy, os, sys
from mathutils import Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hm_common import K, mat, out_path, sweep, bevel, join, place_to_card, finish, bez, P

OUT = out_path("23_004_big_red_horns")
bpy.ops.wm.read_factory_settings(use_empty=True)
RED = mat("scarlet", "dd1622", 0.3)
DARK = mat("oxblood", "4a0a12", 0.4)

parts = []
for s in (-1, 1):
    X = (lambda x: x) if s < 0 else (lambda x: 961 - x)
    c = bez([P(X(375), 580), P(X(290), 510), P(X(215), 450), P(X(235), 412)], 10)
    c += bez([P(X(235), 412), P(X(220), 388), P(X(170), 402), P(X(122), 416)], 5)[1:]
    r = [k * K for k in (56, 55, 54, 52, 50, 48, 46, 44, 42, 40, 37, 28, 20, 13, 7, 0)]
    parts.append(sweep("horn", c, r, RED, nseg=10, squash=0.85))
    cuff = sweep("cuff", [P(X(395), 604), P(X(385), 592), P(X(366), 574)], [52 * K, 52 * K, 49 * K], DARK, nseg=10, squash=0.85)
    bevel(cuff, 0.003); parts.append(cuff)
ob = join(parts, "BigRedHorns")
place_to_card(ob, (118, 350, 843, 606))
ob.data.transform(Matrix.Translation((0, 0.07, 0))); ob.data.update()   # behind the face: rear horns
finish(ob, OUT, 35)
