"""Original FN EVOLYS 7.62 game art. Blender 5.2; no third-party geometry/maps.
blender -b --python-exit-code 1 --python tools/blender/evolys_762.py
Reference/photo-inferred datums and regeneration caveats: asset README.md.
"""
import json
import math
import struct
import sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'assets/weapons/fn-evolys-762'
sys.path.insert(0,str(Path(__file__).parent))
from evolys_actions import author_actions
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.render.fps=120;scene.unit_settings.system='METRIC'
C=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
def xyz(v):return C@Vector(v)
asset=bpy.data.collections.new('EVOLYS | authored components');scene.collection.children.link(asset)
def active(o):
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o

def empty(name,loc=(0,0,0),parent=None):
    o=bpy.data.objects.new(name,None);asset.objects.link(o);o.location=xyz(loc);o.parent=parent;o.empty_display_size=.01;bpy.context.view_layer.update();return o
rig=empty('EVOLYS_RIG');body=empty('receiver',parent=rig);hg=empty('handguard',parent=rig)
stock=empty('stock',parent=rig);optic=empty('optic',parent=rig)
cover=empty('feed_cover',(-.025,.060,-.215),rig)
charging=empty('charging_handle',parent=rig);bolt=empty('bolt',parent=rig);trigger=empty('trigger',(0,.003,-.020),rig)
pouch=empty('pouch',parent=rig);spare=empty('pouch_spare',parent=rig)
# Three original packed 1024 maps shared across material slots, like M4/MCX.
rng=np.random.default_rng(762);N=1024
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
albedo=image('evolys_surface',np.clip(.86+cloud*.09+fine*.025+scratches*.08,0,1),True)
rough=image('evolys_roughness',np.clip(.85+cloud*.09+fine*.06-scratches*.2,0,1))
grain=np.sin(xx*2.1)*np.sin(yy*1.7)*.08+fine*.07
normal_pixels=np.stack((.5+grain,.5+np.roll(grain,3,0),np.full_like(grain,1)),axis=2)
# Reserve atlas quarters for moulded stipple and woven pouch; remaining UVs
# use subtle coated-metal detail. No extra runtime texture or material pass.
height=field(200)*.00018
height[:,256:512]=(np.sin(xx[:,256:512]*1.7)*np.sin(yy[:,256:512]*1.7)+1)*.00008
for x0,x1,span in [(0,256,.075),(256,512,.13)]:
    part=height[:,x0:x1];dx=(np.roll(part,-1,1)-np.roll(part,1,1))/(2*span/(x1-x0));dy=(np.roll(part,-1,0)-np.roll(part,1,0))/(2*span/N)
    vector=np.stack((-dx,-dy,np.ones_like(dx)),axis=2);vector/=np.linalg.norm(vector,axis=2,keepdims=True);normal_pixels[:,x0:x1]=vector*.5+.5
normal=image('evolys_normal',normal_pixels)

def material(name,color,metal=0,r=.6):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*color,1)
    ns=m.node_tree.nodes;links=m.node_tree.links;shader=ns.get('Principled BSDF');shader.inputs['Base Color'].default_value=(*color,1);shader.inputs['Metallic'].default_value=metal;shader.inputs['Roughness'].default_value=r
    tex=ns.new('ShaderNodeTexImage');tex.image=albedo;mix=ns.new('ShaderNodeMix');mix.data_type='RGBA';mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[7].default_value=(*color,1);links.new(tex.outputs['Color'],mix.inputs[6]);links.new(mix.outputs[2],shader.inputs['Base Color'])
    t=ns.new('ShaderNodeTexImage');t.image=rough;sep=ns.new('ShaderNodeSeparateColor');links.new(t.outputs['Color'],sep.inputs[0]);mul=ns.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=r;links.new(sep.outputs[1],mul.inputs[0]);links.new(mul.outputs[0],shader.inputs['Roughness'])
    t=ns.new('ShaderNodeTexImage');t.image=normal;n=ns.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=.25;links.new(t.outputs['Color'],n.inputs['Color']);links.new(n.outputs[0],shader.inputs['Normal']);return m
fde=material('01 | tan receiver',(.50,.40,.265),0,.70)
black=material('02 | black furniture',(.023,.026,.028),0,.76)
steel=material('03 | parkerized steel',(.045,.051,.052),.8,.52)
bright=material('04 | exposed steel',(.17,.18,.18),1,.36)
rubber=material('05 | pad and grip texture',(.015,.017,.018),0,.9)
canvas=material('06 | woven tan pouch',(.22,.17,.10),0,.95)
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
    bpy.ops.object.text_add(location=xyz(loc));o=bpy.context.object;o.data.body=label;o.data.size=size;o.data.extrude=0;o.data.space_character=1.05
    # local text +X lies along longitudinal direction, +Y points game-up.
    right=xyz((0,0,-side));up=xyz((0,1,0));normal=right.cross(up);o.rotation_euler=Matrix((right,up,normal)).transposed().to_euler()
    active(o);bpy.ops.object.convert(target='MESH');return finish(o,'Mark | '+label,mark,parent,0)

# Right studio photo traced in its displayed 2000-pixel coordinate system.
# ONE 948 mm full-retracted scale, no independent horizontal/vertical fitting.
S=.948/(1956-57)
def zy(px,py):return ((805-px)*S,.075+(219-py)*S)
def traced(points):return [zy(x,y) for x,y in points]
upper=profile('Upper shaped receiver',traced([(596,144),(615,127),(1263,127),(1268,152),(1268,302),(1200,308),(1190,344),(1100,344),(1086,322),(947,322),(933,338),(625,343),(596,323)]),.047,fde,bevel=.0016)
# Side reliefs and feed cavity, not dark rectangles on a sealed solid.
for side in (-1,1):
    cut(upper,box('CUT rear relief',(side*.024,.035,.006),(.006,.019,.105),None,None,.001))
    cut(upper,box('CUT lower channel',(side*.025,.067,-.040),(.006,.013,.240),None,None,.001))
cut(upper,box('CUT ejection port',(.022,.103,-.078),(.022,.018,.046),None,None,.0015))
cut(upper,box('CUT feed tray',(-.023,.086,-.155),(.032,.057,.134),None,None,.002))
box('Feed back wall',(-.009,.086,-.155),(.004,.052,.130),steel)
box('Port dark throat',(.006,.102,-.078),(.004,.016,.043),black)
for z in (-.170,-.207):
    cut(upper,box('CUT upper lightening pocket',(.024,.106,z),(.008,.013,.031),None,None,.002))
box('Right lower ejection shield',(.026,.032,-.093),(.003,.023,.068),black,body,.001)
for y in (.022,.041):
    for z in (-.122,-.063):cyl('Shield fastener',(.028,y,z),.0022,.002,bright,body,'X',20)
# Sloped top shoulders bridge the narrow rail to the receiver sides.
for side in (-1,1):
    profile('Receiver shoulder',traced([(618,129),(1225,129),(1225,144),(618,144)]),.007,fde,x=side*.024,bevel=.001)
# Lower polymer trigger module and curved guard.
profile('Lower trigger module',traced([(634,318),(760,318),(782,329),(871,330),(875,352),(820,365),(769,376),(721,342),(639,339)]),.041,black,bevel=.002,smooth=True)
guard=profile('Curved trigger guard',traced([(783,349),(912,348),(912,381),(907,400),(896,414),(873,426),(853,433),(827,434),(810,430),(788,418),(779,405)]),.018,black,bevel=.0013)
cut(guard,profile('CUT guard',traced([(800,357),(898,356),(898,380),(893,397),(880,409),(864,418),(842,420),(824,418),(808,407),(800,393)]),.04,None,None,bevel=.002))
grip_points=traced([(711,341),(765,336),(814,343),(840,354),(824,372),(815,383),(795,394),(783,405),(786,414),(799,420),(786,429),(769,433),(759,439),(740,480),(721,518),(724,540),(720,550),(711,554),(627,532),(623,529),(630,519),(645,491),(662,460),(681,426),(695,403),(704,381),(703,370),(700,360)])
# Vary section depth instead of another flat extruded grip slab.
n=len(grip_points);zc=sum(z for z,y in grip_points)/n;yc=sum(y for z,y in grip_points)/n
rings=[[(x,yc+(y-yc)*scale,zc+(z-zc)*scale) for z,y in grip_points] for x,scale in [(-.017,.88),(-.014,1),(.014,1),(.017,.88)]]
faces=[tuple(range(n-1,-1,-1)),tuple(range(3*n,4*n))]+[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(3) for i in range(n)]
mesh('Sculpted grip',[v for ring in rings for v in ring],faces,black,bevel=.001,smooth=True)
for side in (-1,1):
    profile('Recessed grip stipple',traced([(716,389),(765,407),(721,509),(705,533),(645,516),(687,436)]),.0012,rubber,x=side*.017,bevel=.001,smooth=True)
profile('Curved trigger',traced([(824,357),(847,357),(861,380),(876,399),(879,411),(868,409),(850,401),(837,386),(826,369)]),.006,steel,trigger,bevel=.0006)
# Full-length rail: standard slot spacing, real gap geometry.
rail_y=.075+(219-123)*S
box('Continuous Picatinny spine',(0,rail_y-.006,-.140),(.025,.009,.501),fde)
for i in range(50):
    z=.105-i*.01005
    profile('Rail tooth',[(z-.003,rail_y-.004),(z+.003,rail_y-.004),(z+.003,rail_y+.002),(z-.003,rail_y+.002)],.0212,fde,bevel=.0003)
# Handguard shell with the alternating triangular openings visible in photos.
hg_shell=profile('Truss handguard',traced([(1250,127),(1557,127),(1616,188),(1606,262),(1560,322),(1250,322)]),.047,fde,hg,bevel=.0011)
# Open central volume plus actual through-side vents.
cut(hg_shell,box('CUT inner guard',(0,.078,-.326),(.037,.079,.189),None,None,.002))
for a,b,c in [(1290,1316,1342),(1385,1412,1438),(1480,1507,1534)]:
    cut(hg_shell,profile('CUT triangle down',traced([(a,157),(c,157),(b,189)]),.10,None,None,bevel=.0015))
for a,b,c in [(1269,1271,1292),(1338,1365,1392),(1435,1461,1487),(1531,1558,1585)]:
    cut(hg_shell,profile('CUT triangle up',traced([(a,191),(c,191),(b,158)]),.10,None,None,bevel=.0015))
for a,b in [(1290,1347),(1365,1422),(1438,1495),(1512,1569)]:
    z,y=zy((a+b)/2,219);cut(hg_shell,box('CUT MLOK',(0,y,z),(.10,.006,(b-a)*S),None,None,.0015))
for a,b,c in [(1283,1304,1325),(1395,1416,1437),(1509,1530,1551)]:
    cut(hg_shell,profile('CUT lower triangle',traced([(a,253),(c,253),(b,279)]),.10,None,None,bevel=.001))
# Black grip covers obscure some bottom openings exactly as on FN studio gun.
for side in (-1,1):
    profile('Handguard molded cover',traced([(1282,247),(1504,247),(1516,255),(1516,281),(1512,290),(1486,290),(1472,300),(1435,315),(1345,316),(1340,328),(1270,328),(1270,304),(1282,300),(1284,281),(1275,278),(1272,265)]),.005,rubber,hg,x=side*.025,bevel=.0014)
# Thin barrel, gas regulator and hollow slotted flash hider. Barrel face/crown
# datum is explicitly 406 mm, not measured against the overall muzzle device.
barrel_end=zy(1832,219)[0];breech=barrel_end+.406
cyl('406 mm barrel',(0,.075,(breech+barrel_end)/2),.008,.406,steel,hg,sides=40)
cyl('Gas block',(0,.075,-.421),.018,.034,steel,hg,sides=40)
box('Gas regulator base',(0,.057,-.422),(.037,.020,.035),steel,hg,.0012)
cyl('Regulator knob',(0,.044,-.435),.009,.014,bright,hg,sides=24)
cyl('Short stroke piston',(0,.048,-.316),.004,.205,steel,hg,sides=20)
crown=zy(1956,219)[0];hider=abs(crown-barrel_end)
h=cyl('Flash hider',(0,.075,(crown+barrel_end)/2),.0112,hider,steel,hg,sides=40)
cut(h,cyl('CUT bore',(0,.075,(crown+barrel_end)/2),.0041,hider+.004,None,None,sides=32,bevel=0))
for i in range(4):
    ang=i*math.pi/2;x=math.sin(ang)*.01;y=.075+math.cos(ang)*.01
    cutter=box('CUT flash slot',(x,y,crown+.016),(.004,.006,.026),None,None,.0008);cutter.rotation_euler.y=ang;cut(h,cutter)
cyl('Muzzle shoulder',(0,.075,barrel_end+.005),.013,.014,steel,hg,sides=32)
# Revised 2024 M4-type stock with the actual broad cheek shell, latch, open web.
cyl('Buffer extension',(0,.068,.149),.014,.112,steel,stock,sides=40)
cyl('Receiver castle nut',(0,.068,.110),.016,.011,steel,stock,sides=32)
stock_shell=profile('Stock cheek shell',traced([(90,228),(109,198),(134,168),(147,156),(166,153),(400,152),(408,153),(411,164),(411,230),(394,245),(386,257),(347,256),(338,252),(190,249),(176,259),(118,263),(87,260)]),.047,black,stock,bevel=.0017,smooth=True)
web=profile('Stock web',traced([(85,260),(385,258),(379,290),(326,333),(128,437),(87,430)]),.025,black,stock,bevel=.0015)
cut(web,profile('CUT triangular stock void',traced([(153,275),(160,268),(184,268),(213,274),(259,276),(258,285),(251,293),(241,301),(217,320),(190,341),(165,363),(147,376),(141,379),(136,378),(133,373),(130,350),(127,325),(124,309),(124,295),(128,288),(137,287),(145,279)]),.06,None,None,bevel=.002))
for points in [[(93,301),(101,303),(109,384),(102,386)],[(158,395),(219,361),(225,363),(222,371),(163,405),(155,405)]]:
    cut(web,profile('CUT stock sling slot',traced(points),.06,None,None,bevel=.0015))
for side in (-1,1):
    ring=cyl('Stock QD sling eye',(side*.013,.045,.338),.0065,.004,steel,stock,'X',32)
    cut(ring,cyl('CUT sling eye',(side*.013,.045,.338),.0045,.010,None,None,'X',24,0))
for side in (-1,1):
    profile('Stock lower reinforcing rib',traced([(110,414),(288,315),(297,325),(122,428)]),.004,black,stock,x=side*.015,bevel=.001)
    cyl('Stock latch pin',(side*.016,.049,.242),.005,.006,bright,stock,'X',24)
profile('Stock latch',traced([(191,291),(210,277),(253,266),(276,265),(284,273),(267,279),(242,284),(220,298),(207,301),(201,300)]),.025,black,stock,bevel=.001)
loop=cyl('Receiver sling loop',(-.018,.040,.121),.008,.003,steel,stock,'X',32)
cut(loop,cyl('CUT rear sling loop',(-.018,.040,.121),.0055,.010,None,None,'X',24,0))
profile('Butt pad',traced([(57,191),(75,190),(94,419),(88,431),(75,430),(57,241)]),.047,rubber,stock,bevel=.002,smooth=True)
# Side-hinged feed cover: hinge at forward end, vertical pivot. Exterior and
# tray contours are photo-informed, not functional manufacturing internals.
profile('Shaped lateral feed cover',[(-.217,.050),(-.080,.050),(-.076,.108),(-.096,.115),(-.108,.123),(-.198,.120),(-.214,.106)],.012,black,cover,x=-.034,bevel=.0015)
box('Cover raised flank',(-.042,.085,-.151),(.010,.036,.078),black,cover,.002)
cyl('Feed hinge',(-.027,.077,-.215),.006,.057,steel,body,'Y',24)
for z in (-.208,-.093):box('Cover latch',(-.043,.086,z),(.013,.015,.014),steel,cover,.001)
# Feed tray/pawls visible while loading. No concealed functional detail.
box('Feed floor',(-.028,.058,-.154),(.036,.007,.125),steel)
for z in (-.186,-.160,-.134):box('Tray guide',(-.035,.067,z),(.025,.016,.004),bright)
# Ambidextrous controls, supported charging slider and receiver fasteners.
box('Charging rail',(.027,.073,-.061),(.009,.008,.168),steel)
box('Charging slider',(.033,.073,-.075),(.014,.015,.082),steel,charging,.001)
cyl('Charging pull knob',(.047,.073,-.075),.009,.026,black,charging,'X',32)
box('Visible bolt through port',(.009,.099,-.078),(.014,.014,.065),bright,bolt,.001)
for side in (-1,1):
    for px,py in [(615,174),(639,186),(781,182),(1059,186),(1240,179),(615,328),(1415,286),(1548,197)]:
        z,y=zy(px,py);cyl('Torx fastener',(side*.025,y,z),.0038,.003,steel,body,'X',24)
        box('Fastener recess',(side*.027,y,z),(.001,.0008,.003),black,body,.0001)
    cyl('Selector axle',(side*.024,.031,.015),.007,.005,steel,body,'X',24)
    box('Selector lever',(side*.028,.033,.001),(.006,.005,.025),black,body,.001)
    text('S  A',(side*.028,.020,.025),.004,side)
text('FN HERSTAL BELGIUM\nFN EVOLYS\nCAL 7.62x51',(-.026,.111,.052),.0035,-1)
# A small reference-informed FN cartouche; no specimen serial or invented label.
cyl('Receiver logo medallion',(-.026,.110,.080),.007,.0003,mark,body,'X',32,0)
text('FN',(-.0265,.107,.084),.004,-1)
# Folded irons stay below the RMR aiming axis.
for z in (.073,-.363):
    box('Folded iron base',(0,rail_y+.005,z),(.025,.007,.034),black)
    cyl('Iron pivot',(0,rail_y+.009,z),.005,.029,steel,body,'X',24)
    box('Folded sight leaf',(0,rail_y+.011,z-.010),(.020,.004,.024),black)
# RMR RM06/RM33: known external dimensions; lens contour remains inferred.
optic_z=-.052;rail_top=rail_y+.002
# RM33 lists 0.768 inch rail-to-RMR optical axis. Its 13.21 mm overall
# height includes the side clamps BELOW the rail top, not a tall solid riser.
mount_top=rail_top+.768*.0254-.014
box('RM33 low mount',(0,(rail_top+mount_top)/2,optic_z),(.028,mount_top-rail_top,.04521),black,optic,.0008)
for side in (-1,1):
    clamp=box('RM33 clamp',(side*.014765,mount_top-.01321/2,optic_z),(.004,.01321,.04521),black,optic,.0008)
    for z in (optic_z-.012,optic_z+.012):
        cut(clamp,cyl('CUT RM33 recessed screw',(side*.016,rail_top-.002,z),.0038,.010,None,None,'X',24,0))
        cyl('RM33 screw',(side*.0153,rail_top-.002,z),.0035,.0025,bright,optic,'X',24)
rmr=box('RMR electronics base',(0,mount_top+.004,optic_z),(.02642,.008,.04572),black,optic,.0012)
# Characteristic twin-eared hood, a real clear window (not a solid rectangle).
outer=[(-.01397,mount_top+.003),(-.01397,mount_top+.020),(-.0108,mount_top+.0254),(-.006,mount_top+.0225),(0,mount_top+.021),( .006,mount_top+.0225),(.0108,mount_top+.0254),(.01397,mount_top+.020),(.01397,mount_top+.003)]
verts=[(x,y,z) for z in (optic_z-.021,optic_z-.014) for x,y in outer];n=len(outer)
hood=mesh('RMR forged hood',verts,[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],black,optic,.0007)
cut(hood,box('CUT RMR clear window',(0,mount_top+.014,optic_z-.018),(.020,.012,.025),None,None,.0022))
box('RMR thin coated lens',(0,mount_top+.014,optic_z-.018),(.0198,.0118,.00035),glass,optic,.0014)
for side in (-1,1):
    cyl('RMR brightness button',(side*.0132,mount_top+.006,optic_z+.002),.0035,.0015,rubber,optic,'X',24)
    text('Trijicon',(side*.01327,mount_top+.006,optic_z+.014),.0026,side,optic)
cyl('RMR battery lid',(0,mount_top+.0085,optic_z+.011),.008,.001,steel,optic,'Y',32)
# Soft 100-round pouch with a rigid mounting lid and shallow seam relief.
for parent in (pouch,spare):
    box('Pouch fabric body',(-.023,-.048,-.166),(.108,.107,.125),canvas,parent,.008)
    box('Pouch rigid lid',(-.023,.009,-.166),(.104,.012,.122),black,parent,.002)
    for side in (-1,1):
        box('Pouch stitched panel',(-.023+side*.054,-.050,-.166),(.002,.087,.105),canvas,parent,.003)
        for z in (-.211,-.121):box('Pouch seam',(-.023+side*.055,-.050,z),(.001,.080,.0013),black,parent,.0004)
    box('Pouch front strap',(-.023,-.055,-.103),(.020,.080,.003),black,parent,.001)
    box('Pouch mount tongue',(-.005,.020,-.165),(.030,.023,.055),steel,parent,.001)
# Eight rounds and links in ONE rigidly weighted skinned mesh, three primitives.
# Each Fire clip translates each bone by one 12.7 mm pitch along the feed curve.
data=bpy.data.armatures.new('Belt bones');belt=bpy.data.objects.new('belt_rig',data);asset.objects.link(belt);belt.parent=rig
active(belt);bpy.ops.object.mode_set(mode='EDIT')
def belt_pos(index):
    return (-.025-index*.00898,.070-index*.00898,-.168)
for i in range(8):
    b=data.edit_bones.new('belt_'+str(i));b.head=xyz(belt_pos(i));b.tail=b.head+Vector((0,.012,0));b.use_deform=True
bpy.ops.object.mode_set(mode='OBJECT');belt_meshes=[]
for i in range(8):
    x,y,z=belt_pos(i);objects=[]
    objects.append(turned('Belt brass',x,y,[(z+.040,.005975),(z+.0385,.005975),(z+.0385,.00565),(z+.004,.0056),(z-.005,.0043),(z-.011,.0043)],brass))
    objects.append(cyl('Belt primer',(x,y,z+.0402),.0019,.0004,brass,None,sides=20,bevel=0))
    objects.append(turned('Belt ogive',x,y,[(z-.010,.0039),(z-.016,.0039),(z-.020,.0035),(z-.026,.0024),(z-.033,.00045),(z-.034,.0001)],copper))
    for dz in (-.002,.012):
        ring=cyl('Disintegrating link',(x,y,z+dz),.0065,.004,steel,None,sides=20)
        cut(ring,cyl('CUT link bore',(x,y,z+dz),.00585,.008,None,None,sides=20,bevel=0));objects.append(ring)
    objects.append(box('Link connecting tab',(x-.0045,y-.0045,z+.005),(.010,.003,.021),steel,None,.0004))
    for o in objects:
        group=o.vertex_groups.new(name='belt_'+str(i));group.add(list(range(len(o.data.vertices))),1,'REPLACE');belt_meshes.append(o)
active(belt_meshes[0])
for o in belt_meshes:o.select_set(True)
bpy.ops.object.join();belt_mesh=bpy.context.object;belt_mesh.name='belt_mesh';belt_mesh.parent=belt
mod=belt_mesh.modifiers.new('Rigid linked belt','ARMATURE');mod.object=belt
# Consolidate only parts sharing a rigid transform, preserving all hinge nodes.
for parent in (body,hg,stock,optic,cover,charging,bolt,trigger,pouch,spare):
    objects=[o for o in list(asset.objects) if o.type=='MESH' and o.parent==parent]
    if not objects:continue
    for o in objects:
        active(o);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        assert o.data.polygons,'Unexpected empty geometry: '+o.name
        if not o.data.uv_layers:
            o.data.uv_layers.new(name='UVMap')
            bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.01);bpy.ops.object.mode_set(mode='OBJECT')
    active(objects[0])
    for o in objects:o.select_set(True)
    bpy.ops.object.join();o=bpy.context.object;o.name=parent.name+'_mesh'
    uv=o.data.uv_layers.active.data
    for face in o.data.polygons:
        mat=o.data.materials[face.material_index]
        x0,scale=(0,.245) if mat==rubber else ((.255,.245) if mat==canvas else (.52,.47))
        for loop in face.loop_indices:uv[loop].uv.x=x0+uv[loop].uv.x*scale
# Skin UVs, then restore an invertible initial pose before export.
active(belt_mesh)
if not belt_mesh.data.uv_layers:belt_mesh.data.uv_layers.new(name='UVMap')
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.01);bpy.ops.object.mode_set(mode='OBJECT')
for loop in belt_mesh.data.uv_layers.active.data:loop.uv.x=.52+loop.uv.x*.47
for name,pos,parent in [('SOCKET_muzzle',(0,.075,crown),rig),('SOCKET_ejection',(.031,.103,-.078),rig),('SOCKET_sight',(0,mount_top+.014,optic_z-.018),rig),('SOCKET_pouch',(-.023,-.048,-.166),rig)]:empty(name,pos,parent)
bpy.context.view_layer.update()
clips,controls,hands=author_actions(ROOT,asset,rig,[rig,cover,charging,bolt,trigger,pouch,spare],belt,belt_pos)
for o in bpy.data.objects:
    if o.animation_data:
        o.animation_data.action=None
        for track in o.animation_data.nla_tracks:track.mute=track.name!='Idle'
scene.frame_set(0);bpy.context.view_layer.update()
# Studio lights/cameras are saved for editable source review, never exported.
scene.world=bpy.data.worlds.new('EVOLYS studio');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.24,.27,.32,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.45
for name,loc,power,size in [('key',(1.2,1.7,.7),180,2),('fill',(-1,.8,-.6),110,2),('rim',(0,.4,-1.2),140,1.5)]:
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);scene.collection.objects.link(o);o.location=xyz(loc);o.rotation_euler=(xyz((0,.04,-.1))-o.location).to_track_quat('-Z','Y').to_euler()
for name,direction in [('hero',(1,.35,1)),('left',(-1,.03,0)),('right',(1,.03,0)),('top',(0,1,.02)),('feed_detail',(-1,.3,.4))]:
    d=bpy.data.cameras.new(name);o=bpy.data.objects.new(name,d);scene.collection.objects.link(o)
    center=xyz((0,.035,-.10));rotation=xyz(direction).to_track_quat('Z','Y');o.rotation_euler=rotation.to_euler();o.location=center+rotation@Vector((0,0,2))
    d.type='ORTHO';d.ortho_scale=1.12
    if name=='hero':scene.camera=o
scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=48;scene.eevee.use_raytracing=False
scene.render.resolution_x=1600;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.film_transparent=True;scene.view_settings.view_transform='AgX'
scene['clips']=json.dumps(clips)
notes=bpy.data.texts.new('START HERE');notes.write('FN EVOLYS 7.62 / CURRENT STOCK / RMR / NO BIPOD\nOriginal game art, not a scan or certified CAD. Reference/photo caveats are in README.md.\nEight weapon/wrist/finger clips at 120 fps; belt_rig is a single batched skinned linked belt.\nShared review skins are not exported. Runtime ammunition controls belt-tail visibility.\nPacked original PBR maps. Select matching NLA tracks on every control and arm for review.\nRegeneration overwrites manual edits.\n')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'fn-evolys-762.blend'))
# Exporter samples NLA independently. Static child transforms must not bake a
# scale-zero spare pose into every descendant, as documented by the M4 checks.
for o in bpy.data.objects:
    if o.animation_data:
        for t in o.animation_data.nla_tracks:t.mute=True
scene.frame_set(0)
for o in (pouch,spare):o.scale=(1,1,1)
bpy.context.view_layer.update();bpy.ops.object.select_all(action='DESELECT')
for o in asset.objects:o.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.export_scene.gltf(filepath=str(OUT/'fn-evolys-762.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_optimize_animation_keep_anim_object=True,export_sampling_interpolation_fallback='LINEAR',export_extras=True,export_yup=True,export_cameras=False,export_lights=False)
path=OUT/'fn-evolys-762.glb';raw=path.read_bytes();length=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+length]);binary=bytearray(raw[20+length:])
# Preserve fractional 700-rpm endpoints without speeding/slowing the gameplay.
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
manifest={'asset':'FN EVOLYS 7.62 / revised stock / RMR RM06 RM33 / 100-round pouch / no bipod','units':'metres','clips':clips,'stats':stats,'textureResolution':1024,'belt':{'rounds':8,'pitch':.0127,'fireDuration':60/700,'rig':'belt_rig'},'dimensions':{'barrel':.406,'retractedOverall':.948,'barrelFace':breech,'barrelCrown':barrel_end,'muzzle':crown},'source':'tools/blender/evolys_762.py + evolys_actions.py + tools/evolys-hand-reference.mjs'}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
assert stats['triangles']<150000 and stats['primitives']<=48 and stats['materials']<=18 and stats['images']==3 and len(raw)<=15*1024*1024,stats
print('EVOLYS export:',json.dumps(stats))
# Texture originals are packed in .blend and embedded in .glb; not duplicate assets.
for name in ('evolys_surface.png','evolys_roughness.png','evolys_normal.png'):(OUT/name).unlink(missing_ok=True)
