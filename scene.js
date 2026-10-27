import * as T from 'three';
import {makeCircuit,trackPoint,circuitLength} from './track.js';
import {RACERS,racerById} from './roster.js';
import {activePowerEffects,hitReaction} from './powers.js';

function texture(draw,w=512,h=256){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;t.anisotropy=4;return t;}
const mat=(color,extra={})=>new T.MeshStandardMaterial({color,roughness:.68,...extra});
function box(parent,x,y,z,sx,sy,sz,material){const m=new T.Mesh(new T.BoxGeometry(sx,sy,sz),material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function sign(parent,text,x,y,z,width,height,bg='#17252c',fg='#eee4c8'){
 const t=texture((c,w,h)=>{c.fillStyle=bg;c.fillRect(0,0,w,h);c.fillStyle=fg;c.textAlign='center';c.textBaseline='middle';c.font=`italic 900 ${Math.min(110,800/text.length)}px Arial`;c.fillText(text,w/2,h/2,w-30);});
 const p=new T.Mesh(new T.PlaneGeometry(width,height),new T.MeshBasicMaterial({map:t,side:T.DoubleSide}));p.position.set(x,y,z);parent.add(p);return p;
}
function ribbon(parent,track,inner,outer,material,height=.04){
 const positions=[],uv=[],indices=[],count=400,len=circuitLength(track);
 for(let i=0;i<=count;i++){for(const offset of [inner,outer]){const p=trackPoint(track,len*i/count,offset);positions.push(p.x,height,p.z);uv.push(i/count,offset===inner?0:1);}if(i<count){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();const m=new T.Mesh(g,material);m.receiveShadow=true;parent.add(m);return m;
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
  this.canvas=canvas;this.track=makeCircuit();this.cameraMode='overview';this.selected='ironhart';this.scene=new T.Scene();this.scene.background=new T.Color('#a8bec3');this.scene.fog=new T.Fog('#a8bec3',220,470);
  this.renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;this.renderer.outputColorSpace=T.SRGBColorSpace;
  this.camera=new T.PerspectiveCamera(44,1,.1,700);this.camera.position.set(115,137,151);this.camera.lookAt(0,0,0);
  this.scene.add(new T.HemisphereLight('#d9ecff','#617050',2.6));const sun=new T.DirectionalLight('#fff2d3',3.5);sun.position.set(-70,130,70);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-120,right:120,top:110,bottom:-110,near:1,far:330});sun.shadow.bias=-.0003;sun.shadow.normalBias=.12;this.scene.add(sun);
  this.buildVenue();this.cars=new Map(RACERS.map(r=>{const car=makeStockCar(r);this.scene.add(car);return[r.id,car];}));
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas.parentElement);this.resize();this.target=new T.Vector3();this.cameraGoal=new T.Vector3();this.lastNow=0;
 }
 resize(){const {width,height}=this.canvas.parentElement.getBoundingClientRect();this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();}
 buildVenue(){
  const s=this.scene,t=this.track,grass=mat('#72947a'),asphalt=mat('#3d484d',{roughness:.96}),white=mat('#e8e6d8'),orange=mat('#e97e3c'),concrete=mat('#bbc1b6'),dark=mat('#263c43'),steel=mat('#889b99');
  const floor=new T.Mesh(new T.PlaneGeometry(1100,1100),grass);floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;s.add(floor);
  ribbon(s,t,-12,12,asphalt);ribbon(s,t,-12.7,-12.1,white,.06);ribbon(s,t,12.1,12.65,white,.06);ribbon(s,t,-14,-12.8,concrete,.055);ribbon(s,t,-19,-16,asphalt,.06);
  // Concrete retaining wall and the catch fence follow the same circuit as the cars.
  const length=circuitLength(t);
  for(let i=0;i<150;i++){const p=trackPoint(t,length*i/150,13.1),wall=box(s,p.x,.7,p.z,length/150+.13,1.4,.6,i%8<4?white:orange);wall.rotation.y=-p.heading;}
  for(let i=0;i<75;i++){const p=trackPoint(t,length*i/75,13.55),post=box(s,p.x,2.5,p.z,.13,4.5,.13,steel);post.castShadow=false;}
  ribbon(s,t,13.48,13.65,steel,3.9);
  for(let i=0;i<95;i++){const p=trackPoint(t,length*i/95,-11.4),kerb=box(s,p.x,.07,p.z,length/95*.92,.11,.6,i%2?orange:white);kerb.rotation.y=-p.heading;}
  const start=trackPoint(t,0,0);for(let i=0;i<4;i++)for(let j=0;j<24;j++){const m=box(s,start.x+i*.48,.09,start.z-11.5+j,.48,.06,1,(i+j)%2?dark:white);m.castShadow=false;}
  // Grid boxes remain visible while drivers stage under the starting lights.
  for(let i=0;i<7;i++){const p=trackPoint(t,0,(i-3)*2.4);const grid=box(s,p.x-3,.095,p.z,.14,.04,1.8,white);grid.castShadow=false;}
  for(const z of [-67,69]){
   box(s,0,1.9,z,108,3.8,11,concrete);
   for(let row=0;row<6;row++){box(s,0,4+row*.8,z+(z<0?-1:1)*row*1.15,107,.5,1.25,row%2?mat('#8d493f'):mat('#d1c7ae'));}
   const roof=box(s,0,11,z+(z<0?-6:6),112,.35,13,mat('#e5d9bb'));roof.rotation.x=z<0?.08:-.08;
   for(const x of [-51,-25,0,25,51])box(s,x,8,z+(z<0?-9:9),.35,7,.35,steel);
   const count=380,crowd=new T.InstancedMesh(new T.BoxGeometry(.48,.73,.48),mat('#c5b0a0'),count),dummy=new T.Object3D();let seed=10;for(let i=0;i<count;i++){seed=(seed*16807)%2147483647;dummy.position.set(-51+(i%76)*1.35,4.7+Math.floor(i/76)*.8,z+(z<0?-1:1)*Math.floor(i/76)*1.15);dummy.updateMatrix();crowd.setMatrixAt(i,dummy.matrix);crowd.setColorAt(i,new T.Color(['#df754e','#435c83','#dfcda3','#e9e7d3','#66754a'][seed%5]));}s.add(crowd);
  }
  // Pit road, garages, transporters, and infield signage.
  for(let i=0;i<7;i++){const x=-42+i*14;box(s,x,2.5,-7,12,5,9,mat('#d5cbbb'));box(s,x,5.1,-7,12.7,.45,9.6,mat(RACERS[i].color));box(s,x,1.5,-2.45,8,3,.1,dark);sign(s,RACERS[i].sponsor,x,4,-2.37,8,1.1,RACERS[i].color);box(s,x,1.5,8,8.7,3,3,white);box(s,x+5,1,8,2,2,3,mat(RACERS[i].color));}
  box(s,0,4,-23,29,8,7,dark);box(s,0,8.15,-23,31,.4,8,concrete);const board=sign(s,'STREAKCHAT SPEEDWAY',0,6,-19.35,27,2.5,'#1d343a','#ffe2ab');
  sign(s,'C A R R A C E',0,.15,20,44,8,'#72947a','#e3dfc5').rotation.x=-Math.PI/2;
  for(const x of [-85,85])for(const z of [-48,49]){box(s,x,12,z,.5,24,.5,steel);box(s,x,23.3,z,8,1.7,.7,concrete);for(let i=0;i<4;i++)box(s,x-3+i*2,23.3,z+.45,1.5,1.2,.1,white);}
  for(let i=0;i<34;i++){const x=Math.sin(i*7.13)*160,z=Math.cos(i*6.3)*160;if(Math.abs(x)<100&&Math.abs(z)<94)continue;const trunk=box(s,x,3,z,.8,6,.8,mat('#796347'));for(let j=0;j<2;j++){const canopy=new T.Mesh(new T.ConeGeometry(3.8-j,8,7),mat(i%2?'#416b5c':'#567d61'));canopy.position.set(x,7+j*3,z);canopy.castShadow=true;s.add(canopy);}}
  for(let i=0;i<9;i++){const building=box(s,-160+i*40,5+(i%3)*4,-155,20,10+(i%3)*8,18,mat('#91aaa6'));building.castShadow=false;}
  // Speedway scoring pylon.
  box(s,91,8,0,1,16,1,steel);box(s,91,18,0,6,13,2,dark);sign(s,'LAPS',91,22,1.05,5,2,'#263c43','#e8d9b3');sign(s,'01',91,17.5,1.05,4.5,5,'#263c43','#ffb451');
 }
 draw(state,race,time,now){
  const dt=this.lastNow?Math.min(.08,(now-this.lastNow)/1000):.016;this.lastNow=now;
  for(const runner of state.runners){const car=this.cars.get(runner.id);if(!car)continue;car.visible=true;const impact=race?hitReaction(race,runner.id,time):{roll:0,lift:0};car.position.set(runner.x,.05+impact.lift,runner.z);car.rotation.set(impact.roll,-runner.heading,0);const effects=race?activePowerEffects(race,runner.id,time):[];const boost=effects.some(e=>e.kind==='boost'||e.kind==='assist'),slow=effects.some(e=>e.kind==='slow');car.userData.glow.material.opacity=boost?.65:slow?.27:runner.id===this.selected?.2:0;car.userData.glow.material.color.set(slow?'#ff664c':racerById(runner.id).accent);car.userData.exhaust.material.opacity=boost?.85:0;car.userData.exhaust.scale.y=1+Math.sin(now*.04)*.18;}
  const selected=state.runners.find(r=>r.id===this.selected)??state.runners[0];
  if(this.cameraMode==='chase'&&selected){this.cameraGoal.set(selected.x-Math.cos(selected.heading)*13,8,selected.z-Math.sin(selected.heading)*13);this.target.set(selected.x+Math.cos(selected.heading)*9,1,selected.z+Math.sin(selected.heading)*9);}
  else if(this.cameraMode==='trackside'&&selected){this.cameraGoal.set(100,10,65);this.target.set(selected.x,1,selected.z);}
  else {const portrait=this.camera.aspect<1.25;this.cameraGoal.set(portrait?148:111,portrait?170:143,portrait?193:145);this.target.set(0,0,0);}
  this.camera.position.lerp(this.cameraGoal,1-Math.exp(-dt*3));this.camera.lookAt(this.target);this.renderer.render(this.scene,this.camera);
 }
}
