'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {spawnSync} = require('node:child_process');
const {renderCSS} = require('../src/css.cjs');
const {contrastRatio, ensureContrast, parseHex} = require('../src/contrast.cjs');
const palette = require('../assets/palette.json');

test('notification bell needs correction on white while its dark-theme color is readable', () => {
  assert(contrastRatio(palette.bell, '#ffffff') < 1.5);
  const adjusted = ensureContrast(palette.bell, '#ffffff');
  assert(contrastRatio(adjusted, '#ffffff') >= 3);
  const [r, g, b] = parseHex(adjusted).rgb;
  assert(r > g && g > b, 'correction retains the yellow hue');
  assert.equal(ensureContrast(palette.bell, '#23272e'), palette.bell);
});

test('browser keeps status icons readable across backgrounds, states and windows', {skip:!process.env.ATOM_UI_COLORS_BROWSER}, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atom-ui-colors-statusbar-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true, maxRetries:10, retryDelay:100}));
  const css = renderCSS(palette, {colors:{gear:'#ffffff'}, statusBarTheme:{
    'statusBar.background':'#23272e', 'statusBar.debuggingBackground':'#fff0e0',
    'statusBar.noFolderBackground':'#ececec', 'statusBar.inactiveBackground':'#fafafa',
  }});
  const file = path.join(root, 'fixture.html');
  // Classes preserve pseudo-class specificity and deterministically select the
  // same rules in this dump-dom fixture, without relying on pointer timing.
  const simulate = css => css.replaceAll(':hover', '.test-hover').replaceAll(':active', '.test-active');
  const native = `
    .codicon::before {content:'X'; color:inherit}
    .statusbar-item-label {color:inherit}
    .statusbar-item span.codicon {color:inherit}
    .statusbar-item a:hover:not(.disabled) {color:var(--vscode-statusBarItem-hoverForeground); background-color:var(--vscode-statusBarItem-hoverBackground)!important}
    .monaco-workbench:not(.hc-black):not(.hc-light) .statusbar-item a:active:not(.disabled) {background-color:var(--vscode-statusBarItem-activeBackground)!important}
  `;
  fs.writeFileSync(file, `<!DOCTYPE html><meta charset="utf-8"><style>${simulate(native + css)}</style><body><script>
    const failures=[];function check(ok,name){if(!ok)failures.push(name)};
    const palette=${JSON.stringify(palette)};
    function rgb(value){return value.match(/[0-9.]+/g).slice(0,3).map(Number)}
    function hex(value){return '#'+rgb(value).map(v=>v.toString(16).padStart(2,'0')).join('')}
    function color(element){return getComputedStyle(element,'::before').color}
    function ratio(fg,bg){
      function lum(value){const c=rgb(value).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722}
      const a=lum(fg),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)
    }
    function windowFixture(id,background,foreground){
      const workbench=document.createElement('div');workbench.className='monaco-workbench';workbench.id=id;
      workbench.innerHTML='<footer class="part statusbar"><div class="items-container"><div class="statusbar-item"><a class="statusbar-item-label">Status text</a></div></div></footer>';
      const bar=workbench.querySelector('.statusbar');bar.style.backgroundColor=background;bar.style.color=foreground;
      const label=bar.querySelector('a'),item=label.parentElement;
      for(const id of Object.keys(palette)){const icon=document.createElement('span');icon.className='codicon codicon-'+id;icon.dataset.icon=id;label.appendChild(icon)}
      document.body.appendChild(workbench);
      const bell=label.querySelector('.codicon-bell'),manual=label.querySelector('.codicon-gear');
      return {workbench,bar,label,item,bell,manual};
    }
    function readable(h,background,name){
      for(const icon of h.label.querySelectorAll('.codicon:not(.codicon-gear)')){
        const value=color(icon);if(ratio(value,background)<3){failures.push(name+': '+icon.dataset.icon+' '+value);break}
      }
    }
    const light=windowFixture('light','#ffffff','#202020');
    const dark=windowFixture('dark','#23272e','#eeeeee');
    readable(light,'rgb(255,255,255)','all automatic light icons');
    readable(dark,'rgb(35,39,46)','all automatic dark icons');
    check(hex(color(light.bell))==='${ensureContrast(palette.bell, '#ffffff')}','bell becomes readable yellow on light theme');
    check(hex(color(dark.bell))===palette.bell,'readable dark bell retains original color');
    check(color(light.manual)==='rgb(255, 255, 255)','explicit color is preserved even below threshold');
    check(getComputedStyle(light.label).color==='rgb(32, 32, 32)','status text color is preserved');
    for(const [name,bg] of [['debug','#fff0e0'],['empty','#ececec'],['inactive','#fafafa'],['default','#007acc']]){
      const h=windowFixture(name,bg,'#202020');readable(h,getComputedStyle(h.bar).backgroundColor,name+' background');
    }
    light.workbench.style.setProperty('--vscode-statusBarItem-hoverBackground','rgba(0, 0, 0, 0.12)');
    light.workbench.style.setProperty('--vscode-statusBarItem-hoverForeground','#202020');
    light.label.classList.add('test-hover');
    readable(light,'rgb(224,224,224)','light hover overlay');
    dark.workbench.style.setProperty('--vscode-statusBarItem-activeBackground','rgba(255, 255, 255, 0.18)');
    dark.label.classList.add('test-hover','test-active');
    readable(dark,'rgb(75,78,84)','active overrides hover');
    dark.label.classList.remove('test-hover','test-active');
    dark.workbench.style.removeProperty('--vscode-statusBarItem-activeBackground');
    dark.workbench.style.setProperty('--vscode-statusBarItem-hoverBackground','#121212');
    dark.workbench.style.setProperty('--vscode-statusBarItem-hoverForeground','#fefefe');
    dark.label.classList.add('test-hover','test-active');
    check(color(dark.bell)==='rgb(254, 254, 254)','missing active overlay does not ignore remaining hover background');
    dark.label.classList.remove('test-hover','test-active');
    light.workbench.style.setProperty('--vscode-statusBarItem-hoverBackground','#121212');
    light.workbench.style.setProperty('--vscode-statusBarItem-hoverForeground','#fefefe');
    check(color(light.bell)==='rgb(254, 254, 254)','unknown hover uses native hover foreground');
    light.workbench.style.removeProperty('--vscode-statusBarItem-hoverBackground');
    readable(light,'rgb(255,255,255)','absent overlay is transparent');
    light.item.classList.add('compact-left');
    check(color(light.bell)==='rgb(254, 254, 254)','compact hover preserves native foreground for layered background');
    light.item.classList.remove('compact-left');light.label.classList.remove('test-hover');
    for(const kind of ['warning','error','remote','offline','prominent']){
      light.item.classList.add(kind+'-kind');light.label.style.color='#010203';
      check(color(light.bell)==='rgb(1, 2, 3)',kind+' entry uses its semantic foreground');
      light.item.classList.remove(kind+'-kind');
    }
    light.item.classList.add('has-background-color');
    check(color(light.bell)==='rgb(1, 2, 3)','extension-painted entry retains native foreground');
    light.item.classList.remove('has-background-color');light.item.style.backgroundColor='#ffffff';
    check(color(light.bell)==='rgb(1, 2, 3)','inline item background is not mistaken for bar background');
    light.item.style.removeProperty('background-color');light.label.style.backgroundColor='#ffffff';
    check(color(light.bell)==='rgb(1, 2, 3)','inline label background retains native foreground');
    light.label.style.removeProperty('background-color');light.label.style.removeProperty('color');
    light.bar.style.backgroundColor='#123456';light.bar.style.color='#fefefe';
    check(color(light.bell)==='rgb(254, 254, 254)','unknown changed background discards stale correction');
    light.bar.style.backgroundColor='#23272e';
    check(hex(color(light.bell))===palette.bell,'live light to dark change restores original yellow');
    light.bar.style.backgroundColor='#ffffff';
    readable(light,'rgb(255,255,255)','live return to light background');
    light.workbench.classList.add('hc-light');
    check(color(light.bell)==='rgb(254, 254, 254)','high contrast keeps native icon color');
    light.workbench.classList.remove('hc-light');light.item.classList.add('disabled');
    check(color(light.bell)==='rgb(254, 254, 254)','disabled status icon stays native');
    light.item.classList.remove('disabled');
    const outside=document.createElement('span');outside.className='codicon codicon-bell';light.workbench.appendChild(outside);
    check(hex(color(outside))===palette.bell,'icons outside status bar remain unchanged');
    const menu=document.createElement('div');menu.className='monaco-menu';menu.innerHTML='<span class="codicon codicon-bell"></span>';light.label.appendChild(menu);
    check(hex(color(menu.firstElementChild))===palette.bell,'nested menu cannot inherit status bar correction');
    document.body.innerHTML='<pre id="result">'+JSON.stringify({failures})+'</pre>';
  </script>`);
  const result = spawnSync(process.env.ATOM_UI_COLORS_BROWSER, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${path.join(root, 'profile')}`,'--dump-dom',pathToFileURL(file).href], {encoding:'utf8', timeout:45000, windowsHide:true, maxBuffer:4*1024*1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const output = /<pre id="result">(\{"failures"[^<]*)<\/pre>/.exec(result.stdout);
  assert(output, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(output[1]).failures, []);
});
