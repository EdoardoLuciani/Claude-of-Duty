"""Reference-specific P320 assemblies, pivots, lettering and unique atlas UVs."""
import math
from pathlib import Path
import bmesh
import bpy
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from .materials import build_source_materials
import picatinny

def build_geometry(asset):
    def active(o):
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
        bpy.context.view_layer.objects.active = o

    def move(o, collection=asset):
        for c in list(o.users_collection): c.objects.unlink(o)
        collection.objects.link(o)
        return o

    def empty(name, loc=(0,0,0), parent=None):
        o = bpy.data.objects.new(name, None); asset.objects.link(o)
        o.parent = parent; o.location = loc; o.empty_display_size = .006
        return o

    rig = empty('P320_RIG')
    rig['subject'] = 'SIG SAUER P320 Nitron Full-Size | visual reconstruction'
    body = empty('frame', parent=rig)
    slide = empty('slide', parent=rig)
    barrel = empty('barrel', (0,.064,.037), rig)
    trigger = empty('trigger', (0,.030,.010), rig)
    catch = empty('slide_catch', (0,-.006,.020), rig)
    mag = empty('magazine', parent=rig)
    spare = empty('magazine_spare', parent=rig)
    round_live = empty('magazine_round', parent=mag)
    round_spare = empty('magazine_spare_round', parent=spare)
    bpy.context.view_layer.update()
    coords = empty('Surface_coordinates')

    nitron, polymer, steel, barrel_mat, mag_mat, cavity, mark, brass, copper, white = build_source_materials(coords)
    def finish(o, name, mat=polymer, parent=body, bevel=.0005, smooth=False):
        o.name = name; move(o)
        if mat: o.data.materials.append(mat)
        if parent:
            o.parent = parent; o.matrix_parent_inverse = parent.matrix_world.inverted()
        if smooth:
            for p in o.data.polygons: p.use_smooth = True
        if bevel:
            b = o.modifiers.new('Edge radii', 'BEVEL'); b.width = bevel; b.segments = 3
            b = o.modifiers.new('Face-weighted normals', 'WEIGHTED_NORMAL'); b.keep_sharp = True
        return o

    def box(name,loc,dims,mat=polymer,parent=body,bevel=.0005):
        bpy.ops.mesh.primitive_cube_add(size=1,location=loc)
        o=bpy.context.object; o.dimensions=dims
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        return finish(o,name,mat,parent,bevel)

    def mesh(name,verts,faces,mat=polymer,parent=body,bevel=.0005,smooth=False):
        d=bpy.data.meshes.new(name); d.from_pydata(verts,[],faces); d.update()
        o=bpy.data.objects.new(name,d); asset.objects.link(o)
        active(o); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
        return finish(o,name,mat,parent,bevel,smooth)

    def profile(name,points,width,mat=polymer,parent=body,bevel=.0005,x=0,smooth=False):
        if smooth:
            outline=[]
            for i in range(len(points)):
                p0,p1,p2,p3=(Vector(points[j%len(points)]) for j in (i-1,i,i+1,i+2))
                for step in range(6):
                    t=step/6
                    outline.append(.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t))
            points=outline
        n=len(points)
        verts=[(x+s*width/2,y,z) for s in (-1,1) for y,z in points]
        faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]
        faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        o=mesh(name,verts,faces,mat,parent,bevel)
        if smooth:
            for face in o.data.polygons[2:]:face.use_smooth=True
        return o

    def cyl(name,loc,r,depth,mat=steel,parent=body,axis='X',sides=48,bevel=.00015):
        bpy.ops.mesh.primitive_cylinder_add(vertices=sides,radius=r,depth=depth,location=loc)
        o=bpy.context.object
        if axis=='X': o.rotation_euler[1]=math.pi/2
        if axis=='Y': o.rotation_euler[0]=math.pi/2
        bpy.ops.object.transform_apply(location=False,rotation=True,scale=False)
        for p in o.data.polygons: p.use_smooth=len(p.vertices)==4
        return finish(o,name,mat,parent,bevel)

    def cut(o,cutter):
        active(o); m=o.modifiers.new('Recess/opening','BOOLEAN'); m.object=cutter; m.operation='DIFFERENCE'
        while list(o.modifiers).index(m)>0: bpy.ops.object.modifier_move_up(modifier=m.name)
        bpy.ops.object.modifier_apply(modifier=m.name); bpy.data.objects.remove(cutter,do_unlink=True)

    def rounded_cut(o,loc,dims,r=.001):
        c=box('CUT',loc,dims,None,None,0)
        m=c.modifiers.new('Cutter round','BEVEL');m.width=r;m.segments=12
        active(c);bpy.ops.object.modifier_apply(modifier=m.name);cut(o,c)

    def tube(name,loc,r,inner,length,mat=barrel_mat,parent=barrel):
        o=cyl(name,loc,r,length,mat,parent,'Y',64)
        cut(o,cyl('CUT',loc,inner,length+.003,None,None,'Y',48,0));return o

    # Slide: hollow underside, machined top chamfers, genuine recessed serrations.
    half=[(-.0124,.027),(-.01315,.0281),(-.0135,.0295),(-.0135,.0375),
          (-.01335,.0408),(-.0129,.0440),(-.0122,.0464),(-.0113,.0483),(-.0102,.0494),(-.009,.0497)]
    section=half+[(-x,z) for x,z in reversed(half)]
    verts=[(x,y-(.006*max(0,(.0497-z)/.0227) if y<0 else 0),z)
           for y in (-.038,.146,.150) for x,z in section]
    for i,(x,y,z) in enumerate(verts[-len(section):],len(verts)-len(section)):
        verts[i]=(x*.86,y,z+(.001 if z<.037 else -.001))
    n=len(section); faces=[tuple(range(n-1,-1,-1)),tuple(range(2*n,3*n))]
    faces += [(j+i,j+(i+1)%n,j+(i+1)%n+n,j+i+n) for j in (0,n) for i in range(n)]
    shroud=mesh('Slide | chamfered Nitron shell',verts,faces,nitron,slide,.00065)
    for face in shroud.data.polygons:
        face.use_smooth=abs(face.normal.y)<.98
    rounded_cut(shroud,(0,.046,.0235),(.022,.185,.033),.0015)
    # Front face has independent barrel and guide rod openings, not a black decal.
    cut(shroud,cyl('CUT',(0,.147,.037),.00765,.017,None,None,'Y',64,0))
    # Preserve clearance through the authored barrel tilt, behind the front face.
    cut(shroud,cyl('CUT',(0,.143,.040),.00765,.014,None,None,'Y',64,0))
    cut(shroud,cyl('CUT',(0,.147,.026),.0044,.017,None,None,'Y',48,0))
    cut(shroud,profile('CUT',[(.027,.047),(.034,.039),(.0615,.039),(.065,.042),
                              (.067,.056),(.030,.056)],.024,None,None,.0008,.011))
    rounded_cut(shroud,(0,.047,.053),(.035,.030,.0104),.0013)
    for side in (-1,1):
        for start,count,pitch,top in [(-.034,9,.0040,.045),(.099,8,.0042,.0395)]:
            for i in range(count):
                y=start+i*pitch
                cutter=profile('CUT',[(y-.00075,.025),(y+.00090,.025),(y+.0095,top),(y+.0090,top+.0009),
                                       (y+.0078,top+.0005)],.005,None,None,0,side*.0147)
                cut(shroud,cutter)
    # Rear slide cap set into a recessed rear face.
    rounded_cut(shroud,(0,-.0411,.036),(.017,.006,.017),.0015)
    cap=box('Rear striker cover',(0,-.0416,.036),(.016,.0025,.0163),steel,slide,.0013)
    cap.rotation_euler.x=-math.atan(.2)
    # Ejection-side external extractor, flush to the port edge.
    rounded_cut(shroud,(.0135,.022,.041),(.0022,.019,.0055),.0017)
    profile('Extractor claw',[(.014,.040),(.017,.039),(.031,.039),(.034,.042),(.029,.0435),(.017,.0435)],
            .0022,steel,slide,.00065,.01245)
    wordmark = bpy.data.curves.new('SIGSAUER  P320', 'FONT')
    wordmark.body = 'SIGSAUER  P320'
    wordmark.size = .0045
    wordmark.resolution_u = 4
    font_path = Path('/usr/share/fonts/dejavu-sans-fonts/DejaVuSansCondensed-Oblique.ttf')
    if font_path.exists():
        wordmark.font = bpy.data.fonts.load(str(font_path))
    wordmark.materials.append(mark)
    label = bpy.data.objects.new('Mark | SIGSAUER  P320', wordmark)
    asset.objects.link(label)
    label.parent = slide
    label.location = (-.0125, .132, .0440)
    label.rotation_euler = Matrix(((0,.46,-.888),(-1,0,0),(0,.888,.46))).to_euler()

    # A continuously lofted grip, with a palm swell and rounded rectangular sections.
    # Each station: z, y centre, half fore/aft depth, half width.
    stations=[(-.082,-.026,.0250,.0148),(-.080,-.025,.0255,.0155),(-.073,-.024,.0257,.0159),
    (-.064,-.022,.0260,.0161),(-.054,-.020,.0255,.0160),(-.044,-.017,.0253,.0155),
    (-.034,-.014,.0245,.0148),(-.025,-.011,.0243,.0142),(-.017,-.008,.0245,.0135),
    (-.012,-.0075,.0248,.0134),(-.008,-.007,.025,.0132),(-.004,-.0074,.026,.0132),
    (.001,-.008,.027,.0131),(.005,-.009,.029,.0131),(.010,-.010,.031,.0131),(.026,-.009,.034,.0128)]
    verts=[]; sides=64
    for z,y,ry,rx in stations:
        for i in range(sides):
            a=i*math.tau/sides
            # Rounded rectangle with a shallow, continuous relief above the palm.
            x=math.copysign(abs(math.cos(a))**.67,math.cos(a))*rx
            yy=y+math.copysign(abs(math.sin(a))**.67,math.sin(a))*ry
            hollow=.0042*math.exp(-((yy-.009)/.018)**2-((z+.001)/.0085)**2)
            ridge=.00165*math.exp(-((yy-.002)/.019)**2-((z+.0115)/.004)**2)
            rolled=abs(x)+(ridge-hollow)*(abs(x)/rx)**2
            verts.append((math.copysign(rolled,x),yy,z))
    faces=[]
    for k in range(len(stations)-1):
        for i in range(sides):faces.append((k*sides+i,k*sides+(i+1)%sides,(k+1)*sides+(i+1)%sides,(k+1)*sides+i))
    faces += [tuple(range(sides-1,-1,-1)),tuple((len(stations)-1)*sides+i for i in range(sides))]
    grip=mesh('Frame | sculpted Full-Size grip',verts,faces,polymer,body,0,True)
    for p in grip.data.polygons:
        p.use_smooth=len(p.vertices)==4
    # Real open magwell. Keep a molded rim rather than a sealed bottom.
    well=box('CUT',(0,-.019,-.063),(.022,.033,.075),None,None,0)
    well.rotation_euler.x=math.radians(-12)
    cut(grip,well)
    # The catalog's left profile sets the slide-to-tang span and rail/body silhouette.
    # Preserve the hand-indexing surfaces around the trigger and use metres for art.
    def left_profile(points):return [(.150-(x-13)*.000302,.056-(y-19)*.000300) for x,y in points]
    frame=profile('Frame | dust cover and rounded tang',left_profile([
        (17,107),(622,107),(632,114),(639,125),(647,135),(657,143),(668,148),(678,151),
        (684,152),(685,155),(681,159),(674,163),(663,167),(650,173),(640,181),(632,193),
        (626,208),(622,226),(588,226),(564,207),(550,185),(537,177),
        (308,175),(278,173),(254,165),(22,165),(18,157)]),.0257,polymer,body,.0016)
    # Tessellate the side before rounding it, so the taper doesn't pull a few large
    # triangles across the planar dust cover. The rail contact geometry is separate.
    shoulders=bmesh.new();shoulders.from_mesh(frame.data)
    bmesh.ops.triangulate(shoulders,faces=list(shoulders.faces))
    for _ in range(6):
        long_edges=[e for e in shoulders.edges if e.calc_length()>.009 and min(v.co.y for v in e.verts)<.037]
        if not long_edges:break
        bmesh.ops.subdivide_edges(shoulders,edges=long_edges,cuts=1,use_grid_fill=True)
    for vertex in shoulders.verts:
        x,y,z=vertex.co
        neck=min(1,max(0,(.022-z)/.017))*min(1,max(0,(.035-y)/.020))
        tip=min(1,max(0,(-.035-y)/.018))
        neck=neck*neck*(3-2*neck)
        vertex.co.x=x*(1-.54*neck)*(1-.65*tip*tip)
    for face in shoulders.faces:
        face.smooth=abs(face.normal.x)>.8
    shoulders.to_mesh(frame.data);shoulders.free();frame.data.update()
    # Two nested reveals below the slide, with the inner one continuing onto the rail.
    recess=left_profile([(12,141),(245,141),(282,171),(260,172),(233,151),(12,151)])
    relief=left_profile([(15,151),(231,151),(256,171),(247,174),(227,158),(15,158)])
    for sign in (-1,1):
        cut(frame,profile('CUT',recess,.004,None,None,.0004,sign*.01335))
        cut(frame,profile('CUT',relief,.0035,None,None,.00035,sign*.0141))
    def silhouette(points):return [(.130-(x-136)*.000311,.050-(y-36)*.000311) for x,y in points]
    # Slim rounded guard, traced independently of the grip and inset under the rail.
    guard=profile('Frame | integral trigger guard',left_profile([
        (274,156),(282,172),(285,201),(284,237),(281,267),(305,271),(386,274),
        (423,270),(447,263),(483,275),(502,215),(478,164)]),.0182,polymer,body,.0021,smooth=True)
    inner=profile('CUT',left_profile([
        (306,180),(359,178),(419,178),(443,186),(450,203),(451,222),(443,243),
        (419,256),(387,262),(334,261),(306,258),(294,245),(292,211),(295,191)]),.030,None,None,.0024,smooth=True)
    active(inner)
    for mod in list(inner.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
    cut(guard,inner)
    for z in [.001,-.002,-.005,-.008,-.011,-.014]:
        rounded_cut(guard,(0,.0692,z),(.021,.0025,.0009),.0003)
    # The longer frame carries the integral rail forward, without moving the TOR Mini seat.
    rail_y=.097
    outline=[(x,.002-z) for x,z in picatinny.section(bottom=-.021)]
    points,faces=picatinny.prism(outline,.069,.145)
    rail=mesh('Frame | integral accessory rail',points,faces,polymer,body,0)
    for i in range(-1,5):
        y=rail_y+i*picatinny.PITCH
        cap=.002+picatinny.SLOT_DEPTH
        cut(rail,box('CUT accessory groove',(0,y,cap-.006),(.025,picatinny.SLOT,.012),None,None,0))
    # Side controls. The magazine button is triangular, not the old circular button.
    profile('Magazine release | checkered face',[(-.003,-.012),(.007,-.018),(.005,-.023),(-.004,-.022)],.002,steel,body,.0007,-.014)
    for y in [-.001,.001,.003,.005]:
        box('Magazine release | ribs',(-.01515,y,-.018),(.0003,.00045,.0055),nitron,body,.0001)
    profile('Magazine release | reverse face',[(-.003,-.012),(.007,-.018),(.005,-.023),(-.004,-.022)],.0006,polymer,body,.0006,.0134)
    cyl('Takedown lever | spindle',(-.0138,.055,.017),.0066,.0018,steel)
    profile('Takedown lever | paddle',silhouette([(359,124),(376,119),(405,121),(445,122),
                  (447,136),(404,140),(388,156),(376,160),(364,148)]),.0032,steel,body,.0011,-.0144,smooth=True)
    for z in [.019,.0203,.0216]:box('Takedown lever | traction',(-.01596,.039,z),(.00033,.012,.00055),steel,body,.00014)
    cyl('Takedown | reverse pin',(.0130,.055,.017),.0051,.0016,barrel_mat,body,'X',48,.00042)
    for side in (-1,1):
        profile('Ambidextrous slide catch', [(-.012,.025),(-.001,.025),(.001,.021),(-.003,.018),(-.011,.019)],
                .0026,steel,catch,.0008,side*.01345,smooth=True)
        for z in [.019,.0205,.022]:box('Slide catch | serration',(side*.0154,-.006,z),(.0002,.007,.00035),nitron,catch,.00012)
    # Recessed chassis window without a serial decal.
    rounded_cut(frame,(.0132,-.024,.021),(.0028,.028,.0048),.00065)
    box('Identification plate',(.0119,-.024,.021),(.00045,.026,.0036),steel,body,.0004)
    box('Unmarked label field',(.0122,-.0225,.021),(.00055,.0124,.0031),mark,body,.00035)

    # Moving barrel and guide rod are visible in both muzzle and open-slide poses.
    tube('Barrel | chamber to muzzle',(0,.0795,.037),.0068,.0044,.138)
    stock = empty('MUZZLE_device', parent=barrel)
    exposed = empty('MUZZLE_device_removed', parent=barrel)
    bpy.context.view_layer.update()
    tube('Barrel | inset stock crown',(0,.1490,.037),.0067,.00445,.0012,barrel_mat,stock)
    tube('Barrel | threaded extension',(0,.1565,.037),.00635,.0044,.016,barrel_mat,exposed)
    # External helical thread is visual game art, not a manufacturing profile.
    vertices=[];faces=[];steps=240
    for i in range(steps+1):
        angle=i*math.tau/20
        y=.1505+i/steps*.012
        for radius,dy in ((.00635,-.00035),(.00695,0),(.00635,.00035)):
            vertices.append((math.cos(angle)*radius,y+dy,.037+math.sin(angle)*radius))
        if i:
            for j in range(2):
                k=(i-1)*3+j;faces.append((k,k+3,k+4,k+1))
    mesh('Barrel | external muzzle thread',vertices,faces,barrel_mat,exposed,0,True)
    hood=profile('Barrel | chamber hood',[(.031,.040),(.035,.038),(.060,.038),(.064,.042),(.063,.0483),(.034,.0483)],
                 .0204,barrel_mat,barrel,.0014)
    # Chamber lettering is a shallow photo-derived impression, baked with the exterior.
    chamber_mark = bpy.data.curves.new('Chamber lettering','FONT')
    chamber_mark.body='SIG\n9MM PARA'; chamber_mark.align_x='CENTER'
    chamber_mark.size=.00225; chamber_mark.space_line=.86
    chamber_mark.materials.append(cavity)
    engraving=bpy.data.objects.new('Mark | chamber legend',chamber_mark);asset.objects.link(engraving)
    engraving.parent=barrel; engraving.matrix_parent_inverse=barrel.matrix_world.inverted()
    engraving.location=(.0113,.051,.0448)
    engraving.rotation_euler=Matrix(((0,0,1),(1,0,0),(0,1,0))).to_euler()
    cyl('Guide rod | front cap',(0,.141,.026),.0036,.018,steel,body,'Y')
    cyl('Guide rod | exposed shaft',(0,.063,.026),.0022,.136,steel,body,'Y')
    # Rounded blade with its upper shank tucked into the frame.
    sections=[(-.0176,.0388,.0406,.0008),(-.0168,.0359,.0410,.0018),(-.0150,.0328,.0397,.0025),
              (-.0125,.0299,.0370,.0028),(-.0078,.0279,.0346,.0032),(-.0028,.0272,.0339,.0035),
              (.0026,.0275,.0349,.0036),(.0080,.0280,.0375,.0037),(.0110,.0280,.0375,.0037)]
    sides=24
    verts=[(width*math.copysign(abs(math.cos(a))**.8,math.cos(a)),
            (back+front+(front-back)*math.copysign(abs(math.sin(a))**.8,math.sin(a)))/2,z)
           for z,back,front,width in sections for i in range(sides) for a in (i*math.tau/sides,)]
    faces=[(k*sides+i,k*sides+(i+1)%sides,(k+1)*sides+(i+1)%sides,(k+1)*sides+i)
           for k in range(len(sections)-1) for i in range(sides)]
    faces += [tuple(reversed(range(sides))),tuple(range(len(verts)-sides,len(verts)))]
    mesh('Trigger | original curved blade',verts,faces,steel,trigger,.0003,True)

    # Flush Full-Size magazine exterior and visible top; gameplay capacity is separate.
    m=profile('Magazine | stamped body',[(-.039,-.081),(-.011,-.081),(.011,.005),(-.012,.005)],.0185,mag_mat,mag,.0013)
    # Tuck the upper front corners inside the molded thumb relief at rest.
    for vertex in m.data.vertices:
        vertex.co.x*=1-.27*min(1,max(0,vertex.co.y/.011))
    for side in (-1,1):
        for z in [-.063,-.045,-.027]:
            y=-.009+(z+.065)*.22
            cut(m,cyl('CUT',(side*.0095,y,z),.0012,.003,None,None,'X',16,0))
        # Shallow stamped longitudinal flutes, not floating ribs.
        for yy in (-.014,.003):
            c=box('CUT',(side*.0102,yy,-.038),(.003,.0028,.068),None,None,0)
            c.rotation_euler.x=math.radians(-14);cut(m,c)
    profile('Magazine | flush polymer floorplate',[
        (-.046,-.080),(-.042,-.079),(-.006,-.079),(-.0005,-.0804),(-.0015,-.0836),
        (-.006,-.084),(-.041,-.084),(-.0455,-.0835)],.0292,polymer,mag,.0014,smooth=True)
    # Visible top during reload; abstract dummy-cartridge art, no functional internals.
    for side in (-1,1):box('Magazine | feed lip',(side*.008,.007,.015),(.0025,.021,.004),mag_mat,mag,.00065)
    cyl('Magazine | visible round',(0,.012,.015),.0044,.018,brass,round_live,'Y',32)
    # Explicit latitude rings avoid the UV-sphere operator's allocator-dependent
    # face traversal, which otherwise changes this tip's smart-project islands.
    segments, latitude_steps = 24, 12
    vertices = [(0, 0, .0044)]
    for longitude in range(segments):
        theta = longitude * math.tau / segments
        for latitude in range(1, latitude_steps):
            phi = latitude * math.pi / latitude_steps
            vertices.append((.0044 * math.sin(phi) * math.sin(theta),
                             .008 * math.sin(phi) * math.cos(theta),
                             .0044 * math.cos(phi)))
    south = len(vertices)
    vertices.append((0, 0, -.0044))
    faces = []
    for longitude in range(segments):
        current = 1 + longitude * (latitude_steps - 1)
        following = 1 + ((longitude + 1) % segments) * (latitude_steps - 1)
        faces.append((current, 0, following))
        for latitude in range(latitude_steps - 2):
            faces.append((current + latitude + 1, current + latitude,
                          following + latitude, following + latitude + 1))
        faces.append((south, current + latitude_steps - 2,
                      following + latitude_steps - 2))
    tip_mesh = bpy.data.meshes.new('Cartridge tip | latitude rings')
    tip_mesh.from_pydata(vertices, [], faces)
    tip_mesh.update()
    tip = bpy.data.objects.new('Magazine | round nose', tip_mesh)
    asset.objects.link(tip)
    tip.location = (0, .025, .015)
    finish(tip, tip.name, copper, round_live, 0, True)

    # Low standard SIGLITE sights. Rear notch is open geometry, dots are recessed.
    rear=profile('Rear sight | square notch',[(-.037,.0488),(-.026,.0488),(-.028,.055),(-.034,.056),(-.036,.055)],.014,steel,slide,.0004)
    rounded_cut(rear,(0,-.032,.055),(.0037,.02,.0055),.00015)
    front=profile('Front sight | blade',[(.129,.0487),(.139,.0487),(.138,.054),(.131,.055)],.0037,steel,slide,.0004)
    tritium=bpy.data.materials.new('SIGLITE | tritium');tritium.use_nodes=True
    p=tritium.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.3,.65,.27,1)
    p.inputs['Emission Color'].default_value=(.035,.22,.025,1);p.inputs['Emission Strength'].default_value=.2
    p.inputs['Roughness'].default_value=.6
    for x,y,z,r in [(-.0048,-.0364,.0531,.0010),(.0048,-.0364,.0531,.0010),(0,.1293,.0528,.0011)]:
        cyl('SIGLITE | white annulus',(x,y,z),r,.00016,white,slide,'Y',32,0)
        cyl('SIGLITE | luminous inset',(x,y-.00010,z),r*.43,.0001,tritium,slide,'Y',24,0)
    # Sockets exported in game axes via glTF +Y-up conversion.
    for name,pos,parent in [('SOCKET_muzzle',(0,.150,.037),barrel),('SOCKET_ejection',(.015,.048,.042),slide),
                            ('SOCKET_sight',(0,-.033,.0537),rig),
                            ('MOUNT_muzzle',(0,.152,.037),barrel),
                            ('MOUNT_rail',(0,rail_y,.002),body)]:
        # Keep authored world coordinates under offset pivots.
        o=empty(name,parent=parent);o.matrix_parent_inverse=parent.matrix_world.inverted();o.location=pos
        # Identity muzzle frame: native +Y forward becomes glTF -Z forward.

    # Union the molded frame pieces so the grip neck and rail are not visibly
    # assembled from intersecting slabs. Preserve the sculpted grip's smooth faces.
    for piece in (frame,guard,rail):
        active(grip);mod=grip.modifiers.new('Continuous molded frame','BOOLEAN');mod.operation='UNION';mod.object=piece
        bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(piece,do_unlink=True)
    # Continue the molded side highlights across the union without moving the
    # surfaces used by the inspected finger contact or the rail datums.
    for face in grip.data.polygons:
        x,y,z=face.center
        if abs(x)>.007 and -.040<y<.026 and -.025<z<.028:
            face.use_smooth=True
    grip_marks=[]
    for sign in (-1,1):
        letters=bpy.data.curves.new('Grip maker mark','FONT');letters.body='SIG SAUER'
        letters.align_x='CENTER';letters.size=.0036;letters.resolution_u=4;letters.materials.append(cavity)
        mark_obj=bpy.data.objects.new('Mark | molded grip legend',letters);asset.objects.link(mark_obj)
        mark_obj.parent=body;mark_obj.location=(sign*.016,-.016,-.038)
        mark_obj.rotation_euler=Matrix(((0,0,sign),(sign,0,0),(0,1,0))).to_euler()
        grip_marks.append(mark_obj)
    grip.name='Frame | continuous Full-Size polymer shell'
    # Apply evaluated bevel geometry for source UVs and glTF; retain all named parts.
    weapon_meshes=[]
    for o in list(asset.objects):
        if o.type not in {'MESH','FONT'}:continue
        active(o);bpy.ops.object.convert(target='MESH');weapon_meshes.append(o)
        # Boolean cutter interiors inherit the assembly finish, not an empty
        # material slot that would have no active atlas bake target.
        for index, material in enumerate(o.data.materials):
            if material is None:o.data.materials[index]=o.data.materials[0]
    # Project flat vector marks onto their actual curved hosts for the atlas.
    def project(mark_obj,host):
        surface=BVHTree.FromPolygons([host.matrix_world@v.co for v in host.data.vertices],
                                     [tuple(p.vertices) for p in host.data.polygons])
        inverse=mark_obj.matrix_world.inverted()
        direction=(mark_obj.matrix_world.to_3x3()@Vector((0,0,1))).normalized()
        for vertex in mark_obj.data.vertices:
            point=mark_obj.matrix_world@vertex.co
            hit,normal,_,_=surface.ray_cast(point+direction*.01,-direction,.022)
            assert hit is not None, (mark_obj.name,'mark must sit on its host')
            vertex.co=inverse@(hit+normal*.00009)
        mark_obj['bake_projected_vertices']=len(mark_obj.data.vertices)
        mark_obj.data.update()
    project(label,shroud)
    project(engraving,hood)
    for mark_obj in grip_marks:project(mark_obj,grip)
    # The source is procedural; only the reduced surfaces need atlas UVs.
    return asset, coords, [rig,body,slide,barrel,trigger,catch,mag,spare,round_live,round_spare], weapon_meshes
