#!/usr/bin/env python3
"""Validate the Blender world source contract. Run inside Blender."""

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import bpy

TARGET_BLENDER = (5, 2)
SURFACES = {
    "concrete", "metal", "wood", "dirt", "sand", "glass",
    "water", "foliage", "fabric", "flesh", "rubber", "plaster",
}
REQUIRED_COLLECTIONS = {
    "WORLD", "VISUAL", "COLLISION", "MARKERS", "SPAWNS", "LIGHTS",
    "METADATA", "BUILDINGS", "VOLUMES", "BOUNDS", "STATIC_BATCHES",
    "PROPS", "ARCHITECTURE", "GROUND", "SET_PIECES",
}


def script_args(values=None):
    if values is None:
        values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata", default="assets/world/world.meta.json")
    parser.add_argument("--allow-version-mismatch", action="store_true")
    return parser.parse_args(values)


def objects(name, kind=None):
    result = list(bpy.data.collections[name].all_objects)
    return result if kind is None else [obj for obj in result if obj.type == kind]


def main(values=None):
    args = script_args(values)
    errors = []
    fail = errors.append

    if bpy.app.version[:2] != TARGET_BLENDER and not args.allow_version_mismatch:
        fail(f"expected Blender {TARGET_BLENDER[0]}.{TARGET_BLENDER[1]}.x, found {bpy.app.version_string}")

    missing = REQUIRED_COLLECTIONS - set(bpy.data.collections.keys())
    if missing:
        fail(f"missing collections: {', '.join(sorted(missing))}")
        visual = []
        collision = []
    else:
        visual = objects("VISUAL", "MESH")
        collision = objects("COLLISION", "MESH")

    ids = {}
    for obj in visual + collision + (objects("MARKERS") if not missing else []) + (objects("METADATA") if not missing else []):
        cod_id = obj.get("cod_id")
        role = obj.get("cod_role")
        if role and not cod_id:
            fail(f"{obj.name}: cod_role={role} requires cod_id")
        if cod_id:
            key = (role, cod_id)
            if key in ids:
                fail(f"duplicate {role} cod_id {cod_id}: {ids[key]} and {obj.name}")
            ids[key] = obj.name

    for obj in visual:
        if obj.get("cod_role") != "visual":
            fail(f"{obj.name}: visual mesh needs cod_role=visual")
        palette = obj.get("palette")
        if not palette:
            fail(f"{obj.name}: visual mesh has no palette")
        elif not obj.data.materials or obj.data.materials[0].name != palette:
            actual = obj.data.materials[0].name if obj.data.materials else "<none>"
            fail(f"{obj.name}: material {actual} does not match palette {palette}")

    for obj in collision:
        if obj.get("cod_role") != "collision":
            fail(f"{obj.name}: collision mesh needs cod_role=collision")
        if obj.get("surface") not in SURFACES:
            fail(f"{obj.name}: unknown collision surface {obj.get('surface')}")
        if obj.get("cod_mask") != "world":
            fail(f"{obj.name}: collision mesh needs cod_mask=world")

    groups = defaultdict(list)
    for obj in visual:
        group = obj.get("cod_instance_group")
        if group:
            groups[group].append(obj)
        color = obj.get("cod_instance_color")
        if color is not None and (len(color) != 3 or not all(math.isfinite(value) for value in color)):
            fail(f"{obj.name}: cod_instance_color must contain three finite values")

    for group, members in groups.items():
        indices = sorted(obj.get("cod_instance_index") for obj in members)
        if indices != list(range(len(members))):
            fail(f"instance group {group} has missing or duplicate cod_instance_index values")
        if len({obj.data for obj in members}) != 1:
            fail(f"instance group {group} does not share one linked mesh datablock")

    if not missing:
        spawns = objects("SPAWNS")
        lights = objects("LIGHTS", "LIGHT")
        buildings = objects("BUILDINGS")
        bounds = objects("BOUNDS")
        if not spawns:
            fail("SPAWNS collection is empty")
        if not lights:
            fail("LIGHTS collection is empty")
        if not buildings:
            fail("BUILDINGS collection is empty")
        if len(bounds) != 1 or bounds[0].get("cod_role") != "bounds":
            fail("BOUNDS must contain exactly one cod_role=bounds object")
        for obj in spawns:
            if obj.get("cod_role") != "spawn" or obj.get("cod_forward_axis") != "+Y":
                fail(f"{obj.name}: spawn needs cod_role=spawn and cod_forward_axis=+Y")
        for obj in lights:
            if obj.get("cod_role") != "light" or obj.get("cod_kind") not in {"interior", "street"}:
                fail(f"{obj.name}: light has invalid role/kind")

    metadata_path = Path(args.metadata)
    try:
        metadata = json.loads(metadata_path.read_text())
        if metadata.get("schemaVersion") != 1:
            fail(f"{metadata_path}: unsupported schemaVersion {metadata.get('schemaVersion')}")
        query = metadata.get("query", {})
        if not isinstance(query.get("street"), dict) or not isinstance(query.get("alleys"), list):
            fail(f"{metadata_path}: query street/alleys metadata is missing")
        building_ids = {obj.get("cod_id") for obj in objects("BUILDINGS")} if not missing else set()
        if set(metadata.get("buildings", {})) != building_ids:
            fail(f"{metadata_path}: building IDs do not match Blender BUILDINGS markers")
    except Exception as error:
        fail(f"cannot read {metadata_path}: {error}")

    if errors:
        for message in errors:
            print(f"[world:source] {message}", file=sys.stderr)
        raise SystemExit(f"[world:source] failed with {len(errors)} error(s)")

    print(
        f"[world:source] ok — {len(visual)} visual objects in {len(groups)} instance groups, "
        f"{len(collision)} collision meshes"
    )


if __name__ == "__main__":
    main()
