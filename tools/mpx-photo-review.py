"""Generate diagnostic fixed-registration photo/model/overlay panels, not scores.
Requires Pillow (offline review only), reference PDF raster and generator renders.
python3 tools/mpx-photo-review.py
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
REVIEW = ROOT / '.tmp-rend/mpx'
record = json.loads((ROOT / 'assets/weapons/sig-mpx/photo-review.json').read_text())
r = record['registration']
reference_path = REVIEW / 'references' / record['source']['image']
assert reference_path.exists(), 'Rasterize SIG 2019 PDF page 25 at scale-to 1800 (see REFERENCES.md)'
ref = Image.open(reference_path).convert('RGB')
assert list(ref.size) == record['source']['rasterSize']
model = Image.open(REVIEW / 'model/right.png').convert('RGBA')
assert list(model.size) == r['candidateRenderSize']
# Orthographic camera is axis-aligned with the +X/+Z reference plane.
pixels_per_metre = model.width / r['candidateOrthoScale']
scale = 1 / (r['metresPerReferencePixel'] * pixels_per_metre)
anchor = [model.width / 2 - r['candidateCameraTarget'][0] * pixels_per_metre,
          model.height / 2 + r['candidateCameraTarget'][2] * pixels_per_metre]
translation = [r['referenceWorldOriginPx'][i] - scale * anchor[i] for i in range(2)]
registered = model.transform(ref.size, Image.Transform.AFFINE,
    (1/scale, 0, -translation[0]/scale, 0, 1/scale, -translation[1]/scale),
    resample=Image.Resampling.BICUBIC)
white = Image.new('RGBA', ref.size, 'white')
white.alpha_composite(registered)
crop = tuple(r['referenceCrop'])
ref_crop = ref.crop(crop)
model_crop = white.convert('RGB').crop(crop)
overlay = Image.blend(ref_crop, model_crop, .5)
width, height = ref_crop.size
board = Image.new('RGB', (width, 3 * (height+50) + 85), '#101820')
draw = ImageDraw.Draw(board)
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 19)
for i,(label,image) in enumerate([
    ('REFERENCE — labelled 8-inch MPX / SIG 2019 p.23', ref_crop),
    ('CANDIDATE — same frozen uniform registration; static, unapproved', model_crop),
    ('50% OVERLAY — diagnostic only, NOT a likeness or RGB score', overlay),
]):
    y=i*(height+50)
    draw.text((12,y+14),label,font=font,fill='#dce6ef')
    board.paste(image,(0,y+50))
draw.text((12,3*(height+50)+10),'Accessory change / photo perspective / annotation are not hidden.',font=font,fill='#ffd27b')
draw.text((12,3*(height+50)+40),'No nonuniform stretching, elastic warping or after-only camera fit.',font=font,fill='#dce6ef')
board.save(REVIEW / 'photo-comparison.png')
registered.save(REVIEW / 'registered-candidate.png')
(REVIEW / 'photo-registration-result.json').write_text(json.dumps({
    'scale':scale,'translationPx':translation,'sourceRecord':record,
    'claim':'Diagnostic overlay only; no automated human-fidelity acceptance',
},indent=2)+'\n')
print(REVIEW / 'photo-comparison.png')
