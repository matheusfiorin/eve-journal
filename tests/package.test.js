import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
test('every explicit app control exists exactly once in the document',async()=>{
  const [html,app]=await Promise.all([read('index.html'),read('app.js')]);
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length,'duplicate HTML IDs');
  for(const m of app.matchAll(/\$\('#([\w-]+)'\)/g))assert.ok(ids.includes(m[1]),`missing control: ${m[1]}`);
});
test('Pages artifact includes every browser module and excludes journal data',async()=>{
  const [workflow,app,storage]=await Promise.all([read('.github/workflows/pages.yml'),read('app.js'),read('storage.js')]);
  for(const source of [app,storage])for(const m of source.matchAll(/from '\.\/([\w.-]+)'/g))assert.ok(workflow.includes(m[1]),`module omitted from Pages: ${m[1]}`);
  const copyLine=workflow.split('\n').find(l=>l.includes('cp index.html'));
  assert.ok(!copyLine.includes('*.json'),'only explicit public configuration is packaged');
  assert.ok(copyLine.includes('config.json'));
});
