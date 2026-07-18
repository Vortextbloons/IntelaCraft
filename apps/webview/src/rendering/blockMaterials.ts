import * as THREE from "three";

export type MaterialFamily="stone"|"wood"|"earth"|"grass"|"sand"|"brick"|"metal"|"glass"|"foliage"|"water"|"light"|"verification"|"generic";
export interface BlockAppearance{family:MaterialFamily;base:number;accent:number;transparent?:boolean;opacity?:number;emissive?:number}

const exact:Record<string,BlockAppearance>={
 "minecraft:stone":{family:"stone",base:0x7d7d79,accent:0x565754},
 "minecraft:cobblestone":{family:"stone",base:0x777773,accent:0x4b4c49},
 "minecraft:deepslate":{family:"stone",base:0x4b4d50,accent:0x303236},
 "minecraft:dirt":{family:"earth",base:0x76543a,accent:0x503824},
 "minecraft:grass_block":{family:"grass",base:0x638b3c,accent:0x3f6128},
 "minecraft:sand":{family:"sand",base:0xd8c98c,accent:0xb6a66e},
 "minecraft:sandstone":{family:"sand",base:0xd7c58d,accent:0xa99460},
 "minecraft:bricks":{family:"brick",base:0x985646,accent:0x63372f},
 "minecraft:glass":{family:"glass",base:0xa8d5dc,accent:0xe6fbff,transparent:true,opacity:.42},
 "minecraft:water":{family:"water",base:0x2f6fd1,accent:0x75b9ed,transparent:true,opacity:.62},
 "minecraft:gold_block":{family:"metal",base:0xe7bd35,accent:0xffe170},
 "minecraft:iron_block":{family:"metal",base:0xc8c9c4,accent:0xf2f2e9},
 "minecraft:diamond_block":{family:"metal",base:0x45c7bd,accent:0x9bf4e8},
 "minecraft:glowstone":{family:"light",base:0xb88a47,accent:0xf3d58a,emissive:0x6f4b18},
 "minecraft:sea_lantern":{family:"light",base:0xaccfc5,accent:0xe7fff4,emissive:0x547f78},
 "intelacraft:missing":{family:"verification",base:0xffd43b,accent:0xfff0a6,emissive:0x5e4800},
 "intelacraft:incorrect":{family:"verification",base:0xff5252,accent:0xffb0a9,emissive:0x651414},
 "intelacraft:unexpected":{family:"verification",base:0xb26bff,accent:0xdec2ff,emissive:0x3d1765},
};

function includes(id:string,...parts:string[]){return parts.some(part=>id.includes(part))}
export function blockAppearance(id:string):BlockAppearance{
 const known=exact[id];if(known)return known;
 if(includes(id,"glass","ice"))return{family:"glass",base:0x9cc8d2,accent:0xe3f5f6,transparent:true,opacity:.46};
 if(includes(id,"leaves","moss","vine","cactus"))return{family:"foliage",base:0x477b3a,accent:0x79a64e,transparent:true,opacity:.9};
 if(includes(id,"log","wood","planks","stem","hyphae","bamboo"))return{family:"wood",base:0x9a7045,accent:0x60452d};
 if(includes(id,"brick","terracotta"))return{family:"brick",base:0x965947,accent:0x653b31};
 if(includes(id,"sand","end_stone"))return{family:"sand",base:0xd2c18b,accent:0xaa9867};
 if(includes(id,"grass","podzol","mycelium","dirt","mud","clay"))return{family:"earth",base:0x75573d,accent:0x4e3827};
 if(includes(id,"ore","iron","gold","copper","diamond","emerald","netherite","lapis","redstone"))return{family:"metal",base:0x8f9697,accent:0xc9d0cf};
 if(includes(id,"torch","lantern","light","shroomlight","magma"))return{family:"light",base:0xd69b43,accent:0xffdf7b,emissive:0x6c4311};
 if(includes(id,"stone","slate","tuff","basalt","blackstone","quartz","prismarine","concrete"))return{family:"stone",base:0x777b79,accent:0x515553};
 return{family:"generic",base:0x8b8173,accent:0x5d574e};
}

function channel(value:number,shift:number){return(value>>shift)&255}
function mix(a:number,b:number,t:number){return Math.round(a+(b-a)*t)}
function seeded(id:string,x:number,y:number){let h=2166136261;for(const c of `${id}:${x}:${y}`)h=Math.imul(h^c.charCodeAt(0),16777619);return(h>>>0)/4294967295}
function texturePixels(id:string,face:"side"|"top"|"bottom",appearance:BlockAppearance){
 const size=16,data=new Uint8Array(size*size*4),base=appearance.base,accent=appearance.accent;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const noise=seeded(id,x,y),mortar=appearance.family==="brick"&&(y%5===0||((x+(Math.floor(y/5)%2)*4)%8===0));
  const grain=appearance.family==="wood"&&(face==="top"?Math.max(Math.abs(x-7.5),Math.abs(y-7.5))%3<1:y%5===0);
  const speckle=["stone","earth","sand","generic"].includes(appearance.family)&&noise>.78;
  const leaf=appearance.family==="foliage"&&noise>.82;
  const metal=appearance.family==="metal"&&(x+y)%9===0;
  const glass=appearance.family==="glass"&&(x===1||y===1||x===14||y===14||x===y);
  const water=appearance.family==="water"&&(y+(x>>2))%6===0;
  const useAccent=mortar||grain||speckle||leaf||metal||glass||water;
  let t=useAccent?.72:.08+noise*.14;
  if(face==="top")t+=.08;else if(face==="bottom")t-=.12;
  const i=(y*size+x)*4;
  data[i]=mix(channel(base,16),channel(accent,16),t);data[i+1]=mix(channel(base,8),channel(accent,8),t);data[i+2]=mix(channel(base,0),channel(accent,0),t);data[i+3]=255;
 }
 const texture=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestMipmapNearestFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;
}

export interface BlockMaterialSet{materials:THREE.MeshStandardMaterial[];textures:THREE.Texture[]}
export function createBlockMaterials(id:string):BlockMaterialSet{
 const appearance=blockAppearance(id),side=texturePixels(id,"side",appearance),top=texturePixels(id,"top",appearance),bottom=texturePixels(id,"bottom",appearance);
 const options=(map:THREE.Texture):THREE.MeshStandardMaterialParameters=>({map,color:0xffffff,roughness:appearance.family==="metal"?.48:.9,metalness:appearance.family==="metal"?.3:0,transparent:appearance.transparent,opacity:appearance.opacity??1,depthWrite:!appearance.transparent,alphaTest:appearance.family==="foliage"?.08:0,emissive:appearance.emissive,emissiveIntensity:appearance.emissive?.32:0});
 return{materials:[new THREE.MeshStandardMaterial(options(side)),new THREE.MeshStandardMaterial(options(side)),new THREE.MeshStandardMaterial(options(top)),new THREE.MeshStandardMaterial(options(bottom)),new THREE.MeshStandardMaterial(options(side)),new THREE.MeshStandardMaterial(options(side))],textures:[side,top,bottom]};
}
