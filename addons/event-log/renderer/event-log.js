// Event Log Analyzer screen.
(function () {
  const { h, clear, statusNote, fmtDate, fmtNumber, empty } = window.UI;
  const LEVELS = [[1, 'Critical'], [2, 'Error'], [3, 'Warning'], [4, 'Information']];
  const RANGES = [[60, 'Last hour'], [1440, 'Last 24 hours'], [10080, 'Last 7 days'], [43200, 'Last 30 days'], [0, 'All time'], [-1, 'Custom range']];
  const stamp = ms => { const d = new Date(ms); return `${fmtDate(ms)}:${String(d.getSeconds()).padStart(2, '0')}`; };

  window.Hub.registerView('event-log-analyzer', {
    render(api) {
      const view = { levels: new Set([1, 2, 3]), tab: 'events', data: null, text: '' };
      const logSelect = h('select', { class: 'input' }, [h('option', { value: 'System', text: 'System' }), h('option', { value: 'Application', text: 'Application' })]);
      const range = h('select', { class: 'input', onchange: () => { customRange.hidden = range.value !== '-1'; } }, RANGES.map(([value, label]) => h('option', { value: String(value), text: label, selected: value === 1440 })));
      const from = h('input', { class: 'input', type: 'datetime-local' });
      const to = h('input', { class: 'input', type: 'datetime-local' });
      const customRange = h('div', { class: 'ev-row', hidden: true }, [h('label', { class: 'field' }, [h('span', { class: 'field-label', text: 'From' }), from]), h('label', { class: 'field' }, [h('span', { class: 'field-label', text: 'To' }), to])]);
      const provider = h('input', { class: 'input', type: 'text', placeholder: 'Any source', list: 'ev-sources', spellcheck: 'false' });
      const sources = h('datalist', { id: 'ev-sources' });
      const eventId = h('input', { class: 'input', type: 'number', min: '0', max: '65535', placeholder: 'Any' });
      const limit = h('select', { class: 'input' }, [500, 1000, 2500, 5000].map(value => h('option', { value: String(value), text: fmtNumber(value), selected: value === 1000 })));
      const levelRow = h('div', { class: 'ev-chips' });
      const search = h('input', { class: 'input', type: 'search', placeholder: 'Search the loaded events…', spellcheck: 'false', oninput: e => { view.text = e.target.value.toLowerCase(); draw(); } });
      const tabs = h('div', { class: 'ev-tabs' });
      const results = h('div', { class: 'ev-results' });
      const status = h('div');
      const load = h('button', { class: 'btn btn-accent', type: 'button', text: 'Load events', onclick: run });
      const exportFormat = h('select', { class: 'input ev-format' }, [['html', 'HTML report'], ['csv', 'CSV'], ['json', 'JSON']].map(([value, label]) => h('option', { value, text: label })));
      const exportBtn = h('button', { class: 'btn', type: 'button', text: 'Export', onclick: exportReport });

      function drawLevels() {
        clear(levelRow);
        for (const [level, label] of LEVELS) levelRow.appendChild(h('button', { class: `ev-chip${view.levels.has(level) ? ' active' : ''}`, type: 'button', text: label, onclick: () => { if (view.levels.has(level)) view.levels.delete(level); else view.levels.add(level); drawLevels(); } }));
      }

      function filter() {
        const minutes = Number(range.value);
        const span = minutes === -1 ? { from: from.value, to: to.value } : minutes > 0 ? { from: Date.now() - minutes * 60000 } : {};
        return { log: logSelect.value, levels: [...view.levels], provider: provider.value.trim(), eventId: eventId.value, limit: Number(limit.value), ...span };
      }

      async function run() {
        load.disabled = true;
        clear(status);
        clear(results);
        results.appendChild(h('div', { class: 'muted', text: 'Reading the log…' }));
        const res = await api.invoke('query', filter());
        load.disabled = false;
        clear(results);
        if (!res.ok) { view.data = null; status.appendChild(statusNote(res.error, 'error')); return; }
        view.data = res.data;
        clear(sources);
        for (const name of [...new Set(res.data.events.map(event => event.provider))].sort()) sources.appendChild(h('option', { value: name }));
        if (res.data.limited) status.appendChild(statusNote(`Showing the newest ${fmtNumber(res.data.events.length)} events. Narrow the filters or raise the limit to see older ones.`, 'info'));
        draw();
      }

      async function exportReport() {
        const format = exportFormat.value;
        const output = await api.saveFile({ defaultName: `${logSelect.value.replace(/\W+/g, '-')}-events.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }], title: 'Save the report' });
        if (!output) return;
        const res = await api.invoke('exportReport', { ...filter(), output });
        if (res.ok) api.toast(`Saved ${fmtNumber(res.data.count)} events`, 'ok'); else api.toast(res.error, 'error');
      }

      const matches = event => !view.text || `${event.message} ${event.provider} ${event.id}`.toLowerCase().includes(view.text);

      function eventRow(event) {
        const detail = h('div', { class: 'ev-detail', hidden: true });
        const row = h('button', { class: 'ev-row-item', type: 'button', onclick: () => {
          detail.hidden = !detail.hidden;
          if (detail.hidden || detail.firstChild) return;
          detail.append(
            h('div', { class: 'ev-message', text: event.message || 'This event has no message.' }),
            h('div', { class: 'muted ev-meta', text: `${event.log} · record ${event.record} · ${event.computer}` }),
            h('button', { class: 'btn btn-sm', type: 'button', text: 'Show what happened around this time', onclick: () => showAround(event) }),
          );
        } }, [
          h('span', { class: `ev-level ev-l${event.level}`, text: event.levelName }),
          h('span', { class: 'ev-time', text: stamp(event.time) }),
          h('span', { class: 'ev-source ellipsis', text: event.provider, title: event.provider }),
          h('span', { class: 'ev-id', text: String(event.id) }),
          h('span', { class: 'ev-text ellipsis', text: (event.message || '').split('\n')[0] }),
        ]);
        return h('div', { class: 'ev-item' }, [row, detail]);
      }

      async function showAround(event) {
        const res = await api.invoke('around', { time: event.time, minutes: 5, log: event.log });
        if (!res.ok) { api.toast(res.error, 'error'); return; }
        clear(status);
        status.appendChild(statusNote(`${fmtNumber(res.data.events.length)} events within ${res.data.minutes} minutes of ${stamp(event.time)}, across all main logs.${res.data.skipped.length ? ` Could not read: ${res.data.skipped.join(', ')}.` : ''}`, 'info'));
        view.around = res.data.events;
        view.tab = 'around';
        draw();
      }

      function drawEvents(list) {
        const shown = list.filter(matches);
        if (!shown.length) { results.appendChild(empty('No events match.')); return; }
        for (const event of shown.slice(0, 1000)) results.appendChild(eventRow(event));
        if (shown.length > 1000) results.appendChild(h('div', { class: 'muted', text: `Showing the first 1,000 of ${fmtNumber(shown.length)}. Search to find the rest.` }));
      }

      function drawGroups() {
        const groups = view.data.groups.filter(group => !view.text || `${group.sample} ${group.provider} ${group.id}`.toLowerCase().includes(view.text));
        if (!groups.length) { results.appendChild(empty('Nothing to group.')); return; }
        for (const group of groups) {
          results.appendChild(h('div', { class: 'ev-group' }, [
            h('div', { class: 'ev-count', text: `${fmtNumber(group.count)}×` }),
            h('div', { class: 'ev-group-main' }, [
              h('div', { class: 'ev-group-title' }, [h('span', { class: `ev-level ev-l${group.level}`, text: group.levelName }), h('strong', { text: group.provider }), h('span', { class: 'muted', text: `ID ${group.id}` })]),
              h('div', { class: 'ev-text', text: group.sample.slice(0, 300) }),
              h('div', { class: 'muted ev-meta', text: group.count > 1 ? `First ${stamp(group.first)} · last ${stamp(group.last)}` : stamp(group.last) }),
            ]),
          ]));
        }
      }

      function drawClusters() {
        if (!view.data.clusters.length) { results.appendChild(empty('No bursts found: fewer than three critical events or errors happened within five minutes of each other. Include Error and Critical above to see bursts.')); return; }
        for (const cluster of view.data.clusters) {
          const body = h('div', { class: 'ev-detail', hidden: true }, cluster.events.map(eventRow));
          results.appendChild(h('div', { class: 'ev-group ev-cluster' }, [
            h('button', { class: 'ev-cluster-head', type: 'button', onclick: () => { body.hidden = !body.hidden; } }, [
              h('strong', { text: `${fmtNumber(cluster.count)} errors` }),
              h('span', { class: 'muted', text: cluster.start === cluster.end ? stamp(cluster.start) : `${stamp(cluster.start)} to ${stamp(cluster.end)}` }),
              h('span', { class: 'ev-text', text: cluster.sources.slice(0, 5).map(source => `${source.name} (${source.count})`).join(' · ') }),
            ]),
            body,
          ]));
        }
      }

      function draw() {
        clear(tabs);
        clear(results);
        if (!view.data) return;
        const items = [['events', `Events (${fmtNumber(view.data.events.length)})`], ['groups', `Recurring (${fmtNumber(view.data.groups.length)})`], ['clusters', `Error bursts (${fmtNumber(view.data.clusters.length)})`]];
        if (view.around) items.push(['around', `Around this time (${fmtNumber(view.around.length)})`]);
        for (const [id, label] of items) tabs.appendChild(h('button', { class: `ev-tab${view.tab === id ? ' active' : ''}`, type: 'button', text: label, onclick: () => { view.tab = id; draw(); } }));
        if (view.tab === 'groups') drawGroups();
        else if (view.tab === 'clusters') drawClusters();
        else drawEvents(view.tab === 'around' ? view.around : view.data.events);
      }

      api.invoke('logs', {}).then(res => {
        if (!res.ok) return;
        const current = logSelect.value;
        clear(logSelect);
        for (const log of res.data) logSelect.appendChild(h('option', { value: log.name, text: `${log.name} (${fmtNumber(log.count)})`, selected: log.name === current }));
      });

      drawLevels();
      run();
      return h('div', { class: 'tool' }, [
        h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'Event Log Analyzer' }), h('p', { class: 'tool-desc', text: 'Browse Windows event logs, find what keeps failing and see what happened at the same time.' })]),
        h('div', { class: 'ev-filters' }, [
          h('div', { class: 'ev-row' }, [
            h('label', { class: 'field ev-grow' }, [h('span', { class: 'field-label', text: 'Log' }), logSelect]),
            h('label', { class: 'field' }, [h('span', { class: 'field-label', text: 'Time' }), range]),
            h('label', { class: 'field' }, [h('span', { class: 'field-label', text: 'Maximum events' }), limit]),
          ]),
          customRange,
          h('div', { class: 'ev-row' }, [
            h('label', { class: 'field ev-grow' }, [h('span', { class: 'field-label', text: 'Source' }), provider, sources]),
            h('label', { class: 'field' }, [h('span', { class: 'field-label', text: 'Event ID' }), eventId]),
            h('div', { class: 'field' }, [h('span', { class: 'field-label', text: 'Levels' }), levelRow]),
          ]),
        ]),
        h('div', { class: 'action-row' }, [load, exportFormat, exportBtn]),
        status, search, tabs, results,
      ]);
    },
  });
})();
