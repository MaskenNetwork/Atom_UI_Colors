'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const w=require('../src/workbench.cjs'),a=require('../src/application.cjs'),s=require('../src/storage.cjs');
const {renderCSS}=require('../src/css.cjs');
const stock=require('../assets/workbench-baselines.json').builds[0];
const page=policies=>'<html><head>'+policies.map(p=>`<meta http-equiv="Content-Security-Policy" content="${p}">`).join('')+'</head><body></body></html>';
const css=renderCSS({search:'#123456'},{token:'test'});
test('policy precedence, first duplicate directive and multiple enforced policies',()=>{
  for(const policy of ["style-src 'unsafe-inline'","default-src 'unsafe-inline'","style-src 'none'; style-src-elem 'unsafe-inline'","STYLE-SRC 'unsafe-inline'; style-src 'none'","style-src &#39;unsafe-inline&#39;","style-src &apos;unsafe-inline&apos;"]) {
    const original=page([policy,policy]);const changed=w.apply(original,css,'test');
    assert.equal(w.remove(changed,'test'),original);
    assert.equal(w.policies(changed).meta.length,2);
    assert.equal(w.apply(changed,css,'test'),changed);
  }
  for(const policy of ["style-src 'unsafe-inline'; style-src-elem 'none'","style-src 'unsafe-inline' 'nonce-abc'","style-src 'unsafe-inline' 'sha256-abc'","default-src 'unsafe-inline'; style-src 'self'","style-src 'none'; style-src 'unsafe-inline'","script-src 'unsafe-inline'","style-src 'self'",'',"style-src 'unsafe-inline'; sandbox"]) assert.throws(()=>w.apply(page(["style-src 'unsafe-inline'",policy]),css,'test'));
});
test('missing, misplaced, report-only, commented policies and ambiguous HTML fail closed',()=>{
  for(const html of [page([]),page(["style-src 'unsafe-inline'"]).replace('http-equiv','other'),page(["style-src 'unsafe-inline'"]).replace('Content-Security-Policy','Content-Security-Policy-Report-Only'),page(["style-src 'unsafe-inline'"]).replace('<meta','<style></style><meta'),'<html><head><!-- <meta http-equiv="Content-Security-Policy" content="style-src \'unsafe-inline\'"> --></head></html>',page(["style-src 'unsafe-inline'"]).replace('content=', 'content="other" content='),page(["style-src 'unsafe-inline'"]).replace('</head>','<base href="https://example.org"></head>')]) assert.throws(()=>w.apply(html,css,'test'));
});
test('verified policy enforcement also requires the original HTML prefix before the meta',()=>{
  for(const prefix of ['<xmp>','<plaintext>','<svg>','text that implicitly closes head','<select>']) {
    const changed=stock.html.replace('<head>','<head>'+prefix);
    assert.throws(()=>w.apply(changed,css,'test',stock.html));
  }
  assert.equal(w.assertBaseline(stock.html,stock.html).meta.length,1);
});
test('every packaged platform baseline has the pinned workbench hash and a compatible original policy',()=>{
  for(const baseline of require('../assets/workbench-baselines.json').builds) {
    assert.equal(w.digest(baseline.html),baseline.sha256);
    assert.equal(w.remove(w.apply(baseline.html,css,'test',baseline.html),'test'),baseline.html);
  }
});
test('HTML boundary protection covers CSS comments, strings and malicious URL paths',()=>{
  for(const payload of ['</style><script>alert(1)</script>','</StYlE >','<!--','\0','@import "https://example.org/x.css";']) assert.throws(()=>w.apply(page(["style-src 'unsafe-inline'"]),css.replace('/* Native',`/* ${payload} Native`),'test'));
  assert.throws(()=>w.apply(page(["style-src 'unsafe-inline'"]),css.replace('/* Native','/* ATOM-UI-COLORS:END test */</style><script> Native'),'test'));
  const data='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
  for(const location of ['C:/à space % # \' " < > /icon.svg','C:/@import/icon.svg']) {
    const url=new URL('file:///C:/icons/icon.svg');url.pathname='/'+location;
    const generated=renderCSS({},{token:'test',resources:[{path:location,url:url.href.replace('file://','vscode-file://vscode-app'),color:'#123456'}]});
    // Suspicious strings may be rejected; none can produce markup.
    try {const result=w.apply(stock.html,generated,'test');assert.equal(w.tags(result).filter(t=>t.name==='script').length,w.tags(stock.html).filter(t=>t.name==='script').length);} catch(error) {assert.match(error.message,/Unsafe|resource/);}
  }
  const generated=renderCSS({},{token:'test',resources:[{path:'/safe.svg',url:data,color:'#123456'}]});
  assert(w.apply(stock.html,generated,'test').includes(data));
  assert.throws(()=>w.apply(page(["style-src 'unsafe-inline'; img-src 'none'"]),generated,'test'),/mask resource/);
});
test('owned removal retains foreign styles/scripts byte for byte and refuses damaged ownership',()=>{
  const original=page(["style-src 'unsafe-inline'"]).replace('</head>','<style id="foreign">.extra { color: red }</style></head>')+'<!-- later -->';
  const changed=w.apply(original,css,'test');assert.equal(w.remove(changed,'test'),original);
  assert.throws(()=>w.remove(changed.replace('/* Native','/* changed */\n/* Native').replace('id="atom-ui-colors-test"','id="atom-ui-colors-test" nonce="x"'),'test'),/unexpected/);
  assert.throws(()=>w.apply(changed.replace('</head>',changed.match(/<style id="atom-ui-colors-test">[\s\S]*?<\/style>/)[0]+'</head>'),css,'test'),/Duplicate/);
});
test('journals roll back write failures at each phase and retain emergency legacy snapshots',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'atom-csp-journal-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const files=[path.join(root,'css'),path.join(root,'settings'),path.join(root,'html'),path.join(root,'state')];
  for(let fail=0;fail<files.length;fail++) {
    for(const file of files)fs.writeFileSync(file,'legacy without CSP');
    assert.throws(()=>a.transact(root,files.map(file=>({file,after:'verified CSP'})),{operation:'migrate'},index=>{if(index===fail)throw new Error('injected failure');}),/injected/);
    for(const file of files)assert.equal(fs.readFileSync(file,'utf8'),'legacy without CSP');
  }
  assert.equal(fs.readdirSync(path.join(root,'transactions')).length,files.length);
  const file=path.join(root,'transactions','crash.json');
  s.writeJSON(file,{phase:'prepared',changes:[{file:files[0],before:'legacy without CSP',after:'verified CSP'}]});
  fs.writeFileSync(files[0],'verified CSP');a.recover(root);assert.equal(fs.readFileSync(files[0],'utf8'),'legacy without CSP');
  s.writeJSON(file,{phase:'prepared',changes:[{file:files[0],before:'legacy without CSP',after:'verified CSP'}]});
  fs.writeFileSync(files[0],'later user edit');assert.throws(()=>a.recover(root),/External edit/);assert.equal(fs.readFileSync(files[0],'utf8'),'later user edit');
  assert.equal(s.readJSON(file).phase,'prepared');
});

test('a second profile can adopt its legacy CSS after another profile already restored CSP',()=>{
  const before=stock.html.replace('</head>',`<style>${css}</style><style>/* later foreign style */</style></head>`);
  const after=w.apply(before,css,'test',stock.html);
  assert.equal(after.split('ATOM-UI-COLORS:BEGIN test').length-1,1);
  assert.equal(after.split('id="atom-ui-colors-test"').length-1,1);
  assert(after.indexOf('ATOM-UI-COLORS:END')<after.indexOf('later foreign style'));
  assert(!w.remove(after,'test').includes('ATOM-UI-COLORS'));
});
test('owner-filtered recovery does not roll back another installation transaction',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'atom-owner-recovery-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const target=path.join(root,'foreign-file'),owner=path.join(root,'owner-b'),journal=path.join(root,'transactions/pending.json');fs.writeFileSync(target,'after');
  s.writeJSON(journal,{phase:'prepared',details:{owner},changes:[{file:target,before:'before',after:'after'}]});
  a.recover(root,path.join(root,'owner-a'));assert.equal(fs.readFileSync(target,'utf8'),'after');
  assert.throws(()=>a.transact(root,[{file:target,after:'different owner'}],{owner:path.join(root,'owner-a')}),/unfinished transaction/);
  a.recover(root,owner);assert.equal(fs.readFileSync(target,'utf8'),'before');
});
