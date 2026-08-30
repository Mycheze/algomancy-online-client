/* Public API of the Algomancy engine. */
export { createGame, apply, replay, legalActions, checkDeck, IllegalAction } from './apply.ts';
export { E, other, normalizeProphecy } from './engine.ts';
export {
  getCard, allCardNames, affinityPips, registerSynthetic,
  // R71: "Wraith" and "Wight" are one card — anything that resolves a printed
  // card NAME (card browsers, deck tools) should go through these
  registerAlias, canonicalCardName,
} from './cards/dsl.ts';
export { DECK_LIST } from './cards/registry.ts';
export * from './types.ts';
export { Harness } from './harness.ts';
