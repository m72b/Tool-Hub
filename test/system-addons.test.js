const assert = require('assert');
const fs = require('fs');
const path = require('path');
const events = require('../addons/event-log/main/events');
const { identify, shape, applyDates } = require('../addons/devices/main/ids');
const { parseFont, findDuplicates } = require('../addons/fonts/main/sfnt');
const { stitch, hashRows, findScroll } = require('../addons/capture/main/stitch');

// ---------- event log ----------
assert.strictEqual(events.buildQuery(), '*');
assert.strictEqual(events.buildQuery({ levels: [1, 2] }), '*[System[(Level=1 or Level=2)]]');
assert.ok(events.buildQuery({ levels: [4] }).includes('Level=0'), 'information can be written as level 0');
assert.strictEqual(events.buildQuery({ provider: 'Service Control Manager', eventId: '7034', from: 0 }).includes("Provider[@Name='Service Control Manager'] and EventID=7034"), true);
assert.ok(events.buildQuery({ from: '2026-01-01T00:00:00Z' }).includes("@SystemTime>='2026-01-01T00:00:00.000Z'"));
assert.throws(() => events.buildQuery({ provider: "x'] or [1=1" }), /cannot be searched/);
assert.throws(() => events.buildQuery({ eventId: '1 or 1=1' }), /Event ID/);
assert.throws(() => events.buildQuery({ eventId: 70000 }), /Event ID/);
assert.throws(() => events.buildQuery({ from: 'soon' }), /valid date/);

const sample = `<Events><Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='Disk &amp; Co' Guid='{1}'/><EventID Qualifiers='49156'>7</EventID><Level>2</Level><TimeCreated SystemTime='2026-11-07T01:00:00.0000000Z'/><EventRecordID>42</EventRecordID><Channel>System</Channel><Computer>PC</Computer></System><RenderingInfo Culture='en-US'><Message>Bad block on \\Device\\Harddisk1 &lt;retry 3&gt;</Message><Level>Error</Level></RenderingInfo></Event>
<Event xmlns='x'><System><Provider Name='App'/><EventID>1000</EventID><Level>0</Level><TimeCreated SystemTime='2026-11-07T01:01:00.000Z'/><EventRecordID>43</EventRecordID><Channel>Application</Channel><Computer>PC</Computer></System><EventData><Data>first</Data><Data>second</Data></EventData></Event></Events>`;
const parsed = events.parseEvents(sample);
assert.strictEqual(parsed.length, 2);
assert.deepStrictEqual([parsed[0].provider, parsed[0].id, parsed[0].levelName, parsed[0].log], ['Disk & Co', 7, 'Error', 'System']);
assert.ok(parsed[0].message.endsWith('<retry 3>'));
assert.strictEqual(parsed[0].time, Date.parse('2026-11-07T01:00:00Z'));
assert.strictEqual(parsed[1].message, 'first\nsecond');
assert.strictEqual(parsed[1].levelName, 'Information');

const event = (provider, id, message, minute, level = 2) => ({ provider, id, message, level, levelName: 'Error', time: minute * 60000, log: 'System', computer: 'PC' });
assert.strictEqual(events.normalizeMessage('Failed 0x80070005 at {12345678-1234-1234-1234-123456789abc} try 3'), events.normalizeMessage('Failed 0x1 at {aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee} try 9'));
const list = [event('A', 1, 'code 1', 1), event('A', 1, 'code 2', 2), event('A', 1, 'other problem', 3), event('B', 2, 'x', 1000)];
const groups = events.groupEvents(list);
assert.strictEqual(groups.length, 3);
assert.deepStrictEqual([groups[0].count, groups[0].first, groups[0].last, groups[0].sample], [2, 60000, 120000, 'code 2']);

const clusters = events.findClusters([...list, event('C', 3, 'y', 4), event('D', 9, 'warning', 5, 3), event('E', 4, 'z', 50)]);
assert.strictEqual(clusters.length, 1, 'a lone error and warnings make no cluster');
assert.strictEqual(clusters[0].count, 4);
assert.deepStrictEqual(clusters[0].sources.map(s => s.name), ['A', 'C']);

assert.ok(events.toCsv([{ ...event('A"B', 1, 'line', 1) }]).includes('"A""B"'));
const html = events.toHtml([event('<script>', 1, '<img src=x>', 1)]);
assert.ok(!html.includes('<script>') && !html.includes('<img') && html.includes('&lt;script&gt;'), 'reports escape log text');

// ---------- devices ----------
let id = identify('USB\\VID_046D&PID_C52B&REV_1211\\5&2A3B');
assert.deepStrictEqual([id.vendorId, id.productId, id.revision], ['046D', 'C52B', '1211']);
assert.strictEqual(identify('USB\\VID_046D&PID_C52B\\ABC123').serial, 'ABC123');
assert.strictEqual(identify('USB\\VID_046D&PID_C52B\\6&1&0').serial, '', 'generated ids are not serial numbers');
id = identify('USBSTOR\\Disk&Ven_SanDisk&Prod_Ultra_Fit&Rev_1.00\\4C53');
assert.deepStrictEqual([id.storageVendor, id.storageProduct, id.revision, id.serial], ['SanDisk', 'Ultra Fit', '1.00', '4C53']);

const raw = (InstanceId, extra = {}) => ({ InstanceId, FriendlyName: 'Device', Class: 'USB', Present: true, ...extra });
assert.strictEqual(shape(raw('USB\\VID_1&PID_2&MI_00\\7')).physicalUsb, false, 'interfaces are not physical devices');
assert.strictEqual(shape(raw('USB\\ROOT_HUB30\\4')).physicalUsb, false);
assert.strictEqual(shape(raw('PCI\\VEN_1')).usb, false);
assert.strictEqual(shape(raw('USBSTOR\\Disk\\1')).storage, true);
assert.strictEqual(shape(raw('USB\\VID_1&PID_2\\3', { Service: 'USBSTOR' })).storage, true);
assert.strictEqual(shape(raw('USB\\VID_1&PID_2\\3', { Service: 'HidUsb' })).storage, false, 'a mouse has no safe removal button');
const devices = [shape(raw('USB\\VID_1&PID_2\\3'))];
applyDates(devices, [{ id: 'usb\\vid_1&pid_2\\3', key: 'DEVPKEY_Device_LastArrivalDate', time: 5 }, { id: 'other', key: 'DEVPKEY_Device_LastRemovalDate', time: 6 }]);
assert.strictEqual(devices[0].lastConnected, 5);

// ---------- fonts ----------
function nameRecords(values) {
  const strings = values.map(([, text]) => Buffer.from(text, 'utf16le').swap16());
  const head = Buffer.alloc(6 + values.length * 12);
  head.writeUInt16BE(values.length, 2);
  head.writeUInt16BE(head.length, 4);
  let offset = 0;
  values.forEach(([nameId], i) => {
    const at = 6 + i * 12;
    head.writeUInt16BE(3, at);
    head.writeUInt16BE(1, at + 2);
    head.writeUInt16BE(0x409, at + 4);
    head.writeUInt16BE(nameId, at + 6);
    head.writeUInt16BE(strings[i].length, at + 8);
    head.writeUInt16BE(offset, at + 10);
    offset += strings[i].length;
  });
  return Buffer.concat([head, ...strings]);
}

function fakeFont(family, base = 0, tag = '\0\x01\0\0') {
  const parts = {
    name: nameRecords([[1, family], [2, 'Bold'], [4, `${family} Bold`], [6, `${family.replace(/ /g, '')}-Bold`], [8, 'Maker']]),
    head: Buffer.alloc(54),
    maxp: Buffer.alloc(6),
    post: Buffer.alloc(32),
    'OS/2': Buffer.alloc(78),
  };
  parts.head.writeUInt16BE(1000, 18);
  parts.maxp.writeUInt16BE(321, 4);
  parts.post.writeUInt32BE(1, 12);
  parts['OS/2'].writeUInt16BE(700, 4);
  parts['OS/2'].write('ACME', 58, 'latin1');
  const tags = Object.keys(parts);
  const directory = Buffer.alloc(12 + tags.length * 16);
  directory.write(tag, 0, 'latin1');
  directory.writeUInt16BE(tags.length, 4);
  let offset = base + directory.length;
  tags.forEach((name, i) => {
    const at = 12 + i * 16;
    directory.write(name, at, 'latin1');
    directory.writeUInt32BE(offset, at + 8);
    directory.writeUInt32BE(parts[name].length, at + 12);
    offset += parts[name].length;
  });
  return Buffer.concat([directory, ...tags.map(name => parts[name])]);
}

const [face] = parseFont(fakeFont('Test Sans'));
assert.deepStrictEqual([face.family, face.style, face.fullName, face.postscript, face.manufacturer], ['Test Sans', 'Bold', 'Test Sans Bold', 'TestSans-Bold', 'Maker']);
assert.deepStrictEqual([face.weight, face.glyphs, face.unitsPerEm, face.monospace, face.vendor, face.embedding], [700, 321, 1000, true, 'ACME', 'Installable']);
assert.strictEqual(parseFont(fakeFont('Other', 0, 'OTTO'))[0].outlines, 'PostScript (OpenType)');

const inner = fakeFont('In Collection', 16);
const ttc = Buffer.concat([Buffer.alloc(16), inner]);
ttc.write('ttcf', 0, 'latin1');
ttc.writeUInt32BE(1, 8);
ttc.writeUInt32BE(16, 12);
assert.strictEqual(parseFont(ttc)[0].family, 'In Collection');
assert.deepStrictEqual(parseFont(Buffer.from('not a font at all')), []);
const cut = fakeFont('Broken').subarray(0, 60);
assert.deepStrictEqual(parseFont(cut), [], 'a damaged font is skipped without an error');

const font = (file, size, postscript) => ({ path: file, size, faces: [{ postscript }] });
const dup = findDuplicates([font('a', 10, 'A'), font('b', 10, 'A'), font('c', 10, 'C'), font('d', 20, 'D'), font('e', 30, 'D')], item => (item.path === 'c' ? 'other' : 'same'));
assert.deepStrictEqual(dup.exact.map(group => group.map(item => item.path)), [['a', 'b']]);
assert.deepStrictEqual(dup.named.map(group => group.map(item => item.path)), [['d', 'e']]);

// ---------- scrolling capture ----------
// A page of rows that all differ, seen through a window with a sticky header and footer.
function rowColor(y) { return [(y * 37) & 255, (y * 91) & 255, ((y * 13) ^ (y >> 3)) & 255]; }
function view(top, { width = 40, height = 200, header = 0, footer = 0 } = {}) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const isHeader = y < header;
    const isFooter = y >= height - footer;
    const color = isHeader ? [200, 10, 10] : isFooter ? [10, 200, 10] : rowColor(top + y - header);
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      data[at] = color[0]; data[at + 1] = color[1]; data[at + 2] = (color[2] + x) & 255; data[at + 3] = 255;
    }
  }
  return { width, height, data };
}
assert.strictEqual(findScroll(hashRows(view(0)), hashRows(view(50))).moved, 50);
assert.strictEqual(findScroll(hashRows(view(0)), hashRows(view(0))).moved, 0);

const plain = stitch([view(0), view(0), view(60), view(150), view(200)]);
assert.strictEqual(plain.height, 400, 'identical frames are ignored and new rows are added');
assert.strictEqual(plain.joined, 4);
assert.strictEqual(plain.skipped, 0);
for (const y of [0, 123, 399]) assert.strictEqual(plain.data[y * 40 * 4], rowColor(y)[0], `row ${y} is in the right place`);

const sticky = stitch([view(0, { header: 20, footer: 15 }), view(70, { header: 20, footer: 15 }), view(120, { header: 20, footer: 15 })]);
assert.strictEqual(sticky.height, 200 + 120, 'sticky header and footer appear only once');
assert.strictEqual(sticky.data[0], 200, 'header stays on top');
assert.strictEqual(sticky.data[(sticky.height - 1) * 40 * 4 + 1], 200, 'footer stays at the bottom');
assert.strictEqual(sticky.data[(20 + 100) * 40 * 4], rowColor(100)[0]);

const jumped = stitch([view(0), view(1000), view(50)]);
assert.strictEqual(jumped.skipped, 1, 'a frame that moved too far is reported');
assert.strictEqual(jumped.height, 250);

const capped = stitch([view(0), view(100), view(200)], { maxHeight: 320 });
assert.strictEqual(capped.height, 300, 'very long captures stop at the limit');

for (const dir of ['capture', 'fonts', 'event-log', 'devices']) {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'addons', dir, 'addon.json'), 'utf8'));
  for (const file of [...manifest.scripts, ...manifest.styles, ...manifest.tools.map(tool => tool.module)]) assert.ok(fs.existsSync(path.join(__dirname, '..', 'addons', dir, file)), file);
}

console.log('system add-ons: all checks passed');
