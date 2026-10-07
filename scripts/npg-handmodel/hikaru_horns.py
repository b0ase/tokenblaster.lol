# Hikaru Horns (23_002, rear horns): two dark gunmetal horns rising from pointed gold collars
# studded with red rivets, curling outward into a hooked spiral tip. Blender -b -P hikaru_horns.py
# Built in card px (P() -> metres about the card face centre), then sized/placed by place_to_card.
# Rear part: pushed back behind the face so it sits at the back of the head.
import bpy, os, sys
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hm_common import K, mat, out_path, sweep, bevel, join, place_to_card, finish, bez, P

OUT = out_path("23_002_hikaru_horns")
bpy.ops.wm.read_factory_settings(use_empty=True)
HORN = mat("hornblack", "3a3b42", 0.35)
GOLD = mat("yellow", "d4a63c", 0.3, 0.8)
RIV = mat("rivet", "c0182a", 0.3)

parts = []
for s in (-1, 1):
    X = (lambda x: x) if s < 0 else (lambda x: 969 - x)
    # horn: up from the collar, sweeping outward, curling down into a hooked tip
    c = bez([P(X(345), 520), P(X(325), 375), P(X(200), 320), P(X(190), 415)], 10) + [P(X(200), 445), P(X(228), 452), P(X(245), 430), P(X(232), 412)]
    r = [k * K for k in (54, 52, 48, 43, 38, 33, 28, 24, 20, 16, 13, 10, 8, 6, 0)]
    parts.append(sweep("horn", c, r, HORN, nseg=10, squash=0.75))
    # gold collar: wedge band pointing down, slightly proud of the horn
    cc = [P(X(355), 582), P(X(352), 545), P(X(345), 505), P(X(342), 492)]
    col = sweep("collar", cc, [8 * K, 50 * K, 60 * K, 60 * K], GOLD, nseg=10, squash=0.8)
    bevel(col, 0.003); parts.append(col)
    for (x, y) in ((300, 512), (322, 506), (378, 500), (330, 535), (365, 528)):   # red rivets
        p = P(X(x), y, -0.040)
        parts.append(sweep("rivet", [p + Vector((0, 0.004, 0)), p, p + Vector((0, -0.006, 0))], [0.008, 0.008, 0.0], RIV, nseg=6))
ob = join(parts, "HikaruHorns")
place_to_card(ob, (182, 351, 750, 578))
ob.data.transform(Matrix.Translation((0, 0.07, 0))); ob.data.update()   # behind the face: rear horns
finish(ob, OUT, 35)
