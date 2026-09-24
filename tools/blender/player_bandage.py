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
image = packed_image('Bandage_linen', base[:, :, None] * np.array([.86, .82, .73]))
rough = packed_image('Bandage_rough', np.repeat((.87 + .08 * weave)[:, :, None], 3, axis=2), True)
dx = (np.roll(weave, -1, 1) - np.roll(weave, 1, 1)) * .20
dy = (np.roll(weave, -1, 0) - np.roll(weave, 1, 0)) * .20
normals = np.stack((-dx, -dy, np.ones_like(dx)), axis=2)
normals /= np.linalg.norm(normals, axis=2)[:, :, None]
normal = packed_image('Bandage_normal', normals * .5 + .5, True)

def material(name, color, albedo, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = color
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = 0
    for img, socket in [(albedo, 'Base Color'), (rough, 'Roughness'), (normal, 'Normal')]:
        node = mat.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = img
        if socket == 'Normal':
            normal_map = mat.node_tree.nodes.new('ShaderNodeNormalMap')
            mat.node_tree.links.new(node.outputs['Color'], normal_map.inputs['Color'])
            mat.node_tree.links.new(normal_map.outputs['Normal'], bsdf.inputs['Normal'])
        else:
            mat.node_tree.links.new(node.outputs['Color'], bsdf.inputs[socket])
    return mat

mat = material('Bandage_woven_linen', (.68, .59, .45, 1), image, .92)
# Exported ribbon has a deliberately exposed underside during the wind.
mat.use_backface_culling = False

# Three overlapping helical turns advance from the cuff along the forearm.
# Wrist radius changes on the fixed elbow's reach sphere as the roll advances.
# Each quad is two triangles in progression order, revealed continuously.
SEGMENTS = 120
TURNS = 3
WIDTH = .044
Z_CUFF, Z_FORE = -.267, -.207  # 20 mm advance per turn; 24 mm overlap
ELBOW_R = (0.0, 0.0, -.515)  # fixed right elbow in left-forearm space
FORE_LENGTH = .30
CLEARANCE = .0018       # gauze stands this far off the woven sleeve
LAYER_LIFT = .0008
CROWN = .0005           # lower than the layer lift so overlapping laps don't cross

# The sleeve is an oval that tapers hard into the cuff, so a single radius
# function either sank the gauze into the arm at the elbow end or floated it
# off the wrist end. Measure the real envelope of the committed skin once, in
# the fore bone's own frame, and ride the table instead.
rig = bpy.data.objects['Player_arm_rig']
PROFILE_BINS, PROFILE_MIN, PROFILE_MAX = 24, .110, .310
PROFILE_STEP = .01

def build_profile():
    skin = bpy.data.objects['Olive_ripstop_skin']
    group = skin.vertex_groups['fore'].index
    bone = rig.data.bones['fore']
    head, axis = bone.head_local, (bone.tail_local - bone.head_local).normalized()
    matrix = skin.matrix_world
    rows = round((PROFILE_MAX - PROFILE_MIN) / PROFILE_STEP) + 1
    table = [[0.0] * PROFILE_BINS for _ in range(rows)]
    for vertex in skin.data.vertices:
        weight = next((g.weight for g in vertex.groups if g.group == group), 0.0)
        if weight < .5:
            continue
        rel = (matrix @ vertex.co) - head
        d = rel.dot(axis)
        if not PROFILE_MIN <= d <= PROFILE_MAX:
            continue
        radial = rel - axis * d
        radius = math.hypot(radial.x, radial.z)   # ring plane is Blender X/Z
        if radius < .02:
            continue
        i = min(rows - 1, round((d - PROFILE_MIN) / PROFILE_STEP))
        j = int((math.atan2(radial.z, radial.x) % math.tau) / math.tau * PROFILE_BINS) % PROFILE_BINS
        table[i][j] = max(table[i][j], radius)
    # Fill gaps from the neighbouring cells so the ribbon never falls back to
    # a guessed radius: an unsampled sector must not leave a hole under cloth.
    for i in range(rows):
        for j in range(PROFILE_BINS):
            if table[i][j] >= .02:
                continue
            near = [table[min(rows - 1, max(0, i + di))][(j + dj) % PROFILE_BINS]
                    for di in (-1, 0, 1) for dj in (-1, 0, 1)]
            table[i][j] = max([r for r in near if r >= .02] or [.033])
    return table

SLEEVE = build_profile()

def lerp(a, b, t):
    return a + (b - a) * t

def sleeve_radius(z, a):
    """Outer sleeve radius under the gauze at axial station `z`, azimuth `a`.
    Bilinear on the measured table, so the cloth follows the taper and oval."""
    x = min(len(SLEEVE) - 1.0001, max(0.0, (-z - PROFILE_MIN) / PROFILE_STEP))
    i, fx = int(x), x - int(x)
    y = (a % math.tau) / math.tau * PROFILE_BINS
    j, fy = int(y) % PROFILE_BINS, y - int(y)
    k = (j + 1) % PROFILE_BINS
    return lerp(lerp(SLEEVE[i][j], SLEEVE[i][k], fy),
                lerp(SLEEVE[i + 1][j], SLEEVE[i + 1][k], fy), fx)

def helix(t):
    """Shared parameterisation: azimuth and axial station along the strip."""
    return math.pi - t * TURNS * math.tau, Z_CUFF + (Z_FORE - Z_CUFF) * t

def point(t):
    """Sleeve surface pushed out by a constant gap, so the gauze reads as
    wound cloth on this arm instead of a cylinder around it."""
    a, z = helix(t)
    r = sleeve_radius(z, a) + CLEARANCE + LAYER_LIFT * t * TURNS + CROWN
    return (r * math.cos(a), r * math.sin(a), z)

verts, uv = [], []
LANES = 5
for i in range(SEGMENTS + 1):
    t = i / SEGMENTS
    angle, z = helix(t)
    for j in range(LANES):
        side = 2 * j / (LANES - 1) - 1
        # A gentle centre crown, compressed edges and irregular torn yarn.
        crown = CROWN * (1 - side * side) - .0001 * abs(side)
        station = z + side * WIDTH * .5 + .00035 * math.sin(t * 97 + side * 2)
        radius = sleeve_radius(station, angle) + CLEARANCE + LAYER_LIFT * t * TURNS + crown
        verts.append((radius * math.cos(angle), radius * math.sin(angle), station))
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
coil_image = packed_image('Bandage_coil', coil[:, :, None] * np.array([.86, .82, .73]))
cap_mat = material('Bandage_spiral_coil', (.58, .49, .37, 1), coil_image, .94)
verts, faces, uv = [], [], []
SIDES = 32
for i in range(SIDES + 1):
    a = i * math.tau / SIDES
    for x in [-WIDTH/2, WIDTH/2]:
        verts.append((x, .019 * math.cos(a), .019 * math.sin(a)))
        uv.append((i / SIDES, (x + WIDTH/2) / WIDTH))
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
            cap_verts.append((side * WIDTH/2, radius * math.cos(a), radius * math.sin(a)))
            cap_uv.append((.5 + (radius / .019) * math.cos(a) * .42,
                           .5 + (radius / .019) * math.sin(a) * .42))
    for k in range(3):
        for j in range(SIDES):
            v = first + k * (SIDES + 1) + j
            cap_faces.extend([(v, v+1, v+SIDES+1), (v+1, v+SIDES+2, v+SIDES+1)])
cap = mesh('Bandage_cap', cap_verts, cap_faces, cap_uv, cap_mat)
# The roll sits in the palm; the same offset determines the straight wrist's
# reach from the fixed elbow to the advancing roll station.
PALM_DEPTH = .032
PALM_LENGTH = .066
roll.location = cap.location = xyz((0, -PALM_DEPTH, -PALM_LENGTH))
REACH = FORE_LENGTH + PALM_LENGTH

X_MAT = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))   # logical -> Blender axes

def smoothstep(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)

# Unequal lap durations and short tension slowdowns, not three identical
# stop/start motor strokes. Hermite tangents keep velocity continuous.
FEED_KEYS = [(0, 0, 0), (.16, .13, 1.55), (.37, 1/3, .26),
             (.51, .54, 1.8), (.65, 2/3, .30), (.81, .90, 1.25), (1, 1, 0)]
GRIP_KEYS = [(0, .4), (.16, .78), (.37, 1), (.46, .60),
             (.65, .96), (.80, .76), (1, .95)]

def feed_at(t):
    for a, b in zip(FEED_KEYS, FEED_KEYS[1:]):
        if t <= b[0]:
            dt = b[0] - a[0]
            u = (t - a[0]) / dt
            return ((2*u**3 - 3*u*u + 1) * a[1] + (u**3 - 2*u*u + u) * dt * a[2]
                    + (-2*u**3 + 3*u*u) * b[1] + (u**3 - u*u) * dt * b[2])
    return 1.0

def grip_at(t):
    for a, b in zip(GRIP_KEYS, GRIP_KEYS[1:]):
        if t <= b[0]:
            return lerp(a[1], b[1], smoothstep((t - a[0]) / (b[0] - a[0])))
    return GRIP_KEYS[-1][1]

def guide_state(t):
    """Straight wrist, fixed elbow, advancing roll, and a little forearm roll."""
    feed = feed_at(t)
    ang, z = helix(feed)
    # Turn the palm partly into the task rather than presenting a stiff
    # knuckle-up grip. A small lead/relax beat changes pronation on each pull.
    # Equal endpoint lead preserves all three wrist turns as well as roll turns.
    roll_radius = math.sqrt(REACH**2 + PALM_DEPTH**2 - (z - ELBOW_R[2])**2)
    lead = .10 + .012 * math.sin(feed * TURNS * math.tau) * math.sin(math.pi * feed)
    pronation = math.asin(roll_radius * math.sin(lead) / PALM_DEPTH)
    depth = PALM_DEPTH * math.cos(pronation)
    reach = math.hypot(REACH, depth)
    theta = math.acos((z - ELBOW_R[2]) / reach) + math.atan2(depth, REACH)
    ang += lead
    radial = Vector((math.cos(ang), math.sin(ang), 0.0))
    axis = Vector((0.0, 0.0, 1.0))
    finger = radial * math.sin(theta) + axis * math.cos(theta)
    back = ((radial * math.cos(theta) - axis * math.sin(theta)) * math.cos(pronation)
            + axis.cross(radial) * math.sin(pronation))
    pos = Vector(ELBOW_R) + finger * FORE_LENGTH
    return tuple(pos), tuple(finger), tuple(back), feed, grip_at(t)

guide = bpy.data.objects.new('Bandage_hand_guide', None)
bpy.context.collection.objects.link(guide)
guide.rotation_mode = 'QUATERNION'
guide['feed'] = 0.0
guide['grip'] = 0.0
for frame in range(1, SEGMENTS + 2):
    pos, finger, back, feed, grip = guide_state((frame - 1) / SEGMENTS)
    guide.location = xyz(pos)
    # Hand frame: local -Z points along the fingers, +Y out of the back of the
    # hand, matching the runtime's handBasis() convention for weapon sockets.
    z = -Vector(finger).normalized()
    y = Vector(back)
    y = (y - z * y.dot(z)).normalized()
    x = y.cross(z)
    logical = Matrix(((x.x, y.x, z.x), (x.y, y.y, z.y), (x.z, y.z, z.z)))
    guide.rotation_quaternion = (X_MAT @ logical @ X_MAT.transposed()).to_quaternion()
    guide['feed'] = float(feed)
    guide['grip'] = float(grip)
    guide.keyframe_insert(data_path='["grip"]', frame=frame)
    guide.keyframe_insert(data_path='location', frame=frame)
    guide.keyframe_insert(data_path='rotation_quaternion', frame=frame)
    guide.keyframe_insert(data_path='["feed"]', frame=frame)
scene = bpy.context.scene
samples = []
for i in range(0, SEGMENTS + 1, 2):
    scene.frame_set(i + 1)
    p = guide.location
    q = guide.rotation_quaternion
    def direction(v):
        # The guide's local -Z is the finger axis and +Y the back of the hand,
        # so the exported basis is read straight off the keyed object.
        b = q @ Vector(xyz(v))
        return [round(b.x, 6), round(b.z, 6), round(-b.y, 6)]
    samples.append([round(p.x, 6), round(p.z, 6), round(-p.y, 6),
                    *direction((0, 0, -1)), *direction((0, 1, 0)),
                    round(guide['feed'], 6), round(guide['grip'], 6)])
# The same Blender rig owns a roll-grip and a looser regrip action. Gameplay
# rebinds these values to the live skin, as it does for the other arm poses.
POSES = {
    # Closed roll grip, softer presentation grip, and a dedicated support fist.
    # The generic weapon 'wrap' pose is too open for a clenched support hand.
    'bandage': {
        'fingers': [[.85, 1.35, .75], [.90, 1.40, .80], [.95, 1.45, .85], [1.0, 1.45, .85]],
        'thumb': [.85, .65], 'thumbBase': [.2, -.90, -.55],
    },
    'bandageLoose': {
        'fingers': [[.65, 1.05, .65], [.75, 1.20, .70], [.85, 1.30, .75], [.90, 1.35, .80]],
        'thumb': [.75, .55], 'thumbBase': [.2, -.92, -.50],
    },
    'bandageFist': {
        'fingers': [[1.35, 1.55, .95], [1.4, 1.6, 1.0], [1.4, 1.6, 1.0], [1.45, 1.6, 1.0]],
        'thumb': [.90, .75], 'thumbBase': [.2, -1.15, -.65],
    },
}
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
                 f'export const BANDAGE_WIDTH = {WIDTH};\n'
                 f'export const BANDAGE_TURNS = {TURNS};\n'
                 'export const BANDAGE_ELBOW_R = ' + json.dumps(ELBOW_R) + ';\n'
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
