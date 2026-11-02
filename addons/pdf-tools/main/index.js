// Main-process side of the PDF Tools add-on. Page-level PDF work happens in the renderer with pdf-lib
// and pdf.js; this module handles file I/O and the jobs that need native programs or Electron APIs.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const ooxml = require('./ooxml');
const { srgbProfile } = require('./icc');

const MAX_READ = 512 * 1024 * 1024;
const ADDON_ROOT = path.join(__dirname, '..');
const OFFICE_FORMATS = {
  word: ['doc', 'docx', 'rtf', 'odt', 'txt'],
  powerpoint: ['ppt', 'pptx', 'odp'],
  excel: ['xls', 'xlsx', 'ods', 'csv'],
};

let safe = null;
function lib(ctx) {
  if (!safe) safe = ctx.lib.safe;
  return safe;
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `toolhub-${prefix}-`));
}

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  throw new Error('File data is missing');
}

// ---------- engine detection ----------

let enginesCache = null;

function qpdfPath(ctx) {
  const bundled = path.join(ADDON_ROOT, 'vendor', 'qpdf', 'bin', ctx.platform === 'win32' ? 'qpdf.exe' : 'qpdf');
  return fs.existsSync(bundled) ? bundled : 'qpdf';
}

function sofficeCandidates(ctx) {
  if (ctx.platform === 'win32') {
    return [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map(dir => path.join(dir, 'LibreOffice', 'program', 'soffice.exe'));
  }
  if (ctx.platform === 'darwin') return ['/Applications/LibreOffice.app/Contents/MacOS/soffice'];
  return ['/usr/bin/soffice', '/usr/bin/libreoffice', '/usr/local/bin/soffice', '/snap/bin/libreoffice'];
}

async function engines(params, ctx) {
  if (enginesCache && !params.refresh) return enginesCache;
  const s = lib(ctx);
  const result = { word: false, excel: false, powerpoint: false, libreoffice: null, qpdf: false, ocr: [], ocrEngine: null, tesseract: false };
  if (ctx.platform === 'win32') {
    const probe = await s.powershellJson(
      "$r=@{};foreach($p in 'Word.Application','Excel.Application','PowerPoint.Application'){$r[$p]=[bool](Test-Path ('Registry::HKEY_CLASSES_ROOT\\'+$p+'\\CLSID'))};" +
      "$langs=@();try{$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime];$langs=@([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages|ForEach-Object{[PSCustomObject]@{tag=$_.LanguageTag;name=$_.DisplayName}})}catch{};" +
      "[PSCustomObject]@{word=$r['Word.Application'];excel=$r['Excel.Application'];powerpoint=$r['PowerPoint.Application'];ocr=$langs}|ConvertTo-Json -Compress -Depth 4",
      { timeout: 30000 }
    );
    const data = probe.ok && probe.data ? probe.data[0] : {};
    result.word = data.word === true;
    result.excel = data.excel === true;
    result.powerpoint = data.powerpoint === true;
    result.ocr = Array.isArray(data.ocr) ? data.ocr : (data.ocr ? [data.ocr] : []);
    if (result.ocr.length) result.ocrEngine = 'windows';
  }
  result.libreoffice = sofficeCandidates(ctx).find(file => fs.existsSync(file)) || null;
  if (!result.libreoffice) {
    const which = await s.run(ctx.platform === 'win32' ? 'where' : 'which', ['soffice'], { timeout: 5000 });
    if (which.ok && which.stdout.trim()) result.libreoffice = which.stdout.trim().split(/\r?\n/)[0];
  }
  const qpdf = await s.run(qpdfPath(ctx), ['--version'], { timeout: 10000 });
  result.qpdf = qpdf.ok;
  if (!result.ocrEngine) {
    const tess = await s.run('tesseract', ['--list-langs'], { timeout: 10000 });
    if (tess.ok) {
      result.tesseract = true;
      result.ocrEngine = 'tesseract';
      result.ocr = (tess.stdout + tess.stderr).split(/\r?\n/).slice(1).map(line => line.trim()).filter(line => /^[a-z_]+$/i.test(line)).map(tag => ({ tag, name: tag }));
    }
  }
  enginesCache = result;
  return result;
}

// ---------- file I/O ----------

async function readFile(params, ctx) {
  const s = lib(ctx);
  const file = s.existingFile(params.path);
  const stat = await fs.promises.stat(file);
  if (stat.size > MAX_READ) s.fail('This file is larger than 512 MB');
  return { path: file, name: path.basename(file), size: stat.size, bytes: await fs.promises.readFile(file) };
}

async function writeFile(params, ctx) {
  const s = lib(ctx);
  const output = s.normalizeAbsolute(params.output);
  const data = toBuffer(params.bytes);
  await fs.promises.mkdir(path.dirname(output), { recursive: true });
  await fs.promises.writeFile(output, data);
  return { output, size: data.length };
}

function uniqueName(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = name;
  for (let i = 2; fs.existsSync(path.join(dir, candidate)); i++) candidate = `${base} (${i})${ext}`;
  return candidate;
}

async function writeFiles(params, ctx) {
  const s = lib(ctx);
  const dir = s.existingDir(params.outputDir);
  const files = Array.isArray(params.files) ? params.files.slice(0, 5000) : [];
  if (!files.length) s.fail('Nothing to save');
  const written = [];
  for (const file of files) {
    const name = String(file.name || '').replace(/[\\/:*?"<>|]/g, '_').trim();
    if (!s.safeEntryName(name)) s.fail(`Invalid output name: ${file.name}`);
    const target = s.assertInside(dir, path.join(dir, uniqueName(dir, name)));
    await fs.promises.writeFile(target, toBuffer(file.bytes));
    written.push(target);
  }
  return { outputDir: dir, files: written };
}

// ---------- qpdf: protect, unlock, repair, optimize ----------

async function qpdf(params, ctx) {
  const s = lib(ctx);
  const input = s.existingFile(params.path);
  const output = s.normalizeAbsolute(params.output);
  if (path.resolve(input).toLowerCase() === path.resolve(output).toLowerCase()) s.fail('Choose a different output file than the input');
  const exe = qpdfPath(ctx);
  // Passwords go through an argument file so they never appear in the process list.
  const dir = tempDir('qpdf');
  const argFile = path.join(dir, 'args.txt');
  const lines = [];
  const op = params.operation;
  if (op === 'encrypt') {
    const user = String(params.userPassword || '');
    const owner = String(params.ownerPassword || '') || crypto.randomBytes(18).toString('base64');
    if (!user && !params.ownerPassword) s.fail('Enter a password');
    const allow = params.allow || {};
    lines.push('--encrypt', user, owner, '256', `--print=${allow.print === false ? 'none' : 'full'}`, `--extract=${allow.copy === false ? 'n' : 'y'}`, `--modify=${allow.modify === false ? 'none' : 'all'}`, `--annotate=${allow.annotate === false ? 'n' : 'y'}`, `--form=${allow.forms === false ? 'n' : 'y'}`, '--');
  } else if (op === 'decrypt') {
    if (params.password) lines.push(`--password=${params.password}`);
    lines.push('--decrypt');
  } else if (op === 'repair') {
    lines.push('--object-streams=generate');
  } else if (op === 'optimize') {
    lines.push('--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9');
  } else s.fail('Unknown qpdf operation');
  lines.push(input, output);
  fs.writeFileSync(argFile, lines.join('\n'), { mode: 0o600 });
  try {
    const res = await s.run(exe, [`@${argFile}`], { timeout: 300000 });
    // qpdf exit code 3 means "succeeded with warnings" (typical when repairing).
    if (!res.ok && res.code !== 3) {
      if (res.code === 'ENOENT') s.fail('qpdf is not available. Reinstall the PDF Tools add-on.');
      if (/invalid password/i.test(res.stderr)) s.fail('The password is incorrect');
      s.fail(res.stderr.trim().split(/\r?\n/).slice(-2).join(' ') || 'qpdf could not process this file');
    }
    if (!fs.existsSync(output)) s.fail('qpdf did not produce an output file');
    return { output, size: fs.statSync(output).size, warnings: res.code === 3 ? res.stderr.trim().split(/\r?\n/).slice(0, 20) : [] };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- Office conversions ----------

function kindFor(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return Object.keys(OFFICE_FORMATS).find(kind => OFFICE_FORMATS[kind].includes(ext)) || null;
}

async function libreConvert(ctx, soffice, input, format, filter) {
  const s = lib(ctx);
  const outDir = tempDir('lo');
  const profile = tempDir('lo-profile');
  try {
    const args = [`-env:UserInstallation=file:///${profile.replace(/\\/g, '/')}`, '--headless', '--norestore'];
    if (filter) args.push(`--infilter=${filter}`);
    args.push('--convert-to', format, '--outdir', outDir, input);
    const res = await s.run(soffice, args, { timeout: 300000 });
    const produced = fs.readdirSync(outDir)[0];
    if (!produced) s.fail(res.stderr.trim() || 'LibreOffice could not convert this file');
    return fs.readFileSync(path.join(outDir, produced));
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

const OFFICE_TO_PDF = {
  word: "$a=New-Object -ComObject Word.Application;$a.Visible=$false;$a.DisplayAlerts=0;try{$d=$a.Documents.Open($env:TH_IN,$false,$true,$false);$d.ExportAsFixedFormat($env:TH_OUT,17);$d.Close(0)}finally{$a.Quit()}",
  excel: "$a=New-Object -ComObject Excel.Application;$a.Visible=$false;$a.DisplayAlerts=$false;try{$d=$a.Workbooks.Open($env:TH_IN,0,$true);$d.ExportAsFixedFormat(0,$env:TH_OUT);$d.Close($false)}finally{$a.Quit()}",
  powerpoint: "$a=New-Object -ComObject PowerPoint.Application;try{$d=$a.Presentations.Open($env:TH_IN,-1,0,0);$d.SaveAs($env:TH_OUT,32);$d.Close()}finally{$a.Quit()}",
};

async function officeToPdf(params, ctx) {
  const s = lib(ctx);
  const input = s.existingFile(params.path);
  const output = s.normalizeAbsolute(params.output);
  const kind = kindFor(input);
  if (!kind) s.fail('Unsupported file type');
  const found = await engines({}, ctx);
  if (ctx.platform === 'win32' && found[kind]) {
    const res = await s.powershell(`$ErrorActionPreference='Stop';${OFFICE_TO_PDF[kind]}`, { env: { TH_IN: input, TH_OUT: output }, timeout: 300000 });
    if (!res.ok || !fs.existsSync(output)) s.fail(res.stderr.trim() || 'Microsoft Office could not convert this file');
    return { output, engine: 'Microsoft Office' };
  }
  if (found.libreoffice) {
    fs.writeFileSync(output, await libreConvert(ctx, found.libreoffice, input, 'pdf'));
    return { output, engine: 'LibreOffice' };
  }
  return { unavailable: true, kind };
}

async function pdfToOffice(params, ctx) {
  const s = lib(ctx);
  const input = s.existingFile(params.path);
  const output = s.normalizeAbsolute(params.output);
  const format = params.format;
  const found = await engines({}, ctx);
  if (format === 'docx' && ctx.platform === 'win32' && found.word) {
    const res = await s.powershell("$ErrorActionPreference='Stop';$a=New-Object -ComObject Word.Application;$a.Visible=$false;$a.DisplayAlerts=0;try{$d=$a.Documents.Open($env:TH_IN,$false,$false,$false);$d.SaveAs2($env:TH_OUT,16);$d.Close(0)}finally{$a.Quit()}", { env: { TH_IN: input, TH_OUT: output }, timeout: 300000 });
    if (res.ok && fs.existsSync(output)) return { output, engine: 'Microsoft Word' };
  }
  if (found.libreoffice && (format === 'docx' || format === 'pptx')) {
    const filter = format === 'docx' ? 'writer_pdf_import' : 'impress_pdf_import';
    const target = format === 'docx' ? 'docx:MS Word 2007 XML' : 'pptx:Impress MS PowerPoint 2007 XML';
    fs.writeFileSync(output, await libreConvert(ctx, found.libreoffice, input, target, filter));
    return { output, engine: 'LibreOffice' };
  }
  return { unavailable: true };
}

// Built-in writers (renderer extracts the content with pdf.js).
async function writeDocx(params, ctx) {
  const output = lib(ctx).normalizeAbsolute(params.output);
  fs.writeFileSync(output, ooxml.docx(params.blocks));
  return { output, engine: 'Tool Hub' };
}

async function writeXlsx(params, ctx) {
  const output = lib(ctx).normalizeAbsolute(params.output);
  fs.writeFileSync(output, ooxml.xlsx(params.sheets));
  return { output, engine: 'Tool Hub' };
}

async function writePptx(params, ctx) {
  const output = lib(ctx).normalizeAbsolute(params.output);
  const slides = (params.slides || []).map(slide => ({ image: toBuffer(slide.image) }));
  if (!slides.length) lib(ctx).fail('No pages to convert');
  fs.writeFileSync(output, ooxml.pptx(slides, Number(params.width) || 720, Number(params.height) || 540));
  return { output, engine: 'Tool Hub' };
}

// ---------- OCR ----------

const WINDOWS_OCR = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]
$null=[Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'})[0]
function Await($op,$type){$t=$asTask.MakeGenericMethod($type).Invoke($null,@($op));$t.Wait(-1)|Out-Null;$t.Result}
$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language $env:TH_LANG))
if(-not $engine){throw 'This OCR language is not installed in Windows'}
$pages=@()
foreach($img in (Get-Content -LiteralPath $env:TH_LIST -Encoding UTF8 | Where-Object { $_ })){
  $file=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($img)) ([Windows.Storage.StorageFile])
  $stream=Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap=Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result=Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $words=@(); $line=0
  foreach($l in $result.Lines){ foreach($w in $l.Words){ $r=$w.BoundingRect; $words+=[PSCustomObject]@{t=$w.Text;x=$r.X;y=$r.Y;w=$r.Width;h=$r.Height;l=$line} }; $line++ }
  $stream.Dispose()
  $pages+=,[PSCustomObject]@{words=$words}
}
ConvertTo-Json -InputObject @($pages) -Compress -Depth 5
`;

async function ocr(params, ctx) {
  const s = lib(ctx);
  const images = Array.isArray(params.images) ? params.images : [];
  if (!images.length) s.fail('No pages to read');
  const found = await engines({}, ctx);
  if (!found.ocrEngine) s.fail(ctx.platform === 'win32' ? 'Windows OCR is not available on this PC' : 'Install Tesseract OCR to use this tool');
  const dir = tempDir('ocr');
  try {
    const files = images.map((bytes, i) => {
      const file = path.join(dir, `page-${i + 1}.png`);
      fs.writeFileSync(file, toBuffer(bytes));
      return file;
    });
    if (found.ocrEngine === 'windows') {
      const list = path.join(dir, 'list.txt');
      fs.writeFileSync(list, files.join('\n'), 'utf8');
      const res = await s.powershell(`$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';${WINDOWS_OCR}`, { env: { TH_LIST: list, TH_LANG: String(params.language || found.ocr[0]?.tag || 'en-US') }, timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
      if (!res.ok) s.fail(res.stderr.trim().split(/\r?\n/)[0] || 'Windows OCR failed');
      const parsed = JSON.parse(res.stdout.trim() || '[]');
      return { pages: (Array.isArray(parsed) ? parsed : [parsed]).map(page => ({ words: Array.isArray(page?.words) ? page.words : (page?.words ? [page.words] : []) })) };
    }
    const pages = [];
    for (const file of files) {
      const res = await s.run('tesseract', [file, 'stdout', '-l', String(params.language || 'eng'), 'tsv'], { timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
      if (!res.ok) s.fail(res.stderr.trim() || 'Tesseract failed');
      const words = res.stdout.split(/\r?\n/).slice(1).map(row => row.split('\t')).filter(c => c.length >= 12 && c[0] === '5' && c[11].trim())
        .map(c => ({ t: c[11], x: +c[6], y: +c[7], w: +c[8], h: +c[9], l: Number(`${c[2]}${c[3]}${c[4]}`) }));
      pages.push({ words });
    }
    return { pages };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- HTML to PDF (Electron's own renderer) ----------

const PAGE_SIZES = ['A4', 'A3', 'A5', 'Letter', 'Legal', 'Tabloid'];

async function htmlToPdf(params, ctx) {
  const s = lib(ctx);
  const output = s.normalizeAbsolute(params.output);
  let url;
  if (params.path) url = require('url').pathToFileURL(s.existingFile(params.path)).toString();
  else {
    const raw = String(params.url || '').trim();
    const withScheme = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
    let parsed;
    try { parsed = new URL(withScheme); } catch { s.fail('Enter a valid web address'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) s.fail('Only http and https addresses can be converted');
    url = parsed.toString();
  }
  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: params.javascript !== false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-download', event => event.preventDefault());
  try {
    await Promise.race([
      win.loadURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('The page took too long to load')), 60000)),
    ]);
    await new Promise(resolve => setTimeout(resolve, Math.min(10000, Math.max(0, Number(params.delayMs) || 1500))));
    const margin = { none: 0, small: 0.4, normal: 0.75 }[params.margin] ?? 0.4;
    const pdf = await win.webContents.printToPDF({
      pageSize: PAGE_SIZES.includes(params.pageSize) ? params.pageSize : 'A4',
      landscape: params.landscape === true,
      printBackground: params.background !== false,
      margins: { top: margin, bottom: margin, left: margin, right: margin },
    });
    fs.writeFileSync(output, pdf);
    return { output, size: pdf.length, title: win.webContents.getTitle() };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function iccProfile() {
  return { bytes: srgbProfile() };
}

// A Unicode font installed with the OS, used for OCR text that the 14 standard PDF fonts cannot encode.
async function systemFont(params, ctx) {
  const fontsDir = ctx.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'Fonts') : null;
  const candidates = ctx.platform === 'win32'
    ? ['arial.ttf', 'segoeui.ttf', 'tahoma.ttf'].map(name => path.join(fontsDir, name))
    : ['/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '/Library/Fonts/Arial Unicode.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf', '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf'];
  const file = candidates.find(candidate => fs.existsSync(candidate));
  if (!file) return { bytes: null };
  return { name: path.basename(file), bytes: fs.readFileSync(file) };
}

module.exports = {
  id: 'pdf',
  actions: { engines, readFile, writeFile, writeFiles, qpdf, officeToPdf, pdfToOffice, writeDocx, writeXlsx, writePptx, ocr, htmlToPdf, iccProfile, systemFont },
  OFFICE_FORMATS,
};
