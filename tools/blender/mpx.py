"""MPX Gate-2 exterior/material candidate. No animations or game integration yet.
blender -b --threads 8 --python-exit-code 1 --python tools/blender/mpx.py -- --render
Original reference-informed game art; never manufacturing geometry.
"""
import argparse
import json
import math
from pathlib import Path
import struct
import sys

import bpy
from mathutils import Vector
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/weapons/sig-mpx'
REVIEW = ROOT / '.tmp-rend/mpx/model'
parser = argparse.ArgumentParser()
parser.add_argument('--render', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
OUT.mkdir(parents=True, exist_ok=True)
REVIEW.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for m in list(bpy.data.materials):
    bpy.data.materials.remove(m)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.render.fps = 120
asset = bpy.data.collections.new('MPX | editable exterior components')
scene.collection.children.link(asset)
studio = bpy.data.collections.new('STUDIO | not exported')
scene.collection.children.link(studio)


def active(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def move(o, collection=asset):
    for c in list(o.users_collection):
        c.objects.unlink(o)
    collection.objects.link(o)
    return o


def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    asset.objects.link(o)
    o.location = loc
    o.parent = parent
    o.empty_display_size = .012
    return o


rig = empty('MPX_RIG')
rig['status'] = 'Gate 2 candidate; static; visual approval pending'
rig['coordinate_system'] = 'metres; Blender +X forward, +Z up, -Y right/ejection side'
body = empty('receiver', parent=rig)
mag = empty('magazine', parent=rig)
bolt = empty('bolt', parent=rig)
handle = empty('charging_handle', parent=rig)
selector = empty('selector', parent=rig)
trigger = empty('trigger', parent=rig)
stock = empty('stock_hinge', parent=rig)
release = empty('bolt_release', parent=rig)
bpy.context.view_layer.update()

# Three original, deterministic tileable PBR maps shared by material factors.
# No photographic texture or third-party mesh input. Tangent-space +Y normals.
N = 1024
rng = np.random.default_rng(0x4d5058)


def field(grid):
    small = rng.random((grid, grid)).astype(np.float32)
    xx = np.arange(N)*grid/N
    lo = xx.astype(int)
    t = xx-lo
    t = t*t*(3-2*t)
    a = small[lo[:, None] % grid, lo[None, :] % grid]
    b = small[(lo[:, None]+1) % grid, lo[None, :] % grid]
    c = small[lo[:, None] % grid, (lo[None, :]+1) % grid]
    d = small[(lo[:, None]+1) % grid, (lo[None, :]+1) % grid]
    return (a*(1-t[:, None])+b*t[:, None])*(1-t[None, :])+(c*(1-t[:, None])+d*t[:, None])*t[None, :]


def image(name, rgb, colour=False):
    im = bpy.data.images.new(name, width=N, height=N, alpha=False)
    im.colorspace_settings.name = 'sRGB' if colour else 'Non-Color'
    pixels = np.ones((N, N, 4), dtype=np.float32)
    pixels[:, :, :3] = rgb if rgb.ndim == 3 else rgb[:, :, None]
    im.pixels.foreach_set(pixels.ravel())
    texdir = OUT / 'textures'
    texdir.mkdir(exist_ok=True)
    im.filepath_raw = str(texdir / (name+'.png'))
    im.file_format = 'PNG'
    im.save()
    im.pack()
    im.filepath = '//textures/'+name+'.png'
    return im


cloud = field(9)*.4+field(43)*.35+field(137)*.25
fine = rng.random((N, N)).astype(np.float32)
height = field(241)*.65+fine*.35
scratches = np.zeros((N, N), dtype=np.float32)
for _ in range(130):
    x, y = rng.integers(0, N, 2)
    for i in range(int(rng.integers(3, 35))):
        scratches[(y+i//9) % N, (x+i) % N] = rng.uniform(.04, .2)
base_map = image('mpx-surface',np.clip(.91+cloud*.035+scratches*.055,0,1),True)
rough = np.clip(.85+cloud*.075+fine*.02-scratches*.10,0,1)
orm_map = image('mpx-orm', np.dstack((np.ones_like(rough), rough, np.ones_like(rough))))
dx = (np.roll(height, -1, 1)-np.roll(height, 1, 1))*.22
dy = (np.roll(height, -1, 0)-np.roll(height, 1, 0))*.22
norm = np.dstack((-dx, -dy, np.ones_like(dx)))
norm /= np.linalg.norm(norm, axis=2, keepdims=True)
normal_map = image('mpx-normal', norm*.5+.5)


def material(name, color, metal=0, roughness=.65, detail=.15):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = (*color, 1)
    nodes, links = m.node_tree.nodes, m.node_tree.links
    p = nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = roughness
    tex = nodes.new('ShaderNodeTexImage'); tex.image = base_map
    mix = nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
    mix.inputs[0].default_value = 1
    mix.inputs[7].default_value = (*color, 1)
    links.new(tex.outputs['Color'], mix.inputs[6])
    links.new(mix.outputs[2], p.inputs['Base Color'])
    tex = nodes.new('ShaderNodeTexImage'); tex.image = orm_map
    sep = nodes.new('ShaderNodeSeparateColor')
    links.new(tex.outputs['Color'], sep.inputs[0])
    mul = nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = roughness
    links.new(sep.outputs['Green'], mul.inputs[0]); links.new(mul.outputs[0], p.inputs['Roughness'])
    tex = nodes.new('ShaderNodeTexImage'); tex.image = normal_map
    nm = nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = detail
    links.new(tex.outputs['Color'], nm.inputs['Color']); links.new(nm.outputs['Normal'], p.inputs['Normal'])
    return m


alloy = material('01 | black anodized receiver', (.060, .065, .071), 1, .66, .13)
wear = material('02 | restrained exposed edge alloy', (.112, .117, .125), 1, .57, .1)
polymer = material('03 | black moulded polymer', (.030, .032, .035), 0, .84, .55)
rubber = material('04 | grip and butt rubber', (.022, .024, .026), 0, .94, 1)
steel = material('05 | black oxidized controls and fasteners', (.066, .072, .08), 1, .51, .18)
carrier = material('06 | satin steel carrier', (.18, .19, .21), 1, .48, .1)
canmat = material('07 | graphite suppressor finish', (.039, .041, .044), 0, .74, .32)
magmat = material('08 | smoked magazine polymer', (.052, .058, .062), 0, .54, .25)
markmat = material('09 | subdued laser marking', (.28, .29, .30), 0, .67, .03)
solar = material('10 | photovoltaic panel', (.033, .049, .075), 0, .31, .02)
glass = material('11 | coated optical glass', (.31, .40, .46), 0, .12, 0)
p = glass.node_tree.nodes.get('Principled BSDF')
p.inputs['Transmission Weight'].default_value = .94
p.inputs['IOR'].default_value = 1.45
p.inputs['Coat Weight'].default_value = .25
clear = material('12 | clear protective caps', (.35, .4, .42), 0, .16, 0)
p = clear.node_tree.nodes.get('Principled BSDF')
p.inputs['Transmission Weight'].default_value = .93
p.inputs['IOR'].default_value = 1.45


def finish(o, name, mat=alloy, parent=body, bevel=.0006, smooth=False):
    o.name = name
    move(o)
    if mat:
        o.data.materials.append(mat)
    if parent:
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
    if o.type == 'MESH':
        for f in o.data.polygons:
            f.use_smooth = smooth and len(f.vertices) == 4
    if bevel:
        mod = o.modifiers.new('Exterior edge radius', 'BEVEL')
        mod.width = bevel; mod.segments = 2; mod.harden_normals = True
        # Sparse brighter micro-chamfers, not continuous white wear outlines.
        mod = o.modifiers.new('Weighted machined normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
    return o


def box(name, loc, dims, mat=alloy, parent=body, bevel=.0006):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object; o.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(o, name, mat, parent, bevel)


def mesh(name, verts, faces, mat=alloy, parent=body, bevel=.0006, smooth=False):
    data = bpy.data.meshes.new(name); data.from_pydata(verts, [], faces); data.update()
    o = bpy.data.objects.new(name, data); asset.objects.link(o)
    active(o); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    return finish(o, name, mat, parent, bevel, smooth)


def loft(name, rings, mat=alloy, parent=body, bevel=.0006, smooth=True):
    n = len(rings[0])
    faces = [tuple(range(n-1, -1, -1)), tuple(range((len(rings)-1)*n, len(rings)*n))]
    faces += [(j*n+i, j*n+(i+1) % n, (j+1)*n+(i+1) % n, (j+1)*n+i)
              for j in range(len(rings)-1) for i in range(n)]
    return mesh(name, [p for ring in rings for p in ring], faces, mat, parent, bevel, smooth)


def profile(name, points, width, mat=alloy, parent=body, y=0, bevel=.0006, smooth=False):
    return loft(name, [[(x, y+s*width/2, z) for x, z in points] for s in (-1, 1)], mat, parent, bevel, smooth)


def cyl(name, loc, r, length, mat=steel, axis='X', parent=body, sides=32, bevel=.0003):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=r, depth=length, location=loc)
    o = bpy.context.object
    if axis == 'X': o.rotation_euler.y = math.pi/2
    if axis == 'Y': o.rotation_euler.x = math.pi/2
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return finish(o, name, mat, parent, bevel, True)


def cut(o, cutter):
    active(o)
    mod = o.modifiers.new('Actual exterior opening', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'; mod.solver = 'EXACT'; mod.object = cutter
    while o.modifiers.find(mod.name) > 0:
        bpy.ops.object.modifier_move_up(modifier=mod.name)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def opening(o, loc, dims, radius=.002):
    c = box('CUT', loc, dims, None, None, 0)
    mod = c.modifiers.new('Rounded opening', 'BEVEL'); mod.width = radius; mod.segments = 4
    active(c); bpy.ops.object.modifier_apply(modifier=mod.name)
    cut(o, c)


def tube(name, loc, r, inside, length, mat=steel, parent=body):
    o = cyl(name, loc, r, length, mat, parent=parent, sides=48)
    cut(o, cyl('CUT', loc, inside, length+.005, None, parent=None, sides=48, bevel=0))
    return o


def screw(loc, r=.0026, parent=body, axis='Y'):
    o = cyl('Socket fastener', loc, r, .0013, steel, axis, parent, 24, .00015)
    cut(o, cyl('CUT', loc, r*.46, .006, None, axis, None, 6, 0))
    return o


def text(label, loc, size=.003, side=-1, parent=body, mat=markmat):
    c = bpy.data.curves.new(label, 'FONT'); c.body = label; c.size = size; c.resolution_u = 2
    o = bpy.data.objects.new('Mark | '+label, c); asset.objects.link(o)
    o.location = loc; o.rotation_euler = (math.pi/2, 0, 0) if side == -1 else (math.pi/2, 0, math.pi)
    c.materials.append(mat); o.parent = parent; o.matrix_parent_inverse = parent.matrix_world.inverted()
    return o


# Uniform photo registration. Primary source: 2019 p23 / PDF25 at scale-to1800.
# 820px catalog overall envelope corresponds approximately to 660mm. Widths,
# relief and hidden contours remain inferred; do not independently stretch axes.
S = .660/820

def trace(points):
    return [((x-710)*S, (232-z)*S) for x, z in points]


def traced(name, points, width, mat=alloy, parent=body, **kwargs):
    return profile(name, trace(points), width, mat, parent, **kwargs)


# MPX receiver: lofted round-shouldered upper, no MP5 cocking tube.
rings = []
for x, half, top, bottom in [(-.105,.018,.030,-.019),(-.098,.024,.039,-.028),
                             (-.077,.024,.040,-.029),(.094,.024,.040,-.029),(.111,.023,.035,-.027)]:
    # Rounded crown, straight lower shoulders and a flat mating datum. A full
    # ellipse lifts the flank clear of the lower receiver and leaves a false gap.
    section=[(half*math.cos(a),top-half+half*math.sin(a))
             for a in np.linspace(0,math.pi,17)]
    r=.003
    section.append((-half,bottom+r))
    section.extend([(-half+r+r*math.cos(a),bottom+r+r*math.sin(a))
                    for a in np.linspace(math.pi,1.5*math.pi,5)[1:]])
    section.append((half-r,bottom))
    section.extend([(half-r+r*math.cos(a),bottom+r+r*math.sin(a))
                    for a in np.linspace(1.5*math.pi,2*math.pi,5)[1:]])
    rings.append([(x,y,z) for y,z in section])
upper = loft('MPX continuous rounded upper', rings, bevel=.0023)
# The real port is on the right. Carrier is a visible external proxy only.
opening(upper, (.063,-.021,.007), (.061,.017,.020), .0032)
cyl('Visible carrier exterior', (.061,-.003,.007), .011, .069, carrier, parent=bolt)
box('Carrier relief', (.057,-.015,.008), (.018,.002,.008), steel, bolt, .001)
port = box('Ejection port frame', (.063,-.025,.008), (.065,.003,.024), alloy, bevel=.001)
opening(port, (.063,-.025,.008), (.058,.012,.018), .003)
# Compact exterior wedge behind the port; the initial placement obscured it.
profile('Shell deflector',[(.022,-.006),(.029,-.003),(.029,.015),(.021,.016),
                         (.017,.011),(.017,-.002)],.007,y=-.027,bevel=.0009)
for side in (-1, 1):
    # Long receiver scallop with rounded ends, machined into the surface.
    opening(upper, (-.028,side*.024,.006), (.111,.003,.019), .009)
    screw((-.086,side*.024,.003), .0032)

lower = traced('Lower receiver shoulder', [(585,255),(749,255),(770,261),(775,285),
    (759,294),(701,294),(689,298),(682,309),(681,325),(691,332),(674,332),
    (659,336),(649,335),(621,327),(627,313),(629,300),(624,285),(612,274),(593,268)],
    .043,bevel=.003)
well = traced('Flared 9mm magazine well', [(761,270),(824,272),(831,285),(831,310),
    (835,332),(830,339),(812,343),(761,346),(758,340),(758,298)],.047,bevel=.0025,smooth=True)
opening(well,(.069,0,-.086),(.043,.031,.045),.003)
traced('Magazine well lower rim',[(758,338),(813,336),(834,326),(838,328),
    (838,338),(815,345),(760,349)],.049,bevel=.001)
guard = traced('Curved trigger guard',[(681,292),(759,292),(771,314),(765,329),
    (750,340),(726,345),(700,343),(682,337),(672,327),(670,313)],.015,bevel=.002,smooth=True)
opening(guard,(.0072,0,-.0672),(.059,.033,.034),.013)
trigger_shape = trace([(718,298),(723,305),(720,316),(717,326),(720,331),
                       (716,332),(711,326),(713,313),(714,304)])
profile('Curved trigger blade', trigger_shape, .006, steel, trigger, bevel=.0008)
for side in (-1,1):
    screw((-.052,side*.023,-.030), .0023)
    screw((.017,side*.023,-.028), .0024)
    cyl('Selector centre', (-.035,side*.025,-.041), .0052, .003, steel, 'Y', selector)
    paddle = box('Selector paddle', (-.027,side*.027,-.041), (.020,.003,.006), steel, selector, .002)
    paddle.rotation_euler.y = -.15
    for label, x, z in [('S',-.047,-.033),('1',-.031,-.029),('A',-.014,-.034)]:
        text(label, (x,side*.024,z), .0031, side)
    box('Magazine release fence',(.034,side*.024,-.043),(.012,.002,.020),alloy,bevel=.002)
    box('Magazine release button',(.034,side*.026,-.043),(.008,.002,.014),steel,bevel=.0015)
    for i in range(5):
        box('Release serration',(.034,side*.0273,-.047+i*.002),(.006,.0004,.00055),polymer,bevel=.0001)
    for x,z in [(-.092,-.023),(.095,-.027)]:
        cyl('Receiver retaining pin', (x,side*.023,z), .0035, .0025, steel, 'Y')
box('Left bolt-release paddle', (.033,.027,-.035), (.010,.005,.015), steel, release, .0015)
box('Bolt-release lower lever', (.033,.026,-.050), (.004,.004,.018), steel, release, .001)
text('SIG SAUER INC.', (.015,.0233,-.029), .0028, 1)
text('NEWINGTON NH USA', (.024,.0233,-.033), .0021, 1)
text('MPX 9mm', (.090,-.024,-.064), .004, -1)
text('MPX-GAME-0001', (.074,.024,-.068), .0023, 1)

# Grip stations: smooth palm swell and rounded heel, not an extruded rectangle.
grip_outline = trace([(670,296),(663,309),(653,323),(646,340),(629,376),
                      (612,405),(615,415),(647,427),(658,420),(675,384),(689,354),(700,325)])
grip_rings=[]
for z,back,front,w in [(-.054,-.0675,-.030,.012),(-.066,-.068,-.030,.014),
    (-.078,-.076,-.036,.016),(-.092,-.085,-.043,.017),
    (-.112,-.097,-.053,.017),(-.121,-.102,-.058,.017),(-.144,-.108,-.065,.016)]:
    heel=z==-.144
    ring=[]
    r=.0045
    for cx,cy,start in [(front-r,w-r,0),(back+r,w-r,90),
                        (back+r,-w+r,180),(front-r,-w+r,270)]:
        for angle in np.linspace(start,start+90,6):
            a=math.radians(angle)
            px=cx+r*math.cos(a)
            pz=z-.45*(px-(back+front)/2) if heel else z
            ring.append((px,cy+r*math.sin(a),pz))
    grip_rings.append(ring)
grip=loft('Palm-swelled ergonomic grip',grip_rings,polymer,bevel=.0008)
for side in (-1,1):
    traced('Grip traction inset',[(630,332),(663,335),(646,377),(626,412),(587,396),(608,357)],
           .0010,rubber,y=side*.0162,bevel=.001)
    text('SIG SAUER',(-.064 if side==-1 else -.044,side*.014,-.074),.0030,side,mat=polymer)
for i in range(8):
    x=-.046-i*.0031; z=-.097-i*.0054
    box('Grip front traction rib',(x,0,z),(.0015,.027,.0010),rubber,bevel=.0004)

# Hollow 8-inch shell. Slots and angled vents are actual through openings.
hg_start, hg_end = .096, .300
section = [(-.016,.036),(.016,.036),(.024,.024),(.025,-.015),(.017,-.026),
           (-.017,-.026),(-.025,-.015),(-.024,.024)]
verts = [(x,y,z) for x in (hg_start,hg_end) for y,z in section]
faces = [(i,(i+1) % 8,(i+1) % 8+8,i+8) for i in range(8)]
hg = mesh('Hollow five-slot M-LOK handguard', verts, faces, bevel=0)
active(hg)
mod = hg.modifiers.new('Reference-inferred shell thickness', 'SOLIDIFY'); mod.thickness = .002
bpy.ops.object.modifier_apply(modifier=mod.name)
for x,length in [(.119,.011),(.148,.035),(.190,.035),(.232,.035),(.274,.035)]:
    opening(hg, (x,0,-.001), (length,.080,.009), .0033)
for x in np.linspace(.123,.282,8):
    cut(hg, profile('CUT', [(x-.006,.027),(x-.002,.034),(x+.006,.034),(x+.002,.027)], .08, None, None, bevel=.0005))
    cut(hg, profile('CUT', [(x-.007,-.020),(x-.001,-.012),(x+.007,-.012),(x+.001,-.020)], .08, None, None, bevel=.0005))
mod = hg.modifiers.new('Slot rim radii', 'BEVEL'); mod.width=.00055; mod.segments=3; mod.harden_normals=True
mod = hg.modifiers.new('Weighted shell normals', 'WEIGHTED_NORMAL'); mod.keep_sharp=True
for side in (-1,1):
    screw((.105,side*.025,-.006), .003)
# Continuous top rail: base plus true separated lugs with edge bevels.
box('Picatinny spine', (.098,0,.0385), (.412,.022,.003), alloy, bevel=.0005)
for x in np.arange(-.103,.300,.010):
    profile('Picatinny rail tooth', [(x-.003,.040),(x+.003,.040),(x+.003,.044),
                                  (x-.003,.044)], .021, alloy, bevel=.00035)
# Visible external barrel envelope only, accurate nominal endpoint convention.
breech = .109
barrel_end = breech+.2032
cyl('External barrel', ((breech+barrel_end)/2,0,0), .0076, .2032, steel, bevel=.00015)
cyl('External barrel shoulder', (.141,0,0), .0105, .043, steel, bevel=.0003)
# SRD9-MPX 175 x35mm with mount. No baffles or working attachment threads.
can_start = barrel_end-.008
can_end = can_start+.175
can = cyl('SRD9 MPX titanium exterior', ((can_start+can_end)/2,0,0), .0175, .175, canmat, sides=64, bevel=.0008)
cut(can, cyl('CUT', (can_end,0,0), .0048, .009, None, parent=None, sides=32, bevel=0))
for x,r in [(can_start+.004,.0177),(can_start+.013,.0176),(can_end-.004,.0176)]:
    cyl('Suppressor end collar', (x,0,0), r, .004, canmat, sides=48, bevel=.0004)
text('SIG SAUER SRD9', (can_start+.030,-.01751,-.0018), .0036, -1)
text('9mm', (can_start+.092,-.01751,-.0018), .0036, -1)

# Magazine: continuous curved, tapering closed shell with ribs/round witness relief.
mag_rings=[]
for z,cx,w,length in [(-.041,.069,.014,.048),(-.075,.074,.014,.047),
                      (-.100,.081,.014,.046),(-.133,.093,.0135,.046),
                      (-.166,.109,.013,.045),(-.194,.126,.0125,.045),(-.211,.137,.0125,.044)]:
    ring=[]
    for a in range(16):
        t=2*math.pi*a/16
        # Rounded rectangle, not a cylinder; superellipse .45 exponent.
        c,s=math.cos(t),math.sin(t)
        ring.append((cx+math.copysign(abs(c)**.45,c)*length/2,
                     math.copysign(abs(s)**.45,s)*w,z))
    mag_rings.append(ring)
mag_shell=loft('Curved 30-round magazine shell',mag_rings,magmat,mag,bevel=.0004)
for side in (-1,1):
    for offset in (-.012,.012):
        for i in range(1,len(mag_rings)-1):
            a=mag_rings[i]; b=mag_rings[i+1]
            cx=(min(p[0] for p in a)+max(p[0] for p in a))/2
            nx=(min(p[0] for p in b)+max(p[0] for p in b))/2
            profile('Magazine longitudinal traction rib',[(cx+offset-.001,a[0][2]),(cx+offset+.001,a[0][2]),
                    (nx+offset+.001,b[0][2]),(nx+offset-.001,b[0][2])], .0014, polymer,mag,y=side*.0139,bevel=.0002)
    for i in range(15):
        z=-.086-i*.0078
        cx=.074+(.137-.074)*((-z-.075)/.136)**1.25
        for offset in (-.006,.006):
            cyl('Magazine moulded witness dot', (cx+offset,side*.0141,z), .0011,.0006,polymer,'Y',mag,12,.0001)
base=box('Magazine floor plate', (.137,0,-.213), (.048,.030,.007), polymer,mag,.0012)
base.rotation_euler.y=-.45
text('30', (.132,-.0145,-.195), .0045,-1,mag)

# Stock silhouette, continuous structural shaft, inset web and actual sling hole.
box('Rear 1913 interface',(-.113,0,.003),(.014,.043,.058),alloy,bevel=.0015)
cyl('Folding hinge pin',(-.122,.015,.004),.004,.050,steel,'Z',stock)
box('Folding hinge leaf',(-.127,0,.004),(.015,.028,.045),alloy,stock,.0015)
box('Telescoping stock shaft',(-.180,0,.010),(.111,.016,.019),alloy,stock,.0012)
stock_outline=trace([(324,201),(494,201),(497,211),(491,230),(457,237),
    (412,284),(386,334),(367,350),(324,346),(315,329),(315,216)])
butt=profile('Factory telescoping stock moulding',stock_outline,.035,polymer,stock,bevel=.003,smooth=True)
cut(butt,traced('CUT',[(357,319),(370,324),(411,275),(429,253),(416,252),(402,263)],.06,None,None,bevel=.002))
for side in (-1,1):
    traced('Inset diagonal stock web',[(326,248),(348,248),(390,278),(365,322),(351,330),(326,319)],
           .0015,rubber,stock,y=side*.0173,bevel=.0006)
    traced('Cheek traction inset',[(337,215),(479,215),(477,228),(335,230)],
           .0009,polymer,stock,y=side*.0178,bevel=.001)
    qd=cyl('Stock QD socket lip',(-.289,side*.0185,-.019),.007,.002,steel,'Y',stock)
    cut(qd,cyl('CUT',(-.289,side*.0185,-.019),.0048,.020,None,'Y',None,32,0))
    for x in (-.28,-.205):
        box('Cheek moulding relief',(x,side*.018,.010),(.017,.001,.006),rubber,stock,.001)
    text('SIG SAUER',(-.293 if side == -1 else -.270,side*.0178,-.076),.004,side,stock,mat=polymer)
traced('Buttpad',[(315,207),(324,209),(324,344),(317,340),(312,323)],.037,rubber,stock,bevel=.002)
for i in range(13):
    box('Buttpad traction',(-.318,0,-.010-i*.006),(.0014,.034,.0012),rubber,stock,.0003)

# Rear ambidextrous non-reciprocating charging handle, correct MPX control location.
box('Charging handle shaft',(-.029,0,.030),(.167,.010,.006),steel,handle,.0008)
traced('Ambidextrous charging handle head',[(579,180),(595,179),(601,190),(582,193)],.059,steel,handle,bevel=.0018)
for side in (-1,1):
    box('Charging latch',(-.099,side*.027,.037),(.012,.006,.008),polymer,handle,.001)
    for i in range(4):
        box('Charging handle traction',(-.103+i*.002,side*.030,.037),(.001,.0014,.006),steel,handle,.0002)

# Folded factory backup sights. No new gameplay toggle.
for x in (-.079,.276):
    box('Folded iron rail clamp',(x,0,.047),(.028,.029,.010),steel,bevel=.0015)
    cyl('Folded sight hinge',(x+.005,0,.054),.0048,.030,steel,'Y')
    box('Folded sight leaf',(x-.003,0,.054),(.024,.017,.004),steel,bevel=.0012)
    screw((x,-.016,.048),.003)

# Non-PRO ROMEO4T. Real 20mm aperture / 1.41in rail-to-axis mount convention.
optic_x=.074
optic_axis=.044+.035814
mount=profile('ROMEO4T 1.41in skeletal mount',[(optic_x-.022,.045),(optic_x+.023,.045),
    (optic_x+.020,.056),(optic_x+.016,.064),(optic_x-.017,.064),(optic_x-.021,.056)],.025,steel,bevel=.0009)
opening(mount,(optic_x,0,.055),(.031,.050,.009),.002)
box('Optic cross bolt clamp',(optic_x,-.017,.048),(.035,.006,.006),steel,bevel=.001)
screw((optic_x,-.021,.048),.0038)
optic_length=.0855
optic_body=tube('ROMEO4T main housing',(optic_x,0,optic_axis),.0145,.0104,optic_length,alloy)
for x in (optic_x-optic_length/2+.003,optic_x+optic_length/2-.003):
    tube('Objective and ocular rim',(x,0,optic_axis),.016,.0102,.006,alloy)
    cyl('Coated optical lens',(x,0,optic_axis),.010,.0006,glass,sides=48,bevel=0)
box('Solar panel housing',(optic_x,0,optic_axis+.014),(.045,.020,.004),alloy,bevel=.001)
box('Solar panel',(optic_x,0,optic_axis+.0162),(.037,.015,.0008),solar,bevel=.0004)
for x in np.linspace(optic_x-.016,optic_x+.016,5):
    box('Solar cell separation',(x,0,optic_axis+.0167),(.0003,.014,.00015),steel,bevel=0)
# Asymmetric battery cap and rubber two-button saddle from the product references.
cyl('ROMEO4T battery cap',(optic_x+.014,-.0185,optic_axis),.0085,.009,alloy,'Y')
for i in range(16):
    a=i*2*math.pi/16
    box('Battery cap knurl',(optic_x+.014+math.cos(a)*.008,-.0231,optic_axis+math.sin(a)*.008),
        (.0014,.0008,.0014),steel,bevel=.0002)
box('ROMEO4T button saddle',(optic_x,.015,optic_axis),(.041,.005,.018),alloy,bevel=.002)
for x,label in [(optic_x-.010,'+'),(optic_x+.010,'-')]:
    box('Rubber brightness button',(x,.0183,optic_axis),(.014,.002,.012),rubber,bevel=.002)
    text(label,(x+.002,.0194,optic_axis-.002),.005,1,mat=polymer)
text('ROMEO4T',(optic_x+.022,.0146,optic_axis+.008),.0040,1)
# Clear flip covers open away from optical path, independently editable.
for x in (optic_x-optic_length/2-.002,optic_x+optic_length/2+.002):
    pivot=empty('lens_cap_front' if x>optic_x else 'lens_cap_rear',parent=body)
    tube('Open lens cap rim',(x,-.024,optic_axis-.020),.013,.011,.003,polymer,pivot)
    cyl('Open clear lens cap',(x,-.024,optic_axis-.020),.011,.0007,clear,parent=pivot,sides=40,bevel=0)
    arm=box('Lens cap hinge arm',(x,-.014,optic_axis-.013),(.004,.026,.003),polymer,pivot,.0006)
    arm.rotation_euler.x=-.65

# Sparse local polished nicks rather than uniform silver wireframes.
for loc,dims in [((.108,-.025,.022),(.005,.0003,.0005)),((.256,-.024,.024),(.009,.0003,.0004)),
                 ((-.087,-.024,.034),(.004,.0002,.0006)),((.076,-.024,-.075),(.006,.0003,.0004))]:
    box('Localized handling nick',loc,dims,wear,bevel=.0001)

for name,loc in {'muzzle':(can_end,0,0),'barrel_crown':(barrel_end,0,0),'breech':(breech,0,0),
                 'ejection':(.070,-.027,.010),'sight':(optic_x,0,optic_axis),
                 'grip_right':(-.045,0,-.103),'grip_left':(.209,0,-.017),
                 'magazine':(.069,0,-.065)}.items():
    empty('SOCKET_'+name,loc,rig)

# Original components remain editable in .blend. Apply/unwrap export copies later.
for o in list(asset.objects):
    if o.type not in {'MESH','FONT'}:
        continue
    active(o)
    if o.type == 'FONT':
        bpy.ops.object.convert(target='MESH')
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.006)
    bpy.ops.object.mode_set(mode='OBJECT')


def aim(o,target):
    o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()


def camera(name,loc,target,scale):
    data=bpy.data.cameras.new(name); data.type='ORTHO'; data.ortho_scale=scale
    o=bpy.data.objects.new(name,data); studio.objects.link(o); o.location=loc; aim(o,target)
    return o


def area(name,loc,power,color,size,target,ratio=1):
    data=bpy.data.lights.new(name,'AREA'); data.energy=power; data.color=color
    data.shape='RECTANGLE'; data.size=size; data.size_y=size*ratio
    o=bpy.data.objects.new(name,data); studio.objects.link(o); o.location=loc; aim(o,target)


target=(.070,0,-.025)
cams={
    'left':camera('left',(.070,2.5,-.025),target,.89),
    'right':camera('right',(.070,-2.5,-.025),target,.89),
    'beauty':camera('beauty',(.63,-1.30,.46),target,.90),
    'receiver_detail':camera('receiver_detail',(.16,-.55,.15),(.018,0,-.018),.34),
    'optic_detail':camera('optic_detail',(.23,.45,.22),(.074,0,.071),.23),
    'stock_detail':camera('stock_detail',(-.36,.42,.12),(-.215,0,-.022),.32),
}
area('Warm broad key',(.3,-.5,.75),65,(1,.92,.83),.65,target,.5)
area('Neutral left fill',(-.1,.6,.25),38,(.86,.93,1),.7,target)
area('Long top reflection',(.05,.05,.55),45,(1,1,1),.95,target,.15)
area('Receiver rim',(-.4,.0,.25),30,(.8,.9,1),.4,target,.3)
scene.world.color=(.12,.12,.12)
scene.render.engine='BLENDER_EEVEE'
scene.eevee.use_raytracing=False
scene.eevee.taa_render_samples=64
scene.render.resolution_x=1600; scene.render.resolution_y=900; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=True
scene.view_settings.view_transform='AgX'
scene.view_settings.exposure=-1.8
scene.camera=cams['beauty']
notes=bpy.data.texts.new('MPX_README')
notes.write('Gate 2 static exterior/material candidate. Human approval pending.\n'
            'No animation clips or runtime integration yet. See adjacent README and REFERENCES.\n'
            'Original shared packed 1K PBR maps; photo-inferred depths/typography, not manufacturing CAD.\n'
            'Metres; +X forward, +Z up, -Y ejection. Component pivots not yet animation-fitted.\n')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'mpx.blend'))
if args.render:
    for name,cam in cams.items():
        scene.camera=cam; scene.render.filepath=str(REVIEW/(name+'.png'))
        bpy.ops.render.render(write_still=True)

# Export evaluated copies, merge per rigid parent, collapse material slots.
# This is explicitly a static candidate; future native clips require fitted pivots.
export=bpy.data.collections.new('EXPORT | evaluated copies')
scene.collection.children.link(export)
copy_by_source={}
for o in list(asset.objects):
    clone=o.copy()
    if o.data: clone.data=o.data.copy()
    export.objects.link(clone); clone.parent=None; clone.matrix_world=o.matrix_world.copy()
    copy_by_source[o]=clone
for source,clone in copy_by_source.items():
    if source.parent:
        world=clone.matrix_world.copy(); clone.parent=copy_by_source[source.parent]; clone.matrix_world=world
for source,clone in copy_by_source.items():
    if clone.type != 'MESH': continue
    active(clone)
    for mod in list(clone.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
# Join mesh copies under the same rigid parent (not all components indiscriminately).
parents={o.parent for o in export.objects if o.type=='MESH'}
for parent in parents:
    group=[o for o in export.objects if o.type=='MESH' and o.parent==parent]
    if not group: continue
    active(group[0])
    for o in group: o.select_set(True)
    if len(group)>1: bpy.ops.object.join()
    joined=bpy.context.object; joined.name=parent.name.replace('.001','')+'_mesh'
    # Joining hundreds of component objects otherwise leaves duplicate material slots.
    materials=list(joined.data.materials); unique=[]; remap={}
    for i,m in enumerate(materials):
        if m not in unique: unique.append(m)
        remap[i]=unique.index(m)
    indexes=[remap[p.material_index] for p in joined.data.polygons]
    joined.data.materials.clear()
    for m in unique: joined.data.materials.append(m)
    for p,i in zip(joined.data.polygons,indexes): p.material_index=i
# Restore canonical exported names so future adapters can find them consistently.
for source,clone in copy_by_source.items():
    if source.type=='EMPTY':
        source.name='SOURCE_'+source.name
        clone.name=source.name.removeprefix('SOURCE_')
bpy.ops.object.select_all(action='DESELECT')
for o in export.objects: o.select_set(True)
bpy.context.view_layer.objects.active=copy_by_source[rig]
bpy.ops.export_scene.gltf(filepath=str(OUT/'mpx.glb'),export_format='GLB',use_selection=True,
                          export_animations=False,export_extras=True,export_yup=True)
raw=(OUT/'mpx.glb').read_bytes()
length,kind=struct.unpack_from('<II',raw,12)
assert kind==0x4e4f534a
j=json.loads(raw[20:20+length])
triangles=0
for node in j.get('nodes',[]):
    if 'mesh' in node:
        for p in j['meshes'][node['mesh']]['primitives']:
            triangles+=j['accessors'][p['indices']]['count']//3
stats={'triangleInstances':triangles,'primitives':sum(len(m['primitives']) for m in j['meshes']),
       'materials':len(j.get('materials',[])),'images':len(j.get('images',[])),'bytes':len(raw)}
assert triangles<110000,stats
assert stats['primitives']<=40 and stats['materials']<=16 and stats['images']==3 and len(raw)<=10*1024*1024,stats
manifest={'status':'Gate 2 static candidate — NOT animated or integrated; human review pending',
    'asset':'SIG MPX 8 inch / ROMEO4T 1.41 inch mount / MIL-SRD9-MPX / 30-round magazine / folded irons',
    'units':'metres','blenderForward':'+X','blenderUp':'+Z','stats':stats,'clips':{},
    'textures':{'resolution':1024,'packed':True,'embedded':True,'method':'original deterministic surface maps; no photographic inputs'},
    'dimensions':{'nominalBarrel':.2032,'barrelBreech':breech,'barrelCrown':barrel_end,
                  'suppressorEnvelope':[.175,.035],'suppressorStart':can_start,'muzzle':can_end,
                  'opticAperture':.020,'railToOpticalAxis':.035814},
    'notes':['Reference-supported assembly, not proof that the hero photograph depicts this barrel.',
             'Depths, relief, magazine translucency and typography remain inferred.',
             'No functional internals, certified pixel parity, or AAA visual sign-off.',
             'Static candidate: rigid controls/pivots will be fitted before animation.']}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('MPX_GATE_2_STATS',json.dumps(stats))
