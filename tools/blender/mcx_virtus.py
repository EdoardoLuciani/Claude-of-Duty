"""Standalone visual asset, not manufacturing geometry.
blender -b --python tools/blender/mcx_virtus.py -- [--render] [--quick]
All content is authored here; no downloaded meshes, textures or add-ons.
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
OUT = ROOT / 'assets/weapons/mcx-virtus'
ARGS = argparse.ArgumentParser()
ARGS.add_argument('--render', action='store_true')
ARGS.add_argument('--quick', action='store_true')
args = ARGS.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'textures').mkdir(exist_ok=True)
(OUT / 'renders').mkdir(exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.materials):
    bpy.data.materials.remove(block)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.render.fps = 60
asset = bpy.data.collections.new('MCX VIRTUS | authored components')
scene.collection.children.link(asset)
studio = bpy.data.collections.new('STUDIO | not exported')
scene.collection.children.link(studio)


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
rig['asset'] = 'SIG MCX VIRTUS / .300 BLK / visual approximation'
rig['forward'] = '+X in Blender; metres; right-side ejection is -Y'
rig['hand_rig'] = 'Not included; grip sockets are provided'
body = empty('receiver', parent=rig)
mag = empty('magazine', parent=rig)
spare = empty('magazine_spare', parent=rig)
bolt = empty('bolt', parent=rig)
handle = empty('charging_handle', parent=rig)
trigger = empty('trigger', (-.098, 0, -.063), rig)
cover = empty('dust_cover', (-.02, -.027, -.022), rig)
stock = empty('stock_hinge', (-.183, .016, .007), rig)
case = empty('spent_case', parent=rig)
release = empty('bolt_release', (-.072, .027, -.045), rig)

# Tileable, deterministic PBR maps. Roughness uses green (glTF convention),
# normal maps are tangent-space +Y. Shared images keep the GLB compact.
rng = np.random.default_rng(300)
N = 1024

def field(grid):
    small = rng.random((grid, grid)).astype(np.float32)
    xx = np.arange(N) * grid / N
    lo = xx.astype(int)
    t = xx - lo
    t = t * t * (3 - 2 * t)
    a = small[lo[:, None] % grid, lo[None, :] % grid]
    b = small[(lo[:, None] + 1) % grid, lo[None, :] % grid]
    c = small[lo[:, None] % grid, (lo[None, :] + 1) % grid]
    d = small[(lo[:, None] + 1) % grid, (lo[None, :] + 1) % grid]
    return (a * (1-t[:, None]) + b*t[:, None]) * (1-t[None, :]) + (c*(1-t[:, None])+d*t[:, None])*t[None, :]


def image(name, rgb, color=False):
    img = bpy.data.images.new(name, width=N, height=N, alpha=False)
    img.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    pixels = np.ones((N, N, 4), dtype=np.float32)
    pixels[:, :, :3] = rgb if rgb.ndim == 3 else rgb[:, :, None]
    img.pixels.foreach_set(pixels.ravel())
    img.filepath_raw = str(OUT / 'textures' / (name + '.png'))
    img.file_format = 'PNG'
    img.save()
    img.pack()
    img.filepath = '//textures/' + name + '.png'
    return img


cloud = field(12)*.48 + field(53)*.32 + field(170)*.20
fine = rng.random((N, N)).astype(np.float32)
height = field(230)*.65 + fine*.35
scratches = np.zeros((N, N), dtype=np.float32)
for _ in range(260):
    x, y = rng.integers(0, N, 2)
    length = int(rng.integers(2, 32))
    for i in range(length):
        scratches[(y+i//7) % N, (x+i) % N] = rng.uniform(.08, .35)
albedo = image('surface_variation', np.clip(.86 + cloud*.05 + scratches*.08, 0, 1), True)
rough = image('roughness_variation', np.clip(.86 + cloud*.08 + fine*.035 - scratches*.10, 0, 1))
dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1))*.33
dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0))*.33
normal = np.dstack((-dx, -dy, np.ones_like(dx)))
normal /= np.linalg.norm(normal, axis=2, keepdims=True)
nmap = image('micro_normal', normal*.5+.5)


def material(name, color, metal=0, roughness=.5, detail=.2):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    p = nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = roughness
    tex = nodes.new('ShaderNodeTexImage'); tex.image = albedo
    mul = nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'
    mul.inputs[0].default_value = 1
    mul.inputs[7].default_value = (*color, 1)
    links.new(tex.outputs['Color'], mul.inputs[6])
    links.new(mul.outputs[2], p.inputs['Base Color'])
    tex = nodes.new('ShaderNodeTexImage'); tex.image = rough
    sep = nodes.new('ShaderNodeSeparateColor')
    links.new(tex.outputs['Color'], sep.inputs[0])
    scale = nodes.new('ShaderNodeMath'); scale.operation = 'MULTIPLY'
    scale.inputs[1].default_value = roughness
    links.new(sep.outputs['Green'], scale.inputs[0])
    links.new(scale.outputs[0], p.inputs['Roughness'])
    tex = nodes.new('ShaderNodeTexImage'); tex.image = nmap
    normal_node = nodes.new('ShaderNodeNormalMap')
    normal_node.inputs['Strength'].default_value = detail
    links.new(tex.outputs['Color'], normal_node.inputs['Color'])
    links.new(normal_node.outputs['Normal'], p.inputs['Normal'])
    return mat


anodized = material('01 | graphite anodized alloy', (.047, .053, .060), 1, .72, .09)
edge = material('02 | subtly burnished edges', (.081, .087, .095), 1, .59, .08)
polymer = material('03 | injection-moulded polymer', (.027, .031, .035), 0, .79, .65)
rubber = material('04 | stippled rubber', (.016, .019, .022), 0, .91, .9)
steel = material('05 | dark nitrided steel', (.083, .091, .105), 1, .44, .16)
ceramic = material('06 | suppressor graphite ceramic', (.054, .056, .060), 0, .66, .35)
brass = material('07 | fired brass', (.49, .285, .084), 1, .35, .14)
copper = material('08 | copper projectile', (.43, .16, .066), 1, .39, .1)
marking = material('09 | subdued laser markings', (.37, .39, .40), 0, .65, .02)
red = material('10 | selector red', (.32, .025, .012), 0, .62, .02)
glass = material('11 | coated optic lens', (.48, .56, .59), 0, .08, 0)
glass_bsdf = glass.node_tree.nodes.get('Principled BSDF')
glass_bsdf.inputs['Transmission Weight'].default_value = .97
glass_bsdf.inputs['IOR'].default_value = 1.45
# Thin transmissive lenses export with KHR_materials_transmission; no alpha blend.
glass_bsdf.inputs['Coat Weight'].default_value = .25


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


def profile(name, points, width, mat=anodized, parent=body, bevel=.0008, y=0):
    # Extruded outline in the X/Z plane, deliberately faceted receiver silhouette.
    n = len(points)
    verts = [(x, y+s*width/2, z) for s in (-1, 1) for x, z in points]
    faces = [tuple(range(n-1, -1, -1)), tuple(range(n, 2*n))]
    faces += [(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]
    mesh = bpy.data.meshes.new(name); mesh.from_pydata(verts, [], faces); mesh.update()
    obj = bpy.data.objects.new(name, mesh); asset.objects.link(obj)
    active(obj); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
    return finish(obj, name, mat, parent, bevel)


def cylinder(name, loc, radius, depth, mat=steel, axis='X', parent=body, vertices=32, bevel=.00035):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    obj = bpy.context.object
    if axis == 'X': obj.rotation_euler[1] = math.pi/2
    if axis == 'Y': obj.rotation_euler[0] = math.pi/2
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    for p in obj.data.polygons: p.use_smooth = len(p.vertices) == 4
    return finish(obj, name, mat, parent, bevel)


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
    obj = cylinder(name, loc, radius, length, mat, parent=parent, vertices=64)
    cut(obj, cylinder('CUT', loc, inner, length+.005, None, parent=None, vertices=64, bevel=0))
    return obj


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


bpy.context.view_layer.update()
# Upper: tall MCX carriage, stepped forging, handguard interface and real port.
upper = profile('VIRTUS upper forging', [(-.178,-.022),(-.178,.029),(-.157,.039),(.064,.039),(.083,.022),(.081,-.027),(-.145,-.030)], .051)
opening(upper, (-.021,-.022,.002), (.085,.025,.018), .003)
box('Port interior shadow', (-.021,.001,.002), (.09,.008,.02), rubber)
profile('Rear upper shoulder', [(-.177,.022),(-.15,.031),(-.137,.022),(-.138,-.015),(-.164,-.019)], .058)
for side in (-1,1):
    y = side*.0262
    profile('Upper machined shoulder', [(-.139,.022),(.047,.022),(.059,.014),(.018,.010),(-.135,.012)], .0015, anodized, y=y)
    profile('Receiver lightening facet', [(-.115,-.019),(-.055,-.022),(-.038,-.015),(-.122,-.011)], .0012, anodized, y=y)
    screw(.048, side*.0275, .004)
    screw(-.157, side*.03, -.027, .0042)
    screw(.065, side*.028, -.027, .004)
# Steel bolt visible behind the cut-out, and open, hinged dust cover.
cylinder('Bolt carrier visible through port', (-.02,-.009,.003), .012, .103, steel, parent=bolt)
box('Carrier extraction recess', (-.012,-.0215,.004), (.022,.001,.007), polymer, bolt, .001)
box('Dust cover plate', (-.021,-.041,-.025), (.088,.026,.002), steel, cover, .0005)
cylinder('Dust cover hinge', (-.021,-.027,-.022), .0017, .092, steel, parent=cover)
for x in (-.05,.012): box('Dust cover rib', (x,-.041,-.0263), (.0016,.022,.0012), steel, cover)
profile('Brass deflector', [(-.079,-.005),(-.066,.012),(-.069,.021),(-.083,.017),(-.09,.002)], .013, y=-.03)
cylinder('Forward assist housing', (-.126,-.032,.010), .007, .022, anodized)
cylinder('Forward assist button', (-.141,-.032,.010), .0075, .005, steel)
# Lower, flared mag well and open trigger guard.
lower = profile('Ambidextrous lower receiver', [(-.168,-.028),(.072,-.028),(.065,-.069),(.054,-.079),(-.025,-.083),(-.039,-.060),(-.125,-.060),(-.149,-.085),(-.166,-.069)], .044)
magwell = profile('Flared magazine well', [(-.028,-.054),(.065,-.049),(.060,-.105),(-.019,-.098)], .051)
opening(magwell, (.020,0,-.096), (.069,.028,.035), .002)
profile('Magazine well lip', [(-.022,-.095),(.062,-.101),(.064,-.108),(-.024,-.102)], .054)
guard = profile('Sculpted trigger guard', [(-.133,-.059),(-.028,-.068),(-.031,-.097),(-.047,-.111),(-.105,-.108),(-.125,-.097)], .016, steel, bevel=.0018)
opening(guard, (-.08,0,-.081), (.083,.030,.047), .016)
profile('Curved trigger blade', [(-.099,-.064),(-.092,-.067),(-.089,-.080),(-.093,-.095),(-.099,-.098),(-.096,-.081)], .007, steel, trigger, .0007)
for side in (-1,1):
    screw(-.13,side*.024,-.047,.0031)
    screw(-.071,side*.024,-.053,.0021)
    cylinder('Selector hub', (-.121,side*.024,-.046), .006,.003,steel,'Y')
    profile('Ambidextrous selector paddle', [(-.123,-.042),(-.099,-.045),(-.095,-.051),(-.121,-.050)], .004, steel, y=side*.027)
    cylinder('Selector fire index', (-.113,side*.025,-.035), .0013,.0005,red,'Y',vertices=16)
    text('S',(-.137 if side==-1 else -.132,side*.025,-.036),.0038,side)
    text('MCX VIRTUS',(-.015 if side==-1 else .049,side*.0265,-.078),.006,side)
    text('300 BLK',(-.015 if side==-1 else .049,side*.0265,-.088),.0044,side)
    text('SIG SAUER',(-.091 if side==-1 else -.045,side*.0235,-.046),.0034,side)
    text('VISUAL ASSET  /  00300',(-.088 if side==-1 else -.043,side*.0235,-.053),.0021,side)
box('Magazine release fence', (.008,-.024,-.047), (.025,.004,.013), anodized, bevel=.002)
box('Magazine release button', (.009,-.027,-.047), (.014,.003,.008), steel, bevel=.001)
for x in np.linspace(.004,.014,5): box('Release grip serration',(float(x),-.029,-.047),(.0006,.001,.006),polymer,bevel=.0001)
box('Bolt release paddle', (-.068,.029,-.045), (.011,.005,.016), steel, release, .0015)
# Grip with curved backstrap, panels, mould parting line and crosshatch.
grip_points = [(-.147,-.058),(-.112,-.066),(-.104,-.094),(-.133,-.181),(-.167,-.191),(-.185,-.177),(-.163,-.116),(-.167,-.079)]
profile('Ergonomic pistol grip', grip_points,.035,polymer,bevel=.003)
for side in (-1,1):
    profile('Grip inset stipple panel', [(-.157,-.105),(-.12,-.106),(-.139,-.175),(-.169,-.179),(-.177,-.172)],.0015,rubber,bevel=.001,y=side*.018)
    for i in range(12):
        z=-.113-i*.0049; x=-.157-(i*.0014)
        profile('Grip traction chevron',[(x,z),(x+.023,z+.003),(x+.024,z+.0015),(x,z-.0015)],.0007,polymer,bevel=.00015,y=side*.019)
profile('Grip floor plate',[(-.169,-.183),(-.135,-.175),(-.132,-.182),(-.168,-.192),(-.183,-.184),(-.183,-.178)],.037,rubber)
# Handguard is a hollow octagonal extrusion, not black decals on a box.
# Build the shell along X from octagonal Y/Z rings.
ring = [(-.016,.034),(.016,.034),(.029,.020),(.029,-.019),(.018,-.033),(-.018,-.033),(-.029,-.019),(-.029,.020)]
verts = [(x,y,z) for x in (.075,.258) for y,z in ring]
faces = [(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)]
mesh = bpy.data.meshes.new('Handguard shell'); mesh.from_pydata(verts,[],faces);mesh.update()
obj = bpy.data.objects.new('Hollow octagonal VIRTUS handguard',mesh);asset.objects.link(obj)
active(obj);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
solid = obj.modifiers.new('Wall thickness','SOLIDIFY');solid.thickness=.0022
bpy.ops.object.modifier_apply(modifier=solid.name)
handguard = finish(obj,obj.name,anodized,bevel=.0007)
for x in (.105,.145,.185,.225):
    opening(handguard,(x,0,-.010),(.030,.082,.008),.0028)
    vent = profile('CUT', [(x-.014,.020),(x-.007,.010),(x+.014,.010),(x+.008,.020)], .082, None, None, .0015)
    cut(handguard, vent)
    opening(handguard,(x,0,-.027),(.025,.026,.026),.003)
opening(handguard,(.235,0,.028),(.034,.080,.015),.003)
for side in (-1,1):
    tube_obj = cylinder('QD sling socket',(.086,side*.03,-.004),.0068,.003,steel,'Y')
    cut(tube_obj,cylinder('CUT',(.086,side*.03,-.004),.0045,.008,None,'Y',None,32,0))
    text('M-LOK',(.209 if side==-1 else .245,side*.0295,-.023),.0032,side)
# Barrel and visible gas system stay visually simple: no functional internals.
cylinder('Barrel under vented guard',(.179,0,0),.0093,.222,steel)
cylinder('Gas system silhouette',(.16,0,.022),.0038,.17,steel)
box('Gas block silhouette',(.237,0,.006),(.016,.025,.033),steel)
# Continuous rail with trapezoidal teeth, foot and numbered lands.
profile('Continuous top rail foot',[(-.17,.035),(.257,.035),(.257,.041),(-.17,.041)],.023,steel)
for i in range(42):
    x=-.165+i*.010
    profile('Picatinny rail tooth',[(x,.040),(x+.0012,.046),(x+.006,.046),(x+.0072,.040)],.029,anodized,bevel=.00035)
for x in (-.15,.242):
    box('Folded backup sight base',(x,0,.049),(.030,.030,.007),steel)
    cylinder('Backup sight hinge',(x+.004,0,.055),.006,.034,steel,'Y')
    box('Folded backup sight leaf',(x-.006,0,.056),(.019,.014,.004),polymer)
    for side in (-1,1): screw(x+.004,side*.018,.055,.003)
# Compact closed-tube red dot with see-through bore and coated lenses.
box('Optic low riser',(-.042,0,.054),(.052,.026,.014),steel)
profile('Optic skeleton mount',[(-.067,.058),(-.016,.058),(-.025,.078),(-.056,.078)],.023,anodized)
optic = tube('Compact optic housing',(-.039,0,.097),.023,.018,.065,anodized)
for x in (-.075,-.004): tube('Optic protective lip',(x,0,.097),.024,.018,.006,rubber)
# Coated thin lenses: transmission rather than alpha sorting, with no reticle shader.
for x in (-.073,-.006): cylinder('Coated optical glass',(x,0,.097),.0178,.0007,glass,bevel=0)
cylinder('Windage turret',(-.03,-.026,.097),.009,.009,steel,'Y')
cylinder('Elevation turret',(-.03,0,.123),.009,.008,steel,'Z')
cylinder('Brightness dial',(-.049,.027,.097),.012,.011,polymer,'Y')
for i in range(24):
    a=i*math.tau/24
    cylinder('Turret knurl',(-.03+math.cos(a)*.008,-.031,.097+math.sin(a)*.008),.00065,.003,polymer,'Y',vertices=8,bevel=0)
screw(-.04,-.018,.055,.004)
text('MICRO  /  2 MOA',(-.062,-.0205,.083),.003)
# Suppressor with recessed front aperture, weld rings, shallow cooling flutes.
cylinder('Suppressor mount',(.279,0,0),.014,.038,steel)
for x in (.267,.275,.283): cylinder('Mount locking ring',(x,0,0),.016,.004,steel)
suppressor = cylinder('Suppressor body',(.368,0,0),.0215,.160,ceramic,vertices=80,bevel=.0013)
for i in range(12):
    a=i*math.tau/12
    # Shallow longitudinal flutes, physically cut in the outer skin.
    cut(suppressor,cylinder('CUT',(.359,math.cos(a)*.0238,math.sin(a)*.0238),.0033,.114,None,parent=None,vertices=12,bevel=0))
for x in (.291,.305,.429,.444): tube('Suppressor end band',(x,0,0),.022,.020,.004,steel)
tube('Recessed suppressor endcap',(.450,0,0),.0208,.0047,.008,steel)
cylinder('Muzzle interior shadow',(.438,0,0),.0048,.001,rubber,bevel=0)
text('300 BLK  //  SUPPRESSED',(.314,-.0217,-.003),.0037)
# Rear charging handle is separate and reciprocates only on an empty reload.
box('Charging handle stem',(-.157,0,.031),(.028,.013,.007),steel,handle)
box('Ambidextrous charging handle',(-.178,0,.032),(.010,.073,.009),steel,handle,.001)
for side in (-1,1):
    box('Charging latch',(-.184,side*.029,.030),(.012,.016,.011),anodized,handle,.001)
    for i in range(4): box('Latch serration',(-.19,side*(.022+i*.003),.030),(.0015,.001,.008),polymer,handle,.0001)
# Folding / telescoping skeleton stock, no AR buffer tube.
box('Rear 1913 interface',(-.181,0,-.005),(.014,.032,.065),steel)
cylinder('Stock folding knuckle',(-.183,.016,.007),.010,.065,steel,'Z',stock)
cylinder('Folding hinge cap',(-.183,.016,.042),.0105,.004,anodized,'Z',stock)
profile('Stock upper spine',[(-.19,.026),(-.376,.024),(-.410,.005),(-.409,-.024),(-.376,-.011),(-.212,.003),(-.190,-.003)],.029,anodized,stock,.0015)
profile('Stock lower skeleton strut',[(-.193,-.009),(-.214,-.019),(-.368,-.060),(-.389,-.056),(-.396,-.071),(-.362,-.076),(-.207,-.036),(-.190,-.022)],.017,steel,stock,.0013)
profile('Adjustable cheek weld',[(-.282,.027),(-.368,.029),(-.405,.009),(-.406,-.029),(-.365,-.018),(-.290,.006)],.040,polymer,stock,.0025)
profile('Stock butt frame',[(-.403,.013),(-.417,.009),(-.436,-.093),(-.418,-.106),(-.399,-.086),(-.382,-.017)],.033,polymer,stock,.003)
profile('Rubber recoil pad',[(-.415,.010),(-.423,.007),(-.443,-.096),(-.435,-.108),(-.420,-.107),(-.431,-.091)],.038,rubber,stock,.002)
for i in range(14):
    z=.001-i*.0068; x=-.424-i*.00125
    box('Butt pad traction rib',(x,0,z),(.0025,.039,.002),polymer,stock,.0006)
box('Length adjustment latch',(-.321,0,-.024),(.041,.020,.009),polymer,stock,.0015)
for side in (-1,1):
    socket = cylinder('Stock sling socket',(-.404,side*.021,-.049),.006,.003,steel,'Y',stock)
    cut(socket,cylinder('CUT',(-.404,side*.021,-.049),.004,.008,None,'Y',None,32,0))
    screw(-.202,side*.019,-.014,.0035,stock)
# Curved 30-round polymer .300 magazine; ribbing follows the body's curve.
mag_points=[(-.016,-.070),(.048,-.070),(.050,-.133),(.060,-.180),(.079,-.226),(.018,-.247),(.001,-.200),(-.010,-.145)]
profile('Curved .300 magazine shell',mag_points,.026,polymer,mag,.002)
profile('Magazine base plate',[(.016,-.243),(.079,-.222),(.083,-.231),(.019,-.254),(.014,-.250)],.031,rubber,mag,.0014)
for side in (-1,1):
    profile('Magazine recessed panel',[(-.005,-.113),(.039,-.113),(.044,-.164),(.061,-.214),(.020,-.229),(.009,-.193)],.001,rubber,mag,.001,y=side*.0136)
    for i in range(4):
        x=-.003+i*.011
        profile('Magazine longitudinal rib',[(x,-.112),(x+.003,-.112),(x+.007,-.163),(x+.025,-.223),(x+.021,-.224),(x+.004,-.165)],.0015,polymer,mag,.0005,y=side*.0145)
    for i in range(6):
        z=-.132-i*.016; shift=max(0,-z-.145)*.29
        profile('Magazine cross rib',[(.000+shift,z),(.045+shift,z+.003),(.046+shift,z-.0005),(.001+shift,z-.0035)],.002,polymer,mag,.00045,y=side*.0145)
    text('.300',(.006 if side==-1 else .041,side*.016,-.109),.005,side,mag)
    text('BLK',(.027 if side==-1 else .047,side*.016,-.235),.0037,side,mag)
# Brass cartridge detail at the feed lips (aesthetic only).
for y in (-.006,.006):
    cylinder('Top round brass',(.019,y,-.073),.0047,.032,brass,parent=mag,vertices=24)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=10,radius=1,location=(.04,y,-.073))
    bullet=bpy.context.object;bullet.scale=(.012,.0039,.0039)
    active(bullet);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    finish(bullet,'Top round copper',copper,mag,0)
# Duplicate magazine geometry for replacement/retention animation.
bpy.context.view_layer.update()
for obj in list(asset.objects):
    if obj.parent == mag:
        clone=obj.copy();clone.data=obj.data.copy();asset.objects.link(clone)
        clone.name=obj.name+' | spare';clone.parent=spare
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
# Named attachment / integration sockets. No runtime code is changed.
for name,loc,parent in [('SOCKET_muzzle',(.456,0,0),rig),('SOCKET_ejection',(-.018,-.030,.004),rig),('SOCKET_grip_R',(-.145,0,-.127),rig),('SOCKET_grip_L',(.171,0,-.028),rig),('SOCKET_magazine',(.017,0,-.082),mag),('SOCKET_sight',(-.039,0,.097),rig)]:
    empty(name,loc,parent)

# Rig rest matrices, explicit channels on every clip prevent state leaking
# when switching from one-shot reloads back to idle in an AnimationMixer.
bpy.context.view_layer.update()
parts=[rig,mag,spare,bolt,handle,trigger,cover,stock,case,release]
rest={o.name:(o.location.copy(),o.rotation_euler.copy(),o.scale.copy()) for o in parts}
clips={}


def key(obj,frame,loc=None,rot=None,scale=None):
    base=rest[obj.name]
    obj.location=base[0]+Vector(loc or (0,0,0))
    obj.rotation_euler=Vector(base[1])+Vector(tuple(math.radians(v) for v in (rot or (0,0,0))))
    obj.scale=(scale,)*3 if scale is not None else base[2]
    for prop in ('location','rotation_euler','scale'):obj.keyframe_insert(data_path=prop,frame=frame,group=obj.name)


def start_clip(name,end):
    clips[name]={'frames':[0,end],'duration':end/60,'loop':name=='Idle','events':[]}
    for obj in parts:
        obj.animation_data_create();obj.animation_data.action=None
        for track in obj.animation_data.nla_tracks:track.mute=True
        action=bpy.data.actions.new(name+' | '+obj.name)
        obj.animation_data.action=action
        hidden=obj in (case,spare)
        for f in (0,end):key(obj,f,scale=0 if hidden else 1)


def end_clip(name,end):
    for obj in parts:
        ad=obj.animation_data;action=ad.action
        for layer in action.layers:
            for action_strip in layer.strips:
                for bag in action_strip.channelbags:
                    for curve in bag.fcurves:
                        if curve.data_path == 'scale':
                            for point in curve.keyframe_points: point.interpolation='CONSTANT'
                        elif obj == case:
                            for point in curve.keyframe_points: point.interpolation='LINEAR'
        track=ad.nla_tracks.new();track.name=name
        strip=track.strips.new(name,0,action);strip.action_frame_start=0;strip.action_frame_end=end
        strip.extrapolation='NOTHING';strip.blend_type='REPLACE'
        ad.action=None;track.mute=True


start_clip('Idle',120)
key(rig,30,(0,0,.0006),(.1,.12,0));key(rig,90,(0,0,-.0006),(-.1,-.12,0))
end_clip('Idle',120)
start_clip('Fire',48)
for f,loc,rot in [(2,(-.014,0,.001),(0,-2.3,-.45)),(5,(-.009,0,.002),(0,-1.4,.2)),(12,(.001,0,0),(0,.15,0)),(20,(0,0,0),(0,0,0))]:key(rig,f,loc,rot)
for f,x in [(1,0),(4,-.068),(7,-.066),(11,0)]:key(bolt,f,(x,0,0))
for f,a in [(1,0),(2,-12),(10,0)]:key(trigger,f,rot=(0,a,0))
key(case,3,(-.02,-.025,.004),scale=0)
# Ballistic-looking sampled trajectory. Linear interpolation avoids overshoot.
for f in range(4,47,2):
    t=(f-4)/60
    key(case,f,(-.022-.48*t,-.038-1.05*t,.006+1.65*t-4.905*t*t),(f*17,f*23,f*11),1)
key(case,47,(-.37,-.80,-1.20),(800,1100,520),0)
clips['Fire']['events']=[{'time':.0333,'event':'shot'},{'time':.0667,'event':'casing_eject'}]
end_clip('Fire',48)
for name,end,empty_reload in [('Reload_Tactical',156,False),('Reload_Empty',198,True)]:
    start_clip(name,end)
    for f,loc,rot in [(18,(-.025,0,.009),(-20,-8,5)),(42,(-.037,0,-.006),(-27,-9,7)),(95,(-.03,0,-.01),(-22,-7,5)),(122,(-.018,0,0),(-15,-4,3)),(end-12,(0,0,0),(0,0,0))]:key(rig,f,loc,rot)
    for f,loc,rot,s in [(20,(0,0,0),(0,0,0),1),(29,(.003,0,-.022),(0,3,0),1),(43,(.012,-.015,-.12),(8,12,-4),1),(61,(.045,-.09,-.30),(24,30,-18),1),(63,(.05,-.11,-.37),(30,37,-20),0),(end-2,(0,0,0),(0,0,0),0)]:key(mag,f,loc,rot,s)
    for f,loc,rot,s in [(62,(.015,-.06,-.35),(15,-18,-10),0),(64,(.015,-.06,-.29),(15,-18,-10),1),(83,(.008,-.025,-.15),(8,-12,-5),1),(102,(.001,0,-.034),(0,-2,0),1),(111,(0,0,.004),(0,0,0),1),(117,(0,0,0),(0,0,0),1),(end-1,(0,0,0),(0,0,0),1)]:key(spare,f,loc,rot,s)
    # Swap identical meshes on the final frame, avoiding duplicate coplanar mags.
    key(mag,end-1,scale=0)
    if empty_reload:
        for f,x in [(0,-.068),(129,-.068),(145,-.075),(155,-.075),(161,0)]:key(bolt,f,(x,0,0))
        for f,x in [(129,0),(145,-.075),(151,-.075),(157,0)]:key(handle,f,(x,0,0))
    clips[name]['events']=[{'time':29/60,'event':'magazine_out'},{'time':111/60,'event':'magazine_in'}]
    if empty_reload:clips[name]['events'].append({'time':161/60,'event':'bolt_forward'})
    end_clip(name,end)
start_clip('Inspect',240)
for f,loc,rot in [(36,(-.025,0,.03),(-34,-12,8)),(88,(-.025,0,.03),(-34,-12,8)),(137,(-.015,0,.038),(34,-8,-12)),(188,(-.015,0,.038),(34,-8,-12)),(228,(0,0,0),(0,0,0))]:key(rig,f,loc,rot)
end_clip('Inspect',240)
start_clip('Stock_Fold',120)
for f,a in [(10,0),(40,-165),(78,-165),(112,0)]:key(stock,f,rot=(0,0,a))
end_clip('Stock_Fold',120)


def select_clip(name,frame=0):
    for obj in parts:
        for track in obj.animation_data.nla_tracks:track.mute=track.name!=name
    scene.frame_start=0;scene.frame_end=clips[name]['frames'][1]
    scene.frame_set(frame)


select_clip('Idle')
for name,info in clips.items():
    for event in info['events']:scene.timeline_markers.new(name+' / '+event['event'],frame=round(event['time']*60))
# Studio presentation. All lights/cameras/background excluded from the GLB.
scene.render.engine='CYCLES'
scene.cycles.samples=48 if args.quick else 128
scene.cycles.use_denoising=True
scene.world.color=(.18,.18,.18)
world=scene.world;world.use_nodes=True
world.node_tree.nodes.get('Background').inputs[0].default_value=(.16,.19,.24,1)
world.node_tree.nodes.get('Background').inputs[1].default_value=.4
scene.view_settings.view_transform='AgX'
scene.view_settings.look='AgX - Medium High Contrast'
scene.view_settings.exposure=-2.1
scene.render.image_settings.file_format='PNG'
scene.render.resolution_x=1920;scene.render.resolution_y=1080
scene.render.resolution_percentage=65 if args.quick else 100


def aim(obj,target):obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()


def camera(name,loc,target,scale):
    data=bpy.data.cameras.new(name);obj=bpy.data.objects.new(name,data);studio.objects.link(obj)
    obj.location=loc;aim(obj,target);data.type='ORTHO';data.ortho_scale=scale;data.lens=55
    return obj


def area(name,loc,power,color,size,target,shape='DISK',size_y=None):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=color;data.shape=shape;data.size=size
    if size_y is not None:data.size_y=size_y
    obj=bpy.data.objects.new(name,data);studio.objects.link(obj);obj.location=loc;aim(obj,target)


hero=camera('CAM_hero',(.43,-1.3,.57),(.005,0,-.045),1.10)
side_cam=camera('CAM_right_profile',(0,-1.7,.13),(.005,0,-.055),1.04)
left_cam=camera('CAM_left_profile',(-.14,1.7,.30),(.005,0,-.055),1.07)
detail_cam=camera('CAM_receiver_detail',(-.21,-.75,.30),(-.025,0,-.010),.47)
first_cam=camera('CAM_first_person',(-.72,-.17,.22),(.14,0,.03),.55)
area('Key | broad softbox',(.1,-.45,.8),85,(.82,.89,1),.65,(0,0,0),'RECTANGLE',.32)
area('Rim | warm strip',(.12,.34,.40),100,(1,.78,.54),.8,(0,0,0),'RECTANGLE',.12)
area('Fill | long side strip',(-.30,-.65,.02),30,(.61,.74,1),.8,(0,0,-.05),'RECTANGLE',.18)
area('Muzzle edge',(.65,.02,.15),22,(1,.92,.82),.25,(.26,0,0))
# Ground provides contact shadow without hiding silhouette; weapon floats for turntable review.
back=box('Studio floor',(0,0,-.295),(200,200,.025),None,None,0)
move_to(back,studio)
mat=bpy.data.materials.new('Studio charcoal');mat.diffuse_color=(.018,.023,.031,1);mat.use_nodes=True
mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.018,.023,.031,1)
mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.82
back.data.materials.append(mat)
scene.camera=hero
# Useful initial workspace, packed maps and readable documentation inside the blend.
notes = bpy.data.texts.new('START HERE')
notes.write('MCX VIRTUS / .300 BLK\n\nStandalone visual asset; not a manufacturing model.\n\nSix synchronized NLA clips are on the named rig objects.\nIdle is selected on opening. Use tools/blender/mcx_review.py\nto select any clip, render stills or create an animation reel.\nAll PBR images are packed, with external copies alongside this file.\nMoving parts use rigid pivots; there is no hand rig or audio.\nThe GLB merges static meshes, but this source keeps editable\ncomponents and bevel modifiers. See adjacent README.md.\n')
scene['clips']=json.dumps(clips)
scene['README']='Standalone visual approximation. Select one matching NLA track on ALL rig objects to preview a clip. See README.md. No hands, sound, gameplay or manufacturing internals.'
for screen in bpy.data.screens:
    for a in screen.areas:
        if a.type=='VIEW_3D':
            a.spaces.active.region_3d.view_perspective='CAMERA'
            a.spaces.active.shading.type='MATERIAL'
# UVs also exist on the editable source, not just on the export copy.
for obj in list(asset.objects):
    if obj.type != 'MESH': continue
    active(obj)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=.006)
    bpy.ops.object.mode_set(mode='OBJECT')
active(rig)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'mcx-virtus.blend'))
if args.render:
    for name,cam in [('hero',hero),('right-profile',side_cam),('left-profile',left_cam),('receiver-detail',detail_cam),('first-person',first_cam)]:
        scene.camera=cam;scene.render.filepath=str(OUT/'renders'/f'{name}.png');bpy.ops.render.render(write_still=True)
    scene.camera=hero
# Export copy in-memory: apply bevels, UV unwrap, merge static geometry by
# animation parent. Source .blend remains editable, with named components.
select_clip('Idle',0)
# Hidden animated parts must have invertible transforms while joining meshes.
for obj in parts:
    for track in obj.animation_data.nla_tracks: track.mute=True
    obj.location, obj.rotation_euler, obj.scale = rest[obj.name]
bpy.context.view_layer.update()
for obj in list(asset.objects):
    if obj.type not in {'MESH','FONT'}:continue
    active(obj)
    bpy.ops.object.convert(target='MESH')
    # Smart unwrap keeps every bevel/boolean face textured in Blender and glTF.
    bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.006)
    bpy.ops.object.mode_set(mode='OBJECT')
# Consolidate draw calls without destroying articulated pivots or named sockets.
for parent in [body,mag,spare,bolt,handle,trigger,cover,stock,case,release]:
    meshes=[o for o in asset.objects if o.type=='MESH' and o.parent==parent]
    if not meshes:continue
    active(meshes[0])
    for obj in meshes:obj.select_set(True)
    bpy.ops.object.join();bpy.context.object.name=parent.name+'_mesh'
# Enable all tracks for the NLA exporter; it isolates tracks by matching names.
for obj in parts:
    for track in obj.animation_data.nla_tracks:track.mute=False
bpy.ops.object.select_all(action='DESELECT')
for obj in asset.objects:obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'mcx-virtus.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_frame_range=False,export_force_sampling=True,export_optimize_animation_keep_anim_object=True,export_sampling_interpolation_fallback='LINEAR',export_extras=True,export_yup=True,export_materials='EXPORT',export_cameras=False,export_lights=False)
# Blender's forced NLA sampler labels changing scale channels LINEAR even
# when their source keys are CONSTANT. Preserve stepped visibility explicitly
# so fractional playback times never shrink both seated magazines together.
glb_path = OUT / 'mcx-virtus.glb'
glb = glb_path.read_bytes()
json_length = struct.unpack_from('<I', glb, 12)[0]
document = json.loads(glb[20:20+json_length])
for animation in document['animations']:
    for channel in animation['channels']:
        if channel['target']['path'] == 'scale':
            animation['samplers'][channel['sampler']]['interpolation'] = 'STEP'
encoded = json.dumps(document, separators=(',', ':')).encode()
encoded += b' ' * (-len(encoded) % 4)
binary_chunk = glb[20+json_length:]
glb_path.write_bytes(struct.pack('<4sII', b'glTF', 2, 20+len(encoded)+len(binary_chunk))
                     + struct.pack('<I4s', len(encoded), b'JSON') + encoded + binary_chunk)
stats={'triangles':0,'vertices':0,'meshes':0,'material_slots':0}
for obj in asset.objects:
    if obj.type=='MESH':
        obj.data.calc_loop_triangles();stats['triangles']+=len(obj.data.loop_triangles)
        stats['vertices']+=len(obj.data.vertices);stats['meshes']+=1;stats['material_slots']+=len(obj.data.materials)
manifest={'asset':'MCX VIRTUS .300 BLK','units':'metres','blender_forward':'+X','gltf_up':'+Y','gltf_forward':'+X','gltf_ejection':'+Z','clips':clips,'stats':stats,'textures':{'resolution':N,'packed_in_blend':True,'embedded_in_glb':True},'notes':['Standalone asset: no game integration, hands, audio or muzzle FX.','Visual approximation; not licensed by or affiliated with SIG SAUER.','Reload clips use two magazine meshes with visibility keyed by scale.','Fire casing path is baked; use SOCKET_ejection for runtime physics.','Optic uses KHR_materials_transmission; add a collimated reticle for gameplay.']}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('MCX_EXPORT_COMPLETE',json.dumps(stats))
