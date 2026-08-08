#!/usr/bin/env python3
"""Add authoring collections and per-building editable region groups.

The imported static batches contain hundreds of thousands of disconnected pieces;
separating by loose parts would create ~335k objects. Instead this script classifies
faces spatially and creates Blender vertex groups (`REGION_<id>`) that can be
selected in Edit Mode without changing geometry or runtime batching.
"""

import json
from pathlib import Path

import bpy
from mathutils import Vector

GROUND_PALETTES = {"road_dust", "road_rut", "asphalt", "sand", "dirt", "gravel"}


def child_collection(parent, name):
    existing = bpy.data.collections.get(name)
    if existing:
        return existing
    value = bpy.data.collections.new(name)
    parent.children.link(value)
    return value


def link_only_under(obj, collection, direct_parent):
    if obj.name not in collection.objects:
        collection.objects.link(obj)
    if obj.name in direct_parent.objects:
        direct_parent.objects.unlink(obj)


def main():
    visual = bpy.data.collections["VISUAL"]
    static_collection = child_collection(visual, "STATIC_BATCHES")
    props_collection = child_collection(visual, "PROPS")
    architecture = child_collection(visual, "ARCHITECTURE")
    ground_collection = child_collection(visual, "GROUND")
    set_pieces = child_collection(visual, "SET_PIECES")

    buildings = sorted(
        (obj for obj in bpy.data.collections["BUILDINGS"].all_objects if obj.get("cod_role") == "building"),
        key=lambda obj: obj.get("cod_id"),
    )
    building_collections = {}
    for building in buildings:
        name = f"BLDG_{building.get('cod_id')}"
        value = child_collection(architecture, name)
        building_collections[building.get("cod_id")] = value
        if building.name not in value.objects:
            value.objects.link(building)

    static_meshes = [
        obj for obj in visual.all_objects
        if obj.type == "MESH" and not obj.get("cod_instance_group")
    ]
    instance_objects = [obj for obj in visual.all_objects if obj.get("cod_instance_group")]
    for obj in static_meshes:
        link_only_under(obj, static_collection, visual)
        category = ground_collection if obj.get("palette") in GROUND_PALETTES else set_pieces
        if obj.name not in category.objects:
            category.objects.link(obj)
    for obj in instance_objects:
        link_only_under(obj, props_collection, visual)

    table = {0: "set_pieces", 1: "ground"}
    table.update({index + 2: building.get("cod_id") for index, building in enumerate(buildings)})
    inverse = [(building, building.matrix_world.inverted()) for building in buildings]
    counts = {name: 0 for name in table.values()}

    for obj in static_meshes:
        mesh = obj.data
        old = mesh.attributes.get("cod_region")
        if old:
            mesh.attributes.remove(old)
        attribute = mesh.attributes.new("cod_region", "INT", "FACE")
        palette = obj.get("palette")
        region_vertices = {index: set() for index in table}
        for polygon in mesh.polygons:
            if palette in GROUND_PALETTES:
                region = 1
            else:
                local_center = sum((mesh.vertices[index].co for index in polygon.vertices), Vector()) / len(polygon.vertices)
                world_center = obj.matrix_world @ local_center
                region = 0
                for offset, (building, matrix) in enumerate(inverse, start=2):
                    point = matrix @ world_center
                    if abs(point.x) <= 1.02 and abs(point.y) <= 1.02 and abs(point.z) <= 1.08:
                        region = offset
                        break
            attribute.data[polygon.index].value = region
            region_vertices[region].update(polygon.vertices)
            counts[table[region]] += 1

        for group in list(obj.vertex_groups):
            if group.name.startswith("REGION_"):
                obj.vertex_groups.remove(group)
        for region, vertices in region_vertices.items():
            if not vertices:
                continue
            group = obj.vertex_groups.new(name=f"REGION_{table[region]}")
            group.add(list(vertices), 1.0, "REPLACE")
        obj["cod_region_table"] = json.dumps(table, sort_keys=True)

    bpy.context.scene["cod_region_table"] = json.dumps(table, sort_keys=True)
    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, compress=True)
    print(
        f"[world:organize] classified {sum(counts.values())} static faces across "
        f"{len(buildings)} buildings; geometry unchanged"
    )


if __name__ == "__main__":
    main()
