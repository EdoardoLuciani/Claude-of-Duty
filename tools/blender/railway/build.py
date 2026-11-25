"""Original photo-referenced C-MORE Railway RW game art; not mechanical CAD.

Native Blender coordinates: X right, Y forward, Z up. Art dimensions in mm.
"""
import argparse
import math
from pathlib import Path
import sys

import bmesh
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


def subtract(obj, tool, reuse=False):
    active(obj)
    cut = obj.modifiers.new('Machined relief', 'BOOLEAN')
    cut.object, cut.material_mode = tool, 'TRANSFER'
    bpy.ops.object.modifier_apply(modifier=cut.name)
    if not reuse:
        bpy.data.objects.remove(tool, do_unlink=True)


def pocket_edges(obj):
    # Keep the molded contours smooth, but break normals at the pocket shoulders.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for edge in bm.edges:
        if edge.is_manifold and edge.calc_face_angle(0) > math.radians(37):
            edge.smooth = False
    bm.to_mesh(obj.data)
    bm.free()


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


def side_slot(name, item, side, y, z, width, height, depth, mat, root, face=13.6):
    outline = [(y+a,z+b) for a,b in rounded_rect(width,height,min(height*.49,2),steps=8)]
    x = side*face
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
    # Keep the top thin. The lower outside shoulders sweep aft into the deck,
    # but the middle stays forward so it cannot bridge over the exposed well.
    profile = [(43.1,.67,0,20),(43.8,.22,0,21),(44.7,0,0,21),
               (49.7,0,0,7),(51.25,.26,0,3),(51.85,.85,0,0),
               (51.85,0,1,0),(49.85,0,1,0),(45.6,0,1,6),(43.1,0,1,12)]
    n = 120
    vertices = []
    for y,bevel,inner,sweep in profile:
        for i in range(n):
            a = i*math.tau/n
            h = math.sin(a)
            side = math.cos(a)
            blend = (max(0,.33-h)/1.33)**1.5
            # Leave a shallow land behind the circular well instead of two free tips.
            sweep_weight = .71 + .29*min(1,abs(side)*2.55)
            x_r = WINDOW if inner else WIDTH/2-bevel
            z_r = WINDOW if inner else RIM_HEIGHT_R-bevel
            drop = 0 if inner else 3.0*blend
            z = z_r*h*(math.cos(LENS_TILT) if inner else 1)
            vertices.append((x_r*side,y-sweep*blend*sweep_weight+z_r*h*math.sin(LENS_TILT),AXIS+z-drop))
    faces = [(j*n+i,j*n+(i+1)%n,((j+1)%len(profile))*n+(i+1)%n,((j+1)%len(profile))*n+i)
             for j in range(len(profile)) for i in range(n)]
    return finish(mesh('Thin round lens surround', vertices, faces, mat, root), width=0)


def build(root):
    body = material('02 | glass-filled black polymer', (.014,.0148,.0164), 0, .56)
    base = material('03 | matte anodized saddle', (.012,.013,.015), .36, .54)
    steel = material('04 | dark hardware steel', (.042,.045,.049), .66, .43)
    inset = material('05 | control rubber and pocket shade', (.006,.0068,.008), 0, .79)
    hardware_top = material('08 | blackened countersunk steel', (.022,.024,.027), .52, .52)
    saddle_recess = material('09 | dark saddle pockets', (.003,.0035,.0042), .68, .46)
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
    bar = section_body('Right clamp bar', [(heel+.85,1.84,-3.25,3.2,.35),
           (-58.5,2.3,-3.55,3.49,.37),(51.45,2.3,-3.55,3.49,.37),
           (53.7,1.78,-3.23,3.18,.34)],base,root)
    bar.location.x = .01245
    bpy.context.view_layer.update()
    for y,w in [(-27.8,30.8),(17.6,34.7)]:
        side_slot('Clamp rounded relief',bar,1,y,.28,w,2.88,1.02,saddle_recess,root)
    pocket_edges(bar)
    for y in (-49.9,45.7):
        fastener('Rounded clamp screw', (14.15,y,.25), 3.53, 1.52, steel,inset,root)
        cylinder('Opposite screw tail', (-12.83,y,.25), 1.6, .27, steel,root,sides=20)
    box('Centre recoil lug', (0,0,-.95), (18,4.0,1.9), steel,root,.1)

    section_body('Molded aft chassis', [(-59.45,24.2,6.25,18.95,1.28),
           (-58.6,26.6,5.1,20.35,1.28),(-55.2,27.6,4.9,20.6,1.62),
           (-34,27.6,4.9,20.6,1.54),(-31,27.3,4.9,20.15,1.27),
           (-29.86,26.95,4.9,18.83,1.18),(-13,26.2,4.9,18.6,1.12)],body,root)
    section_body('Dark access-cover gasket', [(-30.15,24.9,18.5,19.1,.18),
           (-15.97,24.9,18.5,19.1,.18)],inset,root)
    section_body('Recessed diode access cover', [(-29.75,24.55,18.93,19.54,.24),
           (-28.6,25.2,18.93,20.0,.43),(-17.15,25.2,18.93,20.0,.43),
           (-16.1,24.55,18.93,19.54,.24)],body,root)
    # The battery cover wraps down the sides with a curved shoulder into the narrower aft shell.
    section_body('Wrapped battery cover', [(-18.8,24.4,5,18.75,1.04),(-16.3,25.2,4.9,19.0,1.25),
           (-12.5,28.9,4.9,21.5,1.36),(-9,29.1,4.9,21.9,1.25),(5,29.1,4.9,21.9,1.22),
           (6.25,28.3,5.0,21.3,.88)],body,root)
    nose = section_body('One-piece lower arm and front web', [(6.36,27.1,5.1,16.5,.9),
            (13,27.3,4.98,17.35,1.15),(39,27.35,5,17.5,1.36),
            (46.3,28.0,5.15,18.1,1.45),(51.8,28.52,5.48,24.0,2.6),
            (55.4,27.8,6.32,23.8,3.55),(58.45,24.55,8.18,22.07,3.8),
            (60.03,20.7,9.5,20.7,3.04),(LENGTH/2,17.3,10.22,19.35,2.62)],body,root)
    for side in (-1,1):
        side_slot('Forward side capsule',nose,side,46.75,10.22,9.88,3.83,1.42,inset,root,14.16)
    # Square-bottomed arch: a parabolic roof cut into the same continuous nose.
    arch = [(-7.75,10.9),(7.75,10.9),(8.13,11.7)]
    arch += [(8.13*math.cos(i*math.pi/22),11.7+6.33*math.sin(i*math.pi/22)**.85) for i in range(1,22)]
    arch += [(-8.13,11.7)]
    subtract(nose,prism('Molded front arch relief',arch,48.05,63,inset,root,axis='Y',bevel=.29))
    pocket_edges(nose)

    deck = section_body('Open stepped lens deck', [(8.4,23.45,14.5,18.5,.79),(11.2,24.18,14.5,19.4,.68),
           (20.5,24.12,14.5,19.54,1.12),(35.9,24.8,14.5,20.9,1.28),
           (45.3,25.9,15.3,22.44,1.55),(51.08,24.1,18.45,23.42,1.9)],body,root)
    hood = ring(root,body)
    well = cylinder('Open round lens well',(0,34.65,20.8),5.16,10.7,inset,root,axis='Z',sides=64,bevel=.16)
    subtract(deck,well,reuse=True)
    subtract(hood,well)
    cylinder('Dark lens-well floor',(0,34.65,17.61),4.98,.25,inset,root,axis='Z',sides=48)
    seat = cylinder('Adjustment seat pocket tool',(0,18.0,19.70),4.21,2.77,inset,root,axis='Z',sides=56,bevel=.26)
    subtract(deck,seat)
    cylinder('Black adjustment seat',(0,18.0,18.57),3.98,.19,inset,root,axis='Z',sides=48,bevel=0)
    fastener('Flush pedestal adjustment head',(0,18.0,19.14),2.36,.71,hardware_top,inset,root,axis='Z')
    pocket_edges(deck)
    pocket_edges(hood)
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
    subtract(emitter,cylinder('Emitter cup tool',(0,-31.22,23.03),2.4,4.5,inset,root,axis='Y',sides=44,bevel=.17))
    cylinder('Dark emitter cup seat',(0,-33.43,23.03),2.1,.17,inset,root,axis='Y',sides=32)
    cylinder('Small recessed emitter glass',(0,-33.28,23.03),.66,.14,diode,root,axis='Y',sides=24)
    pocket_edges(emitter)
    for x in (-8.55,8.55):
        for y,z,r in [(-21.4,20.01,1.73),(-1.9,21.91,2.24)]:
            cylinder('Dark top countersink',(x,y,z),r+.66,.14,inset,root,axis='Z',sides=40,bevel=.03)
            fastener('Broad flush top fastener',(x,y,z+.049),r,.26,hardware_top,inset,root,axis='Z')
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
