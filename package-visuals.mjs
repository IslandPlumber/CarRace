import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const folder=path.resolve('review/visuals-deploy');mkdirSync(folder,{recursive:true});
execFileSync('tar',['-czf',path.join(folder,'carrace-visuals.tar.gz'),'site'],{stdio:'inherit'});
writeFileSync(path.join(folder,'update-visuals.sh'),readFileSync('deploy/update-visuals.sh','utf8').replaceAll('\r\n','\n'));
writeFileSync(path.join(folder,'visuals.sha256'),createHash('sha256').update(readFileSync(path.join(folder,'carrace-visuals.tar.gz'))).digest('hex')+'  carrace-visuals.tar.gz\n');
console.log('Visual-only package:',folder);
