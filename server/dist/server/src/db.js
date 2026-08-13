"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setDbName = setDbName;
exports.getDb = getDb;
exports.closeDb = closeDb;
const sqlite3_1 = __importDefault(require("sqlite3"));
const sqlite_1 = require("sqlite");
const path_1 = __importDefault(require("path"));
let db = null;
let currentDbName = '../database.sqlite';
function setDbName(name) {
    currentDbName = name;
    db = null; // Reset current connection
}
async function migrate(db) {
    const tableInfo = await db.all("PRAGMA table_info(pins)");
    const columnNames = tableInfo.map((col) => col.name);
    if (!columnNames.includes('description')) {
        await db.exec("ALTER TABLE pins ADD COLUMN description TEXT");
    }
    if (!columnNames.includes('address')) {
        await db.exec("ALTER TABLE pins ADD COLUMN address TEXT");
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
    if (columnNames.includes('group_id')) {
        await db.exec("ALTER TABLE pins RENAME COLUMN group_id TO layer_id");
    }
    else if (!columnNames.includes('layer_id')) {
        await db.exec("ALTER TABLE pins ADD COLUMN layer_id TEXT");
    }
    if (!columnNames.includes('position')) {
        await db.exec("ALTER TABLE pins ADD COLUMN position INTEGER DEFAULT 0");
    }
    const mapTableInfo = await db.all("PRAGMA table_info(maps)");
    const mapColumnNames = mapTableInfo.map((col) => col.name);
    if (!mapColumnNames.includes('owner_id')) {
        await db.exec("ALTER TABLE maps ADD COLUMN owner_id TEXT");
    }
}
async function getDb() {
    if (db)
        return db;
    const dbPath = process.env.DB_PATH || path_1.default.join(__dirname, currentDbName);
    db = await (0, sqlite_1.open)({
        filename: dbPath,
        driver: sqlite3_1.default.Database
    });
    // Enable foreign keys
    await db.run('PRAGMA foreign_keys = ON;');
    await db.exec('PRAGMA busy_timeout = 5000');
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = tables.map((t) => t.name);
    if (tableNames.includes('pin_groups')) {
        if (tableNames.includes('pin_layers')) {
            // Split-brain recovery: If both tables exist due to a previous crash, merge them
            await db.run('PRAGMA foreign_keys = OFF;');
            await db.exec("ALTER TABLE pin_layers RENAME TO pin_layers_temp");
            await db.run('PRAGMA foreign_keys = ON;');
            await db.exec("ALTER TABLE pin_groups RENAME TO pin_layers");
            await db.exec("INSERT OR IGNORE INTO pin_layers SELECT * FROM pin_layers_temp");
            await db.exec("DROP TABLE pin_layers_temp");
        }
        else {
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
      image_url TEXT,
      color TEXT DEFAULT 'blue',
      icon TEXT DEFAULT 'default',
      position INTEGER DEFAULT 0,
      FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE,
      FOREIGN KEY (layer_id) REFERENCES pin_layers(id) ON DELETE SET NULL
    );
  `);
    await migrate(db);
    return db;
}
async function closeDb() {
    if (db) {
        await db.close();
        db = null;
    }
}
