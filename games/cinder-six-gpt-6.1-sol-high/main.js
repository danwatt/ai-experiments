import * as THREE from './vendor/three.module.js';
import {CELL, rooms, links, keyOf, cellAt, createLevel, enemySpawns, pickupSpawns} from './level.js';

const $=id=>document.getElementById(id);
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const clamp=THREE.MathUtils.clamp;
const {cells,doors}=createLevel();
const renderer=new THREE.WebGLRenderer({canvas:$('world'),antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));
renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.35;
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x071117);
scene.fog=new THREE.FogExp2(0x08171c,.0058);
const camera=new THREE.PerspectiveCamera(78,innerWidth/innerHeight,.08,340);
scene.add(camera);
scene.add(new THREE.HemisphereLight(0xb6d8df,0x283039,2.1));
const sunlight=new THREE.DirectionalLight(0xb5cfd5,1.7);sunlight.position.set(2,7,4);scene.add(sunlight);
const headlight=new THREE.PointLight(0xd0f2e8,65,65,1.35);camera.add(headlight);
const roomLights=Array.from({length:4},()=>{const l=new THREE.PointLight(0xffffff,70,58,1.5);scene.add(l);return l;});
const state={mode:'menu',started:false,health:100,energy:100,key:false,plasma:false,weapon:1,reactor:400,meltdown:0,time:0,kills:0,room:0,visitedRooms:new Set([0]),shot:0,damage:0,hit:0,toast:0,discover:0,boost:false,won:false};
const player={p:V(0,0,9),q:new THREE.Quaternion(),v:V()};
const keys=new Set();
const enemies=[],pickups=[],bullets=[],effects=[],colliders=[];
let frameTime=performance.now(),worldTime=0,menuTime=0,sensitivity=1,invert=false,muted=false,audio;

function material(color,emissive=0,metalness=.65,roughness=.62){return new THREE.MeshStandardMaterial({color,emissive,emissiveIntensity:.8,metalness,roughness});}
const mats={steel:material(0x253a43),dark:material(0x111b23),edge:material(0x52666c),cyan:material(0x91efdc,0x4d9d91),orange:material(0xff8753,0xcc431c),pink:material(0xc585df,0x8c2aaf)};
function mesh(geo,mat,parent=scene,pos){const o=new THREE.Mesh(geo,mat);if(pos)o.position.copy(pos);parent.add(o);return o;}
function box(size,mat,parent=scene,pos){return mesh(new THREE.BoxGeometry(...size),mat,parent,pos);}
function glow(color){return new THREE.MeshBasicMaterial({color,toneMapped:false});}
const glowMats={cyan:glow(0x8af5e0),orange:glow(0xff824e),red:glow(0xff4055),green:glow(0x83ffc2),purple:glow(0xe590ff)};

// A locally generated panel texture keeps the demo self-contained.
function panelTexture(floor=false){
  const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');
  x.fillStyle=floor?'#3d4b50':'#536268';x.fillRect(0,0,256,256);
  x.strokeStyle='#17232a';x.lineWidth=5;x.strokeRect(3,3,250,250);
  x.strokeStyle='#82908f';x.lineWidth=1;x.strokeRect(9,9,238,238);
  x.fillStyle='#27373e';x.fillRect(18,18,220,5);x.fillRect(18,233,220,5);
  x.strokeStyle='#38484d';x.lineWidth=2;
  for(let k=0;k<7;k++){const y=45+k*24;x.beginPath();x.moveTo(24,y);x.lineTo(232,y);x.stroke();}
  if(floor){x.strokeStyle='#213039';x.lineWidth=4;for(let k=-256;k<256;k+=20){x.beginPath();x.moveTo(k,0);x.lineTo(k+256,256);x.stroke();}}
  x.fillStyle='#a1aba7';for(const a of [17,239])for(const b of [17,239]){x.beginPath();x.arc(a,b,2.5,0,Math.PI*2);x.fill();}
  x.fillStyle='#72807f';x.font='8px monospace';x.fillText(floor?'LOAD / 060':'CS-06 / PRESSURE HULL',29,225);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=renderer.capabilities.getMaxAnisotropy();return t;
}
const wallTex=panelTexture(),floorTex=panelTexture(true);
const wallMaterials=rooms.flatMap(r=>[false,true].map(floor=>new THREE.MeshStandardMaterial({map:floor?floorTex:wallTex,color:new THREE.Color(r.color).lerp(new THREE.Color(0xc2cfcd),.64),metalness:.6,roughness:.78,side:THREE.DoubleSide})));
const faces=[{n:[1,0,0],u:[0,0,1],v:[0,1,0]},{n:[-1,0,0],u:[0,0,-1],v:[0,1,0]},{n:[0,1,0],u:[1,0,0],v:[0,0,1]},{n:[0,-1,0],u:[1,0,0],v:[0,0,-1]},{n:[0,0,1],u:[-1,0,0],v:[0,1,0]},{n:[0,0,-1],u:[1,0,0],v:[0,1,0]}];
const buffers=wallMaterials.map(()=>({p:[],n:[],uv:[]}));
const lavaUniforms={time:{value:0}};
const lavaMat=new THREE.ShaderMaterial({uniforms:lavaUniforms,side:THREE.DoubleSide,vertexShader:`varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`varying vec2 vUv;uniform float time;void main(){vec2 p=vUv*20.;float a=sin(p.x+sin(p.y*1.4+time*.6)*1.5+time*.4);float b=cos(p.y*1.8+sin(p.x*.7-time*.3)*2.);float veins=pow(1.-abs(sin(a*2.+b*1.8)),4.);vec3 c=mix(vec3(.28,.025,.005),vec3(1.,.29,.025),.35+.65*veins);c+=vec3(.2,.018,0.)*(.5+.5*sin(p.x*3.+p.y*2.+time));gl_FragColor=vec4(c,1.);}`});
for(const c of cells.values())for(const f of faces){
  if(cells.has(keyOf(c.x+f.n[0],c.y+f.n[1],c.z+f.n[2])))continue;
  if(rooms[c.room].lava&&f.n[1]===-1){const m=mesh(new THREE.PlaneGeometry(CELL,CELL),lavaMat);m.rotation.x=-Math.PI/2;m.position.set(c.x*CELL,c.y*CELL-5.97,c.z*CELL);continue;}
  const b=buffers[c.room*2+(f.n[1]===-1?1:0)];
  const corners=[[-1,-1],[1,-1],[1,1],[-1,1]],uvs=[[0,0],[1,0],[1,1],[0,1]];
  for(const i of [0,1,2,0,2,3]){const [u,v]=corners[i];for(let a=0;a<3;a++){b.p.push([c.x,c.y,c.z][a]*CELL+f.n[a]*6+f.u[a]*u*6+f.v[a]*v*6);b.n.push(-f.n[a]);}b.uv.push(...uvs[i]);}
}
buffers.forEach((b,i)=>{if(!b.p.length)return;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(b.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(b.n,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(b.uv,2));mesh(g,wallMaterials[i]);});

function labelTexture(title,sub,color='#91e8dd'){
  const c=document.createElement('canvas');c.width=1024;c.height=256;const x=c.getContext('2d');
  x.fillStyle='#0c1a20';x.fillRect(0,0,1024,256);x.strokeStyle=color;x.lineWidth=5;x.strokeRect(5,5,1014,246);
  x.fillStyle=color;x.fillRect(28,28,8,200);x.font='bold 65px monospace';x.fillText(title.toUpperCase(),65,108);x.fillStyle='#a7b9ba';x.font='27px monospace';x.fillText(sub.toUpperCase(),68,177);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshBasicMaterial({map:t,side:THREE.DoubleSide});
}
function sign(title,sub,p,normal,width=10,color){const o=mesh(new THREE.PlaneGeometry(width,width/4),labelTexture(title,sub,color));o.position.copy(p);o.quaternion.setFromUnitVectors(V(0,0,1),normal);return o;}
// Architectural ribs, light rails, destination signs and cargo recesses.
rooms.forEach((r,i)=>{
  const center=V(...r.c).multiplyScalar(CELL),accent=glow(r.color);
  for(const sx of [-1,1])for(const sz of [-1,1]){
    box([.45,35,.45],mats.edge,scene,center.clone().add(V(sx*17.7,0,sz*17.7)));
    box([.16,23,.2],accent,scene,center.clone().add(V(sx*17.42,0,sz*17.45)));
  }
  for(const y of [-17.65,17.65])for(const side of [-1,1]){
    box([35,.4,.4],mats.edge,scene,center.clone().add(V(0,y,side*17.7)));
    box([11,.12,.24],accent,scene,center.clone().add(V(0,y-.23,side*17.35)));
  }
  sign(`${r.tag} / ${r.name}`,i===3?'thermal hazard / red access':i===11?'primary energy core':'cinder mining / sector 06',center.clone().add(V(0,14,-17.87)),V(0,0,1),15,i===3?'#ff8053':undefined);
  if(![0,3,11,13].includes(i))for(const sx of [-1,1]){
    const crate=box([5,5,5],mats.steel,scene,center.clone().add(V(sx*13,-14,12)));
    colliders.push({min:crate.position.clone().addScalar(-2.5),max:crate.position.clone().addScalar(2.5)});
    box([4.7,.2,5.05],mats.edge,scene,crate.position.clone().add(V(0,1.5,0)));
    box([.2,4.7,5.06],mats.edge,scene,crate.position.clone());
  }
});
for(const [a,b,type] of links){
  const ca=V(...rooms[a].c).multiplyScalar(CELL),cb=V(...rooms[b].c).multiplyScalar(CELL),d=cb.clone().sub(ca).normalize();
  for(const [from,to,dir] of [[a,b,d],[b,a,d.clone().negate()]]){
    const p=V(...rooms[from].c).multiplyScalar(CELL).addScaledVector(dir,17.85);
    if(!dir.y){p.y+=9;sign(`→ ${rooms[to].name}`,type==='red'?'red access required':type?'F / open bulkhead':'transit passage',p,dir.clone().negate(),10,type==='red'?'#ff6576':undefined);}
    else {sign(dir.y>0?'↑ ASCENT SHAFT':'↓ LOWER DECK','vertical transit',V(...rooms[from].c).multiplyScalar(CELL).add(V(0,dir.y*10,-17.8)),V(0,0,1),11);}
  }
}
for(const c of cells.values())if(c.corridor){const accent=glow(rooms[c.room].color);box([.16,.1,8],accent,scene,V(c.x*CELL-4.5,c.y*CELL+5.8,c.z*CELL));box([.16,.1,8],accent,scene,V(c.x*CELL+4.5,c.y*CELL+5.8,c.z*CELL));}

for(const d of doors){
  const g=new THREE.Group();g.position.set(...d.p);if(d.axis===0)g.rotation.y=Math.PI/2;scene.add(g);d.group=g;d.panels=[];
  const doorMat=material(d.type==='red'?0x6b2936:0x344a52,d.type==='red'?0x200208:0x061719);
  for(const side of [-1,1]){
    const p=box([5.9,11.8,1],doorMat,g,V(side*3,0,0));d.panels.push({mesh:p,side});
    box([.1,10,.06],d.type==='red'?glowMats.red:glowMats.cyan,p,V(-side*2.55,0,.54));
    box([.1,10,.06],d.type==='red'?glowMats.red:glowMats.cyan,p,V(-side*2.55,0,-.54));
    for(const y of [-3,3])box([4.4,.15,1.05],mats.edge,p,V(0,y,0));
  }
  for(const side of [-1,1]){box([.35,12,.8],mats.edge,g,V(side*5.9,0,0));box([12,.35,.8],mats.edge,g,V(0,side*5.9,0));}
  for(const side of [-1,1]){const s=sign(d.type==='red'?'RED ACCESS':'BULKHEAD',d.type==='red'?'key required':'F / open',V(),V(0,0,side),5,d.type==='red'?'#ff6576':undefined);g.add(s);s.position.set(0,0,side*.57);}
}

// Reactor and exit are physical targets in the final three chambers.
const reactor=new THREE.Group();reactor.position.copy(V(...rooms[11].c).multiplyScalar(CELL));scene.add(reactor);
const core=mesh(new THREE.IcosahedronGeometry(3.3,1),material(0xffad69,0xff461e,.15,.2),reactor);
const coreLight=new THREE.PointLight(0xff582b,230,43,1.4);reactor.add(coreLight);
const rings=[];
for(const r of [5.2,6.5]){const o=mesh(new THREE.TorusGeometry(r,.24,8,64),mats.edge,reactor);o.rotation.x=r===5.2?Math.PI/3:-Math.PI/3;rings.push(o);}
for(const y of [-13,13]){box([8,2,8],mats.steel,reactor,V(0,y,0));box([1.2,8,1.2],mats.orange,reactor,V(0,y>0?8:-8,0));}
const exitCenter=V(...rooms[13].c).multiplyScalar(CELL);
const exitRing=mesh(new THREE.TorusGeometry(7,.6,8,64),glowMats.green,scene,exitCenter.clone().add(V(-8,0,0)));exitRing.rotation.y=Math.PI/2;
sign('EXTRACTION','destroy reactor to activate',exitCenter.clone().add(V(-17.8,10,0)),V(1,0,0),12,'#8fffc2');
const exitLight=new THREE.PointLight(0x6affb3,160,36,1.4);exitLight.position.copy(exitRing.position);scene.add(exitLight);
const escapeMarkers=[];
for(const [a,b] of [[11,12],[12,13]]){
  const p=V(...rooms[a].c).multiplyScalar(CELL),q=V(...rooms[b].c).multiplyScalar(CELL),d=q.clone().sub(p),length=d.length();
  for(let t=12;t<length;t+=12){const g=new THREE.Group();g.position.copy(p).addScaledVector(d,t/length);g.quaternion.setFromUnitVectors(V(0,0,-1),d.clone().normalize());for(const s of [-1,1]){const m=box([.16,.16,2],glowMats.green,g,V(s*.6,-3.5,0));m.rotation.y=s*-.6;}g.visible=false;scene.add(g);escapeMarkers.push(g);}
}

function makeEnemy(type,p,room){
  const g=new THREE.Group();g.position.copy(p);scene.add(g);
  const info={scout:{hp:46,size:1.5,speed:7,color:0x7cefdc,damage:7},sentry:{hp:85,size:2,speed:3.3,color:0xffa268,damage:9},brute:{hp:180,size:2.7,speed:2.6,color:0xdf94ef,damage:17}}[type];
  const color=glow(info.color);let body;
  if(type==='scout'){
    body=mesh(new THREE.OctahedronGeometry(1.5),mats.steel,g);body.scale.set(1,.65,1.3);
    for(const s of [-1,1]){box([2.1,.22,.9],mats.edge,g,V(s*1.65,0,.2));mesh(new THREE.SphereGeometry(.3,8,6),color,g,V(s*2.4,0,.25));}
  }else if(type==='sentry'){
    body=box([2.4,2.3,2.2],mats.steel,g);for(const s of [-1,1]){const t=mesh(new THREE.CylinderGeometry(.65,.65,3,8),mats.edge,g,V(s*1.8,0,0));t.rotation.x=Math.PI/2;box([.8,.4,.15],color,g,V(s*1.8,0,-1.55));}
    const ring=mesh(new THREE.TorusGeometry(2.8,.12,6,24),color,g);ring.rotation.x=Math.PI/2;
  }else{
    body=mesh(new THREE.DodecahedronGeometry(2.5),mats.dark,g);for(const s of [-1,1]){box([1.5,3,2.7],mats.edge,g,V(s*2,0,0));box([.5,2.2,.1],color,g,V(s*2,0,-1.4));}mesh(new THREE.TorusGeometry(1.5,.22,6,20),color,g,V(0,0,-1.9));
  }
  const eye=mesh(new THREE.SphereGeometry(type==='brute'?.7:.4,12,8),color,g,V(0,0,-info.size*.78));
  const e={type,g,body,eye,room,...info,maxHp:info.hp,home:p.clone(),cool:1+Math.random()*2,phase:Math.random()*6,alive:true,flash:0};enemies.push(e);return e;
}
enemySpawns.forEach(([room,type,offset])=>makeEnemy(type,V(...rooms[room].c).multiplyScalar(CELL).add(V(...offset)),room));
for(const spawn of pickupSpawns){
  const p=V(...rooms[spawn.room].c).multiplyScalar(CELL).add(V(...spawn.offset)),g=new THREE.Group();g.position.copy(p);scene.add(g);
  const mat=spawn.type==='key'?glowMats.red:spawn.type==='weapon'?glowMats.purple:glowMats.green;
  if(spawn.type==='key'){mesh(new THREE.OctahedronGeometry(1.2),mat,g);box([.3,1.6,.3],mat,g,V(0,-1.7,0));box([1,.3,.3],mat,g,V(.3,-2.25,0));}
  else if(spawn.type==='health'){box([1.8,.55,.55],mat,g);box([.55,1.8,.55],mat,g);}
  else{box([.6,.7,3],mats.edge,g);for(const s of [-1,1])box([.4,.5,2.5],mat,g,V(s*.6,0,-.7));}
  const ring=mesh(new THREE.TorusGeometry(2,.045,5,32),mat,g);ring.rotation.x=Math.PI/2;
  pickups.push({...spawn,g,base:p.clone(),alive:true});
}

// Ship guns are camera-relative, retaining full roll and pitch.
const gun=new THREE.Group();camera.add(gun);
for(const side of [-1,1]){
  const pod=new THREE.Group();pod.position.set(side*.68,-.75,-1.5);gun.add(pod);
  const body=box([.19,.2,.9],mats.steel,pod);body.rotation.x=-.09;
  box([.12,.05,.7],mats.edge,pod,V(0,.11,-.1));box([.04,.025,.4],glowMats.cyan,pod,V(0,.15,-.2));
  box([.22,.23,.12],mats.dark,pod,V(0,0,-.47));
}

// Batch the immovable ribs, crates and light rails by surface, instead of
// issuing a separate GPU draw for every small architectural detail.
scene.updateMatrixWorld(true);
const staticBatches=new Map();
for(const o of [...scene.children]){
  if(!o.isMesh||o.geometry.type!=='BoxGeometry')continue;
  const m=o.material,k=[m.type,m.color.getHex(),m.emissive?.getHex(),m.metalness,m.roughness].join('/');
  if(!staticBatches.has(k))staticBatches.set(k,{material:m,p:[],n:[],uv:[]});
  const b=staticBatches.get(k),g=o.geometry.toNonIndexed();g.applyMatrix4(o.matrixWorld);
  b.p.push(...g.attributes.position.array);b.n.push(...g.attributes.normal.array);b.uv.push(...g.attributes.uv.array);
  scene.remove(o);o.geometry.dispose();g.dispose();
}
for(const b of staticBatches.values()){
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(b.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(b.n,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(b.uv,2));mesh(g,b.material);
}

function cellFor(p){const [x,y,z]=cellAt(p.toArray());return cells.get(keyOf(x,y,z));}
function doorBlocked(c){return c?.door&&!c.door.open;}
function fits(p,r=1.15){
  for(const x of [-r,r])for(const y of [-r,r])for(const z of [-r,r]){const c=cellFor(V(p.x+x,p.y+y,p.z+z));if(!c||doorBlocked(c))return false;}
  for(const b of colliders){if(p.x+r>b.min.x&&p.x-r<b.max.x&&p.y+r>b.min.y&&p.y-r<b.max.y&&p.z+r>b.min.z&&p.z-r<b.max.z)return false;}
  return true;
}
function move(p,delta,r=1.15){
  // Substeps prevent high-speed tunneling through a sealed cube or wall.
  const count=Math.max(1,Math.ceil(delta.length()/1.4)),d=delta.clone().divideScalar(count);
  for(let n=0;n<count;n++)for(const axis of ['x','y','z']){const q=p.clone();q[axis]+=d[axis];if(fits(q,r))p[axis]=q[axis];}
}

// Exact grid traversal: shots, robot sight and map exploration all stop at the
// same closed bulkheads. Seen cells are recorded only along an unobstructed ray.
function trace(origin,dir,max=180,discover=false){
  let [x,y,z]=cellAt(origin.toArray());const axes=['x','y','z'],pos=[x,y,z],step=axes.map(a=>Math.sign(dir[a]));
  const next=axes.map((a,i)=>Math.abs(dir[a])<1e-9?Infinity:((pos[i]+step[i]*.5)*CELL-origin[a])/dir[a]);
  const stride=axes.map(a=>Math.abs(dir[a])<1e-9?Infinity:CELL/Math.abs(dir[a]));let distance=0;
  for(let n=0;n<180&&distance<=max;n++){
    const c=cells.get(keyOf(...pos));
    if(!c||doorBlocked(c))return {distance,door:c?.door,cell:c};
    if(discover)c.seen=true;
    const axis=next[0]<next[1]?(next[0]<next[2]?0:2):(next[1]<next[2]?1:2);
    distance=next[axis];next[axis]+=stride[axis];pos[axis]+=step[axis];
  }
  return {distance:max};
}
function lineOfSight(a,b){const d=b.clone().sub(a),len=d.length();return trace(a,d.normalize(),len).distance>=len-.1;}
function discover(){
  const c=cellFor(player.p);if(c){c.visited=true;c.seen=true;if(!c.corridor){state.room=c.room;state.visitedRooms.add(c.room);}}
  // Rays sample the current camera frustum, including its edges.
  for(let y=-4;y<=4;y++)for(let x=-7;x<=7;x++){
    const v=V(x/7*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.aspect,y/4*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),-1).normalize().applyQuaternion(player.q);
    trace(player.p,v,135,true);
  }
}
function openDoor(d){
  if(!d||d.open||d.opening)return;
  if(d.type==='red'&&!state.key){toast('RED ACCESS KEY REQUIRED',2);tone(110,.2,'sawtooth',.035);return;}
  d.opening=true;tone(d.type==='red'?170:260,.5,'sawtooth',.025);toast(d.type==='red'?'RED ACCESS ACCEPTED':'BULKHEAD OPENING',1.4);
}
function nearestDoor(){return doors.filter(d=>!d.open&&V(...d.p).distanceTo(player.p)<21).sort((a,b)=>V(...a.p).distanceToSquared(player.p)-V(...b.p).distanceToSquared(player.p))[0];}
function toast(message,seconds=3){$('toast').textContent=message;state.toast=seconds;$('toast').style.opacity=1;}
function tone(frequency,duration=.1,type='sine',volume=.03,end=frequency/2){
  if(muted||!audio||audio.state!=='running')return;
  const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(frequency,audio.currentTime);o.frequency.exponentialRampToValueAtTime(Math.max(20,end),audio.currentTime+duration);g.gain.setValueAtTime(volume,audio.currentTime);g.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+duration);o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+duration);
}
function initAudio(){if(!audio)audio=new (window.AudioContext||window.webkitAudioContext)();audio.resume().catch(()=>{});}
function damage(amount){if(state.mode!=='play')return;state.health=Math.max(0,state.health-amount);state.damage=Math.min(1,state.damage+.35);if(amount>2)tone(65,.12,'triangle',.04);if(state.health<=0)finish(false,state.meltdown>0?'Your ship was lost during the evacuation.':'Your hull could not withstand the mine.');}
function burst(p,color,count=12,scale=1){
  for(let i=0;i<count;i++){
    const m=mesh(new THREE.BoxGeometry(.16*scale,.16*scale,.6*scale),glow(color),scene,p);
    const v=V(Math.random()-.5,Math.random()-.5,Math.random()-.5).normalize().multiplyScalar((5+Math.random()*12)*scale);m.lookAt(p.clone().add(v));effects.push({m,v,life:.3+Math.random()*.5,max:.8});
  }
}
function beam(a,b,color,width=1){const m=new THREE.Line(new THREE.BufferGeometry().setFromPoints([a,b]),new THREE.LineBasicMaterial({color,transparent:true,opacity:.95,linewidth:width,toneMapped:false}));scene.add(m);effects.push({m,life:.075,max:.075});}
function hitEnemy(e,amount){
  e.hp-=amount;e.flash=.12;state.hit=.13;
  burst(e.g.position,e.color,4,.5);
  if(e.hp<=0){e.alive=false;e.g.visible=false;state.kills++;burst(e.g.position,e.color,18,1.5);tone(90,.35,'sawtooth',.045);if(Math.random()<.45){const g=new THREE.Group();g.position.copy(e.g.position);scene.add(g);box([1,.3,.3],glowMats.green,g);box([.3,1,.3],glowMats.green,g);pickups.push({type:'health',g,base:e.g.position.clone(),alive:true,small:true});}}
}
function fire(){
  if(state.shot>0||state.mode!=='play')return;
  const plasma=state.weapon===2&&state.plasma;state.shot=plasma?.34:.17;
  const direction=V(0,0,-1).applyQuaternion(player.q),hit=trace(player.p,direction,170);
  let distance=hit.distance,enemy=null,reactorHit=false;
  for(const e of enemies){if(!e.alive)continue;const d=e.g.position.clone().sub(player.p),along=d.dot(direction);if(along<0||along>distance)continue;
    // Small targeting tolerance makes fast six-axis combat approachable.
    if(d.lengthSq()-along*along<(e.size+.45)**2){distance=along;enemy=e;}
  }
  if(state.reactor>0){const d=reactor.position.clone().sub(player.p),along=d.dot(direction);if(along>0&&along<distance&&d.lengthSq()-along*along<4**2){distance=along;enemy=null;reactorHit=true;}}
  const end=player.p.clone().addScaledVector(direction,distance);
  for(const s of [-1,1])beam(player.p.clone().add(V(s*.7,-.5,-1.8).applyQuaternion(player.q)),end,plasma?0xe7a1ff:0x91f6df);
  if(enemy)hitEnemy(enemy,plasma?45:18);
  else if(reactorHit){state.reactor-=plasma?45:18;state.hit=.13;burst(end,0xff8756,5);if(state.reactor<=0)destroyReactor();}
  else{burst(end,plasma?0xe7a1ff:0xa3e9dd,3,.5);if(hit.door&&distance<24)openDoor(hit.door);}
  tone(plasma?380:650,plasma?.18:.07,plasma?'sawtooth':'triangle',.025,plasma?90:190);
  gun.position.z=.09;
}
function destroyReactor(){
  state.reactor=0;state.meltdown=100;core.visible=false;coreLight.intensity=0;rings.forEach(r=>r.material=glowMats.red);burst(reactor.position,0xff6c3d,60,3);tone(70,1.5,'sawtooth',.08);
  escapeMarkers.forEach(m=>m.visible=true);$('escape').hidden=false;toast('REACTOR DESTROYED · 100 SECONDS TO EXTRACT',5);
}
function shootEnemy(e,heavy=false){
  const d=player.p.clone().sub(e.g.position).normalize(),p=e.g.position.clone().addScaledVector(d,e.size+1);
  const m=mesh(new THREE.SphereGeometry(heavy?.65:.28,8,6),glow(e.color),scene,p);
  bullets.push({m,v:d.multiplyScalar(heavy?16:25),life:5,damage:e.damage,size:heavy?.65:.28});
  tone(heavy?100:220,.08,'triangle',.007);
}
function updateEnemies(dt){
  for(const e of enemies){
    if(!e.alive)continue;e.phase+=dt;e.flash=Math.max(0,e.flash-dt);
    e.eye.scale.setScalar(e.flash>0?1.8:1+.12*Math.sin(e.phase*4));
    const d=player.p.clone().sub(e.g.position),distance=d.length();
    if(distance>78)continue;
    if(!lineOfSight(e.g.position,player.p))continue;
    e.g.lookAt(player.p);e.g.rotateY(Math.PI);
    let delta=V();
    if(e.type==='scout'){delta.copy(d).normalize().multiplyScalar(distance>10?e.speed:-e.speed*.4);delta.y+=Math.sin(e.phase*2)*2;}
    else if(e.type==='sentry'){const side=V().crossVectors(d.clone().normalize(),V(0,1,0)).multiplyScalar(Math.sin(e.phase)*e.speed);delta.add(side);if(distance<15)delta.addScaledVector(d.clone().normalize(),-2);}
    else if(distance>9)delta.copy(d).normalize().multiplyScalar(e.speed);
    move(e.g.position,delta.multiplyScalar(dt),e.size);
    e.cool-=dt;
    if(e.cool<0&&distance<65){shootEnemy(e,e.type==='brute');e.cool=e.type==='scout'?1.7:e.type==='brute'?2.5:(e.burst||0)<2?.25:2.1;e.burst=((e.burst||0)+1)%3;}
    if(distance<e.size+1.8){damage(10*dt);move(player.p,d.normalize().multiplyScalar(8*dt));}
  }
}
function updateBullets(dt){for(let i=bullets.length-1;i>=0;i--){const b=bullets[i],delta=b.v.clone().multiplyScalar(dt),len=delta.length(),dir=delta.clone().normalize();let remove=false;
  const toPlayer=player.p.clone().sub(b.m.position),along=clamp(toPlayer.dot(dir),0,len);
  if(toPlayer.addScaledVector(dir,-along).length()<1.3+b.size){damage(b.damage);remove=true;}
  else if(trace(b.m.position,dir,len).distance<len){burst(b.m.position,b.m.material.color,3,.5);remove=true;}
  b.m.position.add(delta);b.life-=dt;if(remove||b.life<=0){scene.remove(b.m);b.m.geometry.dispose();b.m.material.dispose();bullets.splice(i,1);}
}}
function updatePickups(dt){for(const p of pickups){if(!p.alive)continue;p.g.rotation.y+=dt*.7;p.g.position.y=p.base.y+Math.sin(worldTime*1.8+p.base.x)*.35;
  if(p.g.position.distanceTo(player.p)>3)continue;
  if(p.type==='health'&&state.health>=100)continue;
  p.alive=false;p.g.visible=false;tone(540,.22,'sine',.04,1000);
  if(p.type==='key'){state.key=true;toast('RED ACCESS KEY ACQUIRED · FIND SECURITY CONTROL',4);}
  else if(p.type==='weapon'){state.plasma=true;state.weapon=2;toast('PLASMA LANCE ACQUIRED · 1 / 2 TO SWITCH',4);}
  else{state.health=Math.min(100,state.health+(p.small?12:30));toast('SHIP INTEGRITY RESTORED',1.5);}
}}
function updateDoors(dt){for(const d of doors){if(!d.opening)continue;d.amount=Math.min(1,d.amount+dt*.95);d.panels.forEach(p=>p.mesh.position.x=p.side*(3+d.amount*6));if(d.amount>=1){d.open=true;d.opening=false;d.group.visible=false;discover();}}}
function updateEffects(dt){for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.life-=dt;if(e.v)e.m.position.addScaledVector(e.v,dt);if(e.m.material.transparent)e.m.material.opacity=e.life/e.max;if(e.life<=0){scene.remove(e.m);e.m.geometry.dispose();e.m.material.dispose();effects.splice(i,1);}}}

function updateFlight(dt){
  const turn=1.45*dt;
  if(keys.has('ArrowLeft'))player.q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0,1,0),turn));
  if(keys.has('ArrowRight'))player.q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0,1,0),-turn));
  if(keys.has('ArrowUp'))player.q.multiply(new THREE.Quaternion().setFromAxisAngle(V(1,0,0),turn));
  if(keys.has('ArrowDown'))player.q.multiply(new THREE.Quaternion().setFromAxisAngle(V(1,0,0),-turn));
  const roll=(keys.has('KeyQ')?1:0)-(keys.has('KeyE')?1:0);if(roll)player.q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0,0,1),roll*turn));player.q.normalize();
  const thrust=V((keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0),(keys.has('Space')?1:0)-(keys.has('KeyC')?1:0),(keys.has('KeyS')?1:0)-(keys.has('KeyW')?1:0));
  state.boost=(keys.has('ShiftLeft')||keys.has('ShiftRight'))&&state.energy>1&&thrust.lengthSq()>0;
  if(state.boost)state.energy=Math.max(0,state.energy-dt*23);else state.energy=Math.min(100,state.energy+dt*15);
  if(thrust.lengthSq()>0)thrust.normalize();thrust.applyQuaternion(player.q).multiplyScalar(state.boost?28:14);
  player.v.lerp(thrust,1-Math.exp(-dt*5));move(player.p,player.v.clone().multiplyScalar(dt));
  if(keys.has('Mouse0')||keys.has('KeyX'))fire();
  const c=cellFor(player.p);if(c&&rooms[c.room].lava&&!c.corridor&&player.p.y<-16.65){damage(23*dt);if(state.toast<=0)toast('THERMAL DAMAGE · CLIMB AWAY FROM LAVA',1.2);}
  if(state.meltdown>0){state.meltdown=Math.max(0,state.meltdown-dt);if(state.meltdown<=0)finish(false,'The reactor reached critical mass before extraction.');else if(player.p.distanceTo(exitRing.position)<6)finish(true,'The core is silent. Your ship is clear of the blast.');}
  state.discover-=dt;if(state.discover<=0){discover();state.discover=.16;}
}
function updateHUD(){
  const r=rooms[state.room];$('roomName').textContent=`${r.tag} / ${r.name.toUpperCase()}`;$('depth').textContent=`DEPTH −${1200-r.c[1]*CELL} M`;
  $('health').textContent=Math.ceil(state.health);$('healthBar').style.width=`${state.health}%`;$('healthBar').style.background=state.health<30?'#ff6753':'#91e8dd';
  $('energy').textContent=Math.ceil(state.energy);$('energyBar').style.width=`${state.energy}%`;$('keyStatus').textContent=state.key?'◆ RED KEY':'KEY —';
  $('speed').textContent=Math.round(player.v.length());$('weaponName').textContent=state.weapon===2?'PLASMA LANCE':'PULSE CANNON';$('weaponInfo').textContent=state.weapon===2?'HEAVY ENERGY / UNLIMITED':'STANDARD ISSUE / UNLIMITED';
  $('objectiveText').textContent=state.meltdown>0?'Reach extraction · Follow green beacons':state.key?'Destroy the reactor · Past security control':'Locate the red key · Smelter vault';
  $('explored').textContent=`EXPLORED ${state.visitedRooms.size} / ${rooms.length}`;$('timer').textContent=formatTime(state.time);$('countdown').textContent=Math.ceil(state.meltdown).toString().padStart(2,'0');
  const d=nearestDoor();$('prompt').textContent=d?(d.opening?'BULKHEAD OPENING…':d.type==='red'&&!state.key?'RED KEY REQUIRED':`[ F ] ${d.type==='red'?'UNLOCK RED BULKHEAD':'OPEN BULKHEAD'}`):'';
  const dir=V(0,0,-1).applyQuaternion(player.q),ray=trace(player.p,dir,100);let target='';
  for(const e of enemies)if(e.alive){const v=e.g.position.clone().sub(player.p),t=v.dot(dir);if(t>0&&t<ray.distance&&v.lengthSq()-t*t<(e.size+1)**2){target=`${e.type.toUpperCase()} / ${Math.ceil(e.hp/e.maxHp*100)}%`;break;}}
  const v=reactor.position.clone().sub(player.p),t=v.dot(dir);if(state.reactor>0&&t>0&&t<ray.distance&&v.lengthSq()-t*t<25)target=`REACTOR / ${Math.ceil(state.reactor/4)}%`;
  $('target').textContent=target;$('hitmarker').style.opacity=state.hit>0?1:0;$('damage').style.opacity=state.damage*.7;
}
function formatTime(s){return `${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`;}
function finish(won,message){
  state.won=won;setMode('end');$('pauseTitle').textContent=won?'CLEAR OF THE BLAST.':'SIGNAL LOST.';
  $('pauseText').textContent=`${message} ${formatTime(state.time)} elapsed · ${state.kills}/${enemySpawns.length} hostiles destroyed · ${state.visitedRooms.size}/14 rooms traversed.`;
  $('resume').hidden=true;$('restart').textContent='FLY AGAIN';
}
function setMode(mode){
  state.mode=mode;keys.clear();$('menu').hidden=mode!=='menu';$('hud').hidden=!state.started;$('mapOverlay').hidden=mode!=='map';$('pause').hidden=!['pause','end'].includes(mode);$('help').hidden=mode!=='help';
  document.body.classList.toggle('playing',state.started);
  if(mode!=='play'&&document.pointerLockElement===renderer.domElement)document.exitPointerLock();
  if(mode==='map'){prepareMap();drawMap();}
}
function lockMouse(){try{const p=renderer.domElement.requestPointerLock();if(p?.catch)p.catch(()=>toast('Click the flight view to capture the mouse. Arrow keys also steer.',4));}catch{toast('Arrow keys steer · X fires. Click the flight view to use the mouse.',4);}}
function start(){initAudio();state.started=true;player.p.set(0,0,9);player.q.identity();setMode('play');discover();lockMouse();toast('FIND THE RED KEY · TAB FOR AUTOMAP · ESC FOR CONTROLS',5);}
let helpReturn='menu';
function showHelp(){helpReturn=state.mode;setMode('help');}
$('start').onclick=start;
$('resume').onclick=()=>{setMode('play');initAudio();lockMouse();};
$('restart').onclick=()=>location.reload();
$('helpButton').onclick=showHelp;$('pauseHelp').onclick=showHelp;
$('closeHelp').onclick=()=>{setMode(helpReturn);if(helpReturn==='play')lockMouse();};
$('closeMap').onclick=()=>{setMode('play');lockMouse();};
$('sound').onclick=()=>{muted=!muted;$('sound').textContent=muted?'AUDIO OFF':'AUDIO ON';if(!muted)initAudio();};
$('sensitivity').oninput=e=>sensitivity=+e.target.value;$('invert').onchange=e=>invert=e.target.checked;
renderer.domElement.addEventListener('click',()=>{if(state.mode==='play'&&document.pointerLockElement!==renderer.domElement){initAudio();lockMouse();}});
document.addEventListener('pointerlockchange',()=>{if(!document.pointerLockElement&&state.mode==='play')setMode('pause');});
document.addEventListener('mousemove',e=>{if(state.mode!=='play'||document.pointerLockElement!==renderer.domElement)return;
  player.q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0,1,0),-e.movementX*.0022*sensitivity));
  player.q.multiply(new THREE.Quaternion().setFromAxisAngle(V(1,0,0),-e.movementY*.0022*sensitivity*(invert?-1:1)));player.q.normalize();
});
document.addEventListener('mousedown',e=>{if(e.button===0&&state.mode==='play'&&document.pointerLockElement===renderer.domElement)keys.add('Mouse0');});
document.addEventListener('mouseup',()=>keys.delete('Mouse0'));
document.addEventListener('keydown',e=>{
  if(['Tab','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
  if(e.repeat)return;
  if((e.code==='Tab'||e.code==='KeyM')&&state.started){if(state.mode==='play')setMode('map');else if(state.mode==='map'){setMode('play');lockMouse();}return;}
  if(e.code==='Escape'){if(state.mode==='map'){setMode('pause');}else if(state.mode==='help'){setMode(helpReturn==='play'?'pause':helpReturn);}else if(state.mode==='play')setMode('pause');return;}
  if(state.mode!=='play')return;keys.add(e.code);
  if(e.code==='KeyF')openDoor(nearestDoor());
  if(e.code==='Digit1')state.weapon=1;if(e.code==='Digit2'){if(state.plasma)state.weapon=2;else toast('PLASMA LANCE AVAILABLE IN MUNITIONS BAY',2);}
});
document.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',()=>{keys.clear();if(state.mode==='play')setMode('pause');});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.mode==='play')setMode('pause');});

// The automap projects only discovered cube edges. There is deliberately no
// precomputed full-level silhouette or undiscovered room-name list.
const map=$('mapCanvas'),ctx=map.getContext('2d');
let mapYaw=-.6,mapPitch=.65,mapZoom=1,mapCenter=V(),mapScale=1,mapDragging=false,mapPrev=[0,0];
function prepareMap(){
  const known=[...cells.values()].filter(c=>c.seen);mapCenter.set(0,0,0);known.forEach(c=>mapCenter.add(V(c.x*CELL,c.y*CELL,c.z*CELL)));if(known.length)mapCenter.divideScalar(known.length);
  const bounds=new THREE.Box3();known.forEach(c=>bounds.expandByPoint(V(c.x*CELL,c.y*CELL,c.z*CELL)));const size=bounds.getSize(V());mapScale=Math.min(map.clientWidth/(Math.max(size.x,size.z)+70),map.clientHeight/(Math.max(size.y,size.z*.6)+70))*.9;
  mapZoom=1;map.width=map.clientWidth*devicePixelRatio;map.height=map.clientHeight*devicePixelRatio;ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
}
function projectMap(p){const v=p.clone().sub(mapCenter),x=v.x*Math.cos(mapYaw)-v.z*Math.sin(mapYaw),z=v.x*Math.sin(mapYaw)+v.z*Math.cos(mapYaw),y=v.y*Math.cos(mapPitch)-z*Math.sin(mapPitch);return [map.clientWidth/2+x*mapScale*mapZoom,map.clientHeight/2-y*mapScale*mapZoom,z*Math.cos(mapPitch)+v.y*Math.sin(mapPitch)];}
const cubeVertices=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const cubeEdges=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
function drawMap(){
  const w=map.clientWidth,h=map.clientHeight;ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='#41616714';ctx.lineWidth=1;for(let x=0;x<w;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}for(let y=0;y<h;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  const known=[...cells.values()].filter(c=>c.seen).sort((a,b)=>projectMap(V(a.x*CELL,a.y*CELL,a.z*CELL))[2]-projectMap(V(b.x*CELL,b.y*CELL,b.z*CELL))[2]);
  for(const c of known){
    const verts=cubeVertices.map(v=>projectMap(V(c.x*CELL+v[0]*5.75,c.y*CELL+v[1]*5.75,c.z*CELL+v[2]*5.75)));
    ctx.strokeStyle=c.visited?'#77c8b9bb':'#587d8066';ctx.lineWidth=c.visited?1.1:.7;ctx.beginPath();for(const [a,b] of cubeEdges){ctx.moveTo(verts[a][0],verts[a][1]);ctx.lineTo(verts[b][0],verts[b][1]);}ctx.stroke();
  }
  for(const d of doors)if(!d.open){const parts=d.cell.split(',').map(Number),visible=faces.some(f=>cells.get(keyOf(...parts.map((n,i)=>n+f.n[i])))?.seen);if(!visible)continue;const p=projectMap(V(...d.p));ctx.strokeStyle=d.type==='red'?'#ff6a7c':'#e2b78b';ctx.lineWidth=2;ctx.strokeRect(p[0]-4,p[1]-4,8,8);}
  const p=projectMap(player.p),forward=projectMap(player.p.clone().add(V(0,0,-6).applyQuaternion(player.q)));ctx.strokeStyle='#ff8858';ctx.fillStyle='#ff8858';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p[0],p[1],5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(forward[0],forward[1]);ctx.stroke();ctx.beginPath();ctx.arc(p[0],p[1],11+Math.sin(worldTime*3)*2,0,Math.PI*2);ctx.stroke();
  const labels=[];
  rooms.forEach((r,i)=>{if(!known.some(c=>c.room===i&&!c.corridor))return;const p=projectMap(V(...r.c).multiplyScalar(CELL).add(V(0,22,0)));labels.push(`<span class="maplabel" style="left:${p[0]+12}px;top:${p[1]+150}px">${r.tag} ${r.name.toUpperCase()}</span>`);});$('maplabels').innerHTML=labels.join('');
  $('mapStats').textContent=`${known.length} CUBES CHARTED / ${[...cells.values()].filter(c=>c.visited).length} TRAVERSED`;
}
map.addEventListener('pointerdown',e=>{mapDragging=true;mapPrev=[e.clientX,e.clientY];map.setPointerCapture(e.pointerId);});
map.addEventListener('pointermove',e=>{if(!mapDragging)return;mapYaw+=(e.clientX-mapPrev[0])*.006;mapPitch=clamp(mapPitch+(e.clientY-mapPrev[1])*.006,-1.3,1.3);mapPrev=[e.clientX,e.clientY];drawMap();});
map.addEventListener('pointerup',()=>mapDragging=false);map.addEventListener('wheel',e=>{e.preventDefault();mapZoom=clamp(mapZoom*Math.exp(-e.deltaY*.001),.4,4);drawMap();},{passive:false});
window.addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();if(state.mode==='map')prepareMap();});

function animate(now){
  const dt=Math.min((now-frameTime)/1000,.04);frameTime=now;worldTime+=dt;lavaUniforms.time.value=worldTime;
  if(state.mode==='play'){
    state.time+=dt;state.shot=Math.max(0,state.shot-dt);state.hit=Math.max(0,state.hit-dt);state.damage=Math.max(0,state.damage-dt*1.4);state.toast-=dt;if(state.toast<=0)$('toast').style.opacity=0;
    updateFlight(dt);if(state.mode==='play'){updateDoors(dt);updateEnemies(dt);updateBullets(dt);updatePickups(dt);updateEffects(dt);}updateHUD();
  }
  if(state.mode==='menu'){
    menuTime+=dt;camera.position.set(7+Math.sin(menuTime*.14)*2,2.4+Math.cos(menuTime*.2),13);camera.lookAt(-4,0,-23);gun.visible=false;
  }else{camera.position.copy(player.p);camera.quaternion.copy(player.q);gun.visible=state.mode!=='map';gun.position.z*=Math.exp(-dt*20);gun.position.y=state.mode==='play'?Math.sin(worldTime*6)*player.v.length()*.0005:0;}
  core.rotation.x=worldTime*.35;core.rotation.y=worldTime*.55;rings.forEach((r,i)=>r.rotation.z=worldTime*(i?-.3:.3));
  const closeRooms=rooms.map((r,i)=>({i,d:V(...r.c).multiplyScalar(CELL).distanceToSquared(camera.position)})).sort((a,b)=>a.d-b.d);
  roomLights.forEach((l,j)=>{const r=rooms[closeRooms[j].i];l.position.copy(V(...r.c).multiplyScalar(CELL));l.position.y+=8;l.color.set(r.color);l.intensity=r.lava?150:75;});
  // Opaque bulkheads and hulls occlude remote robots and mechanisms. Avoid
  // drawing their many small components through several rooms of solid wall.
  const visible=(p,r=2)=>{const d=p.clone().sub(camera.position),len=d.length();return len<20||trace(camera.position,d.normalize(),len).distance>=len-r;};
  enemies.forEach(e=>e.g.visible=e.alive&&visible(e.g.position,e.size));
  pickups.forEach(p=>p.g.visible=p.alive&&visible(p.g.position,2));
  doors.forEach(d=>d.group.visible=!d.open&&visible(d.group.position,7));
  reactor.visible=visible(reactor.position,7);
  if(state.mode==='map')drawMap();
  renderer.render(scene,camera);
}
renderer.setAnimationLoop(animate);
$('loading').hidden=true;

// Opt-in deterministic inspection hooks for the included browser smoke checks.
// They are absent from a normal launch and never reveal map data to the player.
if(new URLSearchParams(location.search).has('test'))window.__cinder={state,player,cells,doors,enemies,pickups,reactor,exitRing,trace,fits,discover,openDoor,damage,fire,hitEnemy,destroyReactor,updateFlight,updateDoors,updatePickups,setMode,start,renderer,camera};
