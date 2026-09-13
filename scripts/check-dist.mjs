import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {ROOT,loadCatalogs,normalizeCatalogs,digest,counts} from './catalog-data.mjs';
const dist=path.join(ROOT,'dist'),prefix='/recsys-2027-check/';
for(const page of ['index.html','soe.html']){
 const html=fs.readFileSync(path.join(dist,page),'utf8');
 assert.doesNotMatch(html,/(?:src|href)=["'][^"']*\/src\//,'Pages must deploy built assets, not Vite source');
 const scripts=[...html.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map(m=>m[1]);
 assert.ok(scripts.length,`No built script found in ${page}`);
 for(const url of scripts){assert.ok(url.startsWith(prefix+'assets/'),`Wrong asset base in ${page}`);assert.ok(fs.existsSync(path.join(dist,url.slice(prefix.length))),`Missing asset ${url}`);}
}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
for(const file of walk(dist).filter(f=>/\.(js|html|json|css)$/.test(f))){
 const content=fs.readFileSync(file,'utf8');assert.doesNotMatch(content,/sb_secret_[A-Za-z0-9_-]{20,}/,`Privileged credential detected in ${path.basename(file)}`);
}
const tables=normalizeCatalogs(loadCatalogs());
const revision=process.env.GITHUB_SHA||execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
fs.writeFileSync(path.join(dist,'release.json'),JSON.stringify({revision,catalog_sha256:digest(tables),counts:counts(tables)},null,2)+'\n');
console.log('PASS: both Pages entrypoints use existing built assets; no secret key found; release.json written.');
