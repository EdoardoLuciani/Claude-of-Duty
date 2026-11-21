"""Build the static M67 game prop; all surfaces are exterior render art."""

import argparse
from math import cos, pi, sin, tau
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from finish import SHELL, SHELVES, make_material, uv

ROOT = Path(__file__).resolve().parents[3]
NODE = 'MESH_grenade'


def lathe(profile, sides, rect, oval=1.0):
    """Each profile station is (height, radius); map the shell by height."""
    low, high = profile[0][0], profile[-1][0]
    vertices = [(r*sin(i*tau/sides)*oval, y, r*cos(i*tau/sides))
                for y, r in profile for i in range(sides)]
    faces, coords = [], []
    for j in range(len(profile)-1):
        v0, v1 = ((profile[k][0]-low)/(high-low) for k in (j, j+1))
        for i in range(sides):
            n = (i+1) % sides
            faces.append((j*sides+i, j*sides+n, (j+1)*sides+n, (j+1)*sides+i))
            coords.append([uv(rect, u/sides, v) for u, v in ((i,v0),(i+1,v0),(i+1,v1),(i,v1))])
    # Small cap lands hide the joins without sub-pixel concentric rings.
    for first, v in [(0, 0), (len(vertices)-sides, 1)]:
        faces.append(tuple(range(first, first+sides)))
        coords.append([uv(rect, .5+.07*sin(i*tau/sides), v*.94+.03+.023*cos(i*tau/sides))
                       for i in range(sides)])
    return vertices, faces, coords


def sweep(sections, rect, closed=False):
    """Skin matching feature cross-sections; keep an explicit UV seam."""
    n, rows = len(sections[0]), len(sections)
    steps = rows if closed else rows-1
    faces, coords = [], []
    for j in range(steps):
        k = (j+1) % rows
        for i in range(n):
            h = (i+1) % n
            faces.append((j*n+i, j*n+h, k*n+h, k*n+i))
            coords.append([uv(rect, u/n, v/steps) for u, v in ((i,j),(i+1,j),(i+1,j+1),(i,j+1))])
    if not closed:
        for first, v in [(0, 0), ((rows-1)*n, 1)]:
            faces.append(tuple(range(first, first+n)))
            coords.append([uv(rect, .5+.18*sin(i*tau/n), v*.88+.06+.05*cos(i*tau/n))
                           for i in range(n)])
    return [p for section in sections for p in section], faces, coords


def spoon(rect):
    # An uninterrupted curve with a recessed web, bright rolled edges and a
    # slight flare at its lower lip. The centre of each row follows the shell.
    stations = [(.011, .077, .008), (.009, .077, .011), (-.012, .077, .012),
                (-.020, .074, .013), (-.026, .065, .012), (-.029, .053, .0105),
                (-.036, .043, .011), (-.044, .034, .012), (-.049, .024, .012),
                (-.051, .013, .0115), (-.053, .004, .009), (-.052, .002, .0075)]
    # (fraction of half-width, relief); the last four points are the return.
    shape = [(-1, -.0007), (-.95, .0008), (-.81, .0015), (-.57, .0008),
             (.57, .0008), (.81, .0015), (.95, .0008), (1, -.0007),
             (.86, -.0014), (-.86, -.0014)]
    sections = []
    for i, (x, y, width) in enumerate(stations):
        px, py, _ = stations[max(0, i-1)]
        nx, ny, _ = stations[min(i+1, len(stations)-1)]
        normal = Vector((ny-py, px-nx)).normalized()
        sections.append([(x+lift*normal.x, y+lift*normal.y, z*width)
                         for z, lift in shape])
    return sweep(sections, rect)


def tube(path, radii, sides, rect, closed=False, guide=(0, 0, 1)):
    points = list(map(Vector, path))
    sections = []
    for i, (point, radius) in enumerate(zip(points, radii, strict=True)):
        prev = points[i-1] if closed or i > 0 else point
        next_point = points[(i+1) % len(points)] if closed or i < len(points)-1 else point
        tangent = (next_point-prev).normalized()
        up = tangent.cross(Vector(guide)).normalized()
        side = up.cross(tangent)
        sections.append([point + radius*(up*cos(j*tau/sides)+side*sin(j*tau/sides))
                         for j in range(sides)])
    return sweep(sections, rect, closed)


def make_grenade():
    housing, lever, wire, clip = (SHELVES[key][0] for key in ('housing', 'spoon', 'wire', 'clip'))
    ring = [(-.028 + .012*cos(t) + .003*sin(t), .087 + .014*sin(t),
             .003 + .005*cos(t) - .003*sin(t)) for t in (i*tau/24 for i in range(24))]
    parts = [
        lathe([(-.040, .012), (-.039, .017), (-.035, .026), (-.029, .034),
               (-.018, .0415), (-.008, .0448), (-.0025, .0454), (-.0013, .0462),
               (.0001, .0462), (.0015, .0456), (.008, .0451), (.019, .0415),
               (.028, .0345), (.035, .0259), (.039, .018), (.0405, .014)], 36, SHELL),
        lathe([(.038, .014), (.040, .017), (.043, .017), (.045, .015),
               (.047, .013), (.065, .0118), (.071, .0118), (.075, .0095)], 14, housing, .90),
        spoon(lever),
        tube(ring, [.0014]*len(ring), 7, wire, closed=True),
        tube([(-.024,.077,.004), (-.021,.079,.005), (-.017,.080,.004), (-.010,.078,.003),
              (.002,.076,.002), (.010,.076,.002)], [.00115,.0016,.0016,.0016,.0016,.00115], 6, wire),
        sweep([[(x, y+dy, z+dz) for dy, dz in ((-.0015,-.002),(-.0006,-.003),
                                               (.0006,-.003),(.0015,-.002),(.0015,.002),
                                               (.0006,.003),(-.0006,.003),(-.0015,.002))]
               for x, y, z in ((.012,.073,.009), (.010,.073,.0108), (.003,.073,.011),
                               (-.007,.074,.010), (-.014,.076,.009), (-.016,.077,.007))], clip),
    ]
    vertices, faces, coords = [], [], []
    for positions, polygons, texcoords in parts:
        faces.extend(tuple(i+len(vertices) for i in f) for f in polygons)
        # Blender Z-up -> native glTF Y-up, preserving runtime hand space.
        vertices.extend((x, -z, y) for x, y, z in positions)
        coords.extend(texcoords)
    mesh = bpy.data.meshes.new(NODE)
    mesh.from_pydata(vertices, [], faces)
    uv_layer = mesh.uv_layers.new(name='Finish').data
    for polygon, texcoords in zip(mesh.polygons, coords, strict=True):
        polygon.use_smooth = True
        for i, texcoord in zip(polygon.loop_indices, texcoords, strict=True):
            uv_layer[i].uv = texcoord
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(make_material())
    obj = bpy.data.objects.new(NODE, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT/'.cache/blender/weapons/m67')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    obj = make_grenade()
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output/'m67.blend'))
    bpy.ops.export_scene.gltf(filepath=str(output/'m67.glb'), export_format='GLB',
                              use_selection=True, export_animations=False)


if __name__ == '__main__':
    main()
