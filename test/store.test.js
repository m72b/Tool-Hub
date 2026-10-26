const assert=require('assert');const fs=require('fs');const os=require('os');const path=require('path');
const {createStore}=require(require('path').join(__dirname,'..','src','core/store'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'store-'));
let s=createStore(dir,'win32');
let st=s.load();
assert.deepStrictEqual(st.installed.sort(),['organizer','renamer'],'defaults are core only');
assert.strictEqual(st.setupComplete,false);
s.install('duplicates');
assert.ok(s.isInstalled('duplicates'),'installed');
s.install('bogus-tool');
assert.ok(!s.isInstalled('bogus-tool'),'unknown tool rejected');
s.uninstall('renamer');
assert.ok(s.isInstalled('renamer'),'core cannot be uninstalled');
s.uninstall('duplicates');
assert.ok(!s.isInstalled('duplicates'),'uninstalled');
// platform filtering
let lin=createStore(dir,'linux');
lin.setInstalled(['apps-manager','duplicates'],true);
assert.ok(!lin.isInstalled('apps-manager'),'win-only tool rejected on linux');
assert.ok(lin.isInstalled('duplicates'));
// persistence
let s2=createStore(dir,'linux');
assert.ok(s2.isInstalled('duplicates'),'persisted across instances');
assert.strictEqual(s2.load().setupComplete,true);
// corrupt file
fs.writeFileSync(path.join(dir,'installed-tools.json'),'{{{not json');
let s3=createStore(dir,'win32');
assert.deepStrictEqual(s3.load().installed.sort(),['organizer','renamer'],'corrupt falls back');
fs.rmSync(dir,{recursive:true,force:true});
console.log('store.js: all checks passed');
