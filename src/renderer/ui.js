const Hub = {
  views: new Map(),
  registerView(id, def) {
    this.views.set(id, def);
  },
  getView(id) {
    return this.views.get(id) || null;
  },
};

function h(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'dataset') for (const [d, v] of Object.entries(value)) node.dataset[d] = v;
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, value);
    }
  }
  const list = Array.isArray(children) ? children : (children === undefined || children === null ? [] : [children]);
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

function fmtBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const value = n / Math.pow(1024, i);
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

function fmtDate(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  const d = new Date(n);
  const pad = v => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : '—';
}

function baseName(p) {
  const s = String(p || '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i >= 0 ? s.slice(i + 1) : s;
}

function dirName(p) {
  const s = String(p || '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i > 0 ? s.slice(0, i) : s;
}

function table(columns, rows) {
  const head = h('div', { class: 'tbl-head' }, columns.map(c => h('span', { class: c.cls || '', text: c.label })));
  const body = h('div', { class: 'tbl-body' }, rows);
  const wrap = h('div', { class: 'tbl' }, [head, body]);
  wrap.style.setProperty('--cols', columns.map(c => c.width || '1fr').join(' '));
  return wrap;
}

function row(columns, cells, attrs) {
  return h('div', { class: `tbl-row${attrs && attrs.class ? ' ' + attrs.class : ''}`, ...(attrs || {}) }, cells);
}

function empty(message) {
  return h('div', { class: 'empty-state', text: message });
}

function statusNote(message, kind) {
  return h('div', { class: `note note-${kind || 'info'}`, text: message });
}

function stat(label, value, kind) {
  return h('div', { class: 'stat' }, [
    h('span', { class: 'stat-label', text: label }),
    h('span', { class: `stat-value${kind ? ' stat-' + kind : ''}`, text: value }),
  ]);
}

function bar(percent, kind) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const fill = h('span', { class: `bar-fill${kind ? ' bar-' + kind : ''}` });
  fill.style.width = `${pct}%`;
  return h('span', { class: 'bar' }, fill);
}

function buildField(field, state, onChange) {
  const id = `f-${field.key}-${Math.random().toString(36).slice(2, 7)}`;
  let control;

  if (field.type === 'folder') {
    const display = h('span', { class: 'path-display empty', text: field.placeholder || 'No folder selected' });
    const pick = h('button', {
      class: 'btn btn-sm',
      type: 'button',
      text: 'Choose…',
      onclick: async () => {
        const chosen = await window.hub.pickFolder(field.label);
        if (!chosen) return;
        state[field.key] = chosen;
        display.textContent = chosen;
        display.classList.remove('empty');
        if (onChange) onChange();
      },
    });
    if (state[field.key]) {
      display.textContent = state[field.key];
      display.classList.remove('empty');
    }
    control = h('div', { class: 'field-row' }, [pick, display]);
  } else if (field.type === 'select') {
    const sel = h('select', {
      class: 'input',
      id,
      onchange: e => {
        state[field.key] = field.numeric ? Number(e.target.value) : e.target.value;
        if (onChange) onChange();
      },
    }, field.options.map(o => h('option', { value: String(o.value), text: o.label, selected: String(o.value) === String(state[field.key]) })));
    control = sel;
  } else if (field.type === 'number') {
    control = h('input', {
      class: 'input',
      id,
      type: 'number',
      min: field.min !== undefined ? String(field.min) : null,
      max: field.max !== undefined ? String(field.max) : null,
      step: field.step || 'any',
      value: state[field.key] !== undefined ? String(state[field.key]) : '',
      placeholder: field.placeholder || '',
      oninput: e => {
        state[field.key] = e.target.value === '' ? '' : Number(e.target.value);
        if (onChange) onChange();
      },
    });
  } else if (field.type === 'text') {
    control = h('input', {
      class: 'input',
      id,
      type: 'text',
      value: state[field.key] || '',
      placeholder: field.placeholder || '',
      spellcheck: 'false',
      oninput: e => {
        state[field.key] = e.target.value;
        if (onChange) onChange();
      },
    });
  } else if (field.type === 'date') {
    control = h('input', {
      class: 'input',
      id,
      type: 'datetime-local',
      value: state[field.key] || '',
      oninput: e => {
        state[field.key] = e.target.value;
        if (onChange) onChange();
      },
    });
  } else if (field.type === 'checkbox') {
    const input = h('input', {
      type: 'checkbox',
      id,
      checked: state[field.key] === true,
      onchange: e => {
        state[field.key] = e.target.checked;
        if (onChange) onChange();
      },
    });
    return h('label', { class: 'field field-inline', for: id }, [input, h('span', { text: field.label })]);
  }

  return h('div', { class: `field${field.wide ? ' field-wide' : ''}` }, [
    h('label', { class: 'field-label', for: id, text: field.label }),
    control,
    field.hint ? h('span', { class: 'field-hint', text: field.hint }) : null,
  ]);
}

function toolShell(def, api) {
  const state = { ...(def.defaults || {}) };
  const results = h('div', { class: 'results' });
  const status = h('div', { class: 'run-status' });

  const setBusy = (busy, label) => {
    runBtn.disabled = busy;
    runBtn.textContent = busy ? (label || 'Working…') : def.runLabel || 'Run';
    status.textContent = busy ? (label || 'Working…') : '';
  };

  const render = data => {
    clear(results);
    try {
      const out = def.render(data, { ...api, state, rerun: run });
      if (out) results.appendChild(out);
    } catch (err) {
      results.appendChild(statusNote(`Could not display results: ${err.message}`, 'error'));
    }
  };

  const run = async () => {
    if (def.validate) {
      const problem = def.validate(state);
      if (problem) {
        api.toast(problem, 'error');
        return;
      }
    }
    setBusy(true, def.busyLabel);
    const params = def.params ? def.params(state) : { ...state };
    const res = await api.invoke(def.action, params);
    setBusy(false);
    if (!res.ok) {
      clear(results);
      results.appendChild(statusNote(res.error, 'error'));
      return;
    }
    render(res.data);
  };

  const fields = (def.fields || []).map(f => buildField(f, state, def.liveRun ? run : null));
  const runBtn = h('button', { class: 'btn btn-accent', type: 'button', text: def.runLabel || 'Run', onclick: run });

  const controls = h('div', { class: 'controls' }, [
    h('div', { class: 'controls-fields' }, fields),
    h('div', { class: 'controls-actions' }, [runBtn, status]),
  ]);

  const root = h('div', { class: 'tool' }, [
    h('div', { class: 'tool-head' }, [
      h('h1', { class: 'tool-title', text: def.title }),
      h('p', { class: 'tool-desc', text: def.description }),
    ]),
    controls,
    results,
  ]);

  if (def.autoRun) run();
  return root;
}

window.Hub = Hub;
window.UI = {
  h, clear, fmtBytes, fmtDate, fmtNumber, baseName, dirName,
  table, row, empty, statusNote, stat, bar, buildField, toolShell,
};
