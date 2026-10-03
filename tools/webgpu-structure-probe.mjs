import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ensureViteServer,stopViteServer,launchChromium,parseArgs} from './lib/browser-harness.mjs';
// Standalone cost isolation, not gameplay/FPS acceptance. No game modules load.
const args=parseArgs(),root=fileURLToPath(new URL('..',import.meta.url)),out=String(args.out??'/tmp/cod-structure'),kind=String(args.kind??'mesh'),backend=String(args.backend??'webgpu'),count=Number(args.count??1000),lights=Number(args.lights??24),frames=Number(args.frames??360),warmup=60;
assert.equal(process.env.MESA_VK_DEVICE_SELECT,'1002:7550!', 'Use the RX 9070 XT selector');
assert.ok(['mesh','instanced','node-mesh'].includes(kind));
assert.ok(['webgpu','webgl'].includes(backend));
assert.ok(backend==='webgpu'||kind!=='node-mesh', 'Node material probe requires WebGPU');
assert.ok(Number.isInteger(count)&&count>0&&count<=2048);
assert.ok(Number.isInteger(lights)&&lights>=0&&lights<=24);
assert.ok(Number.isInteger(frames)&&frames>warmup&&frames<=900);
const server=await ensureViteServer({root,port:5262}),browser=await launchChromium({headless:true,channel:'chromium',...(args.browser?{executablePath:String(args.browser)}:{}),args:['--ignore-gpu-blocklist','--use-angle=vulkan','--enable-features=Vulkan','--enable-unsafe-webgpu','--disable-frame-rate-limit','--disable-gpu-vsync']});
try{
 const page=await browser.newPage({viewport:{width:960,height:540},deviceScaleFactor:1}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/micro',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><canvas id="c"></canvas>'}));await page.goto('http://localhost:5262/micro');
 const result=await page.evaluate(async({kind,backend,count,lights,frames,warmup})=>{
  const T=await import(backend==='webgpu'?'/node_modules/three/build/three.webgpu.js':'/node_modules/three/build/three.module.js');
  const canvas=document.querySelector('canvas');const renderer=backend==='webgpu'?new T.WebGPURenderer({canvas,forceWebGL:false,antialias:false,powerPreference:'high-performance'}):new T.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});
  renderer.setSize(960,540);
  if(backend==='webgpu'){
   await renderer.init();
   if(renderer.backend.isWebGPUBackend!==true)throw new Error('Expected native WebGPU backend');
   const adapter=renderer.backend.device.adapterInfo;
   if(adapter?.vendor!=='amd'||adapter.architecture!=='rdna-4'||adapter.isFallbackAdapter)throw new Error('Expected hardware RDNA 4 adapter');
  }
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(60,1,.1,100),geometry=new T.BoxGeometry(.3,.3,.3),material=backend==='webgpu'?new T.MeshStandardNodeMaterial({color:0x808080}):new T.MeshStandardMaterial({color:0x808080});
  if(kind.startsWith('node')){const {uniform,vec4}=await import('/node_modules/three/build/three.tsl.js');material.colorNode=vec4(uniform(new T.Color(.5,.5,.5)),1);}
  for(let i=0;i<count;i++){
   const mesh=kind.endsWith('instanced')?new T.InstancedMesh(geometry,material,1):new T.Mesh(geometry,material);mesh.position.set((i%32-16)*.5,0,(Math.floor(i/32)-16)*.5);mesh.frustumCulled=false;mesh.updateMatrix();mesh.matrixAutoUpdate=false;
   if(mesh.isInstancedMesh&&backend==='webgpu')mesh.instanceMatrix=new T.StorageInstancedBufferAttribute(mesh.instanceMatrix.array,16);
   scene.add(mesh);
  }
  const sun=new T.DirectionalLight(0xffffff,2);sun.position.set(10,20,10);scene.add(sun);
  for(let i=0;i<lights;i++){const l=new T.PointLight(0xff8844,2,25,2);l.position.set(10*Math.sin(i*6.28/Math.max(1,lights)),3,10*Math.cos(i*6.28/Math.max(1,lights)));scene.add(l);}
  const target=new T.RenderTarget(64,64,{depthBuffer:true});renderer.setRenderTarget(target);
  let writes=0,bytes=0,builds=0,recording=false;
  if(renderer.backend){const q=renderer.backend.device.queue,write=q.writeBuffer;q.writeBuffer=function(buffer,offset,data,dataOffset=0,size){if(recording){writes++;bytes+=size===undefined?data.byteLength-dataOffset*(data.BYTES_PER_ELEMENT??1):size*(data.BYTES_PER_ELEMENT??1);}return write.call(this,buffer,offset,data,dataOffset,size);};renderer.debug.onNodeBuilderCreated=()=>{if(recording)builds++;};}
  function render(i){camera.position.set(Math.sin(i*.006)*5,16,18+Math.cos(i*.006));camera.lookAt(0,0,0);renderer.render(scene,camera);}
  const boot=performance.now();for(let i=0;i<warmup;i++){await new Promise(resolve=>requestAnimationFrame(resolve));render(i);}const bootMs=performance.now()-boot;
  const records=[];let previous=null;recording=true;
  for(let i=warmup;i<frames;i++){const now=await new Promise(resolve=>requestAnimationFrame(resolve));if(previous!==null)records.at(-1).dt=now-previous;previous=now;const w=writes,b=bytes,start=performance.now();render(i);records.push({wall:performance.now()-start,writes:writes-w,bytes:bytes-b});}
  recording=false;const info=renderer.info.render;
  const adapter=renderer.backend?.device?.adapterInfo;
  const metadata={userAgent:navigator.userAgent,kind,backend,count,lights,target:[64,64],bootMs,builds,renderInfo:{...info},adapterInfo:adapter?{vendor:adapter.vendor,architecture:adapter.architecture,isFallbackAdapter:adapter.isFallbackAdapter}:null};
  renderer.setRenderTarget(null);target.dispose();geometry.dispose();material.dispose();await renderer.dispose();return{records,metadata};
 },{kind,backend,count,lights,frames,warmup});
 const dist=a=>{a=a.filter(Number.isFinite).sort((a,b)=>a-b);return{mean:a.reduce((s,v)=>s+v,0)/a.length,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)]};};const report={metadata:result.metadata,errors};for(const k of ['dt','wall','writes','bytes'])report[k]=dist(result.records.map(r=>r[k]));writeFileSync(out+'.json',JSON.stringify(report,null,2));writeFileSync(out+'-raw.json',JSON.stringify(result));console.log(JSON.stringify(report,null,2));assert.deepEqual(errors,[]);
}finally{await browser.close();await stopViteServer(server);}
