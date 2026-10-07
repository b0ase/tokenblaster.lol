"""Card canvas <-> chibi base mask registration, worked out once from the Ayumi card (the chibi's
own mask design) against the base mask mesh seen front-on (Blender: front = -Y, up = +Z).

Cards are 961x1441 and share one canvas with the character. The chibi's head is wider than the
2D face relative to its height, so the mapping is non-uniform:
  canvas_x = CX + x * SX     (respirator centres +-0.08 m  <->  canvas x ~380 / ~575)
  canvas_y = CY + (Z0 - z) * SZ   (nose bridge z 0.569 <-> y 690, chin edge z 0.454 <-> y 787)
"""
CX, SX = 480.0, 1220.0
Z0, CY, SZ = 0.569, 690.0, 843.0
# Region of the canvas the mesh can see, with margin (left, top, right, bottom).
CROP = (280, 560, 680, 810)
TEX_W, TEX_H = 512, 320
