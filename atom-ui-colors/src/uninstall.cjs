'use strict';
// VS Code runs this Node hook only on complete uninstall, not on every shutdown.
const storage = require('./storage.cjs');
const path=require('node:path');
const fs=require('node:fs');
function cleanup(base,owner,source='Hook') {
    const log=message=>fs.appendFileSync(path.join(base,'uninstall.log'),new Date().toISOString()+' '+message+'\n',{mode:0o600});
    log(source+' started; restoring files on disk. A loaded renderer may need another reload.');
    try {
      const result=storage.restoreAll(base,owner);
      log(`Restored ${result.restored} profile(s) on disk. Reload the window to load the restored HTML.`);
      return result;
    } catch(error) {log('FAILED: '+error.message);throw error;}
}
async function main(base=storage.defaultBase(),owner=path.dirname(path.dirname(__dirname))) {
  return storage.withLock(base,()=>cleanup(base,owner));
}
if(require.main===module) main().then(result=>console.log(`Atom UI Colors: restored ${result.restored} profile(s).`)).catch(error=>{
  console.error(error.message);
  for(const cause of error.errors||[]) console.error(cause.message);
  process.exitCode=1;
});
module.exports={main,cleanup};
