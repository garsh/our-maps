import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';

let db: Database | null = null;
let currentDbName: string = '../database.sqlite';

export function setDbName(name: string) {
  currentDbName = name;
  db = null; // Reset current connection
}

/**
 * Run incremental schema migrations that cannot be expressed in CREATE TABLE IF NOT EXISTS.
 *
 * HOW TO ADD A MIGRATION:
 *   1. Add a PRAGMA table_info / ALTER TABLE block below.
 *   2. Include a comment with the date one week after the change is deployed to production
 *      (e.g. "// Safe to remove after 2026-10-01"). Once that date passes and all known
 *      databases have been updated, delete the block.
 *
 * Current migrations: none (all historical migrations have been applied to every known database).
 */
async function migrate(_db: Database) {
  // Add future migrations here.
}

export async function getDb() {
  if (db) return db;

  const dbPath = process.env.DB_PATH || (currentDbName === ':memory:' ? ':memory:' : path.join(__dirname, currentDbName));
  
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
      is_public INTEGER DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS user_labels (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_mode TEXT NOT NULL DEFAULT 'last_accessed',
      position INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_user_labels_user ON user_labels(user_id, position);

    CREATE TABLE IF NOT EXISTS user_map_labels (
      user_id TEXT NOT NULL,
      label_id TEXT NOT NULL,
      map_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, label_id, map_id),
      FOREIGN KEY (label_id) REFERENCES user_labels(id) ON DELETE CASCADE,
      FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_map_labels_user_map ON user_map_labels(user_id, map_id);
    CREATE INDEX IF NOT EXISTS idx_user_map_labels_user_label ON user_map_labels(user_id, label_id, position);

    CREATE TABLE IF NOT EXISTS user_system_label_settings (
      user_id TEXT NOT NULL,
      system_label_id TEXT NOT NULL,
      sort_mode TEXT NOT NULL DEFAULT 'last_accessed',
      PRIMARY KEY (user_id, system_label_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_system_label_map_order (
      user_id TEXT NOT NULL,
      system_label_id TEXT NOT NULL,
      map_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, system_label_id, map_id),
      FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_system_label_map_order ON user_system_label_map_order(user_id, system_label_id, position);
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

/**
 * In-process mutex to serialize write transactions on SQLite's singleton connection handle.
 * Prevents concurrent BEGIN TRANSACTION collisions ("cannot start a transaction within a transaction").
 */
class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  private acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const run = () => {
        this.locked = true;
        resolve(() => {
          this.locked = false;
          const next = this.queue.shift();
          if (next) next();
        });
      };
      if (!this.locked) {
        run();
      } else {
        this.queue.push(run);
      }
    });
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const txMutex = new AsyncMutex();

/**
 * Safely executes a callback inside an IMMEDIATE transaction serialized by txMutex.
 */
export async function runInTransaction<T>(fn: (database: Database) => Promise<T>): Promise<T> {
  const database = await getDb();
  return txMutex.runExclusive(async () => {
    await database.run('BEGIN IMMEDIATE TRANSACTION');
    try {
      const result = await fn(database);
      await database.run('COMMIT');
      return result;
    } catch (error) {
      try {
        await database.run('ROLLBACK');
      } catch {
        // Ignore rollback failure if already rolled back
      }
      throw error;
    }
  });
}

