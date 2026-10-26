const assert=require('assert');const fs=require('fs');const os=require('os');const path=require('path');
const {createStore}=require(require('path').join(__dirname,'..','src','core/store'));
const {createHost}=require(require('path').join(__dirname,'..','src','core/host'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'host-'));
const trashed=[];
(async()=>{
const store=createStore(dir,'win32');
const host=createHost({store,platform:'win32',userData:dir,trash:async p=>{trashed.push(p);}});
// uninstalled tool blocked
let r=await host.invoke('duplicates','scan',{roots:[dir]});
assert.strictEqual(r.ok,false);assert.match(r.error,/not installed/,'uninstalled blocked');
// install then works
store.install('duplicates');
r=await host.invoke('duplicates','scan',{roots:[dir],minSize:0});
assert.strictEqual(r.ok,true,'installed works: '+r.error);
// unknown tool / action
r=await host.invoke('nope','scan',{});
assert.match(r.error,/Unknown tool/);
r=await host.invoke('duplicates','evil',{});
assert.match(r.error,/Unknown action/);
// SafeError surfaces as clean message, not a crash
r=await host.invoke('duplicates','scan',{roots:['/definitely/not/here']});
assert.strictEqual(r.ok,false);assert.match(r.error,/does not exist/);
// bad params type doesn't throw
r=await host.invoke('duplicates','scan',null);
assert.strictEqual(r.ok,false,'null params handled');
// platform gating
const lstore=createStore(fs.mkdtempSync(path.join(os.tmpdir(),'host2-')),'linux');
const lhost=createHost({store:lstore,platform:'linux',userData:dir,trash:async()=>{}});
lstore.install('apps-manager');
r=await lhost.invoke('apps-manager','list',{});
assert.strictEqual(r.ok,false);assert.match(r.error,/not available on this platform/,'platform gate');
// catalog shape
const cat=host.catalog();
assert.strictEqual(cat.tools.length,17,'17 tools');
assert.ok(cat.tools.find(t=>t.id==='duplicates').installed,'installed flag');
assert.ok(cat.tools.find(t=>t.id==='renamer').core,'core flag');
assert.ok(cat.categories.length>0,'categories');
// lazy loading: uninstalled module never required
const before=Object.keys(require.cache).filter(k=>k.includes('tools/network')).length;
assert.strictEqual(before,0,'network module not loaded when uninstalled');
fs.rmSync(dir,{recursive:true,force:true});
console.log('host: all checks passed');
})();
