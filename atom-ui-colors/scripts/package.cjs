'use strict';
// Dependency-free, reproducible VSIX packager. `npx @vscode/vsce package` can
// also package this source tree for Marketplace publication.
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const root=path.resolve(__dirname,'..');
const manifest=require('../package.json');
const crcTable=Array.from({length:256},(_,n)=>{for(let bit=0;bit<8;bit++) n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(buffer) {let crc=0xffffffff;for(const byte of buffer)crc=crcTable[(crc^byte)&255]^(crc>>>8);return(crc^0xffffffff)>>>0;}
const xml=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function zip(entries) {
  const body=[],directory=[];let offset=0;
  for(const [name,value] of entries) {
    if(name.startsWith('/') || name.includes('..') || name.includes('\\')) throw new Error('Unsafe package entry: '+name);
    const filename=Buffer.from(name),raw=Buffer.isBuffer(value)?value:Buffer.from(value),compressed=zlib.deflateRawSync(raw),crc=crc32(raw);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(filename.length,26);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(8,10);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
    body.push(local,filename,compressed);directory.push(central,filename);offset+=local.length+filename.length+compressed.length;
  }
  const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...body,central,end]);
}
function packageExtension(output=path.join(root,'..',`${manifest.name}-${manifest.version}.vsix`)) {
  const files=[];
  function collect(directory) {for(const entry of fs.readdirSync(path.join(root,directory),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const relative=path.posix.join(directory,entry.name);if(entry.isDirectory())collect(relative);else if(entry.isFile())files.push([`extension/${relative}`,fs.readFileSync(path.join(root,relative))]);}}
  for(const name of ['package.json','README.md','CHANGELOG.md','LICENSE','THIRD_PARTY_NOTICES.md']) files.push([`extension/${name}`,fs.readFileSync(path.join(root,name))]);
  for(const name of ['src','assets','media','vendor']) collect(name);
  const icon=manifest.icon;
  if(!icon || !files.some(([name])=>name===`extension/${icon}`)) throw new Error('The Marketplace icon must be included in the package.');
  // Keep Marketplace Resources links aligned with the official vsce packager.
  const repository=manifest.repository.url;
  const links={Source:repository,Getstarted:repository,GitHub:repository,Support:manifest.bugs.url,Learn:manifest.homepage};
  const linkProperties=Object.entries(links).map(([name,value])=>`<Property Id="Microsoft.VisualStudio.Services.Links.${name}" Value="${xml(value)}"/>`).join('');
  const vsix=`<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="${xml(manifest.name)}" Version="${xml(manifest.version)}" Publisher="${xml(manifest.publisher)}"/><DisplayName>${xml(manifest.displayName)}</DisplayName><Description xml:space="preserve">${xml(manifest.description)}</Description><Tags>${manifest.keywords.map(xml).join(',')}</Tags><Categories>${manifest.categories.map(xml).join(',')}</Categories><GalleryFlags>Public${manifest.preview?' Preview':''}</GalleryFlags><Properties>${linkProperties}<Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(manifest.engines.vscode)}"/><Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="${xml((manifest.extensionDependencies||[]).join(','))}"/><Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui"/><Property Id="Microsoft.VisualStudio.Services.Branding.Color" Value="${xml(manifest.galleryBanner.color)}"/><Property Id="Microsoft.VisualStudio.Services.Branding.Theme" Value="${xml(manifest.galleryBanner.theme)}"/><Property Id="Microsoft.VisualStudio.Services.EnableMarketplaceQnA" Value="true"/></Properties><Icon>extension/${xml(icon)}</Icon><License>extension/LICENSE</License></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/${xml(icon)}" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Changelog" Path="extension/CHANGELOG.md" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/></Assets></PackageManifest>`;
  const types='<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="css" ContentType="text/css"/><Default Extension="png" ContentType="image/png"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="wasm" ContentType="application/wasm"/><Default Extension="txt" ContentType="text/plain"/><Default Extension="vsixmanifest" ContentType="text/xml"/><Override PartName="/extension/LICENSE" ContentType="text/plain"/></Types>';
  const buffer=zip([['extension.vsixmanifest',vsix],['[Content_Types].xml',types],...files]);
  fs.writeFileSync(output,buffer);console.log(`${output}: ${buffer.length} bytes, ${files.length+2} files.`);return output;
}
if(require.main===module)packageExtension();
module.exports={zip,crc32,packageExtension};
