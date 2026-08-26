import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const dataFontsDir = path.join(rootDir, 'data', 'fonts');
const serverMapsFontsDir = path.join(rootDir, 'server', 'public', 'maps', 'fonts');
const clientPublicMapsDir = path.join(rootDir, 'client', 'public', 'maps');
const serverPublicMapsDir = path.join(rootDir, 'server', 'public', 'maps');

if (!fs.existsSync(dataFontsDir)) {
  fs.mkdirSync(dataFontsDir, { recursive: true });
}
if (!fs.existsSync(serverPublicMapsDir)) {
  fs.mkdirSync(serverPublicMapsDir, { recursive: true });
}
if (!fs.existsSync(clientPublicMapsDir)) {
  fs.mkdirSync(clientPublicMapsDir, { recursive: true });
}
const clientMapsFontsDir = path.join(clientPublicMapsDir, 'fonts');

const isForce = process.argv.includes('--force');

const FONTSTACKS = [
  'Noto Sans Regular',
  'Noto Sans Medium',
  'Noto Sans Italic',
  'Noto Sans Devanagari Regular v1'
];

const BASE_URL = 'https://protomaps.github.io/basemaps-assets/fonts/';

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

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
    console.warn(`Could not update font symlink at ${linkPath}: ${err.message}`);
    return false;
  }
}

// Concurrency pool helper
async function pool(items, concurrency, fn) {
  const results = [];
  const executing = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    if (concurrency <= items.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(results);
}

async function setupFonts() {
  const tasks = [];

  for (const fontstack of FONTSTACKS) {
    const fontDir = path.join(dataFontsDir, fontstack);
    if (!fs.existsSync(fontDir)) {
      fs.mkdirSync(fontDir, { recursive: true });
    }

    for (let i = 0; i < 256; i++) {
      const start = i * 256;
      const end = start + 255;
      const filename = `${start}-${end}.pbf`;
      const dest = path.join(fontDir, filename);
      const url = `${BASE_URL}${encodeURIComponent(fontstack)}/${filename}`;
      const needsDownload = isForce || !fs.existsSync(dest) || fs.statSync(dest).size === 0;
      if (needsDownload) {
        tasks.push({ fontstack, filename, dest, url });
      }
    }
  }

  if (tasks.length > 0) {
    console.log(`Downloading ${tasks.length} font glyph files to ${dataFontsDir}...`);
    let completed = 0;
    let failed = 0;
    const startTime = Date.now();

    await pool(tasks, 24, async (task) => {
      try {
        await downloadFile(task.url, task.dest);
        completed++;
        if (completed % 100 === 0 || completed === tasks.length) {
          process.stdout.write(`\rProgress: ${completed}/${tasks.length} font glyph files downloaded (${Math.round((completed / tasks.length) * 100)}%)`);
        }
      } catch (err) {
        failed++;
        // Some rare unicode blocks may not exist for certain sub-fonts; non-fatal
      }
    });

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nFont download complete in ${durationSec}s. (${completed} downloaded, ${failed} skipped/404s).`);
  } else {
    console.log('All font glyph files already exist locally.');
  }

  // Create symlinks server/public/maps/fonts and client/public/maps/fonts -> data/fonts
  ensureSymlink(dataFontsDir, serverMapsFontsDir, tasks.length > 0);
  ensureSymlink(dataFontsDir, clientMapsFontsDir, tasks.length > 0);
}

setupFonts();
