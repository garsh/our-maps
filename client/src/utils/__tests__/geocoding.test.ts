import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reverseGeocode, resetGeocodingState } from '../geocoding';

describe('reverseGeocode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn();
    resetGeocodingState();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls Nominatim API directly', async () => {
    const fetchMock = global.fetch as any;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: 'Direct Address' })
    });

    const result = await reverseGeocode(1, 1);
    
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('nominatim.openstreetmap.org/reverse'),
      expect.any(Object)
    );
    expect(result).toBe('Direct Address');
  });

  it('serializes concurrent requests with spacing', async () => {
    const fetchMock = global.fetch as any;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ display_name: 'Test' })
    });

    const p1 = reverseGeocode(1, 1);
    const p2 = reverseGeocode(2, 2);

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1200);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await Promise.all([p1, p2]);
  });
});
