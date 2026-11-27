"""Review cosmetic M4 seats and draft contact poses; never export a fit."""
import argparse
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import attachment_source
import picatinny
from m4.actions import C, set_hand_pose
from m4.animations import FPS, select_clip
from review_hands import author_review_hands

# Visual seats relative to the forend's bottom groove grid. Each exterior has a
# closed crown: seat it shallowly against the tooth faces, not through the web.
BOTTOM = .04645
PALM_AND_PADS = ('hand', 'thumb_1', *(f'finger_{i}_2' for i in range(4)))


def draft_skin(id, candidate, rig, controls, idle):
    for obj in controls.values():
        for track in obj.animation_data.nla_tracks:
            track.mute = True
    x, y, z, w = candidate['quaternion']
    set_hand_pose(controls, candidate['position'], Quaternion((w, x, y, z)), candidate['pose'])
    review = author_review_hands(attachment_source.ROOT, rig, {'left': controls}, [], idle, basis=C, label=id)
    select_clip([], review, idle, 'Idle')
    return [o for o in review if o.type == 'MESH']


def patch_gaps(glove, inverse, target):
    obj = glove.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = obj.to_mesh()
    frame = inverse @ obj.matrix_world
    gaps = dict.fromkeys(PALM_AND_PADS, math.inf)
    for vertex in mesh.vertices:
        if not vertex.groups:
            continue
        group = max(vertex.groups, key=lambda weight: weight.weight)
        name = glove.vertex_groups[group.group].name
        if name in gaps:
            gaps[name] = min(gaps[name], target.find_nearest(frame @ vertex.co)[3])
    obj.to_mesh_clear()
    return gaps


def color_skin(objects):
    for obj in objects:
        obj.color = (.12, .16, .19, 1) if 'Olive' not in obj.name else (.17, .20, .15, 1)


def capture(output, label, y):
    scene = bpy.context.scene
    if scene.camera is None or scene.camera.name != 'Foregrip review':
        camera = bpy.data.objects.new('Foregrip review', bpy.data.cameras.new('Foregrip review'))
        scene.collection.objects.link(camera)
        scene.camera = camera
    camera = scene.camera
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = .30
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x, scene.render.resolution_y = 960, 640
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.exposure = .9
    shading = scene.display.shading
    shading.light = 'STUDIO'
    shading.color_type = 'OBJECT'
    shading.show_cavity = True
    shading.cavity_type = 'BOTH'
    shading.background_type = 'VIEWPORT'
    shading.background_color = (.16, .16, .16)
    for side, direction in [('left', (-.9, -.08, -.11)), ('right', (.88, -.12, -.28))]:
        aim = Vector((0, y, .008))
        camera.location = aim + Vector(direction)
        camera.rotation_euler = (-Vector(direction)).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(output / f'{label}-{side}.png')
        bpy.ops.render.render(write_still=True)


def main(output):
    scene = bpy.context.scene
    guard = bpy.data.objects['handguard']
    rig = bpy.data.objects['M4_RIG']
    parts = list(bpy.data.collections['M4A1 | authored components'].objects)
    review = list(bpy.data.collections['M4 | authored hands (shared appearance)'].objects)
    meshes = [obj for obj in parts if obj.type == 'MESH']
    skin = [obj for obj in review if obj.type == 'MESH']
    clips = json.loads(scene['clips'])
    candidates = json.loads(Path(__file__).with_name('foregrip-review.json').read_text())
    select_clip(parts, review, clips, 'Idle')

    def mount(id, socket):
        return [o for o in attachment_source.seat(id, bpy.data.objects[socket], weapon='m4')
                if o.type == 'MESH']

    laser = mount('laser', 'MOUNT_rail')
    emitter = bpy.data.objects['SOCKET_laser']
    attachments = {'laser': laser}
    for id in attachment_source.OPTICS:
        attachments[id] = mount(id, 'MOUNT_optic')
    for id in ('srd762ti', 'm4_72'):
        attachments[id] = mount(id, 'MOUNT_muzzle')
    teeth = [o for o in meshes if o.name.startswith('RIS II bottom tooth')]
    moving_parents = {'bolt', 'bolt_head', 'charging_handle', 'trigger', 'dust_cover',
                      'mag_release', 'magazine', 'magazine_spare', 'spent_case'}
    moving = [o for o in meshes if o.parent.name in moving_parents]
    fixed = [o for o in meshes if o not in teeth and o not in moving]
    inverse = guard.matrix_world.inverted()
    surface = attachment_source.surface
    seats = surface(teeth, inverse)
    nonseating = {'weapon': surface(fixed, inverse),
                  **{id: surface(objects, inverse) for id, objects in attachments.items()}}
    emission = inverse @ emitter.matrix_world.translation
    targets, grips, stations = {}, {}, {}
    for id, candidate in candidates.items():
        station = .250 + candidate['slot'] * picatinny.PITCH
        inset = candidate['inset']
        preview = bpy.data.objects.new(f'Foregrip review | {id}', None)
        scene.collection.objects.link(preview)
        preview.parent = guard
        preview.location = inverse @ rig.matrix_world @ Vector((0, station, BOTTOM + inset))
        bpy.context.view_layer.update()
        grip = [o for o in attachment_source.seat(id, preview) if o.type == 'MESH']
        crown = max((rig.matrix_world.inverted() @ o.matrix_world @ Vector(p)).z
                    for o in grip for p in o.bound_box)
        assert crown - BOTTOM < picatinny.SLOT_DEPTH, (id, 'crown reaches the groove bed')
        target = surface(grip, inverse)
        assert target.overlap(seats), (id, 'floating above the bottom rail')
        for name, geometry in nonseating.items():
            assert not target.overlap(geometry), (id, 'intersects', name)
        assert target.ray_cast(emission, Vector((0, 1, 0)), 1)[0] is None, (id, 'blocks TOR Mini')
        targets[id], grips[id], stations[id] = target, grip, station
        print(f'{id}: bottom-tooth contact, clear of non-seating surfaces and mounted accessories', flush=True)

    for name, clip in clips.items():
        select_clip(parts, review, clips, name)
        end = clip['duration'] * FPS
        clashes = {id: [] for id in targets}
        for sample in range(math.ceil(end) + 1):
            frame = min(sample, end)
            scene.frame_set(math.floor(frame), subframe=frame % 1)
            inverse = guard.matrix_world.inverted()
            posed_skin = surface(skin, inverse)
            mechanism = surface([o for o in moving if min(o.parent.scale) > .5], inverse)
            for id, target in targets.items():
                assert not target.overlap(mechanism), (id, name, frame, 'intersects moving weapon')
                if target.overlap(posed_skin):
                    clashes[id].append(frame)
        for id, frames in clashes.items():
            span = f' (first {frames[0] / FPS:.3f}s, last {frames[-1] / FPS:.3f}s)' if frames else ''
            print(f'{id} / {name}: stock skin intersects at {len(frames)}/{math.ceil(end) + 1} samples{span}', flush=True)

    select_clip(parts, review, clips, 'Idle')
    inverse = guard.matrix_world.inverted()
    idle_weapon = surface([obj for obj in meshes if not obj.hide_render and min(obj.parent.scale) > .5], inverse)
    left = [obj for obj in skin if obj.name.startswith('M4_left_')]
    controls = {'wrist': bpy.data.objects['hand_L'], **{
        obj.name[2:]: obj for obj in parts if obj.name.startswith(('L_finger_', 'L_thumb_'))
    }}
    if output:
        output.mkdir(parents=True, exist_ok=True)
        color_skin(skin)
        for obj in meshes:
            obj.color = (.26, .21, .15, 1) if obj.name.startswith('RIS II') else (.09, .10, .11, 1)
        for id, objects in {**attachments, **grips}.items():
            for obj in objects:
                obj.hide_render = id != 'laser'
                obj.color = (.045, .05, .055, 1)
    for id, objects in grips.items():
        if output:
            for obj in skin:
                obj.hide_render = False
            capture(output, f'{id}-none', stations[id])
            for obj in objects:
                obj.hide_render = False
            capture(output, f'{id}-stock-hand', stations[id])
        posed = draft_skin(id, candidates[id], rig, controls, {'Idle': clips['Idle']})
        posed_tree = surface(posed, inverse)
        for name, target in {**nonseating, 'weapon': idle_weapon, 'foregrip': targets[id]}.items():
            assert not target.overlap(posed_tree), (id, 'draft idle hand intersects', name)
        glove = next(obj for obj in posed if 'Charcoal_woven_glove' in obj.name)
        gaps = patch_gaps(glove, inverse, targets[id])
        assert max(gaps.values()) < .003, (id, 'draft palm or pad is off the grip', gaps)
        print(f'{id}: draft idle skin clears weapon and attachments; largest palm/pad gap {max(gaps.values())*1000:.2f} mm', flush=True)
        if output:
            for obj in left:
                obj.hide_render = True
            color_skin(posed)
            capture(output, f'{id}-draft-idle', stations[id])
            for obj in objects:
                obj.hide_render = True
        for obj in posed:
            obj.hide_render = True


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--renders', type=Path, help='Optional matched idle captures, with and without each grip.')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    main(args.renders.resolve() if args.renders else None)
