"""Build the MCX visual asset from Python, never from a previous .blend/GLB.

blender -b --python-exit-code 1 --python tools/blender/mcx/build.py
Optional: -- --output /absolute/directory --render --quick

See tools/blender/mcx/README.md for the editing/build process.
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys

import bpy

# Blender does not add the --python script's directory to Python's import path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mcx.animations import FPS, build_animations, restore_rest, select_clip
from mcx.export import export_asset, prepare_surfaces
from mcx.geometry import build_geometry
from mcx.finishes import FINISH_LOOKUP_SIZE
from mcx.materials import TEXTURE_SIZE, build_materials
from mcx.review_hands import author_review_hands
from mcx.studio import build_studio

ROOT = Path(__file__).resolve().parents[3]


def build(output, render=False, quick=False):
    output.mkdir(parents=True, exist_ok=True)
    (output / 'textures').mkdir(exist_ok=True)
    if render:
        (output / 'renders').mkdir(exist_ok=True)

    # Ignore startup-file objects, animation state and previous datablock names.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.render.fps = FPS
    scene.world = bpy.data.worlds.new('World')

    materials = build_materials(output)
    asset, parts = build_geometry(materials)
    prepare_surfaces(asset)
    rest, clips = build_animations(parts)
    cameras = [(name,camera.name) for name,camera in build_studio(quick)]

    scene['clips'] = json.dumps(clips)
    scene['README'] = (
        'Generated MCX preview. Edit tools/blender/mcx/, not this file. '
        'Select matching NLA track names on all rigid parts to preview a clip.'
    )
    for name, info in clips.items():
        for event in info['events']:
            scene.timeline_markers.new(
                name + ' / ' + event['event'], frame=round(event['time'] * FPS)
            )
    select_clip(parts, clips, 'Idle')
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'mcx-virtus.blend'))

    restore_rest(parts, rest)
    stats = export_asset(asset, parts, output)
    manifest = {
        'asset': 'MCX VIRTUS .300 BLK',
        'optic': bpy.data.objects['receiver']['optic'],
        'units': 'metres',
        'blender_forward': '+X',
        'gltf_up': '+Y',
        'gltf_forward': '+X',
        'gltf_ejection': '+Z',
        'clips': clips,
        'stats': stats,
        'textures': {
            'resolution': TEXTURE_SIZE,
            'finish_lookup_resolution': FINISH_LOOKUP_SIZE,
            'packed_in_blend': True,
            'embedded_in_glb': True,
        },
        'notes': [
            'Generated from tools/blender/mcx/. Python is the authoring authority.',
            'Reference-backed visual exterior, not manufacturing geometry or licensed SIG art.',
            'Named sockets and rigid-part clips; hands, audio and live casing physics are runtime-owned.',
            'Review-only shared skins bake actual runtime poses at 120 Hz in the editable blend, never the weapon GLB.',
            'Visibility is authored CONSTANT; motion LINEAR at 60 Hz. Stock Actions export, no GLB rewriting.',
            'Export-only corner pigment and scalar finish lookup; UV0 albedo/normal detail retained. Roughness grain reduced to its mean.',
            'One opaque material; MCX adapter selects exact fine/polymer/rubber/fiber normal strengths and fiber emission from UV1 finish identity. Lens remains separate.',
        ],
    }
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    # Sample the freshly exported model through the real runtime, then reopen
    # the untouched editable source. Review geometry never enters the GLB cook.
    subprocess.run(['bun',str(Path(__file__).with_name('runtime-hands.ts')),str(output)],cwd=ROOT,check=True)
    bpy.ops.wm.open_mainfile(filepath=str(output/'mcx-virtus.blend'))
    author_review_hands(ROOT,output)
    bpy.ops.wm.save_as_mainfile(filepath=str(output/'mcx-virtus.blend'))
    if render:
        scene = bpy.context.scene
        for name,camera in cameras:
            scene.camera = bpy.data.objects[camera]
            scene.render.filepath = str(output/'renders'/(name+'.png'))
            bpy.ops.render.render(write_still=True)
    print('MCX_EXPORT_COMPLETE', json.dumps(stats))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/weapons/mcx-virtus')
    parser.add_argument('--render', action='store_true')
    parser.add_argument('--quick', action='store_true', help='Lower optional preview resolution/samples only')
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    args = parser.parse_args(argv)
    build(args.output.resolve(), args.render, args.quick)


if __name__ == '__main__':
    main()
