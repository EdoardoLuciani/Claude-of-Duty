"""Frozen source review cameras and lighting; never exported."""
import bpy
from mathutils import Matrix, Vector

def build_studio(quick, SIGHT_Y):
    scene=bpy.context.scene
    studio=bpy.data.collections.new('STUDIO | excluded from export');scene.collection.children.link(studio)
    C=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
    def xyz(v):return C@Vector(v)
    # DCC review setup is excluded from shipped GLB.
    scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=24 if quick else 64;scene.eevee.use_raytracing=False
    scene.world.use_nodes=True;bg=scene.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=(.18,.21,.26,1);bg.inputs[1].default_value=.4
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=-2.1
    scene.render.resolution_x=1920;scene.render.resolution_y=1080;scene.render.resolution_percentage=65 if quick else 100
    scene.render.image_settings.file_format='PNG'
    def aim(o,target):o.rotation_euler=(xyz(target)-o.location).to_track_quat('-Z','Y').to_euler()
    def camera(name,loc,target,scale):
        d=bpy.data.cameras.new(name);o=bpy.data.objects.new('CAM_'+name,d);studio.objects.link(o);o.location=xyz(loc);d.type='ORTHO';d.ortho_scale=scale;aim(o,target);return o
    cameras={n:camera(n,l,t,s) for n,l,t,s in [('hero',(-1.3,.55,-.75),(0,.030,-.10),1.0),('left',(-1.7,.06,-.10),(0,.025,-.10),.93),('right',(1.7,.06,-.10),(0,.025,-.10),.93),('top',(0,1.7,-.10),(0,0,-.10),.93),('receiver',(-.6,.26,.04),(0,.027,-.032),.34),('irons',(.005,.145,.30),(0,SIGHT_Y,-.08),.13)]}
    for name,loc,power,size,color in [('Key',(-.40,.65,-.10),85,.65,(.82,.89,1)),('Rim',(.34,.40,-.12),100,.8,(1,.78,.54)),('Fill',(-.65,.02,.30),30,.8,(.61,.74,1))]:
        d=bpy.data.lights.new(name,'AREA');d.energy=power;d.size=size;d.color=color;o=bpy.data.objects.new(name,d);studio.objects.link(o);o.location=xyz(loc);aim(o,(0,.02,-.10))
    scene.camera=cameras['hero']
    return cameras
