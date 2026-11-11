"""Canonical standalone PM II LP / AI mount; no weapon product input.
Geometry, seeded maps and per-component UVs preserve the former AX338 assembly.
"""
from pathlib import Path
import math
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'assets/attachments/schmidt-bender-pm-ii'


def build():
    OUT.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene;scene.unit_settings.system='METRIC'
    C=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
    def xyz(v):return C@Vector(v)
    asset=bpy.data.collections.new('PM II | authored components');scene.collection.children.link(asset)
    def active(o):
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
    def empty(name,loc=(0,0,0),parent=None):
        o=bpy.data.objects.new(name,None);asset.objects.link(o);o.location=xyz(loc);o.parent=parent;return o
    optic=empty('SCOPE');body=optic
    # Three original packed 1024 maps shared across material slots, like M4/MCX.
    rng=np.random.default_rng(338);N=1024
    def field(grid):
        a=rng.random((grid,grid)).astype(np.float32);t=np.arange(N)*grid/N;i=t.astype(int);t=t-i;t=t*t*(3-2*t)
        return ((a[i[:,None]%grid,i[None,:]%grid]*(1-t[:,None])+a[(i[:,None]+1)%grid,i[None,:]%grid]*t[:,None])*(1-t[None,:])
          +(a[i[:,None]%grid,(i[None,:]+1)%grid]*(1-t[:,None])+a[(i[:,None]+1)%grid,(i[None,:]+1)%grid]*t[:,None])*t[None,:])
    cloud=field(12)*.4+field(53)*.4+field(200)*.2
    fine=rng.uniform(-1,1,(N,N));yy,xx=np.mgrid[0:N,0:N]
    scratches=((np.sin(xx*.27+yy*.008)> .997)&(fine>.35)).astype(float)
    def image(name,rgb,color=False):
        a=np.ones((N,N,4),dtype=np.float32)
        if rgb.ndim==2:a[:,:,:3]=rgb[:,:,None]
        else:a[:,:,:3]=rgb
        im=bpy.data.images.new(name,width=N,height=N,alpha=True);im.colorspace_settings.name='sRGB' if color else 'Non-Color';im.pixels.foreach_set(a.ravel())
        im.filepath_raw=str(OUT/(name+'.png'));im.file_format='PNG';im.save();im.pack();return im
    albedo=image('ax338_surface',np.clip(.86+cloud*.09+fine*.025+scratches*.08,0,1),True)
    rough=image('ax338_roughness',np.clip(.85+cloud*.09+fine*.06-scratches*.2,0,1))
    grain=np.sin(xx*2.1)*np.sin(yy*1.7)*.08+fine*.07
    normal_pixels=np.stack((.5+grain,.5+np.roll(grain,3,0),np.full_like(grain,1)),axis=2)
    # Retain the former shared atlas, including unused rifle finish quarters,
    # so the packed image bytes and the scope's coated-metal UV region stay exact.
    height=field(200)*.00018
    height[:,256:512]=(np.sin(xx[:,256:512]*1.7)*np.sin(yy[:,256:512]*1.7)+1)*.00008
    for x0,x1,span in [(0,256,.075),(256,512,.13)]:
        part=height[:,x0:x1];dx=(np.roll(part,-1,1)-np.roll(part,1,1))/(2*span/(x1-x0));dy=(np.roll(part,-1,0)-np.roll(part,1,0))/(2*span/N)
        vector=np.stack((-dx,-dy,np.ones_like(dx)),axis=2);vector/=np.linalg.norm(vector,axis=2,keepdims=True);normal_pixels[:,x0:x1]=vector*.5+.5
    normal=image('ax338_normal',normal_pixels)

    def material(name,color,metal=0,r=.6):
        m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*color,1)
        ns=m.node_tree.nodes;links=m.node_tree.links;shader=ns.get('Principled BSDF');shader.inputs['Base Color'].default_value=(*color,1);shader.inputs['Metallic'].default_value=metal;shader.inputs['Roughness'].default_value=r
        tex=ns.new('ShaderNodeTexImage');tex.image=albedo;mix=ns.new('ShaderNodeMix');mix.data_type='RGBA';mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[7].default_value=(*color,1);links.new(tex.outputs['Color'],mix.inputs[6]);links.new(mix.outputs[2],shader.inputs['Base Color'])
        t=ns.new('ShaderNodeTexImage');t.image=rough;sep=ns.new('ShaderNodeSeparateColor');links.new(t.outputs['Color'],sep.inputs[0]);mul=ns.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=r;links.new(sep.outputs[1],mul.inputs[0]);links.new(mul.outputs[0],shader.inputs['Roughness'])
        t=ns.new('ShaderNodeTexImage');t.image=normal;n=ns.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=.25;links.new(t.outputs['Color'],n.inputs['Color']);links.new(n.outputs[0],shader.inputs['Normal']);return m
    black=material('02 | black furniture',(.010,.012,.014),0,.76)
    steel=material('03 | coated steel',(.018,.021,.023),0,.52)
    bright=material('04 | exposed steel',(.17,.18,.18),1,.36)
    mark=material('09 | laser markings',(.60,.57,.47),0,.88)
    glass=material('10 | RMR coated lens',(.03,.10,.12),0,.14)
    glass.surface_render_method='DITHERED';glass.node_tree.nodes.get('Principled BSDF').inputs['Alpha'].default_value=.13
    glass.node_tree.nodes.get('Principled BSDF').inputs['Transmission Weight'].default_value=0

    # Geometry is authored in game metres, converted only at the Blender boundary.
    def finish(o,name,mat=black,parent=body,bevel=.0005,smooth=False):
        o.name=name
        for c in list(o.users_collection):c.objects.unlink(o)
        asset.objects.link(o)
        # Primitives are authored in world space; preserve it under the root.
        bpy.context.view_layer.update();world=o.matrix_world.copy();o.parent=parent
        if parent:o.matrix_parent_inverse=parent.matrix_world.inverted()
        o.matrix_world=world
        if mat:o.data.materials.append(mat)
        active(o);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        if bevel:
            m=o.modifiers.new('Machined edge radius','BEVEL');m.width=bevel;m.segments=3;bpy.ops.object.modifier_apply(modifier=m.name)
        if smooth:
            for poly in o.data.polygons:poly.use_smooth=True
        m=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');m.keep_sharp=True;bpy.ops.object.modifier_apply(modifier=m.name)
        return o

    def box(name,loc,dims,mat=black,parent=body,bevel=.0005):
        bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(loc));o=bpy.context.object;o.dimensions=(dims[0],dims[2],dims[1]);return finish(o,name,mat,parent,bevel)

    def mesh(name,verts,faces,mat=black,parent=body,bevel=.0005,smooth=False):
        d=bpy.data.meshes.new(name);d.from_pydata([xyz(v) for v in verts],[],faces);d.update();o=bpy.data.objects.new(name,d);asset.objects.link(o);active(o)
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
        return finish(o,name,mat,parent,bevel,smooth)

    def cyl(name,loc,r,length,mat=steel,parent=body,axis='Z',sides=32,bevel=.00015):
        bpy.ops.mesh.primitive_cylinder_add(vertices=sides,radius=r,depth=length,location=xyz(loc));o=bpy.context.object
        direction=xyz({'X':(1,0,0),'Y':(0,1,0),'Z':(0,0,1)}[axis]);o.rotation_euler=direction.to_track_quat('Z','Y').to_euler();return finish(o,name,mat,parent,bevel,True)

    def turned(name,x,y,section,mat,parent=None,sides=24):
        verts=[(x+math.sin(i*2*math.pi/sides)*r,y+math.cos(i*2*math.pi/sides)*r,z) for z,r in section for i in range(sides)]
        faces=[tuple(range(sides-1,-1,-1)),tuple(range((len(section)-1)*sides,len(section)*sides))]
        faces += [(j*sides+i,j*sides+(i+1)%sides,(j+1)*sides+(i+1)%sides,(j+1)*sides+i) for j in range(len(section)-1) for i in range(sides)]
        return mesh(name,verts,faces,mat,parent,.0001,True)

    def cut(o,cutter):
        bpy.context.view_layer.update();active(o);m=o.modifiers.new('True opening','BOOLEAN');m.operation='DIFFERENCE';m.object=cutter;bpy.ops.object.modifier_apply(modifier=m.name);bpy.data.objects.remove(cutter,do_unlink=True)


    def text(label,loc,size,side=-1,parent=body):
        bpy.ops.object.text_add(location=xyz(loc));o=bpy.context.object;o.data.body=label;o.data.size=size;o.data.extrude=0
        right=xyz((0,0,-side));up=xyz((0,1,0));o.rotation_euler=Matrix((right,up,right.cross(up))).transposed().to_euler()
        active(o);bpy.ops.object.convert(target='MESH');return finish(o,'Mark | '+label,mark,parent,0)

    def fastener(name,x,y,z,r=.0027,parent=body):
        o=cyl(name,(x,y,z),r,.002,bright,parent,'X',24)
        cut(o,cyl('CUT hex',(x,y,z),r*.52,.004,None,None,'X',6,0))
        return o

    # Older PM II LP 5-25x56, 417 mm overall / 34 mm central tube.
    # Its exact mount relief, turrets and hidden contours remain photo-inferred.
    axis=.159;rear=.087;front=rear-.417
    turned('PM II scope housing',0,axis,[(rear,.020),(rear-.006,.021),(rear-.064,.021),(rear-.081,.018),(-.150,.017),(-.265,.031), (front,.031)],black,optic,64)
    for z,r,length in [(.043,.022,.021),(.004,.018,.015),(-.320,.032,.009)]:
        cyl('Scope knurled ring',(0,axis,z),r,length,black,optic,'Z',64)
        for i in range(48):
            a=i*math.tau/48
            cyl('Ring grip ridge',(math.sin(a)*r,axis+math.cos(a)*r,z),.0006,length*.85,steel,optic,'Z',8,0)
    for z in (-.024,-.154):
        saddle=cyl('34 mm mount ring',(0,axis,z),.023,.019,black,optic,'Z',48)
        cut(saddle,cyl('CUT ring bore',(0,axis,z),.0172,.030,None,None,'Z',48,0))
        box('AI one-piece ring pedestal',(0,.137,z),(.037,.034,.028),black,optic,.0007)
        for side in (-1,1):
            box('Ring clamp ear',(side*.020,axis,z),(.007,.014,.023),black,optic,.0007)
            fastener('Ring clamp screw',side*.024,axis,z,.0028,optic)
    box('AI mount base',(0,.126,-.089),(.040,.011,.177),black,optic,.0007)
    for side in (-1,1):
        for z in (-.024,-.154):fastener('Mount rail nut',side*.021,.125,z,.004,optic)
    cyl('Elevation drum',(0,axis+.022,-.087),.020,.035,black,optic,'Y',48)
    cyl('Elevation cap',(0,axis+.041,-.087),.018,.006,black,optic,'Y',48)
    # Real relief on the controls; numeric typography/layout is inferred, not an
    # exact reticle/turret calibration or a claim of a particular specimen serial.
    for i in range(24):
        a=i*math.tau/24
        cyl('Elevation knurl',(math.sin(a)*.020,axis+.023,-.087+math.cos(a)*.020),.0007,.011,black,optic,'Y',8,0)
    for i in range(12):
        a=i*math.tau/12
        bpy.ops.object.text_add(location=xyz((math.sin(a)*.0203,axis+.029,-.087+math.cos(a)*.0203)))
        o=bpy.context.object;o.data.body=str(i*2);o.data.size=.0026;o.data.align_x='CENTER'
        right=xyz((math.cos(a),0,-math.sin(a)));up=xyz((0,1,0))
        o.rotation_euler=Matrix((right,up,right.cross(up))).transposed().to_euler()
        active(o);bpy.ops.object.convert(target='MESH');finish(o,'Elevation graduation',mark,optic,0)
    for side in (-1,1):
        cyl('Windage and parallax',(side*.025,axis,-.087),.016,.023,black,optic,'X',48)
        cyl('Turret cap',(side*.038,axis,-.087),.015,.004,black,optic,'X',48)
    for z,r in [(front-.0002,.028),(rear+.0002,.018)]:
        cyl('Recessed optical glass',(0,axis,z),r,.0005,glass,optic,'Z',64,0)
    for side in (-1,1):
        text('SCHMIDT & BENDER',(side*.0212,axis-.004,.058),.003,side,optic)
        for i in range(8):
            text(str(i*5),(side*.0379,axis+.009-i*.002,-.094),.0018,side,optic)
    # Source and runtime share identical UVs and atlas regions; never save an
    # untextured DCC source and unwrap only the GLB after saving it.
    for o in list(asset.objects):
        if o.type!='MESH':continue
        active(o)
        if not o.data.uv_layers:o.data.uv_layers.new(name='UVMap')
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.01);bpy.ops.object.mode_set(mode='OBJECT')
        x0,scale=.52,.47
        for loop in o.data.uv_layers.active.data:loop.uv.x=x0+loop.uv.x*scale

    # Match the former extraction's rail-contact transform, after source unwrap.
    mount=Vector((0,.089,.1205))
    transform=Matrix.Translation(-mount)
    for obj in optic.children:
        obj.data.transform(transform@obj.matrix_world)
        obj.matrix_world=Matrix.Identity(4)
    empty('MOUNT_base',parent=optic)
    sight=empty('SOCKET_sight',parent=optic)
    sight.location=transform@xyz((0,axis,rear))
    bpy.context.view_layer.update()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'scope.blend'),compress=True)
    meshes=[o for o in scene.objects if o.parent==optic and o.type=='MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:obj.select_set(True)
    bpy.context.view_layer.objects.active=meshes[0];bpy.ops.object.join()
    bpy.context.object.name='scope_mesh'
    bpy.ops.export_scene.gltf(filepath=str(OUT/'scope.glb'),export_format='GLB',
        export_animations=False,export_extras=True,export_yup=True,
        export_cameras=False,export_lights=False)
    for name in ('ax338_surface.png','ax338_roughness.png','ax338_normal.png'):
        (OUT/name).unlink(missing_ok=True)


if __name__=='__main__':build()
