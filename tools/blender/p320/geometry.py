"""Reference-specific P320 assemblies, pivots, lettering and unique atlas UVs."""
import math
from pathlib import Path
import bpy
from mathutils import Vector, Matrix
from .materials import build_source_materials

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
    rig['subject'] = 'Early-production SIG P320 Nitron Compact | visual reconstruction'
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

    materials, (nitron, polymer, stipple, steel, barrel_mat, mag_mat, cavity, mark, brass, copper, white) = build_source_materials(coords)
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

    def text(label,loc,size,side=-1,parent=body,mat=mark,depth=0):
        d=bpy.data.curves.new(label,'FONT');d.body=label;d.size=size;d.extrude=depth;d.resolution_u=4
        if font: d.font=font
        o=bpy.data.objects.new('Mark | '+label,d);asset.objects.link(o);o.location=loc
        o.rotation_euler=Matrix(((0,0,side),(side,0,0),(0,1,0))).to_euler()
        o.parent=parent;o.matrix_parent_inverse=parent.matrix_world.inverted();d.materials.append(mat)
        return o
    font_path='/usr/share/fonts/dejavu-sans-fonts/DejaVuSansCondensed-Oblique.ttf'
    font=bpy.data.fonts.load(font_path) if Path(font_path).exists() else None

    # Slide: hollow underside, machined top chamfers, genuine recessed serrations.
    section=[(-.0134,.022),(-.0134,.042),(-.0094,.0497),(.0094,.0497),(.0134,.042),(.0134,.022)]
    verts=[(x,y-(.004 if y<0 and z<.04 else 0),z) for y in (-.039,.130) for x,z in section]
    n=len(section); faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    shroud=mesh('Slide | chamfered Nitron shell',verts,faces,nitron,slide,.0007)
    rounded_cut(shroud,(0,.036,.022),(.022,.165,.035),.0015)
    # Front face has independent barrel and guide rod openings, not a black decal.
    cut(shroud,cyl('CUT',(0,.127,.037),.00765,.017,None,None,'Y',64,0))
    cut(shroud,cyl('CUT',(0,.127,.025),.0044,.017,None,None,'Y',48,0))
    rounded_cut(shroud,(.009,.049,.045),(.023,.032,.021),.0010)
    for side in (-1,1):
        for group,start,count,pitch in [('rear',-.033,8,.0040),('front',.086,6,.0046)]:
            for i in range(count):
                y=start+i*pitch
                cutter=profile('CUT',[(y-.00085,.024),(y+.00085,.024),(y+.007+.00085,.0407),(y+.007-.00085,.0407)],.006,None,None,0,side*.0159)
                cut(shroud,cutter)
    # Rear slide cap set into a recessed rear face.
    rounded_cut(shroud,(0,-.0408,.033),(.016,.006,.018),.002)
    cap=box('Rear striker cover',(0,-.0411,.033),(.015,.0011,.017),steel,slide,.0013)
    cap.rotation_euler.x=-math.atan(.2)
    # Ejection-side external extractor, flush to the port edge.
    box('Extractor claw housing',(.0131,.028,.0395),(.0015,.018,.0058),steel,slide,.0005)
    cyl('Extractor pin cap',(.014,.021,.036),.0014,.0005,barrel_mat,slide)
    label=text('SIGSAUER  P320',(-.01338,.114,.0423),.0048,-1,slide,mark)
    label.rotation_euler=Matrix(((0,.46,-.888),(-1,0,0),(0,.888,.46))).to_euler()
    text('9mm x 19',(.0128,.050,.041),.0026,1,barrel,mark)

    # A continuously lofted grip, with a palm swell and rounded rectangular sections.
    # Each station: z, y centre, half fore/aft depth, half width.
    stations=[(-.079,-.023,.0245,.0148),(-.077,-.023,.0249,.0155),(-.070,-.022,.0250,.0159),
    (-.061,-.021,.0250,.0161),(-.052,-.019,.0251,.0160),(-.043,-.017,.0250,.0155),
    (-.034,-.014,.0245,.0148),(-.025,-.011,.0243,.0142),(-.017,-.008,.0245,.0135),
    (-.008,-.007,.025,.0132),(.001,-.008,.027,.013),(.010,-.010,.030,.0128),(.022,-.009,.034,.0128)]
    verts=[]; sides=64
    for z,y,ry,rx in stations:
        for i in range(sides):
            a=i*math.tau/sides
            # Rounded rectangle rather than an elliptical sausage.
            x=math.copysign(abs(math.cos(a))**.67,math.cos(a))*rx
            yy=y+math.copysign(abs(math.sin(a))**.67,math.sin(a))*ry
            verts.append((x,yy,z))
    faces=[]
    for k in range(len(stations)-1):
        for i in range(sides):faces.append((k*sides+i,k*sides+(i+1)%sides,(k+1)*sides+(i+1)%sides,(k+1)*sides+i))
    faces += [tuple(range(sides-1,-1,-1)),tuple((len(stations)-1)*sides+i for i in range(sides))]
    grip=mesh('Frame | sculpted compact medium grip',verts,faces,polymer,body,0,True)
    grip.data.materials.append(stipple)
    for p in grip.data.polygons:
        if len(p.vertices)!=4: continue
        z=sum(grip.data.vertices[i].co.z for i in p.vertices)/4
        y=sum(grip.data.vertices[i].co.y for i in p.vertices)/4
        x=sum(abs(grip.data.vertices[i].co.x) for i in p.vertices)/4
        top=-.020 if x>.013 else -.028
        if -.076<z<top and (x>.013 or y<-.036 or y>-.015):p.material_index=1
    # Real open magwell. Keep a molded rim rather than a sealed bottom.
    well=box('CUT',(0,-.019,-.063),(.022,.033,.075),None,None,0)
    well.rotation_euler.x=math.radians(-12)
    cut(grip,well)
    # Frame rails/dust cover define the characteristic upward dog-leg ahead of guard.
    # Trace the approved side silhouette in photographic proportions. This is a
    # visual reference transform, not a precision or functional firearm drawing.
    def silhouette(points):return [(.130-(x-136)*.000311,.050-(y-36)*.000311) for x,y in points]
    frame=profile('Frame | dust cover and rounded tang',silhouette([(139,117),(678,117),(686,133),(698,144),(720,148),(724,156),(706,165),(680,177),(658,194),(504,220),(484,177),(351,177),(329,154),(151,154)]),.0257,polymer,body,.0018)
    # Thin rounded guard follows the compact specimen, not a generic square hoop.
    guard=profile('Frame | integral trigger guard',silhouette([(323,174),(330,185),(334,210),(334,244),(333,266),(355,271),(431,274),(479,265),(511,241),(493,178)]),.0182,polymer,body,.0010,smooth=True)
    inner=profile('CUT',silhouette([(357,183),(420,180),(484,182),(494,208),(490,237),(458,254),(368,257),(348,243),(342,218),(344,198)]),.030,None,None,.0030,smooth=True)
    active(inner)
    for mod in list(inner.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
    cut(guard,inner)
    for z in [-.001,-.004,-.007,-.010,-.013]:
        rounded_cut(guard,(0,.0686,z),(.021,.0015,.0010),.0003)
    # Compact accessory rail: lower trapezoid and four slots.
    rail=profile('Frame | integral accessory rail',[(.069,.014),(.127,.014),(.127,.002),(.071,.002)],.021,polymer,body,.0005)
    for y in (.081,.093,.105,.117):rounded_cut(rail,(0,y,.0017),(.026,.0042,.006),.0003)
    for side in (-1,1):
        text('SIGSAUER',(side*.0161,-.004 if side==-1 else -.028,-.036),.0042,side,body,polymer,.00012)
        # Compact-medium molding under the dust cover, not a bright white label.
        text('COMPACT MEDIUM',(side*.01291,.111 if side==-1 else .073,.010),.0024,side,body,polymer,.00006)
    # Side controls. The magazine button is triangular, not the old circular button.
    profile('Magazine release | checkered face',[(-.003,-.012),(.007,-.018),(.005,-.023),(-.004,-.022)],.002,steel,body,.0007,-.014)
    for y in [-.001,.001,.003,.005]:
        box('Magazine release | ribs',(-.01515,y,-.018),(.0003,.00045,.0055),nitron,body,.0001)
    profile('Magazine release | reverse face',[(-.003,-.012),(.007,-.018),(.005,-.023),(-.004,-.022)],.0006,polymer,body,.0006,.0134)
    cyl('Takedown lever | spindle',(-.0138,.055,.017),.0066,.0018,steel)
    profile('Takedown lever | paddle',silhouette([(359,125),(376,117),(404,119),(444,120),(448,137),(400,140),(388,158),(375,161),(360,145)]),.003,steel,body,.0009,-.015)
    for z in [.019,.0203,.0216]:box('Takedown lever | traction',(-.0166,.039,z),(.00022,.012,.00035),nitron,body,.0001)
    cyl('Takedown | reverse pin',(.0131,.055,.017),.0051,.0006,steel)
    for side in (-1,1):
        profile('Ambidextrous slide catch', [(-.012,.024),(-.001,.024),(.001,.020),(-.003,.017),(-.011,.018)],.0025,steel,catch,.0006,side*.014)
        for z in [.019,.0205,.022]:box('Slide catch | serration',(side*.0154,-.006,z),(.0002,.007,.00035),nitron,catch,.00012)
    # Visible serialized chassis window; fictional serial, no real specimen copied.
    box('Serial window',(.0130,-.028,.009),(.0005,.025,.0042),cavity,body,.0004)
    text('P320  00015',(.01331,-.038,.0077),.0020,1,body,mark)

    # Moving barrel and guide rod are visible in both muzzle and open-slide poses.
    tube('Barrel | crowned muzzle',(0,.070,.037),.0068,.0044,.119)
    tube('Barrel | crown lip',(0,.1298,.037),.00685,.00465,.0010)
    box('Barrel | chamber hood',(0,.049,.041),(.019,.031,.013),barrel_mat,barrel,.0007)
    cyl('Guide rod | front cap',(0,.121,.025),.0036,.018,barrel_mat,body,'Y')
    cyl('Guide rod | exposed shaft',(0,.053,.025),.0022,.116,steel,body,'Y')
    # Original curved trigger: broad face at the top, thin tapered hooked tip.
    profile('Trigger | original curved blade',silhouette([(435,174),(469,174),(472,196),(470,219),(463,237),(452,250),(440,254),(425,254),(422,251),(436,238),(443,222),(445,204),(442,188)]),.0074,steel,trigger,.0007,smooth=True)

    # Straight stamped compact magazine, including flush floorplate and visible top.
    m=profile('Magazine | stamped body',[(-.032,-.075),(-.001,-.075),(.019,.005),(-.007,.005)],.0205,mag_mat,mag,.0014)
    for side in (-1,1):
        for z in [-.063,-.045,-.027]:
            y=-.009+(z+.065)*.22
            cut(m,cyl('CUT',(side*.0106,y,z),.0012,.004,None,None,'X',16,0))
            text(str({-.063:15,-.045:10,-.027:5}[z]),(side*.01035,y+.003*side,z-.001),.0020,side,mag,mark)
        # Shallow stamped longitudinal flutes, not floating ribs.
        for yy in (-.014,.003):
            c=box('CUT',(side*.0115,yy,-.038),(.003,.0028,.068),None,None,0)
            c.rotation_euler.x=math.radians(-14);cut(m,c)
    base=box('Magazine | flush polymer floorplate',(0,-.023,-.079),(.030,.047,.0048),polymer,mag,.0018)
    box('Magazine | lower floorplate seam',(0,-.023,-.0812),(.0285,.045,.0008),stipple,mag,.0010)
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
    rear=profile('Rear sight | square notch',[(-.037,.050),(-.027,.050),(-.028,.055),(-.034,.056)],.014,steel,slide,.00025)
    rounded_cut(rear,(0,-.032,.055),(.0037,.02,.0055),.00015)
    front=box('Front sight | blade',(0,.114,.0522),(.0037,.009,.005),steel,slide,.00035)
    tritium=bpy.data.materials.new('SIGLITE | tritium');tritium.use_nodes=True
    p=tritium.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.3,.65,.27,1)
    p.inputs['Emission Color'].default_value=(.035,.22,.025,1);p.inputs['Emission Strength'].default_value=.2
    p.inputs['Roughness'].default_value=.6
    for x,y,z,r in [(-.0048,-.0364,.0531,.0010),(.0048,-.0364,.0531,.0010),(0,.1094,.0528,.0011)]:
        cyl('SIGLITE | white annulus',(x,y,z),r,.00016,white,slide,'Y',32,0)
        cyl('SIGLITE | luminous inset',(x,y-.00010,z),r*.43,.0001,tritium,slide,'Y',24,0)
    # Sockets exported in game axes via glTF +Y-up conversion.
    for name,pos,parent in [('SOCKET_muzzle',(0,.131,.037),barrel),('SOCKET_ejection',(.015,.048,.042),slide),
                            ('SOCKET_sight',(0,-.033,.0537),rig)]:
        # Keep authored world coordinates under offset pivots.
        o=empty(name,parent=parent);o.matrix_parent_inverse=parent.matrix_world.inverted();o.location=pos

    # Union the molded frame pieces so the grip neck and rail are not visibly
    # assembled from intersecting slabs. Preserve the sculpted grip's smooth faces.
    for piece in (frame,guard,rail):
        active(grip);mod=grip.modifiers.new('Continuous molded frame','BOOLEAN');mod.operation='UNION';mod.object=piece
        bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(piece,do_unlink=True)
    grip.name='Frame | continuous compact medium polymer shell'
    # Apply evaluated bevel geometry for source UVs and glTF; retain all named parts.
    weapon_meshes=[]
    for o in list(asset.objects):
        if o.type not in {'MESH','FONT'}:continue
        active(o);bpy.ops.object.convert(target='MESH');weapon_meshes.append(o)
    # Conform molded grip lettering to the actual curved side, no hovering glyphs.
    from mathutils.bvhtree import BVHTree
    grip_surface=BVHTree.FromObject(grip,bpy.context.evaluated_depsgraph_get())
    for o in weapon_meshes:
        if not o.name.startswith('Mark | SIGSAUER') or o.parent!=body:continue
        inv=o.matrix_world.inverted();side=-1 if o.location.x<0 else 1
        for v in o.data.vertices:
            p=o.matrix_world@v.co
            hit,normal,_,_=grip_surface.ray_cast(Vector((side*.1,p.y,p.z)),Vector((-side,0,0)))
            if hit:v.co=inv@(hit+normal*.00009)
    # Small letters retain a constant physical material instead of consuming tiny
    # subpixel UV islands. This also prevents bake-padding bleeding into markings.
    letter_materials={}
    for o in weapon_meshes:
        if not o.name.startswith('Mark |'):continue
        source=o.data.materials[0]
        if source.name not in letter_materials:
            m=bpy.data.materials.new('Lettering | '+source.name);m.use_nodes=True
            p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=source.diffuse_color
            p.inputs['Roughness'].default_value=.65;p.inputs['Metallic'].default_value=.1
            letter_materials[source.name]=m
        o.data.materials.clear();o.data.materials.append(letter_materials[source.name])
    bake_meshes=[o for o in weapon_meshes if not o.name.startswith('Mark |') and o.data.materials[0]!=tritium]
    # Unique atlas across all weapon surfaces; density allocation follows area.
    active(bake_meshes[0])
    for o in bake_meshes:o.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(75),island_margin=.012)
    bpy.ops.object.mode_set(mode='OBJECT')

    return asset, coords, [rig,body,slide,barrel,trigger,catch,mag,spare,round_live,round_spare], weapon_meshes, materials, tritium
