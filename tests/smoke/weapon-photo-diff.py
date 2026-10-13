"""Offline photo CLI regression; optionally compare all outputs to a git baseline.
python3 tests/smoke/weapon-photo-diff.py --baseline-ref <revision>
Requires the same optional Pillow/NumPy installation as the photo tools.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
p = argparse.ArgumentParser()
p.add_argument('--baseline-ref')
args = p.parse_args()
with tempfile.TemporaryDirectory() as directory:
    tmp = Path(directory)
    for name in ('photos', 'before', 'after'):
        (tmp/name).mkdir()
    ref = Image.new('RGB', (640, 360), 'white')
    ImageDraw.Draw(ref).rectangle((20, 20, 119, 79), fill='black')
    ref.save(tmp/'photos/reference.png')
    for name, box in [('before', (21, 20, 120, 79)), ('after', (20, 20, 119, 79))]:
        im = Image.new('RGBA', ref.size)
        draw = ImageDraw.Draw(im)
        draw.rectangle(box, fill=(40, 50, 60, 255))
        draw.rectangle((5, 5, 9, 9), fill=(0, 0, 0, 255))  # excluded
        im.save(tmp/name/'side.png')
    view = dict(name='side', file='reference.png', image_size=list(ref.size),
                rgb_sha256=hashlib.sha256(ref.tobytes()).hexdigest(), roi=[0, 0, 600, 300],
                exclude=[[0, 0, 10, 10]], regions={'stock': [10, 10, 130, 90], 'full': [0, 0, 640, 360]},
                registration={'scale': 1}, source='synthetic', intentional_differences=[])
    registration = tmp/'registration.json'
    registration.write_text(json.dumps([view]))

    def run(script, out, *extra):
        return subprocess.run([sys.executable, str(script), '--photos', str(tmp/'photos'),
                               '--before', str(tmp/'before'), '--after', str(tmp/'after'),
                               '--out', str(out), '--registration', str(registration), *extra],
                              capture_output=True, text=True)

    for weapon in ('evolys', 'ax338'):
        script = ROOT/f'tools/{weapon}-photo-diff.py'
        for region in (None, 'stock'):
            extra = ('--region', region) if region else ()
            out = tmp/f'{weapon}-{region}'
            result = run(script, out, *extra)
            assert result.returncode == 0, result.stderr
            report = json.loads(result.stdout)
            assert report == json.loads((out/'metrics.json').read_text())
            before, after = report[0]['before'], report[0]['after']
            assert before['mask_iou'] == 5940/6060 and before['mask_disagreement_pixels'] == 120
            assert after == dict(mask_iou=1.0, mask_disagreement_pixels=0, roi_pixels=179900,
                                 regions={name: dict(mask_iou=1.0, mask_disagreement_pixels=0, roi_pixels=pixels)
                                          for name, pixels in [('stock', 9600), ('full', 179900)]})
            assert Image.open(out/'overview.png').size == (2560, 300)
            assert Image.open(out/f'{region or "regions"}.png').size == (1600, 340 if region else 680)
            if args.baseline_ref:
                baseline = tmp/f'{weapon}-baseline.py'
                baseline.write_bytes(subprocess.check_output(['git', 'show', f'{args.baseline_ref}:tools/{weapon}-photo-diff.py'], cwd=ROOT))
                old = tmp/f'{weapon}-{region}-baseline'
                previous = run(baseline, old, *extra)
                assert previous.returncode == 0, previous.stderr
                assert result.stdout == previous.stdout
                assert sorted(f.name for f in out.iterdir()) == sorted(f.name for f in old.iterdir())
                for file in out.iterdir():
                    assert file.read_bytes() == (old/file.name).read_bytes(), file.name
        for field, value, message in [('image_size', [1, 1], 'Reference dimensions changed'),
                                      ('rgb_sha256', 'invalid', 'Reference pixels changed')]:
            registration.write_text(json.dumps([{**view, field: value}]))
            result = run(script, tmp/'invalid')
            assert result.returncode != 0 and message in result.stderr
        registration.write_text(json.dumps([view]))
        result = run(script, tmp/'invalid', '--region', 'missing')
        assert result.returncode != 0 and 'No matching region' in result.stderr
        after_path = tmp/'after/side.png'
        original = after_path.read_bytes()
        Image.new('RGBA', (1, 1)).save(after_path)
        assert run(script, tmp/'invalid').returncode != 0, 'after-only resizing must fail'
        after_path.write_bytes(original)
print('ok  weapon-photo-diff: metrics, boards, frozen-registration guards' + ('; baseline byte equivalence' if args.baseline_ref else ''))
