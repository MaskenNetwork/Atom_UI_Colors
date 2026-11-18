'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {pathToFileURL,fileURLToPath}=require('node:url');
const settings=require('../src/settings.cjs');
const storage=require('../src/storage.cjs');
const {renderCSS,stripStyles}=require('../src/css.cjs');
const {createController}=require('../src/extension.cjs');
const {main:uninstall}=require('../src/uninstall.cjs');
const palette=require('../assets/palette.json');
const jsonc=require('../vendor/jsonc-parser/lib/umd/main.js');
const manifest=require('../package.json');

function harness(t,{initial='// personal settings\n{\n  "workbench.iconTheme": "material-icon-theme", // keep this\n}\n',folder='electron-browser/workbench',workspaceOverride,fail,silent=false}={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'atom-ui-colors-test-'));
  t.after(()=>{assert(path.basename(root).startsWith('atom-ui-colors-test-'));fs.rmSync(root,{recursive:true,force:true});});
  const settingsPath=path.join(root,'User','settings.json');
  const htmlPath=path.join(root,'app','out','vs','code',folder,'workbench.html');
  fs.mkdirSync(path.dirname(settingsPath),{recursive:true});fs.mkdirSync(path.dirname(htmlPath),{recursive:true});
  if(initial!==null)fs.writeFileSync(settingsPath,initial);
  const original='<html><head><meta http-equiv="Content-Security-Policy" content="original"><style>.original{color:blue}</style></head><body>original</body></html>';
  fs.writeFileSync(htmlPath,original);
  let applications=0,dependencyActivations=0;
  const vscode={env:{appRoot:path.join(root,'app'),uiKind:1},UIKind:{Web:2},ConfigurationTarget:{Global:1},extensions:{getExtension:()=>({activate:async()=>{dependencyActivations++;}})},workspace:{getConfiguration:namespace=>({
    get:(key,fallback)=>{const value=settings.parse(fs.existsSync(settingsPath)?fs.readFileSync(settingsPath,'utf8'):'{}');return value[namespace+'.'+key]??fallback;},
    inspect:key=>({globalValue:settings.parse(fs.existsSync(settingsPath)?fs.readFileSync(settingsPath,'utf8'):'{}')[namespace+'.'+key],workspaceValue:workspaceOverride}),
    update:async(key,value)=>{const text=fs.existsSync(settingsPath)?fs.readFileSync(settingsPath,'utf8'):'{}\n';const result=jsonc.applyEdits(text,jsonc.modify(text,[namespace+'.'+key],value,{formattingOptions:{insertSpaces:true,tabSize:2}}));fs.writeFileSync(settingsPath,result);}
  })},commands:{getCommands:async()=>['extension.installCustomCSS'],executeCommand:async command=>{
    assert.equal(command,'extension.installCustomCSS');applications++;
    fs.writeFileSync(path.join(path.dirname(htmlPath),`workbench.${crypto.randomUUID()}.bak-custom-css`),original);
    if(fail==='before')throw new Error('simulated write denied');
    if(silent)return;
    const imports=settings.parse(fs.readFileSync(settingsPath,'utf8'))[settings.KEY]||[];
    const css=imports.map(url=>fs.readFileSync(fileURLToPath(url),'utf8')).join('\n');
    const current=fs.readFileSync(htmlPath,'utf8').replace(/<style data-loader>[\s\S]*?<\/style>/g,'');
    fs.writeFileSync(htmlPath,current.replace('</head>',`<style data-loader>${css}</style></head>`));
    if(fail==='after')throw new Error('simulated failure after patch');
  }}};
  const context={extensionPath:path.join(root,'extensions',`${manifest.publisher}.${manifest.name}-${manifest.version}`),globalStorageUri:{fsPath:path.join(root,'User/globalStorage',`${manifest.publisher}.${manifest.name}`)}};
  const controller=createController(vscode,context,{base:path.join(root,'managed')});
  return {root,settingsPath,htmlPath,original,initial,vscode,context,controller,applications:()=>applications,activations:()=>dependencyActivations,settings:()=>settings.parse(fs.readFileSync(settingsPath,'utf8'))};
}

test('native CSS changes colors only and rejects CSS injection',()=>{
  const css=renderCSS(palette);
  assert(Object.keys(palette).length>700);
  assert.equal(palette['explorer-view-icon'],'#4db6ac');assert.equal(palette['search-view-icon'],'#80cbc4');
  assert(!/[{;]\s*(content|font-family|font-size|width|height|background-image|opacity)\s*:/.test(css));
  assert(!css.includes('url('));assert(css.includes(':not(.disabled *)'));assert(css.includes(':not(.hc-black)'));
  assert(!css.includes('activity-workbench-view-extension-angular-'));
  assert(!css.includes('activity-workbench-view-extension-codexViewContainer-'));
  assert.throws(()=>renderCSS(palette,{colors:{'x;}body{':'#ff0000'}}));
  assert.throws(()=>renderCSS(palette,{colors:{search:'red;content:"x"'}}));
});
test('JSONC preserves comments, trailing commas, CRLF and unrelated values',()=>{
  const text='// hello\r\n{\r\n  "url": "https://host/a//b", /* personal */\r\n  "array": [1,],\r\n}\r\n';
  const updated=settings.setImports(text,['file:///my%20folder/icons.css']);
  assert(updated.includes('// hello'));assert(updated.includes('/* personal */'));assert(updated.includes('\r\n'));
  assert.deepEqual(settings.parse(updated).array,[1]);assert.equal(settings.parse(updated).url,'https://host/a//b');
  assert(!Object.hasOwn(settings.parse(settings.removeOwned(updated,'file:///my%20folder/icons.css',false)),settings.KEY));
  assert.throws(()=>settings.parse('{ broken'));assert.throws(()=>settings.parse('{"vscode_custom_css.imports": "oops"}'));
});
test('apply activates the dependency, merges imports, preserves the file theme and is idempotent',async t=>{
  const h=harness(t);const first=await h.controller.apply();
  assert(first.changed);assert(h.activations()>0);assert.equal(h.settings()['workbench.iconTheme'],'material-icon-theme');
  assert(h.settings()[settings.KEY].includes(h.controller.paths.cssUrl));assert(!h.controller.paths.cssUrl.includes('\\'));
  assert(fs.readFileSync(h.htmlPath,'utf8').includes('ATOM-UI-COLORS:BEGIN'));
  assert.equal((await h.controller.apply()).changed,false);assert.equal(h.applications(),1);
});

test('Atom UI Colors settings drive Codicon and view overrides and survive restore',async t=>{
  const initial=JSON.stringify({'workbench.iconTheme':'material-icon-theme','atomUIColors.colors':{'search-view-icon':'#123456'},'atomUIColors.viewColors':{angular:'#654321'}},null,2)+'\n';
  const h=harness(t,{initial});
  await h.controller.apply();
  const css=fs.readFileSync(h.controller.paths.cssPath,'utf8');
  assert(css.includes('codicon-search-view-icon'));
  assert(css.includes('color: #123456 !important'));
  assert(css.includes('background-color: #654321 !important'));
  await h.controller.restore();
  assert.equal(fs.readFileSync(h.settingsPath,'utf8'),initial);
});

test('the published command IDs activate Atom UI Colors and restore its changes',async t=>{
  const h=harness(t,{initial:'{"atomUIColors.enabled":false,"atomUIColors.colors":{"search-view-icon":"#123456"}}\n'});
  const commands=new Map();
  const output={appendLine:()=>{},show:()=>{},dispose:()=>{}};
  const errors=[];
  h.vscode.window={createOutputChannel:name=>{assert.equal(name,'Atom UI Colors');return output;},showErrorMessage:async message=>{errors.push(message);},showInformationMessage:async()=>undefined};
  h.vscode.workspace.onDidChangeConfiguration=()=>({dispose:()=>{}});
  h.vscode.commands.registerCommand=(id,handler)=>{commands.set(id,handler);return {dispose:()=>commands.delete(id)};};
  h.context.subscriptions=[];
  h.context.extension={packageJSON:manifest};
  const filename=require.resolve('../src/extension.cjs');
  const originalRequire=require('node:module').createRequire(filename);
  const isolated={exports:{}};
  const load=name=>name==='vscode'?h.vscode:name==='./storage.cjs'?{...storage,defaultBase:()=>path.join(h.root,'managed')}:originalRequire(name);
  require('node:vm').runInThisContext('(function(require,module,exports,__dirname,__filename){'+fs.readFileSync(filename,'utf8')+'\n})',{filename})(load,isolated,isolated.exports,path.dirname(filename),filename);
  const controller=await isolated.exports.activate(h.context);
  assert.equal(`${manifest.publisher}.${manifest.name}`,'maskennetwork.atom-ui-colors');
  assert.deepEqual([...commands.keys()].sort(),manifest.contributes.commands.map(command=>command.command).sort());
  assert.equal(h.applications(),0);
  await commands.get('atomUIColors.apply')();
  assert.equal(h.applications(),1);
  assert.equal(h.settings()['atomUIColors.enabled'],true);
  assert(fs.readFileSync(controller.paths.cssPath,'utf8').includes('color: #123456 !important'));
  assert.equal(path.basename(storage.defaultBase()),'.atom-ui-colors');
  await commands.get('atomUIColors.restore')();
  assert(!fs.readFileSync(h.htmlPath,'utf8').includes('ATOM-UI-COLORS:BEGIN'));
  assert.deepEqual(errors,[]);
});
test('restore and complete uninstall reproduce the original settings and HTML exactly',async t=>{
  const h=harness(t);await h.controller.apply();
  await uninstall(path.join(h.root,'managed'),path.dirname(h.context.extensionPath));
  assert.equal(fs.readFileSync(h.settingsPath,'utf8'),h.initial);assert.equal(fs.readFileSync(h.htmlPath,'utf8'),h.original);
  assert(!fs.existsSync(h.controller.paths.cssPath));assert.equal(storage.loaderBackups(h.htmlPath).length,0);
});

test('installed extension events update SVG colors, coalesce bursts and respect Restore/disabled state',async t=>{
  const h=harness(t), commands=new Map(), errors=[];
  let extensionEvent, themeEvent;
  const disposable=()=>({dispose:()=>{}});
  h.vscode.extensions.all=[];
  h.vscode.extensions.onDidChange=callback=>{extensionEvent=callback;return disposable();};
  h.vscode.window={activeColorTheme:{kind:2},createOutputChannel:()=>({appendLine:()=>{},show:()=>{},dispose:()=>{}}),
    onDidChangeActiveColorTheme:callback=>{themeEvent=callback;return disposable();},
    showErrorMessage:async message=>{errors.push(message);},showInformationMessage:async()=>undefined};
  h.vscode.workspace.onDidChangeConfiguration=disposable;
  const originalExecute=h.vscode.commands.executeCommand;
  h.vscode.commands.registerCommand=(id,handler)=>{commands.set(id,handler);return disposable();};
  h.vscode.commands.executeCommand=async id=>commands.has(id)?commands.get(id)():originalExecute(id);
  h.context.subscriptions=[];h.context.extension={packageJSON:manifest};
  t.after(()=>h.context.subscriptions.forEach(subscription=>subscription.dispose()));
  const filename=require.resolve('../src/extension.cjs'), originalRequire=require('node:module').createRequire(filename), isolated={exports:{}};
  const load=name=>name==='vscode'?h.vscode:name==='./storage.cjs'?{...storage,defaultBase:()=>path.join(h.root,'managed')}:originalRequire(name);
  require('node:vm').runInThisContext('(function(require,module,exports,__dirname,__filename){'+fs.readFileSync(filename,'utf8')+'\n})',{filename})(load,isolated,isolated.exports,path.dirname(filename),filename);
  const controller=await isolated.exports.activate(h.context);
  assert.equal(h.applications(),1);
  const svgPath=path.join(h.root,'icon.svg');
  fs.writeFileSync(svgPath,'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path fill="#D97757" d="M0 0h24v24H0z"/></svg>');
  h.vscode.extensions.all=[{id:'test.new-extension',extensionPath:h.root,packageJSON:{contributes:{viewsContainers:{activitybar:[{id:'new-extension-view',icon:'icon.svg'}]}}}}];
  const settle=async predicate=>{
    const deadline=Date.now()+5000;
    while(!predicate()) {if(Date.now()>deadline)throw new Error('Automatic refresh did not complete.');await new Promise(resolve=>setTimeout(resolve,25));}
  };
  extensionEvent();extensionEvent();extensionEvent();
  await settle(()=>h.applications()===2);
  assert(fs.readFileSync(controller.paths.cssPath,'utf8').includes('background-color: #d97757 !important'));
  await commands.get('atomUIColors.status')(); // Drain the operation's state writes.
  await new Promise(resolve=>setTimeout(resolve,300));assert.equal(h.applications(),2);
  fs.writeFileSync(svgPath,'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path fill="#abcdef" d="M0 0h24v24H0z"/></svg>');
  extensionEvent();await settle(()=>h.applications()===3);
  assert(fs.readFileSync(controller.paths.cssPath,'utf8').includes('background-color: #abcdef !important'));
  h.vscode.extensions.all=[];extensionEvent();await settle(()=>h.applications()===4);
  assert(!fs.readFileSync(controller.paths.cssPath,'utf8').includes('activity-workbench-view-extension-new-extension-view-'));
  themeEvent();await new Promise(resolve=>setTimeout(resolve,400));assert.equal(h.applications(),4);
  await commands.get('atomUIColors.restore')();
  extensionEvent();themeEvent();await new Promise(resolve=>setTimeout(resolve,400));
  assert.equal(h.applications(),4);assert(!fs.existsSync(controller.paths.cssPath));
  assert.deepEqual(errors,[]);
});
test('later user settings, comments and CSS imports survive uninstall',async t=>{
  const h=harness(t);await h.controller.apply();
  const extra=path.join(h.root,'my other theme.css');fs.writeFileSync(extra,'.extra{color:red}');
  const url=pathToFileURL(extra).href;
  let text=fs.readFileSync(h.settingsPath,'utf8');text=settings.setImports(text,[...h.settings()[settings.KEY],url]);text='// added later\n'+text;
  fs.writeFileSync(h.settingsPath,text);await h.controller.apply();
  await uninstall(path.join(h.root,'managed'),path.dirname(h.context.extensionPath));
  assert(fs.readFileSync(h.settingsPath,'utf8').includes('// added later'));assert.deepEqual(h.settings()[settings.KEY],[url]);
  assert(fs.readFileSync(h.htmlPath,'utf8').includes('.extra{color:red}'));assert(!fs.readFileSync(h.htmlPath,'utf8').includes('ATOM-UI-COLORS:BEGIN'));
});
test('a workbench modified by another tool is cleaned selectively',async t=>{
  const h=harness(t);await h.controller.apply();fs.appendFileSync(h.htmlPath,'<!-- changed by another extension -->');
  await h.controller.restore();const html=fs.readFileSync(h.htmlPath,'utf8');
  assert(html.includes('changed by another extension'));assert(!html.includes('ATOM-UI-COLORS:BEGIN'));
});
for(const fail of ['before','after'])test(`loader failure ${fail} writing rolls back settings, HTML, CSS and new loader backups`,async t=>{
  const h=harness(t,{fail});await assert.rejects(h.controller.apply(),/simulated/);
  assert.equal(fs.readFileSync(h.settingsPath,'utf8'),h.initial);assert.equal(fs.readFileSync(h.htmlPath,'utf8'),h.original);
  assert(!fs.existsSync(h.controller.paths.cssPath));assert.equal(storage.loaderBackups(h.htmlPath).length,0);
});
test('silent Loader failures are detected and rolled back',async t=>{
  const h=harness(t,{silent:true});await assert.rejects(h.controller.apply(),/could not write/);
  assert.equal(fs.readFileSync(h.settingsPath,'utf8'),h.initial);assert.equal(storage.loaderBackups(h.htmlPath).length,0);
});
test('workspace import overrides are rejected before changing files',async t=>{
  const h=harness(t,{workspaceOverride:[]});await assert.rejects(h.controller.apply(),/workspace override/);
  assert.equal(fs.readFileSync(h.settingsPath,'utf8'),h.initial);assert.equal(h.applications(),0);
});
test('restore then reapply captures the new user baseline',async t=>{
  const h=harness(t);await h.controller.apply();await h.controller.restore();
  const next='// new baseline\n{"workbench.iconTheme":"another-theme"}\n';fs.writeFileSync(h.settingsPath,next);
  fs.appendFileSync(h.htmlPath,'<!-- new baseline -->');const html=fs.readFileSync(h.htmlPath,'utf8');
  await h.controller.apply();await h.controller.restore();
  assert.equal(fs.readFileSync(h.settingsPath,'utf8'),next);assert.equal(fs.readFileSync(h.htmlPath,'utf8'),html);
});
test('fresh profiles without settings.json return to having no settings file',async t=>{
  const h=harness(t,{initial:null});await h.controller.apply();await h.controller.restore();assert(!fs.existsSync(h.settingsPath));
});
for(const folder of ['electron-browser/workbench','electron-sandbox/workbench','electron-browser','electron-sandbox'])test(`discovers supported app-relative layout ${folder}`,async t=>{
  const h=harness(t,{folder});assert.equal(storage.locateWorkbench(path.join(h.root,'app')),h.htmlPath);await h.controller.apply();await h.controller.restore();
});
test('missing dependency and unsupported editor layouts do not change user settings',async t=>{
  const h=harness(t);h.vscode.extensions.getExtension=()=>undefined;await assert.rejects(h.controller.apply(),/Loader is missing/);assert.equal(h.settings()[settings.KEY],undefined);
  assert.throws(()=>storage.locateWorkbench(path.join(h.root,'does-not-exist')),/Unsupported/);
});
test('style removal preserves unrelated styles in the same style element',()=>{
  const css=renderCSS({search:'#80cbc4'},{token:'owned'});
  const html=`<style>.before{color:red}\n${css}.after{color:blue}</style><style>unrelated</style>`;
  const clean=stripStyles(html,'owned');assert(clean.includes('.before'));assert(clean.includes('.after'));assert(clean.includes('unrelated'));assert(!clean.includes('NATIVE-ATOM'));
});
test('path URLs encode spaces, percent signs, Unicode and # safely',t=>{
  const h=harness(t);const paths=storage.profilePaths(path.join(h.root,'profile à # %','settings.json'),path.join(h.root,'managed à # %'));
  assert.equal(fileURLToPath(paths.cssUrl),paths.cssPath);assert(paths.cssUrl.includes('%23'));assert(paths.cssUrl.includes('%25'));
});
test('operation lock serializes concurrent controller changes',async t=>{
  const h=harness(t);const order=[];const base=path.join(h.root,'locks');
  await Promise.all([storage.withLock(base,async()=>{order.push(1);await new Promise(resolve=>setTimeout(resolve,20));order.push(2);}),storage.withLock(base,async()=>order.push(3))]);
  assert.deepEqual(order,[1,2,3]);
});
test('restoring an inactive profile does not remove another profile current colors',async t=>{
  const h=harness(t);await h.controller.apply();
  const otherSettings=path.join(h.root,'User','profiles','second','settings.json');fs.mkdirSync(path.dirname(otherSettings),{recursive:true});fs.writeFileSync(otherSettings,'{"workbench.iconTheme":"keep-second"}');
  const state=storage.prepare(otherSettings,h.htmlPath,path.join(h.root,'managed'),path.dirname(h.context.extensionPath));
  storage.atomicWrite(state.cssPath,renderCSS(palette,{token:state.token}));
  fs.writeFileSync(otherSettings,settings.setImports(fs.readFileSync(otherSettings,'utf8'),[state.cssUrl]));storage.recordSettingsChanged(state);
  fs.writeFileSync(h.htmlPath,h.original.replace('</head>',`<style>${fs.readFileSync(state.cssPath,'utf8')}</style></head>`));storage.recordApplied(state,h.htmlPath);
  await h.controller.restore();assert(fs.readFileSync(h.htmlPath,'utf8').includes(state.token));
  await uninstall(path.join(h.root,'managed'),path.dirname(h.context.extensionPath));
  assert(!fs.readFileSync(h.htmlPath,'utf8').includes('ATOM-UI-COLORS:BEGIN'));assert.equal(settings.parse(fs.readFileSync(otherSettings,'utf8'))['workbench.iconTheme'],'keep-second');
});
test('uninstall handles a later editor installation layout without restoring old app files over it',async t=>{
  const h=harness(t);await h.controller.apply();
  const nextRoot=path.join(h.root,'updated-app');const nextHtml=path.join(nextRoot,'out/vs/code/electron-sandbox/workbench/workbench.html');fs.mkdirSync(path.dirname(nextHtml),{recursive:true});const nextOriginal='<html><head></head><body>NEW VERSION</body></html>';fs.writeFileSync(nextHtml,nextOriginal);
  const state=storage.prepare(h.settingsPath,nextHtml,path.join(h.root,'managed'),path.dirname(h.context.extensionPath));
  fs.writeFileSync(nextHtml,nextOriginal.replace('</head>',`<style>${fs.readFileSync(state.cssPath,'utf8')}</style></head>`));storage.recordApplied(state,nextHtml);
  await uninstall(path.join(h.root,'managed'),path.dirname(h.context.extensionPath));
  assert.equal(fs.readFileSync(nextHtml,'utf8'),nextOriginal);assert.equal(fs.readFileSync(h.htmlPath,'utf8'),h.original);
});
test('uninstall does not touch a separate VS Code extensions installation',async t=>{
  const h=harness(t);await h.controller.apply();
  await uninstall(path.join(h.root,'managed'),path.join(h.root,'some-other-extensions-directory'));
  assert(h.controller.getState().active);assert(fs.readFileSync(h.htmlPath,'utf8').includes('ATOM-UI-COLORS:BEGIN'));
});
