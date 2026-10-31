// Pruebas de la lógica pura:  npm test   (o  node --test test/)
// ⚠ Los climas de abajo son VALORES APROXIMADOS escritos a mano solo para probar el código sin red.
//   NO son datos reales de NASA POWER ni se guardan en la base de datos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as G from '../js/geo.js';
import * as M from '../js/modelos.js';

const catalogo = JSON.parse(fs.readFileSync(new URL('../data/especies.json', import.meta.url)));
const gesn = catalogo[0];
const mm = (arr) => arr.map((v, i) => v / M.DIAS_MES[i]);   // mm/mes → mm/día (formato del proxy)

const FIX = {
  lisse:   { lat: 52.26, lon: 4.56, elevacion_m: 1, t2m: [3.6, 3.9, 6.2, 9.2, 12.9, 15.6, 17.9, 17.6, 14.7, 11, 7.1, 4.3], precip_mm_dia: mm([70, 52, 55, 40, 55, 70, 80, 85, 85, 85, 85, 85]), rad_mj_dia: [1.6, 3, 6, 10.2, 14.5, 16.5, 15.8, 13, 8.2, 4.5, 2, 1.1], hr: Array(12).fill(82), t2m_max: [], t2m_min: [] },
  cordoba: { lat: 37.89, lon: -4.78, elevacion_m: 120, t2m: [9, 10.7, 13.4, 15.7, 19.7, 24.6, 28, 27.6, 23.2, 18.1, 12.7, 9.8], precip_mm_dia: mm([58, 52, 50, 55, 40, 15, 3, 8, 25, 70, 75, 80]), rad_mj_dia: [7.5, 10.5, 15, 19, 23, 26, 27, 24, 18.5, 12.5, 8.5, 6.5], hr: Array(12).fill(60), t2m_max: [], t2m_min: [] },
  jutiapa: { lat: 14.29, lon: -89.9, elevacion_m: 900, t2m: [22.5, 23.5, 25, 25.5, 25, 24, 24.5, 24.5, 24, 23.5, 23, 22.5], precip_mm_dia: mm([2, 3, 10, 40, 160, 260, 150, 180, 260, 170, 40, 5]), rad_mj_dia: [18, 20, 21, 21, 19.5, 18, 19.5, 19, 17.5, 16.5, 16.5, 16.5], hr: Array(12).fill(70), t2m_max: [], t2m_min: [] }
};
const clima = Object.fromEntries(Object.entries(FIX).map(([k, v]) => [k, G.derivarClima(v)]));
const sueloBueno = { ph: 6.8, arcilla: 20, arena: 45, limo: 35, carbono: 18 };
const sueloArcilla = { ph: 5.2, arcilla: 48, arena: 18, limo: 34, carbono: 6 };

test('proyección esfera: lat/lon → vector → lat/lon (ida y vuelta)', () => {
  for (const [lat, lon] of [[0, 0], [14.29, -89.9], [-32.9, -68.8], [52.3, 4.6], [89, 170], [-45, -179]]) {
    const v = G.latLonAVec3(lat, lon, 100), b = G.vec3ALatLon(v.x, v.y, v.z);
    assert.ok(Math.abs(b.lat - lat) < 1e-9 && Math.abs(b.lon - lon) < 1e-9, `${lat},${lon}`);
    assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 100) < 1e-9);
  }
  // convención de THREE.SphereGeometry: lon 0 → +X, lon −90 → +Z, polo norte → +Y
  const a = G.latLonAVec3(0, 0), b = G.latLonAVec3(0, -90), c = G.latLonAVec3(90, 0);
  assert.ok(Math.abs(a.x - 1) < 1e-12 && Math.abs(b.z - 1) < 1e-12 && Math.abs(c.y - 1) < 1e-12);
});

test('distancia haversine: Lisse–Córdoba ≈ 1 750 km', () => {
  const d = G.distanciaKm(52.2625, 4.5571, 37.8882, -4.7794);
  assert.ok(d > 1700 && d < 1800, String(d));
});

test('interpolación mensual circular continua en el cambio de año', () => {
  const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  assert.ok(Math.abs(M.interpMensual(a, 15.5) - 1) < 1e-9);            // centro de enero
  assert.ok(Math.abs(M.interpMensual(a, 364.99) - M.interpMensual(a, 0)) < 0.2);   // sin salto 31-dic → 1-ene
  assert.ok(Math.abs(M.interpMensual(a, 365 + 100) - M.interpMensual(a, 100)) < 1e-9);
  for (let d = 0; d < 365; d++) { const v = M.interpMensual(a, d); assert.ok(v >= 1 && v <= 12); }
});

test('ET0, aridez y luz tienen magnitudes razonables', () => {
  assert.ok(clima.lisse.aridez > 1.2, 'Lisse es húmedo');
  assert.ok(clima.cordoba.aridez < 1, 'Córdoba tiene déficit');
  assert.ok(clima.cordoba.et0Anual > 900 && clima.cordoba.et0Anual < 1700, String(clima.cordoba.et0Anual));
  for (const c of Object.values(clima)) c.luzMensualPct.forEach(v => assert.ok(v >= 5 && v <= 100));
  assert.ok(clima.cordoba.luzPrimavera > clima.lisse.luzPrimavera, 'más luz relativa en el sur de España');
});

test('frío efectivo: Lisse cumple, Córdoba es parcial, Jutiapa nulo', () => {
  const f = k => G.frioEfectivo(clima[k], gesn);
  assert.ok(f('lisse') >= gesn.frio_req_dias, 'lisse ' + f('lisse'));
  assert.ok(f('cordoba') > 20 && f('cordoba') < gesn.frio_req_dias, 'cordoba ' + f('cordoba'));
  assert.equal(f('jutiapa'), 0);
});

test('idoneidad: Lisse > Córdoba > Jutiapa para T. gesneriana (con y sin suelo/GBIF)', () => {
  const g = { lisse: { region: 4000, radio_km: 250 }, cordoba: { region: 150, radio_km: 250 }, jutiapa: { region: 0, radio_km: 250 } };
  const I = k => G.idoneidad(clima[k], sueloBueno, g[k], gesn);
  assert.ok(I('lisse').puntaje >= 80, JSON.stringify(I('lisse')));
  assert.ok(I('lisse').puntaje > I('cordoba').puntaje && I('cordoba').puntaje > I('jutiapa').puntaje);
  assert.equal(I('jutiapa').clase, 'No apta');
  assert.equal(I('jutiapa').limitante, 'frio');
  const sinFuentes = G.idoneidad(clima.lisse, null, null, gesn);       // renormaliza pesos
  assert.ok(sinFuentes.cobertura < 1 && sinFuentes.cobertura > 0.5 && sinFuentes.puntaje > 60);
  assert.equal(Object.values(G.PESOS).reduce((a, b) => a + b, 0).toFixed(6), '1.000000');
});

test('reglas geo-agronómicas: umbrales del enunciado', () => {
  const cod = (c, s, g, e = gesn) => G.reglasGeo({ clima: c, suelo: s, gbif: g }, e, catalogo).map(r => r.codigo);
  assert.ok(cod({ ...clima.lisse, precipAnual: 350 }, sueloBueno, { region: 10, radio_km: 250 }).includes('GEO_RIEGO'));
  assert.ok(cod({ ...clima.lisse, tMedia: 36 }, sueloBueno, null).includes('GEO_CALOR_MEDIO'));
  assert.ok(cod(clima.lisse, sueloBueno, { region: 0, radio_km: 250 }).includes('GEO_GBIF0'));
  assert.ok(cod(clima.lisse, sueloArcilla, null).includes('GEO_PH_ACIDO'));
  assert.ok(cod({ ...clima.lisse, radMaxMes: 27 }, sueloBueno, null).includes('GEO_RAD'));
  assert.ok(cod(clima.jutiapa, sueloBueno, null).includes('GEO_FRIO'));
  const arcilla = G.reglasGeo({ clima: clima.lisse, suelo: sueloArcilla, gbif: null }, gesn, catalogo).find(r => r.codigo === 'GEO_ARCILLA');
  assert.ok(arcilla && /sylvestris/.test(arcilla.detalle), 'recomienda la especie que tolera más arcilla');
  const orden = G.reglasGeo({ clima: clima.jutiapa, suelo: sueloArcilla, gbif: { region: 0, radio_km: 250 } }, gesn, catalogo).map(r => r.severidad);
  assert.deepEqual(orden, [...orden].sort((a, b) => ['critica', 'alta', 'media', 'info', 'ok'].indexOf(a) - ['critica', 'alta', 'media', 'info', 'ok'].indexOf(b)));
  assert.equal(cod(clima.lisse, sueloBueno, { region: 4000, radio_km: 250 }).includes('GEO_OK'), true);
});

test('parametrosSim + motor: el clima real gobierna la temperatura diaria', () => {
  const p = G.parametrosSim(clima.lisse, sueloBueno, gesn);
  assert.equal(p.mesSiembra, 9);                       // octubre en el hemisferio norte
  assert.equal(G.parametrosSim(G.derivarClima({ ...FIX.lisse, lat: -33 }), sueloBueno, gesn).mesSiembra, 3);
  let s = M.estadoInicial(gesn); const T = [];
  for (let i = 0; i < 400 && s.fase < 6; i++) { s = M.avanzarDia(s, p, gesn); T.push(s.temp); }
  assert.ok(Math.min(...T) < 6 && Math.max(...T) > 14, `rango ${Math.min(...T)}–${Math.max(...T)}`);
  const sig = T.slice(1).map((v, i) => Math.abs(v - T[i]));
  assert.ok(Math.max(...sig) < 0.5, 'la serie diaria no tiene saltos');
});

test('simulación con clima real: Lisse florece; Jutiapa sin frío rinde peor; pre-enfriado ayuda', () => {
  const R = (k, o) => G.simularCiclo(gesn, G.parametrosSim(clima[k], sueloBueno, gesn, o)).resumen;
  const l = R('lisse'), j = R('jutiapa'), jp = R('jutiapa', { preFrio: true });
  assert.ok(l.dias_madurez != null && !l.aborto, JSON.stringify(l));
  assert.ok(l.biomasa_final > j.biomasa_final, `${l.biomasa_final} vs ${j.biomasa_final}`);
  assert.ok(jp.biomasa_final >= j.biomasa_final, `pre-frío ${jp.biomasa_final} vs ${j.biomasa_final}`);
  // determinismo
  assert.deepEqual(R('lisse'), R('lisse'));
});

test('comparador A/B geográfico: Lisse gana a Jutiapa; mismo lugar = empate', () => {
  const L = (k, g) => ({ clima: clima[k], suelo: sueloBueno, gbif: g });
  const r = G.compararUbicaciones(gesn, L('lisse', { region: 4000, radio_km: 250 }), L('jutiapa', { region: 0, radio_km: 250 }));
  assert.equal(r.ganador, 'A');
  assert.ok(r.filas.length >= 10 && r.filas.every(f => 'ganaFila' in f));
  const e = G.compararUbicaciones(gesn, L('lisse', null), L('lisse', null));
  assert.equal(e.ganador, 'empate');
});

test('ranking de especies: ordenado por idoneidad y usa conteos GBIF', () => {
  const conteos = { 1: 4000, 2: 4000, 3: 0, 4: 300, 5: 10, 6: 5 };
  const r = G.rankingEspecies(catalogo, { clima: clima.lisse, suelo: sueloBueno }, conteos);
  assert.equal(r.length, 6);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].ido.puntaje >= r[i].ido.puntaje);
  const p = id => r.find(x => x.esp.id === id).ido.puntaje;
  assert.ok(p(1) > p(3), 'misma envolvente climática: sin registros GBIF (edulis) puntúa menos que con 4 000 (gesneriana)');
});

test('clase textural simplificada', () => {
  assert.equal(G.claseTextura(48, 18), 'Arcillosa');
  assert.equal(G.claseTextura(10, 80), 'Arenosa / franco-arenosa');
  assert.equal(G.claseTextura(20, 40), 'Franca');
  assert.equal(G.claseTextura(null, 40), null);
});
