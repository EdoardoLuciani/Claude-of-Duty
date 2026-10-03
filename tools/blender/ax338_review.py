"""Saved-source Eevee review; never saves/rebuilds the asset.
--photos uses frozen brochure registration; --baseline imports old GLB + seats.
--reel renders native controls and shared review hands at 30 fps.
"""
import argparse
import json
import sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
ROOT=Path(__file__).resolve().parents[2];C=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
p=argparse.ArgumentParser()
p.add_argument('--out',type=Path,required=True);p.add_argument('--baseline',type=Path);p.add_argument('--photos',action='store_true');p.add_argument('--clip',default='Idle');p.add_argument('--time',type=float,default=0);p.add_argument('--hands',action='store_true');p.add_argument('--reel',action='store_true');p.add_argument('--view',action='append')
a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []);a.out.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene
if a.baseline:
    for o in list(bpy.data.objects):
        if o.type in ('MESH','ARMATURE','EMPTY'):bpy.data.objects.remove(o,do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=str(a.baseline.resolve()))
    meta=json.loads(a.baseline.with_suffix('.json').read_text())
    for name,node in [('magazine','magSeat'),('charging','chargeRest'),('bolt','boltRest'),('trigger','triggerPivot'),('selector','selectorPivot')]:
        o=bpy.data.objects.get('sniper-'+name)
        if o:o.location=C@Vector(meta['nodes'][node]['pos'])
    colors={'polymer_tan':(.50,.40,.265),'polymer':(.023,.026,.028),'rubber':(.015,.017,.018),'cavity':(.005,.005,.005),'steel':(.045,.051,.052)}
    for m in bpy.data.materials:
        if m.use_nodes:
            shader=m.node_tree.nodes.get('Principled BSDF')
            if shader:shader.inputs['Base Color'].default_value=(*colors.get(m.name,(.05,.055,.06)),1)
else:
    for o in bpy.data.objects:
        if o.animation_data:
            o.animation_data.action=None
            for track in o.animation_data.nla_tracks:track.mute=track.name!=a.clip
    scene.frame_set(round(a.time*120));bpy.context.view_layer.update()
    for o in bpy.data.objects:
        q=o;is_hand=False
        while q:
            is_hand=is_hand or q.name.startswith('AX338_arm_');q=q.parent
        if o.type=='MESH':o.hide_render=is_hand and not a.hands
scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=48;scene.eevee.use_raytracing=False
scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.resolution_percentage=100
if a.photos:views=json.loads((ROOT/'assets/weapons/ax338/photo-review.json').read_text())
else:
    views=[]
    for name,direction in [('hero',(1,.35,1)),('left',(-1,0,0)),('right',(1,0,0)),('top',(0,1,.02)),('bolt_detail',(1,.3,.5)),('stock_detail',(-1,.3,.3)),('optic_detail',(1,.4,.6))]:
        center=Vector((0,.035,-.245));scale=1.40
        if name=='bolt_detail':center=Vector((.025,.060,.02));scale=.30
        if name=='stock_detail':center=Vector((0,.035,.230));scale=.38
        if name=='optic_detail':center=Vector((0,.172,-.13));scale=.48
        views.append({'name':name,'image_size':[1600,900],'center':list(center),'pixels_per_metre':1600/scale,'rotation_blender':(C@Vector(direction)).to_track_quat('Z','Y').to_matrix()})
if a.view:views=[v for v in views if v['name'] in a.view]
assert views,'No matching review views'
for v in views:
    w,h=v['image_size'];scene.render.resolution_x=w;scene.render.resolution_y=h
    d=bpy.data.cameras.new(v['name']);cam=bpy.data.objects.new(v['name'],d);scene.collection.objects.link(cam)
    rotation=v.get('rotation_blender') or C@Matrix(v['camera_rotation']);center=C@Vector(v['center'])
    cam.matrix_world=rotation.to_4x4();cam.location=center+rotation.col[2]*2;d.type='ORTHO';d.ortho_scale=max(w,h)/v['pixels_per_metre'];scene.camera=cam
    if a.reel:
        info=json.loads(scene['clips'])[a.clip];scene.frame_start=0;scene.frame_end=round(info['duration']*120);scene.frame_step=4
        scene.render.filepath=str(a.out/(v['name']+'-'));bpy.ops.render.render(animation=True);break
    scene.render.filepath=str(a.out/(v['name']+'.png'));bpy.ops.render.render(write_still=True)
