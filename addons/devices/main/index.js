// Device Manager: reads Windows' device list. The only action that changes anything is safe removal.
const { shape, applyDates } = require('./ids');

const LIST = "Get-PnpDevice -ErrorAction SilentlyContinue | Select-Object InstanceId,FriendlyName,Name,Class,Manufacturer,Status,Present,Service,Problem | ConvertTo-Json -Compress -Depth 2";

const DATES = `$ids=@($env:TH_IDS -split "\`n");
Get-PnpDeviceProperty -InstanceId $ids -KeyName DEVPKEY_Device_LastArrivalDate,DEVPKEY_Device_LastRemovalDate,DEVPKEY_Device_FirstInstallDate -ErrorAction SilentlyContinue |
  Where-Object { $_.Data -is [DateTime] } |
  ForEach-Object { [PSCustomObject]@{ id=$_.InstanceId; key=$_.KeyName; time=[DateTimeOffset]::new($_.Data).ToUnixTimeMilliseconds() } } | ConvertTo-Json -Compress`;

const DETAILS = `$id=$env:TH_ID;$keys='DEVPKEY_Device_DriverVersion','DEVPKEY_Device_DriverDate','DEVPKEY_Device_DriverProvider','DEVPKEY_Device_DriverInfPath','DEVPKEY_Device_DriverDesc','DEVPKEY_Device_HardwareIds','DEVPKEY_Device_LocationInfo','DEVPKEY_Device_Parent','DEVPKEY_Device_BusReportedDeviceDesc';
$r=@{};Get-PnpDeviceProperty -InstanceId $id -KeyName $keys -ErrorAction SilentlyContinue | ForEach-Object { $r[$_.KeyName -replace 'DEVPKEY_Device_','']=$_.Data };
$d=Get-CimInstance Win32_PnPSignedDriver -Filter ("DeviceID='"+($id -replace '\\\\','\\\\' -replace "'","\\'")+"'") -ErrorAction SilentlyContinue | Select-Object -First 1;
$date=if($r.DriverDate -is [DateTime]){[DateTimeOffset]::new($r.DriverDate).ToUnixTimeMilliseconds()}else{0};
[PSCustomObject]@{version=$r.DriverVersion;date=$date;provider=$r.DriverProvider;inf=$r.DriverInfPath;description=$r.DriverDesc;hardwareIds=@($r.HardwareIds);location=$r.LocationInfo;parent=$r.Parent;busName=$r.BusReportedDeviceDesc;signed=$d.IsSigned;signer=$d.Signer} | ConvertTo-Json -Compress -Depth 3`;

// Asks Windows to eject, walking up to the part of the device that can be removed. Windows refuses if it is in use.
const EJECT = `$ErrorActionPreference='Stop';
Add-Type -TypeDefinition @'
using System;using System.Text;using System.Runtime.InteropServices;
public static class ToolHubEject {
  [DllImport("cfgmgr32.dll",CharSet=CharSet.Unicode)] static extern int CM_Locate_DevNodeW(out int node,string id,int flags);
  [DllImport("cfgmgr32.dll")] static extern int CM_Get_Parent(out int parent,int node,int flags);
  [DllImport("cfgmgr32.dll")] static extern int CM_Get_DevNode_Status(out int status,out int problem,int node,int flags);
  [DllImport("cfgmgr32.dll",CharSet=CharSet.Unicode)] static extern int CM_Request_Device_EjectW(int node,out int veto,StringBuilder name,int length,int flags);
  public static string Eject(string id){
    int node;
    if(CM_Locate_DevNodeW(out node,id,0)!=0) return "missing";
    for(int i=0;i<16;i++){
      int status,problem;
      if(CM_Get_DevNode_Status(out status,out problem,node,0)!=0) return "missing";
      if((status&0x4000)!=0){
        int veto;var name=new StringBuilder(512);
        int result=CM_Request_Device_EjectW(node,out veto,name,512,0);
        return (result==0&&veto==0)?"ok":("veto:"+veto+":"+name);
      }
      int parent;
      if(CM_Get_Parent(out parent,node,0)!=0) return "fixed";
      node=parent;
    }
    return "fixed";
  }
}
'@
[ToolHubEject]::Eject($env:TH_ID)`;

async function listDevices(ctx) {
  const { safe } = ctx.lib;
  const res = await safe.powershellJson(LIST, { timeout: 60000 });
  if (!res.ok) safe.fail(res.error);
  const devices = (res.data || []).map(shape).filter(device => device.instanceId);
  const usb = devices.filter(device => device.physicalUsb);
  if (usb.length) {
    const dates = await safe.powershellJson(DATES, { timeout: 60000, env: { TH_IDS: usb.map(device => device.instanceId).join('\n') } });
    if (dates.ok) applyDates(devices, dates.data || []);
  }
  return devices;
}

const actions = {
  async list(params, ctx) {
    return { devices: await listDevices(ctx) };
  },

  async details(params, ctx) {
    const { safe } = ctx.lib;
    if (typeof params.id !== 'string' || !params.id) safe.fail('Choose a device');
    const res = await safe.powershellJson(DETAILS, { timeout: 30000, env: { TH_ID: params.id } });
    if (!res.ok) safe.fail(res.error);
    return (res.data || [])[0] || {};
  },

  async safeRemove(params, ctx) {
    const { safe } = ctx.lib;
    if (typeof params.id !== 'string' || !/^(USB|USBSTOR)\\/i.test(params.id)) safe.fail('Only USB drives can be removed here');
    const res = await safe.powershell(EJECT, { timeout: 30000, env: { TH_ID: params.id } });
    const answer = res.stdout.trim();
    if (!res.ok) safe.fail('Windows could not remove this device');
    if (answer === 'ok') return { removed: true };
    if (answer === 'missing') safe.fail('This device is no longer connected');
    if (answer === 'fixed') safe.fail('Windows does not allow this device to be removed while the PC is running');
    const by = answer.split(':').slice(2).join(':');
    safe.fail(`Windows says the device is still in use${by ? ` by ${by}` : ''}. Close any open files and try again.`);
  },
};

module.exports = { id: 'device-manager', actions };
