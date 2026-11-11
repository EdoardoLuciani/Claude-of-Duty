"""Standalone RM06/RM33. No generated weapon input; shared source geometry."""
import sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from rmr.geometry import build_rmr

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'assets/attachments/trijicon-rmr'
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.unit_settings.system='METRIC'
C=Matrix(((1,0,0),(0,0,-1),(0,1,0)))

def active(o):
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o

def empty(name,loc=(0,0,0),parent=None):
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o)
    o.location=C@Vector(loc);o.parent=parent;return o

root=empty('RMR')

def material(name,color,metal,roughness):
    m=bpy.data.materials.new(name);m.use_nodes=True
    shader=m.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value=(*color,1)
    shader.inputs['Metallic'].default_value=metal;shader.inputs['Roughness'].default_value=roughness
    return m

black=material('02 | anodized RMR housing',(.023,.026,.028),0,.76)
bright=material('04 | exposed steel',(.17,.18,.18),1,.36)
rubber=material('05 | rubber buttons',(.015,.017,.018),0,.9)
steel=material('03 | parkerized steel',(.045,.051,.052),.8,.52)
glass=material('10 | RMR coated lens',(.03,.10,.12),0,.14)
mark=material('09 | laser markings',(.60,.57,.47),0,.88)
glass.surface_render_method='DITHERED'
glass.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value=.13

def finish(o,name,mat,parent,bevel):
    o.name=name;o.parent=parent
    if mat:o.data.materials.append(mat)
    active(o);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Machined edge','BEVEL');mod.width=bevel;mod.segments=2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

def box(name,loc,dims,mat,parent,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=C@Vector(loc))
    o=bpy.context.object;o.dimensions=(dims[0],dims[2],dims[1])
    return finish(o,name,mat,parent,bevel)

def cyl(name,loc,r,length,mat,parent,axis='Z',sides=32,bevel=.00015):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides,radius=r,depth=length,location=C@Vector(loc))
    o=bpy.context.object;direction=C@Vector({'X':(1,0,0),'Y':(0,1,0),'Z':(0,0,1)}[axis])
    o.rotation_euler=direction.to_track_quat('Z','Y').to_euler()
    return finish(o,name,mat,parent,bevel)

def mesh(name,verts,faces,mat,parent,bevel):
    data=bpy.data.meshes.new(name);data.from_pydata([C@Vector(v) for v in verts],[],faces);data.update()
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o)
    return finish(o,name,mat,parent,bevel)

def cut(o,cutter):
    active(o);mod=o.modifiers.new('Machined opening','BOOLEAN');mod.operation='DIFFERENCE';mod.object=cutter
    bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)

def text(label,loc,size,side,parent):
    bpy.ops.object.text_add(location=C@Vector(loc));o=bpy.context.object
    o.data.body=label;o.data.size=size;o.data.extrude=.00002
    o.rotation_euler=(C@Matrix(((0,0,side),(0,1,0),(-side,0,0)))).to_euler()
    active(o);bpy.ops.object.convert(target='MESH');return finish(o,'Mark | '+label,mark,parent,0)

# A 23 mm see-through riser clears the M4's fixed front sight. Its rail-contact
# datum stays at zero; the same low RM33 geometry is used by the EVOLYS build.
for side in (-1,1):
    box('Riser side',(side*.010, .0115,0),(.006,.023,.045),black,root,.0008)
box('Riser top',(0,.021,0),(.026,.004,.045),black,root,.0007)
for z in (-.012,.012):
    cyl('Riser cross bolt',(0,.002,z),.002,.030,steel,root,'X',24)
sight_y=build_rmr(box,cyl,mesh,cut,text,root,.023,0,black,bright,rubber,steel,glass)
empty('MOUNT_base',parent=root)
empty('SOCKET_sight',(0,sight_y,-.018),root)
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'rmr.blend'))
# One rigid runtime assembly, batched by finish; retain the two named datums.
objects=[o for o in root.children if o.type=='MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in objects:o.select_set(True)
bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
bpy.context.object.name='rmr_mesh'
bpy.ops.export_scene.gltf(filepath=str(OUT/'rmr.glb'),export_format='GLB',export_animations=False,export_extras=True,export_yup=True)
