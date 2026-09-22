"""Add the first-person dressing to the editable player-arms scene.
Run: blender -b --python-exit-code 1 --python tools/blender/player_bandage.py
The strip is authored in the left forearm pivot's local space; the roll is
in the right hand's local space. Gameplay samples the guide and controls time.
"""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
ASSET = ROOT / 'assets/player/arms/player-arms.blend'
GLB = ROOT / 'public/models/player/bandage.glb'
GUIDE = ROOT / 'src/weapons/bandage-path.js'
bpy.ops.wm.open_mainfile(filepath=str(ASSET))
for obj in list(bpy.data.objects):
    if obj.name.startswith('Bandage_'):
        bpy.data.objects.remove(obj, do_unlink=True)
for datablocks in [bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.actions]:
    for block in list(datablocks):
        if block.name.startswith('Bandage_') and block.users == 0:
            datablocks.remove(block)

def xyz(v):
    return (v[0], -v[2], v[1])

def mesh(name, vertices, faces, uvs, mat):
    data = bpy.data.meshes.new(name)
    data.from_pydata([xyz(v) for v in vertices], [], faces)
    data.update()
    layer = data.uv_layers.new(name='UVMap')
    for face in data.polygons:
        for loop in face.loop_indices:
            layer.data[loop].uv = uvs[data.loops[loop].vertex_index]
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(mat)
    return obj

# A small packed textile swatch, distinct from the olive uniform. UVs run
# across the width and along the yarn; no runtime image/texture generation.
import numpy as np
n = 256
xx, yy = np.meshgrid(np.arange(n), np.arange(n))
weave = np.sin(xx * math.tau / 7) * np.cos(yy * math.tau / 9)
base = .75 + .065 * weave + .025 * np.sin(yy * math.tau / 64)
def packed_image(name, rgb, noncolor=False):
    image = bpy.data.images.new(name, width=n, height=n)
    if noncolor:
        image.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((n, n, 4), np.float32)
    rgba[:, :, :3] = rgb
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = str(ROOT / f'assets/player/arms/{name}.png')
    image.file_format = 'PNG'
    image.save()
    image.pack()
    return image
image = packed_image('Bandage_linen', base[:, :, None] * np.array([.82, .74, .59]))
rough = packed_image('Bandage_rough', np.repeat((.87 + .04 * weave)[:, :, None], 3, axis=2), True)
dx = (np.roll(weave, -1, 1) - np.roll(weave, 1, 1)) * .11
dy = (np.roll(weave, -1, 0) - np.roll(weave, 1, 0)) * .11
normals = np.stack((-dx, -dy, np.ones_like(dx)), axis=2)
normals /= np.linalg.norm(normals, axis=2)[:, :, None]
normal = packed_image('Bandage_normal', normals * .5 + .5, True)
mat = bpy.data.materials.new('Bandage_woven_linen')
mat.use_nodes = True
mat.diffuse_color = (.68, .59, .45, 1)
bsdf = mat.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Roughness'].default_value = .92
bsdf.inputs['Metallic'].default_value = 0
tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
tex.image = image
mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
for img, socket in [(rough, 'Roughness'), (normal, 'Normal')]:
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = img
    if socket == 'Normal':
        normal_map = mat.node_tree.nodes.new('ShaderNodeNormalMap')
        mat.node_tree.links.new(node.outputs['Color'], normal_map.inputs['Color'])
        mat.node_tree.links.new(normal_map.outputs['Normal'], bsdf.inputs['Normal'])
    else:
        mat.node_tree.links.new(node.outputs['Color'], bsdf.inputs[socket])
# Exported ribbon has a deliberately exposed underside during the wind.
mat.use_backface_culling = False

# Spiral sits just proud of the Blender sleeve next to the wrist.
# Each quad is two triangles in progression order, so a single drawRange
# exposes exactly the section already wrapped, without popping whole rings.
SEGMENTS = 120
TURNS = 3
WIDTH = .027

def point(t):
    a = .35 + t * TURNS * math.tau
    z = -.205 - .077 * t
    r = .039 - .005 * t + .0007 * math.sin(a * 3)
    return (r * math.cos(a), r * .90 * math.sin(a), z)

verts, uv = [], []
for i in range(SEGMENTS + 1):
    t = i / SEGMENTS
    x, y, z = point(t)
    # Width is along the forearm; a slight edge waviness breaks the perfect helix.
    for side in [-1, 1]:
        verts.append((x, y, z + side * WIDTH * .5 + .00045 * math.sin(t * 91 + side)))
        uv.append((side * .45 + .5, t * 18))
faces = []
for i in range(SEGMENTS):
    k = 2 * i
    faces.extend([(k, k+1, k+2), (k+1, k+3, k+2)])
wrap = mesh('Bandage_wrap', verts, faces, uv, mat)
# Separate editable roll; it sits in the right palm and shrinks slightly as
# the strip is paid out. Face detail is carried by the same linen map.
verts, faces, uv = [], [], []
for i in range(17):
    a = i * math.tau / 16
    for x in [-.021, .021]:
        verts.append((x * 1.25, -.025 + .024 * math.cos(a), -.130 + .024 * math.sin(a)))
        uv.append((i / 16, (x + .021) / .042))
    if i:
        k = 2 * i
        faces.extend([(k-2, k-1, k), (k-1, k+1, k)])
roll = mesh('Bandage_roll', verts, faces, uv, mat)
# This control is authored in the SAME Blender scene. It marks where the
# right palm should be while the free edge walks around the left forearm.
# Blender keys are sampled to data; gameplay never has to play a looping clip.
guide = bpy.data.objects.new('Bandage_hand_guide', None)
bpy.context.collection.objects.link(guide)
for i in range(SEGMENTS + 1):
    t = i / SEGMENTS
    x, y, z = point(t)
    a = .35 + t * TURNS * math.tau
    guide.location = xyz((x + .034 * math.cos(a), y + .032 * math.sin(a), z - .022))
    guide.keyframe_insert(data_path='location', frame=i + 1)
scene = bpy.context.scene
samples = []
for i in range(0, SEGMENTS + 1, 2):
    scene.frame_set(i + 1)
    p = guide.location
    samples.append([round(p.x, 6), round(p.z, 6), round(-p.y, 6)])
GUIDE.write_text('// Generated by tools/blender/player_bandage.py; forearm-pivot local.\n'
                 'export const BANDAGE_PATH = ' + json.dumps(samples, separators=(',', ':')) + ';\n'
                 f'export const BANDAGE_SEGMENTS = {SEGMENTS};\n'
                 'export const BANDAGE_CONTACT = ' + json.dumps([[round(v, 6) for v in point(i/SEGMENTS)] for i in range(SEGMENTS+1)], separators=(',', ':')) + ';\n')
# Don't touch the existing arms GLB: this prop is loaded beside it. The blend
# remains the single editable scene for the arm skin, cloth and guide action.
bpy.ops.object.select_all(action='DESELECT')
for obj in [wrap, roll]:
    obj.select_set(True)
bpy.context.view_layer.objects.active = wrap
bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB', use_selection=True,
                          export_animations=False, export_yup=True)
# The export uses pivot-local coordinates. Move the editable review objects
# onto the arm's neutral fore bone in the saved .blend (after exporting), so
# opening the scene actually shows the dressing around the sleeve.
display = bpy.data.objects.new('Bandage_fore_display', None)
bpy.context.collection.objects.link(display)
display.location = xyz((0, 0, .3))
wrap.parent = display
guide.parent = display
bpy.ops.wm.save_as_mainfile(filepath=str(ASSET))
print(f'Bandage: {GLB}; {len(samples)} guide samples; {SEGMENTS} mesh sections')
