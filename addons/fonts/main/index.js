// Font Manager. New fonts go to the current user's fonts, which needs no administrator rights.
// Fonts that came with the system are read-only here, because removing one can break apps.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseFont, findDuplicates } = require('./sfnt');

const EXTENSIONS = new Set(['.ttf', '.otf', '.ttc', '.otc']);
const MAX_FONT_BYTES = 128 * 1048576;
const cache = new Map();

function fontDirs(platform) {
  const home = os.homedir();
  if (platform === 'win32') {
    return { system: [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts')], user: path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Microsoft', 'Windows', 'Fonts') };
  }
  if (platform === 'darwin') return { system: ['/System/Library/Fonts', '/Library/Fonts'], user: path.join(home, 'Library', 'Fonts') };
  return { system: ['/usr/share/fonts', '/usr/local/share/fonts'], user: path.join(home, '.local', 'share', 'fonts') };
}

function collect(dir, out, depth = 0) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && depth < 6) collect(full, out, depth + 1);
    else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
}

function readFont(file, scope) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_FONT_BYTES) return null;
    const key = `${file}|${stat.size}|${stat.mtimeMs}`;
    if (!cache.has(key)) cache.set(key, parseFont(fs.readFileSync(file)));
    const faces = cache.get(key);
    return faces.length ? { path: file, file: path.basename(file), size: stat.size, scope, faces } : null;
  } catch {
    return null;
  }
}

async function scan(platform) {
  const dirs = fontDirs(platform);
  const found = [];
  const groups = [...dirs.system.map(dir => [dir, 'system']), [dirs.user, 'user']];
  for (const [dir, scope] of groups) {
    const files = [];
    collect(dir, files);
    for (let i = 0; i < files.length; i++) {
      const font = readFont(files[i], scope);
      if (font) found.push(font);
      if (i % 25 === 0) await new Promise(resolve => setImmediate(resolve));
    }
  }
  return found;
}

const inside = (file, dir) => path.resolve(file).toLowerCase().startsWith(path.resolve(dir).toLowerCase() + path.sep);

// Only files in font folders can be read or removed through these actions.
function checkFont(file, platform) {
  const dirs = fontDirs(platform);
  const known = typeof file === 'string' && EXTENSIONS.has(path.extname(file).toLowerCase()) && [...dirs.system, dirs.user].some(dir => inside(file, dir));
  if (!known) throw new Error('That file is not in a font folder');
  return path.resolve(file);
}

const WIN_API = `Add-Type -Namespace ToolHub -Name Fonts -MemberDefinition '[DllImport("gdi32.dll",CharSet=CharSet.Unicode)] public static extern int AddFontResourceW(string f); [DllImport("gdi32.dll",CharSet=CharSet.Unicode)] public static extern bool RemoveFontResourceW(string f); [DllImport("user32.dll")] public static extern System.IntPtr SendMessageTimeoutW(System.IntPtr h,uint m,System.IntPtr w,System.IntPtr l,uint f,uint t,out System.IntPtr r);';
function Notify { $r=[System.IntPtr]::Zero; [void][ToolHub.Fonts]::SendMessageTimeoutW([System.IntPtr]0xffff,0x1D,[System.IntPtr]::Zero,[System.IntPtr]::Zero,2,1000,[ref]$r) }
$key='HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts';`;

const WIN_INSTALL = `$ErrorActionPreference='Stop';${WIN_API}
if(-not (Test-Path $key)){[void](New-Item -Path $key -Force)}
[void](New-ItemProperty -Path $key -Name $env:TH_NAME -Value $env:TH_FILE -PropertyType String -Force);
[void][ToolHub.Fonts]::AddFontResourceW($env:TH_FILE); Notify`;

const WIN_UNINSTALL = `$ErrorActionPreference='Stop';${WIN_API}
[void][ToolHub.Fonts]::RemoveFontResourceW($env:TH_FILE);
$values=Get-ItemProperty -Path $key -ErrorAction SilentlyContinue;
if($values){foreach($p in $values.PSObject.Properties){if($p.Value -is [string] -and $p.Value -ieq $env:TH_FILE){Remove-ItemProperty -Path $key -Name $p.Name}}}
Notify`;

async function refreshSystem(ctx) {
  if (ctx.platform === 'linux') await ctx.lib.safe.run('fc-cache', ['-f'], { timeout: 60000 });
}

function freeName(dir, name, buffer) {
  const { name: stem, ext } = path.parse(name);
  for (let i = 0; i < 1000; i++) {
    const candidate = path.join(dir, i ? `${stem}-${i}${ext}` : name);
    if (!fs.existsSync(candidate)) return candidate;
    if (fs.readFileSync(candidate).equals(buffer)) return candidate;
  }
  throw new Error(`Could not find a free name for ${name}`);
}

async function installOne(source, ctx) {
  const { safe } = ctx.lib;
  if (!EXTENSIONS.has(path.extname(source).toLowerCase())) safe.fail(`${path.basename(source)} is not a TTF, OTF or TTC font`);
  const buffer = fs.readFileSync(source);
  const faces = parseFont(buffer);
  if (!faces.length) safe.fail(`${path.basename(source)} is not a valid font`);
  const { user } = fontDirs(ctx.platform);
  fs.mkdirSync(user, { recursive: true });
  const target = freeName(user, path.basename(source), buffer);
  fs.writeFileSync(target, buffer);
  if (ctx.platform === 'win32') {
    const label = `${faces[0].fullName || faces[0].family} (${faces[0].outlines === 'TrueType' ? 'TrueType' : 'OpenType'})`;
    const res = await safe.powershell(WIN_INSTALL, { timeout: 30000, env: { TH_NAME: label, TH_FILE: target } });
    if (!res.ok) { fs.rmSync(target, { force: true }); safe.fail(`Windows could not install ${path.basename(source)}: ${res.stderr.trim().slice(0, 200)}`); }
  }
  return { file: target, name: faces[0].fullName || faces[0].family };
}

const actions = {
  async list(params, ctx) {
    return { fonts: await scan(ctx.platform) };
  },

  async read(params, ctx) {
    const file = checkFont(params.font, ctx.platform);
    return { data: fs.readFileSync(file).toString('base64') };
  },

  async install(params, ctx) {
    const list = Array.isArray(params.paths) ? params.paths : [];
    if (!list.length) ctx.lib.safe.fail('Choose at least one font');
    const installed = [];
    const failed = [];
    for (const source of list) {
      try { installed.push(await installOne(source, ctx)); }
      catch (err) { failed.push({ file: path.basename(source), error: err.message }); }
    }
    await refreshSystem(ctx);
    return { installed, failed };
  },

  async uninstall(params, ctx) {
    const { safe } = ctx.lib;
    const file = checkFont(params.font, ctx.platform);
    if (!inside(file, fontDirs(ctx.platform).user)) safe.fail('Fonts that came with the system cannot be removed here');
    if (ctx.platform === 'win32') {
      const res = await safe.powershell(WIN_UNINSTALL, { timeout: 30000, env: { TH_FILE: file } });
      if (!res.ok) safe.fail(`Windows could not remove this font: ${res.stderr.trim().slice(0, 200)}`);
    }
    try { await ctx.trash(file); }
    catch { safe.fail('This font is in use. Close the apps using it, then try again.'); }
    await refreshSystem(ctx);
    return { removed: true };
  },

  async duplicates(params, ctx) {
    const fonts = await scan(ctx.platform);
    const hash = font => crypto.createHash('sha256').update(fs.readFileSync(font.path)).digest('hex');
    return findDuplicates(fonts, hash);
  },
};

module.exports = { id: 'font-manager', actions };
