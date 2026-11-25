"""Crest Brake: chunky octagonal graphite silhouette with ochre ledges."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from brake import STOCK_EXIT, begin, can, export

STEM = 'crest-brake'
root, out = begin(STEM)
graphite = can.material('Crest | graphite enamel', (.047, .052, .055), .46, .48)
ochre = can.material('Crest | worn ochre inlay', (.32, .17, .067), .48, .4)

# A tall, faceted rear shoulder and heavy nose frame two bright inset ribs.
can.lathe('Crest sculpted shell', [(.012, .011), (.017, .0178), (.024, .0187),
          (.027, .0153), (.044, .0153), (.047, .0187), (.061, .0187),
          (STOCK_EXIT, .0142), (STOCK_EXIT, .0068), (.045, .0068),
          (.037, .0089), (.014, .0092), (.012, .0092)], graphite, root, sides=8, smooth=())
for index, y in enumerate((.029, .038), 1):
    can.lathe(f'Ochre rib {index}', [(y, .0152), (y+.0014, .0164),
              (y+.0041, .0164), (y+.0054, .0152)], ochre, root, sides=8, smooth=())

export(root, out, STEM)
