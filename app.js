// OBSERVATORIO GLOBAL DE CULTIVOS · Práctica 06
// Orquesta: globo 3D (js/globo.js) + datos reales vía proxy PHP (js/api.js) + lógica geo-agronómica (js/geo.js)
// + laboratorio de crecimiento de la P05 (main.js).
import * as API from './js/api.js';
import * as G from './js/geo.js';
import { crearGlobo } from './js/globo.js';
import * as LAB from './main.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));   // evita XSS con datos de APIs/BD
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const f = (x, d = 1, u = '') => x == null || Number.isNaN(x) ? '—' : (+x).toFixed(d) + u;
const redond = (x, d = 1) => x == null ? null : +(+x).toFixed(d);
const claseCss = c => 'c-' + String(c).replace(/\s/g, '');
const corto = e => e.nombre_cientifico.replace('Tulipa ', 'T. ').replace('gesneriana cv. ', "cv. ");

const S = { especies: [], sel: null, ubic: [], punto: null, A: null, B: null, token: 0, radio: 250, mapas: new Map(), matriz: new Map(), matrizTok: 0, charts: {}, cmp: null };
let globo = null;

// ---------- utilidades de interfaz ----------
let tToast;
function aviso(msg, error = false) { const t = $('toast'); t.textContent = msg; t.className = error ? 'err' : ''; t.hidden = false; clearTimeout(tToast); tToast = setTimeout(() => t.hidden = true, 4800); }
function abrirModal(html) { $('modalCont').innerHTML = html; $('modal').hidden = false; }
function grafica(id, cfg) { S.charts[id]?.destroy(); const el = $(id); if (el) S.charts[id] = new Chart(el, cfg); return S.charts[id]; }
const barra = (t, v, color) => `<div class="barra"><span><em>${t}</em><em>${v == null ? 'sin dato' : v.toFixed(0) + '%'}</em></span><i><u style="width:${clamp(v ?? 0, 0, 100)}%;background:${color}"></u></i></div>`;
const colorPct = v => v >= 80 ? '#4cd98a' : v >= 55 ? '#b5e048' : v >= 35 ? '#ffb347' : '#ff6b6b';
const COLOR_CLASE = { 'Óptima': '#4cd98a', 'Buena': '#b5e048', 'Marginal': '#ffb347', 'No apta': '#ff6b6b' };

// ---------- vistas ----------
function cambiarVista(v) {
  document.body.dataset.vista = v;
  document.querySelectorAll('#barra nav button').forEach(b => b.classList.toggle('on', b.dataset.vista === v));
  globo.setActivo(v === 'globo'); LAB.setActivo(v === 'lab');
}

// ---------- datos del punto ----------
const gbifDe = (P, esp) => { const c = P?.conteos?.[esp.id]; return c && c.region != null ? { region: c.region, total: c.total, radio_km: S.radio } : null; };
function evaluar(P = S.punto, esp = S.sel) {
  if (!P?.clima) return null;
  const gbif = gbifDe(P, esp);
  return { ido: G.idoneidad(P.clima, P.suelo, gbif, esp), decs: G.reglasGeo({ clima: P.clima, suelo: P.suelo, gbif }, esp, S.especies), gbif };
}
function payloadAnalisis(P, esp) {
  const ev = evaluar(P, esp), c = P.clima;
  return {
    lat: P.lat, lon: P.lon, nombre: P.nombre, pais: P.pais, codigo_pais: P.cc, elevacion_m: c.elevacion_m, especie_id: esp.id,
    resumen: { temp_media: redond(c.tMedia, 2), temp_min_mes: redond(c.tMinMes, 2), temp_max_mes: redond(c.tMaxMes, 2), precip_anual: redond(c.precipAnual, 1), radiacion_mj: redond(c.radMedia, 2), et0_anual: redond(c.et0Anual, 1), aridez: redond(c.aridez, 2), frio_efectivo: ev.ido.frioEfectivoDias },
    suelo: P.suelo ? { ph: P.suelo.ph, arcilla: P.suelo.arcilla, arena: P.suelo.arena, limo: P.suelo.limo, carbono: P.suelo.carbono, textura: P.suelo.textura } : null,
    gbif: ev.gbif ? { region: ev.gbif.region, radio_km: ev.gbif.radio_km, total: ev.gbif.total } : null,
    idoneidad: { puntaje: ev.ido.puntaje, clase: ev.ido.clase, factor_limitante: ev.ido.limitante, detalle: ev.ido.sub },
    fuentes: { ...P.fuentes, gbif: P.fuentesGbif || null }, notas: '',
    decisiones: ev.decs
  };
}

async function seleccionarPunto(lat, lon, hint = null) {
  const tok = ++S.token;
  lon = ((lon + 180) % 360 + 360) % 360 - 180; lat = clamp(lat, -89.9, 89.9);
  globo.pinSeleccion(lat, lon); globo.volarA(lat, lon);
  const nombreHint = hint ? `${hint.nombre}${hint.pais ? ', ' + hint.pais : ''}` : null;
  S.punto = { lat, lon, nombre: nombreHint || `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`, pais: hint?.pais ?? null, cc: hint?.codigo_pais ?? null, cargando: true, conteos: null, fuentes: {} };
  pintar();
  let raw; const t0 = performance.now();
  try { raw = await API.geoPunto(lat, lon); }
  catch (e) { if (tok === S.token) { S.punto.cargando = false; S.punto.error = e.message; pintar(); } return; }
  if (tok !== S.token) return;
  const P = S.punto;
  P.cargando = false; P.raw = raw; P.fuentes = raw.fuentes; P.actual = raw.actual; P.ms = Math.round(performance.now() - t0);
  P.clima = raw.clima ? G.derivarClima({ ...raw.clima, lat, lon }) : null;
  P.suelo = raw.suelo ? { ...raw.suelo, textura: G.claseTextura(raw.suelo.arcilla, raw.suelo.arena) } : null;
  if (!nombreHint && raw.lugar) { P.nombre = `${raw.lugar.nombre}${raw.lugar.pais ? ', ' + raw.lugar.pais : ''}`; P.pais = raw.lugar.pais; P.cc = raw.lugar.codigo_pais; }
  P.cargandoGbif = true; pintar();
  try {
    const r = await API.geoConteos(lat, lon, S.radio); if (tok !== S.token) return;
    P.conteos = Object.fromEntries(r.items.map(i => [i.especie_id, { region: i.region, total: i.total }]));
    const est = Object.values(r.fuentes || {}).map(x => x.cache);
    P.fuentesGbif = est.includes('ERR') || est.includes('NEG') ? 'ERR' : est.every(x => x === 'HIT') ? 'HIT' : 'MISS';
  } catch (e) { if (tok !== S.token) return; P.conteos = {}; P.fuentesGbif = 'ERR'; }
  P.cargandoGbif = false; pintar();
}

// ---------- panel derecho ----------
function chip(nombre, estado) {
  const m = { HIT: ['hit', '⚡ caché'], MISS: ['miss', '⬇ descargado'], ERR: ['err', '✖ falló'], NEG: ['err', '✖ falló (reintento en 2 min)'], BLOQ: ['err', '✖ bloqueado'] }[estado] || ['err', '—'];
  return `<span class="chip fuente ${m[0]}" title="Estado del proxy PHP/caché MySQL">${nombre}: ${m[1]}</span>`;
}
function pintar() {
  const P = S.punto, box = $('gPanel');
  if (!P) { box.innerHTML = '<p class="suave">Haz clic en el globo (o en un marcador) para consultar el clima histórico, el suelo y la biodiversidad de ese punto.</p>'; return; }
  const cab = `<h3>${esc(P.nombre)}</h3><div class="coords">${P.lat.toFixed(4)}°, ${P.lon.toFixed(4)}°${P.clima?.elevacion_m != null ? ' · ' + P.clima.elevacion_m + ' m s.n.m.' : ''}</div>`;
  if (P.cargando) { box.innerHTML = cab + '<p class="suave"><span class="spin"></span>Consultando NASA POWER, Open-Meteo y SoilGrids a través del proxy PHP…</p>'; return; }
  if (P.error) { box.innerHTML = cab + `<div class="aviso">No se pudo consultar el proxy: ${esc(P.error)}<br><small>Pulsa «Diagnóstico» para ver si falla PHP, MySQL, los certificados SSL o la salida a Internet del servidor.</small><br><button class="azul" data-acc="diag" style="margin-top:6px">🩺 Diagnóstico del servidor</button></div>`; return; }
  const F = P.fuentes || {};
  let h = cab + `<div class="chips">${chip('NASA POWER', F.nasa?.cache)}${chip('Open-Meteo', F.actual?.cache)}${chip('SoilGrids', F.suelo?.cache)}${chip('Nombre', F.lugar?.cache)}${P.fuentesGbif ? chip('GBIF', P.fuentesGbif) : ''}</div>
    <div class="coords">⏱ ${P.ms ?? '—'} ms · caché MySQL ${Object.values(F).filter(x => x?.cache === 'HIT').length}/${Object.keys(F).length} fuentes</div>`;
  const c = P.clima;
  if (!c) { box.innerHTML = h + '<div class="aviso">NASA POWER no devolvió clima para este punto, así que no se puede calcular idoneidad ni simular.</div>'; return; }

  h += `<div class="sec"><h5>🌡 Clima histórico · NASA POWER</h5><div class="kv">
      <div><small>T media anual</small><b>${f(c.tMedia, 1, ' °C')}</b></div><div><small>Mes más frío</small><b>${f(c.tMinMes, 1, ' °C')}</b></div><div><small>Mes más cálido</small><b>${f(c.tMaxMes, 1, ' °C')}</b></div>
      <div><small>Lluvia anual</small><b>${f(c.precipAnual, 0, ' mm')}</b></div><div><small>Radiación</small><b>${f(c.radMedia, 1)}<small> MJ/m²/d</small></b></div><div><small>Lluvia / ET0</small><b>${f(c.aridez, 2)}</b></div></div>
      <div class="graf2"><canvas id="gClimaGraf"></canvas></div></div>`;

  const a = P.actual;
  h += `<div class="sec"><h5>⛅ Ahora · Open-Meteo</h5>` + (a ? `<div class="kv"><div><small>Temp.</small><b>${f(a.temp_c, 1, ' °C')}</b></div><div><small>Humedad</small><b>${f(a.hr, 0, ' %')}</b></div><div><small>Viento</small><b>${f(a.viento_kmh, 0, ' km/h')}</b></div>
      <div><small>Suelo 6 cm</small><b>${f(a.suelo_temp_6cm_c, 1, ' °C')}</b></div><div><small>Humedad suelo</small><b>${a.suelo_humedad == null ? '—' : f(a.suelo_humedad * 100, 0, ' %')}</b></div><div><small>ET0 hoy</small><b>${f(a.pronostico?.[0]?.et0_mm, 1, ' mm')}</b></div></div>`
      : '<p class="suave">Open-Meteo no respondió.</p>') + '</div>';

  const s = P.suelo;
  h += `<div class="sec"><h5>🧱 Suelo · SoilGrids (0–30 cm)</h5>` + (s ? `<div class="kv"><div><small>pH</small><b>${f(s.ph, 1)}</b></div><div><small>Arcilla</small><b>${f(s.arcilla, 0, ' %')}</b></div><div><small>Arena</small><b>${f(s.arena, 0, ' %')}</b></div>
      <div><small>Limo</small><b>${f(s.limo, 0, ' %')}</b></div><div><small>C orgánico</small><b>${f(s.carbono, 1, ' g/kg')}</b></div><div><small>Textura</small><b style="font-size:.72rem">${esc(s.textura ?? '—')}</b></div></div>`
      : '<div class="aviso">SoilGrids no respondió (límite de uso o punto sin dato, p. ej. agua). El índice se calcula sin suelo y su cobertura baja.</div>') + '</div>';

  const esp = S.sel, g = gbifDe(P, esp);
  h += `<div class="sec"><h5>🐝 Biodiversidad · GBIF · <i>${esc(esp.nombre_cientifico)}</i></h5>` +
    (P.cargandoGbif ? '<p class="suave"><span class="spin"></span>Contando registros…</p>' : g ? `<div class="kv" style="grid-template-columns:1fr 1fr"><div><small>En ${S.radio} km a la redonda</small><b>${g.region.toLocaleString('es')}</b></div><div><small>En todo el mundo</small><b>${g.total == null ? '—' : g.total.toLocaleString('es')}</b></div></div>` : '<p class="suave">GBIF no respondió para esta especie.</p>') + '</div>';

  const ev = evaluar();
  if (ev && !P.cargandoGbif) {
    h += `<div class="sec"><h5>🎯 Índice de idoneidad</h5><div class="gauge"><span class="num" style="color:${colorPct(ev.ido.puntaje)}">${ev.ido.puntaje.toFixed(0)}</span><span class="cls ${claseCss(ev.ido.clase)}">${ev.ido.clase}</span><small>factor limitante: <b>${esc(G.ETIQUETAS[ev.ido.limitante])}</b><br>cobertura de datos: ${(ev.ido.cobertura * 100).toFixed(0)} %</small></div>` +
      Object.keys(G.PESOS).map(k => barra(`${G.ETIQUETAS[k]} <small>(peso ${(G.PESOS[k] * 100).toFixed(0)} %)</small>`, ev.ido.sub[k] == null ? null : ev.ido.sub[k] * 100, ev.ido.sub[k] == null ? '#555' : colorPct(ev.ido.sub[k] * 100))).join('') + '</div>';
    h += `<div class="sec decision"><h5>🧠 Decisiones geo-agronómicas</h5><ul id="listaDecisiones">${ev.decs.map(d => `<li class="sev-${d.severidad}"><b>${esc(d.titulo)}</b> — ${esc(d.detalle)} ${d.umbral ? `<small>[umbral: ${esc(d.umbral)}]</small>` : ''}</li>`).join('')}</ul></div>`;
  }
  if (!P.cargandoGbif) {
    const conteos = Object.fromEntries(Object.entries(P.conteos || {}).map(([k, v]) => [k, v.region]));
    const rk = G.rankingEspecies(S.especies, P, conteos, S.radio);
    h += `<div class="sec"><h5>🏆 Especies del catálogo en este punto</h5><table class="mini rk"><tr><th>#</th><th>Especie</th><th>Idon.</th><th>Clase</th></tr>${rk.map((x, i) => `<tr data-id="${x.esp.id}" class="${x.esp.id === S.sel.id ? 'sel' : ''}"><td>${i + 1}</td><td>${esc(corto(x.esp))}</td><td><b style="color:${colorPct(x.ido.puntaje)}">${x.ido.puntaje.toFixed(0)}</b></td><td>${x.ido.clase}</td></tr>`).join('')}</table><small class="suave">Clic en una fila para cambiar de especie.</small></div>`;
  }
  h += `<div class="acciones"><button class="verde ancho" data-acc="simular">▶ Simular crecimiento aquí (clima real)</button>
      <button class="btnA" data-acc="fijarA">📌 Fijar como A</button><button class="btnB" data-acc="fijarB">📌 Fijar como B</button>
      <button class="azul" data-acc="guardar">💾 Guardar análisis</button><button class="violeta" data-acc="ranking">🏆 Ranking aquí</button></div>`;
  box.innerHTML = h;
  dibujarClima();
}
function dibujarClima() {
  const c = S.punto?.clima; if (!c || !$('gClimaGraf')) return;
  grafica('gClimaGraf', { data: { labels: G.MESES, datasets: [
      { type: 'bar', label: 'Lluvia (mm/mes)', data: c.precipMensual.map(v => +v.toFixed(0)), backgroundColor: '#4fa3ff88', yAxisID: 'y', order: 3 },
      { type: 'line', label: 'ET0 (mm/mes)', data: c.et0Mensual.map(v => +v.toFixed(0)), borderColor: '#ffb347', borderDash: [4, 3], pointRadius: 0, borderWidth: 1.5, yAxisID: 'y', order: 2 },
      { type: 'line', label: 'T media (°C)', data: c.tMensual, borderColor: '#ff6b6b', pointRadius: 2, borderWidth: 2, tension: .3, yAxisID: 'y1', order: 1 }] },
    options: { animation: false, responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { boxWidth: 8, font: { size: 9 } } } },
      scales: { y: { beginAtZero: true, grid: { color: '#ffffff12' }, title: { display: true, text: 'mm', font: { size: 9 } } }, y1: { position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: '°C', font: { size: 9 } } } } } });
}

// ---------- capa GBIF ----------
async function cargarCapaGbif() {
  const esp = S.sel, info = $('gbifInfo');
  if (!$('capaGbif').checked) { globo.quitarOcurrencias(); info.textContent = ''; return; }
  info.innerHTML = '<span class="spin"></span>Descargando ocurrencias de GBIF…';
  try {
    let m = S.mapas.get(esp.id);
    if (!m) { m = await API.geoMapa(esp.id); S.mapas.set(esp.id, m); }
    if (S.sel.id !== esp.id || !$('capaGbif').checked) return;
    globo.setOcurrencias(m.puntos, esp.color_hex);
    info.innerHTML = m.total ? `<b>${m.total.toLocaleString('es')}</b> registros georreferenciados en GBIF. Se dibuja una muestra de <b>${m.muestra.toLocaleString('es')}</b> puntos.` : 'GBIF no tiene registros georreferenciados de esta especie.';
  } catch (e) { globo.quitarOcurrencias(); info.innerHTML = `<span class="sev-alta">GBIF: ${esc(e.message)}</span>`; }
}

// ---------- A/B ----------
function fijar(id) {
  const P = S.punto;
  if (!P?.clima) return aviso('Primero consulta un punto con datos de clima', true);
  S[id] = P; globo.colocarPin(id, P.lat, P.lon, id === 'A' ? 0x4fa3ff : 0xff4f8b, id);
  globo.arcoAB(S.A, S.B); pintarAB();
  aviso(`Ubicación ${id} fijada: ${P.nombre}`);
}
function pintarAB() {
  const box = $('gAB'); box.hidden = !S.A && !S.B; if (box.hidden) return;
  const km = S.A && S.B ? G.distanciaKm(S.A.lat, S.A.lon, S.B.lat, S.B.lon) : null;
  box.innerHTML = `<span><b class="a">A</b> ${esc(S.A?.nombre ?? '—')}</span><span><b class="b">B</b> ${esc(S.B?.nombre ?? '—')}</span>${km != null ? `<small>${Math.round(km).toLocaleString('es')} km</small>` : ''}
    <button class="naranja" id="bComparar" ${S.A && S.B ? '' : 'disabled'}>⚖ Comparar A/B</button><button class="gris" id="bLimpiarAB">✕</button>`;
  $('bComparar').addEventListener('click', abrirComparador);
  $('bLimpiarAB').addEventListener('click', () => { S.A = S.B = null; globo.quitarPin('A'); globo.quitarPin('B'); globo.quitarArco(); pintarAB(); });
}
const lugarGeo = P => ({ clima: P.clima, suelo: P.suelo, gbif: gbifDe(P, S.sel) });
const MESES_OPT = sel => G.MESES.map((m, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${m}</option>`).join('');

function abrirComparador() {
  if (!S.A?.clima || !S.B?.clima) return;
  const esp = S.sel;
  abrirModal(`<h3>⚖️ ¿Dónde crece mejor <i>${esc(esp.nombre_cientifico)}</i>?</h3>
    <div class="opts"><label><input type="checkbox" id="cPre"> Bulbos pre-enfriados</label><label><input type="checkbox" id="cInv"> Invernadero (termostato)</label>
    <small class="suave">Se simula el ciclo completo con el clima real de cada lugar (siembra en otoño local).</small></div><div id="cmpCuerpo"></div>`);
  const dibujar = () => {
    const opc = { preFrio: $('cPre').checked, invernadero: $('cInv').checked };
    const rr = G.compararUbicaciones(esp, lugarGeo(S.A), lugarGeo(S.B), opc); S.cmp = { rr, opc, esp };
    const val = (fila, k) => { const v = fila[k]; if (v == null) return '—'; if (fila.clave === 'aborto') return v ? 'Sí' : 'No'; return (fila.dec === 0 ? Math.round(v).toLocaleString('es') : (+v).toFixed(fila.dec)) + fila.unidad; };
    const nombre = { A: S.A.nombre, B: S.B.nombre };
    const titulo = rr.ganador === 'empate' ? '🤝 Empate técnico' : `🏆 Gana ${rr.ganador}: ${esc(nombre[rr.ganador])}`;
    $('cmpCuerpo').innerHTML = `<div class="win">${titulo}<br><small>Puntaje final A ${rr.puntajeA.toFixed(3)} · B ${rr.puntajeB.toFixed(3)} (60 % simulación + 40 % idoneidad)</small></div>
      <table><tr><th>Métrica</th><th>A · ${esc(nombre.A)}</th><th>B · ${esc(nombre.B)}</th></tr>${rr.filas.map(fl => `<tr><td>${fl.etiqueta}</td><td class="${fl.ganaFila === 'A' ? 'gana' : ''}">${val(fl, 'a')}</td><td class="${fl.ganaFila === 'B' ? 'gana' : ''}">${val(fl, 'b')}</td></tr>`).join('')}</table>
      <h5>Biomasa simulada con el clima real de cada lugar</h5><div style="height:210px"><canvas id="cmpGraf"></canvas></div>
      <div class="noPrint" style="margin-top:10px"><button class="verde" id="cmpLab">🌷 Ver ambas plantas en el laboratorio 3D</button> <button class="azul" id="cmpGuardar">💾 Guardar comparación en MySQL</button></div>`;
    const pts = tr => tr.filter((_, i) => i % 3 === 0).map(h => ({ x: h.dia, y: +h.N.toFixed(2) }));
    grafica('cmpGraf', { type: 'line', data: { datasets: [
        { label: 'A · ' + nombre.A, data: pts(rr.simA.traza), borderColor: '#4fa3ff', pointRadius: 0, tension: .25, parsing: false },
        { label: 'B · ' + nombre.B, data: pts(rr.simB.traza), borderColor: '#ff4f8b', pointRadius: 0, tension: .25, parsing: false }] },
      options: { animation: false, responsive: true, maintainAspectRatio: false, scales: { x: { type: 'linear', title: { display: true, text: 'día desde la siembra' } }, y: { beginAtZero: true, title: { display: true, text: 'g' } } } } });
    $('cmpLab').addEventListener('click', () => {
      const cmp = { ganador: rr.ganador, puntaje_a: rr.puntajeA, puntaje_b: rr.puntajeB };
      $('modal').hidden = true; lanzarEnLab([itemLab('A', S.A, esp, opc, cmp), itemLab('B', S.B, esp, opc, cmp)]);
    });
    $('cmpGuardar').addEventListener('click', guardarComparacion);
  };
  $('cPre').addEventListener('change', dibujar); $('cInv').addEventListener('change', dibujar);
  dibujar();
}
async function guardarComparacion() {
  const { rr, esp } = S.cmp, btn = $('cmpGuardar'); btn.disabled = true;
  try {
    const ids = {};
    for (const id of ['A', 'B']) {
      const P = S[id], sim = id === 'A' ? rr.simA : rr.simB, p = id === 'A' ? rr.pSimA : rr.pSimB;
      const cuerpo = LAB.cuerpoDesde({ esp, p, hist: sim.traza, proy: [], decs: new Map(), geo: { nombre: P.nombre } }, id, `${esp.nombre_cientifico} @ ${P.nombre}`, 'Simulación de la comparación A/B geográfica', true);
      const simId = (await API.guardarSimulacion(cuerpo)).id;
      const an = await API.geoGuardarAnalisis({ ...payloadAnalisis(P, esp), simulacion_id: simId });
      ids[id] = { sim: simId, an: an.id };
    }
    await API.geoGuardarComparacion({ especie_id: esp.id, analisis_a_id: ids.A.an, analisis_b_id: ids.B.an, sim_a_id: ids.A.sim, sim_b_id: ids.B.sim, ganador: rr.ganador, puntaje_a: rr.puntajeA, puntaje_b: rr.puntajeB });
    aviso(`✔ Comparación guardada (análisis #${ids.A.an} y #${ids.B.an}, simulaciones #${ids.A.sim} y #${ids.B.sim})`); refrescarUbicaciones();
  } catch (e) { btn.disabled = false; aviso('No se pudo guardar: ' + e.message, true); }
}

// ---------- simulación con clima real ----------
function itemLab(id, P, esp, opc, comparacion = null) {
  const p = G.parametrosSim(P.clima, P.suelo, esp, opc);
  return { id, esp, p, geo: { nombre: P.nombre, payload: payloadAnalisis(P, esp), comparacion } };
}
function lanzarEnLab(items) { LAB.lanzarGeo(items); cambiarVista('lab'); }
function abrirSimular() {
  const P = S.punto, esp = S.sel; if (!P?.clima) return;
  const ev = evaluar(), sugerirPre = G.frioEfectivo(P.clima, esp) < 0.6 * esp.frio_req_dias;
  abrirModal(`<h3>▶ Simular <i>${esc(esp.nombre_cientifico)}</i> en ${esc(P.nombre)}</h3>
    <p class="suave">El simulador de la Práctica 05 tomará de este lugar la <b>temperatura</b> (NASA POWER, mensual → diaria), la <b>humedad del sustrato</b> (lluvia/ET0 + arcilla), la <b>luz</b> (radiación / cielo despejado) y los <b>nutrientes</b> (carbono orgánico y pH de SoilGrids).</p>
    <div class="opts"><label>Mes de siembra <select id="sMes">${MESES_OPT(G.mesSiembraSugerido(P.lat))}</select></label>
      <label><input type="checkbox" id="sPre" ${sugerirPre ? 'checked' : ''}> Bulbo pre-enfriado${sugerirPre ? ' <small>(sugerido: poco frío invernal)</small>' : ''}</label>
      <label><input type="checkbox" id="sInv"> Invernadero (termostato)</label></div>
    ${ev ? `<p class="suave">Idoneidad actual: <b>${ev.ido.puntaje.toFixed(0)}</b> (${ev.ido.clase}).</p>` : ''}
    <button class="verde" id="sGo">▶ Lanzar en el laboratorio 3D</button>`);
  $('sGo').addEventListener('click', () => {
    const opc = { mesSiembra: +$('sMes').value, preFrio: $('sPre').checked, invernadero: $('sInv').checked };
    $('modal').hidden = true; lanzarEnLab([itemLab('A', P, esp, opc)]);
  });
}
async function guardarAnalisis() {
  const P = S.punto, esp = S.sel; if (!P?.clima) return;
  try {
    const p = G.parametrosSim(P.clima, P.suelo, esp, {}), sim = G.simularCiclo(esp, p);
    const cuerpo = LAB.cuerpoDesde({ esp, p, hist: sim.traza, proy: [], decs: new Map(), geo: { nombre: P.nombre } }, 'A', `${esp.nombre_cientifico} @ ${P.nombre}`, 'Simulación con clima real (análisis geoespacial)');
    const simId = (await API.guardarSimulacion(cuerpo)).id;
    const an = await API.geoGuardarAnalisis({ ...payloadAnalisis(P, esp), simulacion_id: simId });
    aviso(`✔ Guardado en MySQL: análisis #${an.id} + simulación #${simId}`); refrescarUbicaciones();
  } catch (e) { aviso('No se pudo guardar: ' + e.message, true); }
}
async function refrescarUbicaciones() { S.ubic = await API.cargarUbicaciones(); globo.setUbicaciones(S.ubic); }

// ---------- ranking de idoneidad ----------
function abrirRanking(tab = 'especies') {
  const cab = `<h3>🏆 Ranking de idoneidad</h3><div class="pestanas">${[['especies', 'Especies en este punto'], ['matriz', 'Especie × ubicación'], ['guardado', 'Guardado en MySQL']].map(([k, t]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  abrirModal(cab + '<div id="rkCuerpo"></div>');
  $('modalCont').querySelectorAll('.pestanas button').forEach(b => b.addEventListener('click', () => abrirRanking(b.dataset.t)));
  if (tab === 'especies') rankEspecies(); else if (tab === 'matriz') rankMatriz(); else rankGuardado();
}
function rankEspecies() {
  const P = S.punto, box = $('rkCuerpo');
  if (!P?.clima || P.cargandoGbif) { box.innerHTML = '<p class="suave">Primero haz clic en un punto y espera a que terminen las consultas.</p>'; return; }
  const conteos = Object.fromEntries(Object.entries(P.conteos || {}).map(([k, v]) => [k, v.region]));
  const rk = G.rankingEspecies(S.especies, P, conteos, S.radio);
  box.innerHTML = `<p class="suave">Mismas condiciones reales de <b>${esc(P.nombre)}</b> evaluadas para cada especie del catálogo.</p>
    <div style="height:${40 + rk.length * 30}px"><canvas id="rkGraf"></canvas></div>
    <table><tr><th>#</th><th>Especie</th><th>Idoneidad</th><th>Clase</th><th>Factor limitante</th><th>GBIF (${S.radio} km)</th></tr>${rk.map((x, i) => `<tr data-id="${x.esp.id}" style="cursor:pointer"><td>${i + 1}</td><td><i>${esc(x.esp.nombre_cientifico)}</i></td><td><b>${x.ido.puntaje.toFixed(1)}</b></td><td>${x.ido.clase}</td><td>${esc(G.ETIQUETAS[x.ido.limitante])}</td><td>${x.gbif ? x.gbif.region.toLocaleString('es') : '—'}</td></tr>`).join('')}</table>`;
  grafica('rkGraf', { type: 'bar', data: { labels: rk.map(x => corto(x.esp)), datasets: [{ data: rk.map(x => x.ido.puntaje), backgroundColor: rk.map(x => COLOR_CLASE[x.ido.clase]) }] }, options: { indexAxis: 'y', animation: false, responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100 } } } });
  box.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => { $('gEspecie').value = tr.dataset.id; cambiarEspecie(); $('modal').hidden = true; }));
}
async function rankMatriz() {
  const box = $('rkCuerpo'), tok = ++S.matrizTok, presets = S.ubic.filter(u => +u.preset);
  const celdas = () => {
    const filas = presets.map(u => { const d = S.matriz.get(u.id); return { u, d, scores: d ? S.especies.map(e => G.idoneidad(d.clima, d.suelo, d.conteos?.[e.id] != null ? { region: d.conteos[e.id], radio_km: S.radio } : null, e)) : null }; });
    const idx = S.especies.findIndex(e => e.id === S.sel.id);
    filas.sort((a, b) => (b.scores ? b.scores[idx].puntaje : -1) - (a.scores ? a.scores[idx].puntaje : -1));
    return `<table class="heat"><tr><th>Ubicación</th>${S.especies.map(e => `<th style="${e.id === S.sel.id ? 'color:#ffe066' : ''}">${esc(corto(e))}</th>`).join('')}</tr>` + filas.map(({ u, d, scores }) => `<tr><td>${esc(u.nombre)}<small> ${esc(u.pais ?? '')}</small>${d && !d.suelo ? ' <small title="SoilGrids no respondió: índice sin suelo">*</small>' : ''}</td>` +
      (scores ? scores.map((s, i) => `<td class="cel" data-u="${u.id}" data-e="${S.especies[i].id}" style="background:${COLOR_CLASE[s.clase]}" title="${s.clase}">${s.puntaje.toFixed(0)}</td>`).join('') : `<td colspan="${S.especies.length}" class="suave">${d === null ? 'sin datos' : 'pendiente…'}</td>`) + '</tr>').join('') + '</table>';
  };
  const pintarM = (msg = '') => {
    if (tok !== S.matrizTok || $('modal').hidden) return false;
    box.innerHTML = `<p class="suave">Idoneidad (0-100) de cada especie en las ubicaciones de ejemplo, con datos reales. Las consultas se hacen de una en una para respetar los límites de las APIs; lo ya descargado sale de la caché. ${msg}</p>${celdas()}<p class="suave">* sin dato de suelo · clic en una celda para ir a ese lugar y especie.</p><button class="violeta" id="mxGo">${S.matriz.size ? '↻ Completar / recalcular pendientes' : '▶ Calcular ubicaciones'}</button>`;
    $('mxGo').addEventListener('click', ejecutar);
    box.querySelectorAll('td.cel').forEach(td => td.addEventListener('click', () => { const u = S.ubic.find(x => x.id == td.dataset.u); $('gEspecie').value = td.dataset.e; S.sel = S.especies.find(e => e.id == td.dataset.e); $('modal').hidden = true; seleccionarPunto(+u.lat, +u.lon, u); cargarCapaGbif(); }));
    return true;
  };
  async function ejecutar() {
    $('mxGo').disabled = true; let n = 0;
    for (const u of presets) {
      n++;
      if (S.matriz.get(u.id)?.clima) continue;
      if (!pintarM(`Consultando ${u.nombre} (${n}/${presets.length})…`)) return;
      try {
        const raw = await API.geoPunto(+u.lat, +u.lon), cn = await API.geoConteos(+u.lat, +u.lon, S.radio);
        S.matriz.set(u.id, { clima: raw.clima ? G.derivarClima({ ...raw.clima, lat: +u.lat, lon: +u.lon }) : null, suelo: raw.suelo ? { ...raw.suelo } : null, conteos: Object.fromEntries(cn.items.map(i => [i.especie_id, i.region])) });
        if (!S.matriz.get(u.id).clima) S.matriz.set(u.id, null);
      } catch { S.matriz.set(u.id, null); }
    }
    pintarM('Listo.');
  }
  pintarM();
}
async function rankGuardado() {
  const box = $('rkCuerpo'); box.innerHTML = '<p class="suave"><span class="spin"></span>Consultando MySQL…</p>';
  try {
    const r = await API.geoRanking(S.sel.id);
    box.innerHTML = r.length ? `<p class="suave">Análisis más reciente de <i>${esc(S.sel.nombre_cientifico)}</i> en cada lugar guardado.</p><table><tr><th>#</th><th>Lugar</th><th>Idoneidad</th><th>Clase</th><th>T media</th><th>Lluvia</th><th>Frío ef.</th><th>pH</th><th>GBIF</th></tr>${r.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.nombre)} <small>${esc(x.pais ?? '')}</small></td><td><b>${esc(x.idoneidad)}</b></td><td>${esc(x.clase)}</td><td>${esc(x.temp_media)} °C</td><td>${Math.round(x.precip_anual)} mm</td><td>${esc(x.frio_efectivo ?? '—')}</td><td>${esc(x.ph ?? '—')}</td><td>${esc(x.gbif_region ?? '—')}</td></tr>`).join('')}</table>` : '<p class="suave">Aún no hay análisis guardados para esta especie. Usa «💾 Guardar análisis».</p>';
  } catch (e) { box.innerHTML = `<div class="aviso">${esc(e.message)}</div>`; }
}

// ---------- historial y caché ----------
async function abrirHistorial() {
  abrirModal('<h3>📚 Análisis geoespaciales guardados</h3><p class="suave"><span class="spin"></span>Cargando…</p>');
  try {
    const [an, cm] = await Promise.all([API.geoAnalisis(), API.geoComparaciones()]);
    abrirModal(`<h3>📚 Análisis geoespaciales guardados</h3><table><tr><th>#</th><th>Lugar</th><th>Especie</th><th>Idoneidad</th><th>Simulación</th><th>Fecha</th></tr>${an.map(x => `<tr><td>${esc(x.id)}</td><td>${esc(x.nombre)} <small>${esc(x.pais ?? '')}</small></td><td><i>${esc(x.nombre_cientifico)}</i></td><td><b>${esc(x.idoneidad)}</b> ${esc(x.clase)}</td><td>${x.simulacion_id ? '#' + esc(x.simulacion_id) : '—'}</td><td>${esc(x.creada_en)}</td></tr>`).join('') || '<tr><td colspan="6" class="suave">Sin análisis todavía.</td></tr>'}</table>
      <h5>Comparaciones A/B geográficas</h5><table><tr><th>#</th><th>Especie</th><th>A</th><th>B</th><th>Ganador</th><th>Puntajes</th></tr>${cm.map(x => `<tr><td>${esc(x.id)}</td><td><i>${esc(x.nombre_cientifico)}</i></td><td>${esc(x.lugar_a)} (${esc(x.idoneidad_a)})</td><td>${esc(x.lugar_b)} (${esc(x.idoneidad_b)})</td><td><b>${esc(x.ganador)}</b></td><td>${(+x.puntaje_a).toFixed(2)} / ${(+x.puntaje_b).toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="6" class="suave">Sin comparaciones todavía.</td></tr>'}</table>`);
  } catch (e) { abrirModal(`<h3>📚 Análisis guardados</h3><div class="aviso">${esc(e.message)}</div>`); }
}
async function abrirCache() {
  try {
    const c = await API.geoCache();
    abrirModal(`<h3>🗄 Caché de APIs externas (MySQL · tabla cache_api)</h3><div class="kpiRow"><div><small>Entradas vigentes</small><b>${esc(c.entradas)}</b></div><div><small>Aciertos de caché</small><b>${esc(c.aciertos)}</b></div></div>
      <table><tr><th>Proveedor</th><th>Entradas</th><th>Aciertos</th><th>Errores en caché</th><th>Última descarga</th></tr>${c.proveedores.map(p => `<tr><td>${esc(p.proveedor)}</td><td>${esc(p.entradas)}</td><td>${esc(p.aciertos)}</td><td>${esc(p.errores_en_cache)}</td><td>${esc(p.ultima_descarga)}</td></tr>`).join('') || '<tr><td colspan="5" class="suave">Vacía: aún no has consultado ningún punto.</td></tr>'}</table>
      <p class="suave">Vigencia: NASA POWER 30 días · SoilGrids 90 días · GBIF 1 día (conteos) / 7 días (puntos) · Open-Meteo 15 min · nombre del lugar 30 días · errores 2 min (caché negativa).</p>`);
  } catch (e) { aviso('No se pudo leer la caché: ' + e.message, true); }
}

// ---------- diagnóstico del servidor (PHP · MySQL · APIs externas) ----------
async function abrirDiagnostico() {
  abrirModal('<h3>🩺 Diagnóstico del servidor</h3><p class="suave"><span class="spin"></span>Probando PHP, MySQL y las APIs externas desde el servidor…</p>');
  const fila = (ok, t, extra = '') => `<tr><td>${ok ? '✔' : '✖'}</td><td>${t}</td><td class="suave">${esc(extra)}</td></tr>`;
  try {
    if (!API.estado.modo) throw new Error('El navegador no llega a api/index.php.\n' + API.estado.intentos.join('\n'));
    const d = await API.geoDiagnostico();
    const pista = a => !a.error ? (a.ok ? '' : `HTTP ${a.http}`) : /ssl|certificate/i.test(a.error) ? 'Certificados SSL: descarga https://curl.se/ca/cacert.pem y ponlo en http.cacert (api/config.local.php)'
      : /resolve|timed out|timeout|connect|refused|unreachable/i.test(a.error) ? 'El servidor no tiene salida a Internet hacia esta API (firewall/proxy del laboratorio)' : a.error;
    abrirModal(`<h3>🩺 Diagnóstico del servidor</h3>
      <table>${fila(true, 'PHP ' + esc(d.php), 'forma de URL usada por el navegador: ' + API.estado.modo)}${fila(d.curl, 'Extensión cURL', d.curl_version ? 'v' + d.curl_version : 'actívala en php.ini (extension=curl)')}
      ${fila(d.mysql, 'MySQL', d.mysql_error || '')}${Object.entries(d.tablas || {}).map(([t, ok]) => fila(ok, 'Tabla ' + t, ok ? '' : 'importa database/schema.sql y seed.sql')).join('')}
      ${fila(d.user_agent_personalizado, 'User-Agent con tu correo', d.user_agent_personalizado ? '' : 'Nominatim lo exige: edítalo en api/config.local.php (http.user_agent)')}</table>
      <h5>APIs externas llamadas desde el servidor (sin caché)</h5>
      <table><tr><th></th><th>API</th><th>HTTP</th><th>Tiempo</th><th>Detalle</th></tr>${Object.entries(d.apis || {}).map(([n, a]) => `<tr><td>${a.ok ? '✔' : '✖'}</td><td>${esc(n)}</td><td>${esc(a.http)}</td><td>${esc(a.ms ?? '—')} ms</td><td class="suave">${esc(pista(a))}</td></tr>`).join('')}</table>
      <p class="suave">Si todas salen ✔ pero la app falla, abre la consola del navegador (F12). Si SoilGrids sale ✖, es normal que a veces esté saturada: la app sigue sin suelo.</p>`);
  } catch (e) {
    abrirModal(`<h3>🩺 Diagnóstico del servidor</h3><div class="aviso">${esc(e.message).replace(/\n/g, '<br>')}</div><p class="suave">Comprueba la dirección de la API en <code>config.js</code> (<code>window.P06_API</code>), que el servidor ejecute PHP y abre <code>api/index.php/ping</code> en el navegador: debe mostrar <code>{"ok":true,"ping":true…}</code>.</p>`);
  }
}

// ---------- eventos ----------
function cambiarEspecie() {
  S.sel = S.especies.find(e => e.id == $('gEspecie').value); pintar(); cargarCapaGbif();
}
function enlazar() {
  document.querySelectorAll('#barra nav button').forEach(b => b.addEventListener('click', () => cambiarVista(b.dataset.vista)));
  $('btnVolverGlobo').addEventListener('click', () => cambiarVista('globo'));
  $('gEspecie').addEventListener('change', cambiarEspecie);
  $('capaGbif').addEventListener('change', cargarCapaGbif);
  $('capaUbic').addEventListener('change', e => globo.mostrarUbicaciones(e.target.checked));
  $('gRadio').addEventListener('input', e => { $('vRadio').textContent = e.target.value + ' km'; });
  $('gRadio').addEventListener('change', e => { S.radio = +e.target.value; S.matriz.clear(); if (S.punto?.clima) seleccionarPunto(S.punto.lat, S.punto.lon, S.punto.nombre ? { nombre: S.punto.nombre, pais: S.punto.pais, codigo_pais: S.punto.cc } : null); });
  $('bRanking').addEventListener('click', () => abrirRanking('especies'));
  $('bCache').addEventListener('click', abrirCache);
  $('bHistGeo').addEventListener('click', abrirHistorial);
  $('bCapturaG').addEventListener('click', () => { const a = document.createElement('a'); a.href = globo.capturar(); a.download = 'globo.png'; a.click(); });
  $('gPanel').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-id]'); if (tr) { $('gEspecie').value = tr.dataset.id; cambiarEspecie(); return; }
    const b = e.target.closest('[data-acc]'); if (!b) return;
    ({ simular: abrirSimular, fijarA: () => fijar('A'), fijarB: () => fijar('B'), guardar: guardarAnalisis, ranking: () => abrirRanking('especies'), diag: abrirDiagnostico })[b.dataset.acc]?.();
  });
  $('bDiag').addEventListener('click', abrirDiagnostico); $('badgeApi').addEventListener('click', abrirDiagnostico);
  // buscador (consumo directo de Open-Meteo Geocoding desde el navegador)
  let tb; $('gBuscar').addEventListener('input', e => {
    clearTimeout(tb); const q = e.target.value.trim(), ul = $('gResultados');
    if (q.length < 2) { ul.innerHTML = ''; return; }
    tb = setTimeout(async () => {
      try {
        const r = await API.buscarLugar(q);
        ul.innerHTML = r.length ? r.map((x, i) => `<li data-i="${i}">${esc(x.nombre)}<small>${esc([x.region, x.pais].filter(Boolean).join(', '))}</small></li>`).join('') : '<li class="suave">Sin resultados</li>';
        ul.querySelectorAll('li[data-i]').forEach(li => li.addEventListener('click', () => { const x = r[li.dataset.i]; ul.innerHTML = ''; $('gBuscar').value = ''; seleccionarPunto(x.lat, x.lon, x); }));
      } catch { ul.innerHTML = '<li class="suave">No se pudo buscar (sin conexión)</li>'; }
    }, 350);
  });
}

async function init() {
  S.especies = await API.cargarEspecies(); S.sel = S.especies[0];
  $('gEspecie').innerHTML = S.especies.map(e => `<option value="${e.id}">${esc(e.nombre_comun)} (${esc(e.nombre_cientifico)})</option>`).join('');
  $('badgeApi').textContent = API.estado.conectado ? 'MySQL conectado' : 'Modo local (sin API)'; $('badgeApi').classList.toggle('ok', API.estado.conectado);
  $('badgeApi').title = API.estado.conectado ? 'FlightPHP + MySQL + proxy de APIs disponibles (clic = diagnóstico)' : 'La API PHP no responde (clic = diagnóstico): ' + (API.estado.error || '');
  globo = crearGlobo({
    onClick: h => h.ubic ? seleccionarPunto(+h.ubic.lat, +h.ubic.lon, h.ubic) : seleccionarPunto(h.lat, h.lon),
    onHover: (u, x, y) => { const t = $('tip'); if (!u) { t.hidden = true; return; } t.textContent = `${u.nombre}${u.pais ? ' · ' + u.pais : ''}${+u.analisis ? ' · ' + u.analisis + ' análisis' : ''}`; t.style.left = x + 12 + 'px'; t.style.top = y + 12 + 'px'; t.hidden = false; }
  });
  S.ubic = await API.cargarUbicaciones(); globo.setUbicaciones(S.ubic);
  $('gPresets').innerHTML = S.ubic.filter(u => +u.preset).map(u => `<button class="chip" data-id="${u.id}">${esc(u.nombre)}</button>`).join('');
  $('gPresets').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { const u = S.ubic.find(x => x.id == b.dataset.id); seleccionarPunto(+u.lat, +u.lon, u); }));
  enlazar(); cambiarVista('globo'); cargarCapaGbif();
  let t0 = performance.now();
  (function bucle(t) { requestAnimationFrame(bucle); const dt = Math.min(.1, (t - t0) / 1000); t0 = t; globo.render(dt); })(t0);
}
init();
