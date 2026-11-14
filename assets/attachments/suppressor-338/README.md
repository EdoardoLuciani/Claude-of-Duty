# AX338 .338-class suppressor (#713)

Original exterior authored by `tools/blender/suppressor-338/build.py`, **not** a
reused or scaled SRD762Ti. The 280 mm × 50 mm graphite ceramic body has a stepped
steel rear sleeve, six wrench lands, shallow circumferential seams and a recessed
11 mm open endcap. The saved source and native/cooked GLBs are ignored products.
This is plausible game art, not manufacturer CAD, rated hardware or a physical
baffle/mount certification.

## Frame and hardware

Metres, +Y up / −Z forward in glTF, unit scale and identity socket rotations:

- `SOCKET_mount`: `[0, 0, 0]`, the rear seating plane.
- `SOCKET_muzzle`: `[0, 0, −.280]`, the actual endcap exit.
- Rear sleeve: 24 mm internal diameter, receiving the AX338-owned 23 mm adapter.
- Endcap: 11 mm open bore, independently ray-tested with a 10.6 mm clear gauge
  (8.59 mm .338 projectile plus over 1 mm radial margin). No hidden closed disk.

AX338 removes its entire factory brake and lock nut (`MUZZLE_device`) and shows
an open, 20 mm-long M18×1.5-to-can adapter (`MUZZLE_device_removed`) at the crown.
The thread designation is an exterior game-fit decision, not a claim that this
fictional can is approved for the factory brake. The can does **not** enclose the
old brake. The shared mount solver restores that brake on removal. The installed
exit is `[0, .075, −1.0758]` in the rifle frame, 205.8 mm beyond the base exit.

## Catalog decision

Use separate `suppressor338` ID and `/models/attachments/suppressor338.runtime.glb`.
Keep `suppressor` and SRD762Ti unchanged. A market item can therefore map directly
to one asset and finite verified fit without a weapon-dependent asset lookup.
Only AX338 (`sniper`) enables this fit. All non-null accepted muzzle IDs resolve
suppression generically; no damage, handling, audio-bank or stat changes.

## Build and check

```sh
blender -b -t 2 --python-exit-code 1 --python tools/blender/suppressor-338/build.py
blender -b -t 2 assets/attachments/suppressor-338/suppressor338.blend \
  --python-exit-code 1 --python tools/blender/suppressor-338/check.py
bun run models:cook -- suppressor338
# Build AX338, TOR Mini and all standalone optics first (bun run assets):
blender -b -t 2 assets/weapons/ax338/ax338.blend --python-exit-code 1 \
  --python tools/blender/ax338/muzzle.py
```

The builder accepts `-- --output /tmp/suppressor338-review` and checks the native
GLB's exported −Z frame. AX338's full `check.py` also calls `muzzle.py`: actual
can and adapter surfaces are checked against every existing weapon component and
evaluated glove/sleeve at 120 Hz plus endpoints over all nine clips. Standalone
RMR, ACOG, PM II and TOR Mini are mounted by their authored datums and checked
against both can and adapter. The only allowed adapter/barrel contact is their
shared crown plane; the bore remains open. These sampled surface checks are not
continuous collision certification or runtime-hand parity proof.

**Bipod: N/A for this source.** There is no authored bipod geometry/control in
`tools/blender/ax338/build.py` or `actions.py`; no future bipod clearance is certified.
AX338's separate, pre-existing firing-hand/grip contact failure remains open;
see its [README](../../weapons/ax338/README.md). Do not label the complete hand
contact acceptance as passing based on a passing new-muzzle sweep.

## In-engine review

```sh
bun tools/capture.ts --port=5713 --weapon=sniper --optic=scope --rail=laser \
  --muzzle=suppressor338 --shot=weapon --out=/tmp/ax338-suppressed.png
```

URL equivalent: `?attachmentWeapon=sniper&attachmentOptic=scope&attachmentRail=laser&attachmentMuzzle=suppressor338`.
Use `--muzzle=none` / `attachmentMuzzle=none` to restore the brake. URL and capture
support use the common fit validator; no alternate asset or runtime scale tuning.
Ballistics, muzzle flash/smoke and tracer consumers retain the shared installed
exit path; the existing `sniper-suppressed` report bank uses the effective definition.

Visible player-tracer review is **N/A**, not a passed visual check: the unchanged
player shot builder in `src/weapons/index.ts` sets `tracer: false` (line 977 at
base `88e13a672c7996a7580709e733afb44c1365ae9f`). This fit does not enable tracers.
Live capture checks verify projectile and fire/FX origins at the installed exit;
they do not claim a visible tracer rendered or human audio listening acceptance.
