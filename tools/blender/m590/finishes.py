"""Export-only finish packing; retain original UV0 albedo and normal XYZ.

Vertex colours keep all seven exact linear colour factors. Only scalar roughness
micro-grain is area-filtered into seven padded UV1 tiles; metallic stays binary.
The editable high source retains its original materials, maps and UVs.
"""
import bpy
import numpy as np


def consolidate_finishes(objects, rough, output):
    materials = sorted({material for obj in objects if obj.type == 'MESH'
                        for material in obj.data.materials if material}, key=lambda material: material.name)
    assert len(materials) == 7
    bounds = {material: np.array([[np.inf, np.inf], [-np.inf, -np.inf]]) for material in materials}
    for obj in objects:
        if obj.type != 'MESH': continue
        uv = obj.data.uv_layers[0].data
        for face in obj.data.polygons:
            bound = bounds[obj.data.materials[face.material_index]]
            for loop in face.loop_indices:
                bound[0] = np.minimum(bound[0], uv[loop].uv)
                bound[1] = np.maximum(bound[1], uv[loop].uv)
    source = np.array(rough.pixels[:], dtype=np.float32).reshape(1024, 1024, 4)[:, :, 1]
    size = 1024; width = 256; height = 512; pad = 8
    span = np.array((width - 2 * pad, height - 2 * pad))
    pixels = np.ones((size, size, 4), dtype=np.float32)
    factors = {}
    for index, material in enumerate(materials):
        shader = material.node_tree.nodes.get('Principled BSDF')
        factors[material] = tuple(shader.inputs['Base Color'].default_value)
        lo, hi = bounds[material]
        u, v = np.meshgrid((np.arange(width) - pad + .5) / span[0],
                           (np.arange(height) - pad + .5) / span[1])
        grain = np.zeros((height, width))
        # Preserve repeat phase across the complete component-UV domain. Only
        # scalar detail is filtered; UV0 is neither wrapped nor reprojected.
        for sy in range(4):
            for sx in range(4):
                x = (lo[0] + (u + (sx / 4 - .375) / span[0]) * (hi[0] - lo[0])) * size - .5
                y = (lo[1] + (v + (sy / 4 - .375) / span[1]) * (hi[1] - lo[1])) * size - .5
                ix = np.floor(x).astype(int); iy = np.floor(y).astype(int)
                fx = x - ix; fy = y - iy
                grain += ((source[iy % size, ix % size] * (1-fx) + source[iy % size, (ix+1) % size] * fx) * (1-fy)
                          + (source[(iy+1) % size, ix % size] * (1-fx) + source[(iy+1) % size, (ix+1) % size] * fx) * fy) / 16
        x0 = index % 4 * width; y0 = index // 4 * height
        pixels[y0:y0+height, x0:x0+width, 1] = grain * shader.inputs['Roughness'].default_value
        pixels[y0:y0+height, x0:x0+width, 2] = shader.inputs['Metallic'].default_value
    atlas = bpy.data.images.new('m590-finish-orm', width=size, height=size, alpha=False)
    atlas.colorspace_settings.name = 'Non-Color'; atlas.pixels.foreach_set(pixels.ravel())
    atlas.filepath_raw = str(output / 'm590-finish-orm.png'); atlas.file_format = 'PNG'; atlas.save(); atlas.pack()
    result = materials[0].copy(); result.name = 'M590 | opaque finishes'
    nodes, links = result.node_tree.nodes, result.node_tree.links
    shader = nodes.get('Principled BSDF'); shader.inputs['Metallic'].default_value = 1
    mix = next(node for node in nodes if node.type == 'MIX')
    color = nodes.new('ShaderNodeVertexColor'); color.layer_name = 'FinishColor'
    links.new(color.outputs['Color'], mix.inputs[7])
    uv = nodes.new('ShaderNodeUVMap'); uv.uv_map = 'FinishUV'
    texture = next(node for node in nodes if node.type == 'TEX_IMAGE' and node.image == rough)
    texture.image = atlas; links.new(uv.outputs['UV'], texture.inputs['Vector'])
    separate = next(node for node in nodes if node.type == 'SEPARATE_COLOR')
    links.new(separate.outputs['Green'], shader.inputs['Roughness'])
    links.new(separate.outputs['Blue'], shader.inputs['Metallic'])
    for obj in objects:
        if obj.type != 'MESH': continue
        mesh = obj.data; uv0 = mesh.uv_layers[0]; uv1 = mesh.uv_layers.new(name='FinishUV')
        colors = mesh.color_attributes.new(name='FinishColor', type='FLOAT_COLOR', domain='CORNER')
        mesh.color_attributes.active_color = colors
        for face in mesh.polygons:
            material = mesh.materials[face.material_index]; index = materials.index(material)
            lo, hi = bounds[material]; origin = np.array((index % 4 * width + pad, index // 4 * height + pad))
            for loop in face.loop_indices:
                uv1.data[loop].uv = (origin + (np.array(uv0.data[loop].uv) - lo) / (hi - lo) * span) / size
                colors.data[loop].color = factors[material]
            face.material_index = 0
        mesh.materials.clear(); mesh.materials.append(result); mesh.uv_layers.active = uv0
