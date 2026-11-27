"""Consolidate the fresh exterior into one opaque, atlas-baked mesh.

Bake each corresponding high/low pair in isolation so rays cannot pick up a
neighbor's hardware. Leave the studio and reference plug out of the target.
"""

import math

import bpy
from mathutils import Vector

ATLAS_SIZE = 1024
BAKE_SIZE = 2 * ATLAS_SIZE  # Supersample the engraved and printed strokes, not the shipped maps.
MAX_TRIANGLES = 8000
LABEL = 'Underbody yellow warning plate'
RECEIVER = 'Machined receiver — continuous radiused pocket and lower lip'
JAW = 'Moving jaw — captive raised side plate'
THROAT = 'Fixed throat'
GLASS = 'Clear protective front window'


def active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def join(parts, name):
    active(parts[0])
    for obj in parts[1:]:
        obj.select_set(True)
    bpy.ops.object.join()
    obj = bpy.context.object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.name = name
    return obj


def copy_evaluated(source, graph, collection):
    original = source.evaluated_get(graph)
    data = bpy.data.meshes.new_from_object(original, preserve_all_data_layers=True, depsgraph=graph)
    data.transform(original.matrix_world)
    clone = bpy.data.objects.new(source.name, data)
    collection.objects.link(clone)
    return clone


def low_mesh(source, collection):
    obj = bpy.data.objects.new(source.name, source.data.copy())
    collection.objects.link(obj)
    active(obj)
    # Hold the rail-height silhouette and favor round optics and shallow bores.
    # Small edge radii elsewhere are represented by the normal bake.
    ratio = .21
    for prefixes, value in [
        (('Rounded upper saddle lip',), 1),
        ((RECEIVER, 'HPL bezel', 'Visible shaped reflector', 'Thin exposed silver separator'), .35),
        (('Optical gasket', 'Silver optical shoulder', 'Dark saddle bed'), .32),
        (('Laser retaining collar', 'Rounded forward cheek'), .39),
    ]:
        if source.name.startswith(prefixes):
            ratio = value
            break
    source.data.calc_loop_triangles()
    if ratio < 1 and len(source.data.loop_triangles) > 48:
        mod = obj.modifiers.new('Reduce while retaining the main silhouette', 'DECIMATE')
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    mod = obj.modifiers.new('Fix tangent-bake triangulation', 'TRIANGULATE')
    mod.keep_custom_normals = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def decal_receiver(name):
    if name.startswith(('Sample serial', 'Date marking', 'Battery outline')):
        return JAW
    if name.startswith('Face cap'):
        return THROAT
    if name.startswith(('Underbody warning', 'Warning plate microprint')):
        return LABEL
    return RECEIVER


def atlas_uv(obj, density):
    active(obj)
    for layer in list(obj.data.uv_layers):
        obj.data.uv_layers.remove(layer)
    obj.data.uv_layers.new(name='AtlasUV')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(68), island_margin=.002)
    bpy.ops.object.mode_set(mode='OBJECT')
    # Rescale whole parts (and thus whole UV islands), never individual faces.
    rest, uv = obj.data.attributes['_rest'].data, obj.data.uv_layers.active.data
    for face in obj.data.polygons:
        i = face.vertices[0]
        shift = obj.data.vertices[i].co - rest[i].vector
        weight = density.get(tuple(round(c/.14) for c in shift), 1)
        for loop in face.loop_indices:
            uv[loop].uv *= weight
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.pack_islands(rotate=True, margin_method='FRACTION', margin=5 / ATLAS_SIZE)
    bpy.ops.object.mode_set(mode='OBJECT')


def channel(links, source, target):
    if source.is_linked:
        links.new(source.links[0].from_socket, target)
    else:
        target.default_value = source.default_value


def bake_maps(body, donor, output):
    scene = bpy.context.scene
    settings = scene.render.bake
    samples = scene.cycles.samples
    scene.cycles.samples = 16
    settings.use_selected_to_active = True
    settings.cage_extrusion, settings.max_ray_distance = .0011, .0023
    settings.margin, settings.margin_type = 8, 'EXTEND'
    settings.use_clear = False
    settings.normal_space = 'TANGENT'
    surface = bpy.data.materials.new('TLR RM 1 | Opaque atlas')
    surface.use_backface_culling = True
    body.data.materials.clear()
    body.data.materials.append(surface)
    for face in body.data.polygons:
        face.material_index = 0
    nodes, links = surface.node_tree.nodes, surface.node_tree.links
    shader = nodes.get('Principled BSDF')
    mats = [(m.node_tree.nodes, m.node_tree.links) for m in donor.data.materials if m is not None]
    for name, color in [('base-color',(.018,.018,.019,1)), ('normal',(.5,.5,1,1)), ('orm',(1,.45,0,1))]:
        image = bpy.data.images.new('tlr-rm1-'+name, width=BAKE_SIZE, height=BAKE_SIZE, alpha=False)
        image.colorspace_settings.name = 'sRGB' if name == 'base-color' else 'Non-Color'
        image.generated_color = color
        tex = nodes.new('ShaderNodeTexImage')
        tex.label = name
        tex.image = image
        tex.extension = 'EXTEND'
        nodes.active = tex
        rewritten = []
        if name != 'normal':
            for src, wires in mats:
                orig = src.get('Principled BSDF')
                out = src.get('Material Output').inputs['Surface']
                emit = src.new('ShaderNodeEmission')
                temp = [emit]
                rewritten.append((src,wires,out,out.links[0].from_socket,temp))
                if name == 'base-color':
                    channel(wires, orig.inputs['Base Color'], emit.inputs['Color'])
                else:
                    rgb = src.new('ShaderNodeCombineColor')
                    temp.append(rgb)
                    rgb.inputs[0].default_value = 1  # Occlusion is intentionally unbaked.
                    for i, key in [(1,'Roughness'), (2,'Metallic')]:
                        channel(wires, orig.inputs[key], rgb.inputs[i])
                    wires.new(rgb.outputs[0], emit.inputs['Color'])
                wires.new(emit.outputs[0],out)
        active(body)
        donor.select_set(True)
        print('TLR_RM1_BAKE', name, flush=True)
        try:
            bpy.ops.object.bake(type='NORMAL' if name == 'normal' else 'EMIT')
        finally:
            for src,wires,out,old,temp in rewritten:
                wires.new(old,out)
                for node in temp:
                    src.remove(node)
        image.scale(ATLAS_SIZE, ATLAS_SIZE)
        image.filepath_raw = str(output / (image.name + '.png'))
        image.file_format = 'PNG'
        image.save()
        image.pack()
        if name == 'base-color':
            links.new(tex.outputs[0], shader.inputs['Base Color'])
        elif name == 'normal':
            normal = nodes.new('ShaderNodeNormalMap')
            links.new(tex.outputs[0], normal.inputs['Color'])
            links.new(normal.outputs[0], shader.inputs['Normal'])
        else:
            orm = nodes.new('ShaderNodeSeparateColor')
            links.new(tex.outputs[0], orm.inputs[0])
            links.new(orm.outputs[1], shader.inputs['Roughness'])
            links.new(orm.outputs[2], shader.inputs['Metallic'])
    settings.use_selected_to_active = False
    scene.cycles.samples = samples


def optimize(collections, output):
    scene = bpy.context.scene
    target = bpy.data.collections.new('00  Optimized exterior — one opaque mesh')
    scene.collection.children.link(target)
    temporary = bpy.data.collections.new('Temporary bake materials and donors')
    scene.collection.children.link(temporary)
    graph = bpy.context.evaluated_depsgraph_get()
    sources = {obj.name: obj for collection in collections for obj in collection.objects if obj.name != GLASS}
    marks = set(collections[-1].objects.keys()) - {LABEL}
    donors = {key: copy_evaluated(obj, graph, temporary) for key,obj in sources.items()}
    # Do not copy materials by part: every donor that used the same material
    # shares the same bake shader and restores it in one operation.
    parts = []
    offsets = {}
    for key, donor in donors.items():
        if key in marks:
            continue
        i = len(parts)
        offset = offsets[key] = Vector((.14*(i%9),.14*(i//9),0))
        obj = low_mesh(donor, target)
        rest = obj.data.attributes.new('_rest','FLOAT_VECTOR','POINT')
        for vertex, item in zip(obj.data.vertices, rest.data):
            item.vector = vertex.co
        obj.location = offset
        parts.append(obj)
    for key, donor in donors.items():
        donor.location = offsets[decal_receiver(key) if key in marks else key]
    body = join(parts, 'TLR_RM1_optimized')
    triangles = len(body.data.polygons)
    if triangles > MAX_TRIANGLES:
        raise ValueError(f'{triangles:,} triangles exceeds {MAX_TRIANGLES:,} target')
    density = {tuple(round(c/.14) for c in offsets[key]): weight
               for key,weight in [(RECEIVER,1.7), (JAW,1.7), (LABEL,1.25)]}
    atlas_uv(body, density)
    donor = join(list(donors.values()), 'Isolated high bake donor')
    bake_maps(body, donor, output)
    bpy.data.objects.remove(donor, do_unlink=True)
    bpy.data.collections.remove(temporary)
    for vertex, item in zip(body.data.vertices, body.data.attributes['_rest'].data):
        vertex.co = item.vector
    body.data.attributes.remove(body.data.attributes['_rest'])
    body.data.update(calc_edges=True)
    body.data.name = 'TLR RM 1 optimized atlas mesh'
    for collection in collections:
        collection.hide_viewport = collection.hide_render = True
    active(body)
    print(f'TLR_RM1_OPTIMIZED {triangles:,} triangles; 1 material; 1 mesh', flush=True)
    return target
