"""Offline AX338 photo diagnostics; reference images are review-only, not shipped.
Frozen registration is committed separately; never fit the after render here.
python3 tools/ax338-photo-diff.py --photos PATH --before PATH --after PATH --out PATH
Requires Pillow/NumPy offline only. RGB differences are NOT a fidelity score.
"""
from weapon_photo_diff import main

if __name__ == "__main__":
    main("assets/weapons/ax338/photo-review.json", "AX338 brochure", enlarge_regions=True)
