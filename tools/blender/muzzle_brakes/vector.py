"""Vector Brake: low, wide slate lobes and a stepped bright nose."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from brake import STOCK_EXIT, begin, can, export

STEM = 'vector-brake'
root, out = begin(STEM)
slate = can.material('Vector | blue-grey alloy', (.13, .19, .22), .39, .55)
nickel = can.material('Vector | satin nose', (.28, .33, .35), .33, .72)

# A stretched cross-section and swept shoulders read broad rather than tall.
shell = can.lathe('Vector swept shell', [(.012, .011), (.017, .014), (.026, .0175),
                  (.034, .0175), (.037, .013), (.042, .013), (.046, .0165),
                  (.052, .0165), (.057, .0107), (.057, .0067), (.013, .0095),
                  (.012, .0095)], slate, root, sides=32, smooth=(1, 2, 3, 4, 5, 6, 7))
for vertex in shell.data.vertices:
    vertex.co.x *= 1.23
    vertex.co.z *= .87
can.lathe('Vector inset nose', [(.054, .009), (.059, .0126), (.063, .0126),
          (STOCK_EXIT, .0098), (STOCK_EXIT, .0067), (.054, .0067)], nickel, root, sides=32)

export(root, out, STEM)
