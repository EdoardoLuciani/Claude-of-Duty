"""Native EXPS3 high-to-low atlas bake; inputs are freshly authored scene objects."""
import math

import bpy
from mathutils import Vector


BAKED_DETAILS = ('Rear cast brand', 'Hood brand ', 'Printed mark ', 'Battery polarity ',
    'Warning label ', 'Laser warning ', 'NV moulded legend', 'DOWN index ',
    'RIGHT index ', 'DOWN rotation ', 'RIGHT rotation ', 'DOWN moulded ', 'RIGHT moulded ')


def active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def join(objects, name):
    active(objects[0])
    for obj in objects:
        obj.select_set(True)
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    return obj


def triangles(objects):
    total = 0
    for obj in objects:
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def prepare_source(root):
    collection = bpy.data.collections.new('SOURCE_HIGH | editable bake authority')
    bpy.context.scene.collection.children.link(collection)
    for obj in [root,*root.children_recursive]:
        obj.name = 'HIGH_'+obj.name
        collection.objects.link(obj)
        for old in list(obj.users_collection):
            if old != collection:
                old.objects.unlink(obj)
    collection.hide_render = collection.hide_viewport = True


def detail_anchor(name):
    if name.startswith(('Hood brand ','Printed mark ','Warning label ','Laser warning ')) or name.endswith(' white rotation arrow'):
        return 'Protective bent-metal hood | 1.8mm wall'
    if name.startswith('Rear cast '):
        return 'Rear electronics cover'
    if name.startswith('Battery polarity '):
        return 'Scalloped battery cap'
    if name.startswith('NV moulded legend'):
        return 'NV rubber key'
    for control in ('DOWN','RIGHT'):
        if name.startswith(control+' moulded '):
            return control+' domed recessed dial'
        if name.startswith((control+' index ',control+' rotation ')):
            return 'Protective bent-metal hood | 1.8mm wall'
    if name.endswith(' moulded arrow'):
        return name.removesuffix(' moulded arrow')+' rubber key'
    if name.endswith(' seat'):
        return name.removesuffix(' seat')+' head'
    if name.endswith(' Torx socket floor'):
        return name.removesuffix(' Torx socket floor')+' head'
    raise ValueError('No bake receiver for '+name)


def bake_asset(output, root, high):
    high_objects = [o for o in high.children_recursive if o.type == 'MESH']
    high_triangles = triangles(high_objects)
    objects = [o for o in root.children_recursive if o.type == 'MESH']
    for obj in list(objects):
        if obj.name.startswith(BAKED_DETAILS) or obj.name.endswith((' moulded arrow',' white rotation arrow',' seat')):
            objects.remove(obj)
            bpy.data.objects.remove(obj,do_unlink=True)
    glass_objects = [o for o in objects if o.name.startswith('OPTIC_glass_')]
    body_objects = [o for o in objects if o not in glass_objects]
    for obj in glass_objects:
        bpy.data.objects.remove(obj,do_unlink=True)
    # Keep the approved optical geometry AND its split normals exactly, not a
    # coarse pane whose changed normals would visibly change the refraction.
    glass_objects = []
    for obj in high_objects:
        if 'OPTIC_glass_' not in obj.name:
            continue
        copy = obj.copy()
        copy.data = obj.data.copy()
        bpy.context.collection.objects.link(copy)
        transform = obj.matrix_world.copy()
        copy.parent = root
        copy.matrix_world = transform
        glass_objects.append(copy)
    # Explode corresponding source/target parts for projection only. This prevents
    # adjacent rings, panes and intersecting housings contaminating each other's bake.
    offsets = {}
    for i,obj in enumerate(body_objects):
        offset = Vector(((i%12)*.18,(i//12)*.18,0))
        offsets[obj.name] = offset
        rest = obj.data.attributes.new('_atlas_rest','FLOAT_VECTOR','POINT')
        for vertex,value in zip(obj.data.vertices,rest.data):
            value.vector = obj.matrix_world @ vertex.co
        weight = obj.data.attributes.new('_atlas_weight','FLOAT','FACE')
        density = 4 if obj.name.startswith('Protective bent-metal hood') else 3 if obj.name == 'Rear electronics cover' else .4 if obj.name == 'Electronics lower housing' else 1
        for value in weight.data:
            value.value = density
        obj.location += offset
    body = join(body_objects,'EXPS3_body')
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    glass = join(glass_objects,'EXPS3_glass')
    active(body)
    modifier = body.modifiers.new('Triangulate before tangent bake','TRIANGULATE')
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    low_triangles = triangles([body,glass])
    print('EXPS3_LOW_MESH',low_triangles,flush=True)
    assert low_triangles <= 12000, low_triangles

    # One unique atlas; preserve authored split normals, not averaged smooth shading.
    while body.data.uv_layers:
        body.data.uv_layers.remove(body.data.uv_layers[0])
    body.data.uv_layers.new(name='AtlasUV')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.006)
    bpy.ops.object.mode_set(mode='OBJECT')
    # Allocate more atlas area to readable printed panels, not buried housing faces.
    uv = body.data.uv_layers.active.data
    for polygon,weight in zip(body.data.polygons,body.data.attributes['_atlas_weight'].data):
        for index in polygon.loop_indices:
            uv[index].uv *= math.sqrt(weight.value)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.pack_islands(rotate=True,margin=.006)
    bpy.ops.object.mode_set(mode='OBJECT')
    for loop in body.data.uv_layers.active.data:
        loop.uv = tuple(round(v*65536)/65536 for v in loop.uv)

    # A temporary joined donor leaves every original high component editable.
    copies = []
    for obj in high_objects:
        if 'OPTIC_glass_' in obj.name:
            continue
        transform = obj.matrix_world.copy()
        copy = obj.copy()
        copy.data = obj.data.copy()
        copy.parent = None
        bpy.context.collection.objects.link(copy)
        name = obj.name.removeprefix('HIGH_')
        anchor = name if name in offsets else detail_anchor(name)
        transform.translation += offsets[anchor]
        copy.matrix_world = transform
        copies.append(copy)
    donor = join(copies,'TEMP_BAKE_DONOR')
    materials = list({mat for mat in donor.data.materials if mat})
    baked = bpy.data.materials.new('EXPS3 | baked opaque PBR atlas')
    baked.use_nodes = baked.use_backface_culling = True
    body.data.materials.clear()
    body.data.materials.append(baked)
    for polygon in body.data.polygons:
        polygon.material_index = 0
    nodes,links = baked.node_tree.nodes,baked.node_tree.links
    target = nodes.new('ShaderNodeTexImage')
    nodes.active = target
    images = {}
    for name,size in [('base-color',2048),('normal',2048),('orm',1024)]:
        image = bpy.data.images.new('exps3-'+name,width=size,height=size,alpha=False)
        image.colorspace_settings.name = 'sRGB' if name == 'base-color' else 'Non-Color'
        # Neutral gutters, not white garbage around black silhouette/UV borders.
        image.generated_color = {'normal':(.5,.5,1,1),
            'base-color':(.025,.030,.037,1),'orm':(1,.5,.8,1)}[name]
        images[name] = image
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.cycles.seed = 330
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = .0015
    scene.render.bake.max_ray_distance = .003
    scene.render.bake.use_clear = False
    scene.render.bake.normal_space = 'TANGENT'
    for name,image in images.items():
        target.image = image
        scene.render.bake.margin = 6 if name != 'orm' else 3
        for mat in materials:
            n,l = mat.node_tree.nodes,mat.node_tree.links
            p,out = n.get('Principled BSDF'),n.get('Material Output')
            if name == 'normal':
                l.new(p.outputs[0],out.inputs['Surface'])
                continue
            emit = n.new('ShaderNodeEmission')
            emit.name = 'TEMP_BAKE_EMIT'
            if name == 'base-color':
                socket = p.inputs['Base Color']
                if socket.is_linked:
                    l.new(socket.links[0].from_socket,emit.inputs[0])
                else:
                    emit.inputs[0].default_value = socket.default_value
            else:
                pack = n.new('ShaderNodeCombineColor')
                pack.name = 'TEMP_BAKE_PACK'
                pack.inputs[0].default_value = 1
                for index,key in [(1,'Roughness'),(2,'Metallic')]:
                    socket = p.inputs[key]
                    if socket.is_linked:
                        l.new(socket.links[0].from_socket,pack.inputs[index])
                    else:
                        pack.inputs[index].default_value = socket.default_value
                l.new(pack.outputs[0],emit.inputs[0])
            l.new(emit.outputs[0],out.inputs['Surface'])
        active(body)
        donor.select_set(True)
        print('EXPS3_BAKE',name,flush=True)
        bpy.ops.object.bake(type='NORMAL' if name == 'normal' else 'EMIT')
        image.filepath_raw = str(output/('exps3-'+name+'.png'))
        image.file_format = 'PNG'
        image.save()
        image.pack()
        for mat in materials:
            n,l = mat.node_tree.nodes,mat.node_tree.links
            l.new(n.get('Principled BSDF').outputs[0],n.get('Material Output').inputs['Surface'])
            for node in list(n):
                if node.name.startswith('TEMP_BAKE_'):
                    n.remove(node)
    bpy.data.objects.remove(donor,do_unlink=True)
    # Restore exact stored float positions, not subtraction of metre-sized offsets.
    for vertex,rest in zip(body.data.vertices,body.data.attributes['_atlas_rest'].data):
        vertex.co = rest.vector
    for name in ('_atlas_rest','_atlas_weight'):
        body.data.attributes.remove(body.data.attributes[name])
    body.data.update()
    nodes.remove(target)
    p = nodes.get('Principled BSDF')
    for name,image in images.items():
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = image
        if name == 'base-color':
            links.new(tex.outputs[0],p.inputs['Base Color'])
        elif name == 'normal':
            normal = nodes.new('ShaderNodeNormalMap')
            links.new(tex.outputs[0],normal.inputs['Color'])
            links.new(normal.outputs[0],p.inputs['Normal'])
        else:
            separate = nodes.new('ShaderNodeSeparateColor')
            links.new(tex.outputs[0],separate.inputs[0])
            links.new(separate.outputs[1],p.inputs['Roughness'])
            links.new(separate.outputs[2],p.inputs['Metallic'])
    scene.render.bake.use_selected_to_active = False
    return {'highSourceTriangles':high_triangles,'targetTriangles':low_triangles,
        'bodyPrimitive':'EXPS3_body','glassPrimitive':'EXPS3_glass',
        'atlas':{'baseColor':[2048,2048],'normal':[2048,2048],'orm':[1024,1024]},
        'decodedTextureBytesRGBA8':sum(i.size[0]*i.size[1]*4 for i in images.values()),
        'textureMemoryNote':'36MiB before mips (~48MiB with full mips), versus8MiB/10.67MiB for the former two1K source maps; no GPU compression or FPS claim.',
        'packing':'ORM: R=1 (unoccluded), G=roughness, B=metallic; no baked studio illumination',
        'projectionMm':{'cage':1.5,'maxRay':3},
        'projection':'Corresponding parts exploded for bake only; exact stored native positions restored before save/export.',
        'sourceRetained':'Hidden SOURCE_HIGH collection; factory-empty recipe, not an old blend input',
        'boundsNote':'Baked cap polarity mark no longer adds0.14mm of physical width; nominal body width58.4mm.'}
