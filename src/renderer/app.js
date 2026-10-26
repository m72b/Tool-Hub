(function () {
  document.documentElement.dataset.platform = window.hub.platform;
  const { h, clear, statusNote } = window.UI;
  const Hub = window.Hub;

  let catalog = null;
  let activeId = null;
  const FAVORITES_KEY = 'toolhub_favorites_v1';
  const RECENT_KEY = 'toolhub_recent_v1';
  const ACTIVITY_KEY = 'toolhub_activity_v1';
  const readList = key => { try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } };
  const writeList = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

  const sidebarEl = document.getElementById('sidebar');
  const contentEl = document.getElementById('content');
  const toastEl = document.getElementById('toast');

  let toastTimer = null;
  function toast(message, kind) {
    toastEl.textContent = message;
    toastEl.className = `toast show ${kind || 'info'}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.className = 'toast';
    }, 3600);
  }

  function apiFor(toolId) {
    const invokeAndLog = async (targetId, action, params, options) => {
      const result = await window.hub.invoke(targetId, action, params, options);
      if (result?.ok && ['rename', 'renameBatch', 'move', 'reverseMove', 'remove', 'clean', 'apply', 'write', 'saveHosts', 'saveEnv', 'removeEnv', 'fixExtensions', 'syncApply', 'shred', 'archive'].includes(action)) recordActivity(targetId, action, params || {}, result.data || {});
      return result;
    };
    return {
      invoke: (action, params, options) => invokeAndLog(toolId, action, params, options),
      invokeTool: (targetId, action, params) => invokeAndLog(targetId, action, params),
      cancel: jobId => window.hub.cancel(jobId),
      onProgress: (jobId, callback) => window.hub.onProgress(jobId, callback),
      toast,
      pickFolder: title => window.hub.pickFolder(title),
      pickFiles: () => window.hub.pickFiles(),
      reveal: target => window.hub.reveal(target),
      platform: window.hub.platform,
    };
  }

  function recordActivity(toolId, action, params, result) {
    let undo = null;
    if (toolId === 'organizer' && action === 'move' && result.from && result.to) undo = { toolId: 'organizer', action: 'reverseMove', params: { folder: params.folder, fromPath: result.to, toPath: result.from } };
    if (toolId === 'organizer' && action === 'reverseMove' && result.from && result.to) {
      const parts = result.to.split(/[\\/]/); const destination = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
      undo = { toolId: 'organizer', action: 'move', params: { folder: params.folder, fileName: parts[parts.length - 1], relativePath: result.from, destFolder: destination === '.' ? '' : destination } };
    }
    if (toolId === 'renamer' && action === 'rename' && params.folder && params.oldName && params.newName) {
      const currentPath = String(params.relativePath || params.oldName).replace(/[^\\/]+$/, () => params.newName);
      undo = { toolId: 'renamer', action: 'rename', params: { folder: params.folder, oldName: params.newName, newName: params.oldName, relativePath: currentPath } };
    }
    if (toolId === 'renamer' && action === 'renameBatch' && Array.isArray(params.items) && params.items.length <= 1000) {
      undo = { toolId: 'renamer', action: 'renameBatch', params: { folder: params.folder, items: params.items.map(item => ({ oldName: item.newName, newName: item.oldName, relativePath: String(item.relativePath || item.oldName).replace(/[^\\/]+$/, () => item.newName) })) } };
    }
    let events = readList(ACTIVITY_KEY);
    events.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, at: Date.now(), toolId, action, summary: summarizeAction(action, params, result), undo });
    events = events.slice(0, 100);
    while (events.length) { try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(events)); break; } catch { events.pop(); } }
  }

  function summarizeAction(action, params, result) {
    if (action === 'move') return `${result.from} → ${result.to}`;
    if (action === 'reverseMove') return `${result.from} → ${result.to}`;
    const list = params.paths || params.items;
    const count = Array.isArray(list) ? list.length : undefined;
    return count ? `${action}: ${count} item(s)` : action;
  }

  function openActivityLog() {
    const overlay = h('div', { class: 'palette-overlay' }), panel = h('div', { class: 'command-palette activity-panel', role: 'dialog', 'aria-modal': 'true' });
    const title = h('div', { class: 'group-head' }, [h('span', { class: 'group-title', text: 'Activity Log' }), h('span', { class: 'muted', text: 'Undo is available for recorded renames and Organizer moves.' }), h('button', { class: 'mini-btn', text: 'Close', onclick: () => overlay.remove() })]);
    const list = h('div', { class: 'command-list' });
    const events = readList(ACTIVITY_KEY);
    if (!events.length) list.appendChild(h('div', { class: 'command-empty', text: 'No file changes recorded yet.' }));
    for (const item of events) {
      const tool = catalog?.tools.find(entry => entry.id === item.toolId);
      const card = h('div', { class: 'activity-entry' }, [h('span', { class: 'activity-date', text: new Date(item.at).toLocaleString() }), h('strong', { text: `${tool?.name || item.toolId} · ${item.action}` }), h('span', { class: 'muted', text: item.summary || '' })]);
      if (item.undo) card.appendChild(h('button', { class: 'btn btn-sm', type: 'button', text: 'Undo', onclick: async e => {
        e.currentTarget.disabled = true;
        let result = await window.hub.invoke(item.undo.toolId, item.undo.action, item.undo.params);
        if (!result.ok && /Choose this folder or file using the app picker/i.test(result.error || '') && item.undo.params.folder) {
          const chosen = await window.hub.pickFolder('Select the original folder to authorize this undo');
          const same = chosen && (window.hub.platform === 'win32' ? chosen.toLowerCase() === item.undo.params.folder.toLowerCase() : chosen === item.undo.params.folder);
          if (same) result = await window.hub.invoke(item.undo.toolId, item.undo.action, item.undo.params);
        }
        if (!result.ok) { toast(`Undo failed: ${result.error}`, 'error'); e.currentTarget.disabled = false; return; }
        item.undo = null; writeList(ACTIVITY_KEY, events); toast('Change undone', 'ok'); overlay.remove();
      } }));
      list.appendChild(card);
    }
    panel.appendChild(title); panel.appendChild(list); overlay.appendChild(panel); overlay.addEventListener('mousedown', event => { if (event.target === overlay) overlay.remove(); }); document.body.appendChild(overlay);
  }

  function installedTools() {
    return catalog.tools.filter(t => t.installed && t.supported);
  }

  function renderSidebar() {
    clear(sidebarEl);
    const all = installedTools();
    const favorites = readList(FAVORITES_KEY).filter(id => all.some(tool => tool.id === id));
    const recent = readList(RECENT_KEY).filter(id => all.some(tool => tool.id === id)).slice(0, 5);
    const addQuickGroup = (label, ids) => {
      const tools = ids.map(id => all.find(tool => tool.id === id)).filter(Boolean);
      if (!tools.length) return;
      sidebarEl.appendChild(h('div', { class: 'nav-group-label', text: label }));
      for (const tool of tools) addNavItem(tool, favorites);
    };
    addQuickGroup('Favorites', favorites);
    addQuickGroup('Recent', recent);
    const groups = new Map();
    for (const tool of all) {
      if (!groups.has(tool.category)) groups.set(tool.category, []);
      groups.get(tool.category).push(tool);
    }

    for (const [category, tools] of groups) {
      sidebarEl.appendChild(h('div', { class: 'nav-group-label', text: category }));
      for (const tool of tools) {
        addNavItem(tool, favorites);
      }
    }

    sidebarEl.appendChild(h('div', { class: 'nav-spacer' }));
    sidebarEl.appendChild(h('button', {
      class: `nav-item nav-manage${activeId === '__library' ? ' active' : ''}`,
      type: 'button',
      onclick: openLibrary,
    }, [
      h('span', { class: 'nav-icon', text: '+' }),
      h('span', { class: 'nav-text', text: 'Tool Library' }),
    ]));
  }

  function addNavItem(tool, favorites = readList(FAVORITES_KEY)) {
    sidebarEl.appendChild(h('div', { class: 'nav-row' }, [
      h('button', { class: `nav-item${tool.id === activeId ? ' active' : ''}`, type: 'button', onclick: () => openTool(tool.id) }, [h('span', { class: 'nav-icon', text: tool.icon }), h('span', { class: 'nav-text', text: tool.name })]),
      h('button', { class: `nav-favorite${favorites.includes(tool.id) ? ' active' : ''}`, type: 'button', title: favorites.includes(tool.id) ? 'Remove favorite' : 'Add favorite', text: favorites.includes(tool.id) ? '★' : '☆', onclick: e => { e.stopPropagation(); const next = readList(FAVORITES_KEY); const index = next.indexOf(tool.id); if (index >= 0) next.splice(index, 1); else next.unshift(tool.id); writeList(FAVORITES_KEY, next); renderSidebar(); } }),
    ]));
  }

  function openTool(id) {
    const tool = catalog.tools.find(t => t.id === id);
    if (!tool || !tool.installed || !tool.supported) {
      openLibrary();
      return;
    }
    activeId = id;
    const recent = readList(RECENT_KEY).filter(item => item !== id);
    recent.unshift(id); writeList(RECENT_KEY, recent.slice(0, 10));
    renderSidebar();
    clear(contentEl);
    const def = Hub.getView(id);
    if (!def) {
      contentEl.appendChild(h('div', { class: 'tool' }, [
        h('div', { class: 'tool-head' }, [
          h('h1', { class: 'tool-title', text: tool.name }),
          h('p', { class: 'tool-desc', text: tool.description }),
        ]),
        statusNote('This tool has no interface registered.', 'error'),
      ]));
      return;
    }
    contentEl.appendChild(def.render(apiFor(id), { tool, toast, openLibrary }));
    contentEl.scrollTop = 0;
  }

  function toolCard(tool, selected, onToggle) {
    const disabled = !tool.supported || tool.core;
    const box = h('input', {
      type: 'checkbox',
      checked: selected,
      disabled,
      onchange: e => onToggle(tool.id, e.target.checked),
    });
    return h('label', {
      class: `tool-card${selected ? ' selected' : ''}${disabled ? ' locked' : ''}`,
    }, [
      h('div', { class: 'tool-card-top' }, [
        h('span', { class: 'tool-card-icon', text: tool.icon }),
        h('span', { class: 'tool-card-name', text: tool.name }),
        box,
      ]),
      h('p', { class: 'tool-card-desc', text: tool.description }),
      h('div', { class: 'tool-card-tags' }, [
        h('span', { class: 'tag', text: tool.category }),
        tool.core ? h('span', { class: 'tag tag-core', text: 'Always installed' }) : null,
        !tool.supported ? h('span', { class: 'tag tag-warn', text: 'Windows only' }) : null,
      ]),
    ]);
  }

  function renderPicker(options) {
    const selection = new Set(catalog.tools.filter(t => t.installed).map(t => t.id));
    const container = h('div', { class: 'picker' });

    const onToggle = (id, on) => {
      if (on) selection.add(id);
      else selection.delete(id);
      draw();
    };

    const draw = () => {
      clear(container);
      container.appendChild(h('div', { class: 'picker-head' }, [
        h('h1', { class: 'tool-title', text: options.title }),
        h('p', { class: 'tool-desc', text: options.description }),
      ]));

      const count = catalog.tools.filter(t => selection.has(t.id) && t.supported).length;
      const actions = h('div', { class: 'picker-actions' }, [
        h('button', {
          class: 'btn btn-sm', type: 'button', text: 'Select all',
          onclick: () => {
            for (const t of catalog.tools) if (t.supported) selection.add(t.id);
            draw();
          },
        }),
        h('button', {
          class: 'btn btn-sm', type: 'button', text: 'Only essentials',
          onclick: () => {
            selection.clear();
            for (const t of catalog.tools) if (t.core) selection.add(t.id);
            draw();
          },
        }),
        h('span', { class: 'picker-count', text: `${count} selected` }),
        h('button', {
          class: 'btn btn-accent', type: 'button', text: options.confirmLabel,
          onclick: async () => {
            catalog = await window.hub.tools.setInstalled(Array.from(selection), true);
            toast('Tool selection saved', 'ok');
            const first = installedTools()[0];
            const pendingFolder = options.afterSave === 'open' ? await window.hub.takeOpenFolder() : null;
            if (options.afterSave === 'open' && pendingFolder) { openTool(installedTools().some(t => t.id === 'renamer') ? 'renamer' : first?.id); document.dispatchEvent(new CustomEvent('hub-folder-drop', { detail: pendingFolder })); }
            else if (options.afterSave === 'open' && first) openTool(first.id);
            else openLibrary();
          },
        }),
      ]);
      container.appendChild(actions);

      for (const category of catalog.categories) {
        const tools = catalog.tools.filter(t => t.category === category);
        if (tools.length === 0) continue;
        container.appendChild(h('div', { class: 'picker-group' }, [
          h('div', { class: 'picker-group-label', text: category }),
          h('div', { class: 'tool-grid' }, tools.map(t => toolCard(t, selection.has(t.id), onToggle))),
        ]));
      }
    };

    draw();
    return container;
  }

  function openLibrary() {
    activeId = '__library';
    renderSidebar();
    clear(contentEl);
    contentEl.appendChild(renderPicker({
      title: 'Tool Library',
      description: 'Choose which tools are installed. Uninstalled tools are never loaded, so they use no memory.',
      confirmLabel: 'Save changes',
      afterSave: 'library',
    }));
    contentEl.scrollTop = 0;
  }

  function openSetup() {
    activeId = null;
    clear(sidebarEl);
    clear(contentEl);
    contentEl.appendChild(renderPicker({
      title: 'Welcome — choose your tools',
      description: 'Pick the tools you want installed. You can add or remove them at any time from the Tool Library.',
      confirmLabel: 'Install selected',
      afterSave: 'open',
    }));
  }

  const THEMES = ['midnight', 'graphite', 'nord', 'vector', 'forest', 'daylight'];
  const SHAPES = ['soft', 'sharp', 'angular'];
  const APPEARANCE_KEY = 'toolhub_appearance_v1';

  function loadAppearance() {
    try {
      const s = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || '{}');
      return {
        theme: THEMES.includes(s.theme) ? s.theme : 'midnight',
        shape: SHAPES.includes(s.shape) ? s.shape : 'soft',
      };
    } catch {
      return { theme: 'midnight', shape: 'soft' };
    }
  }

  let appearance = loadAppearance();

  function applyAppearance() {
    document.documentElement.dataset.theme = appearance.theme;
    document.documentElement.dataset.shape = appearance.shape;
    document.querySelectorAll('[data-set-theme]').forEach(b => b.classList.toggle('active', b.dataset.setTheme === appearance.theme));
    document.querySelectorAll('[data-set-shape]').forEach(b => b.classList.toggle('active', b.dataset.setShape === appearance.shape));
    try {
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
    } catch {
      toast('Could not save appearance', 'error');
    }
  }

  function setupChrome() {
    if (window.hub.platform !== 'darwin') {
      document.getElementById('titlebar').style.display = 'flex';
      document.getElementById('tbMin').onclick = () => window.hub.window.minimize();
      document.getElementById('tbMax').onclick = () => window.hub.window.maximize();
      document.getElementById('tbClose').onclick = () => window.hub.window.close();
    }

    const panel = document.getElementById('settingsPanel');
    const btn = document.getElementById('settingsBtn');
    btn.onclick = () => panel.classList.toggle('open');
    document.addEventListener('click', e => {
      if (!panel.classList.contains('open')) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      panel.classList.remove('open');
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') panel.classList.remove('open');
    });

    document.getElementById('themeGrid').onclick = e => {
      const target = e.target.closest('[data-set-theme]');
      if (!target) return;
      appearance.theme = target.dataset.setTheme;
      applyAppearance();
    };
    document.getElementById('shapeGrid').onclick = e => {
      const target = e.target.closest('[data-set-shape]');
      if (!target) return;
      appearance.shape = target.dataset.setShape;
      applyAppearance();
    };
    document.getElementById('libraryBtn').onclick = () => {
      panel.classList.remove('open');
      openLibrary();
    };
    document.getElementById('activityBtn').onclick = () => { panel.classList.remove('open'); openActivityLog(); };
    const portableBtn = document.getElementById('portableBtn');
    const portableHint = document.getElementById('portableHint');
    window.hub.portableMode().then(mode => {
      portableBtn.disabled = !mode.supported;
      portableBtn.textContent = mode.enabled ? 'Disable portable mode' : 'Enable portable mode';
      portableHint.textContent = mode.supported ? (mode.enabled ? 'Settings are stored in the app folder. Restart to switch modes.' : 'Enable to store settings in a data folder next to the app.') : 'Portable mode is available in a packaged app.';
    });
    portableBtn.onclick = async () => {
      if (!window.confirm('Changing storage location restarts Tool Hub. Continue?')) return;
      const result = await window.hub.togglePortable();
      if (!result.ok) toast(result.error, 'error');
    };
    document.getElementById('commandBtn').onclick = openCommandPalette;
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openCommandPalette(); }
    });
    const content = document.getElementById('content');
    content.addEventListener('dragover', event => { event.preventDefault(); content.classList.add('drop-active'); });
    content.addEventListener('dragleave', event => { if (!content.contains(event.relatedTarget)) content.classList.remove('drop-active'); });
    content.addEventListener('drop', async event => {
      event.preventDefault(); content.classList.remove('drop-active');
      const item = Array.from(event.dataTransfer.files || [])[0];
      if (!item) return;
      const droppedPath = window.hub.getPathForFile(item);
      const approved = await window.hub.approveDrop(droppedPath);
      if (!approved) return;
      content.querySelectorAll('.field-row').forEach(row => row.dispatchEvent(new CustomEvent('hub-folder-drop', { bubbles: true, detail: approved })));
      toast('Dropped folder added to the current tool', 'ok');
    });
  }

  function openCommandPalette() {
    if (!catalog) return;
    const overlay = h('div', { class: 'palette-overlay' });
    const panel = h('div', { class: 'command-palette', role: 'dialog', 'aria-modal': 'true' });
    const input = h('input', { class: 'input command-input', type: 'text', placeholder: 'Search tools…', autocomplete: 'off' });
    const list = h('div', { class: 'command-list' });
    const tools = installedTools();
    const draw = () => {
      clear(list);
      const query = input.value.trim().toLowerCase();
      const favorites = readList(FAVORITES_KEY), recent = readList(RECENT_KEY);
      const found = tools.filter(tool => !query || `${tool.name} ${tool.category} ${tool.description}`.toLowerCase().includes(query))
        .sort((a, b) => (favorites.includes(b.id) - favorites.includes(a.id)) || ((recent.indexOf(a.id) < 0 ? 999 : recent.indexOf(a.id)) - (recent.indexOf(b.id) < 0 ? 999 : recent.indexOf(b.id))) || a.name.localeCompare(b.name));
      if (!found.length) list.appendChild(h('div', { class: 'command-empty', text: 'No installed tools match.' }));
      for (const tool of found.slice(0, 40)) list.appendChild(h('button', { class: 'command-item', type: 'button', onclick: () => { overlay.remove(); openTool(tool.id); } }, [h('span', { class: 'nav-icon', text: tool.icon }), h('span', { text: tool.name }), h('span', { class: 'muted', text: tool.category })]));
    };
    input.addEventListener('input', draw);
    panel.appendChild(input); panel.appendChild(list); overlay.appendChild(panel);
    overlay.addEventListener('mousedown', event => { if (event.target === overlay) overlay.remove(); });
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') overlay.remove(); });
    document.body.appendChild(overlay); draw(); input.focus();
  }

  async function start() {
    setupChrome();
    applyAppearance();
    catalog = await window.hub.tools.catalog();
    if (!catalog.setupComplete) {
      openSetup();
      return;
    }
    renderSidebar();
    const pendingFolder = await window.hub.takeOpenFolder();
    if (pendingFolder) { openTool(installedTools().some(t => t.id === 'renamer') ? 'renamer' : installedTools()[0]?.id); document.dispatchEvent(new CustomEvent('hub-folder-drop', { detail: pendingFolder })); }
    else if (installedTools()[0]) openTool(installedTools()[0].id);
    else openLibrary();
  }

  window.HubApp = { toast, openLibrary };
  start();
})();
