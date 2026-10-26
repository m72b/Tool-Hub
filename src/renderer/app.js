(function () {
  document.documentElement.dataset.platform = window.hub.platform;
  const { h, clear, statusNote } = window.UI;
  const Hub = window.Hub;

  let catalog = null;
  let activeId = null;

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
    return {
      invoke: (action, params) => window.hub.invoke(toolId, action, params),
      toast,
      pickFolder: title => window.hub.pickFolder(title),
      pickFiles: () => window.hub.pickFiles(),
      reveal: target => window.hub.reveal(target),
      platform: window.hub.platform,
    };
  }

  function installedTools() {
    return catalog.tools.filter(t => t.installed && t.supported);
  }

  function renderSidebar() {
    clear(sidebarEl);
    const groups = new Map();
    for (const tool of installedTools()) {
      if (!groups.has(tool.category)) groups.set(tool.category, []);
      groups.get(tool.category).push(tool);
    }

    for (const [category, tools] of groups) {
      sidebarEl.appendChild(h('div', { class: 'nav-group-label', text: category }));
      for (const tool of tools) {
        sidebarEl.appendChild(h('button', {
          class: `nav-item${tool.id === activeId ? ' active' : ''}`,
          type: 'button',
          onclick: () => openTool(tool.id),
        }, [
          h('span', { class: 'nav-icon', text: tool.icon }),
          h('span', { class: 'nav-text', text: tool.name }),
        ]));
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

  function openTool(id) {
    const tool = catalog.tools.find(t => t.id === id);
    if (!tool || !tool.installed || !tool.supported) {
      openLibrary();
      return;
    }
    activeId = id;
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
            if (options.afterSave === 'open' && first) openTool(first.id);
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
    const first = installedTools()[0];
    if (first) openTool(first.id);
    else openLibrary();
  }

  window.HubApp = { toast, openLibrary };
  start();
})();
