"""Geometry regression checks on the editable asset (requires Blender).
blender -b assets/weapons/mcx-virtus/mcx-virtus.blend \
  --python tools/blender/mcx_check.py
Checks are independent of the authoring script; no source rebuild or save.
"""
import bpy
from mathutils import Vector
from mathutils.geometry import convex_hull_2d
from mathutils.bvhtree import BVHTree

scene = bpy.context.scene
objects = bpy.data.objects
asset = bpy.data.collections['MCX VIRTUS | authored components']


def pose(clip, frame):
    for obj in asset.objects:
        if obj.animation_data:
            for track in obj.animation_data.nla_tracks:
                track.mute = track.name != clip
    scene.frame_set(int(frame), subframe=frame % 1)


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
# Revised photo-inferred trigger envelope: the assembly was ~30 mm too low.
belly = [v.x for v in blade_vertices if -.060 < v.z < -.049]
head = [v.x for v in blade_vertices if v.z > -.040]
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
assert bvh('ACOG tapered prism housing').overlap(bvh('ACOG integral mounting foot')), 'housing attached to integral foot'
mount_shoe = bvh('ACOG rail shoe')
assert mount_shoe.overlap(bvh('ACOG integral mounting foot')), 'optic foot seated on TA51 shoe'
assert any(mount_shoe.overlap(bvh(o.name)) for o in asset.objects
           if o.name.startswith('Picatinny rail tooth')), 'TA51 shoe seated on rifle rail'
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
# Explicit, independently measured magazine convention; this does not infer
# Magpul's unpublished datum. Both seated magazines must have the same exterior.
def magazine_envelope(parent):
    vertices = [v for o in asset.objects if o.parent == objects[parent]
                and o.type == 'MESH' and 'Top round' not in o.name
                for v in mesh_world(o.name)[0]]
    # Remove the whole-rifle inspect/reload pose before comparing dimensions.
    inverse = objects['MCX_RIG'].matrix_world.inverted()
    local = [inverse @ v for v in vertices]
    points = [Vector((v.x,v.z)) for v in local]
    hull = [points[i] for i in convex_hull_2d(points)]
    best = None
    for i, a in enumerate(hull):
        u = (hull[(i+1)%len(hull)]-a).normalized(); v = Vector((-u.y,u.x))
        width = max(p.dot(u) for p in hull)-min(p.dot(u) for p in hull)
        height = max(p.dot(v) for p in hull)-min(p.dot(v) for p in hull)
        if best is None or width*height < best[0]: best = (width*height,max(width,height))
    return best[1], max(p.y for p in points)-min(p.y for p in points)

length, height = magazine_envelope('magazine')
assert abs(length-.1905) < .0001 and height <= .1905, f'MAG800 complete envelope: {length}, {height}'
pose('Reload_Tactical', 117)
spare_length, spare_height = magazine_envelope('magazine_spare')
assert abs(spare_length-length) < 1e-6 and abs(spare_height-height) < 1e-6, 'identical magazine exteriors'
pose('Idle', 0)
for name in ['VIRTUS upper forging','Ambidextrous lower receiver','Ergonomic pistol grip']:
    obj = objects[name]
    assert any(p.use_smooth for p in obj.data.polygons), f'{name}: shaped normals'
    assert obj.modifiers['Machined edge radius'].segments >= 4, f'{name}: rounded transitions'
assert not any(o.name.startswith(('Upper machined shoulder','Receiver lower shoulder',
                                'Magazine well forging relief')) for o in asset.objects), 'no slab overlays'
# Local silhouette/contact regressions, NOT certified SIG dimensions.
grip_vertices = mesh_world('Ergonomic pistol grip')[0]
assert -.148 < min(v.z for v in grip_vertices) < -.144, 'grip heel follows registered reference'
assert -.080 < min(v.z for v in mesh_world('Magazine well lip')[0]) < -.075, 'magwell not oversized below rail'
assert extent(['Ergonomic pistol grip']).y < .035, 'retain grip thickness budget'
assert abs(objects['SOCKET_magazine'].matrix_world.translation.z+.042) < 1e-6, 'revised seated-mag socket'
# Hooked latch outlines and bow replace the rectangular charging crossbar.
assert len(objects['Ambidextrous charging handle'].data.vertices) >= 24
assert len(objects['Charging latch'].data.vertices) >= 16
assert objects['Charging latch pivot'].parent == objects['charging_handle']
assert bvh('Ambidextrous charging handle').overlap(bvh('Charging handle stem')), 'charging bow attaches to stem'
for name in ['Charging latch','Charging latch.001']:
    assert bvh(name).overlap(bvh('Ambidextrous charging handle')), f'{name}: hooked onto bow'
assert bvh('Dust cover plate').overlap(bvh('Dust cover hinge')), 'open cover supported by hinge'
for frame in (129,145,151,157):
    pose('Reload_Empty', frame)
    assert bvh('Charging handle stem').overlap(bvh('VIRTUS upper forging')), f'stem supported during rack {frame}'
pose('Idle', 0)
# Conservative clearance certificates: disjoint mesh AABBs in rifle space
# guarantee separation, including full containment (BVH surface tests alone
# would miss that case). All tested components are rigid, so cache local verts.
stock_parts = [o for o in asset.objects if o.type == 'MESH'
               and (o.parent == objects['stock_hinge'] or o.name == 'Rear 1913 interface')]
charging_parts = [o for o in asset.objects if o.type == 'MESH' and o.parent == objects['charging_handle']]
charging_parts.sort(key=lambda o: o.name != 'Ambidextrous charging handle')
local_vertices = {}
for obj in stock_parts + charging_parts:
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    local_vertices[obj.name] = [v.co.copy() for v in mesh.vertices]
    evaluated.to_mesh_clear()

def local_bounds(obj, inverse):
    matrix = inverse @ obj.matrix_world
    vertices = [matrix @ v for v in local_vertices[obj.name]]
    return ([min(v[i] for v in vertices) for i in range(3)],
            [max(v[i] for v in vertices) for i in range(3)])

knuckle = mesh_world('Stock folding knuckle')[0]
cap = mesh_world('Folding hinge cap')[0]
assert abs(min(v.z for v in knuckle)+.023) < 1e-6, 'hinge lower end unchanged'
assert abs(max(v.z for v in knuckle)-min(v.z for v in cap)) < 1e-6, 'cap seated on hinge shoulder'
assert bvh('Stock folding knuckle').overlap(bvh('Stock upper spine')), 'hinge supports stock spine'
assert (objects['stock_hinge'].matrix_world.translation-Vector((-.183,.016,.007))).length < 1e-6, 'fold pivot unchanged'
minimum_separation = {'moving_stock':float('inf'),'rear_plate':float('inf')}
def stock_handle_clearance(label):
    inverse = objects['MCX_RIG'].matrix_world.inverted()
    stocks = [(o.name,local_bounds(o,inverse)) for o in stock_parts]
    charges = [(o.name,local_bounds(o,inverse)) for o in charging_parts]
    for s,(lo_s,hi_s) in stocks:
        for c,(lo_c,hi_c) in charges:
            separation = max(max(lo_s[i]-hi_c[i],lo_c[i]-hi_s[i]) for i in range(3))
            # The fixed rear plate already has a 0.5 mm gap. Keep its shape;
            # corrected moving stock/hinge hardware gets a >=1.9 mm margin.
            required = .0004 if s == 'Rear 1913 interface' else .0019
            assert separation >= required, f'{label}: {s} / {c} lacks {required*1000:.1f} mm conservative clearance ({separation*1000:.3f} mm)'
            group = 'rear_plate' if s == 'Rear 1913 interface' else 'moving_stock'
            minimum_separation[group] = min(minimum_separation[group],separation)

stock_handle_clearance('Idle')
# Entire clips at 120 Hz, including between authored/exported integer frames.
for clip,end in [('Reload_Empty',198),('Stock_Fold',120)]:
    for step in range(end*2+1):
        frame = step/2
        pose(clip,frame)
        stock_handle_clearance(f'{clip} {frame}')
# Also rack with the stock fully folded; this combination has no native clip.
pose('Stock_Fold',60)
folded_rotation = objects['stock_hinge'].rotation_euler.copy()
for step in range(129*2,157*2+1):
    pose('Reload_Empty',step/2)
    objects['stock_hinge'].rotation_euler = folded_rotation
    bpy.context.view_layer.update()
    stock_handle_clearance(f'folded rack {step/2}')
pose('Idle', 0)
print(f'MCX_STOCK_HANDLE_CLEARANCE_OK: moving stock/hinge >= {minimum_separation["moving_stock"]*1000:.3f} mm; fixed rear plate >= {minimum_separation["rear_plate"]*1000:.3f} mm; full clips/midframes/folded rack')
print(f'MCX_GEOMETRY_OK: moving parts clear/attached, rounded receiver/grip, MAG800 envelope {length*1000:.3f} mm, TA31F/SRD762Ti dimensions')
