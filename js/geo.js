// CAPA DE DECISIÓN GEO-AGRONÓMICA · Práctica 06
// Módulo puro (sin DOM ni Three.js): corre en el navegador y en Node (test/geo.test.mjs).
// Recibe los datos YA normalizados por el proxy PHP (NASA POWER, SoilGrids, GBIF) y calcula:
//   · proyección lat/lon ↔ esfera 3D          · clima derivado (ET0, aridez, luz, frío efectivo)
//   · índice de idoneidad 0-100               · reglas de decisión geo-agronómicas
//   · parámetros de simulación desde el clima · comparador A/B geográfico y ranking
import { eficaciaFrio, estadoInicial, paramsPorDefecto, proyectar, resumenSim, compararAB, DIAS_MES, ACUM_MES } from './modelos.js';

export const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
const media = a => a.reduce((s, v) => s + v, 0) / a.length;
const ponderada = a => a.reduce((s, v, i) => s + v * DIAS_MES[i], 0) / 365;   // media ponderada por días del mes

// ======================= 1. PROYECCIÓN ESFERA ↔ (lat, lon) =======================
// Convención idéntica al mapeo UV de THREE.SphereGeometry con una textura equirectangular
// (lon −180° al borde izquierdo, lon 0° en +X, lon −90° en +Z, norte en +Y):
//   x =  r·cos(lat)·cos(lon)      y = r·sin(lat)      z = −r·cos(lat)·sin(lon)
export function latLonAVec3(lat, lon, r = 1) {
  const la = rad(lat), lo = rad(lon);
  return { x: r * Math.cos(la) * Math.cos(lo), y: r * Math.sin(la), z: -r * Math.cos(la) * Math.sin(lo) };
}
export function vec3ALatLon(x, y, z) {
  const r = Math.hypot(x, y, z) || 1;
  return { lat: deg(Math.asin(clamp(y / r, -1, 1))), lon: deg(Math.atan2(-z, x)) };
}
export function distanciaKm(lat1, lon1, lat2, lon2) {   // haversine
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

// ======================= 2. CLIMA DERIVADO =======================
// Radiación extraterrestre (FAO-56, ec. 21) en MJ/m²/día para una latitud y día del año
export function radExtraterrestre(latDeg, diaAnio) {
  const phi = rad(latDeg), J = diaAnio + 1;
  const dr = 1 + 0.033 * Math.cos(2 * Math.PI / 365 * J);
  const dec = 0.409 * Math.sin(2 * Math.PI / 365 * J - 1.39);
  const ws = Math.acos(clamp(-Math.tan(phi) * Math.tan(dec), -1, 1));
  return (24 * 60 / Math.PI) * 0.0820 * dr * (ws * Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.sin(ws));
}

// raw = salida de GET /api/geo/clima (NASA POWER normalizado): series mensuales ene→dic
//   t2m (°C) · t2m_max · t2m_min · precip_mm_dia · rad_mj_dia · hr (%)
export function derivarClima(raw) {
  const lat = raw.lat, z = raw.elevacion_m ?? 0;
  const t = raw.t2m, P = raw.precip_mm_dia.map((v, i) => v * DIAS_MES[i]), Rs = raw.rad_mj_dia;
  // ET0 radiativa de Hargreaves (1994): ET0 = 0,0135 · Rs/λ · (T + 17,8)   [mm/día], λ = 2,45 MJ/kg
  const et0 = t.map((T, i) => Math.max(0, 0.0135 * Rs[i] / 2.45 * (T + 17.8)) * DIAS_MES[i]);
  // Fracción de cielo despejado = Rs / Rso (Rso = (0,75 + 2e-5·z)·Ra) → "% de luz solar completa" del simulador
  const luzPct = Rs.map((rs, i) => {
    const ra = radExtraterrestre(lat, ACUM_MES[i] + DIAS_MES[i] / 2), rso = (0.75 + 2e-5 * z) * ra;
    return rso < 1 ? 30 : clamp(100 * rs / rso, 5, 100);
  });
  const primavera = lat >= 0 ? [2, 3, 4] : [8, 9, 10];
  const precipAnual = P.reduce((a, b) => a + b, 0), et0Anual = et0.reduce((a, b) => a + b, 0);
  return {
    lat, lon: raw.lon, elevacion_m: z,
    tMensual: t, tMaxMensual: raw.t2m_max, tMinMensual: raw.t2m_min, hr: raw.hr,
    precipMensual: P, radMensual: Rs, et0Mensual: et0, luzMensualPct: luzPct,
    aiMensual: P.map((p, i) => p / Math.max(1, et0[i])),
    tMedia: ponderada(t), tMinMes: Math.min(...t), tMaxMes: Math.max(...t),
    tPrimavera: media(primavera.map(i => t[i])), luzPrimavera: media(primavera.map(i => luzPct[i])),
    precipAnual, et0Anual, aridez: precipAnual / Math.max(1, et0Anual),
    radMedia: ponderada(Rs), radMaxMes: Math.max(...Rs)
  };
}

// Frío efectivo del invierno: días/año con temperatura media mensual dentro del rango de vernalización
// de la especie, ponderados por eficaciaFrio() (la MISMA función que usa el simulador de la Práctica 05)
export function frioEfectivo(clima, esp) {
  return clima.tMensual.reduce((s, T, i) => s + DIAS_MES[i] * eficaciaFrio(T, esp), 0);
}

// Clasificación textural simplificada (aprox. del triángulo USDA a partir de arcilla y arena en %)
export function claseTextura(arcilla, arena) {
  if (arcilla == null || arena == null) return null;
  const limo = 100 - arcilla - arena;
  if (arcilla >= 40) return 'Arcillosa';
  if (arcilla >= 27) return arena > 45 ? 'Franco-arcillo-arenosa' : 'Franco-arcillosa';
  if (arena >= 70) return 'Arenosa / franco-arenosa';
  if (limo >= 50) return 'Franco-limosa';
  return 'Franca';
}

// ======================= 3. ÍNDICE DE IDONEIDAD (0-100) =======================
// Pesos (suman 1). Si falta una fuente (p. ej. SoilGrids no respondió) se renormaliza con las demás.
export const PESOS = { frio: .25, tAnual: .10, calor: .10, precip: .15, luz: .05, ph: .10, textura: .05, gbif: .20 };
export const ETIQUETAS = { frio: 'Frío de vernalización', tAnual: 'Temperatura media anual', calor: 'Calor en floración', precip: 'Precipitación anual', luz: 'Luz en floración', ph: 'pH del suelo', textura: 'Textura / drenaje', gbif: 'Registros GBIF (región)' };
export const GBIF_REF = 200;   // registros dentro del radio para considerar "bien documentada" (puntaje 1)

const rango = (x, min, max, margen) => x >= min && x <= max ? 1 : clamp(1 - (x < min ? min - x : x - max) / margen, 0, 1);
export function subpuntajes(clima, suelo, gbif, esp) {
  const p = clima.precipAnual;
  return {
    frio: clamp(frioEfectivo(clima, esp) / esp.frio_req_dias, 0, 1),
    tAnual: rango(clima.tMedia, esp.t_anual_min, esp.t_anual_max, 6),
    calor: clamp(1 - Math.max(0, clima.tPrimavera - esp.temp_umbral_calor) / 8, 0, 1),
    // lluvia dentro del rango de la especie, castigada además por aridez (P/ET0 < 0,6 = el agua de lluvia no alcanza)
    precip: Math.min(p < esp.precip_min ? clamp(p / esp.precip_min, 0, 1) : p > esp.precip_max ? clamp(1 - (p - esp.precip_max) / esp.precip_max, 0, 1) : 1, clamp(clima.aridez / 0.6, 0, 1)),
    luz: clamp(1 - Math.abs(clima.luzPrimavera - esp.luz_opt) / 60, 0, 1),
    ph: suelo?.ph != null ? rango(suelo.ph, esp.ph_min, esp.ph_max, 1.5) : null,
    textura: suelo?.arcilla != null ? clamp(1 - Math.max(0, suelo.arcilla - esp.arcilla_max) / 25, 0, 1) : null,
    gbif: gbif?.region != null ? clamp(Math.log10(1 + gbif.region) / Math.log10(1 + GBIF_REF), 0, 1) : null
  };
}
export function clasificar(p) { return p >= 80 ? 'Óptima' : p >= 60 ? 'Buena' : p >= 40 ? 'Marginal' : 'No apta'; }

// Puntaje = 100 · (0,7 · media ponderada + 0,3 · factor más limitante)   [ley del mínimo de Liebig,
// igual que el estrés global de la P05: promedio + peor factor]. Limitantes: frío, temperatura, lluvia y calor.
export function idoneidad(clima, suelo, gbif, esp) {
  const sub = subpuntajes(clima, suelo, gbif, esp);
  let sw = 0, sv = 0;
  for (const k of Object.keys(PESOS)) if (sub[k] != null) { sw += PESOS[k]; sv += PESOS[k] * sub[k]; }
  const mediaPond = sv / sw;
  const lim = ['frio', 'tAnual', 'precip', 'calor'].map(k => [k, sub[k]]).sort((a, b) => a[1] - b[1])[0];
  const puntaje = +(100 * (0.7 * mediaPond + 0.3 * lim[1])).toFixed(1);
  return { puntaje, clase: clasificar(puntaje), sub, mediaPonderada: mediaPond, limitante: lim[0], limitanteValor: lim[1], cobertura: +sw.toFixed(2), frioEfectivoDias: +frioEfectivo(clima, esp).toFixed(1) };
}

// ======================= 4. REGLAS DE DECISIÓN GEO-AGRONÓMICAS =======================
// Cada regla: umbral → recomendación (se guardan en la tabla `decisiones`, con analisis_id).
export function reglasGeo({ clima: c, suelo: s, gbif: g }, esp, catalogo = []) {
  const R = [];
  const add = (codigo, severidad, titulo, detalle, umbral, valor) => R.push({ codigo, severidad, titulo, detalle, umbral, valor: valor == null ? null : +(+valor).toFixed(2) });
  const frioEf = frioEfectivo(c, esp);
  if (c.precipAnual < 400) add('GEO_RIEGO', 'critica', 'Riego suplementario obligatorio', `Solo ${Math.round(c.precipAnual)} mm de lluvia al año (NASA POWER).`, 'precipitación anual < 400 mm', c.precipAnual);
  else if (c.aridez < 0.5) add('GEO_ARIDEZ', 'alta', 'Déficit hídrico: planificar riego', `Lluvia/ET0 = ${c.aridez.toFixed(2)}: la evaporación supera ampliamente a la lluvia.`, 'P/ET0 < 0,5', c.aridez);
  if (c.tMedia > 35) add('GEO_CALOR_MEDIO', 'critica', 'Estrés térmico severo, considerar variedad resistente', `Temperatura media anual de ${c.tMedia.toFixed(1)} °C.`, 'temp_promedio > 35 °C', c.tMedia);
  else if (c.tPrimavera > esp.temp_umbral_calor + 3) add('GEO_CALOR_FLOR', 'alta', 'Calor en la estación de floración', `La temperatura de primavera (${c.tPrimavera.toFixed(1)} °C) supera el umbral de vigor floral; considera floración temprana o sombra.`, `T primavera > ${esp.temp_umbral_calor + 3} °C`, c.tPrimavera);
  if (frioEf < 0.6 * esp.frio_req_dias) add('GEO_FRIO', 'alta', 'Frío invernal insuficiente: usar bulbos pre-enfriados', `Solo ${Math.round(frioEf)} d de frío efectivo frente a ${esp.frio_req_dias} d requeridos: la dormancia no se libera sola.`, 'frío efectivo < 60 % del requerimiento', frioEf);
  else if (frioEf >= esp.frio_req_dias) add('GEO_FRIO_OK', 'ok', 'Frío suficiente para liberar la dormancia', `${Math.round(frioEf)} d de frío efectivo (requiere ${esp.frio_req_dias}).`, 'frío efectivo ≥ requerimiento', frioEf);
  if (g?.region === 0) add('GEO_GBIF0', 'alta', 'Especie no reportada en esta región, alto riesgo', `GBIF no tiene registros de ${esp.nombre_cientifico} en ${g.radio_km} km a la redonda.`, 'ocurrencias_gbif = 0', 0);
  else if (g?.region > 0 && g.region < 20) add('GEO_GBIF_BAJO', 'media', 'Pocos registros de la especie en la región', `Solo ${g.region} registros en ${g.radio_km} km: valida con ensayos locales.`, 'ocurrencias_gbif < 20', g.region);
  else if (g?.region >= 1000) add('GEO_GBIF_OK', 'info', 'Especie bien documentada en la región', `${g.region.toLocaleString('es')} registros en ${g.radio_km} km.`, 'ocurrencias_gbif ≥ 1000', g.region);
  if (s?.ph != null) {
    if (s.ph < 5.5) add('GEO_PH_ACIDO', 'media', 'Suelo ácido, encalar antes de sembrar', `pH ${s.ph.toFixed(1)} (SoilGrids, 0–30 cm).`, 'pH < 5,5', s.ph);
    else if (s.ph > esp.ph_max + 0.5) add('GEO_PH_ALC', 'media', 'Suelo alcalino: vigilar disponibilidad de micronutrientes', `pH ${s.ph.toFixed(1)}; la especie rinde mejor hasta ~${esp.ph_max}.`, `pH > ${esp.ph_max + 0.5}`, s.ph);
  }
  if (s?.arcilla != null && s.arcilla > esp.arcilla_max) {
    const alt = catalogo.filter(x => x.id !== esp.id).sort((a, b) => b.arcilla_max - a.arcilla_max)[0];
    const sug = alt && alt.arcilla_max > esp.arcilla_max ? ` O prueba ${alt.nombre_cientifico}, que tolera más humedad en el suelo.` : '';
    add('GEO_ARCILLA', 'alta', 'Suelo arcilloso: riesgo de pudrición del bulbo', `${s.arcilla.toFixed(0)} % de arcilla (SoilGrids). Mejora el drenaje con camas elevadas y arena.${sug}`, `arcilla > ${esp.arcilla_max} %`, s.arcilla);
  }
  if (s?.carbono != null && s.carbono < 8) add('GEO_MO', 'media', 'Baja materia orgánica: incorporar compost', `${s.carbono.toFixed(1)} g/kg de carbono orgánico.`, 'carbono orgánico < 8 g/kg', s.carbono);
  if (c.radMaxMes > 25) add('GEO_RAD', 'media', 'Alta radiación, considerar sombra parcial', `Hasta ${c.radMaxMes.toFixed(1)} MJ/m²/día en el mes más soleado.`, 'radiación > 25 MJ/m²/día', c.radMaxMes);
  if (!R.some(r => ['critica', 'alta'].includes(r.severidad))) add('GEO_OK', 'ok', 'Sin limitantes graves para esta especie', 'El clima y el suelo reportados son compatibles con el cultivo.', '', 0);
  const orden = { critica: 4, alta: 3, media: 2, info: 1, ok: 0 };
  return R.sort((a, b) => orden[b.severidad] - orden[a.severidad]);
}

// ======================= 5. DEL CLIMA REAL AL SIMULADOR =======================
export const mesSiembraSugerido = lat => lat >= 0 ? 9 : 3;   // octubre (norte) / abril (sur): bulbos de tulipán en otoño

// Humedad del sustrato (%) estimada desde el índice de aridez mensual P/ET0 (saturación suave, tope ≈ 70 %) + retención por arcilla
export const aguaDesdeAridez = (ai, arcilla) => clamp(25 + 45 * (1 - Math.exp(-ai / 1.2)) + (arcilla != null ? (arcilla - 25) * 0.2 : 0), 5, 90);
// Nutrientes (%) estimados desde el carbono orgánico del suelo (g/kg) y el pH
export function nutrDesdeSuelo(suelo, esp) {
  if (!suelo || suelo.carbono == null) return esp.nutr_opt;
  let n = 25 + 2.2 * suelo.carbono;
  if (suelo.ph != null && suelo.ph < 5.5) n *= 0.85; else if (suelo.ph != null && suelo.ph > 8) n *= 0.9;
  return clamp(n, 15, 95);
}

export function parametrosSim(clima, suelo, esp, opc = {}) {
  const mes = opc.mesSiembra ?? mesSiembraSugerido(clima.lat);
  const serie = { temp: clima.tMensual, agua: clima.aiMensual.map(ai => aguaDesdeAridez(ai, suelo?.arcilla)), luz: clima.luzMensualPct };
  return {
    ...paramsPorDefecto(esp), serie, diaInicio: ACUM_MES[mes], mesSiembra: mes,
    temp: serie.temp[mes], agua: serie.agua[mes], luz: serie.luz[mes], nutr: nutrDesdeSuelo(suelo, esp),
    termostato: !!opc.invernadero, preFrio: !!opc.preFrio, modelo: opc.modelo || 'logistico'
  };
}

// Ciclo completo sin interfaz (misma función que dibuja la planta): devuelve la traza y el resumen
export function simularCiclo(esp, p, maxDias = 700) {
  const traza = proyectar(estadoInicial(esp), p, esp, maxDias);
  return { traza, resumen: resumenSim(traza, esp) };
}

// ======================= 6. COMPARADOR A/B GEOGRÁFICO Y RANKING =======================
// puntaje final = 60 % desempeño simulado (P05: 50 % biomasa + 30 % rapidez + 20 % bajo estrés)
//               + 40 % idoneidad geo-agronómica / 100.   Empate técnico si |Δ| < 0,02.
export function compararUbicaciones(esp, A, B, opc = {}) {
  const calc = L => {
    const ido = idoneidad(L.clima, L.suelo, L.gbif, esp);
    const p = parametrosSim(L.clima, L.suelo, esp, opc), sim = simularCiclo(esp, p);
    return { ido, p, sim };
  };
  const a = calc(A), b = calc(B);
  const c = compararAB(a.sim.resumen, b.sim.resumen);
  const fa = 0.6 * c.puntajeA + 0.4 * a.ido.puntaje / 100, fb = 0.6 * c.puntajeB + 0.4 * b.ido.puntaje / 100;
  const ganador = Math.abs(fa - fb) < 0.02 ? 'empate' : fa > fb ? 'A' : 'B';
  const fila = (clave, etiqueta, va, vb, mejor, dec = 1, unidad = '') => ({ clave, etiqueta, a: va, b: vb, unidad, dec, ganaFila: va == null || vb == null || va === vb || mejor === 0 ? null : (mejor > 0 ? (va > vb ? 'A' : 'B') : (va < vb ? 'A' : 'B')) });
  const dm = r => r.dias_madurez ?? 999;
  const filas = [
    fila('idoneidad', 'Idoneidad (0-100)', a.ido.puntaje, b.ido.puntaje, +1),
    fila('frio', 'Frío efectivo (días)', a.ido.frioEfectivoDias, b.ido.frioEfectivoDias, +1, 0, ' d'),
    fila('tmedia', 'Temperatura media anual', A.clima.tMedia, B.clima.tMedia, 0, 1, ' °C'),
    fila('precip', 'Precipitación anual', A.clima.precipAnual, B.clima.precipAnual, 0, 0, ' mm'),
    fila('ph', 'pH del suelo', A.suelo?.ph ?? null, B.suelo?.ph ?? null, 0, 1),
    fila('arcilla', 'Arcilla', A.suelo?.arcilla ?? null, B.suelo?.arcilla ?? null, 0, 0, ' %'),
    fila('gbif', 'Registros GBIF en la región', A.gbif?.region ?? null, B.gbif?.region ?? null, +1, 0),
    fila('biomasa', 'Biomasa final simulada', a.sim.resumen.biomasa_final, b.sim.resumen.biomasa_final, +1, 1, ' g'),
    fila('floracion', 'Días a floración', a.sim.resumen.dias_madurez, b.sim.resumen.dias_madurez, dm(a.sim.resumen) === dm(b.sim.resumen) ? 0 : -1, 0, ' d'),
    fila('estres', 'Estrés medio', a.sim.resumen.estres_medio, b.sim.resumen.estres_medio, -1, 1, ' %'),
    fila('aborto', 'Aborto floral', a.sim.resumen.aborto, b.sim.resumen.aborto, -1, 0)
  ];
  return { ganador, puntajeA: fa, puntajeB: fb, simA: a.sim, simB: b.sim, idoA: a.ido, idoB: b.ido, pSimA: a.p, pSimB: b.p, filas, puntajeSimA: c.puntajeA, puntajeSimB: c.puntajeB };
}

// Ranking de especies en un punto: conteos = { [especie_id]: registros GBIF en la región }
export function rankingEspecies(catalogo, punto, conteos = {}, radioKm = 250) {
  return catalogo.map(esp => {
    const g = conteos[esp.id] != null ? { region: conteos[esp.id], radio_km: radioKm } : null;
    return { esp, ido: idoneidad(punto.clima, punto.suelo, g, esp), gbif: g };
  }).sort((a, b) => b.ido.puntaje - a.ido.puntaje);
}
