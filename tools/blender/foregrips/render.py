"""Render repeatable comparison views of a saved foregrip blend, without changing it."""
import argparse
from pathlib import Path
import sys

import bpy
from mathutils import Vector


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
args.output.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = 840, 630
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.world = bpy.data.worlds.new('Neutral review fill')
scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value = (.26, .26, .26, 1)
scene.world.node_tree.nodes.get('Background').inputs['Strength'].default_value = .55
for name, position, power, size in (
    ('Key softbox', (.28, -.12, .32), 2.6, .31),
    ('Grip fill', (.24, .11, -.22), 1.25, .26),
    ('Rim softbox', (-.19, .10, .17), 2.0, .25),
):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size = power, 'DISK', size
    light = bpy.data.objects.new(name, data)
    scene.collection.objects.link(light)
    light.location = position
    aim(light, (0,0,-.028))

data = bpy.data.cameras.new('Orthographic review')
data.type, data.ortho_scale = 'ORTHO', .171
camera = bpy.data.objects.new(data.name, data)
scene.collection.objects.link(camera)
scene.camera = camera
vertical = bpy.data.objects.get('ATTACHMENT_dd_vertical') is not None
center = Vector((0, 0, -.056 if vertical else -.026))
for name, direction in (
    ('side', (1,0,0)),
    ('oblique', (1,.52,.03) if vertical else (1,.52,.48)),
    ('underside', (.29,.14,-1) if vertical else (.70,-.40,-1)),
    ('end', (0,1,.15) if vertical else (.30,1,-.23)),
):
    camera.location = center + Vector(direction).normalized() * .42
    aim(camera, center)
    scene.render.filepath = str(args.output/f'{name}.png')
    bpy.ops.render.render(write_still=True)
