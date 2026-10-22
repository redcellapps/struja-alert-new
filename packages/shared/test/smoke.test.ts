import { describe, expect, it } from 'vitest';
import { MAX_ADDRESSES } from '../src/index';

describe('shared package', () => {
  it('exposes constants', () => {
    expect(MAX_ADDRESSES).toBe(3);
  });
});
