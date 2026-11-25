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
CLAMP_POCKETS = [(-27.8,30.8),(17.6,34.7)]
OUT = Path(__file__).resolve().parents[3]/'.cache/blender/attachments/c-more-railway'


def empty(name, parent=None, pos=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = Vector(pos) * .001
    return obj


def boolean(obj, tool, operation='DIFFERENCE'):
    active(obj)
    cut = obj.modifiers.new('Molded detail', 'BOOLEAN')
    cut.operation, cut.object, cut.material_mode = operation, tool, 'TRANSFER'
    bpy.ops.object.modifier_apply(modifier=cut.name)
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
    boolean(head,cylinder('Hex socket tool',bit,radius*.46,depth*.65,mask,root,axis=axis,sides=6,bevel=0))
    return head


def slotted_head(name, center, radius, depth, metal, mask, root, axis='X', side=1):
    head = cylinder(name,center,radius,depth,metal,root,axis=axis,sides=40,bevel=.13)
    bit = Vector(center)
    i = 0 if axis == 'X' else 2
    bit[i] += side*depth*.47
    size = (depth*.72,.70,radius*2.2) if axis == 'X' else (radius*2.2,.69,depth*.72)
    tool = box('Slotted drive tool',bit,size,mask,root,.07)
    tool.rotation_euler[i] = math.radians(12)
    boolean(head,tool)
    pocket_edges(head)
    return head


def loft(name, stations, mat, root, crown=False):
    n = len(stations[0][1])
    points = [(x,front_sweep(x,y,z) if crown else y,z) for y,loop in stations for x,z in loop]
    last = (len(stations)-1)*n
    faces = [tuple(range(n)), tuple(reversed(range(last,last+n)))]
    faces += [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)
              for j in range(len(stations)-1) for i in range(n)]
    return finish(mesh(name,points,faces,mat,root),width=0)


def section_body(name, sections, mat, root):
    """Molded part with a rounded section and individually tapered ends."""
    return loft(name,[(y,rounded_rect(w,hi-lo,r,center_z=(hi+lo)/2,steps=5))
                      for y,w,lo,hi,r in sections],mat,root)


def lens_deck(root, mat):
    stations = []
    for y,w,lo,rail,bed in [(8.72,22.65,14.25,18.68,17.98),(10.5,24.08,14.25,20.0,18.98),
                           (14.3,24.8,14.3,20.33,19.0),(23.4,25.1,14.3,20.52,19.1),
                           (31.1,25.25,14.45,21.04,19.68),(36.8,25.5,15.1,21.75,20.18),
                           (40.3,26.10,15.38,22.49,20.95),(43.45,26.42,15.50,23.15,21.50),
                           (46.0,26.58,15.6,23.69,21.62),(48.2,26.30,15.61,23.84,21.93),
                           (51.0,25.20,15.65,23.55,22.60)]:
        a = w/2
        # Opposing molded shoulders share a depressed center deck. The forward
        # corners rise into the rim but stay outside the coated pane.
        top = [(a-.56,rail-.61),(a-1.37,rail),(a-2.1,rail-.24),(a-3.28,rail-.93),
               (a-4.45,bed+.36),(a-5.7,bed+.03),(0,bed)]
        loop = [(a-.75,lo),(a,lo+.68),(a,rail-1.04),*top,
                *[(-x,z) for x,z in reversed(top[:-1])],(-a,rail-1.04),(-a,lo+.68),(-a+.75,lo)]
        stations.append((y,loop))
    return loft('Concave molded lens deck',stations,mat,root)


def front_sweep(x,y,z):
    # The upper part of the center arch leans back into the web. Its lower
    # face and the outside cheeks don't move, so the opening reads from above.
    return y-.72*max(0,z-10.25)*min(1,max(0,(y-50.0)/10.95))*max(0,1-(abs(x)/9.65)**4)


def front_web(root, mat):
    # The forward cross sections peak over the opening and drop at its sides.
    # Preserve the vertical side wall where the round opening crosses the web.
    stations = []
    for y,w,lo,shoulder,crown in [(6.36,27.1,5.1,16.5,16.5),(13,27.3,4.98,17.35,17.35),
                                 (39,27.35,5,17.54,17.54),(46.3,28,5.15,18.16,18.16),
                                 (50.1,28.52,5.48,19.06,21.36),(53.35,29.8,6.1,20.12,23.15),
                                 (55.8,29.10,6.91,20.05,22.86),(57.55,28.06,7.84,18.90,22.20),
                                 (59.2,23.75,8.74,16.4,21.72),(60.29,21.05,9.45,15.66,21.33),
                                 (LENGTH/2,18.8,9.94,15.04,20.66)]:
        a = w/2
        top = [(a*t,shoulder+(crown-shoulder)*max(0,1-(t/.90)**2)**.88)
               for t in (.86,.73,.60,.47,.34,.21,.10,0)]
        loop = [(a-1.18,lo),(a-.34,lo+.43),(a,lo+1.11),(a,shoulder-1.02),
                (a-.40,shoulder-.34),*top,*[(-x,z) for x,z in reversed(top[:-1])],
                (-a+.40,shoulder-.34),(-a,shoulder-1.02),(-a,lo+1.11),(-a+.34,lo+.43),(-a+1.18,lo)]
        stations.append((y,loop))
    return loft('Crowned front web and lower arm',stations,mat,root,crown=True)


def side_slot(name, item, side, y, z, width, height, depth, mat, root, face=13.6):
    outline = [(y+a,z+b) for a,b in rounded_rect(width,height,min(height*.49,2),steps=8)]
    x = side*face
    lo,hi = sorted((x-side*depth,x+side*2))
    boolean(item,prism(name,outline,lo,hi,mat,root,bevel=.06))


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
    # The outside of the hoop carries the shoulder's long sweep. Its lower
    # stations sink into the deck before they end, not as a raised heel.
    # The upper rim and the circular aperture keep their dimensions.
    profile = [(43.1,.67,0,23.2),(43.8,.22,0,24.38),(44.7,0,0,25.3),
               (49.7,0,0,10.65),(51.25,.26,0,4),(51.85,.85,0,0),
               (51.85,0,1,0),(49.85,0,1,0),(45.6,0,1,2),(43.1,0,1,4)]
    n = 120
    vertices = []
    for y,bevel,inner,sweep in profile:
        for i in range(n):
            a = i*math.tau/n
            h = math.sin(a)
            side = math.cos(a)
            blend = (max(0,.33-h)/1.33)**1.65
            x_r = WINDOW if inner else WIDTH/2-bevel
            z_r = WINDOW if inner else RIM_HEIGHT_R-bevel
            drop = 0 if inner else 5.35*blend
            z = z_r*h*(math.cos(LENS_TILT) if inner else 1)
            vertices.append((x_r*side,y-sweep*blend+z_r*h*math.sin(LENS_TILT),AXIS+z-drop))
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
    # Cut through the side plate and recess the saddle beneath it. The
    # floor must be visible, not hidden behind overlapping saddle geometry.
    for y,w in CLAMP_POCKETS:
        side_slot('Clamp plate window',bar,1,y,.28,w,2.88,2.48,base,root)
        side_slot('Saddle pocket floor',saddle,1,y,.28,w,2.88,2.04,saddle_recess,root)
    pocket_edges(bar)
    pocket_edges(saddle)
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
    shell = lens_deck(root,body)
    boolean(shell,ring(root,body),'UNION')
    boolean(shell,front_web(root,body),'UNION')
    shell.name = 'Continuous molded crown, deck and nose'

    for side in (-1,1):
        side_slot('Forward side capsule',shell,side,46.75,10.22,9.88,3.83,1.42,inset,root,14.16)
    well = cylinder('Round lens well tool',(0,34.5,20.55),4.77,9.25,inset,root,axis='Z',sides=64,bevel=.16)
    boolean(shell,well)
    cylinder('Dark lens-well floor',(0,34.5,15.99),4.45,.22,inset,root,axis='Z',sides=48)
    # Curved recessed seat behind the well; its slotted head is flush with the deck.
    seat = [(17.1,22.4,7.9),(17.6,20.30,7.56),(18.2,19.55,6.8),
            (18.45,18.80,5.65),(18.52,17.95,4.58),(18.52,17.52,4.44)]
    n = 64
    seat_points = [(r*math.cos(a),y+r*math.sin(a),z) for y,z,r in seat
                   for a in (i*math.tau/n for i in range(n))]
    last = len(seat_points)-n
    faces = [tuple(reversed(range(n))),tuple(range(last,last+n))]
    faces += [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)
              for j in range(len(seat)-1) for i in range(n)]
    boolean(shell,finish(mesh('Curved adjustment cup tool',seat_points,faces,body,root),width=0))
    cylinder('Recessed adjuster seat',(0,18.52,17.61),4.37,.19,inset,root,axis='Z',sides=48,bevel=0)
    slotted_head('Flush elevation head',(0,18.52,18.20),2.72,.71,steel,inset,root,axis='Z')
    arch = [(-7.65,10.78),(7.65,10.78),(8.1,11.9)]
    arch += [(8.1*math.cos(i*math.pi/28),11.9+6.82*math.sin(i*math.pi/28)**.89) for i in range(1,28)]
    arch += [(-8.1,11.9)]
    opening = prism('Arched front opening',arch,49.73,65,inset,root,axis='Y',bevel=.20)
    # The pockets share an interior, but the side mouth stops aft of the front
    # arch lip so both openings keep their own continuous molded border.
    boolean(opening,cylinder('Transverse front-web opening',(0,53.45,16.28),2.64,34,inset,root,
                             axis='X',sides=52,bevel=.20),'UNION')
    boolean(shell,opening)
    pocket_edges(shell)
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
    cap = [(-5.9,19.4),(5.9,19.4),(5.9,22.95)]
    cap += [(5.9*math.cos(i*math.pi/24),22.95+4.05*math.sin(i*math.pi/24)) for i in range(1,24)]
    cap += [(-5.9,22.95)]
    emitter = prism('Arched emitter housing',cap,-39.45,-30.28,body,root,axis='Y',bevel=.68)
    boolean(emitter,cylinder('Emitter cup tool',(0,-31.12,23.1),2.44,4.75,inset,root,axis='Y',sides=48,bevel=.16))
    cylinder('Dark emitter cup seat',(0,-33.38,23.1),2.11,.16,inset,root,axis='Y',sides=36)
    cylinder('Small recessed emitter glass',(0,-33.25,23.1),.77,.15,diode,root,axis='Y',sides=24)
    pocket_edges(emitter)
    for x in (-8.55,8.55):
        for y,z,r in [(-21.4,20.01,1.73),(-1.9,21.91,2.24)]:
            cylinder('Dark top countersink',(x,y,z),r+.66,.14,inset,root,axis='Z',sides=40,bevel=.03)
            fastener('Broad flush top fastener',(x,y,z+.049),r,.26,hardware_top,inset,root,axis='Z')
    slotted_head('Small right guide pin',(13.62,17.6,10.45),1.35,.49,hardware_top,inset,root)
    cylinder('Recessed right lock pocket',(13.64,24.1,10.45),1.51,.28,inset,root,sides=32)
    fastener('Right lock screw',(13.69,24.1,10.45),.9,.36,steel,inset,root)
    slotted_head('Broad right windage head',(13.76,31.2,10.59),2.92,.75,steel,inset,root)
    fastener('Right elevation lock',(13.74,37.4,10.48),2.29,.57,hardware_top,inset,root)
    cylinder('Left guide pin',(-13.62,22.5,10.5),1.1,.25,hardware_top,root,sides=32)
    cylinder('Left lock pocket',(-13.64,28.2,10.47),1.53,.28,inset,root,sides=32)
    slotted_head('Left exposed lock head',(-13.67,35.4,10.5),2.13,.53,steel,inset,root,side=-1)
    for side in (-1,1):
        side_name = 'right' if side == 1 else 'left'
        text('Molded C-MORE wordmark','C-MORE',(side*13.82,-42.3,12.76),5.44,etch,root,side=side_name)
        text('Molded maker line','C-MORE SYSTEMS',(side*13.82,-42.3,9.92),1.40,etch,root,side=side_name)
    for i in range(7):
        a = math.radians(23+42*i)
        mark = box('Molded dial index',(5.85*math.cos(a),-48+5.85*math.sin(a),20.65),
                   (1.26,.40,.12),inset,root,.07)
        mark.rotation_euler.z = a
    for label,x in [('OFF',-8.18),('HI',8.12)]:
        mark = text('Dial '+label,label,(x,-53.85,20.65),1.68,inset,root,side='rear')
        mark.rotation_euler = (0,0,0)


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


def check_pockets(root):
    # The underlying saddle used to hide the plate cuts. Check the first surface
    # of the complete rendered assembly, not the isolated clamp bar.
    parts = [obj for obj in root.children if obj.type == 'MESH']
    for center,width in CLAMP_POCKETS:
        for offset in (-width*.31,0,width*.31):
            origin = Vector((.02,(center+offset)*.001,.00028))
            hits = []
            for obj in parts:
                inverse = obj.matrix_world.inverted()
                hit,point,_,face = obj.ray_cast(inverse@origin,inverse.to_3x3()@Vector((-1,0,0)))
                if hit:
                    mat = obj.data.materials[obj.data.polygons[face].material_index]
                    hits.append(((obj.matrix_world@point).x,mat.name))
            assert hits and max(hits)[1].startswith('09 |'), ('saddle pocket is occluded',center,offset)
    print('RAILWAY_POCKETS_OK: six visible floor rays',flush=True)


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
    check_pockets(root)
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
