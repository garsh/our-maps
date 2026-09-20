import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_SIDEBAR_WIDTH,
  layoutOrientation,
  standardSheetHeight,
  viewportIsMobile,
} from '../layoutChrome';

const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;

afterEach(() => {
  window.innerWidth = originalInnerWidth;
  window.innerHeight = originalInnerHeight;
});

describe('layoutChrome', () => {
  it('treats a narrow viewport as mobile portrait', () => {
    window.innerWidth = 400;
    window.innerHeight = 800;
    expect(layoutOrientation()).toBe('portrait');
    expect(viewportIsMobile()).toBe(true);
    expect(standardSheetHeight()).toBe(Math.min(350, Math.round(800 * 0.45)));
  });

  it('treats a wide viewport as a desktop sidebar layout', () => {
    window.innerWidth = 900;
    window.innerHeight = 400;
    expect(layoutOrientation()).toBe('landscape');
    expect(viewportIsMobile()).toBe(false);
    expect(DEFAULT_SIDEBAR_WIDTH).toBe(400);
  });
});
