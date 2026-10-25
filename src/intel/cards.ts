/**
 * Six card names, drawn once per run. This PR pays credits and shows the
 * name. The rewards themselves land in a later change.
 */
export const CARDS = Object.freeze([
  { id: 'sigint', label: 'SIGINT' },
  { id: 'carpet', label: 'Extra Strike' },
  { id: 'armour', label: 'Plate Carrier' },
  { id: 'blueprint', label: 'Gunsmith Blueprint' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'map', label: "Dead Man's Map" },
] as const);

export type CardId = (typeof CARDS)[number]['id'];
export type IntelCard = (typeof CARDS)[number];

export function cardById(id: CardId): IntelCard {
  const card = CARDS.find((card): boolean => card.id === id);
  if (!card) throw new Error(`[intel] unknown card: ${id}`);
  return card;
}

export interface RandomSource {
  u32(): number;
}

/** Fisher-Yates into `out`. Does not allocate. */
export function shuffleDeck(rng: RandomSource, out: CardId[]): void {
  out.length = 0;
  for (let i = 0; i < CARDS.length; i++) out.push(CARDS[i].id);
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.u32() % (i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
}

export function drawCard(deck: CardId[]): CardId | null {
  return deck.length ? deck.pop()! : null;
}
