const dns = require('dns').promises;
const os = require('os');
const safe = require('../core/safe');

function buildPingArgs(platform, host, count) {
  const n = String(count);
  if (platform === 'win32') return ['-n', n, '-w', '4000', host];
  if (platform === 'darwin') return ['-c', n, '-t', '10', host];
  return ['-c', n, '-w', '10', host];
}

function buildTraceArgs(platform, host, maxHops) {
  const h = String(maxHops);
  if (platform === 'win32') return ['-h', h, '-w', '3000', '-d', host];
  return ['-m', h, '-q', '1', '-w', '3', host];
}

function parsePing(output) {
  const times = [];
  const re = /[=<]\s*([\d.]+)\s*ms/gi;
  let m;
  while ((m = re.exec(output)) !== null) times.push(Number(m[1]));
  const lossMatch = output.match(/([\d.]+)%\s*(?:packet\s*)?loss/i) || output.match(/\(\s*([\d.]+)%\s*(?:loss|perdidos)/i);
  const summary = times.length > 0
    ? {
        received: times.length,
        min: Math.min(...times),
        max: Math.max(...times),
        avg: Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10,
      }
    : null;
  return { times, summary, loss: lossMatch ? Number(lossMatch[1]) : null };
}

async function ping(params, ctx) {
  const host = safe.validHost(params.host);
  const count = safe.toInt(params.count, 4, 1, 10);
  const args = buildPingArgs(ctx.platform, host, count);
  const res = await safe.run('ping', args, { timeout: 30000 });
  const parsed = parsePing(res.stdout || res.stderr);
  return {
    host,
    ok: res.ok,
    output: (res.stdout || res.stderr).trim().slice(0, 8000),
    ...parsed,
  };
}

async function lookup(params) {
  const host = safe.validHost(params.host);
  const types = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME'];
  const records = {};
  const errors = {};
  await Promise.all(types.map(async type => {
    try { records[type] = await dns.resolve(host, type); }
    catch (err) { errors[type] = err.code || err.message; records[type] = []; }
  }));
  let reverse = [];
  try {
    const first = records.A[0];
    if (first) reverse = await dns.reverse(first);
  } catch {
    reverse = [];
  }
  return { host, records, errors, reverse };
}

async function traceroute(params, ctx) {
  const host = safe.validHost(params.host);
  const maxHops = safe.toInt(params.maxHops, 20, 1, 40);
  const command = ctx.platform === 'win32' ? 'tracert' : 'traceroute';
  const args = buildTraceArgs(ctx.platform, host, maxHops);
  const res = await safe.run(command, args, { timeout: 90000 });
  const hops = (res.stdout || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^\s*\d+/.test(line))
    .slice(0, 40);
  return {
    host,
    ok: res.ok || hops.length > 0,
    hops,
    output: (res.stdout || res.stderr).trim().slice(0, 12000),
    available: res.code !== 'ENOENT',
  };
}

async function ipinfo() {
  const interfaces = os.networkInterfaces();
  const list = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs || []) {
      list.push({
        name,
        address: addr.address,
        family: typeof addr.family === 'number' ? `IPv${addr.family}` : addr.family,
        mac: addr.mac,
        internal: addr.internal,
        cidr: addr.cidr,
      });
    }
  }
  let servers = [];
  try {
    servers = dns.getServers();
  } catch {
    servers = [];
  }
  return { interfaces: list, dnsServers: servers, hostname: os.hostname() };
}

module.exports = {
  id: 'network',
  actions: { ping, lookup, traceroute, ipinfo },
  buildPingArgs,
  buildTraceArgs,
  parsePing,
};
