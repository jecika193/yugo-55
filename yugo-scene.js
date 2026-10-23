// Yugo 55 — hero scene. Self-contained ES module; mounts into #yugo-canvas.
// Requires an importmap for "three" and "three/addons/" (three@0.169.0).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const MODEL_URL = "1985_yugo_gv.glb"; // REPLACE_WITH_GLB_URL for production
const DRACO_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';
const PAINT_MATERIAL = null; // optional: exact material name of the body paint
const MODEL_LENGTH = 4;      // scene units the car is normalised to

const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function buildStudio() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x010102);
  const panel = (w, h, intensity, pos, rot) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(intensity), side: THREE.DoubleSide })
    );
    m.position.set(...pos);
    m.rotation.set(...rot);
    s.add(m);
  };
  // two long thin strips overhead, running front-to-back (Z)
  panel(0.32, 16, 9, [-1.05, 5.2, 0], [Math.PI / 2, 0, 0]);
  panel(0.32, 16, 9, [1.05, 5.2, 0], [Math.PI / 2, 0, 0]);
  // large soft panel, left side
  panel(9, 3.6, 2.4, [-7.5, 2.4, 0], [0, Math.PI / 2, 0]);
  // faint panel behind
  panel(12, 3, 0.45, [0, 2.2, -10], [0, 0, 0]);
  // very faint low kicker on the right so the right flank isn't pure void
  panel(10, 0.6, 0.25, [7.5, 0.9, 0], [0, -Math.PI / 2, 0]);
  return s;
}

function contactTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)');
  grd.addColorStop(0.45, 'rgba(0,0,0,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function meshArea(mesh) {
  const g = mesh.geometry, pos = g.attributes.position, idx = g.index;
  if (!pos) return 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = idx ? idx.count : pos.count;
  let s = 0;
  for (let i = 0; i < n; i += 3) {
    const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
    s += b.sub(a).cross(c.sub(a)).length() * 0.5;
  }
  return s;
}

export function mountYugo(container, opts = {}) {
  const { heroEl = container, onProgress, onLoad, onError, onPreset } = opts;
  let frontSign = opts.frontSign ?? 1;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) {
    onError?.(e);
    return { goTo() {}, setPaintColor() {}, setFrontSign() {}, dispose() {} };
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%', outline: 'none' });
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  camera.position.set(6, 2.5, 8);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(buildStudio(), 0.02);
  scene.environment = envRT.texture;

  scene.add(new THREE.HemisphereLight(0xdfe3ea, 0x0a0a0b, 0.12));
  const key = new THREE.DirectionalLight(0xfff3e6, 1.5);
  key.position.set(3.5, 8, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 25 });
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xcfdcff, 2.4);
  rim.position.set(-2, 5.5, -8);
  scene.add(rim);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.ShadowMaterial({ opacity: 0.5 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.autoRotate = !reduced;
  controls.autoRotateSpeed = 0.4;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  renderer.domElement.style.touchAction = coarse ? 'pan-y' : 'none';

  let paintMat = null, paintOriginal = null, pendingPaint = opts.paintColor ?? null;
  const applyPaint = hex => {
    pendingPaint = hex;
    if (!paintMat) return;
    if (hex) paintMat.color.set(hex); else paintMat.color.copy(paintOriginal);
    paintMat.map = hex ? null : paintMat.userData.origMap;
    paintMat.needsUpdate = true;
  };
  let dims = null, R = 2.3, fitDist = 9, targetDist = 9, tween = null, resumeTimer = 0, model = null;

  function computeFit() {
    const vf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hf = Math.atan(Math.tan(vf) * camera.aspect);
    fitDist = (R / Math.sin(Math.min(vf, hf))) * 1.02;
    controls.minDistance = R * 1.25;
    controls.maxDistance = fitDist * 1.3;
    targetDist = clamp(targetDist, controls.minDistance, controls.maxDistance);
  }

  function presets() {
    if (!dims) return {};
    const { w, h, l } = dims, f = frontSign, t = new THREE.Vector3(0, h * 0.5, 0);
    const p = (dir, dist, target = t) => ({ dir: new THREE.Vector3(...dir).normalize(), dist, target });
    return {
      hero:   p([0.82, 0.3, 0.95 * f], fitDist * 1.05, new THREE.Vector3(0, h * 0.62, 0)),
      front:  p([0.16, 0.16, 1 * f], fitDist * 0.9),
      side:   p([1, 0.1, 0.02 * f], fitDist * 0.92),
      rear:   p([-0.28, 0.24, -1 * f], fitDist * 0.9),
      detail: p([0.75, 0.12, 0.7 * f], controls.minDistance * 1.05, new THREE.Vector3(w * 0.28, h * 0.42, l * 0.32 * f)),
    };
  }

  function setCam(pr) {
    controls.target.copy(pr.target);
    camera.position.copy(pr.target).addScaledVector(pr.dir, pr.dist);
    targetDist = clamp(pr.dist, controls.minDistance, controls.maxDistance);
    controls.update();
  }

  function scheduleResume() {
    clearTimeout(resumeTimer);
    if (reduced) return;
    resumeTimer = setTimeout(() => { controls.autoRotate = true; }, 3000);
  }

  controls.addEventListener('start', () => {
    clearTimeout(resumeTimer);
    controls.autoRotate = false;
    onPreset?.(null);
  });
  controls.addEventListener('end', scheduleResume);

  function goTo(name) {
    const pr = presets()[name];
    if (!pr) return;
    clearTimeout(resumeTimer);
    controls.autoRotate = false;
    onPreset?.(name);
    if (reduced) { setCam(pr); return; }
    const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    const to = new THREE.Spherical().setFromVector3(pr.dir.clone().multiplyScalar(clamp(pr.dist, controls.minDistance, controls.maxDistance)));
    let dTheta = to.theta - from.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    tween = { t0: performance.now(), dur: 1400, from, to, dTheta, fromT: controls.target.clone(), toT: pr.target.clone() };
    controls.enabled = false;
  }

  function stepTween(now) {
    const k = clamp((now - tween.t0) / tween.dur, 0, 1), e = easeInOut(k);
    const s = new THREE.Spherical(
      THREE.MathUtils.lerp(tween.from.radius, tween.to.radius, e),
      THREE.MathUtils.lerp(tween.from.phi, tween.to.phi, e),
      tween.from.theta + tween.dTheta * e
    );
    controls.target.lerpVectors(tween.fromT, tween.toT, e);
    camera.position.setFromSpherical(s).add(controls.target);
    camera.lookAt(controls.target);
    if (k >= 1) {
      targetDist = s.radius;
      tween = null;
      controls.enabled = true;
      controls.update();
    }
  }

  // Wheel: zoom while at top of page; hand scroll back to the page once fully pulled out.
  let heroVisible = true;
  function onWheel(e) {
    if (coarse || !model || tween) return;
    if (window.scrollY > 0 || !heroVisible) return;
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= window.innerHeight;
    if (dy === 0) return;
    const max = controls.maxDistance, min = controls.minDistance;
    if (dy < 0) {
      targetDist = clamp(targetDist * Math.exp(dy * 0.0012), min, max);
      e.preventDefault();
    } else if (targetDist < max - 1e-3) {
      targetDist = clamp(targetDist * Math.exp(dy * 0.0012), min, max);
      e.preventDefault();
    } else return; // at max distance: let the page scroll
    controls.autoRotate = false;
    onPreset?.(null);
    scheduleResume();
  }
  heroEl.addEventListener('wheel', onWheel, { passive: false });

  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    computeFit();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // Render loop, paused when the hero is off screen or the tab is hidden.
  let raf = 0, running = false;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (tween) stepTween(now);
    else {
      const off = camera.position.clone().sub(controls.target);
      const len = off.length();
      const next = reduced ? targetDist : THREE.MathUtils.lerp(len, targetDist, 0.08);
      if (Math.abs(next - len) > 1e-4) camera.position.copy(controls.target).addScaledVector(off.normalize(), next);
      controls.update();
    }
    renderer.render(scene, camera);
  }
  const start = () => { if (!running) { running = true; raf = requestAnimationFrame(frame); } };
  const stop = () => { running = false; cancelAnimationFrame(raf); };
  const io = new IntersectionObserver(([en]) => {
    heroVisible = en.isIntersecting;
    heroVisible && !document.hidden ? start() : stop();
  }, { threshold: 0 });
  io.observe(container);
  const onVis = () => (document.hidden || !heroVisible ? stop() : start());
  document.addEventListener('visibilitychange', onVis);
  start();

  // Load the car
  const draco = new DRACOLoader().setDecoderPath(DRACO_PATH);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  loader.load(
    MODEL_URL,
    gltf => {
      try { setupModel(gltf.scene); onLoad?.(); }
      catch (e) { onError?.(e); }
    },
    xhr => onProgress?.(xhr.total ? xhr.loaded / xhr.total : 1 - Math.exp(-xhr.loaded / 4e6)),
    err => onError?.(err)
  );

  function setupModel(root) {
    const group = new THREE.Group();
    group.add(root);
    group.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(group);
    let size = box.getSize(new THREE.Vector3());
    if (size.x > size.z) { root.rotation.y = Math.PI / 2; group.updateMatrixWorld(true); }
    box = new THREE.Box3().setFromObject(group);
    size = box.getSize(new THREE.Vector3());
    group.scale.setScalar(MODEL_LENGTH / Math.max(size.x, size.z));
    group.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(group);
    const c = box.getCenter(new THREE.Vector3());
    group.position.set(-c.x, -box.min.y, -c.z);
    group.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(group);
    size = box.getSize(new THREE.Vector3());
    dims = { w: size.x, h: size.y, l: size.z };
    R = box.getBoundingSphere(new THREE.Sphere()).radius;

    // materials
    const meshes = [], areaByMat = new Map();
    group.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      meshes.push(o);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const a = meshArea(o) / mats.length;
      mats.forEach(m => areaByMat.set(m, (areaByMat.get(m) || 0) + a));
    });
    const all = [...areaByMat.keys()];
    const isGlass = m => /glass|window|windshield|windscreen|staklo/i.test(m.name) || (m.transparent && m.opacity < 0.95);
    const hsl = {};
    const saturated = m => m.color && (m.color.getHSL(hsl), hsl.s > 0.35 && hsl.l > 0.08 && hsl.l < 0.85);
    const byArea = list => list.sort((a, b) => areaByMat.get(b) - areaByMat.get(a))[0];
    const paint =
      all.find(m => PAINT_MATERIAL && m.name === PAINT_MATERIAL) ||
      all.find(m => /paint|body|karoser|lak/i.test(m.name)) ||
      byArea(all.filter(m => !isGlass(m) && saturated(m))) ||
      byArea(all.filter(m => !isGlass(m)));

    paintMat = paint && new THREE.MeshPhysicalMaterial({
      name: 'yugo-paint', color: paint.color ? paint.color.clone() : new THREE.Color(0xa3231f),
      map: paint.map || null, normalMap: paint.normalMap || null,
      metalness: 0.5, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.2,
    });
    if (paintMat) { paintOriginal = paintMat.color.clone(); paintMat.userData.origMap = paintMat.map; applyPaint(pendingPaint); }
    const glassMat = new THREE.MeshPhysicalMaterial({
      name: 'yugo-glass', color: 0x06080a, metalness: 0, roughness: 0.04, transmission: 0,
      transparent: true, opacity: 0.62, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.02,
    });
    const swap = m => {
      if (m === paint) return paintMat;
      if (isGlass(m)) return glassMat;
      if ('envMapIntensity' in m) m.envMapIntensity = 1.2;
      return m;
    };
    meshes.forEach(o => {
      if (Array.isArray(o.material)) o.material = o.material.map(swap);
      else {
        o.material = swap(o.material);
        if (o.material === glassMat) o.castShadow = false;
      }
    });

    // contact shadow, faded so there is no floor edge
    const contact = new THREE.Mesh(
      new THREE.PlaneGeometry(dims.w * 1.9, dims.l * 1.45),
      new THREE.MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false, toneMapped: false })
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.003;
    contact.renderOrder = -1;
    scene.add(contact);

    // fit key-light shadow camera to the car
    const s = Math.max(dims.w, dims.l) * 0.85;
    Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
    key.shadow.camera.updateProjectionMatrix();

    scene.add(group);
    model = group;
    computeFit();
    setCam(presets().hero);
    renderer.compile(scene, camera);
  }

  return {
    goTo,
    setPaintColor: applyPaint,
    setFrontSign(v) { frontSign = v; if (model) setCam(presets().hero); },
    dispose() {
      stop();
      clearTimeout(resumeTimer);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      heroEl.removeEventListener('wheel', onWheel);
      controls.dispose();
      draco.dispose();
      envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
