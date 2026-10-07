from PIL import Image, ImageDraw, ImageFont
import glob

root = '/private/tmp/claude-501/-Volumes-2026-Projects-tokenblaster-lol/71e6c512-a46b-4775-85a0-4cd4f3360013/scratchpad/build/potions/raw-assets/'
font = ImageFont.truetype(glob.glob('/private/tmp/claude-501/-Volumes-2026-Projects-tokenblaster-lol/71e6c512-a46b-4775-85a0-4cd4f3360013/scratchpad/build/bubbo/raw-assets/fonts/Bungee-Regular*.ttf')[0], 84)
W, H = 448, 204
mask = Image.new('L', (W, H), 0)
d = ImageDraw.Draw(mask)
d.text((W / 2, 52), 'TOKEN', font=font, fill=255, anchor='mm')
d.text((W / 2, 150), 'POTIONS', font=ImageFont.truetype(font.path, 70), fill=255, anchor='mm')
grad = Image.new('RGBA', (W, H))
px = grad.load()
for y in range(H):
    t = y / (H - 1)
    c = (int(60 + (118 - 60) * t), 37, int(126 + (125 - 126) * t), 255)
    for x in range(W):
        px[x, y] = c
out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
out.paste(grad, (0, 0), mask)
out.save(glob.glob(root + 'home*/home-atlas*/logo-game.png')[0])
