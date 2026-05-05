import { describe, expect, it } from 'vitest';
import { assertSecureConfig } from './config.js';

describe('assertSecureConfig', () => {
  it('does not throw outside production', () => {
    expect(() => assertSecureConfig()).not.toThrow();
  });
});
