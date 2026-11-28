"""P320 procedural finishes and unique-UV atlas baking; no cached asset inputs."""
import bpy
from .surfaces import active, bake_mesh, build_surfaces, stash_sources

ATLAS_RESOLUTIONS = {'base': 1024, 'orm': 1024, 'normal': 1024, 'emission': 1024}
# Multisample cavity shading and sub-texel bump detail. Scalar finishes and
# unlit sight emission do not need extra samples.
ATLAS_SAMPLES = {'base': 4, 'orm': 1, 'normal': 4, 'emission': 1}

def build_source_materials(coords):
    def material(name, color, rough=.6, metal=0, grain=0):
        m = bpy.data.materials.new(name); m.use_nodes = True
        m.diffuse_color = (*color,1)
        n, l = m.node_tree.nodes, m.node_tree.links
        p = n.get('Principled BSDF'); p.inputs['Metallic'].default_value = metal
        p.inputs['Roughness'].default_value = rough
        uv = n.new('ShaderNodeTexCoord'); uv.object = coords
        noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 180
        noise.inputs['Detail'].default_value = 3; noise.inputs['Roughness'].default_value = .65
        l.new(uv.outputs['Object'], noise.inputs['Vector'])
        ramp = n.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = .2
        ramp.color_ramp.elements[0].color = (*(v*.95 for v in color),1)
        ramp.color_ramp.elements[1].position = .8
        ramp.color_ramp.elements[1].color = (*(v*1.04 for v in color),1)
        l.new(noise.outputs['Fac'],ramp.inputs[0]); l.new(ramp.outputs[0],p.inputs['Base Color'])
        rough_ramp = n.new('ShaderNodeMapRange')
        rough_ramp.inputs['From Min'].default_value = 0; rough_ramp.inputs['From Max'].default_value = 1
        rough_ramp.inputs['To Min'].default_value = rough-.075
        rough_ramp.inputs['To Max'].default_value = min(1,rough+.075)
        l.new(noise.outputs['Fac'],rough_ramp.inputs[0]); l.new(rough_ramp.outputs[0],p.inputs['Roughness'])
        micro = n.new('ShaderNodeTexNoise'); micro.inputs['Scale'].default_value = 4300
        micro.inputs['Detail'].default_value = 2.8; micro.inputs['Roughness'].default_value = .72
        l.new(uv.outputs['Object'],micro.inputs['Vector'])
        bump = n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = grain
        bump.inputs['Distance'].default_value = .00014
        l.new(micro.outputs['Fac'],bump.inputs['Height']); l.new(bump.outputs['Normal'],p.inputs['Normal'])
        # Faint cavity darkening baked explicitly into base. No drawn-on white edges.
        ao = n.new('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value = .004
        mix = n.new('ShaderNodeMixRGB'); mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = .32
        l.new(ramp.outputs[0],mix.inputs[1]); l.new(ao.outputs['Color'],mix.inputs[2])
        l.new(mix.outputs[0],p.inputs['Base Color'])
        return m

    nitron = material('Nitron | satin coated steel',(.041,.040,.042),.29,.48,.27)
    polymer = material('Frame | fine injection moulding',(.019,.018,.019),.63,0,.74)
    molding = next(n for n in polymer.node_tree.nodes if n.type=='VALTORGB')
    molding.inputs[0].links[0].from_node.inputs['Scale'].default_value=2150
    molding.color_ramp.elements[0].color=(.011,.011,.012,1)
    molding.color_ramp.elements[1].color=(.025,.024,.025,1)
    grip_finish(polymer)
    steel = material('Controls | blackened steel',(.046,.046,.049),.36,.47,.19)
    barrel_mat = material('Barrel | polished nitriding',(.061,.065,.070),.29,.72,.12)
    mag_mat = material('Magazine | blued stamped steel',(.033,.039,.044),.37,.75,.18)
    cavity = material('Recess | shadowed coating',(.007,.008,.009),.86,0,.12)
    mark = bpy.data.materials.new('Laser etching | subtle warm grey'); mark.use_nodes = True
    mark.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (.085,.084,.079,1)
    brass = material('Visible dummy round | brass',(.38,.22,.07),.33,1,.1)
    copper = material('Visible dummy round | copper',(.30,.105,.045),.32,1,.1)
    white = material('SIGLITE | white surround',(.68,.69,.63),.58,0,.05)

    return nitron, polymer, steel, barrel_mat, mag_mat, cavity, mark, brass, copper, white


def grip_finish(polymer):
    # Object-space rounded panel follows the grip rake, independent of mesh tessellation.
    n,l=polymer.node_tree.nodes,polymer.node_tree.links
    p=n.get('Principled BSDF'); coord=n.get('Texture Coordinate').outputs['Object']
    yz=n.new('ShaderNodeSeparateXYZ'); l.new(coord,yz.inputs[0])

    def calc(op,*inputs):
        node=n.new('ShaderNodeMath');node.operation=op
        for i,value in enumerate(inputs):
            if isinstance(value,(int,float)):node.inputs[i].default_value=value
            else:l.new(value,node.inputs[i])
        return node.outputs[0]

    y=calc('ADD',yz.outputs['Y'],calc('MULTIPLY_ADD',yz.outputs['Z'],-.24,.009))
    z=calc('ADD',yz.outputs['Z'],.0515)
    corner=n.new('ShaderNodeCombineXYZ')
    for i,axis,half in ((0,y,.0126),(1,z,.0234)):
        l.new(calc('MAXIMUM',calc('SUBTRACT',calc('ABSOLUTE',axis),half),0),corner.inputs[i])
    length=n.new('ShaderNodeVectorMath');length.operation='LENGTH';l.new(corner.outputs[0],length.inputs[0])
    mask=n.new('ShaderNodeMapRange');mask.interpolation_type='SMOOTHSTEP'
    l.new(length.outputs['Value'],mask.inputs['Value'])
    for key,value in [('From Min',.00345),('From Max',.0038),('To Min',1),('To Max',0)]:
        mask.inputs[key].default_value=value
    pebbles=n.new('ShaderNodeTexNoise');pebbles.inputs['Scale'].default_value=2000
    pebbles.inputs['Detail'].default_value=2.5;l.new(coord,pebbles.inputs['Vector'])
    ramp=n.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position=.30;ramp.color_ramp.elements[0].color=(.006,.0065,.007,1)
    ramp.color_ramp.elements[1].position=.72;ramp.color_ramp.elements[1].color=(.026,.028,.029,1)
    l.new(pebbles.outputs['Fac'],ramp.inputs[0])
    color=n.new('ShaderNodeMixRGB');l.new(mask.outputs[0],color.inputs[0])
    l.new(p.inputs['Base Color'].links[0].from_socket,color.inputs[1]);l.new(ramp.outputs[0],color.inputs[2])
    l.new(color.outputs[0],p.inputs['Base Color'])
    smooth=n.new('ShaderNodeMixRGB');l.new(mask.outputs[0],smooth.inputs[0])
    l.new(p.inputs['Roughness'].links[0].from_socket,smooth.inputs[1])
    l.new(calc('MULTIPLY_ADD',pebbles.outputs['Fac'],-.43,.94),smooth.inputs[2])
    l.new(smooth.outputs[0],p.inputs['Roughness'])
    bump=n.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.00050
    l.new(p.inputs['Normal'].links[0].from_socket,bump.inputs['Normal'])
    l.new(pebbles.outputs['Fac'],bump.inputs['Height']);l.new(mask.outputs[0],bump.inputs['Strength'])
    l.new(bump.outputs[0],p.inputs['Normal'])


def bake_atlas(output, asset, coords, weapon_meshes):
    scene = bpy.context.scene
    surfaces = build_surfaces(asset, weapon_meshes)
    receiver = bake_mesh(asset, [(low,) for low, _ in surfaces], coords, 'Isolated atlas receiver')
    donor = bake_mesh(asset, [high for _, high in surfaces], coords, 'Isolated atlas donor')
    originals = {obj: obj.hide_render for obj in [*weapon_meshes, *(low for low, _ in surfaces)]}
    for obj in originals:
        obj.hide_render = True
    atlas = {}
    for name, resolution in ATLAS_RESOLUTIONS.items():
        im = bpy.data.images.new('P320_' + name, width=resolution, height=resolution, alpha=False)
        im.generated_color = (.5,.5,1,1) if name == 'normal' else (0,0,0,1)
        im.colorspace_settings.name = 'sRGB' if name in ('base', 'emission') else 'Non-Color'
        atlas[name] = im
    bake = scene.render.bake
    bake.use_clear = False
    bake.margin = 4
    bake.cage_extrusion, bake.max_ray_distance = .0015, .0024
    all_mats = {m for obj in (receiver, donor) for m in obj.data.materials if m}
    # Separation is only for rays: finishes still use the undisplaced art coordinates.
    rewired = []
    for mat in all_mats:
        n, l = mat.node_tree.nodes, mat.node_tree.links
        texture_coords = n.get('Texture Coordinate')
        if texture_coords is None:
            continue
        original = texture_coords.outputs['Object']
        attribute = n.new('ShaderNodeAttribute')
        attribute.attribute_name = '_p320_bake_position'
        destinations = [link.to_socket for link in original.links]
        for socket in destinations:
            l.new(attribute.outputs['Vector'], socket)
        rewired.append((n, l, original, attribute, destinations))
    # Project the wordmark, traction and SIGLITE surfaces into the shared atlas.
    samples = scene.cycles.samples
    for name in atlas:
        scene.cycles.samples = ATLAS_SAMPLES[name]
        bake.margin = atlas[name].size[0] // 256
        for mat in all_mats:
            n, l = mat.node_tree.nodes, mat.node_tree.links
            p, out = n.get('Principled BSDF'), n.get('Material Output')
            target = n.get('ATLAS_TARGET') or n.new('ShaderNodeTexImage')
            target.name = 'ATLAS_TARGET'
            target.image = atlas[name]
            n.active = target
            if name == 'normal':
                l.new(p.outputs[0], out.inputs['Surface'])
                continue
            emit = n.get('BAKE_EMIT') or n.new('ShaderNodeEmission')
            emit.name = 'BAKE_EMIT'
            for link in list(emit.inputs[0].links):
                l.remove(link)
            if name == 'orm':
                pack = n.new('ShaderNodeCombineColor')
                pack.inputs[0].default_value = 1
                r, m = p.inputs['Roughness'], p.inputs['Metallic']
                if r.is_linked:
                    l.new(r.links[0].from_socket, pack.inputs[1])
                else:
                    pack.inputs[1].default_value = r.default_value
                pack.inputs[2].default_value = m.default_value
                l.new(pack.outputs[0], emit.inputs[0])
            else:
                socket = p.inputs['Base Color' if name == 'base' else 'Emission Color']
                if socket.is_linked:
                    l.new(socket.links[0].from_socket, emit.inputs[0])
                else:
                    strength = p.inputs['Emission Strength'].default_value if name == 'emission' else 1
                    emit.inputs[0].default_value = tuple(v * strength for v in socket.default_value[:3]) + (1,)
            l.new(emit.outputs[0], out.inputs['Surface'])
        # Keep roughness and metalness on the receiver so projected markings
        # do not overwrite the host material channels.
        active(receiver)
        bake.use_selected_to_active = name != 'orm'
        donor.select_set(bake.use_selected_to_active)
        bpy.ops.object.bake(type='NORMAL' if name == 'normal' else 'EMIT')
        im = atlas[name]
        im.filepath_raw = str(output / 'textures' / f'p320-{name}.png')
        im.file_format = 'PNG'
        im.save()
        im.pack()
        im.filepath = '//textures/p320-' + name + '.png'
    scene.cycles.samples = samples
    bake.use_selected_to_active = False
    for obj in (receiver, donor):
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(data)
    for obj, hidden in originals.items():
        obj.hide_render = hidden
    for n, l, original, attribute, destinations in rewired:
        n.remove(attribute)
        for socket in destinations:
            l.new(original, socket)
    for mat in all_mats:
        n = mat.node_tree.nodes
        mat.node_tree.links.new(n.get('Principled BSDF').outputs[0], n.get('Material Output').inputs[0])
    baked = bpy.data.materials.new('P320 | baked unique PBR')
    baked.use_nodes = True
    n, l = baked.node_tree.nodes, baked.node_tree.links
    p = n.get('Principled BSDF')
    for name, im in atlas.items():
        t = n.new('ShaderNodeTexImage')
        t.image = im
        if name == 'base':
            l.new(t.outputs[0], p.inputs['Base Color'])
        elif name == 'emission':
            l.new(t.outputs[0], p.inputs['Emission Color'])
            p.inputs['Emission Strength'].default_value = 1
        elif name == 'normal':
            norm = n.new('ShaderNodeNormalMap')
            l.new(t.outputs[0], norm.inputs['Color'])
            l.new(norm.outputs[0], p.inputs['Normal'])
        else:
            sep = n.new('ShaderNodeSeparateColor')
            l.new(t.outputs[0], sep.inputs[0])
            l.new(sep.outputs[1], p.inputs['Roughness'])
            l.new(sep.outputs[2], p.inputs['Metallic'])
    for surface, _ in surfaces:
        surface.data.materials.clear()
        surface.data.materials.append(baked)
        for poly in surface.data.polygons:
            poly.material_index = 0
    stash_sources(weapon_meshes)
