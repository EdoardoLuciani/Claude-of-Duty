"""Reference-approved MPX exterior with eight native gameplay clips.
blender -b --threads 2 --python-exit-code 1 --python tools/blender/mpx/build.py -- --render
Original reference-informed game art; never manufacturing geometry.
"""
import argparse
import json
import math
from pathlib import Path
import struct
import sys

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import picatinny
from review_hands import without_review_hands
from mpx.actions import author_actions
from mpx.animations import prepare_export_actions
from mpx.finishes import consolidate_finishes


def build(output, render=False, quick=False):
    """Regenerate all MPX products; only calibration/shared appearance are inputs."""
    OUT = output
    REVIEW = OUT / 'renders'
    OUT.mkdir(parents=True, exist_ok=True)
    if render:
        REVIEW.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.world = bpy.data.worlds.new('World')
    scene.world.use_nodes = True
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


    def empty(name, loc=(0, 0, 0), parent=None):
        o = bpy.data.objects.new(name, None)
        asset.objects.link(o)
        o.location = loc
        o.parent = parent
        o.empty_display_size = .012
        return o


    rig = empty('MPX_RIG')
    rig['status'] = 'Base conversion candidate; human visual/animation/gameplay review pending'
    rig['coordinate_system'] = 'metres; Blender +X forward, +Z up, -Y right/ejection side'
    body = empty('receiver', parent=rig)
    mag = empty('magazine', parent=rig)
    bolt = empty('bolt', parent=rig)
    handle = empty('charging_handle', parent=rig)
    selector = empty('selector', parent=rig)
    trigger = empty('trigger',(-.003,0,-.037),rig)
    stock = empty('stock_hinge', parent=rig)
    release = empty('bolt_release', (.033,.026,-.050), rig)
    mag_catch = empty('magazine_catch', parent=rig)
    rounds = empty('magazine_rounds', parent=mag)
    bpy.context.view_layer.update()

    # Stage 1: original maps and finishes.
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


    finish_slots = {}

    def material(slot, name, color, metal, roughness, detail):
        m = bpy.data.materials.new(f'{slot + 1:02d} | {name}')
        finish_slots[m] = slot
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


    # Slots are zero-based UV1 tile indices; holes keep surviving UVs fixed.
    alloy = material(0, 'black anodized receiver', (.060, .065, .071), 1, .66, .13)
    polymer = material(2, 'black moulded polymer', (.030, .032, .035), 0, .84, .55)
    rubber = material(3, 'grip and butt rubber', (.022, .024, .026), 0, .94, 1)
    steel = material(4, 'black oxidized controls and fasteners', (.066, .072, .08), 1, .51, .18)
    carrier = material(5, 'satin steel carrier', (.18, .19, .21), 1, .48, .1)
    magmat = material(7, 'smoked magazine polymer', (.052, .058, .062), 0, .54, .25)
    markmat = material(8, 'subdued laser marking', (.28, .29, .30), 0, .67, .03)
    brass = material(12, 'loaded cartridge brass', (.25, .15, .055), 1, .55, .06)
    copper = material(13, 'loaded bullet jacket', (.22, .09, .045), 1, .58, .04)


    def finish(o, name, mat=alloy, parent=body, bevel=.0006, smooth=False):
        o.name = name
        for c in list(o.users_collection):
            c.objects.unlink(o)
        asset.objects.link(o)
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
            mod.width = bevel; mod.segments = 1 if name == 'Magazine moulded witness dot' else 2; mod.harden_normals = True
            if name == 'Magazine moulded witness dot':
                # Sub-millimetre dots need rounded caps, not bevelled radial seams.
                mod.angle_limit = math.radians(60)
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


    def text(label,loc,size=.003,side=-1,parent=body,mat=markmat,surface=None):
        c = bpy.data.curves.new(label, 'FONT'); c.body = label; c.size = size; c.resolution_u = 2
        o = bpy.data.objects.new('Mark | '+label, c); asset.objects.link(o)
        o.location = loc; o.rotation_euler = (math.pi/2, 0, 0) if side == -1 else (math.pi/2, 0, math.pi)
        c.materials.append(mat); o.parent = parent; o.matrix_parent_inverse = parent.matrix_world.inverted()
        if surface:
            o['decal_target']=surface.name
            o['decal_side']=side


    # Stage 2: reference-registered component geometry.
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
    # The top shoulder seats inside the upper's flat datum; do not leave a gap.
    well = traced('Flared 9mm magazine well',[(761,258),(824,259),(831,285),(831,310),
        (835,332),(830,339),(812,343),(761,346),(758,340),(758,280)],.047,bevel=.0025,smooth=True)
    opening(well,(.069,0,-.086),(.050,.031,.045),.003)
    traced('Magazine well lower rim',[(758,338),(813,336),(834,326),(838,328),
        (838,338),(815,345),(760,349)],.049,bevel=.001)
    guard = traced('Curved trigger guard',[(681,292),(759,292),(771,314),(765,329),
        (750,340),(726,345),(700,343),(682,337),(672,327),(670,313)],.015,bevel=.002,smooth=True)
    opening(guard,(.0072,0,-.0672),(.059,.033,.034),.013)
    # Root penetrates its receiver pocket; the first candidate floated below it.
    trigger_shape = trace([(701,276),(709,276),(709,290),(705,300),(699,313),(700,319),
                           (706,326),(704,329),(697,324),(692,317),(693,309),(698,296)])
    profile('Curved trigger blade', trigger_shape, .006, steel, trigger, bevel=.0008)
    for side in (-1,1):
        screw((-.052,side*.023,-.030), .0023)
        screw((.017,side*.023,-.028), .0024)
        cyl('Selector centre', (-.035,side*.025,-.041), .0052, .003, steel, 'Y', selector)
        paddle = box('Selector paddle', (-.027,side*.027,-.041), (.020,.003,.006), steel, selector, .002)
        paddle.rotation_euler.y = -.15
        for label,x,z in [('S',-.047,-.033),('1',-.031,-.035),('A',-.014,-.034)]:
            text(label,(x,side*.024,z),.0031,side,surface=lower)
        box('Magazine release fence',(.034,side*.024,-.043),(.012,.002,.020),alloy,bevel=.002)
        box('Magazine release button',(.034,side*.026,-.043),(.008,.002,.014),steel,mag_catch,bevel=.0015)
        for i in range(5):
            box('Release serration',(.034,side*.0273,-.047+i*.002),(.006,.0004,.00055),polymer,mag_catch,bevel=.0001)
        for x,z in [(-.092,-.023),(.095,-.027)]:
            cyl('Receiver retaining pin', (x,side*.023,z), .0035, .0025, steel, 'Y')
    box('Left bolt-release paddle', (.033,.027,-.035), (.010,.005,.015), steel, release, .0015)
    box('Bolt-release lower lever', (.033,.026,-.050), (.004,.004,.018), steel, release, .001)
    text('SIG SAUER INC.',(.015,.0233,-.034),.0028,1,surface=lower)
    text('NEWINGTON NH USA',(.024,.0233,-.038),.0021,1,surface=lower)
    text('MPX 9mm',(.054,-.024,-.066),.004,-1,surface=well)
    text('MPX-GAME-0001',(.074,.024,-.068),.0023,1,surface=well)

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
        text('SIG SAUER',(-.064 if side==-1 else -.044,side*.014,-.074),.0030,side,mat=polymer,surface=grip)
    for i in range(8):
        x=-.046-i*.0031; z=-.097-i*.0054
        box('Grip front traction rib',(x,0,z),(.0015,.027,.0010),rubber,bevel=.0004)

    # Hollow 8-inch shell. Slots and angled vents are actual through openings.
    hg_start, hg_end = .096, .300
    # Section points give y, z and front-lip setback (only at the bottom corners).
    section = [(-.016,.036,0),(.016,.036,0),(.024,.024,0),(.025,-.015,0),
               (.017,-.026,.006),(-.017,-.026,.006),(-.025,-.015,0),(-.024,.024,0)]
    verts = ([(hg_start,y,z) for y,z,_ in section] +
             [(hg_end-setback,y,z) for y,z,setback in section])
    faces = [(i,(i+1) % 8,(i+1) % 8+8,i+8) for i in range(8)]
    hg = mesh('Hollow five-slot M-LOK handguard', verts, faces, bevel=0)
    active(hg)
    mod = hg.modifiers.new('Reference-inferred shell thickness', 'SOLIDIFY'); mod.thickness = .002
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for x,length in [(.119,.011),(.148,.035),(.190,.035),(.232,.035),(.274,.035)]:
        opening(hg, (x,0,-.001), (length,.080,.009), .0033)
    for x in np.linspace(.123,.282,8):
        cut(hg, profile('CUT', [(x-.006,.033),(x-.002,.026),(x+.006,.026),(x+.002,.033)], .08, None, None, bevel=.0005))
        cut(hg, profile('CUT', [(x-.007,-.020),(x-.001,-.012),(x+.007,-.012),(x+.001,-.020)], .08, None, None, bevel=.0005))
    mod = hg.modifiers.new('Slot rim radii', 'BEVEL'); mod.width=.00055; mod.segments=2; mod.harden_normals=True
    mod = hg.modifiers.new('Weighted shell normals', 'WEIGHTED_NORMAL'); mod.keep_sharp=True
    for side in (-1,1):
        screw((.105,side*.025,-.006), .003)
    # Canonical Picatinny head/neck, with a groove centred on MOUNT_optic.
    for name, outline, spans in [
        ('Picatinny spine', picatinny.section(.044,.034,slot=True), [(-.108,.304)]),
        ('Picatinny rail tooth', picatinny.section(.044,.034), picatinny.lands(-.108,.304,.025)),
    ]:
        for a,b in spans:
            loft(name,[[(y,x,z) for x,z in outline] for y in (a,b)],alloy,bevel=0)
    # Full 8-inch exterior including the formerly hidden, open 9mm crown.
    breech = .109
    barrel_end = breech+.2032
    tube('External barrel', ((breech+barrel_end)/2,0,0), .0076, .0047, .2032)
    cyl('External barrel shoulder', (.141,0,0), .0105, .043, steel, bevel=.0003)
    device = empty('MUZZLE_device', parent=body)
    tube('Muzzle thread protector', (barrel_end,0,0), .0105, .0077, .012, steel, device)
    adapter = empty('MUZZLE_device_removed', parent=body)
    tube('MPX suppressor adapter sleeve', (barrel_end+.001,0,0), .0093, .0077, .018, steel, adapter)
    adapter.hide_render = True
    adapter.hide_viewport = True
    # Game-fit direct-thread adapter, not factory hardware or internal engineering.
    muzzle_mount = empty('MOUNT_muzzle', (barrel_end+.004,0,0), body)
    muzzle_mount.rotation_euler.z = -math.pi/2

    # Photo-registered 30-round curved magazine. Cross-sections follow the curve's
    # tangent instead of remaining horizontal and making an oversized flat slab.
    # Visible stations follow the frozen PDF25 pixels; concealed neck/depth inferred.
    mag_pixels=[(808,283),(808,319),(810,343),(816,365),(824,389),
                (834,413),(847,440),(860,464),(873,487)]
    centres=[Vector(((x-710)*S,0,(232-y)*S)) for x,y in mag_pixels]
    normals=[]
    mag_rings=[]
    for i,centre in enumerate(centres):
        tangent=centres[min(i+1,len(centres)-1)]-centres[max(0,i-1)]
        normal=Vector((-tangent.z,0,tangent.x)).normalized()
        normals.append(normal)
        ring=[]
        for j in range(20):
            a=2*math.pi*j/20
            c,s=math.cos(a),math.sin(a)
            point=centre+normal*(math.copysign(abs(c)**.45,c)*.020)
            point.y=math.copysign(abs(s)**.45,s)*.0135
            ring.append(tuple(point))
        mag_rings.append(ring)
    mag_shell=loft('Curved 30-round magazine shell',mag_rings,magmat,mag,bevel=.0004)
    mag_shell['reference_stations']='PDF25 at frozen uniform registration; no independently stretched axes'
    # Exterior feeding-end detail only: open neck, seated lips/follower and two
    # decorative cartridges. No functional spring, chamber or manufacturing data.
    neck = centres[0].x
    opening(mag_shell, (neck,0,-.041), (.034,.022,.026), .001)
    box('Visible magazine follower',(neck,0,-.053),(.031,.020,.002),polymer,mag,.0005)
    for side in (-1,1):
        profile('Extended magazine feed lip',[(neck-.017,-.050),(neck+.017,-.050),
            (neck+.017,-.044),(neck+.013,-.037),(neck-.013,-.037)],
            .003,steel,mag,y=side*.0105,bevel=.0005)
    for y,z in [( .0045,-.0405),(-.0045,-.0475)]:
        start = neck-.014
        cyl('Decorative loaded cartridge',(start+.0096,y,z),.00465,.0192,brass,parent=rounds,sides=24,bevel=.00015)
        cyl('Loaded cartridge rim',(start+.0006,y,z),.0049,.0012,brass,parent=rounds,sides=24,bevel=.00010)
        rings = [[(start+.0192+x,y+math.cos(a)*r,z+math.sin(a)*r)
                  for a in np.linspace(0,2*math.pi,24,endpoint=False)]
                 for x,r in [(0,.0045),(.002,.0044),(.006,.0034),(.009,.0018),(.0105,.0002)]]
        loft('Decorative loaded bullet jacket',rings,copper,rounds,bevel=0)
    for side in (-1,1):
        for offset in (-.011,.011):
            edge_a=[c+n*(offset-.0008) for c,n in zip(centres[2:],normals[2:])]
            edge_b=[c+n*(offset+.0008) for c,n in zip(centres[2:],normals[2:])]
            points=edge_a+edge_b[::-1]
            profile('Magazine longitudinal traction rib',[(p.x,p.z) for p in points],
                    .0010,polymer,mag,y=side*.0138,bevel=.0002)
        for i in range(28):
            t=2+i/27*(len(centres)-3)
            j=min(int(t),len(centres)-2)
            f=t-j
            centre=centres[j].lerp(centres[j+1],f)
            normal=normals[j].lerp(normals[j+1],f).normalized()
            for offset in (-.0055,.0055):
                p=centre+normal*offset
                cyl('Magazine moulded witness dot',(p.x,side*.0138,p.z),.00085,.0004,
                    polymer,'Y',mag,8,.0001)
    base=box('Magazine floor plate',tuple(centres[-1]+Vector((0,0,-.0028))),
             (.0455,.029,.0055),polymer,mag,.001)
    base.rotation_euler.y=-math.atan2(normals[-1].z,normals[-1].x)
    text('30',(.125,-.014,-.193),.004,-1,mag,surface=mag_shell)

    # A reusable fresh magazine has the same original exterior, not a new material.
    spare = empty('magazine_spare', parent=rig)
    spare_rounds = empty('magazine_spare_rounds', parent=spare)
    for o in list(asset.objects):
        if o.type == 'MESH' and o.parent in (mag, rounds):
            clone = o.copy()
            asset.objects.link(clone)
            clone.name = 'Spare | ' + o.name
            clone.parent = spare if o.parent == mag else spare_rounds

    # Stock silhouette, continuous structural shaft, inset web and actual sling hole.
    box('Rear 1913 interface',(-.113,0,.003),(.014,.043,.058),alloy,bevel=.0015)
    cyl('Folding hinge pin',(-.122,.015,.004),.004,.050,steel,'Z',stock)
    box('Folding hinge leaf',(-.127,0,.004),(.015,.028,.045),alloy,stock,.0015)
    box('Telescoping stock shaft',(-.180,0,.010),(.111,.016,.019),alloy,stock,.0012)
    # Registration follows the cheek housing, stepped toe and narrow opening
    # of the telescoping stock in the 8-inch catalog side view.
    stock_outline=trace([(328,202),(505,202),(508,210),(506,239),(482,241),
        (457,268),(422,274),(373,319),(396,341),(381,357),(338,357),(326,345),(317,221)])
    butt=profile('Factory telescoping stock moulding',stock_outline,.035,polymer,stock,bevel=.003,smooth=True)
    cut(butt,traced('CUT',[(366,311),(373,315),(413,278),(405,273)],.06,None,None,bevel=.002))
    for side in (-1,1):
        traced('Inset diagonal stock web',[(329,237),(479,238),(451,267),(411,271),
            (369,309),(351,306),(345,279)],.0015,rubber,stock,y=side*.0173,bevel=.0006)
        traced('Cheek traction inset',[(337,211),(499,211),(497,226),(334,228)],
               .0009,polymer,stock,y=side*.0178,bevel=.001)
        qd=cyl('Stock QD socket lip',(-.289,side*.0185,-.019),.007,.002,steel,'Y',stock)
        cut(qd,cyl('CUT',(-.289,side*.0185,-.019),.0048,.020,None,'Y',None,32,0))
        for x in (-.28,-.205):
            box('Cheek moulding relief',(x,side*.018,.010),(.017,.001,.006),rubber,stock,.001)
        text('SIG SAUER',(-.293 if side == -1 else -.270,side*.0178,-.084),.004,side,stock,mat=polymer,surface=butt)
    traced('Buttpad',[(328,202),(333,204),(327,222),(342,344),(386,344),
        (386,354),(377,359),(335,358),(329,348),(315,224),(317,210)],
        .037,rubber,stock,bevel=.002)

    # Rear ambidextrous non-reciprocating charging handle, correct MPX control location.
    box('Charging handle shaft',(-.029,0,.030),(.167,.010,.006),steel,handle,.0008)
    traced('Ambidextrous charging handle head',[(579,180),(595,179),(601,190),(582,193)],.059,steel,handle,bevel=.0018)
    for side in (-1,1):
        box('Charging latch',(-.099,side*.027,.037),(.012,.006,.008),polymer,handle,.001)
        for i in range(4):
            box('Charging handle traction',(-.103+i*.002,side*.030,.037),(.001,.0014,.006),steel,handle,.0002)

    # Deployed factory-style backup sights; removed state retains folded hardware.
    irons = empty('IRON_sights', parent=body)
    folded = empty('IRON_sights_removed', parent=body)
    for parent in (irons, folded):
        for x in (-.079,.284):
            box('Iron rail clamp',(x,0,.047),(.028,.029,.010),steel,parent,.0015)
            cyl('Iron sight hinge',(x+.005,0,.054),.0048,.030,steel,'Y',parent)
            screw((x,-.016,.048),.003,parent)
            if parent == folded:
                box('Folded sight leaf',(x-.003,0,.054),(.024,.017,.004),steel,parent,.0012)
            else:
                box('Deployed sight stalk',(x,0,.062),(.006,.008,.019),steel,parent,.0006)
    # Open rear peep and slender front blade meet at the authored aim datum.
    tube('Rear iron aperture',(-.079,0,.074),.005,.0018,.003,steel,irons)
    box('Front iron post',(.284,0,.070),(.003,.0016,.008),steel,irons,.0001)
    for side in (-1,1):
        box('Front iron guard',(.284,side*.007,.070),(.006,.003,.018),steel,irons,.0007)
    folded.hide_render = True
    folded.hide_viewport = True
    optic_mount = empty('MOUNT_optic', (.025,0,.044), body)
    optic_mount.rotation_euler.z = -math.pi/2

    for name,loc in {'muzzle':(barrel_end+.006,0,0),'barrel_crown':(barrel_end,0,0),'breech':(breech,0,0),
                     'ejection':(.070,-.027,.010),'sight':(-.079,0,.074),'front_post':(.284,0,.074),
                     'grip_right':(-.045,0,-.103),'grip_left':(.209,0,-.017),
                     'magazine':(.069,0,-.065)}.items():
        empty('SOCKET_'+name,loc,rig)

    # Seat the fixed rail on the chamfer, set back from the front lip.
    (top_y, top_z, _), (side_y, side_z, _) = section[0], section[-1]
    roll = Matrix.Rotation(-math.atan2(top_y-side_y,top_z-side_z), 3, 'X')
    seat = Vector((.270,(top_y+side_y)/2,(top_z+side_z)/2))
    rail = empty('MOUNT_rail', seat + roll @ Vector((0,-.014,0)), body)
    rail.rotation_euler = (roll @ Matrix(((0,1,0),(0,0,1),(1,0,0)))).to_euler()
    web = box('Laser rail adapter web',seat + roll @ Vector((-.005,-.005,0)),(.035,.011,.014),alloy)
    web.rotation_euler = roll.to_euler()
    bpy.context.view_layer.update()
    picatinny.build_rail('Laser rail adapter',rail.matrix_world@Matrix.Rotation(math.pi,4,'Y'),-.0126,.0226,steel,body,asset)

    # Stage 3: surface-fitted markings and original component atlas UVs.
    # Project original text mesh vertices onto their declared physical surface, not
    # a guessed plane beyond the part's edge. Fail loudly if any glyph misses it.
    bpy.context.view_layer.update()
    decal_trees={}
    # Original components remain editable in .blend. Apply/unwrap export copies later.
    for o in list(asset.objects):
        if o.type not in {'MESH','FONT'}:
            continue
        active(o)
        if o.type == 'FONT':
            bpy.ops.object.convert(target='MESH')
            if 'decal_target' in o:
                name=o['decal_target']
                if name not in decal_trees:
                    target=bpy.data.objects[name].evaluated_get(bpy.context.evaluated_depsgraph_get())
                    data=target.to_mesh()
                    decal_trees[name]=BVHTree.FromPolygons([target.matrix_world@v.co for v in data.vertices],
                        [tuple(p.vertices) for p in data.polygons],all_triangles=False)
                    target.to_mesh_clear()
                side=o['decal_side']
                inverse=o.matrix_world.inverted()
                for vertex in o.data.vertices:
                    p=o.matrix_world@vertex.co
                    hit=decal_trees[name].ray_cast(p+Vector((0,side*.10,0)),Vector((0,-side,0)),.20)[0]
                    assert hit is not None,(o.name,'glyph falls outside declared surface',tuple(p))
                    vertex.co=inverse@(hit+Vector((0,side*.00010,0)))
                o.data.update()
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


    # Stage 4: unchanged studio and native weapon/review-hand actions.
    target=(.070,0,-.025)
    cams={
        'left':camera('left',(.070,2.5,-.025),target,.89),
        'right':camera('right',(.070,-2.5,-.025),target,.89),
        'beauty':camera('beauty',(.63,-1.30,.46),target,.90),
        'receiver_detail':camera('receiver_detail',(.16,-.55,.15),(.018,0,-.018),.34),
        'magazine_detail':camera('magazine_detail',(.22,-.50,.012),(.065,0,-.110),.46),
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
    if quick:
        scene.render.resolution_percentage=50
        scene.eevee.taa_render_samples=16
    scene.camera=cams['beauty']
    notes=bpy.data.texts.new('MPX_README')
    clips = author_actions(ROOT, asset, rig, [rig, mag, spare, bolt, handle, selector, trigger, release, mag_catch, rounds, spare_rounds],
                           mag, spare, bolt, trigger, release, mag_catch, rounds)
    scene['clips'] = json.dumps(clips)
    scene.frame_start = 0
    scene.frame_end = math.ceil(max(c['frames'][1] for c in clips.values()))
    for o in bpy.data.objects:
        if o.animation_data:
            o.animation_data.action = None
            for track in o.animation_data.nla_tracks: track.mute = track.name != 'Idle'
    scene.frame_set(0)
    bpy.context.view_layer.update()
    notes.write('GENERATED PREVIEW: edit tools/blender/mpx/; rebuild from Python.\n'
                'Base conversion candidate; human visual/animation/gameplay review pending.\n'
                'Eight native weapon/wrist/finger clips; select matching NLA tracks on controls and review arms.\n'
                'Shared review skins are not exported; runtime uses shared IK and live casing pools.\n'
                'Original packed 1K PBR maps; photo-inferred depths/typography, not manufacturing CAD.\n'
                'Metres; +X forward, +Z up, -Y ejection. Runtime normalizes the basis once.\n')
    # Stage 5: generated editable preview, saved before runtime preparation.
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'mpx.blend'))
    if render:
        # Preserve the approved fixed geometry/photo views without review-only arms.
        hands_collection=bpy.data.collections['MPX | authored hands (shared appearance)']
        hands_collection.hide_render=True
        for name,cam in cams.items():
            scene.camera=cam; scene.render.filepath=str(REVIEW/(name+'.png'))
            bpy.ops.render.render(write_still=True)
        hands_collection.hide_render=False

    # Stage 6: evaluated rigid copies and native runtime actions/export.
    # Export evaluated copies; retain native NLA, but never export duplicate arm skins.
    # Mute all tracks and restore scale-one static parents before copying children:
    # otherwise the hidden spare collapses every descendant permanently in the GLB.
    for o in bpy.data.objects:
        if o.animation_data:
            for track in o.animation_data.nla_tracks: track.mute = True
    scene.frame_set(0)
    spare.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    # Merge only mesh copies sharing a rigid parent; original source remains editable.
    export=bpy.data.collections.new('EXPORT | evaluated copies')
    scene.collection.children.link(export)
    folded.hide_viewport = False
    adapter.hide_viewport = False
    bpy.context.view_layer.update()
    copy_by_source={}
    for o in list(asset.objects):
        clone=o.copy()
        clone.hide_render = False
        if o.data: clone.data=o.data.copy()
        export.objects.link(clone); clone.parent=None; clone.matrix_world=o.matrix_world.copy()
        copy_by_source[o]=clone
    for source,clone in copy_by_source.items():
        if source.parent:
            world=clone.matrix_world.copy(); clone.parent=copy_by_source[source.parent]; clone.matrix_world=world
    # Evaluate the selected export copies together instead of updating the scene per modifier.
    meshes = [clone for clone in copy_by_source.values() if clone.type == 'MESH']
    active(meshes[0])
    for clone in meshes:
        clone.select_set(True)
    bpy.ops.object.convert(target='MESH')
    consolidate_finishes(meshes, finish_slots, OUT, orm_map, normal_map)
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
    prepare_export_actions(list(export.objects), clips)
    bpy.ops.object.select_all(action='DESELECT')
    for o in export.objects: o.select_set(True)
    bpy.context.view_layer.objects.active=copy_by_source[rig]
    with without_review_hands():
        bpy.ops.export_scene.gltf(filepath=str(OUT/'mpx.glb'),export_format='GLB',use_selection=True,
                                  export_animations=True,export_animation_mode='ACTIONS',export_merge_animation='NLA_TRACK',
                                  export_frame_range=False,export_force_sampling=False,
                                  export_optimize_animation_keep_anim_object=True,
                                  export_sampling_interpolation_fallback='LINEAR',
                                  export_extras=True,export_yup=True,export_cameras=False,export_lights=False,
                                  export_vertex_color='ACTIVE',export_all_vertex_colors=False,
                                  export_rest_position_armature=False)
    raw=(OUT/'mpx.glb').read_bytes()
    length,kind=struct.unpack_from('<II',raw,12)
    assert kind==0x4e4f534a
    j=json.loads(raw[20:20+length])
    # Read-only native-output validation; never rewrite GLB JSON or buffers.
    assert {animation['name'] for animation in j['animations']} == set(clips)
    for animation in j['animations']:
        duration=clips[animation['name']]['duration']
        for sampler in animation['samplers']:
            acc=j['accessors'][sampler['input']]
            view=j['bufferViews'][acc['bufferView']]
            offset=28+length+view.get('byteOffset',0)+acc.get('byteOffset',0)
            times=struct.unpack_from('<'+'f'*acc['count'],raw,offset)
            endpoint=struct.unpack('<f',struct.pack('<f',duration))[0]
            assert times[0]==0 and times[-1]==endpoint, (animation['name'], times[-1], endpoint)
            assert all(a<b for a,b in zip(times,times[1:])), animation['name']
        for channel in animation['channels']:
            sampler=animation['samplers'][channel['sampler']]
            # One-key curves are always baked with our LINEAR fallback; one key cannot interpolate.
            if channel['target']['path']=='scale' and j['accessors'][sampler['input']]['count']>1:
                assert sampler['interpolation']=='STEP'
    triangles=0
    for node in j.get('nodes',[]):
        if 'mesh' in node:
            for p in j['meshes'][node['mesh']]['primitives']:
                triangles+=j['accessors'][p['indices']]['count']//3
    stats={'triangleInstances':triangles,'primitives':sum(len(m['primitives']) for m in j['meshes']),
           'materials':len(j.get('materials',[])),'images':len(j.get('images',[])),'bytes':len(raw)}
    assert triangles<80000,stats
    assert stats['primitives']==16 and stats['materials']==1 and stats['images']==3 and len(raw)<=10*1024*1024,stats
    # Stage 7: separate manifest metadata (the GLB remains read-only).
    manifest={'status':'Base conversion candidate — human visual/animation/gameplay review pending',
        'asset':'SIG MPX 8 inch / open 9mm crown and thread protector / 30-round magazine / removable deployed irons',
        'units':'metres','blenderForward':'+X','blenderUp':'+Z','stats':stats,'clips':clips,
        'source':'tools/blender/mpx/build.py + tools/blender/mpx/animations.py + tools/blender/mpx/actions.py',
        'runtimeBasis':'GLB +X forward / +Y up / +Z right; adapter rotates basis +90 degrees around Y once',
        'textures':{'resolution':1024,'packed':True,'embedded':True,'method':'original deterministic surface maps; no photographic inputs'},
        'dimensions':{'nominalBarrel':.2032,'barrelBreech':breech,'barrelCrown':barrel_end,
                      'muzzle':barrel_end+.006,'ironAxis':.074,'rearAperture':.0036,
                      'opticMount':[.025,0,.044],'muzzleMount':[barrel_end+.004,0,0]},
        'notes':['Reference-supported assembly, not proof that the hero photograph depicts this barrel.',
                 'Depths, relief, magazine translucency and typography remain inferred.',
                 'No functional internals, certified pixel parity, or AAA visual sign-off.',
                 'Shared wrist/finger curves, reactive game recoil, pooled casings; no exported duplicate arms.']}
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('MPX_GATE_3_STATS',json.dumps(stats))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.cache/blender/weapons/sig-mpx')
    parser.add_argument('--render', action='store_true')
    parser.add_argument('--quick', action='store_true', help='Only reduce preview resolution/samples')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    build(args.output.resolve(), args.render, args.quick)


if __name__ == '__main__':
    main()
