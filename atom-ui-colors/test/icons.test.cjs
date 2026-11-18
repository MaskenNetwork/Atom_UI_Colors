'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {dominantColor, analyzeSVG} = require('../src/svg.cjs');
const {resolveColors, parseBundle, discoverIcons} = require('../src/icons.cjs');
const {renderCSS} = require('../src/css.cjs');
const palette = require('../assets/palette.json');
const catalog = require('../assets/codicons.json');
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${body}</svg>`;
const rect = (color, width = 100, x = 0, extra = '') => `<rect x="${x}" width="${width}" height="100" fill="${color}" ${extra}/>`;

test('dominant SVG color uses visible area rather than attribute frequency', async () => {
  assert.equal(await dominantColor(svg(rect('#ff0000', 90) + rect('#0000ff', 5, 90) + rect('#0000ff', 5, 95))), '#ff0000');
});
test('equal SVG areas select the first paint in document order', async () => {
  assert.equal(await dominantColor(svg(rect('#0000ff', 50) + rect('#ff0000', 50, 50))), '#0000ff');
  assert.equal(await dominantColor(svg(rect('#ff0000', 50, 50) + rect('#0000ff', 50))), '#ff0000');
  assert.equal(await dominantColor('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" fill="red">'+rect('blue',50)+'<rect x="50" width="50" height="100"/></svg>'), '#ff0000');
});
test('SVG analysis accounts for overlap, opacity, CSS and inherited paint', async () => {
  assert.equal(await dominantColor(svg(rect('red') + rect('blue', 80))), '#0000ff');
  assert.equal(await dominantColor(svg(rect('red', 50, 0, 'opacity="0.1"') + rect('blue', 50, 50))), '#0000ff');
  assert.equal(await dominantColor(svg('<style>.paint {fill:rgb(217,119,87)}</style><g class="paint"><rect width="100" height="100"/></g>')), '#d97757');
  assert.equal(await dominantColor('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="#D97757"><path d="M0 0h24v24H0z"/></svg>'), '#d97757');
});
test('context colors and missing colors fall back; explicit neutral colors are retained', async () => {
  assert.equal(await dominantColor(svg('<rect width="100" height="100"/>')), null);
  assert.equal(await dominantColor(svg(rect('currentColor'))), null);
  assert.equal(await dominantColor(svg(rect('none'))), null);
  assert.equal(await dominantColor(svg(rect('#000000'))), '#000000');
  assert.equal(await dominantColor(svg(rect('#888888'))), '#888888');
  assert.equal(await dominantColor(svg(rect('red', 100, 0, 'opacity="0"'))), null);
});
test('gradient paints, clipping and hidden elements are measured from the rendered SVG', async () => {
  assert.equal(await dominantColor(svg('<defs><clipPath id="small"><rect width="10" height="100"/></clipPath></defs>'+rect('red')+'<g clip-path="url(#small)">'+rect('blue')+'</g>')), '#ff0000');
  assert.equal(await dominantColor(svg(rect('red')+'<g display="none">'+rect('blue')+'</g>')), '#ff0000');
  const gradient='<defs><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/>';
  assert.equal(await dominantColor(svg(gradient)), '#ff0000');
});
test('malformed or external SVG resources are rejected in the worker', async () => {
  await assert.rejects(analyzeSVG('<svg broken'), /SVG|parse|element|document/i);
  await assert.rejects(analyzeSVG(svg('<image href="https://example.invalid/icon.png"/>')), /resource/);
  await assert.rejects(analyzeSVG('<!DOCTYPE svg><svg/>'), /resource/);
  await assert.rejects(analyzeSVG(' '.repeat(512 * 1024 + 1)), /limit/);
  assert.equal(await analyzeSVG(svg(rect('#D97757'))), '#d97757');
});
test('official catalog covers every extracted Codicon, including derived aliases', () => {
  assert(Object.keys(catalog.icons).length >= 789);
  for (const id of ['chevron-down', 'loading', 'copy', 'folder', 'tree-item-loading', 'dialog-error']) assert(Object.hasOwn(catalog.icons, id), id);
  for (const reference of Object.values(catalog.icons).filter(Boolean)) assert(Object.hasOwn(catalog.icons, reference), reference);
  assert.equal(catalog.icons['dialog-error'], 'error');
  assert.equal(catalog.icons['tree-item-expanded'], 'chevron-down');
});
test('aliases inherit colors while explicit palette colors and user overrides prevail', () => {
  const aliases = {...catalog.icons, 'custom-search': 'search', nested: 'custom-search', cycleA: 'cycleB', cycleB: 'cycleA'};
  const result = resolveColors(palette, aliases, {search: '#123456', copilot: '#8c8c8c'});
  assert.equal(result['custom-search'], '#123456'); assert.equal(result.nested, '#123456');
  assert.equal(result['repo-delete'], palette['repo-delete']); assert.equal(result.repo, palette.repo);
  assert.equal(result['dialog-error'], palette.error); assert.equal(result.copilot, '#8c8c8c');
  assert.equal(result['logo-github'], palette['mark-github']);
  assert(!result.cycleA);
});
test('installed bundle aliases are parsed without evaluating application code', () => {
  const aliases = parseBundle('var icons={add:reg("add",6e4),plus:reg("plus",6e4),newThing:reg("new-thing",60700)}; var account=register("accounts-view-bar-icon",P.account,msg()); var alias=register("new-view",P.newThing,msg()); var nested=register("nested-view",alias,msg());');
  assert.equal(aliases.plus, 'add'); assert.equal(aliases['new-thing'], null);
  assert.equal(aliases['new-view'], 'new-thing'); assert.equal(aliases['nested-view'], 'new-view');
});
test('all Codicons and URI masks receive explicit stable fallbacks without historical SVG defaults', () => {
  const css = renderCSS(palette, {aliases: catalog.icons, detectedViews: {'new-view': null, 'colored-view': '#d97757'}});
  assert(css.includes('.codicon:not(.file-icon):not(.folder-icon)'));
  assert(css.includes('--vscode-icon-foreground')); assert(css.includes('--vscode-activityBar-inactiveForeground'));
  assert(css.includes('.action-label.uri-icon')); assert(css.includes('color: var(--atom-ui-colors-fallback'));
  assert(css.includes('background-color: #d97757 !important'));
  for (const id of ['codexViewContainer', 'codexSecondaryViewContainer', 'prettyTsErrors', 'project-manager', 'angular']) assert(!css.includes(`activity-workbench-view-extension-${id}-`), id);
  assert(!css.includes('background-image:')); assert(!css.includes('mask-image:'));
});
test('extension discovery refreshes from installed SVGs and theme variants, with no brand lookup', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atom-ui-colors-icons-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  fs.writeFileSync(path.join(root, 'dark.svg'), svg(rect('#D97757')));
  fs.writeFileSync(path.join(root, 'light.svg'), svg(rect('#123456')));
  fs.writeFileSync(path.join(root, 'neutral.svg'), svg(rect('currentColor')));
  const views = [{id:'claude-sidebar',icon:{dark:'dark.svg',light:'light.svg'}}, {id:'neutral',icon:'neutral.svg'}, {id:'missing',icon:'missing.svg'}, {id:'codicon-view',icon:'$(search)'}];
  const vscode = {window:{activeColorTheme:{kind:2}},extensions:{all:[{id:'test.extension',extensionPath:root,packageJSON:{contributes:{viewsContainers:{activitybar:views},icons:{'custom-alias':{default:'search'}},commands:[{command:'test.toolbar',icon:'dark.svg'}]}}}]}};
  let result = await discoverIcons(vscode);
  assert.equal(result.viewColors['claude-sidebar'], '#d97757'); assert.equal(result.viewColors.neutral, null);
  assert.equal(result.viewColors.missing, null); assert(!Object.hasOwn(result.viewColors, 'codicon-view'));
  assert.equal(result.aliases['custom-alias'], 'search');
  assert.equal(result.resources.find(resource=>resource.path.endsWith('/dark.svg')).color,'#d97757');
  assert(!Object.hasOwn(result.viewColors,'test.toolbar'));
  vscode.window.activeColorTheme.kind = 1;
  result = await discoverIcons(vscode); assert.equal(result.viewColors['claude-sidebar'], '#123456');
  fs.writeFileSync(path.join(root, 'light.svg'), svg(rect('#abcdef')));
  result = await discoverIcons(vscode); assert.equal(result.viewColors['claude-sidebar'], '#abcdef');
  vscode.extensions.all = []; result = await discoverIcons(vscode); assert.deepEqual(result.viewColors, {});
});
test('toolbar SVG rules use the original resource as a mask, including a theme fallback and encoded paths', () => {
  const resource={path:'/extensions/an extension/icon # %.svg',url:'vscode-file://vscode-app/extensions/an%20extension/icon%20%23%20%25.svg',color:'#d97757',ignoreCase:false};
  const css=renderCSS({}, {resources:[resource,{...resource,path:'/extensions/neutral.svg',color:null}]});
  assert(css.includes('background-image: none !important'));
  assert(css.includes(`mask-image: url("${resource.url}") !important`));
  assert(css.includes('/extensions/an%20extension/icon%20%23%20%25.svg'));
  assert(css.includes('background-color: var(--atom-ui-colors-fallback'));
  assert(!/[{;]\s*(?:content|width|height|font-family|font-size)\s*:/.test(css));
  assert.throws(()=>renderCSS({}, {resources:[{...resource,url:'https://example.invalid/icon.svg'}]}),/Invalid SVG/);
});
