import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
function parse(file){const b=readFileSync(new URL(file,import.meta.url));assert.equal(b.toString('ascii',0,4),'glTF');assert.equal(b.readUInt32LE(4),2);assert.equal(b.readUInt32LE(8),b.length);const length=b.readUInt32LE(12);return{bytes:b,json:JSON.parse(b.toString('utf8',20,20+length))};}
test('licensed model source is retained unchanged and runtime GLB is self-contained with four independent wheels',()=>{
 const source=parse('../assets/source/stock-camry-ns.glb'),runtime=parse('../assets/cars/stock-car.glb');
 assert.equal(createHash('sha256').update(source.bytes).digest('hex'),'6855cdfc4c68cbb2adb98c14f55330a67bec5f034919e99548eb722853ac79c1');
 for(const{json:g}of[source,runtime]){assert.equal(g.asset.version,'2.0');assert.ok(g.nodes.filter(n=>n.name?.startsWith('wheel_star_bolt')).length===4);assert.ok(g.meshes.length>=5);assert.ok((g.buffers??[]).every(b=>!b.uri));assert.ok((g.images??[]).every(i=>!i.uri));assert.ok(g.materials.some(m=>m.name==='Body_F'));}
 assert.ok(runtime.bytes.length<900_000,'seven cars share one mobile-sized GLB');
 const license=readFileSync(new URL('../assets/licenses/stock-camry-ns-readme.txt',import.meta.url),'utf8');assert.match(license,/Creative Commons Zero v1\.0 Universal \(CC0\)/);assert.match(license,/WiyantoID/);
});
