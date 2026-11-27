/* Display-only motion. Recorded coordinates, graph weights and sources stay unchanged. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.GraphMotion=api;
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const SETTINGS=Object.freeze({returnFactor:5,orbitFactor:2,flowX:2.2,flowY:1.4,
    flowXPeriodMs:50000,flowYPeriodMs:70000,pulsePeriodMs:18000,pulseDepth:.025});
  const finite=value=>Number.isFinite(value)?value:0;
  const elapsed=(interval,stallMs=250)=>Number.isFinite(interval)&&interval>0&&interval<=stallMs?interval:0;
  const ease=value=>{const t=Math.max(0,Math.min(1,finite(value)));return t*t*(3-2*t);};
  function returnDuration(distance,baseline,pathLength=distance,dragReturn=true){
    const px=Math.max(0,finite(distance)),factor=dragReturn?SETTINGS.returnFactor:1;
    const legacy=Math.min(baseline.maxReturnMs,Math.max(baseline.returnMs,px*2.5));
    // Smoothstep's peak derivative is 1.5. Preserve the 5x time scale and bound
    // even very long off-canvas drags by one fifth of baseline's nominal cap.
    const velocity=baseline.maxStepPx*(1000/baseline.frameMs)/factor;
    return Math.max(legacy*factor,Math.max(px,finite(pathLength))*1.5/velocity*1000);
  }
  function returnPathLength(from,to,polar=false){
    if(!polar)return Math.hypot(to.x-from.x,to.y-from.y);
    const a=Math.atan2(from.y,from.x),b=Math.atan2(to.y,to.x),r0=Math.hypot(from.x,from.y),r1=Math.hypot(to.x,to.y);
    return Math.abs(r1-r0)+Math.max(r0,r1)*Math.abs(Math.atan2(Math.sin(b-a),Math.cos(b-a)));
  }
  function flow(timeMs){
    const t=Math.max(0,finite(timeMs));
    return {x:SETTINGS.flowX*Math.sin(t*Math.PI*2/SETTINGS.flowXPeriodMs),
      y:SETTINGS.flowY*Math.sin(t*Math.PI*2/SETTINGS.flowYPeriodMs)};
  }
  function phase(id){
    let hash=2166136261;
    for(const char of String(id)){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619);}
    return (hash>>>0)/4294967296*Math.PI*2;
  }
  function opacity(timeMs,id){
    return 1-SETTINGS.pulseDepth*(.5+.5*Math.sin(Math.max(0,finite(timeMs))*Math.PI*2/SETTINGS.pulsePeriodMs+phase(id)));
  }
  function orbitDelta(interval,band,baseline){
    return elapsed(interval,baseline.stallMs)/1000*baseline.orbitRate*SETTINGS.orbitFactor/(1+Math.max(0,finite(band))*.12);
  }
  function labelIds(automatic,selectedId,walkIds,overrides){
    const ids=new Set([...automatic,...walkIds]);
    if(selectedId)ids.add(selectedId);
    for(const [id,shown]of overrides)shown?ids.add(id):ids.delete(id);
    return ids;
  }
  return {SETTINGS,elapsed,ease,returnDuration,returnPathLength,flow,opacity,orbitDelta,labelIds};
});
