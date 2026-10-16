"""MCX finish authority and saved-source material-only maintenance.
blender -b --python-exit-code 1 --python tools/blender/mcx_materials.py
The full procedural rebuild can repack magazine UVs; this path preserves source geometry.
"""
import json
from pathlib import Path
import struct
import sys
import tempfile

# Linear pigment, metalness, roughness multiplier, tangent-normal strength.
POLYMER_FINISH = ('03 | injection-moulded polymer', (.027, .031, .035), 0, .73, .50)
SUPPRESSOR_FINISH = ('06 | suppressor graphite ceramic', (.054, .056, .060), 0, .72, .25)
COATING_FINISH = ('13 | Elite Concrete gray coating', (.145, .155, .168), 0, .57, .10)
FINISHES = (POLYMER_FINISH, SUPPRESSOR_FINISH, COATING_FINISH)


def read_glb(path):
    data = path.read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:20+size]), data[28+size:]


def update_materials():
    import bpy
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from mcx_export import export_mcx

    out = Path(__file__).resolve().parents[2] / 'assets/weapons/mcx-virtus'
    before, binary = read_glb(out / 'mcx-virtus.glb')
    bpy.ops.wm.open_mainfile(filepath=str(out / 'mcx-virtus.blend'))
    for name, color, metal, roughness, detail in FINISHES:
        material = bpy.data.materials[name]
        nodes = material.node_tree.nodes
        expected = [('Principled BSDF', 'ShaderNodeBsdfPrincipled'),
                    ('Mix', 'ShaderNodeMix'), ('Math', 'ShaderNodeMath'),
                    ('Normal Map', 'ShaderNodeNormalMap')]
        for node_name, node_type in expected:
            if nodes[node_name].bl_idname != node_type:
                raise RuntimeError(f'{name}: unexpected {node_name} node')
        mix, scale, normal = nodes['Mix'], nodes['Math'], nodes['Normal Map']
        if mix.data_type != 'RGBA' or mix.blend_type != 'MULTIPLY' or scale.operation != 'MULTIPLY':
            raise RuntimeError(f'{name}: expected tint/roughness multiply nodes')
        p = nodes['Principled BSDF']
        for socket, source in [('Base Color', mix), ('Roughness', scale), ('Normal', normal)]:
            links = p.inputs[socket].links
            if len(links) != 1 or links[0].from_node != source:
                raise RuntimeError(f'{name}: unexpected {socket} link')
        material.diffuse_color = (*color, 1)
        p.inputs['Base Color'].default_value = (*color, 1)
        p.inputs['Metallic'].default_value = metal
        p.inputs['Roughness'].default_value = roughness
        mix.inputs[7].default_value = (*color, 1)
        scale.inputs[1].default_value = roughness
        normal.inputs['Strength'].default_value = detail

    parts = [bpy.data.objects[name] for name in ('MCX_RIG', 'magazine', 'magazine_spare',
             'bolt', 'charging_handle', 'trigger', 'dust_cover', 'stock_hinge', 'spent_case', 'bolt_release')]
    rest = {o.name: (o.location.copy(), o.rotation_euler.copy(), o.scale.copy()) for o in parts}
    # Idle hides these two rigid parts with scale zero; joining needs their rest scale.
    for name in ('magazine_spare', 'spent_case'):
        rest[name] = (rest[name][0], rest[name][1], (1, 1, 1))
    bpy.ops.wm.save_as_mainfile(filepath=str(out / 'mcx-virtus.blend'))
    with tempfile.TemporaryDirectory(prefix='mcx-materials-') as tmp:
        export_mcx(bpy.data.collections['MCX VIRTUS | authored components'], parts, rest, Path(tmp))
        exported = Path(tmp) / 'mcx-virtus.glb'
        after, changed_binary = read_glb(exported)
        old_materials, new_materials = before.pop('materials'), after.pop('materials')
        targets = {finish[0] for finish in FINISHES}
        if before != after or binary != changed_binary:
            raise RuntimeError('MCX material-only export changed nonmaterial data; GLB not replaced')
        if len(old_materials) != len(new_materials) or any(
            a['name'] != b['name'] or (a['name'] not in targets and a != b)
            for a, b in zip(old_materials, new_materials)
        ):
            raise RuntimeError('MCX material-only export changed an untouched finish; GLB not replaced')
        (out / 'mcx-virtus.glb').write_bytes(exported.read_bytes())
    print('MCX_MATERIAL_ONLY_EXPORT_OK: all nonmaterial JSON/binary and untouched finishes identical')


if __name__ == '__main__':
    update_materials()
