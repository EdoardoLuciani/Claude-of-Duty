"""Checks actual shared optic meshes, not proxy attachment envelopes.

The dedicated 12g suppressor and TOR Mini have separate sampled checks.
Optic clamps intentionally seat over the rail teeth. The receiver-hugging base,
integrated rear sight and all other weapon/hand surfaces remain strict for optics.
"""
import math
import bpy
from mathutils import Matrix, Vector

import attachment_source


def check_mounts(manifest, rig_transform, meshes, review, pose, tree, point, basis):
    pose('Idle')
    mounts = {slot: bpy.data.objects['MOUNT_' + slot] for slot in manifest['mounts']}
    for slot, data in manifest['mounts'].items():
        mount = mounts[slot]
        assert mount.parent.name == data['parent'], (slot, 'mount ownership')
        assert (point(mount) - Vector(data['pos'])).length < 1e-7
        rotation = basis @ rig_transform(mount) @ basis.inverted()
        expected = Matrix.Rotation(data['rot'][2], 4, 'Z')
        for axis in range(3):
            # Blender Euler/matrix conversion rounds the 90-degree rail turn
            # by one float32 step (1.1921e-7), not a meaningful mount rotation.
            assert (rotation.col[axis].xyz - expected.col[axis].xyz).length < 2e-7
        assert (mount.scale - Vector((1, 1, 1))).length < 1e-7
    rail = [o for o in meshes if o.name.startswith(('Optic rail', 'Optic Picatinny'))]
    adapter = [o for o in meshes if o.name.startswith('12g adapter')]
    assert len(adapter) == 2
    laser_hardware = [o for o in meshes if o.name.startswith('Laser rail ')]
    assert laser_hardware and all(o.parent.name == 'receiver' for o in laser_hardware)
    additions = tree(rail + adapter + laser_hardware + [o for o in meshes if o.name.startswith(('Ghost ring', 'Rear sight'))])
    fixed = [o for o in meshes if o.parent.name == 'receiver' and o not in rail + adapter + laser_hardware]
    tube = tree([o for o in fixed if o.name == 'Magazine tube'])
    clamp_parts = [o for o in laser_hardware if o.name.startswith('Laser rail tube clamp')]
    assert len(clamp_parts) == 2
    clamps = tree(clamp_parts)
    web = tree([o for o in laser_hardware if o.name == 'Laser rail adapter web'])
    assert not tree(laser_hardware).overlap(tree([o for o in fixed if o.name != 'Magazine tube'])), 'tube rail crosses non-seating weapon surfaces'
    for z in (point(o).z for o in clamp_parts):
        centre = Vector((0, .0348, z))
        for direction in (Vector((1,0,0)), Vector((-1,0,0)), Vector((0,1,0)), Vector((0,-1,0))):
            inner = clamps.ray_cast(centre, direction, .03)[0]
            outer = tube.ray_cast(centre + direction * .02, -direction, .02)[0]
            assert inner is not None and outer is not None, 'missing tube/clamp seating surface'
            assert -.00010 < (inner - outer).dot(direction) < .00002, 'tube clamp not seated'
        bottom = clamps.ray_cast(Vector((0,0,z)), Vector((0,1,0)), .03)[0]
        upper = web.ray_cast(centre, Vector((0,-1,0)), .03)[0]
        lower = web.ray_cast(Vector((0,0,z)), Vector((0,1,0)), .03)[0]
        assert bottom is not None and upper is not None and lower is not None
        assert lower.y < bottom.y < upper.y, 'rail web unsupported by tube clamp'
    print('M590_LASER_SUPPORT_OK: two fixed tube clamps; eight radial seating rays; web supported at both clamps')
    base = [o for o in rail if o.name == 'Optic rail receiver base']
    fasteners = [o for o in rail if o.name.startswith(('Optic rail mounting screw', 'Optic rail screw shank'))]
    seating_teeth = [o for o in rail if o.name.startswith('Optic Picatinny lug')]
    rear_sight = [o for o in fixed if o.name.startswith(('Ghost ring', 'Rear sight'))]
    assert len(base) == 1 and len(fasteners) == 8 and len(seating_teeth) == 18, 'extended seventeen-slot rail hardware'
    assert not tree(seating_teeth).overlap(tree(fixed)), 'rail teeth cross fixed weapon/irons'
    barrel = [o for o in fixed if o.name.startswith(('Heavy barrel', 'Barrel crown'))]
    assert not tree(adapter).overlap(tree([o for o in fixed if o not in barrel])), 'adapter crosses non-seating surfaces'
    receiver = [o for o in fixed if o.name.startswith('590A1 receiver forging')]
    assert not tree(base + fasteners).overlap(tree([o for o in fixed if o not in receiver + rear_sight])), 'rail base crosses non-seating surfaces'
    receiver_tree = tree(receiver)
    base_tree = tree(base)
    gaps = []
    for x in (-.007, 0, .007):
        for z in (-.182, -.130, -.048):
            underside = base_tree.ray_cast(Vector((x, .080, z)), Vector((0, 1, 0)), .02)[0]
            roof = receiver_tree.ray_cast(Vector((x, .100, z)), Vector((0, -1, 0)), .03)[0]
            assert underside is not None and roof is not None
            gap = underside.y - roof.y
            assert -.00015 < gap < .00015, 'receiver rail base not seated'
            gaps.append(gap)
    print('M590_INTEGRATED_RAIL_OK: seventeen slots; four modeled fasteners; nine continuous-base seating rays; gaps mm', [g * 1000 for g in gaps])
    barrel_tree = tree(barrel)
    barrel_gaps = []
    for z in (-.245, -.225, -.200):
        for x in (-.007, 0, .007):
            underside = base_tree.ray_cast(Vector((x, .081, z)), Vector((0, 1, 0)), .01)[0]
            crown = barrel_tree.ray_cast(Vector((x, .090, z)), Vector((0, -1, 0)), .03)[0]
            assert underside is not None and crown is not None, ('cantilever/barrel surface missing', x, z)
            gap = underside.y - crown.y
            assert gap > .0005, ('cantilever crosses barrel', x, z, gap)
            barrel_gaps.append(gap)
    print('M590_CANTILEVER_BARREL_OK: nine paired surface rays; minimum gap mm', min(barrel_gaps) * 1000)
    tooth_z = []
    for tooth in seating_teeth:
        transform = basis @ rig_transform(tooth)
        z = [(transform @ v.co).z for v in tooth.data.vertices]
        tooth_z.append((min(z) + max(z)) / 2)
    tooth_z.sort()
    assert all(abs(b - a - .0100076) < 1e-7 for a, b in zip(tooth_z, tooth_z[1:])), 'rail slot pitch'
    # Preserve the whole ghost-ring opening, including four off-axis rays.
    irons_and_rail = tree(rail + rear_sight)
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
    # that frame throughout every clip, while the laser rail stays on the fixed magazine-tube clamps.
    receiver_mount = rig_transform(mounts['optic'])
    optics = {}
    for optic, stations in (('railway', (7, 10)), ('acog', (5, 12)), ('scope', (1, 3, 14, 16)), ('exps3', (7, 10))):
        objects = attachment_source.seat(optic, mounts['optic'])
        # The muzzle check reads each mounted optic back from this collection.
        collection = bpy.data.collections.new('M590 check | mounted ' + optic)
        bpy.context.scene.collection.children.link(collection)
        for obj in objects:
            collection.objects.link(obj)
        sight = attachment_source.named(objects, 'SOCKET_sight')
        surfaces = [o for o in objects if o.type == 'MESH']
        optic_tree = tree(surfaces)
        # Only mating teeth may contact an optic; the receiver base,
        # integrated sight and remaining body must stay clear.
        assert not optic_tree.overlap(tree([o for o in meshes if o not in seating_teeth])), (optic, 'fixed irons/body/rail support conflict')
        # Probe both feet at two actual rail teeth, not a broad bounding box.
        gaps = []
        rail_tree = tree(rail)
        for station in stations:
            z = tooth_z[station]
            for x in (-.009, .009):
                top = rail_tree.ray_cast(Vector((x, .098, z)), Vector((0, -1, 0)), .02)[0]
                bottom = optic_tree.ray_cast(Vector((x, .0905, z)), Vector((0, 1, 0)), .02)[0]
                assert top is not None and bottom is not None, (optic, 'unsupported foot', station, x)
                gap = bottom.y - top.y
                assert -.0006 < gap < .00015, (optic, 'unseated foot', gap)
                gaps.append(gap)
        if optic == 'scope':
            # Both complete 28 mm pedestals must be within the actual tooth
            # envelope, not the former nominal four-inch backing length.
            def points(objects):
                result = []
                deps = bpy.context.evaluated_depsgraph_get()
                for obj in objects:
                    evaluated = obj.evaluated_get(deps)
                    data = evaluated.to_mesh()
                    transform = basis @ rig_transform(obj)
                    result.extend(transform @ v.co for v in data.vertices)
                    evaluated.to_mesh_clear()
                return result
            pedestals = [o for o in surfaces if o.name.startswith('AI one-piece ring pedestal')]
            assert len(pedestals) == 2
            footprints = [points([o]) for o in pedestals]
            centres = sorted((min(p.z for p in foot) + max(p.z for p in foot)) / 2 for foot in footprints)
            assert abs(centres[1] - centres[0] - .130) < 1e-7, 'PM II cross-bolt spacing'
            tooth_points = points(seating_teeth)
            for footprint in footprints:
                assert min(p.z for p in tooth_points) < min(p.z for p in footprint)
                assert max(p.z for p in tooth_points) > max(p.z for p in footprint)
            ears = [o for o in rear_sight if o.name.startswith('Rear sight protective ear')]
            mount_base = [o for o in surfaces if o.name.startswith('AI mount base')]
            housing = [o for o in surfaces if o.name.startswith('PM II scope housing')]
            ear_tree = tree(ears)
            def separation(objects):
                surface = tree(objects)
                return min([ear_tree.find_nearest(p)[3] for p in points(objects)] + [surface.find_nearest(p)[3] for p in points(ears)])
            base_gap = separation(mount_base)
            # Include ocular knurling/ridges, not just the smooth tube: those
            # protrusions are closer to the retained ears than the housing.
            tube_gap = separation([o for o in surfaces if o not in mount_base + pedestals])
            assert base_gap > .00049 and tube_gap > .0024, ('PM II fixed-ear clearance', base_gap, tube_gap)
            front_sight = tree([o for o in meshes if o.name.startswith('Front sight')])
            objective_gap = min(front_sight.find_nearest(p)[3] for p in points(housing))
            assert objective_gap > .15, ('objective/front sight clearance', objective_gap)
            print('M590_PMII_FIT_OK: full pedestal envelopes; 130 mm cross-bolt spacing; sampled mesh distances mm: base/ears', base_gap * 1000, 'scope upper/ears', tube_gap * 1000, 'housing/front sight', objective_gap * 1000)
        optics[optic] = optic_tree
        print('M590_OPTIC_SEAT_OK:', optic, 'sight', tuple(point(sight)), 'foot gaps mm', [g * 1000 for g in gaps])

    moving = [o for o in meshes if o.parent.name in ('forend', 'bolt', 'trigger', 'shell_insert')]
    hands = [o for o in review.objects if o.type == 'MESH']
    count = 0
    for name, clip in manifest['clips'].items():
        for frame in range(math.ceil(clip['duration'] * 120) + 1):
            pose(name, min(frame / 120, clip['duration']))
            mounted = rig_transform(mounts['optic'])
            assert all(abs(mounted[i][j] - receiver_mount[i][j]) < 1e-7 for i in range(4) for j in range(4)), (name, frame, 'receiver mount moved relative to cached hardware')
            # The fixed tube-mounted laser does not inherit pump travel.
            assert (point(mounts['rail']) - Vector(manifest['mounts']['rail']['pos'])).length < 1e-7
            visible = [o for o in moving if o.parent.name != 'shell_insert' or o.parent.scale.x > .5]
            moving_tree = tree(visible + hands)
            assert not additions.overlap(moving_tree), (name, frame, 'new rail/adapter crosses mechanism or hand')
            for optic, optic_tree in optics.items():
                assert not optic_tree.overlap(moving_tree), (optic, name, frame, 'mounted optic crosses mechanism or hand')
            count += 1
    pose('Idle')
    print('M590_ATTACHMENT_CLEARANCE_OK:', count, '120Hz poses; Railway/ACOG/PM II real optics; both hands, pump, bolt, trigger and visible insertion shell; dedicated 12g suppressor and TOR Mini checked separately')
