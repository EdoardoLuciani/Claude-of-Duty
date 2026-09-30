/**
 * Six card names, drawn once per run. This PR pays credits and shows the
 * name. The rewards themselves land in a later change.
 */

export const CARDS = Object.freeze([
  { id: 'sigint', label: 'SIGINT', blurb: 'Next wave bearing' },
  { id: 'carpet', label: 'Extra Strike', blurb: '+1 carpet over cap' },
  { id: 'armour', label: 'Plate Carrier', blurb: '+25 max armour' },
  { id: 'blueprint', label: 'Gunsmith Blueprint', blurb: 'Souk attachments' },
  { id: 'forecast', label: 'Forecast', blurb: '12s weather warning' },
  { id: 'map', label: "Dead Man's Map", blurb: 'Remaining caches' },
]);

const BY_ID = new Map(CARDS.map((card) => [card.id, card]));

export function cardById(id) {
  return BY_ID.get(id) ?? null;
}

/** Fisher-Yates into `out`. Does not allocate. */
export function shuffleDeck(rng, out) {
  out.length = 0;
  for (let i = 0; i < CARDS.length; i++) out.push(CARDS[i].id);
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.u32() % (i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

export function drawCard(deck) {
  return deck.length ? deck.pop() : null;
}
