/* Presentation geometry only: labels stay on their own bubble's lower half. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.GraphLabelLayout=factory();
})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const intersects=(a,b,gap=4)=>a.x<b.width+b.x+gap&&b.x<a.x+a.width+gap&&
    a.y<b.y+b.height+gap&&b.y<a.y+a.height+gap;
  function lowerHalfBox({point,radius,size,bounds,placed=[],neighbors=[],required=false}){
    if(![point.x,point.y,radius,size.width,size.height].every(Number.isFinite))return null;
    const y=point.y+Math.min(8,radius*.22),width=size.width,height=size.height;
    const offsets=[0,-.22,.22,-.4,.4].map(fraction=>fraction*radius);
    let fallback=null;
    for(const offset of offsets){
      const x=point.x-width/2+offset,box={x,y,width,height,placement:'lower-half'};
      // Never detach an edge-clipped label by clamping it to a distant margin.
      if(x<bounds.left||x+width>bounds.right||y<bounds.top||y+height>bounds.bottom)continue;
      fallback??=box;
      if(placed.some(other=>intersects(box,other)))continue;
      if(neighbors.some(other=>Math.hypot(other.x-Math.max(x,Math.min(other.x,x+width)),
          other.y-Math.max(y,Math.min(other.y,y+height)))<other.r+2))continue;
      return {...box,collision:false};
    }
    if(required){
      // The selected tag takes priority over automatic labels, not a remote caption.
      return {...(fallback||{x:point.x-width/2,y,width,height,placement:'lower-half'}),collision:true};
    }
    return null;
  }
  return {lowerHalfBox,intersects};
});
