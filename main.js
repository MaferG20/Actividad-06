// LABORATORIO BIOINFORMÁTICO DE CULTIVO · Práctica 05 (continuación de la 04) + modo «clima real» de la Práctica 06
import { crearEscena } from './js/escena.js';
import * as M from './js/modelos.js';
import * as API from './js/api.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); // evita XSS al pintar datos de la BD
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const DIAS_POR_S = 2;           // días simulados por segundo con velocidad 1x
const CADA_N_DIAS = 5;          // se guarda una medición cada N días (no cada frame)
const COLORES_FASE = ['#4fa3ff', '#9ad1ff', '#52b788', '#b5e048', '#ff4f8b', '#c9a24a', '#7a8a90'];

const SLIDERS = [
  { k: 'r',    t: '🧬 Tasa intrínseca (r)',    min: .02, max: .25, step: .005, f: v => v.toFixed(3) + ' /d' },
  { k: 'K',    t: '🧬 Capacidad de carga (K)', min: 5,   max: 60,  step: 1,    f: v => v + ' g' },
  { k: 'luz',  t: '☀️ Luz solar',              min: 0,   max: 100, step: 1,    f: v => v + ' %' },
  { k: 'agua', t: '💧 Agua / humedad',         min: 0,   max: 100, step: 1,    f: v => v + ' %' },
  { k: 'temp', t: '🌡 Temperatura',            min: -5,  max: 35,  step: .5,   f: v => v.toFixed(1) + ' °C' },
  { k: 'nutr', t: '🧪 Nutrientes (NPK)',       min: 0,   max: 100, step: 1,    f: v => v + ' %' },
  { k: 'co2',  t: '🫧 CO₂ atmosférico',        min: 300, max: 1200, step: 10,  f: v => v + ' ppm' }
];
export const ctx = { activo: false, especies: [], esc: { A: null, B: null }, ab: false, editando: 'A', corriendo: true, vel: 3, acum: 0, revision: null, sel: null, escena: null, chart: null, ultimoUI: 0, reporte: null };

// ---------- Escenarios ----------
function nuevoEsc(esp, p) { return { esp, p: p || M.paramsPorDefecto(esp), e: M.estadoInicial(esp), hist: [], proy: [], traza: [], decs: new Map(), geo: null }; }
const activos = () => ctx.ab ? ['A', 'B'] : ['A'];
function registrarDecisiones(s) {
  for (const d of M.evaluarDecisiones(s.e, s.p, s.esp)) if (!['OK', 'INFO_VEG'].includes(d.codigo) && !s.decs.has(d.codigo)) s.decs.set(d.codigo, { dia: s.e.dia, ...d });
}
function paso(s) {
  if (s.e.fase >= 6) return;
  const antes = s.e.fase;
  s.e = M.avanzarDia(s.e, s.p, s.esp);
  s.hist.push(s.e);
  if (s.e.dia % CADA_N_DIAS === 0 || s.e.fase !== antes) registrarDecisiones(s);
}
function recalcular(s) {   // proyección a fin de ciclo con las condiciones actuales
  s.proy = M.proyectar(s.e, s.p, s.esp);
  s.traza = [M.estadoInicial(s.esp), ...s.hist, ...s.proy];
}
const vista = s => ctx.revision == null ? s.e : (s.traza[Math.min(ctx.revision, s.traza.length - 1)] || s.e);

// ---------- Toast ----------
let tToast;
function aviso(msg, error = false) {
  const t = $('toast'); t.textContent = msg; t.className = error ? 'err' : ''; t.hidden = false;
  clearTimeout(tToast); tToast = setTimeout(() => t.hidden = true, 4200);
}

// ---------- Controles ----------
function construirSliders() {
  $('sliders').innerHTML = SLIDERS.map(s => `<div class="sl"><label>${s.t}<span id="v_${s.k}"></span></label><input type="range" id="s_${s.k}" min="${s.min}" max="${s.max}" step="${s.step}"></div>`).join('');
  SLIDERS.forEach(s => $('s_' + s.k).addEventListener('input', e => {
    const sc = ctx.esc[ctx.editando]; sc.p[s.k] = parseFloat(e.target.value);
    $('v_' + s.k).textContent = s.f(sc.p[s.k]);
    if (s.k === 'r' || s.k === 'K') recalcular(sc);
  }));
  $('slidersGlobales').innerHTML = `
    <div class="sl"><label>⏩ Velocidad<span id="v_vel"></span></label><input type="range" id="s_vel" min="0.5" max="12" step="0.5" value="3"></div>
    <div class="sl"><label>🌬 Viento<span id="v_vie"></span></label><input type="range" id="s_vie" min="0" max="3" step="0.1" value="1"></div>
    <div class="sl"><label>💡 Luz de la escena<span id="v_lue"></span></label><input type="range" id="s_lue" min="0.3" max="3" step="0.1" value="1.2"></div>`;
  const g = (id, fn, f) => { const el = $(id); const act = () => { fn(parseFloat(el.value)); }; el.addEventListener('input', act); act(); };
  g('s_vel', v => { ctx.vel = v; $('v_vel').textContent = v.toFixed(1) + 'x'; });
  g('s_vie', v => { ctx.escena.setViento(v); $('v_vie').textContent = v.toFixed(1); });
  g('s_lue', v => { ctx.escena.setLuz(v); $('v_lue').textContent = v.toFixed(1); });
}
function sincronizarControles() {
  const sc = ctx.esc[ctx.editando];
  $('selEspecie').value = sc.esp.id; $('selModelo').value = sc.p.modelo; $('chkTermo').checked = sc.p.termostato;
  $('tituloParams').textContent = `Parámetros genéticos y ambientales (${ctx.editando})`;
  SLIDERS.forEach(s => { $('s_' + s.k).value = sc.p[s.k]; $('v_' + s.k).textContent = s.f(sc.p[s.k]); });
  const real = !!sc.p.serie;                                  // con clima real, T/agua/luz las manda el lugar
  $('s_temp').disabled = sc.p.termostato || real; $('s_agua').disabled = real; $('s_luz').disabled = real;
  $('selEspecie').disabled = !!sc.geo; $('selEspecie').title = sc.geo ? 'La especie está fijada por el análisis geoespacial' : '';
  document.querySelectorAll('#tabsEsc button').forEach(b => { b.classList.toggle('on', b.dataset.esc === ctx.editando); b.hidden = b.dataset.esc === 'B' && !ctx.ab; });
}
function sincronizarTemp() {   // el termostato mueve la temperatura: reflejarla en el slider
  const sc = ctx.esc[ctx.editando];
  if ((sc.p.termostato || sc.p.serie) && ctx.revision == null) { $('s_temp').value = sc.p.temp; $('v_temp').textContent = sc.p.temp.toFixed(1) + ' °C'; }
  if (sc.p.serie && ctx.revision == null) { for (const k of ['agua', 'luz']) { $('s_' + k).value = sc.p[k]; $('v_' + k).textContent = Math.round(sc.p[k]) + ' %'; } }
}
function reiniciar(id, esp, p) {
  const geoPrevio = p ? null : ctx.esc[id]?.geo ?? null;      // reiniciar conserva el lugar (y su clima real)
  ctx.esc[id] = nuevoEsc(esp || ctx.esc[id].esp, p || { ...ctx.esc[id].p, temp: 6 });
  ctx.esc[id].geo = geoPrevio;
  ctx.escena.setColorEspecie(id, ctx.esc[id].esp.color_hex);
  recalcular(ctx.esc[id]);
}
function activarAB(on, reset = true) {
  ctx.ab = on; $('chkAB').checked = on;
  if (on) { reiniciar('A'); ctx.esc.B = nuevoEsc(ctx.esc.A.esp, { ...ctx.esc.A.p }); ctx.escena.setColorEspecie('B', ctx.esc.B.esp.color_hex); recalcular(ctx.esc.B); }
  else { ctx.esc.B = null; ctx.editando = 'A'; }
  ctx.escena.setAB(on); ctx.revision = null; sincronizarControles();
  $('boxAB').hidden = !on;
  if (ctx.chart) ctx.chart.data.datasets.forEach((d, i) => { if (i === 2 || i === 3) d.hidden = !on; });
  if (on && reset) aviso('A/B activado: ambos escenarios reiniciados. Edita B con su pestaña.');
}
function enlazarEventos() {
  $('selEspecie').innerHTML = ctx.especies.map(e => `<option value="${e.id}">${esc(e.nombre_comun)} (${esc(e.nombre_cientifico)})</option>`).join('');
  $('selModelo').innerHTML = Object.entries(M.MODELOS).map(([k, m]) => `<option value="${k}">${esc(m.nombre)}</option>`).join('');
  $('selEspecie').addEventListener('change', e => { const esp = ctx.especies.find(x => x.id == e.target.value); reiniciar(ctx.editando, esp, M.paramsPorDefecto(esp)); ctx.revision = null; sincronizarControles(); });
  $('selModelo').addEventListener('change', e => { const sc = ctx.esc[ctx.editando]; sc.p.modelo = e.target.value; recalcular(sc); });
  $('chkTermo').addEventListener('change', e => { const sc = ctx.esc[ctx.editando]; sc.p.termostato = e.target.checked; $('s_temp').disabled = e.target.checked; recalcular(sc); });
  $('chkAB').addEventListener('change', e => activarAB(e.target.checked));
  $('chkCorte').addEventListener('change', e => ctx.escena.setCorte(e.target.checked));
  document.querySelectorAll('#tabsEsc button').forEach(b => b.addEventListener('click', () => { ctx.editando = b.dataset.esc; sincronizarControles(); }));
  $('btnPausa').addEventListener('click', () => { ctx.corriendo = !ctx.corriendo; $('btnPausa').textContent = ctx.corriendo ? '⏸ Pausar' : '▶ Reanudar'; });
  $('btnReiniciar').addEventListener('click', () => { activos().forEach(id => reiniciar(id)); ctx.revision = null; ctx.corriendo = true; $('btnPausa').textContent = '⏸ Pausar'; sincronizarControles(); });
  $('btnCamara').addEventListener('click', () => ctx.escena.resetCamara());
  $('btnCaptura').addEventListener('click', () => { const a = document.createElement('a'); a.href = ctx.escena.capturar(); a.download = 'captura.png'; a.click(); });
  $('btnVivo').addEventListener('click', () => { ctx.revision = null; });
  $('btnQuitarGeo').addEventListener('click', quitarGeo);
  $('btnGuardar').addEventListener('click', abrirGuardar);
  $('btnReportes').addEventListener('click', () => abrirReportes('reportes'));
  $('cerrarModal').addEventListener('click', () => $('modal').hidden = true);
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal') $('modal').hidden = true; });
  // línea de tiempo: clic → revisar ese día (pasado real o proyección)
  $('tlPista').addEventListener('click', e => {
    const s = ctx.esc.A, total = s.traza.length - 1; if (total < 1) return;
    const r = $('tlPista').getBoundingClientRect();
    ctx.revision = clamp(Math.round((e.clientX - r.left) / r.width * total), 0, total);
  });
  // raycasting: clic sobre la planta
  addEventListener('click', e => {
    if (e.target.closest('.panel, #modal')) return;
    ctx.sel = ctx.escena.seleccionar(e.clientX, e.clientY);
  });
}

// ---------- Panel derecho ----------
function pintarParte() {
  const box = $('parteDatos');
  if (!ctx.sel || !ctx.esc[ctx.sel.cama]) { $('parteVacio').hidden = false; box.hidden = true; return; }
  const s = ctx.esc[ctx.sel.cama], e = vista(s), P = M.PARTES[ctx.sel.parte]; if (!P) return;
  const sen = e.fase === 5 ? clamp(e.tSen / 30, 0, 1) : e.fase === 6 ? 1 : 0;
  let pct = 100, share = P.share;
  switch (ctx.sel.parte) {
    case 'bulbo': case 'raices': pct = e.fase === 0 && ctx.sel.parte === 'raices' ? Math.round(e.frio) : Math.round(100 * clamp(e.N / s.p.K, 0, 1)); break;
    case 'tallo': pct = Math.round(100 * e.h / s.esp.altura_max); break;
    case 'hoja': pct = ctx.sel.hoja < e.hojas ? Math.round(100 * clamp(e.g / .6, 0, 1)) : 0; share = e.hojas ? P.share / e.hojas : 0; break;
    case 'flor': case 'pistilo': pct = e.fase < 3 ? 0 : e.fase === 3 ? Math.round(70 * clamp((e.g - .45) / .4, 0, 1)) : Math.round(100 * (1 - .45 * sen)); break;
  }
  if (ctx.sel.parte === 'flor') share = pct ? P.share / 6 : 0;
  const nomEst = { h: 'hídrico', t: 'térmico', l: 'lumínico', n: 'nutricional' }[P.estres];
  const g = share * e.N;
  box.hidden = false; $('parteVacio').hidden = true;
  box.innerHTML = `<p><b>${esc(ctx.sel.nombre)}</b> · Escenario ${esc(ctx.sel.cama)}</p>
    <p><b>Especie:</b> <i>${esc(s.esp.nombre_cientifico)}</i></p>
    <p><b>Geometría:</b> ${esc(ctx.sel.geometria)} · <b>Crecimiento:</b> ${pct}%</p>
    <p><b>Estrés asociado (${nomEst}):</b> ${e.estres[P.estres].toFixed(1)}%</p>
    <p><b>Contribución a la biomasa:</b> ${g.toFixed(2)} g (${(100 * g / e.N).toFixed(1)}% del total)</p>
    <p><b>Función:</b> ${esc(P.funcion)}</p><p><b>Necesita:</b> ${esc(P.necesita)}</p><p><b>Problemas:</b> ${esc(P.problemas)}</p>`;
}
const colorEstres = v => v <= 20 ? '#4cd98a' : v <= 50 ? '#ffd84a' : v <= 75 ? '#ff9a3c' : '#ff5a5a';
function barra(t, v, color) { return `<div class="barra"><span><em>${t}</em><em>${v.toFixed(1)}%</em></span><i><u style="width:${clamp(v, 0, 100)}%;background:${color || colorEstres(v)}"></u></i></div>`; }

function actualizarUI() {
  const id = ctx.editando === 'B' && ctx.ab ? 'B' : 'A', s = ctx.esc[id], e = vista(s);
  const proy = s.proy, dc = M.diasACosecha(s.e, proy);
  $('escVista').textContent = (ctx.ab ? 'Escenario ' + id : s.esp.nombre_cientifico) + (ctx.revision != null ? ' · revisión' : '');
  $('faseNombre').textContent = M.FASES[e.fase] + (e.aborto ? ' ⚠ aborto floral' : '');
  $('kDia').textContent = e.dia; $('kAlt').textContent = e.h.toFixed(2); $('kBio').textContent = e.N.toFixed(1);
  $('kHojas').textContent = `${e.hojas} / ${e.bulbillos}`; $('kIcr').textContent = e.icr.toFixed(4);
  $('kCos').textContent = s.e.fase >= 4 ? (s.e.fase === 4 ? '¡Ya!' : 'Hecho') : dc == null ? '—' : dc + ' d';
  $('barras').innerHTML = barra('Estrés hídrico', e.estres.h) + barra('Estrés térmico', e.estres.t) + barra('Estrés lumínico', e.estres.l) + barra('Estrés nutricional', e.estres.n) +
    barra('<b>Estrés global</b>', e.estres.g) + barra('❄️ Frío acumulado (dormancia)', e.frio, '#4fa3ff') + barra('🧅 Salud del bulbo', e.bulbo, e.bulbo > 60 ? '#4cd98a' : e.bulbo > 30 ? '#ffa24d' : '#ff5a5a');
  // motor de decisiones
  const dec = M.evaluarDecisiones(s.e, { ...s.p, temp: s.e.temp ?? s.p.temp }, s.esp);
  $('accionPrincipal').textContent = '▶ ' + dec[0].titulo; $('accionPrincipal').className = 'accion sev-' + dec[0].severidad;
  $('listaDecisiones').innerHTML = dec.slice(0, 4).map(d => `<li class="sev-${d.severidad}"><b>${esc(d.titulo)}</b> — ${esc(d.detalle)} ${d.umbral ? `<small>[umbral: ${esc(d.umbral)}]</small>` : ''}</li>`).join('');
  $('modeloNombre').textContent = '📐 ' + M.MODELOS[s.p.modelo].nombre; $('modeloDesc').textContent = M.MODELOS[s.p.modelo].desc;
  pintarParte(); pintarTimeline(); actualizarGrafica(); if (ctx.ab) pintarAB();
  $('btnVivo').hidden = ctx.revision == null;
  const A = ctx.esc.A; $('tlInfo').textContent = `Día ${vista(A).dia} / ${A.traza.length - 1}` + (ctx.revision != null && ctx.revision > A.hist.length ? ' (proyección)' : '');
  sincronizarTemp();
}

function pintarTimeline() {
  const s = ctx.esc.A, T = s.traza, total = Math.max(1, T.length - 1);
  let html = '', ini = 0;
  for (let i = 1; i <= T.length; i++) {
    if (i === T.length || T[i].fase !== T[ini].fase) { html += `<div title="${esc(M.FASES[T[ini].fase])}" style="width:${100 * (i - ini) / T.length}%;background:${COLORES_FASE[T[ini].fase]}"></div>`; ini = i; }
  }
  $('tlSegs').innerHTML = html;
  const dia = ctx.revision ?? s.e.dia;
  $('tlCursor').style.left = `calc(${100 * dia / total}% - 1px)`;
  $('tlFuturo').style.width = `${100 * (1 - (s.e.dia) / total)}%`;
  $('tlLeyenda').innerHTML = M.FASES.slice(0, 6).map((f, i) => `<span><i style="background:${COLORES_FASE[i]}"></i>${f}</span>`).join('');
}

// ---------- Gráfica (Chart.js) ----------
function crearGrafica() {
  Chart.defaults.color = '#bcd8cc'; Chart.defaults.font.size = 10;
  const ds = (label, color, extra = {}) => ({ label, data: [], borderColor: color, backgroundColor: color + '33', pointRadius: 0, borderWidth: 2, tension: .25, parsing: false, yAxisID: 'y', ...extra });
  ctx.chart = new Chart($('grafica'), {
    type: 'line',
    data: { datasets: [ds('Biomasa A (g)', '#52b788'), ds('Proy. A', '#52b788', { borderDash: [3, 4], borderWidth: 1.2 }), ds('Biomasa B (g)', '#ff4f8b', { hidden: true }), ds('Proy. B', '#ff4f8b', { borderDash: [3, 4], borderWidth: 1.2, hidden: true }), ds('Estrés global A (%)', '#ff7b54', { yAxisID: 'y1', borderWidth: 1.5 })] },
    options: { animation: false, responsive: true, maintainAspectRatio: false, interaction: { mode: 'nearest', intersect: false },
      scales: { x: { type: 'linear', title: { display: true, text: 'día' }, grid: { color: '#ffffff12' } }, y: { title: { display: true, text: 'Biomasa (g)' }, grid: { color: '#ffffff12' }, min: 0 }, y1: { position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false } } },
      plugins: { legend: { labels: { boxWidth: 9 } } } }
  });
}
function actualizarGrafica() {
  const dec = a => a.filter((_, i) => i % 3 === 0 || i === a.length - 1);
  const pts = (a, f) => dec(a).map(h => ({ x: h.dia, y: f(h) }));
  const [dA, pA, dB, pB, st] = ctx.chart.data.datasets;
  const A = ctx.esc.A, B = ctx.esc.B;
  dA.data = pts(A.hist, h => +h.N.toFixed(2)); pA.data = [{ x: A.e.dia, y: +A.e.N.toFixed(2) }, ...pts(A.proy, h => +h.N.toFixed(2))];
  st.data = pts(A.hist, h => +h.estres.g.toFixed(1));
  if (B) { dB.data = pts(B.hist, h => +h.N.toFixed(2)); pB.data = [{ x: B.e.dia, y: +B.e.N.toFixed(2) }, ...pts(B.proy, h => +h.N.toFixed(2))]; }
  ctx.chart.update('none');
}

// ---------- A/B ----------
function resultadoProy(s) { return M.resumenSim([...s.hist, ...s.proy], s.esp); }
function pintarAB() {
  const A = ctx.esc.A, B = ctx.esc.B; if (!B) return;
  const rA = resultadoProy(A), rB = resultadoProy(B), c = M.compararAB(rA, rB);
  const f = (a, b) => `<tr><td>${a}</td>${b}</tr>`;
  $('tablaAB').innerHTML = `<tr><th></th><th>A</th><th>B</th></tr>` +
    f('Biomasa final (g)', `<td>${rA.biomasa_final.toFixed(1)}</td><td>${rB.biomasa_final.toFixed(1)}</td>`) +
    f('Días a floración', `<td>${rA.dias_madurez ?? '—'}</td><td>${rB.dias_madurez ?? '—'}</td>`) +
    f('Estrés medio (%)', `<td>${rA.estres_medio.toFixed(1)}</td><td>${rB.estres_medio.toFixed(1)}</td>`) +
    f('Puntaje', `<td>${c.puntajeA.toFixed(2)}</td><td>${c.puntajeB.toFixed(2)}</td>`);
  $('ganadorAB').textContent = c.ganador === 'empate' ? '🤝 Empate técnico' : `🏆 Ganador: Escenario ${c.ganador} (${Math.abs(c.dif_biomasa_pct).toFixed(0)}% ${c.dif_biomasa_pct * (c.ganador === 'A' ? 1 : -1) >= 0 ? 'más' : 'menos'} biomasa)` + (A.e.fase < 6 || B.e.fase < 6 ? ' · provisional' : '');
}

// ---------- Guardar en MySQL ----------
export function cuerpoDesde(s, id, nombre, notas, ab = false) {
  const traza = [...s.hist, ...s.proy];   // al guardar se completa el ciclo con las condiciones actuales
  const r = M.resumenSim(traza, s.esp);
  const meds = traza.filter((h, i) => h.dia % CADA_N_DIAS === 0 || i === traza.length - 1).map(h => ({
    dia: h.dia, fase: h.fase, biomasa: h.N, altura: h.h, hojas: h.hojas, bulbillos: h.bulbillos, icr: h.icr,
    estres_hidrico: h.estres.h, estres_termico: h.estres.t, estres_luminico: h.estres.l, estres_nutricional: h.estres.n, estres_global: h.estres.g,
    frio_acum: h.frio, salud_bulbo: h.bulbo, temp: h.temp ?? s.p.temp, agua: h.agua ?? s.p.agua, luz: h.luz ?? s.p.luz, nutr: s.p.nutr }));
  const ult = traza[traza.length - 1] || s.e;
  const decs = [...s.decs.values(), ...M.evaluarDecisiones(ult, s.p, s.esp).filter(d => d.codigo === 'FIN')].map(d => ({ dia: d.dia ?? ult.dia, codigo: d.codigo, severidad: d.severidad, titulo: d.titulo, detalle: d.detalle, umbral: d.umbral, valor: d.valor }));
  const notasF = s.geo ? `${notas || ''} [Clima real NASA POWER, suelo SoilGrids · ${s.geo.nombre}]`.trim() : notas;
  return { especie_id: s.esp.id, nombre: ab ? `${nombre} (${id})` : nombre, notas: notasF, modelo: s.p.modelo, luz: s.p.luz, agua: s.p.agua, temp: s.p.temp, nutr: s.p.nutr, co2: s.p.co2, r: s.p.r, k: s.p.K,
    termostato: s.p.termostato, escenario: id, ...r, mediciones: meds, decisiones: decs };
}
const cuerpoSim = (id, nombre, notas) => cuerpoDesde(ctx.esc[id], id, nombre, notas, ctx.ab);
function abrirModal(html) { $('modalCont').innerHTML = html; $('modal').hidden = false; }
function abrirGuardar() {
  abrirModal(`<h3>💾 Guardar simulación en MySQL</h3>
    <label>Nombre<input type="text" id="gNombre" maxlength="100" value="${esc(ctx.esc.A.geo ? ctx.esc.A.esp.nombre_cientifico + ' @ ' + ctx.esc.A.geo.nombre : 'Tulipán ' + ctx.esc.A.esp.nombre_cientifico.split(' ')[1] + ' · ' + ctx.esc.A.p.modelo)}"></label>
    <label>Notas<textarea id="gNotas" rows="3" maxlength="1000" placeholder="Hipótesis, observaciones…"></textarea></label>
    <p class="suave">Se guardan los parámetros, una medición cada ${CADA_N_DIAS} días y las decisiones emitidas. El ciclo se completa con las condiciones actuales.${ctx.ab ? ' Se guardarán A y B y su comparación.' : ''}</p>
    <button class="azul" id="gOk">Guardar</button>`);
  $('gOk').addEventListener('click', async () => {
    const nombre = $('gNombre').value.trim(), notas = $('gNotas').value.trim();
    if (!nombre) return aviso('Escribe un nombre', true);
    $('gOk').disabled = true;
    try {
      const ids = {};
      const anal = {};
      for (const id of activos()) {
        ids[id] = (await API.guardarSimulacion(cuerpoSim(id, nombre, notas))).id;
        const g = ctx.esc[id].geo;     // P06: el análisis geoespacial queda enlazado a la simulación (analisis_geo.simulacion_id)
        if (g) { try { anal[id] = (await API.geoGuardarAnalisis({ ...g.payload, simulacion_id: ids[id] })).id; } catch (e) { aviso('Simulación guardada, pero el análisis geo falló: ' + e.message, true); } }
      }
      const gA = ctx.esc.A.geo, gB = ctx.esc.B?.geo;
      if (ctx.ab && gA?.comparacion && gB && anal.A && anal.B) await API.geoGuardarComparacion({ especie_id: ctx.esc.A.esp.id, analisis_a_id: anal.A, analisis_b_id: anal.B, sim_a_id: ids.A, sim_b_id: ids.B, ...gA.comparacion });
      if (ctx.ab) { const c = M.compararAB(resultadoProy(ctx.esc.A), resultadoProy(ctx.esc.B)); await API.guardarComparacion({ sim_a_id: ids.A, sim_b_id: ids.B, ganador: c.ganador, puntaje_a: c.puntajeA, puntaje_b: c.puntajeB }); }
      $('modal').hidden = true; aviso('✔ Guardado en MySQL: ' + Object.entries(ids).map(([k, v]) => `${k}=#${v}`).join('  '));
    } catch (err) { $('gOk').disabled = false; aviso('No se pudo guardar: ' + err.message, true); }
  });
}

// ---------- Reportes / Historial ----------
async function abrirReportes(tab) {
  const cab = `<h3>📊 Laboratorio · Reportes e historial</h3><div class="pestanas"><button data-t="reportes" class="${tab === 'reportes' ? 'on' : ''}">Reportes</button><button data-t="historial" class="${tab === 'historial' ? 'on' : ''}">Historial</button></div>`;
  abrirModal(cab + '<p class="suave">Cargando…</p>');
  const enlazarTabs = () => $('modalCont').querySelectorAll('.pestanas button').forEach(b => b.addEventListener('click', () => abrirReportes(b.dataset.t)));
  try {
    if (tab === 'reportes') {
      const r = ctx.reporte = await API.obtenerReportes();
      abrirModal(cab + `<div class="kpiRow"><div><small>Tiempo promedio a madurez</small><b>${esc(r.madurez.prom ?? '—')} d</b></div><div><small>Mín / Máx</small><b>${esc(r.madurez.minimo ?? '—')} / ${esc(r.madurez.maximo ?? '—')}</b></div><div><small>Especie más eficiente</small><b style="font-size:1rem">${esc(r.eficiencia_especies[0]?.nombre_cientifico ?? '—')}</b></div></div>
        <h5>Top 5 simulaciones por biomasa</h5><table><tr><th>#</th><th>Simulación</th><th>Especie</th><th>Modelo</th><th>Biomasa (g)</th><th>Días a floración</th></tr>
        ${r.top_biomasa.map((t, i) => `<tr><td>${i + 1}</td><td>${esc(t.nombre)}</td><td><i>${esc(t.nombre_cientifico)}</i></td><td>${esc(t.modelo)}</td><td>${esc(t.biomasa_final)}</td><td>${esc(t.dias_madurez ?? '—')}</td></tr>`).join('')}</table>
        <h5>Eficiencia por especie (biomasa / día hasta floración)</h5><div style="height:220px"><canvas id="gEfi"></canvas></div>
        <div class="noPrint"><button class="azul" id="bCsv">⬇ Exportar CSV</button> <button class="violeta" id="bPdf">🖨 Exportar PDF (imprimir)</button></div>`);
      new Chart($('gEfi'), { type: 'bar', data: { labels: r.eficiencia_especies.map(x => x.nombre_cientifico), datasets: [{ label: 'g/día', data: r.eficiencia_especies.map(x => +x.eficiencia_g_dia), backgroundColor: '#ff4f8b' }] }, options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } } } });
      $('bPdf').addEventListener('click', () => window.print());
      $('bCsv').addEventListener('click', () => descargarCsvReporte(r));
    } else {
      const lista = await API.listarSimulaciones();
      abrirModal(cab + `<table><tr><th>#</th><th>Nombre</th><th>Especie</th><th>Modelo</th><th>Biomasa</th><th>Floración</th><th>Estrés</th><th></th></tr>${lista.map(x => `<tr><td>${esc(x.id)}</td><td>${esc(x.nombre)}</td><td><i>${esc(x.nombre_cientifico)}</i></td><td>${esc(x.modelo)}</td><td>${esc(x.biomasa_final)}</td><td>${esc(x.dias_madurez ?? '—')}</td><td>${esc(x.estres_medio)}%</td>
        <td><button class="verde" data-a="A" data-id="${esc(x.id)}">▶ A</button><button class="violeta" data-a="B" data-id="${esc(x.id)}">▶ B</button><a href="${API.urlCsv(x.id)}"><button class="gris">CSV</button></a><button class="gris" data-a="del" data-id="${esc(x.id)}">🗑</button></td></tr>`).join('')}</table>`);
      $('modalCont').querySelectorAll('td button[data-a]').forEach(b => b.addEventListener('click', async () => {
        try {
          if (b.dataset.a === 'del') { if (confirm('¿Borrar la simulación #' + b.dataset.id + '?')) { await API.borrarSimulacion(b.dataset.id); abrirReportes('historial'); } }
          else { await cargarSim(b.dataset.id, b.dataset.a); $('modal').hidden = true; }
        } catch (err) { aviso(err.message, true); }
      }));
    }
    enlazarTabs();
  } catch (err) { abrirModal(cab + `<p class="sev-alta">No se pudo consultar la API: ${esc(err.message)}.<br>Verifica Apache/MySQL y que hayas importado database/schema.sql y seed.sql.</p>`); enlazarTabs(); }
}
function descargarCsvReporte(r) {
  const l = [['TOP 5 BIOMASA'], ['id', 'nombre', 'especie', 'modelo', 'biomasa_g', 'dias_floracion'], ...r.top_biomasa.map(t => [t.id, t.nombre, t.nombre_cientifico, t.modelo, t.biomasa_final, t.dias_madurez]),
    [], ['EFICIENCIA POR ESPECIE'], ['especie', 'corridas', 'biomasa_prom', 'dias_madurez_prom', 'g_por_dia'], ...r.eficiencia_especies.map(x => [x.nombre_cientifico, x.corridas, x.biomasa_prom, x.dias_madurez_prom, x.eficiencia_g_dia]),
    [], ['MADUREZ'], ['promedio_dias', 'min', 'max', 'n'], [r.madurez.prom, r.madurez.minimo, r.madurez.maximo, r.madurez.n]];
  const csv = '\uFEFF' + l.map(f => f.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'reporte_practica05.csv'; a.click();
}
async function cargarSim(id, destino) {   // reproducir: el motor es determinista, mismos parámetros = misma curva
  const d = await API.obtenerSimulacion(id);
  const esp = ctx.especies.find(e => e.id == d.especie_id);
  const p = { luz: +d.luz, agua: +d.agua, temp: +d.temp, nutr: +d.nutr, co2: +d.co2, r: +d.r, K: +d.k, modelo: d.modelo, termostato: !!+d.termostato };
  if (destino === 'B' && !ctx.ab) activarAB(true, false);
  reiniciar(destino, esp, p); ctx.editando = destino; ctx.revision = null; ctx.corriendo = true; sincronizarControles();
  aviso(`Simulación #${id} cargada en el escenario ${destino}`);
}

// ---------- P06 · integración con el Observatorio ----------
export function setActivo(v) { ctx.activo = v; if (v) actualizarBanner(); }
// items = [{ id:'A'|'B', esp, p (con p.serie = clima real), geo:{ nombre, payload, comparacion } }]
export function lanzarGeo(items) {
  if (!ctx.escena || !ctx.esc.A) { aviso('El laboratorio 3D aún está cargando; inténtalo en un segundo', true); return; }
  if (items.length > 1) { if (!ctx.ab) activarAB(true, false); } else if (ctx.ab) activarAB(false);
  for (const it of items) { reiniciar(it.id, it.esp, it.p); ctx.esc[it.id].geo = it.geo; }
  ctx.editando = 'A'; ctx.revision = null; ctx.corriendo = true; $('btnPausa').textContent = '⏸ Pausar';
  sincronizarControles(); actualizarBanner();
}
function quitarGeo() {
  for (const id of activos()) {
    const s = ctx.esc[id]; if (!s.geo) continue;
    const p = { ...s.p }; delete p.serie; p.termostato = true; p.diaInicio = 0; p.preFrio = false; p.temp = 6; p.agua = s.esp.agua_opt; p.luz = s.esp.luz_opt;
    reiniciar(id, s.esp, p);
  }
  sincronizarControles(); actualizarBanner(); aviso('Modo manual: vuelves a los parámetros de la Práctica 05');
}
function actualizarBanner() {
  const g = activos().map(id => [id, ctx.esc[id]?.geo, ctx.esc[id]?.p]).filter(x => x[1]);
  $('bannerGeo').hidden = !g.length;
  $('txtBannerGeo').innerHTML = g.map(([id, geo, p]) => `<b>${ctx.ab ? 'Escenario ' + esc(id) + ': ' : ''}${esc(geo.nombre)}</b> · clima real · siembra en ${['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][p.mesSiembra ?? 0]}${p.preFrio ? ' · bulbo pre-enfriado' : ''}${p.termostato ? ' · invernadero' : ''}`).join('<br>');
}

// ---------- Bucle principal ----------
let ultimo = performance.now();
function bucle(t) {
  requestAnimationFrame(bucle);
  if (!ctx.activo) { ultimo = t; return; }          // P06: el laboratorio no gasta GPU mientras se ve el globo
  const dt = Math.min(.1, (t - ultimo) / 1000); ultimo = t;
  let cambio = false;
  if (ctx.corriendo && ctx.revision == null) {
    ctx.acum += dt * ctx.vel * DIAS_POR_S;
    for (let n = 0; ctx.acum >= 1 && n < 30; n++, ctx.acum -= 1) { activos().forEach(id => paso(ctx.esc[id])); cambio = true; }
    if (activos().every(id => ctx.esc[id].e.fase >= 6) && ctx.corriendo) { ctx.corriendo = false; $('btnPausa').textContent = '▶ Reanudar'; aviso('Ciclo completo. Guarda la simulación en MySQL o compárala en Reportes.'); }
  }
  if (cambio || t - ctx.ultimoUI > 250) { if (cambio) activos().forEach(id => recalcular(ctx.esc[id])); actualizarUI(); ctx.ultimoUI = t; }
  activos().forEach(id => { const s = ctx.esc[id]; ctx.escena.aplicarEstado(id, vista(s), s.esp, s.p); });
  ctx.escena.animar(dt, ctx.corriendo || ctx.revision != null);
}

async function init() {
  ctx.escena = await crearEscena();
  ctx.especies = await API.cargarEspecies();
  const b = $('badgeDb'); b.textContent = API.estado.conectado ? 'MySQL conectado' : 'Modo local'; b.classList.toggle('ok', API.estado.conectado);
  b.title = API.estado.conectado ? 'API FlightPHP + MySQL disponibles' : 'La API no responde: se usa data/especies.json (no se podrá guardar)';
  ctx.esc.A = nuevoEsc(ctx.especies[0]); ctx.escena.setColorEspecie('A', ctx.esc.A.esp.color_hex); recalcular(ctx.esc.A);
  construirSliders(); enlazarEventos(); crearGrafica(); sincronizarControles();
  requestAnimationFrame(bucle);
}
init();
