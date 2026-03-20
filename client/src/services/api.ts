import type { Pin, MapData, MapPermission } from '@shared/interfaces';

const API_BASE = '/api';

const getHeaders = () => {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : '',
  };
};

const fetchWithRetry = async (url: string, options: RequestInit = {}, retries = 3): Promise<Response> => {
  try {
    const res = await fetch(url, options);
    if (!res.ok && retries > 0 && res.status !== 401 && res.status !== 403 && res.status !== 404) {
      console.warn(`Fetch status ${res.status} for ${url}, retrying... (${retries} left)`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return fetchWithRetry(url, options, retries - 1);
    }
    return res;
  } catch (err) {
    if (retries > 0) {
      console.warn(`Fetch network error for ${url}, retrying... (${retries} left)`, err);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return fetchWithRetry(url, options, retries - 1);
    }
    throw err;
  }
};

export const apiService = {
  async getHello(): Promise<{ message: string }> {
    const res = await fetchWithRetry(`${API_BASE}/hello`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch hello message');
    return res.json();
  },

  async getMaps(): Promise<any[]> {
    const res = await fetchWithRetry(`${API_BASE}/maps`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch maps');
    return res.json();
  },

  async getMap(id: string): Promise<MapData> {
    const res = await fetchWithRetry(`${API_BASE}/maps/${id}`, { headers: getHeaders() });
    if (!res.ok) throw new Error('Failed to fetch map');
    return res.json();
  },

  async createMap(mapData: MapData): Promise<MapData> {
    try {
      const res = await fetchWithRetry(`${API_BASE}/maps`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(mapData),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error('API createMap failed:', text);
        throw new Error('Failed to create map');
      }
      return res.json();
    } catch (err) {
      console.error('API createMap FETCH ERROR:', err);
      throw err;
    }
  },

  async updateMap(id: string, name: string, groups: any[], pins: Pin[]): Promise<{ message: string }> {
    const res = await fetchWithRetry(`${API_BASE}/maps/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ name, groups, pins }),
    });
    if (!res.ok) throw new Error('Failed to update map');
    return res.json();
  },

  async shareMap(id: string, email: string, role: 'view' | 'edit'): Promise<any> {
    const res = await fetchWithRetry(`${API_BASE}/maps/${id}/share`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ email, role }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to share map');
    }
    return res.json();
  },

  async removeShare(id: string, userId: string): Promise<any> {
    const res = await fetchWithRetry(`${API_BASE}/maps/${id}/share/${userId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to remove share');
    return res.json();
  }
};
