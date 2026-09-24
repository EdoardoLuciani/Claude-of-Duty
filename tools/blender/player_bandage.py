"""Add the first-person dressing to the editable player-arms scene.
Run: blender -b --python-exit-code 1 --python tools/blender/player_bandage.py
The strip is authored in the left forearm pivot's local space; the roll is
in the right hand's local space. Gameplay samples the guide and controls time.
"""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector, Euler, Matrix

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
        if block.name.startswith('Bandage_') and (block.users == 0 or
           (datablocks is bpy.data.actions and block.use_fake_user and block.users == 1)):
            datablocks.remove(block)

def xyz(v):
    return (v[0], -v[2], v[1])

def mesh(name, vertices, faces, uvs, mat):
    data = bpy.data.meshes.new(name)
    data.from_pydata([xyz(v) for v in vertices], [], faces)
    data.update()
    for poly in data.polygons:
        poly.use_smooth = True
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
weave = np.sin(xx * math.tau / 15) * np.cos(yy * math.tau / 17)
# Selvedge threads and slight longitudinal staining make three adjacent laps
# legible at first-person distance, instead of one smooth plaster cylinder.
edge = np.exp(-((xx - 15) / 7)**2) + np.exp(-((xx - 240) / 7)**2)
base = (.70 + .13 * weave + .035 * np.sin(yy * math.tau / 64)) * (1 - .20 * edge)
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
image = packed_image('Bandage_linen', base[:, :, None] * np.array([.76, .67, .54]))
rough = packed_image('Bandage_rough', np.repeat((.87 + .08 * weave)[:, :, None], 3, axis=2), True)
dx = (np.roll(weave, -1, 1) - np.roll(weave, 1, 1)) * .20
dy = (np.roll(weave, -1, 0) - np.roll(weave, 1, 0)) * .20
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
WIDTH = .025

def point(t):
    a = .35 + t * TURNS * math.tau
    z = -.205 - .077 * t
    # Sleeve tapers toward the cuff: let the gauze just clear the folds.
    r = .0348 - .0044 * t + .0006 * math.sin(a * 3)
    return (r * math.cos(a), r * .90 * math.sin(a), z)

verts, uv = [], []
LANES = 5
for i in range(SEGMENTS + 1):
    t = i / SEGMENTS
    x, y, z = point(t)
    for j in range(LANES):
        side = 2 * j / (LANES - 1) - 1
        # A gentle centre crown, compressed edges and irregular torn yarn.
        crown = .0013 * (1 - side * side) - .00025 * abs(side)
        verts.append((x * (1 + crown / .035), y * (1 + crown / .035),
                      z + side * WIDTH * .5 + .00035 * math.sin(t * 97 + side * 2)))
        uv.append((side * .45 + .5, t * 4))
faces = []
for i in range(SEGMENTS):
    k = i * LANES
    for j in range(LANES - 1):
        v = k + j
        faces.extend([(v, v+1, v+LANES), (v+1, v+LANES+1, v+LANES)])
wrap = mesh('Bandage_wrap', verts, faces, uv, mat)
# Wound roll: cylindrical textile plus separately shaded, hollow end faces.
# Dark spiral shadows make it read as gauze paid off a core, not a solid can.
xx0, yy0 = (xx - n/2) / (n/2), (yy - n/2) / (n/2)
radius_uv = np.sqrt(xx0*xx0 + yy0*yy0)
spiral = np.sin(35 * radius_uv + np.arctan2(yy0, xx0) * 2)
coil = np.clip((.69 + .11 * spiral) * (1 - .20 * np.exp(-((radius_uv-.20)/.06)**2)), .35, .88)
coil_image = packed_image('Bandage_coil', coil[:, :, None] * np.array([.76, .67, .54]))
cap_mat = bpy.data.materials.new('Bandage_spiral_coil')
cap_mat.use_nodes = True
cap_mat.diffuse_color = (.58, .49, .37, 1)
cap_bsdf = cap_mat.node_tree.nodes.get('Principled BSDF')
cap_bsdf.inputs['Roughness'].default_value = .94
cap_tex = cap_mat.node_tree.nodes.new('ShaderNodeTexImage')
cap_tex.image = coil_image
cap_mat.node_tree.links.new(cap_tex.outputs['Color'], cap_bsdf.inputs['Base Color'])
for img, socket in [(rough, 'Roughness'), (normal, 'Normal')]:
    node = cap_mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = img
    if socket == 'Normal':
        normal_map = cap_mat.node_tree.nodes.new('ShaderNodeNormalMap')
        cap_mat.node_tree.links.new(node.outputs['Color'], normal_map.inputs['Color'])
        cap_mat.node_tree.links.new(normal_map.outputs['Normal'], cap_bsdf.inputs['Normal'])
    else:
        cap_mat.node_tree.links.new(node.outputs['Color'], cap_bsdf.inputs[socket])
verts, faces, uv = [], [], []
SIDES = 32
for i in range(SIDES + 1):
    a = i * math.tau / SIDES
    for x in [-.013, .013]:
        verts.append((x, .019 * math.cos(a), .019 * math.sin(a)))
        uv.append((i / SIDES, (x + .013) / .026))
    if i:
        k = 2 * i
        faces.extend([(k-2, k-1, k), (k-1, k+1, k)])
roll = mesh('Bandage_roll', verts, faces, uv, mat)
cap_verts, cap_faces, cap_uv = [], [], []
for side in [-1, 1]:
    first = len(cap_verts)
    for radius in [.019, .014, .009, .004]:
        for j in range(SIDES + 1):
            a = math.tau * j / SIDES
            cap_verts.append((side * .013, radius * math.cos(a), radius * math.sin(a)))
            cap_uv.append((.5 + (radius / .019) * math.cos(a) * .42,
                           .5 + (radius / .019) * math.sin(a) * .42))
    for k in range(3):
        for j in range(SIDES):
            v = first + k * (SIDES + 1) + j
            cap_faces.extend([(v, v+1, v+SIDES+1), (v+1, v+SIDES+2, v+SIDES+1)])
cap = mesh('Bandage_cap', cap_verts, cap_faces, cap_uv, cap_mat)
roll.location = cap.location = xyz((0, -.040, -.100))
# Animate a grip, three pulls/regrips and a final tuck on the NEAR side of
# the wrist. The old full-circle palm orbit sent the right forearm straight
# through the left arm. Only the cloth winds all the way around the sleeve.
# Keys are Blender scene frames: x/y/z in the forearm pivot, then palm roll.
BEATS = [
    (0,   .087, .013, -.205, -.14),  # reach, settle roll at cuff
    (10,  .073, .000, -.211,  .06),  # press first edge
    (24,  .096, .010, -.224,  .21),  # pull, thumb meters the roll
    (35,  .092,-.018, -.230, -.17),  # sweep down beside wrist
    (43,  .079,-.026, -.235, -.04),  # regrip, not a full hand orbit
    (52,  .076, .003, -.239,  .09),
    (66,  .100, .008, -.252,  .24),
    (77,  .093,-.015, -.255, -.18),
    (85,  .077,-.026, -.260, -.04),
    (94,  .079, .005, -.266,  .12),
    (108, .098, .007, -.274,  .20),
    (120, .074, .000, -.280, -.10),  # thumb tucks loose end
]
guide = bpy.data.objects.new('Bandage_hand_guide', None)
bpy.context.collection.objects.link(guide)
for frame, x, y, z, roll_angle in BEATS:
    guide.location = xyz((x, y, z))
    guide.rotation_euler = (0, roll_angle, 0)  # Blender Y = game forearm Z
    guide.keyframe_insert(data_path='location', frame=frame + 1)
    guide.keyframe_insert(data_path='rotation_euler', frame=frame + 1)
scene = bpy.context.scene
samples = []
for i in range(0, SEGMENTS + 1, 2):
    scene.frame_set(i + 1)
    p = guide.location
    q = guide.rotation_euler.to_quaternion()
    def direction(v):
        b = q @ Vector(xyz(v))
        return [round(b.x, 6), round(b.z, 6), round(-b.y, 6)]
    samples.append([round(p.x, 6), round(p.z, 6), round(-p.y, 6),
                    *direction((-.72, -.27, -.60)), *direction((.10, -.95, .15))])
# The same Blender rig owns a roll-grip and a looser regrip action. Gameplay
# rebinds these values to the live skin, as it does for the other arm poses.
POSES = {
    'bandage': {
        'fingers': [[.66, 1.18, .83], [1.04, 1.12, .82], [1.17, 1.16, .80], [1.22, 1.16, .76]],
        'thumb': [1.0, .75], 'thumbBase': [.2, -.82, -.40],
    },
    'bandageLoose': {
        'fingers': [[.35, .85, .62], [.84, 1.02, .72], [1.02, 1.06, .68], [1.07, 1.02, .64]],
        'thumb': [.75, .55], 'thumbBase': [.2, -.90, -.34],
    },
}
rig = bpy.data.objects['Player_arm_rig']
rig.animation_data_create()
basis = Matrix(((1,0,0),(0,0,-1),(0,1,0)))
rest = Euler((0,-.95,0), 'XYZ').to_matrix()
for name, pose in POSES.items():
    action = bpy.data.actions.new('Bandage_' + name)
    action.use_fake_user = True
    rig.animation_data.action = action
    for frame, amount in [(1,0),(10,1),(40,1),(52,0)]:
        for pb in rig.pose.bones:
            pb.rotation_mode = 'XYZ'
            pb.rotation_euler = (0,0,0)
        for i in range(4):
            for j in range(3):
                rig.pose.bones[f'finger_{i}_{j}'].rotation_euler.x = -pose['fingers'][i][j] * amount
                if j:
                    rig.pose.bones[f'finger_{i}_{j}_flex'].rotation_euler.x = -pose['fingers'][i][j] * amount * .5
        target = Euler(tuple(pose['thumbBase']), 'XYZ').to_matrix()
        delta = rest.inverted() @ target
        rig.pose.bones['thumb_base'].rotation_euler = tuple(v*amount for v in (basis @ delta @ basis.inverted()).to_euler())
        for j in range(2):
            rig.pose.bones[f'thumb_{j}'].rotation_euler.x = -pose['thumb'][j] * amount
        for pb in rig.pose.bones:
            pb.keyframe_insert('rotation_euler', frame=frame, group=pb.name)
rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.rotation_euler = (0,0,0)
GUIDE.write_text('// Generated by tools/blender/player_bandage.py; forearm-pivot local.\n'
                 'export const BANDAGE_PATH = ' + json.dumps(samples, separators=(',', ':')) + ';\n'
                 f'export const BANDAGE_SEGMENTS = {SEGMENTS};\n'
                 'export const BANDAGE_CONTACT = ' + json.dumps([[round(v, 6) for v in point(i/SEGMENTS)] for i in range(SEGMENTS+1)], separators=(',', ':')) + ';\n'
                 'export const BANDAGE_POSES = ' + json.dumps(POSES, separators=(',', ':')) + ';\n')
# Don't touch the existing arms GLB: this prop is loaded beside it. The blend
# remains the single editable scene for the arm skin, cloth and guide action.
bpy.ops.object.select_all(action='DESELECT')
for obj in [wrap, roll, cap]:
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
