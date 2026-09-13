"""Review the saved Blender skin/pose actions, not a reconstruction.
blender -b assets/player/arms/player-arms.blend --python tools/blender/player_arms_review.py -- --pose gripPistol --render
Add --reel to render the entire pose library (requires ffmpeg).
"""
import argparse
from pathlib import Path
import subprocess
import sys
import tempfile
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--pose', default='gripPistol')
parser.add_argument('--frame', type=int, default=20)
parser.add_argument('--render', action='store_true')
parser.add_argument('--reel', action='store_true')
parser.add_argument('--out', default=str(ROOT/'assets/player/arms/review'))
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
rig = bpy.data.objects['Player_arm_rig']
tracks = rig.animation_data.nla_tracks

def select(name, frame):
    expected = 'Pose_'+name
    if not any(t.name == expected for t in tracks):
        raise ValueError('Unknown pose: '+name)
    rig.animation_data.action = None
    for t in tracks:
        t.mute = t.name != expected
    scene.frame_set(frame)

select(args.pose, args.frame)
# Camera positions here are native Blender coordinates, targeting the glove.
cam = scene.camera
cam.location = (.19, .04, .34)
target = Vector((.015,.082,0))
cam.rotation_euler = (target-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.ortho_scale = .29
scene.render.resolution_x = 900
scene.render.resolution_y = 900
scene.cycles.samples = 32
scene.cycles.use_denoising = True
if args.render:
    scene.render.filepath = str(out/(args.pose+'.png'))
    bpy.ops.render.render(write_still=True)
if args.reel:
    scene.render.resolution_x = 600
    scene.render.resolution_y = 600
    scene.cycles.samples = 12
    with tempfile.TemporaryDirectory(prefix='player-arms-reel-') as temp:
        index = 0
        for track in tracks:
            for frame in range(1,53,4):
                select(track.name.removeprefix('Pose_'), frame)
                scene.render.filepath = str(Path(temp)/f'{index:04}.png')
                bpy.ops.render.render(write_still=True)
                index += 1
        subprocess.run(['ffmpeg','-y','-loglevel','error','-framerate','15','-i',str(Path(temp)/'%04d.png'),
            '-c:v','libx264','-pix_fmt','yuv420p','-crf','19','-movflags','+faststart',str(out/'pose-library.mp4')],check=True)
# Deliberately do not overwrite the user's editable source file.
