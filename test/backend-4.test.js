const assert=require('assert');
const N=require(require('path').join(__dirname,'..','src','tools/network'));
const S=require(require('path').join(__dirname,'..','src','tools/system-info'));
(async()=>{
// arg building never lets host become a flag / injection
assert.deepStrictEqual(N.buildPingArgs('win32','example.com',4),['-n','4','-w','4000','example.com']);
assert.deepStrictEqual(N.buildPingArgs('linux','8.8.8.8',2),['-c','2','-w','10','8.8.8.8']);
assert.deepStrictEqual(N.buildTraceArgs('win32','a.com',20),['-h','20','-w','3000','-d','a.com']);
// host validation blocks injection before it reaches argv
for(const bad of['a.com;id','a.com && calc','$(id)','-n 100','a b']){
  await assert.rejects(async()=>N.actions.ping({host:bad},{platform:'linux'}),/invalid characters|required/,'blocked: '+bad);
}
// count clamped
const a=N.buildPingArgs('linux','h',999);assert.strictEqual(a[1],'999');
await assert.rejects(async()=>N.actions.lookup({host:'bad host'}),/invalid characters/);
// ping parser
const sample=`Pinging example.com [93.184.216.34] with 32 bytes of data:
Reply from 93.184.216.34: bytes=32 time=12ms TTL=56
Reply from 93.184.216.34: bytes=32 time=15ms TTL=56
Packets: Sent = 2, Received = 2, Lost = 0 (0% loss),`;
const p=N.parsePing(sample);
assert.deepStrictEqual(p.times,[12,15],'times parsed');
assert.strictEqual(p.summary.avg,13.5,'avg');
assert.strictEqual(p.summary.min,12);assert.strictEqual(p.summary.max,15);
assert.strictEqual(p.loss,0,'loss parsed');
const unix=`64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=9.20 ms
2 packets transmitted, 2 received, 50% packet loss`;
const p2=N.parsePing(unix);
assert.strictEqual(p2.times[0],9.2);assert.strictEqual(p2.loss,50);
// ipinfo works offline
const ip=await N.actions.ipinfo();
assert.ok(Array.isArray(ip.interfaces)&&ip.interfaces.length>0,'interfaces');
assert.ok(ip.interfaces.every(i=>typeof i.address==='string'));
assert.ok(typeof ip.hostname==='string');
// system info
const si=await S.actions.get({},{platform:process.platform});
assert.ok(si.cpu.cores>0,'cores');
assert.ok(si.memory.total>0,'mem');
assert.ok(si.memory.percent>=0&&si.memory.percent<=100,'mem pct');
assert.ok(Array.isArray(si.storage),'storage array');
assert.ok(si.storage.length>0&&si.storage[0].total>0,'storage populated');
assert.ok(si.storage.every(s=>s.percent>=0&&s.percent<=100),'storage pct sane');
assert.match(S.formatUptime(90061),/^1d 1h 1m$/);
console.log('network + system-info: all checks passed');
})();
