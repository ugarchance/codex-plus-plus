import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import patches from '../patch/patches/index.mjs';
const require=createRequire(new URL('../patch/package.json',import.meta.url));
const acorn=require('acorn');
const root=process.argv[2];
if(!root)throw Error('Usage: node tools/test-bundle-compatibility.mjs <extracted original ASAR directory>');
const names=fs.readdirSync(root,{recursive:true}).filter(f=>fs.statSync(path.join(root,f)).isFile()).map(f=>f.replaceAll('\\','/'));
const changed=new Map();
const read=f=>changed.get(f)??fs.readFileSync(path.join(root,f),'utf8');
for(const patch of patches){
 const regex=new RegExp('^'+patch.glob.replace(/[.+^${}()|[\]\\]/g,'\\$&').replaceAll('*','[^/]*')+'$');
 const matches=names.filter(f=>regex.test(f)&&(!patch.select||read(f).includes(patch.select)));
 assert.equal(matches.length,1,patch.id+' unique file');
 const file=matches[0],source=read(file);
 assert.equal(source.includes(patch.marker),false,patch.id+' marker absent upstream');
 const output=patch.apply(source);
 assert.ok(output.includes(patch.marker),patch.id+' marker after apply');
 changed.set(file,output);
 console.log('PASS '+patch.id+' -> '+file);
}
for(const [file,source] of changed){
 acorn.parse(source,{ecmaVersion:'latest',sourceType:file.startsWith('webview/')?'module':'script'});
 if(process.argv[3])assert.equal(source,fs.readFileSync(path.join(process.argv[3],file),'utf8'),'verified artifact matches final patch output: '+file);
 console.log('Syntax PASS '+file);
}
for(const patch of patches){const matching=[...changed].filter(([f,s])=>(!patch.select||s.includes(patch.select))&&s.includes(patch.marker));assert.ok(matching.length>0,patch.id+' second pass skipped by installer marker');}
console.log(`${patches.length} patches; ${changed.size} unique files parsed; original files unchanged`);
