"""Manufacturer-reference 590A1 SKU50774 exterior. Game metres, -Z forward.
blender -b --threads 8 --python-exit-code 1 --python tools/blender/m590.py
Optional -- --render-dir=/tmp/issue410-review/after. No runtime dependency.
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
sys.path.insert(0,str(Path(__file__).resolve().parent))
from m590_actions import author_actions
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'assets/weapons/m590';OUT.mkdir(parents=True,exist_ok=True)
p=argparse.ArgumentParser();p.add_argument('--render-dir',type=Path)
args=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1;scene.render.fps=120
asset=bpy.data.collections.new('M590 | authored components');scene.collection.children.link(asset)
studio=bpy.data.collections.new('STUDIO | excluded from export');scene.collection.children.link(studio)
C=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
def xyz(v):return C@Vector(v)
def active(o):
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
def empty(name,loc=(0,0,0),parent=None):
    o=bpy.data.objects.new(name,None);asset.objects.link(o);o.parent=parent;o.location=xyz(loc);o.empty_display_size=.008;return o
# Factory SKU50774: manufacturer nominal anchors, not old game-art scale.
OAL=39.5*.0254;BARREL=18.5*.0254;LOP=13.875*.0254
trigger_patch=Vector((0,.010,-.006));butt_y=-.0456
butt_z=trigger_patch.z+math.sqrt(LOP**2-(butt_y-trigger_patch.y)**2)
butt_heel=butt_z+.006;muzzle_z=butt_heel-OAL;breech_z=muzzle_z+BARREL
rig=empty('M590_RIG');body=empty('receiver',parent=rig)
forend=empty('forend',parent=rig);bolt=empty('bolt',(0,.068,breech_z+.024),rig)
trigger=empty('trigger',(0,.022,-.002),rig);shell=empty('shell_insert',parent=rig)
empty('DATUM_closed_breech',(0,.068,breech_z),rig)
empty('DATUM_trigger_face',trigger_patch,rig)
empty('DATUM_butt_center',(0,butt_y,butt_z),rig)
bpy.context.view_layer.update()
# Three original packed 1K maps. Materials share maps; metalness stays binary.
rng=np.random.default_rng(590);N=1024
noise=rng.random((N,N)).astype(np.float32)
def image(name,rgb,color=False):
    im=bpy.data.images.new(name,width=N,height=N,alpha=False)
    im.colorspace_settings.name='sRGB' if color else 'Non-Color'
    a=np.ones((N,N,4),dtype=np.float32);a[:,:,:3]=rgb;im.pixels.foreach_set(a.ravel());im.pack();return im
albedo=image('m590-surface',np.repeat((.87+noise*.10)[:,:,None],3,axis=2),True)
rough=image('m590-roughness',np.repeat((.85+noise*.12)[:,:,None],3,axis=2))
h=(noise+np.roll(noise,1,0)+np.roll(noise,1,1))/3
dx=(np.roll(h,-1,1)-np.roll(h,1,1))*.18;dy=(np.roll(h,-1,0)-np.roll(h,1,0))*.18
normal=np.dstack((-dx,-dy,np.ones_like(dx)));normal/=np.linalg.norm(normal,axis=2,keepdims=True)
nmap=image('m590-normal',normal*.5+.5)
def material(name,color,metal,roughness):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*color,1)
    n,l=m.node_tree.nodes,m.node_tree.links;p=n.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=roughness
    t=n.new('ShaderNodeTexImage');t.image=albedo
    mix=n.new('ShaderNodeMix');mix.data_type='RGBA';mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[7].default_value=(*color,1)
    l.new(t.outputs[0],mix.inputs[6]);l.new(mix.outputs[2],p.inputs['Base Color'])
    t=n.new('ShaderNodeTexImage');t.image=rough;s=n.new('ShaderNodeSeparateColor');l.new(t.outputs[0],s.inputs[0])
    mul=n.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=roughness;l.new(s.outputs[1],mul.inputs[0]);l.new(mul.outputs[0],p.inputs['Roughness'])
    t=n.new('ShaderNodeTexImage');t.image=nmap;nm=n.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.25;l.new(t.outputs[0],nm.inputs['Color']);l.new(nm.outputs[0],p.inputs['Normal']);return m
steel=material('01 | parkerized steel',(.027,.031,.035),1,.72)
receiver_finish=material('07 | anodized aluminium',(.022,.024,.027),1,.80)
polymer=material('02 | moulded black polymer',(.026,.031,.035),0,.79)
rubber=material('03 | textured rubber',(.016,.020,.024),0,.91)
wear=material('04 | burnished steel',(.16,.18,.20),1,.48)
brass=material('05 | brass shell head',(.48,.29,.09),1,.36)
red=material('06 | red hull',(.28,.032,.019),0,.62)
def smooth_rows(rows,closed=False):
    # Catmull-Rom only for the photographed stock/guard contours; no global subdivision.
    result=[];n=len(rows)
    for i in range(n if closed else n-1):
        a=rows[(i-1)%n] if closed else rows[max(0,i-1)]
        b=rows[i];c=rows[(i+1)%n];d=rows[(i+2)%n] if closed else rows[min(n-1,i+2)]
        for step in range(4):
            u=step/4
            result.append(tuple(.5*(2*b[k]+(-a[k]+c[k])*u+(2*a[k]-5*b[k]+4*c[k]-d[k])*u*u+(-a[k]+3*b[k]-3*c[k]+d[k])*u*u*u) for k in range(len(b))))
    if not closed:result.append(rows[-1])
    return result
def finish(o,name,mat=steel,parent=body,bevel=.0006,rounded=False):
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

def box(name,loc,dims,mat=steel,parent=body,bevel=.0006):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(loc));o=bpy.context.object;o.dimensions=(dims[0],dims[2],dims[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,name,mat,parent,bevel)
def mesh(name,verts,faces,mat=steel,parent=body,bevel=.0006,rounded=False):
    d=bpy.data.meshes.new(name);d.from_pydata([xyz(v) for v in verts],[],faces);d.update();o=bpy.data.objects.new(name,d);asset.objects.link(o)
    active(o);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
    return finish(o,name,mat,parent,bevel,rounded)
def loft(name,rings,mat=steel,parent=body,bevel=.0006,rounded=True):
    n=len(rings[0]);faces=[tuple(range(n-1,-1,-1)),tuple(range((len(rings)-1)*n,len(rings)*n))]
    faces += [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(rings)-1) for i in range(n)]
    return mesh(name,[v for ring in rings for v in ring],faces,mat,parent,bevel,rounded)
def profile(name,points,width,mat=steel,parent=body,bevel=.0006,x=0,rounded=False):
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
# Hollow receiver, not a dark decal masquerading as the two service openings.
section=[(-.019,.022),(.019,.022),(.020,.065),(.0185,.076),(.013,.083),(0,.085),(-.013,.083),(-.0185,.076),(-.020,.065)]
receiver=loft('590A1 receiver forging',[[(x,y-max(0,y-.065)/.020*drop,z) for x,y in section] for z,drop in ((.025,.009),(.012,.006),(-.005,.002),(-.025,0),(-.194,0))],receiver_finish,bevel=.0012,rounded=True)
cut(receiver,box('CUT receiver chamber',(0,.0525,-.089),(.030,.050,.199),None,None,0))
cut(receiver,box('CUT ejection window',(.019,.063,-.132),(.016,.022,.072),None,None,.002),True)
cut(receiver,box('CUT loading opening',(0,.024,-.068),(.023,.016,.080),None,None,0))
cut(receiver,cyl('CUT loading-to-tube channel',(0,.0348,-.152),.0096,.170,None,None,'Z',48,0))
for x in (-.0132,.0132):cut(receiver,box('CUT action bar channel',(x,.040,-.190),(.0034,.006,.018),None,None,0))
box('Rear tang',(0,.067,.031),(.029,.018,.020),bevel=.002)
box('Tang safety',(0,.084,.023),(.010,.004,.020),polymer,bevel=.001)
for z,y in ((-.017,.045),(-.027,.032)):
    cyl('Trigger plate cross pin',(0,y,z),.0024,.040,wear,axis='X')
box('Action release button',(-.021,.019,.004),(.003,.008,.014),polymer)
# Original editable rollmark, no downloaded decals.
d=bpy.data.curves.new('M590A1 rollmark','FONT');d.body='590A1  12 GA';d.size=.0026;d.extrude=.000025
o=bpy.data.objects.new('M590A1 left rollmark',d);asset.objects.link(o);o.location=xyz((-.0201,.061,-.033))
o.rotation_euler=Matrix((xyz((0,0,1)),xyz((0,1,0)),xyz((-1,0,0)))).transposed().to_euler()
o.data.materials.append(wear);o.parent=body
active(o);bpy.ops.object.convert(target='MESH')
# Physical cavity surfaces remain open; elevator is above the belly mouth.
box('Elevator shelf',(0,.075,-.068),(.018,.002,.055),steel,bevel=.0003)
box('Bolt carrier',(0,.068,breech_z+.024),(.020,.019,.048),wear,bolt,.001)
cyl('Bolt face',(0,.068,breech_z+.002),.0092,.004,wear,bolt,axis='Z')
# Nominal barrel is closed-breech to muzzle; exposed portion starts at receiver nose.
tube('Heavy barrel',(0,.068,(muzzle_z+breech_z)/2),.0129,.0093,BARREL)
tube('Barrel crown',(0,.068,muzzle_z+.002),.0129,.0093,.004)
tube('Magazine tube',(0,.0348,(-.175+muzzle_z+.012)/2),.013,.0095,-muzzle_z-.012-.175)
cyl('Threaded clean-out cap',(0,.0348,muzzle_z+.022),.0142,.020,steel,axis='Z')
for i in range(16):
    a=i*math.tau/16
    box('Cap fluting',(.0142*math.cos(a),.0348+.0142*math.sin(a),muzzle_z+.046),(.001,.001,.010),steel,bevel=.0001)
box('Barrel lug',(0,.052,muzzle_z+.100),(.020,.030,.024),bevel=.002)
cyl('Barrel lug screw',(0,.052,muzzle_z+.100),.003,.025,steel,axis='X')
# Factory ghost ring at receiver rear, ramp-mounted post near the muzzle.
profile('Ghost ring foot',[(-.120,.084),(-.047,.084),(-.050,.090),(-.100,.090)],.020,bevel=.0007)
ghost=tube('Ghost ring aperture',(0,.096,-.058),.0075,.0048,.0055,axis='Z')
for x in (-.010,.010):profile('Rear sight protective ear',smooth_rows([(-.105,.085),(-.052,.085),(-.052,.098),(-.046,.103),(-.048,.107),(-.052,.108),(-.056,.107),(-.062,.099),(-.069,.091),(-.090,.089),(-.100,.087)],True),.0025,x=x,bevel=.0006)
profile('Front sight pedestal',[(muzzle_z+.060,.080),(muzzle_z+.009,.080),(muzzle_z+.014,.089),(muzzle_z+.035,.089)],.014,bevel=.001)
box('Front sight blade',(0,.088,muzzle_z+.020),(.0026,.016,.0032),wear,bevel=.00015)
for x in (-.008,.008):profile('Front sight protective ear',[(muzzle_z+.028,.081),(muzzle_z+.009,.081),(muzzle_z+.009,.099),(muzzle_z+.017,.101),(muzzle_z+.028,.088)],.0025,x=x,bevel=.0006)
# Fixed conventional stock, neck/comb/toe loft; no pistol grip or adjustable tube.
guard=profile('Metal trigger guard',smooth_rows([(-.050,.022),(-.028,.022),(.012,.022),(.025,.015),(.026,.004),(.022,-.006),(.012,-.012),(-.025,-.011),(-.039,-.008),(-.047,.001)],True),.014,bevel=.001)
cut(guard,box('CUT trigger window',(0,.006,-.011),(.026,.025,.054),None,None,.007),True)
profile('Curved trigger',smooth_rows([(-.002,.022),(-.006,.014),(-.006,.010),(-.010,.004),(-.015,.002),(-.017,.000),(-.013,.0005),(-.009,.002),(-.003,.008),(-.003,.014),(.001,.022)],True),.005,wear,trigger,.0002)
stock_rings=[]
for z,top,bottom,width in smooth_rows([(.025,.078,.019,.031),(.042,.071,.005,.034),(.066,.060,-.039,.034),(.085,.053,-.046,.037),(.108,.045,-.022,.039),(.130,.039,-.017,.043),(.180,.035,-.040,.046),(.240,.031,-.070,.047),(.310,.027,-.103,.048)]):
    centre=(top+bottom)/2;radius=(top-bottom)/2
    stock_rings.append([(width/2*math.sin(a),centre+radius*math.cos(a),z) for a in [i*math.tau/16 for i in range(16)]])
def butt_ring(offset):
    return [(.025*math.sin(a),butt_y+.068*math.cos(a),butt_z+.006*math.cos(a)+offset) for a in [i*math.tau/16 for i in range(16)]]
stock_rings.append(butt_ring(-.012))
loft('Conventional synthetic stock',stock_rings,polymer,bevel=.0015,rounded=True)
loft('Rubber buttpad',[butt_ring(-.012),butt_ring(0)],rubber,bevel=.0007,rounded=True)
for x in (-.0205,.0205):
    for i in range(12):
        y=-.105+i*.010;z=butt_z+.006*(y-butt_y)/.068-.007
        box('Buttpad vent',(x,y,z),(.009,.004,.004),polymer,bevel=.0007)
cyl('Stock sling stud',(0,-.081,.255),.0025,.009,steel,axis='Y')
tube('Stock sling eye',(0,-.087,.255),.004,.0025,.003,steel,axis='X',sides=24)
# Factory full bottom / twin short side Picatinny rails and ribbed tri-rail forend.
slide=loft('Factory ribbed slide',[[(r*math.cos(a),.0348+r*math.sin(a),z) for a in [i*math.tau/48 for i in range(48)]] for z,r in [(-.499,.019),(-.493,.0225),(-.304,.0225),(-.295,.0215),(-.289,.0185)]],polymer,forend,bevel=.0007)
cut(slide,cyl('CUT slide bore',(0,.0348,-.394),.014,.216,None,None,'Z',48,0))
for i in range(14):
    rib=tube('Forend grip rib',(0,.0348,-.301-i*.009),.0245,.0215,.005,polymer,forend)
    rib.modifiers['Selective edge radius'].width=.0012;rib.modifiers['Selective edge radius'].segments=3
for x in (-.0132,.0132):box('Twin action bar',(x,.040,-.290),(.0024,.004,.280),steel,forend,.0005)
box('Bottom rail spine',(0,.012,-.394),(.023,.008,.202),polymer,forend,.001)
for i in range(18):box('Bottom Picatinny lug',(0,.006,-.298-i*.0107),(.023,.004,.005),polymer,forend,.0006)
for x in (-.023,.023):
    box('Side rail spine',(x,.035,-.458),(.006,.017,.074),polymer,forend,.001)
    for i in range(7):box('Side Picatinny lug',(x,.035,-.428-i*.0107),(.009,.021,.005),polymer,forend,.0006)
# Crown/barrel clearance remains a genuine open scallop throughout the stroke.
for o in list(asset.objects):
    if o.type=='MESH' and (o.name.startswith('Factory ribbed slide') or o.name.startswith('Forend grip rib')):
        cut(o,cyl('CUT pump barrel clearance',(0,.068,-.394),.0136,.290,None,None,'Z',48,0))
# Insertion hull is a base datum with body extending 70mm forward (-Z).
cyl('Red shell hull',(0,0,-.041),.00906,.058,red,shell,axis='Z',sides=32)
cyl('Brass shell head',(0,0,-.006),.010,.012,brass,shell,axis='Z')
cyl('Shell rim',(0,0,-.001),.01105,.002,brass,shell,axis='Z')
cyl('Shell primer',(0,0,.0001),.0026,.0002,wear,shell,axis='Z',sides=16)
sockets={'muzzle':[0,.068,muzzle_z],'ejection':[.0205,.063,-.132],'sight':[0,.096,-.058],
         'loading':[0,.024,-.068],'chamber':[0,.068,breech_z]}
for name,pos in sockets.items():empty('SOCKET_'+name,pos,rig)
def surface_uv(o):
    # Deterministic planar UVs; no randomized island packer or primitive UVs.
    for layer in list(o.data.uv_layers):o.data.uv_layers.remove(layer)
    uv=o.data.uv_layers.new(name='Surface UV')
    for face in o.data.polygons:
        axis=max(range(3),key=lambda i:abs(face.normal[i]));axes=[i for i in range(3) if i!=axis]
        for loop in face.loop_indices:
            v=o.data.vertices[o.data.loops[loop].vertex_index].co
            uv.data[loop].uv=(v[axes[0]]*8,v[axes[1]]*8)
for o in list(asset.objects):
    if o.type=='MESH':surface_uv(o)
clips,controls,hands=author_actions(ROOT,asset,rig,[rig,body,forend,bolt,trigger,shell],forend,bolt,trigger,shell)
scene['clips']=json.dumps(clips);scene['basis']='game (x,y,z) -> Blender (x,-z,y); export_yup=True'
scene.frame_start=0;scene.frame_end=360

def pose(name,t=0):
    for o in scene.objects:
        if o.animation_data:
            o.animation_data.action=None
            for track in o.animation_data.nla_tracks:track.mute=track.name!=name
    f=t*120;scene.frame_set(math.floor(f),subframe=f-math.floor(f));bpy.context.view_layer.update()
def aim(o,target):o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
def camera(name,loc,target,scale):
    d=bpy.data.cameras.new(name);d.type='ORTHO';d.ortho_scale=scale
    o=bpy.data.objects.new(name,d);studio.objects.link(o);o.location=xyz(loc);aim(o,xyz(target));return o
cams={
    'hero':camera('hero',(.65,.40,.95),(0,.025,-.13),1.25),
    'left':camera('left',(-1.5,.03,-.14),(0,.03,-.14),1.12),
    'right':camera('right',(1.5,.03,-.14),(0,.03,-.14),1.12),
    'loading':camera('loading',(-.32,-.35,.22),(0,.03,-.04),.38),
    'hands':camera('hands',(-.40,.25,.14),(0,.00,-.20),.85),
    'sights':camera('sights',(0,.096,.14),(0,.096,muzzle_z),.070),
}
for name,pos,power,color,size in [('Key',(-.3,.7,-.1),80,(1,.92,.83),.8),('Fill',(.4,.3,.2),50,(.82,.9,1),.6),('Rim',(.1,.3,-.6),65,(1,1,1),.5)]:
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.color=color;d.size=size
    o=bpy.data.objects.new(name,d);studio.objects.link(o);o.location=xyz(pos);aim(o,xyz((0,.03,-.12)))
scene.world.color=(.12,.12,.12);scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=32
scene.render.resolution_x=1600;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False;scene.view_settings.view_transform='AgX';scene.view_settings.exposure=-1.8
scene.camera=cams['hero'];pose('Idle')
notes=bpy.data.texts.new('M590_README');notes.write('Factory590A1 SKU50774 exterior reconstruction, metres. Manufacturer nominal OAL1003.3mm / barrel469.9mm / LOP352.425mm; local profiles remain photo estimates. Native seven NLA actions.\nSelect matching NLA tracks on all objects; review skins excluded from GLB.89mm stroke is provisional, not certified factory travel.\nRuntime owns reactive recoil and live casing pools; this asset has no Fire action or spent case.\n')
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'m590.blend'),compress=True)
if args.render_dir:
    args.render_dir.mkdir(parents=True,exist_ok=True)
    hc=bpy.data.collections['M590 | authored hands (shared appearance)'];hc.hide_render=True
    for name,cam in cams.items():
        scene.camera=cam;scene.render.filepath=str(args.render_dir/(name+'.png'));bpy.ops.render.render(write_still=True)
    hc.hide_render=False;scene.camera=cams['hands']
    for name,times in {'Pump':[0,.144,.2475,.369,.45],'Reload_Tactical':[0,.187,.32,.451,.462,.55],
                       'Reload_Empty':[.209,.418,.57,.646,.665,.741,.836,.8835,.95],'Inspect':[.6,1.6,2.4]}.items():
        for t in times:
            pose(name,t);scene.render.filepath=str(args.render_dir/f'{name}-{t:.4f}.png');bpy.ops.render.render(write_still=True)
# Restore identity/scale-one parents before copying, including the hidden hull.
for o in scene.objects:
    if o.animation_data:
        for track in o.animation_data.nla_tracks:track.mute=True
scene.frame_set(0)
for o in [rig,body,forend,shell]:o.location=(0,0,0);o.rotation_quaternion=(1,0,0,0);o.scale=(1,1,1)
bolt.location=xyz((0,.068,breech_z+.024));trigger.location=xyz((0,.022,-.002))
bpy.context.view_layer.update()
export=bpy.data.collections.new('EXPORT | evaluated copies');scene.collection.children.link(export)
copies={}
for o in list(asset.objects):
    clone=o.copy()
    if o.data:clone.data=o.data.copy()
    export.objects.link(clone);clone.parent=None;clone.matrix_world=o.matrix_world.copy();copies[o]=clone
for source,clone in copies.items():
    if source.parent:
        world=clone.matrix_world.copy();clone.parent=copies[source.parent];clone.matrix_world=world
for clone in list(export.objects):
    if clone.type!='MESH':continue
    active(clone)
    for mod in list(clone.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
    surface_uv(clone)
for parent in sorted({o.parent for o in export.objects if o.type=='MESH'},key=lambda o:o.name):
    group=[o for o in export.objects if o.type=='MESH' and o.parent==parent]
    active(group[0])
    for o in group:o.select_set(True)
    if len(group)>1:bpy.ops.object.join()
    joined=bpy.context.object;joined.name=parent.name.replace('.001','')+'_mesh'
    materials=list(joined.data.materials);unique=[];remap={}
    for i,m in enumerate(materials):
        if m not in unique:unique.append(m)
        remap[i]=unique.index(m)
    indices=[remap[p.material_index] for p in joined.data.polygons];joined.data.materials.clear()
    for m in unique:joined.data.materials.append(m)
    for polygon,i in zip(joined.data.polygons,indices):polygon.material_index=i
for source,clone in copies.items():
    if source.type=='EMPTY':source.name='SOURCE_'+source.name;clone.name=source.name.removeprefix('SOURCE_')
bpy.ops.object.select_all(action='DESELECT')
for o in export.objects:o.select_set(True)
bpy.context.view_layer.objects.active=copies[rig]
bpy.ops.export_scene.gltf(filepath=str(OUT/'m590.glb'),export_format='GLB',use_selection=True,
    export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,
    export_force_sampling=True,export_optimize_animation_keep_anim_object=True,
    export_sampling_interpolation_fallback='LINEAR',export_extras=True,export_yup=True,export_cameras=False,export_lights=False)
raw=(OUT/'m590.glb').read_bytes();length,kind=struct.unpack_from('<II',raw,12);assert kind==0x4e4f534a
j=json.loads(raw[20:20+length]);binary=bytearray(raw[20+length:])
def append_accessor(values,kind,width):
    offset=len(binary)-8;data=struct.pack('<'+'f'*len(values),*values);binary.extend(data)
    view=len(j['bufferViews']);j['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(data)})
    index=len(j['accessors']);accessor={'bufferView':view,'componentType':5126,'count':len(values)//width,'type':kind}
    if kind=='SCALAR':accessor.update(min=[min(values)],max=[max(values)])
    j['accessors'].append(accessor);return index
for animation in j['animations']:
    duration=clips[animation['name']]['duration']
    for sampler in animation['samplers']:
        acc=j['accessors'][sampler['input']];view=j['bufferViews'][acc['bufferView']]
        offset=8+view.get('byteOffset',0)+acc.get('byteOffset',0)+(acc['count']-1)*4
        assert abs(struct.unpack_from('<f',binary,offset)[0]-duration)<=1/120+.00001
        struct.pack_into('<f',binary,offset,duration);acc['max']=[duration]
    for channel in animation['channels']:
        # Zero-scale decomposition can erase a hidden hull's orientation. Read
        # its authored quaternion directly so the first visible fractional beat
        # has the same rigid grip as the wrist, not a one-frame spin-in.
        if j['nodes'][channel['target']['node']]['name']=='shell_insert' and channel['target']['path']=='rotation':
            sampler=animation['samplers'][channel['sampler']]
            times=j['accessors'][sampler['input']];tv=j['bufferViews'][times['bufferView']]
            output=j['accessors'][sampler['output']];ov=j['bufferViews'][output['bufferView']]
            for i in range(times['count']):
                time=struct.unpack_from('<f',binary,8+tv.get('byteOffset',0)+times.get('byteOffset',0)+i*4)[0]
                pose(animation['name'],time)
                q=(C.inverted()@shell.rotation_quaternion.to_matrix()@C).to_quaternion()
                offset=8+ov.get('byteOffset',0)+output.get('byteOffset',0)+i*16
                struct.pack_into('<4f',binary,offset,q.x,q.y,q.z,q.w)
        if channel['target']['path']=='scale':
            sampler=animation['samplers'][channel['sampler']];sampler['interpolation']='STEP'
            if j['nodes'][channel['target']['node']]['name']=='shell_insert' and animation['name'].startswith('Reload'):
                empty_reload=animation['name']=='Reload_Empty'
                times=[0,(.44 if empty_reload else .34)*duration,(.70 if empty_reload else .84)*duration,duration]
                sampler['input']=append_accessor(times,'SCALAR',1)
                sampler['output']=append_accessor([0,0,0,1,1,1,0,0,0,0,0,0],'VEC3',3)
# Visibility has fractional keys too: keep its exact beats, not rounded video frames.
j['buffers'][0]['byteLength']=len(binary)-8;struct.pack_into('<I',binary,0,len(binary)-8)
encoded=json.dumps(j,separators=(',',':')).encode();encoded+=b' '*(-len(encoded)%4)
raw=struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(binary))+struct.pack('<I4s',len(encoded),b'JSON')+encoded+binary
(OUT/'m590.glb').write_bytes(raw)
triangles=sum(j['accessors'][p['indices']]['count']//3 for n in j['nodes'] if 'mesh' in n for p in j['meshes'][n['mesh']]['primitives'])
stats={'triangleInstances':triangles,'primitives':sum(len(m['primitives']) for m in j['meshes']),
       'materials':len(j['materials']),'images':len(j['images']),'bytes':len(raw)}
assert triangles<110000 and stats['primitives']<=40 and stats['materials']<=16 and stats['images']==3 and len(raw)<=10*1024*1024,stats
pose('Idle')
vertices=[C.inverted().to_4x4()@rig.matrix_world.inverted()@o.matrix_world@v.co for o in asset.objects if o.type=='MESH' and o.parent!=shell for v in o.data.vertices]
bounds=[[min(v[i] for v in vertices) for i in range(3)],[max(v[i] for v in vertices) for i in range(3)]]
ref=json.loads((OUT/'hand-reference.json').read_text())
manifest={'asset':'Mossberg 590A1 Tactical SKU50774 (2016) / 18.5-inch / 6+1 / ghost ring / fixed synthetic stock / tri-rail',
    'status':'Asset candidate; runtime not integrated; human visual/gameplay approval pending',
    'units':'metres','blenderForward':'+Y','blenderUp':'+Z','runtimeBasis':'-Z forward / +Y up / +X right; no adapter basis transform',
    'source':'tools/blender/m590.py + m590_actions.py + tools/m590-hand-reference.mjs','stats':stats,'clips':clips,
    'aliases':{'pump':'Pump','reloadTac':'Reload_Tactical','reloadEmpty':'Reload_Empty','inspect':'Inspect','draw':'Draw','holster':'Holster'},
    'textures':{'resolution':1024,'packed':True,'embedded':True,'method':'original deterministic surface maps; no photographic inputs'},
    'dimensions':{'sourceBounds':bounds,'caseLength':.07,'rimRadius':.01105,'barrelLength':BARREL,'exposedBarrelLength':-.194-muzzle_z,'overallLength':OAL,'lengthOfPull':LOP,'nominalBarrelInches':18.5,
                  'triggerFace':list(trigger_patch),'buttCenter':[0,butt_y,butt_z],'closedBreech':[0,.068,breech_z]},
    'reference':{'manufacturer':'O.F. Mossberg & Sons','model':'590A1 Tactical','sku':'50774','year':2016,'stock':'fixed black synthetic, no positions',
                 'specification':'https://resources.mossberg.com/hubfs/press_releases/Mossberg-Introduces-7-Shot-Versions-of-590A1-and-590-PR-1-4-2016-FINAL.pdf',
                 'photoCatalog':'https://resources.mossberg.com/hubfs/eBook_PDF/Mossberg-2016-NewProducts.pdf','photoPage':2,'photoSide':'right/ejection'},
    'sockets':sockets,
    'ejectionDirection':[.84,.42,.28],'mechanism':{'stroke':ref['pump']['stroke'],'boltRest':[0,.068,breech_z+.024],'triggerPivot':[0,.022,-.002],'triggerPull':-.28},
    'shell':{'caseLen':.07,'rimR':.01105},'fxClass':'shotgun','opticGlass':None,'contactWindows':ref['contactWindows'],
    'notes':['Manufacturer nominal barrel/OAL/LOP anchors; local exterior profile estimates from catalog photograph, not manufacturing CAD.',
             'No exported arms, spent case, optic, baked shot recoil, or gameplay balance changes.',
             'shell_insert is not a detachable magazine; adapter owns visibility from authored scale.']}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('M590_EXPORT_STATS',json.dumps(stats))
