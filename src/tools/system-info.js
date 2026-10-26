const os = require('os');
const fs = require('fs');
const safe = require('../core/safe');

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

async function volumeRoots(platform) {
  if (platform !== 'win32') return ['/'];
  const roots = [];
  await Promise.all(Array.from({ length: 26 }, async (_, i) => {
    const root = `${String.fromCharCode(65 + i)}:\\`;
    try { await fs.promises.access(root); roots.push(root); } catch {}
  }));
  roots.sort();
  return roots.length > 0 ? roots : ['C:\\'];
}

async function storage(platform) {
  const out = [];
  for (const root of await volumeRoots(platform)) {
    try {
      const st = await fs.promises.statfs(root);
      const total = st.blocks * st.bsize;
      const free = st.bavail * st.bsize;
      if (total <= 0) continue;
      out.push({
        root,
        total,
        free,
        used: total - free,
        percent: Math.round(((total - free) / total) * 1000) / 10,
      });
    } catch {
      continue;
    }
  }
  return out;
}

async function windowsExtras() {
  const gpu = await safe.powershellJson(
    'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM,VideoProcessor | ConvertTo-Json -Compress'
  );
  const board = await safe.powershellJson(
    'Get-CimInstance Win32_BaseBoard | Select-Object Manufacturer,Product,Version | ConvertTo-Json -Compress'
  );
  const bios = await safe.powershellJson(
    'Get-CimInstance Win32_BIOS | Select-Object Manufacturer,SMBIOSBIOSVersion,ReleaseDate | ConvertTo-Json -Compress'
  );
  const osInfo = await safe.powershellJson(
    'Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture,InstallDate | ConvertTo-Json -Compress'
  );
  const mem = await safe.powershellJson(
    'Get-CimInstance Win32_PhysicalMemory | Select-Object Capacity,Speed,Manufacturer,MemoryType | ConvertTo-Json -Compress'
  );
  return {
    gpu: gpu.ok ? gpu.data : [],
    motherboard: board.ok && board.data ? board.data[0] : null,
    bios: bios.ok && bios.data ? bios.data[0] : null,
    os: osInfo.ok && osInfo.data ? osInfo.data[0] : null,
    memoryModules: mem.ok ? mem.data : [],
  };
}

async function get(params, ctx) {
  const cpus = os.cpus() || [];
  const base = {
    platform: ctx.platform,
    hostname: os.hostname(),
    osType: os.type(),
    osRelease: os.release(),
    arch: os.arch(),
    uptime: formatUptime(os.uptime()),
    cpu: {
      model: cpus.length > 0 ? cpus[0].model.trim() : 'Unknown',
      cores: cpus.length,
      speed: cpus.length > 0 ? cpus[0].speed : 0,
    },
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
      percent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 1000) / 10,
    },
    storage: await storage(ctx.platform),
    extras: null,
  };
  if (ctx.platform === 'win32') {
    try {
      base.extras = await windowsExtras();
    } catch {
      base.extras = null;
    }
  }
  return base;
}

module.exports = { id: 'system-info', actions: { get }, formatUptime, storage };
