"""M590-owned 12g can fit. Actual surfaces/skins; no rail/optic fit edits."""
import math
import bpy
from mathutils import Vector

import attachment_source


def check_muzzle(manifest, rig_transform, meshes, review, pose, tree, point, basis):
    pose('Idle')
    mount = bpy.data.objects['MOUNT_muzzle']
    assert mount.parent.name == 'receiver'
    assert (point(mount)-Vector((0, .068, -.6672884763))).length < 1e-7
    transform = basis @ rig_transform(mount) @ basis.inverted()
    assert all(abs(transform[i][j]-(1 if i == j else 0)) < 1e-7
               for i in range(3) for j in range(3)), 'unit bore-forward mount'
    loaded = attachment_source.seat('suppressor12g', mount)
    exit = attachment_source.named(loaded, 'SOCKET_muzzle')
    can = tree([o for o in loaded if o.type == 'MESH'])
    expected = Vector((0, .068, -.8872884763))
    assert (point(exit)-expected).length < 1e-7, 'mounted exit position'
    adapter = tree([o for o in meshes if o.name.startswith('12g adapter')])
    for x in (-.012, .012):
        seat = point(mount) + Vector((x, 0, 0))
        can_face = can.ray_cast(seat + Vector((0, 0, .005)), Vector((0, 0, -1)), .01)[0]
        adapter_face = adapter.ray_cast(seat - Vector((0, 0, .005)), Vector((0, 0, 1)), .01)[0]
        assert can_face is not None and adapter_face is not None, 'missing physical mating faces'
        assert (can_face-adapter_face).length < 1e-7, 'unseated suppressor neck'
    print('M590_SUPPRESSOR12G_SEAT_OK: two paired real-surface rays; permanent adapter retained')
    # All weapon surfaces (including front blade/cheeks, cap, lug and TOR clamps)
    # are strict; only the adapter's planar rear seat is allowed to touch.
    fixed = [o for o in meshes if o.parent.name == 'receiver' and not o.name.startswith('12g adapter')]
    assert not can.overlap(tree(fixed)), 'can intersects fixed weapon/sights/cap/lug/clamps'
    # The wide expansion chamber deliberately occludes the low ghost-ring line.
    assert can.ray_cast(Vector((0, .096, -.64)), Vector((0, 0, -1)), .3)[0] is not None
    for optic in attachment_source.OPTICS:
        collection = bpy.data.collections['M590 check | mounted ' + optic]
        assert not can.overlap(tree([o for o in collection.objects if o.type == 'MESH'])), (optic, 'can intersects optic')
        sight = attachment_source.named(collection.objects, 'SOCKET_sight')
        assert can.ray_cast(point(sight), Vector((0, 0, -1)), 1)[0] is None, (optic, 'can blocks optic sightline')
    print('M590_SUPPRESSOR12G_SIGHTLINE: low irons occluded; actual Railway/ACOG/PM II meshes and sight rays clear; no sight auto-switch or tuning changes')
    # Include the real optional TOR Mini, not just its permanent clamp hardware.
    laser = attachment_source.seat('laser', bpy.data.objects['MOUNT_rail'],
                                   ('ATTACHMENT_tor_mini', 'TOR_MINI_body', 'SOCKET_mount'))
    assert not can.overlap(tree([o for o in laser if o.type == 'MESH'])), 'can intersects TOR Mini'
    moving = [o for o in meshes if o.parent.name in ('forend', 'bolt', 'trigger', 'shell_insert')]
    hands = [o for o in review.objects if o.type == 'MESH']
    count = 0
    for name, clip in manifest['clips'].items():
        for frame in range(math.ceil(clip['duration']*120)+1):
            pose(name, min(frame/120, clip['duration']))
            assert (point(exit)-expected).length < 1e-7, (name, frame, 'can must follow receiver, not pump')
            visible = [o for o in moving if o.parent.name != 'shell_insert' or o.parent.scale.x > .5]
            assert not can.overlap(tree(visible+hands)), (name, frame, 'can crosses mechanism/support or firing hand')
            count += 1
    pose('Idle')
    for obj in loaded + laser:
        bpy.data.objects.remove(obj, do_unlink=True)
    print('M590_SUPPRESSOR12G_CLEARANCE_OK:', count, '120Hz poses; both deformed hands, full 89mm pump stroke, shell/bolt/trigger; front blade/cheeks, cap, lug, TOR Mini and clamps clear; exit', tuple(expected))
