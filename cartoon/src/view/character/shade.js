// Palette texture + crisp anime cel material (tinted shadows, soft rim) + inverted-hull outline material.
import * as THREE from 'three';
import { PAL_N, SLOT } from './sculpt.js';

export function makePalette() {
  const data = new Uint8Array(PAL_N * 4);
  const tex = new THREE.DataTexture(data, PAL_N, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
const _c = new THREE.Color(), _h = {};
function setSlot(tex, slot, hex) {
  _c.set(hex);
  const d = tex.image.data;
  d[slot * 4] = Math.round(_c.r * 255); d[slot * 4 + 1] = Math.round(_c.g * 255); d[slot * 4 + 2] = Math.round(_c.b * 255); d[slot * 4 + 3] = 255;
}
// NOTE: THREE.Color.set(hex) with SRGB colour management converts to linear; the texture stores sRGB bytes, so convert back.
function setSlotSRGB(tex, slot, hex) {
  _c.set(hex);
  const s = _c.getHex(THREE.SRGBColorSpace);
  const d = tex.image.data;
  d[slot * 4] = (s >> 16) & 255; d[slot * 4 + 1] = (s >> 8) & 255; d[slot * 4 + 2] = s & 255; d[slot * 4 + 3] = 255;
}
export function hairShade(hex, l = 0.78, sat = 1.08, hue = 0.015) {
  _c.set(hex); _c.getHSL(_h);
  _c.setHSL((_h.h + hue + 1) % 1, Math.min(1, _h.s * sat), _h.l * l);
  return '#' + _c.getHexString(THREE.SRGBColorSpace);
}
export function fillPalette(tex, look) {
  setSlotSRGB(tex, SLOT.skin, look.skin);
  setSlotSRGB(tex, SLOT.hair, look.hair);
  setSlotSRGB(tex, SLOT.hair2, look.hair2 || hairShade(look.hair));
  setSlotSRGB(tex, SLOT.shirt, look.shirt);
  setSlotSRGB(tex, SLOT.shorts, look.shorts);
  setSlotSRGB(tex, SLOT.shoes, look.shoes);
  setSlotSRGB(tex, SLOT.accent, look.accent);
  setSlotSRGB(tex, SLOT.band, look.accent);
  setSlotSRGB(tex, SLOT.white, '#f6f4ee');
  setSlotSRGB(tex, SLOT.dark, '#2a2634');
  setSlotSRGB(tex, SLOT.sole, '#fbfbf6');
  setSlotSRGB(tex, SLOT.sleeve, look.sleeve || (look.block ? look.accent : look.shirt));
  setSlotSRGB(tex, SLOT.trim, look.trim || '#f6f4ee');
  setSlotSRGB(tex, SLOT.skin2, look.skin);
  setSlotSRGB(tex, SLOT.hair3, look.vest || look.accent);
  setSlotSRGB(tex, SLOT.mouth, '#b8463f');
  void setSlot;
  tex.needsUpdate = true;
}

const AUX_VERT = {
  head: `attribute vec4 aux; varying vec4 vAux;`,
  body: `vAux = aux;`,
};

export function makeToon(map) {
  const m = new THREE.MeshLambertMaterial({ map });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${AUX_VERT.head}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${AUX_VERT.body}`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec4 vAux;')
      .replace('#include <opaque_fragment>',
        `{
           vec3 alb = diffuseColor.rgb;
           vec3 N = normalize(normal);
           #if NUM_DIR_LIGHTS > 0
             vec3 Ld = normalize(directionalLights[0].direction);
           #else
             vec3 Ld = normalize(vec3(0.35, 0.8, 0.5));
           #endif
           float nl = dot(N, Ld);
           nl = mix(nl, nl * 0.3 + 0.5, vAux.w);                        // head skin: evenly lit
           float lit = smoothstep(0.02, 0.14, nl);
           float deep = smoothstep(-0.62, -0.45, nl);
           float lum = dot(alb, vec3(0.2126, 0.7152, 0.0722));
           vec3 sat = mix(vec3(lum), alb, 1.22);
           vec3 shadowT = sat * vec3(0.60, 0.55, 0.80);
           vec3 deepT = shadowT * vec3(0.66, 0.64, 0.82);
           vec3 col = mix(deepT, shadowT, deep);
           col = mix(col, alb, lit);
           col = mix(col, shadowT, smoothstep(0.42, 0.58, vAux.y) * 0.95);   // baked occlusion (under fringe, under chin, hair layers)
           vec3 hlT = mix(alb, vec3(1.0, 0.97, 0.9), 0.5) + vec3(0.03);
           col = mix(col, hlT, smoothstep(0.42, 0.58, vAux.x) * mix(0.75, 1.0, lit));
           float rim = 1.0 - saturate(dot(N, normalize(vViewPosition)));
           col += vec3(1.0, 0.93, 0.82) * smoothstep(0.58, 0.82, rim) * 0.12 * lit * (1.0 - vAux.w);
           outgoingLight = col;
         }
         #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'cc-anime-toon-1';
  return m;
}

export function makeOutlineMaterial(map) {
  const m = new THREE.MeshBasicMaterial({ map, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n${AUX_VERT.head}`)
      .replace('#include <skinning_vertex>',
        `#include <skinning_vertex>
         {
           #ifdef USE_SKINNING
             vec3 on_ = normalize(objectNormal);
           #else
             vec3 on_ = normalize(normal);
           #endif
           float dd = -(modelViewMatrix * vec4(transformed, 1.0)).z;
           transformed += on_ * clamp(dd * 0.0016, 0.0035, 0.011) * aux.z;
         }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
      `#include <map_fragment>
       {
         float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
         vec3 sat = mix(vec3(lum), diffuseColor.rgb, 1.2);
         diffuseColor.rgb = sat * vec3(0.12, 0.09, 0.16) + vec3(0.006, 0.004, 0.02);
       }`);
  };
  m.customProgramCacheKey = () => 'cc-anime-outline-1';
  return m;
}
