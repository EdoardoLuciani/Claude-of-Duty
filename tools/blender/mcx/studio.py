"""Optional fixed review cameras/lights. Never selected for GLB export."""
import bpy
from mathutils import Vector

def build_studio(quick=False):
    scene = bpy.context.scene
    studio = bpy.data.collections.new("STUDIO | not exported")
    scene.collection.children.link(studio)
    # Studio presentation. All lights/cameras/background excluded from the GLB.
    scene.render.engine='BLENDER_EEVEE'
    scene.eevee.taa_render_samples=48 if quick else 128
    scene.eevee.use_raytracing=False
    scene.world.color=(.18,.18,.18)
    world=scene.world;world.use_nodes=True
    world.node_tree.nodes.get('Background').inputs[0].default_value=(.16,.19,.24,1)
    world.node_tree.nodes.get('Background').inputs[1].default_value=.4
    scene.view_settings.view_transform='AgX'
    scene.view_settings.look='AgX - Medium High Contrast'
    scene.view_settings.exposure=-2.1
    scene.render.image_settings.file_format='PNG'
    scene.render.resolution_x=1920;scene.render.resolution_y=1080
    scene.render.resolution_percentage=65 if quick else 100


    def aim(obj,target):obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()


    def camera(name,loc,target,scale):
        data=bpy.data.cameras.new(name);obj=bpy.data.objects.new(name,data);studio.objects.link(obj)
        obj.location=loc;aim(obj,target);data.type='ORTHO';data.ortho_scale=scale;data.lens=55
        return obj


    def area(name,loc,power,color,size,target,shape='DISK',size_y=None):
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=color;data.shape=shape;data.size=size
        if size_y is not None:data.size_y=size_y
        obj=bpy.data.objects.new(name,data);studio.objects.link(obj);obj.location=loc;aim(obj,target)


    hero=camera('CAM_hero',(.43,-1.3,.57),(.005,0,-.045),1.10)
    side_cam=camera('CAM_right_profile',(0,-1.7,.13),(.005,0,-.055),1.04)
    left_cam=camera('CAM_left_profile',(-.14,1.7,.30),(.005,0,-.055),1.07)
    detail_cam=camera('CAM_receiver_detail',(-.21,-.75,.30),(-.025,0,-.010),.47)
    first_cam=camera('CAM_first_person',(-.72,-.17,.22),(.14,0,.03),.55)
    area('Key | broad softbox',(.1,-.45,.8),85,(.82,.89,1),.65,(0,0,0),'RECTANGLE',.32)
    area('Rim | warm strip',(.12,.34,.40),100,(1,.78,.54),.8,(0,0,0),'RECTANGLE',.12)
    area('Fill | long side strip',(-.30,-.65,.02),30,(.61,.74,1),.8,(0,0,-.05),'RECTANGLE',.18)
    area('Muzzle edge',(.65,.02,.15),22,(1,.92,.82),.25,(.26,0,0))
    # Ground provides contact shadow without hiding silhouette; weapon floats for turntable review.
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0,0,-.295))
    back=bpy.context.object
    back.name='Studio floor'
    back.dimensions=(200,200,.025)
    for collection in list(back.users_collection):
        collection.objects.unlink(back)
    studio.objects.link(back)
    mat=bpy.data.materials.new('Studio charcoal');mat.diffuse_color=(.018,.023,.031,1);mat.use_nodes=True
    mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.018,.023,.031,1)
    mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.82
    back.data.materials.append(mat)
    scene.camera=hero

    return [("hero", hero), ("right-profile", side_cam), ("left-profile", left_cam),
            ("receiver-detail", detail_cam), ("first-person", first_cam)]
