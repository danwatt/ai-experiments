// Each playable volume is a cube. Connections remove shared faces; sealed
// bulkheads occupy a corridor cube until opened. Units are metres.
export const CELL = 12;
export const rooms = [
  {name:'Insertion dock', c:[0,0,0], color:0x76bdb7, tag:'01'},
  {name:'Transit nexus', c:[0,0,-5], color:0x76bdb7, tag:'02'},
  {name:'Ore processing', c:[-5,0,-5], color:0xe89d65, tag:'03'},
  {name:'Smelter vault', c:[-10,0,-5], color:0xff673b, tag:'04', lava:true},
  {name:'Munitions bay', c:[5,0,-5], color:0x8bb3e9, tag:'05'},
  {name:'Signal relay', c:[5,0,-10], color:0x8bb3e9, tag:'06'},
  {name:'Ascent shaft', c:[0,0,-10], color:0x89d2c6, tag:'07'},
  {name:'Observation deck', c:[0,5,-10], color:0x8cd9d3, tag:'08'},
  {name:'Coolant reservoir', c:[-5,5,-10], color:0x5bbac4, tag:'09'},
  {name:'Turbine hall', c:[-5,5,-15], color:0xc5b78c, tag:'10'},
  {name:'Security control', c:[0,5,-15], color:0xe39070, tag:'11'},
  {name:'Reactor chamber', c:[5,5,-15], color:0xff6555, tag:'12'},
  {name:'Exhaust gallery', c:[5,5,-20], color:0x97b785, tag:'13'},
  {name:'Extraction gate', c:[0,5,-20], color:0x7fe8b1, tag:'14'},
];
export const links = [
  [0,1], [1,2], [2,3,'normal'], [1,4,'normal'], [4,5],
  [5,6], [1,6], [6,7], [7,8], [8,9,'normal'], [9,10],
  [7,10], [10,11,'red'], [11,12], [12,13,'normal'],
];
export const keyOf = (x,y,z) => `${x},${y},${z}`;
export const cellAt = p => p.map(n=>Math.floor(n/CELL+.5));
export function createLevel() {
  const cells = new Map(), doors = [];
  const add=(x,y,z,room,corridor=false)=>{
    const key=keyOf(x,y,z);
    if(!cells.has(key)) cells.set(key,{key,x,y,z,room,corridor,seen:false,visited:false});
  };
  rooms.forEach((r,i)=>{
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)add(r.c[0]+x,r.c[1]+y,r.c[2]+z,i);
  });
  links.forEach(([a,b,type])=>{
    const from=rooms[a].c,to=rooms[b].c,axis=from.findIndex((v,i)=>v!==to[i]);
    const distance=Math.abs(to[axis]-from[axis]),direction=Math.sign(to[axis]-from[axis]);
    for(let n=2;n<distance-1;n++){
      const p=[...from];p[axis]+=n*direction;add(...p,a,true);
      if(type&&n===2){const d={id:doors.length,cell:keyOf(...p),p:p.map(v=>v*CELL),axis,type,open:false,amount:0,a,b};doors.push(d);cells.get(d.cell).door=d;}
    }
  });
  return {cells,doors};
}
export const enemySpawns = [
  [1,'scout',[-7,4,-3]],[1,'scout',[8,-5,4]],
  [2,'sentry',[-5,4,-3]],[2,'scout',[8,-4,5]],
  [3,'brute',[0,2,0]],[3,'scout',[-8,-7,-6]],
  [4,'sentry',[5,3,-5]],[5,'scout',[-6,4,4]],[5,'sentry',[6,-4,-5]],
  [6,'scout',[-7,4,-6]],[7,'sentry',[8,3,-7]],
  [8,'brute',[0,0,-4]],[8,'scout',[-8,4,4]],
  [9,'sentry',[7,4,2]],[9,'scout',[-7,-5,-5]],
  [10,'brute',[6,0,3]],[10,'sentry',[-8,6,-6]],
  [11,'brute',[-7,0,-5]],[11,'sentry',[7,5,6]],
  [12,'scout',[-6,4,1]],[12,'scout',[7,-5,3]],
];
export const pickupSpawns = [
  {room:3,type:'key',offset:[-6,-8,-5]},
  {room:4,type:'weapon',offset:[0,0,3]},
  ...[0,2,5,7,8,10,12].map(room=>({room,type:'health',offset:[-9,-9,8]})),
];
