(function () {
  const { h, clear, fmtBytes, fmtNumber, table, empty, statusNote, stat, bar, toolShell } = window.UI;
  const Hub = window.Hub;

  function kv(label, value) {
    if (value === null || value === undefined || value === '') return null;
    return h('div', { class: 'kv' }, [
      h('span', { class: 'kv-label', text: label }),
      h('span', { class: 'kv-value', text: String(value) }),
    ]);
  }

  function card(title, children) {
    const items = children.filter(Boolean);
    if (items.length === 0) return null;
    return h('div', { class: 'info-card' }, [
      h('div', { class: 'info-card-title', text: title }),
      h('div', { class: 'info-card-body' }, items),
    ]);
  }

  Hub.registerView('system-info', {
    render(api) {
      return toolShell({
        title: 'System Information',
        description: 'CPU, memory, storage and hardware details for this machine.',
        action: 'get',
        runLabel: 'Refresh',
        busyLabel: 'Reading system data…',
        autoRun: true,
        fields: [],
        render(data) {
          const wrap = h('div', { class: 'info-grid' });
          const e = data.extras || {};

          wrap.appendChild(card('System', [
            kv('Hostname', data.hostname),
            kv('Operating system', e.os ? e.os.Caption : `${data.osType} ${data.osRelease}`),
            kv('Version', e.os ? `${e.os.Version} (build ${e.os.BuildNumber})` : data.osRelease),
            kv('Architecture', e.os ? e.os.OSArchitecture : data.arch),
            kv('Uptime', data.uptime),
          ]));

          wrap.appendChild(card('Processor', [
            kv('Model', data.cpu.model),
            kv('Logical cores', data.cpu.cores),
            kv('Base clock', data.cpu.speed ? `${data.cpu.speed} MHz` : null),
          ]));

          const memChildren = [
            kv('Installed', fmtBytes(data.memory.total)),
            kv('In use', `${fmtBytes(data.memory.used)} (${data.memory.percent}%)`),
            kv('Available', fmtBytes(data.memory.free)),
          ];
          if (Array.isArray(e.memoryModules)) {
            e.memoryModules.forEach((m, i) => {
              memChildren.push(kv(`Module ${i + 1}`, `${fmtBytes(Number(m.Capacity) || 0)}${m.Speed ? ` @ ${m.Speed} MHz` : ''}`));
            });
          }
          wrap.appendChild(card('Memory', memChildren));

          if (Array.isArray(e.gpu) && e.gpu.length > 0) {
            wrap.appendChild(card('Graphics', e.gpu.flatMap((g, i) => [
              kv(`GPU ${i + 1}`, g.Name),
              kv('Driver', g.DriverVersion),
              g.AdapterRAM ? kv('Adapter memory', fmtBytes(Number(g.AdapterRAM))) : (g.AdapterRAMLimited ? kv('Adapter memory', '4 GB (WMI limit; actual may be higher)') : null),
            ])));
          }

          if (e.motherboard) {
            wrap.appendChild(card('Motherboard', [
              kv('Manufacturer', e.motherboard.Manufacturer),
              kv('Model', e.motherboard.Product),
              kv('Version', e.motherboard.Version),
            ]));
          }

          if (e.bios) {
            wrap.appendChild(card('BIOS', [
              kv('Vendor', e.bios.Manufacturer),
              kv('Version', e.bios.SMBIOSBIOSVersion),
            ]));
          }

          const storageCard = h('div', { class: 'info-card info-card-wide' }, [
            h('div', { class: 'info-card-title', text: 'Storage' }),
            h('div', { class: 'info-card-body' }, data.storage.map(s => h('div', { class: 'vol' }, [
              h('div', { class: 'vol-top' }, [
                h('span', { class: 'mono', text: s.root }),
                h('span', { class: 'muted', text: `${fmtBytes(s.used)} of ${fmtBytes(s.total)} used` }),
              ]),
              bar(s.percent, s.percent > 90 ? 'danger' : s.percent > 75 ? 'warn' : null),
              h('span', { class: 'muted', text: `${fmtBytes(s.free)} free (${s.percent}% used)` }),
            ]))),
          ]);
          wrap.appendChild(storageCard);
          return wrap;
        },
      }, api);
    },
  });

  Hub.registerView('drive-health', {
    render(api) {
      return toolShell({
        title: 'Drive Health',
        description: 'SMART and reliability data reported by your physical drives.',
        action: 'get',
        runLabel: 'Refresh',
        busyLabel: 'Querying drives…',
        autoRun: true,
        fields: [],
        render(data) {
          const wrap = h('div');
          if (!data.supported) {
            wrap.appendChild(statusNote(data.message, 'info'));
            return wrap;
          }
          if (data.error) {
            wrap.appendChild(statusNote(data.error, 'error'));
            return wrap;
          }
          if (data.drives.length === 0) {
            wrap.appendChild(empty('No physical drives reported.'));
            return wrap;
          }
          const grid = h('div', { class: 'info-grid' });
          for (const d of data.drives) {
            grid.appendChild(h('div', { class: 'info-card' }, [
              h('div', { class: 'info-card-title' }, [
                h('span', { text: d.name }),
                h('span', { class: `tag tag-${d.health === 'healthy' ? 'ok' : d.health === 'unknown' ? '' : 'warn'}`, text: d.healthRaw }),
              ]),
              h('div', { class: 'info-card-body' }, [
                kv('Media type', d.mediaType),
                kv('Bus', d.busType),
                kv('Capacity', d.size ? fmtBytes(d.size) : null),
                kv('Operational status', d.operational),
                kv('Temperature', d.temperature !== null ? `${d.temperature} °C` : null),
                kv('Wear', d.wear !== null ? `${d.wear}%` : null),
                kv('Power-on hours', d.powerOnHours !== null ? fmtNumber(d.powerOnHours) : null),
                kv('Read errors', fmtNumber(d.readErrors)),
                kv('Write errors', fmtNumber(d.writeErrors)),
                kv('Firmware', d.firmware),
                kv('Serial', d.serial),
              ]),
            ]));
          }
          wrap.appendChild(grid);
          if (data.note) wrap.appendChild(statusNote(data.note, 'info'));
          return wrap;
        },
      }, api);
    },
  });

  Hub.registerView('apps-manager', {
    render(api) {
      return toolShell({
        title: 'Installed Apps Manager',
        description: 'Review installed applications by size and launch their uninstallers.',
        action: 'list',
        runLabel: 'Refresh list',
        busyLabel: 'Reading installed programs…',
        autoRun: true,
        fields: [],
        render(data, ctx) {
          const wrap = h('div');
          if (!data.supported) {
            wrap.appendChild(statusNote(data.message, 'info'));
            return wrap;
          }
          if (data.error) {
            wrap.appendChild(statusNote(data.error, 'error'));
            return wrap;
          }
          const totalSize = data.apps.reduce((s, a) => s + a.size, 0);
          wrap.appendChild(h('div', { class: 'stat-row' }, [
            stat('Applications', fmtNumber(data.total)),
            stat('Reported size', fmtBytes(totalSize)),
          ]));

          const filter = h('input', { class: 'input', type: 'text', placeholder: 'Filter by name or publisher' });
          const body = h('div');
          const draw = () => {
            const term = filter.value.trim().toLowerCase();
            const list = term
              ? data.apps.filter(a => a.name.toLowerCase().includes(term) || a.publisher.toLowerCase().includes(term))
              : data.apps;
            clear(body);
            if (list.length === 0) {
              body.appendChild(empty('No applications matched.'));
              return;
            }
            const rows = list.map(app => h('div', { class: 'tbl-row' }, [
              h('span', { class: 'ellipsis', text: app.name, title: app.name }),
              h('span', { class: 'muted ellipsis', text: app.publisher }),
              h('span', { class: 'mono', text: app.version }),
              h('span', { class: 'mono', text: app.size ? fmtBytes(app.size) : '—' }),
              app.canUninstall
                ? h('button', {
                    class: 'mini-btn mini-danger', type: 'button', text: 'Uninstall',
                    onclick: async () => {
                      const res = await api.invoke('uninstall', { key: app.key });
                      if (!res.ok) {
                        api.toast(res.error, 'error');
                        return;
                      }
                      api.toast('Uninstaller launched — follow its prompts, then refresh.', 'ok');
                    },
                  })
                : h('span', { class: 'muted', text: '—' }),
            ]));
            body.appendChild(table([
              { label: 'Application', width: 'minmax(0,1.6fr)' },
              { label: 'Publisher', width: 'minmax(0,1fr)' },
              { label: 'Version', width: '110px' },
              { label: 'Size', width: '90px' },
              { label: '', width: '96px' },
            ], rows));
          };
          filter.oninput = draw;
          wrap.appendChild(h('div', { class: 'action-row' }, [filter]));
          wrap.appendChild(body);
          draw();
          wrap.appendChild(statusNote('Sizes come from the registry and are estimates. Uninstallers run as separate programs.', 'info'));
          return wrap;
        },
      }, api);
    },
  });

  Hub.registerView('startup-manager', {
    render(api) {
      return toolShell({
        title: 'Startup Manager',
        description: 'Review and disable programs that launch when Windows starts.',
        action: 'list',
        runLabel: 'Refresh',
        busyLabel: 'Reading startup entries…',
        autoRun: true,
        fields: [],
        render(data, ctx) {
          const wrap = h('div');
          if (!data.supported) {
            wrap.appendChild(statusNote(data.message, 'info'));
            return wrap;
          }
          if (data.entries.length === 0) {
            wrap.appendChild(empty('No startup entries found.'));
            return wrap;
          }
          const rows = data.entries.map(entry => h('div', { class: 'tbl-row' }, [
            h('span', { class: 'ellipsis', text: entry.name, title: entry.name }),
            h('span', { class: 'mono muted ellipsis', text: entry.command, title: entry.command }),
            h('span', { class: 'muted', text: entry.scope }),
            h('span', { class: 'muted', text: entry.source }),
            h('span', { class: `tag tag-${entry.enabled ? 'ok' : ''}`, text: entry.enabled ? 'Enabled' : 'Disabled' }),
            h('button', {
              class: 'mini-btn', type: 'button', text: entry.enabled ? 'Disable' : 'Enable',
              onclick: async () => {
                const res = await api.invoke('setEnabled', { id: entry.id, enabled: !entry.enabled });
                if (!res.ok) {
                  api.toast(res.error, 'error');
                  return;
                }
                api.toast(entry.enabled ? 'Entry disabled' : 'Entry enabled', 'ok');
                ctx.rerun();
              },
            }),
          ]));
          wrap.appendChild(table([
            { label: 'Name', width: 'minmax(0,1fr)' },
            { label: 'Command', width: 'minmax(0,1.6fr)' },
            { label: 'Scope', width: '110px' },
            { label: 'Source', width: '130px' },
            { label: 'State', width: '90px' },
            { label: '', width: '90px' },
          ], rows));
          wrap.appendChild(statusNote('Disabled registry entries are backed up so they can be restored. All-users entries may require administrator rights.', 'info'));
          return wrap;
        },
      }, api);
    },
  });

  Hub.registerView('network', {
    render(api) {
      const container = h('div', { class: 'tool' });
      const results = h('div', { class: 'results' });
      const hostInput = h('input', { class: 'input', type: 'text', value: 'example.com', placeholder: 'Hostname or IP', spellcheck: 'false' });

      const busy = label => {
        clear(results);
        results.appendChild(h('div', { class: 'run-status', text: label }));
      };

      const showError = message => {
        clear(results);
        results.appendChild(statusNote(message, 'error'));
      };

      const runPing = async () => {
        busy('Pinging…');
        const res = await api.invoke('ping', { host: hostInput.value, count: 4 });
        if (!res.ok) return showError(res.error);
        const d = res.data;
        clear(results);
        if (d.summary) {
          results.appendChild(h('div', { class: 'stat-row' }, [
            stat('Replies', fmtNumber(d.summary.received)),
            stat('Average', `${d.summary.avg} ms`),
            stat('Min / Max', `${d.summary.min} / ${d.summary.max} ms`),
            d.loss !== null ? stat('Packet loss', `${d.loss}%`, d.loss > 0 ? 'warn' : 'ok') : null,
          ].filter(Boolean)));
        }
        results.appendChild(h('pre', { class: 'output', text: d.output || 'No output' }));
      };

      const runLookup = async () => {
        busy('Resolving…');
        const res = await api.invoke('lookup', { host: hostInput.value });
        if (!res.ok) return showError(res.error);
        const d = res.data;
        clear(results);
        const grid = h('div', { class: 'info-grid' });
        for (const [type, values] of Object.entries(d.records)) {
          if (!values || values.length === 0) continue;
          grid.appendChild(h('div', { class: 'info-card' }, [
            h('div', { class: 'info-card-title', text: `${type} records` }),
            h('div', { class: 'info-card-body' }, values.map(v => h('div', {
              class: 'mono record-line',
              text: typeof v === 'string' ? v : JSON.stringify(v),
            }))),
          ]));
        }
        if (d.reverse.length > 0) {
          grid.appendChild(h('div', { class: 'info-card' }, [
            h('div', { class: 'info-card-title', text: 'Reverse DNS' }),
            h('div', { class: 'info-card-body' }, d.reverse.map(v => h('div', { class: 'mono record-line', text: v }))),
          ]));
        }
        if (grid.children.length === 0) {
          results.appendChild(empty('No DNS records returned.'));
          return;
        }
        results.appendChild(grid);
      };

      const runTrace = async () => {
        busy('Tracing route — this can take up to a minute…');
        const res = await api.invoke('traceroute', { host: hostInput.value, maxHops: 20 });
        if (!res.ok) return showError(res.error);
        const d = res.data;
        clear(results);
        if (!d.available) {
          results.appendChild(statusNote('The traceroute command is not available on this system.', 'warn'));
          return;
        }
        results.appendChild(h('pre', { class: 'output', text: d.output || 'No output' }));
      };

      const runIpInfo = async () => {
        busy('Reading interfaces…');
        const res = await api.invoke('ipinfo', {});
        if (!res.ok) return showError(res.error);
        const d = res.data;
        clear(results);
        results.appendChild(h('div', { class: 'stat-row' }, [
          stat('Hostname', d.hostname),
          stat('DNS servers', d.dnsServers.length > 0 ? d.dnsServers.join(', ') : '—'),
        ]));
        const rows = d.interfaces.map(i => h('div', { class: 'tbl-row' }, [
          h('span', { class: 'ellipsis', text: i.name }),
          h('span', { class: 'mono ellipsis', text: i.address, title: i.address }),
          h('span', { class: 'muted', text: i.family }),
          h('span', { class: 'mono muted ellipsis', text: i.mac || '—' }),
          h('span', { class: 'tag', text: i.internal ? 'internal' : 'external' }),
        ]));
        results.appendChild(table([
          { label: 'Interface', width: 'minmax(0,1fr)' },
          { label: 'Address', width: 'minmax(0,1.4fr)' },
          { label: 'Family', width: '90px' },
          { label: 'MAC', width: 'minmax(0,1fr)' },
          { label: '', width: '100px' },
        ], rows));
      };

      container.appendChild(h('div', { class: 'tool-head' }, [
        h('h1', { class: 'tool-title', text: 'Network Toolkit' }),
        h('p', { class: 'tool-desc', text: 'Ping a host, resolve DNS records, trace a route, or inspect local network interfaces.' }),
      ]));
      container.appendChild(h('div', { class: 'controls' }, [
        h('div', { class: 'controls-fields' }, [
          h('div', { class: 'field field-wide' }, [
            h('label', { class: 'field-label', text: 'Host' }),
            hostInput,
          ]),
        ]),
        h('div', { class: 'controls-actions' }, [
          h('button', { class: 'btn btn-accent', type: 'button', text: 'Ping', onclick: runPing }),
          h('button', { class: 'btn', type: 'button', text: 'DNS lookup', onclick: runLookup }),
          h('button', { class: 'btn', type: 'button', text: 'Traceroute', onclick: runTrace }),
          h('button', { class: 'btn', type: 'button', text: 'My IP info', onclick: runIpInfo }),
        ]),
      ]));
      container.appendChild(results);
      results.appendChild(empty('Enter a host and choose an action.'));
      return container;
    },
  });
})();
