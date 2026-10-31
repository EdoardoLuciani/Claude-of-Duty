"""Regression: identity mesh joins must retain MPX's packed normal fan encoding.

Run with Blender on the committed editable mpx.blend, not a runtime GLB.
"""
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).parent))
from mpx.geometry import active, preserve_normal_encoding, restore_normal_encoding

collection = bpy.data.collections.new('MPX normal regression')
bpy.context.scene.collection.children.link(collection)
parts = []
for source in list(bpy.data.objects):
    if source.type != 'MESH' or not source.parent or source.parent.name != 'selector':
        continue
    clone = source.copy()
    clone.data = source.data.copy()
    collection.objects.link(clone)
    active(clone)
    for modifier in list(clone.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    parts.append(clone)
assert len(parts) == 4, 'source-named selector fixture must remain present'
active(parts[0])
for obj in parts:
    obj.select_set(True)
bpy.ops.object.join()
source = bpy.context.object
source.parent = None
source.matrix_world = Matrix.Identity(4)
mesh = source.data
reference = np.empty(len(mesh.loops) * 3, dtype=np.float32)
mesh.corner_normals.foreach_get('vector', reference)
probe = mesh.copy()
probe.normals_split_custom_set(reference.reshape(-1, 3).tolist())
actual = np.empty_like(reference)
probe.corner_normals.foreach_get('vector', actual)
changed = np.count_nonzero(np.linalg.norm((actual-reference).reshape(-1, 3), axis=1) > .001)
assert changed > 0, 'fixture must expose lossy decoded custom-normal round trip'

# Two disjoint identity-frame copies force the same join path used by rigid export preparation,
# without changing any face coordinates, sharp edges or local fan topology.
clone = source.copy()
clone.data = mesh.copy()
collection.objects.link(clone)
for obj in (source, clone):
    preserve_normal_encoding(obj.data)
active(source)
clone.select_set(True)
bpy.ops.object.join()
restore_normal_encoding(source.data)  # asserts every local corner, including zero/tiny faces
assert len(source.data.loops) * 3 == len(reference) * 2
print('MPX_NORMAL_ENCODING_REGRESSION', changed,
      'lossy round-trip corners; packed encoding retained every joined local corner')
