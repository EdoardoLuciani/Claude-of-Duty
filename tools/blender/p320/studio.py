"""Fixed P320 source-review lighting and cameras; excluded from runtime export."""
import bpy
from mathutils import Vector

def build_studio(studio, hands, quick=False):
    scene = bpy.context.scene
    # Studio and inspection cameras. Photography comes from the actual saved asset.
    scene.render.engine='BLENDER_EEVEE'
    scene.eevee.taa_render_samples=24 if quick else 96
    scene.eevee.use_raytracing=False
    scene.world.use_nodes=True
    bg=scene.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=(.20,.23,.28,1);bg.inputs[1].default_value=.35
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
    scene.view_settings.exposure=-1.6
    scene.render.resolution_x=1920;scene.render.resolution_y=1440
    scene.render.resolution_percentage=60 if quick else 100
    scene.render.image_settings.file_format='PNG'
    def aim(o,target):o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
    def camera(name,loc,target,scale):
        d=bpy.data.cameras.new(name);o=bpy.data.objects.new(name,d);studio.objects.link(o);o.location=loc
        d.type='ORTHO';d.ortho_scale=scale;aim(o,target);return o
    cameras={
    'hero':camera('CAM_hero',(-.36,.36,.20),(0,.030,-.009),.255),
    'left-profile':camera('CAM_left_profile',(-.6,.035,-.012),(0,.035,-.012),.235),
    'right-profile':camera('CAM_right_profile',(.6,.035,-.012),(0,.035,-.012),.235),
    'rear-detail':camera('CAM_rear_detail',(-.13,-.30,.12),(0,-.018,.014),.18),
    'first-person':camera('CAM_first_person',(.035,-.42,.12),(0,.04,.008),.35),
    }
    for name,loc,power,size,color in [('Key',(-.20,.10,.40),14,.34,(.89,.94,1)),('Rim',(.23,.08,.18),20,.28,(1,.85,.65)),('Fill',(-.15,-.30,.03),4,.25,(.72,.83,1))]:
        d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color
        o=bpy.data.objects.new(name,d);studio.objects.link(o);o.location=loc;aim(o,(0,.02,0))
    scene.camera=cameras['hero']
    # Weapon-only cameras keep the reusable hand skins hidden; review enables them.
    for o in hands:
        if o.type=='MESH':o.hide_render=True
    return cameras
