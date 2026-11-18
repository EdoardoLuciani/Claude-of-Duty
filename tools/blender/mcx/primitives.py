"""Exact MCX exterior primitives, also used by the standalone ACOG recipe."""
import math
import bpy
from mathutils import Vector

def create_primitives(asset, body, materials):
    anodized = materials['anodized']
    edge = materials['edge']
    polymer = materials['polymer']
    rubber = materials['rubber']
    steel = materials['steel']
    ceramic = materials['ceramic']
    brass = materials['brass']
    copper = materials['copper']
    marking = materials['marking']
    red = materials['red']
    glass = materials['glass']
    fiber = materials['fiber']
    coating = materials['coating']

    def move_to(obj, collection=asset):
        for c in list(obj.users_collection):
            c.objects.unlink(obj)
        collection.objects.link(obj)
        return obj


    def active(obj):
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj


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
            # Sub-millimetre machined chamfers need one segment; the large
            # rounded forging/grip transitions override this below.
            mod.width = bevel; mod.segments = 1
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


    def profile(name, points, width, mat=anodized, parent=body, bevel=.0008, y=0, rounded=False, segments=4):
        # Outline extrusions are two-ring lofts; ordinary plates remain flat-shaded.
        rings = [[(x, y+s*width/2, z) for x, z in points] for s in (-1, 1)]
        return loft(name, rings, mat, parent, bevel, rounded, segments)


    def loft(name, rings, mat, parent=body, bevel=.001, rounded=True, segments=4):
        # Explicit cross-sections: continuous shoulders, not raised plate overlays.
        n = len(rings[0])
        verts = [point for ring in rings for point in ring]
        faces = [tuple(range(n-1, -1, -1)), tuple(range((len(rings)-1)*n, len(rings)*n))]
        faces += [(j*n+i, j*n+(i+1)%n, (j+1)*n+(i+1)%n, (j+1)*n+i)
                  for j in range(len(rings)-1) for i in range(n)]
        mesh = bpy.data.meshes.new(name); mesh.from_pydata(verts, [], faces); mesh.update()
        obj = bpy.data.objects.new(name, mesh); asset.objects.link(obj)
        active(obj); bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.normals_make_consistent(inside=False); bpy.ops.object.mode_set(mode='OBJECT')
        for polygon in mesh.polygons: polygon.use_smooth = rounded and len(polygon.vertices) == 4
        finish(obj, name, mat, parent, bevel)
        if bevel and rounded:
            mod = obj.modifiers.get('Machined edge radius')
            mod.segments = segments; mod.harden_normals = True
        return obj


    def forging(name, sections):
        rings = []
        for x, bottom, top, w in sections:
            r = min(.007, (top-bottom)/3)
            yz = [(-w*.48,top),(w*.48,top),(w*.82,top-r*.5),(w,top-r*1.5),
                  (w,bottom+r),(w*.9,bottom+r*.25),(w*.7,bottom),
                  (-w*.7,bottom),(-w*.9,bottom+r*.25),(-w,bottom+r),
                  (-w,top-r*1.5),(-w*.82,top-r*.5)]
            rings.append([(x,y,z) for y,z in yz])
        return loft(name, rings, coating)


    def cylinder(name, loc, radius, depth, mat=steel, axis='X', parent=body, vertices=24, bevel=.00035):
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
        obj = bpy.context.object
        if axis == 'X': obj.rotation_euler[1] = math.pi/2
        if axis == 'Y': obj.rotation_euler[0] = math.pi/2
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
        for p in obj.data.polygons: p.use_smooth = len(p.vertices) == 4
        return finish(obj, name, mat, parent, bevel)


    def ellipsoid(name, loc, radii, mat, parent, segments=20, rings=10):
        # Explicit latitude rings keep face order stable across Blender processes.
        # The generated preview and exporter receive the same ordinary mesh.
        vertices = [(0, 0, radii[2])]
        for ring in range(1, rings):
            latitude = math.pi * ring / rings
            for column in range(segments):
                longitude = math.tau * column / segments
                vertices.append((
                    radii[0] * math.sin(latitude) * math.cos(longitude),
                    radii[1] * math.sin(latitude) * math.sin(longitude),
                    radii[2] * math.cos(latitude),
                ))
        bottom = len(vertices)
        vertices.append((0, 0, -radii[2]))
        faces = [(0, 1 + column, 1 + (column + 1) % segments)
                 for column in range(segments)]
        for ring in range(rings - 2):
            start = 1 + ring * segments
            for column in range(segments):
                a = start + column
                b = start + (column + 1) % segments
                faces.append((a, a + segments, b + segments, b))
        last = 1 + (rings - 2) * segments
        faces.extend((last + column, bottom, last + (column + 1) % segments)
                     for column in range(segments))
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        asset.objects.link(obj)
        obj.location = loc
        return finish(obj, name, mat, parent, bevel=0)

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
        obj = cylinder(name, loc, radius, length, mat, parent=parent, vertices=48)
        cut(obj, cylinder('CUT', loc, inner, length+.005, None, parent=None, vertices=48, bevel=0))
        return obj


    def cord(name, points, radius, mat):
        curve = bpy.data.curves.new(name, 'CURVE')
        curve.dimensions = '3D'; curve.resolution_u = 12
        curve.bevel_depth = radius; curve.bevel_resolution = 3; curve.use_fill_caps = True
        spline = curve.splines.new('BEZIER'); spline.bezier_points.add(len(points)-1)
        for point, co in zip(spline.bezier_points, points):
            point.co = co; point.handle_left_type = 'AUTO'; point.handle_right_type = 'AUTO'
        obj = bpy.data.objects.new(name, curve); asset.objects.link(obj)
        active(obj); bpy.ops.object.convert(target='MESH')
        return finish(obj, name, mat, bevel=0)


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

    return active, finish, box, profile, loft, forging, cylinder, ellipsoid, cut, opening, tube, cord, screw, text
