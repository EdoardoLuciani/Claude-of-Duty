"""Generate the P320 from an empty scene. Python is the authoring authority.
blender -b -t 8 --python-exit-code 1 --python tools/blender/p320_compact.py
Optional: -- --output /absolute/directory --render --quick
"""
import argparse
import json
from pathlib import Path
import sys
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from p320.animations import select_clip
from p320_actions import author_actions
from p320.export import export_asset
from p320.geometry import build_geometry
from p320.materials import ATLAS_RESOLUTIONS, bake_atlas
from p320.studio import build_studio
from p320.skin import build_skin

ROOT = Path(__file__).resolve().parents[2]


def build(output, render=False, quick=False):
    output.mkdir(parents=True, exist_ok=True)
    (output / 'textures').mkdir(exist_ok=True)
    if render:
        (output / 'renders').mkdir(exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.render.fps = 60
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.world = bpy.data.worlds.new('World')
    asset = bpy.data.collections.new('P320 | editable weapon')
    scene.collection.children.link(asset)
    studio = bpy.data.collections.new('STUDIO | excluded from export')
    scene.collection.children.link(studio)

    asset, coords, pivots, weapon_meshes = build_geometry(asset)
    rig, body, slide, barrel, trigger, catch, mag, spare, round_live, round_spare = pivots
    bake_atlas(output, asset, weapon_meshes)
    # Spare shares the same evaluated geometry and atlas UVs.
    for obj in list(asset.objects):
        if obj.type == 'MESH' and obj.parent in (mag, round_live):
            clone = obj.copy()
            clone.data = obj.data
            asset.objects.link(clone)
            clone.parent = spare if obj.parent == mag else round_spare
            clone.name = obj.name + ' | spare'

    parts = [rig, slide, barrel, trigger, catch, mag, spare, round_live, round_spare]
    clips, controls, hands = author_actions(ROOT, asset, rig, parts, mag, spare,
        slide, barrel, trigger, catch, round_live)
    parts += controls
    armature = build_skin(asset, parts, clips)
    parts.append(armature)
    select_clip(parts, hands, clips, 'Idle')
    cameras = build_studio(studio, hands, quick)
    notes=bpy.data.texts.new('START HERE')
    notes.write('P320 COMPACT / GENERATED PREVIEW\nEdit tools/blender/p320/ and p320_actions.py, not this file.\nReference-specific early-production exterior.\nEight weapon + wrist/finger NLA actions.\nHands use existing glove/sleeve meshes; authored deformation lives in this file.\nSelect the same clip on weapon controls and the two armatures.\nRuntime exports hand controls and reuses shared skins (no duplicated texture cost).\nRun tools/blender/p320_review.py for stills or an animation reel.\nPacked base/ORM/normal/emission atlas (sizes in manifest textureResolutions); high bake sources and studio are excluded from GLB.\nNot manufacturing geometry; not endorsed by SIG SAUER.\n')
    scene['clips']=json.dumps(clips)
    scene['hand_collection']='P320 | authored hands (shared appearance)'
    for s in bpy.data.screens:
        for a in s.areas:
            if a.type=='VIEW_3D':a.spaces.active.region_3d.view_perspective='CAMERA'
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.wm.save_as_mainfile(filepath=str(output/'p320-compact.blend'))
    if render:
        for name,cam in cameras.items():
            scene.camera=cam;scene.render.filepath=str(output/'renders'/f'{name}.png');bpy.ops.render.render(write_still=True)
    stats = export_asset(asset, coords, output)
    manifest={'asset':'SIG P320 Nitron Compact | early-production visual reconstruction','units':'metres','blender_forward':'+Y','gltf_forward':'-Z','clips':clips,'stats':stats,
     'textureResolutions':ATLAS_RESOLUTIONS,'geometry':'One rigidly weighted mechanical skin; lettering/traction baked from retained high source','handAnimation':'Blender wrist and finger controls; shared runtime skins and shoulder IK',
     'source':'tools/blender/p320_compact.py + tools/blender/p320/ + tools/blender/p320_actions.py + tools/p320-hand-reference.mjs',
     'notes':['Original non-functional game art, not a dimensionally exact replica.','No downloaded models or textures.','No endorsement by SIG SAUER.']}
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('P320_EXPORT_COMPLETE',json.dumps(stats))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/weapons/p320-compact')
    parser.add_argument('--render', action='store_true')
    parser.add_argument('--quick', action='store_true', help='Only reduce preview resolution/samples')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    build(args.output.resolve(), args.render, args.quick)


if __name__ == '__main__':
    main()
