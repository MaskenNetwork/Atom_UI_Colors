'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const storage=require('./storage.cjs');
const settings=require('./settings.cjs');
const workbench=require('./workbench.cjs');
const baselines=require('../assets/workbench-baselines.json');
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):null;
const json=value=>JSON.stringify(value,null,2)+'\n';
function identity(appRoot) {
  const root=fs.realpathSync(appRoot), product=storage.readJSON(path.join(root,'product.json')), manifest=storage.readJSON(path.join(root,'package.json'));
  if(!product?.commit || !manifest?.version) throw new Error('Cannot identify the VS Code distribution.');
  return {root,version:manifest.version,commit:product.commit,platform:process.platform,arch:process.arch};
}
function baselineFor(id,htmlPath,known) {
  // identity() resolves the application root; resolve the file as well so
  // directory links (including macOS /var -> /private/var) share that root.
  const relative=path.relative(id.root,fs.realpathSync(htmlPath)).replaceAll('\\','/');
  let item=baselines.builds.find(item=>item.version===id.version && item.commit===id.commit && item.platform===id.platform && item.arch===id.arch && item.relativePath===relative);
  if(item && workbench.digest(item.html)!==item.sha256) throw new Error('Bundled workbench baseline is damaged. Reinstall Atom UI Colors.');
  const product=storage.readJSON(path.join(id.root,'product.json'));
  const checksum=product.checksums?.[relative.replace(/^out\//,'')];
  if(!item) {
    // Verify other builds against their installed distribution checksum. After
    // patching, reuse only a saved original for this exact installation, and
    // recheck it against product.json on every apply/restore.
    const saved=known?.schema===2 && sameIdentity(known.identity,id) && path.resolve(known.htmlPath)===path.resolve(htmlPath);
    const html=saved?known.baseline:read(htmlPath);
    const sha256=typeof html==='string'?workbench.digest(html):null;
    if(!sha256 || !checksum || checksum!==Buffer.from(sha256,'hex').toString('base64').replace(/=+$/,'')) {
      throw new Error(`VS Code ${id.version} (${id.commit}, ${id.platform}-${id.arch}) has no verified CSP baseline: the original workbench could not be verified against its distribution checksum. Restore or reinstall VS Code to recover its original application files, then retry Apply / Repair Colors. No application files were changed.`);
    }
    item={...id,relativePath:relative,html,sha256};
  }
  if(checksum!==Buffer.from(item.sha256,'hex').toString('base64').replace(/=+$/,'')) throw new Error('Distribution checksum does not match the verified workbench baseline.');
  workbench.assertInline(item.html);
  return item;
}
function sameIdentity(a,b) {return JSON.stringify(a)===JSON.stringify(b);}
function write(file,value) {if(value===null) {if(fs.existsSync(file))fs.unlinkSync(file);} else storage.atomicWrite(file,value);}
// Persist every intended write before touching any target, including state. A
// crash can leave either side of each atomic replacement, never a guessed file.
function transact(base,changes,details={},hook=()=>{}) {
  for(const change of changes) if(Object.hasOwn(change,'expected') && read(change.file)!==change.expected) throw new Error('A file changed while preparing the operation. No files changed.');
  const directory=path.join(base,'transactions');
  if(fs.existsSync(directory)) for(const name of fs.readdirSync(directory).filter(name=>name.endsWith('.json'))) {
    const pending=storage.readJSON(path.join(directory,name));
    if(pending?.phase==='prepared' && pending.changes.some(old=>changes.some(next=>next.file===old.file))) throw new Error('An unfinished transaction touches these files. Recover its owning installation before continuing.');
  }
  const file=path.join(base,'transactions',crypto.randomUUID()+'.json');
  const journal={schema:2,phase:'prepared',details,changes:changes.filter(c=>read(c.file)!==c.after).map(c=>({...c,before:read(c.file)}))};
  storage.writeJSON(file,journal);
  try {
    for(let index=0;index<journal.changes.length;index++) {
      const change=journal.changes[index];
      if(read(change.file)!==change.before) throw new Error('A file changed during the transaction. Recovery retained.');
      hook(index,change); write(change.file,change.after);
      if(read(change.file)!==change.after) throw new Error('Write verification failed.');
    }
    journal.phase='committed'; storage.writeJSON(file,journal);
  } catch(error) {
    try {rollback(file,journal);} catch(recovery) {throw new AggregateError([error,recovery],'Operation failed; rollback incomplete. Recovery data retained: '+file);}
    if(details.operation==='migrate') throw new Error('CSP migration failed; the previous legacy state was restored and its missing CSP remains unresolved. '+error.message,{cause:error});
    throw error;
  }
  return file;
}
function rollback(file,journal) {
  // Check every target first; never overwrite a later external edit.
  for(const change of journal.changes) if(![change.before,change.after].includes(read(change.file))) throw new Error('External edit prevents automatic rollback: '+change.file);
  for(const change of [...journal.changes].reverse()) if(read(change.file)!==change.before) write(change.file,change.before);
  journal.phase='rolled-back'; storage.writeJSON(file,journal);
}
function recover(base,owner) {
  const directory=path.join(base,'transactions');
  if(!fs.existsSync(directory))return;
  for(const name of fs.readdirSync(directory).filter(name=>name.endsWith('.json'))) {
    const file=path.join(directory,name),journal=storage.readJSON(file);
    if(journal?.phase==='prepared' && (!owner || journal.details?.owner===path.resolve(owner)))rollback(file,journal);
  }
}
function apply({base,paths,settingsPath,htmlPath,appRoot,owner,css,hook}) {
  recover(base,owner);
  const id=identity(appRoot), before=read(htmlPath), old=storage.readJSON(paths.statePath);
  const appStatePath=path.join(base,'applications',storage.hash(JSON.stringify({...id,htmlPath})).slice(0,24)+'.json');
  const baseline=baselineFor(id,htmlPath,storage.readJSON(appStatePath));
  let clean=before, migrated=false;
  const raw=read(settingsPath), parsed=settings.parse(raw??'{}');
  const hasPolicy=workbench.tags(before).some(t=>t.name==='meta' && t.attrs['http-equiv']?.toLowerCase()==='content-security-policy');
  if(!hasPolicy) {
    // Once this backend has restored CSP, another removal is an explicit error,
    // not a repair loop between two competing patchers.
    if((old?.schema===2 && sameIdentity(old.identity,id)) || storage.readJSON(appStatePath)?.schema===2) throw new Error('Another tool removed the CSP. Stop that patcher before applying colors again.');
    if((parsed[settings.KEY]||[]).some(url=>url!==paths.cssUrl && !/\.css(?:[?#]|$)/i.test(url))) throw new Error('Legacy Loader has script or unsupported imports. Review them before CSP migration; no imports or HTML were changed.');
    clean=workbench.migrate(before,baseline.html,paths.token,baselines.loader751IndicatorSha256); migrated=true;
  } else if(/VSCODE-CUSTOM-CSS-START/.test(before)) throw new Error('Legacy Loader markers remain. Review the mixed patch before applying.');
  const after=workbench.apply(clean,css,paths.token,baseline.html);
  const nextSettings=settings.removeOwned(raw??'{}',paths.cssUrl,old?.importsOriginallyPresent??true);
  const state={schema:2,...paths,settingsPath:path.resolve(settingsPath),owner:path.resolve(owner),identity:id,active:true,paused:false,
    appStatePaths:[...new Set([...(old?.schema===2?old.appStatePaths:[]),appStatePath])],cssHash:storage.hash(css),reloadRequired:after!==before || old?.reloadRequired===true};
  const app={schema:2,htmlPath:path.resolve(htmlPath),identity:id,baselineSha256:baseline.sha256,baseline:baseline.html,afterHash:storage.hash(after)};
  if(after===before && read(paths.cssPath)===css && old?.schema===2 && old.active && old.owner===state.owner && old.paused===false && nextSettings===(raw??'{}')) return {changed:false,cssPath:paths.cssPath};
  const changes=[{file:paths.cssPath,after:css}];
  if(raw!==null && raw!==nextSettings)changes.push({file:settingsPath,after:nextSettings,expected:raw});
  changes.push({file:htmlPath,after,expected:before},{file:appStatePath,after:json(app)},{file:paths.statePath,after:json(state)});
  transact(base,changes,{operation:migrated?'migrate':'apply',owner:path.resolve(owner),identity:id,normalRestoreBaselineSha256:baseline.sha256,legacyState:old},hook);
  return {changed:after!==before,cssPath:paths.cssPath,migrated,preservedLegacyStyles:migrated?workbench.tags(clean).filter(t=>t.name==='style' && t.attrs.id!==`atom-ui-colors-${paths.token}`).length:0,reloadRequired:state.reloadRequired};
}
function restoredHTML(app,token) {
  if(!fs.existsSync(app.htmlPath))return null;
  const currentId=identity(app.identity.root);
  if(!sameIdentity(currentId,app.identity)) return null; // Never copy an older build over an update.
  const baseline=baselineFor(currentId,app.htmlPath,app), current=read(app.htmlPath);
  if(baseline.sha256!==app.baselineSha256) throw new Error('Recovery baseline identity mismatch.');
  workbench.assertBaseline(current,baseline.html);
  return workbench.remove(current,token);
}
function restore(state,{paused=true,hook}={}) {
  recover(state.base,state.owner);
  // Recovery can replace the state left by an interrupted operation.
  state=storage.readJSON(state.statePath)??state;
  const changes=[];
  for(const file of state.appStatePaths||[]) {
    const app=storage.readJSON(file);
    if(app?.schema!==2) throw new Error('Unverified legacy recovery data. Apply the verified migration before Restore.');
    if(!fs.existsSync(app.identity.root)) continue;
    const before=read(app.htmlPath);
    const after=restoredHTML(app,state.token);
    if(after!==null)changes.push({file:app.htmlPath,after,expected:before});
  }
  const raw=read(state.settingsPath);
  if(raw!==null)changes.push({file:state.settingsPath,after:settings.removeOwned(raw,state.cssUrl,true),expected:raw});
  const next={...state,active:false,paused,reloadRequired:true};
  changes.push({file:state.cssPath,after:null},{file:state.statePath,after:json(next)});
  const changed=changes.some(c=>c.file!==state.statePath && read(c.file)!==c.after);
  transact(state.base,changes,{operation:'restore',owner:state.owner,identity:state.identity},hook);
  Object.assign(state,next);
  return {changed,reloadRequired:true};
}
module.exports={identity,baselineFor,apply,restore,transact,recover,restoredHTML};
