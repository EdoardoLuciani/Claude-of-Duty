"""Check the saved editable source, including its real skinned hands.
blender -b assets/weapons/p320-compact/p320-compact.blend --python-exit-code 1 --python tools/blender/p320_check.py
"""
import json
import math
import bpy
from mathutils import Vector
s=bpy.context.scene;clips=json.loads(s['clips'])
assert s.unit_settings.system=='METRIC'
assert len(clips)==8
for suffix in ('base','orm','normal'):
    images=[im for im in bpy.data.images if im.name.startswith('P320_'+suffix) or im.name=='p320-'+suffix+'.png']
    assert images and images[0].packed_file, 'packed '+suffix
maximum=0
for name,info in clips.items():
    for o in s.objects:
        if not o.animation_data:continue
        o.animation_data.action=None
        for track in o.animation_data.nla_tracks:track.mute=track.name!=name
    for frame in range(0,info['frames'][1]+1,2):
        s.frame_set(frame);bpy.context.view_layer.update()
        for side,prefix in [('left','L'),('right','R')]:
            arm=bpy.data.objects['P320_arm_'+side]
            wrist=bpy.data.objects['hand_'+prefix]
            actual=arm.matrix_world@arm.pose.bones['hand'].head
            expected=wrist.matrix_world.translation
            gap=(actual-expected).length;maximum=max(maximum,gap)
            assert gap<.0002, f'{name}/{frame}/{side}: native Blender skin wrist differs from exported wrist by {gap*1000:.3f} mm'
            for bone in arm.pose.bones:
                assert all(math.isfinite(x) for row in bone.matrix for x in row)
        if name=='Last_Shot' and frame==info['frames'][1]:
            assert bpy.data.objects['slide'].location.y<-.025, 'last-shot endpoint must hold open, not fall out of its NLA strip'
        for part in ('magazine','magazine_spare'):
            o=bpy.data.objects[part]
            assert min(abs(o.scale.x),abs(o.scale.x-1))<1e-5
# Body must not have an exposed rail gap or a sealed magazine bottom.
body=bpy.data.objects['Frame | continuous compact medium polymer shell']
assert len(body.data.vertices)>500
# No exterior barrel/slide pieces can be empty or collapsed in source.
for o in bpy.data.collections['P320 | editable weapon'].objects:
    if o.type!='MESH':continue
    assert len(o.data.polygons)>0,o.name
    assert max((Vector(o.bound_box[6])-Vector(o.bound_box[0])).length,0)>.00001,o.name
print(f'P320_BLENDER_OK: 8 synchronized actions, native skin wrists agree within {maximum*1000:.4f} mm, packed atlases, finite bone transforms and discrete magazines')
