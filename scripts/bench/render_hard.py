import sys, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
random.seed(11)
font_path = sys.argv[1]
for name in ['woolworths','coles','aldi','spudshed']:
    lines = open(f'/home/claude/personal-chef/src/receipts/fixtures/{name}.txt').read().rstrip('\n').split('\n')
    font = ImageFont.truetype(font_path, 30)
    w, lh = 900, 42
    img = Image.new('L', (w, lh*len(lines)+120), 225)
    d = ImageDraw.Draw(img)
    for i, l in enumerate(lines):
        # faded thermal print: lighter, uneven ink
        d.text((50, 60+i*lh), l, fill=random.randint(60,110), font=font)
    px = img.load()
    for _ in range(9000):
        x, y = random.randrange(w), random.randrange(img.height)
        px[x,y] = random.randint(120,255)
    img = img.filter(ImageFilter.GaussianBlur(1.3)).rotate(-3.5, expand=True, fillcolor=210)
    img = img.resize((int(img.width*0.8), int(img.height*0.8)))
    shadow = Image.linear_gradient('L').rotate(90).resize(img.size).point(lambda v: int(v*0.35))
    img = ImageChops.subtract(img, shadow)
    img.convert('RGB').save(f'/tmp/ocrbench/hard/{name}.jpg', quality=70)
