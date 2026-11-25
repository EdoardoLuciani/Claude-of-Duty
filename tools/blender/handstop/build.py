"""Build an original compact Picatinny hand stop; no external meshes or textures."""
import argparse
import sys
from pathlib import Path
from math import pi

import bmesh
import bpy
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import picatinny

ROOT = Path(__file__).resolve().parents[3]


def active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def profile(name, outline, half_width, bevel, material):
    """Extrude the molded side profile in metres across the rail."""
    n = len(outline)
    points = [(x, y, z) for x in (-half_width, half_width) for y, z in outline]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
    faces += [(i, (i+1) % n, (i+1) % n + n, i+n) for i in range(n)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(points, [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(material)
    active(obj)
    mod = obj.modifiers.new('Mold parting radii', 'BEVEL')
    mod.width, mod.segments = bevel, 3
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj


def cylinder(name, x, radius, depth, sides=20):
    bpy.ops.mesh.primitive_cylinder_add(vertices=sides, radius=radius, depth=depth,
                                      location=(x, 0, .0005), rotation=(0, pi/2, 0))
    obj = bpy.context.object
    obj.name = name
    return obj


def empty(name, parent=None, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent, obj.location = parent, location
    return obj


def build(output):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    material = bpy.data.materials.new('Molded earth polymer / blackened pin')
    material.use_backface_culling = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    color = material.node_tree.nodes.new('ShaderNodeVertexColor')
    color.layer_name = 'Tint'
    material.node_tree.links.new(color.outputs['Color'], shader.inputs['Base Color'])
    shader.inputs['Roughness'].default_value = .67

    clamp = profile('Rail saddle', [(-.010, -.008), (.009, -.008), (.010, .002),
                                   (.007, .004), (-.008, .004), (-.011, .001)],
                    .014, .00065, material)
    picatinny.cut_channel([clamp], Matrix.Rotation(pi, 4, 'Y'), -.020, .012)
    body = profile('Raked finger stop', [(-.009, -.006), (.008, -.006), (.012, -.013),
                                        (.005, -.021), (-.009, -.024), (-.023, -.021),
                                        (-.037, -.013), (-.038, -.007), (-.035, -.005)],
                   .0105, .0012, material)
    pin = cylinder('Recoil crossbolt', 0, .00165, .0292)
    head = cylinder('Recessed drive head', -.0142, .0030, .0020)
    tool = cylinder('Hex drive cutter', -.0154, .00148, .0017, 6)
    active(head)
    cut = head.modifiers.new('Hex drive', 'BOOLEAN')
    cut.object = tool
    bpy.ops.object.modifier_apply(modifier=cut.name)
    bpy.data.objects.remove(tool, do_unlink=True)

    for obj, tint in ((clamp, (.108, .076, .050)), (body, (.134, .094, .061)),
                      (pin, (.019, .021, .022)), (head, (.025, .028, .030))):
        obj.data.materials.clear()
        obj.data.materials.append(material)
        for face in obj.data.polygons:
            face.material_index = 0
        layer = obj.data.color_attributes.new(name='Tint', type='FLOAT_COLOR', domain='POINT')
        for v in obj.data.vertices:
            # Restrained injection-mold variation, no painted-in lighting.
            factor = 1 + .025 * ((v.index * 43 % 19) / 9 - 1)
            layer.data[v.index].color = (*(c * factor for c in tint), 1)
    active(clamp)
    for obj in (body, pin, head):
        obj.select_set(True)
    bpy.ops.object.join()
    clamp.name = 'Handstop_body'
    root = empty('ATTACHMENT_handstop')
    clamp.parent = root
    empty('SOCKET_mount', root)
    empty('SOCKET_support_contact', root, (.007, -.03735, -.0068))
    # Same calibrated wrap as the M4A1 base hand, indexed forward to this pad.
    empty('SOCKET_support_wrist', root, (-.067358, -.164567, .002211))

    output.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output/'handstop.blend'))
    bpy.ops.export_scene.gltf(filepath=str(output/'handstop.glb'), export_format='GLB',
                              export_animations=False, export_texcoords=False, export_vertex_color='MATERIAL')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'.cache/blender/attachments/handstop')
    build(parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []).output.resolve())
