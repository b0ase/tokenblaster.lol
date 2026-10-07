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
    ink = (0.09, 0.01, 0.03, 1)
    if navy:
        # vertical rib lines round the cone
        sep = node("ShaderNodeSeparateXYZ"); L.new(tc.outputs["Object"], sep.inputs[0])
        at = node("ShaderNodeMath", operation="ARCTAN2"); L.new(sep.outputs["Y"], at.inputs[0]); L.new(sep.outputs["X"], at.inputs[1])
        mul = node("ShaderNodeMath", operation="MULTIPLY"); mul.inputs[1].default_value = 12 / math.pi * 1.0
        L.new(at.outputs[0], mul.inputs[0])
        fr = node("ShaderNodeMath", operation="PINGPONG"); fr.inputs[1].default_value = 0.5; L.new(mul.outputs[0], fr.inputs[0])
        rib = node("ShaderNodeValToRGB"); L.new(fr.outputs[0], rib.inputs[0])
        rib.color_ramp.elements[0].position = 0.1; rib.color_ramp.elements[1].position = 0.17
        col = mix(rib.outputs[0], (0.025, 0.02, 0.06, 1), col)
        g = node("ShaderNodeTexNoise"); g.inputs["Scale"].default_value = 60
        L.new(tc.outputs["Object"], g.inputs["Vector"])
        gr = node("ShaderNodeValToRGB"); L.new(g.outputs["Fac"], gr.inputs[0])
        gr.color_ramp.elements[0].position = 0.55; gr.color_ramp.elements[1].position = 0.7
        gr.color_ramp.elements[0].color = (1, 1, 1, 1); gr.color_ramp.elements[1].color = (0.7, 0.7, 0.75, 1)
        mg = node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY"); mg.inputs[0].default_value = 1.0
        L.new(col, mg.inputs[6]); L.new(gr.outputs[0], mg.inputs[7]); col = mg.outputs[2]
    else:
        # highlight streak on convex, upward-facing edges
        sz = node("ShaderNodeSeparateXYZ"); L.new(geo.outputs["Normal"], sz.inputs[0])
        up = node("ShaderNodeMath", operation="GREATER_THAN"); up.inputs[1].default_value = 0.25; L.new(sz.outputs["Z"], up.inputs[0])
        hl = node("ShaderNodeMath", operation="MULTIPLY"); L.new(pr.outputs[0], hl.inputs[0]); L.new(up.outputs[0], hl.inputs[1])
        light = tuple(min(1.0, c * 0.75 + 0.22) for c in base[:3]) + (1,)
        col = mix(hl.outputs[0], col, light)
        # scuffs / chipped wear near edges
        sc = node("ShaderNodeTexNoise"); sc.inputs["Scale"].default_value = 140; sc.inputs["Detail"].default_value = 2
        L.new(tc.outputs["Object"], sc.inputs["Vector"])
        scr = node("ShaderNodeValToRGB"); L.new(sc.outputs["Fac"], scr.inputs[0])
        scr.color_ramp.elements[0].position = 0.655; scr.color_ramp.elements[1].position = 0.685
        wear = node("ShaderNodeMath", operation="MULTIPLY"); L.new(scr.outputs[0], wear.inputs[0])
        wv = node("ShaderNodeMath", operation="ADD"); wv.inputs[1].default_value = 0.2; L.new(pr.outputs[0], wv.inputs[0])
        L.new(wv.outputs[0], wear.inputs[1])
        chipc = tuple(c * 0.55 for c in base[:3]) + (1,)
        col = mix(wear.outputs[0], col, chipc)
    # ink: concave edges + crevice AO
    inkm = node("ShaderNodeMath", operation="MULTIPLY"); L.new(cr.outputs[0], inkm.inputs[0]); L.new(aor.outputs[0], inkm.inputs[1])
    col = mix(inkm.outputs[0], ink, col)
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
