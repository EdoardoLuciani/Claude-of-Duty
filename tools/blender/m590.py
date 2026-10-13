"""Original M590A1 game-art source. Helpers accept game metres, -Z forward.
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
rig=empty('M590_RIG');body=empty('receiver',parent=rig)
forend=empty('forend',parent=rig);bolt=empty('bolt',(0,.068,-.017),rig)
trigger=empty('trigger',(0,.037,.0025),rig);shell=empty('shell_insert',parent=rig)
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
steel=material('01 | parkerized steel',(.053,.061,.069),1,.66)
polymer=material('02 | moulded black polymer',(.026,.031,.035),0,.79)
rubber=material('03 | textured rubber',(.016,.020,.024),0,.91)
wear=material('04 | burnished steel',(.16,.18,.20),1,.48)
brass=material('05 | brass shell head',(.48,.29,.09),1,.36)
red=material('06 | red hull',(.28,.032,.019),0,.62)
lens=material('07 | recessed lamp glass',(.12,.16,.18),0,.24)
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
section=[(-.0145,.0345),(.0145,.0345),(.0145,.080),(.014,.087),(.009,.093),(0,.095),(-.009,.093),(-.014,.087),(-.0145,.080)]
receiver=loft('590A1 receiver forging',[[(x,y,z) for x,y in section] for z in (.055,-.165)],bevel=.001,rounded=True)
cut(receiver,box('CUT receiver chamber',(0,.065,-.058),(.024,.047,.207),None,None,0))
cut(receiver,box('CUT ejection window',(.014,.071,-.072),(.015,.020,.058),None,None,0))
cut(receiver,box('CUT loading opening',(0,.038,-.055),(.023,.015,.074),None,None,0))
cut(receiver,cyl('CUT loading-to-tube channel',(0,.0446,-.106),.0096,.140,None,None,'Z',48,0))
for x in (-.0104,.0104):cut(receiver,box('CUT action bar channel',(x,.0506,-.163),(.0034,.006,.018),None,None,0))
box('Rear tang',(0,.069,.064),(.025,.024,.025),bevel=.0015)
box('Tang safety',(0,.095,.043),(.009,.004,.017),polymer,bevel=.0007)
for z in (.022,-.018):
    cyl('Trigger plate cross pin',(0,.063,z),.0027,.032,wear,axis='X')
box('Action release button',(.016,.052,.009),(.004,.009,.013),polymer)
# Original editable rollmark, no downloaded decals.
d=bpy.data.curves.new('M590A1 rollmark','FONT');d.body='M590A1  12 GA';d.size=.0026;d.extrude=.000025
o=bpy.data.objects.new('M590A1 left rollmark',d);asset.objects.link(o);o.location=xyz((-.0146,.070,-.010))
o.rotation_euler=Matrix((xyz((0,0,1)),xyz((0,1,0)),xyz((-1,0,0)))).transposed().to_euler()
o.data.materials.append(wear);o.parent=body
active(o);bpy.ops.object.convert(target='MESH')
# Physical cavity surfaces remain open; elevator is above the belly mouth.
box('Elevator shelf',(0,.077,-.056),(.018,.002,.055),steel,bevel=.0003)
box('Bolt carrier',(0,.068,-.017),(.017,.014,.048),wear,bolt,.0009)
cyl('Bolt face',(0,.068,-.045),.0088,.004,wear,bolt,axis='Z')
# Hollow heavy barrel/crown and 590 clean-out tube. Existing shorter game envelope.
tube('Heavy barrel',(0,.068,-.3225),.0112,.0093,.445)
tube('Barrel crown',(0,.068,-.543),.0116,.0093,.004)
tube('Magazine tube',(0,.0446,-.324),.0104,.0095,.362)
cyl('Threaded clean-out cap',(0,.0446,-.498),.0137,.016,steel,axis='Z')
for i in range(12):
    a=i*math.tau/12
    box('Cap fluting',(.0138*math.cos(a),.0446+.0138*math.sin(a),-.498),(.0012,.0012,.010),wear,bevel=.0002)
box('Barrel lug',(0,.057,-.477),(.016,.022,.022),bevel=.001)
cyl('Barrel lug screw',(0,.057,-.477),.0028,.019,wear,axis='X')
# Ghost-ring bore centered on the frozen sightline and matching front blade tip.
box('Ghost ring foot',(0,.094,-.137),(.022,.006,.020),bevel=.0005)
ghost=box('Ghost ring aperture',(0,.102,-.137),(.018,.018,.0055),bevel=.001)
cut(ghost,cyl('CUT sight aperture',(0,.102,-.137),.0048,.012,None,None,'Z',48,0))
for x in (-.010,.010):box('Rear sight protective ear',(x,.104,-.137),(.002,.020,.012),bevel=.0005)
box('Front sight pedestal',(0,.083,-.523),(.012,.006,.014),bevel=.0005)
box('Front sight blade',(0,.094,-.523),(.0026,.016,.0032),wear,bevel=.00015)
for x in (-.006,.006):box('Front sight protective ear',(x,.093,-.523),(.002,.019,.008),bevel=.0004)
# Open metal guard; sculpted near-vertical grip (front strap contacts firing pads).
guard=box('Metal trigger guard',(0,.020,-.004),(.0135,.030,.052),bevel=.002)
cut(guard,box('CUT trigger window',(0,.022,-.004),(.025,.022,.042),None,None,.001))
profile('Curved trigger',[(.006,.037),(.006,.030),(.005,.026),(-.001,.022),(-.004,.021)],.005,wear,trigger,.0003)
grip_rings=[]
for y,front,rear,width in [(.040,.006,.068,.030),(.032,.001,.064,.033),(.014,-.003,.048,.033),(-.003,.001,.051,.034),(-.025,-.003,.053,.034),(-.074,.012,.066,.030),(-.085,.018,.071,.033)]:
    x=width/2;r=.003
    grip_rings.append([(-x+r,y,front),(x-r,y,front),(x,y,front+r),(x,y,rear-r),(x-r,y,rear),(-x+r,y,rear),(-x,y,rear-r),(-x,y,front+r)])
loft('Sculpted pistol grip',grip_rings,polymer,bevel=.001,rounded=True)
# Local grip panels/checkering and seam: sparse geometry, not thousands of bumps.
for x in (-.0167,.0167):
    panel=box('Rubber grip side panel',(x,-.029,.038),(.0012,.064,.031),rubber,bevel=.0005)
    for i in range(7):box('Grip panel transverse groove',(x,-.003-i*.008,.038),(.0015,.0007,.026),polymer,bevel=.0001)
# Stock adapter, six-position extension and supported M4-style hollow web.
box('Stock adapter',(0,.069,.079),(.031,.034,.024),polymer,bevel=.002)
cyl('Receiver extension',(0,.069,.155),.012,.155,wear,axis='Z')
cyl('Castle nut',(0,.069,.093),.015,.009,steel,axis='Z')
box('Carbine stock cheek',(0,.066,.202),(.042,.036,.100),polymer,bevel=.003)
web=profile('Carbine stock structural web',[(.163,.056),(.248,.056),(.251,-.030),(.237,-.034),(.177,.008)],.021,polymer,bevel=.001)
cut(web,box('CUT stock web relief',(0,.015,.213),(.040,.023,.043),None,None,.002))
box('Rubber buttpad',(0,.015,.256),(.045,.114,.008),rubber,bevel=.002)
for i in range(9):box('Buttpad traction rib',(0,-.030+i*.011,.260),(.040,.002,.002),rubber,bevel=.0005)
for x in (-.023,.023):tube('Stock sling socket',(x,.054,.215),.0048,.003,.002,steel,axis='X',sides=24)
box('Stock latch',(0,.038,.176),(.028,.012,.032),polymer,bevel=.001)
for i in range(6):cyl('Stock adjustment detent',(0,.056,.103+i*.020),.0018,.002,steel,axis='Y',sides=12)
# The separate pump with hollow slide, clearance-limited stroke, twin action bars.
tube('SureFire ribbed slide',(0,.0446,-.295),.019,.0115,.180,polymer,forend)
for i in range(7):
    # Small ring ribs use the same contact envelope rather than inflating it.
    tube('Forend grip rib',(0,.0446,-.224-i*.024),.0198,.019,.003,rubber,forend)
for x in (-.0104,.0104):box('Twin action bar',(x,.0506,-.235),(.0024,.004,.260),steel,forend,.0003)
box('SureFire lamp housing',(0,.021,-.303),(.028,.026,.078),polymer,forend,.003)
tube('Lamp bezel',(0,.019,-.350),.0125,.0085,.017,steel,forend)
cyl('Recessed lamp lens',(0,.019,-.352),.0084,.001,lens,forend,axis='Z')
box('Left pressure switch',(-.020,.052,-.315),(.004,.012,.030),rubber,forend,.001)
# Scalloped barrel channel: the close axes cannot accommodate a full round slide.
for o in list(asset.objects):
    if o.type=='MESH' and (o.name.startswith('SureFire ribbed slide') or o.name.startswith('Forend grip rib')):
        cut(o,cyl('CUT pump barrel clearance',(0,.068,-.295),.0118,.250,None,None,'Z',48,0))
# Insertion hull is a base datum with body extending 70mm forward (-Z).
cyl('Red shell hull',(0,0,-.041),.00906,.058,red,shell,axis='Z',sides=32)
cyl('Brass shell head',(0,0,-.006),.010,.012,brass,shell,axis='Z')
cyl('Shell rim',(0,0,-.001),.01105,.002,brass,shell,axis='Z')
cyl('Shell primer',(0,0,.0001),.0026,.0002,wear,shell,axis='Z',sides=16)
for name,pos in {'muzzle':[0,.068,-.545],'ejection':[.0205,.071,-.072],'sight':[0,.102,-.137],
                 'loading':[0,.041,-.055],'chamber':[0,.068,-.072]}.items():empty('SOCKET_'+name,pos,rig)
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
    'hero':camera('hero',(.65,.40,.95),(0,.025,-.13),.95),
    'left':camera('left',(-1.5,.03,-.14),(0,.03,-.14),.94),
    'right':camera('right',(1.5,.03,-.14),(0,.03,-.14),.94),
    'loading':camera('loading',(-.32,-.35,.22),(0,.03,-.04),.38),
    'hands':camera('hands',(-.40,.25,.14),(0,.00,-.20),.56),
    'sights':camera('sights',(0,.102,.14),(0,.102,-.54),.070),
}
for name,pos,power,color,size in [('Key',(-.3,.7,-.1),80,(1,.92,.83),.8),('Fill',(.4,.3,.2),50,(.82,.9,1),.6),('Rim',(.1,.3,-.6),65,(1,1,1),.5)]:
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.color=color;d.size=size
    o=bpy.data.objects.new(name,d);studio.objects.link(o);o.location=xyz(pos);aim(o,xyz((0,.03,-.12)))
scene.world.color=(.12,.12,.12);scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=32
scene.render.resolution_x=1600;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False;scene.view_settings.view_transform='AgX';scene.view_settings.exposure=-1.8
scene.camera=cams['hero'];pose('Idle')
notes=bpy.data.texts.new('M590_README');notes.write('Original editable game art, metres. Native seven NLA actions on rigid parts/wrist/finger controls.\nSelect matching NLA tracks on all objects; review skins excluded from GLB. Source bounds are not manufacturer CAD.\nRuntime owns reactive recoil and live casing pools; this asset has no Fire action or spent case.\n')
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
bolt.location=xyz((0,.068,-.017));trigger.location=xyz((0,.037,.0025))
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
manifest={'asset':'M590A1 18.5-inch / 6+1 / ghost ring / SureFire-style forend / pistol grip / M4-style stock',
    'status':'Asset candidate; runtime not integrated; human visual/gameplay approval pending',
    'units':'metres','blenderForward':'+Y','blenderUp':'+Z','runtimeBasis':'-Z forward / +Y up / +X right; no adapter basis transform',
    'source':'tools/blender/m590.py + m590_actions.py + tools/m590-hand-reference.mjs','stats':stats,'clips':clips,
    'aliases':{'pump':'Pump','reloadTac':'Reload_Tactical','reloadEmpty':'Reload_Empty','inspect':'Inspect','draw':'Draw','holster':'Holster'},
    'textures':{'resolution':1024,'packed':True,'embedded':True,'method':'original deterministic surface maps; no photographic inputs'},
    'dimensions':{'sourceBounds':bounds,'caseLength':.07,'rimRadius':.01105,'visualBarrelLength':.445,'nominalBarrelInches':18.5},
    'sockets':{'muzzle':[0,.068,-.545],'ejection':[.0205,.071,-.072],'sight':[0,.102,-.137],'loading':[0,.041,-.055],'chamber':[0,.068,-.072]},
    'ejectionDirection':[.84,.42,.28],'mechanism':{'stroke':[0,0,.038],'boltRest':[0,.068,-.017],'triggerPivot':[0,.037,.0025],'triggerPull':-.28},
    'shell':{'caseLen':.07,'rimR':.01105},'fxClass':'shotgun','opticGlass':None,'contactWindows':ref['contactWindows'],
    'notes':['Original game art; inferred dimensions, not manufacturing CAD or certified 39.5-inch OAL.',
             'No exported arms, spent case, optic, baked shot recoil, or gameplay balance changes.',
             'shell_insert is not a detachable magazine; adapter owns visibility from authored scale.']}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('M590_EXPORT_STATS',json.dumps(stats))
