"""Author the inert M590 ejection visual, in the runtime casing reference basis."""

import argparse
import math
from pathlib import Path
import sys

import bpy


OUT = Path(__file__).resolve().parents[3] / 'assets/fx/spent-hull'
SIDES = 24
# In-game visual proportions from the M590 insertion mesh, not physical specifications.
RADIUS_SCALE = .00495 / 11.05
LENGTH_SCALE = .045 / 70
# Scene-linear vertex albedos; wear and burnish modulate these below.
RED = (.19, .015, .012)
BRASS = (.38, .205, .060)
PRIMER = (.39, .32, .21)


def build_hull():
    vertices, faces, finishes = [], [], []

    # Six opened petals, with a slightly crushed side and uneven fold heights.
    def opening(a):
        return (math.cos(6 * a + .18 * math.sin(2 * a)) + 1) / 2

    def mouth(a):
        return 68.5 + 1.5 * opening(a) - .75 * math.sin(a + .37) ** 2

    crest = max(mouth(i * math.tau / SIDES) for i in range(SIDES))

    def ring(radius, height, *, sides=SIDES, fold=0, ribs=0, lip=False):
        start = len(vertices)
        for i in range(sides):
            a = i * math.tau / sides
            r = radius + fold * (opening(a) - .5) + ribs * (i % 2 - .5)
            r += abs(fold) * .23 * math.cos(2 * a + .45)
            z = height + ((mouth(a) - crest) if lip else fold * .18 * math.sin(3 * a))
            vertices.append((r * math.cos(a), r * math.sin(a), z))
        return list(range(start, len(vertices)))

    def face(indices, finish):
        faces.append(indices)
        finishes.append(finish)

    def band(lower, upper, finish):
        # Keep the small primer and deep inner wall at half perimeter density.
        lo_step = 1 + (len(lower) > len(upper))
        hi_step = 1 + (len(upper) > len(lower))
        for i in range(min(len(lower), len(upper))):
            j, k = i * lo_step, i * hi_step
            lo, hi = lower[j], upper[k]
            next_lo, next_hi = lower[(j + lo_step) % len(lower)], upper[(k + hi_step) % len(upper)]
            if lo_step == 2:
                face((lo, lower[j + 1], hi), finish)
                lo = lower[j + 1]
            if hi_step == 2:
                face((lo, upper[k + 1], hi), finish)
                hi = upper[k + 1]
            face((lo, next_lo, next_hi, hi), finish)

    strike = ring(.95, .22, sides=12)
    primer = ring(2.66, .045, sides=12)
    base = ring(10.47, 0)
    rim = ring(11.05, .48)
    rim_top = ring(10.91, 1.55)
    groove = ring(9.49, 2.33)
    head = ring(9.94, 3.54)
    shoulder = ring(9.91, 11.61)
    seam = ring(9.06, 12, ribs=.08)
    sleeve = ring(9.05, 49, ribs=.15)
    crimp = ring(9.03, 63.8, fold=.74, ribs=.09)
    lip = ring(8.88, 70, fold=1.83, lip=True)
    lip_inner = ring(8.10, 69.72, fold=1.80, lip=True)
    floor = ring(7.65, 13, sides=12)

    face(tuple(reversed(strike)), 'strike')
    for lower, upper, finish in (
        (strike, primer, 'primer'), (primer, base, 'base'), (base, rim, 'brass'),
        (rim, rim_top, 'brass'), (rim_top, groove, 'brass'), (groove, head, 'brass'),
        (head, shoulder, 'brass'), (shoulder, seam, 'brass'), (seam, sleeve, 'sleeve'),
        (sleeve, crimp, 'sleeve'), (crimp, lip, 'sleeve'), (lip, lip_inner, 'sleeve'),
        (lip_inner, floor, 'interior'),
    ):
        band(lower, upper, finish)
    face(tuple(floor), 'interior')

    data = bpy.data.meshes.new('Spent hull surface')
    data.from_pydata(
        [(x * RADIUS_SCALE, y * RADIUS_SCALE, z * LENGTH_SCALE - .0225) for x, y, z in vertices],
        [], faces,
    )
    data.update()
    # Hold the head-face/primer edge, the shoulder and the inner lip. Smooth the rolled bevels.
    sharp = {frozenset((a, b)) for contour in (primer, base, seam, lip_inner, floor)
             for a, b in zip(contour, contour[1:] + contour[:1])}
    for edge in data.edges:
        edge.use_edge_sharp = frozenset(edge.vertices) in sharp

    color = data.color_attributes.new(name='HullColor', type='BYTE_COLOR', domain='CORNER')
    pbr = data.attributes.new(name='_shellpbr', type='FLOAT2', domain='CORNER')
    for polygon, finish in zip(data.polygons, finishes):
        polygon.use_smooth = True
        for i in polygon.loop_indices:
            idx = data.loops[i].vertex_index
            x, y, z = vertices[idx]
            a = math.atan2(y, x)
            fleck = math.sin(idx * 17.61) * .045
            if finish in ('sleeve', 'interior'):
                rib = math.cos(12 * a) * .11
                # Remnants of a rubbed print band. No subpixel text geometry or maps.
                print_ghost = .19 if idx in sleeve and -.87 < a < -.05 else 0
                scorch = .3 * max(0, (z - 49) / 21) * (.6 + .4 * opening(a))
                if finish == 'interior':
                    strength = .25 if idx in floor else .53
                elif idx in lip or idx in lip_inner:
                    strength = 1.15 - .22 * opening(a)
                else:
                    strength = 1 + rib + print_ghost
                strength -= scorch * .6
                tone, metal, rough = RED, 0, .61 + scorch * .6 - rib * .33
            else:
                tone = PRIMER if finish in ('strike', 'primer') else BRASS
                if finish == 'brass':
                    strength, rough = (.65, .48) if idx in groove else (.92, .37)
                    if idx in rim or idx in rim_top:
                        strength, rough = 1.10, .29
                else:
                    strength, rough = {'strike': (.43, .60), 'primer': (.93, .41),
                                       'base': (1, .34)}[finish]
                metal = 1
            color.data[i].color = (*(v * (strength + fleck) for v in tone), 1)
            pbr.data[i].vector = (metal, rough + fleck)

    # The saved blend previews the same corner finishes the engine reads.
    mat = bpy.data.materials.new('Spent hull · vertex finish')
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    albedo = nodes.new('ShaderNodeVertexColor')
    albedo.layer_name = color.name
    links.new(albedo.outputs['Color'], bsdf.inputs['Base Color'])
    finish = nodes.new('ShaderNodeAttribute')
    finish.attribute_name = pbr.name
    xy = nodes.new('ShaderNodeSeparateXYZ')
    links.new(finish.outputs['Vector'], xy.inputs['Vector'])
    links.new(xy.outputs['X'], bsdf.inputs['Metallic'])
    links.new(xy.outputs['Y'], bsdf.inputs['Roughness'])
    data.materials.append(mat)
    obj = bpy.data.objects.new('spent12g', data)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=OUT)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if not args.output.is_absolute():
        parser.error('--output must be absolute')
    args.output.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_hull()
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output / 'spent12g.blend'))
    bpy.ops.export_scene.gltf(
        filepath=str(args.output / 'spent12g.glb'), export_format='GLB',
        export_attributes=True, export_vertex_color='ACTIVE', export_texcoords=False,
        export_animations=False, export_yup=True, use_selection=True,
    )


if __name__ == '__main__':
    main()
