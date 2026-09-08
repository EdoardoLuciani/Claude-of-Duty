"""Author the first-person deformation meshes and hand-pose actions in Blender.
Run: blender -b --python tools/blender/player_arms.py [-- --render]
Metres. Helpers accept game coordinates (+Y dorsal, -Z fingers).
Original geometry/textures, deterministic; no external assets or add-ons.
"""
import bpy
import json
import hashlib
import math
import sys
from pathlib import Path
from mathutils import Vector
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/player/arms'
PUBLIC = ROOT / 'public/models/player'
OUT.mkdir(parents=True, exist_ok=True)
PUBLIC.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.render.fps = 60
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.render.resolution_x = 1600
scene.render.resolution_y = 1100
scene.render.resolution_percentage = 100
scene.world.color = (.18, .18, .18)

def xyz(p):
    return (p[0], -p[2], p[1])

def active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

# Tileable yarn / leather grain, baked into glTF-compatible PBR images.
NORMAL_IMAGES = {}
def material(name, color, rough, textile=False):
    n = 1024
    yy, xx = np.mgrid[:n, :n]
    rng = np.random.default_rng(704 + int(textile))
    grain = rng.random((n, n)).astype(np.float32)
    weave = np.sin(xx * math.tau / 8) * np.cos(yy * math.tau / 8)
    height = (.65 * weave + .35 * grain) if textile else (.75 * grain + .25 * np.sin(xx * .7 + np.sin(yy * .6)))
    variation = 1 + .028 * height + .018 * np.sin(xx * math.tau / 256) * np.sin(yy * math.tau / 128)
    def image(suffix, rgb, noncolor=False):
        im = bpy.data.images.new(name + '_' + suffix, width=n, height=n)
        if noncolor:
            im.colorspace_settings.name = 'Non-Color'
        arr = np.ones((n, n, 4), dtype=np.float32)
        arr[:, :, :3] = rgb
        im.pixels.foreach_set(arr.ravel())
        im.filepath_raw = str(OUT / (name + '_' + suffix + '.png'))
        im.file_format = 'PNG'
        im.save()
        im.pack()
        return im
    albedo = image('base', np.clip(variation[:, :, None] * np.array(color), 0, 1))
    r = np.clip(rough + .045 * height, .3, .98)
    roughness = image('rough', np.repeat(r[:, :, None], 3, axis=2), True)
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * .19
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * .19
    normals = np.stack((-dx, -dy, np.ones_like(dx)), axis=2)
    normals /= np.linalg.norm(normals, axis=2)[:, :, None]
    if textile not in NORMAL_IMAGES:
        NORMAL_IMAGES[textile] = image('normal', normals * .5 + .5, True)
    normal = NORMAL_IMAGES[textile]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Specular IOR Level'].default_value = .08
    uv = nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'Microdetail'
    for im, socket in [(albedo, 'Base Color'), (roughness, 'Roughness')]:
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = im
        links.new(uv.outputs['UV'], tex.inputs['Vector'])
        links.new(tex.outputs['Color'], bsdf.inputs[socket])
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = normal
    links.new(uv.outputs['UV'], tex.inputs['Vector'])
    norm = nodes.new('ShaderNodeNormalMap')
    norm.inputs['Strength'].default_value = .5
    links.new(tex.outputs['Color'], norm.inputs['Color'])
    links.new(norm.outputs['Normal'], bsdf.inputs['Normal'])
    mat.diffuse_color = (*color, 1)
    return mat

shell = material('Charcoal_woven_glove', (.115, .125, .13), .84, True)
palm_mat = material('Grained_suede_reinforcement', (.085, .088, .083), .91)
pad_mat = material('Flexible_knuckle_rubber', (.055, .06, .058), .64)
cloth = material('Olive_ripstop', (.23, .255, .17), .88, True)
thread = material('Olive_stitch', (.31, .32, .235), .9, True)

# Rig pivots match the engine's contact solver. Bone orientation itself is not
# an engine contract: exported weights are rebound to its named controls.
lengths = [[.045, .028, .022], [.049, .031, .023], [.046, .029, .022], [.038, .024, .020]]
radii = [[.0102, .0096, .0086, .0062], [.0104, .0098, .0088, .0064], [.010, .0094, .0084, .006], [.0092, .0086, .0078, .0056]]
xs = [.0298, .0102, -.0104, -.0298]
rig_data = bpy.data.armatures.new('Player_arm_deformation')
rig = bpy.data.objects.new('Player_arm_rig', rig_data)
scene.collection.objects.link(rig)
active(rig)
bpy.ops.object.mode_set(mode='EDIT')
bones = {}
segments = []

def bone(name, head, tail, parent=None):
    b = rig_data.edit_bones.new(name)
    b.head, b.tail = xyz(head), xyz(tail)
    if parent:
        b.parent = bones[parent]
    bones[name] = b
    return b

bone('upper', (0, 0, .63), (0, 0, .3))
bone('fore', (0, 0, .3), (0, 0, 0), 'upper')
bone('hand', (0, 0, 0), (0, 0, -.096), 'fore')
# Finger roots fan in exactly the same plane as the runtime contact probes.
for i in range(4):
    angle = -xs[i] * 2.2
    axis = Vector((-math.sin(angle), 0, -math.cos(angle)))
    start = Vector((xs[i], -.006, -.096))
    parent = 'hand'
    for j, length in enumerate(lengths[i]):
        end = start + axis * length
        name = f'finger_{i}_{j}'
        bone(name, start, end, parent)
        if j > 0:
            bone(name+'_flex', start, end, parent)
        segments.append((name, start.copy(), end.copy(), radii[i][j]))
        parent, start = name, end
# Thumb base is an extra saddle control, articulated separately from its hinges.
bone('thumb_base', (.037, -.009, -.04), (.037, -.009, -.055), 'hand')
bone('thumb_0', (.037, -.009, -.04), (.037, -.009, -.09), 'thumb_base')
bone('thumb_1', (.037, -.009, -.09), (.037, -.009, -.122), 'thumb_0')
bone('thumb_1_flex', (.037, -.009, -.09), (.037, -.009, -.122), 'thumb_0')
bpy.ops.object.mode_set(mode='OBJECT')

# Build in a relaxed abducted rest shape. The thumb's geometry is straight in
# bind space (same as controls); the neutral action opens the saddle joint.
def mesh(name, verts, faces, mat):
    data = bpy.data.meshes.new(name)
    data.from_pydata([xyz(v) for v in verts], [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    for p in data.polygons:
        p.use_smooth = True
    return obj

def loft(name, rings, mat, sides=32, tilt=0):
    # Rings: center x,y,z; elliptical radii; circumferential fold amplitude.
    verts, faces = [], []
    for k, (x, y, z, rx, ry, fold) in enumerate(rings):
        for j in range(sides):
            a = j * math.tau / sides
            f = 1 + fold * (math.sin(a * 3 + k * .69) + .4 * math.sin(a * 7 - k * .31))
            radial = rx * math.cos(a) * f
            verts.append((x + radial * math.cos(tilt), y + ry * math.sin(a) * f, z - radial * math.sin(tilt)))
    for k in range(len(rings) - 1):
        for j in range(sides):
            a = k * sides + j
            b = k * sides + (j + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    faces += [tuple(reversed(range(sides))), tuple((len(rings)-1)*sides+j for j in range(sides))]
    obj = mesh(name, verts, faces, mat)
    active(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    return obj

def ellipsoid(name, center, scale, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, location=xyz(center))
    o = bpy.context.object
    o.name = name
    o.scale = (scale[0], scale[2], scale[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(mat)
    for p in o.data.polygons:
        p.use_smooth = True
    return o

# The palm tapers at the carpus and expands across the metacarpals. All digits
# are welded into this shell, not assembled from rigid overlapping capsules.
parts = [loft('Glove_shell', [
    (0, 0, .015, .027, .024, .01), (0, 0, 0, .028, .019, .01),
    (0, -.001, -.022, .034, .017, .008), (0, 0, -.050, .039, .017, .005),
    (0, 0, -.076, .043, .016, .005), (0, -.002, -.094, .040, .014, .005),
    (0, -.004, -.103, .035, .008, 0)], shell)]
for i in range(4):
    rings = []
    total = sum(lengths[i])
    boundaries = np.cumsum([0] + lengths[i])
    for k in range(29):
        t = total * k / 28
        r = float(np.interp(t, boundaries, radii[i])) * .86
        # Flatten the pad; rounded fingertip closes without a spherical joint.
        if k > 25:
            r *= math.sqrt(max(.018, 1 - ((k-25)/3.1)**2))
        angle = -xs[i] * 2.2
        rings.append((xs[i] - math.sin(angle)*t, -.006, -.092-math.cos(angle)*t, r, r*.86, .008))
    parts.append(loft('digit', rings, shell, 20))
# Thumb is offset laterally in bind space so voxel welding cannot fuse it to
# the index. Its vertices are mapped back into the saddle's control rest space
# after remeshing, using the same transform as the edit bones below.
thumb_angle = -.95
thumb_start = Vector((.037, -.009, -.04))
thumb_axis = Vector((-math.sin(thumb_angle), 0, -math.cos(thumb_angle)))
thumb_rings = []
for k in range(25):
    t = .082*k/24
    p = thumb_start + thumb_axis*t
    r = float(np.interp(t, [0, .05, .082], [.013, .0102, .0078]))
    if k > 21:
        r *= math.sqrt(max(.02, 1-((k-21)/3.1)**2))
    thumb_rings.append((*p, r, r*.9, .006))
parts.append(loft('thumb', thumb_rings, shell, 24, tilt=thumb_angle))
parts.append(ellipsoid('Thenar_web', (.036, -.004, -.041), (.019, .017, .023), shell))
active(parts[0])
for o in parts:
    o.select_set(True)
bpy.ops.object.join()
glove = bpy.context.object
glove.name = 'Continuous_glove'
remesh = glove.modifiers.new('Weld palm web and finger topology', 'REMESH')
remesh.mode = 'VOXEL'
remesh.voxel_size = .00135
remesh.use_smooth_shade = True
bpy.ops.object.modifier_apply(modifier=remesh.name)
smooth = glove.modifiers.new('Relax glove surface', 'SMOOTH')
smooth.factor = .65
smooth.iterations = 5
bpy.ops.object.modifier_apply(modifier=smooth.name)
dec = glove.modifiers.new('Viewmodel topology budget', 'DECIMATE')
dec.ratio = .48
bpy.ops.object.modifier_apply(modifier=dec.name)
# Match the abducted thumb rest mesh in Blender. Runtime inverses use the same
# rest transform, leaving the saddle free to oppose the fingers in every pose.
active(rig)
bpy.ops.object.mode_set(mode='EDIT')
for name, a, b in [('thumb_base', 0, .015), ('thumb_0', 0, .05), ('thumb_1', .05, .082), ('thumb_1_flex', .05, .082)]:
    eb = rig_data.edit_bones[name]
    eb.head = xyz(thumb_start + thumb_axis*a)
    eb.tail = xyz(thumb_start + thumb_axis*b)
bpy.ops.object.mode_set(mode='OBJECT')

# Sewn polygonal panels, flex channels and real lockstitch silhouettes.
meshes = [glove]
from mathutils.bvhtree import BVHTree
glove_surface = BVHTree.FromObject(glove, bpy.context.evaluated_depsgraph_get())
def conform(obj, y, offset):
    for v in obj.data.vertices:
        origin = Vector((v.co.x, v.co.y, .08 if y > 0 else -.08))
        hit, _, _, _ = glove_surface.ray_cast(origin, Vector((0,0,-1 if y > 0 else 1)))
        if hit:
            v.co.z = hit.z + (v.co.z-y) + (offset if y > 0 else -offset)

def panel(name, outline, y, mat, thickness=.0012, stitch=False):
    sign = 1 if y > 0 else -1
    count = len(outline)
    verts = [(x,y,z) for x,z in outline] + [(x,y+sign*thickness,z) for x,z in outline]
    faces = [tuple(reversed(range(count))), tuple(count+i for i in range(count))]
    faces += [(i,(i+1)%count,(i+1)%count+count,i+count) for i in range(count)]
    obj = mesh(name, verts, faces, mat)
    active(obj)
    bevel = obj.modifiers.new('Soft sewn edge', 'BEVEL')
    bevel.width = .0007
    bevel.segments = 3
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.quads_convert_to_tris(quad_method='BEAUTY', ngon_method='BEAUTY')
    bpy.ops.mesh.subdivide(number_cuts=2)
    bpy.ops.object.mode_set(mode='OBJECT')
    conform(obj, y, .0004)
    meshes.append(obj)
    if stitch:
        center = np.mean(np.array(outline),axis=0)
        for i in range(count):
            a = np.array(outline[i])*.94+center*.06
            b = np.array(outline[(i+1)%count])*.94+center*.06
            length = np.linalg.norm(b-a)
            steps = max(1,int(length/.003))
            for j in range(steps):
                p = a+(b-a)*(j+.18)/steps
                q = a+(b-a)*(j+.72)/steps
                direction = (q-p)/np.linalg.norm(q-p)
                side = np.array([-direction[1],direction[0]])*.00018
                corners = [p+side,p-side,q-side,q+side]
                seam = mesh('Lockstitch', [(v[0],y+sign*(thickness+.00015),v[1]) for v in corners], [(0,1,2,3)], thread)
                conform(seam, y, .00045)
                meshes.append(seam)

for i in range(4):
    x = xs[i]
    panel(f'MCP_flex_pad_{i}', [(x-.008,-.075),(x+.007,-.075),(x+.009,-.083),(x+.006,-.092),(x-.006,-.092),(x-.009,-.084)], .0135, pad_mat, .002)
    for j,z in enumerate([-.115,-.14]):
        x = xs[i]-math.sin(-xs[i]*2.2)*(-z-.096)
        panel(f'Finger_suede_{i}_{j}', [(x-.0045,z+.007),(x+.0045,z+.007),(x+.006,z-.004),(x+.003,z-.008),(x-.003,z-.008),(x-.006,z-.004)], .0018, palm_mat, .0008)
panel('Palm_grip_panel', [(-.023,-.019),(.009,-.023),(.024,-.044),(.025,-.075),(.014,-.086),(-.026,-.080),(-.032,-.048)], -.016, palm_mat, .001, True)
panel('Dorsal_stretch_panel', [(-.021,-.018),(.012,-.020),(.025,-.045),(.024,-.067),(.014,-.072),(-.025,-.071),(-.032,-.049)], .016, palm_mat, .0008, True)
# Woven cuff with overlapping adjustable tab.
meshes.append(loft('Glove_cuff_binding', [(0,0,.025,.028,.025,0), (0,0,.015,.029,.026,0), (0,0,-.004,.030,.020,0)], palm_mat))
meshes.append(ellipsoid('Wrist_adjustment_tab', (.005,.020,.002), (.018,.0024,.008), pad_mat))

# Continuous sleeve, irregular bias folds, elbow compression and narrow cuff.
rings = []
for k in range(97):
    z = .01 + .63*k/96
    r = float(np.interp(z, [.01,.055,.18,.30,.43,.64], [.024,.028,.034,.036,.041,.047]))
    envelope = .0017 + .0036*math.exp(-((z-.29)/.065)**2) + .0021*math.exp(-((z-.065)/.045)**2)
    wrinkle = envelope*(math.sin(z*137 + .7*math.sin(z*57)) + .35*math.sin(z*281))
    rings.append((.0015*math.sin(z*21), 0, z, r+wrinkle, (r+wrinkle)*.9, .017 + .015*math.exp(-((z-.3)/.06)**2)))
sleeve = loft('Continuous_combat_sleeve', rings, cloth, 48)
meshes.append(sleeve)
# Two flat-felled longitudinal seams; deliberately subtle at first-person scale.
for side in [-1, 1]:
    verts, faces = [], []
    for x,y,z,rx,ry,fold in rings:
        for a in [side*.6-.013, side*.6+.013]:
            verts.append((x+(rx+.0005)*math.cos(a), (ry+.0005)*math.sin(a), z))
    for k in range(len(rings)-1):
        faces.append((k*2,k*2+1,k*2+3,k*2+2))
    meshes.append(mesh('Felled_sleeve_seam', verts, faces, thread))

# Bind nearest digit centerline with smooth, two-joint transitions. A soft web
# transition carries the proximal root into the palm without visible gaps.
def smoothstep(a, b, t):
    u = max(0, min(1, (t-a)/(b-a)))
    return u*u*(3-2*u)

def weights(p):
    x,y,z = p
    if z > .009:
        w = smoothstep(.255,.345,z)
        wrist = 1-smoothstep(.005,.040,z)
        return {'upper': w, 'fore': (1-w)*(1-wrist), 'hand': (1-w)*wrist}
    tthumb = (Vector(p)-thumb_start).dot(thumb_axis)
    thumb_dist = (Vector(p)-thumb_start-thumb_axis*tthumb).length
    if tthumb > .007 and thumb_dist < .026 and x > .036:
        w = smoothstep(.038,.062,tthumb)
        root = smoothstep(.006,.030,tthumb) * smoothstep(.036,.051,x)
        flex = 1-smoothstep(0,.011,abs(tthumb-.05))
        return {'hand':1-root, 'thumb_0':root*(1-w)*(1-flex), 'thumb_1':root*w*(1-flex), 'thumb_1_flex':root*flex}
    if z > -.083:
        return {'hand':1}
    i = min(range(4), key=lambda j: abs(x-(xs[j]-math.sin(-xs[j]*2.2)*max(0,-z-.096))))
    t = -z-.096
    root = smoothstep(-.013,.012,t)
    a,b = lengths[i][0], sum(lengths[i][:2])
    w1, w2 = smoothstep(a-.008,a+.008,t), smoothstep(b-.007,b+.007,t)
    joint = 1 if abs(t-a) < abs(t-b) else 2
    boundary = a if joint == 1 else b
    flex = 1-smoothstep(0,.011,abs(t-boundary))
    return {'hand':1-root, f'finger_{i}_0':root*(1-w1)*(1-flex), f'finger_{i}_1':root*w1*(1-w2)*(1-flex), f'finger_{i}_2':root*w2*(1-flex), f'finger_{i}_{joint}_flex':root*flex}

for obj in meshes:
    active(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for name in bones:
        obj.vertex_groups.new(name=name)
    for v in obj.data.vertices:
        p = (v.co.x, v.co.z, -v.co.y)
        ww = weights(p)
        total = sum(ww.values())
        for name,w in ww.items():
            if w > 1e-5:
                obj.vertex_groups[name].add([v.index], w/total, 'REPLACE')
    # Smart unwrap is retained in .blend; baked maps are local, tiled microdetail.
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=.015)
    bpy.ops.object.mode_set(mode='OBJECT')
    mod = obj.modifiers.new('Deform with player controls', 'ARMATURE')
    mod.object = rig
    obj.parent = rig

# One submission per material per arm; named vertex groups remain editable.
merged = []
groups = [(mat, [o for o in meshes if o.data.materials[0] == mat]) for mat in [shell, palm_mat, pad_mat, cloth, thread]]
for mat, group in groups:
    active(group[0])
    for o in group:
        o.select_set(True)
    if len(group) > 1:
        bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = mat.name + '_skin'
    merged.append(obj)
meshes = merged
for obj in meshes:
    active(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=.008)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.data.uv_layers[0].name = 'AO'
    source_uv = obj.data.uv_layers[0]
    micro = obj.data.uv_layers.new(name='Microdetail')
    density = math.sqrt(sum(p.area for p in obj.data.polygons))/.055
    for i in range(len(micro.data)):
        micro.data[i].uv = source_uv.data[i].uv * density
    obj.data.uv_layers.active_index = 0
    obj.data.uv_layers[0].active_render = True

# Bake local crevice/contact occlusion into the unique UV set. Tileable micro-
# detail uses a second UV set, so sleeve yarn density is not stretched to fit
# the whole arm. No weapon is present during this self-occlusion bake.
scene.cycles.samples = 16
for obj in meshes:
    active(obj)
    mat = obj.data.materials[0]
    image = bpy.data.images.new(mat.name+'_AO', width=1024, height=1024)
    image.colorspace_settings.name = 'Non-Color'
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    node.image = image
    mat.node_tree.nodes.active = node
    bpy.ops.object.bake(type='AO', margin=8)
    image.filepath_raw = str(OUT/(mat.name+'_ao.png'))
    image.file_format = 'PNG'
    image.save()
    image.pack()
    group = bpy.data.node_groups.get('glTF Material Output')
    if not group:
        group = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        group.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    output = mat.node_tree.nodes.new('ShaderNodeGroup')
    output.node_tree = group
    mat.node_tree.links.new(node.outputs['Color'], output.inputs['Occlusion'])
scene.cycles.samples = 32

# Blender-authored pose actions: neutral -> contact -> neutral, with eased
# approach and a stable hold. Export full actions for independent DCC review.
poses = json.loads((OUT/'pose-reference.json').read_text())
rig.animation_data_create()
baked_poses = {}
pose_ease = []
for name, pose in poses.items():
    action = bpy.data.actions.new('Pose_' + name)
    rig.animation_data.action = action
    for frame, amount in [(1,0), (10,1), (40,1), (52,0)]:
        for pb in rig.pose.bones:
            pb.rotation_mode = 'XYZ'
            pb.rotation_euler = (0,0,0)
        for i in range(4):
            for j in range(3):
                rig.pose.bones[f'finger_{i}_{j}'].rotation_euler.x = -pose['fingers'][i][j]*amount
                if j > 0:
                    rig.pose.bones[f'finger_{i}_{j}_flex'].rotation_euler.x = -pose['fingers'][i][j]*amount*.5
        # Blender basis conversion: engine XYZ -> Blender X, -Z, Y.
        base = pose['thumbBase']
        from mathutils import Euler, Matrix
        c = Matrix(((1,0,0),(0,0,-1),(0,1,0)))
        rest = Euler((0,thumb_angle,0), 'XYZ').to_matrix()
        target = Euler(tuple(base), 'XYZ').to_matrix()
        delta = rest.inverted() @ target
        local = (c @ delta @ c.inverted()).to_euler()
        rig.pose.bones['thumb_base'].rotation_euler = tuple(v*amount for v in local)
        for j in range(2):
            rig.pose.bones[f'thumb_{j}'].rotation_euler.x = -pose['thumb'][j]*amount
        rig.pose.bones['thumb_1_flex'].rotation_euler.x = -pose['thumb'][1]*amount*.5
        for pb in rig.pose.bones:
            pb.keyframe_insert('rotation_euler', frame=frame, group=pb.name)
    scene.frame_set(10)
    evaluated = rig.evaluated_get(bpy.context.evaluated_depsgraph_get())
    baked_poses[name] = {
        'fingers': [[round(-evaluated.pose.bones[f'finger_{i}_{j}'].rotation_euler.x, 7) for j in range(3)] for i in range(4)],
        'thumb': [round(-evaluated.pose.bones[f'thumb_{j}'].rotation_euler.x, 7) for j in range(2)],
        'thumbBase': [round(v, 7) for v in (rest @ c.inverted() @ evaluated.pose.bones['thumb_base'].rotation_euler.to_matrix() @ c).to_euler('XYZ')],
    }
    if name == 'open':
        for sample in range(33):
            frame = 1 + 9*sample/32
            scene.frame_set(int(frame), subframe=frame-int(frame))
            evaluated = rig.evaluated_get(bpy.context.evaluated_depsgraph_get())
            pose_ease.append(round(-evaluated.pose.bones['finger_0_0'].rotation_euler.x / pose['fingers'][0][0], 7))
    track = rig.animation_data.nla_tracks.new()
    track.name = action.name
    track.strips.new(action.name, 1, action)
    track.mute = True
rig.animation_data.action = None
for pb in rig.pose.bones:
    pb.rotation_euler = (0,0,0)
scene.frame_set(1)
# The engine consumes authored contact values with the same eased approach;
# weapon root trajectories and event timings remain gameplay-owned.
(ROOT/'src/weapons/hand-poses.js').write_text('// Generated by tools/blender/player_arms.py. Edit Blender pose source, not this file.\nexport const HAND_POSES = '+json.dumps(baked_poses, indent=2)+';\nexport const HAND_POSE_EASE = '+json.dumps(pose_ease)+';\n')
text = bpy.data.texts.new('START HERE')
text.write('PLAYER ARMS\nContinuous welded glove and sleeve deformation meshes, metres.\nLeft-hand bind mesh; engine mirrors the right hand before binding.\nPose_* NLA tracks: enable ONE track to review contact poses at frame 10-40.\nWeapon root trajectories/IK are game-owned, not baked into these pose clips.\nPacked PBR maps; generated by tools/blender/player_arms.py.\n')
# Export selection before studio creation, with all pose tracks enabled.
active(rig)
for obj in meshes:
    obj.select_set(True)
for track in rig.animation_data.nla_tracks:
    track.mute = False
bpy.ops.export_scene.gltf(filepath=str(PUBLIC/'arms.glb'), export_format='GLB', use_selection=True,
    export_animations=True, export_animation_mode='NLA_TRACKS', export_skins=True,
    export_yup=True, export_apply=False, export_extras=True)
for track in rig.animation_data.nla_tracks:
    track.mute = True

# Lit authoring review: palm, finger silhouette, sleeve folds, not a game frame.
def camera(name, pos, target):
    bpy.ops.object.camera_add(location=xyz(pos))
    o = bpy.context.object
    o.name = name
    o.rotation_euler = (Vector(xyz(target))-o.location).to_track_quat('-Z','Y').to_euler()
    o.data.type = 'ORTHO'
    o.data.ortho_scale = .90
    return o
scene.camera = camera('Arm_overview', (.4,.85,.35), (0,0,.22))
for name, pos, power, size in [('Key',(.3,.5,-.2),65,.55), ('Fill',(-.4,.2,.25),35,.6), ('Rim',(.2,-.25,.5),90,.4)]:
    bpy.ops.object.light_add(type='AREA', location=xyz(pos))
    o=bpy.context.object
    o.name=name
    o.data.energy=power
    o.data.shape='DISK'
    o.data.size=size
    o.rotation_euler=(Vector(xyz((0,0,.2)))-o.location).to_track_quat('-Z','Y').to_euler()
scene.frame_end=52
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'player-arms.blend'))
manifest = {'generator':'tools/blender/player_arms.py', 'runtime':'public/models/player/arms.glb',
    'vertices':sum(len(o.data.vertices) for o in meshes), 'bones':list(bones), 'poses':list(poses),
    'thumbRestY':thumb_angle, 'units':'metres', 'scope':'deformation meshes and finger-pose actions; game-owned weapon trajectories',
    'sha256': {str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__), OUT/'pose-reference.json', PUBLIC/'arms.glb', ROOT/'src/weapons/hand-poses.js']}}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
if '--render' in sys.argv:
    scene.render.filepath=str(OUT/'overview.png')
    bpy.ops.render.render(write_still=True)
