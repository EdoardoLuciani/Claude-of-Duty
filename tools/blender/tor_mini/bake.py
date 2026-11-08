"""Native Cycles part-isolated bake for the freshly authored TOR Mini.

Source and target are both recipe products, never loaded from an older blend.
Opaque recessed window shares the atlas; no transmission/extra optical draw call.
"""
import math

import bpy
from mathutils import Vector

SIZE = 2048


def active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def join(objects,name):
    active(objects[0])
    for obj in objects:
        obj.select_set(True)
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    return obj


def hide_source(root):
    collection = bpy.data.collections.new('SOURCE_HIGH | editable detailed reference reconstruction')
    bpy.context.scene.collection.children.link(collection)
    for obj in [root,*root.children_recursive]:
        obj.name = 'HIGH_'+obj.name
        collection.objects.link(obj)
        for old in list(obj.users_collection):
            if old != collection:
                old.objects.unlink(obj)
    collection.hide_render = collection.hide_viewport = True


def bake_asset(output,root,source):
    targets = [o for o in root.children_recursive if o.type == 'MESH']
    sources = [o for o in source.children_recursive if o.type == 'MESH']
    bpy.context.view_layer.update()
    offsets = {}
    for i,obj in enumerate(targets):
        offsets[obj.name] = Vector(((i%10)*.1,(i//10)*.1,0))
        rest = obj.data.attributes.new('_rest','FLOAT_VECTOR','POINT')
        for vertex,item in zip(obj.data.vertices,rest.data):
            item.vector = obj.matrix_world @ vertex.co
        obj.location += offsets[obj.name]
    body = join(targets,'TOR_MINI_body')
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    mod = body.modifiers.new('Triangulate before tangent bake','TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=mod.name)
    body.data.update(calc_edges=True)
    body.data.validate(clean_customdata=False)
    assert len(body.data.polygons) <= 12000,len(body.data.polygons)
    while body.data.uv_layers:
        body.data.uv_layers.remove(body.data.uv_layers[0])
    body.data.uv_layers.new(name='AtlasUV')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.003)
    bpy.ops.object.mode_set(mode='OBJECT')
    # The two broad printed side panels need more area than buried clamp faces.
    uv = body.data.uv_layers.active.data
    rest = body.data.attributes['_rest'].data
    for poly in body.data.polygons:
        centre = sum((rest[i].vector for i in poly.vertices),Vector()) / len(poly.vertices)
        printed = abs(abs(centre.x)-.0123)<.0001 and -.019<centre.z<-.012
        weight = 2 if printed else 1
        for index in poly.loop_indices:
            uv[index].uv *= weight
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.pack_islands(rotate=True,margin_method='FRACTION',margin=.006)
    bpy.ops.object.mode_set(mode='OBJECT')
    for loop in uv:
        loop.uv = tuple(round(v*65536)/65536 for v in loop.uv)
    copies = []
    for obj in sources:
        copy = obj.copy()
        copy.data = obj.data.copy()
        copy.parent = None
        bpy.context.collection.objects.link(copy)
        transform = obj.matrix_world.copy()
        anchor = obj.get('receiver',obj.name.removeprefix('HIGH_'))
        assert anchor in offsets,anchor
        transform.translation += offsets[anchor]
        copy.matrix_world = transform
        copies.append(copy)
    donor = join(copies,'TEMP_BAKE_DONOR')
    mats = list(set(donor.data.materials))
    baked = bpy.data.materials.new('TOR Mini | opaque atlas PBR')
    baked.use_nodes = baked.use_backface_culling = True
    body.data.materials.clear()
    body.data.materials.append(baked)
    for poly in body.data.polygons:
        poly.material_index = 0
    n,l = baked.node_tree.nodes,baked.node_tree.links
    target = n.new('ShaderNodeTexImage')
    n.active = target
    images = {}
    for name,color in [('base-color',(.02,.025,.03,1)),('normal',(.5,.5,1,1)),('orm',(1,.5,1,1))]:
        image = bpy.data.images.new('tor-mini-'+name,width=SIZE,height=SIZE,alpha=False)
        image.colorspace_settings.name = 'sRGB' if name == 'base-color' else 'Non-Color'
        image.generated_color = color
        images[name] = image
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples,scene.cycles.seed = 16,7003
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = .001
    scene.render.bake.max_ray_distance = .002
    scene.render.bake.use_clear = False
    scene.render.bake.normal_space = 'TANGENT'
    # Explicit 12px island separation above accommodates 6px dilation on each
    # island. EXTEND avoids adjacency-dependent padding across exploded parts.
    scene.render.bake.margin = 6
    scene.render.bake.margin_type = 'EXTEND'
    for name,image in images.items():
        target.image = image
        for mat in mats:
            nodes,links = mat.node_tree.nodes,mat.node_tree.links
            p,out = nodes.get('Principled BSDF'),nodes.get('Material Output')
            if name == 'normal':
                links.new(p.outputs[0],out.inputs['Surface'])
                continue
            emit = nodes.new('ShaderNodeEmission')
            emit.name = 'TEMP_BAKE_EMIT'
            if name == 'base-color':
                socket = p.inputs['Base Color']
                if socket.is_linked:
                    links.new(socket.links[0].from_socket,emit.inputs[0])
                else:
                    emit.inputs[0].default_value = socket.default_value
            else:
                pack = nodes.new('ShaderNodeCombineColor')
                pack.name = 'TEMP_BAKE_PACK'
                pack.inputs[0].default_value = 1
                for i,key in [(1,'Roughness'),(2,'Metallic')]:
                    socket = p.inputs[key]
                    if socket.is_linked:
                        links.new(socket.links[0].from_socket,pack.inputs[i])
                    else:
                        pack.inputs[i].default_value = socket.default_value
                links.new(pack.outputs[0],emit.inputs[0])
            links.new(emit.outputs[0],out.inputs['Surface'])
        active(body)
        donor.select_set(True)
        print('TOR_MINI_BAKE',name,flush=True)
        bpy.ops.object.bake(type='NORMAL' if name == 'normal' else 'EMIT')
        image.filepath_raw = str(output/('tor-mini-'+name+'.png'))
        image.file_format = 'PNG'
        image.save()
        image.pack()
        for mat in mats:
            nodes,links = mat.node_tree.nodes,mat.node_tree.links
            links.new(nodes.get('Principled BSDF').outputs[0],nodes.get('Material Output').inputs['Surface'])
            for node in list(nodes):
                if node.name.startswith('TEMP_BAKE_'):
                    nodes.remove(node)
    bpy.data.objects.remove(donor,do_unlink=True)
    for vertex,item in zip(body.data.vertices,body.data.attributes['_rest'].data):
        vertex.co = item.vector
    body.data.attributes.remove(body.data.attributes['_rest'])
    body.data.update(calc_edges=True)
    body.data.validate(clean_customdata=False)
    body.data.update(calc_edges=True)
    body.data.name = 'TOR_MINI_atlas_mesh'
    n.remove(target)
    p = n.get('Principled BSDF')
    for name,image in images.items():
        tex = n.new('ShaderNodeTexImage')
        tex.image = image
        if name == 'base-color':
            l.new(tex.outputs[0],p.inputs['Base Color'])
        elif name == 'normal':
            normal = n.new('ShaderNodeNormalMap')
            l.new(tex.outputs[0],normal.inputs['Color'])
            l.new(normal.outputs[0],p.inputs['Normal'])
        else:
            separate = n.new('ShaderNodeSeparateColor')
            l.new(tex.outputs[0],separate.inputs[0])
            l.new(separate.outputs[1],p.inputs['Roughness'])
            l.new(separate.outputs[2],p.inputs['Metallic'])
    scene.render.bake.use_selected_to_active = False
    return {'triangles':len(body.data.polygons),'opaquePrimitives':1,'atlasSize':SIZE,
        'maps':['base-color','normal','orm'],'orm':'R=1 (no baked AO), G=roughness, B=metallic',
        'projectionMm':{'cage':1,'maxRay':2},'sourceParts':len(sources),
        'bake':'Exploded corresponding parts; native rest positions restored before export',
        'decodedRGBA8MiB':48,'withFullMipsMiB':64,
        'status':'Review candidate, not an in-engine material/performance acceptance'}
