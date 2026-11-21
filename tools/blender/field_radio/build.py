"""FR-12 field radio. Dimensions below use runtime axes in mm: +Y up, +Z face."""
import argparse
import math
from pathlib import Path
import random
import struct
import sys
import tempfile
import zlib

import bpy

OUT = Path(__file__).resolve().parents[3] / '.cache/blender/props/field-radio'
SIZE = 512

# Ink on the moulding, not on the dynamic LCD. Each glyph is a 5x7 bitmap,
# top row first; 0x10 is the leftmost column.
GLYPHS = dict(zip('ACDEFILNOPRTU0124-/', '''
0e11111f111111 0f10101010100f 1e11111111111e 1f10101e10101f 1f10101e101010
0e04040404040e 1010101010101f 11191513111111 0e11111111110e
1e11111e101010 1e11111e141211 1f040404040404 1111111111110e
0e11131519110e 040c040404040e 0e11010204081f 02060a121f0202
0000001f000000 01010204081010'''.split()))

# Atlas tiles for the non-printed surfaces. RGB is display-encoded; roughness
# and metalness are linear. Coated metal stays dielectric until paint wears off.
SWATCHES = {
    'Polymer': ((74, 76, 49), .68, 0),
    'Rubber': ((39, 42, 39), .89, 0),
    'Recess': ((21, 26, 25), .86, 0),
    'Anodized': ((103, 108, 108), .35, .78),
    'Fastener': ((133, 136, 131), .47, .86),
    'Orange': ((180, 69, 31), .71, 0),
    'Pointer': ((189, 184, 150), .63, 0),
    'Gasket': ((47, 48, 36), .57, 0),
}


def tile(finish):
    index = list(SWATCHES).index(finish)
    return 278 + index % 4 * 57, 24 + index // 4 * 70


def front_uv(x, y):
    return 128 + x * 3.72, 12 + y * 4.1


def png(path, size, data):
    def chunk(kind, value):
        return struct.pack('>I', len(value)) + kind + value + struct.pack('>I', zlib.crc32(kind + value))
    rows = b''.join(b'\0' + data[y * size * 3:(y + 1) * size * 3] for y in reversed(range(size)))
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))


def atlases(out):
    rng = random.Random(691)
    color = bytearray(SIZE * SIZE * 3)
    orm_size = SIZE // 2
    orm = bytearray(orm_size * orm_size * 3)
    for py in range(SIZE):
        for px in range(SIZE):
            if px < 256:
                x, y = (px - 128) / 3.72, (py - 12) / 4.1
                rgb, rough, metal = (88, 88, 59), .71, 0
                # Outline and narrow scuff bands on the moulded face. Recessed
                # grille perforations are baked at this scale, not 100 tiny draws.
                edge = max(abs(x) - 20.2, 1.8 - y, y - 105)
                rubbed = max(0, 1 - abs(edge - .7) * .75)
                rub = rubbed * max(0, math.sin(x * .85 + y * .59) + .18) * rng.uniform(3, 16)
                grain = rng.uniform(-4, 4) + math.sin(x * 1.4 + y * .8) * .9 + rub
                if 25 < y < 44 and abs(x) < 17:
                    rgb, rough = (38, 43, 38), .83
                    row = int((y - 26) // 3.15)
                    dx = (x + (row % 2) * 1.45 + 1.45) % 2.90 - 1.45
                    dy = (y - 26) % 3.15 - 1.58
                    dist = math.hypot(dx * .84, dy * 1.05)
                    if abs(x) < 14.9 and 0 <= row < 5:
                        if dist < .87:
                            rgb, grain = (16, 19, 18), grain * .35
                        elif dist < 1.09 and dy < .25:
                            grain += 15
                if 103.3 < y < 104.0 and -19 < x < 18:
                    rgb, grain = (152, 116, 54), 0
                rough -= rub / 125
            else:
                row = max(0, min(1, (py + 10) // 70))
                col = max(0, min(3, (px - 263) // 57))
                rgb, rough, metal = tuple(SWATCHES.values())[row * 4 + col]
                grain = rng.uniform(-4, 4) + math.sin(px * .87 + py * 1.2) * 1.4
            k = (py * SIZE + px) * 3
            color[k:k + 3] = bytes(max(0, min(255, round(c + grain))) for c in rgb)
            if px % 2 == 0 and py % 2 == 0:
                k = (py // 2 * orm_size + px // 2) * 3
                orm[k:k + 3] = bytes((255, round(rough * 255), round(metal * 255)))

    def ink(text, x, y, scale, rgb):
        px, py = (round(v) for v in front_uv(x, y))
        for n, ch in enumerate(text):
            if ch == ' ':
                continue
            for row, bits in enumerate(bytes.fromhex(GLYPHS[ch])):
                for col in range(5):
                    if bits & (16 >> col):
                        for iy in range(scale):
                            for ix in range(scale):
                                k = ((py + (6 - row) * scale + iy) * SIZE + px + (n * 6 + col) * scale + ix) * 3
                                color[k:k + 3] = bytes(rgb)

    ink('FR-12', -16, 97.5, 2, (195, 190, 158))
    ink('TACTICAL', 3, 98, 1, (156, 158, 130))
    ink('AUDIO', -11, 21, 1, (139, 143, 117))
    ink('P4 / 12', 4, 12, 1, (127, 132, 109))
    png(out / 'radio-albedo.png', SIZE, color)
    png(out / 'radio-orm.png', orm_size, orm)


def finish_material(path):
    m = bpy.data.materials.new('FR12 · moulded finishes')
    m.use_nodes = True
    m.use_backface_culling = True
    shader = m.node_tree.nodes.get('Principled BSDF')
    for name, file, space in [('Finish atlas', 'albedo', 'sRGB'), ('Packed roughness/metalness', 'orm', 'Non-Color')]:
        node = m.node_tree.nodes.new('ShaderNodeTexImage')
        node.label = name
        node.image = bpy.data.images.load(str(path / f'radio-{file}.png'))
        node.image.colorspace_settings.name = space
        node.image.pack()
        if file == 'albedo':
            m.node_tree.links.new(node.outputs['Color'], shader.inputs['Base Color'])
        else:
            channels = m.node_tree.nodes.new('ShaderNodeSeparateColor')
            m.node_tree.links.new(node.outputs['Color'], channels.inputs['Color'])
            m.node_tree.links.new(channels.outputs['Green'], shader.inputs['Roughness'])
            m.node_tree.links.new(channels.outputs['Blue'], shader.inputs['Metallic'])
    return m


class Radio:
    def __init__(self, finish):
        self.material = finish
        self.parts = []
        self.grip = bpy.data.objects.new('GRIP_radio', None)
        bpy.context.collection.objects.link(self.grip)

    def mesh(self, name, points, faces, finish, screen=None):
        data = bpy.data.meshes.new(name)
        data.from_pydata([(x * .001, -z * .001, y * .001) for x, y, z in points], [], faces)
        data.update()
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.parent = self.grip
        obj.data.materials.append(screen or self.material)
        uv = data.uv_layers.new(name='UVMap')
        for poly, surface in zip(data.polygons, finish):
            for i in poly.loop_indices:
                x, y, z = points[data.loops[i].vertex_index]
                if screen:
                    u, v = (x + 19.8) / 39.6, (y - 67.5) / 19.8
                else:
                    if surface == 'Face':
                        u, v = front_uv(x, y)
                    else:
                        a, b = tile(surface)
                        u, v = a + (x + z * .2) * .27, b + (y - 50) * .18
                    u, v = u / SIZE, v / SIZE
                uv.data[i].uv = (u, v)
        if not screen:
            self.parts.append(obj)
        return obj

    @staticmethod
    def profile(cx, cy, w, h, r, depth, steps):
        return [(cx + sx * (w / 2 - r) + r * math.cos(a),
                 cy + sy * (h / 2 - r) + r * math.sin(a), depth)
                for k, (sx, sy) in enumerate([(1, 1), (-1, 1), (-1, -1), (1, -1)])
                for a in [math.pi / 2 * (k + i / steps) for i in range(steps + 1)]]

    def mould(self, name, center, sections, surfaces, steps=2, open_center=False, smooth=False):
        rings = [self.profile(*center, *section, steps) for section in sections]
        self.loft(name, rings, surfaces, open_center, smooth)

    def loft(self, name, rings, surfaces, open_center=False, smooth=False):
        n = len(rings[0])
        faces = [] if open_center else [tuple(reversed(range(n)))]
        materials = [] if open_center else [surfaces[0]]
        for layer in range(len(rings) - 1):
            for i in range(n):
                j = (i + 1) % n
                k = layer * n
                faces.append((k + i, k + j, k + j + n, k + i + n))
                materials.append(surfaces[layer])
        if not open_center:
            faces.append(tuple(range((len(rings) - 1) * n, len(rings) * n)))
            materials.append(surfaces[-1])
        obj = self.mesh(name, sum(rings, []), faces, materials)
        if smooth:
            for p in list(obj.data.polygons)[1:-1]:
                p.use_smooth = True

    def turned(self, name, center, levels, finish, axis='Y', sides=12, knurl=False):
        cx, cy, cz = center
        rings = []
        for j, (height, radius) in enumerate(levels):
            ring = []
            for i in range(sides):
                a = 2 * math.pi * i / sides
                r = radius * (.92 if knurl and j in (1, 2) and i % 2 else 1)
                x, z = r * math.cos(a), r * math.sin(a)
                ring.append((cx + x, cy + height, cz - z) if axis == 'Y'
                            else (cx + x, cy + z, cz + height))
            rings.append(ring)
        self.loft(name, rings, [finish] * len(rings), smooth=not knurl)

    def assemble(self):
        # Cross-sections are back to front. The dark gasket splits the two
        # mouldings; the lower case stays in the original hand's grip envelope.
        self.mould('Back shell', (0, 54), [(45, 97, 4.2, -16.8), (51, 106, 5.6, -13.3),
                   (51, 106, 5.6, 3.5)], ['Polymer'] * 3, smooth=True)
        self.mould('Compression gasket', (0, 54), [(51.2, 106.2, 5.8, 3.5), (51.2, 106.2, 5.8, 4.6)],
                   ['Gasket'] * 2)
        self.mould('Face shell', (0, 54), [(51, 106, 5.6, 4.6), (51, 106, 5.6, 13.4),
                   (46.4, 101.5, 4.3, 17.0)], ['Polymer', 'Face', 'Face'], smooth=True)
        self.mould('LCD rubber isolation and bezel', (0, 77.4), [(47, 29, 3, 16.6), (46, 28, 2.8, 19.2),
                   (44, 26, 2.2, 20), (40, 20.2, .6, 20), (39.4, 19.6, .45, 18.9)],
                   ['Gasket', 'Rubber', 'Gasket', 'Recess'], open_center=True)
        self.mould('Speaker rim', (0, 34.5), [(36.8, 21, 3.5, 16.95), (35.8, 20, 3, 17.55),
                   (34.6, 19, 2.8, 17.6), (33.5, 18, 2.4, 16.95)],
                   ['Polymer', 'Gasket', 'Recess'], steps=1, open_center=True)
        for x, width, surf in [(-13, 10, 'Rubber'), (0, 11, 'Rubber'), (13, 10, 'Orange')]:
            self.mould(f'Sealed key {x}', (x, 54.3), [(width + 1.2, 7.8, 1.9, 16.9),
                       (width, 6.6, 1.6, 17.8), (width - 1.1, 5.5, 1.3, 19.0)],
                       ['Recess', surf, surf], steps=1)
        for x in (-19.4, 19.4):
            self.turned(f'Captive screw {x}', (x, 98, 17), [(-.12, 1.25), (.23, 1.47), (.58, 1.17)],
                        'Fastener', 'Z', 8)
            self.mesh(f'Captive screw drive {x}', self.profile(x, 98, 1.7, .44, .1, 17.583, 1),
                      [tuple(range(8))], ['Recess'])
        self.turned('Antenna alloy ferrule', (14, 105.7, -5), [(0, 5.6), (3.5, 5.6), (4.4, 4.1)], 'Anodized')
        self.turned('Antenna strain relief and tapered whip', (14, 110, -5), [(0, 4.25), (7, 4.15),
                    (8, 3.1), (11, 3), (12, 2.46), (18, 2.3), (78, 1.47), (81, 1.12)], 'Rubber', sides=10)
        self.turned('Encoder collar', (-12.6, 105.2, 2), [(0, 6.5), (3.1, 6.5), (4, 5.75)], 'Anodized')
        self.turned('Coarse encoder grip', (-12.6, 109, 2), [(0, 5.35), (1, 6.35), (7, 6.1), (8, 5.17)],
                    'Rubber', sides=20, knurl=True)
        self.mould('Encoder index mark', (-12.6, 113.1), [(1.15, 4.1, .32, 8.06), (1.15, 4.1, .32, 8.18)],
                   ['Pointer'] * 2, steps=1)
        for y in (10, 15, 20):
            # Small grip bars stop short of the outer case silhouette.
            for side in (-1, 1):
                self.mould(f'Grip traction {side} {y}', (side * 21.7, y), [(2.6, 2.0, .42, 15.6),
                           (2.5, 1.8, .4, 16.85)], ['Rubber'] * 2, steps=1)
        screen = bpy.data.materials.new('LCD cover glass · live content at runtime')
        screen.use_nodes = True
        screen.use_backface_culling = True
        p = screen.node_tree.nodes.get('Principled BSDF')
        p.inputs['Base Color'].default_value = (.009, .014, .011, 1)
        p.inputs['Roughness'].default_value = .29
        self.mesh('SCREEN_radio', self.profile(0, 77.4, 39.6, 19.8, .55, 19.07, 1), [tuple(range(8))], ['LCD'], screen)


def build(output):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as scratch:
        path = Path(scratch)
        atlases(path)
        radio = Radio(finish_material(path))
        radio.assemble()
        bpy.ops.wm.save_as_mainfile(filepath=str(output / 'field-radio.blend'))
        # Keep the individual mouldings and controls editable in the .blend;
        # consolidate the static finish primitives only for the native export.
        bpy.ops.object.select_all(action='DESELECT')
        for obj in radio.parts:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = radio.parts[0]
        bpy.ops.object.join()
        bpy.context.object.name = 'Radio_housing'
        bpy.ops.export_scene.gltf(filepath=str(output / 'field-radio.glb'), export_format='GLB',
                                  export_yup=True, export_animations=False, export_materials='EXPORT')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=OUT)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    build(args.output.resolve())
