import sys
from PIL import Image
p=sys.argv[1]
s=Image.new('RGB',(2400,600),'white')
for i,v in enumerate(['front','34','side','back']): s.paste(Image.open(f'{p}_{v}.png').convert('RGB'),(i*600,0))
s.save(f'{p}_strip.png')
