"""Author and bake the canonical world meshes (see README.md)."""

import argparse
from pathlib import Path
import sys

import bmesh
import bpy


def shell(name, rings):
    # Blender X/Y is the footprint; +Z is up and the origin is at the base.
    vertices = []
    for z, x, y, corner in rings:
        vertices.extend((i, j, z) for i, j in (
            (-x + corner, -y), (x - corner, -y), (x, -y + corner), (x, y - corner),
            (x - corner, y), (-x + corner, y), (-x, y - corner), (-x, -y + corner),
        ))
    top = len(vertices) - 8
    faces = [tuple(range(7, -1, -1)), tuple(range(top, top + 8))]
    for base in range(0, top, 8):
        for i in range(8):
            a, b = base + i, base + (i + 1) % 8
            faces.append((a, b, b + 8, a + 8))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def fork_slots(obj, spacing, width, height):
    # Through the lower skirt in the short direction, open at the base.
    for x in (-spacing, spacing):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x, 0, (height - 0.1) / 2))
        cutter = bpy.context.object
        cutter.dimensions = (width, 3, height + 0.1)
        bpy.context.view_layer.objects.active = obj
        cut = obj.modifiers.new('Fork pocket', 'BOOLEAN')
        cut.operation = 'DIFFERENCE'
        cut.object = cutter
        bpy.ops.object.modifier_apply(modifier=cut.name)
        bpy.data.objects.remove(cutter, do_unlink=True)


# Keep the walkable surfaces on the outermost ring. A narrow top bevel can
# disappear in the world collision simplifier and lower the vault/stack datum.
def barrier():
    obj = shell('Precast concrete barrier', [
        (0.000, 1.192, 0.267, 0.022),
        (0.012, 1.200, 0.275, 0.022),
        (0.082, 1.200, 0.275, 0.022),
        (0.235, 1.200, 0.224, 0.018),
        (0.780, 1.200, 0.205, 0.018),
    ])
    fork_slots(obj, 0.65, 0.22, 0.075)
    return obj


def bake(name, obj):
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    assert all(edge.is_manifold and edge.is_contiguous for edge in bm.edges), obj.name
    assert bm.calc_volume(signed=True) > 0, obj.name
    bm.free()
    mesh.calc_loop_triangles()
    # Compact text geometry in millimetres. The (X,Z,-Y) basis preserves winding.
    positions = [round(coord * 1000) for v in mesh.vertices for coord in (v.co.x, v.co.z, -v.co.y)]
    triangles = [i for tri in mesh.loop_triangles for i in tri.vertices]

    def rows(values):
        return ''.join('    ' + ', '.join(map(str, values[i:i + 12])) + ',\n'
                       for i in range(0, len(values), 12))

    return (f'export const {name} = {{\n'
            f'  // oxfmt-ignore\n  positions: [\n{rows(positions)}  ],\n'
            f'  // oxfmt-ignore\n  triangles: [\n{rows(triangles)}  ],\n'
            '};\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    args.output.write_text(
        '// Baked by tools/blender/industrial_props/build.py. Do not edit by hand.\n\n'
        + bake('barrierMesh', barrier()),
        encoding='utf-8', newline='\n',
    )


if __name__ == '__main__':
    main()
