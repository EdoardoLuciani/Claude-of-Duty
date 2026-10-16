"""MCX's single normal export path; source is saved before in-memory mesh conversion."""
import json
import math
import struct

import bpy


def export_mcx(asset, parts, rest, out):
    OUT = out

    def active(obj):
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj

    # Export copy in-memory: apply bevels, UV unwrap, merge static geometry by
    # animation parent. Source .blend remains editable, with named components.
    for obj in parts:
        for track in obj.animation_data.nla_tracks: track.mute=track.name!='Idle'
    bpy.context.scene.frame_set(0)
    # Hidden animated parts must have invertible transforms while joining meshes.
    for obj in parts:
        for track in obj.animation_data.nla_tracks: track.mute=True
        obj.location, obj.rotation_euler, obj.scale = rest[obj.name]
    bpy.context.view_layer.update()
    for obj in list(asset.objects):
        if obj.type not in {'MESH','FONT'}:continue
        active(obj)
        bpy.ops.object.convert(target='MESH')
        # Smart unwrap keeps every bevel/boolean face textured in Blender and glTF.
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.006)
        bpy.ops.object.mode_set(mode='OBJECT')
    # Consolidate draw calls without destroying articulated pivots or named sockets.
    for parent in [bpy.data.objects['receiver'], *parts[1:]]:
        meshes=[o for o in asset.objects if o.type=='MESH' and o.parent==parent]
        if not meshes:continue
        active(meshes[0])
        for obj in meshes:obj.select_set(True)
        bpy.ops.object.join();bpy.context.object.name=parent.name+'_mesh'
    # Enable all tracks for the NLA exporter; it isolates tracks by matching names.
    for obj in parts:
        for track in obj.animation_data.nla_tracks:track.mute=False
    bpy.ops.object.select_all(action='DESELECT')
    for obj in asset.objects:obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/'mcx-virtus.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_optimize_animation_keep_anim_object=True,export_sampling_interpolation_fallback='LINEAR',export_extras=True,export_yup=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
    # Blender's forced NLA sampler labels changing scale channels LINEAR even
    # when their source keys are CONSTANT. Preserve stepped visibility explicitly
    # so fractional playback times never shrink both seated magazines together.
    glb_path = OUT / 'mcx-virtus.glb'
    glb = glb_path.read_bytes()
    json_length = struct.unpack_from('<I', glb, 12)[0]
    document = json.loads(glb[20:20+json_length])
    for animation in document['animations']:
        for channel in animation['channels']:
            if channel['target']['path'] == 'scale':
                animation['samplers'][channel['sampler']]['interpolation'] = 'STEP'
    encoded = json.dumps(document, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    binary_chunk = glb[20+json_length:]
    glb_path.write_bytes(struct.pack('<4sII', b'glTF', 2, 20+len(encoded)+len(binary_chunk))
                         + struct.pack('<I4s', len(encoded), b'JSON') + encoded + binary_chunk)
