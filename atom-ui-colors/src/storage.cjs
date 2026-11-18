'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const settings = require('./settings.cjs');
const {stripStyles} = require('./css.cjs');
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
function prepare(settingsPath, htmlPath, base, owner) {
  const paths = profilePaths(settingsPath,base);
  const old = readJSON(paths.statePath);
  const raw = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath,'utf8') : '{}\n';
  const parsed = settings.parse(raw);
  const state = old?.active ? old : {schema:1,settingsPath:path.resolve(settingsPath),...paths,originalSettings:raw,settingsOriginallyExisted:fs.existsSync(settingsPath),importsOriginallyPresent:Object.hasOwn(parsed,settings.KEY),active:false,canRestoreSettingsExactly:true};
  if(owner) state.owner=path.resolve(owner);
  if (old?.active && old.settingsAfterHash && hash(raw)!==old.settingsAfterHash) state.canRestoreSettingsExactly=false;
  const appStatePath = path.join(paths.base,'applications',hash(path.resolve(htmlPath)).slice(0,24)+'.json');
  const currentHtml=fs.readFileSync(htmlPath,'utf8');
  if (!readJSON(appStatePath) || !currentHtml.includes('/* ATOM-UI-COLORS:BEGIN ')) writeJSON(appStatePath,{schema:1,htmlPath:path.resolve(htmlPath),before:currentHtml,afterHash:null,canRestoreExactly:true});
  state.appStatePaths = [...new Set([...(state.appStatePaths||[]),appStatePath])];
  writeJSON(paths.statePath,state); // Persist before changing CSS, settings or HTML.
  return state;
}
const normalizeUnowned = html => stripStyles(html).replace(/<!-- !! VSCODE-CUSTOM-CSS-SESSION-ID [\w-]+ !! -->/g,'<!-- CUSTOM-CSS-SESSION -->').replace(/>\s+</g,'><').trim();
function recordSettingsChanged(state) {
  state.settingsAfterHash=hash(fs.readFileSync(state.settingsPath));
  writeJSON(state.statePath,state);
}
function loaderBackups(htmlPath) {
  return fs.readdirSync(path.dirname(htmlPath)).filter(name=>/^workbench\.[\da-f-]+\.bak-custom-css$/i.test(name));
}
function recordApplied(state, htmlPath, backupsBefore=[]) {
  state.active = true;
  state.cssHash = hash(fs.readFileSync(state.cssPath));
  state.settingsAfterHash = hash(fs.readFileSync(state.settingsPath));
  writeJSON(state.statePath,state);
  for (const file of state.appStatePaths) {
    const app = readJSON(file);
    if (app?.htmlPath === path.resolve(htmlPath)) {
      const html=fs.readFileSync(htmlPath,'utf8');
      const unownedHash=hash(normalizeUnowned(html));
      if(app.unownedHash && app.unownedHash!==unownedHash) app.canRestoreExactly=false;
      app.unownedHash=unownedHash;
      app.afterHash=hash(html);
      app.ownedBackups ||= {};
      for(const name of loaderBackups(htmlPath)) if(!backupsBefore.includes(name)) app.ownedBackups[name]=hash(fs.readFileSync(path.join(path.dirname(htmlPath),name)));
      writeJSON(file,app);
    }
  }
}
function restoreSettings(state) {
  if (!fs.existsSync(state.settingsPath)) return;
  const current = fs.readFileSync(state.settingsPath,'utf8');
  const value = settings.parse(current);
  // If settings did not change later, restore the original text exactly.
  // Otherwise remove only the owned URL and preserve all later edits.
  const restored = state.canRestoreSettingsExactly && state.settingsAfterHash && hash(current)===state.settingsAfterHash
    ? state.originalSettings : settings.removeOwned(current,state.cssUrl,state.importsOriginallyPresent);
  if (current!==restored) atomicWrite(state.settingsPath,restored);
  if(state.settingsOriginallyExisted===false && state.canRestoreSettingsExactly && state.settingsAfterHash && hash(current)===state.settingsAfterHash) fs.unlinkSync(state.settingsPath);
}
function restoreApplication(file, token, all = false, selectiveOnly = false) {
  const app = readJSON(file);
  if (!app || !fs.existsSync(app.htmlPath)) return;
  const current = fs.readFileSync(app.htmlPath,'utf8');
  const noOwnedToken=token && !current.includes(`/* ATOM-UI-COLORS:BEGIN ${token} */`);
  if(token && [...current.matchAll(/\/\* ATOM-UI-COLORS:BEGIN ([a-zA-Z0-9-]+) \*\//g)].some(match=>match[1]!==token)) selectiveOnly=true;
  let restored;
  if (!noOwnedToken && !selectiveOnly && app.canRestoreExactly && app.afterHash && hash(current)===app.afterHash) restored = stripStyles(app.before,all ? undefined : token);
  else restored = stripStyles(current,all ? undefined : token);
  if (current!==restored) atomicWrite(app.htmlPath,restored);
  for(const [name,digest] of Object.entries(selectiveOnly?{}:app.ownedBackups||{})) {
    if(!/^workbench\.[\da-f-]+\.bak-custom-css$/i.test(name)) continue;
    const backup=path.join(path.dirname(app.htmlPath),name);
    if(fs.existsSync(backup) && hash(fs.readFileSync(backup))===digest) fs.unlinkSync(backup);
  }
  // Selective removal never restores unrelated application files or old builds.
}
function restoreProfile(state) {
  const errors = [];
  for (const file of state.appStatePaths||[]) {
    try { restoreApplication(file,state.token); } catch(error) { errors.push(error); }
  }
  try { restoreSettings(state); } catch(error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors,'Restore incomplete. Backups retained.');
  if (fs.existsSync(state.cssPath)) fs.unlinkSync(state.cssPath);
  state.active=false;
  writeJSON(state.statePath,state);
}
function restoreAll(base = defaultBase(), owner) {
  const profiles = path.join(base,'profiles');
  if (!fs.existsSync(profiles)) return {restored:0};
  const allStates = fs.readdirSync(profiles,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>readJSON(path.join(profiles,e.name,'state.json'))).filter(Boolean);
  const states=allStates.filter(state=>!owner || state.owner===path.resolve(owner));
  const errors = [];
  const applications = new Set(states.flatMap(state=>state.appStatePaths||[]));
  const shared=new Set();
  for(const file of applications) {
    try {
      if(allStates.some(state=>!states.includes(state) && state.active && state.appStatePaths?.includes(file))) {
        shared.add(file);
        for(const state of states) if(state.appStatePaths?.includes(file)) restoreApplication(file,state.token,false,true);
      } else restoreApplication(file,undefined,true);
    } catch(error) {errors.push(error);}
  }
  for (const state of states) { try { restoreSettings(state); } catch(error) { errors.push(error); } }
  if (errors.length) throw new AggregateError(errors,'Uninstall cleanup incomplete; recovery files were kept in '+base);
  // Delete only recorded/generated files in our own dedicated storage tree.
  for (const state of states) for (const file of [state.cssPath,state.statePath]) {
    if (isInside(base,file) && fs.existsSync(file)) fs.unlinkSync(file);
  }
  for (const file of applications) if (!shared.has(file) && isInside(base,file) && fs.existsSync(file)) fs.unlinkSync(file);
  // Empty directories are harmless; no recursive deletion or external paths.
  return {restored:states.length};
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
module.exports={hash,defaultBase,atomicWrite,writeJSON,readJSON,locateWorkbench,profilePaths,prepare,recordSettingsChanged,loaderBackups,recordApplied,restoreSettings,restoreProfile,restoreAll,withLock,isInside};
