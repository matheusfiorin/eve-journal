// Check the same source directories on Windows and Unix without depending on a shell's glob expansion.
import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
let count=0;
for(const [dir,extension] of [['.','.js'],['ui','.js'],['ui/screens','.js'],['scripts','.mjs'],['worker','.js']]){
  const entries=await readdir(join(root,dir),{withFileTypes:true});
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
    if(!entry.isFile()||!entry.name.endsWith(extension))continue;
    const result=spawnSync(process.execPath,['--check',join(root,dir,entry.name)],{stdio:'inherit'});
    if(result.error)throw result.error;
    if(result.status!==0)process.exit(result.status??1);
    count++;
  }
}
console.log(`Syntax checks passed: ${count} files`);
