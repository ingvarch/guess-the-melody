// Host-private nudge for auto spins. The console sends the favoured genre and
// its chance with the spin itself; neither is stored nor broadcast, so the
// room only ever sees an ordinary roulette.
export function boostedGenre(
  payload: Record<string, unknown>,
  roll: number,
): string | undefined {
  const genre = payload['boostGenre'];
  const chance = payload['boostChance'];
  if (typeof genre !== 'string' || genre === '' || typeof chance !== 'number') {
    return undefined;
  }
  return roll < chance ? genre : undefined;
}
