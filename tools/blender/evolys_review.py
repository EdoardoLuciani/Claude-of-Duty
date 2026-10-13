"""Saved-source Eevee stills / clip frames / frozen FN photographic cameras.
Never saves or edits the source. --baseline imports the old procedural GLB.
blender -b assets/weapons/fn-evolys-762/fn-evolys-762.blend --python tools/blender/evolys_review.py -- --out .tmp-rend/evolys/after --photos
"""
import argparse
import json
import sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
ROOT=Path(__file__).resolve().parents[2];C=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--baseline',type=Path);p.add_argument('--photos',action='store_true');p.add_argument('--clip',default='Idle');p.add_argument('--time',type=float,default=0);p.add_argument('--hands',action='store_true');p.add_argument('--reel',action='store_true');p.add_argument('--view',action='append')
args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []);args.out.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene
if args.baseline:
    for o in list(bpy.data.objects):
        if o.type in ('MESH','ARMATURE','EMPTY'):bpy.data.objects.remove(o,do_unlink=True)
    bpy.ops.import_scene.gltf(filepath=str(args.baseline.resolve()))
    meta=json.loads(args.baseline.with_suffix('.json').read_text())
    for name,node in [('magazine','magSeat'),('charging','chargeRest'),('bolt','boltRest'),('trigger','triggerPivot'),('selector','selectorPivot')]:
        o=bpy.data.objects.get('lmg-'+name)
        if o and node in meta['nodes']:o.location=C@Vector(meta['nodes'][node]['pos'])
    colors={'polymer_tan':(.50,.40,.265),'polymer':(.023,.026,.028),'rubber':(.015,.017,.018),'cavity':(.005,.005,.005),'steel':(.045,.051,.052)}
    for mat in bpy.data.materials:
        if not mat.use_nodes:continue
        shader=mat.node_tree.nodes.get('Principled BSDF')
        if shader:shader.inputs['Base Color'].default_value=(*colors.get(mat.name,(.05,.055,.06)),1)
else:
    for o in bpy.data.objects:
        if o.animation_data:
            o.animation_data.action=None
            for track in o.animation_data.nla_tracks:track.mute=track.name!=args.clip
    scene.frame_set(round(args.time*120));bpy.context.view_layer.update()
    for o in bpy.data.objects:
        if o.type!='MESH':continue
        roots=[];q=o
        while q:roots.append(q.name);q=q.parent
        o.hide_render=not args.hands and any(s.startswith('EVOLYS_arm_') for s in roots)
    # Metadata-only backdrop controls imported with the review arms are not
    # runtime meshes and never contaminate the silhouette review.
scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=48;scene.eevee.use_raytracing=False
scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.resolution_percentage=100
if args.photos:
    views=json.loads((ROOT/'assets/weapons/fn-evolys-762/photo-review.json').read_text())
else:
    views=[]
    for name,direction in [('hero',(1,.35,1)),('left',(-1,.03,0)),('right',(1,.03,0)),('top',(0,1,.02)),('feed_detail',(-1,.3,.4)),('grip_detail',(1,.3,.6)),('optic_detail',(1,.4,.6))]:
        center=Vector((0,.035,-.10));scale=1.12
        if name=='feed_detail':center=Vector((-.04,.07,-.15));scale=.29
        if name=='grip_detail':center=Vector((0,-.02,.014));scale=.27
        if name=='optic_detail':center=Vector((0,.15,-.05));scale=.16
        rot=(C@Vector(direction)).to_track_quat('Z','Y').to_matrix()
        views.append({'name':name,'image_size':[1600,900],'center':list(center),'pixels_per_metre':1600/scale,'rotation_blender':rot})
if args.view:views=[v for v in views if v['name'] in args.view]
assert views,'No matching review views'
for v in views:
    w,h=v['image_size'];scene.render.resolution_x=w;scene.render.resolution_y=h
    data=bpy.data.cameras.new(v['name']);cam=bpy.data.objects.new(v['name'],data);scene.collection.objects.link(cam)
    rotation=v.get('rotation_blender') or C@Matrix(v['camera_rotation']);center=C@Vector(v['center'])
    cam.matrix_world=rotation.to_4x4();cam.location=center+rotation.col[2]*2;data.type='ORTHO';data.ortho_scale=max(w,h)/v['pixels_per_metre'];scene.camera=cam
    if args.reel and args.clip in ('Fire','Last_Shot'):
        # Twelve-shot native-track showcase, including the final short tail.
        # No new animation is baked into the asset; runtime ammo is tested by
        # the browser harness rather than inferred from this offline reel.
        duration=json.loads(scene['clips'])['Fire']['duration'];belt=bpy.data.objects['belt_rig']
        for f in range(0,180,4):
            t=f/120;shot=int(t/duration);phase=(t%duration)*120
            if shot>=12:
                for o in bpy.data.objects:
                    if o.animation_data:
                        for track in o.animation_data.nla_tracks:track.mute=track.name!='Idle'
                scene.frame_set(0)
            else:scene.frame_set(int(phase),subframe=phase-int(phase))
            for i,bone in enumerate(belt.pose.bones):bone.scale=(1,1,1) if i<max(0,12-shot) else (0,0,0)
            bpy.context.view_layer.update();scene.render.filepath=str(args.out/(v['name']+f'-{f:04d}.png'));bpy.ops.render.render(write_still=True)
        break
    if args.reel:
        info=json.loads(scene['clips'])[args.clip];scene.frame_start=0;scene.frame_end=round(info['duration']*120);scene.frame_step=4
        scene.render.filepath=str(args.out/(v['name']+'-'));bpy.ops.render.render(animation=True)
        break
    scene.render.filepath=str(args.out/(v['name']+'.png'));bpy.ops.render.render(write_still=True)
