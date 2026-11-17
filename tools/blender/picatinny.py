"""Shared MIL-STD-1913 game-art interface, in metres; +Y along rail, +Z up.

Figure 1 (10 June 1999 revision) and Figure 2:
https://www.biggerhammer.net/picatinny/1913a_specs.pdf
Nominal dimensions, not a manufacturing/tolerance or manufacturer-CAD certificate.
Weapon-specific length, supports, orientation and materials stay with the weapon.
"""
import math

INCH = .0254
TOP_HALF = .748 * INCH / 2
HEAD_HALF = .835 * INCH / 2
NECK_HALF = .617 * INCH / 2
FLANK = .108 * INCH
PITCH = .394 * INCH
SLOT = .206 * INCH
SLOT_DEPTH = .118 * INCH
LAND = PITCH - SLOT
SHOULDER_DEPTH = .367 * INCH
EDGE_DEPTH = HEAD_HALF - TOP_HALF
LOWER_EDGE = FLANK - EDGE_DEPTH
NECK_DEPTH = FLANK + TOP_HALF - NECK_HALF


def section(top=0, bottom=None, slot=False):
    """Across/up outline. The basic .108 dimension locates the lower 45° flank
    at the top-flat width; it is not the overall head or rail height.
    Between lands the same lower profile remains below the recoil groove."""
    bottom = top - SHOULDER_DEPTH if bottom is None else bottom
    assert bottom <= top - NECK_DEPTH
    if slot:
        half = TOP_HALF + FLANK - SLOT_DEPTH
        return [(-NECK_HALF, bottom), (NECK_HALF, bottom),
                (NECK_HALF, top-NECK_DEPTH), (half, top-SLOT_DEPTH),
                (-half, top-SLOT_DEPTH), (-NECK_HALF, top-NECK_DEPTH)]
    return [(-NECK_HALF, bottom), (NECK_HALF, bottom),
            (NECK_HALF, top-NECK_DEPTH), (HEAD_HALF, top-LOWER_EDGE),
            (HEAD_HALF, top-EDGE_DEPTH), (TOP_HALF, top), (-TOP_HALF, top),
            (-HEAD_HALF, top-EDGE_DEPTH), (-HEAD_HALF, top-LOWER_EDGE),
            (-NECK_HALF, top-NECK_DEPTH)]


def lands(start, end, origin=0):
    """Land intervals clipped to the rail; the mount origin is a groove centre."""
    first = math.floor((start-origin)/PITCH)-1
    last = math.ceil((end-origin)/PITCH)+1
    return [(max(start, origin+(i+.5)*PITCH-LAND/2),
             min(end, origin+(i+.5)*PITCH+LAND/2))
            for i in range(first, last+1)
            if origin+(i+.5)*PITCH+LAND/2 > start and origin+(i+.5)*PITCH-LAND/2 < end]


def prism(outline, start, end):
    """Extrude an across/up section along +Y; callers apply their weapon basis."""
    n = len(outline)
    vertices = [(x,y,z) for y in (start,end) for x,z in outline]
    faces = [tuple(range(n)),tuple(reversed(range(n,2*n)))]
    faces += [(i+n,(i+1)%n+n,(i+1)%n,i) for i in range(n)]
    return vertices, faces


def build_rail(name, frame, start, end, material, parent, collection, bottom=-.0045):
    """Rigid adapter rail in its authored contact frame; finish/UV/export stay local."""
    import bpy
    from mathutils import Vector
    objects = []
    for suffix, outline, spans in [
        (' groove bed',section(bottom=bottom,slot=True),[(start,end)]),
        (' tooth',section(bottom=bottom),lands(start,end)),
    ]:
        for a,b in spans:
            vertices,faces = prism(outline,a,b)
            data = bpy.data.meshes.new(name+suffix)
            data.from_pydata([frame @ Vector(v) for v in vertices],[],faces);data.update()
            obj = bpy.data.objects.new(name+suffix,data);collection.objects.link(obj)
            obj.parent = parent;obj.matrix_parent_inverse = parent.matrix_world.inverted()
            data.materials.append(material)
            objects.append(obj)
    return objects


def cut_channel(objects, frame, start, end, clearance=.00010):
    """Cut the rail's swept head/neck out of a clamp in its contact frame.
    Keep exact top seating, with 0.1mm transverse assembly clearance on flanks.
    This is an authored Boolean before UV/bake/export, never a runtime offset.
    """
    import bpy
    from mathutils import Vector
    outline = [(x+math.copysign(clearance,x), z) for x,z in section(bottom=-.030)]
    vertices, faces = prism(outline,start,end)
    vertices = [frame @ Vector(v) for v in vertices]
    data = bpy.data.meshes.new('Picatinny channel tool')
    data.from_pydata(vertices,[],faces);data.update()
    tool = bpy.data.objects.new('CUT standard Picatinny channel',data)
    bpy.context.scene.collection.objects.link(tool)
    bpy.context.view_layer.update()
    for obj in objects:
        bpy.context.view_layer.objects.active = obj
        data.materials.clear();data.materials.append(obj.data.materials[0])
        modifier = obj.modifiers.new('Standard Picatinny channel','BOOLEAN')
        modifier.operation = 'DIFFERENCE';modifier.object = tool
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.data.objects.remove(tool,do_unlink=True)
    bpy.data.meshes.remove(data)
