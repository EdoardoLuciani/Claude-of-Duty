"""P320-only low surfaces; high geometry remains an editable bake source."""
import math
import bpy

# These shallow traction ribs are projected into the normal atlas, not rendered.
BAKE_ONLY = ('Mark |', 'Magazine release | ribs', 'Takedown lever | traction',
             'Slide catch | serration')


def active(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def build_surfaces(asset, sources):
    groups = {}
    for source in sources:
        groups.setdefault(source.parent, []).append(source)
    surfaces = []
    for parent, high in groups.items():
        low = []
        for source in high:
            if source.name.startswith(BAKE_ONLY):
                continue
            obj = source.copy()
            obj.data = source.data.copy()
            obj.name = source.name + ' | low'
            asset.objects.link(obj)
            active(obj)
            # Remove coplanar tessellation first; retain actual openings and the
            # continuous molded silhouette, then reduce curved bevel segments.
            dissolve = obj.modifiers.new('Coplanar cleanup', 'DECIMATE')
            dissolve.decimate_type = 'DISSOLVE'
            dissolve.angle_limit = math.radians(0.5)
            dissolve.delimit = {'NORMAL', 'MATERIAL'}
            bpy.ops.object.modifier_apply(modifier=dissolve.name)
            reduce = obj.modifiers.new('Baked bevel reduction', 'DECIMATE')
            reduce.ratio = 0.45
            bpy.ops.object.modifier_apply(modifier=reduce.name)
            low.append(obj)
        active(low[0])
        for obj in low:
            obj.select_set(True)
        if len(low) > 1:
            bpy.ops.object.join()
        surface = bpy.context.object
        surface.name = parent.name + '_surface'
        # Stable triangles before UVs/baking, not a different export tessellation.
        triangulate = surface.modifiers.new('Bake topology', 'TRIANGULATE')
        bpy.ops.object.modifier_apply(modifier=triangulate.name)
        surfaces.append((surface, high))
    active(surfaces[0][0])
    for surface, _ in surfaces:
        surface.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(75), island_margin=.012)
    bpy.ops.object.mode_set(mode='OBJECT')
    emphasize_marks(surfaces)
    return surfaces


def emphasize_marks(surfaces):
    """Give existing UV islands carrying lettering/ribs extra texel density."""
    from mathutils.bvhtree import BVHTree
    for surface, sources in surfaces:
        mesh = surface.data
        uv = mesh.uv_layers.active.data
        roots = list(range(len(mesh.polygons)))
        def root(index):
            while roots[index] != index:
                roots[index] = roots[roots[index]]
                index = roots[index]
            return index
        edges = {}
        for face in mesh.polygons:
            loops = list(face.loop_indices)
            for i, loop in enumerate(loops):
                following = loops[(i + 1) % len(loops)]
                ends = sorted((mesh.loops[j].vertex_index,
                    round(uv[j].uv.x, 6), round(uv[j].uv.y, 6)) for j in (loop, following))
                key = tuple(ends)
                if key in edges:
                    roots[root(face.index)] = root(edges[key])
                else:
                    edges[key] = face.index
        tree = BVHTree.FromPolygons([surface.matrix_world @ v.co for v in mesh.vertices],
                                   [tuple(p.vertices) for p in mesh.polygons], all_triangles=True)
        priority = {}
        for source in sources:
            if not source.name.startswith(BAKE_ONLY):
                continue
            factor = 4
            for vertex in source.data.vertices:
                _, _, face, distance = tree.find_nearest(source.matrix_world @ vertex.co)
                if face is not None and distance < .004:
                    island = root(face)
                    priority[island] = max(priority.get(island, 1), factor)
        for face in mesh.polygons:
            factor = priority.get(root(face.index), 1)
            for loop in face.loop_indices:
                uv[loop].uv *= factor
    active(surfaces[0][0])
    for surface, _ in surfaces:
        surface.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin=.006)
    bpy.ops.object.mode_set(mode='OBJECT')


def stash_sources(sources):
    collection = bpy.data.collections.new('P320 | high bake source (not exported)')
    bpy.context.scene.collection.children.link(collection)
    for obj in sources:
        for owner in list(obj.users_collection):
            owner.objects.unlink(obj)
        collection.objects.link(obj)
        obj.hide_set(True)
    # Keep source controls evaluated for action editing and source/skin checks.
    collection.hide_render = True
