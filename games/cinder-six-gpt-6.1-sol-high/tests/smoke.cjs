const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
try {
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto(`${process.env.GAME_URL||'http://127.0.0.1:8086'}/?test`);
await page.waitForFunction(()=>!!window.__cinder);
await page.screenshot({path:'/tmp/cinder-menu.png'});
console.log('INITIAL',await page.evaluate(()=>({cubes:__cinder.cells.size,doors:__cinder.doors.length,enemies:__cinder.enemies.length,renderer:__cinder.renderer.info.render})));
await page.click('#start');
await page.waitForTimeout(300);
await page.screenshot({path:'/tmp/cinder-flight.png'});
console.log('START',await page.evaluate(()=>({mode:__cinder.state.mode,p:__cinder.player.p.toArray(),lock:!!document.pointerLockElement})));
const results=await page.evaluate(async()=>{
 const g=__cinder;g.setMode('pause');
 const checks=[];const check=(name,pass,detail)=>checks.push({name,pass,detail});
 const V=(...a)=>new g.player.p.constructor(...a);
 // Connectivity including cube collision, without using authored room links.
 const reachable=allowRed=>{const queue=['0,0,0'],seen=new Set(queue);for(let n=0;n<queue.length;n++){const c=g.cells.get(queue[n]);for(const d of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const key=[c.x+d[0],c.y+d[1],c.z+d[2]].join(',');const next=g.cells.get(key);if(next&&!seen.has(key)&&(allowRed||next.door?.type!=='red')){seen.add(key);queue.push(key);}}}return seen;};
 const blocked=reachable(false),all=reachable(true);
 check('14 rooms connected',new Set([...all].map(k=>g.cells.get(k).room)).size===14,all.size);
 check('red door gates reactor and exit',!blocked.has('5,5,-15')&&!blocked.has('0,5,-20'));
 check('key and armory reachable before red lock',blocked.has('-10,0,-5')&&blocked.has('5,0,-5'));
 const door=g.doors.find(d=>d.type==='red');
 g.player.p.set(12,60,-180);g.player.q.setFromAxisAngle(V(0,1,0),-Math.PI/2);g.discover();
 check('reactor not discovered through red door',![...g.cells.values()].some(c=>c.room===11&&c.seen));
 const los=g.trace(g.player.p,V(1,0,0),100);check('sight stops at closed door',los.door===door,los.distance);
 check('closed door blocks movement',!g.fits(V(...door.p)));
 g.openDoor(door);check('red door rejects missing key',!door.opening);
 g.state.key=true;g.openDoor(door);g.updateDoors(2);g.discover();
 check('red key opens door',door.open&&g.fits(V(...door.p)));
 check('opened doorway reveals reactor cubes',[...g.cells.values()].some(c=>c.room===11&&c.seen));
 // Reset exploration for map capture, then check every pickup and damage.
 const key=g.pickups.find(p=>p.type==='key');g.player.p.copy(key.base);g.state.key=false;g.updatePickups(0);check('key pickup',g.state.key&&!key.alive);
 const weapon=g.pickups.find(p=>p.type==='weapon');g.player.p.copy(weapon.base);g.updatePickups(0);check('weapon pickup and selection',g.state.plasma&&g.state.weapon===2);
 g.player.p.set(-120,-16.75,-60);g.state.health=100;g.setMode('play');g.updateFlight(.25);g.setMode('pause');check('lava floor damages ship',g.state.health<100,g.state.health);
 g.player.p.set(-120,0,-60);g.state.health=100;g.setMode('play');g.updateFlight(.25);g.setMode('pause');check('flying above lava is safe',g.state.health===100);
 check('three enemy classes',new Set(g.enemies.map(e=>e.type)).size===3);
 const enemy=g.enemies.find(e=>e.alive);g.hitEnemy(enemy,999);check('hostiles can be destroyed',!enemy.alive&&g.state.kills===1);
 g.player.p.copy(g.reactor.position).add(V(0,0,11));g.player.q.identity();g.state.weapon=2;g.state.shot=0;g.setMode('play');for(let n=0;n<12;n++){g.state.shot=0;g.fire();}g.setMode('pause');check('shooting destroys reactor and starts countdown',g.state.reactor<=0&&g.state.meltdown>0,{hp:g.state.reactor,count:g.state.meltdown});
 g.player.p.copy(g.exitRing.position);g.setMode('play');g.updateFlight(.01);check('extraction completes mission',g.state.won&&g.state.mode==='end');
 // Inspect six-axis flight and prevent out-of-level movement.
 check('solid hull blocks escape',!g.fits(V(0,0,20)));
 return checks;
});
console.log(JSON.stringify(results,null,2));
assert(results.every(r=>r.pass),'Gameplay checks failed');
await page.screenshot({path:'/tmp/cinder-win.png'});
await page.reload();await page.waitForFunction(()=>!!window.__cinder);await page.click('#start');
await page.keyboard.down('KeyW');await page.waitForTimeout(1800);await page.keyboard.up('KeyW');
const flight=await page.evaluate(()=>({position:__cinder.player.p.toArray(),mode:__cinder.state.mode}));
console.log('FLIGHT',flight);assert(flight.position[2]<-3,'Keyboard thrust moves the ship');
await page.keyboard.down('KeyQ');await page.keyboard.down('Space');await page.waitForTimeout(400);await page.keyboard.up('KeyQ');await page.keyboard.up('Space');
const rolled=await page.evaluate(()=>({y:__cinder.player.p.y,qz:__cinder.player.q.z}));assert(rolled.y>.5&&Math.abs(rolled.qz)>.1,'Local vertical thrust and roll respond to keyboard input');
await page.keyboard.press('Tab');await page.waitForTimeout(100);await page.screenshot({path:'/tmp/cinder-map.png'});
assert(await page.locator('#mapOverlay').isVisible());
for(const shot of [{name:'lava',position:[-120,3,-45],target:[-124,-7,-62]},{name:'reactor',position:[60,62,-165],target:[60,60,-180]}]){
 await page.evaluate(s=>{const g=__cinder;g.setMode('play');g.player.v.set(0,0,0);g.player.p.set(...s.position);g.player.q.setFromUnitVectors(new g.player.p.constructor(0,0,-1),new g.player.p.constructor(...s.target).sub(g.player.p).normalize());},shot);
 await page.waitForTimeout(100);await page.screenshot({path:`/tmp/cinder-${shot.name}.png`});
}
await page.reload();await page.waitForFunction(()=>!!window.__cinder);await page.setViewportSize({width:1280,height:720});await page.waitForTimeout(400);await page.screenshot({path:'/tmp/cinder-menu-small.png'});
console.log('ERRORS',errors);assert.equal(errors.length,0);
} finally {
await browser.close();
}
})().catch(e=>{console.error(e);process.exitCode=1;});
