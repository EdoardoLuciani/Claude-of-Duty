"""Photo-referenced Micro T-2 #200170 game art; no CAD or external build inputs.

Blender X right, Y forward, Z up. Local dimensions in millimetres. The standard
low saddle is the reference configuration; both dust covers are posed open.
"""
import argparse
import math
from pathlib import Path
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tools/blender'))
import picatinny

MM = .001
AXIS = 20


def xyz(v):
    return Vector(v) * MM


def active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def empty(name, p=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = xyz(p)
    return obj


def material(name, rgb, metal, roughness, alpha=1):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb, alpha)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    for key, value in [('Base Color', (*rgb, 1)), ('Metallic', metal),
                       ('Roughness', roughness), ('Alpha', alpha)]:
        bsdf.inputs[key].default_value = value
    return mat


def micro_finish(root, finishes):
    # Seeded micro-normal tile for the bead-blasted housing, saddle and polymer.
    # Original grain, not a projection of the Aimpoint photos.
    size = 128
    grain = np.random.default_rng(200170).normal(0, .027, (size, size))
    pixels = np.ones((size, size, 4), dtype=np.float32)
    pixels[:, :, 0] = .5 + (np.roll(grain, 1, axis=1) - grain)
    pixels[:, :, 1] = .5 + (np.roll(grain, 1, axis=0) - grain)
    image = bpy.data.images.new('T-2 micro-grain normal', size, size, alpha=False)
    image.colorspace_settings.name = 'Non-Color'
    image.pixels.foreach_set(pixels.ravel())
    image.pack()
    for mat, strength in finishes.items():
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = image
        normal = nodes.new('ShaderNodeNormalMap')
        normal.inputs['Strength'].default_value = strength
        links.new(tex.outputs['Color'], normal.inputs['Color'])
        links.new(normal.outputs['Normal'], nodes.get('Principled BSDF').inputs['Normal'])
    for obj in root.children:
        if obj.type != 'MESH' or not any(m in finishes for m in obj.data.materials):
            continue
        uv = obj.data.uv_layers.new(name='UVMap')
        for face in obj.data.polygons:
            a, b = [(1, 2), (0, 2), (0, 1)][max(range(3), key=lambda k: abs(face.normal[k]))]
            for i in face.loop_indices:
                p = obj.data.vertices[obj.data.loops[i].vertex_index].co
                uv.data[i].uv = (p[a] / .023, p[b] / .023)


def mesh(name, points, faces, mat, parent, bevel=0, smooth=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata([xyz(p) for p in points], [], faces)
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    data.materials.append(mat)
    for face in data.polygons:
        face.use_smooth = smooth or bool(bevel)
    if bevel:
        active(obj)
        edge = obj.modifiers.new('Machined radii', 'BEVEL')
        edge.width, edge.segments, edge.harden_normals = bevel * MM, 3, True
        bpy.ops.object.modifier_apply(modifier=edge.name)
        normal = obj.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
        normal.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier=normal.name)
    return obj


def prism(name, outline, lo, hi, coordinate, mat, parent, bevel):
    n = len(outline)
    points = [coordinate(k, a, b) for k in (lo, hi) for a, b in outline]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
    faces += [(i, (i+1)%n, (i+1)%n+n, i+n) for i in range(n)]
    return mesh(name, points, faces, mat, parent, bevel)


def box(name, p, size, mat, parent, bevel=.25):
    x,y,z = p
    w,l,h = (s/2 for s in size)
    return prism(name, [(y-l,z-h), (y+l,z-h), (y+l,z+h), (y-l,z+h)],
                 x-w, x+w, lambda a,b,c: (a,b,c), mat, parent, bevel)


def spin_x(obj, centre, angle):
    obj.data.transform(Matrix.Translation(-xyz(centre)))
    obj.location = xyz(centre)
    obj.rotation_euler.x = angle


def turned(name, p, axis, profile, mat, parent, sides=64, flutes=0):
    """Lathe a closed exterior/interior silhouette; axis-distance / radius pairs."""
    origin, axis = Vector(p), Vector(axis).normalized()
    u = axis.cross(Vector((0, 0, 1))) if abs(axis.z) < .98 else Vector((1, 0, 0))
    u.normalize()
    v = axis.cross(u)
    points = []
    for d, radius in profile:
        for i in range(sides):
            a = math.tau * i / sides
            r = radius - (flutes if i%4 in (0, 3) else 0)
            points.append(origin + axis*d + (u*math.cos(a)+v*math.sin(a))*r)
    faces = [(j*sides+i, j*sides+(i+1)%sides, ((j+1)%len(profile))*sides+(i+1)%sides,
              ((j+1)%len(profile))*sides+i) for j in range(len(profile)) for i in range(sides)]
    obj = mesh(name, points, faces, mat, parent, smooth=True)
    # The flat cut faces stay planar; curved surfaces get continuous normals.
    for face in obj.data.polygons:
        d = [(axis.dot(v) / MM) for v in (obj.data.vertices[i].co for i in face.vertices)]
        face.use_smooth = max(d) - min(d) > .0002
    return obj


def disc(name, p, axis, r, depth, mat, parent, sides=64, flutes=0):
    # Tiny nonzero radial closure avoids collapsed faces at the centre.
    return turned(name, p, axis, [(-depth/2,.01), (-depth/2,r-.3), (-depth/2+.18,r),
                  (depth/2-.18,r), (depth/2,r-.3), (depth/2,.01)], mat, parent, sides, flutes)


def glass(name, p, axis, radius, bow, mat, parent):
    p, axis = Vector(p), Vector(axis).normalized()
    u = axis.cross(Vector((0,0,1))).normalized()
    v = axis.cross(u)
    points = [p + axis * bow]
    count = 64
    for j in range(1, 5):
        s = j/4
        for i in range(count):
            a = math.tau*i/count
            points.append(p + axis*(bow*(1-s*s)) + (u*math.cos(a)+v*math.sin(a))*radius*s)
    faces = [(0, 1+i, 1+(i+1)%count) for i in range(count)]
    faces += [(1+j*count+i, 1+(j+1)*count+i, 1+(j+1)*count+(i+1)%count,
               1+j*count+(i+1)%count) for j in range(3) for i in range(count)]
    return mesh(name, points, faces, mat, parent, smooth=True)


def stamp(name, label, p, size, mat, parent, side):
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body, curve.size, curve.align_x = label, size*MM, 'CENTER'
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.parent, obj.location = parent, xyz(p)
    if side:
        obj.rotation_euler = Matrix(((0,0,side), (side,0,0), (0,1,0))).to_euler()
    active(obj)
    bpy.ops.object.convert(target='MESH')
    obj.data.materials.append(mat)
    return obj


def build(root):
    body = material('01 | graphite anodizing', (.024,.025,.028), .35, .59)
    saddle = material('02 | satin clamp anodizing', (.018,.020,.023), .42, .49)
    caps = material('03 | textured cover polymer', (.014,.015,.017), 0, .73)
    steel = material('04 | dark turned steel', (.046,.049,.054), .72, .44)
    print_ink = material('05 | soft grey pad print', (.48,.462,.426), 0, .68)
    etch = material('06 | dark laser mark', (.015,.017,.019), .28, .75)
    baffle = material('07 | nonreflective bore', (.003,.0036,.0044), 0, .94)
    baffle.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value = 0
    objective = material('10 | amber objective coating', (.30,.066,.012), 0, .16, .24)
    ocular = material('10 | clear ocular and cover', (.076,.123,.121), 0, .16, .16)
    X, Y, Z = (1,0,0), (0,1,0), (0,0,1)

    # Turned main tube and stepped lens retainers. Its centre is physically open.
    tube = turned('Forged tube and end shoulders', (0,0,AXIS), Y,
           [(-36.4,13),(-37,14),(-36.6,15),(-30.7,15),(-29.4,15.9),(-27.4,16.1),
            (26.6,16.1),(28.5,15.5),(30,14.8),(36.7,14.8),(37.3,14.1),(37.3,12.8),
            (34.5,12.7),(32.3,11.3),(27,10.2),(24,9),(-27,9),(-31,10.2),(-34,11.5),
            (-36.4,12.5)], body, root, 96)
    tube.data.materials.append(baffle)
    for face in tube.data.polygons[11*96:]:
        face.material_index = 1
    for side in (-1,1):
        turned('Stepped inner retaining ring', (0,side*34,AXIS), Y,
               [(-1.3,11.9),(-1.6,12.2),(1.6,12.2),(1.8,11.8),(1.8,11.3),(-1.3,11.3)], baffle, root)
    glass('Warm coated front objective', (0,28,AXIS), (0,.993,.118), 10.6, 1.5, objective, root)
    glass('Recessed rear ocular', (0,-30,AXIS), (0,-1,0), 10.8, .9, ocular, root)

    # The top guard sweeps forward into the tube, leaving a U around the dial.
    for x in (-7.9,7.9):
        side = lambda a,b,c: (a,b,c)
        prism('Swept forward elevation guard', [(-7.5,29.8),(-7.5,38.9),(-3.4,38.9),
               (2.5,35.3),(14,32.9),(16,29.8)], x-2.4,x+2.4, side, body,root,.58)
        prism('Rear elevation guard', [(-26.5,30),(-26.5,38),(-24,39),(-20,39),(-20,30)],
               x-2.4,x+2.4, side, body,root,.53)
    disc('Recessed elevation well', (0,-14,35), Z, 6.2, 1.4, steel, root)
    disc('Knurled elevation cap', (0,-14,37), Z, 5.7, 4.1, saddle, root, 80, .34)
    box('Elevation tool face', (0,-14,39.12), (7.4,.55,.18), etch, root, .08)
    disc('Windage shoulder', (14.9,-16,20.5), X, 8.1, 2.35, body, root)
    disc('Knurled windage cap', (17.2,-16,20.5), X, 7.2, 3, saddle, root, 80, .27)
    for z in (18.8,22.1):
        disc('Windage cap tool detail', (18.76,-16.2,z), X, .62, .22, etch, root, 16)
    disc('Control-side reinforced boss', (14,6.9,19.4), X, 15.1, 4.3, body, root)
    disc('Knurled intensity and battery dial', (22,7,19.4), X, 14.9, 8.0, saddle, root, 144, .39)
    lid = disc('Inset battery lid face', (26.15,7,19.4), X, 14.2, .46, body, root)
    slot_center = (26.49,7,19.4)
    slot = box('Battery coin-slot tool', slot_center, (.68,2.25,17), etch, root, .24)
    spin_x(slot, slot_center, math.radians(28))
    active(lid)
    cut = lid.modifiers.new('Recessed coin slot', 'BOOLEAN')
    cut.object = slot
    bpy.ops.object.modifier_apply(modifier=cut.name)
    bpy.data.objects.remove(slot, do_unlink=True)
    for i, glyph in enumerate('− INTENSITY +'):
        if glyph == ' ':
            continue
        angle = math.radians((i-6)*8)
        p = (26.41, 7+11*math.sin(angle), 19.4+11*math.cos(angle))
        mark = stamp('Intensity face legend', glyph, p, 1.9, print_ink, root, 1)
        mark.rotation_euler = (Matrix.Rotation(-angle,3,'X') @ mark.rotation_euler.to_matrix()).to_euler()
    for i, digit in enumerate(('8','9','10','11','12')):
        theta = math.radians(-52 + 24*i)
        y,z = 7+15.0*math.cos(theta),19.4+15.0*math.sin(theta)
        stamp('Index '+digit, digit, (22,y,z), 1.85, print_ink, root, 0).rotation_euler = (
            theta-math.pi/2, 0, math.pi/2)

    # Low standard mount: continuous floor, fixed jaw and removable side plate.
    box('Integral receiver foot', (0,0,5.9), (23.4,53,6.2), body, root, .86)
    clamp = box('Low saddle with fixed jaw', (-1.05,0,.45), (24.1,54,8.9), saddle, root, .56)
    jaw = box('Moving clamp jaw', (11.2,0,.25), (6.2,20,8.3), saddle, root, .48)
    picatinny.cut_channel([clamp,jaw], Matrix.Identity(4), -.029,.029)
    box('Recoil bar in centre groove', (0,0,-1.05), (21.2,4.05,2.1), steel, root, .16)
    disc('Clamp crossbolt head', (14.35,0,.25), X, 3.8, 1, steel, root, 40)
    disc('Clamp socket recess', (14.88,0,.25), X, 2, .21, etch, root, 6)
    disc('Crossbolt tail', (-13.25,0,.25), X, 1.7, .54, steel, root, 32)
    stamp('Left identification print', 'Micro T-2 2MOA', (-11.77,0,6.4), 2.35, print_ink, root, -1)
    stamp('Laser wordmark', 'Aimpoint', (-16.11,1,18.1), 5.45, etch, root, -1)

    # Asymmetric reference covers: front solid and tipped back over the roof;
    # rear nearly upright with a clear centre. Both retain their hinge seams.
    for side in (1,-1):
        p = (0,side*34.7,AXIS)
        turned(('Front' if side == 1 else 'Rear')+' snap-on cover collar', p, (0,side,0),
               [(-4,14.35),(-4.2,15.4),(-3.6,16.1),(.9,16.1),(1.4,15.85),(1.65,15.18),
                (2.15,15.18),(2.4,15.86),(3.45,15.75),(4.25,15.25),(4.5,14.64),
                (4.3,13.3),(2.8,12.45),(-3.9,13.65)], caps, root, 80)
        hinge = (0,side*33.4,AXIS+16.1)
        for x in (-9.1,9.1):
            def ear(a, b, c):
                return (a, hinge[1]+side*b, hinge[2]+c)
            prism('Sculpted cover hinge ear', [(-3.1,-5),(-3.1,-.5),(-2.1,1.7),
                  (-.1,2.45),(2.0,1.8),(3.65,-.35),(3,-4.15)],
                  x-2.05,x+2.05, ear, caps,root,.5)
            skin = x+math.copysign(2.068,x)
            mesh('Hinge relief line', [ear(skin,a,b) for a,b in ((-1.5,-2.9),(1.7,-2.9),(.35,-.5))],
                 [(0,1,2)], etch,root)
        disc('Hinge knuckle', hinge, X, 2.6, 15.2, caps, root, 36)
        disc('Hinge pin', hinge, X, 1.06, 23, steel, root, 24)
        angle = math.radians(29 if side == 1 else 97)
        d = Vector((0,-math.cos(angle),math.sin(angle)))
        n = (0,math.sin(angle),math.cos(angle))
        p = Vector(hinge) + d*14.0
        turned('Raised dust cover rim', p, n,
               [(-2.6,12.8),(-2.9,14.65),(-2.2,15.72),(-.4,15.72),(.12,15.32),
                (.65,15.75),(2.15,15.72),(2.75,14.65),(2.75,12.45),
                (1,12.15),(-1.5,12.15)], caps, root, 80)
        if side == 1:
            disc('Solid recessed front lid', p, n, 12.7, 2.15, caps,root)
        else:
            glass('Clear cap insert', p, n, 12.2, .13, ocular, root)
        tab_center = p+d*15.15
        tab = box('Moulded lift tab', tab_center, (8.1,4.4,2.45), caps,root,.75)
        spin_x(tab, tab_center, -angle)

    micro_finish(root, {body: .34, saddle: .23, caps: .55})


def render_views(output):
    """Neutral studio for side-by-side reference checks, excluded from the asset."""
    output.mkdir(exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'AgX'
    target = Vector((0,0,.028))
    for name, p, energy, size in [('Key',(-.08,.12,.17),1.4,.14), ('Fill',(.11,-.04,.10),1.1,.14),
                                  ('Rim',(.05,.17,.035),.55,.12), ('Bounce',(-.10,-.11,-.08),.65,.13)]:
        light = bpy.data.lights.new(name, 'AREA')
        light.energy, light.shape, light.size = energy, 'DISK', size
        obj = bpy.data.objects.new(name, light)
        scene.collection.objects.link(obj)
        obj.location = p
        obj.rotation_euler = (target-obj.location).to_track_quat('-Z','Y').to_euler()
    cam = bpy.data.cameras.new('Review camera')
    cam.type, cam.ortho_scale, cam.clip_start = 'ORTHO', .103, .001
    scene.camera = bpy.data.objects.new('Review camera', cam)
    scene.collection.objects.link(scene.camera)
    for name, d in [('left',(-1,0,.045)), ('right',(1,0,.045)), ('front',(0,1,0)), ('rear',(0,-1,0)),
                    ('top',(0,.04,1)), ('bottom',(0,.04,-1)), ('front-left',(-.77,.83,.34)),
                    ('front-right',(.72,.85,.55)), ('rear-right',(.85,-.72,.42))]:
        scene.camera.location = target + Vector(d).normalized()*.32
        scene.camera.rotation_euler = (target-scene.camera.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath = str(output/(name+'.png'))
        bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT/'.cache/blender/attachments/aimpoint-micro-t2')
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    args.output.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    root = empty('ATTACHMENT_MICRO_T2')
    build(root)
    empty('MOUNT_base', parent=root)
    empty('SOCKET_sight', (0,-32,AXIS), root)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output/'micro-t2.blend'))
    # Runtime has one rigid mesh, split into primitives by material on glTF export.
    bpy.ops.object.select_all(action='DESELECT')
    meshes = [o for o in root.children if o.type == 'MESH']
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    meshes[0].name = 'micro_t2_mesh'
    triangles = meshes[0].modifiers.new('Runtime triangle tangents', 'TRIANGULATE')
    triangles.keep_custom_normals = True
    bpy.ops.object.modifier_apply(modifier=triangles.name)
    bpy.ops.export_scene.gltf(filepath=str(args.output/'micro-t2.glb'), export_format='GLB',
                              export_animations=False, export_yup=True, export_tangents=True)
    if args.render:
        render_views(args.output/'renders')


if __name__ == '__main__':
    main()
