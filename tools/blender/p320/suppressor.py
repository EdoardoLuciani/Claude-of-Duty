"""P320-owned compact booster fit: actual source surfaces and deformed hands."""
import math
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from .attachments import attachment_geometry, optic_geometry


def check_suppressor(clips):
    scene = bpy.context.scene
    mount = bpy.data.objects['MOUNT_muzzle']
    arm = bpy.data.objects['P320_SKIN']
    assert mount.parent == arm and mount.parent_type == 'BONE' and mount.parent_bone == 'barrel'
    for name in ('MUZZLE_device', 'MUZZLE_device_removed'):
        obj = bpy.data.objects[name]
        assert obj.parent == arm and obj.parent_type == 'BONE' and obj.parent_bone == 'barrel'
        assert obj.children, name + ' must own switchable geometry'
    vertices, faces, exit = attachment_geometry('suppressor9mm', 'SOCKET_muzzle')
    assert (exit-Vector((0, .135, 0))).length < 1e-6
    can = BVHTree.FromPolygons(vertices, faces)
    optics = optic_geometry()
    laser_vertices, laser_faces, emitter = attachment_geometry('laser', 'SOCKET_laser')
    # Test the evaluated mechanical skin used by runtime, not the sparse
    # editable controls (their subframe interpolation differs from the bake).
    sources = [bpy.data.objects['P320_surface'],
               *bpy.data.objects['MUZZLE_device_removed'].children]
    hands = [o for o in bpy.data.collections['P320 | authored hands (shared appearance)'].objects if o.type == 'MESH']
    for side in ('left', 'right'):
        armature = bpy.data.objects['P320_arm_'+side]
        assert any(any(mod.type == 'ARMATURE' and mod.object == armature for mod in obj.modifiers)
                   for obj in hands), 'missing deformed '+side+' hand'
    rest_relation = None
    count = 0
    for name, clip in clips.items():
        for obj in scene.objects:
            if obj.animation_data:
                obj.animation_data.action = None
                for track in obj.animation_data.nla_tracks:
                    track.mute = track.name != name
        for sample in range(math.ceil(clip['duration']*120)+1):
            frame = min(sample/120, clip['duration'])*scene.render.fps
            scene.frame_set(math.floor(frame), subframe=frame % 1)
            bpy.context.view_layer.update()
            inverse = mount.matrix_world.inverted()
            barrel = arm.matrix_world @ arm.pose.bones['barrel'].matrix
            relation = barrel.inverted() @ mount.matrix_world
            if rest_relation is None:
                rest_relation = relation.copy()
            assert max(abs(relation[r][c]-rest_relation[r][c]) for r in range(4) for c in range(4)) < 2e-6, (name, sample, 'mount detached from barrel')
            # Actual skin evaluation for hands; broad phase avoids building BVHs
            # for the grip, magazine and distant surfaces on every 120 Hz sample.
            depsgraph = bpy.context.evaluated_depsgraph_get()
            for obj in sources + hands:
                evaluated = obj.evaluated_get(depsgraph)
                transform = inverse @ evaluated.matrix_world
                bounds = [transform @ Vector(p) for p in evaluated.bound_box]
                if any(max(p[i] for p in bounds) < low or min(p[i] for p in bounds) > high
                       for i, (low, high) in enumerate(((-.015, .015), (0, .136), (-.015, .015)))):
                    continue
                mesh = evaluated.to_mesh()
                target = BVHTree.FromPolygons([transform @ v.co for v in mesh.vertices],
                                             [tuple(p.vertices) for p in mesh.polygons])
                assert not can.overlap(target), (name, sample, obj.name, 'can intersection')
                evaluated.to_mesh_clear()
            for id, (points, polygons) in optics.items():
                transform = inverse @ bpy.data.objects['MOUNT_optic'].matrix_world
                target = BVHTree.FromPolygons([transform @ p for p in points], polygons)
                assert not can.overlap(target), (name, sample, id, 'can/optic')
            transform = inverse @ bpy.data.objects['MOUNT_rail'].matrix_world
            laser = BVHTree.FromPolygons([transform @ p for p in laser_vertices], laser_faces)
            assert not can.overlap(laser), (name, sample, 'can/TOR Mini')
            assert can.ray_cast(transform @ emitter, (transform.to_3x3() @ Vector((0, 1, 0))).normalized(), 1)[0] is None, (name, sample, 'can blocks laser')
            if name == 'Idle':
                rig = bpy.data.objects['P320_RIG']
                ray = inverse @ rig.matrix_world @ Vector((0, -.026, .0537))
                direction = (inverse.to_3x3() @ rig.matrix_world.to_3x3() @ Vector((0, 1, 0))).normalized()
                assert can.ray_cast(ray, direction, 1)[0] is None, 'can blocks fixed SIGLITE aim ray'
                # Every supported optic's actual optical datum, not its housing bounds.
                for id in ('rmr', 'acog', 'scope') if sample == 0 else ():
                    _, _, sight = attachment_geometry(id, 'SOCKET_sight')
                    transform = inverse @ bpy.data.objects['MOUNT_optic'].matrix_world
                    assert can.ray_cast(transform @ sight, (transform.to_3x3() @ Vector((0, 1, 0))).normalized(), 1)[0] is None, id + ' sightline blocked'
            count += 1
    print('P320_SUPPRESSOR_OK:', count, 'poses at 120Hz; barrel parent, weapon/slide, both hands, three optics, TOR Mini/emitter; loaded-rest iron and optic aim rays')
