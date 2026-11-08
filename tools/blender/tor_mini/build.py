"""Reference-backed Steiner TOR Mini game art, authored from factory-empty Blender.

blender -b -t 8 --python-exit-code 1 --python tools/blender/tor_mini/build.py -- \
    --output /tmp/tor-mini-review --render
Millimetres in recipe; native metres in Blender/glTF. X right, Y forward, Z up.
Mount faces up, body below mount, as in Steiner's reference photography.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'assets/attachments/steiner-tor-mini'
MM = .001
HIGH = False


def active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def material(name, color, metal, rough, grain=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = mat.use_backface_culling = True
    mat.diffuse_color = (*color, 1)
    n, l = mat.node_tree.nodes, mat.node_tree.links
    p = n.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if grain:
        noise = n.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 160
        noise.inputs['Detail'].default_value = 2
        coords = n.new('ShaderNodeTexCoord')
        l.new(coords.outputs['UV'], noise.inputs['Vector'])
        ramp = n.new('ShaderNodeMapRange')
        ramp.inputs['To Min'].default_value = rough - .09
        ramp.inputs['To Max'].default_value = rough + .09
        l.new(noise.outputs['Fac'], ramp.inputs['Value'])
        l.new(ramp.outputs[0], p.inputs['Roughness'])
        tone = n.new('ShaderNodeMapRange')
        tone.inputs['To Min'].default_value = .72
        tone.inputs['To Max'].default_value = 1.28
        l.new(noise.outputs['Fac'],tone.inputs['Value'])
        color_mix = n.new('ShaderNodeMixRGB')
        color_mix.blend_type = 'MULTIPLY'
        color_mix.inputs[0].default_value = 1
        color_mix.inputs[1].default_value = (*color,1)
        l.new(tone.outputs[0],color_mix.inputs[2])
        l.new(color_mix.outputs[0],p.inputs['Base Color'])
        bump = n.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = grain
        bump.inputs['Distance'].default_value = .00006
        l.new(noise.outputs['Fac'], bump.inputs['Height'])
        l.new(bump.outputs['Normal'], p.inputs['Normal'])
    return mat


def mesh(name, vertices, faces, mat, root):
    data = bpy.data.meshes.new(name)
    data.from_pydata([tuple(v * MM for v in p) for p in vertices], [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = root
    if mat:
        data.materials.append(mat)
    return obj


def finish(obj, bevel=.2, smooth=True):
    active(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    if bevel:
        mod = obj.modifiers.new('Manufactured edge radius', 'BEVEL')
        mod.width, mod.segments = bevel * MM, 3 if HIGH else 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
        mod = obj.modifiers.new('Weighted surface normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    uv = obj.data.uv_layers.new(name='FinishUV')
    for polygon in obj.data.polygons:
        axis = max(range(3),key=lambda i:abs(polygon.normal[i]))
        a,b = [(1,2),(0,2),(0,1)][axis]
        for index in polygon.loop_indices:
            p = obj.data.vertices[obj.data.loops[index].vertex_index].co
            uv.data[index].uv = (p[a]/.02,p[b]/.02)
    return obj


def box(name, pos, size, mat, root, bevel=.2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=tuple(v * MM for v in pos))
    obj = bpy.context.object
    obj.name, obj.parent = name, root
    obj.dimensions = tuple(v * MM for v in size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        obj.data.materials.append(mat)
    return finish(obj, bevel)


def cyl(name, pos, radius, depth, mat, root, axis='Z', bevel=.1, sides=48):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides if HIGH else min(sides, 32),
        radius=radius * MM, depth=depth * MM, location=tuple(v * MM for v in pos))
    obj = bpy.context.object
    obj.name, obj.parent = name, root
    obj.rotation_euler = {'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0), 'Z': (0, 0, 0)}[axis]
    active(obj)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if mat:
        obj.data.materials.append(mat)
    return finish(obj, bevel)


def prism(name, contour, low, high, mat, root, axis='X', bevel=.2):
    def point(u, a, b):
        return {'X': (u, a, b), 'Y': (a, u, b), 'Z': (a, b, u)}[axis]
    n = len(contour)
    verts = [point(u, a, b) for u in (low, high) for a, b in contour]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return finish(mesh(name, verts, faces, mat, root), bevel)


def cut(obj, cutter):
    active(obj)
    mod = obj.modifiers.new('Machined recess', 'BOOLEAN')
    mod.operation, mod.solver, mod.object = 'DIFFERENCE', 'EXACT', cutter
    bpy.ops.object.modifier_apply(modifier=mod.name)
    for i,mat in enumerate(obj.data.materials):
        if mat is None:
            obj.data.materials[i] = obj.data.materials[0]
    bpy.data.objects.remove(cutter, do_unlink=True)


def ring(name, pos, outer, inner, depth, mat, root, axis='Y'):
    # Real open aperture, not a dark disc pasted on a solid cylinder.
    sides = 64 if HIGH else 32
    verts = []
    for d, r in [(-depth / 2, outer), (depth / 2, outer),
                 (-depth / 2, inner), (depth / 2, inner)]:
        for i in range(sides):
            a = i * math.tau / sides
            p = (r * math.cos(a), d, r * math.sin(a))
            if axis == 'Z':
                p = (p[0], p[2], p[1])
            verts.append(tuple(x + y for x, y in zip(pos, p)))
    faces = []
    for i in range(sides):
        j = (i + 1) % sides
        faces.extend([(i, j, sides + j, sides + i),
            (2 * sides + j, 2 * sides + i, 3 * sides + i, 3 * sides + j),
            (j, i, 2 * sides + i, 2 * sides + j),
            (sides + i, sides + j, 3 * sides + j, 3 * sides + i)])
    return finish(mesh(name, verts, faces, mat, root), .07)


def rounded(y0, y1, z0, z1, r, steps=5):
    return [(y + r * math.cos(a + i * math.pi / 2 / steps),
             z + r * math.sin(a + i * math.pi / 2 / steps))
        for y, z, a in [(y1-r,z1-r,0),(y0+r,z1-r,math.pi/2),
                        (y0+r,z0+r,math.pi),(y1-r,z0+r,3*math.pi/2)]
        for i in range(steps + 1)]


def mark(name, value, pos, size, mat, root, receiver, side):
    if not HIGH:
        return
    data = bpy.data.curves.new(name, 'FONT')
    data.body, data.size = value, size * MM
    data.align_x, data.align_y, data.resolution_u = 'CENTER', 'CENTER', 3
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location, obj.parent = tuple(v * MM for v in pos), root
    # Left side reads forward->rear; opposite side reads rear->forward.
    obj.rotation_euler = Matrix(((0,0,side),(side,0,0),(0,1,0))).to_euler()
    if value == 'STEINER':
        data.offset = .04 * MM
        obj.scale.x = .66
    active(obj)
    bpy.ops.object.convert(target='MESH')
    obj['receiver'] = receiver
    obj.data.materials.append(mat)


def diamond_clip(poly, bounds):
    # Clip the relief diamonds to the pressure-pad outline, never outside it.
    for a, b in zip(bounds, bounds[1:] + bounds[:1]):
        def inside(p):
            return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]) >= -1e-7
        def intersect(p, q):
            d, e = (q[0]-p[0],q[1]-p[1]), (b[0]-a[0],b[1]-a[1])
            den = d[0]*e[1]-d[1]*e[0]
            t = ((a[0]-p[0])*e[1]-(a[1]-p[1])*e[0])/den
            return (p[0]+t*d[0],p[1]+t*d[1])
        result = []
        for p, q in zip(poly, poly[1:] + poly[:1]):
            if inside(p):
                result.append(p)
            if inside(p) != inside(q):
                result.append(intersect(p,q))
        poly = result
        if not poly:
            break
    # Native clipping can repeat a tangent corner; do not author zero-area tiles.
    poly = [p for i,p in enumerate(poly) if math.dist(p,poly[i-1]) > 1e-6]
    return [p for i,p in enumerate(poly) if abs((p[0]-poly[i-1][0])*
        (poly[(i+1)%len(poly)][1]-p[1])-(p[1]-poly[i-1][1])*
        (poly[(i+1)%len(poly)][0]-p[0])) > 1e-7]


def geometry(mats):
    root = bpy.data.objects.new('ATTACHMENT_tor_mini', None)
    bpy.context.collection.objects.link(root)
    root['subject'] = 'Steiner TOR Mini green 7003 | reference-backed game art'
    root['mountInterface'] = 'Picatinny/Weaver clamp; provisional art fit'
    root['orientation'] = 'Mount up; body below rail, +Y forward in Blender'
    body = mats['body']
    # Side silhouette is registered to the two manufacturer side photographs.
    profile = [(-13,-23.3),(-8.8,-23.3),(-8.8,-18.1),(8,-18.1),
        (10,-18),(11.2,-17.7),(12,-16.6),(12.6,-15.7),(13.5,-15.1),
        (24.4,-15.1),(24.4,-6.7),(-8.9,-6.7),(-13,-8)]
    housing = prism('Machined aluminum housing', profile, -12.3, 12.3, body, root, bevel=.55)
    # Aperture recess intersects the housing; the sight is not an emissive fake lens.
    cut(housing, cyl('CUT optical bore', (0,24,-10.5), 2.45, 4, None, root, 'Y', 0))
    for side in (1,):
        cut(housing, cyl('CUT windage bore', (side*12.3,8.1,-10.1), 1.8, 1.6,
            None, root, 'X', 0, 32))
        cyl('Windage seat '+str(side), (side*11.9,8.1,-10.1), 1.64, .24,
            mats['dark'], root, 'X', .02, 32)
        head = cyl('Windage screw '+str(side), (side*12.05,8.1,-10.1), 1.25, .25,
            mats['steel'], root, 'X', .03, 32)
        cut(head, cyl('CUT hex socket', (side*12.2,8.1,-10.1), .73, .5,
            None, root, 'X', 0, 6))
    # The upper face is a recessed open rail channel, not an added Picatinny rail.
    base = prism('Mount channel floor',[(-9.5,-4.8),(26.3,-4.8),(26.3,-.15),
        (-.3,-.15),(-7.8,-4.0),(-9.5,-4.0)],-12.3,12.3,mats['mount'],root,bevel=.2)
    cut(base, box('CUT locking-key pocket', (0,7,-.2), (6,13,1.8), None, root, .8))
    box('Sliding rail key', (0,7,-.55), (5.3,4.2,1.4), mats['mount'], root, .3)
    for side in (-1,1):
        # Six small rail-bar indexing bores on the inner wall are visible in front-quarter photos.
        jaw_profile = [(-7.8,-6.7),(24.4,-6.7),(24.4,-.5),(26.6,1.8),
            (26.6,3.8 if side == 1 else 6.35),(24.4,6.35),(.4,6.35),(-7.8,-2.2)]
        jaw = prism('Fixed rail jaw' if side == 1 else 'Captive clamp bar', jaw_profile,
            10.2 if side == 1 else -14.7,14.7 if side == 1 else -10.2,
            mats['mount'], root, bevel=.15)
        for i in range(6):
            cut(jaw, cyl('CUT indexing bore', (side*10.4,-.2+i*4.3,4.0), .72, 3.6,
                None, root, 'X', 0, 24))
        # Inward-facing 45-degree rail purchase. Fit datum remains art-inferred.
        prism('Rail purchase '+str(side), [(side*10.2,.9),(side*8.7,2.4),
            (side*10.2,3.9)], .8,23.8,mats['mount'],root,'Y',.06)
    for y in (-2.7,17):
        washer = cyl('Captive screw washer '+str(y), (-14.95,y,-2), 3.0, .36,
            mats['steel'], root, 'X', .08)
        head = cyl('Slotted captive screw '+str(y), (-15.6,y,-2), 2.8, 1.1,
            mats['silver'], root, 'X', .15)
        cut(head, box('CUT screwdriver slot', (-16.1,y,-2), (1,6,.62), None, root, .04))
        # Exposed pads in the rail bed, visible in the reference front/rear quarters.
        prism('Rail bed polished pad '+str(y),rounded(-3.45,3.45,y-3.2,y+3.2,.7),
            -.12,.18,mats['silver'],root,'Z',.04)
    # Rear boot: gently tapered rounded sections preserve its sculpted silhouette.
    sections = [(-26.6,10.3,-13.5,7.9),(-25.8,13.5,-13.3,9.0),
        (-23.5,15.8,-13.0,10.0),(-18,16.35,-12.9,10.6),
        (-12.1,14.0,-12.6,11.2),(-10.9,12.6,-12.6,10.9)]
    n = 32 if HIGH else 24
    verts = []
    for y, width, centre, height in sections:
        for i in range(n):
            a = i * math.tau / n
            # Superellipse: broad flat sides with rounded moulded transitions.
            c, s = math.cos(a), math.sin(a)
            verts.append((width*math.copysign(abs(c)**.42,c),y,
                          centre+height*math.copysign(abs(s)**.42,s)))
    faces = [tuple(reversed(range(n))),tuple((len(sections)-1)*n+i for i in range(n))]
    faces += [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)
              for j in range(len(sections)-1) for i in range(n)]
    boot = finish(mesh('Moulded rear boot',verts,faces,mats['rubber'],root),0)
    cut(boot,box('CUT rear U-shaped relief',(0,-25,-8.5),(14.8,15.5,20),
        None,root,2.0))
    active(boot)
    lip = boot.modifiers.new('Soft moulded relief lip','BEVEL')
    lip.width,lip.segments = .35*MM,3 if HIGH else 2
    bpy.ops.object.modifier_apply(modifier=lip.name)
    for side in (-1,1):
        # Raised perimeter and deep diamond-pattern pressure pads, on both sides.
        contour = rounded(-26,-13,-22.2,-4.9,2.4,6 if HIGH else 3)
        rim = prism('Pressure pad rim '+str(side), contour,
            side*15.0, side*16.0, mats['rubber'],root,bevel=.35)
        pad_contour = rounded(-25.4,-13.7,-21.5,-5.6,1.8,6)
        pad = prism('Pressure pad '+str(side), pad_contour,
            side*15.8, side*16.18,mats['rubber_dark'],root,bevel=.12)
        # Keep the pressure-pad relief in the target too: it is a close-up
        # silhouette feature. Bake each corresponding tile in isolation to avoid
        # projection across the intersecting base and diamond sidewalls.
        for j in range(-5,6):
            for k in range(-5,6):
                y,z = -19.5+j*3.8+(k%2)*1.9,-13.6+k*1.9
                diamond = [(y-1.65,z),(y,z-1.65),(y+1.65,z),(y,z+1.65)]
                clipped = diamond_clip(diamond,pad_contour)
                area = abs(sum(a[0]*b[1]-b[0]*a[1]
                    for a,b in zip(clipped,clipped[1:]+clipped[:1])))/2
                if len(clipped) >= 3 and area > .02:
                    prism(f'Pressure pad diamond {side} {j} {k}',clipped,side*16.1,side*16.42,
                        mats['rubber'],root,bevel=.09 if HIGH else 0)
        # A narrow tooling seam around the boot's forward face.
        seam = rounded(-11.4,-10.9,-22.9,-2.2,.24,2)
        prism('Boot parting seam '+str(side),seam,side*12.7,side*13.0,
            mats['rubber_dark'],root,bevel=.08)
    # Recessed rear connector-free cover: there is no remote pressure-switch cable.
    rear = prism('Rear bridge inset',rounded(-7.1,7.1,-18.5,-7.8,1.7),
        -17.8,-17.5,mats['rubber_dark'],root,'Y',.1)
    for x in (-5.6,5.6):
        cyl('Rear cover screw '+str(x),(x,-17.95,-15.5),.75,.18,mats['steel'],root,'Y',.04,24)
    # Bottom 1/3N battery cap: scalloped rim, collar and sealing line.
    cyl('Battery collar',(0,.1,-18.4),6.2,.65,mats['dark'],root,bevel=.1)
    cap = cyl('Scalloped battery cap',(0,.1,-21.35),5.9,5.3,mats['cap'],root,bevel=.2, sides=64)
    for i in range(12):
        a = i * math.tau / 12
        cut(cap,cyl('CUT cap scallop',(6.45*math.cos(a),.1+6.45*math.sin(a),-21.35),
            .9,4.9,None,root,bevel=.16,sides=24))
    if HIGH:
        cut(cap,box('CUT battery coin slot',(0,.1,-23.94),(1,7,.55),None,root,.12))
    ring('Laser aperture bezel',(0,24.68,-10.5),4.1,2.35,.95,body,root)
    ring('Aperture inner retaining ring',(0,24.77,-10.5),2.35,1.78,.24,mats['steel'],root)
    cyl('Recessed laser window',(0,24.1,-10.5),1.8,.15,mats['lens'],root,'Y',.03,64)
    # Printed brand and battery polarity, rebuilt as vectors and baked to the atlas.
    for side in (-1,1):
        receiver = 'Machined aluminum housing'
        mark('STEINER wordmark '+str(side),'STEINER',(side*12.34,2.1 if side == -1 else -2,-15.5),4.45,
            mats['print'],root,receiver,side)
        if HIGH:
            # White square/negative inverted triangle, separate from the wordmark.
            # Keep logo in the continuous flat housing area on both faces.
            y = -6.4 if side == -1 else 6.1
            icon = prism('Brand square '+str(side),[(y-2.1,-17.1),(y+2.1,-17.1),
                (y+2.1,-13.9),(y-2.1,-13.9)],side*12.34,side*12.35,mats['print'],root,bevel=0)
            icon['receiver'] = receiver
            tri = prism('Brand negative triangle '+str(side),[(y-1.95,-14.25),
                (y+1.95,-14.25),(y,-16.7)],side*12.36,side*12.37,body,root,bevel=0)
            tri['receiver'] = receiver
        if side == 1:
            continue
        mark('Battery polarity '+str(side),'+',(side*12.34,-9.9,-21.9),1.7,
            mats['print'],root,receiver,side)
        mark('Battery negative '+str(side),'-',(side*12.34,-9.9,-20.0),1.7,
            mats['print'],root,receiver,side)
        if HIGH:
            for y,z,dy,dz in [(-10.65,-21,.14,3.6),(-9.15,-21,.14,3.6),
                              (-9.9,-22.8,1.5,.14),(-9.9,-19.2,1.5,.14)]:
                line = prism('Battery outline',[(y-dy/2,z-dz/2),(y+dy/2,z-dz/2),
                    (y+dy/2,z+dz/2),(y-dy/2,z+dz/2)],side*12.34,side*12.35,
                    mats['print'],root,bevel=0)
                line['receiver'] = receiver
    # Resolve normals after all Boolean operations. Broad machined planes stay
    # truly flat; smoothing a perforated n-gon makes false triangular dents.
    for obj in root.children_recursive:
        if obj.type != 'MESH':
            continue
        for poly in obj.data.polygons:
            if (poly.area > .00001 or obj.name.startswith('Pressure pad diamond')) and max(abs(v) for v in poly.normal) > .999:
                poly.use_smooth = False
        active(obj)
        mod = obj.modifiers.new('Final post-machining normals','WEIGHTED_NORMAL')
        mod.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for name, pos in [('SOCKET_mount',(0,0,0)),('SOCKET_laser',(0,25.18,-10.5))]:
        socket = bpy.data.objects.new(name,None)
        bpy.context.collection.objects.link(socket)
        socket.parent, socket.location = root,tuple(v*MM for v in pos)
        socket.empty_display_size = .003
    return root


def studio(quick):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 24 if quick else 96
    scene.cycles.use_denoising = True
    scene.cycles.seed = 7003
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = -3.5
    world = bpy.data.worlds.new('Neutral studio')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (.3,.34,.4,1)
    world.node_tree.nodes['Background'].inputs[1].default_value = .35
    scene.world = world
    for name,pos,power,size,color in [('Key',(-.09,.06,.13),4,.11,(.92,.96,1)),
        ('Rim',(.08,-.05,.04),3,.08,(1,.91,.8)),('Front',(-.02,.12,-.04),1.8,.09,(.85,.92,1)),
        ('Low strip',(-.09,-.03,-.08),1.2,.06,(1,1,1))]:
        light = bpy.data.lights.new(name,'AREA')
        light.energy,light.shape,light.size,light.color = power,'DISK',size,color
        obj = bpy.data.objects.new(name,light)
        scene.collection.objects.link(obj)
        obj.location = pos
        obj.rotation_euler = (Vector((0,0,-.008))-obj.location).to_track_quat('-Z','Y').to_euler()
    views = {}
    for name,pos,scale in [('hero',(-.09,.12,.085),.086),('rear-quarter',(-.09,-.11,.065),.086),
        ('left',(-.3,0,-.008),.069),('right',(.3,0,-.008),.069),
        ('front',(0,.3,-.008),.052),('rear',(0,-.3,-.008),.052),
        ('top',(0,0,.3),.070),('bottom',(0,0,-.3),.070)]:
        camera = bpy.data.cameras.new('CAM_'+name)
        obj = bpy.data.objects.new('CAM_'+name,camera)
        scene.collection.objects.link(obj)
        obj.location = pos
        obj.rotation_euler = (Vector((0,0,-.008))-obj.location).to_track_quat('-Z','Y').to_euler()
        camera.type,camera.ortho_scale,camera.clip_start = 'ORTHO',scale,.001
        views[name] = obj
    scene.camera = views['hero']
    scene.render.resolution_x,scene.render.resolution_y = (1000,1000) if quick else (1600,1600)
    return views


def export(output,root,report):
    active(root)
    for obj in root.children_recursive:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(output/'tor-mini.glb'),export_format='GLB',
        use_selection=True,export_yup=True,export_extras=True,export_animations=False,
        export_cameras=False,export_lights=False,export_tangents=True)
    data = (output/'tor-mini.glb').read_bytes()
    n = struct.unpack_from('<I',data,12)[0]
    doc = json.loads(data[20:20+n])
    prims = [p for m in doc['meshes'] for p in m['primitives']]
    stats = {'triangles':sum(doc['accessors'][p['indices']]['count']//3 for p in prims),
        'primitives':len(prims),'materials':len(doc['materials']),'images':len(doc.get('images',[])),
        'bytes':len(data)}
    assert stats['triangles'] <= 12000 and stats['primitives'] == 1,stats
    assert stats['materials'] == 1 and stats['images'] == 3,stats
    manifest = {'asset':'Steiner TOR Mini green 7003 | original reference-backed art',
        'source':'tools/blender/tor_mini/build.py','blender':bpy.app.version_string,
        'sourceSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'bakeSourceSha256':hashlib.sha256(Path(__file__).with_name('bake.py').read_bytes()).hexdigest(),
        'units':'metres','axes':{'right':'+X','up':'+Y','forward':'-Z'},
        'nominalEnvelopeMm':{'length':53.34,'width':33.02,'height':30.48},
        'mount':'SOCKET_mount at channel-bed origin; mount up, body below rail; art-inferred fit',
        'laser':{'socket':'SOCKET_laser','direction':[0,0,-1],
            'position':[0,-.0105,-.02518],'wavelengthNm':520,'beamGeometry':False},
        'optimization':report,'stats':stats,'sha256':hashlib.sha256(data).hexdigest()}
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('TOR_MINI_EXPORT',json.dumps(stats),flush=True)


def build(output,render=False,quick=False):
    global HIGH
    sys.path.insert(0,str(Path(__file__).parent))
    from bake import bake_asset, hide_source
    output = output.resolve()
    output.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    mats = {
        'body':material('Hard-anodized machined aluminum',(.025,.029,.033),.8,.53,.3),
        'mount':material('Type III anodized clamp',(.017,.021,.024),.9,.55,.25),
        'cap':material('Battery-cap hardcoat',(.025,.029,.033),.65,.65,.3),
        'rubber':material('Moulded pressure-pad rubber',(.024,.027,.029),0,.72,.5),
        'rubber_dark':material('Recessed rubber grooves',(.009,.011,.012),0,.79,.3),
        'steel':material('Blackened adjuster steel',(.067,.072,.074),1,.35),
        'silver':material('Satin captive-screw steel',(.42,.44,.43),1,.32,.1),
        'dark':material('Dark seals and bore interiors',(.005,.007,.008),0,.68),
        'print':material('Off-white pad printing',(.74,.77,.74),0,.57),
        'lens':material('Recessed coated laser window',(.008,.018,.015),.55,.14),
    }
    HIGH = True
    source = geometry(mats)
    hide_source(source)
    HIGH = False
    root = geometry(mats)
    report = bake_asset(output,root,source)
    views = studio(quick)
    notes = bpy.data.texts.new('START HERE')
    notes.write('Original reference-backed TOR Mini game art; not manufacturer CAD.\n'
        'SOURCE_HIGH retains detailed individual parts; TOR_MINI_body is the one-material target.\n'
        'Mount up; native Blender +Y forward, +Z up, body below rail. Export -Z forward/+Y up.\n'
        'SOCKET_mount and SOCKET_laser are provisional art datums, not certified mounting/zero data.\n'
        'No beam, light, weapon fit, gameplay, laser-zero or final human visual acceptance.\n'
        'Rebuild from tools/blender/tor_mini/build.py. References and limitations beside asset.\n')
    active(root)
    bpy.ops.wm.save_as_mainfile(filepath=str(output/'tor-mini.blend'))
    if render:
        (output/'renders').mkdir(exist_ok=True)
        for name,camera in views.items():
            bpy.context.scene.camera = camera
            bpy.context.scene.render.filepath = str(output/'renders'/f'{name}.png')
            bpy.ops.render.render(write_still=True)
    export(output,root,report)
    from check import check
    check()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=OUT)
    parser.add_argument('--render',action='store_true')
    parser.add_argument('--quick',action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    build(args.output,args.render,args.quick)
