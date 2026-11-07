const { safe } = globalThis.toolHubLib;

async function locking(params, ctx) {
  if (ctx.platform !== 'win32') safe.fail('File lock lookup is available on Windows only');
  const file = safe.existingFile(params.path);
  const script = `$source=@'
using System;using System.Runtime.InteropServices;using System.Text;
public static class ToolHubRestartManager {
 public enum AppType { Unknown, MainWindow, OtherWindow, Service, Explorer, Console, Critical }
 [StructLayout(LayoutKind.Sequential)] public struct FileTime { public uint Low; public uint High; }
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct ProcessInfo { public uint Pid; public FileTime Start; public AppType Type; public uint Status; public uint Session; [MarshalAs(UnmanagedType.Bool)] public bool Restartable; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string AppName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string ServiceName; }
 [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] public static extern int RmStartSession(out uint handle, int flags, StringBuilder key);
 [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] public static extern int RmRegisterResources(uint handle, uint fileCount, string[] files, uint appCount, IntPtr apps, uint serviceCount, string[] services);
 [DllImport("rstrtmgr.dll")] public static extern int RmGetList(uint handle, out uint needed, ref uint count, [In,Out] ProcessInfo[] info, ref uint reasons);
 [DllImport("rstrtmgr.dll")] public static extern int RmEndSession(uint handle);
}
'@;Add-Type -TypeDefinition $source;$key=New-Object Text.StringBuilder 64;[uint32]$h=0;$code=[ToolHubRestartManager]::RmStartSession([ref]$h,0,$key);if($code -ne 0){throw "Restart Manager error $code"};try{[void][ToolHubRestartManager]::RmRegisterResources($h,1,@($env:TOOLHUB_FILE),0,[IntPtr]::Zero,0,$null);[uint32]$need=0;[uint32]$count=0;[uint32]$reason=0;$code=[ToolHubRestartManager]::RmGetList($h,[ref]$need,[ref]$count,$null,[ref]$reason);if($code -eq 234 -and $need){$items=New-Object 'ToolHubRestartManager+ProcessInfo[]' $need;$count=$need;$code=[ToolHubRestartManager]::RmGetList($h,[ref]$need,[ref]$count,$items,[ref]$reason);if($code -ne 0){throw "Restart Manager error $code"};$items|Select-Object -First $count|ForEach-Object{$p=Get-Process -Id $_.Pid -ErrorAction SilentlyContinue;[PSCustomObject]@{Pid=$_.Pid;Process=if($p){$p.ProcessName}else{'Unknown'}}}|ConvertTo-Json -Compress}elseif($code -eq 0){'[]'}else{throw "Restart Manager error $code"}}finally{[void][ToolHubRestartManager]::RmEndSession($h)}`;
  const result = await safe.powershellJson(script, { env: { TOOLHUB_FILE: file }, timeout: 30000 });
  if (!result.ok) safe.fail(result.error);
  return { path: file, processes: result.data || [] };
}

module.exports = { id: 'file-locks', actions: { locking } };
