import { describe, expect, it } from 'vitest';
import { PARSER_VERSION } from '../src/index';

describe('parser package', () => {
  it('loads', () => {
    expect(PARSER_VERSION).toBe('0.0.0');
  });
});
