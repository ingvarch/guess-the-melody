// Boost decision for auto spins: which genre, if any, a roll favours.

import { describe, it, expect } from 'vitest';
import { boostedGenre } from '../../src/spin-boost';

describe('boostedGenre', () => {
  const boost = { action: 'spin', boostGenre: 'hip-hop', boostChance: 0.5 };

  it('returns the favoured genre when the roll lands under the chance', () => {
    expect(boostedGenre(boost, 0.49)).toBe('hip-hop');
  });

  it('returns undefined when the roll lands on or above the chance', () => {
    expect(boostedGenre(boost, 0.5)).toBeUndefined();
    expect(boostedGenre(boost, 0.99)).toBeUndefined();
  });

  it('always hits at chance 1 and never at chance 0', () => {
    expect(boostedGenre({ ...boost, boostChance: 1 }, 0.999999)).toBe('hip-hop');
    expect(boostedGenre({ ...boost, boostChance: 0 }, 0)).toBeUndefined();
  });

  it('ignores a spin with no favoured genre', () => {
    expect(boostedGenre({ action: 'spin' }, 0)).toBeUndefined();
    expect(boostedGenre({ action: 'spin', boostGenre: '', boostChance: 1 }, 0)).toBeUndefined();
    expect(boostedGenre({ action: 'spin', boostGenre: 7, boostChance: 1 }, 0)).toBeUndefined();
  });

  it('ignores a chance that is not a number', () => {
    expect(boostedGenre({ ...boost, boostChance: '1' }, 0)).toBeUndefined();
    expect(boostedGenre({ action: 'spin', boostGenre: 'hip-hop' }, 0)).toBeUndefined();
    expect(boostedGenre({ ...boost, boostChance: Number.NaN }, 0)).toBeUndefined();
  });
});
