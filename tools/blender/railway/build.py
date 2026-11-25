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
from exps3.build import active, box, cylinder, finish, material, mesh, prism, rounded_rect, text
import picatinny

# Black polymer RW, C-MORE's spec table (not the taller Tactical variant).
LENGTH, WIDTH, HEIGHT = 121.9, 31.75, 58.41
GLASS_DIAMETER = 29
BASE_BOTTOM = -4
RIM_HEIGHT_R = 16.15
AXIS = BASE_BOTTOM + HEIGHT - RIM_HEIGHT_R
WINDOW = GLASS_DIAMETER/2
LENS_Y = 46.9
LENS_TILT = math.radians(7)
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


def section_body(name, sections, mat, root):
    """Molded part with a rounded section and individually tapered ends."""
    slices = [rounded_rect(w, hi-lo, r, center_z=(hi+lo)/2, steps=5)
              for _,w,lo,hi,r in sections]
    n = len(slices[0])
    points = [(x,s[0],z) for s,loop in zip(sections,slices) for x,z in loop]
    last = (len(slices)-1)*n
    faces = [tuple(range(n)), tuple(reversed(range(last,last+n)))]
    faces += [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)
              for j in range(len(slices)-1) for i in range(n)]
    return finish(mesh(name,points,faces,mat,root),width=0)


def side_slot(name, item, side, y, z, width, height, depth, mat, root):
    outline = [(y+a,z+b) for a,b in rounded_rect(width,height,min(height*.49,2),steps=8)]
    x = side*13.6
    lo,hi = sorted((x-side*depth,x+side*2))
    subtract(item,prism(name,outline,lo,hi,mat,root,bevel=0))


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
    # The hood is a thin rolled rim in front, not a tube. The exterior
    # sweeps into a broad foot; the inside follows it only below the pane.
    profile = [(42.0,.65,0,25),(42.85,.23,0,26),(44.0,0,0,26),
               (49.7,0,0,7),(51.25,.26,0,3),(51.85,.85,0,0),
               (51.85,0,1,0),(49.85,0,1,0),(44.35,0,1,20),(42.0,0,1,24)]
    n = 120
    vertices = []
    for y,bevel,inner,sweep in profile:
        for i in range(n):
            a = i*math.tau/n
            h = math.sin(a)
            blend = (max(0,.46-h)/1.46)**1.72
            x_r = WINDOW if inner else WIDTH/2-bevel
            z_r = WINDOW if inner else RIM_HEIGHT_R-bevel
            drop = 0 if inner else 2.2*blend
            z = z_r*h*(math.cos(LENS_TILT) if inner else 1)
            vertices.append((x_r*math.cos(a),y-sweep*blend+z_r*h*math.sin(LENS_TILT),AXIS+z-drop))
    faces = [(j*n+i,j*n+(i+1)%n,((j+1)%len(profile))*n+(i+1)%n,((j+1)%len(profile))*n+i)
             for j in range(len(profile)) for i in range(n)]
    finish(mesh('Thin round lens surround', vertices, faces, mat, root), width=0)


def build(root):
    body = material('02 | glass-filled black polymer', (.014,.0148,.0164), 0, .56)
    base = material('03 | low satin anodized saddle', (.012,.0135,.0165), .48, .43)
    steel = material('04 | dark hardware steel', (.065,.068,.071), .73, .40)
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

    heel = -LENGTH/2
    saddle = section_body('Continuous low saddle', [(heel,24.3,-3.6,4.3,.6),
           (heel+.64,25.6,BASE_BOTTOM,4.8,.85),(49.7,25.6,BASE_BOTTOM,4.8,.85),
           (53,25.4,-3.6,4.7,.75),(55.2,23.8,-2.8,4.15,.6)],base,root)
    picatinny.cut_channel([saddle], Matrix.Identity(4), -.064,.064)
    bar = section_body('Right clamp bar', [(heel+.85,1.65,-3.2,3.1,.48),
           (-58.5,2.4,-3.6,3.55,.63),(51.45,2.45,-3.6,3.55,.63),
           (53.7,1.66,-3.15,3.15,.52)],base,root)
    bar.location.x = .01265
    bpy.context.view_layer.update()
    for y,w in [(-29.3,35.5),(18.5,37.6)]:
        side_slot('Clamp rounded relief',bar,1,y,.36,w,2.55,2.4,base,root)
    for y in (-49.9,45.7):
        fastener('Rounded clamp screw', (14.15,y,.25), 3.53, 1.52, steel,inset,root)
        cylinder('Opposite screw tail', (-12.83,y,.25), 1.6, .27, steel,root,sides=20)
    box('Centre recoil lug', (0,0,-.95), (18,4.0,1.9), steel,root,.1)

    section_body('Molded aft chassis', [(-59.45,24.2,6.25,18.95,1.28),
           (-58.6,26.6,5.1,20.35,1.28),(-55.2,27.6,4.9,20.6,1.62),
           (-30,27.6,4.9,20.6,1.54),(-22,26.8,4.9,18.65,1.13),
           (-13,26.2,4.9,18.65,1.12)],body,root)
    section_body('Recessed diode access cover', [(-29.1,24.6,18.35,19.35,.35),
           (-27.7,25.7,18.3,20.0,.5),(-16.2,25.7,18.3,20.0,.45),(-14.1,23.6,18.3,19.45,.39)],body,root)
    # The battery cover wraps down the sides with a curved shoulder into the narrower aft shell.
    section_body('Wrapped battery cover', [(-18.8,24.4,5,18.75,1.04),(-16.3,25.2,4.9,19.0,1.25),
           (-12.5,28.9,4.9,21.5,1.36),(-9,29.1,4.9,21.9,1.25),(5,29.1,4.9,21.9,1.22),
           (6.25,28.3,5.0,21.3,.88)],body,root)
    nose = section_body('Lower polymer arm with rolled nose', [(6.36,27.1,5.1,16.5,.9),
            (13,27.3,4.98,17.35,1.15),(41,27.35,5,17.5,1.36),
            (50,28.4,5.3,18.3,1.48),(55.3,28.52,6.2,20.6,2.35),
            (58.7,24.3,8.3,20.2,2.9),(LENGTH/2,18.8,10.15,17.2,2.3)],body,root)
    for side in (-1,1):
        side_slot('Forward side capsule',nose,side,47.9,9.95,9.8,4.45,2.25,body,root)
        side_slot('Nose relief seam',nose,side,56.1,15.0,5.25,4.55,2.25,body,root)
    deck = section_body('Swept lens deck', [(8.4,23.6,14.5,18.65,.8),(11.2,24.3,14.5,19.4,.7),
           (20.5,23.8,14.5,19.0,1.32),(36.9,24.8,14.5,21.0,1.4),
           (50.6,26,14.5,24.55,2.4),(55.7,25.8,13.0,23.1,2.3)],body,root)
    subtract(deck,cylinder('Round lens-well recess',(0,35.8,20.0),4.68,4.9,body,root,axis='Z',sides=56,bevel=.18))
    cylinder('Dark lens-well floor',(0,35.8,17.59),4.51,.26,inset,root,axis='Z',sides=48)
    cylinder('Adjustment-seat bevel',(0,17.3,19.22),4.07,.47,inset,root,axis='Z',sides=48)
    fastener('Pedestal adjustment recess',(0,17.3,19.45),2.53,.76,steel,inset,root,axis='Z')
    ring(root,body)
    # Form the wide arched nose opening as a through pocket; keep the separate rolled edge.
    arch = [(x,z) for x,z in rounded_rect(15,7.85,3.04,center_z=14.55,steps=10)]
    outer = [(x,z) for x,z in rounded_rect(22.8,12.65,4.88,center_z=15.35,steps=10)]
    eye = prism('Webbed forward arch',outer,50.65,LENGTH/2,body,root,axis='Y',bevel=.82)
    subtract(nose,prism('Arm arch tool',arch,49.14,62,body,root,axis='Y',bevel=.25))
    subtract(eye,prism('Arch opening tool',arch,49.14,62,body,root,axis='Y',bevel=.25))
    # One pane, no tube or second rim, exported with the shared thin-glass convention.
    n = 96
    points = [(0,LENS_Y+.88,AXIS)]
    for r in (.3,.6,1):
        for i in range(n):
            a = i*math.tau/n
            z = WINDOW*r*math.sin(a)
            points.append((WINDOW*r*math.cos(a),LENS_Y+.88*(1-r*r)+z*math.sin(LENS_TILT),
                           AXIS+z*math.cos(LENS_TILT)))
    faces = [(0,1+i,1+(i+1)%n) for i in range(n)]
    faces += [(1+j*n+i,1+(j+1)*n+i,1+(j+1)*n+(i+1)%n,1+j*n+(i+1)%n)
              for j in range(2) for i in range(n)]
    finish(mesh('Single dished coated lens',points,faces,pane,root),width=0)

    cylinder('Dial collar',(0,-48,20.64),4.4,.74,body,root,axis='Z')
    cylinder('Brightness dial',(0,-48,23.3),3.05,6.25,inset,root,axis='Z',sides=48,bevel=.24)
    for i in range(16):
        a = i*math.tau/16
        cylinder('Dial grip flute',(3.02*math.cos(a),-48+3.02*math.sin(a),23.3),.31,5.25,
                 inset,root,axis='Z',sides=10,bevel=.08)
    emitter = prism('Low emitter block', [(-39.5,19),(-39.5,23.6),(-37.4,25.7),
                    (-33.4,25.7),(-30.5,23),(-30.5,18)], -5.8,5.8,body,root,bevel=.85)
    subtract(emitter,cylinder('Emitter cup tool',(0,-30.4,23.2),2.4,3.2,inset,root,axis='Y',bevel=0))
    cylinder('Recessed emitter glass',(0,-31.8,23.2),1.32,.28,diode,root,axis='Y',sides=24)
    for x in (-8.55,8.55):
        for y,z,r in [(-21.4,19.95,1.53),(-1.9,21.84,2.02)]:
            cylinder('Top countersink',(x,y,z),r+.52,.16,inset,root,axis='Z',sides=36)
            fastener('Top recessed fastener',(x,y,z+.08),r,.43,steel,inset,root,axis='Z')
    for y,r in [(17.6,1.16),(24.1,1.32),(31.2,2.84),(37.2,2.42)]:
        fastener('Right windage hardware',(13.64,y,10.45),r,.69,steel,inset,root)
    for y,r in [(22.5,1.0),(27.2,1.38),(35.4,2.06)]:
        fastener('Left guide hardware',(-13.62,y,10.5),r,.55,steel,inset,root,side=-1)
    for side in (-1,1):
        side_name = 'right' if side == 1 else 'left'
        text('Molded C-MORE wordmark','C-MORE',(side*13.82,-42.3,12.76),5.44,etch,root,side=side_name)
        text('Molded maker line','C-MORE SYSTEMS',(side*13.82,-42.3,9.92),1.40,etch,root,side=side_name)
    for i in range(7):
        a = math.radians(20+42*i)
        mark = box('Molded dial index',(5.7*math.cos(a),-48+5.7*math.sin(a),20.62),
                   (.85,.26,.08),etch,root,0)
        mark.rotation_euler.z = a


def check_dimensions(root):
    """Measure the evaluated art, before any studio setup or export batching."""
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    bounds = []
    lens = None
    for obj in root.children:
        if obj.type != 'MESH':
            continue
        evaluated = obj.evaluated_get(deps)
        data = evaluated.to_mesh()
        points = np.array([evaluated.matrix_world@v.co for v in data.vertices])*1000
        bounds.append(points)
        if obj.name == 'Single dished coated lens':
            lens = [np.ptp(points[:,0]),np.ptp(points[:,1]*math.sin(LENS_TILT)+points[:,2]*math.cos(LENS_TILT))]
        evaluated.to_mesh_clear()
    width,length,height = np.ptp(np.concatenate(bounds),axis=0)
    np.testing.assert_allclose([length,width,height],[LENGTH,WIDTH,HEIGHT],atol=.05,rtol=0)
    np.testing.assert_allclose(lens,[GLASS_DIAMETER]*2,atol=.025,rtol=0)
    print(f'RAILWAY_ENVELOPE_OK: {length:.2f} x {width:.2f} x {height:.2f} mm; lens {lens[0]:.2f} mm',flush=True)


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
    empty('SOCKET_sight',root,(0,LENS_Y,AXIS))
    check_dimensions(root)
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
