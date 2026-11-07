// Every tool comes from an installed add-on; this is the live list of what is available.
let tools = [];
let byId = new Map();

function setAddonTools(list) {
  tools = Array.isArray(list) ? list.filter(Boolean) : [];
  byId = new Map(tools.map(tool => [tool.id, tool]));
}

function getTool(id) {
  return byId.get(id) || null;
}

function isSupported(tool, platform) {
  if (!tool) return false;
  return tool.platforms.split(',').includes(platform);
}

function listTools(platform) {
  return tools.map(({ modulePath, ...tool }) => ({ ...tool, supported: isSupported(tool, platform) }));
}

function categories() {
  const out = [];
  for (const tool of tools) if (!out.includes(tool.category)) out.push(tool.category);
  return out;
}

module.exports = { getTool, isSupported, listTools, categories, setAddonTools };
