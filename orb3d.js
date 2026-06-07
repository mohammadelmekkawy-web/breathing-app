// orb3d.js — experimental genuine-3D glowing liquid orb (Three.js).
//
// Loaded LAZILY (dynamic import) only when the "Liquid orb (3D)" visual is
// selected AND reduced-motion is off. Rendering is driven by the app's single
// breathing timer via update(fill, timeMs) — there is no separate animation
// loop here, so it stays perfectly in sync and stops when the session does.
// If anything fails, the app falls back to the 2D orb (see app.js), so the
// breathing experience is never affected.
//
// Design notes (kept deliberately lightweight for phones):
//  - One liquid sphere shaded by a custom fragment shader that DISCARDS
//    fragments above a wavy waterline → the liquid fills the lower part of the
//    sphere and the waterline undulates in 3D (sum of slow sine modes + a
//    slowly-rotating tilt = calm rolling slosh).
//  - One faint fresnel "glass" shell.
//  - A small GPU points system (≈150) for drifting, twinkling magical dots that
//    only show once submerged (more appear as the liquid rises).
import * as THREE from './vendor/three.module.min.js';

let renderer, scene, camera, canvas;
let lastW = 0, lastH = 0;
const R = 0.92; // liquid radius (glass shell is 1.0)

// Shared uniforms (same objects referenced by multiple materials, so a single
// update() call drives them all).
const shared = {
  uTime: { value: 0 },
  uFill: { value: 0 },
  uRadius: { value: R },
  uPx: { value: 1 },
};

export function init(cnv) {
  canvas = cnv;
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  const pxr = Math.min(2, window.devicePixelRatio || 1);
  renderer.setPixelRatio(pxr);
  renderer.setClearColor(0x000000, 0);
  shared.uPx.value = pxr;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
  camera.position.set(0, 0, 3.4);

  const liquidGeo = new THREE.SphereGeometry(R, 64, 48);

  // ---------- Liquid ----------
  const liquidMat = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uFill: shared.uFill, uRadius: shared.uRadius },
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    vertexShader: [
      'varying vec3 vLocal; varying vec3 vN; varying vec3 vView;',
      'void main(){',
      '  vLocal = position;',
      '  vec4 wp = modelMatrix * vec4(position,1.0);',
      '  vN = normalize(mat3(modelMatrix) * normal);',
      '  vView = normalize(cameraPosition - wp.xyz);',
      '  gl_Position = projectionMatrix * viewMatrix * wp;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform float uTime, uFill, uRadius;',
      'varying vec3 vLocal; varying vec3 vN; varying vec3 vView;',
      'float waves(vec3 p){',
      '  float t = uTime; float w = 0.0;',
      '  w += 0.060*sin(p.x*1.6 + t*0.50);',
      '  w += 0.050*sin(p.z*1.7 - t*0.42);',
      '  w += 0.040*sin((p.x+p.z)*1.25 + t*0.66);',
      '  w += 0.030*sin(p.x*2.6 - t*0.80);',
      '  w += 0.060*(p.x*sin(t*0.30) + p.z*cos(t*0.30));', // slow rotating tilt → 3D rolling
      '  return w*uRadius;',
      '}',
      'void main(){',
      '  float surf = (-uRadius + 2.0*uRadius*uFill) + waves(vLocal);',
      '  if (vLocal.y > surf) discard;',                  // above the wavy waterline → empty
      '  float depthBelow = clamp((surf - vLocal.y)/(2.0*uRadius), 0.0, 1.0);',
      '  vec3 col = mix(vec3(0.42,0.68,0.90), vec3(0.07,0.25,0.47), depthBelow);',
      '  float sheen = smoothstep(0.10, 0.0, surf - vLocal.y);', // bright band at the surface
      '  col += sheen*0.22;',
      '  float facing = clamp(dot(vN, vView), 0.0, 1.0);',
      '  col += facing*0.10*vec3(0.5,0.75,1.0);',         // soft inner glow toward the viewer
      '  gl_FragColor = vec4(col, 0.85);',
      '}'
    ].join('\n'),
  });
  scene.add(new THREE.Mesh(liquidGeo, liquidMat));

  // ---------- Glass shell (faint fresnel rim) ----------
  const glassMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide, blending: THREE.AdditiveBlending,
    vertexShader: [
      'varying vec3 vN; varying vec3 vView;',
      'void main(){',
      '  vec4 wp = modelMatrix * vec4(position,1.0);',
      '  vN = normalize(mat3(modelMatrix)*normal);',
      '  vView = normalize(cameraPosition - wp.xyz);',
      '  gl_Position = projectionMatrix * viewMatrix * wp;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'varying vec3 vN; varying vec3 vView;',
      'void main(){',
      '  float fres = pow(1.0 - clamp(dot(vN,vView),0.0,1.0), 3.0);',
      '  gl_FragColor = vec4(vec3(0.55,0.78,1.0)*fres*0.6, fres*0.5);',
      '}'
    ].join('\n'),
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.0, 48, 32), glassMat));

  // ---------- Magical particles ----------
  const N = 150;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  const warm = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let x, y, z;
    do { x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1; }
    while (x * x + y * y + z * z > 0.85);
    pos[i * 3] = x * R * 0.92; pos[i * 3 + 1] = y * R * 0.92; pos[i * 3 + 2] = z * R * 0.92;
    seed[i] = Math.random();
    warm[i] = Math.random() < 0.42 ? 1 : 0;
  }
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pgeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  pgeo.setAttribute('aWarm', new THREE.BufferAttribute(warm, 1));
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uFill: shared.uFill, uRadius: shared.uRadius, uPx: shared.uPx },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: [
      'attribute float aSeed; attribute float aWarm;',
      'uniform float uTime, uFill, uRadius, uPx;',
      'varying float vA; varying float vWarm;',
      'void main(){',
      '  vec3 p = position;',
      '  p.x += sin(uTime*0.30 + aSeed*6.28)*0.03;',
      '  p.y += sin(uTime*0.25 + aSeed*5.0)*0.03;',
      '  p.z += cos(uTime*0.28 + aSeed*4.0)*0.03;',
      '  float surf = -uRadius + 2.0*uRadius*uFill;',     // simple waterline for dots
      '  float sub = step(p.y, surf);',                   // 1 if submerged
      '  float fade = clamp((surf - p.y)/0.18, 0.0, 1.0);',
      '  vA = sub * fade * (0.40 + 0.60*max(0.0, sin(uTime*(0.5+aSeed*0.8) + aSeed*6.28)));',
      '  vWarm = aWarm;',
      '  vec4 mv = modelViewMatrix * vec4(p,1.0);',
      '  gl_PointSize = sub * (3.0 + aSeed*5.0) * uPx;',
      '  gl_Position = projectionMatrix * mv;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'varying float vA; varying float vWarm;',
      'void main(){',
      '  vec2 d = gl_PointCoord - 0.5;',
      '  float r = length(d);',
      '  if (r > 0.5) discard;',
      '  float glow = smoothstep(0.5, 0.0, r);',
      '  vec3 c = mix(vec3(1.0,0.97,0.9), vec3(1.0,0.86,0.55), vWarm);',
      '  gl_FragColor = vec4(c, glow * vA);',
      '}'
    ].join('\n'),
  });
  scene.add(new THREE.Points(pgeo, pMat));
}

// Driven by the app's render loop (single timer). Returns nothing; safe to call
// every frame. Skips when the canvas has no size (e.g. still hidden).
export function update(fill, timeMs) {
  if (!renderer || !canvas) return;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (w !== lastW || h !== lastH) {
    lastW = w; lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  shared.uTime.value = timeMs / 1000;
  shared.uFill.value = fill;
  renderer.render(scene, camera);
}

export function dispose() {
  try { if (renderer) renderer.dispose(); } catch (e) {}
  renderer = null; scene = null; camera = null; canvas = null;
  lastW = lastH = 0;
}
