"""Shared Blender review-arm baking; no weapon geometry or runtime exports."""
import math
import bpy
from mathutils import Vector, Quaternion, Matrix

FPS=120

def eq(e):return Quaternion((1,0,0),e[0])@Quaternion((0,1,0),e[1])@Quaternion((0,0,1),e[2])

def author_review_hands(root,rig,hand_controls,all_parts,clips,*,basis,label):
    """Bake review-only player arms in the caller's weapon coordinate basis."""
    source_basis=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
    C=basis;CI=C.inverted()
    orientation=C@source_basis.inverted()
    scene=bpy.context.scene
    collection=bpy.data.collections.new(label+' | authored hands (shared appearance)');scene.collection.children.link(collection)
    with bpy.data.libraries.load(str(root/'assets/player/arms/player-arms.blend'),link=False) as (available,loaded):loaded.objects=list(available.objects)
    objects=[o for o in loaded.objects if o];source=next(o for o in objects if o.type=='ARMATURE')
    meshes=[o for o in objects if o.type=='MESH' and any(m.type=='ARMATURE' for m in o.modifiers)]
    arms={}
    for side in ('left','right'):
        arm=source.copy();arm.data=source.data.copy();arm.animation_data_clear();arm.name=label+'_arm_'+side;collection.objects.link(arm);arm.parent=rig;arm.matrix_parent_inverse=Matrix.Identity(4)
        arm.location=(0,0,0);arm.rotation_euler=orientation.to_euler();arm.scale=(-1,1,1) if side=='right' else (.97,.97,.97);arms[side]=arm
        for o in meshes:
            clone=o.copy();clone.data=o.data;clone.name=label+'_'+side+'_'+o.name;collection.objects.link(clone);clone.parent=arm;clone.matrix_parent_inverse=Matrix.Identity(4)
            clone.location=(0,0,0);clone.rotation_euler=(0,0,0);clone.scale=(1,1,1)
            for mod in clone.modifiers:
                if mod.type=='ARMATURE':mod.object=arm
    for o in objects:bpy.data.objects.remove(o,do_unlink=True)
    lengths=[[.045,.028,.022],[.049,.031,.023],[.046,.029,.022],[.038,.024,.020]];xs=[.0298,.0102,-.0104,-.0298]
    def mat(pos=(0,0,0),q=None,scale=(1,1,1)):return Matrix.LocRotScale(Vector(pos),q or Quaternion(),Vector(scale))
    def rotation(o):return (CI@o.rotation_quaternion.to_matrix()@C).to_quaternion()
    def game_matrices(side,bind=False):
        cs=hand_controls[side];mirror=-1 if side=='right' else 1;scale=.97 if side=='left' else 1
        wrist=Matrix.Identity(4) if bind else mat(CI@cs['wrist'].location,rotation(cs['wrist']));inner=wrist@mat(scale=(mirror*scale,scale,scale));out={'hand':wrist}
        for i in range(4):
            q=eq((0,-xs[i]*2.2,0)) if bind else rotation(cs[f'finger_{i}_root']);parent=inner@mat((xs[i],-.006,-.096),q)
            for j in range(3):
                q=Quaternion() if bind else rotation(cs[f'finger_{i}_{j}']);tr=(0,0,-lengths[i][j-1]) if j else (0,0,0)
                if j:out[f'finger_{i}_{j}_flex']=parent@mat(tr,Quaternion().slerp(q,.5))
                parent=parent@mat(tr,q);out[f'finger_{i}_{j}']=parent
        tq=eq((0,-.95,0)) if bind else rotation(cs['thumb_base']);out['thumb_base']=inner@mat((.037,-.009,-.040),tq);out['thumb_web']=inner@mat((.037,-.009,-.040),eq((0,-.95,0)).slerp(tq,.5));parent=out['thumb_base']
        for j in range(2):
            q=Quaternion() if bind else rotation(cs[f'thumb_{j}']);tr=(0,0,-.05) if j else (0,0,0)
            if j:out['thumb_1_flex']=parent@mat(tr,Quaternion().slerp(q,.5))
            parent=parent@mat(tr,q);out[f'thumb_{j}']=parent
        if bind:out['upper']=mat((0,0,.63*scale));out['fore']=mat((0,0,.3*scale))
        else:
            shoulder=Vector((-.29,-.04,.50) if side=='left' else (.075,-.04,.50));hand=wrist.translation;delta=hand-shoulder;d=max(.04,min(.627,delta.length));direction=delta.normalized()
            pole=Vector((-.4 if side=='left' else .4,-.7,.7));pole=(pole-direction*pole.dot(direction)).normalized();a=(.33**2+d*d-.30**2)/(2*d);h=math.sqrt(max(0,.33**2-a*a));elbow=shoulder+direction*a+pole*h
            for name,start,end in [('upper',shoulder,elbow),('fore',elbow,hand)]:
                z=(start-end).normalized();y=Vector((0,1,0));y=(y-z*y.dot(z)).normalized();x=y.cross(z);out[name]=mat(start,Matrix((x,y,z)).transposed().to_quaternion())
        return out
    bind={s:game_matrices(s,True) for s in arms};cm=C.to_4x4();cmi=source_basis.inverted().to_4x4()
    for name,info in clips.items():
        for o in all_parts:
            for track in o.animation_data.nla_tracks:track.mute=track.name!=name
        for arm in arms.values():
            arm.animation_data_create();arm.animation_data.action=bpy.data.actions.new(name+' | '+arm.name)
            for t in arm.animation_data.nla_tracks:t.mute=True
        for f in range(0,math.ceil(info['frames'][1])+1,2):
            scene.frame_set(f)
            for side,arm in arms.items():
                current=game_matrices(side);s=Matrix.Diagonal((-1,1,1,1) if side=='right' else (.97,.97,.97,1));transform=orientation.to_4x4()@s;desired={}
                for pb in arm.pose.bones:desired[pb.name]=transform.inverted()@(cm@current[pb.name]@bind[side][pb.name].inverted()@cmi)@s@pb.bone.matrix_local
                for pb in arm.pose.bones:
                    pb.rotation_mode='QUATERNION';basis=pb.bone.matrix_local.inverted()
                    if pb.parent:basis=basis@pb.parent.bone.matrix_local@desired[pb.parent.name].inverted()
                    pb.matrix_basis=basis@desired[pb.name]
                    for prop in ('location','rotation_quaternion','scale'):pb.keyframe_insert(prop,frame=f,group=pb.name)
        for arm in arms.values():
            ad=arm.animation_data;a=ad.action;t=ad.nla_tracks.new();t.name=name;st=t.strips.new(name,0,a);st.action_frame_start=0;st.action_frame_end=math.ceil(info['frames'][1]);st.extrapolation='HOLD';ad.action=None;t.mute=True
