"""Non-shipping M4 material studies. Never save the source blend.
blender -b assets/weapons/m4a1-block-ii/m4a1-block-ii.blend --python-exit-code 1 \
  --python tools/spikes/m4-finish-blender.py -- --variant roughness --out /tmp/m4-study
Requires working Blender OCIO configuration (see the study report).
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

parser = argparse.ArgumentParser()
parser.add_argument('--variant', choices=['baseline', 'roughness', 'separated', 'balanced'], required=True)
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
args.out.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
asset = bpy.data.collections['M4A1 | authored components']
C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
changes = []

def finish(prefix, roughness, normal=None, color=None):
    m = next(m for m in bpy.data.materials if m.name.startswith(prefix + ' |'))
    p = m.node_tree.nodes.get('Principled BSDF')
    mul = p.inputs['Roughness'].links[0].from_node
    old = mul.inputs[1].default_value
    mul.inputs[1].default_value = roughness
    if normal is not None:
        p.inputs['Normal'].links[0].from_node.inputs['Strength'].default_value = normal
    if color is not None:
        p.inputs['Base Color'].links[0].from_node.inputs[7].default_value = (*color, 1)
    changes.append({'material': m.name, 'oldRoughness': old, 'roughnessFactor': roughness,
                    'normalStrengthOverride': normal, 'linearColorOverride': color})

if args.variant == 'roughness':
    finish('01', .46)
elif args.variant == 'separated':
    finish('01', .38, .08, (.045, .046, .048))
    finish('02', .48, .12)
    finish('03', .82, .35)
    finish('05', .50, .12)
    finish('07', .60, .14)
elif args.variant == 'balanced':
    # Refine the stronger study: less polish, retain polymer's molded texture.
    finish('01', .44, .08, (.041, .043, .046))
    finish('02', .56, .16)
    finish('03', .80, .55)
    finish('05', .56, .16)
    finish('07', .67, .18)
    # Reduce the shared cloudy albedo variation on the receiver only. A local
    # image copy preserves UVs and average linear tint, without painting wear.
    import numpy as np
    m = bpy.data.materials['01 | black anodized receiver']
    mix = m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].links[0].from_node
    tex = mix.inputs[6].links[0].from_node
    image = tex.image.copy()
    image.name = 'STUDY receiver restrained albedo'
    pixels = np.array(image.pixels[:], dtype=np.float32).reshape((-1, 4))
    mean = pixels[:, :3].mean(axis=0)
    pixels[:, :3] = mean + (pixels[:, :3] - mean) * .25
    image.pixels.foreach_set(pixels.ravel())
    image.update()
    tex.image = image
    changes.append({'receiverAlbedoVariationScale': .25, 'meanPreserved': mean.tolist()})

for o in bpy.data.objects:
    if o.animation_data:
        o.animation_data.action = None
        for track in o.animation_data.nla_tracks:
            track.mute = track.name != 'Idle'
scene.frame_set(0)
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    q, excluded = o, False
    while q:
        if q.name in ('magazine_spare', 'magazine_spare_round', 'spent_case'):
            excluded = True
        q = q.parent
    o.hide_render = o.name not in asset.objects or excluded
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 96
scene.cycles.use_denoising = True
scene.cycles.seed = 432
scene.cycles.max_bounces = 8
scene.render.resolution_x = 1600
scene.render.resolution_y = 1000
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.render.film_transparent = False
records = []

def render(name, camera):
    scene.camera = camera
    scene.render.filepath = str(args.out / (name + '.png'))
    bpy.context.view_layer.update()
    records.append({'name': name, 'camera': [list(row) for row in camera.matrix_world],
                    'orthoScale': camera.data.ortho_scale,
                    'exposure': scene.view_settings.exposure,
                    'transform': scene.view_settings.view_transform,
                    'look': scene.view_settings.look})
    bpy.ops.render.render(write_still=True)

render('studio-full', bpy.data.objects['CAM_hero'])
render('studio-receiver', bpy.data.objects['CAM_receiver'])
for o in scene.objects:
    if o.type == 'LIGHT':
        o.hide_render = True
for name, loc, power, size, size_y in [
    ('Neutral strip', (-.4, .5, .15), 85, .55, .12),
    ('Neutral rim', (.35, .4, -.1), 100, .8, .8),
    ('Neutral fill', (-.65, .02, .3), 30, .8, .8),
]:
    d = bpy.data.lights.new(name, 'AREA')
    d.energy, d.shape, d.size, d.size_y, d.color = power, 'RECTANGLE', size, size_y, (1, 1, 1)
    o = bpy.data.objects.new(name, d)
    scene.collection.objects.link(o)
    o.location = C @ Vector(loc)
    o.rotation_euler = (C @ Vector((0, .02, -.1)) - o.location).to_track_quat('-Z', 'Y').to_euler()
scene.world.node_tree.nodes.get('Background').inputs[0].default_value = (.21, .21, .21, 1)
render('neutral-receiver', bpy.data.objects['CAM_receiver'])
(args.out / 'report.json').write_text(json.dumps({
    'variant': args.variant, 'changes': changes, 'blender': bpy.app.version_string,
    'sourceSha256': hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),
    'engine': 'Cycles CPU', 'samples': 96, 'denoising': True, 'renders': records,
}, indent=2))
print('M4_MATERIAL_STUDY_COMPLETE', args.variant)
