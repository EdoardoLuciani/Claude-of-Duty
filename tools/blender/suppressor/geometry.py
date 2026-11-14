"""SRD762Ti exterior shared by the legacy MCX and standalone attachment.

Metres, +X bore axis. Callers own primitives, material conversion and batching.
"""
import math
import bpy


def build_suppressor(asset, cylinder, opening, finish, tube, text, ceramic, rubber):
    # SRD762Ti direct-thread exterior: 236 mm overall / 44 mm diameter.
    # Subtle circumferential seams, no invented cooling flutes or QD locking rings.
    mount = cylinder('Suppressor mount',(.282,0,0),.013,.016,ceramic,vertices=48)
    for side in (-1,1):
        opening(mount,(.280,side*.015,0),(.012,.008,.030),.0004)
    profile_rings=[(.288,.013),(.290,.0205),(.294,.022),(.326,.022),(.328,.0215)]
    for x in (.345,.369,.393,.417,.441,.465,.489):
        profile_rings.extend([(x-.0005,.0215),(x,.02165),(x+.0005,.0215)])
    profile_rings.extend([(.504,.0215),(.508,.0208)])
    verts=[(x,math.cos(i*math.tau/64)*r,math.sin(i*math.tau/64)*r) for x,r in profile_rings for i in range(64)]
    faces=[(j*64+i,j*64+(i+1)%64,(j+1)*64+(i+1)%64,(j+1)*64+i) for j in range(len(profile_rings)-1) for i in range(64)]
    mesh=bpy.data.meshes.new('SRD762Ti exterior');mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new('Suppressor body',mesh);asset.objects.link(obj)
    for polygon in mesh.polygons: polygon.use_smooth=True
    finish(obj,obj.name,ceramic,bevel=0)
    tube('Recessed suppressor endcap',(.508,0,0),.0208,.0047,.004,ceramic)
    cylinder('Muzzle interior shadow',(.502,0,0),.0048,.001,rubber,bevel=0)
    text('SIG SAUER',(.302,-.0222,.003),.0028)
    text('SRD762Ti',(.302,-.0222,-.001),.0028)
