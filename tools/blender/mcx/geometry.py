"""Named exterior assemblies. Dimensions in metres; +X forward, -Y ejection.

Edit the assembly function matching the part. Helpers and Blender state are
local to build_geometry; importing this module creates no scene objects.
"""
import math

import bpy
from mathutils import Vector
import numpy as np

def build_geometry(materials):
    asset = bpy.data.collections.new("MCX VIRTUS | authored components")
    bpy.context.scene.collection.children.link(asset)
    anodized = materials['anodized']
    edge = materials['edge']
    polymer = materials['polymer']
    rubber = materials['rubber']
    steel = materials['steel']
    ceramic = materials['ceramic']
    brass = materials['brass']
    copper = materials['copper']
    marking = materials['marking']
    red = materials['red']
    glass = materials['glass']
    fiber = materials['fiber']
    coating = materials['coating']

    def move_to(obj, collection=asset):
        for c in list(obj.users_collection):
            c.objects.unlink(obj)
        collection.objects.link(obj)
        return obj


    def active(obj):
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj


    def empty(name, loc=(0, 0, 0), parent=None):
        obj = bpy.data.objects.new(name, None)
        asset.objects.link(obj)
        obj.parent = parent
        obj.location = loc
        obj.empty_display_size = .018
        return obj


    rig = empty('MCX_RIG')
    rig['asset'] = 'SIG MCX VIRTUS / .300 BLK / reference-backed exterior'
    rig['forward'] = '+X in Blender; metres; right-side ejection is -Y'
    rig['hand_rig'] = 'Not included; grip sockets are provided'
    body = empty('receiver', parent=rig)
    mag = empty('magazine', parent=rig)
    spare = empty('magazine_spare', parent=rig)
    bolt = empty('bolt', parent=rig)
    handle = empty('charging_handle', parent=rig)
    trigger = empty('trigger', (-.071, 0, -.034), rig)
    cover = empty('dust_cover', (-.02, -.027, -.022), rig)
    stock = empty('stock_hinge', (-.183, .016, .007), rig)
    case = empty('spent_case', parent=rig)
    release = empty('bolt_release', (-.072, .027, -.045), rig)

    def finish(obj, name, mat, parent=body, bevel=.0006):
        obj.name = name
        move_to(obj)
        if mat:
            obj.data.materials.append(mat)
        # Shapes are authored in asset coordinates; keep world pose under each pivot.
        if parent:
            obj.parent = parent
            obj.matrix_parent_inverse = parent.matrix_world.inverted()
        if bevel:
            mod = obj.modifiers.new('Machined edge radius', 'BEVEL')
            mod.width = bevel; mod.segments = 2
            if mat == anodized:
                obj.data.materials.append(edge); mod.material = 1
            mod = obj.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
            mod.keep_sharp = True; mod.weight = 40
        return obj


    def box(name, loc, dims, mat=anodized, parent=body, bevel=.0006):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        obj = bpy.context.object
        obj.dimensions = dims
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        return finish(obj, name, mat, parent, bevel)


    def profile(name, points, width, mat=anodized, parent=body, bevel=.0008, y=0, rounded=False):
        # Outline extrusions are two-ring lofts; ordinary plates remain flat-shaded.
        rings = [[(x, y+s*width/2, z) for x, z in points] for s in (-1, 1)]
        return loft(name, rings, mat, parent, bevel, rounded)


    def loft(name, rings, mat, parent=body, bevel=.001, rounded=True):
        # Explicit cross-sections: continuous shoulders, not raised plate overlays.
        n = len(rings[0])
        verts = [point for ring in rings for point in ring]
        faces = [tuple(range(n-1, -1, -1)), tuple(range((len(rings)-1)*n, len(rings)*n))]
        faces += [(j*n+i, j*n+(i+1)%n, (j+1)*n+(i+1)%n, (j+1)*n+i)
                  for j in range(len(rings)-1) for i in range(n)]
        mesh = bpy.data.meshes.new(name); mesh.from_pydata(verts, [], faces); mesh.update()
        obj = bpy.data.objects.new(name, mesh); asset.objects.link(obj)
        active(obj); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
        for polygon in mesh.polygons: polygon.use_smooth = rounded and len(polygon.vertices) == 4
        finish(obj, name, mat, parent, bevel)
        if bevel and rounded:
            mod = obj.modifiers.get('Machined edge radius')
            mod.segments = 4; mod.harden_normals = True
        return obj


    def forging(name, sections):
        rings = []
        for x, bottom, top, w in sections:
            r = min(.007, (top-bottom)/3)
            yz = [(-w*.48,top),(w*.48,top),(w*.82,top-r*.5),(w,top-r*1.5),
                  (w,bottom+r),(w*.9,bottom+r*.25),(w*.7,bottom),
                  (-w*.7,bottom),(-w*.9,bottom+r*.25),(-w,bottom+r),
                  (-w,top-r*1.5),(-w*.82,top-r*.5)]
            rings.append([(x,y,z) for y,z in yz])
        return loft(name, rings, coating)


    def cylinder(name, loc, radius, depth, mat=steel, axis='X', parent=body, vertices=24, bevel=.00035):
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
        obj = bpy.context.object
        if axis == 'X': obj.rotation_euler[1] = math.pi/2
        if axis == 'Y': obj.rotation_euler[0] = math.pi/2
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
        for p in obj.data.polygons: p.use_smooth = len(p.vertices) == 4
        return finish(obj, name, mat, parent, bevel)


    def ellipsoid(name, loc, radii, mat, parent, segments=20, rings=10):
        # Explicit latitude rings keep face order stable across Blender processes.
        # The generated preview and exporter receive the same ordinary mesh.
        vertices = [(0, 0, radii[2])]
        for ring in range(1, rings):
            latitude = math.pi * ring / rings
            for column in range(segments):
                longitude = math.tau * column / segments
                vertices.append((
                    radii[0] * math.sin(latitude) * math.cos(longitude),
                    radii[1] * math.sin(latitude) * math.sin(longitude),
                    radii[2] * math.cos(latitude),
                ))
        bottom = len(vertices)
        vertices.append((0, 0, -radii[2]))
        faces = [(0, 1 + column, 1 + (column + 1) % segments)
                 for column in range(segments)]
        for ring in range(rings - 2):
            start = 1 + ring * segments
            for column in range(segments):
                a = start + column
                b = start + (column + 1) % segments
                faces.append((a, a + segments, b + segments, b))
        last = 1 + (rings - 2) * segments
        faces.extend((last + column, bottom, last + (column + 1) % segments)
                     for column in range(segments))
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        asset.objects.link(obj)
        obj.location = loc
        return finish(obj, name, mat, parent, bevel=0)

    def cut(obj, cutter):
        active(obj)
        mod = obj.modifiers.new('Actual opening', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'; mod.solver = 'EXACT'; mod.object = cutter
        # Apply boolean before the bevel, so opening rims also catch light.
        bpy.ops.object.modifier_move_up(modifier=mod.name)
        if len(obj.modifiers) > 1: bpy.ops.object.modifier_move_up(modifier=mod.name)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(cutter, do_unlink=True)


    def opening(obj, loc, dims, radius=.0018):
        cutter = box('CUT', loc, dims, None, None, 0)
        mod = cutter.modifiers.new('Rounded slot', 'BEVEL'); mod.width = radius; mod.segments = 4
        active(cutter); bpy.ops.object.modifier_apply(modifier=mod.name)
        cut(obj, cutter)


    def tube(name, loc, radius, inner, length, mat=steel, parent=body):
        obj = cylinder(name, loc, radius, length, mat, parent=parent, vertices=48)
        cut(obj, cylinder('CUT', loc, inner, length+.005, None, parent=None, vertices=48, bevel=0))
        return obj


    def cord(name, points, radius, mat):
        curve = bpy.data.curves.new(name, 'CURVE')
        curve.dimensions = '3D'; curve.resolution_u = 12
        curve.bevel_depth = radius; curve.bevel_resolution = 3; curve.use_fill_caps = True
        spline = curve.splines.new('BEZIER'); spline.bezier_points.add(len(points)-1)
        for point, co in zip(spline.bezier_points, points):
            point.co = co; point.handle_left_type = 'AUTO'; point.handle_right_type = 'AUTO'
        obj = bpy.data.objects.new(name, curve); asset.objects.link(obj)
        active(obj); bpy.ops.object.convert(target='MESH')
        return finish(obj, name, mat, bevel=0)


    def screw(x, y, z, radius=.0028, parent=body):
        cylinder('Recessed fastener seat', (x, y, z), radius*1.32, .0008, polymer, 'Y', parent)
        cap = cylinder('Torx-style fastener', (x, y*1.015, z), radius, .0012, steel, 'Y', parent)
        cut(cap, cylinder('CUT', (x, y*1.03, z), radius*.43, .006, None, 'Y', None, 6, 0))


    def text(label, loc, size=.006, side=-1, parent=body, mat=marking):
        curve = bpy.data.curves.new(label, 'FONT'); curve.body = label
        curve.size = size; curve.extrude = 0; curve.resolution_u = 3
        obj = bpy.data.objects.new('Mark | ' + label, curve); asset.objects.link(obj)
        obj.location = loc
        obj.rotation_euler = (math.pi/2, 0, 0) if side == -1 else (math.pi/2, 0, math.pi)
        curve.materials.append(mat)
        obj.parent = parent; obj.matrix_parent_inverse = parent.matrix_world.inverted()
        return obj

    def build_receiver():
        # Exterior profiles traced against the gray 9-inch VIRTUS SBR photographs.
        # Unpublished contours remain photo-inferred, not manufacturing dimensions.
        upper = forging('VIRTUS upper forging', [(-.178,-.008,.020,.019),
            (-.166,-.009,.034,.026),(-.146,-.010,.037,.0245),
            (.037,-.008,.037,.0245),(.052,-.008,.024,.0245)])
        opening(upper, (-.006,-.022,.013), (.085,.024,.020), .0035)
        box('Port interior shadow', (-.006,.001,.013), (.089,.008,.021), rubber)
        for side in (-1,1):
            screw(.036, side*.022, -.017, .0033)
            screw(-.150, side*.021, -.012, .0042)
        # Steel carrier, dust cover and rear deflector on the ejection side only.
        cylinder('Bolt carrier visible through port', (-.005,-.010,.013), .0105, .099, steel, parent=bolt)
        box('Carrier extraction recess', (.004,-.021,.015), (.018,.001,.009), polymer, bolt, .001)
        plate = box('Dust cover plate', (-.006,-.0335,-.005), (.087,.020,.002), coating, cover, .0007)
        plate.rotation_euler.x = math.pi/6
        cylinder('Dust cover hinge', (-.006,-.0235,0), .0017, .092, steel, parent=cover)
        for x in (-.035,.027):
            rib = box('Dust cover rib', (x,-.0335,-.0063), (.0016,.016,.0012), coating, cover)
            rib.rotation_euler.x = math.pi/6
        profile('Brass deflector', [(-.057,-.006),(-.048,.002),(-.050,.025),(-.062,.027),(-.069,.019),(-.069,.001)], .011, coating, y=-.0275, bevel=.002)
        cylinder('Forward assist housing', (-.094,-.030,.013), .007, .026, coating)
        cylinder('Forward assist button', (-.110,-.030,.013), .0075, .006, steel)
        for z in (.010,.013,.016): box('Forward assist serration',(-.1135,-.030,z),(.0006,.011,.0007),polymer,bevel=.0001)
        # Lower shoulders, rounded rear grip transition and narrower magazine well.
        forging('Ambidextrous lower receiver', [(-.169,-.020,-.006,.019),
            (-.150,-.032,-.008,.021),(-.125,-.042,-.009,.021),
            (-.093,-.042,-.009,.021),(-.075,-.040,-.009,.021),
            (-.035,-.042,-.008,.021),(.037,-.044,-.007,.022)])
        magwell = profile('Flared magazine well', [(-.035,-.017),(.037,-.011),
            (.037,-.058),(.039,-.061),(-.031,-.075),(-.035,-.072)], .050, coating, bevel=.003, rounded=True)
        opening(magwell, (.003,0,-.065), (.061,.029,.040), .002)
        profile('Magazine well lip', [(-.032,-.071),(.037,-.057),(.041,-.062),(-.033,-.078)], .053, coating, bevel=.001)
        guard = profile('Sculpted trigger guard', [(-.095,-.041),(-.031,-.040),
            (-.034,-.065),(-.045,-.075),(-.051,-.078),(-.069,-.079),
            (-.087,-.073),(-.098,-.065)], .015, coating, bevel=.002, rounded=True)
        opening(guard, (-.065,0,-.056), (.056,.030,.034), .013)
        # A continuous, rounded blade, with its head embedded in the receiver.
        # Offset a sampled Bezier centreline instead of beveling a six-corner polygon.
        # The finger-facing concavity opens toward the muzzle (+X), not the grip.
        control = [Vector(p) for p in [(-.072,-.035),(-.086,-.050),(-.087,-.060),(-.074,-.068)]]
        front, back_edge = [], []
        for i in range(25):
            t = i/24; u = 1-t
            centre = u**3*control[0] + 3*u*u*t*control[1] + 3*u*t*t*control[2] + t**3*control[3]
            tangent = 3*u*u*(control[1]-control[0]) + 6*u*t*(control[2]-control[1]) + 3*t*t*(control[3]-control[2])
            normal = Vector((-tangent.y, tangent.x)).normalized() * .0021
            front.append(tuple(centre+normal)); back_edge.append(tuple(centre-normal))
        profile('Curved trigger blade', front + back_edge[::-1], .007, steel, trigger, .0007)
        cylinder('Trigger axle', (-.071,0,-.034), .0035, .012, steel, 'Y', trigger)
        for side in (-1,1):
            screw(-.123,side*.021,-.018,.0031)
            screw(-.074,side*.021,-.032,.0021)
            cylinder('Selector hub', (-.107,side*.021,-.028), .006,.003,steel,'Y')
            profile('Ambidextrous selector paddle', [(-.111,-.023),(-.099,-.024),(-.094,-.030),(-.098,-.034),(-.111,-.032)], .004, steel, y=side*.022, bevel=.001)
            cylinder('Selector fire index', (-.097,side*.021,-.017), .001,.0005,red,'Y',vertices=12)
            text('S',(-.124 if side==-1 else -.119,side*.021,-.021),.003,side)
            text('F',(-.099 if side==-1 else -.096,side*.021,-.017),.003,side)
        # Manufacturer/address text is only on the documented non-ejection side.
        text('SIG SAUER INC.',(-.065,.021,-.031),.0031,1)
        text('EXETER-NH-USA',(-.065,.021,-.035),.0024,1)
        text('SIG SAUER',(.028,.0252,-.054),.004,1)
        profile('Magazine release fence', [(-.049,-.027),(-.039,-.025),(-.029,-.029),
            (-.029,-.044),(-.043,-.053),(-.049,-.047)], .004, coating, y=-.021, bevel=.002)
        box('Magazine release button', (-.039,-.024,-.036), (.007,.003,.016), steel, bevel=.0015)
        for z in np.linspace(-.041,-.031,5): box('Release grip serration',(-.039,-.026,float(z)),(.005,.001,.0006),polymer,bevel=.0001)
        box('Bolt release paddle', (-.057,.024,-.031), (.011,.005,.016), steel, release, .0015)
        # Molded grip: a narrow web expands into a rounded-rectangle palm section.
        # Side-view station coordinates are photo-inferred, not a scanned grip.
        grip_sections = [(-.026,-.149,-.126,.012),(-.035,-.142,-.103,.013),
            (-.043,-.136,-.096,.0135),(-.051,-.134,-.096,.014),
            (-.060,-.139,-.096,.0145),(-.075,-.147,-.101,.016),
            (-.085,-.152,-.109,.017),(-.110,-.163,-.116,.017),
            (-.129,-.170,-.122,.017),(-.139,-.174,-.126,.0165)]
        rings = []
        for j,(z,back,front,w) in enumerate(grip_sections):
            r = .005; ring = []
            for cx,cy,start in [(front-r,w-r,0),(back+r,w-r,90),
                                (back+r,-w+r,180),(front-r,-w+r,270)]:
                for i in range(5):
                    a = math.radians(start+i*22.5)
                    x = cx+r*math.cos(a); y = cy+r*math.sin(a)
                    heel = -.32*(x-(back+front)/2) if j == len(grip_sections)-1 else 0
                    ring.append((x,y,z+heel))
            rings.append(ring)
        grip = loft('Ergonomic pistol grip', rings, polymer, bevel=.0007)
        for side in (-1,1):
            panel = [(-.138,-.075),(-.108,-.081),(-.130,-.136),(-.162,-.126),(-.149,-.090)]
            cut(grip,profile('CUT',panel,.0024,None,None,.001,y=side*.0172))
            profile('Grip inset stipple panel',panel,.0004,rubber,bevel=.0005,y=side*.0162)
            text('SIG SAUER',(-.127 if side==-1 else -.105,side*.0145,-.058),.0033,side,mat=polymer)
        for i in range(11):
            z=-.081-i*.0047; x=-.106-i*.00195
            box('Grip front traction rib',(x,0,z),(.0012,.024,.0010),rubber,bevel=.0003)
        profile('Grip floor plate',[(-.173,-.130),(-.126,-.144),(-.125,-.147),(-.175,-.133)],.034,rubber,bevel=.0008)

    def build_handguard():
        # Handguard is a hollow octagonal extrusion, not black decals on a box.
        # Build the shell along X from octagonal Y/Z rings.
        # 8-inch PDW exterior, including its rear receiver overlap. Width/section are
        # inferred from photographs; 203.2 mm is the catalog's nominal length.
        ring = [(-.015,.034),(.015,.034),(.026,.019),(.026,-.019),(.017,-.033),(-.017,-.033),(-.026,-.019),(-.026,.019)]
        verts = [(x,y,z) for x in (.045,.2482) for y,z in ring]
        faces = [(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)]
        mesh = bpy.data.meshes.new('Handguard shell'); mesh.from_pydata(verts,[],faces);mesh.update()
        obj = bpy.data.objects.new('Hollow octagonal VIRTUS handguard',mesh);asset.objects.link(obj)
        active(obj);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
        solid = obj.modifiers.new('Wall thickness','SOLIDIFY');solid.thickness=.0022
        bpy.ops.object.modifier_apply(modifier=solid.name)
        handguard = finish(obj,obj.name,coating,bevel=.0008)
        # Four side M-LOK lands: a short rear land followed by three full slots.
        for x,length in [(.095,.012),(.126,.032),(.169,.032),(.212,.032)]:
            opening(handguard,(x,0,-.006),(length,.072,.009),.003)
        # Nonuniform upper vents and the distinctive diagonal lower openings.
        for points in [[(.086,.017),(.092,.024),(.108,.024),(.102,.017)],[(.111,.017),(.117,.024),(.133,.024),(.127,.017)],[(.157,.025),(.168,.033),(.191,.033),(.187,.023),(.163,.023)],[(.207,.020),(.210,.030),(.239,.030),(.239,.020)]]:
            cut(handguard,profile('CUT',points,.072,None,None,.001))
        for x in (.096,.125,.154,.183,.212,.238):
            cut(handguard,profile('CUT',[(x-.014,-.017),(x-.005,-.017),(x+.009,-.030),(x-.005,-.030)],.072,None,None,.0015))
        for x in (.100,.140,.180,.220):
            opening(handguard,(x,0,-.032),(.028,.014,.018),.002)
        for side in (-1,1):
            tube_obj = cylinder('QD sling socket',(.067,side*.027,-.004),.0065,.003,steel,'Y')
            cut(tube_obj,cylinder('CUT',(.067,side*.027,-.004),.0044,.008,None,'Y',None,24,0))
        # Barrel/gas exterior silhouettes only. The accessory is not a functional model.
        cylinder('Barrel under vented guard',(.1643,0,0),.0087,.2286,steel)
        cylinder('Gas system silhouette',(.146,0,.022),.0036,.168,steel)
        box('Gas block silhouette',(.233,0,.006),(.014,.023,.029),steel)
        # Rail pitches/land shapes are visual reference details, not machinable rail data.
        profile('Continuous top rail foot',[(-.17,.035),(.247,.035),(.247,.041),(-.17,.041)],.022,coating)
        for i in range(42):
            x=-.168+i*.010
            profile('Picatinny rail tooth',[(x,.040),(x+.0012,.046),(x+.006,.046),(x+.0072,.040)],.027,coating,bevel=.00035)
        for x in (-.15,.232):
            box('Folded backup sight base',(x,0,.049),(.030,.030,.007),steel)
            cylinder('Backup sight hinge',(x+.004,0,.055),.006,.034,steel,'Y')
            box('Folded backup sight leaf',(x-.006,0,.056),(.019,.014,.004),polymer)
            for side in (-1,1): screw(x+.004,side*.018,.055,.003)

    def build_optic():
        # TA31F/TA51 exterior from Trijicon's side/top/oblique product photographs.
        # 151.89 mm optic length; width includes the windage cap. Our height check
        # uses optic/foot, excluding TA51 shoe/knobs; Trijicon's exact datum is unverified.
        body['optic'] = 'ACOG 4x32 (TA31F / TA51)'
        # Seat the shoe into the foot and rail by 0.1 mm at each interface. Its
        # unpublished height is fit-inferred; optic envelope and sight axis stay fixed.
        box('ACOG rail shoe',(-.081,0,.0530),(.096,.030,.0142),anodized,bevel=.0008)
        profile('ACOG integral mounting foot',[(-.128,.060),(-.026,.060),(-.026,.064),(-.039,.069),(-.047,.075),(-.096,.076),(-.109,.065),(-.127,.064)],.023,anodized,bevel=.001)
        for side in (-1,1):
            box('ACOG rail clamp',(-.081,side*.016,.051),(.094,.004,.009),anodized,bevel=.0008)
        for x in (-.113,-.049):
            cylinder('ACOG mount crossbolt',(x,0,.051),.0027,.042,steel,'Y')
            knob = cylinder('ACOG slotted thumbscrew',(x,.0225,.051),.0078,.0055,anodized,'Y',vertices=48)
            opening(knob,(x,.026,.051),(.011,.003,.0016),.0003)
            for i in range(24):
                a=i*math.tau/24
                cylinder('ACOG thumbscrew knurl',(x+math.cos(a)*.0074,.0225,.051+math.sin(a)*.0074),.00035,.0038,anodized,'Y',vertices=6,bevel=0)
        # Hollow forged housing: varying oval sections and swept front hood. The
        # front bell has a tall outer shoulder, unlike a rotationally symmetric cone.
        sections=[(-.129,.0168,.0168,0),(-.117,.0175,.017,0),(-.103,.0175,.018,0),(-.092,.018,.020,0),(-.071,.0185,.0205,0),(-.045,.0215,.0255,0),(-.017,.022,.0265,0),(-.00511,.022,.0265,.006)]
        segments=48; count=len(sections); verts=[]
        for wall in (0,.002):
            for x,ry,rz,skew in sections:
                for i in range(segments):
                    a=i*math.tau/segments
                    verts.append((x+math.sin(a)*skew,math.cos(a)*(ry-wall),.087+math.sin(a)*(rz-wall)))
        faces=[]
        for wall in range(2):
            offset=wall*count*segments
            for j in range(count-1):
                for i in range(segments):
                    a=offset+j*segments+i; b=offset+j*segments+(i+1)%segments
                    face=(a,b,b+segments,a+segments)
                    faces.append(face if wall==0 else face[::-1])
        for j in (0,count-1):
            for i in range(segments):
                a=j*segments+i; b=j*segments+(i+1)%segments
                faces.append((a,a+count*segments,b+count*segments,b))
        mesh=bpy.data.meshes.new('ACOG hollow forging');mesh.from_pydata(verts,[],faces);mesh.update()
        obj=bpy.data.objects.new('ACOG tapered prism housing',mesh);asset.objects.link(obj)
        active(obj);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
        for p in mesh.polygons: p.use_smooth=True
        finish(obj,obj.name,anodized,bevel=.00045)
        # Short ocular and 32 mm objective behind the slanted protective hood.
        tube('ACOG ocular',(-.139,0,.087),.0168,.0138,.022,anodized)
        tube('ACOG ocular rubber rim',(-.148,0,.087),.0177,.0138,.006,rubber)
        tube('ACOG objective retaining ring',(-.011,0,.087),.0183,.016,.003,anodized)
        for x,r in [(-.149,.0137),(-.013,.016)]:
            cylinder('ACOG coated optical glass',(x,0,.087),r,.0007,glass,vertices=48,bevel=0)
        # The lateral forging ridge and ocular collar break up the top-view silhouette.
        for side in (-1,1):
            profile('ACOG prism side facet',[(-.114,.080),(-.093,.070),(-.045,.068),(-.020,.072),(-.013,.085),(-.035,.106),(-.073,.109),(-.092,.097)],.0024,anodized,bevel=.001,y=side*.017)
            for z in (.073,.101):
                box('ACOG ocular collar lug',(-.126,side*.013,z),(.012,.010,.006),anodized,bevel=.001)
                screw(-.126,side*.019,z,.0018)
        cylinder('ACOG elevation boss',(-.099,0,.107),.0083,.012,anodized,'Z')
        cylinder('ACOG elevation cap',(-.099,0,.11542),.0092,.006,anodized,'Z',vertices=48)
        cylinder('ACOG windage boss',(-.099,-.021,.087),.0079,.010,anodized,'Y')
        cylinder('ACOG windage cap',(-.099,-.0273,.087),.0087,.003,anodized,'Y',vertices=48)
        # The small prism access cover is on the opposite side from the windage knob.
        cylinder('ACOG prism access boss',(-.104,.0178,.087),.0058,.006,anodized,'Y')
        cylinder('ACOG prism access cover',(-.104,.0212,.087),.006,.0016,anodized,'Y',vertices=32)
        for i in range(32):
            a=i*math.tau/32
            cylinder('ACOG elevation knurl',(-.099+math.cos(a)*.0088,math.sin(a)*.0088,.11542),.0003,.0045,anodized,'Z',vertices=6,bevel=0)
            cylinder('ACOG windage knurl',(-.099+math.cos(a)*.0083,-.0273,.087+math.sin(a)*.0083),.0003,.002,anodized,'Y',vertices=6,bevel=0)
        # Clear protective collector cover and a thin internal red fiber, with a
        # diagonal cradle running from the adjustment shoulder to the objective hood.
        profile('ACOG collector cradle',[(-.090,.101),(-.080,.104),(-.037,.109),(-.007,.112),(-.005,.114),(-.036,.113),(-.080,.108),(-.091,.105)],.007,anodized,bevel=.0006)
        collector=[(-.088,0,.106),(-.077,0,.108),(-.040,0,.113),(-.010,0,.115)]
        cord('ACOG collector cover',collector,.002,glass)
        cord('ACOG red fiber collector',collector,.0011,fiber)
        cord('ACOG cap retaining tether',[(-.098,-.006,.114),(-.115,-.011,.106),(-.115,-.025,.094),(-.099,-.027,.091)],.00035,polymer)
        text('Trijicon',(-.056,-.0228,.084),.0032)
        text('ACOG',(-.052,-.0228,.079),.0032)
        text('MADE IN USA',(-.054,-.0117,.063),.0019)
        text('Trijicon',(-.026,.022,.086),.003,1)

    def build_suppressor():
        # SRD762Ti direct-thread exterior: 236 mm overall / 44 mm diameter.
        # Subtle circumferential seams, no invented cooling flutes or QD locking rings.
        mount = cylinder('Suppressor mount',(.282,0,0),.013,.016,ceramic,vertices=48)
        for side in (-1,1):
            opening(mount,(.280,side*.015,0),(.012,.008,.030),.0004)
        profile_rings=[(.288,.013),(.290,.0205),(.294,.022),(.326,.022),(.328,.0215)]
        for x in (.345,.369,.393,.417,.441,.465,.489):
            profile_rings.extend([(x-.0005,.0215),(x,.02165),(x+.0005,.0215)])
        profile_rings.extend([(.504,.0215),(.508,.0208)])
        verts=[(x,math.cos(i*math.tau/64)*r,math.sin(i*math.tau/64)*r) for x,r in profile_rings for i in range(64)]
        faces=[(j*64+i,j*64+(i+1)%64,(j+1)*64+(i+1)%64,(j+1)*64+i) for j in range(len(profile_rings)-1) for i in range(64)]
        mesh=bpy.data.meshes.new('SRD762Ti exterior');mesh.from_pydata(verts,[],faces);mesh.update()
        obj=bpy.data.objects.new('Suppressor body',mesh);asset.objects.link(obj)
        for polygon in mesh.polygons: polygon.use_smooth=True
        finish(obj,obj.name,ceramic,bevel=0)
        tube('Recessed suppressor endcap',(.508,0,0),.0208,.0047,.004,ceramic)
        cylinder('Muzzle interior shadow',(.502,0,0),.0048,.001,rubber,bevel=0)
        text('SIG SAUER',(.302,-.0222,.003),.0028)
        text('SRD762Ti',(.302,-.0222,-.001),.0028)

    def build_charging_handle():
        # OEM KIT-MCX-CHARGE-HANDLE-SM: swept rear bow, separate hooked small
        # latches and pivot pins. Exterior inferred from SIG/installed-VIRTUS photos.
        # It remains one rigid animation group; latch articulation is not introduced.
        # Hidden forward length keeps the exposed stem supported at full 75 mm rack.
        box('Charging handle stem',(-.1225,0,.031),(.140,.013,.007),anodized,handle)
        angles = [math.pi*(i/16-.5) for i in range(17)]
        bow = [(-.169-.026*math.cos(a),.025*math.sin(a)) for a in angles]
        bow += [(-.169-.015*math.cos(a),.017*math.sin(a)) for a in reversed(angles)]
        obj = profile('Ambidextrous charging handle',bow,.008,anodized,handle,.001,rounded=True)
        obj.rotation_euler.x = -math.pi/2; obj.location.z = .031
        for side in (-1,1):
            points = [(x,side*y) for x,y in [(-.170,.018),(-.163,.023),(-.174,.027),
                (-.179,.035),(-.189,.035),(-.193,.030),(-.186,.030),(-.182,.023)]]
            obj = profile('Charging latch',points,.009,anodized,handle,.001)
            obj.rotation_euler.x = -math.pi/2; obj.location.z = .030
            cylinder('Charging latch pivot',(-.175,side*.021,.0355),.0013,.0007,steel,'Z',handle,12,0)
            for i in range(6): box('Latch serration',(-.190+i*.0018,side*.035,.030),(.0007,.001,.007),polymer,handle,.0001)
        # Factory VIRTUS folding/telescoping stock, with its molded butt body and
        # exposed straight adjustment spine (not a minimalist two-strut skeleton).

    def build_stock():
        box('Rear 1913 interface',(-.181,0,-.005),(.014,.030,.063),steel)
        # Reference-informed upper shoulder sits below the handle, not through its
        # bow/latch path. Preserve the lower end (-23 mm) and the stock fold pivot.
        # No published hinge drawing: these are exterior fit coordinates, not SIG specs.
        hinge_bottom, hinge_shoulder = -.023, .0195
        cylinder('Stock folding knuckle',(-.183,.016,(hinge_bottom+hinge_shoulder)/2),
                 .0085,hinge_shoulder-hinge_bottom,steel,'Z',stock)
        cylinder('Folding hinge cap',(-.183,.016,hinge_shoulder+.002),.009,.004,anodized,'Z',stock)
        # Seat the spine's front end into the knuckle; the old -191 mm end floated
        # beside the offset hinge axis. Rear stock length and fold pivot are unchanged.
        profile('Stock upper spine',[(-.184,.019),(-.365,.019),(-.369,-.008),(-.184,-.008)],.022,anodized,stock,.0012)
        for side in (-1,1):
            box('Stock spine inset',(-.252,side*.0115,.0045),(.104,.001,.014),polymer,stock,.001)
        stock_body=profile('Stock butt frame',[(-.304,.028),(-.424,.028),(-.434,.019),(-.434,-.104),(-.419,-.116),(-.404,-.103),(-.379,-.054),(-.327,-.048),(-.304,-.015)],.037,polymer,stock,.0025)
        cut(stock_body,profile('CUT',[(-.415,-.088),(-.394,-.042),(-.380,-.041),(-.405,-.092)],.052,None,None,.002))
        for side in (-1,1):
            profile('Stock molded side panel',[(-.320,.012),(-.419,.012),(-.422,-.025),(-.395,-.028),(-.383,-.047),(-.329,-.039)],.0011,polymer,stock,.0012,y=side*.019)
            for x in (-.341,-.395):
                opening(stock_body,(x,side*.020,.012),(.022,.006,.004),.0015)
            profile('Stock stipple panel',[(-.418,-.036),(-.397,-.036),(-.417,-.087),(-.424,-.094)],.001,rubber,stock,.001,y=side*.019)
        profile('Rubber recoil pad',[(-.432,.024),(-.442,.024),(-.444,-.107),(-.431,-.117),(-.425,-.106)],.040,rubber,stock,.002)
        for i in range(17):
            box('Butt pad traction rib',(-.443,0,.015-i*.007),(.0017,.036,.0013),rubber,stock,.0004)
        # Latch locks into the spine and remains supported in the folded showcase.
        profile('Length adjustment latch',[(-.347,-.004),(-.316,-.004),(-.316,-.017),(-.340,-.026),(-.349,-.020)],.022,polymer,stock,.0012)
        for i in range(8):
            box('Stock latch serration',(-.344+i*.003,0,-.020),(.001,.023,.0014),rubber,stock,.0002)
        for side in (-1,1):
            socket = cylinder('Stock sling socket',(-.419,side*.021,-.008),.0065,.003,steel,'Y',stock)
            cut(socket,cylinder('CUT',(-.419,side*.021,-.008),.0042,.008,None,'Y',None,24,0))
            screw(-.199,side*.015,-.007,.003,stock)
            text('SIG SAUER',(-.421 if side==-1 else -.397,side*.020,-.027),.0035,side,stock,mat=polymer)

    def build_magazines():
        # MAG800 .300 BLK GEN M3: smooth upper side, large lower panels, front/back
        # traction ribs and a paint-pen matrix. Do not reuse the 5.56 magazine lattice.
        mag_points=[(-.014,-.070),(.046,-.070),(.047,-.127),(.051,-.163),(.058,-.200),(.069,-.239),(.009,-.258),(-.002,-.218),(-.010,-.169)]
        mag_shell=profile('Curved .300 magazine shell',mag_points,.025,polymer,mag,.0015)
        profile('Magazine base plate',[(.008,-.253),(.070,-.235),(.074,-.245),(.009,-.264),(.004,-.260)],.029,polymer,mag,.001)
        for side in (-1,1):
            # Shallow molded relief, not a raised black slab over the whole side.
            for points in [[(-.006,-.139),(.012,-.139),(.018,-.197),(.007,-.201)],[(.020,-.139),(.041,-.139),(.051,-.194),(.026,-.201)]]:
                cut(mag_shell,profile('CUT',points,.0024,None,None,.001,y=side*.0127))
            profile('Magazine shoulder rib',[(-.012,-.131),(.046,-.130),(.047,-.135),(-.011,-.137)],.0012,polymer,mag,.0005,y=side*.0128)
            text('300 BLK',(.015 if side==-1 else .055,side*.0127,-.217),.0038,side,mag,mat=polymer)
            # Small dots are individually visible on inspect; four-face marks suffice.
            for row in range(4):
                for col in range(6):
                    box('Magazine paint-pen dot',(.020+col*.004+row*.0008,side*.0128,-.228-row*.004),(.0018,.0005,.0018),rubber,mag,0)
        for i in range(9):
            z=-.142-i*.010; shift=max(0,-z-.150)*.17
            for x in (-.009+shift,.048+shift):
                box('Magazine edge traction rib',(x,0,z),(.0022,.024,.003),polymer,mag,.0006)
        # Molded seam and over-insertion shoulders in the smooth upper region.
        for x in (-.010,.042):
            box('Magazine upper shoulder',(x,0,-.116),(.005,.027,.004),polymer,mag,.0005)
        # Brass cartridge detail at the feed lips (aesthetic only).
        for y in (-.006,.006):
            cylinder('Top round brass',(.019,y,-.073),.0047,.032,brass,parent=mag,vertices=24)
            ellipsoid('Top round copper', (.04, y, -.073), (.012, .0039, .0039), copper, mag)
        # Complete magazine length convention: longer side of the minimum-area X/Z
        # envelope, including the floorplate, excluding cartridges. The unscaled
        # evaluated exterior is 195.083136 mm. Magpul gives 7.5 in but no datum drawing;
        # this conservative 190.5 mm envelope is explicit, not certified metrology.
        mag_scale = 190.5 / 195.083136
        mag_shell['length_datum'] = 'Minimum-area side envelope, floorplate included, cartridges excluded'
        mag_shell['length_target_mm'] = 190.5
        for obj in list(asset.objects):
            if obj.parent == mag and obj.type in {'MESH','FONT'}:
                obj.location *= mag_scale; obj.scale *= mag_scale
                obj.location.x -= .012; obj.location.z += .040
        # Duplicate magazine geometry for replacement/retention animation.
        bpy.context.view_layer.update()
        for obj in list(asset.objects):
            if obj.parent == mag:
                clone=obj.copy();clone.data=obj.data.copy();asset.objects.link(clone)
                clone.name=obj.name+' | spare';clone.parent=spare

    def build_casing():
        # Spent casing: bottle-neck silhouette, open neck, extractor groove and primer.
        # Mesh is stylized visual geometry, intentionally not dimensioned cartridge data.
        profile_rings=[(-.019,.0048),(-.0175,.0048),(-.017,.0042),(-.015,.0042),(-.014,.0047),(.009,.0045),(.013,.0037),(.018,.0037)]
        verts=[]
        for x,r in profile_rings:
            verts.extend((x,math.cos(i*math.tau/32)*r,math.sin(i*math.tau/32)*r) for i in range(32))
        faces=[]
        for j in range(len(profile_rings)-1):
            faces.extend((j*32+i,j*32+(i+1)%32,(j+1)*32+(i+1)%32,(j+1)*32+i) for i in range(32))
        faces.append(tuple(range(31,-1,-1)))
        mesh=bpy.data.meshes.new('Spent brass mesh');mesh.from_pydata(verts,[],faces);mesh.update()
        obj=bpy.data.objects.new('Ejected bottle-neck brass',mesh);asset.objects.link(obj)
        finish(obj,obj.name,brass,case,.0001)
        for p in mesh.polygons: p.use_smooth=len(p.vertices)==4
        cylinder('Spent primer',(-.0191,0,0),.0018,.0003,copper,parent=case,vertices=24,bevel=0)
        tube('Casing open neck',(.017,0,0),.0037,.0031,.002,brass,case)
        cylinder('Case interior shadow',(.012,0,0),.0031,.0003,rubber,parent=case,vertices=24,bevel=0)

    bpy.context.view_layer.update()
    build_receiver()
    build_handguard()
    build_optic()
    build_suppressor()
    build_charging_handle()
    build_stock()
    build_magazines()
    build_casing()

    # Named attachment / integration sockets; adapter hand contacts follow the fit.
    for name,loc,parent in [('SOCKET_muzzle',(.512,0,0),rig),('SOCKET_ejection',(-.018,-.030,.004),rig),('SOCKET_grip_R',(-.139,0,-.099),rig),('SOCKET_grip_L',(.171,0,-.028),rig),('SOCKET_magazine',(.004,0,-.042),mag),('SOCKET_sight',(-.149,0,.087),rig)]:
        empty(name,loc,parent)

    return asset, [rig, mag, spare, bolt, handle, trigger, cover, stock, case, release]
