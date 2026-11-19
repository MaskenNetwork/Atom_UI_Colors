'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const defaultBase = () => path.join(os.homedir(),'.atom-ui-colors');
function atomicWrite(file,text) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary = file+'.'+crypto.randomUUID()+'.tmp';
  try { fs.writeFileSync(temporary,text,{mode:0o600}); fs.renameSync(temporary,file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function writeJSON(file,value) { atomicWrite(file,JSON.stringify(value,null,2)+'\n'); }
function readJSON(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : null; }
function locateWorkbench(appRoot) {
  for (const directory of ['electron-browser/workbench','electron-browser','electron-sandbox/workbench','electron-sandbox']) {
    for (const name of ['workbench.html','workbench.esm.html','workbench-dev.html']) {
      const candidate = path.join(appRoot,'out/vs/code',directory,name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error('Unsupported VS Code layout: workbench HTML was not found.');
}
function profilePaths(settingsPath, base = defaultBase()) {
  const token = hash(path.resolve(settingsPath)).slice(0,24);
  const directory = path.join(base,'profiles',token);
  return {base,token,directory,statePath:path.join(directory,'state.json'),cssPath:path.join(directory,'icons.css'),cssUrl:pathToFileURL(path.join(directory,'icons.css')).href};
}
function restoreProfile(state) {
  if(state.schema===2) return require('./application.cjs').restore(state);
  throw new Error('Legacy snapshots are not verified CSP baselines. Migrate with Apply before Restore; recovery data retained.');
}
function restoreAll(base = defaultBase(), owner) {
  require('./application.cjs').recover(base,owner);
  const profiles = path.join(base,'profiles');
  if (!fs.existsSync(profiles)) return {restored:0};
  const allStates = fs.readdirSync(profiles,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>readJSON(path.join(profiles,e.name,'state.json'))).filter(Boolean);
  const states=allStates.filter(state=>!owner || state.owner===path.resolve(owner));
  if(states.some(state=>state.schema!==2)) throw new Error('Uninstall found unverified legacy recovery data. No cleanup performed. Recovery retained in '+base);
  // Per-token removal preserves other profiles and owners, including later edits.
  // Keep journals and application baselines for recovery and diagnostics.
  const failures=[];
  for(const state of states) {
    try {require('./application.cjs').restore(state);} catch(error) {failures.push(error);}
  }
  if(failures.length) throw new AggregateError(failures,'Uninstall cleanup incomplete; recovery files retained in '+base);
  for(const state of states) if(isInside(base,state.statePath) && fs.existsSync(state.statePath)) fs.unlinkSync(state.statePath);
  return {restored:states.length,reloadRequired:true};
}
function isInside(root,target) { const relative=path.relative(path.resolve(root),path.resolve(target)); return relative!=='' && !relative.startsWith('..') && !path.isAbsolute(relative); }
async function withLock(base, callback) {
  fs.mkdirSync(base,{recursive:true});
  const lock=path.join(base,'operation.lock');
  const identity=JSON.stringify({pid:process.pid,nonce:crypto.randomUUID()});
  const deadline=Date.now()+8000;
  while(true) {
    try { fs.writeFileSync(lock,identity,{flag:'wx',mode:0o600}); break; }
    catch(error) {
      if(error.code!=='EEXIST') throw error;
      try { const owner=readJSON(lock); try { process.kill(owner.pid,0); } catch(e) { if(e.code==='ESRCH') { fs.unlinkSync(lock); continue; } } } catch { /* An in-progress lock is not safe to remove. */ }
      if(Date.now()>deadline) throw new Error('Another Atom UI Colors operation is running. Retry shortly.');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  }
  try { return await callback(); } finally { if(fs.existsSync(lock) && fs.readFileSync(lock,'utf8')===identity) fs.unlinkSync(lock); }
}
module.exports={hash,defaultBase,atomicWrite,writeJSON,readJSON,locateWorkbench,profilePaths,restoreProfile,restoreAll,withLock,isInside};
