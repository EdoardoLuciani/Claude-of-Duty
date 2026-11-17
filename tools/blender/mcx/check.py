"""Geometry regression checks on the editable asset (requires Blender).
blender -b assets/weapons/mcx-virtus/mcx-virtus.blend \
  --python tools/blender/mcx/check.py
Checks are independent of the authoring script; no source rebuild or save.
"""
import sys
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from attachment_source import surface

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
guard = bvh('Sculpted trigger guard')
assert not bvh('Curved trigger blade').overlap(guard), 'trigger must clear guard'
assert guard.ray_cast(Vector((-.037,-.05,-.068)), Vector((0,1,0)), .1)[0] is not None, 'front guard band reaches the well'
assert bvh('Length adjustment latch').overlap(bvh('Stock upper spine')), 'stock latch must attach to spine'
assert objects['Length adjustment latch'].parent == objects['stock_hinge']
rig_inverse = objects['MCX_RIG'].matrix_world.inverted()
stock_frame = surface([objects['Stock butt frame']], rig_inverse)
assert stock_frame.overlap(surface([objects['Rubber recoil pad']], rig_inverse)), 'recoil pad must attach to the stock'
assert stock_frame.ray_cast(Vector((-.395,-.05,-.043)), Vector((0,1,0)), .1)[0] is None, 'stock relief slot remains open'

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
assert not any(o.get('sharedOptic') or o.name.startswith(('ACOG','Suppressor')) for o in asset.objects), 'no integrated accessories'
assert not any(m.name.startswith('11 |') for o in asset.objects if o.type == 'MESH' for m in o.data.materials if m), 'no base glass'
sight = objects['SOCKET_sight'].matrix_world.translation
front = objects['SOCKET_front_post'].matrix_world.translation
assert abs(sight.y-front.y) < 1e-6 and abs(sight.z-front.z) < 1e-6, 'aligned base irons'
assert objects['Rear sight aperture'].parent == objects['IRON_sights']
assert objects['Front sight post'].parent == objects['IRON_sights']
assert all(o.parent == objects['IRON_sights_removed'] for o in asset.objects if o.name.startswith('Folded backup sight leaf'))
rear = bvh('Rear sight aperture')
for y,z in [(0,0),(.0015,0),(-.0015,0),(0,.0015),(0,-.0015)]:
    assert rear.ray_cast(sight+Vector((-.02,y,z)),Vector((1,0,0)),.04)[0] is None, 'open rear aperture'
assert rear.ray_cast(sight+Vector((-.02,.003,0)),Vector((1,0,0)),.04)[0] is not None, 'aperture rim'
post = mesh_world('Front sight post')[0]
assert abs(max(v.z for v in post)-sight.z) < 1e-6, 'post tip on sight axis'
for obj in asset.objects:
    if obj.type == 'MESH' and obj.parent not in (objects['IRON_sights'],objects['IRON_sights_removed']):
        assert bvh(obj.name).ray_cast(sight+Vector((.005,0,0)),Vector((1,0,0)),.37)[0] is None, ('obstructed iron line',obj.name)
# The bare muzzle has a real bore and the entire device is replaceable.
assert all(o.parent == objects['MUZZLE_device'] for o in asset.objects if o.name.startswith('Base muzzle '))
for obj in asset.objects:
    if obj.type == 'MESH' and obj.name.startswith(('Base muzzle ','Muzzle thread')):
        assert bvh(obj.name).ray_cast(Vector((.270,0,.009)),Vector((1,0,0)),.06)[0] is None, ('blocked bore',obj.name)
assert (objects['SOCKET_muzzle'].matrix_world.translation-Vector((.317,0,.009))).length < 1e-6

def extent(names):
    vertices = [v for name in names for v in mesh_world(name)[0]]
    return Vector(tuple(max(v[i] for v in vertices)-min(v[i] for v in vertices) for i in range(3)))

guard_size = extent(['Hollow octagonal VIRTUS handguard'])
assert abs(guard_size.x-.2032) <= .001, '8-inch PDW nominal exterior length'
assert guard_size.z < .054, 'short guard must not regain the deep lower skirt'
guard_shell = bvh('Hollow octagonal VIRTUS handguard')
assert guard_shell.ray_cast(Vector((.093,-.06,-.012)), Vector((0,1,0)))[0] is None, 'diagonal vent must be open'
assert guard_shell.ray_cast(Vector((.096,-.06,-.018)), Vector((0,1,0)))[0] is not None, 'diagonal vent retains its lower rim'
assert 'Stock lower skeleton strut' not in objects, 'factory telescoping stock, not skeleton approximation'
assert 'Mount locking ring' not in objects, 'direct-thread suppressor, not generic QD mount'
for o in asset.objects:
    if o.type == 'FONT':
        assert not any(label in o.data.body for label in ['VISUAL ASSET', 'PRISM OPTIC', 'SUPPRESSED']), o.name


def magazine_bounds(parent):
    inverse = objects['MCX_RIG'].matrix_world.inverted()
    vertices = [inverse @ v for o in objects[parent].children
                if o.type == 'MESH' and not o.name.startswith('Top round')
                for v in mesh_world(o.name)[0]]
    return (
        Vector(tuple(min(v[i] for v in vertices) for i in range(3))),
        Vector(tuple(max(v[i] for v in vertices) for i in range(3))),
    )


# Judge the seated silhouette relative to the grip heel, including the floorplate.
grip_heel = min(v.z for v in mesh_world('Ergonomic pistol grip')[0])
mag_bounds = magazine_bounds('magazine')
shell = bvh('Curved .300 magazine shell')
assert shell.ray_cast(Vector((0,-.05,-.120)), Vector((0,1,0)), .1)[0] is not None, 'exposed magazine shell is present'
neck_edges = [shell.ray_cast(Vector((-.06,0,z)), Vector((1,0,0)), .05)[0] for z in (-.075,-.088)]
assert all(edge is not None for edge in neck_edges) and abs(neck_edges[0].x-neck_edges[1].x) < .002, 'magazine neck blends into body'
drop = grip_heel - mag_bounds[0].z
assert .035 < drop < .046, ('magazine floorplate below grip heel', drop)
lip = bvh('Magazine well lip')
assert lip.ray_cast(Vector((0,0,-.085)), Vector((0,0,1)), .035)[0] is None, 'open magazine well lip'
assert lip.ray_cast(Vector((0,.020,-.085)), Vector((0,0,1)), .035)[0] is not None, 'lip retains its sidewall'
seating_parts = ('Flared magazine well','Magazine well lip','Sculpted trigger guard')
well_and_guard = surface([objects[name] for name in seating_parts], objects['MCX_RIG'].matrix_world.inverted())
for parent, frames in [('magazine',(20,25,29)), ('magazine_spare',(104,107,111,117))]:
    parts = [o for o in objects[parent].children if o.type == 'MESH']
    for frame in frames:
        pose('Reload_Empty', frame)
        assert not well_and_guard.overlap(surface(parts, objects['MCX_RIG'].matrix_world.inverted())), (parent, frame, 'magazine clips the well or guard')

for clip in ('Reload_Tactical','Reload_Empty'):
    pose(clip, 117)
    for regular, spare in zip(mag_bounds, magazine_bounds('magazine_spare')):
        assert (regular-spare).length < 1e-6, (clip, 'replacement seats with the same silhouette')
pose('Idle', 0)
for name in ['VIRTUS upper forging','Ambidextrous lower receiver','Ergonomic pistol grip']:
    obj = objects[name]
    assert any(p.use_smooth for p in obj.data.polygons), f'{name}: shaped normals'
    assert obj.modifiers['Machined edge radius'].segments >= 4, f'{name}: rounded transitions'
assert not any(o.name.startswith(('Upper machined shoulder','Receiver lower shoulder',
                                'Magazine well forging relief')) for o in asset.objects), 'no slab overlays'
# Local silhouette/contact regressions, NOT certified SIG dimensions.
assert -.151 < grip_heel < -.145, 'grip heel follows registered reference'
assert -.077 < min(v.z for v in mesh_world('Magazine well lip')[0]) < -.072, 'magwell not oversized below rail'
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
print('MCX_GEOMETRY_OK: moving parts clear/attached, rounded receiver/grip, seated magazine and open well, open aligned irons and base muzzle')

# The rotated adapter must actually seat on the upper handguard, not float
# above it to avoid the glove. Six rays span both screw stations on real faces.
pose('Idle', 0)
mount = objects['MOUNT_rail']
guard = bvh('Hollow octagonal VIRTUS handguard')
inward = (mount.matrix_world.to_3x3() @ Vector((0,0,1))).normalized()
for station in (-.020,.020):
    for across in (-.004,0,.004):
        origin = mount.matrix_world @ Vector((across,station,.005))
        hit = guard.ray_cast(origin,inward,.02)
        assert hit[0] is not None and .0065 < hit[3] <= .007, ('laser adapter backing not seated',station,across,hit[3])
for obj in asset.objects:
    if obj.type == 'MESH' and obj.name.startswith('Laser rail '):
        assert bvh(obj.name).ray_cast(sight,Vector((1,0,0)),1)[0] is None, ('laser hardware blocks ACOG',obj.name)

# Validate native hand controls, review skins and the hidden-magazine transition.
from mcx.review_hands import check_review_hands
check_review_hands()

# Actual shared rail attachment, independent of the optic catalog.
from tor_mini.mounts import check_laser_mount
check_laser_mount('mcx')

from mcx.fits import check_attachment_fits
check_attachment_fits()
