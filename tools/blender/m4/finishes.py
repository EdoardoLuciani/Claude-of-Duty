"""Export-only exact per-corner finishes; the editable source keeps all materials."""
import bpy


def consolidate_finishes(asset, output):
    sources = {m for obj in asset.objects if obj.type == 'MESH'
               for m in obj.data.materials if m}
    assert len(sources) == 12
    factors = {}
    for source in sources:
        nodes = source.node_tree.nodes
        shader = nodes.get('Principled BSDF')
        paint = source.name.startswith('12 |')
        tint = (shader.inputs['Base Color'].default_value[:] if paint else
                next(n for n in nodes if n.type == 'MIX').inputs[7].default_value[:])
        roughness = (.8 if paint else next(n for n in nodes if n.type == 'MATH').inputs[1].default_value)
        strength = (0 if paint else next(n for n in nodes if n.type == 'NORMAL_MAP').inputs['Strength'].default_value)
        # Role: ordinary finish = 0, receiver-only albedo = 1, emissive paint = 2.
        role = 2 if paint else 1 if source.name.startswith('01 |') else 0
        factors[source] = (tint, (roughness, shader.inputs['Metallic'].default_value, strength, role))

    material = bpy.data.materials.new('M4 | unified opaque finishes')
    material.use_nodes = True
    material['m4FinishData'] = 'UV1 roughness/metalness; UV2 normalStrength/role'
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    tex = nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images['m4_surface']
    color = nodes.new('ShaderNodeVertexColor'); color.layer_name = 'FinishColor'
    mix = nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1
    links.new(tex.outputs['Color'], mix.inputs[6]); links.new(color.outputs['Color'], mix.inputs[7])
    links.new(mix.outputs[2], shader.inputs['Base Color'])
    tex = nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images['m4_roughness']
    sep = nodes.new('ShaderNodeSeparateColor'); links.new(tex.outputs['Color'], sep.inputs[0])
    links.new(sep.outputs['Green'], shader.inputs['Roughness'])
    shader.inputs['Metallic'].default_value = 1
    tex = nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images['m4_normal']
    nm = nodes.new('ShaderNodeNormalMap'); links.new(tex.outputs['Color'], nm.inputs['Color'])
    links.new(nm.outputs[0], shader.inputs['Normal'])
    # Carry the original receiver image through a standard texture slot. The
    # weapon-local physical node graph selects it only on role=1 and emits only
    # role=2; no extra image/atlas, sampling-resolution loss or strength baking.
    tex = nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images['m4_receiver_surface']
    links.new(tex.outputs['Color'], shader.inputs['Emission Color'])
    shader.inputs['Emission Strength'].default_value = 1

    for mesh in {obj.data for obj in asset.objects if obj.type == 'MESH'}:
        old = list(mesh.materials)
        colors = mesh.color_attributes.new(name='FinishColor', type='FLOAT_COLOR', domain='CORNER')
        uv0 = mesh.uv_layers.active
        mesh.uv_layers.new(name='FinishFactors')
        mesh.uv_layers.new(name='FinishDetail')
        colors = mesh.color_attributes['FinishColor']
        mesh.color_attributes.active_color = colors
        for face in mesh.polygons:
            tint, data = factors[old[face.material_index]]
            for loop in face.loop_indices:
                colors.data[loop].color = tint
                mesh.uv_layers['FinishFactors'].data[loop].uv = (data[0], 1-data[1])
                mesh.uv_layers['FinishDetail'].data[loop].uv = (data[2], 1-data[3])
            face.material_index = 0
        mesh.uv_layers.active = uv0
        mesh.materials.clear(); mesh.materials.append(material)
        mesh.update()
