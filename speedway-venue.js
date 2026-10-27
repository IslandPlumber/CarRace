import * as T from 'three';
import {trackPoint,circuitLength} from './track.js';
import {RACERS} from './roster.js';
const material=(color,extra={})=>new T.MeshStandardMaterial({color,roughness:.85,...extra});
function box(parent,x,y,z,w,h,d,mat){const m=new T.Mesh(new T.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function textSign(parent,text,x,y,z,w,h,bg='#20323b',fg='#f3e6c9'){
 const c=document.createElement('canvas');c.width=1024;c.height=128;const ctx=c.getContext('2d');ctx.fillStyle=bg;ctx.fillRect(0,0,1024,128);ctx.fillStyle=fg;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`italic 900 ${Math.min(90,1600/text.length)}px Arial`;ctx.fillText(text,512,68,980);const map=new T.CanvasTexture(c);map.colorSpace=T.SRGBColorSpace;const mesh=new T.Mesh(new T.PlaneGeometry(w,h),new T.MeshBasicMaterial({map,side:T.DoubleSide}));mesh.position.set(x,y,z);parent.add(mesh);return mesh;
}
function ribbon(parent,track,inner,outer,mat,height=.03,shape=null){
 const positions=[],uv=[],indices=[],length=circuitLength(track),count=Math.ceil(length/2);
 for(let i=0;i<=count;i++){for(const offset of[inner,outer]){const p=trackPoint(track,length*i/count,offset);positions.push(p.x,(shape?shape(p,offset):p.y)+height,p.z);uv.push(i/count,offset===inner?0:1);}if(i<count){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();const mesh=new T.Mesh(g,mat);mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function instances(parent,geometry,mat,placements){const mesh=new T.InstancedMesh(geometry,mat,placements.length),dummy=new T.Object3D();placements.forEach((p,i)=>{dummy.position.set(...p.position);dummy.rotation.set(...(p.rotation??[0,0,0]));dummy.scale.set(...(p.scale??[1,1,1]));dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);if(p.color)mesh.setColorAt(i,new T.Color(p.color));});mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
export function buildSpeedwayVenue(track){
 const venue=new T.Group();venue.name='speedway-venue';const S=track.straight,R=track.radius,home=track.shortStraight/2+R,half=(track.banking?.width??24)/2,scale=Math.min(1,S/650),length=circuitLength(track);
 const mats={grass:material('#5d795e'),asphalt:material('#343d42'),apron:material('#495258'),white:material('#dddccf'),yellow:material('#efcc46'),wall:material('#d4d6cd'),concrete:material('#9caaa7'),steel:material('#586b72',{metalness:.55}),dark:material('#23303b')};
 const floor=new T.Mesh(new T.PlaneGeometry(5000,5000),mats.grass);floor.rotation.x=-Math.PI/2;floor.position.y=-.05;floor.receiveShadow=true;venue.add(floor);
 ribbon(venue,track,-half,half,mats.asphalt);
 ribbon(venue,track,half,half+1.2,mats.asphalt);
 ribbon(venue,track,-half-(track.banking?.apron??7),-half,mats.apron,.02);
 ribbon(venue,track,-half-.13,-half+.04,mats.yellow,.075);ribbon(venue,track,-half-.55,-half-.38,mats.yellow,.075);
 ribbon(venue,track,half-.35,half-.12,mats.white,.055);
 ribbon(venue,track,half+1.1,half+40,mats.grass,.01,(p,offset)=>p.y*Math.max(0,1-(offset-half-1.1)/38.9));
 // Concrete wall, catch-fence posts, and crowd are instanced for mobile GPUs.
 const walls=[],posts=[],wallCount=Math.ceil(length/4),postCount=Math.ceil(length/12);
 for(let i=0;i<wallCount;i++){const p=trackPoint(track,length*i/wallCount,half+.55);walls.push({position:[p.x,p.y+.8,p.z],rotation:[0,-p.heading,0]});}
 instances(venue,new T.BoxGeometry(length/wallCount+.12,1.6,.48),mats.wall,walls);
 for(let i=0;i<postCount;i++){const p=trackPoint(track,length*i/postCount,half+.65);posts.push({position:[p.x,p.y+3.25,p.z]});}
 instances(venue,new T.BoxGeometry(.10,4.8,.10),mats.steel,posts);
 const fencePositions=[],fenceUV=[],fenceIndices=[],fenceCount=Math.ceil(length/5);
 for(let i=0;i<=fenceCount;i++){const p=trackPoint(track,length*i/fenceCount,half+.65);fencePositions.push(p.x,p.y+1.6,p.z,p.x,p.y+5.65,p.z);fenceUV.push(i*length/fenceCount/1.2,0,i*length/fenceCount/1.2,1);if(i<fenceCount){const n=i*2;fenceIndices.push(n,n+1,n+2,n+1,n+3,n+2);}}
 const fenceCanvas=document.createElement('canvas');fenceCanvas.width=64;fenceCanvas.height=64;const ctx=fenceCanvas.getContext('2d');ctx.strokeStyle='rgba(126,147,152,.65)';ctx.lineWidth=1;for(let i=-64;i<128;i+=12){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i+64,64);ctx.stroke();ctx.beginPath();ctx.moveTo(i,64);ctx.lineTo(i+64,0);ctx.stroke();}const fenceMap=new T.CanvasTexture(fenceCanvas);fenceMap.wrapS=T.RepeatWrapping;fenceMap.wrapT=T.RepeatWrapping;fenceMap.repeat.y=2;const fenceGeometry=new T.BufferGeometry();fenceGeometry.setAttribute('position',new T.Float32BufferAttribute(fencePositions,3));fenceGeometry.setAttribute('uv',new T.Float32BufferAttribute(fenceUV,2));fenceGeometry.setIndex(fenceIndices);fenceGeometry.computeVertexNormals();venue.add(new T.Mesh(fenceGeometry,new T.MeshBasicMaterial({map:fenceMap,transparent:true,opacity:.65,side:T.DoubleSide,depthWrite:false})));
 // Painted start/finish stripe follows the road's cross slope.
 const start=trackPoint(track,0),stripe=[];for(let i=0;i<4;i++)for(let j=0;j<24;j++){const d=(i-1.5)*.48,offset=-half+(j+.5)*half*2/24,p=trackPoint(track,d,offset);stripe.push({position:[p.x,p.y+.055,p.z],rotation:[-p.bank,-p.heading,0],color:(i+j)%2?'#ecebe0':'#202930'});}instances(venue,new T.BoxGeometry(.48,.025,half*2/24+.01),mats.white,stripe).castShadow=false;
 const grassStripes=[];for(let z=-home+35;z<home-40;z+=18*scale+6){grassStripes.push({position:[0,.005,z],scale:[Math.max(40,S*.87),.01,8*scale+3]});}instances(venue,new T.BoxGeometry(1,1,1),material('#648162'),grassStripes).castShadow=false;
 // Pit road lives inside the home straight, with tapered entry and exit.
 const pitZ=home-half-18,pitHalf=S*.46,pitShape=new T.Shape();pitShape.moveTo(-pitHalf-30*scale,-(home-half-3));pitShape.lineTo(-pitHalf,-(pitZ-5));pitShape.lineTo(pitHalf,-(pitZ-5));pitShape.lineTo(pitHalf+30*scale,-(home-half-3));pitShape.lineTo(pitHalf+10*scale,-(home-half-3));pitShape.lineTo(pitHalf-15*scale,-(pitZ+5));pitShape.lineTo(-pitHalf+15*scale,-(pitZ+5));pitShape.lineTo(-pitHalf-10*scale,-(home-half-3));pitShape.closePath();const pit=new T.Mesh(new T.ShapeGeometry(pitShape),mats.asphalt);pit.rotation.x=-Math.PI/2;pit.position.y=.045;pit.receiveShadow=true;venue.add(pit);
 const garageZ=pitZ-24*scale-5;for(let i=0;i<7;i++){const x=(i-3)*46*scale,width=Math.max(7,37*scale),height=4+2*scale,paint=material(RACERS[i].color);box(venue,x,height/2,garageZ,width,height,12*scale+3,mats.concrete);box(venue,x,height+.1,garageZ,width+1,.35,13*scale+3,paint);box(venue,x,1.6,garageZ+(6*scale+1.52),width*.65,3,.08,mats.dark);textSign(venue,RACERS[i].sponsor,x,height-.65,garageZ+6*scale+1.58,width*.7,1, RACERS[i].color);box(venue,x,1.4,garageZ-18*scale-4,12*scale+3,2.8,3.4,mats.white);box(venue,x+9*scale,1.2,garageZ-18*scale-4,3.5,2.4,3.4,paint);box(venue,x,.08,pitZ,width*.65,.1,6,paint);}
 box(venue,0,7,garageZ-44*scale-12,Math.max(32,S*.30),14,14*scale+5,mats.dark);box(venue,0,14.3,garageZ-44*scale-12,Math.max(34,S*.31),.5,15*scale+6,mats.concrete);textSign(venue,'STREAKCHAT MOTOR SPEEDWAY',0,10,garageZ-37*scale-9,Math.max(27,S*.27),3);
 const logo=textSign(venue,'S T R E A K C H A T',0,.09,-home*.10,Math.max(45,S*.45),Math.max(8,15*scale),'#5d795e','#d0d2b5');logo.rotation.x=-Math.PI/2;
 const grandLength=Math.max(100,S*.96),grandRows=track.banking?16:7,crowd=[];for(const side of[-1,1]){const z=side*(home+half+31),blocks=3,blockWidth=grandLength/blocks-5;
  for(let block=0;block<blocks;block++){const x=(block-1)*grandLength/blocks;box(venue,x,2,z,blockWidth,4,12,mats.concrete);for(let row=0;row<grandRows;row++){const yy=4+row*.65,zz=z+side*row*1.55;box(venue,x,yy,zz,blockWidth,.38,1.5,row%3===0?material('#7d4b43'):mats.concrete);const people=Math.floor(blockWidth/2.0);for(let c=0;c<people;c++){const seed=c*29+row*19+block*13;crowd.push({position:[x-blockWidth/2+1+c*2,yy+.6,zz],color:['#d8c7a1','#b15f43','#344e77','#e1dfcd','#687952'][seed%5]});}}
   const roofY=grandRows*.65+5.5,roofZ=z+side*(grandRows*.8+2);box(venue,x,roofY,roofZ,blockWidth+2,.35,grandRows*1.6,material('#d8d3bb'));for(const xx of[x-blockWidth*.45,x+blockWidth*.45])box(venue,xx,roofY/2,roofZ+side*5,.5,roofY,.5,mats.steel);
  }
 }
 instances(venue,new T.BoxGeometry(.46,.66,.46),material('#cabda5'),crowd).castShadow=false;
 const towers=[];for(const x of[-S*.48,0,S*.48])for(const z of[-home-45,home+45]){box(venue,x,18,z,.7,36,.7,mats.steel);box(venue,x,35,z,11,2,.8,mats.concrete);for(let i=0;i<5;i++)towers.push({position:[x-4+i*2,35,z+(z>0?-1:1)*.5]});}instances(venue,new T.BoxGeometry(1.5,1.4,.2),mats.white,towers);
 const pylonX=S/2+R+30;box(venue,pylonX,14,0,1.5,28,1.5,mats.steel);box(venue,pylonX,28,0,10,20,3,mats.dark);textSign(venue,'LAP',pylonX,34,1.55,8,3);textSign(venue,'01',pylonX,27,1.55,8,7,'#20323b','#ffd07d');
 const trees=[],leaves=[];for(let i=0;i<100;i++){const x=Math.sin(i*7.13)*(S/2+R+180),z=Math.cos(i*6.3)*(home+220);if(Math.abs(x)<S/2+R+65&&Math.abs(z)<home+90)continue;trees.push({position:[x,4,z]});leaves.push({position:[x,10,z],color:i%2?'#345b48':'#3f654e'});}instances(venue,new T.BoxGeometry(1.1,8,1.1),material('#6b5943'),trees);instances(venue,new T.ConeGeometry(5,14,7),mats.grass,leaves);
 venue.userData.bounds={halfX:S/2+R+65,halfZ:home+90};return venue;
}
