"""EVOLYS-only base/ORM finish bake; original UV0 normal detail is untouched."""
import bpy
import numpy as np


def bake_finish_atlas(asset, output):
    """Bake the ten source finishes into two 1024 maps on a second UV set.

    Each 256-pixel tile has an eight-pixel gutter and a 240-pixel interior.
    Base/rough micro-noise is conservatively area-filtered; the original normal
    image, UV0, geometry and material color-space roles are never resampled.
    The editable source has already been saved with its original materials.
    """
    resolution=1024
    materials=sorted({slot.material for obj in asset.objects if obj.type=='MESH' for slot in obj.material_slots if slot.material},key=lambda mat:mat.name)
    assert len(materials)==10 and all(mat.name.startswith(f'{i+1:02d} |') for i,mat in enumerate(materials))
    bounds={mat:np.array([[np.inf,np.inf],[-np.inf,-np.inf]]) for mat in materials}
    for obj in asset.objects:
        if obj.type!='MESH':continue
        uv=obj.data.uv_layers[0].data
        for face in obj.data.polygons:
            mat=obj.data.materials[face.material_index]
            for index in face.loop_indices:
                bounds[mat][0]=np.minimum(bounds[mat][0],uv[index].uv)
                bounds[mat][1]=np.maximum(bounds[mat][1],uv[index].uv)
    source=[]
    for name in ('evolys_surface','evolys_roughness'):
        pixels=np.empty(1024*1024*4,dtype=np.float32)
        bpy.data.images[name].pixels.foreach_get(pixels)
        source.append(pixels.reshape(1024,1024,4)[...,:3])
    # Source image samples are encoded sRGB; factors multiply linear light.
    albedo=np.where(source[0]<=.04045,source[0]/12.92,((source[0]+.055)/1.055)**2.4)
    rough=source[1]
    base=np.ones((resolution,resolution,4),dtype=np.float32)
    orm=np.ones_like(base)
    tile=resolution//4;padding=8*resolution//1024;span=tile-2*padding
    def sample(pixels,u,v):
        x=u*1024-.5;y=v*1024-.5
        ix=np.floor(x).astype(int);iy=np.floor(y).astype(int);fx=(x-ix)[...,None];fy=(y-iy)[...,None]
        return ((pixels[iy%1024,ix%1024]*(1-fx)+pixels[iy%1024,(ix+1)%1024]*fx)*(1-fy)
            +(pixels[(iy+1)%1024,ix%1024]*(1-fx)+pixels[(iy+1)%1024,(ix+1)%1024]*fx)*fy)
    for index,mat in enumerate(materials):
        lo,hi=bounds[mat];assert np.all(hi>lo)
        shader=mat.node_tree.nodes.get('Principled BSDF')
        color=np.array(shader.inputs['Base Color'].default_value[:3]);metal=shader.inputs['Metallic'].default_value;r=shader.inputs['Roughness'].default_value
        x=(index%4)*tile;y=(index//4)*tile
        grid=np.arange(tile)-padding+.5
        u,v=np.meshgrid(grid/span,grid/span)
        rgb=np.zeros((tile,tile,3));roughness=np.zeros((tile,tile))
        # Bounded area sampling suppresses downsampling aliases, not normals.
        for sy in range(4):
            for sx in range(4):
                us=lo[0]+(u+(sx/4-.375)/span)*(hi[0]-lo[0]);vs=lo[1]+(v+(sy/4-.375)/span)*(hi[1]-lo[1])
                rgb+=sample(albedo,us,vs)*color/16
                roughness+=sample(rough,us,vs)[...,1]*r/16
        base[y:y+tile,x:x+tile,:3]=np.where(rgb<=.0031308,rgb*12.92,1.055*np.maximum(rgb,0)**(1/2.4)-.055)
        orm[y:y+tile,x:x+tile,1]=roughness
        orm[y:y+tile,x:x+tile,2]=metal
    def image(name,pixels,srgb):
        im=bpy.data.images.new(name,width=resolution,height=resolution,alpha=True)
        im.colorspace_settings.name='sRGB' if srgb else 'Non-Color'
        im.pixels.foreach_set(pixels.ravel());im.filepath_raw=str(output/(name+'.png'));im.file_format='PNG';im.save();im.pack();return im
    base_image=image('evolys_finish_base',base,True);orm_image=image('evolys_finish_orm',orm,False)
    def material(name,alpha):
        mat=bpy.data.materials.new(name);mat.use_nodes=True;ns=mat.node_tree.nodes;links=mat.node_tree.links;shader=ns.get('Principled BSDF')
        uv=ns.new('ShaderNodeUVMap');uv.uv_map='FinishUV'
        tex=ns.new('ShaderNodeTexImage');tex.image=base_image;links.new(uv.outputs['UV'],tex.inputs['Vector']);links.new(tex.outputs['Color'],shader.inputs['Base Color'])
        tex=ns.new('ShaderNodeTexImage');tex.image=orm_image;links.new(uv.outputs['UV'],tex.inputs['Vector']);sep=ns.new('ShaderNodeSeparateColor');links.new(tex.outputs['Color'],sep.inputs[0]);links.new(sep.outputs[1],shader.inputs['Roughness']);links.new(sep.outputs[2],shader.inputs['Metallic'])
        uv=ns.new('ShaderNodeUVMap');uv.uv_map='UVMap';tex=ns.new('ShaderNodeTexImage');tex.image=bpy.data.images['evolys_normal'];links.new(uv.outputs['UV'],tex.inputs['Vector']);normal=ns.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.25;links.new(tex.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs[0],shader.inputs['Normal'])
        shader.inputs['Alpha'].default_value=alpha
        if alpha<1:mat.surface_render_method='DITHERED'
        return mat
    opaque=material('01 | baked opaque finishes',1);lens=material('10 | baked RMR coated lens',.13)
    for obj in asset.objects:
        if obj.type!='MESH':continue
        mesh=obj.data;uv=mesh.uv_layers[0].data;finish=mesh.uv_layers.new(name='FinishUV').data;indices=[]
        for face in mesh.polygons:
            mat=mesh.materials[face.material_index];index=materials.index(mat);lo,hi=bounds[mat]
            origin=np.array([(index%4)*tile+padding,(index//4)*tile+padding])
            for loop in face.loop_indices:finish[loop].uv=(origin+(np.array(uv[loop].uv)-lo)/(hi-lo)*span)/resolution
            indices.append(1 if mat.name.startswith('10 |') else 0)
        mesh.materials.clear();mesh.materials.append(opaque);mesh.materials.append(lens)
        for face,index in zip(mesh.polygons,indices):face.material_index=index
        mesh.uv_layers.active_index=0

