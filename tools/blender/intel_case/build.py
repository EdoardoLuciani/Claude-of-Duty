"""Author the Al-Maktaba MK-IV terminal and export its native batched GLB."""
import argparse
from math import cos, pi, sin
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import atlas

OUT = Path(__file__).resolve().parents[3] / '.cache/blender/props/intel-case'
HINGE = (0, .23, .38)
TRAY_LIFT = .043
SPARK = (.13, -.06, .245 + TRAY_LIFT)


def empty(name, pos, parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = pos
    obj.empty_display_size = .028
    return obj


class Assembly:
    """Scene-local parts use closed case coordinates until the export join."""
    def __init__(self, finish, lens, led):
        self.finish, self.lens, self.led = finish, lens, led
        self.parts = []

    def surface(self, name, verts, faces, tile, face_uv=None):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts, [], faces, shade_flat=False)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        if tile in ('lens', 'led'):
            mesh.materials.append(self.lens if tile == 'lens' else self.led)
        else:
            mesh.materials.append(self.finish)
            uv = mesh.uv_layers.new(name='FinishUV')
            z0, z1 = min(v[2] for v in verts), max(v[2] for v in verts)
            for face in mesh.polygons:
                nx, ny, nz = face.normal
                for i in face.loop_indices:
                    vertex = mesh.loops[i].vertex_index
                    x, y, z = verts[vertex]
                    if face_uv:
                        u, v = face_uv[vertex]
                    elif tile == 'shell' and abs(nz) < .8:
                        # Map vertical wear up the draft, not a horizontal texel
                        # stretched through the entire case wall.
                        u = .5 + (x/.76 if abs(ny) > abs(nx) else y/.48)
                        v = (z - z0) / (z1 - z0)
                    elif tile in ('shell', 'pad'):
                        u, v = .5 + x/.76, .5 + y/.48
                    else:
                        u, v = .5 + x * 1.05 + z * .35, .48 + y * 1.38 + z * .56
                    uv.data[i].uv = atlas.coordinates(tile, u, v)
        mesh.set_sharp_from_angle(angle=pi / 5)
        self.parts.append(obj)
        return obj

    def loft(self, name, profile, tile, xy=(0, 0), steps=3, loop_profile=False):
        """Rounded rectangle cross-sections: (height, width, depth, corner radius)."""
        verts = []
        for z, w, d, r in profile:
            for q, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
                for i in range(steps + 1):
                    a = (q + i / steps) * pi / 2
                    verts.append((xy[0] + sx * (w/2-r) + r*cos(a),
                                  xy[1] + sy * (d/2-r) + r*sin(a), z))
        return self.rings(name, verts, 4*(steps+1), tile, loop_profile)

    def rings(self, name, verts, n, tile, loop_profile=False):
        faces = [] if loop_profile else [tuple(reversed(range(n)))]
        for k in range(0, len(verts) if loop_profile else len(verts)-n, n):
            next_ring = (k+n) % len(verts)
            for j in range(n):
                i = (j + 1) % n
                faces.append((k+j, k+i, next_ring+i, next_ring+j))
        if not loop_profile:
            faces.append(tuple(range(len(verts)-n, len(verts))))
        return self.surface(name, verts, faces, tile)

    def block(self, name, xyz, size, bevel, tile, steps=1):
        x, y, z = xyz
        w, d, h = size
        r = bevel * 1.5
        return self.loft(name, [(z-h/2, w-2*bevel, d-2*bevel, r-bevel),
                               (z-h/2+bevel, w,d,r), (z+h/2-bevel,w,d,r),
                               (z+h/2,w-2*bevel,d-2*bevel,r-bevel)], tile, (x,y), steps)

    def tube(self, name, points, radii, tile, sides=8, reference=(0,0,1), flatten=1, bore=0):
        verts = []
        profile = list(zip(points, radii))
        frames = []
        for i in range(len(points)):
            chord = Vector(points[min(i+1, len(points)-1)]) - Vector(points[max(i-1,0)])
            direction = chord.normalized()
            right = Vector(reference).cross(direction).normalized()
            frames.append((right, direction.cross(right)))
        if bore:
            # Reverse the inner wall so the same closed profile forms the sleeve.
            profile += [(p, bore) for p in reversed(points)]
            frames += list(reversed(frames))
        for (p, r), (right, up) in zip(profile, frames):
            for j in range(sides):
                a = 2*pi*(j+.5)/sides
                verts.append(tuple(Vector(p) + r*(right*cos(a) + flatten*up*sin(a))))
        return self.rings(name, verts, sides, tile, loop_profile=bool(bore))

    def screw(self, x, y, z):
        self.tube('Captive slotted screw', [(x,y,z-.002), (x,y,z+.002)], [.007,.006], 'bare', 8,
                  reference=(1,0,0))
        self.block('Recessed drive', (x,y,z+.0023), (.007,.0019,.001), .0003, 'chip')

    def label(self, tile, center, w, h, down=(0,-1,0)):
        verts = [(center[0]+u*w, center[1]+v*h*down[1], center[2]+v*h*down[2])
                 for u, v in ((-.5,-.5),(-.5,.5),(.5,.5),(.5,-.5))]
        return self.surface(tile, verts, [(0,1,2,3)], tile, [(0,0),(0,1),(1,1),(1,0)])


def housing(a):
    a.loft('Injection shell / hollow draft and return flange', [
        (.028,.633,.390,.048), (.044,.682,.434,.052), (.066,.711,.454,.053),
        (.325,.727,.463,.062), (.353,.725,.461,.050), (.365,.711,.452,.045),
        (.365,.660,.396,.037), (.343,.650,.387,.034), (.094,.603,.342,.038),
    ], 'shell')
    a.loft('Flange / dual durometer overmould', [
        (.339,.726,.445,.051), (.352,.746,.455,.054), (.373,.741,.455,.056),
        (.379,.722,.435,.052), (.379,.668,.376,.039), (.355,.665,.375,.038),
    ], 'rubber', (0,-.013), loop_profile=True)
    for x in (-.279,.279):
        for y in (-.157,.157):
            a.loft('Impact boot / stepped foot', [
                (.003,.123,.112,.022), (.016,.141,.129,.025), (.054,.142,.130,.022),
                (.080,.123,.112,.021), (.087,.112,.103,.016),
            ], 'rubber', (x,y), steps=2)
        # Molded vertical gussets bridge the boot and closure flange.
        for y in (-.216,.216):
            a.loft('Flange rib / tapered gusset', [
                (.056,.028,.015,.006), (.101,.038,.036,.011),
                (.323,.038,.050,.011), (.346,.030,.042,.010),
            ], 'edge', (x*1.086,y), steps=1)
    for x in (-.235,.235):
        a.block('Toggle bed / recessed steel frame', (x,-.223,.319), (.106,.044,.097), .010, 'anodized')
        a.loft('Cast over-centre toggle', [( .277,.038,.019,.006),(.289,.059,.027,.008),
                                          (.339,.070,.025,.006),(.350,.061,.019,.005)],
               'latch', (x,-.245), steps=1)
        a.tube('Toggle axle', [(x-.040,-.246,.334),(x+.040,-.246,.334)], [.007,.007], 'bare', 8)
    for x in (-.108,.108):
        a.block('Pull-handle shoe', (x,-.222,.210), (.067,.041,.067), .007, 'anodized')
    a.tube('Folding elastomer grip', [(-.106,-.225,.211),(-.113,-.254,.202),(-.095,-.276,.192),
                                        (-.076,-.277,.189),(.076,-.277,.189),(.095,-.276,.192),
                                        (.113,-.254,.202),(.106,-.225,.211)],
           [.009,.013,.015,.017,.017,.015,.013,.009], 'rubber', sides=8, flatten=.75)
    a.block('Recessed asset tag pocket', (0,-.224,.298), (.126,.017,.057), .005, 'anodized')
    a.label('front_print', (0,-.233,.298), .110,.041, (0,0,-1))


def hinge_straps(a, lid):
    for x in (-.252,.252):
        if lid:
            for offset in (-.030,.030):
                a.block('Lid hinge ear', (x+offset,.212,.401), (.018,.042,.023), .003,'anodized')
                a.tube('Moving barrel', [(x+offset-.010,.23,.38),(x+offset+.010,.23,.38)],
                       [.014,.014], 'anodized', bore=.0065)
        else:
            a.block('Rear strap', (x,.214,.339), (.035,.041,.069), .006,'anodized')
            a.tube('Fixed barrel', [(x-.017,.23,.38),(x+.017,.23,.38)], [.014,.014], 'bare')
            a.tube('Through pin', [(x-.043,.23,.38),(x+.043,.23,.38)], [.0055,.0055], 'bare')


def cover(a):
    a.loft('Lid composite cap / stepped rim', [
        (.382,.718,.454,.047), (.389,.746,.475,.053), (.419,.739,.467,.054),
        (.435,.706,.437,.056), (.440,.685,.407,.047),
    ], 'shell', (0,-.020))
    # The soft pocket and its card are inset clear of the electronics tray.
    a.loft('Closed-cell lid liner', [(.377,.555,.291,.038),(.379,.603,.337,.044),
                                   (.386,.632,.366,.053)], 'pad')
    a.block('Laminated field card bed', (0,.006,.377), (.271,.156,.007), .002,'anodized')
    a.label('field_card', (0,.006,.3734), .254,.142, (0,1,0))
    for x in (-.286,.286):
        a.block('Raised lid skid', (x,.007,.439), (.072,.346,.024), .008,'rubber')
        for y in (-.125,.138):
            a.screw(x,y,.450)
    a.loft('Recessed aluminium nameplate bed', [(.440,.291,.112,.008), (.443,.288,.108,.008)],
           'anodized', (.021,-.015), steps=2)
    a.label('badge', (.021,-.015,.4433), .273,.097)
    for x in (-.235,.235):
        a.block('Striker lip', (x,-.221,.394), (.068,.043,.019), .004,'bare')
    a.loft('Status beacon / strain collar', [(.433,.074,.066,.028),(.441,.076,.066,.029),
                                           (.455,.057,.053,.022)], 'anodized', (-.294,-.161))
    hinge_straps(a, True)


def electronics(a):
    a.loft('Suspended foam with clearance channels', [(.113,.602,.346,.038),(.163,.638,.380,.050),
                                                       (.179,.632,.375,.047)], 'foam')
    a.block('Battery well plate', (-.217,.0,.178), (.157,.287,.016), .005,'anodized')
    a.loft('24 V sealed battery casting', [(.180,.115,.246,.016),(.189,.133,.265,.016),
                                          (.252,.133,.265,.016),(.260,.118,.245,.011)],
           'battery', (-.217,.002), steps=2)
    a.label('battery_print', (-.217,-.015,.2603), .102,.165)
    for y in (-.117,.103):
        a.block('Battery isolation strap', (-.217,y,.234), (.135,.021,.058), .004,'rubber')
    a.block('Potted power receptacle', (-.153,.108,.245), (.042,.059,.030), .005,'chip')
    a.block('Signal board carrier', (.074,.001,.191), (.391,.326,.029), .008,'anodized')
    a.loft('Controller PCB / bonded substrate', [(.208,.371,.303,.013),(.217,.369,.302,.011)],
           'board', (.076,.001), steps=2)
    a.label('pcb_print', (.076,.001,.2173), .340,.284)
    for x in (-.090,.242):
        for y in (-.134,.135):
            a.screw(x,y,.221)
    a.block('Shielded signal processor', (.119,.024,.229), (.112,.084,.021), .005,'chip')
    a.label('chip_print', (.119,.024,.2397), .094,.065)
    for y in (-.022,.070):
        a.block('Processor pin comb', (.119,y,.221), (.101,.016,.006), .002,'bare')
    for y in (.056,.094,.129):
        a.tube('Filter capacitor can', [(.211,y,.218),(.211,y,.249),(.211,y,.253)], [.012,.012,.010],
               'anodized', reference=(1,0,0))
    for x in (-.041,.003):
        a.block('Inductor / moulded shoulder', (x,.022,.227), (.038,.047,.018), .003,'chip')
    a.block('Keyed battery connector', (-.073,.097,.234), (.057,.071,.030), .004,'socket')
    a.block('Connector lock tab', (-.069,.097,.251), (.018,.033,.006), .002,'latch')
    for i in range(3):
        y = i*.012
        a.tube('Radiused harness lead', [(-.156,.105+y,.247),(-.134,.112+y,.264),
                                          (-.110,.116+y,.272),(-.096,.108+y,.266),
                                          (-.077,.087+y,.245)], [.004]*5,
               'wire' if i != 1 else 'rubber', sides=6)
    a.block('Status strip / lens bed', (.142,-.105,.226), (.131,.072,.017), .005,'chip')
    a.label('power', (.142,-.109,.2347), .104,.053)
    a.block('Service header', (.133,-.056,.232), (.058,.024,.023), .004,'socket')
    for x in (.117,.133,.149):
        a.block('Live test contact', (x,-.056,.244), (.006,.009,.005), .001,'bare')


def parent_in_place(parts, parent):
    bpy.context.view_layer.update()
    for obj in parts:
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()


def batch(parts, name):
    if len(parts) == 1:
        parts[0].name = name
        return
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    parts[0].name = name


def indicator(name, rgb):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb,1)
    mat.use_nodes = True
    mat.use_backface_culling = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*rgb,1)
    bsdf.inputs['Emission Color'].default_value = (*rgb,1)
    bsdf.inputs['Emission Strength'].default_value = 1
    return mat


def build(output):
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    finish, lens, led = atlas.material(), indicator('Beacon review only', (.8,.015,.005)), indicator('Status review only', (.06,.8,.34))
    root = empty('INTEL_CASE', (0,0,0))
    hinge = empty('INTEL_HINGE', HINGE, root)
    empty('INTEL_SPARK', SPARK, root)
    body = Assembly(finish, lens, led)
    housing(body)
    tray_start = len(body.parts)
    electronics(body)
    for obj in body.parts[tray_start:]:
        obj.location.z += TRAY_LIFT
    hinge_straps(body, False)
    lid = Assembly(finish, lens, led)
    cover(lid)
    beacon = Assembly(finish, lens, led)
    beacon.loft('Fresnel dome lens', [(.455,.055,.051,.021),(.469,.047,.043,.019),
                                    (.482,.027,.026,.011),(.486,.013,.012,.005)],
                'lens', (-.294,-.161), steps=2)
    lamps = Assembly(finish, lens, led)
    for x in (.117,.142,.167):
        lamps.loft('Potted LED lens', [(.235,.010,.009,.003),(.240,.008,.007,.002)],
                   'led', (x,-.091), steps=1)
    for obj in lamps.parts:
        obj.location.z += TRAY_LIFT
    parent_in_place(body.parts + lamps.parts, root)
    parent_in_place(lid.parts + beacon.parts, hinge)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'intel-case.blend'))
    batch(body.parts, 'INTEL_BODY')
    batch(lid.parts, 'INTEL_LID')
    batch(beacon.parts, 'INTEL_BEACON')
    batch(lamps.parts, 'INTEL_LEDS')
    bpy.ops.export_scene.gltf(filepath=str(output / 'intel-case.glb'), export_format='GLB',
                              export_yup=True, export_animations=False, export_cameras=False,
                              export_lights=False, export_materials='EXPORT')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=OUT)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    build(args.output)
