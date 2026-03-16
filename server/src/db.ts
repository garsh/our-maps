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
  if (!columnNames.includes('image_url')) {
    await db.exec("ALTER TABLE pins ADD COLUMN image_url TEXT");
  }
  if (!columnNames.includes('color')) {
    await db.exec("ALTER TABLE pins ADD COLUMN color TEXT DEFAULT 'blue'");
  }
  if (!columnNames.includes('icon')) {
    await db.exec("ALTER TABLE pins ADD COLUMN icon TEXT DEFAULT 'default'");
  }
  if (!columnNames.includes('group_id')) {
    await db.exec("ALTER TABLE pins ADD COLUMN group_id TEXT");
  }
  if (!columnNames.includes('position')) {
    await db.exec("ALTER TABLE pins ADD COLUMN position INTEGER DEFAULT 0");
  }
}

export async function getDb() {
  if (db) return db;

  db = await open({
    filename: path.join(__dirname, currentDbName),
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS maps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pin_groups (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pins (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL,
      group_id TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      label TEXT,
      description TEXT,
      image_url TEXT,
      color TEXT DEFAULT 'blue',
      icon TEXT DEFAULT 'default',
      position INTEGER DEFAULT 0,
      FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES pin_groups(id) ON DELETE SET NULL
    );
  `);

  await migrate(db);

  return db;
}

export async function closeDb() {
  if (db) {
    await db.close();
    db = null;
  }
}
