'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const catalog = require('../assets/codicons.json');
const {analyzeSVG, MAX_BYTES} = require('./svg.cjs');
const validId = id => typeof id === 'string' && /^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(id);
const svgCache = new Map();
let bundleCache;

// Read registration data without evaluating VS Code's application code. The
// generic CSS fallback covers future IDs even if a future bundle format changes.
function parseBundle(source) {
  const aliases = {...catalog.icons}, properties = {...catalog.properties};
  const registration = /\badd:([\w$]+)\("add",(?:6e4|60000)\)/.exec(source)?.[1];
  if (registration) {
    const escaped = registration.replace(/[$]/g, '\\$&');
    const entries = [...source.matchAll(new RegExp(`([\\w$]+):${escaped}\\("([a-zA-Z][\\w.-]*)",(0x[\\da-f]+|[\\de.+-]+|"[^"]+")\\)`, 'g'))];
    const glyphs = new Map();
    for (const [, property, id, raw] of entries) {
      properties[property] = id;
      if (raw.startsWith('"')) aliases[id] = raw.slice(1, -1);
      else {
        const glyph = Number(raw);
        if (!Number.isFinite(glyph)) continue;
        aliases[id] = glyphs.get(glyph) || null;
        if (!glyphs.has(glyph)) glyphs.set(glyph, id);
      }
    }
  }
  const productRegister = /([\w$]+)\("accounts-view-bar-icon",([\w$]+)\.account,/.exec(source);
  if (productRegister) {
    const fn = productRegister[1].replace(/[$]/g, '\\$&');
    const codiconObject = productRegister[2];
    const symbols = new Map(), pending = [];
    const pattern = new RegExp(`${fn}\\("([a-zA-Z][\\w.-]*)",([\\w$.]+)(?=[,)])`, 'g');
    for (const match of source.matchAll(pattern)) {
      const [, id, reference] = match;
      const prefix = source.slice(Math.max(0, match.index - 90), match.index);
      const symbol = /([\w$]+)\s*=\s*$/.exec(prefix)?.[1];
      if (symbol) symbols.set(symbol, id);
      pending.push({id, reference});
    }
    for (const {id, reference} of pending) {
      const [object, property] = reference.split('.');
      aliases[id] = object === codiconObject ? (properties[property] || null) : (symbols.get(reference) || null);
    }
  }
  return aliases;
}
function applicationAliases(appRoot, output) {
  if (!appRoot) return {...catalog.icons};
  const file = path.join(appRoot, 'out/vs/workbench/workbench.desktop.main.js');
  try {
    const stat = fs.statSync(file), key = `${file}:${stat.size}:${stat.mtimeMs}`;
    if (bundleCache?.key === key) return {...bundleCache.aliases};
    const aliases = parseBundle(fs.readFileSync(file, 'utf8'));
    bundleCache = {key, aliases};
    output?.appendLine(`Icon registry: ${Object.keys(aliases).length} IDs discovered.`);
    return {...aliases};
  } catch { return {...catalog.icons}; }
}
function resolveColors(palette, aliases, overrides = {}) {
  const resolved = {...palette};
  // A library glyph may be introduced under an unmapped name before a mapped
  // synonym (e.g. logo-github / mark-github). Use a mapped member as the group's
  // fallback, while preserving every explicit palette entry independently.
  const groupColors = new Map();
  function rootOf(id) {
    const visited = new Set();
    while (Object.hasOwn(aliases,id) && typeof aliases[id] === 'string' && !visited.has(id)) { visited.add(id); id = aliases[id]; }
    return id;
  }
  for (const [id, color] of Object.entries({...palette, ...overrides})) {
    const root = rootOf(id);
    if (!groupColors.has(root) || id === root || Object.hasOwn(overrides, id)) groupColors.set(root, color);
  }
  function lookup(id, visited = new Set()) {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (Object.hasOwn(resolved, id)) return resolved[id];
    if (visited.has(id)) return null;
    visited.add(id);
    const color = (Object.hasOwn(aliases,id) && typeof aliases[id] === 'string' ? lookup(aliases[id], visited) : null) || groupColors.get(rootOf(id));
    if (color) resolved[id] = color;
    return color;
  }
  for (const id of Object.keys(aliases)) lookup(id);
  return {...resolved, ...overrides};
}
function iconPath(icon, light) {
  if (typeof icon === 'string') return icon;
  if (icon && typeof icon === 'object') return light ? (icon.light || icon.dark) : (icon.dark || icon.light);
  return null;
}
async function discoverIcons(vscode, {appRoot, output} = {}) {
  const aliases = applicationAliases(appRoot, output), viewColors = {}, resources = new Map();
  const light = vscode.window?.activeColorTheme?.kind === 1 || vscode.window?.activeColorTheme?.kind === 4;
  const extensions = [...(vscode.extensions.all || [])].sort((a, b) => a.id.localeCompare(b.id));
  for (const extension of extensions) {
    const contributes = extension.packageJSON?.contributes || {};
    for (const [id, definition] of Object.entries(contributes.icons || {})) {
      if (validId(id)) aliases[id] = typeof definition?.default === 'string' ? definition.default : null;
    }
    const views = [...Object.values(contributes.viewsContainers || {}).flat(), ...Object.values(contributes.views || {}).flat(),
      ...(contributes.commands || []).map(command=>({id:command.command,icon:command.icon,command:true}))];
    for (const view of views) {
      if (!validId(view?.id)) continue;
      const relative = iconPath(view.icon, light);
      if (!relative || /^\$\([\w.-]+\)$/.test(relative)) continue;
      // null means an explicit theme-color fallback, including unreadable assets.
      if (!view.command) viewColors[view.id] = null;
      if (!/\.svg$/i.test(relative) || relative.includes('\0') || /^[a-z]+:/i.test(relative)
        || /(^|[\\/])\.\.([\\/]|$)/.test(relative) || /^[\\/]/.test(relative)) continue;
      try {
        let bytes, resourcePath, browserUrl;
        if (extension.extensionUri && extension.extensionUri.scheme !== 'file' && vscode.Uri?.joinPath && vscode.workspace.fs) {
          const uri = vscode.Uri.joinPath(extension.extensionUri, relative);
          resourcePath = uri.path;
          if ((await vscode.workspace.fs.stat(uri)).size > MAX_BYTES) throw new Error('SVG exceeds the analysis limit.');
          bytes = Buffer.from(await vscode.workspace.fs.readFile(uri));
        } else {
          const root = extension.extensionPath || extension.extensionUri?.fsPath;
          if (!root) continue;
          const absolute = path.resolve(root, relative), within = path.relative(root, absolute);
          if (within.startsWith('..') || path.isAbsolute(within)) throw new Error('SVG path escapes its extension.');
          const uri = pathToFileURL(absolute);
          resourcePath = decodeURIComponent(uri.pathname);
          browserUrl = uri.href.replace(/^file:\/\//,'vscode-file://vscode-app');
          resources.set(resourcePath,{path:resourcePath,url:browserUrl,color:null,ignoreCase:process.platform==='win32'});
          if ((await fs.promises.stat(absolute)).size > MAX_BYTES) throw new Error('SVG exceeds the analysis limit.');
          bytes = await fs.promises.readFile(absolute);
        }
        const digest = crypto.createHash('sha256').update(bytes).digest('hex');
        if (!svgCache.has(digest)) {
          if (svgCache.size >= 512) svgCache.clear();
          svgCache.set(digest, analyzeSVG(bytes.toString('utf8')).catch(error => {
            output?.appendLine(`SVG ${extension.id}/${relative}: ${error.message} Using the theme color.`);
            return null;
          }));
        }
        const color = await svgCache.get(digest);
        if (!view.command) viewColors[view.id] = color;
        // Image-only toolbar/tree elements can use the same resource as a mask.
        // Local URLs retain the SVG's original base URL and relative resources.
        browserUrl ||= `data:image/svg+xml;base64,${bytes.toString('base64')}`;
        if (resourcePath) resources.set(resourcePath,{path:resourcePath,url:browserUrl,color,ignoreCase:process.platform==='win32'});
      } catch (error) { output?.appendLine(`SVG ${extension.id}/${relative}: ${error.message} Using the theme color.`); }
    }
  }
  return {aliases, viewColors, resources:[...resources.values()]};
}
module.exports = {applicationAliases, parseBundle, resolveColors, discoverIcons};
