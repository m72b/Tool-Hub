(function () {
  const { h, clear, table, empty, statusNote, stat, fmtBytes, fmtNumber, toolShell, downloadFile } = window.UI;
  const Hub = window.Hub;

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
                if (!window.confirm(`Stop ${item.process || 'PID ' + item.pid} and its child processes? Windows will force-stop the entire process tree; unsaved work may be lost.`)) return;
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

  Hub.registerView('file-locks', { render(api) {
    const root = h('div', { class: 'tool' }), results = h('div', { class: 'results' });
    const chosen = h('span', { class: 'muted', text: 'No file selected' }); let filePath = '';
    const pick = h('button', { class: 'btn btn-sm', type: 'button', text: 'Choose file…', onclick: async () => { const files = await api.pickFiles(); if (files?.[0]) { filePath = files[0].path; chosen.textContent = files[0].path; } } });
    const check = h('button', { class: 'btn btn-accent', type: 'button', text: 'Check for locks', onclick: async () => {
      if (!filePath) { api.toast('Choose a file first', 'error'); return; }
      check.disabled = true; const result = await api.invoke('locking', { path: filePath }); check.disabled = false; clear(results);
      if (!result.ok) { results.appendChild(statusNote(result.error, 'error')); return; }
      const items = Array.isArray(result.data.processes) ? result.data.processes : (result.data.processes ? [result.data.processes] : []);
      if (!items.length) results.appendChild(empty('No locking process was found.'));
      else results.appendChild(table([{ label: 'Process', width: 'minmax(0,1fr)' }, { label: 'PID', width: '100px' }], items.map(item => h('div', { class: 'tbl-row' }, [h('span', { text: item.Process || item.process || 'Unknown' }), h('span', { class: 'mono', text: String(item.Pid || item.pid) })]))));
    } });
    root.appendChild(h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'File Lock Finder' }), h('p', { class: 'tool-desc', text: 'Ask Windows Restart Manager which processes are using a file. This does not close them.' })]));
    root.appendChild(h('div', { class: 'action-row' }, [pick, chosen, check])); root.appendChild(results); return root;
  } });

  Hub.registerView('disk-benchmark', { render(api) {
    return toolShell({
      title: 'Disk Benchmark', description: 'Write and read a temporary test file, then remove it. Results are sequential speed estimates and can vary with cache, encryption, and background load.',
      action: 'run', runLabel: 'Start benchmark', busyLabel: 'Benchmarking…', defaults: { root: '', sizeMiB: 128 },
      fields: [{ type: 'folder', key: 'root', label: 'Drive folder to test', wide: true }, { type: 'select', key: 'sizeMiB', label: 'Test file size', numeric: true, options: [64, 128, 256, 512].map(size => ({ label: `${size} MiB`, value: size })) }],
      validate: state => state.root ? null : 'Choose a folder on the drive to test', params: state => ({ root: state.root, sizeMiB: state.sizeMiB }),
      render(data) { return h('div', { class: 'stat-row' }, [stat('Sequential write', `${data.writeMiBs} MiB/s`), stat('Sequential read', `${data.readMiBs} MiB/s`), stat('Test size', `${data.sizeMiB} MiB`)]); },
    }, api);
  } });
})();
