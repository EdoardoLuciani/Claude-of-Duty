"""Check the saved editable source, including its real skinned hands.
blender -b .cache/blender/weapons/p320-compact/p320-compact.blend --python-exit-code 1 --python tools/blender/p320/check.py
"""
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

sys.path[:0] = [str(Path(__file__).resolve().parent), str(Path(__file__).resolve().parents[1])]
from attachments import check_mounts, check_sight_emission, tree


def check_inspect_grip(end):
    rig = bpy.data.objects['P320_RIG']
    frame = bpy.data.objects['Frame | continuous compact medium polymer shell']
    trigger = bpy.data.objects['Trigger | original curved blade']
    glove = bpy.data.objects['P320_right_Charcoal_woven_glove_skin']
    digits = [(v.index, bone) for v in glove.data.vertices if v.groups
              if (bone := glove.vertex_groups[max(v.groups, key=lambda g: g.weight).group].name).startswith('finger_')]
    # Sample the one-handed presentation, not the blends to/from two-handed ready.
    for f in range(end // 10, end * 9 // 10, end // 10):
        s.frame_set(f)
        evaluated = glove.evaluated_get(bpy.context.evaluated_depsgraph_get())
        shell, blade = tree([frame]), tree([trigger])
        muzzle = rig.matrix_world.to_3x3() @ Vector((0, 1, 0))
        on_trigger = False
        for i, bone in digits:
            p = evaluated.matrix_world @ evaluated.data.vertices[i].co
            hit, normal, _, _ = shell.find_nearest(p)
            assert (p - hit).dot(normal) > -.0007, (f, bone, 'finger through P320 frame/guard')
            hit, normal, _, distance = blade.find_nearest(p)
            assert (p - hit).dot(normal) > -.0007, (f, bone, 'finger through P320 trigger')
            if bone.startswith('finger_0_') and distance < .0012 and normal.dot(muzzle) > .4:
                on_trigger = True
        assert on_trigger, (f, 'P320 index no longer contacts front of trigger')


s=bpy.context.scene;clips=json.loads(s['clips'])
assert s.unit_settings.system=='METRIC'
assert len(clips)==8
for suffix in ('base','orm','normal','emission'):
    images=[im for im in bpy.data.images if im.name.startswith('P320_'+suffix) or im.name=='p320-'+suffix+'.png']
    assert images and images[0].packed_file, 'packed '+suffix
    expected=1024
    assert list(images[0].size)==[expected,expected]
wordmark=bpy.data.objects['Mark | SIGSAUER  P320']
assert wordmark['bake_projected_vertices']==len(wordmark.data.vertices), wordmark.name
assert all(p.normal.z>0 for p in wordmark.data.polygons), 'no reversed coincident glyph caps'
maximum=0
skin_error=0
arm=bpy.data.objects['P320_SKIN']
basis=Matrix.Rotation(math.pi/2,4,'X')
surface=bpy.data.objects['P320_surface']
assert len(surface.data.materials)==1
assert len(surface.data.uv_layers)==1
# The integral accessory rail must not protrude ahead of the loaded slide nose.
frame=bpy.data.objects['Frame | continuous compact medium polymer shell']
slide=bpy.data.objects['Slide | chamfered Nitron shell']
assert max((frame.matrix_world@v.co).y for v in frame.data.vertices)<=max((slide.matrix_world@v.co).y for v in slide.data.vertices), 'accessory rail extends past slide nose'
for uv in surface.data.uv_layers:
    assert all(0<=coord<=1 for loop in uv.data for coord in loop.uv)
surface.data.calc_loop_triangles()
assert len(surface.data.loop_triangles)<30000
expected_parts={'frame','slide','barrel','trigger','slide_catch','magazine',
                'magazine_spare','magazine_round','magazine_spare_round'}
assert {bone.name for bone in arm.data.bones}==expected_parts
membership={name:0 for name in expected_parts}
for vertex in surface.data.vertices:
    assert len(vertex.groups)==1 and vertex.groups[0].weight==1
    part=surface.vertex_groups[vertex.groups[0].group].name
    assert part in membership, 'expected mechanical group: '+part
    membership[part]+=1
assert all(membership.values()), 'every mechanical joint must own geometry: '+str(membership)
for name,info in clips.items():
    for o in s.objects:
        if not o.animation_data:continue
        o.animation_data.action=None
        for track in o.animation_data.nla_tracks:track.mute=track.name!=name
    if name=='Inspect':
        check_inspect_grip(info['frames'][1])
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
check_sight_emission(surface)
check_mounts(clips)
print(f'P320_BLENDER_OK: 8 synchronized actions, wrists {maximum*1000:.4f} mm, mechanical skin/source matrix error {skin_error:.9f}, packed shared-UV atlases, rigid weights and discrete magazines')

# Actual shared rail attachment, independent of the optic catalog.
from tor_mini.mounts import check_laser_mount
check_laser_mount('p320')

from p320.suppressor import check_suppressor
check_suppressor(clips)
