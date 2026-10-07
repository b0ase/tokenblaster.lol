# Katana (07_009): long gently curved steel blade (sori) with a pale edge bevel and angled
# kissaki, brass habaki, dark oval tsuba, oxblood tsuka with a criss-cross wrap and dark kashira.
# Blender -b -P katana.py. Weapon frame: blade along +Z, origin = grip, edge on +X, flats to camera.
import bpy, math, os, sys
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hm_common import mat, out_path, sweep, slab, bevel, join, fit_weapon, finish

OUT = out_path("07_009_katana")
bpy.ops.wm.read_factory_settings(use_empty=True)
STEEL = mat("steel", "c3c8cf", 0.22, 0.9)
EDGE = mat("edge", "eef1f4", 0.15, 0.9)
BRASS = mat("brass", "c99a3a", 0.3, 0.9)
IRON = mat("iron", "2a2328", 0.45, 0.5)
OX = mat("oxblood", "5a1418", 0.6)
WRAP = mat("wrap", "2b0f12", 0.7)

BL, SORI, W = 0.70, 0.075, 0.034   # blade length, curvature (offset at the tip), blade width
def back(t):  # blade spine curve: x offset grows with t^2 (edge on +X, curving toward -X)
    return -SORI * t * t

N = 14
spine, edge = [], []
for i in range(N + 1):
    t = i / N
    z = 0.02 + BL * t
    w = W * (1 - 0.18 * t)
    if t > 0.9:  # kissaki: the edge sweeps up to the spine
        w *= 1 - ((t - 0.9) / 0.1) ** 0.7
    spine.append((back(t) - 0.0, z))
    edge.append((back(t) + w, z))
outline = edge + spine[::-1]
blade = slab("blade", outline, 0.009, STEEL)
bevel(blade, 0.003, 1, 30)
# pale hamon/edge strip
strip = [(x - 0.006, z) for x, z in edge[:-1]] + [(x - 0.016, z) for x, z in edge[-2::-1]]
parts = [blade, slab("edgeband", strip, 0.0105, EDGE)]
parts.append(sweep("habaki", [Vector((0.017, 0, 0.0)), Vector((0.017, 0, 0.035))], [0.022, 0.02], BRASS, nseg=8, squash=0.55))
# tsuba: flat oval disc across the blade
tsu = sweep("tsuba", [Vector((0.017, 0, -0.008)), Vector((0.017, 0, 0.004))], [0.03, 0.03], IRON, nseg=12, squash=0.8)
bevel(tsu, 0.002); parts.append(tsu)
# tsuka (handle) + criss-cross wrap diamonds + kashira (pommel)
HL = 0.24
parts.append(sweep("tsuka", [Vector((0.017, 0, -0.008)), Vector((0.017, 0, -HL))], [0.016, 0.015], OX, nseg=8, squash=0.8))
for k in range(6):
    z0 = -0.025 - k * (HL - 0.04) / 6
    for sgn in (-1, 1):
        for y in (-0.0125, 0.0125):  # diamonds on both flats of the handle
            a = Vector((0.017 - 0.014 * sgn, y, z0)); b = Vector((0.017 + 0.014 * sgn, y, z0 - 0.034))
            parts.append(sweep("wrap", [a, b], [0.004, 0.004], WRAP, nseg=4, squash=0.5))
parts.append(sweep("kashira", [Vector((0.017, 0, -HL)), Vector((0.017, 0, -HL - 0.025)), Vector((0.017, 0, -HL - 0.03))],
                   [0.018, 0.017, 0.0], IRON, nseg=8, squash=0.8))
ob = join(parts, "Katana")
# origin = grip centre
from mathutils import Matrix
ob.data.transform(Matrix.Translation((-0.017, 0, HL * 0.5))); ob.data.update()
fit_weapon(ob, 28, 343, 238)   # card: handle axis rises ~28 deg (tip curves higher), bbox 343 x 238 px
finish(ob, OUT, 30)
