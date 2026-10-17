"""Finish authority: linear pigment, metalness, roughness and normal strength.

Edit FINISHES to tune a surface. Shared maps supply variation, not finish color.
The same parameters drive the preview shader and the native glTF material.
"""
from pathlib import Path

import bpy
import numpy as np

TEXTURE_SIZE = 1024
TEXTURE_SEED = 300

# Key: (exported name, linear RGB, metalness, roughness multiplier, normal strength)
FINISHES = {
    'anodized': ('01 | graphite anodized alloy', (.047, .053, .060), 1, .72, .09),
    'edge': ('02 | subtly burnished edges', (.081, .087, .095), 1, .59, .08),
    'polymer': ('03 | injection-moulded polymer', (.027, .031, .035), 0, .84, .50),
    'rubber': ('04 | stippled rubber', (.016, .019, .022), 0, .91, .9),
    'steel': ('05 | dark nitrided steel', (.083, .091, .105), 1, .44, .16),
    'ceramic': ('06 | suppressor graphite ceramic', (.045, .046, .049), 0, .76, .15),
    'brass': ('07 | fired brass', (.49, .285, .084), 1, .35, .14),
    'copper': ('08 | copper projectile', (.43, .16, .066), 1, .39, .1),
    'marking': ('09 | subdued laser markings', (.37, .39, .40), 0, .65, .02),
    'red': ('10 | selector red', (.32, .025, .012), 0, .62, .02),
    'glass': ('11 | coated optic lens', (.48, .56, .59), 0, .08, 0),
    'fiber': ('12 | red fiber-optic collector', (.48, .025, .008), 0, .28, .03),
    'coating': ('13 | Elite Concrete gray coating', (.135, .130, .123), 0, .44, .025),
}


def build_materials(output: Path):
    """Generate three packed/external maps, then create the named finishes."""
    rng = np.random.default_rng(TEXTURE_SEED)
    size = TEXTURE_SIZE

    def field(grid):
        small = rng.random((grid, grid)).astype(np.float32)
        xx = np.arange(size) * grid / size
        lo = xx.astype(int)
        t = xx - lo
        t = t * t * (3 - 2 * t)
        a = small[lo[:, None] % grid, lo[None, :] % grid]
        b = small[(lo[:, None] + 1) % grid, lo[None, :] % grid]
        c = small[lo[:, None] % grid, (lo[None, :] + 1) % grid]
        d = small[(lo[:, None] + 1) % grid, (lo[None, :] + 1) % grid]
        return ((a * (1 - t[:, None]) + b * t[:, None]) * (1 - t[None, :])
                + (c * (1 - t[:, None]) + d * t[:, None]) * t[None, :])

    def image(name, rgb, color=False):
        img = bpy.data.images.new(name, width=size, height=size, alpha=False)
        img.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
        pixels = np.ones((size, size, 4), dtype=np.float32)
        pixels[:, :, :3] = rgb if rgb.ndim == 3 else rgb[:, :, None]
        img.pixels.foreach_set(pixels.ravel())
        img.filepath_raw = str(output / 'textures' / (name + '.png'))
        img.file_format = 'PNG'
        img.save()
        img.pack()
        img.filepath = '//textures/' + name + '.png'
        return img

    cloud = field(12) * .48 + field(53) * .32 + field(170) * .20
    fine = rng.random((size, size)).astype(np.float32)
    height = field(230) * .65 + fine * .35
    scratches = np.zeros((size, size), dtype=np.float32)
    for _ in range(260):
        x, y = rng.integers(0, size, 2)
        length = int(rng.integers(2, 32))
        for i in range(length):
            scratches[(y + i // 7) % size, (x + i) % size] = rng.uniform(.08, .35)
    albedo = image('surface_variation', np.clip(.86 + cloud * .05 + scratches * .08, 0, 1), True)
    rough = image('roughness_variation', np.clip(.86 + cloud * .08 + fine * .035 - scratches * .10, 0, 1))
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * .33
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * .33
    normal = np.dstack((-dx, -dy, np.ones_like(dx)))
    normal /= np.linalg.norm(normal, axis=2, keepdims=True)
    nmap = image('micro_normal', normal * .5 + .5)

    def material(name, color, metal, roughness, detail):
        mat = bpy.data.materials.new(name)
        mat.diffuse_color = (*color, 1)
        mat.use_nodes = True
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        shader = nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value = (*color, 1)
        shader.inputs['Metallic'].default_value = metal
        shader.inputs['Roughness'].default_value = roughness

        texture = nodes.new('ShaderNodeTexImage')
        texture.image = albedo
        tint = nodes.new('ShaderNodeMix')
        tint.data_type = 'RGBA'
        tint.blend_type = 'MULTIPLY'
        tint.inputs[0].default_value = 1
        tint.inputs[7].default_value = (*color, 1)
        links.new(texture.outputs['Color'], tint.inputs[6])
        links.new(tint.outputs[2], shader.inputs['Base Color'])

        texture = nodes.new('ShaderNodeTexImage')
        texture.image = rough
        channels = nodes.new('ShaderNodeSeparateColor')
        links.new(texture.outputs['Color'], channels.inputs[0])
        multiplier = nodes.new('ShaderNodeMath')
        multiplier.operation = 'MULTIPLY'
        multiplier.inputs[1].default_value = roughness
        links.new(channels.outputs['Green'], multiplier.inputs[0])
        links.new(multiplier.outputs[0], shader.inputs['Roughness'])

        texture = nodes.new('ShaderNodeTexImage')
        texture.image = nmap
        normal_node = nodes.new('ShaderNodeNormalMap')
        normal_node.inputs['Strength'].default_value = detail
        links.new(texture.outputs['Color'], normal_node.inputs['Color'])
        links.new(normal_node.outputs['Normal'], shader.inputs['Normal'])
        return mat

    materials = {key: material(*finish) for key, finish in FINISHES.items()}
    # Explicit optic exceptions, not shared finish defaults.
    glass = materials['glass'].node_tree.nodes.get('Principled BSDF')
    glass.inputs['Transmission Weight'].default_value = .97
    glass.inputs['IOR'].default_value = 1.45
    glass.inputs['Coat Weight'].default_value = .25
    fiber = materials['fiber'].node_tree.nodes.get('Principled BSDF')
    fiber.inputs['Emission Color'].default_value = (*FINISHES['fiber'][1], 1)
    fiber.inputs['Emission Strength'].default_value = .7
    return materials
