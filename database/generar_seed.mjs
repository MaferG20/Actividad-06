// Genera seed.sql con el MISMO motor que usa el navegador:  node database/generar_seed.mjs
import fs from 'fs';
import * as M from '../js/modelos.js';
const esp = JSON.parse(fs.readFileSync(new URL('../data/especies.json', import.meta.url)));
const q = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(+v.toFixed(5)) : "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
const ESC = [ // [especie_id, nombre, notas, cambios a params]
  [1, 'Gesneriana óptimo (logístico)', 'Condiciones óptimas con termostato por fase.', {}],
  [1, 'Gesneriana sin frío (20 °C fijo)', 'Sin termostato: no acumula frío, emerge por tiempo máximo con tallo corto.', { termostato: false, temp: 20 }],
  [1, 'Gesneriana exceso de riego', 'Agua al 92 %: riesgo de pudrición del bulbo.', { agua: 92 }],
  [1, 'Gesneriana poca luz (30 %)', 'Baja fotosíntesis y biomasa.', { luz: 30 }],
  [1, 'Gesneriana modelo Gompertz', 'Mismo escenario óptimo con Gompertz.', { modelo: 'gompertz' }],
  [1, 'Gesneriana modelo exponencial', 'Mismo escenario óptimo con modelo exponencial.', { modelo: 'exponencial' }],
  [1, 'Gesneriana modelo lineal', 'Mismo escenario óptimo con modelo lineal.', { modelo: 'lineal' }],
  [1, 'Gesneriana déficit de nutrientes', 'Nutrientes al 20 %.', { nutr: 20 }],
  [2, 'Prominence + CO₂ 800 ppm', 'Cultivar de forzado con enriquecimiento de CO₂.', { co2: 800 }],
  [2, 'Prominence calor 24 °C', 'Sin termostato, 24 °C: pérdida de vigor floral.', { termostato: false, temp: 24 }],
  [3, 'Edulis luz 78 % (óptimo)', 'Luz óptima reportada para T. edulis.', { luz: 78 }],
  [3, 'Edulis luz 100 %', 'Pleno sol con la misma especie.', { luz: 100 }],
  [4, 'Sylvestris semisombra', 'Luz 60 %, suelo húmedo.', {}],
  [5, 'Clusiana pleno sol y drenaje', 'Luz 90 %, agua 40 %.', {}],
  [6, 'Kaufmanniana óptimo', 'Floración temprana.', {}]
];
let sql = '-- seed.sql · Práctica 06 (generado con: node database/generar_seed.mjs)\n-- Contiene catálogo, 8 ubicaciones de ejemplo (solo nombre y coordenadas) y las 15 simulaciones de la P05.\n-- NO contiene datos climáticos/suelo/GBIF inventados: esos se descargan de las APIs reales y se guardan al usar la app.\nUSE practica06_geovisualizacion;\nSET FOREIGN_KEY_CHECKS=0;\nTRUNCATE comparaciones_geo; TRUNCATE comparaciones_ab; TRUNCATE decisiones; TRUNCATE analisis_geo; TRUNCATE ubicaciones; TRUNCATE mediciones; TRUNCATE simulaciones; TRUNCATE especies;\nSET FOREIGN_KEY_CHECKS=1;\n\n';
const cols = ['id','nombre_comun','nombre_cientifico','familia','color_hex','luz_opt','agua_opt','temp_opt','nutr_opt','r_defecto','k_defecto','n0','altura_max','frio_req_dias','frio_tmin','frio_tmax','temp_umbral_calor','t_anual_min','t_anual_max','precip_min','precip_max','ph_min','ph_max','arcilla_max','notas'];
sql += `INSERT INTO especies (${cols.join(',')}) VALUES\n` + esp.map(e => '(' + cols.map(c => q(e[c])).join(',') + ')').join(',\n') + ';\n\n';
const ubic = JSON.parse(fs.readFileSync(new URL('../data/ubicaciones.json', import.meta.url)));
sql += 'INSERT INTO ubicaciones (id,nombre,pais,codigo_pais,lat,lon,preset) VALUES\n' + ubic.map(u => '(' + [u.id, u.nombre, u.pais, u.codigo_pais, u.lat, u.lon, 1].map(q).join(',') + ')').join(',\n') + ';\n\n';
const sims = [], resultados = [];
ESC.forEach(([eid, nombre, notas, cambios], i) => {
  const e = esp.find(x => x.id === eid), p = { ...M.paramsPorDefecto(e), ...cambios }, p0 = { ...p };
  let s = M.estadoInicial(e); const hist = [], meds = [], dec = new Map();
  while (s.fase < 6 && s.dia < 600) {
    s = M.avanzarDia(s, p, e); hist.push(s);
    if (s.dia % 5 === 0 || s.fase === 6) {
      meds.push(s);
      for (const d of M.evaluarDecisiones(s, p, e)) if (d.codigo !== 'OK' && d.codigo !== 'INFO_VEG' && !dec.has(d.codigo)) dec.set(d.codigo, { dia: s.dia, ...d });
    }
  }
  const r = M.resumenSim(hist, e); resultados.push(r);
  const id = i + 1;
  sql += `-- Simulación ${id}: ${nombre}\n`;
  sql += `INSERT INTO simulaciones (id,especie_id,nombre,notas,modelo,luz,agua,temp,nutr,co2,r,k,termostato,escenario,biomasa_final,altura_final,dias_madurez,dias_totales,estres_medio,aborto) VALUES (${[id, eid, nombre, notas, p0.modelo, p0.luz, p0.agua, p0.temp, p0.nutr, p0.co2, p0.r, p0.K, p0.termostato ? 1 : 0, 'A', r.biomasa_final, r.altura_final, r.dias_madurez, r.dias_totales, r.estres_medio, r.aborto].map(q).join(',')});\n`;
  sql += 'INSERT INTO mediciones (simulacion_id,dia,fase,biomasa,altura,hojas,bulbillos,icr,estres_hidrico,estres_termico,estres_luminico,estres_nutricional,estres_global,frio_acum,salud_bulbo,temp,agua,luz,nutr) VALUES\n' +
    meds.map(m => '(' + [id, m.dia, m.fase, m.N, m.h, m.hojas, m.bulbillos, m.icr, m.estres.h, m.estres.t, m.estres.l, m.estres.n, m.estres.g, m.frio, m.bulbo, m.temp, p.agua, p.luz, p.nutr].map(v => typeof v === 'number' ? +v.toFixed(4) : v).join(',') + ')').join(',\n') + ';\n';
  if (dec.size) sql += 'INSERT INTO decisiones (simulacion_id,dia,codigo,severidad,titulo,detalle,umbral,valor) VALUES\n' + [...dec.values()].map(d => '(' + [id, d.dia, d.codigo, d.severidad, d.titulo, d.detalle, d.umbral, d.valor].map(q).join(',') + ')').join(',\n') + ';\n';
  sql += '\n';
});
const pares = [[1, 2], [1, 3], [1, 4], [11, 12]];
sql += 'INSERT INTO comparaciones_ab (sim_a_id,sim_b_id,ganador,puntaje_a,puntaje_b) VALUES\n' + pares.map(([a, b]) => {
  const c = M.compararAB(resultados[a - 1], resultados[b - 1]);
  return `(${a},${b},'${c.ganador}',${c.puntajeA.toFixed(3)},${c.puntajeB.toFixed(3)})`;
}).join(',\n') + ';\n';
fs.writeFileSync(new URL('./seed.sql', import.meta.url), sql);
console.log('seed.sql generado:', ESC.length, 'simulaciones');
resultados.forEach((r, i) => console.log(i + 1, ESC[i][1], JSON.stringify(r)));
