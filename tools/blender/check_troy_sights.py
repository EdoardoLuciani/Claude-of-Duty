"""Check the active TROY game-art state in a generated weapon .blend."""
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import attachment_source
from picatinny import PITCH
from troy_sights import SIGHT_HEIGHT, set_sight_preview


def check():
    scene = bpy.context.scene
    objects = bpy.data.objects
    group = objects['IRON_troy']
    rig = group
    while rig.parent:
        rig = rig.parent
    can_id = 'suppressor338' if rig.name == 'AX338_RIG' else 'srd762ti'
    alt = [o for o in group.children if o.type == 'MESH']
    meshes = [o for o in rig.children_recursive if o.type == 'MESH' and o not in alt and
              o.parent.name not in ('IRON_sights', 'IRON_sights_removed', 'MUZZLE_device_removed')]
    hands = [o for o in scene.objects if o.type == 'MESH' and
             any('authored hands' in c.name for c in o.users_collection)]
    assert hands, 'deformed review hands required'
    clips = json.loads(scene['clips'])
    assert alt and all(o.hide_get() and o.hide_render for o in alt), 'alternate visible in stock preview'
    set_sight_preview(group, True)

    def select(name):
        for obj in scene.objects:
            if obj.animation_data:
                obj.animation_data.action = None
                for track in obj.animation_data.nla_tracks:
                    track.mute = track.name != name

    select('Idle')
    scene.frame_set(0)
    bpy.context.view_layer.update()
    inverse = rig.matrix_world.inverted()
    rear, front = [inverse @ objects[name].matrix_world.translation
                   for name in ('SOCKET_troy', 'SOCKET_troy_front_post')]
    forward = (front-rear).normalized()
    up = Vector((0,0,1))
    across = forward.cross(up)
    assert abs(forward.dot(up)) < 1e-6 and abs(rear.dot(across)) < 1e-6, 'canted sights'
    tree = attachment_source.surface(alt, inverse)

    def hits(datum, x, y):
        return tree.ray_cast(datum + x*across + y*up - .018*forward, forward, .035)[0] is not None

    for sign in (-1,1):
        # A round aperture of similar width would pass the corner probe.
        assert not hits(rear, sign*.0022, 0) and not hits(rear, 0, sign*.0022), 'blocked diamond tip'
        assert hits(rear, sign*.0017, sign*.0015), 'missing diamond corner'
        assert hits(front, sign*.0056, .0059), 'missing HK ear tip'
        assert not hits(front, sign*.0044, .0059), 'HK tip gap too narrow'
        assert not hits(front, sign*.0093, 0), 'HK ears too wide'
        assert not hits(front, sign*.0012, -.003), 'HK post merged into opening'
    assert not hits(front, 0, .0059), 'HK opening closed into a hood'
    assert hits(front, 0, -.0003) and not hits(front, 0, .0002), 'front post height or opening'

    def animated(obj):
        while obj != rig:
            if obj.animation_data:
                return True
            obj = obj.parent
        return False

    fixed = [o for o in meshes if not animated(o)]
    moving = [o for o in meshes if o not in fixed] + hands
    body = attachment_source.surface(fixed, inverse)
    # Move the static body down a hair so its coplanar rail seating faces are
    # not reported as crossing. All other opaque parts still have to clear.
    inset = attachment_source.surface(fixed, Matrix.Translation(-.00002*up) @ inverse)
    if tree.overlap(inset):
        stamp = Matrix.Translation(-.00002*up) @ inverse
        offenders = [o for o in fixed if tree.overlap(attachment_source.surface([o], stamp))]
        raise AssertionError([(o.name, [part.name for part in alt if
                               attachment_source.surface([part], inverse).overlap(attachment_source.surface([o], stamp))])
                              for o in offenders])
    for datum in (rear, front):
        for land in (-PITCH/2, PITCH/2):
            for x in (-.006,.006):
                p = datum - up*SIGHT_HEIGHT + forward*land + across*x
                top = body.ray_cast(p+.0008*up, -up, .0016)[0]
                saddle = tree.ray_cast(p-.0008*up, up, .0016)[0]
                assert top and saddle and (top-saddle).length < .00003, ('floating foot', tuple(p))

    aim = rear - .018*forward + .0002*up
    for id,slot in ((can_id,'muzzle'),('laser','rail')):
        parts = attachment_source.seat(id, objects['MOUNT_'+slot])
        mounted = attachment_source.surface([o for o in parts if o.type == 'MESH'], inverse)
        assert not tree.overlap(mounted), (id, 'mount touches TROY')
        assert mounted.ray_cast(aim, forward, 2)[0] is None, (id, 'blocks TROY sight line')
        for obj in reversed(parts):
            bpy.data.objects.remove(obj, do_unlink=True)
    for target in (body, tree):
        assert target.ray_cast(aim, forward, 2)[0] is None, 'TROY sight line obstructed'

    count = 0
    for name, info in clips.items():
        select(name)
        for sample in range(math.ceil(info['duration']*120)+1):
            time = min(sample/120, info['duration']) * scene.render.fps
            scene.frame_set(math.floor(time), subframe=time%1)
            inverse = rig.matrix_world.inverted()
            visible = [o for o in moving if min(o.matrix_world.to_scale()) > .001]
            if visible and tree.overlap(attachment_source.surface(visible, inverse)):
                crossing = [o.name for o in visible if tree.overlap(attachment_source.surface([o], inverse))]
                raise AssertionError((name, sample, crossing, 'moving part or hand crosses TROY'))
            count += 1
    print(rig.name, 'TROY_OK:', count, '120Hz poses; seated pair, diamond/post/open ears, moving parts, hands and laser/can clearance')


check()
