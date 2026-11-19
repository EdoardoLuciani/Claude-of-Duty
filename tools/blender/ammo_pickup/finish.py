"""Two small PBR atlases: painted pressed steel, stamped ink and exposed hardware."""
import bpy
import numpy as np

SIZE = 256
# x, y, width, height in Blender's bottom-up image coordinates, including gutters.
TILES = {
    'deck': (0, 116, 256, 140), 'front': (0, 26, 160, 90),
    'shell': (196, 26, 60, 90), 'lever': (160, 26, 36, 90),
    'paint': (0, 0, 52, 26), 'seal': (52, 0, 51, 26),
    'steel': (103, 0, 51, 26), 'grip': (154, 0, 51, 26), 'catch': (205, 0, 51, 26),
}

# Original five-column stencil alphabet; row bits run left to right.
GLYPHS = {
    'A': (14, 17, 17, 31, 17, 17, 17), 'D': (30, 17, 17, 17, 17, 17, 30),
    'E': (31, 16, 16, 30, 16, 16, 31), 'F': (31, 16, 16, 30, 16, 16, 16),
    'I': (31, 4, 4, 4, 4, 4, 31), 'L': (16, 16, 16, 16, 16, 16, 31),
    'M': (17, 27, 21, 21, 17, 17, 17), 'O': (14, 17, 17, 17, 17, 17, 14),
    'P': (30, 17, 17, 30, 16, 16, 16), 'S': (15, 16, 16, 14, 1, 1, 30),
    'T': (31, 4, 4, 4, 4, 4, 4), 'U': (17, 17, 17, 17, 17, 17, 14),
    'Y': (17, 17, 10, 4, 4, 4, 4), '0': (14, 17, 19, 21, 25, 17, 14),
    '8': (14, 17, 17, 14, 17, 17, 14),
}


def stencil(mask, text, left, bottom, scale):
    for letter in text:
        for row, bits in enumerate(reversed(GLYPHS.get(letter, ()))):
            for col in range(5):
                if bits & (16 >> col):
                    x, y = left + col * scale, bottom + row * scale
                    mask[y:y+scale, x:x+scale] = True
        left += 6 * scale


def ammo_stencil(x, y):
    """Analytic stencil with diagonals, clipped ends and bridges through the counters."""
    a = (y >= 0) & (y < 1) & (x >= .24*y) & (x < 1 - .24*y)
    a &= ~((x > .22 + .23*y) & (x < .78 - .23*y) & ((y > .50) | (y < .29)))
    a &= ~((x < .50) & (y > .40) & (y < .48))
    o_x = x - 3.6
    o = (o_x >= 0) & (o_x < 1) & (y >= 0) & (y < 1)
    o &= np.abs(o_x - .5) + .85 * np.abs(y - .5) < .79
    o &= ~((o_x > .25) & (o_x < .75) & (y > .20) & (y < .80))
    o &= ~((o_x > .50) & (y > .42) & (y < .52))
    for start in (1.2, 2.4):
        m_x = x - start
        m = (m_x >= 0) & (m_x < 1) & (y >= 0) & (y < 1)
        a |= m & ((m_x < .22) | (m_x > .78) | (y > .07 + 1.53 * abs(m_x - .5)) &
                  (y < .51 + 1.89 * abs(m_x - .5)))
    return a | o


def markings(color, data, name, grain):
    coverage = np.zeros(color.shape[:2], dtype=np.float32)
    ink = np.zeros(color.shape[:2], dtype=bool)
    if name == 'deck':
        left, bottom, width, height = (40, 34, 25, 32)
        stencil(ink, 'FIELD SUPPLY', 40, 19, 1)
        stencil(ink, 'LOT 08', 170, 19, 1)
        ink[16:75, 29:32] = ink[16:75, 222:225] = True
        ink[32:35, 168:214] = True
        for x in (170, 186, 202):
            for y in range(17):
                lead = x + (8 - abs(y - 8)) // 2
                ink[y+43, lead:lead+4] = True
    elif name == 'front':
        left, bottom, width, height = (36, 39, 18, 25)
        stencil(ink, 'FIELD SUPPLY', 36, 23, 1)
        ink[19:21, 36:124] = True
        for x in (112, 115, 117, 122):
            ink[24:30, x:x+1] = True
    else:
        return
    v, u = np.mgrid[:ink.shape[0], :ink.shape[1]]
    for sy in (.125, .375, .625, .875):
        for sx in (.125, .375, .625, .875):
            coverage += ammo_stencil((u + sx - left) / width, (v + sy - bottom) / height) / 16
    coverage[ink] = 1
    coverage *= (grain > .025) * (.82 + .18 * grain)  # pinholes, not large illegible breaks
    color[:] += (np.array((.88, .72, .44)) - color) * coverage[:, :, None]
    data[:] += (np.array((1, .69, 0)) - data) * coverage[:, :, None]


def finish():
    rng = np.random.default_rng(692)
    base = np.ones((SIZE, SIZE, 4), dtype=np.float32)
    surface = base.copy()
    # Display-space paint/ink colors; bare metal reflects colored light only as a conductor.
    finishes = {
        'deck': ((.17, .32, .165), .57, 0), 'front': ((.15, .285, .145), .62, 0),
        'shell': ((.14, .27, .14), .63, 0), 'paint': ((.135, .26, .135), .51, 0),
        'seal': ((.081, .092, .078), .82, 0), 'steel': ((.38, .39, .36), .41, .92),
        'grip': ((.14, .15, .135), .72, 0), 'catch': ((.61, .40, .18), .47, 0),
        'lever': ((.31, .32, .30), .46, .9),
    }
    for name, (x, y, w, h) in TILES.items():
        color, rough, metal = finishes[name]
        v, u = np.mgrid[:h, :w]
        grain = rng.random((h, w))
        waves = np.sin(u * .085 + v * .12) * .012 + np.sin(u * .21 - v * .07) * .013
        value = 1 + waves + (grain - .5) * .105
        color_patch = base[y:y+h, x:x+w, :3]
        data_patch = surface[y:y+h, x:x+w, :3]
        color_patch[:] = np.array(color) * value[:, :, None]
        data_patch[:] = (1, rough, metal)
        data_patch[:, :, 1] += waves + (grain - .5) * .1
        if name == 'lever':
            # Pin and shallow pressing are tightly localized finish changes.
            pin = np.hypot((u - 18) * 1.6, (v - 65) * .7)
            pin_ring = (pin < 6) & (pin > 4)
            color_patch[pin_ring], data_patch[pin_ring] = (.16, .17, .15), (1, .72, .8)
            color_patch[pin <= 4], data_patch[pin <= 4] = (.52, .54, .52), (1, .32, 1)
            stamped = (abs(u - 18) < 7) & (v > 16) & (v < 54)
            color_patch[stamped] *= .72
            data_patch[stamped, 1] += .14
        elif name == 'catch':
            color_patch[(u + 2*v) % 7 < 2] *= .82
        elif name in ('deck', 'front', 'shell'):
            markings(color_patch, data_patch, name, grain)
            edge = np.minimum(np.minimum(u, w-1-u), np.minimum(v, h-1-v))
            if name == 'deck':  # drags from the corners of the raised lid
                edge = np.minimum(edge, np.abs(v - 123) + np.minimum(u, w-1-u) * .20)
            wear = (edge < 9 + 5 * np.sin(u * .097 + v * .14)) & (grain < .13)
            for px, py, length in ((20, 13, 13), (w-34, h-15, 21), (w-29, 18, 18), (24, h-14, 14)):
                drag = (u > px) & (u < px + length) & (abs(v - py - (u-px) * .17) < .85)
                wear |= drag & (grain < .8)
            primer = wear & (grain >= .09)
            color_patch[primer] = (.29, .32, .23)
            data_patch[primer] = (1, .76, 0)
            bare = wear & ~primer
            color_patch[bare] = (.39, .41, .39)
            data_patch[bare] = (1, .42, .86)
    mat = bpy.data.materials.new('Field supply · painted steel')
    mat.use_nodes = mat.use_backface_culling = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes.get('Principled BSDF')

    def image_node(name, pixels, space, location):
        height, width, _ = pixels.shape
        image = bpy.data.images.new(name, width, height, alpha=False)
        image.colorspace_settings.name = space
        image.pixels.foreach_set(pixels.ravel())
        image.pack()
        node = nodes.new('ShaderNodeTexImage')
        node.image, node.location = image, location
        return node

    albedo = image_node('Ammo_Case_BaseColor', base, 'sRGB', (-560, 230))
    packed = surface.reshape(SIZE//2, 2, SIZE//2, 2, 4).mean(axis=(1, 3))
    mr = image_node('Ammo_Case_MetalRough', packed, 'Non-Color', (-560, -75))
    channels = nodes.new('ShaderNodeSeparateColor')
    channels.location = (-280, -75)
    links.new(albedo.outputs['Color'], shader.inputs['Base Color'])
    links.new(mr.outputs['Color'], channels.inputs['Color'])
    links.new(channels.outputs['Green'], shader.inputs['Roughness'])
    links.new(channels.outputs['Blue'], shader.inputs['Metallic'])
    return mat
