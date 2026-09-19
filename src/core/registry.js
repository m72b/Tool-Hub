const ALL = 'win32,darwin,linux';
const WIN = 'win32';

const TOOLS = [
  {
    id: 'renamer',
    name: 'Batch Renamer',
    category: 'Files',
    icon: 'RN',
    description: 'Rename files in bulk with reusable templates, tokens and live previews.',
    platforms: ALL,
    core: true,
  },
  {
    id: 'organizer',
    name: 'File Organizer',
    category: 'Files',
    icon: 'OR',
    description: 'Sort files into subfolders by pattern, modified year or size range.',
    platforms: ALL,
    core: true,
  },
  {
    id: 'duplicates',
    name: 'Duplicate Finder',
    category: 'Cleanup',
    icon: 'DF',
    description: 'Find duplicate files by content hash, size or name and remove them safely.',
    platforms: ALL,
    core: false,
  },
  {
    id: 'disk-analyzer',
    name: 'Disk Space Analyzer',
    category: 'Cleanup',
    icon: 'DA',
    description: 'See exactly which folders are consuming your storage.',
    platforms: ALL,
    core: false,
  },
  {
    id: 'large-files',
    name: 'Large File Finder',
    category: 'Cleanup',
    icon: 'LF',
    description: 'Quickly locate the biggest files on a drive or folder.',
    platforms: ALL,
    core: false,
  },
  {
    id: 'temp-cleaner',
    name: 'Temporary File Cleaner',
    category: 'Cleanup',
    icon: 'TC',
    description: 'Preview and clear temp, cache and prefetch files.',
    platforms: ALL,
    core: false,
  },
  {
    id: 'apps-manager',
    name: 'Installed Apps Manager',
    category: 'System',
    icon: 'AM',
    description: 'List installed applications with sizes and launch their uninstallers.',
    platforms: WIN,
    core: false,
  },
  {
    id: 'startup-manager',
    name: 'Startup Manager',
    category: 'System',
    icon: 'SM',
    description: 'Review and disable programs that launch with Windows.',
    platforms: WIN,
    core: false,
  },
  {
    id: 'system-info',
    name: 'System Information',
    category: 'System',
    icon: 'SI',
    description: 'CPU, GPU, memory, motherboard, OS and storage details.',
    platforms: ALL,
    core: false,
  },
  {
    id: 'drive-health',
    name: 'Drive Health',
    category: 'System',
    icon: 'DH',
    description: 'SMART and reliability data for your physical drives.',
    platforms: WIN,
    core: false,
  },
  {
    id: 'folder-compare',
    name: 'Folder Compare',
    category: 'Files',
    icon: 'FC',
    description: 'Compare two folders and identify added, missing and changed files.',
    platforms: ALL,
    core: false,
  },
  {
    id: 'hash-tool',
    name: 'File Hash Generator',
    category: 'Files',
    icon: 'HS',
    description: 'Generate and verify MD5, SHA-1, SHA-256 and SHA-512 checksums.',
    platforms: ALL,
    core: false,
  },
  {
    id: 'image-convert',
    name: 'Image Converter',
    category: 'Media',
    icon: 'IC',
    description: 'Batch convert images between PNG, JPEG and WebP.',
    platforms: ALL,
    core: false,
  },
  {
    id: 'image-resize',
    name: 'Image Resizer',
    category: 'Media',
    icon: 'IR',
    description: 'Batch resize and compress images with quality control.',
    platforms: ALL,
    core: false,
  },
  {
    id: 'network',
    name: 'Network Toolkit',
    category: 'System',
    icon: 'NW',
    description: 'Ping, DNS lookup, traceroute and local IP information.',
    platforms: ALL,
    core: false,
  },
  {
    id: 'attributes',
    name: 'File Attribute Editor',
    category: 'Files',
    icon: 'AT',
    description: 'Bulk set hidden, read-only, system and archive attributes.',
    platforms: ALL,
    core: false,
  },
  {
    id: 'file-dates',
    name: 'File Date Editor',
    category: 'Files',
    icon: 'FD',
    description: 'Bulk change created, modified and accessed timestamps.',
    platforms: ALL,
    core: false,
  },
];

const BY_ID = new Map(TOOLS.map(t => [t.id, t]));

function getTool(id) {
  return BY_ID.get(id) || null;
}

function isSupported(tool, platform) {
  if (!tool) return false;
  return tool.platforms.split(',').includes(platform);
}

function listTools(platform) {
  return TOOLS.map(t => ({ ...t, supported: isSupported(t, platform) }));
}

function coreIds() {
  return TOOLS.filter(t => t.core).map(t => t.id);
}

function categories() {
  const out = [];
  for (const t of TOOLS) if (!out.includes(t.category)) out.push(t.category);
  return out;
}

module.exports = { TOOLS, getTool, isSupported, listTools, coreIds, categories };
