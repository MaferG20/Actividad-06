// MOTOR BIOINFORMÁTICO · modelos de crecimiento, estrés, predicción, decisiones y A/B.
// Módulo puro (sin DOM ni Three.js): corre en el navegador y en Node (para generar el seed).
export const FASES = ['Dormancia / Frío', 'Emergencia', 'Crecimiento vegetativo', 'Elongación y botón floral', 'Floración', 'Senescencia', 'Ciclo completo'];

export const MODELOS = {
  lineal:      { nombre: 'Lineal: N(t) = a·t + b',                      desc: 'Crecimiento a ritmo constante (a = r·K/4). Es poco realista: no tiene freno biológico, solo el tope K.' },
  exponencial: { nombre: 'Exponencial: N(t) = N₀·e^(r·t)',               desc: 'Crecimiento sin límites. Describe bien el arranque del brote, pero aquí se recorta en K.' },
  logistico:   { nombre: 'Logístico de Verhulst: dN/dt = rN(1 − N/K)',   desc: 'Curva en S: arranque lento, máxima velocidad hacia K/2 y frenado al acercarse a la capacidad de carga K.' },
  gompertz:    { nombre: 'Gompertz: N(t) = K·exp(−exp(−r(t−t₀)))',       desc: 'Curva asimétrica en S: crece rápido al inicio y frena lento. Se integra como dN/dt = rN·ln(K/N).' }
};

// Partes anatómicas (raycasting). share = aporte a la biomasa total en la simulación (representación, no medición real).
export const PARTES = {
  bulbo:   { nombre: 'Bulbo',        share: .35, estres: 'h', funcion: 'Órgano de reserva (almidón y azúcares) y de dormancia; ya contiene la flor en formación.', necesita: 'Frío 4–9 °C, drenaje y aireación.', problemas: 'Pudrición por exceso de agua (Fusarium, Pythium), roedores.' },
  raices:  { nombre: 'Raíces',       share: .08, estres: 'h', funcion: 'Absorben agua y minerales del suelo.', necesita: 'Suelo suelto, oxígeno y humedad moderada.', problemas: 'Encharcamiento: menos oxígeno y más riesgo de pudrición.' },
  tallo:   { nombre: 'Tallo floral', share: .15, estres: 'n', funcion: 'Sostiene la flor y se elonga tras el frío; transporta agua (xilema) y azúcares (floema).', necesita: 'Frío completo, K y Ca, luz.', problemas: 'Frío insuficiente = tallo corto; exceso de fertilizante reduce la altura.' },
  hoja:    { nombre: 'Hoja',         share: .27, estres: 'l', funcion: 'Fotosíntesis: produce los azúcares que se almacenan en el bulbo.', necesita: 'Luz abundante, N y Mg, 16–20 °C.', problemas: 'Poca luz = baja fotosíntesis; pulgones, babosas, Botrytis.' },
  flor:    { nombre: 'Flor (tépalos)', share: .15, estres: 't', funcion: 'Estructura reproductiva y ornamental (tépalos, estambres, pistilo).', necesita: 'Temperatura fresca; sobre ~21 °C pierde vigor.', problemas: 'Aborto floral, trips, virus del tulipán.' },
  pistilo: { nombre: 'Pistilo',      share: 0,   estres: 't', funcion: 'El estigma recibe el polen; el ovario forma la cápsula con semillas.', necesita: 'Polinizadores (abejas) y flor receptiva.', problemas: 'El calor y la falta de polinización reducen las semillas.' },
  maceta:  { nombre: 'Maceta',       share: 0,   estres: 'h', funcion: 'Contenedor del sustrato.', necesita: 'Orificios de drenaje.', problemas: 'Mal drenaje favorece la pudrición.' },
  tierra:  { nombre: 'Sustrato',     share: 0,   estres: 'n', funcion: 'Aporta agua, aire y nutrientes.', necesita: 'Fértil, rico en materia orgánica, drenante, pH neutro a alcalino.', problemas: 'Compactación, salinidad, suelo muy ácido.' }
};

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---- Práctica 06: clima real mensual → serie diaria -------------------------------------------------------
// p.serie = { temp:[12], agua:[12], luz:[12] } (promedios mensuales, ene→dic). Si existe, el motor toma la
// temperatura / humedad / luz de cada día por interpolación lineal entre los centros de mes (año circular).
// p.diaInicio = día del año en que se siembra (0 = 1 de enero). p.preFrio = bulbo ya enfriado en cámara.
export const DIAS_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const ACUM_MES = DIAS_MES.map((_, i) => DIAS_MES.slice(0, i).reduce((a, b) => a + b, 0));
const CENTRO_MES = DIAS_MES.map((d, i) => ACUM_MES[i] + d / 2);
export function interpMensual(arr, diaAnio) {
  const d = ((diaAnio % 365) + 365) % 365;
  let i = 11;                                            // i = último centro de mes <= d
  for (let k = 0; k < 11; k++) if (d >= CENTRO_MES[k] && d < CENTRO_MES[k + 1]) { i = k; break; }
  const j = (i + 1) % 12, antesEnero = d < CENTRO_MES[0];   // antes del centro de enero: tramo dic(año previo)→ene
  const ini = antesEnero ? CENTRO_MES[11] - 365 : CENTRO_MES[i];
  const fin = antesEnero ? CENTRO_MES[0] : (j === 0 ? CENTRO_MES[0] + 365 : CENTRO_MES[j]);
  return arr[i] + (arr[j] - arr[i]) * clamp((d - ini) / (fin - ini), 0, 1);
}
export function aplicarSerie(p, dia) {
  const d = (p.diaInicio || 0) + dia;
  if (p.serie.temp && !p.termostato) p.temp = interpMensual(p.serie.temp, d);   // invernadero (termostato) manda sobre el clima
  if (p.serie.agua) p.agua = interpMensual(p.serie.agua, d);
  if (p.serie.luz) p.luz = interpMensual(p.serie.luz, d);
}

export function paramsPorDefecto(esp) {
  return { luz: esp.luz_opt, agua: esp.agua_opt, temp: 6, nutr: esp.nutr_opt, co2: 420, r: esp.r_defecto, K: esp.k_defecto, modelo: 'logistico', termostato: true };
}

export function estadoInicial(esp) {
  return {
    dia: 0, fase: 0, temp: 6, N: esp.n0, icr: 0, tCrec: 0, tFlor: 0, tSen: 0, frioDias: 0, frio: 0, frioEmer: 0, bulbo: 100,
    aborto: false, h: 0, hojas: 0, bulbillos: 0, g: 0, Keff: esp.k_defecto, estres: { h: 0, t: 0, l: 0, n: 0, g: 0 }
  };
}

// Eficacia del frío (0-1): 1 dentro de [tmin,tmax], decae a 0 a 3 °C fuera del rango
export function eficaciaFrio(T, esp) {
  if (T >= esp.frio_tmin && T <= esp.frio_tmax) return 1;
  const d = T < esp.frio_tmin ? esp.frio_tmin - T : T - esp.frio_tmax;
  return clamp(1 - d / 3, 0, 1);
}

// Índices de estrés 0-100 según la desviación respecto al óptimo de la especie
export function calcularEstres(p, esp, fase) {
  const curva = d => 100 * Math.pow(clamp(d, 0, 1), 1.4);
  const sh = curva(Math.abs(p.agua - esp.agua_opt) / (p.agua < esp.agua_opt ? 45 : 38));
  const optT = fase === 0 ? (esp.frio_tmin + esp.frio_tmax) / 2 : esp.temp_opt;
  const spanT = fase === 0 ? 9 : (p.temp > optT ? 10 : 12);
  const st = curva(Math.abs(p.temp - optT) / spanT);
  let sl = curva(Math.abs(p.luz - esp.luz_opt) / 55);
  if (p.luz > 85 && p.temp > esp.temp_umbral_calor) sl = Math.min(100, sl + 15); // luz intensa + calor
  const sn = curva(Math.abs(p.nutr - esp.nutr_opt) / (p.nutr < esp.nutr_opt ? 50 : 40));
  const wl = fase === 0 ? .2 : 1, wn = fase === 0 ? .3 : 1; // bajo tierra, luz y N pesan menos
  const s = { h: sh, t: st, l: sl * wl, n: sn * wn };
  const media = .28 * s.h + .32 * s.t + .2 * s.l + .2 * s.n;
  s.g = clamp(.65 * media + .35 * Math.max(s.h, s.t, s.l, s.n), 0, 100);
  return s;
}

// Termostato por fase: cálido→frío→templado (secuencia del tulipán)
export function termostato(p, esp, fase) {
  if (fase === 0) p.temp = (esp.frio_tmin + esp.frio_tmax) / 2;
  else if (fase <= 4) p.temp = esp.temp_opt;
  else p.temp = Math.min(p.temp, 18);
}

export function derivada(modelo, N, r, K) {
  switch (modelo) {
    case 'lineal':      return N >= K ? 0 : r * K / 4;
    case 'exponencial': return N >= K ? 0 : r * N;
    case 'gompertz':    return r * N * Math.log(K / N);
    default:            return r * N * (1 - N / K);
  }
}

// Avanza 1 día. Devuelve un estado nuevo. p puede mutar su temperatura si p.termostato.
export function avanzarDia(e, p, esp) {
  const s = { ...e, estres: { ...e.estres } };
  if (s.fase >= 6) return s;
  if (p.termostato) termostato(p, esp, s.fase);
  s.dia++;
  if (p.serie) aplicarSerie(p, s.dia);   // P06: clima real del lugar
  s.temp = p.temp; s.agua = p.agua; s.luz = p.luz;   // P06: con clima real cambian cada día (se guardan en mediciones)
  s.estres = calcularEstres(p, esp, s.fase);
  const S = s.estres.g;
  if (p.agua > 82) s.bulbo = clamp(s.bulbo - (p.agua - 82) * 0.12 * (p.temp > 8 ? 1 : .4), 0, 100); // riesgo de pudrición
  const fB = .4 + .6 * s.bulbo / 100;

  if (s.fase === 0) {
    if (p.preFrio) s.frioDias = esp.frio_req_dias;   // bulbo pre-enfriado (cámara fría): la dormancia ya se liberó
    s.frioDias += eficaciaFrio(p.temp, esp);
    s.frio = clamp(100 * s.frioDias / esp.frio_req_dias, 0, 100);
    if (s.frio >= 100 || s.dia >= esp.frio_req_dias * 1.7) { s.fase = 1; s.frioEmer = s.frio / 100; }
  } else if (s.fase <= 3) {
    s.tCrec++;
    const fCold = .45 + .55 * s.frioEmer;
    const fCO2 = 1 + .25 * clamp((p.co2 - 420) / 580, -.3, 1);
    const rEff = p.r * (1 - .9 * S / 100) * fCold * fB * fCO2;
    s.Keff = p.K * (1 - .45 * S / 100) * (.75 + .25 * s.frioEmer) * (.7 + .3 * s.bulbo / 100);
    const N1 = s.N;
    let N = s.N;
    for (let i = 0; i < 4; i++) {
      N += derivada(p.modelo, N, rEff, s.Keff) * .25;
      N = clamp(N, .05, 1e4);
      if (p.modelo === 'lineal' || p.modelo === 'exponencial') N = Math.min(N, s.Keff);
    }
    s.N = N;
    s.icr = (N - N1) / N1;
    s.g = clamp((N - esp.n0) / Math.max(.01, s.Keff - esp.n0), 0, 1);
    s.fase = s.g < .05 ? 1 : s.g < .45 ? 2 : s.g < .85 ? 3 : 4;
    if (s.tCrec > 140 && s.fase < 4) { s.fase = 5; s.aborto = true; } // aborto floral
  } else if (s.fase === 4) {
    s.tFlor++; s.icr = 0;
    const dur = clamp(18 - .5 * Math.max(0, p.temp - 12), 6, 18); // el calor acorta la flor
    if (s.tFlor >= dur) s.fase = 5;
  } else if (s.fase === 5) {
    s.tSen++; s.icr = 0;
    if (s.tSen >= 30) s.fase = 6;
  }

  if (s.fase >= 4) s.g = Math.max(s.g, .85);
  const g = s.fase === 0 ? 0 : s.g;
  s.h = s.fase === 0 ? 0 : esp.altura_max * (.45 + .55 * s.frioEmer) * Math.pow(clamp(g, 0, 1), .8);
  s.hojas = s.fase === 0 ? 0 : Math.round(2 + 4 * clamp(g, 0, 1));
  s.bulbillos = s.fase >= 5 ? Math.round(1 + 2 * s.bulbo / 100 * Math.min(1, s.tSen / 25)) : 0;
  return s;
}

// Proyección: mantiene las condiciones actuales y avanza hasta fin de ciclo (predicción de cosecha)
export function proyectar(e, p, esp, maxDias = 450) {
  const pc = { ...p }, out = [];
  let s = e;
  for (let i = 0; i < maxDias && s.fase < 6; i++) { s = avanzarDia(s, pc, esp); out.push(s); }
  return out;
}
export function diasACosecha(e, proy) {
  if (e.fase >= 4) return 0;
  const i = proy.findIndex(x => x.fase >= 4);
  return i < 0 ? null : i + 1;
}

// MOTOR DE DECISIONES: reglas con umbral → recomendación
export function evaluarDecisiones(e, p, esp) {
  const R = [];
  const add = (codigo, severidad, titulo, detalle, umbral, valor) => R.push({ codigo, severidad, titulo, detalle, umbral, valor });
  const s = e.estres;
  if (e.fase === 0 && p.temp > esp.frio_tmax + 1 && e.frio < 100) add('FRIO_TEMP', 'alta', 'Bajar temperatura a 4–9 °C', 'No se acumula frío fuera del rango; la dormancia no se libera.', `T > ${esp.frio_tmax + 1} °C`, p.temp);
  if (e.fase === 0 && e.frio < 100 && e.dia > esp.frio_req_dias * 1.3) add('FRIO_TARDE', 'alta', 'Frío insuficiente', 'Emergerá con tallo corto y floración deficiente.', `día > ${Math.round(esp.frio_req_dias * 1.3)}`, e.dia);
  if (e.fase >= 1 && e.fase <= 4 && p.temp > esp.temp_umbral_calor) add('CALOR', 'alta', 'Reducir temperatura', 'Sobre ~21 °C se pierde vigor floral (intolerante al calor).', `T > ${esp.temp_umbral_calor} °C`, p.temp);
  if (e.fase >= 1 && e.fase <= 4 && p.temp < esp.temp_opt - 8) add('FRIO_CREC', 'media', 'Subir temperatura a 16–20 °C', 'Tras el frío, la elongación necesita temperaturas templadas.', `T < ${esp.temp_opt - 8} °C`, p.temp);
  if (p.agua < esp.agua_opt - 20) add('RIEGO', 'alta', 'Aumentar riego', 'Humedad por debajo del rango óptimo: estrés hídrico.', `agua < ${esp.agua_opt - 20}%`, p.agua);
  if (p.agua > 82) add('PUDRICION', 'critica', 'Reducir riego / mejorar drenaje', 'Suelo saturado: menos oxígeno y riesgo de pudrición del bulbo.', 'agua > 82%', p.agua);
  if (p.luz < esp.luz_opt - 25) add('LUZ_BAJA', 'media', 'Aumentar luz', 'Poca luz reduce la fotosíntesis y la biomasa.', `luz < ${esp.luz_opt - 25}%`, p.luz);
  if (p.luz > 85 && p.temp > esp.temp_umbral_calor) add('LUZ_CALOR', 'media', 'Aplicar sombreo parcial', 'Luz intensa combinada con calor.', 'luz > 85% y T > 21 °C', p.luz);
  if (p.nutr < esp.nutr_opt - 25) add('NUTR_BAJA', 'media', 'Fertilizar (N, P, K)', 'Deficiencia: hojas pequeñas y bulbos hijos pequeños.', `nutr < ${esp.nutr_opt - 25}%`, p.nutr);
  if (p.nutr > esp.nutr_opt + 25) add('NUTR_ALTA', 'media', 'Reducir fertilización', 'Exceso: salinidad/desequilibrio; puede reducir la altura.', `nutr > ${esp.nutr_opt + 25}%`, p.nutr);
  if (s.g > 75) add('ESTRES_SEV', 'critica', 'Estrés severo', 'Corrige primero el factor con mayor índice.', 'estrés global > 75', Math.round(s.g));
  if (e.bulbo < 50) add('BULBO', 'alta', 'Salud del bulbo comprometida', 'Reduce el agua; el bulbo no se recupera solo.', 'salud < 50%', Math.round(e.bulbo));
  if (e.fase === 1 || e.fase === 2 || e.fase === 3) add('INFO_VEG', 'info', 'Mantener condiciones', 'Crecimiento en curso.', '', 0);
  if (e.fase === 4) add('COSECHA', 'info', 'Cosechar la flor en los próximos días', 'Flor abierta: su duración depende de la temperatura.', 'fase floración', 0);
  if (e.fase === 5) add('BULBO_COS', 'info', e.aborto ? 'Aborto floral: revisar frío y estrés' : 'Dejar el follaje; cosechar bulbo y bulbillos', 'Las hojas devuelven reservas al bulbo.', 'fase senescencia', 0);
  if (e.fase === 6) add('FIN', 'ok', 'Ciclo completo', 'Guarda la simulación y compárala en Reportes.', '', 0);
  if (!R.length || (e.fase === 0 && s.g < 20)) add('OK', 'ok', 'Condiciones óptimas', e.fase === 0 ? 'Acumulando frío correctamente.' : 'Sin acciones necesarias.', '', 0);
  const orden = { critica: 4, alta: 3, media: 2, info: 1, ok: 0 };
  return R.sort((a, b) => orden[b.severidad] - orden[a.severidad]);
}

export function resumenSim(historial, esp) {
  const u = historial[historial.length - 1] || estadoInicial(esp);
  const flor = historial.find(h => h.fase >= 4);
  const estMedio = historial.length ? historial.reduce((a, h) => a + h.estres.g, 0) / historial.length : 0;
  return { biomasa_final: +u.N.toFixed(3), dias_madurez: flor ? flor.dia : null, estres_medio: +estMedio.toFixed(2), altura_final: +u.h.toFixed(3), aborto: u.aborto ? 1 : 0, dias_totales: u.dia };
}

// Comparación A/B → ganador por puntaje ponderado (biomasa 50 %, rapidez 30 %, bajo estrés 20 %, penaliza aborto)
export function compararAB(rA, rB) {
  const dA = rA.dias_madurez ?? 999, dB = rB.dias_madurez ?? 999;
  const bm = Math.max(rA.biomasa_final, rB.biomasa_final, 1e-6), dm = Math.min(dA, dB);
  const pts = (r, d) => .5 * r.biomasa_final / bm + .3 * (dm / d) + .2 * (1 - r.estres_medio / 100) - (r.aborto ? .3 : 0);
  const pA = pts(rA, dA), pB = pts(rB, dB);
  return {
    puntajeA: pA, puntajeB: pB,
    ganador: Math.abs(pA - pB) < .01 ? 'empate' : (pA > pB ? 'A' : 'B'),
    dif_biomasa_pct: 100 * (rA.biomasa_final - rB.biomasa_final) / Math.max(rB.biomasa_final, 1e-6)
  };
}
