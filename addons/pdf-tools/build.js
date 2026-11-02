// Build step for the PDF Tools add-on, run by scripts/build-addon.js before packing.
// Copies pdf.js and fontkit from node_modules and adds a pinned, checksum-verified qpdf for Windows.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { execFileSync } = require('child_process');

const QPDF = {
  version: '11.9.1',
  url: 'https://github.com/qpdf/qpdf/releases/download/v11.9.1/qpdf-11.9.1-msvc64.zip',
  sha256: 'b5061e09aa45b63a36200c130b4cce15dc322338ea91f698760c3b8732fc41ef',
};

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name), dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst); else fs.copyFileSync(src, dst);
  }
}

function download(url, file, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'toolhub-addon-build' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) { res.resume(); resolve(download(res.headers.location, file, redirects - 1)); return; }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`Download failed (${res.statusCode}): ${url}`)); return; }
      const out = fs.createWriteStream(file);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    }).on('error', reject);
  });
}

async function qpdfZip(cacheDir) {
  const zip = path.join(cacheDir, `qpdf-${QPDF.version}-msvc64.zip`);
  const valid = () => fs.existsSync(zip) && crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex') === QPDF.sha256;
  if (!valid()) {
    console.log(`Downloading qpdf ${QPDF.version}…`);
    fs.mkdirSync(cacheDir, { recursive: true });
    await download(QPDF.url, zip);
    if (!valid()) { fs.rmSync(zip, { force: true }); throw new Error('qpdf download failed its checksum — refusing to bundle it'); }
  }
  return zip;
}

function unzip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:TH_ZIP -DestinationPath $env:TH_DEST -Force'], { env: { ...process.env, TH_ZIP: zip, TH_DEST: dest }, stdio: 'inherit' });
  } else {
    execFileSync('unzip', ['-q', '-o', zip, '-d', dest], { stdio: 'inherit' });
  }
}

module.exports = async function prepare({ stageDir, repoRoot }) {
  const modules = path.join(repoRoot, 'node_modules');
  const pdfjs = path.join(modules, 'pdfjs-dist');
  if (!fs.existsSync(pdfjs)) throw new Error('Run "npm install" first (pdfjs-dist is missing)');
  const vendor = path.join(stageDir, 'vendor');
  fs.mkdirSync(path.join(vendor, 'pdfjs'), { recursive: true });
  for (const file of ['pdf.min.js', 'pdf.worker.min.js']) fs.copyFileSync(path.join(pdfjs, 'build', file), path.join(vendor, 'pdfjs', file));
  copyDir(path.join(pdfjs, 'cmaps'), path.join(vendor, 'pdfjs', 'cmaps'));
  copyDir(path.join(pdfjs, 'standard_fonts'), path.join(vendor, 'pdfjs', 'standard_fonts'));
  fs.copyFileSync(path.join(pdfjs, 'LICENSE'), path.join(stageDir, 'licenses', 'pdfjs-LICENSE.txt'));
  fs.copyFileSync(path.join(modules, '@pdf-lib', 'fontkit', 'dist', 'fontkit.umd.min.js'), path.join(vendor, 'fontkit.umd.min.js'));

  // qpdf (Apache-2.0) powers Protect, Unlock and Repair. Only the Windows build is bundled;
  // on macOS and Linux the add-on uses a qpdf installed with the system package manager.
  const cache = path.join(modules, '.cache', 'toolhub-addons');
  const extracted = path.join(cache, `qpdf-${QPDF.version}`);
  if (!fs.existsSync(path.join(extracted, `qpdf-${QPDF.version}-msvc64`, 'bin', 'qpdf.exe'))) unzip(await qpdfZip(cache), extracted);
  const bin = path.join(extracted, `qpdf-${QPDF.version}-msvc64`, 'bin');
  const target = path.join(vendor, 'qpdf', 'bin');
  fs.mkdirSync(target, { recursive: true });
  for (const file of fs.readdirSync(bin)) if (/^(qpdf\.exe|qpdf\d+\.dll|msvcp140.*\.dll|vcruntime140.*\.dll|concrt140\.dll)$/i.test(file)) fs.copyFileSync(path.join(bin, file), path.join(target, file));
};
