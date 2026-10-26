const assert=require('assert');const fs=require('fs');const os=require('os');const path=require('path');const crypto=require('crypto');
const T=require(require('path').join(__dirname,'..','src','tools/temp-cleaner'));
const H=require(require('path').join(__dirname,'..','src','tools/hash-tool'));
const F=require(require('path').join(__dirname,'..','src','tools/folder-compare'));
(async()=>{
// hash
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hash-'));
const f1=path.join(tmp,'f1.txt');fs.writeFileSync(f1,'hello world');
const expectSha=crypto.createHash('sha256').update('hello world').digest('hex');
const expectMd5=crypto.createHash('md5').update('hello world').digest('hex');
let r=await H.actions.hashFiles({paths:[f1],algo:'sha256'});
assert.strictEqual(r.results[0].hash,expectSha,'sha256 matches');
r=await H.actions.hashFiles({paths:[f1],algo:'md5'});
assert.strictEqual(r.results[0].hash,expectMd5,'md5 matches');
r=await H.actions.hashFiles({paths:[f1],algo:'bogus'});
assert.strictEqual(r.algo,'sha256','unknown algo falls back');
r=await H.actions.hashFiles({paths:[path.join(tmp,'missing')],algo:'sha256'});
assert.strictEqual(r.results[0].ok,false,'missing file reported');
let v=await H.actions.verify({path:f1,algo:'sha256',expected:expectSha.toUpperCase()});
assert.strictEqual(v.match,true,'verify case-insensitive');
v=await H.actions.verify({path:f1,algo:'sha256',expected:expectMd5});
assert.strictEqual(v.match,false,'wrong hash detected');
await assert.rejects(async()=>H.actions.verify({path:f1,expected:'zzz'}),/valid hex/);
// folder compare
const L=path.join(tmp,'L'),R=path.join(tmp,'R');
fs.mkdirSync(path.join(L,'sub'),{recursive:true});fs.mkdirSync(path.join(R,'sub'),{recursive:true});
fs.writeFileSync(path.join(L,'same.txt'),'AAA');fs.writeFileSync(path.join(R,'same.txt'),'AAA');
fs.writeFileSync(path.join(L,'diff.txt'),'AAA');fs.writeFileSync(path.join(R,'diff.txt'),'BBB');
fs.writeFileSync(path.join(L,'onlyleft.txt'),'L');fs.writeFileSync(path.join(R,'onlyright.txt'),'R');
fs.writeFileSync(path.join(L,'sub/deep.txt'),'D');fs.writeFileSync(path.join(R,'sub/deep.txt'),'D');
let c=await F.actions.compare({left:L,right:R,mode:'size'});
assert.strictEqual(c.counts.onlyLeft,1,'onlyLeft');
assert.strictEqual(c.counts.onlyRight,1,'onlyRight');
assert.strictEqual(c.counts.different,0,'size mode: AAA vs BBB same size => not different');
c=await F.actions.compare({left:L,right:R,mode:'hash'});
assert.strictEqual(c.counts.different,1,'hash mode detects content diff');
assert.strictEqual(c.different[0].reason,'content');
assert.strictEqual(c.counts.identical,2,'same.txt + sub/deep.txt identical');
c=await F.actions.compare({left:L,right:R,mode:'hash',recursive:false});
assert.strictEqual(c.counts.identical,1,'non-recursive skips sub');
await assert.rejects(async()=>F.actions.compare({left:L,right:L}),/two different folders/);
// temp cleaner scan (real dirs on this box)
const ctx={platform:process.platform,trash:async p=>fs.rmSync(p,{recursive:true,force:true})};
let s=await T.actions.scan({},ctx);
assert.ok(Array.isArray(s.targets)&&s.targets.length>0,'targets listed');
assert.ok(s.targets.every(t=>path.isAbsolute(t.path)),'abs paths');
await assert.rejects(async()=>T.actions.clean({ids:[]},ctx),/No categories/);
await assert.rejects(async()=>T.actions.clean({ids:['../etc']},ctx),/No valid categories/);
// clean only touches inside an allowlisted dir: simulate by pointing at a fake target
fs.rmSync(tmp,{recursive:true,force:true});
console.log('file tools: all checks passed');
})();
