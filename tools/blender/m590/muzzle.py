"""M590-owned 12g can fit. Actual surfaces/skins; no rail/optic fit edits."""
import math
import bpy
from mathutils import Vector


def check_muzzle(root, manifest, rig, meshes, review, pose, tree, point, basis):
    pose('Idle')
    mount = bpy.data.objects['MOUNT_muzzle']
    assert mount.parent.name == 'receiver'
    assert (point(mount)-Vector((0, .068, -.6672884763))).length < 1e-7
    transform = basis @ rig.matrix_world.inverted() @ mount.matrix_world @ basis.inverted()
    assert all(abs(transform[i][j]-(1 if i == j else 0)) < 1e-7
               for i in range(3) for j in range(3)), 'unit bore-forward mount'
    source = root/'assets/attachments/12g-suppressor/suppressor12g.blend'
    assert source.exists(), 'Build suppressor12g before M590 clearance checks'
    with bpy.data.libraries.load(str(source), link=False) as (available, loaded):
        loaded.objects = available.objects
    for obj in loaded.objects:
        bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.update()
    base = next(o for o in loaded.objects if o.name.startswith('SOCKET_mount'))
    exit = next(o for o in loaded.objects if o.name.startswith('SOCKET_muzzle'))
    wrapper = bpy.data.objects.new('M590 check | suppressor12g', None)
    bpy.context.scene.collection.objects.link(wrapper)
    wrapper.parent = mount
    wrapper.matrix_basis = base.matrix_world.inverted()
    for obj in loaded.objects:
        if obj.parent is None:
            obj.parent = wrapper
    bpy.context.view_layer.update()
    can = tree([o for o in loaded.objects if o.type == 'MESH'])
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
    for optic in ('rmr', 'acog'):
        collection = bpy.data.collections['M590 check | mounted ' + optic]
        sight = next(o for o in collection.objects if o.name.startswith('SOCKET_sight'))
        assert can.ray_cast(point(sight), Vector((0, 0, -1)), 1)[0] is None, (optic, 'can blocks optic sightline')
    print('M590_SUPPRESSOR12G_SIGHTLINE: low irons occluded; actual RMR/ACOG sight rays clear; no sight auto-switch or tuning changes')
    # Include the real optional TOR Mini, not just its permanent clamp hardware.
    laser_source = root/'assets/attachments/steiner-tor-mini/tor-mini.blend'
    with bpy.data.libraries.load(str(laser_source), link=False) as (available, laser):
        laser.objects = [n for n in available.objects if n in ('ATTACHMENT_tor_mini', 'TOR_MINI_body', 'SOCKET_mount')]
    for obj in laser.objects:
        bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.update()
    laser_base = next(o for o in laser.objects if o.name.startswith('SOCKET_mount'))
    laser_transform = bpy.data.objects['MOUNT_rail'].matrix_world @ laser_base.matrix_world.inverted()
    for obj in laser.objects:
        if obj.parent is None:
            obj.matrix_world = laser_transform @ obj.matrix_world
    bpy.context.view_layer.update()
    assert not can.overlap(tree([o for o in laser.objects if o.type == 'MESH'])), 'can intersects TOR Mini'
    moving = [o for o in meshes if o.parent.name in ('forend', 'bolt', 'trigger', 'shell_insert')]
    hands = [o for o in review.objects if o.type == 'MESH']
    count = 0
    maximum_rounding = 0
    for name, clip in manifest['clips'].items():
        for frame in range(math.ceil(clip['duration']*120)+1):
            pose(name, min(frame/120, clip['duration']))
            # The longer exit's world -> rig float32 round trip peaks at
            # 2.035e-7m in Inspect frame 297 (not physical mount movement).
            rounding = (point(exit)-expected).length
            maximum_rounding = max(maximum_rounding, rounding)
            assert rounding < 2.1e-7, (name, frame, 'can must follow receiver, not pump')
            visible = [o for o in moving if o.parent.name != 'shell_insert' or o.parent.scale.x > .5]
            assert not can.overlap(tree(visible+hands)), (name, frame, 'can crosses mechanism/support or firing hand')
            count += 1
    pose('Idle')
    for obj in loaded.objects + laser.objects + [wrapper]:
        bpy.data.objects.remove(obj, do_unlink=True)
    print('M590_SUPPRESSOR12G_CLEARANCE_OK:', count, '120Hz poses; both deformed hands, full 89mm pump stroke, shell/bolt/trigger; front blade/cheeks, cap, lug, TOR Mini and clamps clear; exit', tuple(expected), 'max socket rounding m', maximum_rounding)
