"""Shared suppressor-can authoring: scene, materials, lathed shells, bore gauge and export.

Native metres. Blender +Y bore / +Z up exports glTF -Z forward / +Y up; the runtime
mount datum is the origin and `SOCKET_muzzle` is the endcap exit. Bore gauges verify
the authored exterior/endcap/mount only, not internal baffle engineering.
"""
import argparse
import json
import math
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[2]


def begin(name, output):
    """Empty metric scene holding the can root; returns (root, product directory).
    `-- --output DIR` redirects products for review builds."""
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT/output)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    return root, out


def material(name, color, roughness, metallic=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    return mat


def lathe(name, section, mat, root, sides=96, smooth=None):
    """Revolve a closed (y, radius) section about +Y, keeping a real open bore.
    `smooth` lists the shaded section segments (default: all but the closing one)."""
    count = len(section)
    vertices = [(math.cos(i*math.tau/sides)*radius, y, math.sin(i*math.tau/sides)*radius)
                for y, radius in section for i in range(sides)]
    faces = [(j*sides+i, j*sides+(i+1)%sides,
              ((j+1)%count)*sides+(i+1)%sides, ((j+1)%count)*sides+i)
             for j in range(count) for i in range(sides)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], [tuple(reversed(face)) for face in faces])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = root
    mesh.materials.append(mat)
    shaded = range(count-1) if smooth is None else smooth
    for polygon in mesh.polygons:
        polygon.use_smooth = polygon.index//sides in shaded
    return obj


def ring(name, count, radius, y, dims, mat, root):
    """`count` radial blocks of `dims` around the bore at forward distance `y`."""
    for i in range(count):
        angle = i*math.tau/count
        bpy.ops.mesh.primitive_cube_add(size=1, location=(math.cos(angle)*radius, y, math.sin(angle)*radius))
        obj = bpy.context.object
        obj.name = f'{name} {i:02d}'
        obj.dimensions = dims
        obj.rotation_euler.y = -angle
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.parent = root
        obj.data.materials.append(mat)


def text(name, body, location, size, mat, root, extrude=0):
    """Shallow side marking following the tangent at `location`, read along the bore."""
    bpy.ops.object.text_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.body = body
    obj.data.size = size
    obj.data.extrude = extrude
    obj.rotation_euler = (math.pi/2, 0, math.pi/2)
    bpy.ops.object.convert(target='MESH')
    obj.parent = root
    obj.data.materials.append(mat)


def bore():
    """World-space triangle BVH and vertices of every mesh in the scene."""
    bpy.context.view_layer.update()
    vertices, faces = [], []
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        offset = len(vertices)
        obj.data.calc_loop_triangles()
        vertices.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
        faces.extend(tuple(offset+i for i in t.vertices) for t in obj.data.loop_triangles)
    return BVHTree.FromPolygons(vertices, faces, all_triangles=True), vertices


def assert_clear(label, radii, length, rays=32, half_angle=0):
    """Rays from behind the mount through the exit must not hit the can: a straight
    gauge at each radius, optionally flaring at `half_angle` degrees (shot envelopes).
    The can must span exactly `length` from the mount. Returns `bore()`."""
    tree, vertices = bore()
    assert abs(max(p.y for p in vertices)-min(p.y for p in vertices)-length) < 1e-6, f'{label} length'
    spread = math.tan(math.radians(half_angle))
    distance = (length+.003)/math.cos(math.radians(half_angle))
    for radius in radii:
        for i in range(rays):
            angle = i*math.tau/rays
            origin = Vector((radius*math.cos(angle), -.001, radius*math.sin(angle)))
            direction = Vector((spread*math.cos(angle), 1, spread*math.sin(angle))).normalized()
            assert tree.ray_cast(origin, direction, distance)[0] is None, f'{label} bore obstructed'
    return tree, vertices


def export(root, out, stem, length):
    """Add the mount/exit sockets, save `<stem>.blend` and `<stem>.glb`, and verify the
    exported exit faces glTF -Z at `length` with unit, unrotated sockets."""
    for name, y in (('SOCKET_mount', 0), ('SOCKET_muzzle', length)):
        node = bpy.data.objects.new(name, None)
        bpy.context.collection.objects.link(node)
        node.parent = root
        node.location = (0, y, 0)
    bpy.context.view_layer.update()
    for node in root.children:
        if node.type == 'EMPTY':
            assert (node.matrix_world.to_scale()-Vector((1, 1, 1))).length < 1e-7
            assert node.matrix_world.to_quaternion().angle < 1e-7
    bpy.ops.wm.save_as_mainfile(filepath=str(out/f'{stem}.blend'))
    bpy.ops.export_scene.gltf(filepath=str(out/f'{stem}.glb'), export_format='GLB',
                              export_animations=False, export_extras=True, export_yup=True)
    raw = (out/f'{stem}.glb').read_bytes()
    doc = json.loads(raw[20:20+struct.unpack_from('<I', raw, 12)[0]])
    exit = next(n for n in doc['nodes'] if n.get('name') == 'SOCKET_muzzle')['translation']
    assert (Vector(exit)-Vector((0, 0, -length))).length < 1e-6, f'{stem} exit must face glTF -Z'
    assert not doc.get('animations')
    print(f'{stem.upper()}_OK: {length*1000:.0f} mm, clear bore, glTF -Z exit')
