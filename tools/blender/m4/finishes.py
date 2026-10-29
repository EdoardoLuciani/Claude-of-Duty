"""Export-only M4 opaque finish packing; preserve receiver and A2 UV0 detail."""
import bpy
import numpy as np


def consolidate_finishes(asset, output):
    # Receiver albedo/normal and polymer/checkering keep their original material
    # and full-resolution UV0 maps. Emissive sight paint remains independent.
    sources = sorted({m for obj in asset.objects if obj.type == 'MESH'
                      for m in obj.data.materials if m}, key=lambda m: m.name)
    packed_sources = [m for m in sources if not m.name.startswith(('01 |', '03 |', '12 |'))]
    assert len(sources) == 12 and len(packed_sources) == 9
    size, tile, pad = 512, 128, 4
    count = tile - 2 * pad

    def pixels(name):
        image = bpy.data.images[name]
        values = np.empty(1024 * 1024 * 4, dtype=np.float32)
        image.pixels.foreach_get(values)
        return values.reshape(1024, 1024, 4)

    coord = np.linspace(0, 1023, count, dtype=np.float32)
    lo = coord.astype(int); hi = np.minimum(lo + 1, 1023); t = coord - lo

    def reduce(values):
        a = values[lo[:, None], lo[None, :]]
        b = values[hi[:, None], lo[None, :]]
        c = values[lo[:, None], hi[None, :]]
        d = values[hi[:, None], hi[None, :]]
        return ((a * (1-t[:, None, None]) + b * t[:, None, None]) * (1-t[None, :, None])
                + (c * (1-t[:, None, None]) + d * t[:, None, None]) * t[None, :, None])

    rough = reduce(pixels('m4_roughness'))[:, :, 1]
    normal = reduce(pixels('m4_normal'))[:, :, :3] * 2 - 1
    orm = np.ones((size, size, 4), dtype=np.float32)
    normals = np.ones_like(orm); normals[:, :, :3] = (.5, .5, 1)
    factors = {}
    for index, source in enumerate(packed_sources):
        nodes = source.node_tree.nodes
        shader = nodes.get('Principled BSDF')
        tint = next(n for n in nodes if n.type == 'MIX').inputs[7].default_value[:]
        roughness = next(n for n in nodes if n.type == 'MATH').inputs[1].default_value
        strength = next(n for n in nodes if n.type == 'NORMAL_MAP').inputs['Strength'].default_value
        values = np.ones((count, count, 4), dtype=np.float32)
        values[:, :, 1] = rough * roughness
        values[:, :, 2] = shader.inputs['Metallic'].default_value
        # Match glTF tangent-space normalScale: scale XY, retain Z, normalize.
        direction = normal.copy(); direction[:, :, :2] *= strength
        direction /= np.linalg.norm(direction, axis=2, keepdims=True)
        n = np.ones_like(values); n[:, :, :3] = direction * .5 + .5
        x, y = index % 4 * tile, index // 4 * tile
        for target, data in [(orm, values), (normals, n)]:
            target[y:y+tile, x:x+tile] = np.pad(data, ((pad,pad),(pad,pad),(0,0)), mode='edge')
        factors[source] = (index, tint)

    def image(name, values):
        result = bpy.data.images.new(name, width=size, height=size, alpha=False)
        result.colorspace_settings.name = 'Non-Color'
        result.pixels.foreach_set(values.ravel())
        result.filepath_raw = str(output / 'textures' / (name + '.png'))
        result.file_format = 'PNG'; result.save(); result.pack()
        return result

    material = bpy.data.materials.new('M4 | packed opaque finishes'); material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images['m4_surface']
    color = nodes.new('ShaderNodeVertexColor'); color.layer_name = 'FinishColor'
    mix = nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1
    links.new(tex.outputs['Color'], mix.inputs[6]); links.new(color.outputs['Color'], mix.inputs[7])
    links.new(mix.outputs[2], shader.inputs['Base Color'])
    uv = nodes.new('ShaderNodeUVMap'); uv.uv_map = 'FinishUV'
    tex = nodes.new('ShaderNodeTexImage'); tex.image = image('m4_finish_orm', orm)
    links.new(uv.outputs['UV'], tex.inputs['Vector'])
    sep = nodes.new('ShaderNodeSeparateColor'); links.new(tex.outputs['Color'], sep.inputs[0])
    links.new(sep.outputs['Green'], shader.inputs['Roughness']); links.new(sep.outputs['Blue'], shader.inputs['Metallic'])
    tex = nodes.new('ShaderNodeTexImage'); tex.image = image('m4_finish_normal', normals)
    links.new(uv.outputs['UV'], tex.inputs['Vector'])
    nm = nodes.new('ShaderNodeNormalMap'); nm.uv_map = 'FinishUV'; nm.inputs['Strength'].default_value = 1
    links.new(tex.outputs['Color'], nm.inputs['Color']); links.new(nm.outputs[0], shader.inputs['Normal'])

    meshes = {obj.data for obj in asset.objects if obj.type == 'MESH'}
    for mesh in meshes:
        old = list(mesh.materials)
        finishes = [old[face.material_index] for face in mesh.polygons]
        if not any(source in factors for source in finishes):continue
        uv0 = mesh.uv_layers.active
        uv1 = mesh.uv_layers.new(name='FinishUV')
        colors = mesh.color_attributes.new(name='FinishColor', type='FLOAT_COLOR', domain='CORNER')
        mesh.color_attributes.active_color = colors
        slot = len(mesh.materials); mesh.materials.append(material)
        for face, source in zip(mesh.polygons, finishes):
            index, tint = factors[source]
            face.material_index = slot
            for loop in face.loop_indices:
                original = uv0.data[loop].uv
                uv1.data[loop].uv = ((index % 4 * tile + pad + .5 + original.x * (count-1)) / size,
                                     (index // 4 * tile + pad + .5 + original.y * (count-1)) / size)
                colors.data[loop].color = tint
        mesh.uv_layers.active = uv0
        mesh.update()
