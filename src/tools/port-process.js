const safe = require('../core/safe');

async function windowsProcesses() {
  const res = await safe.run('netstat.exe', ['-ano', '-p', 'tcp']);
  if (!res.ok) safe.fail(res.stderr.trim() || 'Could not read listening ports');
  const rows = [];
  const seen = new Set();
  for (const line of res.stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^TCP\s+(\S+)\s+(\S+)\s+LISTENING\s+(\d+)$/i);
    if (!match) continue;
    const local = match[1];
    const colon = local.lastIndexOf(':');
    const port = Number(local.slice(colon + 1));
    const pid = Number(match[3]);
    const key = `${local}:${pid}`;
    if (!Number.isInteger(port) || seen.has(key)) continue;
    seen.add(key);
    rows.push({ address: local.slice(0, colon), port, pid, process: '' });
  }
  const list = await safe.run('tasklist.exe', ['/FO', 'CSV', '/NH']);
  if (list.ok) {
    const names = new Map();
    for (const line of list.stdout.split(/\r?\n/)) {
      const m = line.match(/^"([^"]+)"\s*,\s*"([^"]+)"/);
      if (m) names.set(Number(m[2].replace(/,/g, '')), m[1]);
    }
    for (const row of rows) row.process = names.get(row.pid) || '';
  }
  return rows;
}

async function list(params, ctx) {
  let processes = [];
  if (ctx.platform === 'win32') processes = await windowsProcesses();
  else if (ctx.platform === 'darwin') {
    const res = await safe.run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN']);
    if (!res.ok) safe.fail(res.stderr.trim() || 'Could not read listening ports');
    for (const line of res.stdout.split(/\r?\n/).slice(1)) {
      const m = line.trim().match(/^(\S+)\s+(\d+)\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(\S+):(\d+)\s+\(LISTEN\)$/);
      if (m) processes.push({ process: m[1], pid: Number(m[2]), address: m[3], port: Number(m[4]) });
    }
  } else {
    const res = await safe.run('ss', ['-ltnp']);
    if (!res.ok) safe.fail(res.stderr.trim() || 'Could not read listening ports');
    for (const line of res.stdout.split(/\r?\n/).slice(1)) {
      const columns = line.trim().split(/\s+/);
      const local = columns[3] || '';
      const m = local.match(/^(.*):(\d+)$/);
      const proc = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
      if (m && proc) processes.push({ address: m[1], port: Number(m[2]), process: proc[1], pid: Number(proc[2]) });
    }
  }
  const unique = new Map(processes.map(row => [`${row.pid}:${row.address}:${row.port}`, row]));
  return { processes: Array.from(unique.values()).sort((a, b) => a.port - b.port || a.pid - b.pid) };
}

async function kill(params, ctx) {
  const pid = safe.toInt(params.pid, 0, 1, 2147483647);
  if (!pid || pid === process.pid || pid <= 4) safe.fail('This process cannot be stopped from Tool Hub');
  if (ctx.platform === 'win32') {
    const res = await safe.run('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { timeout: 15000 });
    if (!res.ok) safe.fail(res.stderr.trim() || 'Could not stop this process');
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch (err) { safe.fail(err.message || 'Could not stop this process'); }
  }
  return { pid, stopped: true };
}

module.exports = { id: 'port-process', actions: { list, kill } };
