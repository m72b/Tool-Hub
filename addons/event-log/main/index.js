// Event Log Analyzer: reads Windows event logs through wevtutil, which is much faster than Get-WinEvent.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { LOG_NAME, buildQuery, parseEvents, groupEvents, findClusters, toCsv, toHtml } = require('./events');

const MAX_EVENTS = 5000;
const CORRELATION_LOGS = ['System', 'Application', 'Setup', 'Microsoft-Windows-Windows Defender/Operational'];

function wevtutil(args, signal) {
  return new Promise(resolve => {
    execFile('wevtutil', args, { encoding: 'buffer', maxBuffer: 512 * 1048576, timeout: 120000, windowsHide: true, signal }, (err, stdout, stderr) => {
      const output = stdout.toString('utf16le');
      resolve({ ok: !err, output, error: err ? (stderr.toString('utf16le') || stderr.toString() || err.message) : '' });
    });
  });
}

async function readLog(log, filter, limit, signal) {
  if (!LOG_NAME.test(String(log || ''))) throw new Error('Choose a log');
  const res = await wevtutil(['qe', log, `/q:${buildQuery(filter)}`, `/c:${limit}`, '/rd:true', '/f:RenderedXml', '/e:Events', '/uni:true'], signal);
  if (!res.ok) {
    if (/access is denied/i.test(res.error)) throw new Error(`Windows only lets administrators read the ${log} log. Run Tool Hub as administrator to open it.`);
    if (/could not be found|was not found/i.test(res.error)) throw new Error(`The ${log} log does not exist on this PC`);
    throw new Error(`Could not read the ${log} log: ${res.error.trim().slice(0, 200)}`);
  }
  return parseEvents(res.output);
}

const clampLimit = value => Math.min(MAX_EVENTS, Math.max(1, Math.round(Number(value)) || 500));

const actions = {
  async logs(params, ctx) {
    const res = await ctx.lib.safe.powershellJson("Get-WinEvent -ListLog * -ErrorAction SilentlyContinue | Where-Object { $_.RecordCount -gt 0 } | ForEach-Object { [PSCustomObject]@{ name=$_.LogName; count=$_.RecordCount; size=$_.FileSize; updated=if($_.LastWriteTime){[DateTimeOffset]::new($_.LastWriteTime).ToUnixTimeMilliseconds()}else{0} } } | ConvertTo-Json -Compress", { timeout: 60000 });
    if (!res.ok) ctx.lib.safe.fail(res.error);
    const main = ['System', 'Application', 'Security', 'Setup'];
    const rank = name => { const i = main.indexOf(name); return i < 0 ? main.length : i; };
    return (res.data || []).sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  },

  async query(params, ctx) {
    const events = await readLog(params.log, params, clampLimit(params.limit), ctx.signal);
    return { events, groups: groupEvents(events), clusters: findClusters(events), limited: events.length >= clampLimit(params.limit) };
  },

  // Everything logged around one moment, across the main logs.
  async around(params, ctx) {
    const time = Number(params.time);
    if (!Number.isFinite(time) || time <= 0) ctx.lib.safe.fail('That event has no time');
    const minutes = Math.min(120, Math.max(1, Number(params.minutes) || 5));
    const span = { from: time - minutes * 60000, to: time + minutes * 60000 };
    const logs = [...new Set([...CORRELATION_LOGS, params.log].filter(Boolean))];
    const events = [];
    const skipped = [];
    for (const log of logs) {
      try { events.push(...await readLog(log, span, 1000, ctx.signal)); }
      catch (err) { if (err.name === 'AbortError') throw err; skipped.push(log); }
    }
    return { events: events.sort((a, b) => b.time - a.time), skipped, minutes };
  },

  async exportReport(params, ctx) {
    if (!params.output) ctx.lib.safe.fail('Choose where to save the report');
    const events = await readLog(params.log, params, clampLimit(params.limit), ctx.signal);
    const ext = path.extname(params.output).toLowerCase();
    const body = ext === '.csv' ? toCsv(events) : ext === '.json' ? JSON.stringify(events, null, 2) : toHtml(events, { title: `${params.log} event log report` });
    fs.writeFileSync(params.output, body);
    return { output: params.output, count: events.length };
  },
};

module.exports = { id: 'event-log-analyzer', actions };
