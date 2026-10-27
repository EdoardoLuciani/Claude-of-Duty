"""P320 color-only UVs: local lettering panels, coarse unmarked finishes.

Normal/ORM/emission retain their original UVs. Coplanar cuts only establish
panel boundaries; no lettering geometry, material section or draw is added.
"""
import math
import bmesh
import bpy
from mathutils import Vector
from .surfaces import active

COLOR_UV = 'BaseColorUV'
MARKED_AREA_SHARE = .80


def layout_color(surfaces):
    marked_area = 0
    plain_area = 0
    panels = 0
    for surface, sources in surfaces:
        mesh = surface.data
        bm = bmesh.new()
        bm.from_mesh(mesh)
        marks = bm.faces.layers.int.new('color_panel')
        patches = {}
        for source in sources:
            if not source.name.startswith('Mark |'):
                continue
            # Work in the glyph's own planar coordinates. Curved molded logos
            # can vary in depth, but their front-facing projected panel is unique.
            to_glyph = source.matrix_world.inverted() @ surface.matrix_world
            from_glyph = to_glyph.inverted()
            points = [vertex.co for vertex in source.data.vertices]
            lower = Vector(tuple(min(p[i] for p in points) for i in range(3)))
            upper = Vector(tuple(max(p[i] for p in points) for i in range(3)))
            padding = max(.0003, (upper.y - lower.y) * .15)
            lower -= Vector((padding, padding, .002))
            upper += Vector((padding, padding, .002))
            outward = to_glyph.to_3x3().transposed() @ Vector((0, 0, 1))
            def nearby(face):
                if face.normal.dot(outward.normalized()) < .35:
                    return False
                coords = [to_glyph @ v.co for v in face.verts]
                return all(max(p[i] for p in coords) >= lower[i] and
                           min(p[i] for p in coords) <= upper[i] for i in range(3))
            # Restrict each cut to the local, outward-facing host region. UV0
            # is interpolated by BMesh; all silhouette positions stay on faces.
            for axis in (0, 1):
                for value in (lower[axis], upper[axis]):
                    faces = [face for face in bm.faces if nearby(face)]
                    bm.edges.index_update()
                    bm.verts.index_update()
                    edges = sorted({edge for face in faces for edge in face.edges}, key=lambda edge: edge.index)
                    verts = sorted({vertex for face in faces for vertex in face.verts}, key=lambda vertex: vertex.index)
                    origin = Vector((0, 0, 0))
                    origin[axis] = value
                    normal = Vector((0, 0, 0))
                    normal[axis] = 1
                    bmesh.ops.bisect_plane(bm, geom=[*faces, *edges, *verts],
                        plane_co=from_glyph @ origin,
                        plane_no=to_glyph.to_3x3().transposed() @ normal,
                        dist=1e-8)
            panel = len(patches) + 1
            selected = []
            for face in bm.faces:
                if not nearby(face):
                    continue
                center = to_glyph @ face.calc_center_median()
                if all(lower[i] - 1e-7 <= center[i] <= upper[i] + 1e-7 for i in (0, 1)):
                    face[marks] = panel
                    selected.append(face)
            assert selected, 'Missing color panel: ' + source.name
            patches[panel] = (to_glyph, lower)
            panels += 1
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        uv0 = bm.loops.layers.uv.active
        color = bm.loops.layers.uv.new(COLOR_UV)
        for face in bm.faces:
            panel = face[marks]
            for loop in face.loops:
                if panel:
                    transform, lower = patches[panel]
                    p = transform @ loop.vert.co - lower
                    loop[color].uv = p.xy
                else:
                    loop[color].uv = loop[uv0].uv.copy()
            a, b, c = [loop[color].uv for loop in face.loops]
            u, v = b - a, c - a
            area = abs(u.x * v.y - u.y * v.x) / 2
            if panel:
                marked_area += area
            else:
                plain_area += area
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
    marked_scale = math.sqrt(MARKED_AREA_SHARE / marked_area)
    plain_scale = math.sqrt((1 - MARKED_AREA_SHARE) / plain_area)
    for surface, _ in surfaces:
        mesh = surface.data
        bm = bmesh.new()
        bm.from_mesh(mesh)
        marks = bm.faces.layers.int['color_panel']
        color = bm.loops.layers.uv[COLOR_UV]
        for face in bm.faces:
            panel = face[marks]
            scale = marked_scale if panel else plain_scale
            for loop in face.loops:
                # Separate panels and the ordinary UV islands before packing,
                # even when their planar coordinates happen to coincide.
                loop[color].uv = loop[color].uv * scale + Vector((panel * 10, 10))
        bm.to_mesh(mesh)
        bm.free()
        mesh.uv_layers.active_index = mesh.uv_layers.find(COLOR_UV)
    active(surfaces[0][0])
    for surface, _ in surfaces:
        surface.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin=.006)
    bpy.ops.object.mode_set(mode='OBJECT')
    for surface, _ in surfaces:
        surface.data.uv_layers.active_index = 0
        surface.data.uv_layers[0].active_render = True
    bpy.context.scene['p320_color_panels'] = panels
    bpy.context.scene['p320_color_marked_share'] = MARKED_AREA_SHARE
