"""Render the saved P320 source, never reconstruct it.
blender -b assets/weapons/p320-compact/p320-compact.blend --python tools/blender/p320_review.py -- --reel
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import bpy

root=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser()
p.add_argument('--clip',default='Idle')
p.add_argument('--frame',type=int,default=0)
p.add_argument('--camera',default='hero')
p.add_argument('--hands',action='store_true')
p.add_argument('--reel',action='store_true')
p.add_argument('--quick',action='store_true')
p.add_argument('--out',default=str(root/'assets/weapons/p320-compact/renders'))
a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
s=bpy.context.scene;clips=json.loads(s['clips']);out=Path(a.out);out.mkdir(parents=True,exist_ok=True)

def select(name,frame):
    for o in s.objects:
        if not o.animation_data:continue
        o.animation_data.action=None
        for t in o.animation_data.nla_tracks:t.mute=t.name!=name
    s.frame_set(frame)

for o in bpy.data.collections['P320 | authored hands (shared appearance)'].objects:
    if o.type=='MESH':o.hide_render=not(a.hands or a.reel)
s.camera=bpy.data.objects['CAM_'+('first_person' if a.reel else a.camera.replace('-','_'))]
s.render.resolution_percentage=100
if a.quick or a.reel:
    s.render.engine='CYCLES';s.cycles.samples=12;s.cycles.use_denoising=True
    s.render.resolution_x=960;s.render.resolution_y=720
else:
    s.render.engine='CYCLES';s.cycles.samples=96
    s.render.resolution_x=1920;s.render.resolution_y=1440
if not a.reel:
    select(a.clip,a.frame);s.render.filepath=str(out/f'{a.clip}-{a.frame:03d}-{a.camera}.png')
    bpy.ops.render.render(write_still=True)
else:
    scratch=root/'.tmp-rend/p320-reel';scratch.mkdir(parents=True,exist_ok=True)
    s.camera.data.ortho_scale=.42
    videos=[]
    for name,info in clips.items():
        frames=info['frames'][1]
        step=1 if name in ('Fire','Last_Shot') else 2
        fps=12 if step==1 else 30
        index=0
        # Short firing clips shown at 20% speed; other actions at real time.
        for frame in range(0,frames+1,step):
            select(name,frame);s.render.filepath=str(scratch/f'{name}-{index:04d}.png')
            bpy.ops.render.render(write_still=True);index+=1
        video=scratch/f'{name}.mp4';videos.append(video)
        label=name.replace('_',' ') + ('  [20% speed]' if step==1 else '')
        subprocess.run(['ffmpeg','-y','-loglevel','error','-framerate',str(fps),'-i',str(scratch/f'{name}-%04d.png'),'-frames:v',str(round(index*30/fps)),
            '-vf',f"drawtext=expansion=none:text='P320 COMPACT  |  {label}':x=24:y=24:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=10",
            '-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-r','30',str(video)],check=True)
    listing=scratch/'clips.txt';listing.write_text(''.join("file '"+str(v)+"'\n" for v in videos))
    subprocess.run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',str(listing),
                    '-c','copy','-movflags','+faststart',str(out/'animation-reel.mp4')],check=True)
print('P320_REVIEW_COMPLETE',out)
