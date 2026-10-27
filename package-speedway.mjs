import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const folder=path.resolve('review/speedway-deploy');mkdirSync(folder,{recursive:true});const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();writeFileSync('review/REVISION',revision+'\n');
const files=['server/start.js','server/http.js','server/game.js','server/race-simulation.js','site','package.json','race-core.js','track.js','powers.js','betting.js','progression.js'];
execFileSync('tar',['-czf',path.join(folder,'carrace-release.tar.gz'),...files,'-C','review','REVISION'],{stdio:'inherit'});
writeFileSync(path.join(folder,'update-speedway.sh'),readFileSync('deploy/update-speedway.sh','utf8').replaceAll('\r\n','\n'));
writeFileSync(path.join(folder,'release.sha256'),createHash('sha256').update(readFileSync(path.join(folder,'carrace-release.tar.gz'))).digest('hex')+'  carrace-release.tar.gz\n');console.log({revision,folder});
