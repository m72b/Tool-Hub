const assert=require('assert');const fs=require('fs');const os=require('os');const path=require('path');
const registry=require(path.join(__dirname,'sections')).register();
const {createStore}=require(path.join(__dirname,'..','src','core/store'));
const ids=registry.listTools('win32').map(t=>t.id);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'store-'));
let s=createStore(dir,'win32');
assert.deepStrictEqual(s.load().installed,[],'nothing installed by default');
assert.strictEqual(s.load().setupComplete,false);
s.syncAddonTools(ids);
assert.ok(s.isInstalled('duplicates'),'installed');
s.install('bogus-tool');
assert.ok(!s.isInstalled('bogus-tool'),'unknown tool rejected');
s.uninstall('duplicates');
assert.ok(!s.isInstalled('duplicates'),'hidden');
// platform filtering
let lin=createStore(dir,'linux');
lin.setInstalled(['apps-manager','duplicates'],true);
assert.ok(!lin.isInstalled('apps-manager'),'win-only tool rejected on linux');
assert.ok(lin.isInstalled('duplicates'));
// persistence
let s2=createStore(dir,'linux');
assert.ok(s2.isInstalled('duplicates'),'persisted across instances');
assert.strictEqual(s2.load().setupComplete,true);
s2.setOffline(true);
assert.strictEqual(createStore(dir,'linux').load().offline,true,'offline persisted');
assert.strictEqual(createStore(dir,'linux').markSectionsChosen().sectionsChosen,true);
// corrupt file
fs.writeFileSync(path.join(dir,'installed-tools.json'),'{{{not json');
let s3=createStore(dir,'win32');
assert.deepStrictEqual(s3.load().installed,[],'corrupt falls back');
fs.rmSync(dir,{recursive:true,force:true});
console.log('store.js: all checks passed');
