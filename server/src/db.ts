import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';

let db: Database | null = null;
let currentDbName: string = '../database.sqlite';

export function setDbName(name: string) {
  currentDbName = name;
  db = null; // Reset current connection
}

async function migrate(_db: Database) {
  // Hook for future schema migrations
}

export async function getDb() {
  if (db) return db;

  const dbPath = process.env.DB_PATH || path.join(__dirname, currentDbName);
  
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Enable foreign keys, WAL mode, and busy timeout for concurrent safety
  await db.run('PRAGMA foreign_keys = ON;');
  await db.run('PRAGMA journal_mode = WAL;');
  await db.run('PRAGMA busy_timeout = 5000;');

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      picture TEXT
    );

    CREATE TABLE IF NOT EXISTS maps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT,
      custom_colors TEXT DEFAULT '[]',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS map_permissions (
      map_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('view', 'edit')),
      PRIMARY KEY (map_id, user_id),
      FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_map_access (
      user_id TEXT NOT NULL,
      map_id TEXT NOT NULL,
      last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, map_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pin_layers (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pins (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL,
      layer_id TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      label TEXT,
      description TEXT,
      address TEXT,
      color TEXT DEFAULT 'blue',
      icon TEXT DEFAULT 'default',
      position INTEGER DEFAULT 0,
      FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE,
      FOREIGN KEY (layer_id) REFERENCES pin_layers(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pins_layer_id ON pins(layer_id);
    CREATE INDEX IF NOT EXISTS idx_pins_map_pos ON pins(map_id, position, id);
    CREATE INDEX IF NOT EXISTS idx_pin_layers_map_pos ON pin_layers(map_id, position, id);
    CREATE INDEX IF NOT EXISTS idx_maps_owner_id ON maps(owner_id);
    CREATE INDEX IF NOT EXISTS idx_map_permissions_user_id ON map_permissions(user_id);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
  `);

  await migrate(db);

  return db;
}

export async function purgeExpiredSessions() {
  const database = await getDb();
  await database.run(
    'DELETE FROM sessions WHERE expires_at <= ?',
    new Date().toISOString()
  );
}

export async function closeDb() {
  if (db) {
    await db.close();
    db = null;
  }
}

/**
 * Bump maps.updated_at to the current timestamp.
 * Called after every realtime write so the ETag reflects the latest change.
 */
export async function touchMapUpdatedAt(mapId: string): Promise<void> {
  const database = await getDb();
  await database.run(
    `UPDATE maps SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    mapId
  );
}
