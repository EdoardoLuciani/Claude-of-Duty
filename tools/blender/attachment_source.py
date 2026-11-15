"""Built attachment sources for weapon fit checks: one id -> .blend table and loader.
Optics seat on `MOUNT_base`; rigid attachments on `SOCKET_mount`.

Build the attachment first (`bun run assets`); checks read its editable `.blend`.
"""
from pathlib import Path
import json
import subprocess

import bpy

ROOT = Path(__file__).resolve().parents[2]
OPTICS = ('rmr', 'acog', 'scope', 'exps3')
SOURCES = {
    'rmr': 'trijicon-rmr/rmr.blend',
    'acog': 'trijicon-acog/acog.blend',
    'scope': 'schmidt-bender-pm-ii/scope.blend',
    'exps3': 'eotech-exps3-0/exps3-0.blend',
    'laser': 'steiner-tor-mini/tor-mini.blend',
    'srd762ti': 'sig-srd762ti/suppressor.blend',
    'suppressor9mm': 'compact-9mm/suppressor9mm.blend',
    'suppressor338': 'suppressor-338/suppressor338.blend',
    'suppressor12g': '12g-suppressor/suppressor12g.blend',
}


def named(objects, name):
    """The loaded object with this base name (Blender suffixes repeated loads)."""
    return next(o for o in objects if o.name.split('.')[0] == name)


def load(id, names=None):
    """Append a built attachment's objects (only `names`, if given) to the scene.
    Returns (objects, datum), where the datum is its weapon-mount base."""
    path = ROOT/'assets/attachments'/SOURCES[id]
    assert path.exists(), f'Build {id} before weapon fit checks: {path}'
    with bpy.data.libraries.load(str(path), link=False) as (source, loaded):
        loaded.objects = [n for n in source.objects if names is None or n in names]
    objects = [o for o in loaded.objects if o is not None]
    if id == 'exps3':
        # The saved scene also contains high-poly bake donors, not runtime geometry.
        root = named(objects, 'ATTACHMENT_exps3')
        objects = [root, *root.children_recursive]
    for obj in objects:
        bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.update()
    return objects, named(objects, 'MOUNT_base' if id in OPTICS else 'SOCKET_mount')


def check_seating(surface, frame):
    """Probe real saddle faces from just below the rail top, above the clamp lips."""
    from mathutils import Vector
    inverse = frame.inverted()
    up = (frame.to_3x3() @ Vector((0,0,1))).normalized()
    for x in (-.008,.008):
        for y in (-.0050038,.0050038):
            point = surface.ray_cast(frame @ Vector((x,y,-.0005)),up,.002)[0]
            assert point is not None and abs((inverse @ point).z)<2e-6, ('unseated saddle',x,y,point)


def optic_fits(weapon):
    """Read owned runtime fit data, rather than duplicating rail-slot choices here."""
    data=subprocess.check_output(['bun','-e',
        "import { WEAPON_DEFS } from './src/weapons/defs.ts'; console.log(JSON.stringify(WEAPON_DEFS))"],cwd=ROOT)
    return json.loads(data)[weapon]['fits']['optic']


def seat(id, mount, names=None, rail_slots=0):
    """Load an attachment and parent it under a weapon mount with its datum on the
    mount origin, so it follows the mount through posed clips. Returns its objects and wrapper."""
    objects, datum = load(id, names)
    wrapper = bpy.data.objects.new(f'fit check | {id}', None)
    bpy.context.scene.collection.objects.link(wrapper)
    wrapper.parent = mount
    from mathutils import Matrix
    import picatinny
    wrapper.matrix_basis = Matrix.Translation((0,rail_slots*picatinny.PITCH,0)) @ datum.matrix_world.inverted()
    for obj in objects:
        if obj.parent is None:
            obj.parent = wrapper
    bpy.context.view_layer.update()
    from mathutils import Vector
    expected = mount.matrix_world @ Vector((0,rail_slots*picatinny.PITCH,0))
    seated = datum.matrix_world.translation-expected
    assert seated.length < 1e-7, (id, 'datum off its selected rail slot')
    return [wrapper, *objects]
