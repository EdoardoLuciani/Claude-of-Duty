"""M4A1 Block II / iron-only game-art source; no downloaded asset content.
blender -b --python-exit-code 1 --python tools/blender/m4a1.py -- [--render] [--quick]
Geometry helpers take GAME metres (+X right, +Y up, -Z forward). Blender +Y
is forward. See the asset README.md for photographic/measurement limitations.
"""
import argparse
import json
import math
from pathlib import Path
import struct
import sys
import bpy
import numpy as np
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'assets/weapons/m4a1-block-ii'
sys.path.insert(0,str(Path(__file__).resolve().parent))
p = argparse.ArgumentParser();p.add_argument('--render',action='store_true');p.add_argument('--quick',action='store_true')
args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
for sub in ('textures','renders'):(OUT/sub).mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.render.fps=120
asset=bpy.data.collections.new('M4A1 | authored components');scene.collection.children.link(asset)
studio=bpy.data.collections.new('STUDIO | excluded from export');scene.collection.children.link(studio)
C=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
def xyz(v):return C@Vector(v)
def active(o):
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o

def empty(name,loc=(0,0,0),parent=None):
    o=bpy.data.objects.new(name,None);asset.objects.link(o);o.parent=parent;o.location=xyz(loc);o.empty_display_size=.008;return o
rig=empty('M4_RIG');body=empty('receiver',parent=rig)
guard_root=empty('handguard',parent=body);stock_root=empty('stock',parent=body)
mag=empty('magazine',parent=rig);spare=empty('magazine_spare',parent=rig)
bolt=empty('bolt',parent=rig);head=empty('bolt_head',(0,.075,-.1015),bolt);handle=empty('charging_handle',parent=rig)
trigger=empty('trigger',(0,.0455,-.0055),rig)
cover=empty('dust_cover',(.020,.066,-.052),rig)
release=empty('mag_release',(.020,.0505,-.0295),rig)
case=empty('spent_case',parent=rig)
round_live=empty('magazine_round',parent=mag);round_spare=empty('magazine_spare_round',parent=spare)
bpy.context.view_layer.update()

# Deterministic, authored microstructure; three shared maps, no duplicate arm maps.
rng=np.random.default_rng(556);N=1024
def field(grid):
    a=rng.random((grid,grid)).astype(np.float32);t=np.arange(N)*grid/N;i=t.astype(int);t=t-i;t=t*t*(3-2*t)
    return ((a[i[:,None]%grid,i[None,:]%grid]*(1-t[:,None])+a[(i[:,None]+1)%grid,i[None,:]%grid]*t[:,None])*(1-t[None,:])
      +(a[i[:,None]%grid,(i[None,:]+1)%grid]*(1-t[:,None])+a[(i[:,None]+1)%grid,(i[None,:]+1)%grid]*t[:,None])*t[None,:])
def image(name,values,color=False):
    im=bpy.data.images.new(name,width=N,height=N,alpha=False);im.colorspace_settings.name='sRGB' if color else 'Non-Color'
    pixels=np.ones((N,N,4),dtype=np.float32);pixels[:,:,:3]=values if values.ndim==3 else values[:,:,None]
    im.pixels.foreach_set(pixels.ravel());im.filepath_raw=str(OUT/'textures'/f'{name}.png');im.file_format='PNG';im.save();im.pack();im.filepath='//textures/'+name+'.png';return im
cloud=field(12)*.4+field(53)*.4+field(200)*.2;fine=rng.random((N,N)).astype(np.float32)
height=field(230)*.65+fine*.35
albedo=image('m4_surface',np.clip(.84+cloud*.12+fine*.025,0,1),True)
rough=image('m4_roughness',np.clip(.84+cloud*.11+fine*.04,0,1))
dx=(np.roll(height,-1,1)-np.roll(height,1,1))*.3;dy=(np.roll(height,-1,0)-np.roll(height,1,0))*.3
normal=np.dstack((-dx,-dy,np.ones_like(dx)));normal/=np.linalg.norm(normal,axis=2,keepdims=True)
# A2 side checkering is original baked microgeometry, not nine raised bars.
# Reserve the left half of the shared normal atlas for its diamond panel.
u=np.arange(N//2)[None,:]/(N//2);v=np.arange(N)[:,None]/N
pyramid=np.maximum(0,1-(abs((u*36)%1-.5)*2+abs((v*48)%1-.5)*2))
mask=np.clip(np.minimum(np.minimum((u-.05)*12,(.95-u)*12),np.minimum((v-.04)*12,(.96-v)*12)),0,1)
h=pyramid*mask*.00018
gx=(np.roll(h,-1,1)-np.roll(h,1,1))/(2*.048/(N//2));gy=(np.roll(h,-1,0)-np.roll(h,1,0))/(2*.063/N)
patch=np.dstack((-gx,-gy,np.ones_like(gx)));patch/=np.linalg.norm(patch,axis=2,keepdims=True);normal[:,:N//2]=patch
nmap=image('m4_normal',normal*.5+.5)
def material(name,color,metal=0,roughness=.6,detail=.2):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    n,l=m.node_tree.nodes,m.node_tree.links;p=n.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=roughness
    t=n.new('ShaderNodeTexImage');t.image=albedo
    mix=n.new('ShaderNodeMix');mix.data_type='RGBA';mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[7].default_value=(*color,1)
    l.new(t.outputs[0],mix.inputs[6]);l.new(mix.outputs[2],p.inputs['Base Color'])
    t=n.new('ShaderNodeTexImage');t.image=rough;s=n.new('ShaderNodeSeparateColor');l.new(t.outputs[0],s.inputs[0])
    mul=n.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=roughness;l.new(s.outputs[1],mul.inputs[0]);l.new(mul.outputs[0],p.inputs['Roughness'])
    t=n.new('ShaderNodeTexImage');t.image=nmap;nm=n.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=detail;l.new(t.outputs[0],nm.inputs['Color']);l.new(nm.outputs[0],p.inputs['Normal']);return m
anodized=material('01 | black anodized receiver',(.041,.047,.053),1,.68,.12)
fde=material('02 | RIS II FDE anodizing',(.235,.150,.084),1,.68,.18)
polymer=material('03 | moulded black furniture',(.026,.029,.032),0,.80,.65)
rubber=material('04 | SOPMOD rubber pad',(.022,.024,.026),0,.92,.9)
steel=material('05 | phosphate steel',(.071,.078,.086),1,.65,.18)
burnished=material('06 | restrained steel wear',(.115,.125,.137),1,.48,.10)
magmat=material('07 | aluminum dry film',(.145,.155,.164),1,.76,.22)
brass=material('08 | brass case',(.49,.285,.084),1,.35,.10)
copper=material('09 | copper projectile',(.43,.16,.066),1,.39,.10)
marking=material('10 | subdued markings',(.115,.122,.129),0,.72,.05)
follower=material('11 | olive follower',(.085,.103,.056),0,.78,.3)

def finish(o,name,mat=anodized,parent=body,bevel=.0006,rounded=False):
    o.name=name
    for collection in list(o.users_collection):collection.objects.unlink(o)
    asset.objects.link(o)
    if mat:o.data.materials.append(mat)
    if parent:o.parent=parent;o.matrix_parent_inverse=parent.matrix_world.inverted()
    if rounded:
        for face in o.data.polygons:face.use_smooth=len(face.vertices)==4
    if bevel:
        b=o.modifiers.new('Selective edge radius','BEVEL');b.width=bevel;b.segments=4 if rounded else 2;b.harden_normals=True
        b=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');b.keep_sharp=True
    return o

def box(name,loc,dims,mat=anodized,parent=body,bevel=.0006):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(loc));o=bpy.context.object;o.dimensions=(dims[0],dims[2],dims[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,mat,parent,bevel)
def mesh(name,verts,faces,mat=anodized,parent=body,bevel=.0006,rounded=False):
    d=bpy.data.meshes.new(name);d.from_pydata([xyz(v) for v in verts],[],faces);d.update();o=bpy.data.objects.new(name,d);asset.objects.link(o)
    active(o);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
    return finish(o,name,mat,parent,bevel,rounded)
def loft(name,rings,mat=anodized,parent=body,bevel=.0006,rounded=True):
    n=len(rings[0]);faces=[tuple(range(n-1,-1,-1)),tuple(range((len(rings)-1)*n,len(rings)*n))]
    faces += [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(rings)-1) for i in range(n)]
    return mesh(name,[v for ring in rings for v in ring],faces,mat,parent,bevel,rounded)
def profile(name,points,width,mat=anodized,parent=body,bevel=.0006,x=0,rounded=False):
    return loft(name,[[(x+s*width/2,y,z) for z,y in points] for s in (-1,1)],mat,parent,bevel,rounded)
def cyl(name,loc,r,depth,mat=steel,parent=body,axis='X',sides=32,bevel=.00015):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides,radius=r,depth=depth,location=xyz(loc));o=bpy.context.object
    o.rotation_mode='QUATERNION';o.rotation_quaternion=Vector((0,0,1)).rotation_difference(xyz({'X':(1,0,0),'Y':(0,1,0),'Z':(0,0,1)}[axis]))
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=False)
    o=finish(o,name,mat,parent,bevel,True)
    if bevel:o.modifiers['Selective edge radius'].segments=2
    return o
def cut(o,cutter,bake_cutter=False):
    if bake_cutter:
        active(cutter)
        for mod in list(cutter.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
    active(o);m=o.modifiers.new('Authored opening','BOOLEAN');m.object=cutter;m.operation='DIFFERENCE'
    while list(o.modifiers).index(m)>0:bpy.ops.object.modifier_move_up(modifier=m.name)
    bpy.ops.object.modifier_apply(modifier=m.name);bpy.data.objects.remove(cutter,do_unlink=True)
def tube(name,loc,r,inner,depth,mat=steel,parent=body,axis='Z',sides=48):
    o=cyl(name,loc,r,depth,mat,parent,axis,sides)
    cut(o,cyl('CUT',loc,inner,depth+.004,None,None,axis,sides,0));return o

def forging(name,sections,mat=anodized):
    rings=[]
    for z,bottom,top,w in sections:
        r=min(.005,(top-bottom)/4)
        xy=[(-w*.48,top),(w*.48,top),(w*.85,top-r*.5),(w,top-r*1.5),(w,bottom+r),(w*.84,bottom),(-w*.84,bottom),(-w,bottom+r),(-w,top-r*1.5),(-w*.85,top-r*.5)]
        if name=='Colt upper forging':
            # Rounded upper wall and narrow rail neck seen in Colt end/oblique
            # views; retain the seam, rail datum and internal moving channels.
            xy=[(-w*.84,bottom),(w*.84,bottom),(w,bottom+.003),(w,.075)]
            xy += [(w*math.cos(a),.075+w*math.sin(a)) for a in [i*math.pi/18 for i in range(1,7)]]
            xy += [(w*.47,top),(-w*.47,top)]
            xy += [(w*math.cos(a),.075+w*math.sin(a)) for a in [i*math.pi/18 for i in range(12,19)]]
            xy += [(-w,bottom+.003)]
        rings.append([(x,y,z) for x,y in xy])
    return loft(name,rings,mat,bevel=.001)

# Integrated varying-depth forgings, hollow port/barrel channel and lower well.
upper=forging('Colt upper forging',[(.063,.0555,.098,.018),(.042,.0555,.098,.018),(.018,.0555,.098,.0176),(-.025,.0555,.098,.0178),(-.090,.0555,.098,.0182),(-.120,.0555,.098,.0178),(-.136,.0555,.096,.017)])
cut(upper,cyl('CUT',(0,.075,-.035),.0129,.210,None,None,'Z',48,0))
# The gas key/charging channel is not a solid roof intersecting moving parts.
cut(upper,box('CUT',(0,.09065,-.035),(.0142,.0103,.212),None,None,0))
port=box('CUT',(.018,.078,-.052),(.021,.020,.073),None,None,.001)
cut(upper,port,bake_cutter=True)
lower=forging('Colt lower forging',[(.062,.030,.0555,.0148),(.037,.020,.0555,.017),(.008,.016,.0555,.0173),(-.026,.016,.0555,.0175),(-.042,.011,.0555,.0192),(-.073,.008,.0555,.020),(-.109,.009,.0555,.0195),(-.121,.014,.0555,.018)])
well=box('CUT',(0,.023,-.078),(.0262,.090,.0625),None,None,.0012)
cut(lower,well,bake_cutter=True)
# Cut through both receiver side walls so the trigger stays visible.
opening=profile('CUT',[(-.040,-.015),(-.040,.022),(-.034,.026),(.014,.026),(.018,.022),(.018,-.015)],.080,None,None,.0012,rounded=True)
cut(lower,opening,bake_cutter=True)
profile('GI trigger guard',[(-.040,.013),(-.040,.005),(-.035,.003),(.013,.003),(.020,.008),(.018,.011),(.012,.006),(-.034,.006),(-.037,.013)],.0138,steel,bevel=.00045,rounded=True)
for z in (-.041,.018):
    box('GI guard mounting ear',(0,.014,z),(.030,.009,.006),anodized,bevel=.0008)
    cyl('GI guard retaining pin',(0,.0115,z),.0012,.031,steel,axis='X',sides=20)
for z in (-.106,.048):cyl('Takedown pin',(0,.049,z),.00315,.040,steel,axis='X',sides=24)
# Colt reference: a broad sloped deflector, then an outward/rearward assist.
# Cross-sections taper the casting into the upper, not a thin detached plate.
loft('Brass deflector',[
    [(x,y,z) for z,y in points] for x,points in [
        (.0158,[(-.011,.069),(-.010,.088),(.010,.085),(.014,.066)]),
        (.0300,[(-.007,.070),(-.007,.083),(.006,.080),(.009,.068)])]],
    anodized,bevel=.0012,rounded=True)
def assist_cylinder(name,start,end,r,mat):
    a,b=Vector(start),Vector(end);direction=(b-a).normalized()
    o=cyl(name,(a+b)/2,r,(b-a).length,mat,axis='Z')
    o.rotation_quaternion=xyz((0,0,1)).rotation_difference(xyz(direction))
assist_start=Vector((.012,.079,.011));assist_end=Vector((.029,.079,.046))
assist_axis=(assist_end-assist_start).normalized()
assist_cylinder('Forward assist housing',assist_start,assist_end,.0063,anodized)
assist_cylinder('Forward assist paddle',assist_end,assist_end+assist_axis*.005,.0064,steel)
for i in range(4):
    o=box('Forward assist traction',assist_end+assist_axis*.0052+Vector((0,(i-1.5)*.0014,0)),(.009,.0006,.0005),steel,bevel=.0001)
    o.rotation_quaternion=xyz((0,0,1)).rotation_difference(xyz(assist_axis));o.rotation_mode='QUATERNION'
profile('Bolt catch paddle',[(-.018,.053),(-.005,.053),(-.003,.043),(-.015,.042)],.0036,steel,x=-.019,bevel=.0005)
for y in (.0445,.046,.0475):box('Bolt catch serration',(-.021,y,-.009),(.0004,.0005,.009),steel,bevel=.0001)
box('Magazine release fence',(.018,.0505,-.0295),(.0045,.015,.021),anodized,bevel=.0015)
box('Magazine release button',(.0215,.0505,-.0295),(.0038,.011,.014),steel,release,.001)
for z in (-.034,-.031,-.028,-.025):box('Magazine button serration',(.0235,.0505,z),(.0003,.007,.0005),burnished,release,.0001)
cyl('Selector shaft',(-.0185,.049,.026),.005,.005,steel,axis='X')
profile('Selector lever',[(.026,.052),(.040,.049),(.042,.045),(.038,.043),(.023,.046)],.0035,steel,x=-.0215,bevel=.0006,rounded=True)
# Thin hinged cover pivots on its LOWER edge, leaving the port genuinely open.
box('Dust cover',(.021,.073,-.052),(.0015,.015,.073),steel,cover,.0006)
for z in (-.080,-.052,-.024):cyl('Dust cover hinge',(.021,.066,z),.00165,.012,steel,cover,'Z',24)

# Colt SOCOM nominal closed-bolt-face to crown: 368.300 mm.
BORE=.075;BOLT_FACE=-.105;CROWN=BOLT_FACE-.3683
for name,z0,z1,r in [('Chamber extension',-.129,-.105,.0128),('SOCOM heavy barrel',-.285,-.129,.0097),('M203 relief',-.309,-.285,.0085),('Forward barrel',CROWN+.013,-.309,.0083),('Muzzle thread',CROWN,CROWN+.013,.00635)]:
    tube(name,(0,BORE,(z0+z1)/2),r,.00285,z1-z0,steel)
# Receiver extension is hollow and coaxial; the carrier is not oversized.
tube('Buffer extension',(0,BORE,.140),.01455,.0128,.166,anodized)
tube('Castle nut',(0,BORE,.073),.0192,.0143,.014,steel,axis='Z',sides=48)
for i in range(4):
    a=i*math.tau/4;cut(bpy.data.objects['Castle nut'],box('CUT',(math.cos(a)*.019,BORE+math.sin(a)*.019,.073),(.005,.005,.010),None,None,0))
plate=profile('Receiver end plate',[(.058,.091),(.072,.091),(.074,.068),(.069,.055),(.058,.055)],.038,steel,bevel=.001)
cut(plate,cyl('CUT',(0,BORE,.066),.0148,.024,None,None,'Z',48,0))
# Bolt/carrier and gas key; ports/last-round lockback are visible authored motion.
carrier=cyl('Bolt carrier',(0,BORE,-.015),.0123,.156,burnished,bolt,'Z',48)
tube('Bolt head',(0,BORE,-.09875),.0069,.0048,.0155,burnished,head)
cyl('Recessed bolt face',(0,BORE,-.10425),.00475,.0015,burnished,head,'Z',32,.0001)
for i in range(1,8):
    a=i*math.tau/8
    loft('Bolt locking lug',[[(math.cos(a+d)*r,BORE+math.sin(a+d)*r,z) for r,d in [(.0065,-.18),(.0098,-.18),(.0098,.18),(.0065,.18)]] for z in (-.1065,-.0985)],burnished,head,.00015,True)
# Visual bolt-head seating pocket; internal contours are fit-inferred.
cut(bpy.data.objects['Chamber extension'],cyl('CUT',(0,BORE,-.106),.00995,.0046,None,None,'Z',48,0))
# Radius stays below the .82 mm roof above the inlet: a blanket 1 mm
# bevel folds the thin mouth into self-intersecting/rendered cap triangles.
key_mesh=box('Carrier gas key',(0,.089,-.0355),(.009,.007,.048),steel,bolt,.00035)
cut(key_mesh,cyl('CUT',(0,.0899,-.050),.00178,.026,None,None,'Z',24,0))
for z in (-.0495,-.0195):cyl('Gas key screw',(0,.0932,z),.0023,.0015,steel,bolt,'Y',16)
for z in (-.076,-.065,-.054):cut(carrier,cyl('CUT',(.0124,.078,z),.00135,.004,None,None,'X',24,0))
# Charging handle clears the extension and MaTech through the complete stroke.
stem=box('Charging handle stem',(0,.09475,-.030),(.013,.0015,.190),anodized,handle,.0002)
# Inverted-U section wraps, rather than cuts through, the carrier gas key.
cut(stem,box('CUT',(0,.0923,-.030),(.010,.005,.194),None,None,0))
profile('Charging T bow',[(.063,.0945),(.075,.0945),(.078,.0975),(.075,.1025),(.064,.1025)],.063,anodized,handle,.001,rounded=True)
profile('Charging latch',[(.055,.0945),(.074,.0945),(.078,.0975),(.076,.1015),(.066,.1015),(.058,.0985)],.007,steel,handle,.0006,x=-.027,rounded=True)
cyl('Charging latch pin',(-.027,.1005,.068),.0014,.004,steel,handle,'Y',20)
profile('Curved trigger',[(-.007,.048),(.002,.048),(.007,.030),(.010,.022),(.008,.015),(.003,.008),(.000,.007),(.002,.013),(.005,.019),(.005,.024),(.000,.033),(-.002,.040)],.0064,steel,trigger,.00055,rounded=True)

# RIS II FSP two-piece body: full envelope targets, supported quad rails,
# slotted walls and genuine front-sight cutout. No polymer free-float panels.
HG_REAR=-.133;HG_FRONT=HG_REAR-.31115
# Native corner windows avoid the bevel/Boolean explosion of invisible side
# slots. The four diagonal rows are actually visible above/below the side rails.
outline=[(-.0235,-.009),(-.009,-.0235),(.009,-.0235),(.0235,-.009),(.0235,.009),(.009,.0235),(-.009,.0235),(-.0235,.009)]
def vent_panel(name,p0,p1):
    a,b=Vector(p0),Vector(p1);u=(b-a).normalized();normal=Vector((u.y,-u.x));mid=(a+b)/2;width=(b-a).length
    verts=[];faces=[];smooth=[];lookup={}
    def point(uv,z,back=False):
        p=mid+u*uv-normal*(.0018 if back else 0)
        key=(round(p.x,12),round(p.y+BORE,12),round(z,12))
        if key not in lookup:lookup[key]=len(verts);verts.append(key)
        return lookup[key]
    count=19;pitch=(HG_REAR-HG_FRONT)/count
    angles=sorted(set([i*math.tau/16 for i in range(16)]+[math.atan2(y,x)%math.tau for x in (-width/2,width/2) for y in (-pitch/2,pitch/2)]))
    for cell in range(count):
        z=HG_FRONT+(cell+.5)*pitch
        if mid.y>0 and -.330<z<-.265:continue
        rings=[[],[],[],[]]
        for angle in angles:
            cs,sn=math.cos(angle),math.sin(angle);t=min(width/2/max(abs(cs),1e-10),pitch/2/max(abs(sn),1e-10))
            for row,(radius,back) in enumerate([(t,False),(.0061,False),(t,True),(.0061,True)]):rings[row].append(point(cs*radius,z+sn*radius,back))
        for i in range(len(angles)):
            j=(i+1)%len(angles);of,oh,ib,ih=rings
            faces += [(of[i],of[j],oh[j],oh[i]),(ib[j],ib[i],ih[i],ih[j]),(oh[i],oh[j],ih[j],ih[i])];smooth += [False,False,True]
            vi,vj=Vector(verts[of[i]]),Vector(verts[of[j]])
            # Long side boundaries and only actual row ends, not internal caps.
            edge=(abs((Vector((vi.x,vi.y-BORE))-mid).dot(u))>width/2-1e-7 and abs((Vector((vj.x,vj.y-BORE))-mid).dot(u))>width/2-1e-7)
            start=cell==0 or (mid.y>0 and -.330<z-pitch<-.265)
            stop=cell==count-1 or (mid.y>0 and -.330<z+pitch<-.265)
            end=(start and abs(vi.z-(z-pitch/2))<1e-7 and abs(vj.z-(z-pitch/2))<1e-7) or (stop and abs(vi.z-(z+pitch/2))<1e-7 and abs(vj.z-(z+pitch/2))<1e-7)
            if edge or end:faces.append((of[j],of[i],ib[i],ib[j]));smooth.append(False)
    o=mesh(name,verts,faces,fde,bevel=0)
    for face,shade in zip(o.data.polygons,smooth):face.use_smooth=shade
core=None
for i,p0 in enumerate(outline):
    p1=outline[(i+1)%len(outline)]
    if i%2==0:vent_panel('RIS II diagonal vents',p0,p1);continue
    # Cardinal inner faces define the explicit 29.210 mm circular clearance.
    if abs(p0[0]-p1[0])<1e-8:inner=[(math.copysign(.014605,p0[0]),p0[1]),(math.copysign(.014605,p1[0]),p1[1])]
    else:inner=[(p0[0],math.copysign(.014605,p0[1])),(p1[0],math.copysign(.014605,p1[1]))]
    o=loft('RIS II structural web',[[(x,BORE+y,z) for x,y in [p0,p1,inner[1],inner[0]]] for z in (HG_FRONT,HG_REAR)],fde,bevel=.0002,rounded=False)
    if p0[1]>0 and p1[1]>0:
        core=o
        # Separate gas-tube clearance above the circular barrel gauge.
        cut(core,box('CUT',(0,.091,.5*(HG_FRONT+HG_REAR)),(.0045,.0042,.319),None,None,0))
# Six-bolt mounting flange and barrel nut sit within the nominal rail envelope.
flange=tube('RIS II bolt-up flange',(0,BORE,HG_REAR-.004),.026,.014605,.008,fde)
cut(flange,box('CUT',(0,.091,HG_REAR-.004),(.0045,.0042,.016),None,None,0))
for i in range(6):
    a=math.tau*i/6+.20;x=math.cos(a)*.0218;y=BORE+math.sin(a)*.0218
    screw=cyl('RIS II mounting screw',(x,y,HG_REAR-.0025),.0032,.005,steel,axis='Z',sides=24)
    cut(screw,cyl('CUT',(x,y,HG_REAR+.0005),.00145,.002,None,None,'Z',6,0))
# Rails use physical Picatinny spacing; the FSP cutout removes top teeth only.
def rail(name,z0,z1,side='top',mat=fde):
    center=(z0+z1)/2
    if side=='top':
        y,height=(.1004,.0048) if name=='Upper receiver rail' else (.0972,.0055)
        base=box(name+' web',(0,y,center),(.016,height,z1-z0),mat)
    elif side=='bottom':base=box(name+' web',(0,.052,center),(.020,.007,z1-z0),mat)
    else:base=box(name+' web',(side*.023,BORE,center),(.008,.020,z1-z0),mat)
    count=int((z1-z0)/.0100076)
    for i in range(count):
        z=z0+.0025+i*.0100076
        if name.startswith('RIS II') and side=='top' and -.330<z<-.265:continue
        section=[(-.0079,.0210),(.0079,.0210),(.0079,.0240),(.0106045,.0266),(.0086,.0286),(-.0086,.0286),(-.0106045,.0266),(-.0079,.0240)]
        angle=0 if side=='top' else math.pi if side=='bottom' else -side*math.pi/2
        radial=1 if side=='top' else .02855/.0286 if side=='bottom' else .028321/.0286
        # Model the small cross-section radii directly, instead of a bevel
        # modifier multiplying every tiny tooth edge into hundreds of faces.
        rounded=[]
        for j,point in enumerate(section):
            q=Vector(point);a=q+(Vector(section[j-1])-q).normalized()*.0002;b=q+(Vector(section[(j+1)%len(section)])-q).normalized()*.0002
            for step in range(4):
                t=step/3;rounded.append(a*(1-t)**2+q*2*t*(1-t)+b*t*t)
        rings=[]
        for dz in (-.0023876,.0023876):
            ring=[]
            for x,y in rounded:
                ring.append((x*math.cos(angle)-y*radial*math.sin(angle),BORE+x*math.sin(angle)+y*radial*math.cos(angle),z+dz))
            rings.append(ring)
        loft(name+' tooth',rings,mat,bevel=0,rounded=True)
    if name.startswith('RIS II') and side=='top':cut(base,box('CUT',(0,.102,-.297),(.031,.055,.065),None,None,0))
rail('Upper receiver rail',-.136,.055,'top',anodized)
for side in ('top','bottom',-1,1):rail('RIS II '+str(side),HG_FRONT,HG_REAR,side)
cut(core,box('CUT',(0,.102,-.297),(.031,.055,.065),None,None,.001))
# F-marked A2 base, forged yoke, round gas boss and protected front post.
GAS=-.297
tube('A2 gas boss',(0,BORE,GAS),.0132,.00835,.047,steel)
# Cast A-frame with a real triangular through-window.
tower=profile('A2 tower casting',[(GAS+.022,.065),(GAS+.022,.086),(GAS+.006,.112),(GAS-.007,.135),(GAS-.018,.137),(GAS-.022,.134),(GAS-.022,.065)],.0218,steel,bevel=.0008,rounded=True)
window=profile('CUT',[(GAS+.014,.093),(GAS-.009,.126),(GAS-.013,.126),(GAS-.014,.096),(GAS+.009,.092)],.030,None,None,.0015,rounded=True)
cut(tower,window,bake_cutter=True)
POST_BASE=.132642
box('A2 post platform',(0,POST_BASE-.002,GAS-.007),(.018,.004,.016),steel,bevel=.0005)
SIGHT_Y=.1395
cyl('Front sight post',(0,(POST_BASE+SIGHT_Y)/2,GAS-.007),.0013,SIGHT_Y-POST_BASE,steel,axis='Y',sides=16)
for x in (-.009,.009):
    profile('A2 protective ear',[(GAS+.003,.128),(GAS-.003,.144),(GAS-.009,.150),(GAS-.015,.151),(GAS-.020,.147),(GAS-.020,.128)],.0043,steel,bevel=.0007,x=x,rounded=True)
for z in (GAS-.012,GAS+.013):cyl('A2 taper pin',(0,.068,z),.0018,.031,steel,axis='X',sides=24)
# DD publishes 9.783 inches; installation endpoints/bend remain fit-inferred.
GAS_TUBE_LEN=.2484882
tube('Gas tube',(0,.0899,-.307+GAS_TUBE_LEN/2),.00165,.0007,GAS_TUBE_LEN,burnished,sides=24)
gas_socket=box('A2 gas-tube socket',(0,.0895,GAS-.005),(.0065,.005,.020),steel,bevel=.00012)
cut(gas_socket,cyl('CUT',(0,.0899,GAS-.005),.00180,.026,None,None,'Z',24,0))
# SureFire nominal 66.04 mm; metric catalog conflict is disclosed in README.md.
FH_LEN=.06604;FH_REAR=CROWN+.013;FH_TIP=FH_REAR-FH_LEN
for name,z0,z1,r in [('FH556RC mounting shank',FH_REAR-.018,FH_REAR,.0114),('FH556RC suppressor bearing',FH_REAR-.034,FH_REAR-.018,.0119)]:
    o=tube(name,(0,BORE,(z0+z1)/2),r,.003,z1-z0,steel)
    if name=='FH556RC mounting shank':cut(o,cyl('CUT',(0,BORE,CROWN+.0065),.0064,.0144,None,None,'Z',48,0))
# Four open tines, not a closed/slotted fake cylinder at the exit.
for i in range(4):
    a=i*math.tau/4+.20;rings=[]
    for z,r in [(FH_REAR-.030,.0119),(FH_REAR-.043,.0109),(FH_TIP+.001,.0101),(FH_TIP,.0098)]:
        rings.append([(math.cos(a+d)*radius,BORE+math.sin(a+d)*radius,z) for radius,d in [(r,-.33),(r,.33),(r-.003,.33),(r-.003,-.33)]])
    loft('FH556RC tine',rings,steel,bevel=.0003,rounded=True)
# A2 grip has varying rounded sections, a backstrap and its characteristic ledge.
rings=[]
for y,z,rx,rz in [(.034,.035,.0155,.023),(.015,.040,.016,.023),(-.012,.052,.0167,.024),(-.040,.064,.0168,.025),(-.064,.073,.016,.024),(-.075,.077,.0155,.023)]:
    rings.append([(math.copysign(abs(math.cos(a))**.65,math.cos(a))*rx,y,z+math.copysign(abs(math.sin(a))**.65,math.sin(a))*rz) for a in [i*math.tau/32 for i in range(32)]])
grip=loft('A2 sculpted grip',rings,polymer,bevel=0)
profile('A2 finger ledge',[(.033,-.027),(.037,-.035),(.051,-.038),(.054,-.030)],.032,polymer,bevel=.0015,rounded=True)
# Diamond checkering is mapped below; no tessellated/fictitious stripe ribs.
cyl('A2 grip screw',(0,-.073,.077),.0048,.002,steel,axis='Y',sides=24)
# SOPMOD storage chambers sit inside the cheek shell, below/outboard of the buffer bore.
cheek=[(-.003,.091),(.003,.091),(.013,.087),(.024,.076),(.0325,.060),(.033,.049),(.029,.040),(.018,.0385),(.009,.048),(-.009,.048),(-.018,.0385),(-.029,.040),(-.033,.049),(-.0325,.060),(-.024,.076),(-.013,.087)]
stock_body=loft('LMT SOPMOD body',[[(x,y,z) for x,y in cheek] for z in (.095,.112,.261,.274)],polymer,bevel=.001,rounded=True)
cut(stock_body,cyl('CUT',(0,BORE,.174),.01475,.185,None,None,'Z',48,0))
for side in (-1,1):
    cut(stock_body,cyl('CUT',(side*.023,.052,.174),.0089,.185,None,None,'Z',40,0))
    tube('LMT storage tube',(side*.023,.052,.179),.0088,.0079,.160,polymer,axis='Z',sides=40)
    cyl('LMT storage cap',(side*.023,.052,.098),.0088,.005,polymer,axis='Z',sides=40)
    profile('LMT cap turn tab',[(.094,.049),(.094,.055),(.096,.057),(.102,.055),(.102,.049)],.0038,polymer,x=side*.023,bevel=.0004,rounded=True)
# LMT side reference: pad square to the buffer axis, not raked.
web=profile('LMT structural web',[(.113,.056),(.274,.056),(.274,-.032),(.265,-.030),(.170,.008),(.142,.026),(.120,.025)],.018,polymer,bevel=.0012,rounded=True)
slot=profile('CUT',[(.204,.028),(.254,.028),(.254,.034),(.204,.034)],.030,None,None,.002,rounded=True)
cut(web,slot,bake_cutter=True)
cut(web,box('CUT',(0,.007,.263),(.030,.035,.0045),None,None,.001))
profile('LMT rear brace',[(.266,.056),(.276,.056),(.276,-.032),(.269,-.032)],.021,polymer,bevel=.0012,rounded=True)
for side in (-1,1):
    tube('LMT QD socket',(side*.0115,.012,.242),.0063,.0047,.005,steel,axis='X',sides=32)
    cut(web,cyl('CUT',(side*.0115,.012,.242),.0047,.012,None,None,'X',32,0))
profile('LMT adjustment lever',[(.131,.034),(.165,.034),(.207,.013),(.211,.002),(.206,-.001),(.172,.021),(.131,.023)],.029,polymer,bevel=.001,rounded=True)
cyl('LMT adjustment pin',(0,.017,.164),.0038,.009,steel,axis='Y',sides=24)
pad=[(-.029,.090),(.029,.090),(.032,.066),(.027,.040),(.014,.027),(.013,-.034),(-.013,-.034),(-.014,.027),(-.027,.040),(-.032,.066)]
loft('SOPMOD rubber buttpad',[[(x,y,z) for x,y in pad] for z in (.274,.284)],rubber,bevel=.0018,rounded=True)
for y in np.arange(-.030,.087,.0045):box('Buttpad traction',(0,float(y),.284),(.020 if y<.027 else .050,.0014,.001),rubber,bevel=.00015)

# MaTech: seated steel base, range wedge, windage drum, open peep and stalk.
box('MaTech rail base',(0,.109,.023),(.033,.011,.050),steel,bevel=.0008)
for x in (-.015,.015):box('MaTech clamp',(x,.1065,.023),(.006,.007,.044),steel,bevel=.0006)
profile('MaTech ranging wedge',[(-.002,.111),(.035,.111),(.033,.126),(.025,.128),(.016,.120),(-.002,.118)],.020,steel,bevel=.0007)
cyl('MaTech pivot',(0,.121,.028),.0038,.028,steel,axis='X')
profile('MaTech aperture stalk',[(.029,.119),(.033,.119),(.038,.137),(.031,.139)],.0045,steel,bevel=.0004,rounded=True)
# Concave cup and real through-bore, rather than a bevel-heavy flat tube.
peep=[(-.0017,.0035),(0,.0038),(.0017,.0036),(.0020,.0032),(.0019,.0028),(0,.0011),(-.0017,.0011)]
verts=[(math.cos(a)*r,SIGHT_Y+math.sin(a)*r,.034+z) for z,r in peep for a in [i*math.tau/48 for i in range(48)]]
faces=[(j*48+i,j*48+(i+1)%48,((j+1)%len(peep))*48+(i+1)%48,((j+1)%len(peep))*48+i) for j in range(len(peep)) for i in range(48)]
mesh('MaTech open aperture',verts,faces,steel,bevel=0,rounded=True)
cyl('MaTech windage drum',(.018,.121,.028),.0044,.0055,steel,axis='X',sides=32)
for y in (.112,.114,.116):box('MaTech thumb traction',(-.012,y,.002),(.008,.0005,.011),steel,bevel=.0001)

# Standard USGI metal magazine; complete shape is photo-informed, not PMAG-sized.
mag_stations=[(.054,-.078,.031),(.022,-.078,.031),(-.010,-.079,.031),(-.035,-.081,.031),(-.060,-.085,.031),(-.079,-.090,.0305),(-.095,-.094,.030)]
def magazine_rings(width,inside=False):
    rings=[]
    offsets=sorted([-.030,.030]+[center+d for center in (-.020,-.006,.009,.022) for d in (-.002,-.0012,-.0007,0,.0007,.0012,.002)])
    for y,z,depth in mag_stations:
        ring=[]
        for side in (-1,1):
            for d in (offsets if side==-1 else offsets[::-1]):
                dent=max(.0005*max(0,1-abs(d-center)/.0015) for center in (-.020,-.006,.009,.022))
                # The stamped floor end follows the lower curve: it is not a
                # horizontal chop through both walls of a curved magazine.
                slope=max(0,min(1,(-y-.060)/.035))*.18
                ring.append((side*(width-dent),y-d*slope,z+d*(depth-(.0007 if inside else 0))/.030))
        rings.append(ring)
    return rings
outer,inner=magazine_rings(.01235),magazine_rings(.01165,True)
n=len(outer[0]);k=len(outer);verts=[v for rings in (outer,inner) for ring in rings for v in ring];faces=[]
for row in range(k-1):
    for i in range(n):
        j=(i+1)%n;a=row*n+i;b=row*n+j;c=(row+1)*n+j;d=(row+1)*n+i
        faces += [(a,b,c,d),(a+k*n,d+k*n,c+k*n,b+k*n)]
for row in (0,k-1):
    for i in range(n):
        a=row*n+i;b=row*n+(i+1)%n;faces.append((a,b,b+k*n,a+k*n))
mag_shell=mesh('USGI formed aluminum body',verts,faces,magmat,mag,.0001,True)
mag_shell.modifiers['Selective edge radius'].segments=2
for side in (-1,1):
    profile('USGI feed lip',[(-.104,.052),(-.100,.056),(-.060,.056),(-.049,.052),(-.052,.048),(-.100,.048)],.0015,magmat,mag,.0004,x=side*.0108)
profile('USGI floorplate',[(-.126,-.089),(-.126,-.0905),(-.062,-.102),(-.062,-.1005)],.0265,magmat,mag,.0006,rounded=True)
box('USGI follower',(0,.046,-.078),(.021,.004,.051),follower,mag,.0007)
# Visible top cartridges use the same parent for loaded/empty state.
case_profile=[(0,.00478),(-.00115,.00478),(-.00115,.0043),(-.0025,.0043),(-.0025,.0047),(-.030,.0044),(-.037,.0042),(-.040,.00285),(-.0447,.00285)]
def cartridge_part(name,loc,section,mat,parent):
    x,y,z=loc
    return loft(name,[[(x+math.cos(a)*r,y+math.sin(a)*r,z+dz) for a in [i*math.tau/24 for i in range(24)]] for dz,r in section],mat,parent,0,True)
for x,y in [(-.0045,.054),(.0045,.049)]:
    # Stagger vertically; do not shove an oversized bullet through the front
    # wall. 44.7 mm case + 12.7 mm exposed ogive fits the 62 mm feed envelope.
    cartridge_part('Magazine cartridge',(x,y,-.0498),case_profile,brass,round_live)
    cartridge_part('Magazine projectile',(x,y,-.0945),[(0,.00285),(-.003,.0028),(-.0075,.0019),(-.0115,.0008),(-.0127,.0001)],copper,round_live)
cartridge_part('Review fired case',(0,0,.02235),case_profile,brass,case)

# Primary-backed words only; typography/stock contours remain approximations.
def text(label,loc,size,side=-1,mat=marking,parent=body):
    d=bpy.data.curves.new(label,'FONT');d.body=label;d.size=size;d.resolution_u=3
    o=bpy.data.objects.new('Mark | '+label,d);asset.objects.link(o);o.location=xyz(loc)
    o.rotation_euler=Matrix(((0,0,side),(side,0,0),(0,1,0))).to_euler();o.parent=parent;o.matrix_parent_inverse=parent.matrix_world.inverted();d.materials.append(mat);return o
text('M4A1 CARBINE',(-.0201,.035,-.102),.0032)
text('CAL. 5.56 MM',(-.0201,.029,-.102),.0028)
for word,loc in [('SAFE',(-.0176,.050,.053)),('SEMI',(-.0176,.058,.035)),('AUTO',(-.0176,.049,.004))]:text(word,loc,.0022)
text('DANIEL DEFENSE',( -.0198,.084,-.400),.0024,mat=marking)
text('M4A1 RIS II FSP',(-.0198,.080,-.400),.0020,mat=marking)
for n,y in [('200',.113),('300',.115),('400',.117),('450',.119),('500',.121),('550',.123),('600',.125)]:text(n,(-.0103,y,.019),.0016)
text('OKAY',(-.01255,-.052,-.094),.0023,mat=magmat,parent=mag)
for name,pos in [('SOCKET_muzzle',(0,BORE,FH_TIP)),('SOCKET_ejection',(.023,.081,-.052)),('SOCKET_sight',(0,SIGHT_Y,.034)),('SOCKET_front_post',(0,SIGHT_Y,GAS-.007)),('SOCKET_bolt_face',(0,BORE,BOLT_FACE)),('SOCKET_barrel_crown',(0,BORE,CROWN))]:empty(name,pos,rig)
# Conform markings to the actual shaped surface, not a floating label plane.
from mathutils.bvhtree import BVHTree
for o in list(asset.objects):
    if o.type!='FONT':continue
    active(o);bpy.ops.object.convert(target='MESH')
    if 'M4A1 CARBINE' in o.name or 'CAL. 5.56' in o.name or any(s in o.name for s in ('SAFE','SEMI','AUTO')):
        surface=BVHTree.FromObject(lower,bpy.context.evaluated_depsgraph_get());inv=o.matrix_world.inverted()
        for v in o.data.vertices:
            pt=o.matrix_world@v.co;hit,normal,_,_=surface.ray_cast(Vector((-.1,pt.y,pt.z)),Vector((1,0,0)))
            if hit:v.co=inv@(hit+normal*.000035)
# Explicit static components retain exported envelopes/clearance evidence,
# including mounting screws, rather than hiding them in a receiver primitive.
for o in asset.objects:
    if o.type!='MESH' or o.parent!=body:continue
    parent=guard_root if o.name.startswith('RIS II') else stock_root if o.name.startswith(('LMT ','SOPMOD ','Buttpad ')) else None
    if parent:o.parent=parent;o.matrix_parent_inverse=parent.matrix_world.inverted()
# Share exact magazine geometry/UVs for the fresh magazine after applying radii.
for o in list(asset.objects):
    if o.type!='MESH':continue
    active(o);bpy.ops.object.convert(target='MESH')
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.006);bpy.ops.object.mode_set(mode='OBJECT')
    uv=o.data.uv_layers.active.data
    for loop in uv:loop.uv.x=.52+loop.uv.x*.47
    if o==grip:
        for face in o.data.polygons:
            if abs(face.normal.x)<.6 or face.center.z>=-.012:continue
            for index in face.loop_indices:
                game=C.inverted()@o.data.vertices[o.data.loops[index].vertex_index].co
                center=.052+max(0,-game.y-.012)*.4
                uv[index].uv=(.01+max(0,min(1,(game.z-center+.024)/.048))*.48,.01+max(0,min(1,(game.y+.075)/.063))*.98)
for o in list(asset.objects):
    if o.type=='MESH' and o.parent in (mag,round_live):
        clone=o.copy();clone.data=o.data;asset.objects.link(clone);clone.parent=spare if o.parent==mag else round_spare;clone.name=o.name+' | spare'
from m4_actions import author_actions
parts=[rig,bolt,head,handle,trigger,cover,release,mag,spare,case,round_live,round_spare]
clips,controls,hands=author_actions(ROOT,asset,rig,parts,mag,spare,bolt,head,handle,trigger,cover,release,case)
parts+=controls
def select_clip(name,frame=0):
    for o in parts+hands:
        if o.animation_data:
            for track in o.animation_data.nla_tracks:track.mute=track.name!=name
    scene.frame_start=0;scene.frame_end=math.ceil(clips[name]['frames'][1]);scene.frame_set(frame)
select_clip('Idle')
# DCC review setup is excluded from shipped GLB.
scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=24 if args.quick else 64;scene.eevee.use_raytracing=False
scene.world.use_nodes=True;bg=scene.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=(.18,.21,.26,1);bg.inputs[1].default_value=.4
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=-2.1
scene.render.resolution_x=1920;scene.render.resolution_y=1080;scene.render.resolution_percentage=65 if args.quick else 100
scene.render.image_settings.file_format='PNG'
def aim(o,target):o.rotation_euler=(xyz(target)-o.location).to_track_quat('-Z','Y').to_euler()
def camera(name,loc,target,scale):
    d=bpy.data.cameras.new(name);o=bpy.data.objects.new('CAM_'+name,d);studio.objects.link(o);o.location=xyz(loc);d.type='ORTHO';d.ortho_scale=scale;aim(o,target);return o
cameras={n:camera(n,l,t,s) for n,l,t,s in [('hero',(-1.3,.55,-.75),(0,.030,-.10),1.0),('left',(-1.7,.06,-.10),(0,.025,-.10),.93),('right',(1.7,.06,-.10),(0,.025,-.10),.93),('top',(0,1.7,-.10),(0,0,-.10),.93),('receiver',(-.6,.26,.04),(0,.027,-.032),.34),('irons',(.005,.145,.30),(0,SIGHT_Y,-.08),.13)]}
for name,loc,power,size,color in [('Key',(-.40,.65,-.10),85,.65,(.82,.89,1)),('Rim',(.34,.40,-.12),100,.8,(1,.78,.54)),('Fill',(-.65,.02,.30),30,.8,(.61,.74,1))]:
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.size=size;d.color=color;o=bpy.data.objects.new(name,d);studio.objects.link(o);o.location=xyz(loc);aim(o,(0,.02,-.10))
scene.camera=cameras['hero']
for o in hands:
    if o.type=='MESH':o.hide_render=True
scene['clips']=json.dumps(clips)
notes=bpy.data.texts.new('START HERE');notes.write('M4A1 BLOCK II / IRON-ONLY GAME ART\nReference-backed visual reconstruction; not manufacturing geometry.\nEight synchronized Blender weapon/wrist/finger actions and shared review arm skins.\n120 fps; select the same NLA clip on all rig controls/arms.\nPacked original PBR maps; no downloaded model/texture assets.\nSee adjacent README.md for authoring and measurement caveats.\n')
active(rig);bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'m4a1-block-ii.blend'))
if args.render:
    for name,cam in cameras.items():scene.camera=cam;scene.render.filepath=str(OUT/'renders'/f'{name}.png');bpy.ops.render.render(write_still=True)
# Export from an invertible rest pose; do not destroy the editable source.
select_clip('Idle',0)
for o in parts:
    for track in o.animation_data.nla_tracks:track.mute=True
    o.scale=(1,1,1)
bpy.context.view_layer.update()
for parent in [body,guard_root,stock_root,bolt,head,handle,trigger,cover,release,mag,spare,case,round_live,round_spare]:
    objects=[o for o in asset.objects if o.type=='MESH' and o.parent==parent]
    if not objects:continue
    active(objects[0])
    for o in objects:o.select_set(True)
    bpy.ops.object.join();bpy.context.object.name=parent.name+'_mesh'
# NLA export samples muted tracks itself. Keep the rest pose invertible while
# it gathers static child transforms; hidden-parent scale must not bake into them.
bpy.ops.object.select_all(action='DESELECT')
for o in asset.objects:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'m4a1-block-ii.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_optimize_animation_keep_anim_object=True,export_sampling_interpolation_fallback='LINEAR',export_extras=True,export_yup=True,export_cameras=False,export_lights=False)
path=OUT/'m4a1-block-ii.glb';raw=path.read_bytes();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);binary=bytearray(raw[20+length:])
# NLA export samples integer frames. The draw ends at fractional frame 74.4:
# include the held endpoint at frame 75, then retain its exact .620 s datum.
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
path.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(binary))+struct.pack('<I4s',len(encoded),b'JSON')+encoded+binary)
# Count both magazines/cartridge instances even when glTF deduplicates buffers.
primitives=[p for node in doc['nodes'] if 'mesh' in node for p in doc['meshes'][node['mesh']]['primitives']]
stats={'triangles':sum(doc['accessors'][p['indices']]['count']//3 for p in primitives),'primitives':len(primitives),'materials':len(doc['materials']),'meshes':len(doc['meshes']),'bytes':path.stat().st_size,'images':len(doc['images'])}
assert stats['triangles']<110000 and stats['primitives']<=40 and stats['materials']<=16 and stats['bytes']<=10*1024*1024 and stats['images']==3,stats
manifest={'asset':'M4A1 Block II | RIS II FSP / MaTech / FH556RC / LMT SOPMOD','units':'metres','clips':clips,'stats':stats,'textureResolution':1024,'source':'tools/blender/m4a1.py + m4_actions.py + tools/m4-hand-reference.mjs','notes':['Visual reconstruction, not manufacturing geometry or a scan.','See README.md for unknown datums and the FH556RC unit conflict.','Weapon/wrist/finger trajectories are Blender-authored; shared runtime skins/IK and existing reactive recoil remain.']}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print('M4_EXPORT_COMPLETE',json.dumps(stats))
