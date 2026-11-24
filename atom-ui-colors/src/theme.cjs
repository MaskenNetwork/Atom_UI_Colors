'use strict';
const fs = require('node:fs');
const path = require('node:path');
const jsonc = require('../vendor/jsonc-parser/lib/umd/main.js');
const {parseHex} = require('./contrast.cjs');
const MAX_BYTES = 2 * 1024 * 1024;

function parseTheme(text) {
  const errors = [];
  const value = jsonc.parse(text.replace(/^\uFEFF/, ''), errors, {allowTrailingComma:true});
  if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSONC theme.');
  return value;
}
function matchesScope(pattern, name) {
  if (typeof name !== 'string') return false;
  const start = pattern.startsWith('*'), end = pattern.endsWith('*');
  const content = pattern.slice(start ? 1 : 0, end ? -1 : undefined);
  return start && end ? name.includes(content) : start ? name.endsWith(content) : end ? name.startsWith(content) : name === pattern;
}
function customColors(customizations, name) {
  const result = {};
  if (!customizations || typeof customizations !== 'object') return result;
  for (const [id, value] of Object.entries(customizations)) if (!id.startsWith('[')) result[id] = value;
  for (const [scope, values] of Object.entries(customizations)) {
    if (!scope.startsWith('[') || !scope.endsWith(']') || !values || typeof values !== 'object' || Array.isArray(values)) continue;
    if ([...scope.matchAll(/\[([^\]]*)\]/g)].some(match => matchesScope(match[1], name))) Object.assign(result, values);
  }
  return result;
}
async function readColors(extension, relative, vscode, visited = new Set()) {
  if (visited.size >= 16 || typeof relative !== 'string' || relative.includes('\0')) throw new Error('Unsupported theme include.');
  const root = extension.extensionPath || extension.extensionUri?.fsPath;
  const remote = extension.extensionUri && extension.extensionUri.scheme !== 'file';
  let key, bytes;
  if (remote && vscode.Uri?.joinPath && vscode.workspace.fs) {
    const normalized = path.posix.normalize(relative.replaceAll('\\', '/'));
    if (normalized.startsWith('../') || path.posix.isAbsolute(normalized) || /^[a-z]+:/i.test(normalized)) throw new Error('Theme path escapes its extension.');
    const uri = vscode.Uri.joinPath(extension.extensionUri, normalized);
    key = uri.toString();
    if (visited.has(key)) throw new Error('Cyclic theme include.');
    if ((await vscode.workspace.fs.stat(uri)).size > MAX_BYTES) throw new Error('Theme exceeds the analysis limit.');
    bytes = Buffer.from(await vscode.workspace.fs.readFile(uri));
  } else {
    if (!root) throw new Error('Theme location unavailable.');
    key = path.resolve(root, relative);
    const within = path.relative(root, key);
    if (within.startsWith('..') || path.isAbsolute(within)) throw new Error('Theme path escapes its extension.');
    if (visited.has(key)) throw new Error('Cyclic theme include.');
    if ((await fs.promises.stat(key)).size > MAX_BYTES) throw new Error('Theme exceeds the analysis limit.');
    bytes = await fs.promises.readFile(key);
  }
  if (bytes.length > MAX_BYTES) throw new Error('Theme exceeds the analysis limit.');
  visited.add(key);
  const data = parseTheme(bytes.toString('utf8'));
  const inherited = data.include ? await readColors(extension, path.posix.join(path.posix.dirname(relative.replaceAll('\\', '/')), data.include), vscode, visited) : {};
  return {...inherited, ...(data.colors && typeof data.colors === 'object' && !Array.isArray(data.colors) ? data.colors : {})};
}
async function resolveThemeColors(vscode, {output} = {}) {
  const workbench = vscode.workspace.getConfiguration('workbench');
  const name = workbench.get('colorTheme');
  let colors = {};
  const extensions = [...(vscode.extensions.all || [])].sort((a, b) => a.id.localeCompare(b.id));
  for (const extension of extensions) {
    const themes = extension.packageJSON?.contributes?.themes;
    const theme = Array.isArray(themes) ? themes.find(theme => theme && (theme.id || theme.label) === name) : null;
    if (!theme) continue;
    try { colors = await readColors(extension, theme.path, vscode); }
    catch (error) { output?.appendLine(`Theme contrast: ${error.message} Using theme foregrounds where backgrounds cannot be verified.`); }
    break;
  }
  Object.assign(colors, customColors(workbench.get('colorCustomizations', {}), name));
  // "default" deliberately removes a theme color: the registry default is not
  // exposed by the public API. Never guess it, or treat it as the theme value.
  return Object.fromEntries(Object.entries(colors).filter(([, value]) => parseHex(value)));
}

module.exports = {resolveThemeColors, customColors, readColors};
