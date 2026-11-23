'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {metadataPaths,inventory,removalEvidence,observeRemoval}=require('../src/removal.cjs');
const id='maskennetwork.atom-ui-colors';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'atom-removal-'));
  const extensionPath=path.join(root,'extensions',id+'-0.2.1'),settingsPath=path.join(root,'User/settings.json');
  fs.mkdirSync(path.dirname(extensionPath),{recursive:true});fs.mkdirSync(path.dirname(settingsPath),{recursive:true});
  const paths=metadataPaths(extensionPath,settingsPath),present=[{identifier:{id},version:'0.2.1'}];
  const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value));
  write(paths.profile,present);write(paths.obsolete,{});
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return {root,extensionPath,settingsPath,paths,present,write};
}
async function until(predicate) {const end=Date.now()+3000;while(!predicate()){if(Date.now()>end)throw Error('Removal was not observed');await pause(10);}}
test('cleanup requires a valid absent ID and the exact installed-folder removal marker',t=>{
  const f=fixture(t);assert.equal(removalEvidence(f.paths,id),null);
  f.write(f.paths.profile,[]);assert.equal(removalEvidence(f.paths,id),null);
  f.write(f.paths.obsolete,{[id+'-0.1.3']:true});assert.equal(removalEvidence(f.paths,id),null);
  f.write(f.paths.obsolete,{[f.paths.folder]:true});assert(removalEvidence(f.paths,id));
  const newer=id+'-0.2.2';fs.mkdirSync(path.join(f.paths.owner,newer));
  assert.equal(removalEvidence(f.paths,id),null);
  f.write(f.paths.obsolete,{[f.paths.folder]:true,[newer]:true});assert(removalEvidence(f.paths,id));
  f.write(f.paths.profile,[{identifier:{id},version:'0.2.2'}]);assert.equal(removalEvidence(f.paths,id),null);
  for(const text of ['{broken','{}','[null]','[{"identifier":{}}]']) {fs.writeFileSync(f.paths.profile,text);assert.equal(inventory(f.paths.profile,id),null);assert.equal(removalEvidence(f.paths,id),null);}
  fs.unlinkSync(f.paths.profile);assert.equal(removalEvidence(f.paths,id),null);
});
test('profile metadata stays within the current extensions owner or named profile',()=>{
  assert.equal(metadataPaths('/data/extensions/extension','/data/User/settings.json').profile,path.join('/data/extensions','extensions.json'));
  assert.equal(metadataPaths('/data/extensions/extension','/data/User/profiles/second/settings.json').profile,path.join('/data/User/profiles/second','extensions.json'));
  assert.equal(metadataPaths('/data/extensions/extension','/unknown/settings.json').profile,null);
});
test('real metadata polling observes uninstall once, after stable evidence, without a resident helper',async t=>{
  const f=fixture(t);let calls=0;
  const observer=observeRemoval({...f,id,interval:20,settle:60,onRemoval:confirmed=>{assert(confirmed());calls++;}});
  t.after(()=>observer.dispose());
  f.write(f.paths.profile,[]);await pause(120);assert.equal(calls,0);
  f.write(f.paths.obsolete,{[f.paths.folder]:true});await until(()=>calls===1);
  f.write(f.paths.obsolete,{[f.paths.folder]:true,unrelated:true});await pause(150);assert.equal(calls,1);
});
test('removal immediately after startup is detected without file-change notifications',async t=>{
  // A native watcher can take its first asynchronous snapshot after both writes,
  // so no later stat change exists to notify the observer about this removal.
  t.mock.method(fs,'watchFile',()=>{});
  t.mock.method(fs,'unwatchFile',()=>{});
  const f=fixture(t);let calls=0;
  const observer=observeRemoval({...f,id,interval:20,settle:60,onRemoval:confirmed=>{assert(confirmed());calls++;}});
  t.after(()=>observer.dispose());
  f.write(f.paths.obsolete,{[f.paths.folder]:true});f.write(f.paths.profile,[]);
  await until(()=>calls===1);
});
test('updates and transient or malformed index rewrites do not trigger cleanup',async t=>{
  const f=fixture(t);let calls=0;
  const observer=observeRemoval({...f,id,interval:20,settle:100,onRemoval:()=>calls++});t.after(()=>observer.dispose());
  f.write(f.paths.obsolete,{[f.paths.folder]:true});
  f.write(f.paths.profile,[]);await pause(35);fs.writeFileSync(f.paths.profile,'[');await pause(35);
  f.write(f.paths.profile,[{identifier:{id},version:'0.2.2'}]);await pause(250);assert.equal(calls,0);
  fs.unlinkSync(f.paths.profile);await pause(120);assert.equal(calls,0);
  f.write(f.paths.profile,f.present);await pause(120);assert.equal(calls,0);
});
test('no cleanup is inferred from missing initial installation evidence or after disposal',async t=>{
  const f=fixture(t);f.write(f.paths.profile,[]);f.write(f.paths.obsolete,{[f.paths.folder]:true});let calls=0;
  const observer=observeRemoval({...f,id,interval:20,settle:40,onRemoval:()=>calls++});
  await pause(150);assert.equal(calls,0);observer.dispose();f.write(f.paths.profile,f.present);await pause(50);f.write(f.paths.profile,[]);await pause(150);assert.equal(calls,0);
});
test('reinstall before serialized cleanup cancels removal and allows later observation',async t=>{
  const f=fixture(t);let calls=0;
  const observer=observeRemoval({...f,id,interval:20,settle:40,onRemoval:confirmed=>{
    calls++;
    if(calls===1){f.write(f.paths.profile,f.present);assert(!confirmed());return {cancelled:true};}
    assert(confirmed());
  }});t.after(()=>observer.dispose());
  f.write(f.paths.obsolete,{[f.paths.folder]:true});f.write(f.paths.profile,[]);await until(()=>calls===1);await pause(100);f.write(f.paths.profile,[]);await until(()=>calls===2);
});
