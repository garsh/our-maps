import { setDbName, getDb, closeDb } from '../db';
import type { Database } from 'sqlite';

export { getDb };

export const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const MOCK_USER = {
  id: 'test-user-id',
  email: 'test@example.com',
  name: 'Test User',
  picture: ''
};

export const AUTH_HEADER = { 'x-mock-user': JSON.stringify(MOCK_USER) };

export async function setupTestDb(): Promise<Database> {
  process.env.NODE_ENV = 'test';
  setDbName(':memory:');
  return getDb();
}

export async function resetTestDb(db?: Database): Promise<Database> {
  const database = db ?? await getDb();
  await database.exec('DELETE FROM user_map_access');
  await database.exec('DELETE FROM map_permissions');
  await database.exec('DELETE FROM pins');
  await database.exec('DELETE FROM pin_layers');
  await database.exec('DELETE FROM maps');
  await database.exec('DELETE FROM users');
  return database;
}

export async function teardownTestDb(): Promise<void> {
  await closeDb();
}

export class BufferSource {
  constructor(private buffer: Buffer, private key = 'fixture.pmtiles') {}
  getKey() { return this.key; }
  async getBytes(offset: number, length: number) {
    const slice = this.buffer.subarray(offset, offset + length);
    return { data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) as ArrayBuffer };
  }
}
