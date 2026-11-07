// Device Manager screen.
(function () {
  const { h, clear, statusNote, fmtDate, fmtNumber, empty } = window.UI;
  const TABS = [['usb', 'USB devices'], ['history', 'Connection history'], ['all', 'All hardware']];

  window.Hub.registerView('device-manager', {
    render(api) {
      const view = { tab: 'usb', devices: null, text: '', cls: '' };
      const status = h('div');
      const tabs = h('div', { class: 'dv-tabs' });
      const list = h('div', { class: 'dv-list' });
      const search = h('input', { class: 'input', type: 'search', placeholder: 'Search by name, maker, ID or serial…', spellcheck: 'false', oninput: e => { view.text = e.target.value.toLowerCase(); draw(); } });
      const classFilter = h('select', { class: 'input dv-class', onchange: e => { view.cls = e.target.value; draw(); } });
      const refresh = h('button', { class: 'btn', type: 'button', text: 'Refresh', onclick: load });

      async function load() {
        refresh.disabled = true;
        clear(status);
        clear(list);
        list.appendChild(h('div', { class: 'muted', text: 'Reading your devices…' }));
        const res = await api.invoke('list', {});
        refresh.disabled = false;
        clear(list);
        if (!res.ok) { status.appendChild(statusNote(res.error, 'error')); return; }
        view.devices = res.data.devices;
        clear(classFilter);
        classFilter.appendChild(h('option', { value: '', text: 'All classes' }));
        for (const name of [...new Set(view.devices.map(device => device.class))].sort()) classFilter.appendChild(h('option', { value: name, text: name, selected: name === view.cls }));
        draw();
      }

      const label = device => (device.storageVendor || device.storageProduct ? `${device.storageVendor} ${device.storageProduct}`.trim() : device.name);

      function ids(device) {
        return [device.vendorId && `VID ${device.vendorId}`, device.productId && `PID ${device.productId}`, device.revision && `Rev ${device.revision}`, device.serial && `Serial ${device.serial}`].filter(Boolean).join(' · ');
      }

      function pairs(items) {
        return h('div', { class: 'dv-pairs' }, items.filter(([, value]) => value !== undefined && value !== null && value !== '').flatMap(([name, value]) => [h('span', { class: 'muted', text: name }), h('span', { class: 'dv-value', text: String(value) })]));
      }

      async function openDetails(device, box) {
        box.hidden = !box.hidden;
        if (box.hidden || box.firstChild) return;
        box.appendChild(h('div', { class: 'muted', text: 'Reading driver details…' }));
        const res = await api.invoke('details', { id: device.instanceId });
        clear(box);
        if (!res.ok) { box.appendChild(statusNote(res.error, 'error')); return; }
        const d = res.data;
        box.appendChild(pairs([
          ['Name on the bus', d.busName], ['Maker', device.manufacturer], ['Class', device.class], ['Service', device.service], ['Location', d.location],
          ['Driver', d.description], ['Driver version', d.version], ['Driver date', d.date ? fmtDate(d.date).slice(0, 10) : ''], ['Driver provider', d.provider], ['Driver file', d.inf],
          ['Signed', d.signed === true ? `Yes${d.signer ? `, by ${d.signer}` : ''}` : d.signed === false ? 'No' : ''],
          ['First installed', device.firstInstalled ? fmtDate(device.firstInstalled) : ''], ['Last connected', device.lastConnected ? fmtDate(device.lastConnected) : ''], ['Last removed', device.lastRemoved ? fmtDate(device.lastRemoved) : ''],
          ['Instance ID', device.instanceId], ['Hardware IDs', (d.hardwareIds || []).filter(Boolean).join('\n')],
        ]));
      }

      async function remove(device) {
        if (!window.confirm(`Safely remove ${label(device)}? Windows will refuse if files on it are in use.`)) return;
        const res = await api.invoke('safeRemove', { id: device.instanceId });
        if (res.ok) { api.toast('It is now safe to unplug this device', 'ok'); load(); } else api.toast(res.error, 'error');
      }

      function row(device) {
        const box = h('div', { class: 'dv-details', hidden: true });
        const problem = device.present && device.problem > 0;
        return h('div', { class: 'dv-item' }, [
          h('div', { class: 'dv-head' }, [
            h('span', { class: `dv-dot${device.present ? (problem ? ' bad' : ' on') : ''}`, title: device.present ? (problem ? `Problem code ${device.problem}` : 'Connected') : 'Not connected' }),
            h('button', { class: 'dv-open', type: 'button', onclick: () => openDetails(device, box) }, [
              h('span', { class: 'dv-name ellipsis', text: label(device), title: label(device) }),
              h('span', { class: 'muted dv-sub ellipsis', text: [device.manufacturer, device.class, ids(device)].filter(Boolean).join(' · ') }),
            ]),
            view.tab === 'history' ? h('span', { class: 'muted dv-when', text: device.lastConnected ? `Last connected ${fmtDate(device.lastConnected)}` : 'Date not recorded' }) : null,
            device.present && device.storage ? h('button', { class: 'btn btn-sm', type: 'button', text: 'Safely remove', onclick: () => remove(device) }) : null,
          ]),
          box,
        ]);
      }

      function draw() {
        clear(tabs);
        for (const [id, name] of TABS) tabs.appendChild(h('button', { class: `dv-tab${view.tab === id ? ' active' : ''}`, type: 'button', text: name, onclick: () => { view.tab = id; draw(); } }));
        clear(list);
        if (!view.devices) return;
        classFilter.hidden = view.tab !== 'all';
        let shown = view.devices;
        if (view.tab === 'usb') shown = shown.filter(device => device.physicalUsb && device.present);
        else if (view.tab === 'history') shown = shown.filter(device => device.physicalUsb).sort((a, b) => (b.lastConnected || 0) - (a.lastConnected || 0));
        else shown = shown.filter(device => device.present && (!view.cls || device.class === view.cls));
        if (view.text) shown = shown.filter(device => `${device.name} ${device.manufacturer} ${device.instanceId} ${device.class} ${device.storageVendor} ${device.storageProduct}`.toLowerCase().includes(view.text));
        list.appendChild(h('div', { class: 'muted dv-sub', text: `${fmtNumber(shown.length)} ${shown.length === 1 ? 'device' : 'devices'}` }));
        if (!shown.length) list.appendChild(empty('No devices found.'));
        for (const device of shown.slice(0, 500)) list.appendChild(row(device));
      }

      load();
      return h('div', { class: 'tool' }, [
        h('div', { class: 'tool-head' }, [h('h1', { class: 'tool-title', text: 'Device Manager' }), h('p', { class: 'tool-desc', text: 'Your USB devices and hardware, their drivers and when they were connected.' })]),
        h('div', { class: 'action-row dv-tools' }, [search, classFilter, refresh]),
        status, tabs, list,
      ]);
    },
  });
})();
