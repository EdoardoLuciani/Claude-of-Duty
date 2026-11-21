"""Author a closed field supply case. Millimetres here, native exports in metres."""
import argparse
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from finish import SIZE, TILES, finish

OUT = Path(__file__).resolve().parents[3] / '.cache/blender/props/ammo-pickup'


def octagon(hx, hy, c):
    return [(-hx+c, -hy), (hx-c, -hy), (hx, -hy+c), (hx, hy-c),
            (hx-c, hy), (-hx+c, hy), (-hx, hy-c), (-hx, -hy+c)]


def project(finish_name, normal, point):
    x, y, z = point
    if finish_name == 'deck':
        u, v = (x + 180) / 360, (y + 115) / 230
    elif finish_name == 'lever':
        u, v = (x - (151 if x > 0 else -151) + 13) / 26, (z - 179) / 45
    elif finish_name in ('front', 'shell'):
        if finish_name == 'front' or abs(normal.y) > abs(normal.x):
            u = (x + 184) / 368
        else:
            u = (y + 128) / 256
        v = (z - 41) / 162
    else:
        a, b = max(range(3), key=lambda i: abs(normal[i])), (x, y, z)
        u, v = ((b[(a+1) % 3] + 153) / 306, (b[(a+2) % 3] + 153) / 306)
    tx, ty, width, height = TILES[finish_name]
    return ((tx + 3 + min(1, max(0, u)) * (width - 6)) / SIZE,
            (ty + 3 + min(1, max(0, v)) * (height - 6)) / SIZE)


def component(name, points, faces, finishes, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v * .001 for v in p) for p in points], [], faces)
    mesh.update()
    mesh.materials.append(mat)
    uv = mesh.uv_layers.new(name='Case atlas')
    for face, tile in zip(mesh.polygons, finishes, strict=True):
        for j in face.loop_indices:
            uv.uv[j].vector = project(tile, face.normal, points[mesh.loops[j].vertex_index])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def press(name, sections, mat, *, bottom=None, top=None):
    """One stamped skin; each section declares the finish towards the next."""
    points, faces, finishes = [], [], []
    for row, (z, hx, hy, c, tile) in enumerate(sections):
        offset = len(points)
        points.extend((x, y, z) for x, y in octagon(hx, hy, c))
        if row == len(sections) - 1:
            break
        for i in range(8):
            j = (i+1) % 8
            faces.append((offset+i, offset+j, offset+8+j, offset+8+i))
            finishes.append(('front' if i == 0 else 'shell') if tile == 'body' else tile)
    if bottom:
        faces.append(tuple(reversed(range(8))))
        finishes.append(bottom)
    if top:
        faces.append(tuple(range(len(points)-8, len(points))))
        finishes.append(top)
    obj = component(name, points, faces, finishes, mat)
    # Shade the corner bends continuously without rounding the broad stamped faces.
    polygons = obj.data.polygons
    normals = [tuple(p.normal) for p in polygons for _ in p.loop_indices]
    for row in range(len(sections)-1):
        for i in (1, 3, 5, 7):
            face = polygons[row*8 + i]
            face.use_smooth = True
            for j, delta in zip(face.loop_indices, (-1, 1, 1, -1), strict=True):
                normals[j] = tuple(polygons[row*8 + (i+delta) % 8].normal)
    obj.data.normals_split_custom_set(normals)
    return obj


def fitting(name, outline, low, high, tile, mat, axis='Y'):
    """Extruded stamped profile. Winding stays outward for both mounting axes."""
    if axis == 'Y':
        points = [(x, y, z) for y in (high, low) for x, z in outline]
    else:
        points = [(x, y, z) for x in (low, high) for y, z in outline]
    n = len(outline)
    faces = [tuple(reversed(range(n))), tuple(range(n, n*2))]
    faces.extend((i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n))
    return component(name, points, faces, [tile] * len(faces), mat)


def end_press(side, sign, mat):
    # A shallow strengthening draw on the wide flanks, following the shell draft.
    rings = [(0, 103, 56, 12), (3.5, 97, 51, 9)]
    points = [(sign * (185 + (z-43)/30 + rise), y, z)
              for rise, hy, hz, c in rings for y, dz in octagon(hy, hz, c) for z in (dz+112,)]
    faces = [(i, (i+1) % 8, (i+1) % 8+8, i+8) for i in range(8)]
    faces.append(tuple(range(8, 16)))
    if sign < 0:
        faces = [f[::-1] for f in faces]
    component(f'09{side} · side strengthening press', points, faces, ['shell'] * len(faces), mat)


def build_case(mat):
    # The perimeter returns carry the silhouette; the long panel is a single face.
    press('01 · seam-welded lower shell', [
        (25, 176, 118, 17, 'steel'), (31, 185, 126, 20, 'paint'),
        (43, 185, 126, 20, 'body'), (193, 190, 130, 19, 'body'),
        (202, 193, 132, 18, 'seal'), (213, 193, 132, 18, None),
    ], mat, bottom='paint')
    lid = press('02 · rolled lid and crown', [
        (208, 192, 132, 18, 'steel'), (212, 201, 143, 20, 'paint'),
        (230, 201, 143, 20, 'paint'), (237, 195, 137, 19, 'paint'),
        (237, 180, 115, 15, 'paint'), (244, 173, 108, 14, None),
    ], mat, bottom='seal', top='deck')
    for sign, side in ((-1, 'L'), (1, 'R')):
        x = sign * 151
        fitting(f'03{side} · latch shoe', [(x-14, 169), (x+14, 169), (x+17, 181),
            (x+17, 207), (x-17, 207), (x-17, 181)], -136, -128, 'seal', mat)
        fitting(f'04{side} · drawn lever', [(x-10, 179), (x+10, 179), (x+13, 185),
            (x+13, 217), (x+9, 224), (x-9, 224), (x-13, 217), (x-13, 185)],
            -148, -135, 'lever', mat)
        fitting(f'05{side} · lock thumb pad', [(x-9, 185), (x+9, 185), (x+9, 198),
            (x-9, 198)], -151, -147, 'catch', mat)
        fitting(f'06{side} · hinge knuckle', [(128, 201), (138, 201), (144, 207),
            (144, 218), (138, 224), (128, 224)], x-23, x+23, 'steel', mat, axis='X')
        pivot = sign * 60
        fitting(f'07{side} · handle mount', [(pivot-8, 243), (pivot+8, 243),
            (pivot+8, 251), (pivot-8, 251)], 48, 76, 'steel', mat)
        end_press(side, sign, mat)
    # Low folded bail with an actual gap under the grip. The stencil stays unobstructed.
    fitting('08 · folded carrying bail', [(-62, 246), (-49, 246), (-43, 252), (43, 252),
        (49, 246), (62, 246), (62, 252), (54, 260), (-54, 260), (-62, 252)],
        52, 72, 'grip', mat)
    return lid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default=OUT, type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    lid = build_case(finish())
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'ammo-pickup.blend'))

    # Join only the export in memory; the saved .blend keeps independent parts.
    bpy.ops.object.select_all(action='SELECT')
    bpy.context.view_layer.objects.active = lid
    bpy.ops.object.join()
    lid.name = lid.data.name = 'Ammo_Case'
    bpy.ops.export_scene.gltf(filepath=str(output / 'ammo-pickup.glb'), export_format='GLB',
                              use_selection=True, export_animations=False, export_cameras=False,
                              export_lights=False, export_yup=True)


if __name__ == '__main__':
    main()
