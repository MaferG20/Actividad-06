// GLOBO TERRÁQUEO 3D hecho desde cero con Three.js (sin three-globe).
//  · Esfera con textura equirectangular → una coordenada (lat, lon) se convierte a un punto de la esfera con
//    latLonAVec3() (js/geo.js) y el clic hace el camino inverso con vec3ALatLon().
//  · Ocurrencias GBIF = un solo THREE.Points (miles de puntos en 1 draw call).
//  · Marcadores = mallas pequeñas con raycasting; pines A/B; arco de gran círculo elevado entre A y B.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { latLonAVec3, vec3ALatLon } from './geo.js';

const R = 100;   // radio de la Tierra en unidades de escena
const TEXTURAS = ['https://unpkg.com/three@0.160.0/examples/textures/planets/earth_atmos_2048.jpg', './assets/earth.jpg'];   // 2.ª = copia local opcional
const ESPECULAR = 'https://unpkg.com/three@0.160.0/examples/textures/planets/earth_specular_2048.jpg';
const v3 = (lat, lon, r) => { const p = latLonAVec3(lat, lon, r); return new THREE.Vector3(p.x, p.y, p.z); };

function texturaCircular() {   // sprite redondo para los puntos
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d'); g.beginPath(); g.arc(16, 16, 14, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
  return new THREE.CanvasTexture(c);
}
function etiqueta(letra, color) {   // sprite con la letra A / B
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fillStyle = color; g.fill();
  g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke(); g.fillStyle = '#fff'; g.font = 'bold 36px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(letra, 32, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(9, 9, 1); return s;
}

export function crearGlobo({ onClick, onHover }) {
  const escena = new THREE.Scene();
  escena.background = new THREE.Color(0x020712);
  const camara = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1, 4000);
  camara.position.copy(v3(15, -70, 330));
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });   // preserveDrawingBuffer: captura PNG
  renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.domElement.classList.add('vista-globo');
  Object.assign(renderer.domElement.style, { position: 'fixed', top: 0, left: 0, zIndex: 0 });
  document.body.appendChild(renderer.domElement);

  const controles = new OrbitControls(camara, renderer.domElement);
  Object.assign(controles, { enablePan: false, enableDamping: true, dampingFactor: .08, minDistance: 130, maxDistance: 600, rotateSpeed: .45, zoomSpeed: .7 });

  escena.add(new THREE.AmbientLight(0xffffff, 1.1));
  const sol = new THREE.DirectionalLight(0xffffff, 1.5); sol.position.set(400, 200, 300); escena.add(sol);

  // ---- Tierra ----
  const matTierra = new THREE.MeshPhongMaterial({ color: 0x1f5f94, shininess: 14, specular: new THREE.Color(0x333333) });   // azul mientras carga la textura
  const tierra = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), matTierra);
  escena.add(tierra);
  const cargador = new THREE.TextureLoader(); cargador.setCrossOrigin('anonymous');
  (function intentar(i) {
    if (i >= TEXTURAS.length) { console.warn('Sin textura de la Tierra: se muestra la esfera azul con la cuadrícula.'); return; }
    cargador.load(TEXTURAS[i], t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; matTierra.map = t; matTierra.color.set(0xffffff); matTierra.needsUpdate = true; }, undefined, () => intentar(i + 1));
  })(0);
  cargador.load(ESPECULAR, t => { matTierra.specularMap = t; matTierra.needsUpdate = true; });

  // ---- Cuadrícula de meridianos y paralelos cada 30° ----
  const pts = [];
  for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 4) pts.push(v3(lat, lon, R * 1.002), v3(lat, lon + 4, R * 1.002));
  for (let lon = -180; lon < 180; lon += 30) for (let lat = -88; lat < 88; lat += 4) pts.push(v3(lat, lon, R * 1.002), v3(lat + 4, lon, R * 1.002));
  escena.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: .1 })));

  // ---- Atmósfera (resplandor de Fresnel) ----
  escena.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.13, 64, 48), new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vN; void main(){ float i = pow(0.62 - dot(vN, vec3(0.0,0.0,1.0)), 2.2); gl_FragColor = vec4(0.30,0.60,1.0,1.0) * clamp(i, 0.0, 1.0); }',
    blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true, depthWrite: false
  })));

  // ---- Estrellas ----
  const est = []; for (let i = 0; i < 1400; i++) { const d = new THREE.Vector3().randomDirection().multiplyScalar(1800 + Math.random() * 600); est.push(d); }
  escena.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(est), new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: .8 })));

  // ---- Capas dinámicas ----
  const circulo = texturaCircular();
  let nubeGbif = null;
  const pines = {};            // id → { grupo, anillo }
  const grupoMarc = new THREE.Group(); escena.add(grupoMarc);
  let arco = null;

  function ponerPin(id, lat, lon, color, letra) {
    quitarPin(id);
    const g = new THREE.Group(), n = v3(lat, lon, 1).normalize();
    g.position.copy(n.clone().multiplyScalar(R)); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const mat = new THREE.MeshBasicMaterial({ color });
    const tallo = new THREE.Mesh(new THREE.CylinderGeometry(.35, .35, 5, 8), mat); tallo.position.y = 2.5;
    const bola = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), mat); bola.position.y = 5.3;
    const anillo = new THREE.Mesh(new THREE.RingGeometry(1.8, 2.5, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .8, side: THREE.DoubleSide })); anillo.rotation.x = -Math.PI / 2; anillo.position.y = .2;
    g.add(tallo, bola, anillo);
    if (letra) { const s = etiqueta(letra, '#' + new THREE.Color(color).getHexString()); s.position.y = 11; g.add(s); }
    escena.add(g); pines[id] = { g, anillo };
  }
  function quitarPin(id) { if (pines[id]) { escena.remove(pines[id].g); delete pines[id]; } }

  // ---- Interacción: clic (sin arrastre) → raycasting ----
  const rc = new THREE.Raycaster();
  const ndc = e => new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  function pick(e) {
    rc.setFromCamera(ndc(e), camara);
    const m = rc.intersectObjects(grupoMarc.children, false)[0];
    const t = rc.intersectObject(tierra, false)[0];
    if (m && (!t || m.distance < t.distance + 4)) return { ubic: m.object.userData.ubic };
    if (t) { const { lat, lon } = vec3ALatLon(t.point.x, t.point.y, t.point.z); return { lat, lon }; }   // esfera → (lat, lon)
    return null;
  }
  let down = null;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  el.addEventListener('pointerup', e => {
    if (!down) return;
    const mov = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
    if (mov < 5 && dt < 600) { const h = pick(e); if (h) onClick(h); }
  });
  let ultimoHover = 0;
  el.addEventListener('pointermove', e => {
    const t = performance.now(); if (t - ultimoHover < 60 || down) return; ultimoHover = t;
    rc.setFromCamera(ndc(e), camara);
    const m = rc.intersectObjects(grupoMarc.children, false)[0], tt = rc.intersectObject(tierra, false)[0];
    const vis = m && (!tt || m.distance < tt.distance + 4);
    el.style.cursor = vis ? 'pointer' : 'crosshair';
    onHover(vis ? m.object.userData.ubic : null, e.clientX, e.clientY);
  });

  // ---- Vuelo suave de cámara hacia una coordenada (interpolación esférica con cuaternión) ----
  let vuelo = null;
  function volarA(lat, lon, dist = 260, ms = 1200) {
    const d0 = camara.position.clone().normalize(), d1 = v3(lat, lon, 1).normalize();
    vuelo = { t0: performance.now(), ms, q: new THREE.Quaternion().setFromUnitVectors(d0, d1), d0, r0: camara.position.length(), r1: dist };
    if (ms === 0) { camara.position.copy(d1.multiplyScalar(dist)); vuelo = null; }
  }

  let activo = true, t = 0;
  const api = {
    renderer, camara,
    setActivo(v) { activo = v; el.style.display = v ? '' : 'none'; },
    volarA,
    colocarPin: ponerPin, quitarPin,
    pinSeleccion(lat, lon) { ponerPin('sel', lat, lon, 0xffffff, null); },
    // Ocurrencias GBIF: puntos = [[lat, lon, año, país], ...]
    setOcurrencias(puntos, hex) {
      api.quitarOcurrencias();
      if (!puntos.length) return;
      const pos = new Float32Array(puntos.length * 3);
      puntos.forEach(([la, lo], i) => { const p = latLonAVec3(la, lo, R * 1.004); pos.set([p.x, p.y, p.z], i * 3); });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      nubeGbif = new THREE.Points(g, new THREE.PointsMaterial({ color: new THREE.Color(hex), size: 5, sizeAttenuation: false, map: circulo, alphaTest: .3, transparent: true, depthWrite: false }));
      escena.add(nubeGbif);
    },
    quitarOcurrencias() { if (nubeGbif) { escena.remove(nubeGbif); nubeGbif.geometry.dispose(); nubeGbif = null; } },
    // Marcadores de ubicaciones guardadas / de ejemplo (cada una con su objeto en userData.ubic)
    setUbicaciones(lista) {
      grupoMarc.clear();
      for (const u of lista) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 10), new THREE.MeshBasicMaterial({ color: u.analisis > 0 ? 0xffd84a : 0x3de0c0 }));
        m.position.copy(v3(u.lat, u.lon, R * 1.01)); m.userData.ubic = u; grupoMarc.add(m);
      }
    },
    mostrarUbicaciones(v) { grupoMarc.visible = v; },
    // Arco de gran círculo elevado entre dos puntos
    arcoAB(a, b) {
      api.quitarArco(); if (!a || !b) return;
      const va = v3(a.lat, a.lon, R), vb = v3(b.lat, b.lon, R), ang = va.angleTo(vb);
      const mid = va.clone().add(vb); if (mid.lengthSq() < 1e-6) mid.set(0, 1, 0).cross(va);
      const ctrl = mid.normalize().multiplyScalar(R * (1 + 0.8 * ang / Math.PI * 2));
      arco = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(va, ctrl, vb), 80, .45, 6, false), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
      escena.add(arco);
    },
    quitarArco() { if (arco) { escena.remove(arco); arco.geometry.dispose(); arco = null; } },
    capturar() { renderer.render(escena, camara); return renderer.domElement.toDataURL('image/png'); },
    render(dt) {
      if (!activo) return;
      t += dt;
      if (vuelo) {   // easing cúbico
        const k = Math.min(1, (performance.now() - vuelo.t0) / vuelo.ms), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        const q = new THREE.Quaternion().slerp(vuelo.q, e);
        camara.position.copy(vuelo.d0.clone().applyQuaternion(q).multiplyScalar(vuelo.r0 + (vuelo.r1 - vuelo.r0) * e));
        if (k >= 1) vuelo = null;
      }
      Object.values(pines).forEach(p => { const s = 1 + .35 * Math.sin(t * 3); p.anillo.scale.set(s, s, 1); });
      controles.update(); renderer.render(escena, camara);
    }
  };
  addEventListener('resize', () => { camara.aspect = innerWidth / innerHeight; camara.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
  return api;
}
