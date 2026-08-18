import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isSample = process.argv.includes('--sample');

const FULL_URL = 'https://build.protomaps.com/20260817.pmtiles';
const SAMPLE_URL = 'https://build.protomaps.com/20260817.pmtiles';

const downloadUrl = isSample ? SAMPLE_URL : FULL_URL;

const rootDir = path.resolve(__dirname, '..');
const dataMapsDir = path.join(rootDir, 'data', 'maps');
const serverMapsDir = path.join(rootDir, 'server', 'public', 'maps');

const targetPath = path.join(dataMapsDir, 'planet.pmtiles');
const symlinkPath = path.join(serverMapsDir, 'planet.pmtiles');

if (!fs.existsSync(dataMapsDir)) {
  fs.mkdirSync(dataMapsDir, { recursive: true });
}
if (!fs.existsSync(serverMapsDir)) {
  fs.mkdirSync(serverMapsDir, { recursive: true });
}

const isForce = process.argv.includes('--force');

if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0 && !isForce) {
  console.log(`Map dataset already exists at ${targetPath} (${(fs.statSync(targetPath).size / (1024 * 1024 * 1024)).toFixed(2)} GB).`);
  console.log(`Preserving existing map dataset. (Pass --force if you intentionally wish to overwrite).`);
  
  try {
    if (fs.existsSync(symlinkPath)) {
      fs.unlinkSync(symlinkPath);
    }
    const relativeTarget = path.relative(serverMapsDir, targetPath);
    fs.symlinkSync(relativeTarget, symlinkPath);
    console.log(`Relative symlink verified at ${symlinkPath} -> ${relativeTarget}`);
  } catch (err) {
    console.warn(`Could not update symlink: ${err.message}`);
  }
  process.exit(0);
}

console.log(`Starting Protomaps dataset download (${isSample ? 'Sample ~20MB' : 'Full Planet 123.5GB'})...`);
console.log(`URL: ${downloadUrl}`);
console.log(`Target: ${targetPath}`);

function download(url, dest, callback) {
  const file = fs.createWriteStream(dest);
  https
    .get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return download(response.headers.location, dest, callback);
      }

      if (response.statusCode !== 200) {
        console.error(`Download failed with HTTP status ${response.statusCode}`);
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        process.exit(1);
      }

      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let downloaded = 0;
      let lastPrinted = 0;

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        const now = Date.now();
        if (now - lastPrinted > 2000) {
          const mb = (downloaded / (1024 * 1024)).toFixed(1);
          const totalMb = totalSize ? (totalSize / (1024 * 1024)).toFixed(1) : '?';
          console.log(`Downloaded ${mb} MB / ${totalMb} MB...`);
          lastPrinted = now;
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close(() => {
          console.log('Download complete!');
          callback();
        });
      });
    })
    .on('error', (err) => {
      try { fs.unlinkSync(dest); } catch {}
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
}

download(downloadUrl, targetPath, () => {
  try {
    if (fs.existsSync(symlinkPath)) {
      fs.unlinkSync(symlinkPath);
    }
    const relativeTarget = path.relative(serverMapsDir, targetPath);
    fs.symlinkSync(relativeTarget, symlinkPath);
    console.log(`Relative symlink created at ${symlinkPath} -> ${relativeTarget}`);
  } catch (err) {
    console.warn(`Could not create symlink (copying file reference instead): ${err.message}`);
  }
});
