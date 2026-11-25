"""Photo-referenced, static TROY Di-Optic rear and HK front game art.

The sculpture uses the game's rail contact frame (+Y forward, +Z up) and
photo-inferred proportions. Details are exterior only, not working mechanisms.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import picatinny

SIGHT_HEIGHT = .0358


def build_troy_pair(collection, parent, rear, front, yaw, body, steel, mark):
    rotation = Matrix.Rotation(yaw, 4, 'Z')

    def empty(name, location, owner):
        obj = bpy.data.objects.new(name, None)
        collection.objects.link(obj)
        obj.parent = owner
        obj.location = location
        obj.empty_display_size = .005
        return obj

    group = empty('IRON_troy', (0, 0, 0), parent)
    for kind, seat, datum in [('Rear', rear, 'SOCKET_troy'), ('Front', front, 'SOCKET_troy_front_post')]:
        frame = Matrix.Translation(seat) @ rotation
        _troy_sight(collection, group, frame, kind, body, steel, mark)
        empty(datum, frame @ Vector((0, 0, SIGHT_HEIGHT)), group)
    return group


def set_sight_preview(group, visible):
    # Hiding a Blender Empty does not hide its mesh children.
    for obj in group.children:
        if obj.type == 'MESH':
            obj.hide_set(not visible)
            obj.hide_render = not visible


def _troy_sight(collection, parent, frame, kind, body, steel, mark):
    def mesh(label, vertices, faces, material, bevel=.00018, smooth=False):
        name = 'TROY ' + kind + ' | ' + label
        data = bpy.data.meshes.new(name)
        data.from_pydata([frame @ Vector(v) for v in vertices], [], faces)
        bm = bmesh.new()
        bm.from_mesh(data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(data)
        bm.free()
        data.update()
        obj = bpy.data.objects.new(name, data)
        collection.objects.link(obj)
        obj.parent = parent
        data.materials.append(material)
        if smooth:
            for poly in data.polygons:
                poly.use_smooth = len(poly.vertices) == 4
        if bevel:
            mod = obj.modifiers.new('Edge highlights', 'BEVEL')
            mod.width, mod.segments, mod.harden_normals = bevel, 2, True
            normals = obj.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
            normals.keep_sharp = True
        return obj

    def loft(label, rings, material=body, **kwargs):
        n = len(rings[0])
        faces = [tuple(reversed(range(n))), tuple(range(n*(len(rings)-1), n*len(rings)))]
        faces += [(j*n+i, j*n+(i+1)%n, (j+1)*n+(i+1)%n, (j+1)*n+i)
                  for j in range(len(rings)-1) for i in range(n)]
        return mesh(label, [v for ring in rings for v in ring], faces, material, **kwargs)

    def side(label, outline, left, right, material=body, **kwargs):
        return loft(label, [[(x,y,z) for y,z in outline] for x in (left,right)], material, **kwargs)

    def face(label, outline, back, front, material=body, **kwargs):
        return loft(label, [[(x,y,z) for x,z in outline] for y in (back,front)], material, **kwargs)

    def cap(label, center, sections, material=steel, axis='X', sides=24, face_height=1, face_width=1):
        x,y,z = center
        angles = [i*math.tau/sides for i in range(sides)]
        rings = []
        for along, r in sections:
            sincos = [(math.sin(a)*r, math.cos(a)*r) for a in angles]
            rings.append([(x+along,y+a,z+b*face_height) if axis == 'X' else (x+a,y+along,z+b) if axis == 'Y' else (x+a*face_width,y+b,z+along) for a,b in sincos])
        return loft(label, rings, material, bevel=0, smooth=True)

    # Broad, skewed saddle, narrow detachable-looking cheek and recessed-looking
    # circular end faces. Only the game's swept contact profile is subtracted.
    # Both C01 matches are aiming-face proportions; retain the existing
    # fore-aft stations, game rail cut and sight axis.
    rear = kind == 'Rear'
    saddle_left = -.01525 if rear else -.01575
    saddle_rise = .0015 if rear else .0028
    outline = [(-.012,-.0049),(-.012,.0026+saddle_rise),(-.008,.0084+saddle_rise),
               (-.003,.0112+saddle_rise),(.0076,.0112+saddle_rise),(.011,.0077+saddle_rise),(.011,-.0049)]
    saddle = side('saddle', outline, saddle_left,.0101, bevel=.0005)
    cheek = (side('split cheek', outline, .0103,.0132, bevel=.00045) if rear else
             loft('split cheek', [[(.0103,y,z) for y,z in outline],
                  [(.01355-.0022*max(0, (z-.007)/.007),y,z) for y,z in outline]],
                  bevel=.00045))
    bpy.ops.object.select_all(action='DESELECT')
    for obj in (saddle, cheek): obj.select_set(True)
    bpy.context.view_layer.objects.active = saddle
    bpy.ops.object.convert(target='MESH')
    picatinny.cut_channel([saddle, cheek], frame, -.016,.016)
    side('groove key', [(-.0021,-.0025),(.0021,-.0025),(.0021,.0002),(-.0021,.0002)],
         -.007,.007, steel, bevel=.00008)
    # Pivot/fastener heads follow the outer face only across the sight, not along it.
    left_shift = saddle_left + .0129
    for sign in (-1,1):
        shift = (left_shift if rear else -.0018) if sign < 0 else 0
        cap('pivot cap', (sign*.0122+shift,.0067,.0084), [(0,.00425),(sign*.0013,.00425),(sign*.0018,.0037)])
        cap('dark pivot recess', (sign*.01401+shift,.0067,.0084), [(0,.00165),(sign*.00005,.00163)], body)
    screw_shift = left_shift if rear else -.00195
    cap('slotted screw head', (-.013+screw_shift,-.0045,.0027), [(0,.003),(-.00085,.0028)])
    side('screw slot shadow', [(-.0067,.0039),(-.0069,.0034),(-.0025,.0014),(-.0023,.0019)],
         -.01389+screw_shift,-.01387+screw_shift, body, bevel=0)
    cap('button', (.01265 if rear else .013,.007,.0084 if rear else .010),
        [(0,.0025),(.0024,.0025),(.0029,.00215)])

    def inscription(label, glyphs, size, at, right, direction):
        right, direction = Vector(right), Vector(direction).normalized()
        normal = right.cross(direction)
        font = bpy.data.curves.new('TROY ' + label, 'FONT')
        font.body, font.align_x, font.size = glyphs, 'CENTER', size
        font.resolution_u, font.space_line = 4, .86
        text = bpy.data.objects.new('TROY ' + kind + ' | ' + label, font)
        collection.objects.link(text)
        text.parent = parent
        basis = Matrix((right,direction,normal)).transposed().to_4x4()
        text.matrix_basis = frame @ Matrix.Translation(Vector(at)+normal*.000038) @ basis
        font.materials.append(mark)
        bpy.ops.object.select_all(action='DESELECT')
        text.select_set(True)
        bpy.context.view_layer.objects.active = text
        bpy.ops.object.convert(target='MESH')

    # Original glyphs on the rear slope of the saddle; no sampled photo texture.
    inscription('inscription', 'FOLDING BATTLE SIGHT\nCAGE CODE 3EZ11\nTROY INDUSTRIES, INC.',
                .00152, (-.001+left_shift/2,-.0087,.00738+saddle_rise), (1,0,0), (0,.004,.0058))

    h = SIGHT_HEIGHT
    if rear:
        # Longer parallel ear faces, with a radiused shoulder into a short stem.
        crown = h+.0045
        half_yoke = [(.0058,.008),(.0058,.0130),(.0060,.0153),(.0067,.0175),
                     (.0077,.0194),(.0090,.0210),(.0104,.0221),(.0115,.0228),
                     (.01165,.0231),(.01165,crown-.0003),(.0114,crown),
                     (.0080,crown),(.0077,crown-.0003),(.0077,.02585)]
        yoke = half_yoke + [(-x,z) for x,z in reversed(half_yoke)]
        loft('flared yoke and square ears', [[(x*scale,y,z) for x,z in yoke]
            for y,scale in [(-.0032,.96),(-.0018,1),(.0066,1),(.0083,.94)]],
            bevel=.00030, smooth=True)
        axle_height = .0290
        cap('windage collar', (-.012,.0026,axle_height), [(0,.0045),(-.0007,.0045),(-.00115,.00415)])
        for i in range(10):
            a = i * math.tau/10
            cap('dial dimple shadow', (-.01316,.0026+math.sin(a)*.00325,axle_height+math.cos(a)*.00325),
                [(0,.00052),(-.00004,.00052)], body, sides=10)
        cap('visible transverse axle', (0,.0026,axle_height), [(-.008,.00175),(.008,.00175)], face_height=1.29)
        # Continuous flip leaf from the pointed crown to the curved heel, with
        # a bevel leading to an actual diamond void through the narrower throat.
        outer = [(0,crown+.00015),(.0046,h),(.00362,h-.0022),(.00362,.0251),
                 (.00422,.0234),(.00344,.0225),(.00255,.02185),(0,.02185),
                 (-.00255,.02185),(-.00344,.0225),(-.00422,.0234),(-.00362,.0251),
                 (-.00362,h-.0022),(-.0046,h)]
        def diamond(x,z):
            d = .00237 / (abs(x)+abs(z-h))
            return x*d,h+(z-h)*d
        inner = [diamond(x,z) for x,z in outer]
        verts = [(x*scale,y-.00155*max(0,min(1,(h-z-.0026)/.003)),h+(z-h)*scale)
                 for outline,y,scale in [(outer,-.0023,1),(inner,-.0023,1.08),(inner,.0003,1),(outer,.0003,.97)]
                 for x,z in outline]
        n = len(outer)
        faces = [(n*j+i,n*j+(i+1)%n,n*((j+1)%4)+(i+1)%n,n*((j+1)%4)+i)
                 for j in range(4) for i in range(n)]
        mesh('through diamond aperture leaf', verts, faces, steel, bevel=.00009)
        lower_mark = [(0,.02410),(.0009,.02320),(0,.02230),(-.0009,.02320)]
        face('lower aperture witness', lower_mark, -.00391,-.00388, body, bevel=0)
        inscription('leaf legend', '300-600M', .00114, (0,-.00387,.0271), (-1,0,0), (0,0,-1))
    else:
        face('saddle top relief', [(-.0133,.0135),(-.01315,.01645),(-.01075,.01645),
             (-.01072,.01542),(-.00832,.01542),(-.00823,.0135)], -.003,.0076, bevel=.00013)
        face('saddle corner relief', [(-.0155,.01375),(-.0150,.01598),(-.01436,.01598),
             (-.01366,.01375)], -.003,.0076, bevel=.00011)
        # The outer cheek curves back into a waisted stem. The tips narrow
        # into nearly upright inner cuts rather than blunt, level crowns.
        outer = [(.00575,.006),(.00575,.0157),(.00565,.0181),(.00525,.0198),
                 (.00502,.0217),(.00504,.0232),(.00523,.0246),(.00557,.0258),
                 (.00604,.0270),(.00668,.0284),(.00739,.0296),(.00803,.0307),
                 (.00849,.0320),(.00873,.0333),(.00878,.0347),(.00869,.0364),
                 (.00848,.0380),(.00808,.0395),(.00748,.0408),(.00671,.0419),
                 (.00579,.04264),(.00513,.04295),(.00473,.04305)]
        inner = [(.00465,.04288),(.00467,.04005),(.00482,.03944),(.00537,.03871),
                 (.00591,.03789),(.00637,.03704),(.00672,.03613),(.00696,.03522),
                 (.00698,.03450),(.00677,.03400),(.00635,.03341),(.00583,.03259),
                 (.00515,.03181),(.00437,.03113),(.00335,.03050),(.00227,.03010),
                 (.00115,.02991),(0,.02985)]

        def ear_ring(y, scale, lip_drop):
            # Lower the near lip in the aiming face so the separate collar
            # reads inside the opening instead of being buried in the rim.
            half = [(x*scale,y,z) for x,z in outer] + [
                (x*max(scale,.985),y,z-lip_drop*max(0,min(1, (.0352-z)/.00535))) for x,z in inner]
            return half + [(-x,y,z) for x,y,z in reversed(half[:-1])]

        loft('open HK ears and tapered upright', [ear_ring(y,scale,drop) for y,scale,drop in
             [(-.0044,.94,.0030),(-.0035,1,.0025),(.0044,1,0),(.0056,.93,0)]],
             bevel=.00016, smooth=True)
        cap('back witness pin', (0,.00563,.0116), [(0,.00074),(.00007,.00074)], axis='Y')
        cap('post crown collar', (0,0,.0287), [(0,.0031),(.0014,.0031),(.00175,.0026)],
            body, axis='Z', face_width=1.36)
        face('collar witness', [(-.0011,.0271),(.0011,.0271),(.00092,.02865),(.00067,.02889),
             (-.00067,.02889),(-.00092,.02865)], -.0031,-.0029, steel, bevel=.00007)
        post = [(.00165,.02985),(.00160,.03030),(.00114,.03080),(.00091,.03125),
                (.00083,.03190),(.00080,h)]
        face('front post', post + [(-x,z) for x,z in reversed(post)],
             -.00085,.00085, steel, bevel=.00007)
