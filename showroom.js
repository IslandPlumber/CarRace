import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {loadCarModel,createStockCar} from './car-model.js';
import {racerById} from './roster.js';
export class CarShowroom{
 constructor(canvas){
  this.canvas=canvas;this.scene=new T.Scene();this.scene.background=new T.Color('#171d24');this.renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.1;this.renderer.outputColorSpace=T.SRGBColorSpace;
  const room=new RoomEnvironment(),generator=new T.PMREMGenerator(this.renderer);this.scene.environment=generator.fromScene(room,.025).texture;this.scene.environmentIntensity=.35;room.dispose();generator.dispose();
  this.camera=new T.PerspectiveCamera(35,1,.1,80);this.camera.position.set(5.3,2.8,5.9);this.controls=new OrbitControls(this.camera,canvas);this.controls.target.set(0,.65,0);this.controls.enablePan=false;this.controls.enableDamping=true;this.controls.minDistance=5.1;this.controls.maxDistance=13;this.controls.minPolarAngle=.18;this.controls.maxPolarAngle=Math.PI/2-.03;this.controls.autoRotate=!matchMedia('(prefers-reduced-motion: reduce)').matches;this.controls.autoRotateSpeed=.65;this.controls.addEventListener('start',()=>{this.controls.autoRotate=false;});
  this.scene.add(new T.HemisphereLight('#d2e7ff','#3c424e',2));
  for(const[x,y,z,power,color]of[[4,8,3,110,'#fff1d4'],[-5,5,-4,75,'#a9cbff']]){const light=new T.SpotLight(color,power,40,.65,.7,1);light.position.set(x,y,z);light.target.position.set(0,.5,0);light.castShadow=true;light.shadow.mapSize.set(1024,1024);this.scene.add(light,light.target);}
  const platform=new T.Mesh(new T.CylinderGeometry(3.5,3.6,.14,96),new T.MeshStandardMaterial({color:'#282e36',metalness:.45,roughness:.42}));platform.position.y=-.09;platform.receiveShadow=true;this.scene.add(platform);
  const ring=new T.Mesh(new T.TorusGeometry(3.45,.018,8,96),new T.MeshBasicMaterial({color:'#fbb14b'}));ring.rotation.x=Math.PI/2;ring.position.y=-.005;this.scene.add(ring);
  const floor=new T.Mesh(new T.PlaneGeometry(120,120),new T.MeshStandardMaterial({color:'#171d24',roughness:.72}));floor.rotation.x=-Math.PI/2;floor.position.y=-.17;floor.receiveShadow=true;this.scene.add(floor);
  this.cache=new Map();this.pendingId='ironhart';this.ready=loadCarModel().then(template=>{this.template=template;this.setRacer(this.pendingId);this.canvas.dataset.modelLoaded='ready';});
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas.parentElement);this.resize();
 }
 resize(){const r=this.canvas.parentElement.getBoundingClientRect();if(r.width<1||r.height<1)return;this.renderer.setSize(r.width,r.height,false);this.camera.aspect=r.width/r.height;this.camera.updateProjectionMatrix();}
 setRacer(id){this.pendingId=id;if(!this.template)return;if(this.car)this.scene.remove(this.car);if(!this.cache.has(id))this.cache.set(id,createStockCar(this.template,racerById(id)));this.car=this.cache.get(id);this.car.userData.glow.visible=false;this.car.userData.exhaust.visible=false;this.scene.add(this.car);this.canvas.dataset.driver=id;}
 draw(){this.controls.update();this.renderer.render(this.scene,this.camera);}
}
