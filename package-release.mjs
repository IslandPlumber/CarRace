import {mkdirSync,copyFileSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const destination=path.resolve('review/deploy');mkdirSync(destination,{recursive:true});
const rev=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();writeFileSync('review/REVISION',rev+'\n');
const files=['server/start.js','server/http.js','server/game.js','server/race-simulation.js','site','package.json','race-core.js','track.js','powers.js','betting.js','progression.js'];
execFileSync('tar',['-czf',path.join(destination,'carrace-release.tar.gz'),...files,'-C','review','REVISION'],{stdio:'inherit'});
for(const name of ['install-carrace.sh','carrace.service','carrace-location.conf','inspect.sh']){
 const bytes=readFileSync(`deploy/${name}`,'utf8').replaceAll('\r\n','\n');writeFileSync(path.join(destination,name),bytes);
}
const manifest=['carrace-release.tar.gz','carrace.service','carrace-location.conf'].map(name=>`${createHash('sha256').update(readFileSync(path.join(destination,name))).digest('hex')}  ${name}`).join('\n')+'\n';writeFileSync(path.join(destination,'payload.sha256'),manifest);
console.log({revision:rev,folder:destination,archiveBytes:readFileSync(path.join(destination,'carrace-release.tar.gz')).length});
