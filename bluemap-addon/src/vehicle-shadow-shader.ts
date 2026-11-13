/** CraftShadow.cast's four coverage samples and sun-light composition, on current terrain. */
export const vehicleShadowFragment = `
uniform sampler2D ground; uniform sampler2D shaded; uniform sampler2D silhouette;
uniform vec2 tileOrigin; uniform vec2 shapeSize; uniform vec2 shapeOrigin;
uniform vec3 sun; uniform vec3 e1; uniform vec3 e2; uniform vec3 origin;
uniform float texels; uniform float pitchSin; uniform float pitchCos; uniform float originDepth;
varying vec2 tileUv;
void main() {
 vec4 g=texture2D(ground,tileUv);
 if(!(g.x>-1.0e20&&g.x<1.0e20)||g.z<=0.0)discard;
 vec2 pixel=floor(tileUv*512.0); float coverage=0.0;
 for(int y=0;y<2;y++)for(int x=0;x<2;x++) {
   vec2 uv=tileOrigin+(pixel+(vec2(float(x),float(y))+.5)/2.0)/4.0;
   vec3 relative=vec3(uv.x,g.x,(uv.y+g.x*pitchCos)/pitchSin)-origin;
   vec2 cell=floor((vec2(dot(relative,e1),dot(relative,e2))-shapeOrigin)*texels);
   if(any(lessThan(cell,vec2(0.0)))||any(greaterThanEqual(cell,shapeSize)))continue;
   float reach=texture2D(silhouette,(cell+.5)/shapeSize).r;
   if(reach>dot(relative,sun)+.05)coverage+=.25;
 }
 if(coverage==0.0)discard;
 vec4 color=texture2D(shaded,tileUv);
 if(color.a>0.0)gl_FragColor=vec4(color.rgb,coverage);
 else gl_FragColor=vec4(0.0,0.0,0.0,(1.0-pow(1.0-g.z,1.0/2.2))*coverage);
 gl_FragDepth=(32768.0+g.y-originDepth-.15)/65536.0;
 #include <colorspace_fragment>
}`;
