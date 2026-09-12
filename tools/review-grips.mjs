#!/usr/bin/env node
/** Real-game first-person captures plus neutral, close diagnostic views of the
 * SAME deformed geometry. No alternative model/IK path in the diagnostic view.
 * node tools/review-grips.mjs --out=/tmp/grips-before [--weapon=rifle]
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {ensureViteServer,launchChromium,parseArgs,stopViteServer} from './lib/browser-harness.mjs';
const args=parseArgs();
const port=Number(args.port??5193);
const out=resolve(args.out??'/tmp/grip-review');
mkdirSync(out,{recursive:true});
const server=await ensureViteServer({port});
const browser=await launchChromium({headless:true,args:['--ignore-gpu-blocklist','--hide-scrollbars']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${port}/?capture=1&lockstep=1&shot=weapon`);
  await page.waitForFunction('window.__READY__ === true',null,{timeout:120000});
  await page.evaluate(async()=>{
    window.__APPLY_SHOT__('weapon');
    await window.__PUMP__(35);
    const w=window.__ENGINE__.ctx.get('weapons');
    w.update=w.fixedUpdate=w.lateUpdate=()=>{};
    w.viewmodel.onClipEvent=()=>{};
    const T=await import('/node_modules/three/build/three.module.js');
    const {GRIP_CONTACTS:contacts}=await import('/src/weapons/grip-contacts.js');
    const canvas=document.createElement('canvas');
    canvas.style.cssText='position:fixed;inset:0;z-index:100000;width:100vw;height:100vh;display:none';
    document.body.appendChild(canvas);
    const renderer=new T.WebGLRenderer({canvas,antialias:true});
    renderer.setSize(innerWidth,innerHeight);
    renderer.setPixelRatio(1);
    renderer.toneMapping=T.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.3;
    const scene=new T.Scene();scene.background=new T.Color(.055,.065,.08);
    for(const [pos,power,color] of [[[1,2,1],4,0xffead4],[[-2,.5,1],3,0xc5dbff],[[0,1,-2],3,0xffffff]]){
      const l=new T.DirectionalLight(color,power);l.position.fromArray(pos);scene.add(l);
    }
    scene.add(new T.HemisphereLight(0xffffff,0x666666,1.8));
    const camera=new T.PerspectiveCamera(40,innerWidth/innerHeight,.005,5);
    window.__GRIP_REVIEW__={T,contacts,canvas,renderer,scene,camera,meshes:[]};
  });
  const reports=[];
  const ids=await page.evaluate(()=>[...window.__ENGINE__.ctx.get('weapons').states.keys()]);
  for(const id of args.weapon?[args.weapon]:ids){
    const actions=args.action?[args.action]:['idle','ads'];
    for(const action of actions){
      const report=await page.evaluate(({id,action,t,eye})=>{
        const w=window.__ENGINE__.ctx.get('weapons'),vm=w.viewmodel;
        const {T,contacts}=window.__GRIP_REVIEW__;
        w.setWeaponImmediate(id);vm.stopClip();vm.endRadio();vm.endGrenade();
        if(eye != null)vm.active.def.eyeRelief=eye;
        vm.adsT=vm.sprintT=0;vm.debugFrozen=false;
        const s={ads:0,sprint:0,lowReady:false,speed:0,crouch:false,airborne:false,trigger:0,empty:false};
        for(let i=0;i<60;i++)vm.update(1/60,s);
        if(action==='ads')s.ads=1;
        if(action==='sprint'){s.sprint=1;s.speed=5;}
        if(vm.active.clips[action])vm.play(action);
        for(let i=0;i<Math.round(t*60);i++)vm.update(1/60,s);
        vm.anchor.updateMatrixWorld(true);
        const report={weapon:id,action,arms:[]};
        for(const arm of [vm.armL,vm.armR]){
          const fore=arm.hand.position.clone().sub(arm.forePivot.position).normalize();
          const fingers=new T.Vector3(0,0,-1).applyQuaternion(arm.hand.quaternion);
          report.arms.push({side:arm.side,pose:arm.pose,shoulder:arm.shoulder.toArray(),finger:fingers.toArray(),lengths:[arm.l1,arm.l2],wristAngle:T.MathUtils.radToDeg(Math.acos(T.MathUtils.clamp(fore.dot(fingers),-1,1))),stretch:arm.forePivot.scale.z,hand:arm.hand.position.toArray(),elbow:arm.forePivot.position.toArray()});
        }
        const contact=contacts[id];
        report.contacts=[];
        for(const [arm,joint,offset,goal] of [
          [vm.armL,vm.armL.thumb.joints[1],[0,0,-.026],contact.leftThumb],
          [vm.armR,vm.armR.thumb.joints[1],[0,0,-.026],contact.rightThumb],
          [vm.armR,vm.armR.fingers[0].joints[2],[0,-.006,-.013],contact.trigger],
        ]){
          const point=new T.Vector3().fromArray(offset).multiplyScalar(arm.scale).applyMatrix4(joint.matrixWorld).applyMatrix4(arm.root.matrixWorld.clone().invert());
          const target=new T.Vector3().fromArray(goal);
          if(vm.active.animation)target.applyMatrix4(vm.active.animation.poseMatrix);
          report.contacts.push({point:point.toArray(),target:target.toArray(),errorMM:point.distanceTo(target)*1000});
        }
        return report;
      },{id,action,t:Number(args.t??.8),eye:args.eye==null?null:Number(args.eye)});
      await page.evaluate(async()=>{window.__GRIP_REVIEW__.canvas.style.display='none';await window.__PUMP__(2);await window.__PRESENT__();});
      await page.screenshot({path:`${out}/${id}-${action}-fp.png`});
      for(const side of (action==='ads'?[]:['left','right','under'])){
        await page.evaluate(({side,action})=>{
          const {T,canvas,scene,renderer,camera,meshes}=window.__GRIP_REVIEW__;
          for(const m of meshes){scene.remove(m);m.geometry.dispose();m.material.dispose();}meshes.length=0;
          const vm=window.__ENGINE__.ctx.get('weapons').viewmodel;
          vm.anchor.updateMatrixWorld(true);
          const inv=vm.rig.matrixWorld.clone().invert();
          const p=new T.Vector3();
          const add=(o,arm)=>{
            if(!o.isMesh||!o.visible)return;
            let parent=o.parent;while(parent&&parent!==vm.rig){if(!parent.visible)return;parent=parent.parent;}
            if(o.isSkinnedMesh)o.skeleton.update();
            const g=o.geometry.clone();
            const positions=g.getAttribute('position');
            const mtx=new T.Matrix4().multiplyMatrices(inv,o.matrixWorld);
            for(let i=0;i<positions.count;i++){o.getVertexPosition(i,p);p.applyMatrix4(mtx);positions.setXYZ(i,p.x,p.y,p.z);}
            g.computeVertexNormals();g.deleteAttribute('tangent');
            const mat=new T.MeshStandardMaterial({color:arm < 0 ? 0x637e91 : arm > 0 ? 0x927860 : 0x3e454d,roughness:.72,metalness:0});
            const mesh=new T.Mesh(g,mat);scene.add(mesh);meshes.push(mesh);
          };
          vm.active.group.traverse(o=>add(o,0));
          for(const arm of [vm.armL,vm.armR])for(const o of arm.skins)add(o,arm.side);
          const target=vm.armL.hand.position.clone().lerp(vm.armR.hand.position,.5);
          target.z-=.05;
          const offsets=action==='idle'
            ? {left:[-.55,.13,.25],right:[.55,.13,.25],under:[-.08,-.55,.25]}
            : {left:[-.75,.20,-.15],right:[.75,.20,-.15],under:[-.08,-.70,-.15]};
          camera.position.copy(target).add(new T.Vector3().fromArray(offsets[side]));camera.lookAt(target);
          canvas.style.display='block';renderer.render(scene,camera);
        },{side,action});
        await page.screenshot({path:`${out}/${id}-${action}-${side}.png`});
      }
      reports.push(report);
    }
  }
  if(errors.length)throw new Error(errors.join('\n'));
  writeFileSync(`${out}/measurements.json`,JSON.stringify(reports,null,2)+'\n');
  console.log(JSON.stringify(reports));
}finally{await browser.close();stopViteServer(server);}
