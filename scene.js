import * as T from 'three';
import {makeSpeedway,trackPoint,trackFrame,circuitLength} from './track.js';
import {buildSpeedwayVenue} from './speedway-venue.js';
import {RACERS,racerById} from './roster.js';
import {activePowerEffects,hitReaction} from './powers.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {loadCarModel,createStockCar,rollWheels} from './car-model.js';

function texture(draw,w=512,h=256){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.anisotropy=4;return t;}
const mat=(color,extra={})=>new T.MeshStandardMaterial({color,roughness:.68,...extra});
function box(parent,x,y,z,sx,sy,sz,material){const m=new T.Mesh(new T.BoxGeometry(sx,sy,sz),material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function sign(parent,text,x,y,z,width,height,bg='#17252c',fg='#eee4c8'){
 const t=texture((c,w,h)=>{c.fillStyle=bg;c.fillRect(0,0,w,h);c.fillStyle=fg;c.textAlign='center';c.textBaseline='middle';c.font=`italic 900 ${Math.min(110,800/text.length)}px Arial`;c.fillText(text,w/2,h/2,w-30);});
 const p=new T.Mesh(new T.PlaneGeometry(width,height),new T.MeshBasicMaterial({map:t,side:T.DoubleSide}));p.position.set(x,y,z);parent.add(p);return p;
}
function makeStockCar(r){
 const car=new T.Group(),paint=mat(r.color,{metalness:.4,roughness:.32}),dark=mat('#101720'),stripe=mat(r.stripe),glass=mat('#294654',{metalness:.65,roughness:.17}),rubber=mat('#111316'),chrome=mat('#b3bac1',{metalness:.85,roughness:.3});
 // A stock-car silhouette: wide fenders, sloping hood, enclosed cockpit, short deck.
 const shape=new T.Shape();shape.moveTo(-2.3,.42);shape.lineTo(-2.35,.82);shape.lineTo(-1.4,.99);shape.lineTo(-.95,1.61);shape.lineTo(.2,1.64);shape.lineTo(.95,1.05);shape.lineTo(2.1,.85);shape.lineTo(2.35,.58);shape.lineTo(2.3,.35);shape.lineTo(-2.3,.35);
 const body=new T.Mesh(new T.ExtrudeGeometry(shape,{depth:2.1,bevelEnabled:true,bevelThickness:.08,bevelSize:.09,bevelSegments:2,steps:1}),paint);body.position.z=-1.05;body.castShadow=true;body.receiveShadow=true;car.add(body);
 for(const side of [-1,1]){
  const windowShape=new T.Shape();windowShape.moveTo(-1.25,1.04);windowShape.lineTo(-.85,1.49);windowShape.lineTo(.15,1.51);windowShape.lineTo(.74,1.06);windowShape.lineTo(-1.25,1.04);
  const window=new T.Mesh(new T.ShapeGeometry(windowShape),glass);window.material=glass.clone();window.material.side=T.DoubleSide;window.position.z=side*1.145;car.add(window);
  box(car,-.28,1.28,side*1.16,.075,.5,.025,dark);box(car,0,.53,side*1.14,4.2,.14,.06,stripe);
  const decal=texture((c,w,h)=>{c.fillStyle=r.id==='ironhart'?'#e8e9e6':'#fff7dc';c.strokeStyle='#101924';c.lineWidth=13;c.textAlign='center';c.textBaseline='middle';c.font='italic 900 206px Arial';c.strokeText(r.number,w/2,h/2+12);c.fillText(r.number,w/2,h/2+12);});
  const number=new T.Mesh(new T.PlaneGeometry(1.53,.77),new T.MeshBasicMaterial({map:decal,transparent:true,side:T.DoubleSide}));number.position.set(-.13,.78,side*1.17);if(side<0)number.rotation.y=Math.PI;car.add(number);
  box(car,2.29,.63,side*.7,.12,.2,.45,mat('#f5e8b2',{emissive:'#d6b33b',emissiveIntensity:.2}));box(car,-2.33,.7,side*.7,.08,.12,.4,mat('#da3030'));
  for(const x of [-1.45,1.42]){const wheel=new T.Group();const tire=new T.Mesh(new T.CylinderGeometry(.47,.47,.33,16),rubber);tire.rotation.x=Math.PI/2;wheel.add(tire);const hub=new T.Mesh(new T.CylinderGeometry(.24,.24,.35,12),chrome);hub.rotation.x=Math.PI/2;wheel.add(hub);wheel.position.set(x,.47,side*1.08);car.add(wheel);wheel.castShadow=true;}
 }
 const windshield=new T.Mesh(new T.PlaneGeometry(2,.86),glass);windshield.rotation.set(-Math.PI/2,Math.PI/5,Math.PI/2);windshield.position.set(.61,1.32,0);car.add(windshield);
 // Roof and hood graphics are original fictional team marks.
 const roof=sign(car,r.number,-.34,1.77,0,1.25,1.65,r.color,'#fff7d9');roof.rotation.x=-Math.PI/2;roof.rotation.z=Math.PI/2;
 const hood=sign(car,r.sponsor,1.37,1.01,0,1.25,1.5,r.color,'#fff7d9');hood.rotation.x=-Math.PI/2;hood.rotation.z=Math.PI/2;
 box(car,-2.15,1.08,0,.18,.26,2.35,dark);box(car,2.32,.35,0,.33,.12,2.38,dark);box(car,2.35,.57,0,.045,.18,.8,dark);
 if(r.id==='prism'){['#fa4b50','#ffc635','#56d6b2','#3d9af2'].forEach((color,i)=>box(car,.7+i*.22,.98,0,.19,.035,2.16,mat(color)));}
 if(r.id==='candy'){for(let i=0;i<6;i++){const dot=new T.Mesh(new T.SphereGeometry(.15,8,6),mat(['#d62b49','#ffd03b','#4885e9'][i%3]));dot.scale.y=.15;dot.position.set(-1.7+i*.22,1.01,0);car.add(dot);}}
 const glow=new T.Mesh(new T.RingGeometry(1.35,1.65,32),new T.MeshBasicMaterial({color:r.accent,transparent:true,opacity:0,side:T.DoubleSide,depthWrite:false}));glow.rotation.x=-Math.PI/2;glow.position.y=.04;car.add(glow);
 const exhaust=new T.Mesh(new T.ConeGeometry(.35,2.6,8),new T.MeshBasicMaterial({color:r.accent,transparent:true,opacity:0,depthWrite:false}));exhaust.rotation.z=Math.PI/2;exhaust.position.set(-3.1,.5,0);car.add(exhaust);
 car.userData={glow,exhaust};return car;
}
export class SpeedwayScene{
 constructor(canvas){
  this.canvas=canvas;this.cameraMode='overview';this.selected='ironhart';this.scene=new T.Scene();this.scene.background=new T.Color('#9cb7c0');this.scene.fog=new T.Fog('#9cb7c0',1700,3600);
  this.renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;this.renderer.outputColorSpace=T.SRGBColorSpace;
  this.camera=new T.PerspectiveCamera(44,1,.1,4500);this.camera.position.set(80,630,600);this.camera.lookAt(0,0,0);
  this.scene.add(new T.HemisphereLight('#d9ecff','#617050',2.2));this.sun=new T.DirectionalLight('#fff2d3',3);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.bias=-.0003;this.sun.shadow.normalBias=.1;this.scene.add(this.sun,this.sun.target);
  const environment=new RoomEnvironment(),generator=new T.PMREMGenerator(this.renderer);this.scene.environment=generator.fromScene(environment,.04).texture;this.scene.environmentIntensity=.25;environment.dispose();generator.dispose();
  this.setTrack(makeSpeedway());this.cars=new Map(RACERS.map(r=>{const car=makeStockCar(r);this.scene.add(car);return[r.id,car];}));
  this.ready=loadCarModel().then(template=>{for(const r of RACERS){const previous=this.cars.get(r.id),car=createStockCar(template,r);this.scene.remove(previous);this.disposeObject(previous);this.scene.add(car);this.cars.set(r.id,car);}this.canvas.dataset.carModels='ready';return true;});
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas.parentElement);this.resize();this.target=new T.Vector3();this.cameraGoal=new T.Vector3();this.lastNow=0;this.basis=new T.Matrix4();
 }
 disposeObject(object){const geometries=new Set(),materials=new Set(),textures=new Set();object.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);if(m.map)textures.add(m.map);}}});for(const t of textures)t.dispose();for(const m of materials)m.dispose();for(const g of geometries)g.dispose();}
 setTrack(track){const key=JSON.stringify(track);if(this.trackKey===key)return;this.trackKey=key;this.track=track;if(this.venue){this.scene.remove(this.venue);this.disposeObject(this.venue);}this.venue=buildSpeedwayVenue(track);this.scene.add(this.venue);this.shadowKey=null;this.canvas.dataset.trackProfile=track.profile??'legacy';this.canvas.dataset.trackLength=String(track.length);}
 resize(){const{width,height}=this.canvas.parentElement.getBoundingClientRect();if(!width||!height)return;this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();}
 draw(state,race,time,now,track=race?.track??this.track){
  this.setTrack(track);const dt=this.lastNow?Math.min(.08,(now-this.lastNow)/1000):.016;this.lastNow=now;let selectedFrame;
  for(const runner of state.runners){const car=this.cars.get(runner.id);if(!car)continue;const offset=(runner.lane-(state.runners.length-1)/2)*track.laneWidth,distance=Math.min(runner.distance,track.length+8),frame=trackFrame(track,distance,offset);if(runner.id===this.selected)selectedFrame=frame;
   car.visible=true;rollWheels(car,runner.distance);const impact=race?hitReaction(race,runner.id,time):{roll:0,lift:0};car.position.set(frame.x,frame.y+.025+impact.lift,frame.z);this.basis.makeBasis(new T.Vector3(...frame.forward),new T.Vector3(...frame.up),new T.Vector3(...frame.right));car.quaternion.setFromRotationMatrix(this.basis);car.rotateX(impact.roll);
   const effects=race?activePowerEffects(race,runner.id,time):[],boost=effects.some(e=>e.kind==='boost'||e.kind==='assist'),slow=effects.some(e=>e.kind==='slow');car.userData.glow.material.opacity=boost?.65:slow?.27:runner.id===this.selected?.2:0;car.userData.glow.material.color.set(slow?'#ff664c':racerById(runner.id).accent);car.userData.exhaust.material.opacity=boost?.85:0;car.userData.exhaust.scale.y=1+Math.sin(now*.04)*.18;
  }
  const selected=state.runners.find(r=>r.id===this.selected)??state.runners[0],p=selectedFrame??trackFrame(track,selected.distance,(selected.lane-3)*track.laneWidth);
  if(this.cameraMode==='chase'){const ahead=trackPoint(track,selected.distance+10,(selected.lane-(state.runners.length-1)/2)*track.laneWidth);this.cameraGoal.set(p.x-Math.cos(p.heading)*14,p.y+6,p.z-Math.sin(p.heading)*14);this.target.set(ahead.x,ahead.y+1,ahead.z);}
  else if(this.cameraMode==='trackside'){const length=circuitLength(track),sector=Math.floor((selected.distance+track.startOffset)/length*8),anchor=(sector+.5)*length/8-track.startOffset,side=trackPoint(track,anchor,(track.banking?.width??24)/2+22);this.cameraGoal.set(side.x,side.y+9,side.z);this.target.set(p.x,p.y+1,p.z);}
  else{const bounds=this.venue.userData.bounds,tan=Math.tan(this.camera.fov*Math.PI/360),distance=Math.max(bounds.halfX/(tan*this.camera.aspect),bounds.halfZ*.85/tan)*1.22;this.cameraGoal.set(distance*.12,distance*.73,distance*.68);this.target.set(0,1,0);}
  const shadowSize=this.cameraMode==='overview'?Math.max(this.venue.userData.bounds.halfX,this.venue.userData.bounds.halfZ):90;
  if(this.shadowKey!==shadowSize){Object.assign(this.sun.shadow.camera,{left:-shadowSize,right:shadowSize,top:shadowSize,bottom:-shadowSize,near:1,far:this.cameraMode==='overview'?3500:450});this.sun.shadow.camera.updateProjectionMatrix();this.shadowKey=shadowSize;}
  if(this.cameraMode==='overview'){this.sun.position.set(-350,1000,450);this.sun.target.position.set(0,0,0);}else{this.sun.position.set(p.x-90,p.y+165,p.z+100);this.sun.target.position.set(p.x,p.y,p.z);}
  this.canvas.dataset.selectedBank=(p.bank*180/Math.PI).toFixed(2);this.camera.position.lerp(this.cameraGoal,1-Math.exp(-dt*(this.cameraMode==='chase'?8:3)));this.camera.lookAt(this.target);this.renderer.render(this.scene,this.camera);
 }
}
