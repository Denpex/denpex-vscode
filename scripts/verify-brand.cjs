#!/usr/bin/env node
// Preserve the existing listing and the exact icon published by both registries.
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {createHash}=require('node:crypto');
const root=resolve(__dirname,'..');
const manifest=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
const expected='dbd170196fd9e00f7e5f08ad00021246cc7fea85f95c6f926bb0a8539fe3b904';
if(manifest.publisher!=='denpex'||manifest.name!=='denpex-diagnostics'||manifest.icon!=='logo.png'){
  throw new Error('Denpex publisher, extension name and icon path must preserve the existing listing.');
}
const actual=createHash('sha256').update(readFileSync(resolve(root,manifest.icon))).digest('hex');
if(actual!==expected)throw new Error('Extension logo differs from the published grid icon. Restore the original logo.png before packaging.');
console.log('Verified original Denpex extension identity and published grid icon.');
