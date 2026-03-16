import type { Pin, MapData } from '@shared/interfaces';

const API_BASE = 'http://localhost:3001/api';

export const apiService = {
  async getHello(): Promise<{ message: string }> {
    const res = await fetch(`${API_BASE}/hello`);
    if (!res.ok) throw new Error('Failed to fetch hello message');
    return res.json();
  },

  async getMap(id: string): Promise<MapData> {
    const res = await fetch(`${API_BASE}/maps/${id}`);
    if (!res.ok) throw new Error('Failed to fetch map');
    return res.json();
  },

  async createMap(mapData: MapData): Promise<MapData> {
    const res = await fetch(`${API_BASE}/maps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mapData),
    });
    if (!res.ok) throw new Error('Failed to create map');
    return res.json();
  },

  async updateMap(id: string, name: string, groups: any[], pins: Pin[]): Promise<{ message: string }> {
    const res = await fetch(`${API_BASE}/maps/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, groups, pins }),
    });
    if (!res.ok) throw new Error('Failed to update map');
    return res.json();
  }
};
