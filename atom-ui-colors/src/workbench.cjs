'use strict';
// Deliberately limited HTML/CSP reader. Unsupported syntax fails closed. This
// is not a general HTML sanitizer, nor a replacement for browser enforcement.
const crypto = require('node:crypto');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function entities(value) {
  if(/&(?!(?:#(?:x[\da-f]+|\d+)|quot|apos|amp|lt|gt);)/i.test(value)) throw new Error('Ambiguous HTML entity.');
  return value.replace(/&(?:#(x[\da-f]+|\d+)|([a-z]+));/gi, (all, number, name) => {
    if (number) {
      const code = number[0].toLowerCase()==='x' ? parseInt(number.slice(1),16) : Number(number);
      if (!code || code>0x10ffff || (code>=0xd800 && code<=0xdfff)) throw new Error('Unsupported HTML entity.');
      return String.fromCodePoint(code);
    }
    const values={quot:'"',apos:"'",amp:'&',lt:'<',gt:'>'};
    if (!Object.hasOwn(values,name)) throw new Error('Unsupported HTML entity.');
    return values[name];
  });
}
function tags(html) {
  const result=[];
  const pattern=/<!--[\s\S]*?-->|<!doctype\s+html\s*>|<\/?[a-z][^<>]*>/giy;
  let at=0;
  while(at<html.length) {
    const next=html.indexOf('<',at);
    if(next<0) break;
    pattern.lastIndex=next;
    const match=pattern.exec(html);
    if(!match) throw new Error('Unsupported workbench HTML syntax.');
    const raw=match[0]; at=pattern.lastIndex;
    if(raw.startsWith('<!--') || /^<!doctype/i.test(raw)) continue;
    const name=/^<\/?([\w-]+)/.exec(raw)[1].toLowerCase(), closing=raw.startsWith('</');
    const attrs={}; let rest=raw.slice((closing?3:2)+name.length-1,-1);
    if(!closing) {
      const attr=/^\s+([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/;
      while(rest.trim() && rest.trim()!=='/') {
        const part=attr.exec(rest);
        if(!part) throw new Error('Unsupported HTML attributes.');
        const key=part[1].toLowerCase();
        if(Object.hasOwn(attrs,key)) throw new Error('Duplicate HTML attribute.');
        attrs[key]=entities(part[2]??part[3]??part[4]??''); rest=rest.slice(part[0].length);
      }
    }
    const tag={name,closing,attrs,raw,start:next,end:at}; result.push(tag);
    if(!closing && ['script','style','title','textarea'].includes(name)) {
      const end=new RegExp(`</${name}\\s*>`,'gi'); end.lastIndex=at;
      const close=end.exec(html);
      if(!close) throw new Error('Unclosed raw HTML element.');
      tag.content=html.slice(at,close.index); tag.closeEnd=end.lastIndex;
      at=end.lastIndex;
    }
  }
  return result;
}
function policies(html) {
  const all=tags(html), heads=all.filter(t=>t.name==='head');
  if(heads.length!==2 || heads[0].closing || !heads[1].closing) throw new Error('Unsupported workbench head.');
  const [open,close]=heads, meta=[]; let relevant=false;
  for(const tag of all) {
    if(['base','template','noscript','iframe','object'].includes(tag.name)) throw new Error('Unsupported workbench element.');
    if(tag.name==='meta' && /content-security-policy/i.test(tag.attrs['http-equiv']||'')) {
      if(tag.attrs['http-equiv'].toLowerCase()!=='content-security-policy' || tag.start<open.end || tag.end>close.start || relevant) throw new Error('CSP must be enforced early in the head.');
      if(!tag.attrs.content) throw new Error('Empty CSP.');
      meta.push(tag);
    }
    if(tag.start>=open.end && tag.start<close.start && ['link','style','script'].includes(tag.name)) relevant=true;
  }
  if(!meta.length) throw new Error('Original CSP is missing. Migration from a verified distribution is required.');
  return {meta,close,all};
}
function directives(policy) {
  if(/[^\x09\x0a\x0c\x0d\x20-\x7e]|,/.test(policy)) throw new Error('Unsupported CSP syntax.');
  const result=new Map();
  for(const part of policy.split(';')) {
    const words=part.trim().split(/\s+/), name=words.shift().toLowerCase();
    if(!name) continue;
    if(!/^[a-z][a-z\d-]*$/.test(name)) throw new Error('Unsupported CSP directive.');
    // CSP uses the first occurrence of each directive.
    if(!result.has(name)) result.set(name,words);
  }
  return result;
}
function assertInline(html) {
  const parsed=policies(html);
  for(const tag of parsed.meta) {
    const rules=directives(tag.attrs.content);
    if(rules.has('sandbox')) throw new Error('Unsupported CSP sandbox.');
    const source=rules.get('style-src-elem')??rules.get('style-src')??rules.get('default-src');
    if(!source || !source.some(v=>v.toLowerCase()==="'unsafe-inline'") || source.some(v=>/^'(?:nonce-|sha(?:256|384|512)-)/i.test(v))) throw new Error('Original CSP does not allow our inline style. No policy was changed.');
  }
  return parsed;
}
function assertResources(parsed,css) {
  if(/[<\u0000]/.test(css) || /@import/i.test(css)) throw new Error('Unsafe generated CSS cannot be embedded in HTML.');
  const urls=[...css.matchAll(/url\(("(?:[^"\\]|\\.)*")\)/g)].map(m=>JSON.parse(m[1]));
  if((css.match(/url\(/g)||[]).length!==urls.length) throw new Error('Unsupported generated CSS URL.');
  for(const url of urls) {
    if(!/^(?:vscode-file:\/\/vscode-app\/[^\s<>]*|data:image\/svg\+xml;base64,[A-Za-z\d+/=]+)$/.test(url)) throw new Error('Only local icon resources are supported.');
    for(const tag of parsed.meta) {
      const rules=directives(tag.attrs.content), sources=rules.get('img-src')??rules.get('default-src');
      const scheme=url.startsWith('data:')?'data:':'vscode-file:';
      if(!sources || !sources.some(s=>s===scheme || (scheme==='vscode-file:' && (s==='vscode-file://vscode-app' || s==="'self'")))) throw new Error('Original CSP does not allow an icon mask resource.');
    }
  }
}
const tokenOK=token=>/^[a-zA-Z0-9-]+$/.test(token);
function remove(html,token) {
  if(!tokenOK(token)) throw new Error('Invalid ownership token.');
  const opening=`<style id="atom-ui-colors-${token}">`, found=tags(html).filter(t=>t.name==='style' && t.attrs.id===`atom-ui-colors-${token}`);
  if(found.length>1) throw new Error('Duplicate owned workbench styles.');
  if(!found.length) return html;
  const tag=found[0];
  if(tag.raw!==opening || !tag.content.startsWith(`/* ATOM-UI-COLORS:BEGIN ${token} */\n`) || !tag.content.endsWith(`/* ATOM-UI-COLORS:END ${token} */\n`)) throw new Error('Owned style has unexpected content; recovery retained.');
  return html.slice(0,tag.start)+html.slice(tag.closeEnd);
}
function apply(html,css,token,baseline) {
  const existing=tags(html).find(t=>t.name==='style' && t.attrs.id===`atom-ui-colors-${token}`);
  const legacy=tags(html).filter(t=>t.name==='style' && !t.attrs.id && t.content.includes(`/* ATOM-UI-COLORS:BEGIN ${token} */`));
  if(legacy.length) {
    const {stripStyles}=require('./css.cjs'),tag=legacy[0],element=html.slice(tag.start,tag.closeEnd);
    if(existing || legacy.length!==1 || Object.keys(tag.attrs).length || stripStyles(element,token).trim()) throw new Error('Mixed or duplicate legacy CSS ownership requires review.');
    return apply(html.slice(0,tag.start)+`<style id="atom-ui-colors-${token}">${tag.content}</style>`+html.slice(tag.closeEnd),css,token,baseline);
  }
  const clean=remove(html,token), parsed=assertInline(clean);
  if(baseline) assertBaseline(clean,baseline);
  if(!tokenOK(token) || !css.startsWith(`/* ATOM-UI-COLORS:BEGIN ${token} */\n`) || !css.endsWith(`/* ATOM-UI-COLORS:END ${token} */\n`)) throw new Error('Invalid generated CSS ownership.');
  assertResources(parsed,css);
  const position=existing?existing.start:parsed.close.start;
  if(position<parsed.meta.at(-1).end || position>parsed.close.start) throw new Error('Owned CSS is outside its supported head position.');
  return clean.slice(0,position)+`<style id="atom-ui-colors-${token}">${css}</style>`+clean.slice(position);
}
function assertBaseline(html,baseline) {
  const parsed=assertInline(html), stock=policies(baseline);
  if(JSON.stringify(parsed.meta.map(t=>t.raw))!==JSON.stringify(stock.meta.map(t=>t.raw))) throw new Error('Workbench CSP differs from the verified distribution.');
  // Matching policy text alone cannot establish enforcement: HTML parser state
  // before the meta (e.g. plaintext, xmp, SVG or implicit head closure) matters.
  if(html.slice(0,parsed.meta.at(-1).end)!==baseline.slice(0,stock.meta.at(-1).end)) throw new Error('Workbench content before the CSP differs from the verified distribution.');
  return parsed;
}
// Only recognize the exact Loader 7.5.1 transformation. Foreign payloads are
// retained by refusing migration, rather than guessing at their ownership.
function migrate(html,baseline,token,indicatorHash) {
  const stock=policies(baseline);
  let clean=html;
  const marker=/<!-- !! VSCODE-CUSTOM-CSS-SESSION-ID [\da-f-]{36} !! -->\n<!-- !! VSCODE-CUSTOM-CSS-START !! -->\n([\s\S]*?)<!-- !! VSCODE-CUSTOM-CSS-END !! -->\n/gi;
  const blocks=[...clean.matchAll(marker)];
  if(blocks.length!==1) throw new Error('Unrecognized legacy patch. No files changed.');
  const payload=blocks[0][1];
  const {stripStyles}=require('./css.cjs');
  let remaining=payload, remainder=payload,owned=0;
  for(const tag of tags(payload)) {
    if(tag.name!=='style' || tag.closing || Object.keys(tag.attrs).length) throw new Error('Legacy patch contains foreign scripts or unsupported markup. Resolve this customization before migration.');
    const element=payload.slice(tag.start,tag.closeEnd);
    remainder=remainder.replace(element,'');
    if(tag.content.includes(`/* ATOM-UI-COLORS:BEGIN ${token} */`)) {
      if(++owned>1 || stripStyles(element,token).trim()) throw new Error('Mixed or duplicate legacy CSS ownership requires review.');
      // Retain the original cascade position relative to foreign style imports.
      const placeholder=`<style id="atom-ui-colors-${token}">/* ATOM-UI-COLORS:BEGIN ${token} */\n/* ATOM-UI-COLORS:END ${token} */\n</style>`;
      remaining=remaining.replace(element,placeholder);
    }
  }
  if(remainder.trim()) throw new Error('Unrecognized legacy payload.');
  clean=clean.replace(marker,'');
  for(const script of tags(clean).filter(t=>t.name==='script' && t.content?.includes('__CUSTOM_CSS_JS_INDICATOR_CLS'))) {
    if(digest(script.raw+script.content+'</script>')!==indicatorHash) throw new Error('Unrecognized Loader indicator script.');
    clean=clean.replace(script.raw+script.content+'</script>\n','');
  }
  let withoutPolicy=baseline;
  for(const tag of [...stock.meta].reverse()) withoutPolicy=withoutPolicy.slice(0,tag.start)+withoutPolicy.slice(tag.end);
  if(clean!==withoutPolicy) throw new Error('Legacy workbench differs from the verified distribution beyond the recognized patch. Recovery requires review.');
  return baseline.slice(0,stock.close.start)+remaining+baseline.slice(stock.close.start);
}
module.exports={tags,policies,directives,assertInline,assertBaseline,assertResources,apply,remove,migrate,digest};
