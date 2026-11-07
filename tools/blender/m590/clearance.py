"""Measured exception for one approved shared-glove tessellation contact.

All other right-skin crossings remain errors. Hash/topology/region checks identify
this contact; they do not waive the independently checked 30 micrometre depth cap.
"""
import hashlib
import struct
from mathutils import Vector

ARMS_SHA256 = '0fde215d10b6b7725f1117881b79c8888a2630d601a0a0e3eb34629ba74ef7ad'
GLOVE_TOPOLOGY_SHA256 = '90eef66426a22d171eb78e2668c15c7a4b7809ecf73b4f7b9eb2f483bbc05bcc'
CONTACT_TRIANGLES = {774: (1816, 1813, 1873), 7834: (1813, 1872, 1873)}
CONTACT_MIN = Vector((-.0021, -.0347, .0861))
CONTACT_MAX = Vector((.0021, -.0337, .0885))
DEPTH_CEILING = .000030


def certify_depth(points, surface, ceiling=.000029):
    """Bound the ENTIRE triangle, not just samples, using signed-distance Lipschitz.

    On the closed, outward-oriented stock, signed Euclidean distance is
    1-Lipschitz. A cell's maximum penetration is at most its maximum vertex
    penetration plus longest edge. Bisect until every cell has a sub-cap bound.
    The extra 0.1um allowance covers float32 BVH/vector arithmetic. No contact is
    accepted on an inconclusive subdivision or an already over-cap sample.
    """
    def depth(point):
        closest, normal, _, distance = surface.find_nearest(point)
        return distance if (point - closest).dot(normal) < 0 else -distance

    pending = [(points, [depth(point) for point in points])]
    maximum = upper = 0
    cells = 0
    while pending:
        points, depths = pending.pop()
        cells += 1
        assert cells < 200000, 'inconclusive glove/stock depth certificate'
        maximum = max(maximum, *depths)
        assert max(depths) <= ceiling, ('glove/stock penetration', maximum)
        edges = [(points[i] - points[(i + 1) % 3]).length for i in range(3)]
        bound = max(depths) + max(edges) + .0000001
        if bound <= ceiling:
            upper = max(upper, bound)
            continue
        a = edges.index(max(edges)); b = (a + 1) % 3; c = (a + 2) % 3
        midpoint = (points[a] + points[b]) / 2
        value = depth(midpoint)
        pending.append(([points[a], midpoint, points[c]], [depths[a], value, depths[c]]))
        pending.append(([midpoint, points[b], points[c]], [value, depths[b], depths[c]]))
    return maximum, upper


class RightGloveStockException:
    def __init__(self, arms_path):
        self.arms_path = arms_path
        self.cache = {}
        self.poses = 0
        self.maximum_sample = 0
        self.maximum_bound = 0
        self.checked_topology = False

    def check(self, mesh_name, vertices, triangles, overlaps, owners, surface):
        assert mesh_name == 'M590_right_Charcoal_woven_glove_skin', ('new right-skin contact', mesh_name)
        if not self.checked_topology:
            assert hashlib.sha256(self.arms_path.read_bytes()).hexdigest() == ARMS_SHA256, 'unreviewed shared-arm input'
            assert len(vertices) == 12562 and len(triangles) == 25120, 'unreviewed glove topology'
            topology = b''.join(struct.pack('<3I', *triangle) for triangle in triangles)
            assert hashlib.sha256(topology).hexdigest() == GLOVE_TOPOLOGY_SHA256, 'unreviewed glove topology'
            self.checked_topology = True
        for glove_face, fixed_face in overlaps:
            assert owners[fixed_face] in {('Conventional synthetic stock', 1154),
                                          ('Conventional synthetic stock', 1157)}, 'new stock/receiver/guard contact'
            assert glove_face in CONTACT_TRIANGLES and tuple(triangles[glove_face]) == CONTACT_TRIANGLES[glove_face], 'new glove contact triangle'
        for face in sorted({a for a, _ in overlaps}):
            points = [vertices[index] for index in triangles[face]]
            assert all(CONTACT_MIN[k] <= point[k] <= CONTACT_MAX[k]
                       for point in points for k in range(3)), 'glove contact outside approved neck region'
            cached = self.cache.get(face)
            if cached:
                old, sample, bound = cached
                # A rigid triangle's barycentric points move no further than
                # its most displaced vertex. This also bounds distance change.
                displacement = max((a - b).length for a, b in zip(points, old))
            else:
                displacement = DEPTH_CEILING
            if not cached or bound + displacement > DEPTH_CEILING:
                sample, bound = certify_depth(points, surface)
                self.cache[face] = ([p.copy() for p in points], sample, bound)
                displacement = 0
            assert bound + displacement <= DEPTH_CEILING, 'glove/stock depth exceeds 30um'
            self.maximum_sample = max(self.maximum_sample, sample)
            self.maximum_bound = max(self.maximum_bound, bound + displacement)
        self.poses += 1
