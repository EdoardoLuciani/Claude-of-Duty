"""Bounded vanguard pilot. Native editable components -> actor-space mesh payload.

Blender owns geometry; reference.mjs owns rig/registry/material tile calibration.
The JSON is temporary Node GLTFExporter input, NOT a Blender glTF export.
"""
import argparse
import json
import math
from pathlib import Path
import random
import struct
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

# Actor Y-up -> Blender Z-up. Bone local axes are NOT basis-conjugated.
C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))


def f32(value):
    return struct.unpack('<f', struct.pack('<f', value))[0]


def source_matrix(values):
    return Matrix([values[i::4] for i in range(4)])


def armature(reference):
    data = bpy.data.armatures.new('Runtime bind rig')
    obj = bpy.data.objects.new('Soldier', data)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    rig = reference['rig']
    for i, name in enumerate(rig['names']):
        bone = data.edit_bones.new(name)
        bone.length = rig['length'][i]
        bone.matrix = C.to_4x4() @ source_matrix(rig['worldMatrices'][i])
        if rig['parent'][i] >= 0:
            bone.parent = data.edit_bones[rig['names'][rig['parent'][i]]]
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.show_in_front = True
    data.display_type = 'STICK'
    for i, name in enumerate(rig['names']):
        expected = C.to_4x4() @ source_matrix(rig['worldMatrices'][i])
        actual = data.bones[name].matrix_local
        assert max(abs(actual[r][c] - expected[r][c]) for r in range(4) for c in range(4)) < 2e-6
        assert (data.bones[name].tail_local - C @ Vector(rig['tail'][i])).length < 2e-6
    return obj


class Recipe:
    def __init__(self, reference, seed, rig):
        self.ref = reference
        self.rng = random.Random(seed)
        self.rig = rig
        self.parts = []
        self.bp = dict(zip(reference['rig']['names'], map(Vector, reference['rig']['bindPos'])))
        # Preview only. Runtime material maps/variant shader remain authoritative.
        preview = {'cloth': (.13, .11, .075), 'gear': (.10, .075, .043),
                   'plate': (.073, .059, .038), 'boot': (.034, .028, .021),
                   'rubber': (.016, .018, .019), 'polymer': (.025, .03, .032),
                   'steel': (.055, .061, .067), 'skin': (.48, .28, .18),
                   'glass': (.027, .07, .078)}
        self.materials = {}
        for slot in reference['slots']:
            material = bpy.data.materials.new(slot)
            material.diffuse_color = (*preview[slot], 1)
            material.use_nodes = True
            shader = material.node_tree.nodes.get('Principled BSDF')
            shader.inputs['Base Color'].default_value = material.diffuse_color
            shader.inputs['Roughness'].default_value = .22 if slot == 'glass' else .72
            shader.inputs['Metallic'].default_value = 1 if slot == 'steel' else 0
            self.materials[slot] = material

    def finish(self, obj, name, slot, bones, tint=1, bevel=0, smooth=False):
        obj.name = name
        # BMesh-backed primitive operators can enumerate faces in pointer order.
        # Rebuild the same native topology in coordinate order before shading.
        original = obj.data
        order = sorted(range(len(original.vertices)), key=lambda i: tuple(original.vertices[i].co))
        remap = {old: new for new, old in enumerate(order)}
        faces = []
        for polygon in original.polygons:
            face = [remap[i] for i in polygon.vertices]
            faces.append(min(tuple(face[j:]+face[:j]) for j in range(len(face))))
        data = bpy.data.meshes.new(name)
        data.from_pydata([original.vertices[i].co.copy() for i in order], [], sorted(faces))
        data.update()
        obj.data = data
        bpy.data.meshes.remove(original)
        obj.data.materials.append(self.materials[slot])
        obj['surface'] = slot
        # Tints are neutral value calibration, not VARIANTS hue multipliers.
        tint = (tint,) * 3 if isinstance(tint, (float, int)) else tint
        variation = self.rng.uniform(.96, 1.0)
        obj['linear_tint'] = [v * variation for v in tint]
        for face in obj.data.polygons:
            face.use_smooth = smooth
        bpy.context.view_layer.update()
        if isinstance(bones, str):
            bones = [bones]
        groups = [obj.vertex_groups.new(name=b) for b in bones]
        for vertex in obj.data.vertices:
            point = C.transposed() @ (obj.matrix_world @ vertex.co)
            if len(bones) == 1:
                weights = [1.0]
            else:
                # Local candidate chains only: never heat-weight close hands/torso.
                distances = []
                for b in bones:
                    i = self.ref['rig']['names'].index(b)
                    a = self.bp[b]
                    d = Vector(self.ref['rig']['tail'][i]) - a
                    t = max(0, min(1, (point - a).dot(d) / d.length_squared))
                    distances.append((point - a - d * t).length)
                weights = [1 / (.025 + d) ** 4 for d in distances]
                total = sum(weights)
                weights = [w / total for w in weights]
            for group, weight in zip(groups, weights):
                group.add([vertex.index], weight, 'REPLACE')
        # Metres/tile, without multiplying variant colour or UV scales again.
        uv = obj.data.uv_layers.active or obj.data.uv_layers.new(name='PhysicalUV')
        tile = self.ref['materials'][slot]['tile']
        for face in obj.data.polygons:
            n = obj.matrix_world.to_3x3().inverted().transposed() @ face.normal
            axis = max(range(3), key=lambda i: abs(n[i]))
            axes = ((1, 2), (0, 2), (0, 1))[axis]
            for loop in face.loop_indices:
                p = obj.matrix_world @ obj.data.vertices[obj.data.loops[loop].vertex_index].co
                uv.data[loop].uv = (p[axes[0]] / tile, p[axes[1]] / tile)
        if bevel:
            mod = obj.modifiers.new('Sewn / machined edge radius', 'BEVEL')
            mod.width = bevel
            mod.segments = 2 if bevel >= .009 else 1
            mod.harden_normals = True
            mod = obj.modifiers.new('Corner normals', 'WEIGHTED_NORMAL')
            mod.keep_sharp = True
        mod = obj.modifiers.new('Preview skin', 'ARMATURE')
        mod.object = self.rig
        obj.parent = self.rig
        self.parts.append(obj)
        return obj

    def box(self, name, p, size, slot, bones, tint=1, radius=.004, frame=None):
        bpy.ops.mesh.primitive_cube_add(size=1)
        obj = bpy.context.object
        obj.scale = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        transform = Matrix.Translation(Vector(p))
        if frame is not None:
            transform = frame @ transform
        obj.matrix_world = C.to_4x4() @ transform
        return self.finish(obj, name, slot, bones, tint, radius)

    def ellipsoid(self, name, p, radii, slot, bones, tint=1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=1)
        obj = bpy.context.object
        obj.scale = radii
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.matrix_world = C.to_4x4() @ Matrix.Translation(Vector(p))
        return self.finish(obj, name, slot, bones, tint, smooth=True)

    def rod(self, name, a, b, radius, slot, bones, tint=1, frame=None):
        a, b = Vector(a), Vector(b)
        if frame is not None:
            a, b = frame @ a, frame @ b
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=(b-a).length)
        obj = bpy.context.object
        obj.location = C @ ((a+b)/2)
        obj.rotation_mode = 'QUATERNION'
        obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(C @ (b-a).normalized())
        return self.finish(obj, name, slot, bones, tint, bevel=radius*.12, smooth=True)

    def garment(self, name, sections, slot, bones, tint=1, segments=20, folds=.0015, jointed=False):
        """Small sewn cross-section surface; Blender supplies normals/triangulation.

        Sections are actor-space (centre, horizontal radius, depth radius).
        This is shared only by jacket and jointed cloth, not a geometry engine.
        """
        verts, faces = [], []
        phase = self.rng.random() * math.tau
        for j, (centre, rx, rz) in enumerate(sections):
            x_axis, z_axis = Vector((1, 0, 0)), Vector((0, 0, 1))
            if jointed:
                tangent = (Vector(sections[min(j+1, len(sections)-1)][0]) -
                           Vector(sections[max(0, j-1)][0])).normalized()
                x_axis = Vector((0, 0, 1)).cross(tangent).normalized()
                z_axis = tangent.cross(x_axis).normalized()
            for i in range(segments):
                a = math.tau * i / segments
                crease = folds * math.sin(j * 2.7 + a * 3 + phase)
                verts.append(C @ (Vector(centre) + x_axis*((rx+crease)*math.cos(a)) +
                                  z_axis*((rz+crease)*math.sin(a))))
        for j in range(len(sections)-1):
            for i in range(segments):
                a = j*segments+i
                b = j*segments+(i+1)%segments
                faces.append((a, a+segments, b+segments, b))
        for ring, reverse in ((0, False), (len(sections)-1, True)):
            centre = len(verts)
            verts.append(C @ Vector(sections[ring][0]))
            for i in range(segments):
                face = (centre, ring*segments+i, ring*segments+(i+1)%segments)
                faces.append(tuple(reversed(face)) if reverse else face)
        # Closed sewn surfaces can run up or down a limb. Orient once by volume;
        # explicit cap fans also avoid ambiguous n-gon tessellation between runs.
        volume = sum(verts[f[0]].dot(verts[f[k]].cross(verts[f[k+1]]))
                     for f in faces for k in range(1, len(f)-1))
        if volume < 0:
            faces = [(f[0], *reversed(f[1:])) for f in faces]
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        return self.finish(obj, name, slot, bones, tint, smooth=True)

    def limb(self, name, chain, radii):
        points = [self.bp[b] for b in chain]
        sections = []
        for k in range(2):
            for j in range(7):
                t = j/6
                if k == 1 and j == 0:
                    continue
                centre = points[k].lerp(points[k+1], t)
                radius = radii[k]*(1-t) + radii[k+1]*t
                sections.append((centre, radius, radius*.91))
        return self.garment(name, sections, 'cloth', chain, segments=18, folds=.0022, jointed=True)


def wardrobe(r, variant):
    r.garment('Jacket | shaped hem, waist, shoulders, collar', [
        ((0, .87, -.006), .146, .103), ((0, .96, -.01), .153, .106),
        ((0, 1.06, -.012), .145, .10), ((0, 1.18, 0), .164, .113),
        ((0, 1.31, .004), .187, .12), ((0, 1.405, 0), .193, .11),
        ((0, 1.45, -.006), .145, .09), ((0, 1.49, -.008), .065, .062)],
        'cloth', ['Hips', 'Spine', 'Spine1', 'Spine2'])
    r.ellipsoid('Trouser seat', (0, .89, -.01), (.143, .105, .10), 'cloth', ['Hips', 'UpLegR', 'UpLegL'])
    for side, suffix in [(-1, 'R'), (1, 'L')]:
        sh, elbow, hand = [r.bp[b+suffix] for b in ('UpperArm', 'Forearm', 'Hand')]
        hip, knee, ankle = [r.bp[b+suffix] for b in ('UpLeg', 'Leg', 'Foot')]
        r.ellipsoid('Deltoid '+suffix, sh, (.066, .079, .067), 'cloth', ['UpperArm'+suffix, 'Clavicle'+suffix])
        r.limb('Jointed sleeve '+suffix, ['UpperArm'+suffix, 'Forearm'+suffix, 'Hand'+suffix], [.060, .051, .037])
        r.ellipsoid('Elbow reinforcement '+suffix, elbow+Vector((0, 0, -.018)), (.05, .057, .044), 'gear', ['UpperArm'+suffix, 'Forearm'+suffix], .55)
        r.limb('Jointed trousers '+suffix, ['UpLeg'+suffix, 'Leg'+suffix, 'Foot'+suffix], [.088, .068, .055])
        r.box('Cargo pocket '+suffix, (hip.x+side*.064, .77, .035), (.072, .13, .058), 'cloth', 'UpLeg'+suffix, .94, .012)
        r.box('Cargo flap '+suffix, (hip.x+side*.065, .825, .067), (.075, .026, .014), 'cloth', 'UpLeg'+suffix, .88)
        if variant['kneePads']:
            r.ellipsoid('Knee pad backing '+suffix, knee+Vector((0, 0, .047)), (.068, .087, .029), 'gear', ['UpLeg'+suffix, 'Leg'+suffix], .55)
            r.box('Knee pad shell '+suffix, knee+Vector((0, 0, .071)), (.095, .105, .023), 'polymer', 'Leg'+suffix, .72, .013)
        r.box('Boot sole '+suffix, (ankle.x, .021, .033), (.122, .042, .244), 'rubber', ['Foot'+suffix, 'Toe'+suffix], .8, .014)
        r.box('Boot toe '+suffix, (ankle.x, .068, .075), (.114, .079, .148), 'boot', ['Foot'+suffix, 'Toe'+suffix], (.22, .209, .198), .023)
        r.box('Boot ankle '+suffix, (ankle.x, .136, -.027), (.102, .19, .108), 'boot', ['Leg'+suffix, 'Foot'+suffix], (.22, .209, .198), .019)
        for j in range(5):
            y = .085+j*.022
            r.rod('Boot lace '+suffix, (ankle.x-.035, y, .034), (ankle.x+.035, y+.012, .036), .002, 'boot', 'Foot'+suffix, .21)
        # Palms and individually articulated-looking curled fingers, not mittens.
        r.ellipsoid('Glove palm '+suffix, hand, (.035, .043, .042), 'boot', ['Hand'+suffix, 'Forearm'+suffix], (.38, .372, .363))
        for j in range(4):
            p = hand+Vector(((j-1.5)*.014, -.026, .026))
            q = p+Vector((0, -.025, .018))
            r.rod('Glove finger '+suffix, p, q, .008, 'boot', 'Hand'+suffix, .38)
            r.rod('Curled fingertip '+suffix, q, q+Vector((0, .008, -.022)), .0075, 'boot', 'Hand'+suffix, .36)
        r.ellipsoid('Glove thumb '+suffix, hand+Vector((side*.031, .007, .021)), (.014, .027, .023), 'boot', 'Hand'+suffix, .38)
    if variant['fullCarrier']:
        for z in (.125, -.115):
            r.box('Ballistic carrier', (0, 1.265, z), (.282, .286, .054), 'plate', ['Spine1', 'Spine2'], .72, .028)
        for side in (-1, 1):
            r.box('Carrier side panel', (side*.153, 1.22, 0), (.035, .16, .21), 'gear', ['Spine', 'Spine1'], .70, .009)
            r.box('Shoulder yoke', (side*.092, 1.423, 0), (.046, .037, .26), 'gear', 'Spine2', .70, .008)
        for row in range(4):
            for col in range(5):
                r.box('MOLLE stitched webbing', ((col-2)*.049, 1.17+row*.043, .157), (.041, .012, .009), 'gear', ['Spine1', 'Spine2'], .70, .002)
        for i in range(3):
            x, y = (i-1)*.078, 1.224+r.rng.uniform(-.006, .006)
            r.box('Loaded magazine pouch', (x, y, .181), (.066, .114, .066), 'gear', 'Spine1', .76 if i == 1 else .84, .009)
            r.box('Pouch flap', (x, y+.048, .211), (.065, .027, .018), 'gear', 'Spine1', .76, .004)
            r.box('Pouch pull tab', (x, y+.015, .222), (.015, .04, .008), 'gear', 'Spine1', .56, .002)
        r.box('Exposed spare magazine', (0, 1.32, .18), (.032, .082, .042), 'polymer', 'Spine1', .9)
    r.box('Radio pouch', (.113, 1.34, .135), (.06, .108, .057), 'gear', 'Spine2', .76, .008)
    r.rod('Radio antenna', (.118, 1.38, .129), (.118, 1.50, .11), .003, 'polymer', 'Spine2')
    r.box('Admin pouch', (-.08, 1.362, .16), (.104, .057, .035), 'gear', 'Spine2', .76, .007)
    r.garment('Equipment belt', [((0, .969, 0), .161, .115), ((0, 1.005, 0), .161, .115)], 'gear', ['Hips', 'Spine'], (.62, .61, .57), folds=0)
    r.box('Belt buckle', (0, .987, .12), (.043, .034, .014), 'polymer', 'Hips', .8)
    r.box('IFAK hip pouch', (-.17, .96, -.016), (.085, .13, .10), 'gear', 'Hips', .72, .012)
    r.rod('Diagonal sling', (-.13, 1.43, .13), (.10, 1.08, .146), .012, 'gear', ['Spine1', 'Spine2'], .70)


def headgear(r, variant):
    r.ellipsoid('Neck', (0, 1.502, -.006), (.052, .076, .052), 'skin', ['Neck', 'Head'])
    r.ellipsoid('Face and cranium', (0, 1.657, .005), (.083, .117, .085), 'skin', 'Head')
    r.ellipsoid('Jaw', (0, 1.591, .031), (.066, .045, .062), 'skin', 'Head')
    r.ellipsoid('Nose bridge', (0, 1.655, .086), (.016, .034, .026), 'skin', 'Head')
    for side in (-1, 1):
        r.ellipsoid('Ear', (side*.083, 1.653, -.002), (.017, .033, .022), 'skin', 'Head')
    if variant['faceWrap']:
        r.ellipsoid('Face wrap', (0, 1.593, .04), (.087, .052, .073), 'gear', 'Head', (.56, .54, .50))
        for j in range(3):
            r.rod('Wrap folded hem', (-.065, 1.57+j*.018, .09), (.065, 1.574+j*.018, .096), .003, 'gear', 'Head', .48)
    if variant['helmet']:
        # Native sphere with lower hemisphere removed leaves an actual open shell.
        shell = r.ellipsoid('Covered ballistic helmet', (0, 1.724, -.005), (.112, .10, .116),
                            'cloth' if variant['helmetCover'] else 'plate', 'Head', variant['helmetTint'])
        bm = bmesh.new()
        bm.from_mesh(shell.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -.025], context='VERTS')
        bm.to_mesh(shell.data)
        bm.free()
        solid = shell.modifiers.new('Helmet shell thickness', 'SOLIDIFY')
        solid.thickness = .004
        for side in (-1, 1):
            r.box('Helmet accessory rail', (side*.109, 1.705, -.025), (.015, .027, .105), 'polymer', 'Head', .8)
            r.rod('Helmet chin strap', (side*.091, 1.696, -.008), (side*.054, 1.555, .038), .007, 'gear', 'Head', .56)
        r.box('Night vision shroud', (0, 1.754, .103), (.037, .04, .012), 'polymer', 'Head')
    if variant['goggles']:
        y = 1.675 if variant['gogglesDown'] else 1.756
        r.garment('Goggle retention band', [((0, y-.012, -.003), .096, .098), ((0, y+.012, -.003), .096, .098)], 'gear', 'Head', .56, folds=0)
        for side in (-1, 1):
            r.box('Goggle frame', (side*.044, y, .087), (.087, .055, .03), 'polymer', 'Head', .85, .012)
            r.box('Down goggle lens', (side*.044, y, .105), (.069, .037, .009), 'glass', 'Head', 1, .008)
        r.box('Goggle bridge', (0, y+.005, .103), (.018, .018, .014), 'polymer', 'Head')


def carbine(r):
    rig = r.ref['rig']
    z = Vector(rig['boreDir']).normalized()
    x = Vector((0, 1, 0)).cross(z).normalized()
    y = z.cross(x).normalized()
    frame = Matrix(((x.x, y.x, z.x, rig['gripR'][0]),
                    (x.y, y.y, z.y, rig['gripR'][1]),
                    (x.z, y.z, z.z, rig['gripR'][2]), (0, 0, 0, 1)))
    bore, muzzle_z = .095, .447
    def box(name, p, dims, slot='polymer', radius=.002):
        return r.box('Carbine | '+name, p, dims, slot, 'HandR', radius=radius, frame=frame)
    def rod(name, a, b, radius, slot='steel'):
        return r.rod('Carbine | '+name, a, b, radius, slot, 'HandR', frame=frame)
    box('lower receiver', (0, .06, .005), (.039, .06, .128))
    box('upper receiver', (0, .109, .005), (.037, .042, .13), 'steel')
    rod('pistol grip', (0, .047, -.026), (0, -.054, -.055), .019, 'polymer')
    # Same frame and dimensions drive visible handguard, support grip and metadata.
    support = frame.inverted() @ Vector(rig['gripL'])
    guard_end = max(.26, support.z+.045)
    box('vented handguard', (0, bore, (.074+guard_end)/2), (.052, .062, guard_end-.074))
    for side in (-1, 1):
        for j in range(7):
            box('handguard vent', (side*.027, .095, .095+j*.023), (.003, .014, .014), 'rubber', .001)
    rod('barrel', (0, bore, guard_end), (0, bore, muzzle_z-.025), .009)
    rod('flash hider', (0, bore, muzzle_z-.03), (0, bore, muzzle_z), .014)
    box('muzzle bore', (0, bore, muzzle_z+.0005), (.012, .012, .001), 'rubber', .001)
    rod('buffer tube', (0, bore, -.065), (0, bore, -.218), .015)
    box('collapsible stock', (0, .065, -.183), (.046, .092, .114))
    box('rubber butt pad', (0, .065, -.245), (.049, .11, .012), 'rubber', .004)
    for j in range(14):
        box('rail tooth', (0, .133, -.05+j*.021), (.029, .007, .009), 'steel', .001)
    mag_bottom = Vector((0, -.155, .033))
    rod('magazine body', (0, .025, .004), mag_bottom, .021, 'polymer')
    box('magazine floor plate', mag_bottom, (.035, .012, .051))
    for j in range(5):
        box('magazine rib', (0, -.014-j*.027, .009+j*.004), (.045, .008, .04))
    # Open trigger guard as three separate bars, with visible trigger inside.
    for a, b in [((0, .04, -.054), (0, .008, -.054)),
                 ((0, .008, -.054), (0, .008, -.005)),
                 ((0, .008, -.005), (0, .034, -.005))]:
        rod('trigger guard', a, b, .004, 'polymer')
    rod('trigger', (0, .04, -.031), (0, .019, -.025), .003)
    ejection = (-.022, .107, .012)
    box('ejection port', ejection, (.004, .019, .044), 'rubber', .001)
    box('charging handle', (0, .128, -.071), (.054, .008, .012), 'steel')
    box('optic riser', (0, .153, .018), (.028, .026, .047), 'steel')
    rod('red dot housing', (0, .183, -.021), (0, .183, .061), .024)
    rod('front optic glass', (0, .183, .062), (0, .183, .064), .019, 'glass')
    rod('rear optic glass', (0, .183, -.024), (0, .183, -.022), .019, 'glass')
    box('front sight', (0, .121, .33), (.012, .044, .014), 'steel')
    local = {'muzzle': (0, bore, muzzle_z), 'foregrip': tuple(support),
             'magBottom': tuple(mag_bottom), 'ejection': ejection,
             'stockTop': (0, bore, -.218)}
    return {name: [f32(v) for v in frame @ Vector(p)] for name, p in local.items()}


def packed_mesh(recipe):
    mesh = {key: [] for key in ('position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight', 'index', 'groups')}
    depsgraph = bpy.context.evaluated_depsgraph_get()
    names = recipe.ref['rig']['names']
    for slot_index, slot in enumerate(recipe.ref['slots']):
        start = len(mesh['index'])
        for obj in recipe.parts:
            if obj['surface'] != slot:
                continue
            evaluated = obj.evaluated_get(depsgraph)
            data = evaluated.to_mesh()
            data.calc_loop_triangles()
            transform = C.to_4x4().transposed() @ obj.matrix_world
            normal_matrix = transform.to_3x3().inverted().transposed()
            lookup, triangles = {}, []
            # Native primitive face order is not stable across Blender processes.
            # Canonical corner tuples and micron-scale quantization remove that
            # authoring noise without imposing old procedural geometry parity.
            def packed(values):
                return tuple(f32(round(v, 5)) for v in values)
            for triangle in data.loop_triangles:
                corners = []
                for loop_index in triangle.loops:
                    loop = data.loops[loop_index]
                    vertex = data.vertices[loop.vertex_index]
                    p = packed(transform @ vertex.co)
                    native_normal = (normal_matrix @ data.corner_normals[loop_index].vector).normalized()
                    n = tuple(f32(v) for v in Vector([round(v, 4) for v in native_normal]).normalized())
                    uv = tuple(f32(round(v, 4)) for v in data.uv_layers.active.data[loop_index].uv)
                    weights = sorted([(names.index(obj.vertex_groups[g.group].name), g.weight)
                                      for g in vertex.groups if g.weight > 0], key=lambda g: (-g[1], g[0]))[:4]
                    total = sum(w for _, w in weights)
                    assert total > 0, obj.name
                    joints = tuple(i for i, _ in weights) + (0,)*(4-len(weights))
                    weights = tuple(f32(round(w/total, 6)) for _, w in weights) + (0,)*(4-len(weights))
                    color = tuple(f32(v) for v in obj['linear_tint'])
                    key = p+n+uv+color+joints+weights
                    corners.append(key)
                triangles.append(min(tuple(corners[j:]+corners[:j]) for j in range(3)))
            for triangle in sorted(triangles):
                for key in triangle:
                    if key not in lookup:
                        lookup[key] = len(mesh['position'])//3
                        for attr, lo, hi in [('position', 0, 3), ('normal', 3, 6), ('uv', 6, 8),
                                            ('color', 8, 11), ('skinIndex', 11, 15), ('skinWeight', 15, 19)]:
                            mesh[attr].extend(key[lo:hi])
                    mesh['index'].append(lookup[key])
            evaluated.to_mesh_clear()
        mesh['groups'].append({'start': start, 'count': len(mesh['index'])-start, 'materialIndex': slot_index})
    return mesh


def build(reference, output, variant, seed):
    if variant != 'vanguard':
        raise ValueError('Only the vanguard pilot is supported; no fallback model')
    v = reference['variants'][variant]
    # Fail explicitly if new source features need authoring, never silently omit them.
    required = ('helmet', 'helmetCover', 'goggles', 'gogglesDown', 'faceWrap', 'kneePads', 'fullCarrier')
    assert all(v.get(k) for k in required) and v['weapon'] == 'carbine'
    assert not any(v.get(k) for k in ('headWrap', 'shades', 'maskHard', 'beard'))
    assert v['bulk'] == v['scale'] == 1 and v.get('wide', 1) == 1
    if not output.is_absolute():
        raise ValueError('--output must be an absolute scratch directory')
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    rig = armature(reference)
    r = Recipe(reference, seed, rig)
    wardrobe(r, v)
    headgear(r, v)
    weapon = carbine(r)
    for name, point in weapon.items():
        socket = bpy.data.objects.new('WEAPON_'+name, None)
        bpy.context.collection.objects.link(socket)
        socket.location = C @ Vector(point)
        socket.empty_display_size = .012
        socket.parent = rig
    bpy.context.view_layer.update()
    mesh = packed_mesh(r)
    count = len(mesh['position'])//3
    # JSON integers retain exact U16 joints and U16/U32 indices; Node chooses the typed accessor.
    assert len(reference['rig']['names']) <= 65535
    assert all(0 <= i < count for i in mesh['index'])
    assert len(mesh['index'])//3 <= 25700, len(mesh['index'])//3
    payload = {'version': 1, 'name': variant, 'seed': seed, 'slots': reference['slots'], 'mesh': mesh,
               'weapon': weapon, 'stats': {'vertices': count, 'triangles': len(mesh['index'])//3}, 'variant': v}
    rig['reference_version'] = reference['version']
    rig['seed'] = seed
    rig['runtime_bone_order'] = json.dumps(reference['rig']['names'])
    bpy.ops.wm.save_as_mainfile(filepath=str(output/(variant+'.blend')))
    (output/(variant+'.mesh.json')).write_text(json.dumps(payload, separators=(',', ':'), allow_nan=False)+'\n')
    print(json.dumps({'output': str(output), **payload['stats'], 'parts': len(r.parts)}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--variant', required=True)
    parser.add_argument('--seed', required=True, type=int)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    build(json.loads(args.reference.read_text()), args.output, args.variant, args.seed)


if __name__ == '__main__':
    main()
