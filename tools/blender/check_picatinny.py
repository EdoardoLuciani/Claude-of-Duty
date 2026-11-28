"""Check generated rail profiles and actual clamp meshes, without rebuilding/saving.
blender -b -t 2 --python-exit-code 1 --python tools/blender/check_picatinny.py

The inset solid detects penetration, not legitimate coplanar mating contact.
These are finite source-mesh checks, not manufacturing or continuous-motion proof.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0,str(Path(__file__).resolve().parent))
import attachment_source
import picatinny
from attachment_source import FOREGRIP_ADAPTER_SURFACES as FOREGRIP_RAIL, surface


def hit(tree, origin, direction):
    point=tree.ray_cast(Vector(origin),Vector(direction),.05)[0]
    assert point is not None,('missing rail surface',origin,direction)
    return point


def check_rail(tree, label):
    # Independent measurements from Figures 1/2, not assertions about helper data.
    for y in (-.0050038,.0050038):
        for x in (-.009,0,.009):
            assert abs(hit(tree,(x,y,.001),(0,0,-1)).z)<2e-6,(label,'top flat',x,y)
        for z,half in [(-.00125,.0106045),(-.0038,.0084428),(-.00445,.0078359)]:
            for side in (-1,1):
                point=hit(tree,(side*.018,y,z),(-side,0,0))
                assert abs(point.x-side*half)<2e-6,(label,'head/flank/neck',y,z,tuple(point))
    for y in (-.0100076,0,.0100076):
        assert abs(hit(tree,(0,y,.001),(0,0,-1)).z+.0029972)<2e-6,(label,'groove depth/pitch',y)
    print('PICATINNY_RAIL_OK',label,flush=True)


# The nominal rail, inset 20 micrometres to distinguish seating from penetration.
vertices,faces=[],[]
for outline,spans in [(picatinny.section(slot=True),[(-.09,.09)]),
                      (picatinny.section(),picatinny.lands(-.09,.09))]:
    outline=[(x-math.copysign(.00002,x),z-.00002 if z>=-.003 else z) for x,z in outline]
    for a,b in spans:
        v,f=picatinny.prism(outline,a+.00002,b-.00002);offset=len(vertices)
        vertices.extend(v);faces.extend(tuple(offset+i for i in p) for p in f)
gauge=BVHTree.FromPolygons(vertices,faces,all_triangles=False)
def check_clamp(id):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objects,datum=attachment_source.load(id)
    inverse=datum.matrix_world.inverted()
    if id=='laser':inverse=Matrix.Rotation(math.pi,4,'Y')@inverse
    meshes=[o for o in objects if o.type=='MESH']
    for obj in meshes:
        tree=surface([obj],inverse)
        assert not tree.overlap(gauge),(id,obj.name,'penetrates inset rail gauge')
    tree=surface(meshes,inverse)
    # Probe both actual saddle strips at land centres. A floating clamp fails too.
    half=picatinny.PITCH/2
    for y in ((-half,3*half) if id=='laser' else (-half,half)):
        for x in ((-.002,.002) if id=='laser' else (-.008,.008)):
            point=hit(tree,(x,y,-.0005),(0,0,1))
            assert abs(point.z)<2e-6,(id,'saddle not seated',x,y,tuple(point))
    print('PICATINNY_CLAMP_OK',id,'inset 3D slotted gauge and four saddle rays',flush=True)


errors=[]
for id in (*attachment_source.OPTICS,'laser'):
    try:check_clamp(id)
    except AssertionError as error:
        errors.append(str(error));print('PICATINNY_FAIL',error,flush=True)

WEAPONS=[
    ('m4a1-block-ii/m4a1-block-ii',('Upper receiver rail ',),('RIS II 1 ',),()),
    ('mcx-virtus/mcx-virtus',('Continuous top rail foot','Picatinny rail tooth'),('Laser rail adapter tooth','Laser rail adapter groove bed'),FOREGRIP_RAIL),
    ('sig-mpx/mpx',('Picatinny spine','Picatinny rail tooth'),('Laser rail adapter tooth','Laser rail adapter groove bed'),FOREGRIP_RAIL),
    ('p320-full-size/p320-full-size',(),('Frame | continuous Full-Size polymer shell',),()),
    ('fn-evolys-762/fn-evolys-762',('receiver_mesh',),('handguard_mesh',),()),
    ('m590/m590',('Optic Picatinny lug','Optic rail groove bed'),('Laser rail adapter tooth','Laser rail adapter groove bed'),()),
    ('ax338/ax338',('Continuous top rail','Rail tooth'),('Laser rail adapter tooth','Laser rail adapter groove bed'),FOREGRIP_RAIL),
]
for file,optic_names,rail_names,foregrip_names in WEAPONS:
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'.cache/blender/weapons'/(file+'.blend')))
    for obj in bpy.context.scene.objects:
        if obj.animation_data:
            obj.animation_data.action=None
            for track in obj.animation_data.nla_tracks:track.mute=track.name!='Idle'
    bpy.context.scene.frame_set(0);bpy.context.view_layer.update()
    for slot,names in [('optic',optic_names),('rail',rail_names),('foregrip',foregrip_names)]:
        if not names:continue
        mount=bpy.data.objects['MOUNT_'+slot]
        inverse=mount.matrix_world.inverted()
        if slot!='optic':inverse=Matrix.Rotation(math.pi,4,'Y')@inverse
        meshes=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.name.startswith(names)]
        try:check_rail(surface(meshes,inverse),file+' '+slot)
        except AssertionError as error:
            errors.append(str(error));print('PICATINNY_FAIL',error,flush=True)
assert not errors,errors
print('PICATINNY_INTERFACES_OK: optic, laser and underside rails; all shared clamps',flush=True)
