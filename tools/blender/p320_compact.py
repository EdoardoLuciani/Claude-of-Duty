"""P320 Compact game-art source, metres; +Y forward, +Z up, +X right.
blender -b --python-exit-code 1 --python tools/blender/p320_compact.py -- [--render] [--quick]
Original visual reconstruction, not manufacturing geometry. Reference board is
assets/weapons/p320-compact/REFERENCES.md. No downloaded model/texture content.
"""
import argparse
import json
import math
from pathlib import Path
import struct
import sys
import bpy
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/weapons/p320-compact'
sys.path.insert(0, str(Path(__file__).resolve().parent))
parser = argparse.ArgumentParser()
parser.add_argument('--render', action='store_true')
parser.add_argument('--quick', action='store_true')
parser.add_argument('--no-bake', action='store_true', help='Reuse existing atlas for geometry/animation iteration')
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
for sub in ('textures', 'renders'):
    (OUT/sub).mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.render.fps = 60
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.cycles.use_denoising = True
asset = bpy.data.collections.new('P320 | editable weapon')
scene.collection.children.link(asset)
studio = bpy.data.collections.new('STUDIO | excluded from export')
scene.collection.children.link(studio)

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

# Source shaders are baked to one shared unique-UV atlas: colour, ORM, normal.
# The atlas costs three 1024-square images, no more than the MCX surface maps.
materials = []
def material(name, color, rough=.6, metal=0, grain=0, stipple=False):
    m = bpy.data.materials.new(name); m.use_nodes = True
    m.diffuse_color = (*color,1)
    n, l = m.node_tree.nodes, m.node_tree.links
    p = n.get('Principled BSDF'); p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    uv = n.new('ShaderNodeTexCoord'); uv.object = coords
    noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 180
    noise.inputs['Detail'].default_value = 3; noise.inputs['Roughness'].default_value = .65
    l.new(uv.outputs['Object'], noise.inputs['Vector'])
    ramp = n.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = .2
    ramp.color_ramp.elements[0].color = (*(v*.95 for v in color),1)
    ramp.color_ramp.elements[1].position = .8
    ramp.color_ramp.elements[1].color = (*(v*1.04 for v in color),1)
    l.new(noise.outputs['Fac'],ramp.inputs[0]); l.new(ramp.outputs[0],p.inputs['Base Color'])
    rough_ramp = n.new('ShaderNodeMapRange')
    rough_ramp.inputs['From Min'].default_value = 0; rough_ramp.inputs['From Max'].default_value = 1
    rough_ramp.inputs['To Min'].default_value = rough-.075
    rough_ramp.inputs['To Max'].default_value = min(1,rough+.075)
    l.new(noise.outputs['Fac'],rough_ramp.inputs[0]); l.new(rough_ramp.outputs[0],p.inputs['Roughness'])
    micro = n.new('ShaderNodeTexNoise'); micro.inputs['Scale'].default_value = 4300 if not stipple else 1700
    micro.inputs['Detail'].default_value = 2.8; micro.inputs['Roughness'].default_value = .72
    l.new(uv.outputs['Object'],micro.inputs['Vector'])
    bump = n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = grain
    bump.inputs['Distance'].default_value = .00014 if not stipple else .00065
    l.new(micro.outputs['Fac'],bump.inputs['Height']); l.new(bump.outputs['Normal'],p.inputs['Normal'])
    # Faint cavity darkening baked explicitly into base. No drawn-on white edges.
    ao = n.new('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value = .004
    mix = n.new('ShaderNodeMixRGB'); mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = .32
    l.new(ramp.outputs[0],mix.inputs[1]); l.new(ao.outputs['Color'],mix.inputs[2])
    l.new(mix.outputs[0],p.inputs['Base Color'])
    materials.append(m)
    return m

nitron = material('Nitron | satin coated steel',(.033,.036,.039),.53,0,.24)
polymer = material('Frame | fine injection moulding',(.026,.028,.030),.72,0,.48)
stipple = material('Grip | moulded pebbled texture',(.017,.019,.020),.86,0,.8,True)
steel = material('Controls | blackened steel',(.041,.043,.045),.52,.38,.18)
barrel_mat = material('Barrel | polished nitriding',(.061,.065,.070),.29,.72,.12)
mag_mat = material('Magazine | blued stamped steel',(.033,.039,.044),.37,.75,.18)
cavity = material('Recess | shadowed coating',(.007,.008,.009),.86,0,.12)
mark = material('Laser etching | subtle warm grey',(.18,.18,.17),.65,.15,.08)
brass = material('Visible dummy round | brass',(.38,.22,.07),.33,1,.1)
copper = material('Visible dummy round | copper',(.30,.105,.045),.32,1,.1)
white = material('SIGLITE | white surround',(.68,.69,.63),.58,0,.05)


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
bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=1,location=(0,.025,.015))
o=bpy.context.object;o.scale=(.0044,.008,.0044);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
finish(o,'Magazine | round nose',copper,round_live,0,True)

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

atlas={}
for name,color in [('base',True),('orm',False),('normal',False)]:
    path=OUT/'textures'/f'p320-{name}.png'
    if args.no_bake and path.exists(): im=bpy.data.images.load(str(path),check_existing=False)
    else:
        im=bpy.data.images.new('P320_'+name,width=1024,height=1024,alpha=False)
        im.generated_color=(.5,.5,1,1) if name=='normal' else (1,1,1,1)
    im.colorspace_settings.name='sRGB' if color else 'Non-Color';atlas[name]=im
if not args.no_bake:
    scene.render.bake.use_clear=False;scene.render.bake.margin=3
    # Emission bake preserves the authored base and packed metallic/roughness,
    # without baking studio illumination. Normal bake includes micro-bump.
    all_mats=materials+[tritium]
    for name in ('base','orm','normal'):
        for mat in all_mats:
            n,l=mat.node_tree.nodes,mat.node_tree.links;p=n.get('Principled BSDF');out=n.get('Material Output')
            target=n.get('ATLAS_TARGET') or n.new('ShaderNodeTexImage');target.name='ATLAS_TARGET';target.image=atlas[name];n.active=target
            if name=='normal':l.new(p.outputs[0],out.inputs['Surface']);continue
            emit=n.get('BAKE_EMIT') or n.new('ShaderNodeEmission');emit.name='BAKE_EMIT'
            if name=='base':
                socket=p.inputs['Base Color']
                if socket.is_linked:l.new(socket.links[0].from_socket,emit.inputs[0])
                else:emit.inputs[0].default_value=socket.default_value
            else:
                pack=n.new('ShaderNodeCombineColor');pack.inputs[0].default_value=1
                r=p.inputs['Roughness'];m=p.inputs['Metallic']
                if r.is_linked:l.new(r.links[0].from_socket,pack.inputs[1])
                else:pack.inputs[1].default_value=r.default_value
                pack.inputs[2].default_value=m.default_value
                l.new(pack.outputs[0],emit.inputs[0])
            l.new(emit.outputs[0],out.inputs['Surface'])
        active(bake_meshes[0])
        for o in bake_meshes:o.select_set(True)
        bpy.ops.object.bake(type='NORMAL' if name=='normal' else 'EMIT')
        im=atlas[name];im.filepath_raw=str(OUT/'textures'/f'p320-{name}.png');im.file_format='PNG';im.save()
    for mat in all_mats:mat.node_tree.links.new(mat.node_tree.nodes.get('Principled BSDF').outputs[0],mat.node_tree.nodes.get('Material Output').inputs[0])
for name,im in atlas.items():
    im.pack();im.filepath='//textures/p320-'+name+'.png'
# Standard glTF-compatible PBR shader, shared by every non-emissive component.
baked=bpy.data.materials.new('P320 | baked unique PBR');baked.use_nodes=True
n,l=baked.node_tree.nodes,baked.node_tree.links;p=n.get('Principled BSDF')
for name in ('base','orm','normal'):
    t=n.new('ShaderNodeTexImage');t.image=atlas[name]
    if name=='base':l.new(t.outputs[0],p.inputs['Base Color'])
    elif name=='normal':
        norm=n.new('ShaderNodeNormalMap');l.new(t.outputs[0],norm.inputs['Color']);l.new(norm.outputs[0],p.inputs['Normal'])
    else:
        sep=n.new('ShaderNodeSeparateColor');l.new(t.outputs[0],sep.inputs[0]);l.new(sep.outputs[1],p.inputs['Roughness']);l.new(sep.outputs[2],p.inputs['Metallic'])
for o in weapon_meshes:
    if o.data.materials[0]==tritium or o.name.startswith('Mark |'):continue
    o.data.materials.clear();o.data.materials.append(baked)
    for poly in o.data.polygons:poly.material_index=0
# Spare reuses the exact same geometry/UVs, not a second atlas island.
for o in list(asset.objects):
    if o.type=='MESH' and o.parent in (mag,round_live):
        clone=o.copy();clone.data=o.data;asset.objects.link(clone)
        clone.parent=spare if o.parent==mag else round_spare;clone.name=o.name+' | spare'

from p320_actions import author_actions
parts=[rig,slide,barrel,trigger,catch,mag,spare,round_live,round_spare]
clips,controls,hands=author_actions(ROOT,asset,rig,parts,mag,spare,slide,barrel,trigger,catch,round_live)
parts+=controls

def select_clip(name,frame=0):
    for o in parts+hands:
        if not o.animation_data:continue
        o.animation_data.action=None
        for t in o.animation_data.nla_tracks:t.mute=t.name!=name
    scene.frame_start=0;scene.frame_end=clips[name]['frames'][1];scene.frame_set(frame)
select_clip('Idle')

# Studio and inspection cameras. Photography comes from the actual saved asset.
scene.cycles.samples=24 if args.quick else 96
scene.world.use_nodes=True
bg=scene.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=(.20,.23,.28,1);bg.inputs[1].default_value=.35
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
scene.view_settings.exposure=-1.6
scene.render.resolution_x=1920;scene.render.resolution_y=1440
scene.render.resolution_percentage=60 if args.quick else 100
scene.render.image_settings.file_format='PNG'
def aim(o,target):o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
def camera(name,loc,target,scale):
    d=bpy.data.cameras.new(name);o=bpy.data.objects.new(name,d);studio.objects.link(o);o.location=loc
    d.type='ORTHO';d.ortho_scale=scale;aim(o,target);return o
cameras={
'hero':camera('CAM_hero',(-.36,.36,.20),(0,.030,-.009),.255),
'left-profile':camera('CAM_left_profile',(-.6,.035,-.012),(0,.035,-.012),.235),
'right-profile':camera('CAM_right_profile',(.6,.035,-.012),(0,.035,-.012),.235),
'rear-detail':camera('CAM_rear_detail',(-.13,-.30,.12),(0,-.018,.014),.18),
'first-person':camera('CAM_first_person',(.035,-.42,.12),(0,.04,.008),.35),
}
for name,loc,power,size,color in [('Key',(-.20,.10,.40),14,.34,(.89,.94,1)),('Rim',(.23,.08,.18),20,.28,(1,.85,.65)),('Fill',(-.15,-.30,.03),4,.25,(.72,.83,1))]:
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color
    o=bpy.data.objects.new(name,d);studio.objects.link(o);o.location=loc;aim(o,(0,.02,0))
scene.camera=cameras['hero']
# Weapon-only cameras keep the reusable hand skins hidden; review enables them.
for o in hands:
    if o.type=='MESH':o.hide_render=True
notes=bpy.data.texts.new('START HERE')
notes.write('P320 COMPACT / GAME ART\nReference-specific early-production exterior.\nEight weapon + wrist/finger NLA actions.\nHands use existing glove/sleeve meshes; authored deformation lives in this file.\nSelect the same clip on weapon controls and the two armatures.\nRuntime exports hand controls and reuses shared skins (no duplicated texture cost).\nRun tools/blender/p320_review.py for stills or an animation reel.\nUnique packed 1024 PBR atlas; studio is excluded from GLB.\nNot manufacturing geometry; not endorsed by SIG SAUER.\n')
scene['clips']=json.dumps(clips)
scene['hand_collection']='P320 | authored hands (shared appearance)'
for s in bpy.data.screens:
    for a in s.areas:
        if a.type=='VIEW_3D':a.spaces.active.region_3d.view_perspective='CAMERA'
active(rig)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'p320-compact.blend'))
if args.render:
    for name,cam in cameras.items():
        scene.camera=cam;scene.render.filepath=str(OUT/'renders'/f'{name}.png');bpy.ops.render.render(write_still=True)
# Export only weapon and light-weight animation controls, not duplicate arm skins.
select_clip('Idle',0)
for o in parts:
    if o.animation_data:
        for t in o.animation_data.nla_tracks:t.mute=True
    o.scale=(1,1,1)
bpy.context.view_layer.update()
# Merge by rigid part, retaining one atlas material per moving group.
for parent in [body,slide,barrel,trigger,catch,mag,spare,round_live,round_spare]:
    meshes=[o for o in asset.objects if o.type=='MESH' and o.parent==parent]
    if not meshes:continue
    active(meshes[0])
    for o in meshes:o.select_set(True)
    bpy.ops.object.join();bpy.context.object.name=parent.name+'_mesh'
for o in parts:
    if o.animation_data:
        for t in o.animation_data.nla_tracks:t.mute=False
bpy.ops.object.select_all(action='DESELECT')
for o in asset.objects:
    if o!=coords:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'p320-compact.glb'),export_format='GLB',use_selection=True,
    export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,
    export_frame_range=False,export_force_sampling=True,export_optimize_animation_keep_anim_object=True,
    export_sampling_interpolation_fallback='LINEAR',export_extras=True,export_yup=True,
    export_materials='EXPORT',export_cameras=False,export_lights=False)
p=OUT/'p320-compact.glb';raw=p.read_bytes();length=struct.unpack_from('<I',raw,12)[0]
doc=json.loads(raw[20:20+length])
for anim in doc['animations']:
    for ch in anim['channels']:
        if ch['target']['path']=='scale':anim['samplers'][ch['sampler']]['interpolation']='STEP'
encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*(-len(encoded)%4)
binary=raw[20+length:]
p.write_bytes(struct.pack('<4sII',b'glTF',2,20+len(encoded)+len(binary))+struct.pack('<I4s',len(encoded),b'JSON')+encoded+binary)
stats={'triangles':0,'vertices':0,'meshes':len(doc.get('meshes',[])),'primitives':0,'textureImages':len(doc.get('images',[]))}
for m in doc.get('meshes',[]):
    for primitive in m['primitives']:
        stats['primitives']+=1;stats['triangles']+=doc['accessors'][primitive['indices']]['count']//3
        stats['vertices']+=doc['accessors'][primitive['attributes']['POSITION']]['count']
manifest={'asset':'SIG P320 Nitron Compact | early-production visual reconstruction','units':'metres','blender_forward':'+Y','gltf_forward':'-Z','clips':clips,'stats':stats,
 'textureResolution':1024,'handAnimation':'Blender wrist and finger controls; shared runtime skins and shoulder IK',
 'source':'tools/blender/p320_compact.py + p320_actions.py + tools/p320-hand-reference.mjs',
 'notes':['Original non-functional game art, not a dimensionally exact replica.','No downloaded models or textures.','No endorsement by SIG SAUER.']}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('P320_EXPORT_COMPLETE',json.dumps(stats))
