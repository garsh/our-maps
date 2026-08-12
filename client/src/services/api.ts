import type { Pin, MapData } from '@shared/interfaces';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

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
  _logoutCallback: null as (() => void) | null,
  
  setLogoutCallback(callback: () => void) {
    this._logoutCallback = callback;
  },

  async loginWithGoogle(credential: string): Promise<{ token: string; user: any }> {
    const res = await fetch(`${API_BASE}/auth/google-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ credential }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Google login failed on server');
    }
    return res.json();
  },

  async getHello(): Promise<{ message: string }> {
    const res = await fetchWithRetry(`${API_BASE}/hello`, { headers: getHeaders() });
    if (res.status === 401) this._logoutCallback?.();
    if (!res.ok) throw new Error('Failed to fetch hello message');
    return res.json();
  },

  async getMaps(): Promise<any[]> {
    const res = await fetchWithRetry(`${API_BASE}/maps`, { headers: getHeaders() });
    if (res.status === 401) {
        const err = await res.json().catch(() => ({}));
        console.error('[API] Unauthorized:', err.error);
        this._logoutCallback?.();
        throw new Error(err.error || 'Unauthorized: Please sign in again');
    }
    if (!res.ok) throw new Error(`Server error: ${res.status}`);
    return res.json();
  },

  async getMap(id: string): Promise<MapData> {
    const res = await fetchWithRetry(`${API_BASE}/maps/${id}`, { headers: getHeaders() });
    if (res.status === 401) {
        const err = await res.json().catch(() => ({}));
        console.error('[API] Unauthorized:', err.error);
        this._logoutCallback?.();
        throw new Error(err.error || 'Unauthorized: Please sign in again');
    }
    if (!res.ok) {
        if (res.status === 404) throw new Error('Map not found');
        throw new Error(`Server error: ${res.status}`);
    }
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
        if (res.status === 401) this._logoutCallback?.();
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
    if (!res.ok) {
        if (res.status === 401) this._logoutCallback?.();
        const err = await res.json();
        throw new Error(err.error || 'Failed to update map');
    }
    return res.json();
  },

  async shareMap(id: string, email: string, role: 'view' | 'edit'): Promise<any> {
    const res = await fetchWithRetry(`${API_BASE}/maps/${id}/share`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ email, role }),
    });
    if (!res.ok) {
      if (res.status === 401) this._logoutCallback?.();
      const err = await res.json();
      throw new Error(err.error || 'Failed to share map');
    }
    return res.json();
  },

  async filterContacts(emails: string[]): Promise<{ existingEmails: string[] }> {
    const res = await fetchWithRetry(`${API_BASE}/auth/filter-contacts`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ emails }),
    });
    if (!res.ok) {
      if (res.status === 401) this._logoutCallback?.();
      const err = await res.json();
      throw new Error(err.error || 'Failed to filter contacts');
    }
    return res.json();
  },

  async removeShare(id: string, userId: string): Promise<any> {
    const res = await fetchWithRetry(`${API_BASE}/maps/${id}/share/${userId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (res.status === 401) this._logoutCallback?.();
    if (!res.ok) throw new Error('Failed to remove share');
    return res.json();
  },

  async deleteMap(id: string): Promise<any> {
    const res = await fetchWithRetry(`${API_BASE}/maps/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (res.status === 401) this._logoutCallback?.();
    if (!res.ok) throw new Error('Failed to delete map');
    return res.json();
  },

  async search(query: string, bounds?: string | null): Promise<any[]> {
    let url = `${API_BASE}/places/search?q=${encodeURIComponent(query)}`;
    if (bounds) {
      url += `&bounds=${encodeURIComponent(bounds)}`;
    }
    const res = await fetchWithRetry(url, { headers: getHeaders() });
    if (res.status === 401) this._logoutCallback?.();
    if (!res.ok) throw new Error('Search failed');
    return res.json();
  },

  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    const res = await fetchWithRetry(`${API_BASE}/places/reverse-geocode?lat=${lat}&lng=${lng}`, { headers: getHeaders() });
    if (res.status === 401) this._logoutCallback?.();
    if (!res.ok) throw new Error('Reverse geocode failed');
    const data = await res.json();
    return data.address || null;
  }
};
