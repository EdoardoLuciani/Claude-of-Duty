"""Select and validate the native MCX wrist/finger and shared review-skin actions."""
import json
import math

import bpy

from mcx.animations import select_clip

LABEL = 'MCX | authored hands (shared appearance)'


def review_tracks():
    return [
        {'name':name,'times':[min(i/120,clip['duration']) for i in range(math.ceil(clip['duration']*120)+1)]}
        for name,clip in json.loads(bpy.context.scene['clips']).items()
    ]


def select_review_clip(name):
    select_clip(None,json.loads(bpy.context.scene['clips']),name)


def check_review_hands():
    collection = bpy.data.collections[LABEL]
    arms = [obj for obj in collection.objects if obj.type=='ARMATURE']
    skins = [obj for obj in collection.objects if obj.type=='MESH']
    assert len(arms)==2 and len(skins)==10, 'both shared review arms are required'
    clips = set(json.loads(bpy.context.scene['clips']))
    controls = [bpy.data.objects['hand_'+side] for side in ('L','R')]
    for prefix in ('L','R'):
        controls += [bpy.data.objects[f'{prefix}_finger_{i}_{joint}'] for i in range(4) for joint in ('root','0','1','2')]
        controls += [bpy.data.objects[prefix+'_'+joint] for joint in ('thumb_base','thumb_0','thumb_1')]
    for obj in controls+arms:
        assert {track.name for track in obj.animation_data.nla_tracks}==clips, ('missing native hand clip',obj.name)
    asset = bpy.data.collections['MCX VIRTUS | authored components']
    assert all(obj.name not in asset.objects for obj in collection.objects), 'review skins entered weapon export'
    # A STEP-hidden old magazine must not collapse the following wrist to its
    # origin. Sample across its hide key, before the separate magazine handoff.
    for name in ('Reload_Tactical','Reload_Empty'):
        select_review_clip(name)
        previous = None
        for frame in (62,62.5,63,63.5):
            bpy.context.scene.frame_set(math.floor(frame),subframe=frame%1)
            position = bpy.data.objects['hand_L'].matrix_world.translation
            if previous is not None:
                assert (position-previous).length < .02, (name,'hidden magazine collapses wrist',frame)
            previous = position.copy()
    select_review_clip('Idle')
    print('MCX_AUTHORED_HANDS_OK:',len(controls),'native wrist/finger controls;',len(clips),'clips; shared review skins excluded from weapon export')
