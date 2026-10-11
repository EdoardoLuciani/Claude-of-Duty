// Opt-in observers only. No proof, scheduling or movement decision is changed.
export function captureProofReuse(engine) {
  const nav = engine.ctx.get('ai').grid, service = nav.worker, worker = service?.worker;
  if (!service?.valid || service.jobs.size) throw new Error('reuse capture needs an idle ready worker');
  if (nav.repeatState === false) throw new Error('reuse capture requires repeat-state mode');
  const generation = service.generation, signature = service.signature(), world = nav.physics.staticWorld;
  const events = [], jobs = [], byId = new Map(), restores = [], intents = new WeakMap();
  let frame = -121, intent = null, nextIntent = 0, delivery = null, closed = false;
  const stamp = () => performance.timeOrigin + performance.now();
  const token = n => Object.is(n,-0) ? '-0' : n;
  const emit = event => {
    if (events.length >= 50000) throw new Error('reuse event bound exceeded');
    const row={frame,at:stamp(),...event};events.push(row);return row;
  };
  const report = { version:1, generation, signature, events, jobs,
    initialProofs:[...service.proofs], initialStats:{...service.stats},
    controller:Object.fromEntries(['radius','height','stepHeight','slopeLimit','snapDistance','maxIterations','mask','enabled'].map(k=>[k,nav._probe[k]])),
    gravity:nav.physics.gravity, mask:nav.physics.MASK.CHARACTER,
    world:{version:world.version,triCount:world.triCount,nodeCount:world.nodeCount},
    initialEndpointCacheHits:nav.stats.cacheHits };
  const wrap = (owner,name,make) => {
    const own=Object.hasOwn(owner,name), original=owner[name], hooked=make(original);owner[name]=hooked;
    restores.push(()=>{if(owner[name]===hooked){if(own)owner[name]=original;else delete owner[name];}});
  };
  wrap(service,'run',original=>function(actor,kind,...rest){
    const scope=this.scopes.get(`${actor}:${kind}`), previous=intent;
    intent=scope?.waiting && intents.has(scope) ? intents.get(scope) : ++nextIntent;
    try { return original.call(this,actor,kind,...rest); }
    finally { const current=this.scopes.get(`${actor}:${kind}`);if(current)intents.set(current,intent);intent=previous; }
  });
  wrap(service,'request',original=>function(from,to,radius,height,budget,...rest){
    const key=[from.x,from.y,from.z,to.x,to.y,to.z,radius,height,budget], identity=key.join(',');
    const known=this.proofs.get(identity), pending=this.current?.proofs.has(identity), before=this.nextId;
    const row=emit({type:'request',key:key.map(token),identity,intent,actor:this.current?.actor,kind:this.current?.kind,
      status:known!==undefined?'hit':pending?'waiting':null,value:known??null});
    const value=original.call(this,from,to,radius,height,budget,...rest);
    if(row.status===null){row.status=this.nextId!==before?'submitted':this.proofs.has(identity)?'immediate':'unsubmitted';row.id=this.nextId!==before?this.nextId:null;
      if(row.status==='immediate')row.value=this.proofs.get(identity);}
    return value;
  });
  wrap(worker,'postMessage',original=>function(data,...rest){
    if(data.type==='queries'){
      for(const job of data.jobs){
        if(jobs.length>=10000)throw new Error('reuse job bound exceeded');
        const row={id:job.id,key:job.key.map(token),actor:job.actor,kind:service.current?.kind??service.jobs.get(job.id)?.scope.kind,
          intent,frame,posted:stamp(),cancelled:null,result:null};jobs.push(row);byId.set(job.id,row);
      }
      return original.call(this,{...data,trace:true},...rest);
    }
    if(data.type==='cancel')for(const id of data.ids){const row=byId.get(id);if(row)row.cancelled=stamp();}
    return original.call(this,data,...rest);
  });
  wrap(service,'receive',original=>function(message){
    const previous=delivery;delivery=byId.get(message.id)??null;
    if(message.type==='result' && delivery)delivery.result={value:message.value,moves:message.moves,ms:message.ms,
      delivered:stamp(),trace:message.trace,stale:!this.jobs.has(message.id)};
    try{return original.call(this,message);}finally{delivery=previous;}
  });
  wrap(service,'remember',original=>function(key,value){
    const before=this.proofs.size, oldest=this.proofs.keys().next().value;
    const row=emit({type:'remember',key,value,intent:delivery?.intent??intent,job:delivery?.id??null,source:delivery?'worker':'immediate',evicted:null});
    const result=original.call(this,key,value);
    if(before && !this.proofs.has(oldest))row.evicted=oldest;
    return result;
  });
  wrap(service,'clear',original=>function(...args){emit({type:'clear'});return original.apply(this,args);});
  const valid = () => {
    if(service.worker!==worker || service.generation!==generation || !service.valid || service.signature()!==signature || nav.physics.staticWorld!==world)
      throw new Error('reuse capture world/configuration changed');
  };
  return {
    before(i){frame=i;valid();},
    async finish(){
      const deadline=performance.now()+5000;
      while(service.jobs.size){if(service.error)throw service.error;if(performance.now()>deadline)throw new Error('reuse result drain deadline');await new Promise(r=>setTimeout(r,0));}
      // Cancelled jobs can have been executing. Retain any missing reply as censored.
      await new Promise(r=>setTimeout(r,50));valid();
      report.finalStats={...service.stats};report.finalProofs=service.proofs.size;
      report.finalEndpointCacheHits=nav.stats.cacheHits;return report;
    },
    snapshot(){return report;},
    dispose(){if(closed)return;closed=true;for(const restore of restores.reverse())restore();},
  };
}

// Runs only after capture, with the game paused. Uses the actual browser world's
// BVH and native controller, not a cooked-map approximation or new runtime solver.
export function replayProofReuse(engine, capture, source, infantry, walkStep, rounds=5) {
  const nav=engine.ctx.get('ai').grid, world=nav.physics.staticWorld, frame=engine.time.frame;
  if(!nav.worker.valid || nav.worker.signature()!==capture.signature || nav.worker.generation!==capture.generation)
    throw new Error('reuse replay configuration changed');
  const anchor='      const step = Math.min(d, WALK_STEP);';
  if(source.split(anchor).length!==2)throw new Error('reuse instrumentation anchor changed');
  const token=n=>Object.is(n,-0)?'-0':String(n), keyOf=values=>values.map(token).join(',');
  const jobs=capture.jobs.filter(j=>j.result).sort((a,b)=>a.result.trace.started-b.result.trace.started);
  if(!jobs.length || jobs.some(j=>!Number.isFinite(j.result.trace?.started)))throw new Error('missing worker execution order');
  const modes=[{name:'native',whole:0,suffix:0},{name:'whole512',whole:512,suffix:0},
    {name:'whole512-suffix4096',whole:512,suffix:4096},{name:'whole512-suffix65536',whole:512,suffix:65536}];
  const traces=[];
  let stateTotal=0;
  const make = (mode,collect=false) => {
    const c=new nav._probe.constructor(world,capture.controller);c.enabled=capture.controller.enabled;
    const physics={staticWorld:world,gravity:capture.gravity,MASK:{CHARACTER:capture.mask},
      checkCapsule:(a,b,r,m)=>world.overlapCapsule(a.x,a.y,a.z,b.x,b.y,b.z,r,m,0)===0};
    const ctx={physics,_probe:c,_p0:nav._p0.clone(),_p1:nav._p1.clone(),canStand:nav.canStand,repeatState:true,stats:{endpointChecks:0}};
    const whole=new Map(),suffix=new Map();let moves=0,prefix=[],context='',hit=null,current=null;
    const stat={wholeHits:0,suffixHits:0,suffixCrossKey:0,savedMoves:0,peakEntries:0,peakKeyChars:0};let chars=0;
    const move=c.move;c.move=function(...a){moves++;return move.apply(this,a);};
    const visit=(i,vy,controller)=>{
      const p=controller.position,v=controller.velocity;
      const state=[p.x,p.y,p.z,vy,controller.grounded?1:0,v.x,v.y,v.z];
      const key=context+'|'+keyOf(state), known=suffix.get(key);
      if(collect){if(++stateTotal>500000)throw new Error('reuse state bound exceeded');prefix.push({i,state:state.map(token)});return false;}
      if(known && known.remaining < current.key[8]-i){hit={i,...known};stat.suffixHits++;if(known.identity!==current.identity)stat.suffixCrossKey++;return true;}
      prefix.push({i,key});return false;
    };
    const body=(mode.suffix||collect)?source.replace(anchor,'      if (visit(i, vy, c)) return true;\n'+anchor):source;
    const check=new Function('INFANTRY','WALK_STEP','visit',`return (${body});`)(infantry,walkStep,visit);
    const put=(map,key,value,cap)=>{if(!map.has(key)&&map.size===cap)map.delete(map.keys().next().value);map.set(key,value);};
    const run=()=>{
      const start=performance.now();
      for(const job of jobs){
        const k=job.key.map(Number), identity=keyOf(k), before=moves;
        current={key:k,identity};context=keyOf([k[1],...k.slice(3,8)]);prefix=[];hit=null;
        let value;
        if(mode.whole && whole.has(identity)){value=true;stat.wholeHits++;}
        else value=check.call(ctx,{x:k[0],y:k[1],z:k[2]},{x:k[3],y:k[4],z:k[5]},k[6],k[7],k[8]);
        if(value!==job.result.value)throw new Error(`reuse boolean mismatch ${job.id}/${mode.name}`);
        const executed=moves-before;
        if(mode.name==='native' && executed!==job.result.moves)throw new Error(`reuse move mismatch ${job.id}: ${executed}/${job.result.moves}`);
        stat.savedMoves+=job.result.moves-executed;
        if(collect)traces.push({id:job.id,key:job.key,value,moves:executed,states:prefix});
        if(value && mode.whole)put(whole,identity,true,mode.whole);
        if(value && mode.suffix){
          const total=hit?hit.i+hit.remaining:executed;
          for(const p of prefix){
            const remaining=total-p.i, prior=suffix.get(p.key);
            if(prior && prior.remaining<=remaining)continue;
            if(!prior){if(suffix.size===mode.suffix){const old=suffix.keys().next().value;chars-=old.length;suffix.delete(old);}chars+=p.key.length;}
            suffix.set(p.key,{remaining,identity});
          }
          stat.peakEntries=Math.max(stat.peakEntries,suffix.size);stat.peakKeyChars=Math.max(stat.peakKeyChars,chars);
        }
      }
      return {mode:mode.name,ms:performance.now()-start,moves,...stat};
    };
    return run;
  };
  make(modes[0],true)();
  const timed=[];
  // Each pass starts empty: no future query may donate a proof to an earlier one.
  for(const mode of modes)make(mode)();
  for(let r=0;r<rounds;r++)for(let j=0;j<modes.length;j++)timed.push({round:r,...make(modes[(r+j)%modes.length])()});
  if(engine.time.frame!==frame || !nav.worker.valid)throw new Error('game advanced during reuse replay');
  return {queries:jobs.length,unreturned:capture.jobs.length-jobs.length,traces,timed,
    timing:'post-capture main-thread Chrome replay; not live worker/frame timing',
    stateKey:'exact xyz, requested vy, grounded, clipped velocity; context includes original from.y, destination, dimensions, immutable world/config',
    budget:'remaining motor moves plus an arrival-check iteration must fit; only completed successful prefixes/tails are stored'};
}
