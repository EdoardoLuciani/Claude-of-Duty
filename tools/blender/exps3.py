"""Author the EXPS3-0 from factory-empty Blender 5.2.2; no CAD/scan or old blend inputs.

blender -b -t 8 --python-exit-code 1 --python tools/blender/exps3.py -- --output /tmp/exps3 --render
Coordinates: Blender X right, Y forward, Z up. Dimensions below are millimetres;
export is native metres, glTF +Y up / -Z forward. See asset README/references.json.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/attachments/eotech-exps3-0'
MM = 0.001
# Photo-backed art datums, not certified optical/installation specifications.
OPTICAL_Z = 48.2
PANE_MM = (30, 23)
CLEAR_MM = (30, 22)
CORNER_MM = 5.4
BATTERY_ROOF_Z = 36.7


def material(name, color, metal=0, rough=0.5):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    m.use_backface_culling = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    return m


def finishes(output):
    mats = {
        'hood': material('01 | bead-blasted black anodized hood', (.035, .040, .048), 1, .43),
        'body': material('02 | phosphate-black housing', (.025, .030, .037), .8, .49),
        'mount': material('03 | hard-anodized QD mount', (.018, .021, .026), 1, .47),
        'rubber': material('04 | moulded rubber controls', (.012, .014, .017), 0, .78),
        'steel': material('05 | dark fastener steel', (.055, .060, .067), 1, .38),
        'edge': material('06 | exposed adjustment nut', (.23, .24, .25), 1, .34),
        'paint': material('07 | off-white pad print', (.72, .75, .72), 0, .55),
        'yellow': material('08 | laser warning yellow', (.84, .62, .025), 0, .62),
        'ink': material('09 | label ink and recesses', (.004, .005, .006), 0, .66),
        'glass': material('10 | AR-coated optical glass', (.89, .97, .96), 0, .075),
    }
    glass = mats['glass'].node_tree.nodes.get('Principled BSDF')
    glass.inputs['Transmission Weight'].default_value = 1
    glass.inputs['IOR'].default_value = 1.5
    mats['glass'].use_raytrace_refraction = True
    mats['glass'].use_backface_culling = False
    # Original seeded micro-finish, never a photographic texture or painted fake wear.
    rng = np.random.default_rng(330)
    noise = rng.normal(0, 1, (1024, 1024)).astype(np.float32)
    for name, values, space in [
        ('finish-roughness', np.clip(.5 + noise * .025, .36, .64), 'Non-Color'),
        ('finish-normal', None, 'Non-Color'),
    ]:
        rgba = np.ones((1024, 1024, 4), dtype=np.float32)
        if values is not None:
            rgba[:, :, :3] = values[:, :, None]
        else:
            rgba[:, :, 0] = .5 + noise * .018
            rgba[:, :, 1] = .5 + np.roll(noise, 1, axis=0) * .018
            rgba[:, :, 2] = 1
        image = bpy.data.images.new(name, width=1024, height=1024, alpha=False)
        image.colorspace_settings.name = space
        image.pixels.foreach_set(rgba.ravel())
        image.filepath_raw = str(output / (name + '.png'))
        image.file_format = 'PNG'
        image.save()
        image.pack()
        for key in ('hood', 'body', 'mount'):
            mat = mats[key]
            texture = mat.node_tree.nodes.new('ShaderNodeTexImage')
            texture.image = image
            bsdf = mat.node_tree.nodes.get('Principled BSDF')
            if values is not None:
                # Preserve the finish-specific response instead of replacing it
                # with the shared map's 0.5 mean. Native glTF exports these factors.
                factor = {'hood':.86,'body':1.0,'mount':.94}[key]
                multiply = mat.node_tree.nodes.new('ShaderNodeMath')
                multiply.operation = 'MULTIPLY'
                multiply.inputs[1].default_value = factor
                mat.node_tree.links.new(texture.outputs['Color'],multiply.inputs[0])
                mat.node_tree.links.new(multiply.outputs[0],bsdf.inputs['Roughness'])
            else:
                normal = mat.node_tree.nodes.new('ShaderNodeNormalMap')
                normal.inputs['Strength'].default_value = .65 if key == 'body' else .22
                mat.node_tree.links.new(texture.outputs['Color'], normal.inputs['Color'])
                mat.node_tree.links.new(normal.outputs['Normal'], bsdf.inputs['Normal'])
    return mats


def active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def mesh(name, vertices, faces, mat, parent):
    data = bpy.data.meshes.new(name)
    data.from_pydata([tuple(v * MM for v in p) for p in vertices], [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    data.materials.append(mat)
    return obj


def finish(obj, width=.25, smooth=True):
    active(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    if width:
        bevel = obj.modifiers.new('Manufactured edge radius', 'BEVEL')
        bevel.width = width * MM
        bevel.segments = 2
        bpy.ops.object.modifier_apply(modifier=bevel.name)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
        weighted = obj.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
        weighted.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=weighted.name)
    uv = obj.data.uv_layers.new(name='UVMap')
    # Coarser cast-housing grain, finer hood/mount; original maps and ordinary UV0.
    tile = .08 if obj.data.materials[0].name.startswith('02 |') else .04
    for polygon in obj.data.polygons:
        axis = max(range(3), key=lambda i: abs(polygon.normal[i]))
        a, b = [(1, 2), (0, 2), (0, 1)][axis]
        for loop in polygon.loop_indices:
            p = obj.data.vertices[obj.data.loops[loop].vertex_index].co
            # Binary authoring lattice keeps native export's V flip exact, including after renders.
            uv.data[loop].uv = tuple(round(p[i] / tile * 65536) / 65536 for i in (a,b))
    return obj


def box(name, pos, size, mat, parent, bevel=.3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=tuple(v * MM for v in pos))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = tuple(v * MM for v in size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    obj.parent = parent
    return finish(obj, bevel)


def cylinder(name, pos, radius, depth, mat, parent, axis='X', sides=48, bevel=.15):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=radius * MM, depth=depth * MM,
                                      location=tuple(v * MM for v in pos))
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = {'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0), 'Z': (0, 0, 0)}[axis]
    active(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.data.materials.append(mat)
    obj.parent = parent
    return finish(obj, bevel)


def prism(name, contour, low, high, mat, parent, axis='X', bevel=.2):
    def point(u, a, b):
        return (u, a, b) if axis == 'X' else (a, u, b)
    n = len(contour)
    verts = [point(u, a, b) for u in (low, high) for a, b in contour]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return finish(mesh(name, verts, faces, mat, parent), bevel)


def text(name, value, pos, size, mat, parent, side='left', angle=0, relief=0):
    data = bpy.data.curves.new(name, 'FONT')
    data.body = value
    data.size = size * MM
    data.align_x = 'CENTER'
    data.align_y = 'CENTER'
    data.resolution_u = 3
    if relief:
        data.extrude = relief * MM
        data.bevel_depth = (.015 if relief >= .1 else .008 if relief >= .05 else 0) * MM
        data.bevel_resolution = 1 if relief >= .1 else 0
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = tuple(v * MM for v in pos)
    # Font XY plane, local +Z points out of the finished surface.
    basis = {
        'left': ((0, 0, -1), (-1, 0, 0), (0, 1, 0)),
        'right': ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
        'rear': ((1, 0, 0), (0, 0, -1), (0, 1, 0)),
    }[side]
    obj.rotation_euler = Matrix(basis).to_euler()
    obj.rotation_euler.rotate_axis('Z', angle)
    obj.data.materials.append(mat)
    obj.parent = parent
    active(obj)
    bpy.ops.object.convert(target='MESH')
    return finish(bpy.context.object, 0, False)


def rounded_rect(width, height, radius, center_z=0, steps=10):
    pts = []
    for x, z, start in [(width/2-radius, height/2-radius, 0),
                         (-width/2+radius, height/2-radius, 90),
                         (-width/2+radius, -height/2+radius, 180),
                         (width/2-radius, -height/2+radius, 270)]:
        for i in range(steps + 1):
            a = math.radians(start + i * 90 / steps)
            pts.append((x + radius * math.cos(a), center_z + z + radius * math.sin(a)))
    return pts


def brand_icon(name, pos, mat, parent, side, depth=.035):
    # Rounded pad-print/casting outline with the four negative-space slots of the mark.
    axis = 'Y' if side == 'rear' else 'X'
    sign = 1 if side == 'right' else -1
    index = 1 if axis == 'Y' else 0
    horizontal = 1 if side != 'left' else -1
    def profile(w,h,r,u=0,v=0):
        return [(pos[0 if axis=='Y' else 1]+horizontal*(a+u),pos[2]+b+v)
                for a,b in rounded_rect(w,h,r,steps=6)]
    low,high = sorted((pos[index],pos[index]+sign*depth))
    obj = prism(name,profile(11.5,8.4,1.1),low,high,mat,parent,axis,0)
    for i,(w,h,r,u,v) in enumerate([(.95,5.8,.22,-3.75,0),
                                   (6.9,1.0,.20,1.2,2.3),(6.9,1.0,.20,1.2,0),
                                   (6.9,1.0,.20,1.2,-2.3)]):
        cutter = prism(name+' negative slot '+str(i),profile(w,h,r,u,v),
                       pos[index]-depth-.1,pos[index]+depth+.1,mat,parent,axis,0)
        active(obj)
        cut = obj.modifiers.new('Negative-space print slot','BOOLEAN')
        cut.operation,cut.object = 'DIFFERENCE',cutter
        bpy.ops.object.modifier_apply(modifier=cut.name)
        data = cutter.data
        bpy.data.objects.remove(cutter,do_unlink=True)
        bpy.data.meshes.remove(data)
    return surface_normals(obj)


def frame(name, outer, inner, front, rear, mat, parent):
    n = len(outer)
    verts = [(x, y, z) for y in (front, rear) for path in (outer, inner) for x, z in path]
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.extend([(i, j, n+j, n+i), (2*n+i, 3*n+i, 3*n+j, 2*n+j),
                      (i, 2*n+i, 2*n+j, j), (n+i, n+j, 3*n+j, 3*n+i)])
    return finish(mesh(name, verts, faces, mat, parent), .12)


def surface_normals(obj):
    # Boolean interpolation must not leave old corner normals across new holes.
    # Native sharp-edge splitting keeps planar casting/hood faces planar.
    active(obj)
    obj.data.set_sharp_from_angle(angle=math.radians(40))
    modifier = obj.modifiers.new('Normals after machining', 'WEIGHTED_NORMAL')
    modifier.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    # A weighted average is not a planar cap normal. Keep the bevel/curved-wall
    # normals, but explicitly author the axis-aligned sheet/casting/slot faces.
    normals = [tuple(n.vector) for n in obj.data.corner_normals]
    for polygon in obj.data.polygons:
        if max(abs(v) for v in polygon.normal) > .999999:
            for loop in polygon.loop_indices:
                normals[loop] = tuple(polygon.normal)
    obj.data.normals_split_custom_set(normals)
    return obj


def subtract(cutter, *objects):
    for obj in objects:
        active(obj)
        cutter.data.materials[0] = obj.data.materials[0]
        modifier = obj.modifiers.new('Actual machined recess', 'BOOLEAN')
        modifier.operation, modifier.object = 'DIFFERENCE', cutter
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        surface_normals(obj)
    data = cutter.data
    bpy.data.objects.remove(cutter, do_unlink=True)
    bpy.data.meshes.remove(data)


def hood_x(z):
    return float(np.interp(z, [8,31,42,58.7], [26,26,23.8,23.8]))


def ring_x(name, y, z, outer, inner, low, high, mat, parent, follow_hood=False):
    # Four circular loops; the adjustment well's mouth follows the bent hood.
    n = 48 if outer > 5 else 24
    vertices = []
    for front in (False, True):
        for radius in (outer, inner):
            for i in range(n):
                a = math.tau*i/n
                py, pz = y+radius*math.cos(a), z+radius*math.sin(a)
                px = hood_x(pz)-.12 if front and follow_hood else high if front else low
                vertices.append((px,py,pz))
    faces = []
    for i in range(n):
        j = (i+1)%n
        faces += [(i,j,n+j,n+i),(2*n+i,3*n+i,3*n+j,2*n+j),
                  (i,2*n+i,2*n+j,j),(n+i,n+j,3*n+j,3*n+i)]
    return surface_normals(finish(mesh(name,vertices,faces,mat,parent),0))


def hood_print(obj, plane):
    # Seat pad print on the actual sloped hood, never in a floating parallel plane.
    transform = obj.matrix_basis
    inverse = transform.inverted()
    for vertex in obj.data.vertices:
        p = transform @ vertex.co
        p.x = (hood_x(p.z/MM)+.025+p.x/MM-plane)*MM
        vertex.co = inverse @ p
    obj.data.update()
    return obj


def adjuster_x(radius):
    return float(np.interp(radius,[5.75,7.5,9.5,10.2],[23.8,23.6,22.6,21.9]))


def wire_loop(name, pos, radius, mat, parent):
    bpy.ops.mesh.primitive_torus_add(major_segments=24,minor_segments=8,
        major_radius=radius*MM,minor_radius=.16*MM,
        location=tuple(v*MM for v in pos),rotation=(math.pi/2,0,0))
    obj = bpy.context.object
    obj.name, obj.parent = name, parent
    obj.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    return finish(obj,0)


def shroud(mat, parent):
    # The real bent hood is an open U, not a solid cube with glass pasted on it.
    side = [(hood_x(z), z)
            for z in [8,20,26,30,34,36,38,40,42,44,46,48,50,52,54,56,58.7]]
    path = [(-x,z) for x,z in side]
    for i in range(1, 13):
        a = math.pi - i * math.pi / 24
        path.append((-14.3 + 9.5 * math.cos(a), 58.7 + 9.5 * math.sin(a)))
    path.append((14.3, 68.2))
    for i in range(1, 13):
        a = math.pi/2 - i * math.pi/24
        path.append((14.3 + 9.5 * math.cos(a), 58.7 + 9.5 * math.sin(a)))
    path += list(reversed(side[:-1]))
    # Side-profile fore/aft flare recovered from EXPS3 ls/rs photographs.
    heights = [8, 25, 37, 43, 50, 58, 66, 68.2]
    fore = [33, 33, 27, 23, 21, 20, 18.5, 17.5]
    aft = [-34, -34, -32, -28, -23.5, -21.5, -22, -22.2]
    outer, inner = [], []
    for x, z in path:
        outer.append((x, z))
        normal = Vector((x - max(-14.3, min(14.3, x)), max(0, z - 58.7)))
        if normal.length < .001:
            normal = Vector((1 if x > 0 else -1, 0))
        normal.normalize()
        inner.append((x-normal.x*1.8, z-normal.y*1.8))
    n = len(path)
    verts = []
    for profile in (outer, inner):
        for edge in (fore, aft):
            verts += [(x, float(np.interp(z, heights, edge)), z) for x, z in profile]
    faces = []
    for i in range(n-1):
        j = i+1
        faces += [(i,j,n+j,n+i), (2*n+i,3*n+i,3*n+j,2*n+j),
                  (i,2*n+i,2*n+j,j), (n+i,n+j,3*n+j,3*n+i)]
    faces += [(0,n,3*n,2*n), (n-1,3*n-1,4*n-1,2*n-1)]
    return finish(mesh('Protective bent-metal hood | 1.8mm wall', verts, faces, mat, parent), .35)


def screw(name, pos, mats, parent, axis='X', sign=1, radius=2.6):
    cylinder(name+' seat', pos, radius+.45, .35, mats['ink'], parent, axis)
    p = list(pos)
    index = 0 if axis == 'X' else 1
    p[index] += sign * .22
    head = cylinder(name+' head', p, radius, .5, mats['steel'], parent, axis)
    # Actual recessed six-lobe socket: the dark floor sits below the machined head.
    contour = []
    for i in range(48):
        a = i*math.tau/48
        r = radius * (.46 + .10*math.cos(6*a))
        contour.append((r*math.cos(a), r*math.sin(a)))
    lateral = 1 if axis == 'X' else 0
    profile = [(p[lateral]+a,p[2]+b) for a,b in contour]
    low,high = sorted((p[index]+sign*.05,p[index]+sign*.8))
    cutter = prism(name+' socket cutter',profile,low,high,mats['ink'],parent,axis,0)
    active(head)
    cut = head.modifiers.new('Machined Torx recess','BOOLEAN')
    cut.operation = 'DIFFERENCE'
    cut.object = cutter
    bpy.ops.object.modifier_apply(modifier=cut.name)
    data = cutter.data
    bpy.data.objects.remove(cutter,do_unlink=True)
    bpy.data.meshes.remove(data)
    p[index] += sign * .052
    verts = []
    for a,b in contour:
        v = list(p)
        v[lateral] += a
        v[2] += b
        verts.append(v)
    finish(mesh(name+' Torx socket floor', verts, [tuple(range(48))], mats['ink'], parent), 0, False)


def build_geometry(mats):
    root = bpy.data.objects.new('ATTACHMENT_exps3', None)
    bpy.context.collection.objects.link(root)
    for name, pos in [('SOCKET_mount', (0,0,0)), ('SOCKET_sight', (0,-23.1,OPTICAL_Z)),
                      ('SOCKET_lens_rear', (0,-23.1,OPTICAL_Z)), ('SOCKET_lens_front', (0,18.1,OPTICAL_Z))]:
        obj = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(obj)
        obj.parent = root
        obj.location = tuple(v*MM for v in pos)
        obj.empty_display_size = .004
    root['assetId'] = 'eotech-exps3-0'
    root['forward'] = '-Z after glTF export'
    root['reticle'] = 'EXPS3-0: 68 MOA ring / 1 MOA dot; runtime projection deferred, no baked reticle'
    hood = shroud(mats['hood'], root)
    skirt = [(1.5,8),(-6.5,3.7),(-31.9,3.7),(-34,5.7),(-34,8)]
    for lo,hi in [(-26,-24.2),(24.2,26)]:
        surface_normals(prism('Hood lower stepped skirt',skirt,lo,hi,mats['hood'],root,bevel=0))
    housing = box('Electronics lower housing', (0,-1,20), (46,66,26), mats['body'], root, 2)
    # Photo-derived cast-cover anatomy: raised upper ears, shallow saddle and
    # lower circular lobes. Lower screw row is 26mm below the retained upper row.
    contour = [(-20,5.5),(-20,29),(-19.8,31.2),(-18.4,32.4),(-16.5,33.3),
               (-15.3,33.3),(-13,32.2),(-8,31.5),(0,31.5),(8,31.5),(13,32.2),
               (15.3,33.3),(16.5,33.3),(18.4,32.4),(19.8,31.2),(20,29),(20,5.5)]
    contour += [(15.3+4.5*math.cos(a),2+4.5*math.sin(a))
                for a in np.linspace(0,-math.pi,17)]
    contour += [(9.7,3.5),(9.3,4.5),(8,5),(-8,5),(-9.3,4.5),(-9.7,3.5)]
    contour += [(-15.3+4.5*math.cos(a),2+4.5*math.sin(a))
                for a in np.linspace(0,-math.pi,17)]
    cover = prism('Rear electronics cover', contour, -35, -33.6, mats['body'], root, 'Y', .4)
    bosses = {}
    for x in (-15.3,15.3):
        # Boss face retains the old assembly's aft envelope, not proud screw heads.
        bosses[x] = cylinder('Rear cast lower boss '+str(x),(x,-34.77,2),4.5,2,
                             mats['body'],root,'Y',32,.25)
    # Clear central bore; carrier, elastomer seals and separately removable optical windows.
    # Slim carrier cheeks; its bottom stays seated on the existing 33mm housing roof.
    outer = rounded_rect(39, 30.4, 7, OPTICAL_Z)
    inner = rounded_rect(*CLEAR_MM, CORNER_MM, OPTICAL_Z)
    frame('Optical carrier | genuinely open aperture', outer, inner, 18, -23, mats['body'], root)
    for name,y in [('rear',-23.1),('front',18.1)]:
        frame('Lens '+name+' recessed gasket', rounded_rect(33,25,6,OPTICAL_Z),
              rounded_rect(*CLEAR_MM,CORNER_MM,OPTICAL_Z), y+.18, y-.18, mats['rubber'], root)
        # Nominal physical pane and the visible/clear bezel opening are distinct.
        path = rounded_rect(*PANE_MM,CORNER_MM,OPTICAL_Z)
        # Manufacturer manual: front 3.17mm glass, rear 4.76mm laminate.
        low,high = (y-3.17,y) if name == 'front' else (y,y+4.76)
        prism('OPTIC_glass_'+name,path,low,high,mats['glass'],root,'Y',.04)
    # Transverse CR123 battery body, seam, cap and scalloped grip.
    battery = [(26,BATTERY_ROOF_Z),(46.2,BATTERY_ROOF_Z)]
    for i in range(1,49):
        a = math.pi/2-i*math.pi/48
        # Relieve the whole upper shoulder, not only the flat roof. Lower profile,
        # cap axis and forward reach remain unchanged; clear-bore margin is 0.5mm.
        radius_z = BATTERY_ROOF_Z-23 if a > 0 else 14.5
        battery.append((46.2+14.5*math.cos(a),23+radius_z*math.sin(a)))
    battery += [(32.5,8.5),(26,12)]
    battery_housing = prism('Transverse CR123 battery housing', battery, -25,25, mats['body'], root, bevel=.6)
    prism('Battery compartment left end', battery, -25.6,-25, mats['hood'], root, bevel=.35)
    cylinder('Battery cap seal', (25.4,46.2,23), 11.95, 1.0, mats['rubber'], root)
    verts, faces = [], []
    for x in (26,29.2):
        for i in range(120):
            a = i*math.tau/120
            r = 11.75 if i%3 else 11.4
            verts.append((x,46.2+r*math.cos(a),23+r*math.sin(a)))
    faces = [tuple(reversed(range(120))), tuple(range(120,240))]
    faces += [(i,(i+1)%120,(i+1)%120+120,i+120) for i in range(120)]
    cap = finish(mesh('Scalloped battery cap', verts, faces, mats['hood'], root), .08)
    subtract(box('Battery cap groove cutter',(29,46.2,23),(1.8,2.1,28),mats['hood'],root,0),cap)
    box('Battery cap recessed groove floor',(28.115,46.2,23),(.02,2.08,22.8),mats['ink'],root,0)
    collar = ring_x('Battery cap retaining collar',46.2,23,14.1,13.3,25.8,27.1,mats['body'],root)
    text('Battery polarity marking', '+', (29.34,51.2,23), 5, mats['rubber'], root, 'right')
    # Both tether ends have visible threaded eyes and crimp sleeves. Wire pose
    # remains an exterior approximation; no hidden captive mechanism is modelled.
    ring_x('Hood tether eye',23,39,1.65,1.2,hood_x(39)-.1,hood_x(39)+.7,mats['body'],root)
    subtract(cylinder('Hood tether eye bore',(25,23,39),1.2,5,mats['hood'],root,bevel=0),hood)
    ring_x('Cap tether eye',44,36.5,1.2,.65,26.1,27.1,mats['body'],root)
    subtract(cylinder('Cap tether eye bore',(26.5,44,36.5),.65,3,mats['body'],root,bevel=0),collar)
    wire_loop('Hood tether folded loop',(25,23,40.3),1.4,mats['steel'],root)
    wire_loop('Cap tether folded loop',(27.3,44,37.2),1,mats['steel'],root)
    # Steel tether routed clear of the upper sight window.
    curve = bpy.data.curves.new('Cap tether wire', 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = .00028
    curve.bevel_resolution = 2
    spline = curve.splines.new('BEZIER')
    spline.bezier_points.add(3)
    for p,co in zip(spline.bezier_points, [(26.4,23,40.3),(28,30,45),(28,40,43),(28.3,44,37.2)]):
        p.co = tuple(v*MM for v in co)
        p.handle_left_type = p.handle_right_type = 'AUTO'
    tether = bpy.data.objects.new('Battery cap captive tether', curve)
    bpy.context.collection.objects.link(tether)
    tether.parent = root
    curve.materials.append(mats['steel'])
    bpy.context.view_layer.update()
    sleeves = []
    for index,start,end in [(0,.1,.35),(2,.5,.95)]:
        a,b = spline.bezier_points[index:index+2]
        def point(t):
            return ((1-t)**3*a.co+3*(1-t)**2*t*a.handle_right+
                    3*(1-t)*t*t*b.handle_left+t**3*b.co).copy()
        sleeves.append((point(start),point(end)))
    active(tether)
    bpy.ops.object.convert(target='MESH')
    finish(bpy.context.object, 0)
    for i,(a,b) in enumerate(sleeves):
        sleeve = cylinder('Tether crimp sleeve '+str(i),(a+b)/(2*MM),.7,(b-a).length/MM,
                          mats['steel'],root,'Z',16,.08)
        sleeve.rotation_euler = (b-a).to_track_quat('Z','Y').to_euler()
        active(sleeve)
        bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    # Raised quick-detach mount with real open rail channel and clamp shoulders.
    deck = [(-22.5,1.7),(-22.5,6.7),(22.5,6.7),(22.5,1.7),(10.6,1.7),
            (9,4.2),(8,4.8),(-8,4.8),(-9,4.2),(-10.6,1.7)]
    prism('7mm raised mount deck with open channel',deck,-34,33,mats['mount'],root,'Y',.3)
    for sign in (-1,1):
        jaw = [(sign*x,z) for x,z in [(10.6,1.7),(10.6,-1.8),(12.4,-4.5),(15,-5.5),
                                     (22,-5.5),(22,3.5)]]
        prism('Picatinny clamp jaw '+str(sign), jaw, -34, 33, mats['mount'], root, 'Y', .25)
    lever = [(-34,-1.5),(-34,2.5),(-31,4.5),(17,4.5),(25,3),(28,1.5),
             (28,-1.5),(23,-2.5),(-30,-2.5)]
    prism('QD closed contoured lever',lever,-29.2,-25,mats['mount'],root,bevel=.65)
    cylinder('QD lever pivot', (-27.2,25,1), 4.2, 3.2, mats['mount'], root)
    box('QD locking catch', (-27.7,20,4.5), (2.5,9,4), mats['body'], root, .5)
    oval = [(13+y,z) for y,z in rounded_rect(31,9,4.2)]
    pad = prism('QD oval tension pad',oval,22.25,23.05,mats['mount'],root,bevel=.12)
    inset = [(13+y,z) for y,z in rounded_rect(28.6,7.3,3.4)]
    subtract(prism('QD oval inset cutter',inset,22.4,23.5,mats['mount'],root,bevel=0),pad)
    cylinder('Crossbolt adjustment washer', (23,13,0), 5, 1.3, mats['steel'], root)
    nut = cylinder('QD slotted tension nut', (24,13,0), 4.3, 2, mats['edge'], root)
    subtract(box('Tension nut tool slot cutter',(25,13,0),(1,8.2,.8),mats['edge'],root,0),nut)
    subtract(cylinder('Crossbolt bore cutter',(24.7,13,0),1.8,1.6,mats['edge'],root,bevel=0),nut)
    surface_normals(cylinder('Crossbolt recessed floor',(23.915,13,0),1.78,.02,mats['ink'],root,bevel=0))
    # Left side brightness buttons, NV button, and recessed rubber surround.
    box('Brightness button surround', (-26.3,-21,16), (1.2,25,13), mats['body'], root, 1.8)
    for name,y,sign in [('Brightness down',-14.5,-1),('Brightness up',-27,1)]:
        box(name+' socket', (-27.0,y,16), (.6,10,8.9), mats['ink'], root, .7)
        box(name+' rubber key', (-27.5,y,16), (.8,8,7), mats['rubber'], root, .65)
        arrow = [(y+a,16+sign*b) for a,b in [(-.65,-2.4),(.65,-2.4),(.65,-.3),
                 (2.4,-.3),(0,2.5),(-2.4,-.3),(-.65,-.3)]]
        prism(name+' moulded arrow', arrow, -28.08,-27.95, mats['body'], root, bevel=.08)
    cylinder('NV recessed collar', (-26.1,-25,32), 5.8, .6, mats['body'], root)
    cylinder('NV rubber key', (-26.6,-25,32), 3.9, .8, mats['rubber'], root)
    text('NV moulded legend', 'NV', (-27.05,-25,32), 2.5, mats['body'], root)
    for y in (1,26.8):
        screw('Left shroud Torx '+str(y), (-26.1,y,12.4), mats, root, sign=-1)
    # Right-side inset windage and elevation adjusters, markings and index dots.
    for name,y,z in [('DOWN',-9,30),('RIGHT',20,21)]:
        subtract(cylinder(name+' hood opening cutter',(24.5,y,z),11,8,mats['hood'],root,bevel=0),
                 hood,housing,battery_housing)
        ring_x(name+' recessed well wall',y,z,10.95,10.5,20.7,26,mats['body'],root,True)
        cylinder(name+' well floor',(20.8,y,z),10.5,.2,mats['body'],root,bevel=0)
        # Convex moulded annulus, not a stack of flat applied discs.
        profile = [(10.2,21.2),(10.2,21.9),(9.5,22.6),(7.5,23.6),(5.75,23.8),(5.75,21.2)]
        vertices = [(px,y+r*math.cos(i*math.tau/48),z+r*math.sin(i*math.tau/48))
                    for r,px in profile for i in range(48)]
        faces = [(k*48+i,k*48+(i+1)%48,((k+1)%len(profile))*48+(i+1)%48,
                  ((k+1)%len(profile))*48+i) for k in range(len(profile)) for i in range(48)]
        surface_normals(finish(mesh(name+' domed recessed dial',vertices,faces,mats['rubber'],root),0))
        centre = cylinder(name+' centre',(23.25,y,z),5.6,.7,mats['steel'],root)
        subtract(box(name+' tool groove cutter',(23.65,y,z),(1.1,9.9,1.1),mats['steel'],root,0),centre)
        box(name+' recessed slot floor',(23.115,y,z),(.02,9.8,1),mats['ink'],root,0)
        for i in range(8):
            a = i*math.tau/8
            cylinder(name+' moulded index '+str(i),(adjuster_x(6.5)+.02,y+6.5*math.cos(a),z+6.5*math.sin(a)),
                     .3,.08,mats['rubber'],root,sides=8,bevel=0)
        for i in range(20):
            a = i*math.tau/20
            dot = cylinder(name+' index '+str(i),(26.35,y+12.2*math.cos(a),z+12.2*math.sin(a)),
                           .19,.04,mats['paint'],root,sides=8,bevel=0)
            hood_print(dot,26.35)
        hood_print(text(name+' rotation direction',name,(26.6,y-7.8,z+10),2.3,
                        mats['paint'],root,'right',.8),26.6)
        for i,char in enumerate(name):
            a = math.radians(145-i*15)
            letter = text(name+' moulded '+str(i),char,(0,y+7.9*math.cos(a),z+7.9*math.sin(a)),
                          2.0,mats['rubber'],root,'right',a-math.pi/2,relief=.08)
            transform = letter.matrix_basis
            inverse = transform.inverted()
            for vertex in letter.data.vertices:
                p = transform @ vertex.co
                p.x += (adjuster_x(math.hypot(p.y/MM-y,p.z/MM-z))+.02)*MM
                vertex.co = inverse @ p
            letter.data.update()
        # Prominent curved moulded arrow, separate from the white hood print.
        arc = []
        for radius,angles in [(7.55,np.linspace(170,232,9)),(7.05,np.linspace(232,170,9))]:
            arc += [(y+radius*math.cos(math.radians(a)),z+radius*math.sin(math.radians(a)))
                    for a in angles]
        arrow_obj = prism(name+' moulded curved arrow',arc,0,.12,mats['rubber'],root,bevel=0)
        tip = [(y-8.1,z+1.1),(y-7,z+2.7),(y-6.3,z+1.2)]
        arrow_tip = prism(name+' moulded curved arrow tip',tip,0,.12,mats['rubber'],root,bevel=0)
        # Conform the head interior too: a corner-only triangle cuts into the dome.
        bm = bmesh.new()
        bm.from_mesh(arrow_tip.data)
        bmesh.ops.subdivide_edges(bm,edges=list(bm.edges),cuts=3,use_grid_fill=True)
        bm.to_mesh(arrow_tip.data)
        bm.free()
        for obj in (arrow_obj,arrow_tip):
            for vertex in obj.data.vertices:
                vertex.co.x += (adjuster_x(math.hypot(vertex.co.y/MM-y,vertex.co.z/MM-z))-.02)*MM
            obj.data.update()
            surface_normals(obj)
        arrow = [(y+a,z+b) for a,b in [(-13.6,-1),(-13.9,3),(-15,2.2),
                 (-13.8,5.5),(-12,2.7),(-13,3.0),(-12.7,-1)]]
        hood_print(prism(name+' white rotation arrow',arrow,26.4,26.44,mats['paint'],root,bevel=0),26.4)
    screw('Right rear shroud Torx', (26.1,-28,12), mats, root)
    for x in (-15.3,15.3):
        for z in (2,28):
            cutter = cylinder('Rear fastener counterbore',(x,-34.5,z),2.9,3,
                              mats['body'],root,'Y',32,0)
            subtract(cutter,cover,bosses[x] if z == 2 else housing)
            screw('Rear cover Torx '+str(x)+' '+str(z),(x,-34.8 if z == 2 else -33.9,z),
                  mats,root,'Y',-1)
    # Shallow cast relief intersects its backing; no floating badge/shadow gap.
    wordmark = text('Rear cast brand','EOTECH',(0,-34.995,17.7),2.4,mats['body'],root,'rear',relief=.1)
    wordmark.scale.x = 1.25
    brand_icon('Rear cast mark',(0,-34.97,23),mats['body'],root,'rear',depth=.15)
    # Reconstructed vector marks, never sampled from third-party photographs.
    for side,sign in [('left',-1),('right',1)]:
        text('Hood brand '+side, 'EOTECH', (sign*23.89,-2.5,47.6), 2.8, mats['paint'], root, side)
        brand_icon('Printed mark '+side,(sign*23.84,-2.5,54),mats['paint'],root,side)
    box('Warning label black border', (-26.12,-2.5,32.5), (.15,23.2,10), mats['ink'], root, .3)
    box('Warning label yellow field', (-26.23,-2.5,32.5), (.08,22,8.8), mats['yellow'], root, .15)
    for i,line in enumerate(['CLASS 1 LASER PRODUCT','Laser product complies with',
                             '21 CFR, Part 1040.10,','1040.11 and','IEC 60825-1:2014']):
        text('Laser warning line '+str(i), line, (-26.55,-5.0,35.4-i*1.35), .95, mats['ink'], root)
    prism('Laser warning triangle', [(2.3,29.4),(8.1,29.4),(5.2,35.6)], -26.58,-26.56, mats['ink'], root, bevel=0)
    prism('Laser warning triangle inset', [(3.0,29.8),(7.4,29.8),(5.2,34.7)], -26.62,-26.60, mats['yellow'], root, bevel=0)
    cylinder('Laser warning sunburst centre', (-26.66,5.2,31.5), .45,.02, mats['ink'], root, sides=12, bevel=0)
    for i in range(12):
        a = i*math.tau/12
        stripe = [(5.2+r*math.cos(a+d),31.5+r*math.sin(a+d))
                  for r,d in [(0.7,-.04),(1.5,-.04),(1.5,.04),(0.7,.04)]]
        prism('Laser warning ray '+str(i), stripe, -26.68,-26.66, mats['ink'], root, bevel=0)
    return root


def studio(quick):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.eevee.taa_render_samples = 32 if quick else 96
    scene.eevee.use_raytracing = True
    scene.render.film_transparent = True
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = -1.5
    scene.world = bpy.data.worlds.new('Studio world')
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (.35,.39,.46,1)
    bg.inputs[1].default_value = .45
    for name,loc,power,size,color in [('Key',(-.18,.07,.24),12,.22,(.91,.95,1)),
                                      ('Strip',(.12,-.04,.2),9,.16,(1,.93,.83)),
                                      ('Front',(.06,.23,.06),4,.18,(.8,.89,1))]:
        light = bpy.data.lights.new(name,'AREA')
        light.energy, light.shape, light.size, light.color = power,'DISK',size,color
        obj = bpy.data.objects.new(name,light)
        scene.collection.objects.link(obj)
        obj.location = loc
        obj.rotation_euler = (Vector((0,0,.03))-obj.location).to_track_quat('-Z','Y').to_euler()
    views = {}
    configs = [
        ('left',(-.4,.01085,.03086),(0,.01085,.03086),.1293,1600,1200),
        ('right',(.4,.0121,.0307),(0,.0121,.0307),.1205,1600,1200),
        ('rear',(0,-.4,.031),(0,0,.031),.126,1600,1200),
        ('front',(0,.4,.0314),(0,0,.0314),.11945,700,700),
        ('top',(0,.0132,.4),(0,.0132,0),.1284,700,700),
        ('hero',(-.16,.19,.13),(0,.01,.031),.139,1400,1100),
        ('rear-quarter',(.17,-.20,.13),(0,.01,.031),.139,1400,1100),
    ]
    for name,loc,target,scale,w,h in configs:
        cam = bpy.data.cameras.new('CAM_'+name)
        obj = bpy.data.objects.new('CAM_'+name,cam)
        scene.collection.objects.link(obj)
        obj.location = loc
        obj.rotation_euler = (Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
        if name == 'top':
            obj.rotation_euler = Matrix(((0,-1,0),(1,0,0),(0,0,1))).to_euler()
        cam.type,cam.ortho_scale,cam.clip_start = 'ORTHO',scale,.001
        views[name] = (obj,w,h)
    scene.camera = views['hero'][0]
    scene.render.resolution_x,scene.render.resolution_y = views['hero'][1:]
    return views


def export(output, root):
    # Save the editable separate parts first; only export copies are consolidated.
    objects = [o for o in root.children_recursive if o.type == 'MESH']
    groups = {}
    for obj in objects:
        groups.setdefault(obj.data.materials[0].name, []).append(obj)
    for name,group in groups.items():
        if name.startswith('10 |'):
            continue  # front/rear glass must remain individually identifiable
        active(group[0])
        for obj in group:
            obj.select_set(True)
        bpy.ops.object.join()
        bpy.context.object.name = 'exps3_'+name.split(' | ')[1].replace(' ','_')
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for obj in root.children_recursive:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(output/'exps3-0.glb'), export_format='GLB',
        use_selection=True, export_yup=True, export_extras=True, export_animations=False,
        export_cameras=False, export_lights=False)
    data = (output/'exps3-0.glb').read_bytes()
    n = struct.unpack_from('<I',data,12)[0]
    doc = json.loads(data[20:20+n])
    prims = [p for m in doc['meshes'] for p in m['primitives']]
    stats = {'triangles':sum(doc['accessors'][p['indices']]['count']//3 for p in prims),
             'primitives':len(prims),'materials':len(doc['materials']),
             'bytes':len(data),'images':len(doc.get('images',[]))}
    assert stats['triangles'] < 45000 and stats['primitives'] <= 14 and stats['materials'] <= 10, stats
    assert stats['images'] == 2 and stats['bytes'] < 5*1024*1024, stats
    manifest = {'asset':'EOTECH EXPS3-0 | reference-backed original Blender art',
        'source':'tools/blender/exps3.py','sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'blender':bpy.app.version_string,'units':'metres',
        'axes':{'right':'+X','up':'+Y','forward':'-Z'},'nominalEnvelopeMm':[58.4,73.7,96.5],
        'mountOrigin':'rail top centre; SOCKET_mount at [0,0,0]',
        'opticalDatum':f'provisional photo-derived {OPTICAL_Z}mm above the current rail datum; not manufacturer-certified',
        'opticalWindow':{'nominalPaneMm':list(PANE_MM),'clearOpeningMm':list(CLEAR_MM),
            'clearCornerRadiusMm':CORNER_MM,'centreAboveArtDatumMm':OPTICAL_Z,
            'carrierOuterMm':[39,30.4],'gasketOuterMm':[33,25],
            'batteryRoofMm':BATTERY_ROOF_Z,'axialLowerClearanceMm':.5,
            'status':'clear opening and centre inferred from registered photos; not an approved ADS/eye-box specification'},
        'reticle':{'ringMoa':68,'dotMoa':1,'geometryBaked':False},'stats':stats,
        'sha256':hashlib.sha256(data).hexdigest()}
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('EXPS3_EXPORT_COMPLETE',json.dumps(stats))


def build(output, render=False, quick=False):
    output.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    mats = finishes(output)
    root = build_geometry(mats)
    # Boolean lettering/socket cuts interpolate UVs; finish the authored UV lattice
    # before saving or rendering, not by rewriting any exported glTF buffers.
    for obj in root.children_recursive:
        if obj.type == 'MESH':
            for layer in obj.data.uv_layers:
                for loop in layer.data:
                    loop.uv = tuple(round(v*65536)/65536 for v in loop.uv)
    views = studio(quick)
    notes = bpy.data.texts.new('START HERE')
    notes.write('EXPS3-0 original visual reconstruction, not CAD or manufacturing data.\n'
                'Source: tools/blender/exps3.py. Native metres; rail-top mount origin.\n'
                'Editable parts and review cameras are saved before runtime consolidation.\n'
                'Photo/reference uncertainty and the provisional sight datum are in README.md.\n'
                'No runtime reticle, ADS integration or paid attachment system in this asset PR.\n')
    active(root)
    bpy.ops.wm.save_as_mainfile(filepath=str(output/'exps3-0.blend'))
    if render:
        (output/'renders').mkdir(exist_ok=True)
        for name,(camera,w,h) in views.items():
            scene = bpy.context.scene
            scene.camera = camera
            scene.render.resolution_x,scene.render.resolution_y = w,h
            scene.render.filepath = str(output/'renders'/f'{name}.png')
            bpy.ops.render.render(write_still=True)
    export(output,root)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=OUT)
    parser.add_argument('--render',action='store_true')
    parser.add_argument('--quick',action='store_true')
    argv = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    args = parser.parse_args(argv)
    build(args.output.resolve(),args.render,args.quick)
