(function () {
  const { h, clear, fmtBytes, fmtNumber, table, empty, statusNote, stat, toolShell, downloadFile } = window.UI;
  const Hub = window.Hub;

  Hub.registerView('empty-folders', {
    render(api) {
      return toolShell({
        title: 'Empty Folder Cleaner', description: 'Find folders that are empty or contain only other empty folders. Selected folders go to the Recycle Bin.',
        action: 'scan', runLabel: 'Find empty folders', busyLabel: 'Scanning folders…',
        defaults: { root: '', recursive: true },
        fields: [{ type: 'folder', key: 'root', label: 'Folder to scan', wide: true }, { type: 'checkbox', key: 'recursive', label: 'Include subfolders' }],
        validate: state => state.root ? null : 'Choose a folder to scan',
        params: state => ({ root: state.root, recursive: state.recursive }),
        render(data, ctx) {
          const wrap = h('div');
          wrap.appendChild(h('div', { class: 'stat-row' }, [stat('Empty folders', fmtNumber(data.count)), stat('Folders checked', fmtNumber(data.scanned))]));
          if (!data.directories.length) { wrap.appendChild(empty('No empty folders found.')); return wrap; }
          const selected = new Set(data.directories.map(item => item.path));
          const count = h('span', { class: 'picker-count', text: `${selected.size} selected` });
          const remove = h('button', { class: 'btn btn-danger', type: 'button', text: 'Move selected to Recycle Bin', onclick: async () => {
            if (!selected.size || !window.confirm(`Move ${selected.size} empty folder(s) to the Recycle Bin?`)) return;
            remove.disabled = true;
            const res = await api.invoke('remove', { root: ctx.state.root, paths: [...selected] });
            remove.disabled = false;
            if (!res.ok) { api.toast(res.error, 'error'); return; }
            api.toast(`Moved ${res.data.removed} folder(s) to the Recycle Bin${res.data.failed.length ? `; ${res.data.failed.length} skipped` : ''}`, res.data.failed.length ? 'warn' : 'ok');
            ctx.rerun();
          } });
          const rows = data.directories.map(item => h('div', { class: 'tbl-row' }, [
            h('input', { type: 'checkbox', checked: true, onchange: e => { e.target.checked ? selected.add(item.path) : selected.delete(item.path); count.textContent = `${selected.size} selected`; } }),
            h('span', { class: 'mono ellipsis', text: item.name, title: item.path }),
            h('span', { class: 'muted ellipsis', text: item.path, title: item.path }),
            h('button', { class: 'mini-btn', type: 'button', text: 'Show', onclick: () => api.reveal(item.path) }),
          ]));
          wrap.appendChild(h('div', { class: 'action-row' }, [remove, count]));
          wrap.appendChild(table([{ label: '', width: '32px' }, { label: 'Folder', width: 'minmax(0,1fr)' }, { label: 'Path', width: 'minmax(0,2fr)' }, { label: '', width: '72px' }], rows));
          return wrap;
        },
      }, api);
    },
  });

  Hub.registerView('small-files', {
    render(api) {
      return toolShell({
        title: 'Zero-Byte & Shortcut Finder', description: 'Find empty files and broken Windows shortcuts. Files you remove go to the Recycle Bin.',
        action: 'scan', runLabel: 'Find empty files', busyLabel: 'Scanning files…', defaults: { root: '', recursive: true },
        fields: [{ type: 'folder', key: 'root', label: 'Folder to scan', wide: true }, { type: 'checkbox', key: 'recursive', label: 'Include subfolders' }],
        validate: state => state.root ? null : 'Choose a folder to scan', params: state => ({ root: state.root, recursive: state.recursive }),
        render(data, ctx) {
          const wrap = h('div');
          wrap.appendChild(h('div', { class: 'stat-row' }, [stat('Findings', fmtNumber(data.count)), stat('Empty files', fmtNumber(data.findings.filter(item => item.kind === 'Zero-byte file').length))]));
          if (!data.shortcutsSupported) wrap.appendChild(statusNote('Broken shortcut checks are available on Windows.', 'info'));
          if (data.truncated) wrap.appendChild(statusNote('Scan reached the file limit; results are partial.', 'warn'));
          if (!data.findings.length) { wrap.appendChild(empty('No zero-byte files or broken shortcuts found.')); return wrap; }
          const selected = new Set(data.findings.map(item => item.path));
          const rows = data.findings.map(item => h('div', { class: 'tbl-row' }, [
            h('input', { type: 'checkbox', checked: true, onchange: e => e.target.checked ? selected.add(item.path) : selected.delete(item.path) }),
            h('span', { class: 'mono ellipsis', text: item.name, title: item.path }),
            h('span', { class: 'tag tag-warn', text: item.kind }),
            h('span', { class: 'mono', text: fmtBytes(item.size) }),
            h('span', { class: 'muted ellipsis', text: item.dir, title: item.dir }),
            h('button', { class: 'mini-btn', type: 'button', text: 'Show', onclick: () => api.reveal(item.path) }),
          ]));
          const remove = h('button', { class: 'btn btn-danger', type: 'button', text: 'Move selected to Recycle Bin', onclick: async () => {
            if (!selected.size || !window.confirm(`Move ${selected.size} file(s) to the Recycle Bin?`)) return;
            const res = await api.invoke('remove', { root: ctx.state.root, paths: [...selected] });
            if (!res.ok) { api.toast(res.error, 'error'); return; }
            api.toast(`Moved ${res.data.removed} file(s) to the Recycle Bin`, 'ok');
            ctx.rerun();
          } });
          wrap.appendChild(h('div', { class: 'action-row' }, [remove]));
          wrap.appendChild(table([{ label: '', width: '32px' }, { label: 'Name', width: 'minmax(0,1.5fr)' }, { label: 'Finding', width: '150px' }, { label: 'Size', width: '90px' }, { label: 'Folder', width: 'minmax(0,1.5fr)' }, { label: '', width: '72px' }], rows));
          return wrap;
        },
      }, api);
    },
  });

  Hub.registerView('tree-export', {
    render(api) {
      return toolShell({
        title: 'Directory Tree Export', description: 'Create a readable folder structure and save it as text or Markdown.',
        action: 'export', runLabel: 'Build directory tree', busyLabel: 'Reading folders…',
        defaults: { root: '', format: 'markdown', maxDepth: 20, includeFiles: true },
        fields: [
          { type: 'folder', key: 'root', label: 'Folder to export', wide: true },
          { type: 'select', key: 'format', label: 'Format', options: [{ label: 'Markdown', value: 'markdown' }, { label: 'Plain text', value: 'text' }] },
          { type: 'select', key: 'maxDepth', label: 'Maximum depth', numeric: true, options: [5, 10, 20, 50].map(n => ({ label: String(n), value: n })) },
          { type: 'checkbox', key: 'includeFiles', label: 'Include files' },
        ],
        validate: state => state.root ? null : 'Choose a folder to export',
        params: state => ({ root: state.root, format: state.format, maxDepth: state.maxDepth, includeFiles: state.includeFiles }),
        render(data) {
          const wrap = h('div');
          wrap.appendChild(h('div', { class: 'stat-row' }, [stat('Entries', fmtNumber(data.count))]));
          if (data.truncated) wrap.appendChild(statusNote('Output was capped at 20,000 entries.', 'warn'));
          wrap.appendChild(h('div', { class: 'action-row' }, [h('button', { class: 'btn btn-accent', type: 'button', text: 'Download tree', onclick: () => downloadFile(`${data.format === 'markdown' ? 'directory-tree.md' : 'directory-tree.txt'}`, data.text, 'text/plain;charset=utf-8') })]));
          wrap.appendChild(h('textarea', { class: 'input mono', rows: '20', readonly: true, value: data.text }));
          return wrap;
        },
      }, api);
    },
  });

  Hub.registerView('port-process', {
    render(api) {
      return toolShell({
        title: 'Port & Process Viewer', description: 'Review TCP ports that are listening. Stopping a process terminates it immediately.',
        action: 'list', runLabel: 'Refresh ports', busyLabel: 'Checking listening ports…', defaults: {}, fields: [],
        render(data) {
          const wrap = h('div');
          const filter = h('input', { class: 'input', type: 'number', min: '1', max: '65535', placeholder: 'Filter by port (for example 3000)' });
          const body = h('div');
          const draw = () => {
            clear(body);
            const rows = data.processes.filter(item => !filter.value || item.port === Number(filter.value)).map(item => h('div', { class: 'tbl-row' }, [
              h('span', { class: 'mono', text: String(item.port) }),
              h('span', { class: 'mono ellipsis', text: item.address }),
              h('span', { class: 'mono', text: String(item.pid) }),
              h('span', { class: 'ellipsis', text: item.process || 'Unknown process' }),
              h('button', { class: 'btn btn-sm btn-danger', type: 'button', text: 'Stop', onclick: async () => {
                if (!window.confirm(`Stop ${item.process || 'PID ' + item.pid}? Any work in that process may be lost.`)) return;
                const res = await api.invoke('kill', { pid: item.pid });
                if (!res.ok) { api.toast(res.error, 'error'); return; }
                api.toast(`Stopped process ${item.pid}`, 'ok');
                api.invoke('list', {}).then(next => { if (next.ok) { data.processes = next.data.processes; draw(); } });
              } }),
            ]));
            if (!rows.length) body.appendChild(empty('No listening ports match.'));
            else body.appendChild(table([{ label: 'Port', width: '80px' }, { label: 'Address', width: 'minmax(0,1.2fr)' }, { label: 'PID', width: '90px' }, { label: 'Process', width: 'minmax(0,1fr)' }, { label: '', width: '80px' }], rows));
          };
          filter.oninput = draw;
          wrap.appendChild(h('div', { class: 'field-row' }, [filter]));
          wrap.appendChild(body);
          draw();
          return wrap;
        },
      }, api);
    },
  });

  Hub.registerView('system-editor', {
    render(api) {
      const root = h('div', { class: 'tool' });
      const results = h('div', { class: 'results' });
      const hosts = h('textarea', { class: 'input mono', rows: '12', spellcheck: 'false' });
      const envName = h('input', { class: 'input mono', type: 'text', placeholder: 'Variable name (for example PATH)' });
      const envValue = h('textarea', { class: 'input mono', rows: '4', spellcheck: 'false', placeholder: 'Variable value' });
      const envRows = h('div');
      const status = h('div');
      const refresh = async () => {
        status.textContent = 'Loading settings…';
        const res = await api.invoke('get', {});
        clear(status); clear(results);
        if (!res.ok) { results.appendChild(statusNote(res.error, 'error')); return; }
        if (!res.data.supported) { results.appendChild(statusNote(res.data.message, 'info')); return; }
        hosts.value = res.data.hosts || '';
        if (res.data.environmentError) results.appendChild(statusNote(res.data.environmentError, 'warn'));
        clear(envRows);
        envRows.appendChild(table([{ label: 'Name', width: '220px' }, { label: 'Value', width: 'minmax(0,1fr)' }, { label: 'Type', width: '130px' }], (res.data.variables || []).map(item => h('div', { class: 'tbl-row', onclick: () => { envName.value = item.Name; envValue.value = item.Value || ''; } }, [
          h('span', { class: 'mono', text: item.Name }), h('span', { class: 'mono ellipsis', text: item.Value || '', title: item.Value || '' }), h('span', { class: 'muted', text: item.Type }),
        ]))));
        results.appendChild(statusNote(`Hosts file: ${res.data.hostsPath}. A backup is written before every save. User environment changes apply to newly started apps.`, 'info'));
      };
      const save = async (action, params, label) => {
        if (!window.confirm(`${label}? A backup will be made first.`)) return;
        const button = document.activeElement;
        if (button) button.disabled = true;
        const res = await api.invoke(action, params);
        if (button) button.disabled = false;
        if (!res.ok) { api.toast(res.error, 'error'); return; }
        api.toast(`Saved. Backup: ${res.data.backup}`, 'ok');
        refresh();
      };
      root.appendChild(h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'Hosts & Environment Editor' }), h('p', { class: 'tool-desc', text: 'Windows hosts and user environment values. Each change creates a timestamped backup.' })]));
      root.appendChild(h('div', { class: 'group' }, [h('div', { class: 'group-head' }, [h('span', { class: 'group-title', text: 'Hosts file' })]), h('div', { class: 'group-body' }, [hosts, h('button', { class: 'btn btn-accent', type: 'button', text: 'Save hosts file', onclick: () => save('saveHosts', { content: hosts.value }, 'Save the hosts file') })])]));
      root.appendChild(h('div', { class: 'group' }, [h('div', { class: 'group-head' }, [h('span', { class: 'group-title', text: 'User environment variable' })]), h('div', { class: 'group-body' }, [envName, envValue, h('div', { class: 'action-row' }, [h('button', { class: 'btn btn-accent', type: 'button', text: 'Save variable', onclick: () => save('saveEnv', { name: envName.value, value: envValue.value }, 'Save this user environment variable') }), h('button', { class: 'btn btn-danger', type: 'button', text: 'Remove variable', onclick: () => save('removeEnv', { name: envName.value }, 'Remove this user environment variable') })]), envRows])]));
      root.appendChild(h('div', { class: 'action-row' }, [h('button', { class: 'btn btn-sm', type: 'button', text: 'Refresh', onclick: refresh })]));
      root.appendChild(results);
      refresh();
      return root;
    },
  });

  Hub.registerView('utilities', {
    render(api) {
      const root = h('div', { class: 'tool' });
      const tabs = h('div', { class: 'shape-grid' });
      const body = h('div', { class: 'group-body' });
      let active = 'JSON Formatter';
      const tools = ['JSON Formatter', 'Base64', 'UUID Generator', 'Text Diff', 'Regex Tester', 'Password Generator'];
      const drawTabs = () => { clear(tabs); for (const name of tools) tabs.appendChild(h('button', { class: `settings-mode-btn${name === active ? ' active' : ''}`, type: 'button', text: name, onclick: () => { active = name; drawTabs(); drawBody(); } })); };
      const drawBody = () => {
        clear(body);
        const input = h('textarea', { class: 'input mono', rows: '8', placeholder: active === 'JSON Formatter' ? '{"key":"value"}' : 'Enter text…' });
        const output = h('textarea', { class: 'input mono', rows: '8', readonly: true, placeholder: 'Result' });
        const note = h('div', { class: 'field-hint' });
        const run = h('button', { class: 'btn btn-accent', type: 'button', text: 'Run', onclick: () => {
          try {
            if (active === 'JSON Formatter') output.value = JSON.stringify(JSON.parse(input.value), null, 2);
            else if (active === 'Base64') output.value = btoa(unescape(encodeURIComponent(input.value)));
            else if (active === 'UUID Generator') output.value = Array.from({ length: Math.min(Math.max(Number(input.value) || 1, 1), 100) }, () => crypto.randomUUID()).join('\n');
            else if (active === 'Text Diff') output.value = makeTextDiff(input.value, compare.value);
            else if (active === 'Regex Tester') { const re = new RegExp(input.value, flags.value); output.value = [...(source.value.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)))].map(m => `${m[0]} at ${m.index}${m.length > 1 ? ` · groups: ${m.slice(1).join(', ')}` : ''}`).join('\n') || 'No matches'; }
            else if (active === 'Password Generator') output.value = makePassword(Number(input.value) || 20);
            note.textContent = '';
          } catch (err) { output.value = ''; note.textContent = err.message; }
        } });
        if (active === 'Base64') {
          const decode = h('button', { class: 'btn', type: 'button', text: 'Decode Base64', onclick: () => { try { output.value = decodeURIComponent(escape(atob(input.value.trim()))); note.textContent = ''; } catch (err) { note.textContent = 'Input is not valid Base64 text.'; } } });
          body.appendChild(h('div', { class: 'action-row' }, [run, decode]));
        } else if (active === 'Text Diff') {
          const compare = h('textarea', { class: 'input mono', rows: '8', placeholder: 'Second text' });
          body.appendChild(input); body.appendChild(compare); body.appendChild(h('div', { class: 'action-row' }, [run]));
        } else if (active === 'Regex Tester') {
          const flags = h('input', { class: 'input mono', type: 'text', value: 'gi', placeholder: 'Flags' });
          const source = h('textarea', { class: 'input mono', rows: '4', placeholder: 'Text to test' });
          body.appendChild(input); body.appendChild(flags); body.appendChild(source); body.appendChild(h('div', { class: 'action-row' }, [run]));
        } else {
          if (active === 'UUID Generator') input.value = '1';
          if (active === 'Password Generator') input.value = '20';
          body.appendChild(input); body.appendChild(h('div', { class: 'action-row' }, [run]));
        }
        body.appendChild(note); body.appendChild(output);
        body.appendChild(h('div', { class: 'action-row' }, [h('button', { class: 'btn btn-sm', type: 'button', text: 'Copy result', onclick: async () => { if (!output.value) return; await navigator.clipboard.writeText(output.value); api.toast('Copied', 'ok'); } })]));
      };
      root.appendChild(h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'Text & Data Utilities' }), h('p', { class: 'tool-desc', text: 'Local-only JSON, Base64, UUID, diff, regex and password tools.' })]));
      root.appendChild(tabs); root.appendChild(h('div', { class: 'group' }, [body]));
      drawTabs(); drawBody();
      return root;
    },
  });

  function makeTextDiff(a, b) {
    const left = a.split(/\r?\n/), right = b.split(/\r?\n/);
    if (left.length > 500 || right.length > 500) throw new Error('Diff is limited to 500 lines per side.');
    const dp = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
    for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--) dp[i][j] = left[i] === right[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const lines = []; let i = 0, j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) { lines.push(`  ${left[i++]}`); j++; }
      else if (j < right.length && (i === left.length || dp[i][j + 1] >= dp[i + 1][j])) lines.push(`+ ${right[j++]}`);
      else lines.push(`- ${left[i++]}`);
    }
    return lines.join('\n');
  }

  function makePassword(length) {
    const size = Math.min(Math.max(Number.isFinite(length) ? length : 20, 8), 128);
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+=';
    const bytes = new Uint32Array(size); crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => chars[byte % chars.length]).join('');
  }
})();
