"""Built attachment sources for weapon fit checks: one id -> .blend table and loader.
Optics seat on `MOUNT_base`; rigid attachments on `SOCKET_mount`.

Build the attachment first (`bun tools/build-assets.ts`); checks read its editable `.blend`.
"""
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import picatinny

ROOT = Path(__file__).resolve().parents[2]
OPTICS = ('rmr', 'acog', 'scope', 'exps3')
SOURCES = {
    'rmr': 'trijicon-rmr/rmr.blend',
    'acog': 'trijicon-acog/acog.blend',
    'scope': 'schmidt-bender-pm-ii/scope.blend',
    'exps3': 'eotech-exps3-0/exps3-0.blend',
    'laser': 'steiner-tor-mini/tor-mini.blend',
    'handstop': 'handstop/handstop.blend',
    'srd762ti': 'sig-srd762ti/suppressor.blend',
    'suppressor9mm': 'compact-9mm/suppressor9mm.blend',
    'suppressor338': 'suppressor-338/suppressor338.blend',
    'suppressor12g': '12g-suppressor/suppressor12g.blend',
}
# Whole forward grooves per weapon fit; mirrors `fits.optic[id].railSlots` in
# src/weapons/defs.ts, which places the same optic at runtime.
RAIL_SLOTS = {'m4': {'scope': 7}, 'evolys': {'exps3': 3, 'acog': 6, 'scope': 6}}


def surface(objects, transform):
    """BVH of the evaluated meshes' rendered triangles in `transform` space (e.g. the
    inverted rig matrix). Triangles, not polygon fans, keep concave ngons open."""
    vertices, faces = [], []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        matrix = transform @ evaluated.matrix_world
        offset = len(vertices)
        vertices.extend(matrix @ v.co for v in mesh.vertices)
        faces.extend(tuple(offset + i for i in t.vertices) for t in mesh.loop_triangles)
        evaluated.to_mesh_clear()
    assert vertices, 'missing fit surfaces'
    return BVHTree.FromPolygons(vertices, faces, all_triangles=True)


def named(objects, name):
    """The loaded object with this base name (Blender suffixes repeated loads)."""
    return next(o for o in objects if o.name.split('.')[0] == name)


def load(id, names=None):
    """Append a built attachment's objects (only `names`, if given) to the scene.
    Returns (objects, datum), where the datum is its weapon-mount base."""
    path = ROOT/'.cache/blender/attachments'/SOURCES[id]
    assert path.exists(), f'Build {id} before weapon fit checks: {path}'
    with bpy.data.libraries.load(str(path), link=False) as (source, loaded):
        loaded.objects = [n for n in source.objects if names is None or n in names]
    objects = [o for o in loaded.objects if o is not None]
    roots = [o for o in objects if o.name.startswith('ATTACHMENT_')]
    if names is None and roots:
        # Keep the exported asset only, not bake donors or review props beside it.
        objects = [roots[0], *roots[0].children_recursive]
    for obj in objects:
        bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.update()
    return objects, named(objects, 'MOUNT_base' if id in OPTICS else 'SOCKET_mount')


def seat(id, mount, names=None, weapon=None):
    """Load an attachment and parent it under a weapon mount with its datum on the
    mount origin (or the weapon's selected rail slot), so it follows the mount through
    posed clips. Returns its objects and wrapper."""
    objects, datum = load(id, names)
    offset = Vector((0, RAIL_SLOTS.get(weapon, {}).get(id, 0)*picatinny.PITCH, 0))
    wrapper = bpy.data.objects.new(f'fit check | {id}', None)
    bpy.context.scene.collection.objects.link(wrapper)
    wrapper.parent = mount
    wrapper.matrix_basis = Matrix.Translation(offset) @ datum.matrix_world.inverted()
    for obj in objects:
        if obj.parent is None:
            obj.parent = wrapper
    bpy.context.view_layer.update()
    seated = datum.matrix_world.translation-mount.matrix_world @ offset
    assert seated.length < 1e-7, (id, 'datum off its selected rail slot')
    return [wrapper, *objects]
