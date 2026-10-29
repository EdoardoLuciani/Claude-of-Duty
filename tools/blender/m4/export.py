"""Native export followed by read-only counts and semantic validation."""
import json
import struct
import bpy
from m4.finishes import consolidate_finishes

def active(o):
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o

def export_asset(output, asset, parents, separate, clips):
    OUT=output
    consolidate_finishes(asset, output)
    # These three seats are rigid in every clip. Join their runtime geometry by
    # finish, not by authoring assembly; retain the named seats as empty helpers.
    # The editable blend was saved before this runtime-only preparation.
    body=bpy.data.objects['receiver']
    for name in ('handguard','stock'):
        for obj in list(bpy.data.objects[name].children):
            if obj.type!='MESH' or obj in separate:continue
            world=obj.matrix_world.copy()
            obj.parent=body;obj.matrix_world=world
    for parent in parents:
        objects=[o for o in asset.objects if o.type=='MESH' and o.parent==parent and o not in separate]
        if not objects:continue
        active(objects[0])
        for o in objects:o.select_set(True)
        bpy.ops.object.join();bpy.context.object.name=parent.name+'_mesh'
    # Actions read the baked curves directly. Keep rest seats invertible while
    # gathering static children; hidden-parent scale must not bake into them.
    bpy.ops.object.select_all(action='DESELECT')
    for o in asset.objects:o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUT/'m4a1-block-ii.glb'), export_format='GLB',
        use_selection=True, export_animations=True,
        export_animation_mode='ACTIONS', export_merge_animation='NLA_TRACK',
        export_frame_range=False, export_force_sampling=False,
        export_optimize_animation_keep_anim_object=True,
        export_sampling_interpolation_fallback='LINEAR', export_extras=True,
        export_yup=True, export_cameras=False, export_lights=False,
    )
    path=output/'m4a1-block-ii.glb'
    raw=path.read_bytes();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length])
    # Count both magazines/cartridge instances even when glTF deduplicates buffers.
    primitives=[p for node in doc['nodes'] if 'mesh' in node for p in doc['meshes'][node['mesh']]['primitives']]
    stats={'triangles':sum(doc['accessors'][p['indices']]['count']//3 for p in primitives),'primitives':len(primitives),'materials':len(doc['materials']),'meshes':len(doc['meshes']),'bytes':path.stat().st_size,'images':len(doc['images'])}
    assert stats['triangles']<=91000 and stats['primitives']<=19 and stats['materials']==4 and stats['bytes']<=9800000 and stats['images']==6,stats
    assert {animation['name'] for animation in doc['animations']} == set(clips)
    for animation in doc['animations']:
        duration=clips[animation['name']]['duration']
        for sampler in animation['samplers']:
            accessor=doc['accessors'][sampler['input']]
            assert abs(accessor['max'][0]-duration)<1e-7, (animation['name'], accessor['max'])
        for channel in animation['channels']:
            expected='STEP' if channel['target']['path']=='scale' else 'LINEAR'
            assert animation['samplers'][channel['sampler']]['interpolation']==expected
    return stats
