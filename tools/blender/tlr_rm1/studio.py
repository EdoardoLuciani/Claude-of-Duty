"""Product-photo comparisons and ortho inspection views, separate from the art."""

import math

import bpy
from mathutils import Quaternion, Vector

# Manufacturer 02/03/04 have no EXIF camera metadata. These are matched by eye
# to the barrel axis, lens ellipse and side silhouette, not a per-axis warp.
VIEWS = {
    'profile-right': ((1, 0, .01), (-11.25, -15.05), 100),
    'front-quarter': ((-.67, .67, .41), (-5.9, -15.5), 86),
    'rear-quarter': ((-.95, -.46, -.13), (-14.5, -18.6), 104),
    'profile-left': ((-1, 0, 0), (-11.25, -15.05), 100),
    'front': ((0, 1, 0), (-11.25, -15.05), 50),
    'rear': ((0, -1, 0), (-11.25, -15.05), 50),
    'top': ((0, .0001, 1), (-11.25, -15.05), 100),
    'bottom': ((0, .0001, -1), (-11.25, -15.05), 100),
}


def setup(quick):
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.length_unit = 'MILLIMETERS'
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 12 if quick else 56
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = 520 if quick else 920
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'

    studio = bpy.data.collections.new('05  Product photography — not part of asset')
    scene.collection.children.link(studio)
    cameras = {}
    for name, (direction, (y,z), width) in VIEWS.items():
        data = bpy.data.cameras.new(name)
        distance = .225 if name == 'front-quarter' else .240
        if name == 'front-quarter':
            data.type = 'PERSP'
            data.lens = data.sensor_width * distance / (width * .001)
        else:
            data.type = 'ORTHO'
            data.ortho_scale = width * .001
        data.clip_start, data.clip_end = .001, 5
        camera = bpy.data.objects.new(name, data)
        studio.objects.link(camera)
        focus = Vector((0,y*.001,z*.001))
        camera.location = focus + Vector(direction).normalized() * distance
        rotation = (focus-camera.location).to_track_quat('-Z', 'Y')
        if name == 'front-quarter':
            rotation = rotation @ Quaternion((0,0,1),math.radians(-9))
        camera.rotation_euler = rotation.to_euler()
        cameras[name] = camera
    scene.camera = cameras['front-quarter']

    world = bpy.data.worlds.new('White sweep with neutral environment fill')
    scene.world = world
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    env = nodes.get('Background')
    env.inputs['Color'].default_value = (.68,.69,.70,1)
    env.inputs['Strength'].default_value = .59
    backdrop = nodes.new('ShaderNodeBackground')
    backdrop.inputs['Color'].default_value = (1,1,1,1)
    backdrop.inputs['Strength'].default_value = 16
    mix = nodes.new('ShaderNodeMixShader')
    links.new(nodes.new('ShaderNodeLightPath').outputs['Is Camera Ray'], mix.inputs[0])
    links.new(env.outputs[0], mix.inputs[1])
    links.new(backdrop.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], nodes.get('World Output').inputs[0])
    for name, where, target, power, size, height in [
        ('Overhead rectangular softbox', (-.058,.032,.105), (0,-.01,-.018), .185, .110, .063),
        ('Front card', (-.067,.105,-.057), (0,.026,-.014), .077, .049, .014),
        ('Optics kicker', (.024,.091,.028), (0,.026,-.014), .043, .043, .043),
        ('Side fill', (.086,.012,.032), (0,-.01,-.019), .088, .088, .099),
        ('Right edge strip', (.085,-.020,.064), (0,-.01,-.019), .058, .083, .015),
        ('Left upper strip', (-.080,-.057,.053), (0,-.005,-.019), .166, .059, .028),
        ('Left fill', (-.069,-.031,-.008), (0,-.01,-.019), .046, .069, .038),
        ('Rear strip', (-.044,-.113,.035), (0,-.017,-.020), .072, .126, .044),
        ('White lower bounce', (.014,-.014,-.086), (0,-.01,-.020), .011, .107, .065),
    ]:
        lamp = bpy.data.lights.new(name, 'AREA')
        lamp.energy, lamp.size = power, size
        lamp.shape = 'DISK' if name == 'Optics kicker' else 'RECTANGLE'
        if lamp.shape == 'RECTANGLE':
            lamp.size_y = height
        obj = bpy.data.objects.new(name, lamp)
        studio.objects.link(obj)
        obj.location = where
        obj.rotation_euler = (Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()

    # Open on the three-quarter view without showing the lighting handles.
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                space = area.spaces.active
                space.clip_start = .0001
                space.overlay.show_extras = False
                space.region_3d.view_rotation = scene.camera.rotation_euler.to_quaternion()
                space.region_3d.view_location = (0,-.012,-.014)
                space.region_3d.view_distance = .14


def render(directory):
    directory.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    for name in VIEWS:
        scene.camera = bpy.data.objects[name]
        scene.render.filepath = str(directory / f'{name}.png')
        bpy.ops.render.render(write_still=True)
    plug = bpy.data.collections['06  Reference-only cable plug']
    plug.hide_render = False
    scene.camera = bpy.data.objects['rear-quarter']
    scene.render.filepath = str(directory / 'rear-quarter-with-plug.png')
    bpy.ops.render.render(write_still=True)
    plug.hide_render = True
