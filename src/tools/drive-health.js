const safe = require('../core/safe');

function statusLabel(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('unhealthy') || text.includes('failed')) return 'critical';
  if (text.includes('warning')) return 'warning';
  if (text.includes('healthy') || text === 'ok') return 'healthy';
  return 'unknown';
}

async function get(params, ctx) {
  if (ctx.platform !== 'win32') {
    return { supported: false, drives: [], message: 'Drive Health uses Windows storage APIs and is only available on Windows.' };
  }
  const disks = await safe.powershellJson(
    'Get-PhysicalDisk | ForEach-Object { [PSCustomObject]@{DeviceId=$_.DeviceId;FriendlyName=$_.FriendlyName;MediaType=$_.MediaType.ToString();BusType=$_.BusType.ToString();Size=$_.Size;HealthStatus=$_.HealthStatus.ToString();OperationalStatus=($_.OperationalStatus -join ",");SerialNumber=$_.SerialNumber;FirmwareVersion=$_.FirmwareVersion} } | ConvertTo-Json -Compress',
    { timeout: 40000 }
  );
  if (!disks.ok) {
    return { supported: true, drives: [], error: disks.error || 'Could not read physical disk information.' };
  }
  const counters = await safe.powershellJson(
    'Get-PhysicalDisk | ForEach-Object { $c=$_ | Get-StorageReliabilityCounter; ' +
    '[PSCustomObject]@{DeviceId=$_.DeviceId;Temperature=$c.Temperature;Wear=$c.Wear;PowerOnHours=$c.PowerOnHours;' +
    'ReadErrorsTotal=$c.ReadErrorsTotal;WriteErrorsTotal=$c.WriteErrorsTotal;StartStopCycleCount=$c.StartStopCycleCount} } | ConvertTo-Json -Compress',
    { timeout: 40000 }
  );
  const counterMap = new Map();
  if (counters.ok && counters.data) {
    for (const c of counters.data) counterMap.set(String(c.DeviceId), c);
  }
  const metric = value => value == null || value === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
  const drives = (disks.data || []).map(d => {
    const c = counterMap.get(String(d.DeviceId)) || {};
    return {
      id: String(d.DeviceId ?? ''),
      name: String(d.FriendlyName || 'Unknown drive'),
      mediaType: String(d.MediaType || 'Unknown'),
      busType: String(d.BusType || ''),
      size: Number(d.Size) || 0,
      health: statusLabel(d.HealthStatus),
      healthRaw: String(d.HealthStatus ?? 'Unknown'),
      operational: String(d.OperationalStatus ?? ''),
      serial: d.SerialNumber ? String(d.SerialNumber).trim() : '',
      firmware: d.FirmwareVersion ? String(d.FirmwareVersion).trim() : '',
      temperature: metric(c.Temperature),
      wear: metric(c.Wear),
      powerOnHours: metric(c.PowerOnHours),
      readErrors: Number(c.ReadErrorsTotal) || 0,
      writeErrors: Number(c.WriteErrorsTotal) || 0,
    };
  });
  return { supported: true, drives, note: 'Temperature and wear require driver support and may be unavailable on some drives.' };
}

module.exports = { id: 'drive-health', actions: { get }, statusLabel };
