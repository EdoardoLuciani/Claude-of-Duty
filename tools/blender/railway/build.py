"""Original photo-referenced C-MORE Railway RW game art; not mechanical CAD.

Native Blender coordinates: X right, Y forward, Z up. Art dimensions in mm.
"""
import argparse
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from exps3.build import active, box, cylinder, finish, material, mesh, prism, text
import picatinny

AXIS = 34
WINDOW = 14.5
OUT = Path(__file__).resolve().parents[3]/'.cache/blender/attachments/c-more-railway'


def empty(name, parent=None, pos=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = Vector(pos) * .001
    return obj


def subtract(obj, tool):
    active(obj)
    cut = obj.modifiers.new('Machined relief', 'BOOLEAN')
    cut.object = tool
    bpy.ops.object.modifier_apply(modifier=cut.name)
    bpy.data.objects.remove(tool, do_unlink=True)


def fastener(name, center, radius, depth, metal, mask, root, axis='X', side=1):
    head = cylinder(name, center, radius, depth, metal,root,axis=axis,sides=32,bevel=.12)
    bit = Vector(center)
    bit[0 if axis == 'X' else 2] += side*depth*.45
    subtract(head, cylinder('Hex socket tool', bit, radius*.46, depth*.65, mask,root,
                           axis=axis,sides=6,bevel=0))
    return head


def grain_map(finishes):
    """Original seeded normal grain, shared between the cast and machined finishes."""
    side = 128
    noise = np.random.default_rng(334).normal(0,.021,(side,side))
    rgba = np.ones((side,side,4),dtype=np.float32)
    rgba[:,:,0] = .5+noise-np.roll(noise,1,axis=1)
    rgba[:,:,1] = .5+noise-np.roll(noise,1,axis=0)
    image = bpy.data.images.new('Railway molded finish normal',side,side,alpha=False)
    image.colorspace_settings.name = 'Non-Color'
    image.pixels.foreach_set(rgba.ravel())
    image.pack()
    for mat,strength in finishes:
        nodes,links = mat.node_tree.nodes,mat.node_tree.links
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = image
        normal = nodes.new('ShaderNodeNormalMap')
        normal.inputs['Strength'].default_value = strength
        links.new(tex.outputs['Color'],normal.inputs['Color'])
        links.new(normal.outputs['Normal'],nodes.get('Principled BSDF').inputs['Normal'])


def ring(root, mat):
    profile = [(43,15.3),(43.5,16.5),(44.3,17),(50.3,17),(51.3,16.4),
               (51.3,15.25),(49.9,WINDOW),(44.6,WINDOW)]
    n = 96
    vertices = []
    for j,(y,r) in enumerate(profile):
        for i in range(n):
            a = i*math.tau/n
            rise = math.sin(a)
            # The lower rear edge fans out into the RW's swept pedestal.
            sweep = 22*(max(0,.31-rise)/1.31)**1.8 if j in (0,1,2,7) else 0
            vertices.append((r*math.cos(a),y-sweep,AXIS+r*rise))
    faces = [(j*n+i,j*n+(i+1)%n,((j+1)%len(profile))*n+(i+1)%n,((j+1)%len(profile))*n+i)
             for j in range(len(profile)) for i in range(n)]
    finish(mesh('Thin round lens surround', vertices, faces, mat, root), width=0)


def build(root):
    body = material('02 | glass-filled black polymer', (.019,.020,.022), 0, .66)
    base = material('03 | low satin anodized saddle', (.018,.019,.022), .4, .45)
    steel = material('04 | dark hardware steel', (.047,.050,.052), .73, .46)
    inset = material('05 | control rubber and pocket shade', (.010,.011,.013), 0, .79)
    etch = material('06 | molded markings', (.012,.013,.014), 0, .68)
    diode = material('07 | red emitter inset', (.16,.012,.009), .1, .24)
    pane = material('10 | coated single pane', (.16,.079,.025), 0, .17)
    grain_map([(body,.41),(base,.25)])
    pane.use_backface_culling = False
    shader = pane.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Alpha'].default_value = .13
    shader.inputs['Specular IOR Level'].default_value = .23
    shader.inputs['Specular Tint'].default_value = (1,.66,.36,1)

    saddle = box('Low continuous rail saddle', (0,0,.5), (25.5,122,9), base,root,.88)
    picatinny.cut_channel([saddle], Matrix.Identity(4), -.064,.064)
    bar = box('Removable clamp side bar', (12.68,0,.55), (2.42,119,7.1), base,root,.86)
    for y in (-23,20):
        subtract(bar,box('Saddle oval relief tool',(14,y,.8),(2.5,33,2.9),base,root,1.15))
    for y in (-48,47):
        fastener('Rounded cross screw', (14.0,y,.75), 3.72, 1.4, steel,inset,root)
        cylinder('Cross screw tail', (-12.83,y,.75), 1.6, .27, steel,root,sides=20)
    box('Centre recoil lug', (0,0,-.95), (18,4.0,1.9), steel,root,.1)

    # The RW has a continuous canoe-shaped body, with a squared aft battery
    # housing and the forward lens surround rising out of a tapered shoulder.
    box('Aft control housing', (0,-43,12.55), (26.8,31.1,15.4), body,root,1.36)
    box('Battery pocket step', (0,-19,10.5), (25.4,20.5,11.4), body,root,.88)
    box('Raised battery lid with seam', (0,-19,17.25), (25.5,21.2,2.4), body,root,.73)
    box('Midbody bridge', (0,-.35,12.0), (27.5,15.2,14.3), body,root,1.0)
    box('Midbody cap', (0,-.8,19.45), (26.9,14.0,2.6), body,root,.77)
    nose = prism('Rounded forward lower arm', [(5.4,5),(5.4,16),(12,16.9),(45,16.9),
           (52,18.1),(57,16),(58.4,11),(56,5)], -13.6,13.6,body,root,bevel=1.32)
    for side in (-1,1):
        subtract(nose,box('Side teardrop relief tool',(side*13.6,48.9,10.2),
                          (1.5,9.0,3.6),body,root,1.4))
    foot = prism('Raised swept pedestal foot', [(10,12),(10,16.4),(22,17.4),(31,19.9),(42,20),
                 (51,19.1),(55,16),(56,10)], -12.4,12.4,body,root,bevel=.96)
    subtract(foot,cylinder('Machined reflector pocket',(0,35.8,19.7),4.38,3.9,body,root,axis='Z',sides=48,bevel=.22))
    cylinder('Matte reflector pocket floor',(0,35.8,17.65),3.76,.32,inset,root,axis='Z',sides=40)
    fastener('Pedestal adjustment recess',(0,20.8,17.0),2.53,.64,steel,inset,root,axis='Z')
    ring(root,body)
    eye = cylinder('Molded forward eyelet', (0,55.0,14.45), 6.6, 5.45, body,root,axis='Y',sides=48,bevel=.60)
    subtract(eye,cylinder('Eyelet opening', (0,55.9,14.55), 3.2, 9.3, body,root,axis='Y',sides=40,bevel=0))
    # One pane, no tube or second rim, exported with the shared thin-glass convention.
    n = 96
    points = [(0,46.75,AXIS)]
    points += [((WINDOW+.08)*r*math.cos(a),46+.75*(1-r*r),AXIS+(WINDOW+.08)*r*math.sin(a))
               for r in (.3,.6,1) for a in (i*math.tau/n for i in range(n))]
    faces = [(0,1+i,1+(i+1)%n) for i in range(n)]
    faces += [(1+j*n+i,1+(j+1)*n+i,1+(j+1)*n+(i+1)%n,1+j*n+(i+1)%n)
              for j in range(2) for i in range(n)]
    finish(mesh('Single dished coated lens',points,faces,pane,root),width=0)

    cylinder('Dial collar',(0,-48,20.45),4.4,.9,body,root,axis='Z')
    cylinder('Brightness dial',(0,-48,23.3),3.05,6.25,inset,root,axis='Z',sides=48,bevel=.24)
    for i in range(16):
        a = i*math.tau/16
        cylinder('Dial grip flute',(3.02*math.cos(a),-48+3.02*math.sin(a),23.3),.31,5.25,
                 inset,root,axis='Z',sides=10,bevel=.08)
    emitter = prism('Low emitter block', [(-39.5,19),(-39.5,23.6),(-37.4,25.7),
                    (-33.4,25.7),(-30.5,23),(-30.5,18)], -5.8,5.8,body,root,bevel=.85)
    subtract(emitter,cylinder('Emitter cup tool',(0,-30.4,23.2),2.4,3.2,inset,root,axis='Y',bevel=0))
    cylinder('Recessed emitter glass',(0,-31.8,23.2),1.32,.28,diode,root,axis='Y',sides=24)
    for x in (-8.35,8.35):
        for y,z in [(-49,20.3),(-18.8,18.55),(-1.0,21.0)]:
            fastener('Recessed top fastener',(x,y,z),1.62,.62,steel,inset,root,axis='Z')
    for side in (-1,1):
        for y,r in [(18,1.15),(25,1.28),(33.8,2.83),(39.9,2.19)]:
            fastener('Side adjustment hardware',(side*13.6,y,10.6),r,.76,steel,inset,root,side=side)
        text('Molded C-MORE wordmark','C-MORE',(side*13.43,-43,13),4.35,etch,root,
             side='right' if side == 1 else 'left')
    for i in range(7):
        a = math.radians(20+42*i)
        mark = box('Molded dial index',(5.7*math.cos(a),-48+5.7*math.sin(a),20.28),
                   (.85,.26,.08),etch,root,0)
        mark.rotation_euler.z = a


def render(output):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = 700
    scene.render.film_transparent = True
    target = Vector((0,0,.021))
    for name,pos,energy in [('Key',(-.15,.16,.22),2),('Fill',(.14,-.12,.14),1.65),('Rim',(.09,.15,.08),1.6)]:
        light = bpy.data.lights.new(name,'AREA')
        light.energy,light.shape,light.size = energy,'DISK',.14
        obj = bpy.data.objects.new(name,light)
        scene.collection.objects.link(obj)
        obj.location = pos
        obj.rotation_euler = (target-obj.location).to_track_quat('-Z','Y').to_euler()
    camera = bpy.data.cameras.new('Review')
    camera.type,camera.ortho_scale,camera.clip_start = 'ORTHO',.143,.001
    scene.camera = bpy.data.objects.new('Review',camera)
    scene.collection.objects.link(scene.camera)
    for label,d in [('left',(-1,0,.03)),('right',(1,0,.03)),('rear',(0,-1,.03)),
                    ('front',(0,1,.03)),('top',(0,.035,1)),('bottom',(0,.035,-1)),
                    ('front-quarter',(.90,.54,.29)),('rear-quarter',(.65,-.85,.50))]:
        scene.camera.location = target+Vector(d).normalized()*.35
        scene.camera.rotation_euler = (target-scene.camera.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath = str(output/(label+'.png'))
        bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    args = argparse.ArgumentParser()
    args.add_argument('--output',type=Path,default=OUT)
    args.add_argument('--render',action='store_true')
    options = args.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    options.output.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    root = empty('ATTACHMENT_RAILWAY')
    build(root)
    empty('MOUNT_base',root)
    empty('SOCKET_sight',root,(0,46,AXIS))
    bpy.ops.wm.save_as_mainfile(filepath=str(options.output/'railway.blend'))
    bpy.ops.object.select_all(action='DESELECT')
    pieces = [o for o in root.children if o.type == 'MESH']
    for obj in pieces:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.join()
    joined = pieces[0]
    joined.name = 'railway_mesh'
    triangles = joined.modifiers.new('Runtime triangle tangents','TRIANGULATE')
    triangles.keep_custom_normals = True
    bpy.ops.object.modifier_apply(modifier=triangles.name)
    bpy.ops.export_scene.gltf(filepath=str(options.output/'railway.glb'),export_format='GLB',
                              export_animations=False,export_yup=True,export_tangents=True)
    if options.render:
        render(options.output)
