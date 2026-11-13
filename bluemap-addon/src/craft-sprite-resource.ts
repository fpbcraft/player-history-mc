import * as T from "three";
import { decodeCraftSprite, type CraftSprite } from "./craft-sprite-format.js";
import { publicBytes } from "./vehicle-http.js";

export interface CraftSpriteResource {
  key: string;
  sprite: CraftSprite;
  mesh: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
  color: T.Texture;
  depth: T.DataTexture;
  image: ImageBitmap;
}
export const releaseCraftSprite = (entry: CraftSpriteResource): void => {
  entry.mesh.geometry.dispose();
  entry.mesh.material.dispose();
  entry.color.dispose();
  entry.depth.dispose();
  entry.image.close();
};
export const loadCraftSprite = async (
  url: string,
  atlas: string,
  key: string,
  signal: AbortSignal,
): Promise<CraftSpriteResource> => {
  const [sprite, png] = await Promise.all([
    publicBytes(url, signal, 17 * 1024 * 1024).then(decodeCraftSprite),
    publicBytes(atlas, signal, 16 * 1024 * 1024),
  ]);
  const header = new DataView(png);
  if (
    png.byteLength < 24 ||
    header.getUint32(0) !== 0x89504e47 ||
    header.getUint32(16) !== sprite.width ||
    header.getUint32(20) !== sprite.height
  )
    throw Error("Craft atlas dimensions do not match depth");
  const image = await createImageBitmap(new Blob([png]));
  if (signal.aborted) {
    image.close();
    throw Error("Obsolete craft sprite");
  }
  const color = new T.Texture(image);
  color.flipY = false;
  color.colorSpace = T.SRGBColorSpace;
  color.magFilter = color.minFilter = T.NearestFilter;
  color.generateMipmaps = false;
  color.needsUpdate = true;
  const depth = new T.DataTexture(
    sprite.depth,
    sprite.width,
    sprite.height,
    T.RedFormat,
    T.FloatType,
  );
  depth.needsUpdate = true;
  const geometry = new T.BufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute("position", new T.Float32BufferAttribute(new Float32Array(12), 3));
  geometry.setAttribute("uv", new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  const material = new T.ShaderMaterial({
    side: T.DoubleSide,
    transparent: true,
    depthWrite: true,
    uniforms: { picture: { value: color }, near: { value: depth }, anchor: { value: 0 } },
    vertexShader: "varying vec2 craftUv;void main(){craftUv=uv;gl_Position=vec4(position,1.0);}",
    fragmentShader: `uniform sampler2D picture;uniform sampler2D near;uniform float anchor;varying vec2 craftUv;
      void main(){vec4 pixel=texture2D(picture,craftUv);if(pixel.a<0.01)discard;float d=texture2D(near,craftUv).r;
      if(!(d>-1.0e20&&d<1.0e20))d=0.0;gl_FragDepth=(32768.0+d+anchor-0.3)/65536.0;gl_FragColor=pixel;
      #include <colorspace_fragment>
      }`,
  });
  return { key, sprite, mesh: new T.Mesh(geometry, material), color, depth, image };
};
