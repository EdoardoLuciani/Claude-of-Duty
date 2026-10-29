"""Export-only finish consolidation; editable component UVs/materials stay intact."""
import bpy
import numpy as np


def consolidate_finishes(objects, output, orm, normal):
    """Keep full-resolution UV0 colour grain; UV1 selects padded finish tiles.

    Reflectance is exact per-corner linear colour, not an averaged black finish.
    Only the subtle procedural roughness/normal grain is reduced to 248px per
    finish. Geometry lettering, normals and optical policies are independent.
    """
    sources = sorted({m for obj in objects if obj.type == 'MESH'
                      for m in obj.data.materials if m}, key=lambda m: m.name)
    assert len(sources) == 15
    size, tile, pad = 1024, 256, 4

    def pixels(image):
        values = np.empty(size * size * 4, dtype=np.float32)
        image.pixels.foreach_get(values)
        return values.reshape(size, size, 4)

    original_orm, original_normal = pixels(orm), pixels(normal)
    # Bilinear resampling at the texel centres; edge padding prevents adjacent
    # finish bleed without moving or reprojecting the original component atlas.
    count = tile - 2 * pad
    coord = (np.arange(count) + .5) * size / count - .5
    lo = coord.astype(int); hi = np.minimum(lo + 1, size - 1)
    t = (coord - lo).astype(np.float32)

    def reduce(values):
        a = values[lo[:, None], lo[None, :]]
        b = values[hi[:, None], lo[None, :]]
        c = values[lo[:, None], hi[None, :]]
        d = values[hi[:, None], hi[None, :]]
        return ((a * (1-t[:, None, None]) + b * t[:, None, None]) * (1-t[None, :, None])
                + (c * (1-t[:, None, None]) + d * t[:, None, None]) * t[None, :, None])

    rough_grain = reduce(original_orm)[:, :, 1]
    normal_grain = reduce(original_normal)[:, :, :3] * 2 - 1
    packed_orm = np.ones((size, size, 4), dtype=np.float32)
    packed_normal = np.ones((size, size, 4), dtype=np.float32)
    packed_normal[:, :, :3] = (.5, .5, 1)
    colors = {}
    for index, source in enumerate(sources):
        p = source.node_tree.nodes.get('Principled BSDF')
        mix = next(n for n in source.node_tree.nodes if n.type == 'MIX')
        colors[source] = tuple(mix.inputs[7].default_value)
        roughness = next(n for n in source.node_tree.nodes if n.type == 'MATH').inputs[1].default_value
        strength = next(n for n in source.node_tree.nodes if n.type == 'NORMAL_MAP').inputs['Strength'].default_value
        values = np.ones((count, count, 4), dtype=np.float32)
        values[:, :, 1] = rough_grain * roughness
        values[:, :, 2] = p.inputs['Metallic'].default_value
        norms = normal_grain.copy()
        norms[:, :, :2] *= strength
        norms /= np.linalg.norm(norms, axis=2, keepdims=True)
        normals = np.ones_like(values); normals[:, :, :3] = norms * .5 + .5
        x, y = (index % 4) * tile, (index // 4) * tile
        for target, data in [(packed_orm, values), (packed_normal, normals)]:
            target[y:y+tile, x:x+tile] = np.pad(data, ((pad,pad),(pad,pad),(0,0)), mode='edge')

    def image(name, values):
        result = bpy.data.images.new(name, width=size, height=size, alpha=False)
        result.colorspace_settings.name = 'Non-Color'
        result.pixels.foreach_set(values.ravel())
        result.filepath_raw = str(output / 'textures' / (name + '.png'))
        result.file_format = 'PNG'; result.save(); result.pack()
        return result

    orm_atlas = image('mpx-finish-orm', packed_orm)
    normal_atlas = image('mpx-finish-normal', packed_normal)
    materials = {}
    for category, source in [('opaque', sources[0]), ('lens', sources[10]),
                             ('cover', sources[11]), ('interior', sources[14])]:
        result = source.copy()
        result.name = 'MPX | consolidated opaque finishes' if category == 'opaque' else source.name
        nodes, links = result.node_tree.nodes, result.node_tree.links
        p = nodes.get('Principled BSDF')
        p.inputs['Metallic'].default_value = 1
        mix = next(n for n in nodes if n.type == 'MIX')
        color = nodes.new('ShaderNodeVertexColor'); color.layer_name = 'finish_color'
        links.new(color.outputs['Color'], mix.inputs[7])
        uv = nodes.new('ShaderNodeUVMap'); uv.uv_map = 'finish_uv'
        for node in nodes:
            if node.type == 'TEX_IMAGE' and node.image in (orm, normal):
                node.image = orm_atlas if node.image == orm else normal_atlas
                links.new(uv.outputs['UV'], node.inputs['Vector'])
            elif node.type == 'MATH':
                node.inputs[1].default_value = 1
            elif node.type == 'NORMAL_MAP':
                node.inputs['Strength'].default_value = 1
        # A dedicated ORM UV is shared by roughness and metalness. Optical and
        # absorptive materials remain separate for their runtime pass policies.
        sep = next(n for n in nodes if n.type == 'SEPARATE_COLOR')
        links.new(sep.outputs['Blue'], p.inputs['Metallic'])
        materials[category] = result

    for obj in objects:
        if obj.type != 'MESH': continue
        mesh = obj.data
        uv0 = mesh.uv_layers.active
        uv1 = mesh.uv_layers.new(name='finish_uv')
        color = mesh.color_attributes.new(name='finish_color', type='FLOAT_COLOR', domain='CORNER')
        mesh.color_attributes.active_color = color
        old = list(mesh.materials)
        finishes = [old[face.material_index] for face in mesh.polygons]
        mesh.materials.clear()
        for material in materials.values(): mesh.materials.append(material)
        for face in mesh.polygons:
            source = finishes[face.index]
            assert source is not None, (obj.name, face.index, 'unassigned finish')
            index = sources.index(source)
            category = 'lens' if index == 10 else 'cover' if index == 11 else 'interior' if index == 14 else 'opaque'
            face.material_index = list(materials).index(category)
            for loop in face.loop_indices:
                uv = uv0.data[loop].uv
                uv1.data[loop].uv = ((index % 4 * tile + pad + uv.x * count) / size,
                                     (index // 4 * tile + pad + uv.y * count) / size)
                color.data[loop].color = colors[source]
        mesh.uv_layers.active = uv0
        mesh.update()
