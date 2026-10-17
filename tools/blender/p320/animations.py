"""Select synchronized P320 weapon/hand preview clips without rebuilding them."""
import bpy

def select_clip(parts, hands, clips, name, frame=0):
    scene = bpy.context.scene
    for o in parts+hands:
        if not o.animation_data:continue
        o.animation_data.action=None
        for t in o.animation_data.nla_tracks:t.mute=t.name!=name
    scene.frame_start=0;scene.frame_end=clips[name]['frames'][1];scene.frame_set(frame)
