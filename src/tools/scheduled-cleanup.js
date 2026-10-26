const safe = require('../core/safe');
const { candidates } = require('./temp-cleaner');
const cleaner = require('./temp-cleaner');

const TASK_NAME = 'ToolHub Weekly Cleanup';

async function create(params, ctx) {
  if (ctx.platform !== 'win32') safe.fail('Scheduled cleanup is currently available on Windows');
  if (!ctx.packaged) safe.fail('Build or install Tool Hub before scheduling a job');
  const allowed = new Set(candidates(ctx.platform).map(target => target.id));
  const ids = Array.isArray(params.ids) ? [...new Set(params.ids.filter(id => allowed.has(id)))] : [];
  if (!ids.length) safe.fail('Select at least one cleanup location');
  const day = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].includes(params.day) ? params.day : 'SUN';
  const time = typeof params.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(params.time) ? params.time : '03:00';
  const command = `"${ctx.executable}" --scheduled-cleanup ${ids.join(',')}`;
  const result = await safe.run('schtasks.exe', ['/Create', '/SC', 'WEEKLY', '/D', day, '/ST', time, '/TN', TASK_NAME, '/TR', command, '/F'], { timeout: 30000 });
  if (!result.ok) safe.fail(result.stderr.trim() || 'Could not create the scheduled task');
  return { task: TASK_NAME, day, time, ids };
}

async function remove(params, ctx) {
  if (ctx.platform !== 'win32') safe.fail('Scheduled cleanup is currently available on Windows');
  const result = await safe.run('schtasks.exe', ['/Delete', '/TN', TASK_NAME, '/F'], { timeout: 30000 });
  if (!result.ok) safe.fail(result.stderr.trim() || 'Could not remove the scheduled task');
  return { removed: true };
}

async function status(params, ctx) {
  if (ctx.platform !== 'win32') return { supported: false };
  const result = await safe.run('schtasks.exe', ['/Query', '/TN', TASK_NAME, '/FO', 'LIST'], { timeout: 30000 });
  return { installed: result.ok, details: result.ok ? result.stdout : '' };
}

async function targets(params, ctx) { return cleaner.actions.scan(params, ctx); }

module.exports = { id: 'scheduled-cleanup', actions: { create, remove, status, targets } };
