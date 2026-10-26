const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const harness = fs.readFileSync(path.join(__dirname, 'renderer.test.js'), 'utf8');
const setup = harness.split('const MOCK = {')[0];
const mockBlock = 'const MOCK = {' + harness.split('const MOCK = {')[1].split("MOCK['image-resize']")[0] + "MOCK['image-resize'] = MOCK['image-convert'];";

const mod = { exports: {} };
vm.runInThisContext(`(function(module,exports,require,__dirname){${setup}\n${mockBlock}\nmodule.exports={createEnv,loadScript,MOCK};})`)(mod, mod.exports, require, __dirname);
const { createEnv, loadScript, MOCK } = mod.exports;

const ctxObj = createEnv();
const context = vm.createContext(ctxObj);
loadScript(context, 'ui.js');
for (const f of ['renamer', 'cleanup', 'files', 'system', 'media']) loadScript(context, `views/${f}.js`);

const registry = require(path.join(__dirname, '..', 'src', 'core', 'registry'));
const Hub = ctxObj.Hub;

function collectText(node, out = []) {
  if (!node) return out;
  if (node.textContent && (!node.children || node.children.length === 0)) out.push(String(node.textContent));
  if (node.textContent && node.children && node.children.length === 0) out.push(String(node.textContent));
  for (const child of node.children || []) collectText(child, out);
  return out;
}

function findButton(node, label, out = []) {
  if (node.tagName === 'BUTTON' && String(node.textContent).trim() === label) out.push(node);
  for (const child of node.children || []) findButton(child, label, out);
  return out;
}

function fire(node, type) {
  const list = node._listeners[type] || [];
  for (const fn of list) fn({ target: node, preventDefault() {}, stopPropagation() {} });
}

let failures = 0;
const rejections = [];
process.on('unhandledRejection', e => rejections.push(e && e.message));

(async () => {
  for (const tool of registry.TOOLS) {
    const def = Hub.getView(tool.id);
    const api = {
      invoke: async (action) => {
        const data = (MOCK[tool.id] || {})[action];
        if (data === undefined) return { ok: false, error: `no mock for ${tool.id}.${action}` };
        return { ok: true, data };
      },
      toast: () => {},
      pickFolder: async () => 'C:/chosen',
      pickFiles: async () => [{ path: 'C:/a', name: 'a', ext: 'txt', size: 1, mtime: 1, dir: 'C:/' }],
      reveal: async () => true,
      platform: 'win32',
    };
    const node = def.render(api, { tool, toast: () => {}, openLibrary: () => {} });

    const runLabels = ['Scan for duplicates','Find large files','Compare folders','Generate hashes','Refresh','Refresh list','Scan temp locations','Ping','DNS lookup','Traceroute','My IP info'];
    for (const label of runLabels) {
      for (const btn of findButton(node, label)) fire(btn, 'click');
    }
    await new Promise(r => setTimeout(r, 60));

    const text = collectText(node).join(' | ');
    if (text.includes('Could not display results')) {
      failures++;
      console.error(`RENDER PATH FAIL ${tool.id}: result renderer threw`);
    }
    if (text.includes('no mock for')) {
      const which = text.split('no mock for ')[1].split(' |')[0];
      console.error(`NOTE ${tool.id}: view called un-mocked action ${which}`);
    }
  }

  await new Promise(r => setTimeout(r, 200));
  if (rejections.length > 0) {
    failures += rejections.length;
    for (const r of rejections) console.error('UNHANDLED REJECTION:', r);
  }
  console.log(failures === 0 ? 'All result-render paths executed cleanly' : `${failures} render-path failure(s)`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
