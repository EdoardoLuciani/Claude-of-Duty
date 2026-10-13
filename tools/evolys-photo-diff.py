"""Offline FN photo diagnostics; reference images are review-only, not shipped.
Frozen registration is committed separately; never fit the after render here.
python3 tools/evolys-photo-diff.py --photos PATH --before PATH --after PATH --out PATH
Requires Pillow/NumPy offline only. RGB differences are NOT a fidelity score.
"""
from weapon_photo_diff import main

if __name__ == "__main__":
    main("assets/weapons/fn-evolys-762/photo-review.json", "FN reference")
