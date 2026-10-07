# Texture pass for a hand-built part: rough the edges a little, UV unwrap, and bake the card's
# hand-drawn look into ONE albedo atlas, then export with a single textured material.
#   Blender -b -P texture_bake.py -- part.glb [size=1024] [rag_mm=1.5]
# Looks painted into the bake (Cycles), per original material colour:
#   ink        - AO in tight crevices + concave edges (pointiness) -> dark seam lines
#   highlights - convex upward-facing edges (band tops) get a light streak, like the card
#   variation  - low-frequency noise tint; scuffs / chipped wear (high-freq noise near edges) on pink
#   navy       - darker vertical rib lines round the cone (radial gradient) + grime noise
# Ragged edges: vertices on sharp edges are nudged by a few mm of 3D noise (silhouette stays crisp).
import bpy, bmesh, sys, math, os
from mathutils import Vector, noise

a = sys.argv[sys.argv.index("--") + 1:]
GLB = os.path.abspath(a[0])
SIZE = int(a[1]) if len(a) > 1 else 1024
RAG = (float(a[2]) if len(a) > 2 else 1.5) / 1000

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
ob = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
me = ob.data

# ---- ragged edges: noise-nudge verts that sit on sharp edges (bevelled rims/plate edges) ----
bm = bmesh.new(); bm.from_mesh(me)
sharp = set()
for e in bm.edges:
    if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(40):
        sharp.update(e.verts)
for v in sharp:
    n = noise.noise_vector(v.co * 90.0)
    chip = max(0.0, noise.noise(v.co * 35.0) - 0.45) * 4.0     # occasional deeper notch
    v.co += n * RAG * 0.6 - v.normal * RAG * chip
bm.to_mesh(me); bm.free()

# ---- UVs ----
bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.006)
bpy.ops.object.mode_set(mode="OBJECT")

# ---- procedural "card" shaders on the existing materials ----
def build(m):
    nt = m.node_tree; N = nt.nodes; L = nt.links
    bsdf = N["Principled BSDF"]
    base = tuple(bsdf.inputs["Base Color"].default_value)
    lum = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2]
    navy = base[2] > base[0] * 1.3 and lum < 0.1
    def node(t, **kw):
        n = N.new(t)
        for k, v in kw.items(): setattr(n, k, v)
        return n
    def mix(fac, c1, c2, mode="MIX"):
        mx = node("ShaderNodeMix", data_type="RGBA", blend_type=mode)
        L.new(fac, mx.inputs[0]) if not isinstance(fac, float) else None
        if isinstance(fac, float): mx.inputs[0].default_value = fac
        for slot, c in ((6, c1), (7, c2)):
            if isinstance(c, tuple): mx.inputs[slot].default_value = c
            else: L.new(c, mx.inputs[slot])
        return mx.outputs[2]
    geo = node("ShaderNodeNewGeometry")
    tc = node("ShaderNodeTexCoord")
    # colour variation
    nz = node("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 18; nz.inputs["Detail"].default_value = 4
    L.new(tc.outputs["Object"], nz.inputs["Vector"])
    var = node("ShaderNodeMapRange"); var.inputs[3].default_value = 0.88; var.inputs[4].default_value = 1.1
    L.new(nz.outputs["Fac"], var.inputs[0])
    mm = node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY"); mm.inputs[0].default_value = 1.0
    mm.inputs[6].default_value = base; L.new(var.outputs[0], mm.inputs[7]); col = mm.outputs[2]
    # edge masks
    pr = node("ShaderNodeValToRGB"); L.new(geo.outputs["Pointiness"], pr.inputs[0])
    pr.color_ramp.elements[0].position = 0.58; pr.color_ramp.elements[1].position = 0.64   # convex
    cr = node("ShaderNodeValToRGB"); L.new(geo.outputs["Pointiness"], cr.inputs[0])
    cr.color_ramp.elements[0].position = 0.42; cr.color_ramp.elements[1].position = 0.49   # 1 - concave
    ao = node("ShaderNodeAmbientOcclusion", samples=16, only_local=True); ao.inputs["Distance"].default_value = 0.012
    aor = node("ShaderNodeValToRGB"); L.new(ao.outputs["AO"], aor.inputs[0])
    aor.color_ramp.elements[0].position = 0.35; aor.color_ramp.elements[1].position = 0.8
    ink = (0.04, 0.002, 0.006, 1)
    def bevmask(radius, lo, hi):
        """1 on/near hard edges: true normal vs a bevel-rounded normal (Cycles Bevel node)."""
        bv = node("ShaderNodeBevel", samples=8); bv.inputs["Radius"].default_value = radius
        dp = node("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        L.new(bv.outputs[0], dp.inputs[0]); L.new(geo.outputs["Normal"], dp.inputs[1])
        r = node("ShaderNodeValToRGB"); L.new(dp.outputs["Value"], r.inputs[0])
        r.color_ramp.elements[0].position = lo; r.color_ramp.elements[1].position = hi
        r.color_ramp.elements[0].color = (1, 1, 1, 1); r.color_ramp.elements[1].color = (0, 0, 0, 1)
        return r.outputs[0]
    def tex(scale, detail=3):
        n = node("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = scale; n.inputs["Detail"].default_value = detail
        L.new(tc.outputs["Object"], n.inputs["Vector"]); return n.outputs["Fac"]
    def thr(fac, lo, hi):
        r = node("ShaderNodeValToRGB"); L.new(fac, r.inputs[0])
        r.color_ramp.elements[0].position = lo; r.color_ramp.elements[1].position = hi
        return r.outputs[0]
    def mul(a, b):
        m_ = node("ShaderNodeMath", operation="MULTIPLY")
        for i, x in enumerate((a, b)):
            if isinstance(x, float): m_.inputs[i].default_value = x
            else: L.new(x, m_.inputs[i])
        return m_.outputs[0]
    sz = node("ShaderNodeSeparateXYZ"); L.new(geo.outputs["Normal"], sz.inputs[0])
    upm = thr(sz.outputs["Z"], 0.15, 0.45)
    if navy:
        col0 = (0.022, 0.022, 0.07, 1)
        sep = node("ShaderNodeSeparateXYZ"); L.new(tc.outputs["Object"], sep.inputs[0])
        at = node("ShaderNodeMath", operation="ARCTAN2"); L.new(sep.outputs["Y"], at.inputs[0]); L.new(sep.outputs["X"], at.inputs[1])
        fr = node("ShaderNodeMath", operation="PINGPONG"); fr.inputs[1].default_value = 0.5
        L.new(mul(at.outputs[0], 7 / math.pi), fr.inputs[0])
        rib = thr(fr.outputs[0], 0.03, 0.07)          # 0 on the rib line
        col = mix(rib, (0.14, 0.14, 0.52, 1), col0)   # lighter blue-violet linework
        scr = thr(tex(9, 6), 0.68, 0.70)
        col = mix(scr, col, (0.2, 0.2, 0.45, 1))
        col = mix(thr(tex(30), 0.3, 0.7), col, (0.035, 0.035, 0.1, 1))
    else:
        hotpink = base[1] < base[0] * 0.1 and base[2] > 0.05   # the hot-pink trim material
        red = base[1] < base[0] * 0.1 and base[2] <= 0.05      # rivets
        light = (0.91, 0.28, 0.45, 1) if not hotpink else (0.75, 0.018, 0.11, 1)   # linear: f590b4 / e0245f
        if red: light = (0.63, 0.009, 0.023, 1)
        col = mix(thr(tex(12), 0.3, 0.7), light, tuple(c * 0.92 for c in light[:3]) + (1,))
        if not red:
            rim = bevmask(0.016, 0.93, 0.985)      # wide hot-pink rim along every plate edge
            col = mix(rim, col, (0.75, 0.018, 0.11, 1))
            # white highlight streaks on upper edges, broken up
            hl = mul(mul(bevmask(0.004, 0.9, 0.97), upm), thr(tex(25), 0.35, 0.5))
            col = mix(hl, col, (1.0, 0.93, 0.96, 1))
            # light chips on the faces
            ch = mul(thr(tex(28, 2), 0.67, 0.69), thr(tex(6), 0.45, 0.6))
            col = mix(ch, col, (1.0, 0.64, 0.75, 1))
    # bold ink on hard edges + crevices
    inkm = node("ShaderNodeMath", operation="MAXIMUM")
    L.new(bevmask(0.0018, 0.80, 0.93), inkm.inputs[0])
    aoi = node("ShaderNodeMath", operation="SUBTRACT"); aoi.inputs[0].default_value = 1.0; L.new(aor.outputs[0], aoi.inputs[1])
    L.new(aoi.outputs[0], inkm.inputs[1])
    col = mix(inkm.outputs[0], col, ink)
    L.new(col, bsdf.inputs["Base Color"])

for m in me.materials:
    build(m)

# ---- bake ----
sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.cycles.samples = 16; sc.cycles.device = "CPU"
img = bpy.data.images.new("phiphi_albedo", SIZE, SIZE)
for m in me.materials:
    t = m.node_tree.nodes.new("ShaderNodeTexImage"); t.image = img
    m.node_tree.nodes.active = t
sc.render.bake.use_pass_direct = False; sc.render.bake.use_pass_indirect = False
sc.render.bake.use_pass_color = True; sc.render.bake.margin = 6
bpy.ops.object.bake(type="DIFFUSE")
img.pack()

# ---- single textured material ----
out = bpy.data.materials.new("phiphi_card")
out.use_nodes = True
b = out.node_tree.nodes["Principled BSDF"]
t = out.node_tree.nodes.new("ShaderNodeTexImage"); t.image = img
out.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"])
b.inputs["Roughness"].default_value = 0.5
me.materials.clear(); me.materials.append(out)
for p in me.polygons: p.material_index = 0
tris = sum(len(p.vertices) - 2 for p in me.polygons)
print("TRIS", tris)
bpy.ops.export_scene.gltf(filepath=GLB, export_format="GLB", use_selection=True, export_yup=True,
                          export_image_format="JPEG", export_jpeg_quality=88)
