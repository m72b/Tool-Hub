const path = require('path');
const fs = require('fs');
const net = require('net');
const { execFile } = require('child_process');

class SafeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SafeError';
  }
}

function fail(message) {
  throw new SafeError(message);
}

function normalizeAbsolute(input) {
  if (typeof input !== 'string' || input.length === 0) fail('Path is required');
  if (input.includes('\0')) fail('Path contains a null byte');
  const resolved = path.resolve(input);
  if (!path.isAbsolute(resolved)) fail('Path must be absolute');
  return resolved;
}

function realPath(input) {
  let current = normalizeAbsolute(input);
  const tail = [];
  while (true) {
    try {
      return path.join(fs.realpathSync.native(current), ...tail.reverse());
    } catch (err) {
      if (!err || (err.code !== 'ENOENT' && err.code !== 'ENOTDIR')) return path.resolve(current, ...tail.reverse());
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(current, ...tail.reverse());
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

function existingDir(input) {
  const resolved = normalizeAbsolute(input);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    fail('Folder does not exist');
  }
  if (!stat.isDirectory()) fail('Path is not a folder');
  return resolved;
}

function existingFile(input) {
  const resolved = normalizeAbsolute(input);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    fail('File does not exist');
  }
  if (stat.isDirectory()) fail('Path is a folder, not a file');
  return resolved;
}

function isInside(root, target) {
  const a = path.resolve(root);
  const b = path.resolve(target);
  if (a === b) return true;
  const rel = path.relative(a, b);
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function assertInside(roots, target) {
  const list = Array.isArray(roots) ? roots : [roots];
  const resolved = path.resolve(target);
  const real = realPath(resolved);
  const ok = list.some(root => {
    if (!root) return false;
    return isInside(realPath(root), real);
  });
  if (!ok) fail('Path is outside the permitted folder');
  return resolved;
}

function safeEntryName(name) {
  return typeof name === 'string'
    && name.length > 0
    && name !== '.'
    && name !== '..'
    && !/[\\/\0]/.test(name);
}

const HOST_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._:-]{0,251}[a-zA-Z0-9])?$/;

function validHost(input) {
  if (typeof input !== 'string') fail('Host is required');
  const host = input.trim();
  if (host.length === 0) fail('Host is required');
  if (host.length > 253) fail('Host is too long');
  if (net.isIP(host) === 6) return host;
  if (!HOST_PATTERN.test(host)) fail('Host contains invalid characters');
  return host;
}

function toInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  if (typeof min === 'number' && n < min) return min;
  if (typeof max === 'number' && n > max) return max;
  return n;
}

function toNumber(value, fallback, min, max) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (typeof min === 'number' && n < min) return min;
  if (typeof max === 'number' && n > max) return max;
  return n;
}

function run(command, args, options = {}) {
  if (typeof command !== 'string' || command.length === 0) fail('Command is required');
  if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) fail('Command arguments must be strings');
  const timeout = options.timeout || 20000;
  const maxBuffer = options.maxBuffer || 8 * 1024 * 1024;
  const env = options.env ? { ...process.env, ...options.env } : process.env;
  if (options.env) {
    for (const value of Object.values(options.env)) {
      if (typeof value !== 'string') fail('Environment values must be strings');
    }
  }
  return new Promise(resolve => {
    execFile(command, args, { timeout, maxBuffer, windowsHide: true, shell: false, env }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') {
        resolve({ ok: false, code: 'ENOENT', stdout: '', stderr: `${command} is not available on this system` });
        return;
      }
      resolve({
        ok: !err,
        code: err ? (err.code ?? 1) : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || (err ? err.message : '')),
      });
    });
  });
}

function powershell(script, options = {}) {
  if (typeof script !== 'string') fail('Script is required');
  return run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-Command', script,
  ], { timeout: options.timeout || 30000, maxBuffer: options.maxBuffer, env: options.env });
}

async function powershellJson(script, options = {}) {
  const wrapped = `$ProgressPreference='SilentlyContinue';$ErrorActionPreference='SilentlyContinue';${script}`;
  const res = await powershell(wrapped, options);
  if (!res.ok && !res.stdout.trim()) return { ok: false, error: res.stderr.trim() || 'PowerShell command failed', data: null };
  const text = res.stdout.trim();
  if (!text) return { ok: true, data: [], error: null };
  try {
    const parsed = JSON.parse(text);
    return { ok: true, data: Array.isArray(parsed) ? parsed : [parsed], error: null };
  } catch {
    return { ok: false, error: 'Could not parse PowerShell output', data: null };
  }
}

function parseCommandLine(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim();
  if (text.length === 0) return null;
  const parts = [];
  let current = '';
  let quoted = false;
  let started = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      quoted = !quoted;
      started = true;
      continue;
    }
    if (!quoted && (ch === ' ' || ch === '\t')) {
      if (started || current.length > 0) {
        parts.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }
  if (started || current.length > 0) parts.push(current);
  if (parts.length === 0) return null;
  return { command: parts[0], args: parts.slice(1) };
}

module.exports = {
  SafeError,
  fail,
  normalizeAbsolute,
  realPath,
  existingDir,
  existingFile,
  isInside,
  assertInside,
  safeEntryName,
  validHost,
  toInt,
  toNumber,
  run,
  powershell,
  powershellJson,
  parseCommandLine,
};
