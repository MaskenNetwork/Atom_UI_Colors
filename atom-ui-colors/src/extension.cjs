'use strict';
const fs = require('node:fs');
const path = require('node:path');
const storage = require('./storage.cjs');
const {renderCSS} = require('./css.cjs');
const {discoverIcons} = require('./icons.cjs');
const {resolveThemeColors} = require('./theme.cjs');
const PALETTE = require('../assets/palette.json');
const application = require('./application.cjs');
const {observeRemoval}=require('./removal.cjs');
const {cleanup:cleanupUninstall}=require('./uninstall.cjs');
const manifest=require('../package.json');

function createController(vscode, context, options = {}) {
  const base=options.base || storage.defaultBase();
  const settingsPath=options.settingsPath || path.join(path.dirname(path.dirname(context.globalStorageUri.fsPath)),'settings.json');
  const paths=storage.profilePaths(settingsPath,base);
  const getState=()=>storage.readJSON(paths.statePath);
  const output=options.output || {appendLine:()=>{}};
  async function apply() {
    return storage.withLock(base,async()=>{
      application.recover(base,path.dirname(context.extensionPath));
      if(vscode.env.uiKind===vscode.UIKind.Web) throw new Error('Atom UI Colors requires desktop VS Code.');
      const appRoot=options.appRoot || vscode.env.appRoot;
      const htmlPath=storage.locateWorkbench(appRoot);
      const appearance=vscode.workspace.getConfiguration('atomUIColors');
      const discovered=await discoverIcons(vscode,{appRoot,output});
      const activityBarTheme=appearance.get('activityBarContrast',true)?await resolveThemeColors(vscode,{output}):null;
      const css=renderCSS(PALETTE,{colors:appearance.get('colors',{}),viewColors:appearance.get('viewColors',{}),aliases:discovered.aliases,detectedViews:discovered.viewColors,resources:discovered.resources,activityBarTheme,token:paths.token});
      const result=application.apply({base,paths,settingsPath,htmlPath,appRoot,owner:path.dirname(context.extensionPath),css,hook:options.hook});
      output.appendLine(result.changed?'CSS written with the verified original CSP unchanged. Reload Window to load the new HTML and policy.':'Already applied; no files changed.');
      if(result.preservedLegacyStyles) output.appendLine('Foreign legacy CSS was preserved. Restore removes only Atom UI Colors; these other styles may keep their own colors. Loader imports remain except our URL; do not run its patch commands, which remove CSP again.');
      return result;
    });
  }
  async function restore(paused=true) {
    return storage.withLock(base,()=>{
      application.recover(base,path.dirname(context.extensionPath));
      const state=getState();
      if(!state) return {changed:false};
      if(state.schema!==2) throw new Error('Legacy recovery snapshots are not verified CSP baselines. Apply the verified migration before Restore.');
      const result=application.restore(state,{paused});
      output.appendLine('Owned CSS removed on disk; original CSP preserved. Reload Window to restore the loaded appearance.');
      return result;
    });
  }
  async function cleanupAfterRemoval(confirmed) {
    return storage.withLock(base,()=>{
      if(!confirmed()) return {changed:false,cancelled:true};
      const result=cleanupUninstall(base,path.dirname(context.extensionPath),'Profile removal');
      output.appendLine(`Uninstall observed: restored ${result.restored} profile(s) on disk before restart. Reload Window to remove the loaded colors.`);
      return {changed:result.restored>0};
    });
  }
  return {apply,restore,cleanupAfterRemoval,getState,paths,settingsPath};
}

async function activate(context, injectedVscode) {
  const vscode=injectedVscode || require('vscode');
  const output=vscode.window.createOutputChannel('Atom UI Colors');
  context.subscriptions.push(output);
  const controller=createController(vscode,context,{output});
  let queue=Promise.resolve();
  let disposed=false, removed=false, refreshTimer;
  context.subscriptions.push({dispose(){disposed=true;clearTimeout(refreshTimer);}});
  function run(operation, notify=false) {
    const result=queue.then(()=>disposed?{changed:false}:operation());
    queue=result.catch(async error=>{
      output.appendLine(error.stack || String(error));
      await vscode.window.showErrorMessage('Atom UI Colors: '+error.message,'Show Log').then(choice=>{if(choice==='Show Log') output.show();});
    });
    if(notify) result.then(async result=>{
      if(result?.changed) {
        const choice=await vscode.window.showInformationMessage('Atom UI Colors: reload the window to see the changes.','Reload Window');
        if(choice==='Reload Window') await vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    }).catch(()=>{});
    return queue;
  }
  function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer=setTimeout(()=>{
      refreshTimer=undefined;
      void run(()=>{
        const config=vscode.workspace.getConfiguration('atomUIColors');
        if(removed || !config.get('enabled',true) || controller.getState()?.paused) return {changed:false};
        return controller.apply();
      },true);
    },250);
  }
  if(vscode.extensions.onDidChange) context.subscriptions.push(vscode.extensions.onDidChange(refresh));
  if(vscode.window.onDidChangeActiveColorTheme) context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(refresh));
  context.subscriptions.push(observeRemoval({extensionPath:context.extensionPath,settingsPath:controller.settingsPath,
    id:`${manifest.publisher}.${manifest.name}`,output,onRemoval:confirmed=>{
      removed=true;clearTimeout(refreshTimer);
      return run(async()=>{
        const result=await controller.cleanupAfterRemoval(confirmed);
        if(result.cancelled) {removed=false;return result;}
        if(result.changed) {
          const choice=await vscode.window.showInformationMessage('Atom UI Colors was uninstalled. Reload the window to restore the original appearance.','Reload Window');
          if(choice==='Reload Window')await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
        return result;
      });
    }}));
  context.subscriptions.push(
    vscode.commands.registerCommand('atomUIColors.apply',()=>run(async()=>{
      if(removed) throw new Error('Atom UI Colors has been uninstalled. Reload Window before applying a reinstalled copy.');
      const config=vscode.workspace.getConfiguration('atomUIColors');
      if(!config.get('enabled',true)) await config.update('enabled',true,vscode.ConfigurationTarget.Global);
      return controller.apply();
    },true)),
    vscode.commands.registerCommand('atomUIColors.restore',()=>run(()=>controller.restore(),true)),
    vscode.commands.registerCommand('atomUIColors.openFolder',async()=>{
      fs.mkdirSync(controller.paths.directory,{recursive:true});
      await vscode.commands.executeCommand('revealFileInOS',vscode.Uri.file(controller.paths.directory));
    }),
    vscode.commands.registerCommand('atomUIColors.status',()=>{output.appendLine(JSON.stringify({version:context.extension.packageJSON.version,diskPolicyOnly:true,reloadRequired:'Reload is needed after writes; disk state does not prove the loaded page policy.',state:controller.getState()},null,2));output.show();}),
    vscode.workspace.onDidChangeConfiguration(event=>{
      if(event.affectsConfiguration('atomUIColors')) void run(()=>{if(removed)return {changed:false};const config=vscode.workspace.getConfiguration('atomUIColors');return config.get('enabled',true)?(controller.getState()?.paused?{changed:false}:controller.apply()):controller.restore(false);},true);
      else if(event.affectsConfiguration('workbench.colorTheme') || event.affectsConfiguration('workbench.colorCustomizations')) refresh();
    }),
  );
  if(vscode.workspace.getConfiguration('atomUIColors').get('enabled',true)) {
    if(!controller.getState()?.paused) await run(()=>controller.apply(),true);
  } else if(controller.getState()?.active) await run(()=>controller.restore(false));
  return controller;
}
// Never restore on normal shutdown: complete removal is handled by vscode:uninstall.
function deactivate() {}
module.exports={activate,deactivate,createController};
