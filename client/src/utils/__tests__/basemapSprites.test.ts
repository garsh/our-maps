import { describe, it, expect } from 'vitest';
import { bundledSpriteIconCount } from '../basemapSprites';

describe('basemapSprites', () => {
  it('bundles light and dark @2x sprite atlases', () => {
    expect(bundledSpriteIconCount('light')).toBeGreaterThan(20);
    expect(bundledSpriteIconCount('dark')).toBeGreaterThan(20);
  });
});
