// Sections screen: download, update and remove add-ons, and manage trusted signing keys.
// Also used as the first-run screen.
(function () {
  const { h, clear, statusNote, fmtBytes } = window.UI;
  const RELEASES = 'https://github.com/m72b/Tool-Hub/releases';

  function isNewer(a, b) {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  }

  function confirmInstall(picked, toast) {
    const { info } = picked;
    const bg = h('div', { class: 'modal-bg open' });
    const close = () => bg.remove();
    const installBtn = h('button', { class: 'btn btn-accent', type: 'button', text: info.replaces ? `Update to ${info.manifest.version}` : 'Install add-on', disabled: !!info.problem, onclick: async () => {
      installBtn.disabled = true;
      installBtn.textContent = 'Installing…';
      const result = await window.hub.addons.install(picked.token);
      if (!result.ok) { toast(result.error, 'error'); installBtn.disabled = false; installBtn.textContent = 'Install add-on'; return; }
      clear(box);
      box.appendChild(h('div', { class: 'modal-title', text: `${info.manifest.name} installed` }));
      box.appendChild(h('p', { class: 'tool-desc', text: 'Tool Hub is restarting to load it…' }));
    } });
    const box = h('div', { class: 'modal-box' }, [
      h('div', { class: 'modal-title', text: `Install ${info.manifest.name}?` }),
      h('div', { class: 'kv' }, [h('span', { class: 'kv-label', text: 'Version' }), h('span', { class: 'kv-value', text: info.replaces ? `${info.manifest.version} (replaces ${info.replaces})` : info.manifest.version })]),
      h('div', { class: 'kv' }, [h('span', { class: 'kv-label', text: 'Signed by' }), h('span', { class: 'kv-value', text: info.signer })]),
      info.authorizer ? h('div', { class: 'kv' }, [h('span', { class: 'kv-label', text: 'Authorized by' }), h('span', { class: 'kv-value', text: info.authorizer })]) : null,
      h('div', { class: 'kv' }, [h('span', { class: 'kv-label', text: 'Adds' }), h('span', { class: 'kv-value', text: info.manifest.tools.map(tool => tool.name).join(', ') })]),
      info.manifest.description ? h('p', { class: 'tool-desc', text: info.manifest.description }) : null,
      info.builtIn ? null : statusNote('This add-on is signed with a personal key you trusted, not the official Tool Hub key. It can read and change your files like any other tool.', 'warn'),
      info.problem ? statusNote(`Cannot install: this add-on ${info.problem}.`, 'error') : null,
      statusNote('Tool Hub restarts after installing.', 'info'),
      h('div', { class: 'action-row' }, [installBtn, h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: close })]),
    ]);
    bg.appendChild(box);
    bg.addEventListener('mousedown', event => { if (event.target === bg) close(); });
    document.body.appendChild(bg);
  }

  function keysPanel(data, toast, redraw) {
    const keyName = h('input', { class: 'input', type: 'text', placeholder: 'Who is this key from?' });
    const keyValue = h('textarea', { class: 'input mono', rows: '2', spellcheck: 'false', placeholder: 'Paste the public key (base64 or PEM)' });
    const body = h('div', { class: 'group-body' }, [
      ...data.keys.map(key => h('div', { class: 'key-row' }, [
        h('span', { class: 'key-name', text: key.name }),
        h('span', { class: 'mono muted', text: key.keyId, title: 'Key fingerprint' }),
        key.builtIn ? h('span', { class: 'tag tag-core', text: 'Built in' }) : h('button', { class: 'mini-btn mini-danger', type: 'button', text: 'Remove', onclick: async () => {
          if (!window.confirm(`Stop trusting "${key.name}"? Add-ons already installed stay installed.`)) return;
          const result = await window.hub.addons.untrustKey(key.keyId);
          if (!result.ok) toast(result.error, 'error'); else redraw();
        } }),
      ])),
      statusNote('Only trust keys from people you know. A trusted key can sign add-ons that run with full access to your files.', 'warn'),
      keyName, keyValue,
      h('div', { class: 'action-row' }, [h('button', { class: 'btn btn-sm', type: 'button', text: 'Trust this key', onclick: async () => {
        const result = await window.hub.addons.trustKey(keyName.value, keyValue.value);
        if (!result.ok) { toast(result.error, 'error'); return; }
        toast('Key trusted', 'ok');
        redraw();
      } })]),
    ]);
    return h('details', { class: 'group more-options-card' }, [h('summary', { class: 'group-head' }, [h('span', { class: 'group-title', text: `Trusted keys (${data.keys.length})` })]), body]);
  }

  function render(toast, options = {}) {
    const setup = options.setup === true;
    const legacy = new Set(options.legacyTools || []);
    const wrap = h('div', { class: 'picker-group' });
    const status = h('div');
    const selected = new Set();
    let preselected = false;

    async function download(ids) {
      clear(status);
      const stop = window.hub.addons.onProgress(progress => {
        clear(status);
        const percent = progress.total ? ` ${Math.min(100, Math.round(progress.received * 100 / progress.total))}%` : '';
        status.appendChild(h('div', { class: 'run-status', text: `Downloading ${progress.id}…${percent}` }));
      });
      const result = await window.hub.addons.download(ids);
      stop();
      clear(status);
      for (const item of result.failed || []) status.appendChild(statusNote(`${item.name || item.id}: ${item.error}`, 'error'));
      if (result.error) status.appendChild(statusNote(result.error, 'error'));
      if (result.restarting) status.appendChild(statusNote('Installed. Tool Hub is restarting…', 'ok'));
      return result;
    }

    function sectionCard(row) {
      const { entry, installed } = row;
      const info = entry || installed;
      const update = installed && entry && isNewer(entry.version, installed.version);
      const toolNames = (info.tools || []).map(tool => tool.name).join(', ');
      const toolCount = (info.tools || []).length;
      const box = setup && !installed ? h('input', { type: 'checkbox', checked: selected.has(info.id), onchange: e => { if (e.target.checked) selected.add(info.id); else selected.delete(info.id); } }) : null;
      const action = (text, cls, run) => h('button', { class: cls, type: 'button', text, onclick: async e => {
        const button = e.currentTarget;
        button.disabled = true;
        await run();
        button.disabled = false;
      } });
      return h(box ? 'label' : 'div', { class: `tool-card${installed ? ' selected' : ''}` }, [
        h('div', { class: 'tool-card-top' }, [
          h('span', { class: 'tool-card-icon', text: info.name.slice(0, 2).toUpperCase() }),
          h('span', { class: 'tool-card-name', text: info.name }),
          box || h('span', { class: 'tag', text: `v${installed ? installed.version : info.version}` }),
        ]),
        h('p', { class: 'tool-card-desc', text: info.description || toolNames, title: toolNames }),
        installed?.problem ? statusNote(`Disabled: ${installed.problem}.`, 'warn') : null,
        h('div', { class: 'tool-card-tags' }, [
          h('span', { class: 'tag', text: `${toolCount} tool${toolCount === 1 ? '' : 's'}` }),
          entry?.size ? h('span', { class: 'tag', text: fmtBytes(entry.size) }) : null,
          installed ? h('span', { class: 'tag', text: `Signed by ${installed.signer}` }) : null,
          installed?.authorizer ? h('span', { class: 'tag tag-ok', text: `Authorized by ${installed.authorizer}` }) : null,
          !setup && !installed ? action('Download', 'mini-btn', () => download([info.id])) : null,
          update ? action(`Update to ${entry.version}`, 'mini-btn', () => download([info.id])) : null,
          installed ? action('Remove', 'mini-btn mini-danger', async () => {
            if (!window.confirm(`Remove ${info.name}? Its tools disappear and Tool Hub restarts. Your files are not affected.`)) return;
            const result = await window.hub.addons.remove(info.id);
            if (!result.ok) toast(result.error, 'error'); else toast('Removed; restarting…', 'ok');
          }) : null,
        ]),
      ]);
    }

    const draw = async () => {
      const [data, online] = await Promise.all([window.hub.addons.list(), window.hub.addons.catalog()]);
      const rows = new Map();
      for (const entry of online.entries || []) rows.set(entry.id, { entry });
      for (const addon of data.addons) rows.set(addon.id, { ...(rows.get(addon.id) || {}), installed: addon });
      if (setup && !preselected) {
        preselected = true;
        for (const row of rows.values()) if (!row.installed && (row.entry?.tools || []).some(tool => legacy.has(tool.id))) selected.add(row.entry.id);
      }
      clear(wrap);
      wrap.appendChild(h('div', { class: 'picker-group-label', text: 'Sections' }));
      const updates = [...rows.values()].filter(row => row.installed && row.entry && isNewer(row.entry.version, row.installed.version)).map(row => row.entry.id);
      const addFile = h('button', { class: `btn btn-sm${setup ? '' : ' btn-accent'}`, type: 'button', text: 'Add add-on…', onclick: async () => {
        const picked = await window.hub.addons.pick();
        if (!picked) return;
        if (!picked.ok) { toast(picked.error, 'error'); return; }
        confirmInstall(picked, toast);
      } });
      const offline = h('input', { type: 'checkbox', checked: data.offline === true, onchange: async e => { await window.hub.addons.setOffline(e.target.checked); draw(); } });
      wrap.appendChild(h('div', { class: 'action-row' }, [
        addFile,
        updates.length ? h('button', { class: 'btn btn-sm btn-accent', type: 'button', text: `Update all (${updates.length})`, onclick: () => download(updates) }) : null,
        h('label', { class: 'field field-inline' }, [offline, h('span', { text: 'Never connect to the internet' })]),
      ]));
      if (online.offline) wrap.appendChild(statusNote('Offline mode is on, so Tool Hub is not checking for sections or updates. You can still use Add add-on with a downloaded .thaddon file.', 'info'));
      else if (!online.ok) wrap.appendChild(h('div', { class: 'note note-warn' }, [h('span', { text: `${online.error} You can still download .thaddon files from ` }), h('a', { href: RELEASES, target: '_blank', rel: 'noreferrer', text: 'GitHub Releases' }), h('span', { text: ' and use Add add-on.' })]));
      if (rows.size) wrap.appendChild(h('div', { class: 'tool-grid' }, [...rows.values()].map(sectionCard)));
      else wrap.appendChild(h('div', { class: 'empty-state', text: 'No sections installed yet.' }));
      wrap.appendChild(status);
      if (setup) {
        const go = h('button', { class: 'btn btn-accent', type: 'button', text: 'Continue', onclick: async () => {
          go.disabled = true;
          const updated = await window.hub.addons.finishSetup();
          if (selected.size) {
            const result = await download([...selected]);
            if (result.restarting) return;
          }
          options.onDone(updated);
        } });
        wrap.appendChild(h('div', { class: 'action-row' }, [go, h('span', { class: 'field-hint', text: 'Tick the sections to download, or continue with what is installed.' })]));
      } else wrap.appendChild(keysPanel(data, toast, draw));
    };
    draw();
    return wrap;
  }

  window.AddonManagerUI = { render };
})();
