"""Built attachment sources for weapon fit checks: one id -> .blend/datum table and loader.

Build the attachment first (`bun run assets`); checks read its editable `.blend`.
"""
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[2]
OPTICS = ('rmr', 'acog', 'scope')
SOURCES = {
    'rmr': ('trijicon-rmr/rmr.blend', 'MOUNT_base'),
    'acog': ('trijicon-acog/acog.blend', 'MOUNT_base'),
    'scope': ('schmidt-bender-pm-ii/scope.blend', 'MOUNT_base'),
    'laser': ('steiner-tor-mini/tor-mini.blend', 'SOCKET_mount'),
    'srd762ti': ('sig-srd762ti/suppressor.blend', 'SOCKET_mount'),
    'suppressor9mm': ('compact-9mm/suppressor9mm.blend', 'SOCKET_mount'),
    'suppressor338': ('suppressor-338/suppressor338.blend', 'SOCKET_mount'),
    'suppressor12g': ('12g-suppressor/suppressor12g.blend', 'SOCKET_mount'),
}


def named(objects, name):
    """The loaded object with this base name (Blender suffixes repeated loads)."""
    return next(o for o in objects if o.name.split('.')[0] == name)


def load(id, names=None):
    """Append a built attachment's objects (only `names`, if given) to the scene.
    Returns (objects, datum), where the datum is its weapon-mount base."""
    file, datum = SOURCES[id]
    path = ROOT/'assets/attachments'/file
    assert path.exists(), f'Build {id} before weapon fit checks: {path}'
    with bpy.data.libraries.load(str(path), link=False) as (source, loaded):
        loaded.objects = [n for n in source.objects if names is None or n in names]
    objects = [o for o in loaded.objects if o is not None]
    for obj in objects:
        bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.update()
    return objects, named(objects, datum)


def seat(id, mount, names=None):
    """Load an attachment and parent it under a weapon mount with its datum on the
    mount origin, so it follows the mount through posed clips. Returns its objects and wrapper."""
    objects, datum = load(id, names)
    wrapper = bpy.data.objects.new(f'fit check | {id}', None)
    bpy.context.scene.collection.objects.link(wrapper)
    wrapper.parent = mount
    wrapper.matrix_basis = datum.matrix_world.inverted()
    for obj in objects:
        if obj.parent is None:
            obj.parent = wrapper
    bpy.context.view_layer.update()
    seated = datum.matrix_world.translation-mount.matrix_world.translation
    assert seated.length < 1e-7, (id, 'datum off its weapon mount')
    return [wrapper, *objects]
