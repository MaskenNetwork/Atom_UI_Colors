'use strict';
// VS Code runs this Node hook only on complete uninstall, not on every shutdown.
const storage = require('./storage.cjs');
const path=require('node:path');
async function main(base=storage.defaultBase(),owner=path.dirname(path.dirname(__dirname))) {
  return storage.withLock(base,()=>storage.restoreAll(base,owner));
}
if(require.main===module) main().then(result=>console.log(`Atom UI Colors: restored ${result.restored} profile(s).`)).catch(error=>{
  console.error(error.message);
  for(const cause of error.errors||[]) console.error(cause.message);
  process.exitCode=1;
});
module.exports={main};
