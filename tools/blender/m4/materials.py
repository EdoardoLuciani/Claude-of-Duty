"""Seeded shared detail atlas, A2 checkering and balanced receiver finish."""
import bpy
import numpy as np

def build_materials(output):
    OUT=output
    # Deterministic microstructure: three shared maps and one receiver albedo.
    # No duplicate arm maps.
    rng=np.random.default_rng(556);N=1024
    def field(grid):
        a=rng.random((grid,grid)).astype(np.float32);t=np.arange(N)*grid/N;i=t.astype(int);t=t-i;t=t*t*(3-2*t)
        return ((a[i[:,None]%grid,i[None,:]%grid]*(1-t[:,None])+a[(i[:,None]+1)%grid,i[None,:]%grid]*t[:,None])*(1-t[None,:])
          +(a[i[:,None]%grid,(i[None,:]+1)%grid]*(1-t[:,None])+a[(i[:,None]+1)%grid,(i[None,:]+1)%grid]*t[:,None])*t[None,:])
    def image(name,values,color=False):
        im=bpy.data.images.new(name,width=N,height=N,alpha=False);im.colorspace_settings.name='sRGB' if color else 'Non-Color'
        pixels=np.ones((N,N,4),dtype=np.float32);pixels[:,:,:3]=values if values.ndim==3 else values[:,:,None]
        im.pixels.foreach_set(pixels.ravel());im.filepath_raw=str(OUT/'textures'/f'{name}.png');im.file_format='PNG';im.save();im.pack();im.filepath='//textures/'+name+'.png';return im
    cloud=field(12)*.4+field(53)*.4+field(200)*.2;fine=rng.random((N,N)).astype(np.float32)
    height=field(230)*.65+fine*.35
    albedo=image('m4_surface',np.clip(.84+cloud*.12+fine*.025,0,1),True)
    rough=image('m4_roughness',np.clip(.84+cloud*.11+fine*.04,0,1))
    dx=(np.roll(height,-1,1)-np.roll(height,1,1))*.3;dy=(np.roll(height,-1,0)-np.roll(height,1,0))*.3
    normal=np.dstack((-dx,-dy,np.ones_like(dx)));normal/=np.linalg.norm(normal,axis=2,keepdims=True)
    # A2 side checkering is original baked microgeometry, not nine raised bars.
    # Reserve the left half of the shared normal atlas for its diamond panel.
    u=np.arange(N//2)[None,:]/(N//2);v=np.arange(N)[:,None]/N
    pyramid=np.maximum(0,1-(abs((u*36)%1-.5)*2+abs((v*48)%1-.5)*2))
    mask=np.clip(np.minimum(np.minimum((u-.05)*12,(.95-u)*12),np.minimum((v-.04)*12,(.96-v)*12)),0,1)
    h=pyramid*mask*.00018
    gx=(np.roll(h,-1,1)-np.roll(h,1,1))/(2*.048/(N//2));gy=(np.roll(h,-1,0)-np.roll(h,1,0))/(2*.063/N)
    patch=np.dstack((-gx,-gy,np.ones_like(gx)));patch/=np.linalg.norm(patch,axis=2,keepdims=True);normal[:,:N//2]=patch
    nmap=image('m4_normal',normal*.5+.5)
    # Selected balanced study: keep the receiver's mean tint, reduce cloudy albedo
    # variation to 25%. Work from the stored image pixels, as in the Blender study.
    receiver_pixels=np.array(albedo.pixels[:],dtype=np.float32).reshape((N,N,4))[:,:,:3]
    receiver_mean=receiver_pixels.reshape((-1,3)).mean(axis=0)
    receiver_albedo=image('m4_receiver_surface',receiver_mean+(receiver_pixels-receiver_mean)*.25,True)
    def material(name,color,metal=0,roughness=.6,detail=.2,surface=albedo):
        m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
        n,l=m.node_tree.nodes,m.node_tree.links;p=n.get('Principled BSDF')
        p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=roughness
        t=n.new('ShaderNodeTexImage');t.image=surface
        mix=n.new('ShaderNodeMix');mix.data_type='RGBA';mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[7].default_value=(*color,1)
        l.new(t.outputs[0],mix.inputs[6]);l.new(mix.outputs[2],p.inputs['Base Color'])
        t=n.new('ShaderNodeTexImage');t.image=rough;s=n.new('ShaderNodeSeparateColor');l.new(t.outputs[0],s.inputs[0])
        mul=n.new('ShaderNodeMath');mul.operation='MULTIPLY';mul.inputs[1].default_value=roughness;l.new(s.outputs[1],mul.inputs[0]);l.new(mul.outputs[0],p.inputs['Roughness'])
        t=n.new('ShaderNodeTexImage');t.image=nmap;nm=n.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=detail;l.new(t.outputs[0],nm.inputs['Color']);l.new(nm.outputs[0],p.inputs['Normal']);return m
    anodized=material('01 | black anodized receiver',(.041,.043,.046),1,.44,.08,receiver_albedo)
    fde=material('02 | RIS II FDE anodizing',(.235,.150,.084),1,.56,.16)
    polymer=material('03 | moulded black furniture',(.026,.029,.032),0,.80,.55)
    rubber=material('04 | SOPMOD rubber pad',(.022,.024,.026),0,.92,.9)
    steel=material('05 | phosphate steel',(.071,.078,.086),1,.56,.16)
    burnished=material('06 | restrained steel wear',(.115,.125,.137),1,.48,.10)
    magmat=material('07 | aluminum dry film',(.145,.155,.164),1,.67,.18)
    brass=material('08 | brass case',(.49,.285,.084),1,.35,.10)
    copper=material('09 | copper projectile',(.43,.16,.066),1,.39,.10)
    marking=material('10 | subdued markings',(.115,.122,.129),0,.72,.05)
    follower=material('11 | olive follower',(.085,.103,.056),0,.78,.3)
    # Approved #39ff14 paint: glTF/Principled inputs are linear, not sRGB bytes.
    green=tuple(((v/255+.055)/1.055)**2.4 if v/255>.04045 else v/255/12.92 for v in (57,255,20))
    paint=bpy.data.materials.new('12 | neon-green sight paint');paint.use_nodes=True;paint.diffuse_color=(*green,1)
    p=paint.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*green,1);p.inputs['Roughness'].default_value=.8
    p.inputs['Emission Color'].default_value=(*green,1);p.inputs['Emission Strength'].default_value=2
    return {
        'anodized': anodized, 'fde': fde, 'polymer': polymer, 'rubber': rubber,
        'steel': steel, 'burnished': burnished, 'magmat': magmat, 'brass': brass,
        'copper': copper, 'marking': marking, 'follower': follower, 'paint': paint,
    }
