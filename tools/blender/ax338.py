"""Original early AX338 game art; Blender 5.2, game metres.
blender -b --python-exit-code 1 --python tools/blender/ax338.py
Geometry/PBR helper conventions follow the existing AX338 rebuild.
"""
import json
import math
import struct
import sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/weapons/ax338'
sys.path.insert(0,str(Path(__file__).parent))
from ax338_actions import author_actions
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.render.fps=120;scene.unit_settings.system='METRIC'
C=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
def xyz(v):return C@Vector(v)
asset=bpy.data.collections.new('AX338 | authored components');scene.collection.children.link(asset)
def active(o):
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o

def empty(name,loc=(0,0,0),parent=None):
    o=bpy.data.objects.new(name,None);asset.objects.link(o);o.location=xyz(loc);o.parent=parent;o.empty_display_size=.01;bpy.context.view_layer.update();return o
rig=empty('AX338_RIG');body=empty('receiver',parent=rig);hg=empty('handguard',parent=rig)
stock=empty('stock',parent=rig);optic=empty('optic',parent=rig)
bolt=empty('bolt',(0,.075,.050),rig);trigger=empty('trigger',(0,.049,.016),rig)
mag=empty('magazine',parent=rig);spare=empty('magazine_spare',parent=rig)
mag_rounds=empty('magazine_round',parent=mag);spare_rounds=empty('magazine_spare_round',parent=spare)
# Three original packed 1024 maps shared across material slots, like M4/MCX.
rng=np.random.default_rng(338);N=1024
def field(grid):
    a=rng.random((grid,grid)).astype(np.float32);t=np.arange(N)*grid/N;i=t.astype(int);t=t-i;t=t*t*(3-2*t)
    return ((a[i[:,None]%grid,i[None,:]%grid]*(1-t[:,None])+a[(i[:,None]+1)%grid,i[None,:]%grid]*t[:,None])*(1-t[None,:])
      +(a[i[:,None]%grid,(i[None,:]+1)%grid]*(1-t[:,None])+a[(i[:,None]+1)%grid,(i[None,:]+1)%grid]*t[:,None])*t[None,:])
cloud=field(12)*.4+field(53)*.4+field(200)*.2
fine=rng.uniform(-1,1,(N,N));yy,xx=np.mgrid[0:N,0:N]
scratches=((np.sin(xx*.27+yy*.008)> .997)&(fine>.35)).astype(float)
def image(name,rgb,color=False):
    a=np.ones((N,N,4),dtype=np.float32)
    if rgb.ndim==2:a[:,:,:3]=rgb[:,:,None]
    else:a[:,:,:3]=rgb
    im=bpy.data.images.new(name,width=N,height=N,alpha=True);im.colorspace_settings.name='sRGB' if color else 'Non-Color';im.pixels.foreach_set(a.ravel())
    im.filepath_raw=str(OUT/(name+'.png'));im.file_format='PNG';im.save();im.pack();return im
albedo=image('ax338_surface',np.clip(.86+cloud*.09+fine*.025+scratches*.08,0,1),True)
rough=image('ax338_roughness',np.clip(.85+cloud*.09+fine*.06-scratches*.2,0,1))
grain=np.sin(xx*2.1)*np.sin(yy*1.7)*.08+fine*.07
normal_pixels=np.stack((.5+grain,.5+np.roll(grain,3,0),np.full_like(grain,1)),axis=2)
# Reserve atlas quarters for moulded stipple and woven pouch; remaining UVs
# use subtle coated-metal detail. No extra runtime texture or material pass.
height=field(200)*.00018
height[:,256:512]=(np.sin(xx[:,256:512]*1.7)*np.sin(yy[:,256:512]*1.7)+1)*.00008
for x0,x1,span in [(0,256,.075),(256,512,.13)]:
    part=height[:,x0:x1];dx=(np.roll(part,-1,1)-np.roll(part,1,1))/(2*span/(x1-x0));dy=(np.roll(part,-1,0)-np.roll(part,1,0))/(2*span/N)
    vector=np.stack((-dx,-dy,np.ones_like(dx)),axis=2);vector/=np.linalg.norm(vector,axis=2,keepdims=True);normal_pixels[:,x0:x1]=vector*.5+.5
normal=image('ax338_normal',normal_pixels)

def material(name,color,metal=0,r=.6):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*color,1)
    ns=m.node_tree.nodes;links=m.node_tree.links;shader=ns.get('Principled BSDF');shader.inputs['Base Color'].default_value=(*color,1);shader.inputs['Metallic'].default_value=metal;shader.inputs['Roughness'].default_value=r
    tex=ns.new('ShaderNodeTexImage');tex.image=albedo;mix=ns.new('ShaderNodeMix');mix.data_type='RGBA';mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[7].default_value=(*color,1);links.new(tex.outputs['Color'],mix.inputs[6]);links.new(mix.outputs[2],shader.inputs['Base Color'])
    t=ns.new('ShaderNodeTexImage');t.image=rough;sep=ns.new('ShaderNodeSeparateColor');links.new(t.outputs['Color'],sep.inputs[0]);mul=ns.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=r;links.new(sep.outputs[1],mul.inputs[0]);links.new(mul.outputs[0],shader.inputs['Roughness'])
    t=ns.new('ShaderNodeTexImage');t.image=normal;n=ns.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=.25;links.new(t.outputs['Color'],n.inputs['Color']);links.new(n.outputs[0],shader.inputs['Normal']);return m
fde=material('01 | Dark Earth stockside',(.28,.19,.085),0,.70)
black=material('02 | black furniture',(.010,.012,.014),0,.76)
steel=material('03 | coated steel',(.018,.021,.023),0,.52)
bright=material('04 | exposed steel',(.17,.18,.18),1,.36)
rubber=material('05 | pad and grip texture',(.015,.017,.018),0,.9)
brass=material('07 | cartridge brass',(.53,.35,.12),1,.32)
copper=material('08 | projectile jacket',(.34,.17,.075),1,.32)
mark=material('09 | laser markings',(.60,.57,.47),0,.88)
glass=material('10 | RMR coated lens',(.03,.10,.12),0,.14)
glass.surface_render_method='DITHERED';glass.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value=.13

# Geometry is authored in game metres, converted only at the Blender boundary.
def finish(o,name,mat=black,parent=body,bevel=.0005,smooth=False):
    o.name=name
    for c in list(o.users_collection):c.objects.unlink(o)
    asset.objects.link(o)
    # Primitives are created in world space; preserve it when attaching hinges.
    bpy.context.view_layer.update();world=o.matrix_world.copy();o.parent=parent
    if parent:o.matrix_parent_inverse=parent.matrix_world.inverted()
    o.matrix_world=world
    if mat:o.data.materials.append(mat)
    active(o);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        m=o.modifiers.new('Machined edge radius','BEVEL');m.width=bevel;m.segments=3;bpy.ops.object.modifier_apply(modifier=m.name)
    if smooth:
        for poly in o.data.polygons:poly.use_smooth=True
    m=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');m.keep_sharp=True;bpy.ops.object.modifier_apply(modifier=m.name)
    return o

def box(name,loc,dims,mat=black,parent=body,bevel=.0005):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(loc));o=bpy.context.object;o.dimensions=(dims[0],dims[2],dims[1]);return finish(o,name,mat,parent,bevel)

def mesh(name,verts,faces,mat=black,parent=body,bevel=.0005,smooth=False):
    d=bpy.data.meshes.new(name);d.from_pydata([xyz(v) for v in verts],[],faces);d.update();o=bpy.data.objects.new(name,d);asset.objects.link(o);active(o)
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
    return finish(o,name,mat,parent,bevel,smooth)

def profile(name,points,width,mat=black,parent=body,x=0,bevel=.0005,smooth=False):
    n=len(points);verts=[(x+s*width/2,y,z) for s in (-1,1) for z,y in points];faces=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    return mesh(name,verts,faces,mat,parent,bevel,smooth)

def cyl(name,loc,r,length,mat=steel,parent=body,axis='Z',sides=32,bevel=.00015):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides,radius=r,depth=length,location=xyz(loc));o=bpy.context.object
    direction=xyz({'X':(1,0,0),'Y':(0,1,0),'Z':(0,0,1)}[axis]);o.rotation_euler=direction.to_track_quat('Z','Y').to_euler();return finish(o,name,mat,parent,bevel,True)

def turned(name,x,y,section,mat,parent=None,sides=24):
    verts=[(x+math.sin(i*2*math.pi/sides)*r,y+math.cos(i*2*math.pi/sides)*r,z) for z,r in section for i in range(sides)]
    faces=[tuple(range(sides-1,-1,-1)),tuple(range((len(section)-1)*sides,len(section)*sides))]
    faces += [(j*sides+i,j*sides+(i+1)%sides,(j+1)*sides+(i+1)%sides,(j+1)*sides+i) for j in range(len(section)-1) for i in range(sides)]
    return mesh(name,verts,faces,mat,parent,.0001,True)

def cut(o,cutter):
    bpy.context.view_layer.update();active(o);m=o.modifiers.new('True opening','BOOLEAN');m.operation='DIFFERENCE';m.object=cutter;bpy.ops.object.modifier_apply(modifier=m.name);bpy.data.objects.remove(cutter,do_unlink=True)


def text(label,loc,size,side=-1,parent=body):
    bpy.ops.object.text_add(location=xyz(loc));o=bpy.context.object;o.data.body=label;o.data.size=size;o.data.extrude=0
    right=xyz((0,0,-side));up=xyz((0,1,0));o.rotation_euler=Matrix((right,up,right.cross(up))).transposed().to_euler()
    active(o);bpy.ops.object.convert(target='MESH');return finish(o,'Mark | '+label,mark,parent,0)

def fastener(name,x,y,z,r=.0027,parent=body):
    o=cyl(name,(x,y,z),r,.002,bright,parent,'X',24)
    cut(o,cyl('CUT hex',(x,y,z),r*.52,.004,None,None,'X',6,0))
    return o

# Published overall/barrel anchors; other exterior datums are photo estimates.
# Barrel is 27 inches = 685.8 mm, NOT simultaneously exact 686 mm.
breech=-.110;crown=breech-.6858;muzzle=-.870;butt=.380
upper=box('Steel flat-bottom action',(0,.077,-.040),(.040,.049,.230),steel,body,.0012)
cut(upper,box('CUT open ejection port',(.021,.081,-.035),(.024,.023,.100),None,None,.002))
# Continuous external bolt tube visible through the real ejection opening.
cyl('Bolt tube',(0,.075,-.027),.010,.180,bright,bolt,'Z',48)
cyl('Bolt shroud',(0,.075,.068),.012,.034,steel,bolt,'Z',40)
cyl('Bolt handle root',(.014,.075,.050),.005,.026,bright,bolt,'X',24)
# Bolt rotates about bore, not around the handle knob.
mesh('Bolt handle swept stem',[(x,y,z) for z in (.044,.054) for x,y in [(.017,.076),(.042,.054),(.061,.051),(.061,.058),(.042,.062),(.021,.084)]],
    [tuple(range(5,-1,-1)),tuple(range(6,12))]+[(i,(i+1)%6,(i+1)%6+6,i+6) for i in range(6)],steel,bolt,.001)
bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,radius=.011,location=xyz((.062,.054,.050)))
finish(bpy.context.object,'Bolt knob',black,bolt,.0001,True)
lower=profile('Bonded chassis',[(-.180,.061),(.019,.061),(.022,.045),(-.004,.038),(-.004,-.002),(-.132,-.008),(-.177,.017)],.042,black)
cut(lower,box('CUT magazine well',(0,-.026,-.075),(.035,.060,.087),None,None,.001))
guard=profile('Tan trigger guard',[(z,y+.030) for z,y in [(-.009,.026),(.058,.029),(.076,.007),(.066,-.040),(.052,-.054),(.0,-.052),(-.012,-.025)]],.031,fde)
cut(guard,profile('CUT trigger guard',[(z,y+.030) for z,y in [(-.001,.017),(.048,.019),(.060,.003),(.052,-.035),(.041,-.042),(.004,-.040),(-.002,-.021)]],.070,None,None,bevel=.001))
profile('Pistol grip spine',[(z,y+.030) for z,y in [(.041,.020),(.077,.018),(.111,-.112),(.074,-.117),(.050,-.067),(.028,-.058)]],.035,fde)
for side in (-1,1):
    profile('Grip stipple insert',[(z,y+.030) for z,y in [(.067,-.008),(.082,-.012),(.107,-.105),(.077,-.110),(.058,-.066),(.046,-.053)]],.003,rubber,x=side*.018,bevel=.0013)
    fastener('Grip screw',side*.020,-.054,.079,.0035)
profile('Curved trigger',[(z,y+.030) for z,y in [(.010,.021),(.016,.020),(.026,-.014),(.023,-.027),(.012,-.031),(.009,-.027),(.018,-.022),(.018,-.014)]],.005,steel,trigger,bevel=.0007)
# Early brochure stock is a solid upper carrier / vertical butt housing, not
# the later AXMC triangular A-frame. The hinge and adjustment hardware remain.
cyl('Stock hinge',(0,.060,.112),.016,.047,steel,stock,'X',32)
for side in (-1,1):
    profile('Dark Earth stockside',[(.120,.058),(.327,.058),(.331,-.068),(.285,-.068),(.283,.010),(.155,.010),(.135,.035),(.120,.035)],.010,fde,stock,x=side*.018,bevel=.0014)
    box('Stock moulding relief',(side*.024,.034,.222),(.002,.013,.106),fde,stock,.0015)
    for z,y in [(.128,.048),(.172,.048),(.265,.048),(.308,.048),(.308,-.038)]:
        fastener('Stockside torx',side*.024,y,z,.0038,stock)
box('Stock carrier',(0,.035,.225),(.027,.043,.214),black,stock,.001)
box('Butt spacer',(0,-.005,.349),(.027,.150,.025),steel,stock,.001)
box('Rubber butt pad',(0,-.005,.369),(.043,.156,.022),rubber,stock,.003)
for y in np.linspace(-.074,.064,12):
    box('Butt traction',(0,float(y),.379),(.040,.004,.002),rubber,stock,.0007)
for z in (.184,.274):cyl('Cheek riser',(0,.068,z),.004,.048,bright,stock,'Y',20)
box('Cheekpiece',(0,.089,.229),(.050,.019,.147),black,stock,.005)
for z in (.184,.274):cyl('Cheek adjuster',(.026,.060,z),.007,.008,black,stock,'X',24)
cyl('Rear support foot',(0,-.078,.309),.006,.020,bright,stock,'Y',24)
cyl('Rear support pad',(0,-.091,.309),.014,.007,rubber,stock,'Y',32)
# 406 mm factory forend envelope with physical wall and KeySlot openings.
hg0=-.175;hg1=hg0-.406
tube=box('Octagonal slotted forend',(0,.076,(hg0+hg1)/2),(.054,.052,.406),black,hg,.009)
cut(tube,box('CUT free float bore',(0,.076,(hg0+hg1)/2),(.043,.041,.411),None,None,.007))
for side in (-1,1):
    for row in (.064,.085):
        for z in np.linspace(hg0-.025,hg1+.025,15):
            # KeySlot: a circular head and a narrower longitudinal neck.
            cut(tube,cyl('CUT KeySlot round',(side*.027,row,float(z)),.0035,.012,None,None,'X',20,0))
            cut(tube,box('CUT KeySlot neck',(side*.027,row,float(z)-.005),(.012,.0045,.012),None,None,.001))
    for z in np.linspace(hg0-.030,hg1+.030,9):
        cut(tube,box('CUT upper vent',(side*.019,.100,float(z)),(.012,.013,.017),None,None,.001))
    profile('Tan forward grip panel',[(hg0,.050),(hg0-.140,.050),(hg0-.137,.021),(hg0+.010,.025)],.006,fde,hg,x=side*.027,bevel=.0015)
    for z in (hg0-.010,hg0-.122):fastener('Panel screw',side*.030,.036,z,.003,hg)
# MIL-STD-1913 pitch 10.01 mm; teeth/cross slots modelled, not normal-only.
box('Continuous top rail',(0,.111,-.252),(.021,.007,.655),black,hg,.0004)
for z in np.arange(-.576,.075,.01001):
    profile('Rail tooth',[(float(z),.113),(float(z),.118),(float(z)+.0052,.118),(float(z)+.0052,.113)],.021,steel,hg,bevel=.00025)
# Barrel external profile and factory high-efficiency open brake.
turned('27 inch barrel',0,.075,[(breech,.016),(breech-.070,.015),(hg1,.012),(crown,.011)],steel,body,48)
brake=turned('Factory brake',0,.075,[(crown,.011),(crown-.012,.014),(muzzle+.004,.014),(muzzle,.012)],steel,body,48)
cut(brake,cyl('CUT brake axial passage',(0,.075,(muzzle+crown)/2),.0052,.080,None,None,'Z',32,0))
for z in (crown-.026,crown-.050):
    cut(brake,box('CUT lateral brake port',(0,.075,z),(.060,.014,.016),None,None,.002))
cyl('Brake lock nut',(0,.075,crown-.007),.015,.006,black,body,'Z',40)
# Ten-round double-row magazine; two separate authored transfer controls.
for parent,rounds in ((mag,mag_rounds),(spare,spare_rounds)):
    box('Magazine steel body',(0,.023,-.075),(.034,.117,.083),steel,parent,.002)
    box('Magazine floorplate',(0,-.037,-.075),(.038,.004,.086),black,parent,.0007)
    for side in (-1,1):
        box('Magazine formed rib',(side*.0175,.023,-.073),(.002,.101,.003),black,parent,.0005)
    for x in (-.007,.007):
        turned('Visible .338 cartridge',x,.083,[(-.034,.0074),(-.085,.0073),(-.098,.0056),(-.108,.0043),(-.137,.0007)],brass,rounds,24)
box('Magazine latch',(0,-.037,.008),(.010,.016,.012),steel,body,.001)
# Older PM II LP 5-25x56, 417 mm overall / 34 mm central tube.
# Its exact mount relief, turrets and hidden contours remain photo-inferred.
axis=.159;rear=.087;front=rear-.417
turned('PM II scope housing',0,axis,[(rear,.020),(rear-.006,.021),(rear-.064,.021),(rear-.081,.018),(-.150,.017),(-.265,.031), (front,.031)],black,optic,64)
for z,r,length in [(.043,.022,.021),(.004,.018,.015),(-.320,.032,.009)]:
    cyl('Scope knurled ring',(0,axis,z),r,length,black,optic,'Z',64)
    for i in range(48):
        a=i*math.tau/48
        cyl('Ring grip ridge',(math.sin(a)*r,axis+math.cos(a)*r,z),.0006,length*.85,steel,optic,'Z',8,0)
for z in (-.024,-.154):
    saddle=cyl('34 mm mount ring',(0,axis,z),.023,.019,black,optic,'Z',48)
    cut(saddle,cyl('CUT ring bore',(0,axis,z),.0172,.030,None,None,'Z',48,0))
    box('AI one-piece ring pedestal',(0,.137,z),(.037,.034,.028),black,optic,.0007)
    for side in (-1,1):
        box('Ring clamp ear',(side*.020,axis,z),(.007,.014,.023),black,optic,.0007)
        fastener('Ring clamp screw',side*.024,axis,z,.0028,optic)
box('AI mount base',(0,.126,-.089),(.040,.011,.177),black,optic,.0007)
for side in (-1,1):
    for z in (-.024,-.154):fastener('Mount rail nut',side*.021,.125,z,.004,optic)
cyl('Elevation drum',(0,axis+.022,-.087),.020,.035,black,optic,'Y',48)
cyl('Elevation cap',(0,axis+.041,-.087),.018,.006,black,optic,'Y',48)
# Real relief on the controls; numeric typography/layout is inferred, not an
# exact reticle/turret calibration or a claim of a particular specimen serial.
for i in range(24):
    a=i*math.tau/24
    cyl('Elevation knurl',(math.sin(a)*.020,axis+.023,-.087+math.cos(a)*.020),.0007,.011,black,optic,'Y',8,0)
for i in range(12):
    a=i*math.tau/12
    bpy.ops.object.text_add(location=xyz((math.sin(a)*.0203,axis+.029,-.087+math.cos(a)*.0203)))
    o=bpy.context.object;o.data.body=str(i*2);o.data.size=.0026;o.data.align_x='CENTER'
    right=xyz((math.cos(a),0,-math.sin(a)));up=xyz((0,1,0))
    o.rotation_euler=Matrix((right,up,right.cross(up))).transposed().to_euler()
    active(o);bpy.ops.object.convert(target='MESH');finish(o,'Elevation graduation',mark,optic,0)
for side in (-1,1):
    cyl('Windage and parallax',(side*.025,axis,-.087),.016,.023,black,optic,'X',48)
    cyl('Turret cap',(side*.038,axis,-.087),.015,.004,black,optic,'X',48)
for z,r in [(front-.0002,.028),(rear+.0002,.018)]:
    cyl('Recessed optical glass',(0,axis,z),r,.0005,glass,optic,'Z',64,0)
for side in (-1,1):
    text('ACCURACY INTERNATIONAL',(side*.0211,.091,-.116),.0032,side)
    text('AX338  .338 LAPUA MAG',(side*.0211,.064,-.103),.0026,side)
    text('SCHMIDT & BENDER',(side*.0212,axis-.004,.058),.003,side,optic)
    for i in range(8):
        text(str(i*5),(side*.0379,axis+.009-i*.002,-.094),.0018,side,optic)
for name,pos in [('SOCKET_muzzle',(0,.075,muzzle)),('SOCKET_ejection',(.027,.081,-.035)),('SOCKET_sight',(0,axis,rear)),('SOCKET_magazine',(0,.080,-.075))]:empty(name,pos,rig)
# Source and runtime share identical UVs and atlas regions; never save an
# untextured DCC source and unwrap only the GLB after saving it.
for o in list(asset.objects):
    if o.type!='MESH':continue
    active(o)
    if not o.data.uv_layers:o.data.uv_layers.new(name='UVMap')
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.01);bpy.ops.object.mode_set(mode='OBJECT')
    x0,scale=(0,.245) if o.data.materials[0]==rubber else (.52,.47)
    for loop in o.data.uv_layers.active.data:loop.uv.x=x0+loop.uv.x*scale
# Keep editable component meshes in the source. Runtime consolidation does not
# export review arms, and never changes the source file after this save.
clips,controls,hands=author_actions(ROOT,asset,rig,[rig,bolt,trigger,mag,spare],mag,spare,bolt,trigger)
for o in bpy.data.objects:
    if o.animation_data:
        o.animation_data.action=None
        for t in o.animation_data.nla_tracks:t.mute=t.name!='Idle'
scene.frame_set(0);bpy.context.view_layer.update()
scene.world=bpy.data.worlds.new('AX338 studio');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.24,.27,.32,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.45
for name,loc,power,size in [('key',(1.2,1.7,.7),180,2),('fill',(-1,.8,-.6),110,2),('rim',(0,.4,-1.2),140,1.5)]:
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=xyz(loc);o.rotation_euler=(xyz((0,.04,-.245))-o.location).to_track_quat('-Z','Y').to_euler()
for name,direction in [('hero',(1,.35,1)),('left',(-1,0,0)),('right',(1,0,0)),('top',(0,1,.02))]:
    d=bpy.data.cameras.new(name);o=bpy.data.objects.new(name,d);scene.collection.objects.link(o)
    center=xyz((0,.035,-.245));rotation=xyz(direction).to_track_quat('Z','Y');o.rotation_euler=rotation.to_euler();o.location=center+rotation@Vector((0,0,2));d.type='ORTHO';d.ortho_scale=1.40
    if name=='hero':scene.camera=o
scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=48;scene.eevee.use_raytracing=False
scene.render.resolution_x=1600;scene.render.resolution_y=900;scene.render.resolution_percentage=100;scene.render.film_transparent=True;scene.view_settings.view_transform='AgX'
scene['clips']=json.dumps(clips)
bpy.data.texts.new('START HERE').write('EARLY AX338 / PM II LP / ORIGINAL GAME ART\nNot a scan or manufacturer CAD. Measurements and fidelity limits: README.md.\nNine weapon/wrist/finger NLA clips; shared review skins are not exported.\nSelect matching NLA tracks on all controls and review arms. 120 fps.\nSource geometry remains separate editable components; runtime export joins copies.\nRegeneration overwrites manual edits.\n')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'ax338.blend'),compress=True)
for o in bpy.data.objects:
    if o.animation_data:
        for t in o.animation_data.nla_tracks:t.mute=True
scene.frame_set(0);mag.scale=(1,1,1);spare.scale=(1,1,1);bpy.context.view_layer.update()
# Consolidation operates after source save and only on runtime geometry.
for parent in (body,hg,stock,optic,bolt,trigger,mag,spare,mag_rounds,spare_rounds):
    objects=[o for o in list(asset.objects) if o.type=='MESH' and o.parent==parent]
    if not objects:continue
    for o in objects:
        active(o);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    active(objects[0])
    for o in objects:o.select_set(True)
    bpy.ops.object.join();o=bpy.context.object;o.name=parent.name+'_mesh'
bpy.ops.object.select_all(action='DESELECT')
for o in asset.objects:o.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT/'ax338.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_optimize_animation_keep_anim_object=True,export_sampling_interpolation_fallback='LINEAR',export_extras=True,export_yup=True,export_cameras=False,export_lights=False)
path=OUT/'ax338.glb';raw=path.read_bytes();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);binary=bytearray(raw[20+length:])
for animation in doc['animations']:
    duration=clips[animation['name']]['duration']
    for sampler in animation['samplers']:
        acc=doc['accessors'][sampler['input']];view=doc['bufferViews'][acc['bufferView']]
        offset=8+view.get('byteOffset',0)+acc.get('byteOffset',0)+(acc['count']-1)*4
        assert abs(struct.unpack_from('<f',binary,offset)[0]-duration)<=1/120+.00001
        struct.pack_into('<f',binary,offset,duration);acc['max']=[duration]
    for channel in animation['channels']:
        if channel['target']['path']=='scale':animation['samplers'][channel['sampler']]['interpolation']='STEP'
encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*(-len(encoded)%4)
raw=struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(binary))+struct.pack('<I4s',len(encoded),b'JSON')+encoded+binary;path.write_bytes(raw)
primitives=[p for n in doc['nodes'] if 'mesh' in n for p in doc['meshes'][n['mesh']]['primitives']]
stats={'triangles':sum(doc['accessors'][p['indices']]['count']//3 for p in primitives),'primitives':len(primitives),'materials':len(doc['materials']),'images':len(doc['images']),'bytes':len(raw)}
manifest={'asset':'Early AX338 / Dark Earth / factory brake / PM II LP 5-25x56 / no bipod','units':'metres','clips':clips,'stats':stats,'textureResolution':1024,'dimensions':{'barrel':.6858,'overall':1.250,'barrelFace':breech,'barrelCrown':crown,'muzzle':muzzle,'butt':butt,'scopeLength':.417,'scopeTubeDiameter':.034},'source':'tools/blender/ax338.py + ax338_actions.py + tools/ax338-hand-reference.mjs'}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
assert stats['triangles']<150000 and stats['primitives']<=48 and stats['materials']<=18 and stats['images']==3 and len(raw)<=15*1024*1024,stats
print('AX338 export:',json.dumps(stats))
for name in ('ax338_surface.png','ax338_roughness.png','ax338_normal.png'):(OUT/name).unlink(missing_ok=True)
