const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function check() {
  const db = await open({
    filename: './database.sqlite',
    driver: sqlite3.Database
  });

  console.log('--- USERS ---');
  const users = await db.all('SELECT * FROM users');
  console.log(users);

  console.log('--- MAPS ---');
  const maps = await db.all('SELECT * FROM maps');
  console.log(maps);

  await db.close();
}

check().catch(console.error);
