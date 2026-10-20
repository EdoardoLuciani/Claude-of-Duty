// The same deliberately limited lighting function is compiled by both renderers.
export const shadowCode = `fn labShadow(p:vec3<f32>, sm:mat4x4<f32>, map:texture_depth_2d) -> f32 {
 let clip=sm*vec4<f32>(p,1.0);let q=clip.xyz/clip.w;
 let uv=vec2<f32>(q.x*0.5+0.5,0.5-q.y*0.5);
 if(any(uv<vec2<f32>(0.0))||any(uv>vec2<f32>(1.0))||q.z<0.0||q.z>1.0){return -1.0;}
 let dims=vec2<i32>(textureDimensions(map));let base=vec2<i32>(floor(uv*vec2<f32>(dims)));
 var lit=0.0;
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let z=textureLoad(map,clamp(base+vec2<i32>(x,y),vec2<i32>(0),dims-vec2<i32>(1)),0);
  lit+=select(0.3,1.0,q.z-0.0007<=z);
 }}return lit*0.25;
}`;
export const lightingCode = `fn labLighting(p:vec3<f32>, n:vec3<f32>, tint:vec3<f32>, light:vec4<f32>, sm0:mat4x4<f32>, sm1:mat4x4<f32>, sm2:mat4x4<f32>, map0:texture_depth_2d, map1:texture_depth_2d, map2:texture_depth_2d) -> vec4<f32> {
 var shadow=labShadow(p,sm0,map0);
 if(shadow<0.0){shadow=labShadow(p,sm1,map1);}if(shadow<0.0){shadow=labShadow(p,sm2,map2);}if(shadow<0.0){shadow=1.0;}
 let diffuse=max(dot(normalize(n),light.xyz),0.0);
 let color=tint*(light.w+(1.0-light.w)*diffuse*shadow);
 return vec4<f32>(pow(max(color,vec3<f32>(0.0)),vec3<f32>(1.0/2.2)),1.0);
}`;
export const vertexCode = `
 struct Frame { vp:mat4x4<f32>, shadows:array<mat4x4<f32>,3>, light:vec4<f32> };
 struct ObjectData { world:mat4x4<f32>, normal:mat4x4<f32>, bind:mat4x4<f32>, bindInv:mat4x4<f32> };
 @group(0) @binding(0) var<uniform> frame:Frame;
 @group(1) @binding(0) var<storage,read> objects:array<ObjectData>;
 @group(1) @binding(1) var<storage,read> bones:array<mat4x4<f32>>;
 struct VertexOut { @builtin(position) clip:vec4<f32>, @location(0) world:vec3<f32>, @location(1) normal:vec3<f32>, @location(2) @interpolate(flat) material:u32 };
 @vertex fn vs(@location(0) p:vec3<f32>, @location(1) n:vec3<f32>, @location(2) joints:vec4<u32>, @location(3) weights:vec4<f32>, @location(4) instance:vec4<u32>) -> VertexOut {
  let object=objects[instance.x];var position=p;var normal=n;
  if(instance.z!=0xffffffffu){
   let b0=bones[instance.z+joints.x];let b1=bones[instance.z+joints.y];let b2=bones[instance.z+joints.z];let b3=bones[instance.z+joints.w];
   let v=object.bind*vec4<f32>(p,1.0);
   let skinned=b0*v*weights.x+b1*v*weights.y+b2*v*weights.z+b3*v*weights.w;
   position=(object.bindInv*skinned).xyz;
   let skin=object.bindInv*(b0*weights.x+b1*weights.y+b2*weights.z+b3*weights.w)*object.bind;
   normal=(skin*vec4<f32>(n,0.0)).xyz;
  }
  let world=object.world*vec4<f32>(position,1.0);
  var out:VertexOut;out.clip=frame.vp*world;out.world=world.xyz;out.normal=(object.normal*vec4<f32>(normal,0.0)).xyz;out.material=instance.y;return out;
 }
`;
export const colorCode = `
 @group(2) @binding(0) var shadow0:texture_depth_2d;
 @group(2) @binding(1) var shadow1:texture_depth_2d;
 @group(2) @binding(2) var shadow2:texture_depth_2d;
 @group(2) @binding(3) var<storage,read> colors:array<vec4<f32>>;
 ${shadowCode}\n${lightingCode}
 @fragment fn fs(in:VertexOut) -> @location(0) vec4<f32> { return labLighting(in.world,in.normal,colors[in.material].xyz,frame.light,frame.shadows[0],frame.shadows[1],frame.shadows[2],shadow0,shadow1,shadow2); }
`;
export const depthCode =
  '@fragment fn fs() -> @location(0) vec4<f32> {return vec4<f32>(0.0,0.0,0.0,1.0);}';
