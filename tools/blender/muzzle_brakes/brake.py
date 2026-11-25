"""Shared visual seat for the fictional Crest and Vector game props."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import can

# Retain the stock M4A1's visual and projectile origin in game space.
STOCK_EXIT = .06604


def begin(stem):
    root, out = can.begin(f'ATTACHMENT_{stem}', f'.cache/blender/attachments/{stem}')
    steel = can.material('Collar | blackened steel', (.064, .068, .071), .43, .72)
    can.lathe('Stepped seat', [(0, .0099), (.002, .012), (.010, .012),
              (.013, .011), (.013, .0084), (0, .00836)], steel, root, sides=48)
    return root, out


def export(root, out, stem):
    can.assert_clear(stem, (0, .005), STOCK_EXIT)
    can.export(root, out, stem, STOCK_EXIT)
