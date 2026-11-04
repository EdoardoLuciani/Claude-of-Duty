"""Strict pilot payload checks (stdlib Python, no Blender or baseline meshes).

python tools/blender/soldiers/check.py ABS_REFERENCE ABS_PAYLOAD [SAME_SEED SECOND_SEED]
"""
import hashlib
import json
import math
from pathlib import Path
import sys


def check(reference, path):
    payload = json.loads(path.read_text())
    mesh = payload['mesh']
    count = payload['stats']['vertices']
    assert payload['version'] == 1 and payload['name'] == 'vanguard'
    assert payload['slots'] == reference['slots']
    assert payload['variant'] == reference['variants']['vanguard']
    assert len(reference['rig']['names']) == 25
    for attr, size in [('position', 3), ('normal', 3), ('uv', 2), ('color', 3),
                       ('skinIndex', 4), ('skinWeight', 4)]:
        assert len(mesh[attr]) == count*size, attr
        assert all(isinstance(v, (float, int)) and math.isfinite(v) for v in mesh[attr]), attr
    assert len(mesh['index']) == payload['stats']['triangles']*3
    assert 0 < payload['stats']['triangles'] <= 25700
    assert set(mesh['index']) == set(range(count)), 'unreferenced or invalid vertices'
    assert all(isinstance(i, int) and 0 <= i < count for i in mesh['index'])
    cursor = 0
    assert len(mesh['groups']) == len(reference['slots']) == 9
    surfaces = []
    for i, group in enumerate(mesh['groups']):
        assert group['materialIndex'] == i and group['start'] == cursor
        assert group['count'] > 0 and group['count'] % 3 == 0
        end = cursor+group['count']
        vertices = set(mesh['index'][cursor:end])
        assert all(not vertices.intersection(previous) for previous in surfaces), 'shared surface vertices'
        surfaces.append(vertices)
        cursor = end
    assert cursor == len(mesh['index'])
    for i in range(count):
        n = mesh['normal'][i*3:i*3+3]
        assert abs(sum(v*v for v in n)-1) < 2e-5, 'nonunit normal'
        color = mesh['color'][i*3:i*3+3]
        assert all(0 <= c <= 1 for c in color)
        joints = mesh['skinIndex'][i*4:i*4+4]
        weights = mesh['skinWeight'][i*4:i*4+4]
        assert all(isinstance(j, int) and 0 <= j < 25 for j in joints)
        assert all(0 <= w <= 1 for w in weights)
        assert abs(sum(weights)-1) < 2e-6
        assert len(set(j for j, w in zip(joints, weights) if w > 0)) == sum(w > 0 for w in weights)
    # Weapon surfaces are real geometry and rigid HandR, not armature-order indices.
    hand = reference['rig']['names'].index('HandR')
    for slot in ('steel', 'glass', 'polymer'):
        rigid_hand = 0
        for vertex in surfaces[reference['slots'].index(slot)]:
            js = mesh['skinIndex'][vertex*4:vertex*4+4]
            ws = mesh['skinWeight'][vertex*4:vertex*4+4]
            rigid_hand += js[0] == hand and ws[0] == 1
        assert rigid_hand > 0, slot
    assert set(payload['weapon']) == {'muzzle', 'foregrip', 'magBottom', 'ejection', 'stockTop'}
    for name, p in payload['weapon'].items():
        assert len(p) == 3 and all(math.isfinite(v) for v in p), name
    grip = reference['rig']['gripL']
    assert math.dist(payload['weapon']['foregrip'], grip) < 2e-6
    muzzle, stock = payload['weapon']['muzzle'], payload['weapon']['stockTop']
    bore = reference['rig']['boreDir']
    delta = [muzzle[i]-stock[i] for i in range(3)]
    assert abs(sum(delta[i]*bore[i] for i in range(3))-.665) < 2e-6
    assert math.dist(delta, [v*.665 for v in bore]) < 2e-6
    # Actor bind-space bounds/contact sanity, not a baseline golden oracle.
    axes = [mesh['position'][i::3] for i in range(3)]
    bounds = [[min(axis), max(axis)] for axis in axes]
    assert abs(bounds[1][0]) < .005 and 1.79 < bounds[1][1] < 1.86, bounds
    result = {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
              **payload['stats'], 'groups': [g['count'] for g in mesh['groups']], 'bounds': bounds}
    print(json.dumps(result))
    return payload


def main():
    paths = list(map(Path, sys.argv[1:]))
    reference = json.loads(paths[0].read_text())
    first = check(reference, paths[1])
    if len(paths) > 2:
        check(reference, paths[2])
        assert paths[1].read_bytes() == paths[2].read_bytes(), 'same-seed nondeterminism'
    if len(paths) > 3:
        second = check(reference, paths[3])
        assert first['mesh'] != second['mesh'], 'second seed did not change geometry/tints'
        assert first['weapon'] == second['weapon'], 'seed changed weapon calibration'
    print('PASS: finite attributes, topology, disjoint slots, weights, rig indices, weapon, determinism')


if __name__ == '__main__':
    main()
