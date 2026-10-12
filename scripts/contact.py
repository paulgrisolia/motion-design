"""Contact sheet: tile frames with timestamps.
usage: python3 scripts/contact.py <frames_dir_or_video> <out.png> [cols] [tile_width]
If given a video, samples one frame every 0.5s with ffmpeg.
"""
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 6
tw = int(sys.argv[4]) if len(sys.argv) > 4 else 480

if os.path.isfile(src):
    tmp = tempfile.mkdtemp()
    subprocess.run(['ffmpeg', '-v', 'error', '-i', src, '-vf', 'fps=2', os.path.join(tmp, 'c_%03d.png')], check=True)
    files = sorted(os.listdir(tmp))
    items = [(os.path.join(tmp, f), (i + 0.5) * 0.5 - 0.25) for i, f in enumerate(files)]
else:
    files = sorted(f for f in os.listdir(src) if f.endswith('.png'))
    def ts(f):
        n = f[:-4].split('_')[1]
        return float(n) if f.startswith('t_') else int(n) / 60
    items = sorted(((os.path.join(src, f), ts(f)) for f in files), key=lambda x: x[1])

th = tw * 9 // 16
pad, lab = 12, 30
rows = (len(items) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (tw + pad) + pad, rows * (th + lab + pad) + pad), (24, 20, 18))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 18)
except OSError:
    font = ImageFont.load_default()
for i, (p, t) in enumerate(items):
    im = Image.open(p).convert('RGB').resize((tw, th), Image.LANCZOS)
    x = pad + (i % cols) * (tw + pad)
    y = pad + (i // cols) * (th + lab + pad)
    sheet.paste(im, (x, y + lab))
    d.text((x, y + 4), f'{t:05.2f}s', fill=(241, 234, 223), font=font)
sheet.save(out)
print('contact sheet ->', out, sheet.size)
