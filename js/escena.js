// ESCENA 3D · continuación de la Práctica 04 (jerarquías, viento GLSL, raycasting)
// Ahora la planta NO crece por un progreso fijo: se dibuja a partir del ESTADO del motor (biomasa, altura, estrés, fase).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const VERDE = new THREE.Color(0x2ecc71), AMARILLO = new THREE.Color(0xd9c23a), SECO = new THREE.Color(0x8a6a3a), GRIS = new THREE.Color(0x8a7f78);

export async function crearEscena() {
  const [vertCode, fragCode] = await Promise.all([fetch('./shaders/wind.vert').then(r => r.text()), fetch('./shaders/wind.frag').then(r => r.text())]);
  const escena = new THREE.Scene();
  escena.background = new THREE.Color(0xbfe3df);
  escena.fog = new THREE.Fog(0xbfe3df, 28, 70);

  const camara = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 120);
  const CAM0 = [0, 9, 17], TGT0 = [0, 2.4, 0];
  camara.position.set(...CAM0);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); // preserveDrawingBuffer: para captura.png
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  Object.assign(renderer.domElement.style, { position: 'fixed', top: 0, left: 0, zIndex: 0 });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.classList.add('vista-lab');   // P06: se oculta cuando se ve el globo
  document.body.appendChild(renderer.domElement);

  const controles = new OrbitControls(camara, renderer.domElement);
  controles.enableDamping = true;
  controles.target.set(...TGT0);

  const luzAmbiente = new THREE.AmbientLight(0xffffff, 1.15);
  const luzDir = new THREE.DirectionalLight(0xffffff, 0.9);
  luzDir.position.set(10, 18, 12);
  luzDir.castShadow = true;
  luzDir.shadow.mapSize.set(2048, 2048);
  Object.assign(luzDir.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22 });
  escena.add(luzAmbiente, luzDir);

  const suelo = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: .6 }));
  suelo.rotation.x = -Math.PI / 2; suelo.receiveShadow = true; escena.add(suelo);

  // ---- Invernadero (de la Práctica 04, compactado) ----
  const inv = new THREE.Group(), W = 36, D = 22, H = 14;
  const mEst = new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: .5, roughness: .35 });
  const mVid = new THREE.MeshPhysicalMaterial({ color: 0xdff7ff, transparent: true, opacity: .1, roughness: .05, side: THREE.DoubleSide });
  [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2], [0, D / 2], [0, -D / 2]].forEach(([x, z]) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(.25, H, .25), mEst); p.position.set(x, H / 2, z); inv.add(p);
  });
  [[W, .25, .25, 0, H, -D / 2], [W, .25, .25, 0, H, D / 2], [.25, .25, D, -W / 2, H, 0], [.25, .25, D, W / 2, H, 0]].forEach(([a, b, c, x, y, z]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(a, b, c), mEst); m.position.set(x, y, z); inv.add(m);
  });
  const techo = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mVid); techo.rotation.x = Math.PI / 2; techo.position.y = H; inv.add(techo);
  [[W, H, 0, H / 2, D / 2, 0], [D, H, -W / 2, H / 2, 0, Math.PI / 2], [D, H, W / 2, H / 2, 0, Math.PI / 2]].forEach(([w, h, x, y, z, ry]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mVid); m.position.set(x, y, z); m.rotation.y = ry; inv.add(m);
  });
  escena.add(inv);

  // ---- Materiales con shader de viento (P04) ----
  const nuevoShader = color => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uWind: { value: 1 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: vertCode, fragmentShader: fragCode, side: THREE.DoubleSide
  });

  // ---- Planta: maceta, sustrato, raíces, bulbo, bulbillos, tallo, hojas, flor ----
  const geomHoja = new THREE.ConeGeometry(.42, 2.4, 16); geomHoja.translate(0, 1.2, 0); geomHoja.scale(.65, 1, .2);
  const geomPetalo = new THREE.SphereGeometry(.48, 16, 16, 0, Math.PI); geomPetalo.scale(.7, 1.5, .25); geomPetalo.translate(0, .75, .2);
  const geomTallo = new THREE.CylinderGeometry(.06, .08, 1, 12); geomTallo.translate(0, .5, 0);

  function crearPlanta(cama, idx, x, z) {
    const g = new THREE.Group(); g.position.set(x, .7, z);
    const meta = (mesh, parte, nombre, geom, extra = {}) => { mesh.userData = { parte, nombre, geometria: geom, cama: cama.id, planta: idx, ...extra }; return mesh; };
    const matMaceta = new THREE.MeshStandardMaterial({ color: 0xe06d53, roughness: .5 });
    const matTierra = new THREE.MeshStandardMaterial({ color: 0x3d1d11, roughness: .95 });
    const maceta = meta(new THREE.Mesh(new THREE.CylinderGeometry(.7, .5, 1.2, 24), matMaceta), 'maceta', 'Maceta de cerámica', 'Cilindro'); maceta.position.y = -.1; maceta.castShadow = true;
    const tierra = meta(new THREE.Mesh(new THREE.CylinderGeometry(.66, .61, .1, 24), matTierra), 'tierra', 'Sustrato', 'Cilindro'); tierra.position.y = .48;
    g.add(maceta, tierra);

    const sub = new THREE.Group(); g.add(sub); // parte subterránea (visible con la maceta transparente)
    const bulbo = meta(new THREE.Mesh(new THREE.SphereGeometry(.36, 20, 16), new THREE.MeshStandardMaterial({ color: 0xc89b5a, roughness: .7 })), 'bulbo', 'Bulbo', 'Esfera');
    bulbo.scale.set(1, 1.2, 1); bulbo.position.y = .22;
    const punta = new THREE.Mesh(new THREE.ConeGeometry(.16, .3, 12), new THREE.MeshStandardMaterial({ color: 0xb88a48 })); punta.position.y = .5; bulbo.add(punta); punta.position.y = .38; punta.userData = { ...bulbo.userData };
    sub.add(bulbo);
    const raices = new THREE.Group(); sub.add(raices);
    for (let i = 0; i < 7; i++) {
      const r = meta(new THREE.Mesh(new THREE.ConeGeometry(.03, .6, 6), new THREE.MeshStandardMaterial({ color: 0xe8d9b0 })), 'raices', 'Raíz', 'Cono');
      const a = i / 7 * Math.PI * 2; r.position.set(Math.cos(a) * .16, -.18, Math.sin(a) * .16); r.rotation.set(Math.PI - Math.sin(a) * .5, 0, Math.cos(a) * .5); raices.add(r);
    }
    const bulbillos = [];
    for (let i = 0; i < 3; i++) {
      const b = meta(new THREE.Mesh(new THREE.SphereGeometry(.13, 12, 10), new THREE.MeshStandardMaterial({ color: 0xd2a96a })), 'bulbo', 'Bulbillo (bulbo hijo)', 'Esfera');
      const a = i * 2.1 + .6; b.position.set(Math.cos(a) * .42, .08, Math.sin(a) * .42); b.visible = false; sub.add(b); bulbillos.push(b);
    }

    const sway = new THREE.Group(); sway.position.y = .5; g.add(sway); // grupo que oscila con el viento
    const mTallo = new THREE.MeshStandardMaterial({ color: 0x2ecc71, roughness: .4 });
    const tallo = meta(new THREE.Mesh(geomTallo, mTallo), 'tallo', `Tallo floral #${idx + 1}`, 'Cilindro'); tallo.castShadow = true; sway.add(tallo);
    const hojas = [];
    for (let i = 0; i < 6; i++) {
      const nodo = new THREE.Group(); nodo.position.y = .05 + i * .17; nodo.rotation.y = i * 2.4;
      const m = meta(new THREE.Mesh(geomHoja, cama.matHojas), 'hoja', `Hoja ${i + 1}`, 'Cono', { hoja: i });
      m.rotation.z = -.28 - i * .03; m.castShadow = true; nodo.add(m); sway.add(nodo); hojas.push(nodo);
    }
    const flor = new THREE.Group(); sway.add(flor);
    const pistilo = meta(new THREE.Mesh(new THREE.SphereGeometry(.2, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: .2 })), 'pistilo', 'Pistilo (centro)', 'Esfera'); flor.add(pistilo);
    const matPetalo = nuevoShader(cama.color); const petalos = [];
    for (let i = 0; i < 6; i++) {
      const pv = new THREE.Group(); pv.rotation.y = i * Math.PI / 3;
      const p = meta(new THREE.Mesh(geomPetalo, matPetalo), 'flor', `Tépalo #${i + 1}`, 'Esfera'); p.castShadow = true; pv.add(p); flor.add(pv); petalos.push(p);
    }
    cama.grupo.add(g);
    return { g, sway, tallo, hojas, flor, petalos, matPetalo, mTallo, matMaceta, matTierra, bulbo, raices, bulbillos, vari: .92 + ((idx * 37) % 17) / 100 * 1.0, fase0: idx * .9 };
  }

  function crearCama(id, x) {
    const cama = { id, grupo: new THREE.Group(), color: '#ff4f8b', matHojas: nuevoShader(0x2ecc71), plantas: [], x };
    cama.grupo.position.x = x; escena.add(cama.grupo);
    for (let f = 0; f < 2; f++) for (let c = -1; c <= 1; c++) cama.plantas.push(crearPlanta(cama, f * 3 + c + 1, c * 3, f * 3 - 1.5));
    return cama;
  }
  const camas = { A: crearCama('A', 0), B: crearCama('B', 5.6) };
  camas.B.grupo.visible = false;

  const marcador = new THREE.Mesh(new THREE.TorusGeometry(.95, .05, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
  marcador.rotation.x = Math.PI / 2; marcador.visible = false; escena.add(marcador);

  // ---- API pública ----
  let viento = 1, tiempo = 0;
  const api = {
    renderer, camara, controles, camas,
    setAB(activo) {
      camas.B.grupo.visible = activo;
      camas.A.grupo.position.x = activo ? -5.6 : 0; camas.B.grupo.position.x = 5.6;
      marcador.visible = false;
      camara.position.set(0, activo ? 11 : 9, activo ? 22 : 17);
    },
    setColorEspecie(id, hex) {
      camas[id].color = hex;
      camas[id].plantas.forEach(p => p.matPetalo.uniforms.uColor.value.set(hex));
      camas[id].hexBase = new THREE.Color(hex);
    },
    setViento(v) { viento = v; },
    setLuz(v) { luzDir.intensity = v; luzAmbiente.intensity = v * .17 + .35; },
    setCorte(on) {
      Object.values(camas).forEach(c => c.plantas.forEach(p => {
        p.matMaceta.transparent = on; p.matMaceta.opacity = on ? .18 : 1; p.matMaceta.depthWrite = !on;
        p.matTierra.transparent = on; p.matTierra.opacity = on ? .3 : 1;
      }));
    },
    resetCamara() { camara.position.set(...CAM0); controles.target.set(...TGT0); controles.update(); },
    // Dibuja el estado del motor en las plantas de una cama
    aplicarEstado(id, e, esp, p) {
      const cama = camas[id], S = e.estres.g / 100;
      const sen = e.fase === 5 ? clamp(e.tSen / 30, 0, 1) : e.fase === 6 ? 1 : 0;
      cama.matHojas.uniforms.uColor.value.copy(VERDE).lerp(AMARILLO, clamp(S * .9 + sen * .8, 0, 1)).lerp(SECO, sen * .5);
      const base = cama.hexBase || new THREE.Color(cama.color);
      cama.plantas.forEach((pl, i) => {
        const v = pl.vari, h = Math.max(.001, e.h * v);
        pl.tallo.scale.set(1, h, 1); pl.tallo.visible = e.fase > 0;
        pl.mTallo.color.copy(VERDE).lerp(AMARILLO, clamp(S * .5 + sen * .6, 0, 1));
        const escalaHoja = e.fase === 0 ? 0 : (.25 + .75 * clamp(e.g / .6, 0, 1)) * (.55 + .45 * esp.altura_max / 4) * (1 - sen * .35);
        pl.hojas.forEach((n, k) => { n.visible = k < e.hojas; n.scale.setScalar(escalaHoja * (1 - k * .05)); n.position.y = .05 + k * .17 * clamp(h / 3, .3, 1); });
        // flor: botón desde la elongación, apertura en floración, marchitez en senescencia
        const botones = e.fase >= 3 && e.fase < 6;
        pl.flor.visible = botones || e.fase === 5 || e.fase === 4;
        pl.flor.position.y = h;
        const esc = e.fase === 3 ? .3 + .4 * clamp((e.g - .45) / .4, 0, 1) : e.fase === 4 ? .7 + .3 * clamp(e.tFlor / 5, 0, 1) : e.fase === 5 ? 1 - .45 * sen : 0;
        pl.flor.scale.setScalar(Math.max(.001, esc));
        const apertura = e.fase === 4 ? .05 + .3 * clamp(e.tFlor / 6, 0, 1) : e.fase === 5 ? .35 + .5 * sen : .02;
        pl.petalos.forEach(pt => { pt.rotation.x = apertura; });
        pl.matPetalo.uniforms.uColor.value.copy(base).lerp(GRIS, clamp(S * .55 + sen * .5, 0, 1));
        // subterráneo: el bulbo se hincha con la biomasa y se oscurece si se pudre
        const bs = .8 + .5 * clamp(e.N / p.K, 0, 1.1);
        pl.bulbo.scale.set(bs, bs * 1.2, bs);
        pl.bulbo.material.color.set(0xc89b5a).lerp(new THREE.Color(0x4a3a20), clamp(1 - e.bulbo / 100, 0, 1));
        pl.raices.visible = e.fase > 0 || e.frio > 25;
        pl.bulbillos.forEach((b, k) => { b.visible = k < e.bulbillos; });
      });
    },
    // Animación de viento (shader + balanceo de la jerarquía)
    animar(dt, correr) {
      if (correr) tiempo += dt;
      const aZ = Math.sin(tiempo * 2.2) * .04 * viento, aX = Math.cos(tiempo * 1.8) * .02 * viento;
      Object.values(camas).forEach(c => {
        c.matHojas.uniforms.uTime.value = tiempo; c.matHojas.uniforms.uWind.value = viento;
        c.plantas.forEach(p => {
          p.matPetalo.uniforms.uTime.value = tiempo; p.matPetalo.uniforms.uWind.value = viento;
          p.sway.rotation.z = aZ * (1 + p.vari * .1); p.sway.rotation.x = aX;
        });
      });
      controles.update();
      renderer.render(escena, camara);
    },
    // Raycasting: devuelve el objeto 3D tocado (ignora lo oculto)
    seleccionar(cx, cy) {
      const rc = new THREE.Raycaster(), m = new THREE.Vector2(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1);
      rc.setFromCamera(m, camara);
      const visibles = o => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };
      const objetivos = Object.values(camas).filter(c => c.grupo.visible).map(c => c.grupo);
      const hit = rc.intersectObjects(objetivos, true).find(h => visibles(h.object) && h.object.userData.parte);
      if (!hit) { marcador.visible = false; return null; }
      const pos = new THREE.Vector3(); camas[hit.object.userData.cama].plantas[hit.object.userData.planta].g.getWorldPosition(pos);
      marcador.position.set(pos.x, .25, pos.z); marcador.visible = true;
      return hit.object.userData;
    },
    capturar() { return renderer.domElement.toDataURL('image/png'); }
  };
  addEventListener('resize', () => { camara.aspect = innerWidth / innerHeight; camara.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
  return api;
}
