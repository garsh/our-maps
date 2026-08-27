import type { Pin, MapData, MapPermission } from '@shared/interfaces';
import { getOfflineMap, saveMapOffline, isMapDownloaded } from '../utils/tileUtils';

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
    if (!res.ok && retries > 0 && res.status >= 500) {
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

const handleResponse = async <T>(res: Response, logoutCb?: (() => void) | null, fallbackErrMsg = 'Request failed'): Promise<T> => {
  if (res.status === 401) {
    const err = await res.json().catch(() => ({}));
    console.error('[API] Unauthorized:', err.error);
    logoutCb?.();
    throw new Error(err.error || 'Unauthorized: Please sign in again');
  }
  if (!res.ok) {
    if (res.status === 404) throw new Error('Map not found');
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || fallbackErrMsg);
  }
  return res.json();
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

  async getMaps(): Promise<any[]> {
    const res = await fetchWithRetry(`${API_BASE}/maps`, { headers: getHeaders() });
    return handleResponse<any[]>(res, this._logoutCallback, `Server error: ${res.status}`);
  },

  async getMap(id: string): Promise<MapData> {
    try {
      const res = await fetchWithRetry(`${API_BASE}/maps/${id}`, { headers: getHeaders() });
      const data = await handleResponse<MapData>(res, this._logoutCallback, `Server error: ${res.status}`);
      isMapDownloaded(id).then(downloaded => {
        if (downloaded) saveMapOffline(data);
      }).catch(() => {});
      return data;
    } catch (err) {
      const offlineMap = await getOfflineMap(id);
      if (offlineMap) {
        return offlineMap;
      }
      throw err;
    }
  },

  async getMapPermissions(id: string): Promise<{
    owner: { id: string; name?: string; email?: string; picture?: string };
    permissions: MapPermission[];
    userRole?: 'owner' | 'edit' | 'view';
  }> {
    const res = await fetchWithRetry(`${API_BASE}/maps/${id}/permissions`, { headers: getHeaders() });
    return handleResponse(res, this._logoutCallback, 'Failed to fetch map permissions');
  },

  async createMap(mapData: MapData): Promise<MapData> {
    try {
      const res = await fetchWithRetry(`${API_BASE}/maps`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(mapData),
      });
      return await handleResponse<MapData>(res, this._logoutCallback, 'Failed to create map');
    } catch (err) {
      console.error('API createMap FETCH ERROR:', err);
      throw err;
    }
  },

  async updateMap(id: string, name: string, layers: any[], pins: Pin[]): Promise<{ message: string }> {
    const res = await fetchWithRetry(`${API_BASE}/maps/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ name, layers, pins }),
    });
    return handleResponse<{ message: string }>(res, this._logoutCallback, 'Failed to update map');
  },

  async shareMap(id: string, email: string, role: 'view' | 'edit' | 'owner'): Promise<any> {
    const res = await fetchWithRetry(`${API_BASE}/maps/${id}/share`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ email, role }),
    });
    return handleResponse<any>(res, this._logoutCallback, 'Failed to share map');
  },

  async sharedContacts(): Promise<{ emails: string[] }> {
    const res = await fetchWithRetry(`${API_BASE}/auth/shared-contacts`, {
      headers: getHeaders(),
    });
    return handleResponse<{ emails: string[] }>(res, this._logoutCallback, 'Failed to load shared contacts');
  },

  async searchUsers(query: string): Promise<{ users: any[] }> {
    const res = await fetchWithRetry(`${API_BASE}/auth/search-users?q=${encodeURIComponent(query)}`, {
      headers: getHeaders(),
    });
    return handleResponse<{ users: any[] }>(res, this._logoutCallback, 'Failed to search users');
  },

  async removeShare(id: string, userId: string): Promise<any> {
    const res = await fetchWithRetry(`${API_BASE}/maps/${id}/share/${userId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<any>(res, this._logoutCallback, 'Failed to remove share');
  },

  async deleteMap(id: string): Promise<any> {
    const res = await fetchWithRetry(`${API_BASE}/maps/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<any>(res, this._logoutCallback, 'Failed to delete map');
  },

  async search(query: string, bounds?: string | null): Promise<any[]> {
    let url = `${API_BASE}/places/search?q=${encodeURIComponent(query)}`;
    if (bounds) {
      url += `&bounds=${encodeURIComponent(bounds)}`;
    }
    const res = await fetchWithRetry(url, { headers: getHeaders() });
    return handleResponse<any[]>(res, this._logoutCallback, 'Search failed');
  },

  async reverseGeocode(lat: number, lng: number): Promise<string | null> {
    const res = await fetchWithRetry(`${API_BASE}/places/reverse-geocode?lat=${lat}&lng=${lng}`, { headers: getHeaders() });
    const data = await handleResponse<{ address?: string }>(res, this._logoutCallback, 'Reverse geocode failed');
    return data.address || null;
  }
};
