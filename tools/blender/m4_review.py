"""Render isolated M4 views from the saved source; never rebuild or save it.
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend --python-exit-code 1 \
  --python tools/blender/m4_review.py -- --out .tmp-rend/m4-views
Repeat --view to select angles; default is all ten. These are overview cameras,
not registered photographic comparisons (use m4_photo_review.py for those).
"""
import argparse
import json
import sys
from pathlib import Path
import bpy
from mathutils import Vector, Matrix

views=[('left',(-1,0,0)),('right',(1,0,0)),('top',(0,1,0)),('bottom',(0,-1,0)),
       ('front',(0,0,-1)),('rear',(0,0,1)),('front-left',(-1,.45,-.8)),
       ('front-right',(1,.45,-.8)),('rear-left',(-1,.4,.8)),('rear-right',(1,.4,.8))]
p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True)
p.add_argument('--view',choices=[name for name,_ in views],action='append')
a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
a.out.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene;asset=bpy.data.collections['M4A1 | authored components']
C=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
for o in bpy.data.objects:
    if o.animation_data:
        o.animation_data.action=None
        for track in o.animation_data.nla_tracks:track.mute=track.name!='Idle'
scene.frame_set(0);bpy.context.view_layer.update()
def excluded(o):
    while o:
        if o.name in ('magazine_spare','magazine_spare_round','spent_case'):return True
        o=o.parent
    return False
visible=[]
for o in bpy.data.objects:
    if o.type!='MESH':continue
    o.hide_render=o not in asset.objects.values() or excluded(o)
    if not o.hide_render:visible.append(o)
assert visible
# Evaluate visible weapon bounds, not review hands or scale-zero props.
dg=bpy.context.evaluated_depsgraph_get();points=[]
for o in visible:
    e=o.evaluated_get(dg);points.extend(e.matrix_world@Vector(v) for v in e.bound_box)
lo=Vector(tuple(min(v[i] for v in points) for i in range(3)))
hi=Vector(tuple(max(v[i] for v in points) for i in range(3)));center=(lo+hi)*.5
scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=48;scene.eevee.use_raytracing=False
scene.render.resolution_x=1920;scene.render.resolution_y=1280;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.render.film_transparent=True
camera=bpy.data.objects['CAM_hero'];scene.camera=camera;camera.data.type='ORTHO'
record=[]
for index,(name,direction) in enumerate(views,1):
    if a.view and name not in a.view:continue
    direction=(C@Vector(direction)).normalized();camera.location=center+direction*2
    camera.rotation_euler=(-direction).to_track_quat('-Z','Y').to_euler()
    inverse=camera.rotation_euler.to_quaternion().inverted()
    projected=[inverse@(v-center) for v in points]
    width=max(v.x for v in projected)-min(v.x for v in projected)
    height=max(v.y for v in projected)-min(v.y for v in projected)
    camera.data.ortho_scale=max(width,height*1.5)*1.16
    scene.render.filepath=str(a.out/f'{index:02d}-{name}.png');bpy.ops.render.render(write_still=True)
    record.append({'view':name,'game_direction':list(C.inverted()@direction),'ortho_scale':camera.data.ortho_scale})
(a.out/'views.json').write_text(json.dumps({'engine':scene.render.engine,'samples':scene.eevee.taa_render_samples,
    'pose':'Idle / frame 0','hands':False,'spare_magazine':False,'review_case':False,'views':record},indent=2))
print('M4_GUN_ONLY_VIEWS_COMPLETE',len(record))
