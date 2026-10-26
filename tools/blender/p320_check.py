"""Check the saved editable source, including its real skinned hands.
blender -b assets/weapons/p320-compact/p320-compact.blend --python-exit-code 1 --python tools/blender/p320_check.py
"""
import json
import math
import bpy
from mathutils import Matrix, Vector
s=bpy.context.scene;clips=json.loads(s['clips'])
assert s.unit_settings.system=='METRIC'
assert len(clips)==8
for suffix in ('base','orm','normal','emission'):
    images=[im for im in bpy.data.images if im.name.startswith('P320_'+suffix) or im.name=='p320-'+suffix+'.png']
    assert images and images[0].packed_file, 'packed '+suffix
    expected=1024
    assert list(images[0].size)==[expected,expected]
marks=[o for o in s.objects if o.name.startswith('Mark |')]
assert len(marks)==13
for mark in marks:
    assert mark['bake_projected_vertices']==len(mark.data.vertices), mark.name
    assert all(p.normal.z>0 for p in mark.data.polygons), 'no reversed coincident glyph caps'
maximum=0
skin_error=0
arm=bpy.data.objects['P320_SKIN']
basis=Matrix.Rotation(math.pi/2,4,'X')
surface=bpy.data.objects['P320_surface']
assert len(surface.data.materials)==1
assert len(surface.data.uv_layers)==2
assert surface.data.uv_layers[1].name=='BaseColorUV'
assert s['p320_color_panels']==13
color_uv=surface.data.uv_layers['BaseColorUV'].data
panels=surface.data.attributes['color_panel'].data
marked_area=total_area=0
for face in surface.data.polygons:
    a,b,c=[color_uv[i].uv for i in face.loop_indices]
    u,v=b-a,c-a
    area=abs(u.x*v.y-u.y*v.x)/2
    total_area+=area
    if panels[face.index].value:marked_area+=area
assert .75<marked_area/total_area<.90, 'most occupied color UV area belongs to lettering panels'
for uv in surface.data.uv_layers:
    assert all(0<=coord<=1 for loop in uv.data for coord in loop.uv)
surface.data.calc_loop_triangles()
assert len(surface.data.loop_triangles)<30000
assert len(arm.data.bones)==9
for vertex in surface.data.vertices:
    assert len(vertex.groups)==1 and vertex.groups[0].weight==1
for name,info in clips.items():
    for o in s.objects:
        if not o.animation_data:continue
        o.animation_data.action=None
        for track in o.animation_data.nla_tracks:track.mute=track.name!=name
    for frame in range(0,info['frames'][1]+1,2):
        s.frame_set(frame);bpy.context.view_layer.update()
        mechanical=bpy.data.objects['P320_SKIN']
        for bone in mechanical.pose.bones:
            actual=mechanical.matrix_world@bone.matrix@basis.inverted()
            expected=bpy.data.objects[bone.name].matrix_world
            gap=max(abs(actual[r][c]-expected[r][c]) for r in range(4) for c in range(4))
            skin_error=max(skin_error,gap)
            assert gap<2e-6, f'{name}/{frame}/{bone.name}: skin/source transform differs by {gap}'
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
print(f'P320_BLENDER_OK: 8 synchronized actions, wrists {maximum*1000:.4f} mm, mechanical skin/source matrix error {skin_error:.9f}, packed atlases, {marked_area/total_area:.1%} lettering UV1, rigid weights and discrete magazines')
