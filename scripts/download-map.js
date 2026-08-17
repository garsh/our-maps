import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isSample = process.argv.includes('--sample');

const FULL_URL = 'https://build.protomaps.com/20260817.pmtiles';
const SAMPLE_URL = 'https://pmtiles.io/protomaps(vector)ODbL_firenze.pmtiles';

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

console.log(`Starting Protomaps dataset download (${isSample ? 'Sample ~20MB' : 'Full Planet 123.5GB'})...`);
console.log(`URL: ${downloadUrl}`);
console.log(`Target: ${targetPath}`);

function download(url, dest, callback) {
  const file = fs.createWriteStream(dest);
  https
    .get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        return download(response.headers.location, dest, callback);
      }

      if (response.statusCode !== 200) {
        console.error(`Download failed with HTTP status ${response.statusCode}`);
        file.close();
        fs.unlinkSync(dest);
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
      fs.unlink(dest, () => {});
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
}

download(downloadUrl, targetPath, () => {
  try {
    if (fs.existsSync(symlinkPath)) {
      fs.unlinkSync(symlinkPath);
    }
    fs.symlinkSync(targetPath, symlinkPath);
    console.log(`Symlink created at ${symlinkPath}`);
  } catch (err) {
    console.warn(`Could not create symlink (copying file reference instead): ${err.message}`);
  }
});
