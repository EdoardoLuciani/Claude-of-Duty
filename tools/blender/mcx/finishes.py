"""Export-only finish consolidation; keep editable materials and repeating UV0."""
import bpy
import numpy as np

FINISH_LOOKUP_SIZE = 64


def consolidate_finishes(asset, output):
    """Linear corner pigment + padded scalar ORM lookup on UV1.

    UV1 also identifies exact normal strength and fiber emission in the MCX
    adapter. Keep full normal XYZ and repeating UV0, not an averaged grain atlas.
    Only glass needs an independent material/pass.
    """
    sources = sorted({material for obj in asset.objects if obj.type == 'MESH'
                      for material in obj.data.materials if material}, key=lambda m: m.name)
    assert len(sources) == 13
    rough = bpy.data.images['roughness_variation']
    values = np.empty(len(rough.pixels), dtype=np.float32)
    rough.pixels.foreach_get(values)
    mean_roughness = float(values.reshape(-1, 4)[:, 1].mean())
    size, tile = FINISH_LOOKUP_SIZE, FINISH_LOOKUP_SIZE // 4
    pixels = np.ones((size, size, 4), dtype=np.float32)
    factors = {}
    for index, source in enumerate(sources):
        nodes = source.node_tree.nodes
        shader = nodes.get('Principled BSDF')
        tint = next(node for node in nodes if node.type == 'MIX')
        multiplier = next(node for node in nodes if node.type == 'MATH')
        factors[source] = (index, tuple(tint.inputs[7].default_value))
        x, y = index % 4 * tile, index // 4 * tile
        # Optical materials keep their factors outside the lookup, so the
        # adapter's established lens roughness override has identical meaning.
        optical = index == 10
        pixels[y:y+tile, x:x+tile, 1] = mean_roughness * (1 if optical else multiplier.inputs[1].default_value)
        pixels[y:y+tile, x:x+tile, 2] = shader.inputs['Metallic'].default_value
    lookup = bpy.data.images.new('mcx_finish_scalars', width=size, height=size, alpha=False)
    lookup.colorspace_settings.name = 'Non-Color'
    lookup.pixels.foreach_set(pixels.ravel())
    lookup.filepath_raw = str(output / 'textures' / 'mcx_finish_scalars.png')
    lookup.file_format = 'PNG'
    lookup.save()
    lookup.pack()

    categories = {
        'opaque': (sources[0], .02),
        'glass': (sources[10], 0),
    }
    materials = {}
    for category, (source, strength) in categories.items():
        result = source.copy()
        result.name = source.name if category == 'glass' else 'MCX | opaque finishes'
        nodes, links = result.node_tree.nodes, result.node_tree.links
        shader = nodes.get('Principled BSDF')
        shader.inputs['Metallic'].default_value = 1
        tint = next(node for node in nodes if node.type == 'MIX')
        if category != 'glass':
            color = nodes.new('ShaderNodeVertexColor')
            color.layer_name = 'FinishColor'
            links.new(color.outputs['Color'], tint.inputs[7])
        uv0 = nodes.new('ShaderNodeUVMap')
        uv0.uv_map = 'SurfaceUV'
        uv1 = nodes.new('ShaderNodeUVMap')
        uv1.uv_map = 'FinishUV'
        for node in list(nodes):
            if node.type == 'TEX_IMAGE':
                is_roughness = node.image == rough
                if is_roughness:
                    node.image = lookup
                links.new((uv1 if is_roughness else uv0).outputs['UV'], node.inputs['Vector'])
            elif node.type == 'MATH' and category != 'glass':
                node.inputs[1].default_value = 1
            elif node.type == 'NORMAL_MAP':
                node.inputs['Strength'].default_value = strength
        channels = next(node for node in nodes if node.type == 'SEPARATE_COLOR')
        links.new(channels.outputs['Blue'], shader.inputs['Metallic'])
        materials[category] = result

    for obj in asset.objects:
        if obj.type != 'MESH':
            continue
        mesh = obj.data
        uv0 = mesh.uv_layers.active
        uv1 = mesh.uv_layers.new(name='FinishUV')
        colors = mesh.color_attributes.new(name='FinishColor', type='FLOAT_COLOR', domain='CORNER')
        mesh.color_attributes.active_color = colors
        old = list(mesh.materials)
        finishes = [old[face.material_index] for face in mesh.polygons]
        mesh.materials.clear()
        for material in materials.values():
            mesh.materials.append(material)
        for face, source in zip(mesh.polygons, finishes):
            index, color = factors[source]
            category = 'glass' if index == 10 else 'opaque'
            face.material_index = list(materials).index(category)
            for loop in face.loop_indices:
                # Constant centre coordinates give seven guard texels on each
                # side and zero derivatives: lookup minification cannot bleed.
                uv1.data[loop].uv = ((index % 4 * tile + tile / 2) / size,
                                     (index // 4 * tile + tile / 2) / size)
                colors.data[loop].color = (1, 1, 1, 1) if category == 'glass' else color
        mesh.uv_layers.active = uv0
        mesh.update()
