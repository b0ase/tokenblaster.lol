# Scarlet Horns (09_002): glossy red alice band arching over the head, a tall faceted horn
# standing on each end and a smaller spike flaring outward below it. Blender -b -P scarlet_horns.py
# Origin = card face centre (head parts share the card canvas); depth centred on the head.
import bpy, math, os, sys
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hm_common import mat, out_path, sweep, bevel, join, place_to_card, finish

OUT = out_path("09_002_scarlet_horns")
bpy.ops.wm.read_factory_settings(use_empty=True)
RED = mat("scarlet", "d8202a", 0.3)
DARK = mat("oxblood", "7a0d16", 0.35)

def bez(p0, p1, p2, n):
    return [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2 for t in (i / n for i in range(n + 1))]

parts = []
# band: flattened tube arching in the coronal plane (front view = the card's arch), ends run into
# the horns at mid-height like the card
S80 = math.sin(math.radians(80))
pts = [Vector((0.34 * math.sin(a) / S80, 0, 0.165 + 0.105 * (math.cos(a) - math.cos(math.radians(80))) / (1 - math.cos(math.radians(80)))))
       for a in [math.radians(-80 + 160 * i / 18) for i in range(19)]]
band = sweep("band", pts, [0.036] * len(pts), RED, nseg=8, squash=0.6, ref=Vector((0, 1, 0)))
bevel(band, 0.002); parts.append(band)
for s in (-1, 1):
    # main horn: 4-sided (crisp diamond facets), fat flame-like base, bulging out then hooking in
    c = bez(Vector((0.36 * s, 0, 0.0)), Vector((0.43 * s, 0, 0.20)), Vector((0.32 * s, 0, 0.37)), 8)
    r = [0.072 * (1 - i / 8) ** 0.75 for i in range(9)]
    parts.append(sweep("horn", c, r, RED, nseg=4, squash=0.6, ref=Vector((0, 1, 0))))
    # dark inner facet (the card's shadow side), slightly proud on the front face
    c2 = [p + Vector((-0.016 * s, -0.022, 0.004)) for p in c[:-1]]
    parts.append(sweep("hornin", c2, [x * 0.42 for x in r[:-1]], DARK, nseg=4, squash=0.6, ref=Vector((0, 1, 0))))
    # side spike flaring outward from the horn's outer base
    c3 = bez(Vector((0.40 * s, 0, 0.03)), Vector((0.47 * s, 0, 0.07)), Vector((0.50 * s, 0, 0.22)), 5)
    parts.append(sweep("spike", c3, [0.042 * (1 - i / 5) ** 0.8 for i in range(6)], RED, nseg=4, squash=0.6,
                       ref=Vector((0, 1, 0))))
ob = join(parts, "ScarletHorns")
place_to_card(ob, (278, 361, 679, 517))
finish(ob, OUT, 30)
