"""Actual catalog surfaces against MCX mechanisms and authored review hands.

Finite 120 Hz source samples, not continuous collision or human visual acceptance.
"""
import bpy
from mathutils import Vector
from mcx.review_hands import review_tracks, select_review_clip

import attachment_source


def points(obj, inverse):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    vertices = [inverse @ evaluated.matrix_world @ v.co for v in mesh.vertices]
    evaluated.to_mesh_clear()
    return vertices


def check_attachment_fits():
    scene = bpy.context.scene
    rig = bpy.data.objects['MCX_RIG']
    asset = bpy.data.collections['MCX VIRTUS | authored components']
    select_review_clip('Idle')
    scene.frame_set(0)
    bpy.context.view_layer.update()
    inverse = rig.matrix_world.inverted()
    installed = bpy.data.objects['IRON_sights']
    folded = bpy.data.objects['IRON_sights_removed']
    device = bpy.data.objects['MUZZLE_device']
    # Weapon Blender +X forward; attachment Blender +Y forward and +Z up.
    for name, position in [('MOUNT_optic',(-.036,0,.046)),('MOUNT_muzzle',(.274,0,.009))]:
        mount = bpy.data.objects[name]
        local = inverse @ mount.matrix_world
        assert mount.parent == bpy.data.objects['receiver']
        assert (local.translation-Vector(position)).length < 1e-6, name
        assert (local.to_3x3() @ Vector((0,1,0))-Vector((1,0,0))).length < 1e-6, name
        assert (local.to_3x3() @ Vector((0,0,1))-Vector((0,0,1))).length < 1e-6, name
    fixed = [o for o in asset.objects if o.type == 'MESH' and o.parent == bpy.data.objects['receiver']]
    hands = [o for o in bpy.data.collections['MCX | authored hands (shared appearance)'].objects if o.type == 'MESH']
    attachments = []
    loaded = []
    for id, slot in [('rmr','optic'),('acog','optic'),('scope','optic'),('exps3','optic'),('srd762ti','muzzle'),('laser','rail')]:
        objects = attachment_source.seat(id, bpy.data.objects['MOUNT_'+slot])
        loaded.extend(objects)
        meshes = [o for o in objects if o.type == 'MESH' and
                  (slot != 'rail' or o.name.startswith('TOR_MINI_body'))]
        surface = attachment_source.surface(meshes,inverse)
        # Only real rail mating faces may contact optics; other receiver,
        # handguard, adapter and base muzzle surfaces must remain disjoint.
        for obj in fixed if slot != 'rail' else []:
            if slot == 'optic' and obj.name.startswith('Picatinny rail tooth'):
                continue
            overlap = surface.overlap(attachment_source.surface([obj],inverse))
            if overlap and slot == 'muzzle' and obj.name in ('Barrel under vented guard','Muzzle thread'):
                # The direct-thread shoulder is intentional coplanar contact,
                # never permission for the can to cross into the barrel body.
                weapon_points = points(obj,inverse)
                can_points = [p for mesh in meshes for p in points(mesh,inverse)]
                assert max(p.x for p in weapon_points) <= .278601
                assert min(p.x for p in can_points) >= .273999
                assert obj.name == 'Muzzle thread' or max(p.x for p in weapon_points) <= .274001
            else:
                assert not overlap, (id,'fixed collision',obj.name)
        if slot == 'optic':
            clashes = bool(surface.overlap(attachment_source.surface(list(installed.children),inverse)))
            assert clashes == (id == 'scope'), (id,'unexpected installed-iron fit',clashes)
            assert not surface.overlap(attachment_source.surface(list(folded.children),inverse)), (id,'folded leaf collision')
        elif slot == 'muzzle':
            assert not surface.overlap(attachment_source.surface(list(installed.children),inverse)), 'can clips irons'
            exit = attachment_source.named(objects, 'SOCKET_muzzle')
            assert (inverse @ exit.matrix_world.translation-Vector((.510,0,.009))).length < 1e-6, 'installed exit'
        elif slot == 'rail':
            emitter = attachment_source.named(objects, 'SOCKET_laser')
            emitter_frame = inverse @ emitter.matrix_world
        attachments.append((id,surface))
    # Optical, muzzle and laser slots may coexist; optic alternatives do not.
    can = attachments[-2][1]
    laser = attachments[-1][1]
    for id, surface in attachments[:-2]:
        assert not surface.overlap(can), (id,'suppressor collision')
        assert not surface.overlap(laser), (id,'laser collision')
    assert not can.overlap(laser), 'suppressor/laser collision'
    for id, surface in attachments[:-1]:
        direction = (emitter_frame.to_3x3() @ Vector((0,1,0))).normalized()
        assert surface.ray_cast(emitter_frame.translation,direction,1)[0] is None, (id,'blocks laser emission')
    count = 0
    checked = set()
    try:
        for track in review_tracks():
            select_review_clip(track['name'])
            for time in track['times']:
                frame = time*60
                scene.frame_set(int(frame),subframe=frame%1)
                inverse = rig.matrix_world.inverted()
                moving = [o for o in asset.objects if o.type == 'MESH' and o.parent not in (bpy.data.objects['receiver'],installed,folded,device)]
                # Rigid mechanism states repeat during held review poses.
                state = tuple(round(v,7) for o in moving for row in (inverse@o.matrix_world) for v in row)
                if state not in checked:
                    checked.add(state)
                    mechanism = attachment_source.surface(moving,inverse)
                    for id,surface in attachments:
                        assert not surface.overlap(mechanism), (track['name'],time,id,'mechanism collision')
                skin = attachment_source.surface(hands,inverse)
                for id,surface in attachments:
                    assert not surface.overlap(skin), (track['name'],time,id,'review hand collision')
                count += 1
    finally:
        for obj in loaded:
            bpy.data.objects.remove(obj,do_unlink=True)
        select_review_clip('Idle')
    print('MCX_ATTACHMENT_FITS_OK:',count,'120Hz poses; RMR/ACOG installed irons, PM II folded irons; all optics + suppressor; mechanisms and both review arms')
