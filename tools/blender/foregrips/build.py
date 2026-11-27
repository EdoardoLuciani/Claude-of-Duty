"""Build the black foregrip exteriors as original, non-functional game props."""
import argparse
from math import copysign, cos, hypot, pi, sin, tau
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[3]


def finish(name, value, roughness, metal=0):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (value * .99, value, value * 1.02, 1)
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = material.diffuse_color
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metal
    return material


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def mesh(name, points, faces, material):
    data = bpy.data.meshes.new(name)
    data.from_pydata(points, [], faces)
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    if material:
        obj.data.materials.append(material)
    return obj


def loft(name, rings, material):
    n = len(rings[0])
    last = n * (len(rings) - 1)
    faces = [tuple(reversed(range(n))), tuple(last + i for i in range(n))]
    for base in range(0, last, n):
        faces.extend((base + i, base + (i+1)%n, base + (i+1)%n + n, base + i + n) for i in range(n))
    return mesh(name, [p for ring in rings for p in ring], faces, material)


def profile(name, outline, half_width, material, x=0):
    return loft(name, [[(u, y, z) for y, z in outline] for u in (x-half_width, x+half_width)], material)


def round_edges(obj, width, segments=3):
    activate(obj)
    mod = obj.modifiers.new('Molded edge radii', 'BEVEL')
    mod.width, mod.segments, mod.limit_method = width, segments, 'ANGLE'
    mod.harden_normals = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for face in obj.data.polygons:
        face.use_smooth = True
    mod = obj.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    mod.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def recess(obj, cutter):
    activate(obj)
    mod = obj.modifiers.new('Visible recess', 'BOOLEAN')
    mod.object = cutter
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def cylinder(name, location, radius, depth, material, sides=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=radius, depth=depth,
                                      location=location, rotation=(0, pi/2, 0))
    obj = bpy.context.object
    obj.name = name
    if material:
        obj.data.materials.append(material)
    return obj


def ease(t):
    t = max(0, min(1, t))
    return t*t*(3-2*t)


def afg_cheek(x, y, z):
    # Round the diagonal beam into the underside and heel without changing its side outline.
    distance = z - (.582*y - .0263)
    along = ease((y+.060)/.012) * ease((.009-y)/.019)
    face = along * (.0019*ease((distance+.001)/.005)*ease((.019-distance)/.009)
                    - .0031*ease((.004-distance)/.006))
    heel = ease((-z-.050)/.013) * ease((-.036-y)/.013)
    toe = ease((-z-.020)/.007) if y > .048 else 0
    return x + x/.0183 * (face - .0031*heel - .0029*toe)


def round_afg_cheek(shell):
    # Sample the host cheek before cutting the web, leaving its drafted rings intact.
    activate(shell)
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bm = bmesh.new()
    bm.from_mesh(shell.data)
    normal = (0, -.582, 1)
    for z in (-.035, -.032, -.030, -.028, -.0255, -.023, -.019, -.015, -.011, -.007):
        bmesh.ops.bisect_plane(bm, geom=[*bm.verts, *bm.edges, *bm.faces], dist=.000001,
                              plane_co=(0, 0, z), plane_no=normal)
    for y in (-.056, -.048, -.038, -.018, -.006, .005):
        bmesh.ops.bisect_plane(bm, geom=[*bm.verts, *bm.edges, *bm.faces], dist=.000001,
                              plane_co=(0, y, 0), plane_no=(0, 1, 0))
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(shell.data)
    bm.free()
    recess(shell, afg_web_opening())
    for vert in shell.data.vertices:
        vert.co.x = afg_cheek(*vert.co)
    for face in shell.data.polygons:
        face.use_smooth = True
    normals = shell.modifiers.new('Molded cheek normals', 'WEIGHTED_NORMAL')
    normals.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=normals.name)


def ribbed_pad(name, path, ribs, material, rib_run=None, back=None, crown=None):
    # The side margin stays smooth even where the transverse ribs follow the camber.
    rings = []
    start, end = path[0][0], path[-1][0]
    first, last = rib_run or (start+.0017, end-.0017)
    cuts = [(y, 0) for y, _, _ in path]
    for i in range(ribs):
        y = first + (last-first) * (i+.5) / ribs
        for d, up in ((-.00058, 0), (-.00024, .00055), (.00024, .00055), (.00058, 0)):
            cuts.append((y+d, up))
    surface = ((-1,.0017), (-.9,.00073), (-.69,.00026), (-.4,.00007), (0,0),
               (.4,.00007), (.69,.00026), (.9,.00073), (1,.0017))
    for y, lift in sorted(cuts):
        a, b = next((a, b) for a, b in zip(path, path[1:]) if a[0] <= y <= b[0])
        t = (y-a[0]) / (b[0]-a[0])
        z = a[1] + (b[1]-a[1]) * t
        w = a[2] + (b[2]-a[2]) * t
        sweep = min(.00135, y-start, end-y)
        dome = crown(y) if crown else 0
        top = max(.0027+dome, back(y)-z) if back else .0027
        rings.append([(w*x, y+sweep*(1-x*x), z+dz+dome*x*x+lift*ease((.86-abs(x))/.27))
                      for x, dz in surface])
        rings[-1].insert(0, (-.82*w, y+sweep*(1-.82**2), z+top))
        rings[-1].append((.82*w, y+sweep*(1-.82**2), z+top))
    return smooth(loft(name, rings, material))


def afg_web_opening():
    throat = ((-.0515,-.01355), (-.0250,-.01355), (-.0227,-.0150), (-.0233,-.0175),
              (-.0419,-.0322), (-.0451,-.0339), (-.0482,-.0319), (-.0522,-.0167))
    # Pair the heel wrap, rib-side shoulder and brow return with the accepted throat.
    shoulder = ((-.054,-.0097), (-.0137,-.0097), (-.0081,-.0118), (-.0094,-.0235),
                (-.0453,-.04553), (-.0495,-.0450), (-.0527,-.0379), (-.0545,-.0185))

    def corners(outline, corner_fractions):
        points = []
        for i, corner in enumerate(outline):
            before, after = outline[i-1], outline[(i+1) % len(outline)]
            incoming, outgoing = (hypot(p[0]-corner[0], p[1]-corner[1]) for p in (before, after))
            trim = corner_fractions[i] * min(incoming, outgoing)
            for t in (0, .25, .5, .75, 1):
                a, b = trim/incoming*(1-t)**2, trim/outgoing*t*t
                points.append(tuple(c + a*(p-c) + b*(q-c) for p,c,q in zip(before,corner,after)))
        return points

    inner = corners(throat, (.40,)*8)
    outer = corners(shoulder, (.32, .29, .46, .46, .39, .43, .36, .31))
    # Tight throat turn, straight draft, compact shoulder roll. Cross the cheek off-ring.
    section = ((.007,0), (.00755,.015), (.00865,.085), (.0168,.81),
               (.0177,.89), (.01814,.95), (.01822,.97), (.01842,1), (.026,1))
    return loft('Drafted triangular web', [[(side*x, y+t*(oy-y), z+t*(oz-z))
        for (y,z),(oy,oz) in zip(inner, outer)]
        for side, steps in ((-1, reversed(section)), (1, section)) for x,t in steps], None)


def afg2():
    polymer = finish('Black molded polymer', .023, .59)
    grip = finish('Textured black polymer', .020, .73)
    steel = finish('Blackened hardware', .053, .39, .60)
    # The rising V has a round heel, a shorter front toe, and a web opening
    # offset toward the heel. The rail-facing skin is deliberately closed.
    outline = [(-.068,-.005), (.058,-.005), (.061,-.008), (.066,-.008),
        (.065,-.015), (.063,-.022), (.060,-.026), (.055,-.0265), (.052,-.024),
        (.050,-.020), (.049,-.0145), (.047,-.0137), (.024,-.0137), (.019,-.0143),
        (.009,-.0188), (.003,-.0232), (-.007,-.0293), (-.021,-.0376),
        (-.039,-.0487), (-.041,-.0512), (-.0415,-.057), (-.043,-.061),
        (-.047,-.063), (-.051,-.0618), (-.055,-.055), (-.058,-.046),
        (-.066,-.019), (-.069,-.015)]
    shell = profile('Open triangular AFG-2 shell', outline, .0183, polymer)
    # Keep the exterior's prior effective bevel independent of the aperture blend.
    round_edges(shell, .0010307768)
    for name,outline in (
        ('Shallow toe relief', [(.0535,-.030),(.0625,-.030),(.061,-.025),(.059,-.0239),(.055,-.0246)]),
        ('Shallow heel relief', [(-.052,-.066),(-.042,-.066),(-.044,-.0601),(-.048,-.0598),(-.051,-.061)]),
    ):
        recess(shell, round_edges(profile(name, outline, .012, None), .0013, segments=2))
    deck = [(-.068,-.006), (.060,-.006), (.059,.0008), (.056,.0015),
            (-.065,.0015), (-.068,.0005)]
    round_edges(loft('Shallow closed crown skin', [[(x, y, z-drop if i > 1 else z)
        for i,(y,z) in enumerate(deck)] for x,drop in (
            (-.0125,0),(-.0105,.0023),(.0105,.0023),(.0125,0))], grip), .0011)
    for side in (-1, 1):
        # The recessed lines are changes in exterior tone and height, not a rail interface.
        brow = round_edges(profile('Continuous molded brow', [(-.068,-.0098), (.064,-.0098),
            (.066,-.0077), (.060,-.0067), (-.067,-.0067)], .0024, polymer, side*.0164), .0011)
        for a,b in ((-.066,-.040), (-.031,.028), (.038,.058)):
            round_edges(profile('Crown edge highlight', [(a,-.0059), (b,-.0059),
                (b,-.0013), (b-.001,.0009), (a+.001,.0009), (a,-.0013)],
                .0019, polymer, side*.0135), .0009)
        for y,z,r in [(-.0585,-.0163,.0036), (-.0485,-.0495,.0034), (.0596,-.0163,.0031),
                      (.0006,-.0114,.0055)]:
            is_large = r > .004
            if is_large:
                # Roll the cosmetic cup into the cheek instead of leaving a hard lip beside the mark.
                sink = loft('Rolled center-mark cup', [[(side*x, y+radius*cos(i*tau/24),
                    z+radius*sin(i*tau/24)) for i in range(24)]
                    for x,radius in ((.0169,r), (.01766,r), (.01793,r+.00006),
                        (.01812,r+.00019), (.0183,r+.00040), (.0197,r+.00040))], None)
            else:
                sink = cylinder('Fastener cup', (side*.0183, y, z), r, .0028, None)
            recess(shell, sink)
            outer = .0189 if is_large else .0181
            if is_large:
                recess(brow, cylinder('Brow break', (side*.0192,y,z), r, .0032, None))
            if is_large and side < 0:
                round_edges(cylinder('Contrasting polygonal center mark',
                    (side*(outer-.00072),y,z), r*.72, .0015, steel, 6), .00019, segments=2)
                continue
            screw = cylinder('Slotted face' if is_large else 'Socket face',
                (side*(outer-.00072),y,z), r*.83, .0015, steel, 20)
            if is_large:
                slot = profile('Slot recess', [(y-.0044,z-.0019), (y+.0044,z+.0009),
                    (y+.0044,z+.0019), (y-.0044,z-.0009)], .0008, None, side*outer)
            else:
                slot = cylinder('Dark hex recess', (side*outer,y,z), r*.39, .0018, None, 6)
            recess(screw, slot)
            round_edges(screw, .00016, segments=2)
            if not is_large:
                matrix = screw.matrix_world
                local = matrix.inverted()
                for vert in screw.data.vertices:
                    world = matrix @ vert.co
                    world.x = afg_cheek(*world)
                    vert.co = local @ world
    round_afg_cheek(shell)
    shell.data.calc_loop_triangles()
    surface = BVHTree.FromPolygons([v.co for v in shell.data.vertices],
                                   [f.vertices[:] for f in shell.data.loop_triangles], all_triangles=True)
    seam = ((-.039,-.038), (-.033,-.0343), (-.027,-.0307), (-.022,-.0277))
    stations = [(y+(ny-y)*t, z+(nz-z)*t) for (y,z), (ny,nz) in zip(seam, seam[1:])
                for t in (0, .25, .5, .75)] + [seam[-1]]
    for side in (-1, 1):
        for i in range(3):
            dz = i*.00105
            x = side*.01824
            line = round_edges(loft('Diagonal molding line', [[(x,y,z+dz),
                (x,y,z+dz-.00043), (x+side*.00033,y,z+dz-.00022)]
                for y,z in stations], polymer), .00010, segments=1)
            # Seat the line on the drafted mesh while retaining its shallow relief.
            for vert in line.data.vertices:
                _, y, z = vert.co
                hit, *_ = surface.ray_cast((side*.04, y, z), (-side, 0, 0))
                vert.co.x += hit.x - side*.0183
    ribbed_pad('Ribbed angled surface', [(-.042,-.0488,.0114), (-.0395,-.0500,.0142),
        (-.036,-.0482,.0157), (-.018,-.0376,.0162), (-.012,-.0340,.0149),
        (-.0095,-.0319,.0129)], 14, grip)
    ribbed_pad('Ribbed front landing', [(.014,-.0165,.0134), (.016,-.0163,.0153),
        (.024,-.0147,.0169), (.044,-.0148,.0151), (.047,-.0144,.0139)], 13, grip)
    # The raised insert pulls away from the ramp into a rounded nub, not a flat tab.
    ribbed_pad('Rounded raised insert', [(-.0105,-.0329,.0088),(-.0084,-.0318,.0102),
        (-.0055,-.0310,.0108),(-.0027,-.0307,.0112),(-.0009,-.0308,.0113),
        (.0008,-.0316,.0113),(.0022,-.0326,.0112),(.0030,-.0330,.0110),
        (.0038,-.0328,.0108),(.0043,-.0318,.0107),(.0044,-.0289,.0108),
        (.0049,-.0265,.0109),(.0058,-.0244,.0110),(.0072,-.0224,.0111),
        (.0095,-.0205,.0112),(.012,-.0190,.0104),(.0133,-.0179,.0087)],
        4, grip, (.0079,.0124), back=lambda y: .60*y-.0238, crown=lambda y: .0033*ease((.010-y)/.004))


def ellipse(z, x, y, squareness, steps=64):
    ring = []
    for i in range(steps):
        angle = tau*i/steps
        c, s = cos(angle), sin(angle)
        ring.append((x*copysign(abs(c)**squareness,c), y*copysign(abs(s)**squareness,s), z))
    return ring


def smooth(obj):
    for face in obj.data.polygons:
        face.use_smooth = len(face.vertices) == 4
    return obj


def dd_vertical():
    polymer = finish('Black molded polymer', .021, .50)
    rubber = finish('Black rubber overmold', .014, .72)
    relief = finish('Black tread and emblem', .018, .64)
    handle = ((-.028, .0126, .01455, .70), (-.036, .0130, .01475, .70),
              (-.064, .0141, .01615, .72), (-.091, .0155, .01745, .77),
              (-.098, .0160, .01775, .81))
    # The maker's maximum width is across the broad shoulder in profile;
    # its thickness is across the narrower face, including the molded marks.
    shoulder = ((-.0015,.0149,.0242,.46), (-.003,.0170,.0254,.47),
        (-.007,.01745,.0254,.47), (-.010,.01715,.0251,.50), (-.013,.01725,.02515,.51),
        (-.0155,.01705,.02395,.54), (-.0185,.0160,.0203,.61), (-.021,.0147,.0175,.66),
        (-.024,.0132,.01545,.69), (-.0265,.0127,.0148,.70))
    smooth(loft('Sculpted shoulder and tapered handle', [ellipse(z,x,y,shape)
        for z,x,y,shape in (*shoulder, *handle, (-.101,.0162,.0178,.83))], polymer))
    # A closed, shallow crown with two molded edges. The top is only a visual cap.
    for side in (-1, 1):
        round_edges(profile('Rounded crown edge', [(-.024,-.007), (.024,-.007),
            (.025,-.004), (.0239,-.0015), (.0215,.0005), (.006,.001),
            (-.013,.001), (-.0215,.0005), (-.0239,-.0015)], .0030, polymer, side*.01335), .0015,
            segments=2)

    def handle_section(z):
        a, b = next((a,b) for a,b in zip(handle, handle[1:]) if b[0] <= z <= a[0])
        t = (z-a[0])/(b[0]-a[0])
        return tuple(v + (w-v)*t for v,w in zip(a[1:], b[1:]))

    for side in (-1, 1):
        # A low contrast, hand-built mark on the shoulder, without a raised badge plate.
        for text, y, z, size in (('D', -.0069, -.0084, .0059), ('ANIEL', -.0000, -.0072, .00275),
                                  ('EFENSE', .0006, -.0105, .00275)):
            data = bpy.data.curves.new(text, 'FONT')
            data.body, data.align_x, data.align_y = text, 'CENTER', 'CENTER'
            data.size, data.extrude, data.resolution_u = size, .000035, 3
            obj = bpy.data.objects.new(text, data)
            bpy.context.collection.objects.link(obj)
            obj.location = (side*.01749, y*side, z)
            obj.rotation_euler = (pi/2, 0, side*pi/2)
            data.materials.append(relief)
            activate(obj)
            bpy.ops.object.convert(target='MESH')

        def panel_surface(outline, depth):
            ring = []
            for u,z in outline:
                hx, hy, shape = handle_section(z)
                y = u*hy*.74
                x = hx*(1-(abs(y)/hy)**(2/shape))**(shape/2)
                ring.append((side*(x+depth), side*y, z))
            return ring

        # Cross sections keep the rubber field conformal and let its edges fade into the handle.
        field = []
        for z,w in ((-.0298,.73),(-.0306,.89),(-.032,.97),(-.034,1),(-.036,1),
                    (-.064,1),(-.089,1),(-.091,.97),(-.0925,.88),(-.0933,.73)):
            field.append(panel_surface([(w*u,z) for u in (-1,-.97,-.9,-.66,-.33,0,.33,.66,.9,.97,1)],
                                       .00044))
            for i in (0,10):
                x,y,h = field[-1][i]
                field[-1][i] = x-side*.00065,y,h
            field[-1].extend(panel_surface([(w,z),(-w,z)], -.0011))
        smooth(loft('Curved rubber overmold', field, rubber))

        def tread(name, outline, direction=1):
            outline = [(direction*u, z) for u,z in outline]
            round_edges(loft(name, [panel_surface(outline, depth) for depth in (.00014,.00102)],
                             relief), .00022, segments=1)

        # Each group has a long, nested arrow and a staggered surround, not rows of individual teeth.
        for group in range(4):
            z = -.0413-group*.01275
            direction = 1 if group % 2 == 0 else -1
            top, bottom = z+.0039, z-.0039
            for a,b,tip in ((-.91,-.79,.21),(-.73,-.65,.25),(-.592,-.514,.25),
                            (-.456,-.075,.25),(-.005,.48,.25),(.55,.91,.17)):
                tread('Nested arrow relief', [(a,top),(b,top),(min(b+tip,.91),z),
                    (b,bottom),(a,bottom),(a+tip,z)], direction)

            if group == 0:
                tread('Top panel shoulder block', [(-.81,-.0324),(-.42,-.0324),(-.20,-.0358),
                    (-.84,-.0368)])
                tread('Top panel center block', [(-.33,-.0317),(.22,-.0317),(.43,-.0354),
                    (-.11,-.0357)])
                tread('Top panel edge block', [(.31,-.0319),(.76,-.0324),(.88,-.0355),(.51,-.0352)])
            for j,(a,b) in enumerate(((-.91,-.35),(-.27,.27),(.35,.91))):
                slope = (-j+1)*.00064
                tread('Staggered chevron surround', [(a,bottom-.00058+slope),
                    (b-.12,bottom-.00058+slope-.00076),(b,bottom-.00435+slope-.00076),
                    (a+.14,bottom-.00435+slope)], direction)
            if group == 3:
                for a,b in ((-.84,-.39),(-.31,.27),(.35,.84)):
                    tread('Bottom panel blocks', [(a,-.0889),(b-.07,-.0889),
                        (b,-.0918),(a+.13,-.0918)], direction)

        # Separate straight bars frame the panel, with clean channels visible in oblique light.
        for i in range(-4,5):
            rings = []
            for z, height in ((-.0314,.00002),(-.0331,.00064),
                              (-.0906,.00066),(-.0920,.00002)):
                hx,hy,shape = handle_section(z)
                ring = []
                for u,depth in ((-.050,-.00032),(-.043,.00003),(-.021,height),
                                (.021,height),(.043,.00003),(.050,-.00032)):
                    x = hx*(i*.145+u)
                    y = hy*(1-(abs(x)/hx)**(2/shape))**(shape/2)
                    ring.append((x,side*(y+depth),z))
                rings.append(ring)
            smooth(loft('Separated longitudinal flute', rings, relief))

    smooth(loft('Rounded base collar', [ellipse(z,x,y,.83) for z,x,y in (
        (-.0964,.0160,.0177),(-.0977,.0167,.01835),(-.0989,.0171,.01865),
        (-.1011,.0170,.01865),(-.102,.0165,.0181)
    )], polymer))
    # Each skirt scallop has a round crown and straight sides below the separate collar.
    rings = []
    for z,x,y,depth,half,lip in ((-.1020,.0161,.0176,0,0,0), (-.1034,.0163,.0178,0,0,0),
        (-.1049,.0162,.0177,0,0,0), (-.1056,.0161,.0176,.055,1.6,0),
        (-.1065,.0160,.0175,.089,3.0,0), (-.1082,.0159,.0173,.100,4.3,0),
        (-.1121,.01555,.01695,.095,4.3,.66), (-.1133,.0153,.01665,.068,3.9,1),
        (-.1133,.0122,.0132,0,0,1), (-.1125,.0104,.0113,0,0,.48),
        (-.1116,.0097,.0107,0,0,0)):
        ring = []
        for i,(u,v,w) in enumerate(ellipse(z,x,y,.87,steps=128)):
            offset = abs((i+8)%16-8)
            scale = 1 - depth*ease((half-offset)/1.9)
            notch = ease((2.85-abs(i-112))/.95)
            ring.append((scale*u,scale*v,w+lip*.0032*notch))
        rings.append(ring)
    smooth(loft('Round-ended scallops and closed end dish', rings, polymer))


def export(asset, output):
    root = bpy.data.objects.new(f'ATTACHMENT_{asset}', None)
    bpy.context.collection.objects.link(root)
    for obj in tuple(bpy.context.scene.objects):
        if obj.type == 'MESH':
            obj.parent = root
    mount = bpy.data.objects.new('SOCKET_mount', None)
    bpy.context.collection.objects.link(mount)
    mount.parent = root
    # Join by finish to cap draw calls while preserving the modeled detail.
    materials = bpy.data.materials[:]
    for material in materials:
        batch = [obj for obj in root.children if obj.type == 'MESH' and obj.data.materials[0] == material]
        if not batch:
            continue
        activate(batch[0])
        for obj in batch:
            obj.select_set(True)
        if len(batch) > 1:
            bpy.ops.object.join()
        batch[0].name = material.name
    if asset == 'afg2':
        # Bake published length/width into the exterior; keep the side profile's
        # proportions rather than treating the maker's over-rail height as total height.
        length = .11938/.134752
        envelope = Matrix.Diagonal((.034798/.0407314, length, length, 1))
        for obj in root.children:
            if obj.type == 'MESH':
                frame = obj.matrix_world
                obj.data.transform(frame.inverted() @ envelope @ frame)
    output.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output/f'{asset}.blend'))
    bpy.ops.export_scene.gltf(filepath=str(output/f'{asset}.glb'), export_format='GLB',
                              export_animations=False, export_texcoords=False)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    recipes = {'afg2': afg2, 'dd_vertical': dd_vertical}
    parser.add_argument('asset', choices=recipes)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    recipes[args.asset]()
    output = args.output or ROOT/'.cache/blender/attachments'/args.asset
    export(args.asset, output.resolve())
