const assert=require('assert');const fs=require('fs');const os=require('os');const path=require('path');
const src=p=>require(path.join(__dirname,'..','src',p));
const T=src('tools/tree-export'),R=src('tools/renamer'),B=src('tools/disk-benchmark'),D=src('tools/duplicates'),A=src('tools/attributes'),E=src('tools/empty-folders'),O=src('tools/organizer');
const ctx={platform:process.platform};
(async()=>{
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'b7-'));
// tree export: children nested under their parent, siblings alphabetical
fs.mkdirSync(path.join(tmp,'a'));fs.writeFileSync(path.join(tmp,'a','inner.txt'),'x');
fs.mkdirSync(path.join(tmp,'b'));fs.writeFileSync(path.join(tmp,'c.txt'),'y');
let t=await T.actions.export({root:tmp,format:'markdown'},ctx);
assert.deepStrictEqual(t.text.split('\n').slice(1),['- a/','  - inner.txt','- b/','- c.txt'],'markdown tree order');
t=await T.actions.export({root:tmp,format:'text'},ctx);
assert.deepStrictEqual(t.text.split('\n').slice(1),['├── a/','│   └── inner.txt','├── b/','└── c.txt'],'text tree order');
assert.strictEqual(t.count,4);
// case-only rename works and does not clobber
fs.writeFileSync(path.join(tmp,'Song.txt'),'s');
await R.actions.rename({folder:tmp,oldName:'Song.txt',newName:'song.txt'});
assert.ok(fs.readdirSync(tmp).includes('song.txt'),'case-only rename applied');
await assert.rejects(async()=>R.actions.rename({folder:tmp,oldName:'song.txt',newName:'c.txt'}),/already exists/);
// batch rename: swapping two names is allowed, renaming onto an untouched file is not
fs.writeFileSync(path.join(tmp,'x.txt'),'X');fs.writeFileSync(path.join(tmp,'y.txt'),'Y');
await R.actions.renameBatch({folder:tmp,items:[{oldName:'x.txt',newName:'y.txt'},{oldName:'y.txt',newName:'x.txt'}]});
assert.strictEqual(fs.readFileSync(path.join(tmp,'x.txt'),'utf8'),'Y','swap renamed');
await assert.rejects(async()=>R.actions.renameBatch({folder:tmp,items:[{oldName:'x.txt',newName:'c.txt'}]}),/already exists/);
// organizer accepts a trailing slash in the destination
await O.actions.move({folder:tmp,fileName:'x.txt',destFolder:'moved/'});
assert.ok(fs.existsSync(path.join(tmp,'moved','x.txt')),'trailing slash destination');
// empty folders: non-recursive scan still lists empty child folders
fs.mkdirSync(path.join(tmp,'empty'));
const e=await E.actions.scan({root:tmp,recursive:false},ctx);
assert.ok(e.directories.some(d=>d.name==='empty')&&e.directories.some(d=>d.name==='b'),'non-recursive empty folders');
assert.ok(!e.directories.some(d=>d.name==='a'),'non-empty folder excluded');
// attributes: changing read-only on a hidden file (attrib.exe refused this on Windows)
const hidden=path.join(tmp,'.secret.txt');fs.writeFileSync(hidden,'h');
if(process.platform==='win32'){
  let r=await A.actions.apply({root:tmp,paths:[hidden],changes:{hidden:true}},ctx);assert.strictEqual(r.updated,1,'set hidden');
  r=await A.actions.apply({root:tmp,paths:[hidden],changes:{readonly:true}},ctx);assert.strictEqual(r.updated,1,'readonly on hidden file');
  const l=await A.actions.list({folder:tmp},ctx);const attrs=l.files.find(f=>f.name==='.secret.txt').attrs;
  assert.ok(attrs.hidden&&attrs.readonly,'both attributes set');
  r=await A.actions.apply({root:tmp,paths:[hidden],changes:{readonly:false,hidden:false}},ctx);assert.strictEqual(r.updated,1,'cleared');
}
// disk benchmark can read back its own file
const bench=await B.actions.run({root:tmp,sizeMiB:32},ctx);
assert.ok(bench.readMiBs>0&&bench.writeMiBs>0,'benchmark read and write');
assert.ok(!fs.readdirSync(tmp).some(n=>n.startsWith('.toolhub-benchmark')),'benchmark file removed');
// duplicates: cancelling mid-hash settles instead of hanging
const big=Buffer.alloc(4*1024*1024,7);
for(let i=0;i<6;i++)fs.writeFileSync(path.join(tmp,`dup${i}.bin`),big);
const controller=new AbortController();
const scan=D.actions.scan({roots:[tmp]},{...ctx,signal:controller.signal});
setTimeout(()=>controller.abort(),5);
const outcome=await Promise.race([scan.then(()=>'done',err=>err.name),new Promise(r=>setTimeout(()=>r('hung'),5000))]);
assert.notStrictEqual(outcome,'hung','cancel does not hang');
fs.rmSync(tmp,{recursive:true,force:true});
console.log('regression checks: all passed');
})().catch(err=>{console.error(err);process.exitCode=1;});
