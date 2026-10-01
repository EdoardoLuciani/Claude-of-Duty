"""Render fixed photographic review cameras; never save/change the source.
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend --python-exit-code 1 \
  --python tools/blender/m4_photo_review.py -- --out .tmp-rend/m4-photo/after
Camera estimates/limitations: asset README.md and registration JSONs.
"""
import argparse
import json
import sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True)
p.add_argument('--registration',type=Path,default=ROOT/'assets/weapons/m4a1-block-ii/photo-review.json')
args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
args.out.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene;C=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
for o in bpy.data.objects:
    if o.animation_data:
        o.animation_data.action=None
        for track in o.animation_data.nla_tracks:track.mute=track.name!='Idle'
scene.frame_set(0);bpy.context.view_layer.update()
asset=bpy.data.collections['M4A1 | authored components']
scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=24;scene.eevee.use_raytracing=False
scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG'
scene.render.image_settings.color_mode='RGBA';scene.render.resolution_percentage=100
views=json.loads(args.registration.read_text())
for v in views:
    for o in bpy.data.objects:
        if o.type!='MESH':continue
        roots=[];q=o
        while q:roots.append(q.name);q=q.parent
        visible=o.name in asset.objects and not any(s in roots for s in ('magazine_spare','magazine_spare_round','spent_case'))
        if v['component'] not in ('rifle','magazine'):visible=visible and 'magazine' not in roots
        if v['component']=='rifle':pass
        elif v['component']=='magazine':visible=visible and 'magazine' in roots
        elif v['component']=='stock':visible=visible and 'stock' in roots
        elif v['component']=='lower':visible=visible and 'stock' not in roots and 'handguard' not in roots and o.name.startswith(('Colt lower','GI trigger','GI guard','Takedown','Bolt catch','Magazine release','Magazine button','Selector','Curved trigger','A2 sculpted','A2 finger','A2 grip','Mark |','Receiver end','Buffer extension','Castle nut'))
        elif v['component']=='receiver':visible=visible and 'handguard' not in roots and 'stock' not in roots and o.name.startswith(('Colt upper','Upper receiver','Brass deflector','Forward assist','Dust cover','Charging'))
        else:visible=visible and 'stock' not in roots and not o.name.startswith(('Colt lower','GI trigger','GI guard','Takedown','Bolt catch','Magazine release','Magazine button','Selector','Curved trigger','A2 sculpted','A2 finger','A2 grip','Mark |','Receiver end','Buffer extension','Castle nut','MaTech'))
        o.hide_render=not visible
    w,h=v['image_size'];scene.render.resolution_x=w;scene.render.resolution_y=h
    d=bpy.data.cameras.new(v['name']);cam=bpy.data.objects.new(v['name'],d);scene.collection.objects.link(cam)
    rotation=C@Matrix(v['camera_rotation']);center=C@Vector(v['center'])
    cam.matrix_world=rotation.to_4x4();cam.location=center+rotation.col[2]*2
    d.type='ORTHO';d.ortho_scale=max(w,h)/v['pixels_per_metre'];scene.camera=cam
    scene.render.filepath=str(args.out/(v['name']+'.png'));bpy.ops.render.render(write_still=True)
