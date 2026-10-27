import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('site',{recursive:true});
await build({entryPoints:['app.js'],outfile:'site/app.js',bundle:true,minify:true,format:'esm',target:'es2022'});
await Promise.all(['index.html','style.css','favicon.svg'].map(f=>copyFile(`public/${f}`,`site/${f}`)));
console.log('CarRace built in site/');
