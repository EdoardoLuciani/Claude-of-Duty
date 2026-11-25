"""M4-72-inspired game prop. The visible shell is solid and has no working geometry."""
import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import can

STEM = 'm4-72'
# Game-art scale: keep the authored M4A1 shot-effect origin at the nose.
LENGTH = .06604
RADIUS = LENGTH * .189
SIDES = 64


def ease(t):
    t = min(1, max(0, t))
    return t*t*(3-2*t)


def make_shell(root):
    # Photo-derived silhouette, not measured dimensions. The side impressions
    # are shallow relief backed by solid material, and the nose is a blind dimple.
    profile = [(0, .80), (.009, .865), (.021, .883), (.098, .883),
               (.114, .86), (.129, .751), (.144, .714), (.165, .714),
               (.181, .988), (.195, 1), (.219, 1), (.235, .995),
               (.250, .724), (.272, .726), (.289, .741), (.298, .965),
               (.309, 1), (.971, 1), (.988, .955), (1, .863)]
    radii = []
    for (y1, r1), (y2, r2) in zip(profile, profile[1:]):
        steps = max(1, math.ceil((y2-y1)*112))
        radii.extend((y1+(y2-y1)*i/steps, r1+(r2-r1)*i/steps) for i in range(steps))
    radii.append(profile[-1])
    angles = [i*math.tau/SIDES for i in range(SIDES)]
    circle = [(math.cos(a), math.sin(a)) for a in angles]
    vertices, faces, colors = [], [], []

    def ring(y, points):
        start = len(vertices)
        for x, z, shadow in points:
            vertices.append((x*RADIUS, y*LENGTH, z*RADIUS))
            steel = .34*(1-shadow)+.008*shadow
            colors.append((steel, steel*.981, steel*.939, 1))
        if start:
            for j in range(SIDES):
                k = (j+1) % SIDES
                faces.append((start-SIDES+j, start+j, start+k, start-SIDES+k))

    for y, radius in radii:
        points = []
        for x, z in circle:
            q = abs((math.atan2(z, abs(x))-.19)/1.21)
            relief, shade = 0, 0
            if q < 1:
                for center, width, sweep, curve in ((.422, .080, .095, 2),
                                                    (.608, .080, .090, 2),
                                                    (.816, .106, .076, 4)):
                    arc = (1-q**curve)**(1/curve)
                    local = y-center-sweep*q**(2 if curve == 2 else 3.1)
                    extent = width*arc*(1 if local < 0 else .78)
                    if abs(local) < extent:
                        margin = (extent-abs(local))/width
                        relief = max(relief, ease(margin/.69)*.43)
                        shade = max(shade, ease((margin-.17)/.48)*.99)
            bottom = -.86 + .075*ease(y/.025) if y < .13 else -.79
            top = .956 if y >= .297 else 1
            surface = radius-relief
            points.append((x*surface, max(bottom, min(top, z))*surface, shade))
        ring(y, points)

    for y, radius, shade in ((1, .34, 0), (1, .304, .06), (.991, .273, .55),
                             (.977, .245, .98), (.975, .105, 1)):
        ring(y, [(radius*x, radius*z, shade) for x, z in circle])
    faces.extend((tuple(range(SIDES)), tuple(reversed(range(len(vertices)-SIDES, len(vertices))))))

    mesh = bpy.data.meshes.new('M4-72 | solid display skin')
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    color = mesh.color_attributes.new(name='Painted occlusion', type='FLOAT_COLOR', domain='POINT')
    for c, value in zip(color.data, colors):
        c.color = value

    mat = can.material('M4-72 | matte stainless', (1, 1, 1), .43, .64)
    nodes = mat.node_tree.nodes
    shade = nodes.new('ShaderNodeVertexColor')
    shade.layer_name = color.name
    mat.node_tree.links.new(shade.outputs['Color'], nodes.get('Principled BSDF').inputs['Base Color'])
    mesh.materials.append(mat)
    obj = bpy.data.objects.new('M4-72 Brake', mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = root
    # Keep the nose face flat and leave the perimeter highlights rounded.
    for poly in mesh.polygons[:-2]:
        poly.use_smooth = poly.index//SIDES not in (len(radii)-1, len(radii))


root, out = can.begin('ATTACHMENT_m4-72', '.cache/blender/attachments/m4-72')
make_shell(root)
for name, y in (('SOCKET_mount', 0), ('SOCKET_muzzle', LENGTH)):
    node = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(node)
    node.parent = root
    node.location.y = y

bpy.ops.wm.save_as_mainfile(filepath=str(out/f'{STEM}.blend'))
bpy.ops.export_scene.gltf(filepath=str(out/f'{STEM}.glb'), export_format='GLB',
                          export_animations=False, export_yup=True)
