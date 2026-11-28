"""Review direct cosmetic foregrip fits on the baked game weapons; never export a fit."""
import argparse
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import attachment_source
import picatinny
from m4.actions import C, set_hand_pose
from m4.animations import FPS, select_clip
from review_hands import author_review_hands

# Scene labels, rigid carriers and underside groove origins in the idle rig frame.
# EVOLYS shares its origin with the laser and has its rail joined into the guard.
WEAPONS = {
    'm4': ('M4', 'M4A1', 'handguard', (.250, .04645), 'RIS II bottom tooth', 'srd762ti'),
    'm590': ('M590', 'M590', 'forend', (.298, .004), 'Bottom Picatinny lug', 'suppressor12g'),
    'evolys': ('EVOLYS', 'EVOLYS', 'handguard', None, None, 'srd762ti'),
}
MOVING = {'bolt', 'bolt_head', 'charging_handle', 'trigger', 'dust_cover', 'mag_release', 'magazine',
          'magazine_spare', 'spent_case', 'shell_insert', 'feed_cover', 'pouch', 'pouch_spare', 'belt_rig'}
PALM_AND_PADS = ('hand', 'thumb_1', *(f'finger_{i}_2' for i in range(4)))
surface = attachment_source.surface


def frames(clip):
    end = clip['duration'] * FPS
    for sample in range(math.ceil(end) + 1):
        yield min(sample, end)


def seek(scene, frame):
    scene.frame_set(math.floor(frame), subframe=frame % 1)


def draft_skin(id, candidate, controls, rig, name, clip, carrier, carrier_rest):
    for obj in controls.values():
        for track in obj.animation_data.nla_tracks:
            track.mute = True
    x, y, z, w = candidate['quaternion']
    set_hand_pose(controls, candidate['position'], Quaternion((w, x, y, z)), candidate['pose'])
    wrist = controls['wrist']
    if name == 'Pump':
        # Track the evaluated slide in weapon space, not an approximation of
        # its stroke or an arm mesh translated away from its shoulder.
        rest = wrist.location.copy()
        wrist.animation_data.action = bpy.data.actions.new(f'{id} | review wrist')
        scene = bpy.context.scene
        for frame in frames(clip):
            seek(scene, frame)
            slide = (rig.matrix_world.inverted() @ carrier.matrix_world).translation - carrier_rest
            wrist.location = rest + slide
            wrist.keyframe_insert('location', frame=frame)
    review = author_review_hands(attachment_source.ROOT, rig, {'left': controls}, [],
                                 {name: clip}, basis=C, label=f'{id}-{name}', frame_step=1)
    wrist.animation_data.action = None
    select_clip([], review, {name: clip}, name)
    return [o for o in review if o.type == 'MESH']


def patch_gap(glove, inverse, target):
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
    return max(gaps.values())


def joined_rail(guard, inverse):
    """Partition the EVOLYS guard without exempting its shell from interference."""
    group = guard.vertex_groups['LASER_mount_hardware'].index
    obj = guard.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = obj.to_mesh()
    matrix = inverse @ obj.matrix_world
    vertices = [matrix @ v.co for v in mesh.vertices]
    rail_ids = {v.index for v in mesh.vertices if any(g.group == group and g.weight > .5 for g in v.groups)}
    rail, shell = [], []
    mesh.calc_loop_triangles()
    for tri in mesh.loop_triangles:
        (rail if all(i in rail_ids for i in tri.vertices) else shell).append(tuple(tri.vertices))
    obj.to_mesh_clear()
    assert rail and shell
    span = min(vertices[i].y for i in rail_ids), max(vertices[i].y for i in rail_ids)
    return BVHTree.FromPolygons(vertices, rail, all_triangles=True), BVHTree.FromPolygons(vertices, shell, all_triangles=True), span


def grip_bounds(objects, inverse):
    return [inverse @ o.matrix_world @ Vector(p) for o in objects for p in o.bound_box]


def place(id, carrier, anchor):
    preview = bpy.data.objects.new(f'Foregrip review | {id}', None)
    bpy.context.scene.collection.objects.link(preview)
    preview.parent = carrier
    preview.location = carrier.matrix_world.inverted() @ anchor
    bpy.context.view_layer.update()
    return preview, [o for o in attachment_source.seat(id, preview) if o.type == 'MESH']


def color_skin(objects):
    for obj in objects:
        obj.color = (.12, .16, .19, 1) if 'Olive' not in obj.name else (.17, .20, .15, 1)


def capture(output, label, aim):
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
    scene.render.film_transparent = False
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
        camera.location = aim + Vector(direction)
        camera.rotation_euler = (-Vector(direction)).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(output / f'{label}-{side}.png')
        bpy.ops.render.render(write_still=True)


def main(weapon, output):
    scene = bpy.context.scene
    label, collection, carrier_name, origin, tooth_prefix, suppressor = WEAPONS[weapon]
    carrier = bpy.data.objects[carrier_name]
    rig = bpy.data.objects[f'{label}_RIG']
    parts = list(bpy.data.collections[f'{collection} | authored components'].objects)
    review = list(bpy.data.collections[f'{label} | authored hands (shared appearance)'].objects)
    meshes = [obj for obj in parts if obj.type == 'MESH']
    skin = [obj for obj in review if obj.type == 'MESH']
    clips = json.loads(scene['clips'])
    candidates = json.loads(Path(__file__).with_name('fit-review.json').read_text())[weapon]
    select_clip(parts, review, clips, 'Idle')
    rig_inverse = rig.matrix_world.inverted()
    inner = carrier.matrix_world.inverted()
    carrier_rest = (rig_inverse @ carrier.matrix_world).translation

    def mount(id, socket):
        return [o for o in attachment_source.seat(id, bpy.data.objects[socket], weapon=weapon) if o.type == 'MESH']

    laser = mount('laser', 'MOUNT_rail')
    emitter = bpy.data.objects['SOCKET_laser']
    attachments = {'laser': laser, **{id: mount(id, 'MOUNT_optic') for id in attachment_source.OPTICS},
                   **{id: mount(id, 'MOUNT_muzzle') for id in (suppressor, 'm4_72')}}
    other_guard = None
    if origin:
        groove, bottom = origin
        rail_meshes = [o for o in meshes if o.name.startswith(tooth_prefix)]
        seats = surface(rail_meshes, rig_inverse)
    else:
        groove, bottom = (rig_inverse @ bpy.data.objects['MOUNT_rail'].matrix_world.translation).yz
        rail_meshes = [bpy.data.objects['handguard_mesh']]
        seats, other_guard, span = joined_rail(rail_meshes[0], rig_inverse)
    moving = [o for o in meshes if o.parent.name in MOVING]
    fixed = [o for o in meshes if o not in moving and o not in rail_meshes]
    pump_shell = None
    if weapon == 'm590':
        pump_shell = surface([o for o in fixed if o.parent == carrier], rig_inverse)
        fixed = [o for o in fixed if o.parent != carrier]
    nonseating = {'weapon': surface(fixed, rig_inverse),
                  **{id: surface(objects, rig_inverse) for id, objects in attachments.items()}}
    if other_guard:
        nonseating['guard shell'] = other_guard
    # Laser is receiver-fixed on the pump weapon, so recheck from rig space.
    emission = rig_inverse @ emitter.matrix_world.translation

    def rigid_conflicts(target):
        return [name for name, geometry in nonseating.items() if target.overlap(geometry)] + (
            ['TOR Mini beam'] if target.ray_cast(emission, Vector((0, 1, 0)), 1)[0] is not None else [])

    if weapon == 'evolys':
        # Report all whole grooves with the AFG-2 envelope inside the rail, not
        # just the nominated slot. This report never auto-enables a new pair.
        holder, trial = place('afg2', carrier, rig.matrix_world @ Vector((0, groove, bottom + .00015)))
        for slot in range(math.floor((span[0] - groove) / picatinny.PITCH),
                          math.ceil((span[1] - groove) / picatinny.PITCH) + 1):
            holder.location.y = (inner @ rig.matrix_world @ Vector((0, groove + slot * picatinny.PITCH, bottom))).y
            bpy.context.view_layer.update()
            bound = grip_bounds(trial, rig_inverse)
            if min(p.y for p in bound) >= span[0] - .0001 and max(p.y for p in bound) <= span[1] + .0001:
                probe = surface(trial, rig_inverse)
                print(f'EVOLYS AFG-2 slot {slot}: {rigid_conflicts(probe) or "clear rigid candidate (not pose-verified)"}')
        holder.hide_render = True
        for o in trial:
            o.hide_render = True

    targets, grips, aim = {}, {}, {}
    for id, candidate in candidates.items():
        station = groove + candidate['slot'] * picatinny.PITCH
        _, grip = place(id, carrier, rig.matrix_world @ Vector((0, station, bottom + candidate['inset'])))
        crown = max(p.z for p in grip_bounds(grip, rig_inverse))
        assert crown - bottom < picatinny.SLOT_DEPTH, (id, 'crown reaches the groove bed')
        target = surface(grip, rig_inverse)
        assert target.overlap(seats), (id, 'floating above the bottom rail')
        assert not (conflicts := rigid_conflicts(target)), (id, 'intersects', conflicts)
        assert not pump_shell or not target.overlap(pump_shell), (id, 'intersects slide outside the tooth faces')
        targets[id], grips[id], aim[id] = surface(grip, inner), grip, Vector((0, station, bottom - .045))
        print(f'{weapon} / {id}: bottom-tooth contact, clear of non-seating surfaces and mounted accessories', flush=True)

    checked_strokes = set()
    for name, clip in clips.items():
        select_clip(parts, review, clips, name)
        clashes = dict.fromkeys(targets, 0)
        samples = 0
        for frame in frames(clip):
            seek(scene, frame)
            samples += 1
            inverse = carrier.matrix_world.inverted()
            posed_skin = surface(skin, inverse)
            mechanism = surface([o for o in moving if min(o.parent.scale) > .5], inverse)
            for id, target in targets.items():
                assert not target.overlap(mechanism), (id, name, frame, 'intersects moving weapon')
                clashes[id] += bool(target.overlap(posed_skin))
            if weapon == 'm590':
                rig_inverse = rig.matrix_world.inverted()
                stroke = round((rig_inverse @ carrier.matrix_world).translation.y, 6)
                if stroke not in checked_strokes:
                    for id, objects in grips.items():
                        # Only the receiver and its accessories are independent
                        # of the slide. The slide's own geometry was checked in Idle.
                        if stroke != round(carrier_rest.y, 6):
                            target = surface(objects, rig_inverse)
                            assert not (conflicts := rigid_conflicts(target)), (id, name, frame, conflicts)
                    checked_strokes.add(stroke)
        for id, count in clashes.items():
            print(f'{weapon} / {id} / {name}: stock skin intersects at {count}/{samples} samples', flush=True)

    controls = {'wrist': bpy.data.objects['hand_L'], **{
        obj.name[2:]: obj for obj in parts if obj.name.startswith(('L_finger_', 'L_thumb_'))
    }}
    if output:
        output.mkdir(parents=True, exist_ok=True)
        color_skin(skin)
        for obj in meshes:
            obj.color = (.26, .21, .15, 1) if obj.parent == carrier else (.09, .10, .11, 1)
        for id, objects in {**attachments, **grips}.items():
            for obj in objects:
                obj.hide_render = id != 'laser'
                obj.color = (.045, .05, .055, 1)
    for id, objects in grips.items():
        select_clip(parts, review, clips, 'Idle')
        if output:
            for obj in skin:
                obj.hide_render = False
            capture(output, f'{id}-none', aim[id])
            for obj in objects:
                obj.hide_render = False
            capture(output, f'{id}-stock-hand', aim[id])
            for obj in skin:
                obj.hide_render = obj.name.startswith(f'{label}_left_')
        for name in ('Idle', 'Pump') if weapon == 'm590' else ('Idle',):
            clip = clips[name]
            select_clip(parts, review, clips, name)
            posed = draft_skin(id, candidates[id], controls, rig, name, clip, carrier, carrier_rest)
            glove = next(obj for obj in posed if 'Charcoal_woven_glove' in obj.name)
            max_gap = 0
            for frame in frames(clip):
                seek(scene, frame)
                inverse = carrier.matrix_world.inverted()
                skin_tree = surface(posed, inverse)
                visible = [o for o in meshes if not o.hide_render and min(o.parent.scale) > .5]
                assert not surface(visible, inverse).overlap(skin_tree), (id, name, frame, 'draft skin intersects weapon')
                for accessory, geometries in {'foregrip': objects, **attachments}.items():
                    assert not surface(geometries, inverse).overlap(skin_tree), (id, name, frame, 'draft skin intersects', accessory)
                max_gap = max(max_gap, patch_gap(glove, inverse, targets[id]))
            assert max_gap < .003, (id, name, 'draft palm or pad is off the grip', max_gap)
            print(f'{weapon} / {id}: draft {name} skin clears weapon and attachments; palm/pad gap ≤ {max_gap*1000:.2f} mm', flush=True)
            if output:
                color_skin(posed)
                if name == 'Pump':
                    seek(scene, .32 * clip['duration'] * FPS)
                target = carrier.matrix_world @ (aim[id] - carrier_rest)
                capture(output, f'{id}-draft-{name.lower()}', target)
            for obj in posed:
                obj.hide_render = True
        for obj in objects:
            obj.hide_render = True


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('weapon', choices=WEAPONS)
    parser.add_argument('--renders', type=Path, help='Optional matched Blender captures.')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    main(args.weapon, args.renders.resolve() if args.renders else None)
