// CLIENTE DE LA API · frontend → fetch → FlightPHP → (cURL → API externa ↔ caché MySQL) → JSON → frontend
// Si la API no responde, la app sigue funcionando en "modo local" con data/especies.json.
const BASE = (window.P06_API || new URLSearchParams(location.search).get('api') || './api').replace(/\/$/, '');
export const estado = { conectado: false, modo: null, intentos: [] };

// El servidor puede no tener mod_rewrite/.htaccess (Apache con AllowOverride None, Nginx…): entonces /api/especies da 404 de Apache.
// Por eso se prueban 3 formas equivalentes de llamar a la MISMA API y se usa la primera que responda JSON (ver api/index.php):
const MODOS = {
  bonita:   r => `${BASE}${r}`,                                   // /api/geo/punto?lat=..       (mod_rewrite)
  pathinfo: r => `${BASE}/index.php${r}`,                         // /api/index.php/geo/punto?lat=..
  consulta: r => `${BASE}/index.php?_ruta=${r.replace('?', '&')}`  // /api/index.php?_ruta=/geo/punto&lat=..
};
const url = ruta => MODOS[estado.modo || 'bonita'](ruta);

async function detectarModo() {
  estado.intentos = [];
  for (const [modo, f] of Object.entries(MODOS)) {
    const u = f('/ping');
    try {
      const res = await fetch(u, { cache: 'no-store' });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.ping) { estado.modo = modo; return true; }
      estado.intentos.push(`${u} → HTTP ${res.status}${j?.error ? ' (' + j.error + ')' : j ? '' : ' (no es JSON: ¿no llega a index.php?)'}`);
    } catch (e) { estado.intentos.push(`${u} → ${e.message}`); }
  }
  return false;
}

async function llamar(ruta, opciones = {}, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url(ruta), { ...opciones, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', ...(opciones.headers || {}) } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status} en ${ruta.split('?')[0]}`);
    return json;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Tiempo agotado (${Math.round(ms / 1000)} s) en ${ruta.split('?')[0]}: el servidor tardó demasiado en llamar a las APIs externas`);
    throw e;
  } finally { clearTimeout(t); }
}

export async function cargarEspecies() {
  try {
    if (!(await detectarModo())) throw new Error('el servidor no llega a api/index.php. Probado:\n' + estado.intentos.join('\n'));
    const r = await llamar('/especies');
    estado.conectado = true;
    return r.data.map(normalizar);
  } catch (err) {
    estado.error = err.message;
    console.warn('API no disponible, usando modo local:', err.message);
    estado.conectado = false;
    const local = await fetch('./data/especies.json').then(r => r.json());
    return local.map(normalizar);
  }
}
// MySQL devuelve DECIMAL como texto: convertir a número
function normalizar(e) {
  const o = { ...e };
  for (const k of ['luz_opt','agua_opt','temp_opt','nutr_opt','r_defecto','k_defecto','n0','altura_max','frio_req_dias','frio_tmin','frio_tmax','temp_umbral_calor','t_anual_min','t_anual_max','precip_min','precip_max','ph_min','ph_max','arcilla_max']) o[k] = Number(o[k]);
  o.id = Number(o.id);
  return o;
}
export const guardarSimulacion = body => llamar('/simulaciones', { method: 'POST', body: JSON.stringify(body) });
export const guardarComparacion = body => llamar('/comparaciones', { method: 'POST', body: JSON.stringify(body) });
export const listarSimulaciones = () => llamar('/simulaciones?limite=100').then(r => r.data);
export const obtenerSimulacion = id => llamar('/simulaciones/' + id).then(r => r.data);
export const borrarSimulacion = id => llamar('/simulaciones/' + id, { method: 'DELETE' });
export const obtenerReportes = () => llamar('/reportes');
export const urlCsv = id => url(`/simulaciones/${id}/csv`);

// ======================= P06 · Observatorio geoespacial =======================
// Estas rutas pasan por el PROXY PHP: el navegador nunca ve URLs de terceros ni API keys. Timeout largo: el servidor
// puede tardar en llamar a 4 APIs la primera vez (después responde desde la caché MySQL).
const LARGO = 45000;
const q = (lat, lon) => `lat=${(+lat).toFixed(4)}&lon=${(+lon).toFixed(4)}`;
export const geoPunto = (lat, lon) => llamar(`/geo/punto?${q(lat, lon)}`, {}, LARGO).then(r => r.data);
export const geoConteos = (lat, lon, radio = 250) => llamar(`/geo/ocurrencias/conteos?${q(lat, lon)}&radio_km=${radio}`, {}, LARGO).then(r => ({ items: r.data, fuentes: r.fuentes }));
export const geoMapa = especieId => llamar(`/geo/ocurrencias/mapa?especie_id=${especieId}`, {}, LARGO).then(r => r.data);
export const geoGuardarAnalisis = body => llamar('/geo/analisis', { method: 'POST', body: JSON.stringify(body) });
export const geoGuardarComparacion = body => llamar('/geo/comparaciones', { method: 'POST', body: JSON.stringify(body) });
export const geoRanking = especieId => llamar(`/geo/ranking?especie_id=${especieId}`).then(r => r.data);
export const geoAnalisis = () => llamar('/geo/analisis?limite=100').then(r => r.data);
export const geoComparaciones = () => llamar('/geo/comparaciones').then(r => r.data);
export const geoCache = () => llamar('/geo/cache/estado');
export const geoDiagnostico = () => llamar('/geo/diagnostico?probar=1', {}, LARGO);
export async function cargarUbicaciones() {
  try { return (await llamar('/geo/ubicaciones')).data.map(u => ({ ...u, lat: +u.lat, lon: +u.lon })); }
  catch { return fetch('./data/ubicaciones.json').then(r => r.json()); }
}

// Consumo DIRECTO desde el navegador (sin proxy): Open-Meteo Geocoding no usa API key, admite CORS y es de baja carga
// (solo al escribir en el buscador). Todo lo demás —clima, suelo, GBIF— se pide al servidor.
export async function buscarLugar(texto) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(texto)}&count=6&language=es&format=json`, { signal: ctrl.signal });
    const j = await r.json();
    return (j.results || []).map(x => ({ nombre: x.name, region: x.admin1 || null, pais: x.country || null, codigo_pais: x.country_code || null, lat: x.latitude, lon: x.longitude }));
  } finally { clearTimeout(t); }
}
