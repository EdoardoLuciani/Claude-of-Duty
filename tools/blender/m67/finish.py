"""Deterministic two-map finish for the render-only M67 prop."""

from math import sin
from random import Random

import bpy

SIZE = 512, 256
# UV endpoints are inset four pixels; shelf gutters bleed the nearest finish.
SHELL = (4, 4, 508, 172)
SHELVES = {
    # pixel rect, sRGB, roughness, metallic
    'housing': ((4, 180, 128, 218), (108, 110, 98), .66, .62),
    'spoon': ((136, 180, 308, 252), (76, 80, 59), .54, .03),
    'wire': ((316, 180, 508, 210), (146, 145, 132), .36, .92),
    'clip': ((316, 218, 508, 252), (70, 72, 64), .48, .84),
}
# Compact stencil artwork, not dependent on a system font or external texture.
# Each base-32 digit encodes the five pixels of one row.
GLYPHS = dict(zip('M67FRAGLOT0', (
    'hrlhhhh', 'egguhhe', 'v124888', 'vgguggg', 'uhhukih', 'ehhvhhh',
    'fggnhhf', 'ggggggv', 'ehhhhhe', 'v444444', 'ehjlphe',
), strict=True))


def uv(rect, u, v):
    x0, y0, x1, y1 = rect
    return ((x0 + (x1-x0)*u)/SIZE[0], (y0 + (y1-y0)*v)/SIZE[1])


def make_material():
    w, h = SIZE
    rng = Random(689)
    letters = set()
    for text, x0, y0, scale in [('M67', 218, 114, 3), ('FRAG', 220, 103, 1), ('LOT 07', 220, 94, 1)]:
        for i, letter in enumerate(text):
            for y, row in enumerate(GLYPHS.get(letter, '')):
                mask = int(row, 32)
                for x in range(5):
                    if mask & (16 >> x):
                        letters.update((x0 + (6*i+x)*scale + dx, y0 + (6-y)*scale + dy)
                                       for dx in range(scale) for dy in range(scale))

    # Asymmetric abrasions and small chips. Worn surfaces are less rough and
    # more metallic, not simply a layer of grey freckles on the color map.
    chips = set()
    for _ in range(115):
        x = rng.randrange(w)
        y = rng.choice([rng.randrange(10, 171), rng.randrange(79, 88), rng.randrange(152, 166)])
        chips.update(((x+i) % w, y+i//3) for i in range(rng.choice([1, 1, 2, 3, 4, 7])))
    scratches = set()
    for x, y, length, slope in [(212, 118, 19, -.28), (275, 137, 16, .44), (306, 66, 18, -.32),
                                (287, 108, 11, -.24), (387, 91, 15, .33), (117, 126, 24, -.5)]:
        scratches.update((x+i, y+int(i*slope)) for i in range(length) if rng.random() > .28)

    base, surface = [], []
    for y in range(h):
        for x in range(w):
            grain = rng.uniform(-3, 3) + 2*sin(x*.075+y*.043) + 1.5*sin(x*.19-y*.21)
            if y <= 175:
                ridge = 3 if 81 <= y <= 83 else (-4 if 78 <= y <= 80 else 0)
                color, rough, metal = (83+ridge, 90+ridge, 64+ridge), .63, .015
                border = 154 + (1 if sin(x*.061) > .8 else 0)
                if border <= y < 163 or ((x, y) in letters and rng.random() > .105):
                    color, rough, metal = (177, 150, 69), .71, .01
                if (x, y) in scratches:
                    color, rough, metal = (121, 119, 99), .51, .42
                if (x, y) in chips:
                    color, rough, metal = (134, 133, 122), .47, .66
            else:
                def distance(entry):
                    (x0, y0, x1, y1), *_ = entry
                    return max(x0-x, 0, x-x1)**2 + max(y0-y, 0, y-y1)**2

                kind = min(SHELVES, key=lambda name: distance(SHELVES[name]))
                (x0, y0, x1, y1), color, rough, metal = SHELVES[kind]
                if kind == 'spoon':
                    # Rails pick up wear where the flat centre remains painted.
                    u = (x-x0)/(x1-x0)
                    if min(u, 1-u) < .10 and sin(y*.17+x*.53) + rng.random() > .91:
                        color, rough, metal = (136, 135, 121), .42, .72
                else:
                    grain += 3*sin(y*1.3+x*.08)
            base.extend((*(max(0, min(255, c+grain))/255 for c in color), 1))
            surface.extend((1, rough+grain*.003, metal, 1))

    def texture(tree, name, pixels, space):
        image = bpy.data.images.new(name, width=w, height=h, alpha=False)
        image.colorspace_settings.name = space
        image.pixels.foreach_set(pixels)
        image.pack()
        node = tree.nodes.new('ShaderNodeTexImage')
        node.image = image
        return node

    material = bpy.data.materials.new('M67 | Olive enamel and worn hardware')
    material.use_nodes = True
    material.use_backface_culling = True
    tree = material.node_tree
    pbr = tree.nodes.get('Principled BSDF')
    color = texture(tree, 'M67_Color', base, 'sRGB')
    packed = texture(tree, 'M67_Surface', surface, 'Non-Color')
    channels = tree.nodes.new('ShaderNodeSeparateColor')
    tree.links.new(color.outputs['Color'], pbr.inputs['Base Color'])
    tree.links.new(packed.outputs['Color'], channels.inputs['Color'])
    tree.links.new(channels.outputs['Green'], pbr.inputs['Roughness'])
    tree.links.new(channels.outputs['Blue'], pbr.inputs['Metallic'])
    return material
