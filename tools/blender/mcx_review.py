"""Preview the committed Blender asset; does not rebuild or modify the source.
blender -b assets/weapons/mcx-virtus/mcx-virtus.blend \
  --python tools/blender/mcx_review.py -- --clip Fire --frame 8 --camera receiver_detail
Use --reel to render and encode all six clips (requires local ffmpeg).
Use --select-only interactively to select synchronized NLA tracks without rendering.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys

import bpy

root = Path(__file__).resolve().parents[2]
out = root / 'assets/weapons/mcx-virtus/renders'
scene = bpy.context.scene
clips = json.loads(scene['clips'])
parser = argparse.ArgumentParser()
parser.add_argument('--clip', choices=clips, default='Idle')
parser.add_argument('--frame', type=float, default=0)
parser.add_argument('--camera', default='hero', choices=['hero', 'right_profile', 'left_profile', 'receiver_detail', 'first_person'])
parser.add_argument('--reel', action='store_true')
parser.add_argument('--select-only', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])


def select(name, frame):
    for obj in bpy.data.collections['MCX VIRTUS | authored components'].objects:
        if obj.animation_data:
            for track in obj.animation_data.nla_tracks:
                track.mute = track.name != name
    scene.frame_start = 0
    scene.frame_end = clips[name]['frames'][1]
    scene.frame_set(int(frame), subframe=frame % 1)


scene.camera = bpy.data.objects['CAM_' + args.camera]
select(args.clip, args.frame)
if args.select_only:
    print('Selected', args.clip, 'on every articulated part')
elif not args.reel:
    scene.render.filepath = str(out / f'{args.clip}-{args.frame:g}.png')
    bpy.ops.render.render(write_still=True)
else:
    if not shutil.which('ffmpeg'):
        raise RuntimeError('Install ffmpeg to encode the preview reel')
    scratch = root / '.tmp-rend/mcx-reel'
    scratch.mkdir(parents=True, exist_ok=True)
    scene.render.resolution_x = 960
    scene.render.resolution_y = 540
    scene.render.resolution_percentage = 100
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    sequence = [('Idle', 'hero', 1), ('Fire', 'receiver_detail', .5),
                ('Reload_Tactical', 'hero', 1), ('Reload_Empty', 'hero', 1),
                ('Inspect', 'hero', 1), ('Stock_Fold', 'hero', 1)]
    frame_index = 0
    labels = []
    for name, cam, speed in sequence:
        scene.camera = bpy.data.objects['CAM_' + cam]
        count = round(clips[name]['duration'] / speed * 24)
        label = name.replace('_', ' ').upper() + (' / HALF SPEED' if speed == .5 else '')
        labels.append((frame_index/24, (frame_index+count)/24, label))
        for i in range(count):
            select(name, min(clips[name]['frames'][1], i * 60 / 24 * speed))
            scene.render.filepath = str(scratch / f'{frame_index:04d}.png')
            bpy.ops.render.render(write_still=True)
            frame_index += 1
    filters = ["drawtext=text='MCX VIRTUS  /  .300 BLK':x=32:y=28:fontsize=24:fontcolor=white",
               "drawtext=text='WEAPON-ONLY ANIMATION STUDY  /  NO HAND RIG':x=32:y=h-35:fontsize=12:fontcolor=0xabb8c3"]
    for start, end, label in labels:
        filters.append(f"drawtext=text='{label}':x=32:y=62:fontsize=15:fontcolor=0xc9a87a:enable='gte(t,{start})*lt(t,{end})'")
    subprocess.run(['ffmpeg', '-y', '-framerate', '24', '-i', str(scratch/'%04d.png'),
                    '-frames:v', str(frame_index), '-vf', ','.join(filters), '-c:v', 'libx264',
                    '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
                    str(out/'animation-reel.mp4')], check=True)
    print('REEL_COMPLETE', frame_index, 'frames')
