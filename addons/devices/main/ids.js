// Reads what Windows device instance ids say about a device. Needs no Windows, so it can be tested anywhere.
const STORAGE_SERVICES = ['usbstor', 'uaspstor'];

function identify(instanceId) {
  const id = String(instanceId || '');
  const usb = /VID_([0-9A-F]{4})&PID_([0-9A-F]{4})(?:&REV_([0-9A-F]{4}))?/i.exec(id);
  const parts = id.split('\\');
  const iface = /&MI_([0-9A-F]{2})/i.exec(id);
  const storage = /^USBSTOR\\[^\\]*Ven_([^&]*)&Prod_([^&]*)(?:&Rev_([^\\]*))?/i.exec(id);
  const serial = parts.length >= 3 && !parts[2].includes('&') ? parts[2] : '';
  return {
    bus: parts[0] || '',
    vendorId: usb ? usb[1].toUpperCase() : '',
    productId: usb ? usb[2].toUpperCase() : '',
    revision: usb?.[3] || storage?.[3] || '',
    interface: iface ? iface[1] : '',
    storageVendor: storage ? storage[1].replace(/_/g, ' ').trim() : '',
    storageProduct: storage ? storage[2].replace(/_/g, ' ').trim() : '',
    serial,
  };
}

const isUsb = device => /^(USB|USBSTOR)\\/i.test(device.instanceId);

// Interfaces of one physical device and internal hub parts are hidden from the USB list.
const isPhysicalUsb = device => isUsb(device) && !/&MI_[0-9A-F]{2}/i.test(device.instanceId) && !/^USB\\ROOT_HUB/i.test(device.instanceId);

const isStorage = device => /^USBSTOR\\/i.test(device.instanceId) || (isUsb(device) && STORAGE_SERVICES.includes(String(device.service || '').toLowerCase()));

function shape(raw) {
  const instanceId = String(raw.InstanceId || '');
  const device = {
    instanceId,
    name: raw.FriendlyName || raw.Name || instanceId,
    class: raw.Class || 'Unknown',
    manufacturer: raw.Manufacturer || '',
    status: raw.Status || 'Unknown',
    present: raw.Present === true,
    service: raw.Service || '',
    problem: Number(raw.Problem) || 0,
    ...identify(instanceId),
  };
  return { ...device, usb: isUsb(device), physicalUsb: isPhysicalUsb(device), storage: isStorage(device) };
}

// Windows returns each property as one row; this joins them per device.
function applyDates(devices, rows) {
  const names = { DEVPKEY_Device_LastArrivalDate: 'lastConnected', DEVPKEY_Device_LastRemovalDate: 'lastRemoved', DEVPKEY_Device_FirstInstallDate: 'firstInstalled' };
  const byId = new Map(devices.map(device => [device.instanceId.toLowerCase(), device]));
  for (const row of rows) {
    const device = byId.get(String(row.id).toLowerCase());
    if (device && names[row.key] && row.time > 0) device[names[row.key]] = row.time;
  }
  return devices;
}

module.exports = { identify, shape, applyDates, isStorage };
