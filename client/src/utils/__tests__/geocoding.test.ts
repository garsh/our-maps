import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reverseGeocode, resetGeocodingState } from '../geocoding';

describe('reverseGeocode', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    resetGeocodingState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls reverse-geocode API directly', async () => {
    const fetchMock = global.fetch as any;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ address: 'Direct Address' })
    });

    const result = await reverseGeocode(1, 1);
    
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/places/reverse-geocode'),
      expect.any(Object)
    );
    expect(result).toBe('Direct Address');
  });

  it('executes concurrent requests immediately without artificial serialization delay', async () => {
    const fetchMock = global.fetch as any;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ address: 'Test' })
    });

    const p1 = reverseGeocode(1, 1);
    const p2 = reverseGeocode(2, 2);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r1).toBe('Test');
    expect(r2).toBe('Test');
  });
});
