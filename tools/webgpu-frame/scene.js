import { AmbientLight, DirectionalLight, Mesh, MeshStandardNodeMaterial, BoxGeometry, Scene, PerspectiveCamera, RenderTarget } from 'three/webgpu';
import { createWebGpuRenderer } from '../../src/render/webgpu-device.js';
import { createWorldViewPipeline } from '../../src/render/webgpu-pipeline.js';
import { createGradeLut } from '../../src/render/lut.js';
import { LowHealthPass } from '../../src/player/lowhealth.js';
let r,g,p,geom,mat,lut,lowHealth;
try {
  r=await createWebGpuRenderer(document.querySelector('#test'));
  r.setSize(128,96);
  r.setClearColor(0,0);
  const scene=new Scene(), vscene=new Scene();
  const cam=new PerspectiveCamera(60,128/96,.05,100),vcam=new PerspectiveCamera(60,128/96,.005,12);
  cam.position.set(0,1,4);cam.lookAt(0,0,0);
  const mode=new URLSearchParams(location.search);
  geom=new BoxGeometry(1,1,1); mat=new MeshStandardNodeMaterial({color:0xbb4477,roughness:.25,metalness:.6});
  const box=new Mesh(geom,mat);box.layers.enable(1);scene.add(box);
  scene.add(new AmbientLight(0xffffff,.4));
  const sun=new DirectionalLight(0xffffff,3);sun.position.set(3,4,5);scene.add(sun);
  p=new RenderTarget(128,96);
  lut=createGradeLut('default');
  if(mode.has('low')) {
    lowHealth=new LowHealthPass();
    lowHealth.sync({effect:.6,pulse:.3,hitFlash:.7});
    lowHealth.resize(128,96);
  }
  g=createWorldViewPipeline(r,scene,cam,vscene,vcam,{gtao:true,ssrEnabled:mode.has('ssr'),taa:mode.has('taa'),bloomStrength:.14,grade:mode.has('grade')?lut:null,postPasses:lowHealth?[lowHealth]:[]});
  r.setRenderTarget(p);g.render();
  const before=await r.readRenderTargetPixelsAsync(p,64,48,1,1);
  await new Promise(resolve=>requestAnimationFrame(resolve));
  cam.position.x=.15;cam.lookAt(0,0,0);cam.updateMatrixWorld();g.render();
  const pixels=await r.readRenderTargetPixelsAsync(p,64,48,1,1);
  const edge=await r.readRenderTargetPixelsAsync(p,14,48,1,1);
  const velIndex = mode.has('taa') ? g.prePass.renderTarget.textures.indexOf(
    g.prePass.getTextureNode('velocity').value) : -1;
  const vel = velIndex < 0 ? null : await r.readRenderTargetPixelsAsync(
    g.prePass.renderTarget, 64, 48, 1, 1, velIndex);
  const world=await r.readRenderTargetPixelsAsync(g.worldPass.renderTarget,64,48,1,1);
  window.__CASE_RESULT__={ok:true,before:[...before],pixel:[...pixels],edge:[...edge],world:[...world],velocity:vel?[...vel]:null};
} catch(e) {window.__CASE_RESULT__={ok:false,error:e.stack};}
finally {g?.dispose();p?.dispose();mat?.dispose();geom?.dispose();lut?.texture?.dispose();lowHealth?.dispose();await r?.dispose();}
