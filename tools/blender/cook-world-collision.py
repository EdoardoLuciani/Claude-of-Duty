#!/usr/bin/env python3
"""Cook the procedural visual staging GLB into Blender-decimated collision."""

import argparse
import sys
from collections import defaultdict
from pathlib import Path

import bpy

TARGET_BLENDER = (5, 2)


def script_args():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--visual", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--allow-version-mismatch", action="store_true")
    return parser.parse_args(values)


def triangle_count(mesh):
    return sum(max(0, len(polygon.vertices) - 2) for polygon in mesh.polygons)


def export_objects(selected, output):
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    for obj in selected:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    if not selected:
        raise RuntimeError("cannot export an empty collision set")
    bpy.context.view_layer.objects.active = selected[0]
    result = bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_extras=True,
        export_gpu_instances=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_apply=False,
        export_yup=True,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"failed to export {output}")


def main():
    args = script_args()
    if bpy.app.version[:2] != TARGET_BLENDER and not args.allow_version_mismatch:
        raise RuntimeError(
            f"world collision requires Blender {TARGET_BLENDER[0]}.{TARGET_BLENDER[1]}.x; "
            f"found {bpy.app.version_string}"
        )

    visual = Path(args.visual).resolve()
    output = Path(args.out).resolve()
    if not visual.is_file():
        raise RuntimeError(f"visual staging GLB does not exist: {visual}")

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.ops.import_scene.gltf(filepath=str(visual))
    sources = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    instance_members = defaultdict(list)
    static_sources = []
    for obj in sources:
        parent = obj.parent
        if parent and parent.type == "EMPTY" and parent.name.startswith("prop_") and parent.get("surface"):
            instance_members[parent.name].append(obj)
        elif obj.get("surface"):
            static_sources.append(obj)

    collection = bpy.data.collections.new("__COLLISION_LOD_EXPORT")
    bpy.context.scene.collection.children.link(collection)
    simplified = {}
    clones = []

    def add_clone(source, properties):
        if properties.get("surface") == "foliage":
            return None
        clone = source.copy()
        clone.parent = None
        clone.matrix_world = source.matrix_world.copy()
        clone["cod_role"] = "collision"
        clone["cod_mask"] = "world"
        clone["collision"] = True
        clone["surface"] = properties.get("surface", "concrete")
        collection.objects.link(clone)
        clones.append(clone)

        cooked = simplified.get(source.data)
        if cooked is None:
            clone.data = source.data.copy()
            if triangle_count(clone.data) > 24:
                for selected in bpy.context.selected_objects:
                    selected.select_set(False)
                clone.select_set(True)
                bpy.context.view_layer.objects.active = clone
                modifier = clone.modifiers.new("collision_lod", "DECIMATE")
                modifier.decimate_type = "COLLAPSE"
                modifier.ratio = 0.12
                modifier.use_collapse_triangulate = True
                bpy.ops.object.modifier_apply(modifier=modifier.name)
            cooked = clone.data
            simplified[source.data] = cooked
        else:
            clone.data = cooked
        return clone

    for source in static_sources:
        add_clone(source, source)

    for group, members in sorted(instance_members.items()):
        members.sort(key=lambda obj: obj.name)
        parent = members[0].parent
        index = 0
        for source in members:
            clone = add_clone(source, parent)
            if clone is None:
                continue
            clone["cod_instance_group"] = group
            clone["cod_instance_index"] = index
            index += 1

    output.parent.mkdir(parents=True, exist_ok=True)
    export_objects(clones, output)
    unique_tris = sum(triangle_count(mesh) for mesh in set(simplified.values()))
    print(
        f"[world:collision] cooked {len(clones)} objects from {len(simplified)} prototypes; "
        f"{unique_tris} unique triangles"
    )


if __name__ == "__main__":
    main()
