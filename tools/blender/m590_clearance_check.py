"""Negative controls for the narrow M590 source-clearance exception.

Run on a fresh m590.blend; uses its actual evaluated glove/stock triangles.
"""
import sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/blender'))
from m590.clearance import RightGloveStockException

scene = bpy.context.scene
for obj in scene.objects:
    if obj.animation_data:
        obj.animation_data.action = None
        for track in obj.animation_data.nla_tracks:
            track.mute = track.name != 'Idle'
scene.frame_set(0)
bpy.context.view_layer.update()
rig = bpy.data.objects['M590_RIG']
ci = Matrix(((1,0,0),(0,0,1),(0,-1,0))).to_4x4()

def geometry(name):
    obj = bpy.data.objects[name]
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh(); mesh.calc_loop_triangles()
    transform = ci @ rig.matrix_world.inverted() @ evaluated.matrix_world
    vertices = [transform @ vertex.co for vertex in mesh.vertices]
    faces = [tuple(face.vertices) for face in mesh.loop_triangles]
    evaluated.to_mesh_clear()
    return vertices, faces

name = 'M590_right_Charcoal_woven_glove_skin'
vertices, faces = geometry(name)
stock_vertices, stock_faces = geometry('Conventional synthetic stock')
stock = BVHTree.FromPolygons(stock_vertices, stock_faces, all_triangles=True)
owners = [('Conventional synthetic stock', index) for index in range(len(stock_faces))]
overlaps = BVHTree.FromPolygons(vertices, faces, all_triangles=True).overlap(stock)
assert len(overlaps) == 4
exception = RightGloveStockException(ROOT / 'assets/player/arms/player-arms.blend')
exception.check(name, vertices, faces, overlaps, owners, stock)

def rejects(label, expected, mesh_name=name, points=vertices, triangles=faces, pairs=overlaps, surfaces=owners):
    try:
        exception.check(mesh_name, points, triangles, pairs, surfaces, stock)
    except AssertionError as error:
        assert expected in str(error), (label, 'unexpected rejection', str(error))
        print('M590_CLEARANCE_REJECTED:', label, str(error))
    else:
        raise AssertionError('exception incorrectly accepted ' + label)

# Same triangle IDs/region and approved source hash must NOT hide deeper contact.
deeper = [point.copy() for point in vertices]
for index in (1813, 1816, 1872, 1873):
    deeper[index] += Vector((0, .000020, 0))
rejects('20um deeper geometry with unchanged topology', 'penetration', points=deeper)
rejects('another right-hand surface', 'new right-skin', mesh_name='M590_right_Grained_suede_reinforcement_skin')
rejects('new glove triangle', 'new glove', pairs=[(775, overlaps[0][1])])
changed_owners = list(owners)
changed_owners[overlaps[0][1]] = ('590A1 receiver forging', 1154)
rejects('receiver contact', 'new stock/receiver/guard', surfaces=changed_owners)
outside = [point.copy() for point in vertices]
outside[1813].x += .001
rejects('contact outside approved region', 'region', points=outside)
changed = list(faces); changed[774] = tuple(reversed(changed[774]))
rejects('changed approved triangle winding', 'new glove contact triangle', triangles=changed)
changed = list(faces); changed[0] = tuple(reversed(changed[0]))
try:
    RightGloveStockException(exception.arms_path).check(name, vertices, changed, overlaps, owners, stock)
except AssertionError as error:
    assert 'topology' in str(error)
    print('M590_CLEARANCE_REJECTED: changed unrelated topology', str(error))
else:
    raise AssertionError('exception accepted changed unrelated topology')
print('M590_CLEARANCE_NEGATIVE_CONTROLS_OK: actual tiny contact accepted; deeper/new/outside contacts rejected')
