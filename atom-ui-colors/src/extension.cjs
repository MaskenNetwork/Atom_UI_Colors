'use strict';
const fs = require('node:fs');
const path = require('node:path');
const storage = require('./storage.cjs');
const settings = require('./settings.cjs');
const {renderCSS} = require('./css.cjs');
const {discoverIcons} = require('./icons.cjs');
const PALETTE = require('../assets/palette.json');
const LOADER = 'be5invis.vscode-custom-css';

function createController(vscode, context, options = {}) {
  const base=options.base || storage.defaultBase();
  const settingsPath=options.settingsPath || path.join(path.dirname(path.dirname(context.globalStorageUri.fsPath)),'settings.json');
  const paths=storage.profilePaths(settingsPath,base);
  const getState=()=>storage.readJSON(paths.statePath);
  const output=options.output || {appendLine:()=>{}};
  async function apply({force=false}={}) {
    return storage.withLock(base,async()=>{
      if(vscode.env.uiKind===vscode.UIKind.Web) throw new Error('Atom UI Colors requires desktop VS Code.');
      const htmlPath=storage.locateWorkbench(options.appRoot || vscode.env.appRoot);
      const config=vscode.workspace.getConfiguration('vscode_custom_css');
      const inspected=config.inspect('imports');
      // Changing global settings cannot override a workspace-specific array.
      if(inspected?.workspaceValue!==undefined || inspected?.workspaceFolderValue!==undefined) throw new Error('Remove the workspace override of vscode_custom_css.imports before applying UI colors. Existing workspace settings were not changed.');
      const appearance=vscode.workspace.getConfiguration('atomUIColors');
      const discovered=await discoverIcons(vscode,{appRoot:options.appRoot || vscode.env.appRoot,output});
      const css=renderCSS(PALETTE,{colors:appearance.get('colors',{}),viewColors:appearance.get('viewColors',{}),aliases:discovered.aliases,detectedViews:discovered.viewColors,resources:discovered.resources,token:paths.token});
      const imports=inspected?.globalValue || [];
      if(!Array.isArray(imports) || imports.some(item=>typeof item!=='string')) throw new Error('Custom CSS imports must be an array of URLs.');
      const previous=getState();
      const html=fs.readFileSync(htmlPath,'utf8');
      if(!force && previous?.active && JSON.stringify(previous.appliedImports)===JSON.stringify(imports) && imports.includes(paths.cssUrl) && html.includes(css) && fs.existsSync(paths.cssPath) && fs.readFileSync(paths.cssPath,'utf8')===css) {
        output.appendLine('Already applied; no files changed.');
        return {changed:false,cssPath:paths.cssPath};
      }
      const loader=vscode.extensions.getExtension(LOADER);
      if(!loader) throw new Error('Custom CSS and JS Loader is missing. Install/enable be5invis.vscode-custom-css, then retry.');
      await loader.activate();
      const commands=await vscode.commands.getCommands(true);
      if(!commands.includes('extension.installCustomCSS')) throw new Error('Custom CSS Loader did not register its apply command. Enable the loader and retry.');
      const state=storage.prepare(settingsPath,htmlPath,base,path.dirname(context.extensionPath));
      const backupsBefore=storage.loaderBackups(htmlPath);
      try {
        storage.atomicWrite(paths.cssPath,css);
        if(!imports.includes(paths.cssUrl)) await config.update('imports',[...imports,paths.cssUrl],vscode.ConfigurationTarget.Global);
        storage.recordSettingsChanged(state);
        // Enable re-generates all configured imports without deleting the
        // loader's previous backups, unlike its Reload command.
        await vscode.commands.executeCommand('extension.installCustomCSS');
        if(!fs.readFileSync(htmlPath,'utf8').includes(css)) throw new Error('The loader could not write the workbench. Check the installation permissions; no automatic elevation is attempted.');
        state.paused=false;
        state.appliedImports=config.inspect('imports')?.globalValue || [];
        storage.recordApplied(state,htmlPath,backupsBefore);
        output.appendLine('Applied native icon colors: '+paths.cssPath);
        return {changed:true,cssPath:paths.cssPath};
      } catch(error) {
        // HTML may have been written even when a loader command reported an error.
        // Capture its exact result so rollback can restore the original snapshot.
        if(fs.existsSync(htmlPath)) storage.recordApplied(state,htmlPath,backupsBefore);
        try { storage.restoreProfile(state); } catch(rollback) { output.appendLine('Rollback: '+rollback.message); }
        throw error;
      }
    });
  }
  async function restore(paused=true) {
    return storage.withLock(base,()=>{
      const state=getState();
      if(!state) return {changed:false};
      storage.restoreProfile(state);
      state.paused=paused;
      storage.writeJSON(state.statePath,state);
      output.appendLine('Restored previous appearance; unrelated imports and file icons were preserved.');
      return {changed:true};
    });
  }
  return {apply,restore,getState,paths};
}

async function activate(context, injectedVscode) {
  const vscode=injectedVscode || require('vscode');
  const output=vscode.window.createOutputChannel('Atom UI Colors');
  context.subscriptions.push(output);
  const controller=createController(vscode,context,{output});
  let queue=Promise.resolve();
  let disposed=false, refreshTimer;
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
        if(!config.get('enabled',true) || controller.getState()?.paused) return {changed:false};
        return controller.apply();
      },true);
    },250);
  }
  if(vscode.extensions.onDidChange) context.subscriptions.push(vscode.extensions.onDidChange(refresh));
  if(vscode.window.onDidChangeActiveColorTheme) context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(refresh));
  context.subscriptions.push(
    vscode.commands.registerCommand('atomUIColors.apply',()=>run(async()=>{
      const config=vscode.workspace.getConfiguration('atomUIColors');
      if(!config.get('enabled',true)) await config.update('enabled',true,vscode.ConfigurationTarget.Global);
      return controller.apply({force:true});
    })),
    vscode.commands.registerCommand('atomUIColors.restore',()=>run(()=>controller.restore(),true)),
    vscode.commands.registerCommand('atomUIColors.openFolder',async()=>{
      fs.mkdirSync(controller.paths.directory,{recursive:true});
      await vscode.commands.executeCommand('revealFileInOS',vscode.Uri.file(controller.paths.directory));
    }),
    vscode.commands.registerCommand('atomUIColors.status',()=>{output.appendLine(JSON.stringify({version:context.extension.packageJSON.version,state:controller.getState()},null,2));output.show();}),
    vscode.workspace.onDidChangeConfiguration(event=>{
      if(event.affectsConfiguration('atomUIColors')) void run(()=>vscode.workspace.getConfiguration('atomUIColors').get('enabled',true)?controller.apply():controller.restore(false),true);
    }),
  );
  if(vscode.workspace.getConfiguration('atomUIColors').get('enabled',true)) {
    if(!controller.getState()?.paused) await run(()=>controller.apply());
  } else if(controller.getState()?.active) await run(()=>controller.restore(false));
  return controller;
}
// Never restore on normal shutdown: complete removal is handled by vscode:uninstall.
function deactivate() {}
module.exports={activate,deactivate,createController};
