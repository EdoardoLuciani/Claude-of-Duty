"""Saved-source left glove/sleeve triangle clearance against actual weapon meshes.
Uses evaluated deformed skins and physical slot/wall geometry, not wrist proxies.
1 mm soft-contact allowance; reports intersections and nearest-surface depth.
Blender -b ax338.blend --python-exit-code 1 --python ... -- --out report.json
"""
import argparse
import json
import sys
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);p.add_argument('--clip',action='append');p.add_argument('--time',type=float)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);scene=bpy.context.scene
clips=json.loads(scene['clips']);asset=bpy.data.collections['AX338 | authored components']
def ancestor(o,name):
    while o:
        if o.name==name:return True
        o=o.parent
    return False
skins=[o for o in bpy.data.objects if o.type=='MESH' and ancestor(o,'AX338_arm_left')]
assert skins,'No actual left glove/sleeve skins'
weapons=[o for o in asset.objects if o.type=='MESH' and not any(ancestor(o,n) for n in ('magazine_round','magazine_spare_round','optic')) and not o.name.startswith('Mark |')]
def surface(o,deps):
    evaluated=o.evaluated_get(deps);m=evaluated.to_mesh()
    vertices=[evaluated.matrix_world@v.co for v in m.vertices];faces=[tuple(f.vertices) for f in m.polygons]
    tree=BVHTree.FromPolygons(vertices,faces)
    evaluated.to_mesh_clear();return vertices,faces,tree
maximum=0;violations=[];samples=0;overlaps=0
for clip,info in clips.items():
    if a.clip and clip not in a.clip:continue
    for o in bpy.data.objects:
        if o.animation_data:
            o.animation_data.action=None
            for t in o.animation_data.nla_tracks:t.mute=t.name!=clip
    # 30 Hz plus exact action/event boundaries; source stores 120 Hz controls.
    times=sorted(set([i/30 for i in range(int(info['duration']*30)+1)]+[info['duration']]+[e['time'] for e in info['events']]))
    if a.time is not None:times=[a.time]
    for time in times:
        frame=time*120;scene.frame_set(int(frame),subframe=frame-int(frame));bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get();samples+=1
        solids=[(o,*surface(o,deps)) for o in weapons if all(abs(v)>0.5 for v in o.matrix_world.to_scale())]
        for skin in skins:
            vertices,faces,tree=surface(skin,deps)
            for solid,_,_,target in solids:
                pairs=tree.overlap(target)
                if not pairs:continue
                overlaps+=len(pairs);indices=set(i for i,_ in pairs)
                candidates=set(v for i in indices for v in faces[i])
                probes=[vertices[v] for v in candidates]
                probes.extend(sum((vertices[v] for v in faces[i]),Vector())/len(faces[i]) for i in indices)
                depth=0;deepest=Vector()
                for point in probes:
                    result=target.find_nearest(point)
                    if result and result[0] is not None:
                        nearest,normal,_,distance=result
                        if (point-nearest).dot(normal)<0 and distance>depth:depth=distance;deepest=point.copy()
                maximum=max(maximum,depth)
                if depth>.001:violations.append({'clip':clip,'time':round(time,6),'skin':skin.name,'weapon':solid.name,'depth_mm':round(depth*1000,3),'triangle_pairs':len(pairs),'weapon_local':[round(v,6) for v in (solid.matrix_world.inverted()@deepest)]})
report={'samples':samples,'skin_meshes':[o.name for o in skins],'tolerance_mm':1,'maximum_depth_mm':maximum*1000,'surface_intersection_pairs':overlaps,'violations':violations}
a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='violations'}));print('Violations:',len(violations),violations[:8])
assert not violations,'Left glove/sleeve enters actual weapon geometry; inspect contact report'
