"""Editable exterior of the Streamlight TLR RM 1 Laser-G (HPL), for game art.

All authored dimensions below are in mm. Blender uses m, +Y forward and +Z up.
Photographs inform the exterior only; there are no internal working parts.
"""

import argparse
import math
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from studio import PLUG, setup, render

MM = .001
ENVELOPE = (30.0, 92.5, 38.1)  # X width, Y length, Z height
OUT = Path(__file__).resolve().parents[3] / '.cache/blender/attachments/tlr-rm1'


def scene_collection(name):
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    return collection


def finish(name, color, rough, metal=0, grain=0, transmission=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes.get('Principled BSDF')
    for key, value in [('Base Color', (*color, 1)), ('Roughness', rough), ('Metallic', metal),
                       ('Transmission Weight', transmission), ('IOR', 1.46)]:
        shader.inputs[key].default_value = value
    if grain:
        noise = nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 6800
        noise.inputs['Detail'].default_value = 2
        links.new(nodes.new('ShaderNodeTexCoord').outputs['Object'], noise.inputs['Vector'])
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = grain
        bump.inputs['Distance'].default_value = .000025
        links.new(noise.outputs['Fac'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], shader.inputs['Normal'])
        ramp = nodes.new('ShaderNodeMapRange')
        ramp.inputs['To Min'].default_value = rough - .105
        ramp.inputs['To Max'].default_value = rough + .105
        links.new(noise.outputs['Fac'], ramp.inputs['Value'])
        links.new(ramp.outputs[0], shader.inputs['Roughness'])
        tone = nodes.new('ShaderNodeValToRGB')
        tone.color_ramp.elements[0].color = (*(c * .63 for c in color),1)
        tone.color_ramp.elements[1].color = (*(c * 1.35 for c in color),1)
        links.new(noise.outputs['Fac'], tone.inputs['Fac'])
        links.new(tone.outputs[0], shader.inputs['Base Color'])
    return mat


def mesh(collection, name, points, faces, material, bevel=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata([tuple(c * MM for c in p) for p in points], [], faces)
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for edge in bm.edges:
        if edge.is_manifold and edge.calc_face_angle() > math.radians(48):
            edge.smooth = False
    for face in bm.faces:
        face.smooth = True
    bm.to_mesh(data)
    bm.free()
    data.update()
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    data.materials.append(material)
    if bevel:
        b = obj.modifiers.new('Edge radius', 'BEVEL')
        b.width, b.segments = bevel * MM, 3
        n = obj.modifiers.new('Face-weighted normals', 'WEIGHTED_NORMAL')
        n.keep_sharp = True
    return obj


def loft(collection, name, rings, material, bevel=0, closed=False):
    n, count = len(rings[0]), len(rings)
    faces = [] if closed else [tuple(reversed(range(n))), tuple(range((count-1)*n, count*n))]
    for k in range(count if closed else count - 1):
        for i in range(n):
            j, l = (i + 1) % n, (k + 1) % count
            faces.append((k*n+i, k*n+j, l*n+j, l*n+i))
    return mesh(collection, name, [p for ring in rings for p in ring], faces, material, bevel)


def round_corners(outline, portion=.24):
    points = [Vector(p) for p in outline]
    for i, corner in enumerate(points):
        a = corner.lerp(points[i-1], portion)
        b = corner.lerp(points[(i+1) % len(points)], portion)
        for t in (0,.333,.667,1):
            yield a.lerp(corner,t).lerp(corner.lerp(b,t),t)


def profile(collection, name, outline, a, b, material, bevel=.3, axis='X'):
    def section(t):
        return [(t, u, v) if axis == 'X' else (u, t, v) for u, v in outline]
    return loft(collection, name, [section(a), section(b)], material, bevel)


def box(collection, name, xyz, size, material, bevel=.25):
    x, y, z = xyz
    a, b, c = (n/2 for n in size)
    return profile(collection, name, [(y-b,z-c), (y+b,z-c), (y+b,z+c), (y-b,z+c)],
                   x-a, x+a, material, bevel)


def turn(collection, name, xyz, outline, material, *, axis='Y', sides=48, hollow=False,
         flutes=None):
    x, y, z = xyz
    place = {
        'Y': lambda a,b,t: (x+a,y+t,z+b),
        'X': lambda a,b,t: (x+t,y+a,z+b),
        'Z': lambda a,b,t: (x+a,y+b,z+t),
    }[axis]
    rings = []
    for t, r in outline:
        ring = []
        for i in range(sides):
            theta = math.tau * i / sides
            radius = r - (flutes(t, i) if flutes else 0)
            a, b = radius * math.cos(theta), radius * math.sin(theta)
            ring.append(place(a, b, t))
        rings.append(ring)
    return loft(collection, name, rings, material, closed=hollow)


def subtract(obj, cutter):
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new('Exterior recess', 'BOOLEAN')
    mod.object = cutter
    bpy.ops.object.modifier_move_to_index(modifier=mod.name, index=0)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def label(collection, receiver, name, words, side, x, y, z, height, width, material, weight=.035, shear=0):
    data = bpy.data.curves.new(name, 'FONT')
    data.body, data.align_x, data.align_y = words, 'CENTER', 'CENTER'
    data.resolution_u, data.size = 5, height * MM
    data.offset, data.shear = weight * MM, shear
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.rotation_euler = Matrix(((0,0,side), (side,0,0), (0,1,0))).to_euler()
    obj.location = (side*x*MM, y*MM, z*MM)
    bpy.context.view_layer.update()
    obj.scale.x = width * MM / obj.dimensions.x
    data.materials.append(material)
    obj['decal_on'] = receiver


def strokes(collection, receiver, name, paths, side, x, material, radius, *, conform=False):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions, data.bevel_depth, data.bevel_resolution = '3D', radius * MM, 1
    data.use_fill_caps = True
    for path in paths:
        spline = data.splines.new('POLY')
        spline.points.add(len(path) - 1)
        for point, (y,z) in zip(spline.points, path):
            at = (side*x*MM, y*MM, z*MM)
            if conform:
                hit, pos, _, _ = receiver.ray_cast(Vector((side*.018,at[1],at[2])), Vector((-side,0,0)))
                if hit:
                    at = (pos.x + side*.00002, at[1], at[2])
            point.co = (*at, 1)
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    data.materials.append(material)
    obj['decal_on'] = receiver


def streamlight_mark(collection, receiver, material):
    # Rounded monoline artwork, drawn as paths rather than a photo texture.
    letters = [
        (1, [[(1,1),(.23,1),(.045,.89),(0,.75),(.15,.54),(.77,.54),(.98,.41),(.98,.16),(.82,0),(0,0)]]),
        (1, [[(0,1),(1,1)],[(.55,1),(.55,0)]]),
        (1, [[(0,0),(0,1),(.82,1),(1,.85),(1,.68),(.82,.55),(.06,.55)],[(.68,.55),(.91,.39),(1,0)]]),
        (1, [[(1,1),(.23,1),(0,.82),(0,.20),(.21,0),(1,0)],[(0,.53),(.92,.53)]]),
        (1, [[(0,0),(0,.56),(.13,.78),(.50,1),(.88,.79),(1,.57),(1,0)],[(.47,.38),(.53,.38)]]),
        (1.27, [[(0,0),(0,.82),(.19,1),(.40,1),(.59,.83),(.59,.29),(.59,.81),(.77,1),(1.03,1),
                 (1.26,.81),(1.26,0)]]),
        (.81, [[(0,1),(0,.20),(.21,0),(.81,0)]]),
        (.18, [[(.10,1),(.10,0)]]),
        (1, [[(1,1),(.22,1),(0,.80),(0,.20),(.20,0),(.82,0),(1,.18),(1,.54),(.56,.54)]]),
        (1, [[(0,0),(0,1)],[(0,.52),(1,.52)],[(1,0),(1,1)]]),
        (1, [[(0,1),(1,1)],[(.49,1),(.49,0)]]),
    ]
    y = -8.05
    artwork = []
    for advance, paths in letters:
        artwork.extend([(y+u*1.82,-15.02+v*1.74) for u,v in path] for path in paths)
        y += advance*1.82 + .36
    strokes(collection, receiver, 'Rounded Streamlight pad print', artwork, 1, 12.50, material, .178)


def model():
    body = scene_collection('01  Anodized housing and clamp')
    light = scene_collection('02  HPL face cap and optics')
    tail = scene_collection('03  Molded switch housing')
    marks = scene_collection('04  Markings')
    cutters = scene_collection('Temporary machining tools')
    anod = finish('Bead-blasted black anodized aluminum', (.055,.052,.050), .405, .56, .51)
    pad_ink_bed = finish('Recessed bead-blasted pad-print surface', (.051,.048,.046), .43, .55, .51)
    clamp = finish('Satin black clamp', (.024,.023,.024), .35, .49, .18)
    cap = finish('Black satin head', (.035,.032,.033), .395, .52, .13)
    polymer = finish('Molded black engineering polymer', (.030,.029,.029), .48, .0, .53)
    rubber = finish('Textured switch elastomer', (.023,.023,.023), .56, .0, .53)
    dark = finish('Recesses and seals', (.008,.008,.009), .47)
    steel = finish('Dark brushed fastener steel', (.13,.126,.118), .38, .77, .10)
    silver = finish('Face-cap silver band', (.70,.70,.69), .22, .96)
    white = finish('Ivory pad print', (.71,.69,.64), .47)
    yellow = finish('Laser safety label, mustard yellow', (.79,.54,.075), .45)

    # The lower front lobe continues around the small offset aperture, beneath the lamp.
    housing = [(-15.6,-31.65),(-15.6,-23.0),(-15.6,-12.0),(-15.6,-3.05),(-13.8,-.35),(-8.2,2.05),
               (10.45,2.05),(14.0,.55),(17.15,-4),(17.15,-12),(17.15,-22),(17.15,-29.75),
               (16.1,-32.6),(14.2,-34.1),(-1.8,-34.1),(-8.5,-33.8)]
    right_pocket = [(-5.8,-26.35),(-9.8,-21.1),(-10.05,-13.22),(-9.55,-10.22),(-8.4,-9.5),(-7.0,-9.32),
                    (9.6,-9.32),(12.3,-9.32),(14.4,-9.4),(16.92,-12),(16.91,-20.8),(16.7,-25.2),
                    (15.25,-26.0),(12.1,-26.16),(-1.4,-26.47),(-4.16,-26.10)]
    left_pocket = [(-8.5,-25.45),(-9.85,-22.85),(-9.85,-13.17),(-9.48,-10.33),(-8.4,-9.48),(-7.0,-9.3),
                   (9.2,-9.3),(11.2,-9.4),(13.5,-9.63),(14.25,-12.4),(14.38,-22.3),(13.9,-25.15),
                   (12.8,-26.63),(10.4,-26.90),(-3.4,-27.13),(-6.15,-26.78)]
    # Roll over the outer shoulder, down the curved pocket wall and back onto
    # the recessed pad-print plane. On the right the remaining lower lip is wider.
    section_profile = [(0,10.8),(.06,12.15),(.18,13.26),(.34,13.48),(.61,13.49),
                       (.76,13.37),(.88,13.09),(.97,12.67),(1,12.60)]

    def section(t, x, pocket):
        outline = [(a*(1-t)+c*t, b*(1-t)+d*t) for (a,b),(c,d) in zip(housing,pocket)]
        return [(x,y,z) for y,z in round_corners(outline)]

    sections = [section(t,-x,left_pocket) for t,x in reversed(section_profile)]
    sections += [section(t,x,right_pocket) for t,x in section_profile]
    carrier = loft(body, 'Machined receiver — continuous radiused pocket and lower lip', sections, anod)
    carrier['bake_ratio'], carrier['uv_weight'] = .35, 1.7
    saddle = box(cutters, 'Saddle clearance over receiver', (0,1.0,1.65), (19.55,23.9,4.55), dark, 0)
    subtract(carrier,saddle)
    aperture = (-5.0, 17.45, -29.6)
    subtract(carrier, turn(cutters, 'Laser aperture recess', aperture, [(-3.3,2.97),(1,2.97)], dark))
    turn(body, 'Rounded forward cheek surrounding the laser opening', aperture,
         [(-2.10,4.20),(-.63,4.20),(-.17,4.03),(.09,3.62),(.12,2.88),(-2.05,2.89)],
         anod, sides=48, hollow=True)['bake_ratio'] = .39
    p = (-12.6,-.2,-22.9)
    subtract(carrier, turn(cutters, 'Deep black side port', p, [(-1,1.44),(.88,1.44)], dark, axis='X', sides=32))
    turn(body, 'Black bed of adjustment port', p, [(.73,1.42),(.91,1.42)], dark, axis='X', sides=32)
    p = (-13.25,-1,-29.65)
    subtract(carrier, turn(cutters, 'Recess beneath lower socket', p, [(-.75,1.13),(.45,1.13)], dark, axis='X', sides=24))
    turn(body, 'Lower socket rim', p, [(-.21,1.05),(-.12,1.16),(.11,1.23),(.11,.77),(-.21,.69)], steel,
         axis='X', sides=24, hollow=True)
    turn(body, 'Lower socket dark seat', p, [(.12,.77),(.47,1.11)], dark, axis='X', sides=24)
    carrier.data.materials.append(pad_ink_bed)
    pad_x = section_profile[-1][1] * MM
    for face in carrier.data.polygons:
        # The machined pad-print face is flat. Do not smooth it into the
        # perimeter or Boolean holes: that would create long diagonal glints.
        if abs(face.normal.x) > .999 and abs(abs(face.center.x)-pad_x) < 1e-6:
            face.use_smooth = False
            face.material_index = 1

    # External rail saddle only. The open channel and lug are visual approximations.
    jaw = [(-8.6,3.76),(10.45,3.76),(11.5,3.50),(12.05,2.5),(12.05,-5.15),(11.65,-6.40),(10.6,-7.27),
           (9.65,-7.65),(-6.35,-7.65),(-7.9,-7.25),(-8.75,-6.60),(-9.15,-5.44),(-9.15,2.95)]
    fixed_jaw = profile(body, 'Fixed jaw — raised saddle and U-shaped side plate', jaw, 9.0, 14.25, clamp, .68)
    moving = [(-9.6,3.4),(-7.4,3.76),(8.0,3.76),(10.8,3.35),(12.6,1.5),(13.3,-4.4),(12.5,-5.9),
              (11.0,-6.6),(7.9,-7.2),(-7.1,-7.2),(-9.41,-6.7),(-10.1,-5.52),(-10.1,1.5)]
    moving_jaw = profile(body, 'Moving jaw — captive raised side plate', moving, -14.16, -8.9, anod, .86)
    moving_jaw['uv_weight'] = 1.7
    for obj, side in [(fixed_jaw,1),(moving_jaw,-1)]:
        flank = [(8.4,-.09),(10.57,1.06),(9.92,2.17),(8.32,4.68),(5,4.68),(5,-.09)]
        cutter = profile(cutters, 'Open saddle relief', [(side*x,z) for x,z in flank], -13, 14, dark, 0, axis='Y')
        subtract(obj,cutter)
    bed = box(body, 'Dark saddle bed', (0,1.6,-.15), (18.1,23.6,1.1), clamp, .31)
    bed['bake_ratio'] = .32
    for y in (-4.5,3.4,9.1):
        subtract(bed, turn(cutters, 'Shallow saddle counterbore', (0,y,0), [(-.11,1.83),(.91,1.83)], dark,
                           axis='Z', sides=30))
    box(body, 'Transverse locating rib, exterior', (0,-8.58,.54), (18.5,2.3,1.43), clamp, .33)
    lip = [(9.2,2.48),(9.85,3.36),(10.25,3.77),(10.96,4.0),(12.10,4),(12.6,3.57),(12.4,2.75)]
    for side in (1,-1):
        profile(body, 'Rounded upper saddle lip', [(side*x,z) for x,z in lip], -7.6, 9.95,
                clamp, .20, 'Y')['bake_ratio'] = 1.0  # Preserve the authored rail height.
    pin = (14.22,.65,-2.95)
    turn(body, 'Right counterbore shadow', pin, [(-.24,2.96),(.10,2.94)], dark, axis='X')
    turn(body, 'Fine rim of right counterbore', pin, [(.10,2.94),(.16,2.91),(.16,2.77),(.095,2.76)],
         clamp, axis='X', hollow=True)
    turn(body, 'Exposed right clamp pin', (14.40,.65,-2.95), [(-.10,1.45),(.30,1.45),(.60,1.13)], steel, axis='X')
    screw = (-14.40,1.0,-1.78)
    turn(body, 'Captive screw black seat', screw,
         [(-.035,4.46),(.19,4.68),(.28,4.55),(.26,3.95),(-.06,3.97)], dark, axis='X', hollow=True)
    turn(body, 'Captive screw fluted shoulder', screw, [(-.46,4.15),(-.36,4.37),(.17,4.37),(.27,4.20)],
         clamp, axis='X', sides=64, flutes=lambda t,i: .17 if i%2 else 0)
    head = turn(body, 'Left captive screw, broad slotted head', screw,
                [(-.60,4.06),(-.54,4.24),(-.38,4.33),(-.28,4.23)], steel, axis='X', sides=64)
    slot = box(cutters, 'Straight screwdriver slot', (-15.03,1.0,-1.78), (.46,9.0,1.05), dark, 0)
    subtract(head, slot)
    turn(body, 'Laser retaining collar', aperture,
         [(-1.95,2.91),(-.38,2.91),(.02,2.49),(.02,1.74),(-1.80,1.74)],
         clamp, hollow=True)['bake_ratio'] = .39
    turn(body, 'Laser optic, recessed and unlit', aperture, [(-1.28,1.50),(-1.15,1.51),(-1.05,1.22)],
         finish('Laser window, dark violet AR coat', (.017,.010,.025), .12, .30, transmission=.15), sides=32)

    lamp = (0, 0, -15.6)
    throat = turn(light, 'Fixed throat', lamp, [(14.8,12.65),(16.30,13.30),(19.43,13.70)], anod, sides=80)
    turn(light, 'Thin exposed silver separator band', lamp,
         [(18.95,13.56),(19.05,13.72),(19.54,13.74),(19.66,13.62)], silver, sides=80)['bake_ratio'] = .35

    def head_flutes(t, i):
        # Four interrupted reliefs, two visible in each side profile.
        return .37 if 22.04 <= t <= 33.8 and i in (6,30,42,66) else 0

    turn(light, 'HPL bezel with shallow longitudinal relief', lamp,
         [(19.61,13.64),(19.89,13.70),(21.9,13.70),(22.0,13.70),(22.04,13.70),(22.19,13.70),
          (28.5,13.70),(33.62,13.70),(33.8,13.70),(33.84,13.70),(34.24,13.66),(35.0,13.15),
          (35.0,11.04),(34.85,10.91),(34.6,10.65),(33.0,10.67),(30.55,10.59),(19.61,11.47)],
         cap, sides=72, hollow=True, flutes=head_flutes)['bake_ratio'] = .35
    seal = finish('Dark optical gasket', (.009,.012,.014), .26, .06)
    turn(light, 'Optical gasket', lamp,
         [(34.43,11.20),(34.48,11.19),(34.52,10.54),(34.40,10.45),(34.10,10.63),(34.10,11.22)],
         seal, sides=72, hollow=True)['bake_ratio'] = .32
    reflector = finish('Mirror-silver optic bowl', (.884,.897,.91), .122, .91)
    turn(light, 'Visible shaped reflector bowl', lamp,
         [(34.37,10.51),(33.74,10.35),(32.6,10.00),(31.50,9.51),(30.40,8.80),
          (29.0,7.68),(27.88,6.48),(26.56,4.71),(25.71,3.13),(25.47,2.23),
          (25.40,1.62),(25.06,1.65),(25.33,3.20),(27.30,6.2),(31.38,9.93),(34.37,10.57)],
         reflector, sides=72, hollow=True)['bake_ratio'] = .35
    turn(light, 'Silver optical shoulder just inside the front seal', lamp,
         [(33.48,10.29),(34.1,10.54),(34.35,10.51),(34.08,10.15),(33.48,10.23)],
         finish('Optical shoulder', (.77,.81,.83), .116, .85), sides=72, hollow=True)['bake_ratio'] = .32
    turn(light, 'Frosted central optic', lamp, [(25.0,2.36),(28.2,2.36),(28.8,2.21),(29.13,1.73),(29.23,1.3)],
         finish('Diffuse milky optic centre', (.75,.75,.72), .39), sides=36)
    facet_metal = finish('Optic facet flashes', (.76,.82,.86), .17, .80)
    for k, a in enumerate((.23,2.24,4.35)):
        bands = []
        for y, r, w in ((29.0,7.61,.09),(30.40,8.72,.14),(32.6,9.90,.10),(34.1,10.39,.045)):
            bands.extend((r*math.cos(a+u*w),y,lamp[2]+r*math.sin(a+u*w)) for u in (-1,1))
        mesh(light, f'Cosmetic reflector facet {k+1}', bands, [(i,i+1,i+3,i+2) for i in (0,2,4)], facet_metal)
    # Coated cosmetic window: retain a slight grazing reflection but leave the
    # bowl and its central surface visible instead of masking them with glare.
    glass = finish('Clear front optic with thin antireflective coating', (.94,.98,1.0), .026)
    nodes, links = glass.node_tree.nodes, glass.node_tree.links
    mix = nodes.new('ShaderNodeMixShader')
    clear = nodes.new('ShaderNodeBsdfTransparent')
    clear.inputs[0].default_value = (.985,.992,1,1)
    mix.inputs[0].default_value = .019
    links.new(clear.outputs[0], mix.inputs[1])
    links.new(nodes.get('Principled BSDF').outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], nodes.get('Material Output').inputs['Surface'])
    window = turn(light, 'Clear protective front window', lamp, [(34.20,10.51),(34.36,10.51),(34.44,10.42)],
                  glass, sides=72)
    window['source_only'] = True  # Keep the optimized atlas opaque.
    # The orthographic side photo sets the bezel diameter at about 23.6 mm.
    for obj in light.objects:
        for v in obj.data.vertices:
            v.co.x *= .864
            v.co.z = (v.co.z-lamp[2]*MM)*.864 - 13.44*MM

    # Eight across/up vertices: the rear body has a long underside bevel that grows toward the palm pad.
    def tail_section(y, w, bottom, top, chamfer):
        section = [(-w+2.0,top),(w-2.0,top),(w,top-2.1),(w,bottom+chamfer),
                   (w-2.1,bottom),(-w+2.1,bottom),(-w,bottom+chamfer),(-w,top-2.1)]
        return [(x,y,z) for x,z in round_corners(section,.16)]
    tail_shell = loft(tail, 'Inverted wedge, index flats and faceted switch housing', [tail_section(*p) for p in [
        (-56.6,10.8,-15.65,-.1,3.2),(-54.7,11.45,-16.0,-.65,3.25),
        (-48.5,11.6,-17.2,-.65,3.25),(-42.8,12.3,-19.05,-1.45,3.4),
        (-36.2,12.65,-22.15,-1.1,3.15),(-29.2,12.7,-26.45,-1.65,3.2),
        (-22.6,12.7,-27.8,-1.73,2.5),(-15.65,12.62,-32.55,-2.05,2.1)
    ]], polymer)
    rail_extension = [(-56.8,-.2),(-53.1,.58),(-51.2,-.65),(-41.35,-.67),(-40.58,-1.60),
                      (-22.8,-1.65),(-22.7,-5.90),(-40.58,-6.0),(-41.5,-7.7),(-56.8,-10.0)]
    shoulder = profile(tail, 'Molded shoulder with rear raised lip', rail_extension, -12.50, 12.50, polymer, .62)
    for obj in (tail_shell, shoulder):
        subtract(obj, box(cutters, 'Shallow top notch in rear collar', (0,-50.65,-1.08), (10.18,5.15,4.0), dark,.80))
    box(tail, 'Satin bottom of rear collar notch', (0,-50.65,-3.15), (9.83,4.88,.3), dark,.10)
    box(tail, 'Rear endcap split line', (0,-48.4,-4.18), (25.08,.31,6.8), dark, .11)
    rear_end = [(-8.4,.05),(8.4,.05),(10.93,-1.8),(10.93,-12.28),
                (8.65,-15.6),(-8.65,-15.6),(-10.93,-12.28),(-10.93,-1.8)]
    surround = profile(tail, 'Rounded rear endcap and port surround', rear_end,
                       -57.5,-55.06,polymer,.78,'Y')
    box(tail, 'Dark receiver seam backing', (0,-15.61,-17.2), (24.1,1.3,30.0), dark, .32)
    port = (0,-57.5,-6.05)
    for obj in (tail_shell, surround):
        subtract(obj, turn(cutters, 'Rear external port recess', port, [(-.65,3.66),(1.6,3.66)], dark, sides=40))
    turn(tail, 'Rounded exterior shoulder around the rear port', port,
         [(0,4.40),(.16,4.92),(.64,5.12),(1.37,5.16),(2.42,5.42),(2.42,3.46),
          (.40,3.39),(0,3.46)], polymer, hollow=True, sides=48)
    turn(tail, 'Recessed connector trim (exterior)', port,
         [(.02,3.60),(.36,3.65),(.7,3.43),(.7,2.62),(.44,2.60),(.02,2.88)], clamp, hollow=True, sides=40)
    turn(tail, 'Connector shadow', port, [(.75,2.66),(1.18,2.67)], dark, sides=32)

    # Only visible in the matched rear reference render; not part of the module envelope.
    plug = scene_collection(PLUG)
    turn(plug, 'Plug socket sleeve', port, [(-2.62,3.40),(-2.4,3.73),(-.15,3.75),(.1,3.49)], clamp, sides=40)
    plug_outline = [(-3.5,-1.90),(3.5,-1.90),(4.72,-3.19),(4.72,-8.95),
                    (3.58,-10.18),(-3.58,-10.18),(-4.72,-8.95),(-4.72,-3.19)]
    loft(plug, 'Overmolded cable grip', [[(x*w,y,z-.27*(y+64.35)) for x,z in plug_outline]
         for y,w in [(-70.2,.94),(-69.15,1.08),(-66.6,1.04),(-64.35,.78)]], polymer,.68)
    turn(plug, 'Continuous neck under strain relief', port,
         [(-6.97,4.19),(-5.59,3.84),(-3.42,3.32),(-2.47,3.37)], rubber, sides=40)
    rib_finish = finish('Satin molded grip relief', (.031,.030,.030), .37, grain=.22)
    for i in range(5):
        y = -2.77 - i*.92
        r = 3.32 + i*.215
        turn(plug, f'Plug strain-relief rib {i+1}', port, [(y,r),(y-.11,r+.40),(y-.44,r+.38),(y-.57,r)],
             rib_finish, sides=32)
    turn(plug, 'Short cable length in reference framing', (0,-70.02,-4.55),
         [(-13.1,1.44),(-3.20,1.50),(-.5,1.62),(.01,1.65)], rubber, sides=24)
    plug.hide_viewport = plug.hide_render = True
    pad = [(-43.1,-19.0),(-40.7,-19.6),(-34.95,-21.95),(-27.2,-26.2),(-26.85,-28.4),
           (-28.55,-29.1),(-42.25,-22.32)]
    profile(tail, 'Recessed large pressure pad', pad, -10.45, 10.45, rubber, .76)
    # The grip strokes keep the same pitch across the underside slope.
    rotation = Matrix.Rotation(math.radians(-25), 3, 'X')
    for i in range(9):
        t = i / 8
        y = -41.34+12.55*t
        z = -22.32 - (y+42.25)*.495 - .07
        bar = box(tail, f'Pressure pad grip rib {i+1}', (0,y,z),
                  (15.4+3.55*math.sin(t*math.pi/1.5), .73, .70), rubber, .20)
        pivot = Vector((0,y*MM,z*MM))
        for v in bar.data.vertices:
            v.co = pivot + rotation @ (v.co - pivot)
    profile(tail, 'Forward underside switch guard', [(-28.5,-27.1),(-15.6,-26.2),(-15.6,-33.85),
            (-21.0,-34.1),(-24.1,-33.1),(-27.1,-31.2)], -10.9, 10.9, polymer, 1.12)
    lever = [(-34.35,-12.18),(-34.43,-9.75),(-33.48,-8.32),(-31.5,-7.76),
             (-29.2,-8.08),(-20.46,-11.24),(-18.25,-12.7),(-17.97,-15.18),
             (-18.67,-17.32),(-20.35,-17.50),(-31.52,-14.59)]
    profile(tail, 'Right three-mode selector paddle', lever, 12.45, 14.19, polymer, .67)
    profile(tail, 'Dished selector thumb ledge', [(-33.47,-9.2),(-32.27,-8.52),(-30.5,-8.48),
              (-19.38,-13.39),(-18.82,-14.49),(-21.13,-13.9),(-31.32,-11.48)],
            14.01, 14.68, anod, .37)
    # Raised index stops on an exposed arc behind the nose of the paddle.
    angles = [math.radians(-64 + i*12.8) for i in range(11)]
    arc = [(-27.0+r*math.cos(a),-14.9+r*math.sin(a))
           for r,sweep in ((10.30,angles),(8.95,reversed(angles))) for a in sweep]
    profile(tail, 'Three-mode index arc', arc, 12.41, 13.24, clamp, .21)
    for i, angle in enumerate((-53, 0, 53)):
        a = math.radians(angle)
        y, z = -27+9.7*math.cos(a), -14.9+9.7*math.sin(a)
        box(tail, f'Selector detent relief {i+1}', (13.35,y,z), (.56,1.06,.48), polymer, .17)
    for s in (1,-1):
        turn(tail, 'Rear housing hinge pin', (s*12.26,-23.7,-3.12),
             [(-.37,1.22),(.37,1.22)], steel, axis='X', sides=24)
        turn(tail, 'Lower housing attachment pin', (s*10.97,-23.5,-30.18),
             [(-.3,1.01),(.3,1.01)], clamp, axis='X', sides=24)

    plate = box(tail, 'Underbody yellow warning plate', (1.25,-14.15,-33.84), (11.9,8.0,.30), yellow, .11)
    plate['uv_weight'] = 1.25
    streamlight_mark(marks, carrier, white)
    label(marks, carrier, 'Wordmark registration', '®', 1, 12.65, 14.47,-15.05,.92,.88,white)
    label(marks, carrier, 'Patent marking', 'Patented', 1, 12.62, 3.5,-16.42,1.60,6.0,white,.042)
    label(marks, carrier, 'CE mark', 'CE', 1, 13.47, -12.40,-2.29,2.42,2.65,white,.07)
    glyphs = [
        [(0,0),(0,.74),(-.34,.74),(-.34,1),(.61,1),(.61,.74),(.28,.74),(.28,0),(0,0)],
        [(0,0),(0,1),(.27,1),(.27,.24),(.81,.24),(.81,0),(0,0)],
        [(0,0),(0,1),(.72,1),(.90,.81),(.90,.56),(.72,.43),(.96,0),(.63,0),(.38,.39),(.28,.39),(.28,0),(0,0)],
        [(.28,.63),(.58,.63),(.65,.72),(.57,.80),(.28,.80),(.28,.63)],
    ]
    outline = [[(origin-u*2.7,-15.7+v*2.86) for u,v in path]
               for origin,path in zip((12.6,9.25,6.15,6.15),glyphs)]
    strokes(marks, carrier, 'Outlined TLR lettering', outline, -1,12.62,white,.089)
    label(marks, carrier, 'TLR registration', '®', -1, 12.62, 2.75,-12.87,1.08,1.02,white,.04)
    label(marks, carrier, 'Model wordmark', 'RM', -1, 12.62, -1.18,-14.2,4.19,6.15,white,.136)
    strokes(marks, carrier, 'The stepped numeral one', [[(-6.05,-13.38),(-7.10,-12.96),(-7.10,-15.69)]],
            -1,12.62,white,.24)
    label(marks, carrier, 'Series marking', 'LASER-G', -1, 12.62, -2.94,-17.52,2.83,10.0,white,.067,.16)
    label(marks, moving_jaw, 'Sample serial marking', 'S/N 017040A', -1, 14.18, -7.0,-1.45,1.43,5.9,white)
    label(marks, moving_jaw, 'Date marking', '1023', -1, 14.18, -7.2,-3.05,1.42,2.75,white)
    strokes(marks, moving_jaw, 'Battery outline', [[(9.0,-1.5),(5.8,-1.5),(5.8,-4.22),(9,-4.22),
            (9,-3.5),(9.53,-3.5),(9.53,-2.25),(9,-2.25),(9,-1.5)]],-1,14.18,white,.095)
    star = []
    for j in range(6):
        a = math.tau*j/12
        dy,dz = 1.07*math.cos(a),1.07*math.sin(a)
        star.append([(-13.21-dy,-18.0-dz),(-13.21+dy,-18.0+dz)])
    strokes(marks, carrier, 'Laser star icon', star, 1,13.37,white,.078,conform=True)
    for y,z,r,x,name in [(-.2,-20.48,1.56,12.62,'Upper adjustment arc'),
                         (-1,-27.94,.89,12.96,'Lower adjustment arc')]:
        arc = [(y+r*math.cos(math.pi*j/10), z+r*math.sin(math.pi*j/10)*.48) for j in range(11)]
        strokes(marks, carrier, name, [arc], -1,x,white,.09,conform=True)
    icons = [[(-14.19,z-.37),(-13.64,z-.37),(-12.91,z-.98),(-12.91,z+.98),
              (-13.60,z+.40),(-14.19,z+.40),(-14.19,z-.37)] for z in (-6.78,-12.5)]
    strokes(marks, carrier, 'White-light selector icons', icons, 1,13.32,white,.087,conform=True)
    box(marks, 'Underbody warning print field', (1.25,-14.08,-34.01),
        (10.16,4.5,.12), dark, .06)['decal_on'] = plate
    for i, width in enumerate((7.8,6.3,8.5,5.6)):
        box(marks, 'Warning plate microprint line', (1.25,-15.65+i*1.02,-34.074),
            (width,.28,.018), yellow,.008)['decal_on'] = plate
    strokes(marks, throat, 'Face cap rotation cue', [[(18.90,-8.88),(18.53,-10.60),(18.52,-12.9),
            (18.84,-15.03),(19.18,-16.58)]], -1,11.30,white,.105)
    arrows = [[(18.40,z+s*.7),(18.98,z),(19.38,z+s*.82)] for z,s in [(-8.88,-1),(-16.58,1)]]
    strokes(marks, throat, 'Face cap cue arrowheads', arrows, -1,11.30,white,.092)
    bpy.data.collections.remove(cutters)
    return (body, light, tail, marks)


def validate(collections):
    graph = bpy.context.evaluated_depsgraph_get()
    lo, hi = [math.inf]*3, [-math.inf]*3
    for collection in collections:
        for source in collection.objects:
            obj = source.evaluated_get(graph)
            matrix = obj.matrix_world
            data = obj.to_mesh()
            for vertex in data.vertices:
                for axis, value in enumerate(matrix @ vertex.co):
                    lo[axis] = min(lo[axis], value)
                    hi[axis] = max(hi[axis], value)
            obj.to_mesh_clear()
    measured = tuple((b-a)/MM for a,b in zip(lo,hi))
    if any(abs(a-b) > .02 for a,b in zip(measured, ENVELOPE)):
        raise ValueError(f'Envelope X/Y/Z {measured!r} mm differs from {ENVELOPE!r}')
    print('Envelope X/Y/Z (mm):', *(round(x,3) for x in measured), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=OUT)
    parser.add_argument('--render', action='store_true')
    parser.add_argument('--quick', action='store_true')
    parser.add_argument('--optimize', action='store_true', help='Bake and export the separate optimized exterior')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    model_collections = model()
    validate(model_collections)
    setup(args.quick)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output / 'tlr-rm1.blend'))
    if args.render:
        render(args.output / 'renders')
    if args.optimize:
        from optimize import optimize

        target = optimize(model_collections, args.output)
        validate((target,))
        bpy.context.scene.camera = bpy.data.objects['front-quarter']
        bpy.ops.wm.save_as_mainfile(filepath=str(args.output / 'tlr-rm1-optimized.blend'))
        bpy.ops.export_scene.gltf(filepath=str(args.output / 'tlr-rm1-optimized.glb'),
                                  export_format='GLB', use_selection=True, export_tangents=True)
        if args.render:
            render(args.output / 'renders-optimized')


if __name__ == '__main__':
    main()
