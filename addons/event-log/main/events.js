// Windows event log helpers that need no Windows: building queries, reading results, grouping and reporting.
const LEVELS = { 0: 'Information', 1: 'Critical', 2: 'Error', 3: 'Warning', 4: 'Information', 5: 'Verbose' };
const LOG_NAME = /^[\w .%/-]{1,200}$/;
const PROVIDER = /^[\w .()/-]{1,200}$/;

const decode = value => String(value || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Builds the XPath filter. Every value is checked here, so nothing can change the query's meaning.
function buildQuery({ levels, provider, eventId, from, to } = {}) {
  const parts = [];
  const wanted = (Array.isArray(levels) ? levels : []).map(Number).filter(level => Number.isInteger(level) && level >= 0 && level <= 5);
  if (wanted.length) {
    // Many logs write Information as level 0.
    const all = wanted.includes(4) ? [...new Set([...wanted, 0])] : wanted;
    parts.push(`(${all.map(level => `Level=${level}`).join(' or ')})`);
  }
  if (provider) {
    if (!PROVIDER.test(provider)) throw new Error('That source name contains characters that cannot be searched');
    parts.push(`Provider[@Name='${provider}']`);
  }
  if (eventId !== undefined && eventId !== null && eventId !== '') {
    const id = Number(eventId);
    if (!Number.isInteger(id) || id < 0 || id > 65535) throw new Error('Event ID must be a number from 0 to 65535');
    parts.push(`EventID=${id}`);
  }
  const time = [];
  for (const [value, op] of [[from, '>='], [to, '<=']]) {
    if (value === undefined || value === null || value === '') continue;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('Choose a valid date and time');
    time.push(`@SystemTime${op}'${date.toISOString()}'`);
  }
  if (time.length) parts.push(`TimeCreated[${time.join(' and ')}]`);
  return parts.length ? `*[System[${parts.join(' and ')}]]` : '*';
}

const attribute = (xml, tag, name) => {
  const found = new RegExp(`<${tag}\\b[^>]*\\s${name}=['"]([^'"]*)['"]`).exec(xml);
  return found ? decode(found[1]) : '';
};
const element = (xml, tag) => {
  const found = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  return found ? decode(found[1]).trim() : '';
};

function parseEvents(xml) {
  const events = [];
  for (const match of String(xml).matchAll(/<Event\b[\s\S]*?<\/Event>/g)) {
    const raw = match[0];
    const level = Number(element(raw, 'Level')) || 0;
    const message = element(raw, 'Message') || [...raw.matchAll(/<Data\b[^>]*>([\s\S]*?)<\/Data>/g)].map(item => decode(item[1]).trim()).filter(Boolean).join('\n');
    const time = Date.parse(attribute(raw, 'TimeCreated', 'SystemTime'));
    events.push({
      id: Number(element(raw, 'EventID')) || 0,
      record: element(raw, 'EventRecordID'),
      provider: attribute(raw, 'Provider', 'Name') || attribute(raw, 'Provider', 'EventSourceName'),
      level,
      levelName: LEVELS[level] || `Level ${level}`,
      log: element(raw, 'Channel'),
      computer: element(raw, 'Computer'),
      time: Number.isNaN(time) ? 0 : time,
      message,
    });
  }
  return events;
}

// Removes what changes between repeats of one problem, such as ids, addresses and counters.
function normalizeMessage(message) {
  return String(message || '')
    .replace(/\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?/gi, '#')
    .replace(/0x[0-9a-f]+/gi, '#')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?/g, '#')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function groupEvents(events) {
  const groups = new Map();
  for (const event of events) {
    const key = `${event.provider}|${event.id}|${normalizeMessage(event.message)}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, provider: event.provider, id: event.id, level: event.level, levelName: event.levelName, count: 0, first: event.time, last: event.time, sample: event.message };
      groups.set(key, group);
    }
    group.count++;
    if (event.time && (!group.first || event.time < group.first)) group.first = event.time;
    if (event.time > group.last) { group.last = event.time; group.sample = event.message; }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.last - a.last);
}

// Splits errors into clusters: runs of events with no gap longer than `gapMinutes`.
function findClusters(events, { gapMinutes = 5, minEvents = 3 } = {}) {
  const serious = events.filter(event => event.time && event.level >= 1 && event.level <= 2).sort((a, b) => a.time - b.time);
  const clusters = [];
  let current = null;
  for (const event of serious) {
    if (!current || event.time - current.end > gapMinutes * 60000) {
      current = { start: event.time, end: event.time, events: [] };
      clusters.push(current);
    }
    current.end = event.time;
    current.events.push(event);
  }
  return clusters.filter(cluster => cluster.events.length >= minEvents).map(cluster => {
    const sources = new Map();
    for (const event of cluster.events) sources.set(event.provider, (sources.get(event.provider) || 0) + 1);
    return {
      start: cluster.start,
      end: cluster.end,
      count: cluster.events.length,
      sources: [...sources].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      events: cluster.events.slice(0, 100),
    };
  }).sort((a, b) => b.start - a.start);
}

const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
function toCsv(events) {
  const rows = [['Time', 'Level', 'Log', 'Source', 'Event ID', 'Computer', 'Message'].map(csvCell).join(',')];
  for (const event of events) rows.push([event.time ? new Date(event.time).toISOString() : '', event.levelName, event.log, event.provider, event.id, event.computer, event.message].map(csvCell).join(','));
  return rows.join('\r\n');
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const stamp = ms => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '');

function toHtml(events, { title = 'Event log report', generated = Date.now() } = {}) {
  const counts = {};
  for (const event of events) counts[event.levelName] = (counts[event.levelName] || 0) + 1;
  const groups = groupEvents(events).slice(0, 100);
  const clusters = findClusters(events).slice(0, 25);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
body{font:14px system-ui,sans-serif;margin:32px;color:#1a1a1a}table{border-collapse:collapse;width:100%;margin-bottom:24px}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f2f2f2}td.m{white-space:pre-wrap;word-break:break-word}
</style></head><body><h1>${escapeHtml(title)}</h1><p>Generated ${stamp(generated)} UTC. ${events.length} events: ${Object.entries(counts).map(([name, count]) => `${count} ${escapeHtml(name)}`).join(', ')}.</p>
<h2>Recurring problems</h2><table><tr><th>Count</th><th>Level</th><th>Source</th><th>ID</th><th>First (UTC)</th><th>Last (UTC)</th><th>Message</th></tr>${groups.map(group => `<tr><td>${group.count}</td><td>${escapeHtml(group.levelName)}</td><td>${escapeHtml(group.provider)}</td><td>${group.id}</td><td>${stamp(group.first)}</td><td>${stamp(group.last)}</td><td class="m">${escapeHtml(group.sample.slice(0, 500))}</td></tr>`).join('')}</table>
<h2>Errors close together</h2><table><tr><th>From (UTC)</th><th>To (UTC)</th><th>Errors</th><th>Sources</th></tr>${clusters.map(cluster => `<tr><td>${stamp(cluster.start)}</td><td>${stamp(cluster.end)}</td><td>${cluster.count}</td><td>${cluster.sources.map(source => `${escapeHtml(source.name)} (${source.count})`).join(', ')}</td></tr>`).join('')}</table>
<h2>All events</h2><table><tr><th>Time (UTC)</th><th>Level</th><th>Log</th><th>Source</th><th>ID</th><th>Message</th></tr>${events.map(event => `<tr><td>${stamp(event.time)}</td><td>${escapeHtml(event.levelName)}</td><td>${escapeHtml(event.log)}</td><td>${escapeHtml(event.provider)}</td><td>${event.id}</td><td class="m">${escapeHtml(event.message)}</td></tr>`).join('')}</table></body></html>`;
}

module.exports = { LOG_NAME, buildQuery, parseEvents, normalizeMessage, groupEvents, findClusters, toCsv, toHtml };
