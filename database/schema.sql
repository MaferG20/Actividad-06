-- Práctica 06 · Observatorio Global de Cultivos (continuación de la Práctica 05)
-- MySQL 8 · utf8mb4
-- Tablas heredadas de la P05: especies*, simulaciones, mediciones, decisiones*, comparaciones_ab   (* ampliadas)
-- Tablas nuevas de la P06:   cache_api, ubicaciones, analisis_geo, comparaciones_geo
CREATE DATABASE IF NOT EXISTS practica06_geovisualizacion CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE practica06_geovisualizacion;
SET NAMES utf8mb4;

DROP TABLE IF EXISTS comparaciones_geo;
DROP TABLE IF EXISTS comparaciones_ab;
DROP TABLE IF EXISTS decisiones;
DROP TABLE IF EXISTS analisis_geo;
DROP TABLE IF EXISTS ubicaciones;
DROP TABLE IF EXISTS mediciones;
DROP TABLE IF EXISTS simulaciones;
DROP TABLE IF EXISTS cache_api;
DROP TABLE IF EXISTS especies;

-- Catálogo de especies: óptimos ambientales y parámetros genéticos simulados (r, K)
CREATE TABLE especies (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre_comun       VARCHAR(80)  NOT NULL,
  nombre_cientifico  VARCHAR(120) NOT NULL UNIQUE,
  familia            VARCHAR(60)  NOT NULL,
  color_hex          CHAR(7)      NOT NULL DEFAULT '#ff4f8b',
  luz_opt            DECIMAL(5,1) NOT NULL COMMENT '% luz solar completa',
  agua_opt           DECIMAL(5,1) NOT NULL COMMENT '% humedad del sustrato',
  temp_opt           DECIMAL(4,1) NOT NULL COMMENT '°C fase de crecimiento',
  nutr_opt           DECIMAL(5,1) NOT NULL COMMENT '% nutrientes (NPK)',
  r_defecto          DECIMAL(5,3) NOT NULL COMMENT 'tasa intrínseca de crecimiento (1/día)',
  k_defecto          DECIMAL(7,2) NOT NULL COMMENT 'capacidad de carga: biomasa máx. (g)',
  n0                 DECIMAL(6,2) NOT NULL COMMENT 'biomasa inicial (g)',
  altura_max         DECIMAL(5,2) NOT NULL COMMENT 'altura máxima del tallo (unidades 3D)',
  frio_req_dias      SMALLINT UNSIGNED NOT NULL COMMENT 'días de frío para liberar dormancia',
  frio_tmin          DECIMAL(4,1) NOT NULL,
  frio_tmax          DECIMAL(4,1) NOT NULL,
  temp_umbral_calor  DECIMAL(4,1) NOT NULL DEFAULT 21.0,
  -- P06: envolvente geo-agronómica (parámetros de SIMULACIÓN calibrados con la investigación; no son constantes biológicas)
  gbif_key           INT UNSIGNED NULL COMMENT 'taxonKey de GBIF (se llena solo la primera vez: caché del species/match)',
  t_anual_min        DECIMAL(4,1) NOT NULL DEFAULT 6   COMMENT '°C temp. media anual mínima favorable',
  t_anual_max        DECIMAL(4,1) NOT NULL DEFAULT 16  COMMENT '°C temp. media anual máxima favorable',
  precip_min         SMALLINT UNSIGNED NOT NULL DEFAULT 450  COMMENT 'mm/año mínimos',
  precip_max         SMALLINT UNSIGNED NOT NULL DEFAULT 1300 COMMENT 'mm/año máximos',
  ph_min             DECIMAL(3,1) NOT NULL DEFAULT 6.0,
  ph_max             DECIMAL(3,1) NOT NULL DEFAULT 7.8,
  arcilla_max        TINYINT UNSIGNED NOT NULL DEFAULT 35 COMMENT '% de arcilla tolerable (drenaje)',
  notas              TEXT NULL,
  creada_en          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Cada corrida guardada: parámetros usados + resultados agregados (trazabilidad)
CREATE TABLE simulaciones (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  especie_id     INT UNSIGNED NOT NULL,
  nombre         VARCHAR(100) NOT NULL,
  notas          TEXT NULL,
  modelo         ENUM('lineal','exponencial','logistico','gompertz') NOT NULL,
  luz            DECIMAL(5,1) NOT NULL,
  agua           DECIMAL(5,1) NOT NULL,
  temp           DECIMAL(4,1) NOT NULL,
  nutr           DECIMAL(5,1) NOT NULL,
  co2            SMALLINT UNSIGNED NOT NULL DEFAULT 420,
  r              DECIMAL(5,3) NOT NULL,
  k              DECIMAL(7,2) NOT NULL,
  termostato     TINYINT(1) NOT NULL DEFAULT 1,
  escenario      CHAR(1) NOT NULL DEFAULT 'A',
  biomasa_final  DECIMAL(8,3) NOT NULL DEFAULT 0,
  altura_final   DECIMAL(6,3) NOT NULL DEFAULT 0,
  dias_madurez   SMALLINT UNSIGNED NULL COMMENT 'día en que inicia la floración (cosecha de flor)',
  dias_totales   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  estres_medio   DECIMAL(5,2) NOT NULL DEFAULT 0,
  aborto         TINYINT(1) NOT NULL DEFAULT 0,
  creada_en      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sim_especie FOREIGN KEY (especie_id) REFERENCES especies(id),
  INDEX idx_sim_especie (especie_id),
  INDEX idx_sim_biomasa (biomasa_final)
) ENGINE=InnoDB;

-- Serie temporal: una fila cada N días (no cada frame) por simulación
CREATE TABLE mediciones (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  simulacion_id       INT UNSIGNED NOT NULL,
  dia                 SMALLINT UNSIGNED NOT NULL,
  fase                TINYINT UNSIGNED NOT NULL,
  biomasa             DECIMAL(8,3) NOT NULL,
  altura              DECIMAL(6,3) NOT NULL,
  hojas               TINYINT UNSIGNED NOT NULL DEFAULT 0,
  bulbillos           TINYINT UNSIGNED NOT NULL DEFAULT 0,
  icr                 DECIMAL(8,5) NOT NULL DEFAULT 0 COMMENT 'índice de crecimiento relativo (g/g/día)',
  estres_hidrico      DECIMAL(5,2) NOT NULL,
  estres_termico      DECIMAL(5,2) NOT NULL,
  estres_luminico     DECIMAL(5,2) NOT NULL,
  estres_nutricional  DECIMAL(5,2) NOT NULL,
  estres_global       DECIMAL(5,2) NOT NULL,
  frio_acum           DECIMAL(5,2) NOT NULL DEFAULT 0,
  salud_bulbo         DECIMAL(5,2) NOT NULL DEFAULT 100,
  temp                DECIMAL(4,1) NOT NULL,
  agua                DECIMAL(5,1) NOT NULL,
  luz                 DECIMAL(5,1) NOT NULL,
  nutr                DECIMAL(5,1) NOT NULL,
  CONSTRAINT fk_med_sim FOREIGN KEY (simulacion_id) REFERENCES simulaciones(id) ON DELETE CASCADE,
  UNIQUE KEY uq_med_sim_dia (simulacion_id, dia)
) ENGINE=InnoDB;

-- ===================== P06 · NUEVAS TABLAS =====================

-- Sitios del mundo: presets del seed + cualquier punto analizado (coordenadas redondeadas a 3 decimales ≈ 110 m)
CREATE TABLE ubicaciones (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre       VARCHAR(120) NOT NULL,
  pais         VARCHAR(80)  NULL,
  codigo_pais  CHAR(2)      NULL,
  lat          DECIMAL(8,5) NOT NULL,
  lon          DECIMAL(8,5) NOT NULL,
  elevacion_m  SMALLINT     NULL,
  preset       TINYINT(1)   NOT NULL DEFAULT 0,
  creada_en    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ubic_coord (lat, lon),
  INDEX idx_ubic_preset (preset)
) ENGINE=InnoDB;

-- Un análisis geoespacial = datos REALES de un punto (NASA POWER + SoilGrids + GBIF) cruzados con una especie.
-- Se enlaza (opcional) con la simulación de crecimiento lanzada con esas mismas condiciones.
CREATE TABLE analisis_geo (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ubicacion_id     INT UNSIGNED NOT NULL,
  especie_id       INT UNSIGNED NOT NULL,
  simulacion_id    INT UNSIGNED NULL,
  temp_media       DECIMAL(5,2) NOT NULL COMMENT '°C media anual (NASA POWER)',
  temp_min_mes     DECIMAL(5,2) NOT NULL COMMENT '°C del mes más frío',
  temp_max_mes     DECIMAL(5,2) NOT NULL COMMENT '°C del mes más cálido',
  precip_anual     DECIMAL(7,1) NOT NULL COMMENT 'mm/año (NASA POWER PRECTOTCORR)',
  radiacion_mj     DECIMAL(5,2) NOT NULL COMMENT 'MJ/m²/día media (ALLSKY_SFC_SW_DWN)',
  et0_anual        DECIMAL(7,1) NULL     COMMENT 'mm/año (Hargreaves radiativo, calculado)',
  aridez           DECIMAL(5,2) NULL     COMMENT 'P / ET0',
  frio_efectivo    DECIMAL(6,1) NULL     COMMENT 'días de frío efectivo para esta especie',
  ph               DECIMAL(4,2) NULL     COMMENT 'SoilGrids 0-30 cm',
  arcilla          DECIMAL(5,1) NULL     COMMENT '% SoilGrids',
  arena            DECIMAL(5,1) NULL,
  limo             DECIMAL(5,1) NULL,
  carbono_org      DECIMAL(5,1) NULL     COMMENT 'g/kg SoilGrids',
  textura          VARCHAR(40)  NULL,
  gbif_region      INT UNSIGNED NULL     COMMENT 'registros GBIF dentro de gbif_radio_km',
  gbif_radio_km    SMALLINT UNSIGNED NULL,
  gbif_total       INT UNSIGNED NULL     COMMENT 'registros GBIF en todo el mundo',
  idoneidad        DECIMAL(5,1) NOT NULL COMMENT '0-100',
  clase            VARCHAR(10)  NOT NULL,
  factor_limitante VARCHAR(20)  NULL,
  detalle          JSON NULL             COMMENT 'subpuntajes por variable',
  fuentes          JSON NULL             COMMENT 'estado de caché/HTTP de cada API en ese momento',
  notas            TEXT NULL,
  creada_en        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ana_ubic FOREIGN KEY (ubicacion_id)  REFERENCES ubicaciones(id) ON DELETE CASCADE,
  CONSTRAINT fk_ana_esp  FOREIGN KEY (especie_id)    REFERENCES especies(id),
  CONSTRAINT fk_ana_sim  FOREIGN KEY (simulacion_id) REFERENCES simulaciones(id) ON DELETE SET NULL,
  INDEX idx_ana_esp_ido (especie_id, idoneidad),
  INDEX idx_ana_ubic (ubicacion_id)
) ENGINE=InnoDB;

-- Caché de respuestas de APIs externas: clave = SHA-256 de la URL pública (nunca incluye API keys)
CREATE TABLE cache_api (
  clave      CHAR(64) PRIMARY KEY,
  proveedor  VARCHAR(30)  NOT NULL COMMENT 'nasa_power | open_meteo | soilgrids | gbif | nominatim',
  url        VARCHAR(1000) NOT NULL,
  status     SMALLINT UNSIGNED NOT NULL COMMENT 'HTTP; ≠200 = caché NEGATIVA de corta duración (evita martillar APIs caídas)',
  cuerpo     MEDIUMTEXT NOT NULL,
  creada_en  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expira_en  DATETIME NOT NULL,
  aciertos   INT UNSIGNED NOT NULL DEFAULT 0,
  INDEX idx_cache_exp (expira_en),
  INDEX idx_cache_prov (proveedor)
) ENGINE=InnoDB;

-- Recomendaciones emitidas por el motor de decisiones durante la corrida
CREATE TABLE decisiones (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  simulacion_id  INT UNSIGNED NULL     COMMENT 'reglas del simulador (P05)',
  analisis_id    INT UNSIGNED NULL     COMMENT 'reglas geo-agronómicas (P06): una de las dos columnas va llena',
  dia            SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  codigo         VARCHAR(30) NOT NULL,
  severidad      ENUM('critica','alta','media','info','ok') NOT NULL,
  titulo         VARCHAR(120) NOT NULL,
  detalle        VARCHAR(255) NULL,
  umbral         VARCHAR(60) NULL,
  valor          DECIMAL(8,2) NULL,
  CONSTRAINT fk_dec_sim FOREIGN KEY (simulacion_id) REFERENCES simulaciones(id) ON DELETE CASCADE,
  CONSTRAINT fk_dec_ana FOREIGN KEY (analisis_id)   REFERENCES analisis_geo(id) ON DELETE CASCADE,
  INDEX idx_dec_sim (simulacion_id),
  INDEX idx_dec_ana (analisis_id)
) ENGINE=InnoDB;

-- Resultado de comparar dos simulaciones (A/B)
CREATE TABLE comparaciones_ab (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sim_a_id   INT UNSIGNED NOT NULL,
  sim_b_id   INT UNSIGNED NOT NULL,
  ganador    ENUM('A','B','empate') NOT NULL,
  puntaje_a  DECIMAL(6,3) NOT NULL,
  puntaje_b  DECIMAL(6,3) NOT NULL,
  criterio   VARCHAR(160) NOT NULL DEFAULT 'biomasa 50% + rapidez 30% + bajo estrés 20%',
  creada_en  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ab_a FOREIGN KEY (sim_a_id) REFERENCES simulaciones(id) ON DELETE CASCADE,
  CONSTRAINT fk_ab_b FOREIGN KEY (sim_b_id) REFERENCES simulaciones(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Comparación A/B geográfica: misma especie en dos ubicaciones del globo
CREATE TABLE comparaciones_geo (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  especie_id    INT UNSIGNED NOT NULL,
  analisis_a_id INT UNSIGNED NOT NULL,
  analisis_b_id INT UNSIGNED NOT NULL,
  sim_a_id      INT UNSIGNED NULL,
  sim_b_id      INT UNSIGNED NULL,
  ganador       ENUM('A','B','empate') NOT NULL,
  puntaje_a     DECIMAL(6,3) NOT NULL,
  puntaje_b     DECIMAL(6,3) NOT NULL,
  criterio      VARCHAR(200) NOT NULL DEFAULT '60 % simulación (biomasa 50 + rapidez 30 + bajo estrés 20) + 40 % idoneidad',
  creada_en     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cg_esp FOREIGN KEY (especie_id)    REFERENCES especies(id),
  CONSTRAINT fk_cg_a   FOREIGN KEY (analisis_a_id) REFERENCES analisis_geo(id) ON DELETE CASCADE,
  CONSTRAINT fk_cg_b   FOREIGN KEY (analisis_b_id) REFERENCES analisis_geo(id) ON DELETE CASCADE,
  CONSTRAINT fk_cg_sa  FOREIGN KEY (sim_a_id) REFERENCES simulaciones(id) ON DELETE SET NULL,
  CONSTRAINT fk_cg_sb  FOREIGN KEY (sim_b_id) REFERENCES simulaciones(id) ON DELETE SET NULL
) ENGINE=InnoDB;
