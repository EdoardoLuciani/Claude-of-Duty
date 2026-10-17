"""P320 procedural finishes and unique-UV atlas baking; no cached asset inputs."""
import bpy

def build_source_materials(coords):
    materials = []
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
        materials.append(m)
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

    return materials, (nitron, polymer, stipple, steel, barrel_mat, mag_mat, cavity, mark, brass, copper, white)

def bake_atlas(output, weapon_meshes, materials, tritium):
    scene = bpy.context.scene
    bake_meshes=[o for o in weapon_meshes if not o.name.startswith('Mark |') and o.data.materials[0]!=tritium]
    atlas={}
    for name,color in [('base',True),('orm',False),('normal',False)]:
        im=bpy.data.images.new('P320_'+name,width=1024,height=1024,alpha=False)
        im.generated_color=(.5,.5,1,1) if name=='normal' else (1,1,1,1)
        im.colorspace_settings.name='sRGB' if color else 'Non-Color';atlas[name]=im
    scene.render.bake.use_clear=False;scene.render.bake.margin=3
    # Emission bake preserves the authored base and packed metallic/roughness,
    # without baking studio illumination. Normal bake includes micro-bump.
    all_mats=materials+[tritium]
    for name in ('base','orm','normal'):
        for mat in all_mats:
            n,l=mat.node_tree.nodes,mat.node_tree.links;p=n.get('Principled BSDF');out=n.get('Material Output')
            target=n.get('ATLAS_TARGET') or n.new('ShaderNodeTexImage');target.name='ATLAS_TARGET';target.image=atlas[name];n.active=target
            if name=='normal':l.new(p.outputs[0],out.inputs['Surface']);continue
            emit=n.get('BAKE_EMIT') or n.new('ShaderNodeEmission');emit.name='BAKE_EMIT'
            if name=='base':
                socket=p.inputs['Base Color']
                if socket.is_linked:l.new(socket.links[0].from_socket,emit.inputs[0])
                else:emit.inputs[0].default_value=socket.default_value
            else:
                pack=n.new('ShaderNodeCombineColor');pack.inputs[0].default_value=1
                r=p.inputs['Roughness'];m=p.inputs['Metallic']
                if r.is_linked:l.new(r.links[0].from_socket,pack.inputs[1])
                else:pack.inputs[1].default_value=r.default_value
                pack.inputs[2].default_value=m.default_value
                l.new(pack.outputs[0],emit.inputs[0])
            l.new(emit.outputs[0],out.inputs['Surface'])
        bpy.ops.object.select_all(action='DESELECT')
        bake_meshes[0].select_set(True)
        bpy.context.view_layer.objects.active=bake_meshes[0]
        for o in bake_meshes:o.select_set(True)
        bpy.ops.object.bake(type='NORMAL' if name=='normal' else 'EMIT')
        im=atlas[name];im.filepath_raw=str(output/'textures'/f'p320-{name}.png');im.file_format='PNG';im.save()
    for mat in all_mats:mat.node_tree.links.new(mat.node_tree.nodes.get('Principled BSDF').outputs[0],mat.node_tree.nodes.get('Material Output').inputs[0])
    for name,im in atlas.items():
        im.pack();im.filepath='//textures/p320-'+name+'.png'
    # Standard glTF-compatible PBR shader, shared by every non-emissive component.
    baked=bpy.data.materials.new('P320 | baked unique PBR');baked.use_nodes=True
    n,l=baked.node_tree.nodes,baked.node_tree.links;p=n.get('Principled BSDF')
    for name in ('base','orm','normal'):
        t=n.new('ShaderNodeTexImage');t.image=atlas[name]
        if name=='base':l.new(t.outputs[0],p.inputs['Base Color'])
        elif name=='normal':
            norm=n.new('ShaderNodeNormalMap');l.new(t.outputs[0],norm.inputs['Color']);l.new(norm.outputs[0],p.inputs['Normal'])
        else:
            sep=n.new('ShaderNodeSeparateColor');l.new(t.outputs[0],sep.inputs[0]);l.new(sep.outputs[1],p.inputs['Roughness']);l.new(sep.outputs[2],p.inputs['Metallic'])
    for o in weapon_meshes:
        if o.data.materials[0]==tritium or o.name.startswith('Mark |'):continue
        o.data.materials.clear();o.data.materials.append(baked)
        for poly in o.data.polygons:poly.material_index=0
