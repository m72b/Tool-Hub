const assert=require('assert');const fs=require('fs');const os=require('os');const path=require('path');
const IO=require(require('path').join(__dirname,'..','src','core/imageio'));
const D=require(require('path').join(__dirname,'..','src','tools/drive-health'));
const A=require(require('path').join(__dirname,'..','src','tools/apps-manager'));
const S=require(require('path').join(__dirname,'..','src','tools/startup-manager'));
(async()=>{
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'img-'));
const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
fs.writeFileSync(path.join(tmp,'a.png'),png);
fs.writeFileSync(path.join(tmp,'b.jpg'),Buffer.from([0xff,0xd8,0xff]));
fs.writeFileSync(path.join(tmp,'notimage.txt'),'x');
let l=await IO.listImages({folder:tmp});
assert.strictEqual(l.files.length,2,'only images listed, got '+l.files.length);
let r=await IO.read({path:path.join(tmp,'a.png')});
assert.ok(r.dataUrl.startsWith('data:image/png;base64,'),'png dataurl');
await assert.rejects(async()=>IO.read({path:path.join(tmp,'notimage.txt')}),/Unsupported image type/);
// write validation
const goodPng='data:image/png;base64,'+png.toString('base64');
let w=await IO.write({dir:tmp,name:'out.png',dataUrl:goodPng});
assert.ok(fs.existsSync(w.path),'wrote file');
await assert.rejects(async()=>IO.write({dir:tmp,name:'out.png',dataUrl:goodPng}),/already exists/);
await assert.doesNotReject(async()=>IO.write({dir:tmp,name:'out.png',dataUrl:goodPng,overwrite:true}));
await assert.rejects(async()=>IO.write({dir:tmp,name:'../escape.png',dataUrl:goodPng}),/Invalid output file name/);
await assert.rejects(async()=>IO.write({dir:tmp,name:'a/b.png',dataUrl:goodPng}),/Invalid output file name/);
await assert.rejects(async()=>IO.write({dir:tmp,name:'out.exe',dataUrl:goodPng}),/Unsupported output format/);
await assert.rejects(async()=>IO.write({dir:tmp,name:'out.png',dataUrl:'data:image/jpeg;base64,'+png.toString('base64'),overwrite:true}),/does not match/);
await assert.rejects(async()=>IO.write({dir:tmp,name:'out2.png',dataUrl:'notadataurl'}),/Invalid image data/);
await assert.rejects(async()=>IO.write({dir:tmp,name:'out3.png',dataUrl:'data:image/png;base64,'}),/Invalid image data/);
// windows tools degrade gracefully off-windows
const ctx={platform:'linux',userData:tmp};
let dh=await D.actions.get({},ctx);
assert.strictEqual(dh.supported,false);assert.match(dh.message,/only available on Windows/);
let am=await A.actions.list({},ctx);
assert.strictEqual(am.supported,false);
await assert.rejects(async()=>A.actions.uninstall({key:'x'},ctx),/Only available on Windows/);
let sm=await S.actions.list({},ctx);
assert.strictEqual(sm.supported,false);
await assert.rejects(async()=>S.actions.setEnabled({id:'x'},ctx),/Only available on Windows/);
// uninstall refuses unknown key even on win
await assert.rejects(async()=>A.actions.uninstall({key:'nope'},{platform:'win32'}),/Refresh the application list/);
assert.strictEqual(D.statusLabel('Healthy'),'healthy');
assert.strictEqual(D.statusLabel('Unhealthy'),'critical');
assert.strictEqual(D.statusLabel(null),'unknown');
fs.rmSync(tmp,{recursive:true,force:true});
console.log('imageio + windows tools: all checks passed');
})();
