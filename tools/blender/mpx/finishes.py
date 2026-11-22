"""Export-only finish consolidation; editable component UVs/materials stay intact."""
import bpy
import numpy as np


def consolidate_finishes(meshes, finish_slots, output, orm, normal):
    """Keep full-resolution UV0 colour grain; UV1 selects padded finish tiles.

    Reflectance is exact per-corner linear colour, not an averaged black finish.
    Only the subtle procedural roughness/normal grain is reduced to 248px per
    finish. Geometry lettering and normals remain independent.
    """
    size, tile, pad = 1024, 256, 4

    def pixels(image):
        values = np.empty(size * size * 4, dtype=np.float32)
        image.pixels.foreach_get(values)
        return values.reshape(size, size, 4)

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

    rough_grain = reduce(pixels(orm)[:, :, 1:2])[:, :, 0]
    normal_grain = reduce(pixels(normal)[:, :, :3]) * 2 - 1
    packed_orm = np.ones((size, size, 4), dtype=np.float32)
    packed_normal = np.ones((size, size, 4), dtype=np.float32)
    packed_normal[:, :, :3] = (.5, .5, 1)
    colors = {}
    border = ((pad, pad), (pad, pad))
    for source, slot in finish_slots.items():
        nodes = source.node_tree.nodes
        colors[source] = tuple(next(n for n in nodes if n.type == 'MIX').inputs[7].default_value)
        roughness = next(n for n in nodes if n.type == 'MATH').inputs[1].default_value
        strength = next(n for n in nodes if n.type == 'NORMAL_MAP').inputs['Strength'].default_value
        norms = normal_grain.copy()
        norms[:, :, :2] *= strength
        norms /= np.linalg.norm(norms, axis=2, keepdims=True)
        x, y = (slot % 4) * tile, (slot // 4) * tile
        packed_orm[y:y+tile, x:x+tile, 1] = np.pad(rough_grain * roughness, border, mode='edge')
        packed_orm[y:y+tile, x:x+tile, 2] = nodes['Principled BSDF'].inputs['Metallic'].default_value
        packed_normal[y:y+tile, x:x+tile, :3] = np.pad(norms * .5 + .5, (*border, (0, 0)), mode='edge')

    def image(name, values):
        result = bpy.data.images.new(name, width=size, height=size, alpha=False)
        result.colorspace_settings.name = 'Non-Color'
        result.pixels.foreach_set(values.ravel())
        result.filepath_raw = str(output / 'textures' / (name + '.png'))
        result.file_format = 'PNG'; result.save(); result.pack()
        return result

    orm_atlas = image('mpx-finish-orm', packed_orm)
    normal_atlas = image('mpx-finish-normal', packed_normal)
    result = next(iter(finish_slots)).copy()
    result.name = 'MPX | consolidated opaque finishes'
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
    sep = next(n for n in nodes if n.type == 'SEPARATE_COLOR')
    links.new(sep.outputs['Blue'], p.inputs['Metallic'])

    for obj in meshes:
        mesh = obj.data
        uv0 = mesh.uv_layers.active
        uv1 = mesh.uv_layers.new(name='finish_uv')
        color = mesh.color_attributes.new(name='finish_color', type='FLOAT_COLOR', domain='CORNER')
        mesh.color_attributes.active_color = color
        old = list(mesh.materials)
        finishes = [old[face.material_index] for face in mesh.polygons]
        mesh.materials.clear()
        mesh.materials.append(result)
        for face in mesh.polygons:
            source = finishes[face.index]
            assert source is not None, (obj.name, face.index, 'unassigned finish')
            slot = finish_slots[source]
            face.material_index = 0
            for loop in face.loop_indices:
                uv = uv0.data[loop].uv
                uv1.data[loop].uv = ((slot % 4 * tile + pad + uv.x * count) / size,
                                     (slot // 4 * tile + pad + uv.y * count) / size)
                color.data[loop].color = colors[source]
        mesh.uv_layers.active = uv0
        mesh.update()
