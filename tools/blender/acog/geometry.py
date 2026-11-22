"""TA31F/TA51 source; metres, +X forward in its original rail frame."""
import math
import bpy
from mcx.primitives import create_primitives
from mathutils import Matrix
import picatinny

def build_acog(asset, body, materials):
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

    active, finish, box, profile, loft, forging, cylinder, ellipsoid, cut, opening, tube, cord, screw, text = create_primitives(asset, body, materials)
    # TA31F/TA51 exterior from Trijicon's side/top/oblique product photographs.
    # 151.89 mm optic length; width includes the windage cap. Our height check
    # uses optic/foot, excluding TA51 shoe/knobs; Trijicon's exact datum is unverified.
    body['optic'] = 'ACOG 4x32 (TA31F / TA51)'
    # Keep the optical envelope; machine a proper common rail channel into the shoe.
    box('ACOG rail shoe',(-.081,0,.0530),(.096,.030,.0142),anodized,bevel=.0008)
    profile('ACOG integral mounting foot',[(-.128,.060),(-.026,.060),(-.026,.064),(-.039,.069),(-.047,.075),(-.096,.076),(-.109,.065),(-.127,.064)],.023,anodized,bevel=.001)
    for side in (-1,1):
        outline=[(side*y,z) for y,z in [(.0077,.042),(.018,.042),(.018,.057),(.014,.057),(.014,.046),(.0077,.046)]]
        loft('ACOG rail clamp',[[(x,y,z) for y,z in outline] for x in (-.128,-.034)],anodized,bevel=.0001)
    for x in (-.113,-.049):
        cylinder('ACOG mount crossbolt',(x,0,.051),.0027,.042,steel,'Y')
        knob = cylinder('ACOG slotted thumbscrew',(x,.0225,.051),.0078,.0055,anodized,'Y',vertices=48)
        opening(knob,(x,.026,.051),(.011,.003,.0016),.0003)
    frame=Matrix(((0,1,0,-.081),(-1,0,0,0),(0,0,1,.046),(0,0,0,1)))
    picatinny.cut_channel([o for o in asset.objects if o.type=='MESH'],frame,-.049,.049)
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
