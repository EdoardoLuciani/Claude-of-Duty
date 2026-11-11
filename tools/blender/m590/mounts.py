"""Checks actual shared optic meshes, not proxy attachment envelopes.

Suppressor/laser catalogs are absent: only their future datums are checked.
Optic clamps intentionally seat over the rail teeth. The bridge, receiver
supports and all other weapon/hand surfaces remain strict collision checks.
"""
import math
import bpy
from mathutils import Matrix, Vector


def check_mounts(root, manifest, rig, meshes, review, pose, tree, point, basis):
    pose('Idle')
    mounts = {slot: bpy.data.objects['MOUNT_' + slot] for slot in manifest['mounts']}
    for slot, data in manifest['mounts'].items():
        mount = mounts[slot]
        assert mount.parent.name == data['parent'], (slot, 'mount ownership')
        assert (point(mount) - Vector(data['pos'])).length < 1e-7
        rotation = basis @ rig.matrix_world.inverted() @ mount.matrix_world @ basis.inverted()
        expected = Matrix.Rotation(data['rot'][2], 4, 'Z')
        for axis in range(3):
            # Blender Euler/matrix conversion rounds the 90-degree rail turn
            # by one float32 step (1.1921e-7), not a meaningful mount rotation.
            assert (rotation.col[axis].xyz - expected.col[axis].xyz).length < 2e-7
        assert (mount.scale - Vector((1, 1, 1))).length < 1e-7
    rail = [o for o in meshes if o.name.startswith(('Optic rail', 'Optic Picatinny'))]
    adapter = [o for o in meshes if o.name.startswith('12g adapter')]
    assert len(adapter) == 2 and len(rail) == 23
    additions = tree(rail + adapter)
    fixed = [o for o in meshes if o.parent.name == 'receiver' and o not in rail + adapter]
    feet = [o for o in rail if o.name.startswith('Optic rail receiver foot')]
    seating_teeth = [o for o in rail if o.name.startswith('Optic Picatinny lug')]
    assert not tree([o for o in rail if o not in feet]).overlap(tree(fixed)), 'optic bridge crosses fixed weapon/irons'
    barrel = [o for o in fixed if o.name.startswith(('Heavy barrel', 'Barrel crown'))]
    assert not tree(adapter).overlap(tree([o for o in fixed if o not in barrel])), 'adapter crosses non-seating surfaces'
    receiver = [o for o in fixed if o.name.startswith('590A1 receiver forging')]
    assert not tree(feet).overlap(tree([o for o in fixed if o not in receiver])), 'rail feet cross non-seating surfaces'
    receiver_tree = tree(receiver)
    for foot in feet:
        vertices = [basis @ rig.matrix_world.inverted() @ foot.matrix_world @ v.co for v in foot.data.vertices]
        centre = sum(vertices, Vector()) / len(vertices)
        for dx in (-.0015, 0, .0015):
            for dz in (-.003, 0, .003):
                x, z = centre.x + dx, centre.z + dz
                underside = tree([foot]).ray_cast(Vector((x, .080, z)), Vector((0, 1, 0)), .04)[0]
                roof = receiver_tree.ray_cast(Vector((x, .100, z)), Vector((0, -1, 0)), .03)[0]
                assert underside is not None and roof is not None
                assert -.00015 < underside.y - roof.y < .00015, 'receiver rail foot not seated'
    # Preserve the whole ghost-ring opening, including four off-axis rays.
    irons_and_rail = tree(rail + [o for o in meshes if o.name.startswith('Ghost ring')])
    for x, dy in ((0, 0), (.004, 0), (-.004, 0), (0, .004), (0, -.004)):
        assert irons_and_rail.ray_cast(Vector((x, .096 + dy, .020)), Vector((0, 0, -1)), .620)[0] is None
    # The adapter bore stays 18.6 mm open; datum is the actual front face.
    muzzle = point(mounts['muzzle'])
    assert (point(bpy.data.objects['SOCKET_muzzle']) - muzzle).length < 1e-7, 'emitter must be at the adapter exit'
    assert (point(bpy.data.objects['DATUM_barrel_crown']) - Vector(manifest['dimensions']['barrelCrown'])).length < 1e-7
    adapter_tree = tree(adapter)
    assert adapter_tree.ray_cast(muzzle + Vector((0, 0, -.01)), Vector((0, 0, 1)), .05)[0] is None
    face = adapter_tree.ray_cast(muzzle + Vector((.011, 0, -.01)), Vector((0, 0, 1)), .05)[0]
    assert face is not None and abs(face.z - muzzle.z) < 1e-7

    # Cached BVHs are in rig space. Receiver hardware must remain rigid in
    # that frame throughout every clip, while the tri-rail follows the pump.
    receiver_mount = rig.matrix_world.inverted() @ mounts['optic'].matrix_world
    optics = {}
    for optic, directory, stations in (
        ('rmr', 'trijicon-rmr', (7, 10)),
        ('acog', 'trijicon-acog', (5, 12)),
        ('scope', 'schmidt-bender-pm-ii', (2, 14)),
    ):
        source = root / 'assets/attachments' / directory / (optic + '.blend')
        assert source.exists(), f'Rebuild the shared {optic} source before M590 checks: {source}'
        with bpy.data.libraries.load(str(source), link=False) as (available, loaded):
            loaded.objects = available.objects
        collection = bpy.data.collections.new('M590 check | mounted ' + optic)
        bpy.context.scene.collection.children.link(collection)
        for obj in loaded.objects:
            collection.objects.link(obj)
        bpy.context.view_layer.update()
        base = next(o for o in loaded.objects if o.name.startswith('MOUNT_base'))
        sight = next(o for o in loaded.objects if o.name.startswith('SOCKET_sight'))
        relative_sight = base.matrix_world.inverted() @ sight.matrix_world.translation
        wrapper = bpy.data.objects.new('M590 check | ' + optic, None)
        collection.objects.link(wrapper)
        wrapper.parent = mounts['optic']
        wrapper.matrix_basis = base.matrix_world.inverted()
        for obj in loaded.objects:
            if obj.parent is None:
                obj.parent = wrapper
        bpy.context.view_layer.update()
        surfaces = [o for o in loaded.objects if o.type == 'MESH']
        optic_tree = tree(surfaces)
        # Only the mating teeth are exempt: bridge and receiver feet must
        # clear every optic, just like the fixed irons and remaining body.
        assert not optic_tree.overlap(tree([o for o in meshes if o not in seating_teeth])), (optic, 'fixed irons/body/rail support conflict')
        expected_sight = mounts['optic'].matrix_world @ relative_sight
        assert (sight.matrix_world.translation - expected_sight).length < 1e-7
        # Probe both feet at two actual rail teeth, not a broad bounding box.
        gaps = []
        rail_tree = tree(rail)
        for station in stations:
            z = -.04905 - station * .0107
            for x in (-.009, .009):
                top = rail_tree.ray_cast(Vector((x, .125, z)), Vector((0, -1, 0)), .02)[0]
                bottom = optic_tree.ray_cast(Vector((x, .110, z)), Vector((0, 1, 0)), .02)[0]
                assert top is not None and bottom is not None, (optic, 'unsupported foot', station, x)
                gap = bottom.y - top.y
                assert -.0006 < gap < .00015, (optic, 'unseated foot', gap)
                gaps.append(gap)
        optics[optic] = optic_tree
        print('M590_OPTIC_SEAT_OK:', optic, 'sight', tuple(point(sight)), 'four foot gaps mm', [g * 1000 for g in gaps])

    moving = [o for o in meshes if o.parent.name in ('forend', 'bolt', 'trigger', 'shell_insert')]
    hands = [o for o in review.objects if o.type == 'MESH']
    count = 0
    for name, clip in manifest['clips'].items():
        for frame in range(math.ceil(clip['duration'] * 120) + 1):
            pose(name, min(frame / 120, clip['duration']))
            mounted = rig.matrix_world.inverted() @ mounts['optic'].matrix_world
            assert all(abs(mounted[i][j] - receiver_mount[i][j]) < 2e-7 for i in range(4) for j in range(4)), (name, frame, 'receiver mount moved relative to cached hardware')
            stroke = (basis.to_3x3() @ bpy.data.objects['forend'].location).z
            # Inverting the animated rig adds up to 1.011e-7 m of float32
            # error during Inspect; keep the same two-step numerical bound.
            assert (point(mounts['rail']) - Vector((.028, .0355, -.460 + stroke))).length < 2e-7
            visible = [o for o in moving if o.parent.name != 'shell_insert' or o.parent.scale.x > .5]
            moving_tree = tree(visible + hands)
            assert not additions.overlap(moving_tree), (name, frame, 'new rail/adapter crosses mechanism or hand')
            for optic, optic_tree in optics.items():
                assert not optic_tree.overlap(moving_tree), (optic, name, frame, 'mounted optic crosses mechanism or hand')
            count += 1
    pose('Idle')
    print('M590_ATTACHMENT_CLEARANCE_OK:', count, '120Hz poses; all three real optics; both hands, pump, bolt, trigger and visible insertion shell; future muzzle/rail datums only, no suppressor/laser fit claim')
