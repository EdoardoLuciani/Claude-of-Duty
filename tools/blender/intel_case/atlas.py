"""Al-Maktaba finish atlas; opaque inks, PCB copper/mask and packed rough/metal."""
from array import array
from random import Random

import bpy

WIDTH, HEIGHT = 512, 256
# sRGB tint, roughness, metalness, RMS-scale grain in code values.
SWATCHES = {
    'polymer': ((68, 87, 54), .68, .02, 5),
    'edge': ((96, 109, 72), .60, .02, 5),
    'rubber': ((40, 43, 41), .88, 0, 5),
    'anodized': ((70, 77, 77), .50, .63, 6),
    'bare': ((158, 159, 145), .42, .80, 6),
    'latch': ((181, 108, 48), .49, .16, 6),
    'foam': ((55, 64, 57), .96, 0, 11),
    'battery': ((130, 118, 88), .57, .11, 5),
    'board': ((41, 84, 70), .61, .07, 4),
    'chip': ((38, 45, 47), .67, .04, 6),
    'wire': ((177, 124, 57), .63, 0, 5),
    'socket': ((180, 184, 166), .57, 0, 5),
}
TILES = {name: (32 * i, 224, 32, 32) for i, name in enumerate(SWATCHES)}
TILES.update({
    'badge': (0, 0, 208, 78), 'pcb_print': (0, 84, 208, 134),
    'field_card': (216, 0, 176, 106), 'battery_print': (216, 112, 80, 98),
    'power': (304, 112, 76, 55), 'chip_print': (396, 0, 110, 76),
    'front_print': (396, 84, 110, 44), 'shell': (396, 132, 110, 86),
    'pad': (302, 171, 88, 47),
})
FONT = dict(zip('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-.:+', (
    '0E111F1111 1E111E111E 0F1010100F 1E1111111E 1F101E101F 1F101E1010 '
    '0F1013110F 11111F1111 1F0404041F 070101110E 11121C1211 101010101F '
    '111B151111 1119151311 0E1111110E 1E111E1010 0E1111150F 1E111E1211 '
    '0F100E011E 1F04040404 111111110E 1111110A04 1111151B11 110A040A11 '
    '110A040404 1F0204081F 0E1315190E 0C0404040E 0E1106081F 1E0106011E '
    '12121F0202 1F101E011E 0F101E110E 1F02040808 0E110E110E 0E110F011E '
    '0102040810 00001F0000 0000000004 0004000400 00041F0400'
).split()))


def coordinates(tile, u, v):
    x, y, w, h = TILES[tile]
    u, v = max(0, min(1, u)), max(0, min(1, v))
    return ((x + 2 + (w - 4) * u) / WIDTH, 1 - (y + 2 + (h - 4) * v) / HEIGHT)


def material():
    px = WIDTH * HEIGHT
    color = array('f', [0, 0, 0, 1]) * px
    masks = array('f', [.9, .7, 0, 1]) * px
    rng = Random(132)
    ink = (215, 216, 192)
    charcoal = (40, 46, 39)
    amber = (205, 143, 60)
    copper = (111, 124, 77)
    tile = 'polymer'

    def rect(x, y, w, h, rgb, noise=1, rough=.62, metal=0):
        ox, oy, tw, th = TILES[tile]
        for j in range(max(0, y), min(th, y + h)):
            for i in range(max(0, x), min(tw, x + w)):
                k = ((HEIGHT - 1 - oy - j) * WIDTH + ox + i) * 4
                n = rng.uniform(-noise, noise)
                for channel in range(3):
                    color[k + channel] = max(0, min(255, rgb[channel] + n)) / 255
                masks[k + 1] = rough + n * .0015
                masks[k + 2] = metal

    def text(x, y, msg, rgb=ink, s=1):
        for i, char in enumerate(msg):
            rows = FONT.get(char, '0000000000')
            for j in range(5):
                bits = int(rows[2*j:2*j + 2], 16)
                for b in range(5):
                    if bits & (16 >> b):
                        rect(x + (6 * i + b) * s, y + j * s, s, s, rgb)

    for tile, (rgb, rough, metal, grain) in SWATCHES.items():
        rect(0, 0, 32, 32, rgb, grain, rough, metal)
        if tile in ('polymer', 'edge', 'anodized', 'latch'):
            for _ in range(12):
                shade = rng.randrange(-18, 20)
                rect(rng.randrange(2, 30), rng.randrange(2, 30), rng.randrange(1, 4), 1,
                     tuple(c + shade for c in rgb), 3, rough, metal)

    tile = 'badge'
    rect(0, 0, 208, 78, charcoal, 5)
    rect(5, 5, 198, 68, (159, 155, 119), 6, .73)
    rect(9, 9, 190, 60, (188, 183, 147), 5, .73)
    text(15, 14, 'AL-MAKTABA', charcoal, 3)
    text(15, 36, 'FIELD INTELLIGENCE', charcoal)
    rect(15, 46, 178, 2, charcoal, 3)
    text(15, 54, 'MK-IV', charcoal, 2)
    text(133, 54, 'CASE 0132', charcoal)
    for i, w in enumerate([1, 3, 2, 1, 2, 3, 1, 2]):
        rect(99 + i * 4, 53, w, 10, charcoal)
    for _ in range(36):
        x, y = rng.randrange(9, 196), rng.choice([9, 10, 11, 65, 66, 67, 68])
        rect(x, y, rng.randrange(1, 6), 1, (115, 114, 90), 8)

    tile = 'pcb_print'
    rect(0, 0, 208, 134, (45, 89, 74), 5, .62)
    for i in range(8):
        x, y = 14 + i * 6, 20 + i * 4
        rect(x, y, 94, 1, copper, 2, .48, .25)
        rect(x, y, 1, 92-y, copper, 2, .48, .25)
        rect(x - 1, 91, 3, 3, amber, 2, .46, .43)
    for i in range(9):
        x, y = 162 + i * 4, 29 + 4 * i
        rect(x, y, 1, 112 - y, copper, 2, .48, .25)
        rect(99, y, x-99, 1, copper, 2, .48, .25)
        rect(x-1, 111, 3, 3, amber, 2, .46, .43)
    for x in (9, 193):
        for y in (9, 118):
            rect(x, y, 7, 7, copper)
            rect(x + 2, y + 2, 3, 3, charcoal)
    rect(95, 37, 49, 28, (124, 146, 117))
    rect(96, 38, 47, 26, (40, 77, 61))
    for y in (70, 79, 88, 97):
        for x in (101, 118, 135, 149):
            rect(x, y, 11, 4, copper, 2, .44, .42)
            rect(x + 2, y - 1, 7, 6, charcoal)
    text(22, 7, 'BUS A / MK-IV')
    text(18, 114, 'SIGNAL CONTROL / R04')
    text(111, 24, 'U10')
    text(152, 77, 'J3')

    tile = 'field_card'
    rect(0, 0, 176, 106, (179, 175, 136), 5, .87)
    rect(5, 5, 166, 18, (57, 63, 47), 5)
    text(10, 9, 'FIELD TERMINAL', ink, 2)
    text(11, 34, '01 / VERIFY SEAL', charcoal)
    text(11, 47, '02 / ISOLATE POWER', charcoal)
    text(11, 60, '03 / BREAK LINK', charcoal)
    rect(8, 74, 160, 2, charcoal)
    for x in range(8, 77, 10):
        for y in range(83, 97):
            rect(x + 96 - y, y, 4, 1, charcoal)
    text(99, 86, 'MK-IV', charcoal, 2)

    tile = 'battery_print'
    rect(0, 0, 80, 98, (128, 120, 92), 4, .73)
    rect(6, 8, 68, 28, charcoal, 5)
    text(10, 16, '24V', amber, 4)
    text(10, 46, 'POWER CORE', charcoal)
    text(10, 56, 'CELL / 06', charcoal)
    rect(8, 67, 64, 2, charcoal)
    text(12, 75, '+    -', charcoal, 2)

    tile = 'power'
    rect(0, 0, 76, 55, charcoal, 5)
    rect(7, 7, 62, 1, copper)
    text(10, 13, 'STATUS', amber)
    text(10, 32, 'A  B  C')

    tile = 'chip_print'
    rect(0, 0, 110, 76, (41, 47, 46), 4, .58)
    text(11, 14, 'MK-IV', ink, 2)
    text(11, 34, 'SIGNAL DSP')
    text(11, 52, 'A0132', (150, 158, 137))
    rect(92, 10, 5, 5, ink)

    tile = 'front_print'
    rect(0, 0, 110, 44, charcoal, 5)
    rect(6, 6, 98, 32, (111, 116, 98), 5)
    text(15, 12, 'MK-IV', ink, 2)
    text(15, 25, 'SEALED 0132')

    tile = 'shell'
    shell, rough, metal, grain = SWATCHES['polymer']
    rect(0, 0, 110, 86, shell, grain, rough, metal)
    # Abrasion follows high contact edges and travels in short dragged streaks.
    rect(0, 0, 110, 12, (76, 93, 59), 5, .74, metal)
    rect(0, 76, 110, 10, (77, 95, 61), 5, .75, metal)
    for _ in range(82):
        y = rng.choice((rng.randrange(2, 18), rng.randrange(67, 84), rng.randrange(10, 80)))
        x = rng.randrange(2, 105)
        shine = rng.randrange(5, 25)
        rect(x, y, rng.randrange(1, 8), 1, tuple(c+shine for c in shell), 4, .58, metal)
    for _ in range(65):
        x, y = rng.randrange(2, 108), rng.randrange(4, 82)
        rect(x, y, 1, 1, (43, 57, 35), 9, .77, metal)

    tile = 'pad'
    rect(0, 0, 88, 47, (58, 63, 56), 6, .95)
    for x in range(2, 86, 3):
        for y in range(2, 46, 3):
            rect(x + y % 2, y, 2, 2, (46, 51, 45), 9, .92)

    def image(name, data, data_map):
        img = bpy.data.images.new(name, WIDTH, HEIGHT, alpha=False)
        if data_map:
            img.colorspace_settings.name = 'Non-Color'
        img.pixels.foreach_set(data)
        img.pack()
        return img

    mat = bpy.data.materials.new('Case finish atlas')
    mat.diffuse_color = (.10, .15, .07, 1)
    mat.use_nodes = True
    mat.use_backface_culling = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    albedo = nodes.new('ShaderNodeTexImage')
    albedo.image = image('AMK-0132 • albedo', color, False)
    albedo.location = (-530, 240)
    orm = nodes.new('ShaderNodeTexImage')
    orm.image = image('AMK-0132 • roughness + metal', masks, True)
    orm.location = (-530, -70)
    split = nodes.new('ShaderNodeSeparateColor')
    split.location = (-250, -60)
    links.new(albedo.outputs['Color'], bsdf.inputs['Base Color'])
    links.new(orm.outputs['Color'], split.inputs['Color'])
    links.new(split.outputs['Green'], bsdf.inputs['Roughness'])
    links.new(split.outputs['Blue'], bsdf.inputs['Metallic'])
    return mat
