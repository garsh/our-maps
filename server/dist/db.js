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
    if (!columnNames.includes('image_url')) {
        await db.exec("ALTER TABLE pins ADD COLUMN image_url TEXT");
    }
    if (!columnNames.includes('color')) {
        await db.exec("ALTER TABLE pins ADD COLUMN color TEXT DEFAULT 'blue'");
    }
    if (!columnNames.includes('icon')) {
        await db.exec("ALTER TABLE pins ADD COLUMN icon TEXT DEFAULT 'default'");
    }
}
async function getDb() {
    if (db)
        return db;
    db = await (0, sqlite_1.open)({
        filename: path_1.default.join(__dirname, currentDbName),
        driver: sqlite3_1.default.Database
    });
    await db.exec(`
    CREATE TABLE IF NOT EXISTS maps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pins (
      id TEXT PRIMARY KEY,
      map_id TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      label TEXT,
      description TEXT,
      image_url TEXT,
      color TEXT DEFAULT 'blue',
      icon TEXT DEFAULT 'default',
      FOREIGN KEY (map_id) REFERENCES maps(id) ON DELETE CASCADE
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
