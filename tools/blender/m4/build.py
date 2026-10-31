"""Build M4 source preview and runtime products from an empty scene.

blender -b -t 2 --python-exit-code 1 --python tools/blender/m4/build.py -- --quick
See tools/blender/m4/README.md. No previous weapon blend or GLB is an input.
"""
import argparse
import json
from pathlib import Path
import sys
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from m4.animations import FPS, build_animations, select_clip, prepare_export_actions
from m4.export import export_asset
from m4.geometry import build_geometry
from m4.materials import build_materials
from m4.studio import build_studio

ROOT = Path(__file__).resolve().parents[3]


def build(output, render=False, quick=False):
    output.mkdir(parents=True, exist_ok=True)
    for sub in ('textures', 'renders'):
        (output / sub).mkdir(exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.render.fps = FPS
    scene.world = bpy.data.worlds.new('World')

    materials = build_materials(output)
    asset, parts, parents, separate = build_geometry(materials)
    clips, parts, hands = build_animations(ROOT, asset, parts)
    cameras = build_studio(quick, bpy.data.objects['SOCKET_sight'].location.z)
    for obj in hands:
        if obj.type == 'MESH':
            obj.hide_render = True
    scene['clips'] = json.dumps(clips)
    notes = bpy.data.texts.new('START HERE')
    notes.write(
        'M4A1 BLOCK II / IRON-ONLY GAME ART\n'
        'Generated preview. Edit tools/blender/m4/, not this file.\n'
        'Reference-backed visual reconstruction; not manufacturing geometry.\n'
        'Eight synchronized weapon/wrist/finger actions and shared review arm skins.\n'
        '120 fps; select the same NLA clip on all rig controls/arms.\n'
        'Packed original PBR maps. See adjacent README.md for limitations.\n'
    )
    select_clip(parts, hands, clips, 'Idle')
    bpy.ops.object.select_all(action='DESELECT')
    rig = parts[0]
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'm4a1-block-ii.blend'))
    if render:
        for name, camera in cameras.items():
            scene.camera = camera
            scene.render.filepath = str(output / 'renders' / (name + '.png'))
            bpy.ops.render.render(write_still=True)

    select_clip(parts, hands, clips, 'Idle')
    prepare_export_actions(parts, clips)
    stats = export_asset(output, asset, parents, separate, clips)
    manifest = {
        'asset': 'M4A1 Block II | RIS II FSP / MaTech / FH556RC / LMT SOPMOD',
        'units': 'metres', 'clips': clips, 'stats': stats, 'textureResolution': 1024,
        'source': 'tools/blender/m4/build.py + tools/blender/m4/ + tools/blender/m4/hand-reference.mjs',
        'notes': [
            'Generated from Python; blend, GLB, maps and manifest are products.',
            'Visual reconstruction, not manufacturing geometry or a scan.',
            'See README.md for unknown datums and the FH556RC unit conflict.',
            'Weapon/wrist/finger trajectories are Blender-authored; shared runtime skins/IK and existing reactive recoil remain.',
            'Native Actions export: 120 Hz LINEAR motion, STEP visibility, exact clip endpoints; no GLB rewriting.',
        ],
    }
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print('M4_EXPORT_COMPLETE', json.dumps(stats))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/weapons/m4a1-block-ii')
    parser.add_argument('--render', action='store_true')
    parser.add_argument('--quick', action='store_true')
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    args = parser.parse_args(argv)
    build(args.output.resolve(), args.render, args.quick)


if __name__ == '__main__':
    main()
