# Generic card-look texture pass (texture_bake.py's approach, made per-material): rough the edges a
# little, UV unwrap, bake every material into ONE illustrated albedo atlas, export one textured material.
#   Blender -b -P card_bake.py -- part.glb [size=1024] [rag_mm=1.0]
# texture_bake.py stays as the exact Phi-Phi recipe. Here each material picks a style by its NAME
# (the build scripts name materials after what they are), colour = its base colour (sampled off the card):
#   wood*            - long grain streaks + darker ring lines along the bat axis, light dings
#   steel/edge/blade/chrome/iron/brass/gold/cap/rose/silver - vertical sheen bands, bright edge
#                      highlight on every hard edge, faint brushed streaks, a few dark scratches
#   tape/wrap/cloth  - matte weave noise, no rim
#   anything else    - "paint": darker same-hue rim round every plate edge (Phi-Phi's hot-pink rim),
#                      broken white highlight streaks on lit edges, light chips on the faces
# All styles: ink (near-black, card hue) on hard edges + AO crevices; low-frequency colour variation.
import bpy, bmesh, sys, math, os, colorsys
from mathutils import noise

a = sys.argv[sys.argv.index("--") + 1:]
GLB = os.path.abspath(a[0])
SIZE = int(a[1]) if len(a) > 1 else 1024
RAG = (float(a[2]) if len(a) > 2 else 1.0) / 1000

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
ob = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
bpy.context.view_layer.objects.active = ob; ob.select_set(True)
me = ob.data

bm = bmesh.new(); bm.from_mesh(me)
sharp = set()
for e in bm.edges:
    if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(40):
        sharp.update(e.verts)
for v in sharp:
    n = noise.noise_vector(v.co * 90.0)
    chip = max(0.0, noise.noise(v.co * 35.0) - 0.45) * 4.0
    v.co += n * RAG * 0.6 - v.normal * RAG * chip
bm.to_mesh(me); bm.free()

bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.006)
bpy.ops.object.mode_set(mode="OBJECT")

METAL = ("steel", "edge", "blade", "chrome", "iron", "brass", "gold", "cap", "rose", "silver", "metal")
MATTE = ("tape", "wrap", "cloth", "leather", "grip")
LIGHT_DIR = (-0.35, -0.55, 0.76)   # key light (Blender Z-up, front -Y): highlights land up-left like the card


def shade(c, k, sat=1.0):
    h, l, s = colorsys.rgb_to_hls(*c[:3])
    r, g, b = colorsys.hls_to_rgb(h, min(max(l * k, 0), 1), min(s * sat, 1))
    return (r, g, b, 1)


def build(m):
    nt = m.node_tree; N = nt.nodes; L = nt.links
    bsdf = N["Principled BSDF"]
    base = tuple(bsdf.inputs["Base Color"].default_value)
    if bsdf.inputs["Base Color"].is_linked:   # already textured (shouldn't happen) - keep
        return
    name = m.name.lower()
    style = "wood" if "wood" in name else "metal" if any(k in name for k in METAL) else \
        "matte" if any(k in name for k in MATTE) else "paint"
    lum = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2]
    dark = lum < 0.03

    def node(t, **kw):
        n = N.new(t)
        for k, v in kw.items(): setattr(n, k, v)
        return n

    def mix(fac, c1, c2, mode="MIX"):
        mx = node("ShaderNodeMix", data_type="RGBA", blend_type=mode)
        if isinstance(fac, float): mx.inputs[0].default_value = fac
        else: L.new(fac, mx.inputs[0])
        for slot, c in ((6, c1), (7, c2)):
            if isinstance(c, tuple): mx.inputs[slot].default_value = c
            else: L.new(c, mx.inputs[slot])
        return mx.outputs[2]
    geo = node("ShaderNodeNewGeometry")
    tc = node("ShaderNodeTexCoord")

    def tex(scale, detail=3, vec=None):
        n = node("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = scale; n.inputs["Detail"].default_value = detail
        L.new(vec if vec is not None else tc.outputs["Object"], n.inputs["Vector"]); return n.outputs["Fac"]

    def thr(fac, lo, hi):
        r = node("ShaderNodeValToRGB"); L.new(fac, r.inputs[0])
        r.color_ramp.elements[0].position = lo; r.color_ramp.elements[1].position = hi
        return r.outputs[0]

    def mul(a_, b_):
        m_ = node("ShaderNodeMath", operation="MULTIPLY")
        for i, x in enumerate((a_, b_)):
            if isinstance(x, float): m_.inputs[i].default_value = x
            else: L.new(x, m_.inputs[i])
        return m_.outputs[0]

    def bevmask(radius, lo, hi):
        bv = node("ShaderNodeBevel", samples=8); bv.inputs["Radius"].default_value = radius
        dp = node("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        L.new(bv.outputs[0], dp.inputs[0]); L.new(geo.outputs["Normal"], dp.inputs[1])
        r = node("ShaderNodeValToRGB"); L.new(dp.outputs["Value"], r.inputs[0])
        r.color_ramp.elements[0].position = lo; r.color_ramp.elements[1].position = hi
        r.color_ramp.elements[0].color = (1, 1, 1, 1); r.color_ramp.elements[1].color = (0, 0, 0, 1)
        return r.outputs[0]

    ld = node("ShaderNodeVectorMath", operation="DOT_PRODUCT"); L.new(geo.outputs["Normal"], ld.inputs[0])
    ld.inputs[1].default_value = LIGHT_DIR
    lit = thr(ld.outputs["Value"], 0.05, 0.5)        # faces turned to the key light
    sep = node("ShaderNodeSeparateXYZ"); L.new(tc.outputs["Object"], sep.inputs[0])

    col = mix(thr(tex(10), 0.3, 0.7), shade(base, 1.06, 1.05), shade(base, 0.92, 1.05))
    if style == "wood":
        # grain: noise stretched along Z (the bat axis) -> long streaks; wave rings for darker lines
        sc = node("ShaderNodeVectorMath", operation="MULTIPLY"); L.new(tc.outputs["Object"], sc.inputs[0])
        sc.inputs[1].default_value = (1.0, 1.0, 0.06)
        g = tex(60, 6, sc.outputs[0])
        col = mix(mul(thr(g, 0.42, 0.62), 0.6), col, shade(base, 1.18, 1.05))
        wv = node("ShaderNodeTexWave", wave_type="BANDS", bands_direction="Z")
        wv.inputs["Scale"].default_value = 3; wv.inputs["Distortion"].default_value = 8; wv.inputs["Detail"].default_value = 3
        L.new(tc.outputs["Object"], wv.inputs["Vector"])
        sw = node("ShaderNodeVectorMath", operation="MULTIPLY"); L.new(tc.outputs["Object"], sw.inputs[0])
        sw.inputs[1].default_value = (30.0, 30.0, 2.0); L.new(sw.outputs[0], wv.inputs["Vector"])
        col = mix(mul(thr(wv.outputs["Fac"], 0.80, 0.9), 0.75), col, shade(base, 0.55))
        col = mix(mul(lit, 0.3), col, shade(base, 1.2, 1.0))
        col = mix(mul(bevmask(0.004, 0.9, 0.97), mul(lit, thr(tex(25), 0.35, 0.5))), col, (1.0, 0.85, 0.6, 1))
        col = mix(mul(thr(tex(26, 2), 0.68, 0.70), 0.8), col, shade(base, 0.5))      # dings
    elif style == "metal":
        # sheen bands across the flats (card steel = light/dark diagonal panels) + brushed streaks
        sk = node("ShaderNodeVectorMath", operation="MULTIPLY"); L.new(tc.outputs["Object"], sk.inputs[0])
        sk.inputs[1].default_value = (1.0, 1.0, 0.08)
        brushed = tex(140, 2, sk.outputs[0])
        diag = node("ShaderNodeMath", operation="ADD"); L.new(sep.outputs["X"], diag.inputs[0]); L.new(sep.outputs["Z"], diag.inputs[1])
        bands = node("ShaderNodeMath", operation="PINGPONG"); bands.inputs[1].default_value = 0.5
        L.new(mul(diag.outputs[0], 7.0), bands.inputs[0])
        lo_c, hi_c = shade(base, 0.78), shade(base, 1.35, 0.7)
        col = mix(thr(bands.outputs[0], 0.18, 0.3), lo_c, col)
        col = mix(mul(lit, 0.55), col, hi_c)
        col = mix(mul(thr(brushed, 0.55, 0.75), 0.25), col, shade(base, 1.4, 0.6))
        col = mix(bevmask(0.004, 0.9, 0.975), col, (0.97, 0.98, 1.0, 1))              # edge highlight
        col = mix(mul(thr(tex(35, 2), 0.70, 0.71), 0.7), col, shade(base, 0.35))      # scratches
    elif style == "matte":
        col = mix(thr(tex(45, 5), 0.3, 0.75), shade(base, 0.8), shade(base, 1.15))
        col = mix(mul(lit, 0.25), col, shade(base, 1.4))
    else:
        rim_c = shade(base, 0.55, 1.15) if not dark else shade(base, 1.6)
        col = mix(bevmask(0.012, 0.93, 0.985), col, rim_c)
        col = mix(mul(lit, 0.3), col, shade(base, 1.12, 1.0) if not dark else shade(base, 2.5, 0.8))
        hl_c = (1.0, 0.93, 0.95, 1) if not dark else (0.32, 0.33, 0.4, 1)
        col = mix(mul(mul(bevmask(0.004, 0.9, 0.97), lit), thr(tex(25), 0.35, 0.5)), col, hl_c)
        col = mix(mul(thr(tex(28, 2), 0.67, 0.69), thr(tex(6), 0.45, 0.6)), col,
                  shade(base, 1.5, 0.8) if not dark else (0.2, 0.2, 0.25, 1))
    # ink on hard edges + crevices (dark near-black in the material's hue)
    ink = shade(base, 0.12) if lum > 0.02 else (0.004, 0.003, 0.006, 1)
    ao = node("ShaderNodeAmbientOcclusion", samples=16, only_local=True); ao.inputs["Distance"].default_value = 0.01 if style != "metal" else 0.004
    aoi = node("ShaderNodeMath", operation="SUBTRACT"); aoi.inputs[0].default_value = 1.0
    L.new(thr(ao.outputs["AO"], 0.35, 0.8), aoi.inputs[1])
    inkm = node("ShaderNodeMath", operation="MAXIMUM")
    L.new(mul(bevmask(0.0016 if style != "metal" else 0.0007, 0.80, 0.93), 1.0 if style != "metal" else 0.35), inkm.inputs[0]); L.new(mul(aoi.outputs[0], 1.0 if style != "metal" else 0.3), inkm.inputs[1])
    col = mix(inkm.outputs[0], col, ink)
    L.new(col, bsdf.inputs["Base Color"])


metal_area = 0.0; area = 0.0
for p in me.polygons:
    area += p.area
    if any(k in me.materials[p.material_index].name.lower() for k in METAL): metal_area += p.area
for m in me.materials:
    build(m)

sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.cycles.samples = 16; sc.cycles.device = "CPU"
stem = os.path.splitext(os.path.basename(GLB))[0]
img = bpy.data.images.new(stem + "_albedo", SIZE, SIZE)
for m in me.materials:
    t = m.node_tree.nodes.new("ShaderNodeTexImage"); t.image = img
    m.node_tree.nodes.active = t
sc.render.bake.use_pass_direct = False; sc.render.bake.use_pass_indirect = False
sc.render.bake.use_pass_color = True; sc.render.bake.margin = 6
bpy.ops.object.bake(type="DIFFUSE")
img.pack()

out = bpy.data.materials.new(stem + "_card")
out.use_nodes = True
b = out.node_tree.nodes["Principled BSDF"]
t = out.node_tree.nodes.new("ShaderNodeTexImage"); t.image = img
out.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"])
mf = metal_area / max(area, 1e-9)
b.inputs["Roughness"].default_value = 0.5 - 0.15 * mf   # a touch glossier on bladed parts, never chrome
b.inputs["Metallic"].default_value = 0.25 * mf
me.materials.clear(); me.materials.append(out)
for p in me.polygons: p.material_index = 0
print("TRIS", sum(len(p.vertices) - 2 for p in me.polygons), "metal", round(mf, 2))
bpy.ops.export_scene.gltf(filepath=GLB, export_format="GLB", use_selection=True, export_yup=True,
                          export_image_format="JPEG", export_jpeg_quality=88)
