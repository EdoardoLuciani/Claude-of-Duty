"""Photo-based C-MORE Railway blockout, not a production asset or mechanical CAD.

Native Blender coordinates: X right, Y forward, Z up. Art dimensions in mm.
"""
import argparse
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from exps3.build import active, box, cylinder, finish, material, mesh, prism
import picatinny

AXIS = 34
WINDOW = 14.5


def empty(name, parent=None, pos=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = Vector(pos) * .001
    return obj


def subtract(obj, tool):
    active(obj)
    cut = obj.modifiers.new('Open lens window', 'BOOLEAN')
    cut.object = tool
    bpy.ops.object.modifier_apply(modifier=cut.name)
    bpy.data.objects.remove(tool, do_unlink=True)


def ring(root, mat):
    profile = [(43,15.3),(43.5,16.5),(44.3,17),(50.3,17),(51.3,16.4),
               (51.3,15.25),(49.9,WINDOW),(44.6,WINDOW)]
    n = 64
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
    body = material('02 | black polymer', (.029,.03,.033), 0, .64)
    base = material('03 | rail saddle', (.019,.020,.023), .35, .53)
    steel = material('04 | fasteners', (.055,.058,.061), .65, .49)
    inset = material('05 | recesses', (.006,.007,.008), 0, .77)
    pane = material('10 | warm coated pane', (.17,.085,.027), 0, .22)
    pane.use_backface_culling = False
    shader = pane.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Alpha'].default_value = .13
    shader.inputs['Specular IOR Level'].default_value = .18

    saddle = box('Low, long rail base', (0,0,.5), (25.5,122,9), base, root, .9)
    picatinny.cut_channel([saddle], Matrix.Identity(4), -.064, .064)
    box('Recessed side fastener bar', (13.05,0,.7), (2,117,6.5), base,root,.75)
    for y in (-47,47):
        cylinder('Rail clamp screw', (14.1,y,.8), 3.7, 1, steel, root, sides=28)
        cylinder('Rail screw socket', (14.65,y,.8), 1.65, .20, inset, root, sides=6, bevel=0)
    for y in (-21,20):
        box('Long saddle relief', (14.0,y,.8), (.25,26,2.2), inset, root, .35)

    # The RW has a continuous canoe-shaped body, with a squared aft battery
    # housing and the forward lens surround rising out of a tapered shoulder.
    prism('Polymer body and shallow front nose', [(-59,5),(-59,18),(-56,20),(-33,20),
          (-28,17),(-7,17),(-6,20),(8,20),(11,16),(46,16),(53,14),
          (57,10),(55,5)], -13.6,13.6,body,root,bevel=1.2)
    box('Battery cover', (0,-20,18), (25.2,18,3.2), body,root,.85)
    box('Center electronics bridge', (0,1,18), (27.5,14.5,5), body,root,.85)
    prism('Shallow tapered pedestal', [(11,12),(11,17),(23,18),(31,19.9),(42,20),
          (50,18.9),(53,15),(56,10)], -12.1,12.1,body,root,bevel=1.05)
    ring(root, body)
    nose = cylinder('Round forward body tab', (0,54,13), 5.6, 5, body,root,axis='Y',sides=32)
    subtract(nose, cylinder('Tab opening tool', (0,54,13), 2.4, 8, body,root,axis='Y',sides=32,bevel=0))
    # One pane, no tube or second rim, exported with the shared thin-glass convention.
    points = [(0,46.45,AXIS)]
    points += [((WINDOW+.08)*math.cos(i*math.tau/64),46,AXIS+(WINDOW+.08)*math.sin(i*math.tau/64))
               for i in range(64)]
    finish(mesh('Single coated lens', points, [(0,1+i,1+(i+1)%64) for i in range(64)], pane,root), width=0)
    cylinder('Aft brightness dial', (0,-48,22.5), 3.3, 7.6, inset, root,axis='Z',sides=24)
    prism('Low emitter block', [(-39,19),(-39,24),(-37,25.7),(-33,25.7),(-30,21),(-30,18)],
          -5.8,5.8,body,root,bevel=.55)
    for x in (-8.6,8.6):
        for y,z in [(-49,20),(-18,19.8),(0,20.7)]:
            cylinder('Top fastener', (x,y,z), 1.65, .36, steel,root,axis='Z',sides=20)
    for y,r in [(21,1.35),(29,1.3),(36,3.05),(42,2.1)]:
        cylinder('Side adjustment detail', (13.7,y,10), r, .45, steel,root,sides=24)
    box('Front side relief', (13.55,49.2,10.1), (.22,6.2,3.1), inset,root,.7)


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
    args.add_argument('--output',type=Path,default=Path('/tmp/railway-blockout'))
    args.add_argument('--render',action='store_true')
    options = args.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    options.output.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    root = empty('RAILWAY_BLOCKOUT')
    build(root)
    empty('MOUNT_base',root)
    empty('SOCKET_sight',root,(0,46,AXIS))
    bpy.ops.wm.save_as_mainfile(filepath=str(options.output/'railway.blend'))
    bpy.ops.export_scene.gltf(filepath=str(options.output/'railway.glb'),export_format='GLB',
                              export_animations=False,export_yup=True)
    if options.render:
        render(options.output)
