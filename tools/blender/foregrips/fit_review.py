"""Review direct cosmetic foregrip fits on the baked game weapons; never export a fit."""
import argparse
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import attachment_source
import picatinny
from attachment_source import FOREGRIP_ADAPTER_TOOTH, bounds, geometry, surface, tree
from m4.actions import C, set_hand_pose
from m4.animations import select_clip
from mcx.hands import C as MCX_BASIS
from mpx.actions import C as MPX_BASIS
from review_hands import author_review_hands
from tor_mini.mounts import PROFILES

# Review label, hand basis, carrier, rail origin, tooth prefix, catalog muzzle
# props, and whether the carrier slides. On adapter models the datum defines the
# carrier and rail frame; EVOLYS joins its rail into the guard.
WEAPONS = {
    'm4': ('M4', C, 'handguard', (.250, .04645), 'RIS II bottom tooth', ('srd762ti', 'm4_72'), False),
    'm590': ('M590', C, 'forend', (.298, .004), 'Bottom Picatinny lug', ('suppressor12g', 'm4_72'), True),
    'evolys': ('EVOLYS', C, 'handguard', None, None, ('srd762ti', 'm4_72'), False),
    'mcx': ('MCX', MCX_BASIS, None, None, FOREGRIP_ADAPTER_TOOTH, ('srd762ti', 'm4_72'), False),
    'mpx': ('MPX', MPX_BASIS, None, None, FOREGRIP_ADAPTER_TOOTH, ('suppressor9mm',), False),
    'ax338': ('AX338', C, None, None, FOREGRIP_ADAPTER_TOOTH, ('suppressor338', 'm4_72'), False),
}
MOVING = {'bolt', 'bolt_head', 'charging_handle', 'trigger', 'dust_cover', 'mag_release', 'magazine',
          'magazine_spare', 'spent_case', 'shell_insert', 'feed_cover', 'pouch', 'pouch_spare', 'belt_rig',
          'bolt_release', 'magazine_catch', 'stock', 'stock_hinge'}
PALM_AND_PADS = ('hand', 'thumb_1', *(f'finger_{i}_2' for i in range(4)))
CAPTURE_CLIPS = ('Idle', 'Pump', 'Bolt_Cycle')
SAMPLE_HZ = 120


def frames(scene, clip):
    # Sample at a common rate even when a scene stores keys at a lower FPS.
    duration = clip['duration']
    for sample in range(math.ceil(duration * SAMPLE_HZ) + 1):
        yield min(sample / SAMPLE_HZ, duration) * scene.render.fps


def seek(scene, frame):
    scene.frame_set(math.floor(frame), subframe=frame % 1)


def parents(obj):
    while obj.parent:
        obj = obj.parent
        yield obj


def shown(obj):
    return all(min(parent.scale) > .5 for parent in parents(obj))


def draft_skin(id, candidate, controls, rig, basis, name, clip, carrier, carrier_rest):
    for obj in controls.values():
        for track in obj.animation_data.nla_tracks:
            track.mute = True
    x, y, z, w = candidate['quaternion']
    set_hand_pose(controls, candidate['position'], Quaternion((w, x, y, z)), candidate['pose'], basis=basis)
    wrist = controls['wrist']
    if name == 'Pump':
        # Track the evaluated slide in weapon space, not an approximation of
        # its stroke or an arm mesh translated away from its shoulder.
        rest = wrist.location.copy()
        wrist.animation_data.action = bpy.data.actions.new(f'{id} | review wrist')
        scene = bpy.context.scene
        for frame in frames(scene, clip):
            seek(scene, frame)
            slide = (rig.matrix_world.inverted() @ carrier.matrix_world).translation - carrier_rest
            wrist.location = rest + slide
            wrist.keyframe_insert('location', frame=frame)
    review = author_review_hands(attachment_source.ROOT, rig, {'left': controls}, [],
                                 {name: clip}, basis=basis, label=f'{id}-{name}', frame_step=1)
    wrist.animation_data.action = None
    select_clip([], review, {name: clip}, name)
    return review


def patch_indices(glove):
    patches = {name: [] for name in PALM_AND_PADS}
    for vertex in glove.data.vertices:
        if vertex.groups:
            group = max(vertex.groups, key=lambda weight: weight.weight)
            name = glove.vertex_groups[group.group].name
            if name in patches:
                patches[name].append(vertex.index)
    return patches.values()


def patch_gap(glove, patches, inverse, target):
    obj = glove.evaluated_get(bpy.context.evaluated_depsgraph_get())
    frame = inverse @ obj.matrix_world
    # Armature deformation preserves the glove's vertex indices.
    vertices = obj.data.vertices
    return max(min((target.find_nearest(frame @ vertices[i].co)[3] for i in patch), default=math.inf)
               for patch in patches)


def joined_rail(guard, inverse, rig_to_rail):
    """Partition the EVOLYS guard without exempting its shell from interference."""
    vertices, faces = geometry(guard, inverse)
    _, rail = geometry(guard, inverse, 'LASER_mount_hardware')
    rail_faces = set(rail)
    shell = [face for face in faces if face not in rail_faces]
    assert shell
    stations = [(rig_to_rail @ vertices[i]).y for i in {i for face in rail for i in face}]
    return tree(vertices, rail), tree(vertices, shell), (min(stations), max(stations))


def place(id, carrier, frame):
    preview = bpy.data.objects.new(f'Foregrip review | {id}', None)
    bpy.context.scene.collection.objects.link(preview)
    preview.parent = carrier
    preview.matrix_basis = carrier.matrix_world.inverted() @ frame
    bpy.context.view_layer.update()
    return preview, [o for o in attachment_source.seat(id, preview) if o.type == 'MESH']


def color_skin(objects):
    for obj in objects:
        obj.color = (.12, .16, .19, 1) if 'Olive' not in obj.name else (.17, .20, .15, 1)


def capture(output, label, view):
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
    for side, offset in [('left', (-.9, -.08, -.11)), ('right', (.88, -.12, -.28))]:
        direction = view.to_3x3() @ Vector(offset)
        camera.location = view.translation + direction
        camera.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(output / f'{label}-{side}.png')
        bpy.ops.render.render(write_still=True)


def main(weapon, output):
    scene = bpy.context.scene
    label, basis, carrier_name, origin, tooth_prefix, muzzle_props, moving_carrier = WEAPONS[weapon]
    rig_name, collection, _, _ = PROFILES[weapon]
    datum = bpy.data.objects['MOUNT_foregrip'] if carrier_name is None else None
    carrier = datum.parent if datum else bpy.data.objects[carrier_name]
    rig = bpy.data.objects[rig_name]
    parts = list(bpy.data.collections[collection].objects)
    review = list(bpy.data.collections[f'{label} | authored hands (shared appearance)'].objects)
    meshes = [obj for obj in parts if obj.type == 'MESH']
    skin = [obj for obj in review if obj.type == 'MESH']
    right_skin = [obj for obj in skin if obj.name.startswith(f'{label}_right_')]
    clips = json.loads(scene['clips'])
    fits = json.loads(Path(__file__).with_name('fit-review.json').read_text())
    candidates = {id: {**fits[fit['poseFrom']][id], **fit} if 'poseFrom' in fit else fit
                  for id, fit in fits[weapon].items()}
    select_clip(parts, review, clips, 'Idle')
    rig_inverse = rig.matrix_world.inverted()
    inner = carrier.matrix_world.inverted()
    carrier_rest = (rig_inverse @ carrier.matrix_world).translation

    def mount(id, socket):
        return attachment_source.seat(id, bpy.data.objects[socket], weapon=weapon)

    laser = mount('laser', 'MOUNT_rail')
    emitter = attachment_source.named(laser, 'SOCKET_laser')
    mounted = {'laser': laser, **{id: mount(id, 'MOUNT_optic') for id in attachment_source.OPTICS},
               **{id: mount(id, 'MOUNT_muzzle') for id in muzzle_props}}
    attachments = {id: [o for o in objects if o.type == 'MESH'] for id, objects in mounted.items()}
    if datum:
        rail_frame = datum.matrix_world.copy()
    else:
        groove, bottom = origin or (rig_inverse @ bpy.data.objects['MOUNT_rail'].matrix_world.translation).yz
        rail_frame = rig.matrix_world @ Matrix.Translation((0, groove, bottom))
    rail_inverse = rail_frame.inverted()
    rail_in_carrier = inner @ rail_frame
    other_guard = None
    if tooth_prefix:
        rail_meshes = [o for o in meshes if o.name.startswith(tooth_prefix)]
        seats = surface(rail_meshes, rig_inverse)
    else:
        rail_meshes = [bpy.data.objects['handguard_mesh']]
        seats, other_guard, span = joined_rail(rail_meshes[0], rig_inverse, rail_inverse @ rig.matrix_world)
    moving = [o for o in meshes if any(parent.name in MOVING for parent in parents(o))]
    fixed = [o for o in meshes if o not in moving and o not in rail_meshes]
    pump_shell = None
    if moving_carrier:
        pump_shell = surface([o for o in fixed if o.parent == carrier], rig_inverse)
        fixed = [o for o in fixed if o.parent != carrier]
    accessory_trees = {id: surface(objects, rig_inverse) for id, objects in attachments.items()}
    nonseating = {'weapon': surface(fixed, rig_inverse), **accessory_trees}
    if other_guard is not None:
        nonseating['guard shell'] = other_guard
    # Laser is receiver-fixed on the pump weapon, so recheck from rig space.
    emitter_frame = rig_inverse @ emitter.matrix_world
    emission = emitter_frame.translation
    forward = (emitter_frame.to_3x3() @ Vector((0, 1, 0))).normalized()

    def rigid_conflicts(target):
        return [name for name, geometry in nonseating.items() if target.overlap(geometry)] + (
            ['TOR Mini beam'] if target.ray_cast(emission, forward, 1)[0] is not None else [])

    if other_guard is not None:
        # Report all whole grooves with the AFG-2 envelope inside the rail, not
        # just the nominated slot. This report never auto-enables a new pair.
        inset = .00015
        holder, trial = place('afg2', carrier, rail_frame @ Matrix.Translation((0, 0, inset)))
        for slot in range(math.floor(span[0] / picatinny.PITCH), math.ceil(span[1] / picatinny.PITCH) + 1):
            holder.matrix_basis = rail_in_carrier @ Matrix.Translation((0, slot * picatinny.PITCH, inset))
            bpy.context.view_layer.update()
            bound = bounds(trial, rail_inverse)
            if min(p.y for p in bound) >= span[0] - .0001 and max(p.y for p in bound) <= span[1] + .0001:
                probe = surface(trial, rig_inverse)
                print(f'EVOLYS AFG-2 slot {slot}: {rigid_conflicts(probe) or "clear rigid candidate (not pose-verified)"}')
        holder.hide_render = True
        for o in trial:
            o.hide_render = True

    targets, grips, views = {}, {}, {}
    if datum:
        adapter_bounds = bounds(rail_meshes, rail_inverse)
        span = min(p.y for p in adapter_bounds), max(p.y for p in adapter_bounds)
    for id, candidate in candidates.items():
        offset = candidate['slot'] * picatinny.PITCH
        _, grip = place(id, carrier, rail_frame @ Matrix.Translation((0, offset, candidate['inset'])))
        grip_bounds = bounds(grip, rail_inverse)
        assert max(p.z for p in grip_bounds) < picatinny.SLOT_DEPTH, (id, 'crown reaches the groove bed')
        if datum:
            assert all(span[0] <= p.y <= span[1] for p in grip_bounds), (id, 'grip overhangs the adapter')
        target = surface(grip, rig_inverse)
        assert target.overlap(seats), (id, 'floating above the bottom rail')
        assert not (conflicts := rigid_conflicts(target)), (id, 'intersects', conflicts)
        assert not pump_shell or not target.overlap(pump_shell), (id, 'intersects slide outside the tooth faces')
        targets[id], grips[id] = surface(grip, inner), grip
        views[id] = rail_in_carrier @ Matrix.Translation((0, offset, -.045))
        print(f'{weapon} / {id}: bottom-tooth contact, clear of non-seating surfaces and mounted accessories', flush=True)

    checked_strokes = {round(carrier_rest.y, 6)}
    for name, clip in clips.items():
        select_clip(parts, review, clips, name)
        clashes = dict.fromkeys(targets, 0)
        samples = 0
        for frame in frames(scene, clip):
            seek(scene, frame)
            samples += 1
            inverse = carrier.matrix_world.inverted()
            posed_skin = surface(skin, inverse)
            mechanism = surface([o for o in moving if shown(o)], inverse)
            for id, target in targets.items():
                assert not target.overlap(mechanism), (id, name, frame, 'intersects moving weapon')
                clashes[id] += bool(target.overlap(posed_skin))
            if moving_carrier:
                posed_rig_inverse = rig.matrix_world.inverted()
                stroke = round((posed_rig_inverse @ carrier.matrix_world).translation.y, 6)
                if stroke not in checked_strokes:
                    checked_strokes.add(stroke)
                    # The slide's own geometry was already checked in Idle.
                    for id, objects in grips.items():
                        target = surface(objects, posed_rig_inverse)
                        assert not (conflicts := rigid_conflicts(target)), (id, name, frame, conflicts)
        for id, count in clashes.items():
            print(f'{weapon} / {id} / {name}: stock skin intersects at {count}/{samples} samples', flush=True)

    controls = {'wrist': bpy.data.objects['hand_L'], **{
        obj.name[2:]: obj for obj in parts if obj.name.startswith(('L_finger_', 'L_thumb_'))
    }}
    if output:
        output.mkdir(parents=True, exist_ok=True)
        color_skin(skin)
        for studio in bpy.data.collections:
            if studio.name.startswith('STUDIO'):
                studio.hide_render = True
        for obj in meshes:
            obj.color = (.26, .21, .15, 1) if obj.parent == carrier else (.09, .10, .11, 1)
        for id, objects in {**attachments, **grips}.items():
            for obj in objects:
                obj.hide_render = id != 'laser'
                obj.color = (.045, .05, .055, 1)
    # Stationary carriers keep their fixed meshes (including rails) and
    # accessory mounts in the same carrier-space frames throughout held clips.
    select_clip(parts, review, clips, 'Idle')
    draft_dynamic = meshes if moving_carrier else moving
    draft_fixed = None
    draft_accessories = accessory_trees
    if not moving_carrier:
        draft_fixed = surface([o for o in meshes if o not in moving and not o.hide_render and shown(o)], inner)
        draft_accessories = {id: surface(objects, inner) for id, objects in attachments.items()}
    for id, candidate in candidates.items():
        objects = grips[id]
        select_clip(parts, review, clips, 'Idle')
        if output:
            for obj in skin:
                obj.hide_render = False
            capture(output, f'{id}-none', carrier.matrix_world @ views[id])
            for obj in objects:
                obj.hide_render = False
            capture(output, f'{id}-stock-hand', carrier.matrix_world @ views[id])
            for obj in skin:
                obj.hide_render = obj.name.startswith(f'{label}_left_')
        check_firing_hand = candidate.get('firingHand', False)
        for name in candidate['clips']:
            if name not in clips:
                continue
            clip = clips[name]
            select_clip(parts, review, clips, name)
            draft = draft_skin(id, candidate, controls, rig, basis, name, clip, carrier, carrier_rest)
            posed = [obj for obj in draft if obj.type == 'MESH']
            glove = next(obj for obj in posed if 'Charcoal_woven_glove' in obj.name)
            patches = patch_indices(glove)
            target = targets[id]
            max_gap = 0
            for frame in frames(scene, clip):
                seek(scene, frame)
                inverse = carrier.matrix_world.inverted()
                skin_tree = surface(posed, inverse)
                visible = [o for o in draft_dynamic if not o.hide_render and shown(o)]
                if draft_fixed is not None:
                    assert not draft_fixed.overlap(skin_tree), (id, name, frame, 'draft skin intersects fixed weapon')
                assert not visible or not surface(visible, inverse).overlap(skin_tree), (id, name, frame, 'draft skin intersects weapon')
                assert not target.overlap(skin_tree), (id, name, frame, 'draft skin intersects foregrip')
                if check_firing_hand:
                    firing_hand = surface(right_skin, inverse)
                    assert not target.overlap(firing_hand), (id, name, frame, 'firing hand intersects foregrip')
                    assert not skin_tree.overlap(firing_hand), (id, name, frame, 'support arm intersects firing arm')
                # Only the pump separates the foregrip and accessory frames during a clip.
                accessory_skin = surface(posed, rig.matrix_world.inverted()) if moving_carrier else skin_tree
                for accessory, accessory_tree in draft_accessories.items():
                    assert not accessory_tree.overlap(accessory_skin), (id, name, frame, 'draft skin intersects', accessory)
                max_gap = max(max_gap, patch_gap(glove, patches, inverse, target))
            assert max_gap < .003, (id, name, 'draft palm or pad is off the grip', max_gap)
            print(f'{weapon} / {id}: draft {name} skin clears weapon and attachments; palm/pad gap ≤ {max_gap*1000:.2f} mm', flush=True)
            if output and name in CAPTURE_CLIPS:
                color_skin(posed)
                if name != 'Idle':
                    seek(scene, .32 * clip['duration'] * scene.render.fps)
                capture(output, f'{id}-draft-{name.lower()}', carrier.matrix_world @ views[id])
            draft_collection = glove.users_collection[0]
            for obj in draft:
                bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.collections.remove(draft_collection)
        for obj in objects:
            obj.hide_render = True


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('weapon', choices=WEAPONS)
    parser.add_argument('--renders', type=Path, help='Optional matched Blender captures.')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    main(args.weapon, args.renders.resolve() if args.renders else None)
