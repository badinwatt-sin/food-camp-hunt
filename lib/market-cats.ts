/** Market categories shown to players and admins. Anything else saved earlier (sauce, topping …) counts as ingredient. */
export const MARKET_CATS = [
  { key: 'ingredient', icon: '🥬', label: 'วัตถุดิบ', en: 'Ingredient' },
  { key: 'decoration', icon: '🎀', label: 'ของตกแต่ง', en: 'Decoration' },
] as const;
export type MarketCat = (typeof MARKET_CATS)[number]['key'];
export const marketCat = (c: string | null | undefined): MarketCat => (c === 'decoration' ? 'decoration' : 'ingredient');
