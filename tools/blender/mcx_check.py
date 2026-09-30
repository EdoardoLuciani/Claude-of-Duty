"""Geometry regression checks on the editable asset (requires Blender).
blender -b assets/weapons/mcx-virtus/mcx-virtus.blend \
  --python tools/blender/mcx_check.py
Checks are independent of the authoring script; no source rebuild or save.
"""
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

scene = bpy.context.scene
objects = bpy.data.objects
asset = bpy.data.collections['MCX VIRTUS | authored components']


def pose(clip, frame):
    for obj in asset.objects:
        if obj.animation_data:
            for track in obj.animation_data.nla_tracks:
                track.mute = track.name != clip
    scene.frame_set(frame)


def mesh_world(name):
    obj = objects[name].evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = obj.to_mesh()
    vertices = [obj.matrix_world @ v.co for v in mesh.vertices]
    faces = [tuple(p.vertices) for p in mesh.polygons]
    obj.to_mesh_clear()
    return vertices, faces


def bvh(name):
    vertices, faces = mesh_world(name)
    return BVHTree.FromPolygons(vertices, faces)


def tip_x():
    inverse = objects['MCX_RIG'].matrix_world.inverted()
    vertices = [inverse @ v for v in mesh_world('Curved trigger blade')[0]]
    bottom = min(v.z for v in vertices)
    tip = [v for v in vertices if v.z < bottom + .003]
    return sum(v.x for v in tip)/len(tip)


pose('Idle', 0)
rest_tip = tip_x()
blade_vertices = mesh_world('Curved trigger blade')[0]
belly = [v.x for v in blade_vertices if -.087 < v.z < -.070]
head = [v.x for v in blade_vertices if v.z > -.055]
assert sum(belly)/len(belly) < min(rest_tip, sum(head)/len(head)) - .006, 'trigger concavity must face muzzle (+X)'
assert len(objects['Curved trigger blade'].data.vertices) >= 80, 'smooth sampled blade, not old faceted wedge'
assert bvh('Curved trigger blade').overlap(bvh('Ambidextrous lower receiver')), 'trigger head must attach to receiver'
assert not bvh('Curved trigger blade').overlap(bvh('Sculpted trigger guard')), 'trigger must clear guard'
assert bvh('Length adjustment latch').overlap(bvh('Stock upper spine')), 'stock latch must attach to spine'
assert objects['Length adjustment latch'].parent == objects['stock_hinge']

for frame in range(13):
    pose('Fire', frame)
    blade = bvh('Curved trigger blade')
    assert blade.overlap(bvh('Ambidextrous lower receiver')), f'trigger detaches at Fire {frame}'
    assert not blade.overlap(bvh('Sculpted trigger guard')), f'trigger clips guard at Fire {frame}'
    assert not blade.overlap(bvh('Ergonomic pistol grip')), f'trigger clips grip at Fire {frame}'
    if frame == 2:
        assert tip_x() < rest_tip - .005, 'trigger must pull rearwards, not towards muzzle'
assert abs(tip_x() - rest_tip) < 1e-5, 'trigger returns to rest'

for frame in (0, 25, 60, 90, 120):
    pose('Stock_Fold', frame)
    assert bvh('Length adjustment latch').overlap(bvh('Stock upper spine')), f'latch detaches at fold {frame}'

pose('Idle', 0)
assert objects['receiver']['optic'] == 'ACOG 4x32 (TA31F / TA51)'
assert 'Compact optic housing' not in objects and 'Brightness dial' not in objects, 'old red dot removed'
for name in ['ACOG tapered prism housing', 'ACOG ocular', 'ACOG collector cradle', 'ACOG red fiber collector']:
    assert name in objects and objects[name].type == 'MESH', name
assert bvh('ACOG tapered prism housing').overlap(bvh('ACOG integral mounting foot')), 'scope attached to mount'
assert bvh('ACOG red fiber collector').overlap(bvh('ACOG collector cradle')), 'collector seated on cradle'
# The enlarged optic must not intersect the folded rear sight.
for name in ['ACOG tapered prism housing', 'ACOG ocular', 'ACOG ocular rubber rim']:
    assert not bvh(name).overlap(bvh('Folded backup sight base')), f'{name} clips rear sight'
sight = objects['SOCKET_sight'].matrix_world.translation
assert (sight - Vector((-.149, 0, .087))).length < 1e-6, 'sight socket at TA31F ocular axis'

# Independent exterior-dimension checks against the cited manufacturer specs.
# The TA31F height excludes the accessory TA51 shoe/knobs (see fidelity notes).
def extent(names):
    vertices = [v for name in names for v in mesh_world(name)[0]]
    return Vector(tuple(max(v[i] for v in vertices)-min(v[i] for v in vertices) for i in range(3)))

mount_prefixes = ('ACOG rail shoe', 'ACOG rail clamp', 'ACOG mount crossbolt',
                  'ACOG slotted thumbscrew', 'ACOG thumbscrew knurl')
optic = [o.name for o in asset.objects if o.type == 'MESH'
         and o.name.startswith('ACOG') and not o.name.startswith(mount_prefixes)]
size = extent(optic)
for actual, expected in zip(size, (.15189, .0508, .05842)):
    assert abs(actual-expected) <= .001, f'TA31F exterior spec: {size}'
suppressor = [o.name for o in asset.objects if o.type == 'MESH'
              and (o.name.startswith('Suppressor') or o.name == 'Recessed suppressor endcap')]
size = extent(suppressor)
for actual, expected in zip(size, (.236, .044, .044)):
    assert abs(actual-expected) <= .001, f'SRD762Ti exterior spec: {size}'
assert abs(extent(['Hollow octagonal VIRTUS handguard']).x-.2032) <= .001, '8-inch PDW nominal exterior length'
guard_shell = bvh('Hollow octagonal VIRTUS handguard')
assert guard_shell.ray_cast(Vector((.093,-.06,-.023)), Vector((0,1,0)))[0] is None, 'diagonal vent must be open'
assert guard_shell.ray_cast(Vector((.096,-.06,-.032)), Vector((0,1,0)))[0] is not None, 'diagonal vent retains its lower rim'
assert 'Stock lower skeleton strut' not in objects, 'factory telescoping stock, not skeleton approximation'
assert 'Magazine longitudinal rib' not in objects, 'MAG800 smooth upper side, not 5.56 lattice'
assert 'Mount locking ring' not in objects, 'direct-thread suppressor, not generic QD mount'
for o in asset.objects:
    if o.type == 'FONT':
        assert not any(label in o.data.body for label in ['VISUAL ASSET', 'PRISM OPTIC', 'SUPPRESSED']), o.name
print('MCX_GEOMETRY_OK: attached/clear moving parts, factory stock, TA31F and SRD762Ti exterior dimensions')
