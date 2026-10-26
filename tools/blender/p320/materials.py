"""P320 procedural finishes and unique-UV atlas baking; no cached asset inputs."""
import bpy
from .surfaces import active, build_surfaces, stash_sources
from .color_uv import COLOR_UV, layout_color

ATLAS_RESOLUTIONS = {'base': 1024, 'orm': 1024, 'normal': 1024, 'emission': 1024}

def build_source_materials(coords):
    def material(name, color, rough=.6, metal=0, grain=0, stipple=False):
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
        micro = n.new('ShaderNodeTexNoise'); micro.inputs['Scale'].default_value = 4300 if not stipple else 1700
        micro.inputs['Detail'].default_value = 2.8; micro.inputs['Roughness'].default_value = .72
        l.new(uv.outputs['Object'],micro.inputs['Vector'])
        bump = n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = grain
        bump.inputs['Distance'].default_value = .00014 if not stipple else .00065
        l.new(micro.outputs['Fac'],bump.inputs['Height']); l.new(bump.outputs['Normal'],p.inputs['Normal'])
        # Faint cavity darkening baked explicitly into base. No drawn-on white edges.
        ao = n.new('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value = .004
        mix = n.new('ShaderNodeMixRGB'); mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = .32
        l.new(ramp.outputs[0],mix.inputs[1]); l.new(ao.outputs['Color'],mix.inputs[2])
        l.new(mix.outputs[0],p.inputs['Base Color'])
        return m

    nitron = material('Nitron | satin coated steel',(.033,.036,.039),.53,0,.24)
    polymer = material('Frame | fine injection moulding',(.026,.028,.030),.72,0,.48)
    stipple = material('Grip | moulded pebbled texture',(.017,.019,.020),.86,0,.8,True)
    steel = material('Controls | blackened steel',(.041,.043,.045),.52,.38,.18)
    barrel_mat = material('Barrel | polished nitriding',(.061,.065,.070),.29,.72,.12)
    mag_mat = material('Magazine | blued stamped steel',(.033,.039,.044),.37,.75,.18)
    cavity = material('Recess | shadowed coating',(.007,.008,.009),.86,0,.12)
    mark = material('Laser etching | subtle warm grey',(.18,.18,.17),.65,.15,.08)
    brass = material('Visible dummy round | brass',(.38,.22,.07),.33,1,.1)
    copper = material('Visible dummy round | copper',(.30,.105,.045),.32,1,.1)
    white = material('SIGLITE | white surround',(.68,.69,.63),.58,0,.05)

    return nitron, polymer, stipple, steel, barrel_mat, mag_mat, cavity, mark, brass, copper, white

def bake_atlas(output, asset, weapon_meshes):
    scene = bpy.context.scene
    surfaces = build_surfaces(asset, weapon_meshes)
    layout_color(surfaces)
    atlas = {}
    for name, resolution in ATLAS_RESOLUTIONS.items():
        im = bpy.data.images.new('P320_' + name, width=resolution, height=resolution, alpha=False)
        im.generated_color = (.5,.5,1,1) if name == 'normal' else (0,0,0,1)
        im.colorspace_settings.name = 'sRGB' if name in ('base', 'emission') else 'Non-Color'
        atlas[name] = im
    bake = scene.render.bake
    bake.use_clear = False
    bake.margin = 4
    bake.use_selected_to_active = True
    bake.cage_extrusion = .0012
    bake.max_ray_distance = .0024
    all_mats = {slot.material for obj in weapon_meshes for slot in obj.material_slots if slot.material}
    # High-to-low projection includes the former lettering/traction geometry.
    # The emission map keeps the small sight dots in the SAME material section.
    for name in atlas:
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
        for surface, sources in surfaces:
            mesh = surface.data
            mesh.uv_layers.active_index = mesh.uv_layers.find(COLOR_UV) if name == 'base' else 0
            mesh.uv_layers.active.active_render = True
            active(surface)
            for source in sources:
                source.select_set(True)
            bpy.ops.object.bake(type='NORMAL' if name == 'normal' else 'EMIT')
        im = atlas[name]
        im.filepath_raw = str(output / 'textures' / f'p320-{name}.png')
        im.file_format = 'PNG'
        im.save()
        im.pack()
        im.filepath = '//textures/p320-' + name + '.png'
    bake.use_selected_to_active = False
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
            coordinates = n.new('ShaderNodeUVMap')
            coordinates.uv_map = COLOR_UV
            l.new(coordinates.outputs['UV'], t.inputs['Vector'])
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
        surface.data.uv_layers.active_index = 0
        surface.data.uv_layers[0].active_render = True
        surface.data.materials.clear()
        surface.data.materials.append(baked)
        for poly in surface.data.polygons:
            poly.material_index = 0
    stash_sources(weapon_meshes)
