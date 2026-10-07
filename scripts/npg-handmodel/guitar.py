# Guitar (07_037): pointy star-body metal guitar, red with purple stripe panels, black neck with
# pale frets, black pickups + knobs, red spiked headstock. Blender -b -P guitar.py
# Weapon frame: neck along +Z, origin = mid-neck (where she grips it), body below, flats to camera.
import bpy, os, sys
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hm_common import mat, out_path, sweep, slab, bevel, join, fit_weapon, finish

OUT = out_path("07_037_guitar")
bpy.ops.wm.read_factory_settings(use_empty=True)
RED = mat("red", "e5182a", 0.3)
PURP = mat("purple", "7a1f8c", 0.35)
BLK = mat("black", "141216", 0.4)
FRET = mat("fret", "c9ccd2", 0.3)

BODY = [(0.018, 0.07), (0.15, 0.17), (0.06, 0.02), (0.17, -0.10), (0.02, -0.06), (-0.07, -0.25), (-0.06, -0.04),
        (-0.22, 0.05), (-0.03, 0.06)]   # 4-point star, neck up
BODY = [(x * 1.35, z * 1.35 - 0.01) for x, z in BODY]
body = slab("body", BODY, 0.04, RED); bevel(body, 0.006, 1, 30)
parts = [body]
for strip in ([(-0.16, 0.035), (-0.06, -0.04), (-0.055, -0.01), (-0.12, 0.045)],
              [(-0.065, -0.14), (-0.04, -0.06), (0.0, -0.065), (-0.06, -0.20)],
              [(0.05, -0.04), (0.14, -0.09), (0.12, -0.075), (0.04, -0.02)]):
    parts.append(slab("stripe", [(x * 1.35, z * 1.35 - 0.01) for x, z in strip], 0.043, PURP))   # purple panels proud of both faces
NL = 0.30
parts.append(slab("neck", [(-0.017, 0.02), (0.017, 0.02), (0.015, NL), (-0.015, NL)], 0.022, BLK, y0=-0.004))
for k in range(7):
    z = 0.08 + k * 0.032
    parts.append(slab("fret", [(-0.016, z), (0.016, z), (0.016, z + 0.003), (-0.016, z + 0.003)], 0.0235, FRET, y0=-0.004))
HEAD = [(-0.015, NL), (0.015, NL), (0.03, NL + 0.06), (0.012, NL + 0.05), (0.004, NL + 0.105), (-0.01, NL + 0.05), (-0.03, NL + 0.075)]
hs = slab("head", HEAD, 0.016, RED, y0=-0.002); bevel(hs, 0.003, 1, 30); parts.append(hs)
for z in (-0.005, 0.035):
    parts.append(slab("pickup", [(-0.022, z), (0.022, z), (0.022, z + 0.022), (-0.022, z + 0.022)], 0.05, BLK))
parts.append(slab("bridge", [(-0.02, -0.04), (0.02, -0.04), (0.02, -0.03), (-0.02, -0.03)], 0.048, FRET))
for x, z in ((0.05, -0.05), (0.075, -0.07)):
    parts.append(sweep("knob", [Vector((x, -0.019, z)), Vector((x, -0.03, z))], [0.009, 0.008], BLK, nseg=8, ref=Vector((1, 0, 0))))
ob = join(parts, "Guitar")
ob.data.transform(Matrix.Translation((0, 0, -0.17))); ob.data.update()   # origin = mid-neck grip
fit_weapon(ob, 44, 475, 436)   # card: neck rises ~44 deg, bbox 475 x 436 px
finish(ob, OUT, 30)
