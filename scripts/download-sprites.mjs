import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const dataSpritesDir = path.join(rootDir, 'data', 'sprites');
const serverMapsSpritesDir = path.join(rootDir, 'server', 'public', 'maps', 'sprites');

if (!fs.existsSync(dataSpritesDir)) {
  fs.mkdirSync(dataSpritesDir, { recursive: true });
}
const serverPublicMapsDir = path.join(rootDir, 'server', 'public', 'maps');
const clientPublicMapsDir = path.join(rootDir, 'client', 'public', 'maps');
if (!fs.existsSync(serverPublicMapsDir)) {
  fs.mkdirSync(serverPublicMapsDir, { recursive: true });
}
if (!fs.existsSync(clientPublicMapsDir)) {
  fs.mkdirSync(clientPublicMapsDir, { recursive: true });
}
const clientMapsSpritesDir = path.join(clientPublicMapsDir, 'sprites');

const isForce = process.argv.includes('--force');

const FLAVORS = ['light', 'dark'];

const SPRITE_FILES = FLAVORS.flatMap(flavor => [
  `${flavor}.json`,
  `${flavor}.png`,
  `${flavor}@2x.json`,
  `${flavor}@2x.png`
]);

const BASE_URL = 'https://protomaps.github.io/basemaps-assets/sprites/v4/';

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return reject(new Error(`HTTP status ${response.statusCode}`));
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve());
      });
    }).on('error', (err) => {
      try { fs.unlinkSync(dest); } catch {}
      reject(err);
    });
  });
}

function ensureSymlink(targetDir, linkPath, verbose = true) {
  try {
    try {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(linkPath);
      } else if (stat.isDirectory() && fs.readdirSync(linkPath).length === 0) {
        fs.rmdirSync(linkPath);
      }
    } catch (e) {
      // Entry does not exist
    }

    const relativeTarget = path.relative(path.dirname(linkPath), targetDir);
    fs.symlinkSync(relativeTarget, linkPath);
    if (verbose) {
      console.log(`Relative symlink verified at ${linkPath} -> ${relativeTarget}`);
    }
    return true;
  } catch (err) {
    console.warn(`Could not update sprite symlink at ${linkPath}: ${err.message}`);
    return false;
  }
}

async function setupSprites() {
  const missingFiles = SPRITE_FILES.filter(f => !fs.existsSync(path.join(dataSpritesDir, f)) || fs.statSync(path.join(dataSpritesDir, f)).size === 0);
  const alreadyExisted = missingFiles.length === 0 && !isForce;

  if (!alreadyExisted) {
    console.log(`Downloading Protomaps sprite assets to ${dataSpritesDir}...`);
    for (const file of SPRITE_FILES) {
      const url = `${BASE_URL}${file}`;
      const dest = path.join(dataSpritesDir, file);
      if (!fs.existsSync(dest) || fs.statSync(dest).size === 0 || isForce) {
        console.log(`Downloading ${file}...`);
        try {
          await downloadFile(url, dest);
        } catch (err) {
          console.error(`Failed to download ${file}: ${err.message}`);
        }
      }
    }
    console.log('Sprite download complete.');
  }

  // Create symlinks server/public/maps/sprites and client/public/maps/sprites -> data/sprites
  const serverOk = ensureSymlink(dataSpritesDir, serverMapsSpritesDir, !alreadyExisted);
  const clientOk = ensureSymlink(dataSpritesDir, clientMapsSpritesDir, !alreadyExisted);

  if (alreadyExisted && serverOk && clientOk) {
    console.log('Sprites already exist and are symlinked correctly.');
  }
}

setupSprites();
