"""Named exterior assemblies. Dimensions in metres; +X forward, -Y ejection.

Edit the assembly function matching the part. Helpers and Blender state are
local to build_geometry; importing this module creates no scene objects.
"""
import math

import bpy
from mathutils import Matrix, Vector
import numpy as np
from mcx.primitives import create_primitives
import picatinny

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
    trigger = empty('trigger', (-.065, 0, -.034), rig)
    cover = empty('dust_cover', (-.02, -.027, -.022), rig)
    stock = empty('stock_hinge', (-.183, .016, .007), rig)
    case = empty('spent_case', parent=rig)
    release = empty('bolt_release', (-.072, .027, -.045), rig)
    irons = empty('IRON_sights', parent=body)
    folded = empty('IRON_sights_removed', parent=body)
    muzzle = empty('MUZZLE_device', parent=body)

    active, finish, box, profile, loft, forging, cylinder, ellipsoid, cut, opening, tube, cord, screw, text = create_primitives(asset, body, materials)

    def build_receiver():
        # Exterior profiles traced against the gray 9-inch VIRTUS SBR photographs.
        # Unpublished contours remain photo-inferred, not manufacturing dimensions.
        upper = forging('VIRTUS upper forging', [(-.178,-.008,.020,.019),
            (-.166,-.009,.034,.026),(-.146,-.010,.037,.0245),
            (.037,-.008,.037,.0245),(.078,-.008,.034,.0245)])
        # The nose meets the guard's diagonal rear shoulder at every height;
        # a square extension would leave a raised ledge across that seam.
        for vertex in upper.data.vertices:
            if vertex.co.x > .077:
                vertex.co.x = .045 + .033*max(0,min(1,(vertex.co.z-.010)/.024))
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
        forging('Ambidextrous lower receiver', [(-.178,-.012,-.004,.018),
            (-.165,-.024,-.005,.0195),(-.148,-.033,-.007,.021),(-.125,-.044,-.008,.021),
            (-.093,-.046,-.009,.021),(-.075,-.046,-.009,.021),
            (-.035,-.044,-.008,.021),(.037,-.044,-.007,.022)])
        magwell = profile('Flared magazine well', [(-.041,-.016),(.036,-.011),
            (.036,-.056),(.038,-.061),(-.035,-.072),(-.040,-.069)], .050, coating, bevel=.003, rounded=True)
        lip = profile('Magazine well lip', [(-.035,-.067),(.036,-.055),(.039,-.061),(-.037,-.075)], .053, coating, bevel=.001)
        for part in (magwell, lip):
            opening(part, (.0005,0,-.055), (.067,.029,.070), .002)
        # Carry the lower band into the front attachment with a rounded shoulder.
        guard = profile('Sculpted trigger guard', [(-.097,-.040),(-.031,-.040),
            (-.034,-.064),(-.037,-.071),(-.046,-.078),(-.056,-.081),(-.067,-.082),
            (-.082,-.076),(-.091,-.067),(-.098,-.061)], .015, coating, bevel=.0017, rounded=True)
        opening(guard, (-.063,0,-.056), (.048,.030,.042), .014)
        # A continuous, rounded blade, with its head embedded in the receiver.
        # Offset a sampled Bezier centreline instead of beveling a six-corner polygon.
        # The finger-facing concavity opens toward the muzzle (+X), not the grip.
        control = [Vector(p) for p in [(-.066,-.035),(-.079,-.050),(-.080,-.060),(-.067,-.068)]]
        front, back_edge = [], []
        for i in range(25):
            t = i/24; u = 1-t
            centre = u**3*control[0] + 3*u*u*t*control[1] + 3*u*t*t*control[2] + t**3*control[3]
            tangent = 3*u*u*(control[1]-control[0]) + 6*u*t*(control[2]-control[1]) + 3*t*t*(control[3]-control[2])
            normal = Vector((-tangent.y, tangent.x)).normalized() * .0021
            front.append(tuple(centre+normal)); back_edge.append(tuple(centre-normal))
        profile('Curved trigger blade', front + back_edge[::-1], .007, steel, trigger, .0007)
        cylinder('Trigger axle', (-.065,0,-.034), .0035, .012, steel, 'Y', trigger)
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
        grip_sections = [(-.025,-.160,-.125,.012),(-.035,-.151,-.103,.013),
            (-.047,-.141,-.091,.0135),(-.057,-.139,-.089,.014),
            (-.070,-.144,-.093,.0145),(-.082,-.153,-.103,.016),
            (-.096,-.158,-.108,.017),(-.112,-.164,-.112,.017),
            (-.130,-.168,-.116,.017),(-.139,-.169,-.119,.0165)]
        rings = []
        for j,(z,back,front,w) in enumerate(grip_sections):
            r = .005; ring = []
            for cx,cy,start in [(front-r,w-r,0),(back+r,w-r,90),
                                (back+r,-w+r,180),(front-r,-w+r,270)]:
                for i in range(5):
                    a = math.radians(start+i*22.5)
                    x = cx+r*math.cos(a); y = cy+r*math.sin(a)
                    heel = -.36*(x-(back+front)/2) if j == len(grip_sections)-1 else 0
                    ring.append((x,y,z+heel))
            rings.append(ring)
        grip = loft('Ergonomic pistol grip', rings, polymer, bevel=.0007)
        for side in (-1,1):
            panel = [(-.138,-.075),(-.105,-.081),(-.123,-.138),(-.162,-.128),(-.149,-.090)]
            cut(grip,profile('CUT',panel,.0024,None,None,.001,y=side*.0172))
            profile('Grip inset stipple panel',panel,.0004,rubber,bevel=.0005,y=side*.0162)
            text('SIG SAUER',(-.127 if side==-1 else -.105,side*.0145,-.058),.0033,side,mat=polymer)
        for i in range(11):
            z=-.083-i*.0047; x=-.103-i*.00165
            box('Grip front traction rib',(x,0,z),(.0012,.024,.0010),rubber,bevel=.0003)
        profile('Grip floor plate',[(-.169,-.130),(-.119,-.145),(-.118,-.148),(-.170,-.133)],.034,rubber,bevel=.0008)

    def build_handguard():
        # Handguard is a hollow octagonal extrusion, not black decals on a box.
        # Build the shell along X from octagonal Y/Z rings.
        # 8-inch PDW exterior, including its rear receiver overlap. Width/section are
        # inferred from photographs; 203.2 mm is the catalog's nominal length.
        # Side-photo registration uses rail pitch, not an independent height
        # stretch. The lower edge sits just below the bore; the rear upper
        # shoulder runs diagonally into the receiver instead of a square cuff.
        ring = [(-.015,.034),(.015,.034),(.026,.019),(.026,-.007),(.017,-.019),(-.017,-.019),(-.026,-.007),(-.026,.019)]
        rear = [.077,.077,.052,.045,.045,.045,.045,.052]
        verts = [(x,y,z) for x,(y,z) in zip(rear,ring)] + [(.2482,y,z) for y,z in ring]
        faces = [(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)]
        mesh = bpy.data.meshes.new('Handguard shell'); mesh.from_pydata(verts,[],faces);mesh.update()
        obj = bpy.data.objects.new('Hollow octagonal VIRTUS handguard',mesh);asset.objects.link(obj)
        active(obj);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
        solid = obj.modifiers.new('Wall thickness','SOLIDIFY');solid.thickness=.0022
        bpy.ops.object.modifier_apply(modifier=solid.name)
        handguard = finish(obj,obj.name,coating,bevel=.0008)
        # Four side M-LOK lands: a short rear land followed by three full slots.
        for x,length in [(.095,.012),(.126,.032),(.169,.032),(.212,.032)]:
            opening(handguard,(x,0,.008),(length,.072,.009),.003)
        # Nonuniform upper vents and the distinctive diagonal lower openings.
        for points in [[(.086,.017),(.092,.024),(.108,.024),(.102,.017)],[(.111,.017),(.117,.024),(.133,.024),(.127,.017)],[(.157,.025),(.168,.033),(.191,.033),(.187,.023),(.163,.023)],[(.207,.020),(.210,.030),(.239,.030),(.239,.020)]]:
            cut(handguard,profile('CUT',points,.072,None,None,.001))
        for x in (.096,.125,.154,.183,.212,.238):
            cut(handguard,profile('CUT',[(x-.014,-.006),(x-.005,-.006),(x+.009,-.017),(x-.005,-.017)],.072,None,None,.0015))
        for x in (.100,.140,.180,.220):
            opening(handguard,(x,0,-.018),(.028,.014,.018),.002)
        for side in (-1,1):
            tube_obj = cylinder('QD sling socket',(.067,side*.027,.008),.0065,.003,steel,'Y')
            cut(tube_obj,cylinder('CUT',(.067,side*.027,.008),.0044,.008,None,'Y',None,24,0))
        # Barrel/gas exterior silhouettes only. The accessory is not a functional model.
        # Full 228.6 mm exterior includes the 4.6 mm threaded end below.
        cylinder('Barrel under vented guard',(.162,0,.009),.0087,.224,steel)
        cylinder('Gas system silhouette',(.146,0,.028),.0036,.168,steel)
        box('Gas block silhouette',(.233,0,.015),(.014,.023,.029),steel)
        # Same across/up interface as every weapon; this rifle remains +X forward.
        for name, outline, spans in [
            ('Continuous top rail foot', picatinny.section(.046,.035,slot=True), [(-.170,.247)]),
            ('Picatinny rail tooth', picatinny.section(.046,.035), picatinny.lands(-.170,.247,-.036)),
        ]:
            for a,b in spans:
                loft(name,[[(y,x,z) for x,z in outline] for y in (a,b)],coating,bevel=0)
        for x in (-.15,.232):
            box('Backup sight base',(x,0,.049),(.030,.030,.007),steel)
            cylinder('Backup sight hinge',(x+.004,0,.055),.006,.034,steel,'Y')
            box('Folded backup sight leaf',(x-.006,0,.056),(.019,.014,.004),polymer,folded)
            if x < 0:
                # Hinge-supported aperture leaf: an actual open bore, not glass.
                box('Rear sight leaf stalk',(x+.004,0,.063),(.004,.010,.017),polymer,irons)
                tube('Rear sight aperture',(x+.004,0,.077),.007,.0025,.003,steel,irons)
            else:
                box('Front sight leaf',(x+.004,0,.063),(.004,.014,.017),polymer,irons)
                box('Front sight post',(x+.004,0,.073),(.002,.0018,.008),steel,irons,bevel=.0001)
                for side in (-1,1):
                    box('Front sight protective ear',(x+.004,side*.008,.074),(.004,.003,.020),polymer,irons)

            for side in (-1,1): screw(x+.004,side*.018,.055,.003)

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
        box('Rear 1913 interface',(-.181,0,.001),(.014,.030,.051),steel)
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
        # The butt follows the pad into a rounded toe and a relieved lower shoulder.
        stock_body=profile('Stock butt frame',[(-.304,.028),(-.429,.028),(-.436,.024),
            (-.432,-.027),(-.427,-.075),(-.424,-.090),(-.398,-.090),(-.390,-.086),
            (-.388,-.080),(-.392,-.072),(-.399,-.063),(-.395,-.057),(-.365,-.025),
            (-.340,-.021),(-.323,.000),(-.304,.000)],.037,polymer,stock,.0025,rounded=True)
        cut(stock_body,profile('CUT',[(-.409,-.054),(-.384,-.028),(-.381,-.026),
            (-.379,-.028),(-.406,-.059),(-.410,-.060)],.052,None,None,.002))
        for side in (-1,1):
            profile('Stock molded side panel',[(-.320,.012),(-.419,.012),(-.421,-.016),
                (-.397,-.018),(-.370,-.015),(-.336,-.011)],.0011,polymer,stock,.0012,y=side*.019)
            for x in (-.341,-.395):
                opening(stock_body,(x,side*.020,.012),(.022,.006,.004),.0015)
            profile('Stock stipple panel',[(-.418,-.024),(-.397,-.024),(-.417,-.060),
                (-.422,-.068)],.001,rubber,stock,.001,y=side*.019)
        profile('Rubber recoil pad',[(-.428,.029),(-.441,.027),(-.446,.016),(-.437,-.075),
            (-.433,-.089),(-.427,-.092),(-.418,-.089),(-.423,-.073),(-.431,.018)],
            .040,rubber,stock,.002,rounded=True)
        for i in range(18):
            box('Butt pad traction rib',(-.4462+i*.00052,0,.012-i*.0051),(.0017,.036,.0013),rubber,stock,.0004)
        # The latch rides the underside of the spine within the tapered shoulder.
        profile('Length adjustment latch',[(-.353,-.004),(-.320,-.004),(-.327,-.008),
            (-.344,-.019),(-.353,-.017)],.022,polymer,stock,.0012)
        for i in range(7):
            box('Stock latch serration',(-.350+i*.0025,0,-.018+i*.00085),(.001,.023,.0014),rubber,stock,.0002)
        for side in (-1,1):
            socket = cylinder('Stock sling socket',(-.419,side*.021,-.008),.0065,.003,steel,'Y',stock)
            cut(socket,cylinder('CUT',(-.419,side*.021,-.008),.0042,.008,None,'Y',None,24,0))
            screw(-.199,side*.015,-.007,.003,stock)
            text('SIG SAUER',(-.421 if side==-1 else -.397,side*.020,-.027),.0035,side,stock,mat=polymer)

    def build_magazines():
        # Blend the seated neck into the body's forward sweep just below the well.
        sections = [(-.030,-.029,.032),(-.075,-.0305,.032),(-.088,-.0315,.033),
                    (-.111,-.031,.034),(-.131,-.028,.037),(-.146,-.025,.041),
                    (-.161,-.022,.044)]
        outline = [(rear,z) for z,rear,_ in sections]
        outline += [(-.016,-.185),(.047,-.168)]
        outline += [(front,z) for z,_,front in reversed(sections)]
        mag_shell = profile('Curved .300 magazine shell', outline, .025, polymer, mag, .0016, rounded=True)
        profile('Magazine base plate', [(-.020,-.181),(.048,-.162),(.051,-.171),(-.017,-.191)],
                .028, polymer, mag, .0012, rounded=True)
        for side in (-1,1):
            # Recess shallow molded panels close to the receiver instead of
            # leaving a smooth collar between the well and the magazine's body.
            for points in [
                [(-.018,-.097),(-.001,-.093),(.000,-.113),(.006,-.149),(-.009,-.154),(-.016,-.122)],
                [(.005,-.092),(.025,-.087),(.028,-.112),(.035,-.141),(.012,-.147),(.007,-.116)],
            ]:
                cut(mag_shell, profile('CUT', points, .0024, None, None, .001, y=side*.0127))
            text('300 BLK', (.000 if side==-1 else .026, side*.0126, -.160), .0035, side, mag, mat=polymer)
            for row in range(3):
                for col in range(5):
                    x = .004+col*.0035+row*.0007
                    z = -.166+col*.0011-row*.0034
                    box('Magazine paint-pen dot', (x,side*.0125,z), (.0015,.0005,.0015), rubber, mag, 0)
        for z,rear,front in sections[2:]:
            for x in (rear,front):
                box('Magazine edge traction rib', (x,0,z), (.0022,.023,.003), polymer, mag, .0006)
        # Visual feed-end detail, visible only when the magazine leaves the well.
        for y in (-.006,.006):
            cylinder('Top round brass', (.007,y,-.033), .0045, .031, brass, parent=mag, vertices=24)
            ellipsoid('Top round copper', (.023,y,-.033), (.009,.0038,.0038), copper, mag)
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
    # The 9-inch barrel ends at its 5/8-24 direct-thread shoulder. An open
    # three-prong game-fit flash hider replaces the former integrated can.
    tube('Muzzle thread',(.2763,0,.009),.00794,.0041,.0046,steel)
    tube('Base muzzle collar',(.281,0,.009),.0105,.0080,.014,steel,muzzle)
    tube('Base muzzle throat',(.289,0,.009),.0105,.0041,.004,steel,muzzle)
    for i in range(3):
        angle = i*math.tau/3
        prong = box('Base muzzle prong',(.303,math.cos(angle)*.008,.009+math.sin(angle)*.008),
                    (.028,.004,.005),steel,muzzle,.0005)
        prong.rotation_euler.x = angle
    build_charging_handle()
    build_stock()
    build_magazines()
    build_casing()

    # Named attachment / integration sockets; adapter hand contacts follow the fit.
    for name,loc,parent in [('SOCKET_muzzle',(.317,0,.009),rig),('SOCKET_ejection',(-.018,-.030,.004),rig),('SOCKET_grip_R',(-.139,0,-.099),rig),('SOCKET_grip_L',(.171,0,-.020),rig),('SOCKET_magazine',(.004,0,-.042),mag),('SOCKET_sight',(-.146,0,.077),rig),('SOCKET_front_post',(.236,0,.077),rig)]:
        empty(name,loc,parent)

    # Rail contact frames: attachment Blender +Y maps to rifle +X; +Z stays up.
    # The optic mount sits forward of the deployed rear leaf so mounted optics clear it.
    for name, loc in [('MOUNT_optic',(-.036,0,.046)),('MOUNT_muzzle',(.274,0,.009))]:
        mount = empty(name,loc,body)
        mount.rotation_euler.z = -math.pi/2

    # Game-fit adapter seats on the upper-right handguard chamfer (11:15 slope).
    # The vertical side seat crossed the live support glove. Rotate the entire
    # supported adapter, not just the laser; native mechanism timing stays put.
    roll = Matrix.Rotation(-math.atan2(11,15), 3, 'X')
    offset = Vector((0,0,.010))
    rail = empty('MOUNT_rail', roll @ Vector((.221,-.038,0)) + offset, body)
    rail.rotation_euler = (roll @ Matrix(((0,1,0),(0,0,1),(1,0,0)))).to_euler()
    box('Laser rail adapter web',(.221,-.0304,0),(.055,.0088,.014),coating)
    for x in (.201,.241):
        cylinder('Laser rail adapter screw',(x,-.0358,0),.002,.004,steel,'Y')
    for obj in asset.objects:
        if obj.type == 'MESH' and obj.name.startswith('Laser rail '):
            obj.location = roll @ obj.location + offset
            obj.rotation_euler = roll.to_euler()
    bpy.context.view_layer.update()
    picatinny.build_rail('Laser rail adapter',rail.matrix_world@Matrix.Rotation(math.pi,4,'Y'),-.0226,.0226,anodized,body,asset)

    return asset, [rig, mag, spare, bolt, handle, trigger, cover, stock, case, release]
