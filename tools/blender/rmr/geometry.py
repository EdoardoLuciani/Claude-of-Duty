"""Shared original RM06/RM33 geometry, in game metres. Lens contour is inferred."""


def build_rmr(box, cyl, mesh, cut, text, optic, rail_top, optic_z, black, bright, rubber, steel, glass):
    # RM33 lists 0.768 inch rail-to-RMR optical axis. Its 13.21 mm overall
    # height includes the side clamps BELOW the rail top, not a tall solid riser.
    mount_top=rail_top+.768*.0254-.014
    box('RM33 low mount',(0,(rail_top+mount_top)/2,optic_z),(.028,mount_top-rail_top,.04521),black,optic,.0008)
    for side in (-1,1):
        clamp=box('RM33 clamp',(side*.014765,mount_top-.01321/2,optic_z),(.004,.01321,.04521),black,optic,.0008)
        for z in (optic_z-.012,optic_z+.012):
            cut(clamp,cyl('CUT RM33 recessed screw',(side*.016,rail_top-.002,z),.0038,.010,None,None,'X',24,0))
            cyl('RM33 screw',(side*.0153,rail_top-.002,z),.0035,.0025,bright,optic,'X',24)
    box('RMR electronics base',(0,mount_top+.004,optic_z),(.02642,.008,.04572),black,optic,.0012)
    # Characteristic twin-eared hood, a real clear window (not a solid rectangle).
    outer=[(-.01397,mount_top+.003),(-.01397,mount_top+.020),(-.0108,mount_top+.0254),(-.006,mount_top+.0225),(0,mount_top+.021),( .006,mount_top+.0225),(.0108,mount_top+.0254),(.01397,mount_top+.020),(.01397,mount_top+.003)]
    verts=[(x,y,z) for z in (optic_z-.021,optic_z-.014) for x,y in outer];n=len(outer)
    hood=mesh('RMR forged hood',verts,[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],black,optic,.0007)
    cut(hood,box('CUT RMR clear window',(0,mount_top+.014,optic_z-.018),(.020,.012,.025),None,None,.0022))
    box('RMR thin coated lens',(0,mount_top+.014,optic_z-.018),(.0198,.0118,.00035),glass,optic,.0014)
    for side in (-1,1):
        cyl('RMR brightness button',(side*.0132,mount_top+.006,optic_z+.002),.0035,.0015,rubber,optic,'X',24)
        text('Trijicon',(side*.01327,mount_top+.006,optic_z+.014),.0026,side,optic)
    cyl('RMR battery lid',(0,mount_top+.0085,optic_z+.011),.008,.001,steel,optic,'Y',32)
    return mount_top+.014
