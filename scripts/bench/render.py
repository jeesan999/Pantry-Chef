import sys, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
random.seed(7)
font_path = sys.argv[1]
for name in ['woolworths','coles','aldi','spudshed']:
    lines = open(f'/home/claude/personal-chef/src/receipts/fixtures/{name}.txt').read().rstrip('\n').split('\n')
    font = ImageFont.truetype(font_path, 30)
    w, lh = 900, 42
    img = Image.new('L', (w, lh*len(lines)+120), 236)
    d = ImageDraw.Draw(img)
    for i, l in enumerate(lines):
        d.text((50, 60+i*lh), l, fill=random.randint(30,70), font=font)
    # paper speckle
    px = img.load()
    for _ in range(4000):
        x, y = random.randrange(w), random.randrange(img.height)
        px[x,y] = random.randint(150,255)
    img = img.filter(ImageFilter.GaussianBlur(0.8)).rotate(1.5, expand=True, fillcolor=236)
    # mimic a phone photo: larger, slightly uneven light
    img = img.resize((int(img.width*1.4), int(img.height*1.4)))
    grad = Image.linear_gradient('L').resize(img.size).point(lambda v: v//6)
    img = Image.composite(img, Image.new('L', img.size, 200), Image.new('L', img.size, 255))
    img = Image.eval(img, lambda v: v)  
    from PIL import ImageChops
    img = ImageChops.subtract(img, grad)
    img.convert('RGB').save(f'/tmp/ocrbench/{name}.jpg', quality=85)
    print(name, img.size)
