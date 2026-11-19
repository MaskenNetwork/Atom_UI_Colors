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

const application=require('../src/application.cjs');
const workbench=require('../src/workbench.cjs');
const baselines=require('../assets/workbench-baselines.json');
// Exercise the same fixture on CI hosts, without claiming a verified desktop
// distribution for that host. Production accepts only the pinned identities.
const baseline=baselines.builds.find(b=>b.platform===process.platform && b.arch===process.arch)??{...baselines.builds[0],platform:process.platform,arch:process.arch};
if(!baselines.builds.some(b=>b.platform===baseline.platform && b.arch===baseline.arch)) baselines.builds.push(baseline);
function harness(t,{initial='// personal settings\n{\n  "workbench.iconTheme": "material-icon-theme", // keep this\n}\n',folder='electron-browser/workbench',hook}={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'atom-ui-colors-test-'));
  t.after(()=>{assert(path.basename(root).startsWith('atom-ui-colors-test-'));fs.rmSync(root,{recursive:true,force:true});});
  const settingsPath=path.join(root,'User','settings.json'), appRoot=path.join(root,'app');
  const htmlPath=path.join(appRoot,...baseline.relativePath.split('/'));
  fs.mkdirSync(path.dirname(settingsPath),{recursive:true});fs.mkdirSync(path.dirname(htmlPath),{recursive:true});
  if(initial!==null)fs.writeFileSync(settingsPath,initial);
  fs.writeFileSync(path.join(appRoot,'package.json'),JSON.stringify({version:baseline.version}));
  fs.writeFileSync(path.join(appRoot,'product.json'),JSON.stringify({commit:baseline.commit,checksums:{[baseline.relativePath.replace(/^out\//,'')]:Buffer.from(baseline.sha256,'hex').toString('base64').replace(/=+$/,'')}}));
  const original=baseline.html; fs.writeFileSync(htmlPath,original);
  let applications=0;
  const vscode={env:{appRoot,uiKind:1},UIKind:{Web:2},ConfigurationTarget:{Global:1},extensions:{all:[],getExtension:()=>{throw new Error('Loader must never be accessed');}},workspace:{getConfiguration:namespace=>({
    get:(key,fallback)=>settings.parse(fs.existsSync(settingsPath)?fs.readFileSync(settingsPath,'utf8'):'{}')[namespace+'.'+key]??fallback,
    update:async(key,value)=>{const text=fs.existsSync(settingsPath)?fs.readFileSync(settingsPath,'utf8'):'{}\n';fs.writeFileSync(settingsPath,jsonc.applyEdits(text,jsonc.modify(text,[namespace+'.'+key],value,{formattingOptions:{insertSpaces:true,tabSize:2}})));}
  })},commands:{executeCommand:async command=>{throw new Error('Unexpected command: '+command);}}};
  const context={extensionPath:path.join(root,'extensions',`${manifest.publisher}.${manifest.name}-${manifest.version}`),globalStorageUri:{fsPath:path.join(root,'User/globalStorage',`${manifest.publisher}.${manifest.name}`)}};
  const controller=createController(vscode,context,{base:path.join(root,'managed'),hook:(index,change)=>{if(change.file===htmlPath)applications++;hook?.(index,change);}});
  return {root,appRoot,settingsPath,htmlPath,original,initial,vscode,context,controller,applications:()=>applications,settings:()=>settings.parse(fs.readFileSync(settingsPath,'utf8'))};
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
test('apply preserves the original CSP, settings and file theme without Loader and is idempotent',async t=>{
  const h=harness(t);const first=await h.controller.apply();
  assert(first.changed);assert.equal(h.settings()['workbench.iconTheme'],'material-icon-theme');
  assert.equal(fs.readFileSync(h.settingsPath,'utf8'),h.initial);
  const html=fs.readFileSync(h.htmlPath,'utf8');
  assert(html.includes('ATOM-UI-COLORS:BEGIN'));assert(!html.includes('VSCODE-CUSTOM-CSS'));
  assert.deepEqual(workbench.policies(html).meta.map(t=>t.raw),workbench.policies(h.original).meta.map(t=>t.raw));
  const time=fs.statSync(h.htmlPath).mtimeMs;
  assert.equal((await h.controller.apply()).changed,false);assert.equal(h.applications(),1);
  assert.equal(fs.statSync(h.htmlPath).mtimeMs,time);
  assert(!manifest.extensionDependencies?.includes('be5invis.vscode-custom-css'));
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
  const load=name=>name==='vscode'?h.vscode:name==='./storage.cjs'?{...storage,defaultBase:()=>path.join(h.root,'managed')}:name==='./application.cjs'?{...application,apply:args=>{const result=application.apply(args);if(result.changed)h.count=(h.count||0)+1;return result;}}:originalRequire(name);
  require('node:vm').runInThisContext('(function(require,module,exports,__dirname,__filename){'+fs.readFileSync(filename,'utf8')+'\n})',{filename})(load,isolated,isolated.exports,path.dirname(filename),filename);
  const controller=await isolated.exports.activate(h.context);
  assert.equal(`${manifest.publisher}.${manifest.name}`,'maskennetwork.atom-ui-colors');
  assert.deepEqual([...commands.keys()].sort(),manifest.contributes.commands.map(command=>command.command).sort());
  assert.equal(h.applications(),0);
  await commands.get('atomUIColors.apply')();
  assert(fs.readFileSync(h.htmlPath,'utf8').includes('ATOM-UI-COLORS:BEGIN'));
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
  assert(!fs.existsSync(h.controller.paths.cssPath));assert(!fs.readdirSync(path.dirname(h.htmlPath)).some(name=>name.endsWith('.bak-custom-css')));
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
  const load=name=>name==='vscode'?h.vscode:name==='./storage.cjs'?{...storage,defaultBase:()=>path.join(h.root,'managed')}:name==='./application.cjs'?{...application,apply:args=>{const result=application.apply(args);if(result.changed)h.count=(h.count||0)+1;return result;}}:originalRequire(name);
  require('node:vm').runInThisContext('(function(require,module,exports,__dirname,__filename){'+fs.readFileSync(filename,'utf8')+'\n})',{filename})(load,isolated,isolated.exports,path.dirname(filename),filename);
  const controller=await isolated.exports.activate(h.context);
  assert.equal((h.count||0),1);
  const svgPath=path.join(h.root,'icon.svg');
  fs.writeFileSync(svgPath,'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path fill="#D97757" d="M0 0h24v24H0z"/></svg>');
  h.vscode.extensions.all=[{id:'test.new-extension',extensionPath:h.root,packageJSON:{contributes:{viewsContainers:{activitybar:[{id:'new-extension-view',icon:'icon.svg'}]}}}}];
  const settle=async predicate=>{
    const deadline=Date.now()+5000;
    while(!predicate()) {if(Date.now()>deadline)throw new Error('Automatic refresh did not complete.');await new Promise(resolve=>setTimeout(resolve,25));}
  };
  extensionEvent();extensionEvent();extensionEvent();
  await settle(()=>(h.count||0)===2);
  assert(fs.readFileSync(controller.paths.cssPath,'utf8').includes('background-color: #d97757 !important'));
  await commands.get('atomUIColors.status')(); // Drain the operation's state writes.
  await new Promise(resolve=>setTimeout(resolve,300));assert.equal((h.count||0),2);
  fs.writeFileSync(svgPath,'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path fill="#abcdef" d="M0 0h24v24H0z"/></svg>');
  extensionEvent();await settle(()=>(h.count||0)===3);
  assert(fs.readFileSync(controller.paths.cssPath,'utf8').includes('background-color: #abcdef !important'));
  h.vscode.extensions.all=[];extensionEvent();await settle(()=>(h.count||0)===4);
  assert(!fs.readFileSync(controller.paths.cssPath,'utf8').includes('activity-workbench-view-extension-new-extension-view-'));
  themeEvent();await new Promise(resolve=>setTimeout(resolve,400));assert.equal((h.count||0),4);
  await commands.get('atomUIColors.restore')();
  extensionEvent();themeEvent();await new Promise(resolve=>setTimeout(resolve,400));
  assert.equal((h.count||0),4);assert(!fs.existsSync(controller.paths.cssPath));
  assert.deepEqual(errors,[]);
});
test('later user settings, comments and CSS imports survive uninstall',async t=>{
  const h=harness(t);await h.controller.apply();
  const extra=path.join(h.root,'my other theme.css');fs.writeFileSync(extra,'.extra{color:red}');
  const url=pathToFileURL(extra).href;
  let text=fs.readFileSync(h.settingsPath,'utf8');text=settings.setImports(text,[url]);text='// added later\n'+text;
  fs.writeFileSync(h.settingsPath,text);await h.controller.apply();
  await uninstall(path.join(h.root,'managed'),path.dirname(h.context.extensionPath));
  assert(fs.readFileSync(h.settingsPath,'utf8').includes('// added later'));assert.deepEqual(h.settings()[settings.KEY],[url]);
  assert(!fs.readFileSync(h.htmlPath,'utf8').includes('.extra{color:red}')); // Foreign imports are preserved, never executed.
  assert(!fs.readFileSync(h.htmlPath,'utf8').includes('ATOM-UI-COLORS:BEGIN'));
});
test('a workbench modified by another tool is cleaned selectively',async t=>{
  const h=harness(t);await h.controller.apply();fs.appendFileSync(h.htmlPath,'<!-- changed by another extension -->');
  await h.controller.restore();const html=fs.readFileSync(h.htmlPath,'utf8');
  assert(html.includes('changed by another extension'));assert(!html.includes('ATOM-UI-COLORS:BEGIN'));
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
test('unsupported editor layouts do not change user settings',async t=>{
  const h=harness(t);assert.throws(()=>storage.locateWorkbench(path.join(h.root,'does-not-exist')),/Unsupported/);
  assert.equal(fs.readFileSync(h.settingsPath,'utf8'),h.initial);
});
test('style removal preserves unrelated styles in the same style element',()=>{
  const css=renderCSS({search:'#80cbc4'},{token:'owned'});
  const html=`<style>.before{color:red}\n${css}.after{color:blue}</style><style>unrelated</style>`;
  const clean=stripStyles(html,'owned');assert(clean.includes('.before'));assert(clean.includes('.after'));assert(clean.includes('unrelated'));assert(!clean.includes('NATIVE-ATOM'));
});
test('path URLs encode spaces, percent signs, Unicode and # safely',t=>{
  const h=harness(t);const paths=storage.profilePaths(path.join(h.root,'profile Ã  # %','settings.json'),path.join(h.root,'managed Ã  # %'));
  assert.equal(fileURLToPath(paths.cssUrl),paths.cssPath);assert(paths.cssUrl.includes('%23'));assert(paths.cssUrl.includes('%25'));
});
test('operation lock serializes concurrent controller changes',async t=>{
  const h=harness(t);const order=[];const base=path.join(h.root,'locks');
  await Promise.all([storage.withLock(base,async()=>{order.push(1);await new Promise(resolve=>setTimeout(resolve,20));order.push(2);}),storage.withLock(base,async()=>order.push(3))]);
  assert.deepEqual(order,[1,2,3]);
});
test('uninstall does not touch a separate VS Code extensions installation',async t=>{
  const h=harness(t);await h.controller.apply();
  await uninstall(path.join(h.root,'managed'),path.join(h.root,'some-other-extensions-directory'));
  assert(h.controller.getState().active);assert(fs.readFileSync(h.htmlPath,'utf8').includes('ATOM-UI-COLORS:BEGIN'));
});

function legacyHTML(h,payload) {
  const meta=workbench.policies(h.original).meta[0];
  return h.original.slice(0,meta.start)+h.original.slice(meta.end).replace('</head>',`<!-- !! VSCODE-CUSTOM-CSS-SESSION-ID 01234567-0123-0123-0123-0123456789ab !! -->\n<!-- !! VSCODE-CUSTOM-CSS-START !! -->\n${payload}<!-- !! VSCODE-CUSTOM-CSS-END !! -->\n</head>`);
}
test('migration separates emergency legacy rollback from normal CSP-preserving Restore',async t=>{
  const h=harness(t), css=renderCSS(palette,{token:h.controller.paths.token});
  const legacy=legacyHTML(h,`<style>${css}</style>`);fs.writeFileSync(h.htmlPath,legacy);
  fs.writeFileSync(h.settingsPath,settings.setImports(h.initial,[h.controller.paths.cssUrl]));
  const legacyState={schema:1,active:true,token:h.controller.paths.token,appStatePaths:[],before:'not a trustworthy backup'};
  storage.writeJSON(h.controller.paths.statePath,legacyState);
  const result=await h.controller.apply();assert(result.migrated);
  await h.controller.restore();assert.equal(fs.readFileSync(h.htmlPath,'utf8'),h.original);
  const journals=fs.readdirSync(path.join(h.root,'managed/transactions')).map(name=>storage.readJSON(path.join(h.root,'managed/transactions',name)));
  const migration=journals.find(j=>j.details.operation==='migrate');
  assert.equal(migration.changes.find(c=>c.file===h.htmlPath).before,legacy);
  assert.deepEqual(migration.details.legacyState,legacyState);
  assert(!fs.readFileSync(h.htmlPath,'utf8').includes('VSCODE-CUSTOM-CSS'));
});
test('migration preserves foreign CSS/imports; imported scripts and foreign payload scripts cause a conflict',async t=>{
  const h=harness(t), foreign='<style>/* foreign */ .extra {color:red}</style>', css=renderCSS(palette,{token:h.controller.paths.token});
  const legacy=legacyHTML(h,foreign+`<style>${css}</style>`);fs.writeFileSync(h.htmlPath,legacy);
  const raw='// keep this comment\n'+settings.setImports(h.initial,['file:///foreign.css',h.controller.paths.cssUrl]);fs.writeFileSync(h.settingsPath,raw);
  const result=await h.controller.apply();assert.equal(result.preservedLegacyStyles,1);
  assert(fs.readFileSync(h.htmlPath,'utf8').includes(foreign));assert.deepEqual(h.settings()[settings.KEY],['file:///foreign.css']);
  assert(fs.readFileSync(h.settingsPath,'utf8').includes('// keep this comment'));
  await h.controller.restore();assert(fs.readFileSync(h.htmlPath,'utf8').includes(foreign));assert(workbench.policies(fs.readFileSync(h.htmlPath,'utf8')).meta.length);
  const k=harness(t);fs.writeFileSync(k.htmlPath,legacyHTML(k,'<script>window.foreign=true</script>'));
  await assert.rejects(k.controller.apply(),/foreign scripts/);assert(!fs.existsSync(k.controller.paths.cssPath));
  const j=harness(t);fs.writeFileSync(j.htmlPath,legacyHTML(j,''));fs.writeFileSync(j.settingsPath,settings.setImports(j.initial,['file:///foreign.js']));
  await assert.rejects(j.controller.apply(),/script or unsupported imports/);
});
test('missing CSP and untrusted backups fail without writes; later CSP removal is never silently migrated again',async t=>{
  const h=harness(t);fs.writeFileSync(h.htmlPath,'<html><head></head><body>modified</body></html>');const before=fs.readFileSync(h.htmlPath,'utf8');
  await assert.rejects(h.controller.apply(),/Unrecognized legacy patch/);assert.equal(fs.readFileSync(h.htmlPath,'utf8'),before);assert(!fs.existsSync(h.controller.paths.statePath));
  fs.writeFileSync(h.htmlPath,h.original);await h.controller.apply();
  const patched=fs.readFileSync(h.htmlPath,'utf8'),meta=workbench.policies(patched).meta[0];fs.writeFileSync(h.htmlPath,patched.replace(meta.raw,''));
  await assert.rejects(h.controller.apply(),/Another tool removed/);await assert.rejects(h.controller.restore(),/CSP is missing/);assert(h.controller.getState().active);
});
test('a build/version mismatch cannot restore an old HTML over a VS Code update',async t=>{
  const h=harness(t);await h.controller.apply();
  fs.writeFileSync(path.join(h.appRoot,'package.json'),JSON.stringify({version:'9.0.0'}));const next='<html><head>New release</head></html>';fs.writeFileSync(h.htmlPath,next);
  await h.controller.restore();assert.equal(fs.readFileSync(h.htmlPath,'utf8'),next);
  await assert.rejects(h.controller.apply(),/no verified CSP baseline/);
});
test('separate profile owners share an app without removing each other styles',async t=>{
  const h=harness(t);await h.controller.apply();
  const other=path.join(h.root,'Other/settings.json');fs.mkdirSync(path.dirname(other),{recursive:true});fs.writeFileSync(other,'{}');
  const paths=storage.profilePaths(other,path.join(h.root,'managed'));
  application.apply({base:paths.base,paths,settingsPath:other,htmlPath:h.htmlPath,appRoot:h.appRoot,owner:path.join(h.root,'other-extensions'),css:renderCSS(palette,{token:paths.token})});
  await uninstall(paths.base,path.dirname(h.context.extensionPath));
  const html=fs.readFileSync(h.htmlPath,'utf8');assert(html.includes(paths.token));assert(!html.includes(h.controller.paths.token));assert(workbench.policies(html).meta.length);
  await uninstall(paths.base,path.join(h.root,'other-extensions'));assert.equal(fs.readFileSync(h.htmlPath,'utf8'),h.original);
});
for(let phase=0;phase<4;phase++)test(`apply failure in phase ${phase} preserves HTML/settings and rolls back generated state`,async t=>{
  const h=harness(t,{hook:index=>{if(index===phase)throw new Error('injected failure');}});
  await assert.rejects(h.controller.apply(),/injected/);assert.equal(fs.readFileSync(h.htmlPath,'utf8'),h.original);assert.equal(fs.readFileSync(h.settingsPath,'utf8'),h.initial);assert(!fs.existsSync(h.controller.paths.cssPath));assert(!h.controller.getState());
});
test('legacy restore/uninstall refuses unverified snapshots and keeps recovery data',async t=>{
  const h=harness(t);const old={schema:1,...h.controller.paths,settingsPath:h.settingsPath,active:true,owner:path.dirname(h.context.extensionPath)};
  storage.writeJSON(old.statePath,old);await assert.rejects(h.controller.restore(),/Legacy recovery/);await assert.rejects(uninstall(old.base,old.owner),/unverified legacy/);assert(fs.existsSync(old.statePath));assert.equal(fs.readFileSync(h.htmlPath,'utf8'),h.original);
});

test('migration and later regeneration preserve cascade order around foreign styles',async t=>{
  const h=harness(t),css=renderCSS(palette,{token:h.controller.paths.token});
  const first='<style>/* before-own */ .foreign {color:red}</style>',last='<style>/* after-own */ .foreign {color:blue}</style>';
  fs.writeFileSync(h.htmlPath,legacyHTML(h,first+`<style>${css}</style>`+last));
  await h.controller.apply();
  for(let iteration=0;iteration<2;iteration++) {
    const html=fs.readFileSync(h.htmlPath,'utf8');assert(html.indexOf(first)<html.indexOf('ATOM-UI-COLORS:BEGIN'));assert(html.indexOf('ATOM-UI-COLORS:END')<html.indexOf(last));
    fs.writeFileSync(h.settingsPath,JSON.stringify({'atomUIColors.colors':{search:'#123456'}}));await h.controller.apply();
  }
  await h.controller.restore();const html=fs.readFileSync(h.htmlPath,'utf8');assert(html.includes(first));assert(html.includes(last));assert(workbench.policies(html).meta.length);
});

test('early uninstall cleanup uses confirmed removal and preserves a reinstalled copy',async t=>{
  const h=harness(t);await h.controller.apply();
  const cancelled=await h.controller.cleanupAfterRemoval(()=>false);assert(cancelled.cancelled);assert(h.controller.getState().active);
  const result=await h.controller.cleanupAfterRemoval(()=>true);assert(result.changed);
  assert.equal(fs.readFileSync(h.htmlPath,'utf8'),h.original);assert.equal(h.controller.getState(),null);
  assert(fs.readFileSync(path.join(h.root,'managed/uninstall.log'),'utf8').includes('Profile removal started'));
  // Complete-uninstall hook remains harmless after early cleanup.
  assert.equal((await uninstall(path.join(h.root,'managed'),path.dirname(h.context.extensionPath))).restored,0);
});
test('uninstall observer serializes cleanup, stops reapplication and offers a user-controlled reload',async t=>{
  const h=harness(t),commands=new Map(),errors=[],messages=[];let removed,extensionEvent,configurationEvent;
  const disposable=()=>({dispose:()=>{}});
  const output={appendLine:()=>{},show:()=>{},dispose:()=>{}};
  h.vscode.window={createOutputChannel:()=>output,showErrorMessage:async message=>{errors.push(message);},showInformationMessage:async message=>{messages.push(message);}};
  h.vscode.extensions.onDidChange=callback=>{extensionEvent=callback;return disposable();};
  h.vscode.workspace.onDidChangeConfiguration=callback=>{configurationEvent=callback;return disposable();};
  h.vscode.commands.registerCommand=(id,handler)=>{commands.set(id,handler);return disposable();};
  h.context.subscriptions=[];h.context.extension={packageJSON:manifest};t.after(()=>h.context.subscriptions.forEach(item=>item.dispose()));
  const filename=require.resolve('../src/extension.cjs'), originalRequire=require('node:module').createRequire(filename), isolated={exports:{}};
  const load=name=>name==='./storage.cjs'?{...storage,defaultBase:()=>path.join(h.root,'managed')}:name==='./removal.cjs'?{observeRemoval:options=>{removed=options.onRemoval;return disposable();}}:originalRequire(name);
  require('node:vm').runInThisContext('(function(require,module,exports,__dirname,__filename){'+fs.readFileSync(filename,'utf8')+'\n})',{filename})(load,isolated,isolated.exports,path.dirname(filename),filename);
  const controller=await isolated.exports.activate(h.context,h.vscode);
  assert(controller.getState().active);await removed(()=>true);assert.equal(controller.getState(),null);
  assert(messages.some(message=>message.includes('uninstalled')));assert.equal(fs.readFileSync(h.htmlPath,'utf8'),h.original);
  extensionEvent();configurationEvent({affectsConfiguration:()=>true});await new Promise(resolve=>setTimeout(resolve,400));
  assert.equal(controller.getState(),null);assert.equal(fs.readFileSync(h.htmlPath,'utf8'),h.original);
  await commands.get('atomUIColors.apply')();assert(errors.some(message=>message.includes('has been uninstalled')));
});
