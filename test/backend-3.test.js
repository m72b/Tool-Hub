const assert=require('assert');const fs=require('fs');const os=require('os');const path=require('path');
const A=require(require('path').join(__dirname,'..','src','tools/attributes'));
const D=require(require('path').join(__dirname,'..','src','tools/file-dates'));
const ctx={platform:process.platform};
(async()=>{
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'attr-'));
const f1=path.join(tmp,'a.txt');fs.writeFileSync(f1,'x');
const f2=path.join(tmp,'.hidden.txt');fs.writeFileSync(f2,'y');
const outside=fs.mkdtempSync(path.join(os.tmpdir(),'out-'));
const f3=path.join(outside,'z.txt');fs.writeFileSync(f3,'z');
// attributes list
let l=await A.actions.list({folder:tmp},ctx);
assert.strictEqual(l.files.length,2,'lists 2');
assert.ok(l.files.find(f=>f.name==='.hidden.txt').attrs.hidden,'dotfile hidden on unix');
// readonly toggle
let r=await A.actions.apply({root:tmp,paths:[f1],changes:{readonly:true}},ctx);
assert.strictEqual(r.updated,1,'set readonly');
assert.strictEqual((fs.statSync(f1).mode&0o200),0,'write bit cleared');
r=await A.actions.apply({root:tmp,paths:[f1],changes:{readonly:false}},ctx);
assert.ok((fs.statSync(f1).mode&0o200)!==0,'write bit restored');
// guards
await assert.rejects(async()=>A.actions.apply({root:tmp,paths:[f1],changes:{}},ctx),/No attribute changes/);
await assert.rejects(async()=>A.actions.apply({root:tmp,paths:[],changes:{readonly:true}},ctx),/No files selected/);
r=await A.actions.apply({root:tmp,paths:[f3],changes:{readonly:true}},ctx);
assert.strictEqual(r.updated,0,'outside root blocked');
assert.match(r.failed[0].error,/outside the permitted folder/);
// dates
let dl=await D.actions.list({folder:tmp},ctx);
assert.strictEqual(dl.files.length,2);
assert.ok(dl.files[0].modified>0,'has mtime');
const target=new Date('2019-03-07T10:30:00Z');
let dr=await D.actions.apply({root:tmp,paths:[f1],modified:target.toISOString()},ctx);
assert.strictEqual(dr.updated,1,'modified set');
assert.strictEqual(new Date(fs.statSync(f1).mtime).toISOString(),target.toISOString(),'mtime persisted');
await assert.rejects(async()=>D.actions.apply({root:tmp,paths:[f1]},ctx),/at least one date/);
await assert.rejects(async()=>D.actions.apply({root:tmp,paths:[f1],modified:'not-a-date'},ctx),/Invalid date/);
await assert.rejects(async()=>D.actions.apply({root:tmp,paths:[f1],modified:'1200-01-01'},ctx),/supported range/);
if(process.platform!=='win32'){
  await assert.rejects(async()=>D.actions.apply({root:tmp,paths:[f1],created:target.toISOString()},ctx),/only be changed on Windows/);
}
dr=await D.actions.apply({root:tmp,paths:[f3],modified:target.toISOString()},ctx);
assert.strictEqual(dr.updated,0,'outside root blocked for dates');
fs.rmSync(tmp,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});
console.log('attribute + date tools: all checks passed');
})();
