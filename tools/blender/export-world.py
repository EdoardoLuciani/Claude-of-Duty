#!/usr/bin/env python3
"""Export Blender world staging assets."""

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

TARGET_BLENDER = (5, 2)


def script_args():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    parser.add_argument("--metadata", default="assets/world/world.meta.json")
    parser.add_argument("--allow-version-mismatch", action="store_true")
    return parser.parse_args(values)


def to_three(vector):
    return [float(vector.x), float(vector.z), float(-vector.y)]


def three_matrix(values):
    return Matrix(
        (
            (values[0], values[4], values[8], values[12]),
            (values[1], values[5], values[9], values[13]),
            (values[2], values[6], values[10], values[14]),
            (values[3], values[7], values[11], values[15]),
        )
    )


def export_collection(name, output):
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    selected = [obj for obj in bpy.data.collections[name].all_objects if obj.type == "MESH"]
    states = []
    for obj in selected:
        states.append((obj, obj.hide_get(), obj.hide_viewport, obj.hide_render))
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    if not selected:
        raise RuntimeError(f"collection {name} has no mesh objects")
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
    for obj, hidden, viewport, render in states:
        obj.hide_set(hidden)
        obj.hide_viewport = viewport
        obj.hide_render = render
    if "FINISHED" not in result:
        raise RuntimeError(f"failed to export collection {name}")


def marker_metadata(source):
    transform = source["levelTransform"]
    inverse = three_matrix(transform).inverted()

    spawns = []
    for obj in sorted(bpy.data.collections["SPAWNS"].all_objects, key=lambda item: item.get("cod_order", 1_000_000)):
        position = to_three(obj.matrix_world.translation)
        blender_forward = obj.matrix_world.to_3x3() @ Vector((0.0, 1.0, 0.0))
        forward = Vector(to_three(blender_forward)).normalized()
        yaw = math.atan2(-forward.x, -forward.z)
        spawns.append(
            {
                "id": obj.get("cod_id", obj.name),
                "position": position,
                "forward": [float(forward.x), float(forward.y), float(forward.z)],
                "yaw": yaw,
                "tag": obj.get("cod_tag", obj.get("cod_id", obj.name)),
                "team": obj.get("cod_team", "any"),
            }
        )

    lights = []
    for obj in sorted(
        bpy.data.collections["LIGHTS"].all_objects,
        key=lambda item: (item.get("cod_kind", ""), item.get("cod_order", 1_000_000)),
    ):
        position = to_three(obj.matrix_world.translation)
        lights.append(
            {
                "id": obj.get("cod_id", obj.name),
                "kind": obj.get("cod_kind", "interior"),
                "position": position,
                "color": [float(value) for value in obj.data.color],
                "range": float(obj.get("cod_range", 13.0)),
                "priority": int(obj.get("cod_priority", 2)),
                "day": float(obj.get("cod_day", 5.0)),
                "night": float(obj.get("cod_night", 22.0)),
            }
        )

    bound = next(
        (obj for obj in bpy.data.collections["BOUNDS"].all_objects if obj.get("cod_role") == "bounds"),
        None,
    )
    if bound is None:
        raise RuntimeError("BOUNDS contains no cod_role=bounds marker")
    points = []
    for x in (-1.0, 1.0):
        for y in (-1.0, 1.0):
            for z in (-1.0, 1.0):
                points.append(to_three(bound.matrix_world @ Vector((x, y, z))))
    bounds = {
        "min": [min(point[axis] for point in points) for axis in range(3)],
        "max": [max(point[axis] for point in points) for axis in range(3)],
    }

    volumes = []
    for obj in bpy.data.collections["VOLUMES"].all_objects:
        if obj.get("cod_role") != "volume":
            continue
        points = [
            to_three(obj.matrix_world @ Vector((x, y, z)))
            for x in (-1.0, 1.0) for y in (-1.0, 1.0) for z in (-1.0, 1.0)
        ]
        volumes.append({
            "id": obj.get("cod_id", obj.name),
            "kind": obj.get("cod_kind", "generic"),
            "bounds": {
                "min": [min(point[axis] for point in points) for axis in range(3)],
                "max": [max(point[axis] for point in points) for axis in range(3)],
            },
        })

    building_markers = {
        obj.get("cod_id"): obj
        for obj in bpy.data.collections["BUILDINGS"].all_objects
        if obj.get("cod_role") == "building"
    }
    building_records = []
    for cod_id, original in source["buildings"].items():
        marker = building_markers.get(cod_id)
        if marker is None:
            raise RuntimeError(f"missing Blender building marker {cod_id}")
        record = json.loads(json.dumps(original))
        center_world = Vector((*to_three(marker.matrix_world.translation), 1.0))
        center_level = inverse @ center_world
        record["spec"]["x"] = float(center_level.x)
        record["spec"]["z"] = float(center_level.z)
        record["spec"]["w"] = abs(float(marker.scale.x)) * 2.0
        record["spec"]["d"] = abs(float(marker.scale.y)) * 2.0
        top = abs(float(marker.scale.z)) * 2.0
        record["top"] = top
        record["roofY"] = top
        building_records.append(record)

    return {
        "version": 2,
        "coordinateSystem": "three-y-up-metres",
        "transform": transform,
        "bounds": bounds,
        "spawns": spawns,
        "buildings": building_records,
        "volumes": volumes,
        "lights": lights,
        "query": source["query"],
    }


def main():
    args = script_args()
    if bpy.app.version[:2] != TARGET_BLENDER and not args.allow_version_mismatch:
        raise RuntimeError(
            f"world export requires Blender {TARGET_BLENDER[0]}.{TARGET_BLENDER[1]}.x; "
            f"found {bpy.app.version_string}"
        )

    validator_path = Path(__file__).with_name("validate-world-source.py")
    spec = importlib.util.spec_from_file_location("validate_world_source", validator_path)
    validator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(validator)
    validator_args = ["--metadata", args.metadata]
    if args.allow_version_mismatch:
        validator_args.append("--allow-version-mismatch")
    validator.main(validator_args)

    output = Path(args.out).resolve()
    output.mkdir(parents=True, exist_ok=True)
    source = json.loads(Path(args.metadata).read_text())
    if source.get("schemaVersion") != 1:
        raise RuntimeError(f"unsupported source metadata schema {source.get('schemaVersion')}")

    export_collection("VISUAL", output / "visual-expanded.glb")
    export_collection("COLLISION", output / "collision-expanded.glb")
    (output / "metadata.json").write_text(json.dumps(marker_metadata(source), indent=2) + "\n")
    print(f"[world:blender] staged Blender exports under {output}")


if __name__ == "__main__":
    main()
