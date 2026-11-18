'use strict';
const jsonc = require('../vendor/jsonc-parser/lib/umd/main.js');
const KEY = 'vscode_custom_css.imports';
function parse(text) {
  const errors = [];
  const value = jsonc.parse(text.replace(/^\uFEFF/, ' '), errors, {allowTrailingComma:true, disallowComments:false, allowEmptyContent:true});
  if (errors.length || (value !== undefined && (!value || Array.isArray(value) || typeof value !== 'object'))) throw new Error('settings.json is not a valid JSONC object.');
  if (value?.[KEY] !== undefined && (!Array.isArray(value[KEY]) || value[KEY].some(v=>typeof v !== 'string'))) throw new Error(`${KEY} must be an array of URLs.`);
  return value || {};
}
function setImports(text, imports) {
  parse(text);
  const edits = jsonc.modify(text,[KEY],imports,{formattingOptions:{insertSpaces:!/^\t/m.test(text),tabSize:2,eol:text.includes('\r\n')?'\r\n':'\n'}});
  return jsonc.applyEdits(text,edits);
}
function removeOwned(text, url, originallyPresent) {
  const value = parse(text);
  if (!value[KEY]?.includes(url)) return text;
  const remaining = value[KEY].filter(item=>item!==url);
  return setImports(text, remaining.length || originallyPresent ? remaining : undefined);
}
module.exports = {KEY, parse, setImports, removeOwned};
