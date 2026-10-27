import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DecalGeometry} from 'three/addons/geometries/DecalGeometry.js';
import {toCreasedNormals} from 'three/addons/utils/BufferGeometryUtils.js';

const SOURCE='./assets/cars/stock-car.glb';
let templatePromise;
const paintNames=new Set(['Body_F','Body_R','Body_U']);
export function loadCarModel(){
 if(!templatePromise)templatePromise=new GLTFLoader().loadAsync(SOURCE).then(gltf=>{
  const root=new T.Group();root.name='stock-car-normalized';root.add(gltf.scene);root.rotation.y=Math.PI/2;root.updateMatrixWorld(true);
  const bounds=new T.Box3().setFromObject(root),center=bounds.getCenter(new T.Vector3()),size=bounds.getSize(new T.Vector3());
  const scale=4.88/size.x,offset=new T.Group();offset.add(root);root.position.set(-center.x,-bounds.min.y,-center.z);offset.scale.setScalar(scale);
  offset.updateMatrixWorld(true);offset.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;const name=o.material.name;if(paintNames.has(name)||['Tire','Rims','Wing'].includes(name))o.geometry=toCreasedNormals(o.geometry,.65);}});
  return offset;
 }).catch(e=>{templatePromise=null;throw e;});
 return templatePromise;
}
function canvasTexture(draw,width=1024,height=512){const c=document.createElement('canvas');c.width=width;c.height=height;draw(c.getContext('2d'),width,height);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.anisotropy=8;return t;}
function number(c,text,x,y,size){c.textAlign='center';c.textBaseline='middle';c.font=`italic 900 ${size}px Arial`;c.lineJoin='round';c.strokeStyle='#141921';c.lineWidth=size*.09;c.strokeText(text,x,y);c.fillStyle='#fff4cc';c.fillText(text,x,y);c.lineWidth=size*.018;c.strokeStyle='#f7f8f0';c.strokeText(text,x,y);}
function sideLivery(r){return canvasTexture((c,w,h)=>{
 c.fillStyle=r.stripe;c.beginPath();c.moveTo(0,h*.73);c.lineTo(w*.75,h*.62);c.lineTo(w,h*.35);c.lineTo(w,h);c.lineTo(0,h);c.fill();
 c.fillStyle=r.accent;c.fillRect(0,h*.92,w,h*.025);
 if(r.id==='prism'){['#fc424e','#ffb624','#ffe849','#45dba8','#49a8fc'].forEach((color,i)=>{c.strokeStyle=color;c.lineWidth=24;c.beginPath();c.moveTo(0,210+i*27);c.bezierCurveTo(300,100+i*24,700,250+i*18,w,15+i*27);c.stroke();});}
 if(r.id==='smoke'){c.fillStyle='#171c24';for(let i=0;i<6;i++){c.beginPath();c.moveTo(w*.58+i*55,h);c.lineTo(w*.70+i*40,h*.43);c.lineTo(w*.65+i*50,h);c.fill();}}
 if(r.id==='candy'){['#e64861','#fcd22d','#609ff5','#eb8a29','#e249a0'].forEach((color,i)=>{c.fillStyle=color;c.beginPath();c.ellipse(w*(.12+i*.14),h*.83,27,19,-.35,0,Math.PI*2);c.fill();});}
 number(c,r.number,w*.5,h*.53,245);
 c.fillStyle=r.id==='ironhart'?'#e5e7e8':'#fff5e6';c.font='900 37px Arial';c.textAlign='center';c.fillText(r.sponsor,w*.83,h*.52,220);
 c.font='bold 17px Arial';c.fillText('STREAKCHAT CUP',w*.19,h*.62,160);
 for(let i=0;i<8;i++){c.fillStyle=['#f5d15a','#ebede0','#df643c','#a7d4c6'][i%4];c.fillRect(125+(i%2)*52,215+Math.floor(i/2)*20,42,13);}
 });}
function topLivery(r){return canvasTexture((c,w,h)=>{
 c.fillStyle=r.accent;c.globalAlpha=.7;c.fillRect(0,h*.1,w,h*.035);c.globalAlpha=1;
 c.textAlign='center';c.textBaseline='middle';c.fillStyle='#fff4df';c.strokeStyle='#151b25';c.lineWidth=14;c.font='italic 900 160px Arial';c.strokeText(r.sponsor,w*.5,h*.5,w*.85);c.fillText(r.sponsor,w*.5,h*.5,w*.85);
 c.font='bold 40px Arial';c.fillText('MOTORSPORTS',w*.5,h*.8,w*.7);
 if(r.id==='prism'){['#fa414b','#ffbb2c','#f9e050','#58dba7','#479cf5'].forEach((color,i)=>{c.fillStyle=color;c.fillRect(w*.07+i*w*.025,0,w*.023,h);});}
 });}
function roofNumber(r){return canvasTexture((c,w,h)=>number(c,r.number,w/2,h/2,410),512,512);}
function addDecals(car,targets,map,position,orientation,size,name){
 const material=new T.MeshPhysicalMaterial({map,transparent:true,alphaTest:.03,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3,roughness:.34,metalness:.15,clearcoat:1,clearcoatRoughness:.18});
 for(const target of targets){const geometry=new DecalGeometry(target,position,orientation,size);if(!geometry.attributes.position.count){geometry.dispose();continue;}const m=new T.Mesh(geometry,material);m.name=name;m.renderOrder=2;car.add(m);}
}
export function createStockCar(template,r){
 const car=new T.Group();car.name=`stock-car-${r.id}`;const model=template.clone(true);car.add(model);
 const paint=new T.MeshPhysicalMaterial({name:'race-paint',color:r.color,metalness:.48,roughness:.28,clearcoat:1,clearcoatRoughness:.13,envMapIntensity:1.05});
 const tire=new T.MeshStandardMaterial({color:'#14171a',roughness:.94});
 const rim=new T.MeshStandardMaterial({color:'#454d56',metalness:.9,roughness:.29});
 const glass=new T.MeshPhysicalMaterial({color:'#142534',metalness:.28,roughness:.13,clearcoat:1,clearcoatRoughness:.06,envMapIntensity:1.5});
 const materials=new Map(),targets=[],wheels=[];
 model.traverse(o=>{if(o.name.startsWith('wheel_star_bolt'))wheels.push(o);if(!o.isMesh)return;const name=o.material.name;
  if(paintNames.has(name)){o.material=paint;targets.push(o);}
  else if(name==='Tire')o.material=tire;
  else if(name==='Rims')o.material=rim;
  else if(name.startsWith('Glass'))o.material=glass;
  else {if(!materials.has(name)){const m=o.material.clone();m.roughness=name==='Lug'?.28:.65;m.metalness=['Lug','Braces','Wing'].includes(name)?.65:.1;if(name==='Lamp_F'){m.color.set('#ede9d1');m.emissive=new T.Color('#fff3cc');m.emissiveIntensity=.25;}if(name==='Rookie')m.color.set(r.stripe);materials.set(name,m);}o.material=materials.get(name);}
 });
 car.updateMatrixWorld(true);
 const sideMap=sideLivery(r),roofMap=roofNumber(r),hoodMap=topLivery(r);
 for(const side of [-1,1])addDecals(car,targets,sideMap,new T.Vector3(0,.67,side*.985),new T.Euler(0,side<0?Math.PI:0,0),new T.Vector3(4.7,.92,.35),'livery-side');
 addDecals(car,targets,roofMap,new T.Vector3(-.18,1.49,0),new T.Euler(-Math.PI/2,0,-Math.PI/2),new T.Vector3(1.15,1.3,.3),'livery-roof');
 addDecals(car,targets,hoodMap,new T.Vector3(1.46,1.02,0),new T.Euler(-Math.PI/2,0,-Math.PI/2),new T.Vector3(1.48,1.31,.68),'livery-hood');
 // A woven driver-side window net, mounted behind the side glass.
 const netMaterial=new T.MeshStandardMaterial({color:'#171b21',roughness:.9});
 for(let i=0;i<7;i++){const mesh=new T.Mesh(new T.BoxGeometry(.018,.32,.018),netMaterial);mesh.position.set(-.57+i*.12,1.17,-.82);car.add(mesh);}
 for(let i=0;i<4;i++){const mesh=new T.Mesh(new T.BoxGeometry(.76,.018,.018),netMaterial);mesh.position.set(-.21,1.03+i*.09,-.82);car.add(mesh);}
 const glow=new T.Mesh(new T.RingGeometry(1.28,1.52,48),new T.MeshBasicMaterial({color:r.accent,transparent:true,opacity:0,side:T.DoubleSide,depthWrite:false}));glow.rotation.x=-Math.PI/2;glow.position.y=.025;car.add(glow);
 const exhaust=new T.Mesh(new T.ConeGeometry(.22,2.3,12),new T.MeshBasicMaterial({color:r.accent,transparent:true,opacity:0,depthWrite:false}));exhaust.rotation.z=Math.PI/2;exhaust.position.set(-3.05,.38,0);car.add(exhaust);
 car.userData={glow,exhaust,wheels,wheelDistance:0,modelSource:'WiyantoID / CC0',quality:'detailed-stock-car'};return car;
}
export function rollWheels(car,distance){
 const delta=distance-(car.userData.wheelDistance??distance);car.userData.wheelDistance=distance;
 if(Math.abs(delta)>20)return;
 for(const wheel of car.userData.wheels??[])wheel.rotateX(-delta/.355);
}
