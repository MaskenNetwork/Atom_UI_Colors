'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {spawnSync} = require('node:child_process');
const {parseHex, contrastRatio, ensureContrast} = require('../src/contrast.cjs');
const {resolveThemeColors, readColors} = require('../src/theme.cjs');
const {renderCSS} = require('../src/css.cjs');
const palette = require('../assets/palette.json');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atom-ui-colors-contrast-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const extension = {id:'test.theme', extensionPath:root, packageJSON:{contributes:{themes:[{id:'Ocean Night', label:'Ocean', path:'themes/child.json'}]}}};
  fs.mkdirSync(path.join(root, 'themes'));
  fs.writeFileSync(path.join(root, 'themes/base.json'), '// base\n{"colors":{"activityBar.background":"#012345","sideBar.background":"#112233"}}');
  fs.writeFileSync(path.join(root, 'themes/child.json'), '\uFEFF{/* child */ "include":"./base.json", "colors":{"activityBar.background":"#234567"},}');
  const config = {colorTheme:'Ocean Night', colorCustomizations:{}};
  const vscode = {extensions:{all:[extension]}, workspace:{getConfiguration:() => ({get:(key, fallback) => config[key] ?? fallback})}};
  return {root, extension, config, vscode};
}

test('contrast uses relative luminance and preserves already readable colors', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#123456', '#123456'), 1);
  assert.equal(ensureContrast('#80cbc4', '#181818'), '#80cbc4');
  assert.equal(ensureContrast('#ffffff', '#ffffff00'), null);
  assert.equal(ensureContrast('red', '#181818'), null);
  assert.equal(ensureContrast('#ffffff', '#000000', 22), null);
  assert.deepEqual(parseHex('#1234'), {rgb:[17,34,51], alpha:0.267});
});

test('dark, light, saturated and neutral colors reach the threshold after 8-bit quantization', () => {
  const foregrounds = new Set([...Object.values(palette), '#000000', '#ffffff', '#181818', '#000055', '#ffff00', '#808080']);
  for (const bg of ['#181818', '#ffffff', '#808080', '#234567', '#e0a020']) {
    for (const fg of foregrounds) {
      const result = ensureContrast(fg, bg);
      assert(result && contrastRatio(result, bg) >= 3, `${fg} on ${bg}: ${result}`);
      if (contrastRatio(fg, bg) >= 3) assert.equal(result, fg);
    }
  }
  const blue = parseHex(ensureContrast('#000055', '#181818')).rgb;
  assert(blue[2] > blue[0] && blue[2] > blue[1], 'blue remains blue');
});

test('JSONC theme includes and scoped customizations follow VS Code precedence', async t => {
  const h = fixture(t);
  h.config.colorCustomizations = {
    'activityBar.background':'#111111',
    '[Ocean*]':{'activityBar.background':'#222222'},
    '[Other][*Night]':{'activityBar.background':'#334455', 'activityBar.activeBackground':'#ffffff22'},
    '[*cean*]':{'sideBar.background':'#abcdef'},
    '[Other]':{'activityBar.background':'#999999'}
  };
  const colors = await resolveThemeColors(h.vscode);
  assert.equal(colors['activityBar.background'], '#334455');
  assert.equal(colors['sideBar.background'], '#abcdef');
  assert.equal(colors['activityBar.activeBackground'], '#ffffff22');
  h.config.colorCustomizations = {'activityBar.background':'default'};
  assert(!Object.hasOwn(await resolveThemeColors(h.vscode), 'activityBar.background'));
  h.config.colorCustomizations = {};
  assert.equal((await resolveThemeColors(h.vscode))['activityBar.background'], '#234567');
});

test('unreadable, invalid, cyclic and escaping themes fall back without guessing a background', async t => {
  const h = fixture(t);
  for (const contents of ['{ broken', '{"include":"./child.json"}', '{"include":"../../outside.json"}']) {
    fs.writeFileSync(path.join(h.root, 'themes/child.json'), contents);
    assert.deepEqual(await resolveThemeColors(h.vscode), {});
  }
  await assert.rejects(readColors(h.extension, '../outside.json', h.vscode), /escapes/);
  h.config.colorCustomizations = {'activityBar.background':'#123456'};
  assert.deepEqual(await resolveThemeColors(h.vscode), {'activityBar.background':'#123456'});
  h.config.colorTheme = 'Unavailable';
  h.config.colorCustomizations = {};
  assert.deepEqual(await resolveThemeColors(h.vscode), {});
});

test('remote JSONC themes can be read through the workspace filesystem', async () => {
  const files = {'/extension/theme.json':'{"include":"base.json","colors":{"activityBar.background":"#abcdef"}}', '/extension/base.json':'{"colors":{"sideBar.background":"#123456"}}'};
  const uri = value => ({scheme:'vscode-remote',path:value,toString:() => 'vscode-remote:' + value});
  const extension = {extensionUri:uri('/extension')};
  const vscode = {Uri:{joinPath:(root, relative) => uri(path.posix.join(root.path, relative))}, workspace:{fs:{stat:async () => ({size:100}), readFile:async value => Buffer.from(files[value.path])}}};
  assert.deepEqual(await readColors(extension, 'theme.json', vscode), {'sideBar.background':'#123456','activityBar.background':'#abcdef'});
});

test('activity adaptation honors explicit overrides and keeps CSS-only installation invariants', () => {
  const css = renderCSS({search:'#000055',gear:'#ffffff'}, {aliases:{'search-copy':'search'}, colors:{search:'#123456'},
    detectedViews:{auto:'#232323',manual:'#181818'}, viewColors:{manual:'#010203'}, activityBarTheme:{'activityBar.background':'#181818'}});
  assert(css.includes('color: #123456 !important'));
  assert(css.includes('background-color: #010203 !important'));
  assert(!css.includes('--atom-ui-colors-contrast-123456'));
  assert(!css.includes('--atom-ui-colors-contrast-010203'));
  assert(css.includes('var(--atom-ui-colors-contrast-232323, #232323)'));
  assert(css.includes('@container style(--vscode-activityBar-background: #181818)'));
  assert(!/<script|@import|url\(/i.test(css));
  assert(!/[{;]\s*(?:width|height|content|opacity|font-size)\s*:/.test(css));
});

// Optional real-engine verification; normal CI still runs all numerical/theme
// and lifecycle tests. Point ATOM_UI_COLORS_BROWSER at Chromium/Edge to enable.
test('browser applies guards per window, state and theme change', {skip:!process.env.ATOM_UI_COLORS_BROWSER}, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atom-ui-colors-contrast-browser-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true, maxRetries:10, retryDelay:100}));
  const css = renderCSS({search:'#000055',gear:'#ffffff'}, {
    colors:{gear:'#010203'}, aliases:{'search-copy':'search'}, detectedViews:{test:'#000055'},
    viewColors:{manualView:'#010203'}, resources:[{path:'/icons/manual.svg',url:'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path d="M0 0h1v1H0z"/></svg>').toString('base64'), color:'#000055'}],
    activityBarTheme:{'activityBar.background':'#181818','activityBar.activeBackground':'#ffffff80','sideBar.background':'#181818',
      'modernActivityBar.background':'#181818','modernActivityBar.inactiveBackground':'#181818','modernActivityBarItem.activeBackground':'#ffffff22'}
  });
  const file = path.join(root, 'fixture.html');
  fs.writeFileSync(file, `<!DOCTYPE html><meta charset="utf-8"><style>
    .monaco-workbench { --vscode-activityBar-background:#181818; --vscode-activityBar-foreground:#eeeeee; --vscode-activityBar-inactiveForeground:#aaaaaa; --vscode-icon-foreground:#bbbbbb; }
    .codicon::before {content:'X'; color:rgb(40,40,40)} .uri-icon {background-color:rgb(40,40,40)}
    ${css}</style><div class="monaco-workbench vs-dark" id="dark"></div><div class="monaco-workbench vs-light" id="light" style="--vscode-activityBar-background:#ffffff"></div>
    <script>
    const failures=[];function check(ok,name){if(!ok)failures.push(name)};
    function rgb(id,pseudo){return getComputedStyle(document.querySelector(id),pseudo).color}
    function bg(id){return getComputedStyle(document.querySelector(id)).backgroundColor}
    const structure='<div class="activitybar"><div class="monaco-action-bar"><div class="action-item" id="ITEM"><a class="codicon codicon-search" id="GLYPH"></a><a class="action-label uri-icon" id="test"></a><a class="codicon codicon-gear" id="MANUAL"></a><a class="codicon codicon-search disabled" id="DISABLED"></a></div></div></div><a class="codicon codicon-search" id="OUTSIDE"></a>';
    dark.innerHTML=structure.replaceAll('ITEM','item').replaceAll('GLYPH','glyph').replaceAll('MANUAL','manual').replaceAll('DISABLED','disabled').replaceAll('OUTSIDE','outside');
    light.innerHTML='<div class="activitybar"><div class="action-item"><a class="codicon codicon-search" id="light-glyph"></a></div></div>';
    const corrected=rgb('#glyph','::before');
    check(corrected!=='rgb(0, 0, 85)' && corrected!=='rgb(170, 170, 170)','dark correction');
    check(rgb('#light-glyph','::before')==='rgb(0, 0, 85)','independent light window');
    check(bg('#test')===corrected,'SVG mask and glyph agree');
    check(rgb('#manual','::before')==='rgb(1, 2, 3)','manual override');
    item.insertAdjacentHTML('beforeend','<a class="action-label uri-icon icon" id="manualView" style="background-image:url(vscode-file://vscode-app/icons/manual.svg)"></a>');
    check(bg('#manualView')==='rgb(1, 2, 3)','manual SVG override wins over resource mask');
    check(rgb('#disabled','::before')==='rgb(40, 40, 40)','disabled remains native');
    check(rgb('#outside','::before')==='rgb(0, 0, 85)','outside bar unchanged');
    item.classList.add('checked');
    check(rgb('#glyph','::before')===corrected,'active without overlay');
    dark.style.setProperty('--vscode-activityBar-activeBackground','rgba(255, 255, 255, 0.5)');
    check(rgb('#glyph','::before')==='rgb(${parseHex(ensureContrast('#000055', '#8c8c8c')).rgb.join(', ')})','known alpha overlay is corrected');
    dark.style.setProperty('--vscode-activityBar-activeBackground','#ff0000');
    check(rgb('#glyph','::before')==='rgb(238, 238, 238)','unknown active overlay uses active theme foreground');
    item.classList.remove('checked');
    dark.style.setProperty('--vscode-activityBar-background','#456789');
    check(rgb('#glyph','::before')==='rgb(170, 170, 170)','unverified changed background uses theme foreground');
    dark.style.setProperty('--vscode-activityBar-background','#181818');
    check(rgb('#glyph','::before')===corrected,'live return to verified background');
    dark.classList.add('modern-ui','focused');
    dark.style.setProperty('--vscode-modernActivityBar-background','#181818');
    dark.style.setProperty('--vscode-modernActivityBar-inactiveBackground','#181818');
    check(rgb('#glyph','::before')===corrected,'Modern UI normal state');
    dark.classList.remove('focused');
    check(rgb('#glyph','::before')===corrected,'Modern UI unfocused window');
    item.classList.add('checked');
    dark.style.setProperty('--vscode-modernActivityBarItem-activeBackground','rgba(255, 255, 255, 0.13)');
    check(rgb('#glyph','::before')==='rgb(${parseHex(ensureContrast('#000055', '#363636')).rgb.join(', ')})','Modern UI selected overlay');
    item.classList.remove('checked');dark.classList.remove('modern-ui');
    const topBar=document.createElement('div');topBar.className='part sidebar';topBar.style.setProperty('--vscode-sideBar-background','#181818');
    topBar.innerHTML='<div class="header-or-footer"><div class="composite-bar-container"><div class="composite-bar"><div class="action-item"><a class="codicon codicon-search" id="top-glyph"></a></div></div></div></div>';
    dark.appendChild(topBar);
    check(rgb('#top-glyph','::before')===corrected,'top activity bar uses verified sidebar background');
    dark.classList.add('modern-ui-tabs');
    check(rgb('#top-glyph','::before')==='rgb(187, 187, 187)','unverified tab layout uses theme foreground');
    dark.classList.remove('modern-ui-tabs');
    dark.classList.add('hc-black');
    check(rgb('#glyph','::before')==='rgb(40, 40, 40)','high contrast remains native');
    document.body.innerHTML='<pre id="result">'+JSON.stringify({failures,corrected})+'</pre>';
    </script>`);
  const result = spawnSync(process.env.ATOM_UI_COLORS_BROWSER, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${path.join(root, 'profile')}`,'--dump-dom',pathToFileURL(file).href], {encoding:'utf8', timeout:45000, windowsHide:true, maxBuffer:4*1024*1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const output = /<pre id="result">(\{"failures"[^<]*)<\/pre>/.exec(result.stdout);
  assert(output, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(output[1]).failures, []);
});
