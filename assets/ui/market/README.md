# Painted market supply artwork

Five offline-authored illustrations for issue #561. The project owner selected
**style B: painted tactical inventory illustration** after comparing realistic,
painted, field-manual and cel-shaded studies. Weapons retain their authored,
interactive 3D inspection models; small card silhouettes remain SVGs.

## Products and provenance

- Runtime: `public/images/market/{ammo,bandage,armour,grenade,carpet}.webp`.
- Mapping and alternative text: `src/ui/market-art.ts`.
- `provenance.json`: exact prompts, requested model, generation settings, token
  usage, original-output hashes and optimized-product hashes for each image.
- Model: OpenAI `gpt-image-2.5-sunburst`, direct Images API through Batch processing.
- Original output: 1536 × 1024, medium quality, opaque WebP at compression 90.
- Optimization: RGB conversion, Lanczos resize to 960 × 640, WebP quality 85,
  method 6 using Pillow. No cropping, compositing or retouching.

Bandage and Ammo Refill reuse the approved painted studies. Grenade Pack depicts
one intact M67-style grenade, matching the purchase of one grenade. Armour Plate
shows one standalone ceramic insert rather than a vest. Carpet Bomb is represented
by a conventional twin-propeller bomber, matching `src/radio/index.ts`, not a modern
stealth jet. The aircraft is illustrative support artwork, not a new 3D asset.

## Future additions

Use the composition and painted-art direction recorded in the existing prompts:
three-quarter view, clear isolated silhouette, restrained ivory/olive/ochre palette,
deliberate brushwork, charcoal background, simplified material detail, no lettering,
logos, people or battlefield effects. Add an item-specific subject that accurately
represents the catalog purchase. Review the result at actual inspection-panel size,
then optimize it with the same settings and update its provenance and alternative
text. Generations are stochastic; prompts and settings document intent, not an
exactly reproducible image.

Generation and packaging scripts are intentionally **not** kept in the repository.
Credentials remain outside Git. All delivered images are bundled locally: the game
does not call OpenAI or any other image-generation or external asset service.
