# Spikes (09_004): a pink heart-shaped forehead plate - magenta rim, light pink inset face, steel
# spikes out of the top corners and sides, small steel darts on the face. Curved round the
# forehead. Blender -b -P spikes_heart.py. Origin = card face centre; plate sits on the forehead.
import bpy, math, os, sys
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hm_common import mat, out_path, slab, sweep, bevel, join, place_to_card, finish

OUT = out_path("09_004_spikes_heart")
bpy.ops.wm.read_factory_settings(use_empty=True)
RIM = mat("magenta", "d92b67", 0.35)
FACE = mat("pink", "f094b4", 0.4)
STEEL = mat("steel", "b9bfc8", 0.25, 0.85)

BEND, Y0 = 0.9, -0.33  # plate curves back round the forehead (y += BEND x^2); front at Y0

def heart(k):
    """Card silhouette: squared lobes, V notch at the top centre, sides then a point at the bottom."""
    half = [(0.0, 0.40), (0.20, 0.52), (0.44, 0.62), (0.48, 0.56), (0.47, 0.36), (0.30, 0.17), (0.0, 0.0)]
    pts = [(x * k, 0.31 + (z - 0.31) * k) for x, z in half]
    left = [(-x, z) for x, z in reversed(pts[1:-1])]
    return [pts[-1]] + list(reversed(pts[1:-1])) + [pts[0]] + [(-x, z) for x, z in pts[1:-1]]

parts = []
rim = slab("rim", heart(1.0), 0.05, RIM, y0=Y0 + 0.025, bend=BEND)
bevel(rim, 0.004, 1, 30); parts.append(rim)
face = slab("face", heart(0.80), 0.02, FACE, y0=Y0 - 0.002, bend=BEND)
bevel(face, 0.006, 1, 30); parts.append(face)

def yb(x):  # front surface depth at x
    return Y0 + BEND * x * x

def spike(p, d, L, r=0.03):
    d = Vector(d).normalized()
    parts.append(sweep("spike", [p, p + d * L * 0.5, p + d * L], [r, r * 0.55, 0.0], STEEL, nseg=6))

for s in (-1, 1):
    spike(Vector((0.43 * s, yb(0.43) + 0.02, 0.58)), (0.35 * s, 0, 1), 0.16)        # top corner, up
    spike(Vector((0.47 * s, yb(0.47) + 0.02, 0.47)), (1 * s, 0, 0.35), 0.13)        # side, outward
    spike(Vector((0.10 * s, yb(0.10) + 0.01, 0.46)), (0.25 * s, 0, 1), 0.08, 0.02)  # inner lobe, small
    for x, z in ((0.25, 0.42), (0.18, 0.26)):                                       # darts on the face
        spike(Vector((x * s, yb(x) - 0.012, z)), (0.6 * s, -0.5, 0.3), 0.05, 0.012)
ob = join(parts, "SpikesHeart")
place_to_card(ob, (317, 455, 644, 658))
finish(ob, OUT, 35)
