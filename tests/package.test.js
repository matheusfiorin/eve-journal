import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {posix} from 'node:path';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const uiFiles=async()=>{const out=[];for(const dir of ['ui','ui/screens'])for(const f of await readdir(new URL(`../${dir}`,import.meta.url)))if(f.endsWith('.js'))out.push(`${dir}/${f}`);return out;};
// Each screen module's static markup (its `export const markup = {...};` block) is part of the document.
const markupOf=source=>source.match(/export const markup[\s\S]*?};$/m)?.[0]||'';
test('every explicit app control exists exactly once in the document',async()=>{
  const files=['app.js',...await uiFiles()];
  const [html,...sources]=await Promise.all(['index.html',...files].map(read));
  const ids=[html,...sources.map(markupOf)].flatMap(s=>[...s.matchAll(/\bid="([\w-]+)"/g)].map(m=>m[1]));
  assert.equal(new Set(ids).size,ids.length,'duplicate HTML IDs');
  for(const [i,source] of sources.entries())for(const m of source.matchAll(/\$\('#([\w-]+)'\)/g))assert.ok(ids.includes(m[1]),`missing control in ${files[i]}: ${m[1]}`);
});
test('Pages artifact includes every browser module and stylesheet and excludes journal data',async()=>{
  const files=['app.js','storage.js',...await uiFiles()];
  const [workflow,html,...sources]=await Promise.all(['.github/workflows/pages.yml','index.html',...files].map(read));
  const copyLine=workflow.split('\n').find(l=>l.includes('cp index.html'));
  assert.match(copyLine,/cp -r ui styles _site\//,'ui/ and styles/ are copied whole');
  for(const [i,source] of sources.entries())for(const m of source.matchAll(/from '(\.[^']+)'/g)){
    const path=posix.normalize(posix.join(posix.dirname(files[i]),m[1]));
    assert.ok(path.startsWith('ui/')?files.includes(path):copyLine.includes(` ${path}`),`module omitted from Pages: ${path}`);
  }
  for(const m of html.matchAll(/href="(styles\/[\w.-]+)"/g))await read(m[1]);
  assert.ok(!copyLine.includes('*.json'),'only explicit public configuration is packaged');
  assert.ok(copyLine.includes('config.json'));
});
