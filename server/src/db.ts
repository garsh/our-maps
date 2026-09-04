import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';

let db: Database | null = null;
let currentDbName: string = '../database.sqlite';

export function setDbName(name: string) {
  currentDbName = name;
  db = null; // Reset current connection
}

async function migrate(db: Database) {
  const tableInfo = await db.all("PRAGMA table_info(pins)");
  const columnNames = tableInfo.map((col: any) => col.name);

  if (!columnNames.includes('description')) {
    await db.exec("ALTER TABLE pins ADD COLUMN description TEXT");
  }
  if (!columnNames.includes('address')) {
    await db.exec("ALTER TABLE pins ADD COLUMN address TEXT");
  }
  if (columnNames.includes('image_url')) {
    await db.exec("ALTER TABLE pins DROP COLUMN image_url");
  }
  if (!columnNames.includes('color')) {
    await db.exec("ALTER TABLE pins ADD COLUMN color TEXT DEFAULT 'blue'");
  }
  if (!columnNames.includes('icon')) {
    await db.exec("ALTER TABLE pins ADD COLUMN icon TEXT DEFAULT 'default'");
  }
  if (columnNames.includes('group_id')) {
    await db.exec("ALTER TABLE pins RENAME COLUMN group_id TO layer_id");
  } else if (!columnNames.includes('layer_id')) {
    await db.exec("ALTER TABLE pins ADD COLUMN layer_id TEXT");
  }

  if (!columnNames.includes('position')) {
    await db.exec("ALTER TABLE pins ADD COLUMN position INTEGER DEFAULT 0");
  }

  const mapTableInfo = await db.all("PRAGMA table_info(maps)");
  const mapColumnNames = mapTableInfo.map((col: any) => col.name);
  if (!mapColumnNames.includes('owner_id')) {
    await db.exec("ALTER TABLE maps ADD COLUMN owner_id TEXT");
  }

  // Prune redundant single-column indexes covered by existing composite indexes (idx_pins_map_pos, idx_pin_layers_map_pos)
  await db.exec(`
    DROP INDEX IF EXISTS idx_pins_map_id;
    DROP INDEX IF EXISTS idx_pin_layers_map_id;
  `);
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

  const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
  const tableNames = tables.map((t: any) => t.name);
  
  if (tableNames.includes('pin_groups')) {
    if (tableNames.includes('pin_layers')) {
      // Split-brain recovery: If both tables exist due to a previous crash, merge them
      await db.run('PRAGMA foreign_keys = OFF;');
      await db.exec("ALTER TABLE pin_layers RENAME TO pin_layers_temp");
      await db.run('PRAGMA foreign_keys = ON;');
      
      await db.exec("ALTER TABLE pin_groups RENAME TO pin_layers");
      await db.exec("INSERT OR IGNORE INTO pin_layers SELECT * FROM pin_layers_temp");
      await db.exec("DROP TABLE pin_layers_temp");
    } else {
      // Normal migration: rename legacy table to new name
      await db.exec("ALTER TABLE pin_groups RENAME TO pin_layers");
    }
  }

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
    CREATE INDEX IF NOT EXISTS idx_user_map_access_map_user ON user_map_access(map_id, user_id);

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
