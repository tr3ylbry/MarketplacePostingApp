"""Offline public synthetic vectors; Pillow is regeneration tooling, not an app dependency."""
from pathlib import Path
from PIL import Image, PngImagePlugin

out = Path(__file__).parent
raw = bytearray([245]) * (500 * 600 * 3)

def rect(x, y, w, h, color):
    for j in range(y, y + h):
        for i in range(x, x + w):
            raw[(j * 500 + i) * 3:(j * 500 + i) * 3 + 3] = bytes(color)

rect(20, 125, 460, 100, [49, 90, 138])
for n in range(12):
    rect(28 + n * 15, 140 + n * 5, 12, 10, [250, 205, 35])
for y in range(235, 255, 4):
    for x in range(160, 310, 8):
        rect(x, y, 4, 2, [30, 35, 40])
for x, y, w, h, rgb in [(24,28,68,52,[224,40,40]), (365,38,82,64,[35,180,65]), (35,265,94,71,[35,75,220]), (340,285,109,49,[235,190,25])]:
    rect(x, y, w, h, rgb)
bits = '1010010100111100' + ''.join(f'{i*13:08b}' for i in range(16))
rect(98,392,304,144,[255,255,255])
for i, bit in enumerate(bits):
    value = 235 if bit == '1' else 20
    rect(106 + i % 18 * 16, 400 + i // 18 * 16, 16,16,[value]*3)
rect(410,555,55,15,[80,45,130])
for i, bit in enumerate('100110'):
    value = 235 if bit == '1' else 20
    rect(20+i%3*12,550+i//3*12,12,12,[value]*3)
image = Image.frombytes('RGB',(500,600),bytes(raw))
meta = PngImagePlugin.PngInfo()
meta.add_text('Software','Independent synthetic fixture')
image.save(out/'independent.png',pnginfo=meta,compress_level=9)
image.save(out/'independent-q85.jpg',quality=85,subsampling=2,progressive=True)
image.save(out/'animated.png',save_all=True,append_images=[Image.new('RGB',(500,600),'white')],duration=100,loop=0)
over = PngImagePlugin.PngInfo()
over.add_text('Comment','x'*65536)
image.save(out/'metadata-over.png',pnginfo=over)
print('Generated four public, non-personal independent codec fixtures.')
