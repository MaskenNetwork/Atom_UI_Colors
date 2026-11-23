'use strict';
const fs=require('node:fs');
const path=require('node:path');

// These files are private VS Code metadata, not an uninstall API. Require both
// a valid profile inventory without our ID and an explicit removal marker for
// this installed folder. An update keeping the ID never requests cleanup.
function metadataPaths(extensionPath,settingsPath) {
  const owner=path.dirname(extensionPath), directory=path.dirname(settingsPath);
  const profile=path.basename(path.dirname(directory))==='profiles'
    ? path.join(directory,'extensions.json')
    : path.basename(directory)==='User' ? path.join(owner,'extensions.json') : null;
  return {profile,obsolete:path.join(owner,'.obsolete'),folder:path.basename(extensionPath),owner};
}
function readJSON(file) {
  try {
    if(!file || fs.statSync(file).size>8*1024*1024) return null;
    const text=fs.readFileSync(file,'utf8');
    return {value:JSON.parse(text),text};
  } catch {return null;}
}
function inventory(file,id) {
  const entry=readJSON(file);
  if(!entry || !Array.isArray(entry.value) || entry.value.some(item=>typeof item?.identifier?.id!=='string' || !item.identifier.id.includes('.'))) return null;
  return {...entry,present:entry.value.some(item=>item.identifier.id.toLowerCase()===id.toLowerCase())};
}
function removalEvidence(paths,id) {
  const profile=inventory(paths.profile,id), obsolete=readJSON(paths.obsolete);
  if(!profile || profile.present || !obsolete?.value || Array.isArray(obsolete.value) || typeof obsolete.value!=='object') return null;
  if(!Object.entries(obsolete.value).some(([folder,marked])=>folder===paths.folder && marked===true)) return null;
  // An active older version may already be obsolete after an update. Do not
  // confuse removal from one profile with full uninstall while another version
  // (possibly belonging to another profile) is still installed in this owner.
  try {
    const remaining=fs.readdirSync(paths.owner,{withFileTypes:true}).some(entry=>entry.isDirectory() && entry.name.toLowerCase().startsWith(id.toLowerCase()+'-') && obsolete.value[entry.name]!==true);
    if(remaining)return null;
  } catch {return null;}
  return JSON.stringify([profile.text,obsolete.text]);
}
function observeRemoval({extensionPath,settingsPath,id,onRemoval,output,interval=1000,settle=1000}) {
  const paths=metadataPaths(extensionPath,settingsPath);
  let disposed=false,running=false,seenInstalled=false,timer,pollTimer,fingerprint;
  const confirmed=()=>seenInstalled && removalEvidence(paths,id)!==null;
  function check() {
    if(disposed || running)return;
    const current=inventory(paths.profile,id);
    if(current?.present)seenInstalled=true;
    const next=seenInstalled?removalEvidence(paths,id):null;
    if(!next) {clearTimeout(timer);timer=undefined;fingerprint=undefined;return;}
    if(timer && fingerprint===next)return;
    clearTimeout(timer);fingerprint=next;
    timer=setTimeout(()=>{
      timer=undefined;
      if(disposed || removalEvidence(paths,id)!==fingerprint)return;
      // The caller rechecks evidence after joining its serialized operation
      // queue. Never persist a background process beyond this extension host.
      running=true;
      Promise.resolve().then(()=>onRemoval(confirmed)).then(result=>{
        if(result?.cancelled && !disposed) {running=false;fingerprint=undefined;check();}
        else dispose();
      }).catch(error=>{dispose();output?.appendLine('Early uninstall cleanup: '+error.message);});
    },settle);
    timer.unref?.();
  }
  function dispose() {disposed=true;clearTimeout(timer);clearInterval(pollTimer);}
  if(!paths.profile) {
    output?.appendLine('Early uninstall cleanup unavailable for this profile layout; the complete-uninstall hook remains available.');
    return {dispose,confirmed:()=>false};
  }
  // Native stat watchers establish their initial snapshot asynchronously. A
  // removal before that snapshot can be missed forever without another write.
  // Check the evidence itself periodically, within this extension host only.
  pollTimer=setInterval(check,interval);
  pollTimer.unref?.();
  check();
  return {dispose,confirmed};
}
module.exports={metadataPaths,inventory,removalEvidence,observeRemoval};
