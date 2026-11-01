"""AX338 export-only finish packing; editable source materials remain separate."""
import bpy
import numpy as np


def consolidate_finishes(asset, rough, albedo, normal, output):
    """Keep UV0/albedo/normal XYZ; pack only scalar finish detail into UV1.

    Eight 512x256 tiles replace seven opaque material submissions plus glass's
    roughness factor. Two-pixel guards isolate metallic boundaries under filtering.
    Vertex colors carry the original linear base-color factors without an atlas.
    """
    materials = sorted({o.data.materials[0] for o in asset.objects if o.type == 'MESH'}, key=lambda m: m.name)
    assert len(materials) == 8
    source = np.array(rough.pixels[:], dtype=np.float32).reshape(1024, 1024, 4)[:, :, 1]
    # Bilinear scalar downsampling only; normal/albedo maps are never resampled.
    x = np.linspace(0, 1023, 508); y = np.linspace(0, 1023, 252)
    ix = x.astype(int); iy = y.astype(int); fx = x - ix; fy = y - iy
    tile = ((source[iy[:, None], ix[None, :]] * (1-fx) + source[iy[:, None], np.minimum(ix+1, 1023)[None, :]] * fx) * (1-fy[:, None])
            + (source[np.minimum(iy+1, 1023)[:, None], ix[None, :]] * (1-fx) + source[np.minimum(iy+1, 1023)[:, None], np.minimum(ix+1, 1023)[None, :]] * fx) * fy[:, None])
    pixels = np.ones((1024, 1024, 4), dtype=np.float32)
    factors = {}
    for i, material in enumerate(materials):
        shader = material.node_tree.nodes.get('Principled BSDF')
        color = tuple(shader.inputs['Base Color'].default_value)
        metal = shader.inputs['Metallic'].default_value
        roughness = shader.inputs['Roughness'].default_value
        factors[material] = (i, color)
        x0 = (i % 2) * 512; y0 = (i // 2) * 256
        pixels[y0:y0+256, x0:x0+512, 1] = np.pad(tile * roughness, 2, mode='edge')
        pixels[y0:y0+256, x0:x0+512, 2] = metal
    packed = bpy.data.images.new('ax338_finishes', width=1024, height=1024, alpha=True)
    packed.colorspace_settings.name = 'Non-Color'; packed.pixels.foreach_set(pixels.ravel())
    packed.filepath_raw = str(output/'ax338_finishes.png'); packed.file_format = 'PNG'; packed.save(); packed.pack()

    opaque = bpy.data.materials.new('AX338 | opaque finishes'); opaque.use_nodes = True
    nodes = opaque.node_tree.nodes; links = opaque.node_tree.links
    shader = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexImage'); tex.image = albedo
    color = nodes.new('ShaderNodeVertexColor'); color.layer_name = 'FinishColor'
    mix = nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1
    links.new(tex.outputs['Color'], mix.inputs[6]); links.new(color.outputs['Color'], mix.inputs[7]); links.new(mix.outputs[2], shader.inputs['Base Color'])
    tex = nodes.new('ShaderNodeTexImage'); tex.image = normal
    n = nodes.new('ShaderNodeNormalMap'); n.inputs['Strength'].default_value = .25
    links.new(tex.outputs['Color'], n.inputs['Color']); links.new(n.outputs[0], shader.inputs['Normal'])

    def finish_texture(material):
        nodes = material.node_tree.nodes; links = material.node_tree.links
        shader = nodes.get('Principled BSDF')
        tex = nodes.new('ShaderNodeTexImage'); tex.image = packed
        uv = nodes.new('ShaderNodeUVMap'); uv.uv_map = 'FinishUV'
        links.new(uv.outputs[0], tex.inputs['Vector'])
        channels = nodes.new('ShaderNodeSeparateColor'); links.new(tex.outputs['Color'], channels.inputs[0])
        links.new(channels.outputs[1], shader.inputs['Roughness']); links.new(channels.outputs[2], shader.inputs['Metallic'])

    finish_texture(opaque)
    for obj in asset.objects:
        if obj.type != 'MESH':
            continue
        material = obj.data.materials[0]; i, color = factors[material]
        uv0 = obj.data.uv_layers.active
        uv1 = obj.data.uv_layers.new(name='FinishUV')
        for original, target in zip(uv0.data, uv1.data):
            target.uv = ((i % 2 * 512 + 2.5 + original.uv.x * 507) / 1024,
                         (i // 2 * 256 + 2.5 + original.uv.y * 251) / 1024)
        obj.data.uv_layers.active = uv0
        if material.name.startswith('10 |'):
            # Keep authored lens alpha, normal and base-color factors independent.
            continue
        colors = obj.data.color_attributes.new(name='FinishColor', type='FLOAT_COLOR', domain='CORNER')
        for value in colors.data:
            value.color = color
        obj.data.color_attributes.active_color = colors
        obj.data.materials.clear(); obj.data.materials.append(opaque)
    glass = next(m for m in materials if m.name.startswith('10 |'))
    finish_texture(glass)
