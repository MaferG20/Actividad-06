# Práctica 06 · Observatorio Global de Cultivos 🌍🌷

Continuación de la **Práctica 05** (Laboratorio Bioinformático de Cultivo del tulipán). El simulador de crecimiento ahora vive dentro de un **globo terráqueo 3D**: haces clic en cualquier punto del planeta, el servidor consulta **datos reales** (clima, suelo, biodiversidad), calcula la **idoneidad** de cada especie y puedes lanzar la **simulación de crecimiento con el clima de ese lugar**, comparar dos ubicaciones (A/B) y ver rankings.

> «Una simulación con datos inventados te enseña a programar; una simulación con datos reales te enseña a decidir.»

## Arquitectura (3 capas)

```
 NAVEGADOR                         SERVIDOR (PHP)                                     INTERNET
┌────────────────────────┐   ┌───────────────────────────────────────────┐   ┌───────────────────────┐
│ app.js  · globo.js     │   │ FlightPHP (api/index.php)                 │   │ NASA POWER  (clima)   │
│ geo.js  (decisión)     │──►│   └► Geo → Proxy ─► MySQL cache_api (HIT) │   │ Open-Meteo  (ahora)   │
│ main.js (lab P05)      │   │               └─► cURL en paralelo (MISS)─┼──►│ SoilGrids   (suelo)   │
│ Three.js · Chart.js    │◄──│   ◄── Normalizar → JSON                   │   │ GBIF        (especies)│
└────────────────────────┘   │   PDO → MySQL (análisis, decisiones, A/B) │   │ Nominatim   (nombre)  │
  nunca ve URLs ni API keys  └───────────────────────────────────────────┘   └───────────────────────┘
```

| Capa | Archivos | Qué hace |
|---|---|---|
| **Datos externos** (PHP) | `api/lib/{Http,Cache,Proxy,Normalizar,Geo}.php`, rutas `/api/geo/*` | Proxy con lista blanca de hosts, cURL paralelo (`curl_multi`), caché MySQL con vigencia por fuente, normalización |
| **Geoespacial** (Three.js) | `js/globo.js`, `app.js` | Globo desde cero: textura, cuadrícula, atmósfera, raycasting, pines A/B, arco, nube de puntos GBIF |
| **Decisión geo-agronómica** (JS + MySQL) | `js/geo.js`, `js/modelos.js`, tablas `analisis_geo`, `decisiones`… | Clima derivado, idoneidad, reglas con umbral, parámetros de simulación, A/B, ranking |
| **Laboratorio 3D** (P05) | `main.js`, `js/escena.js` | Motor de crecimiento de la P05, alimentado por la serie climática mensual del lugar |

## Instalación (XAMPP/Laragon · MySQL 8 · PHP ≥ 8.1 con `curl`)

1. Copia la carpeta a `htdocs` → `http://localhost/practica-06-geovisualizacion/`.
2. Importa `database/schema.sql` y luego `database/seed.sql` (crea `practica06_geovisualizacion`).
3. En `api/`: `composer install`. Si tu MySQL no es `root` sin clave, copia `api/config.local.php.ejemplo` a `api/config.local.php` (no se sube a git).
4. **Pon tu correo** en `http.user_agent` (Nominatim lo exige). En Windows, si cURL da *error 60 (SSL)*, descarga <https://curl.se/ca/cacert.pem> y apunta `http.cacert` a él.
5. Verifica el backend **antes** del globo:
   ```bash
   bash api/tools/probar_apis.sh http://localhost/practica-06-geovisualizacion/api
   curl "http://localhost/practica-06-geovisualizacion/api/geo/clima?lat=14.29&lon=-89.9"
   curl  http://localhost/practica-06-geovisualizacion/api/geo/diagnostico
   ```
6. Abre la página: la insignia **MySQL conectado** confirma la API. Opcional: `php api/tools/precargar.php` llena la caché de las 8 ubicaciones respetando el límite de SoilGrids.

### Si ves «HTTP 404» / «Modo local (sin API)»

Es Apache sin `mod_rewrite` o con `AllowOverride None`: `/api/especies` nunca llega a `index.php`. **Ya no hace falta arreglarlo**: `js/api.js` prueba solo
`/api/…`, `/api/index.php/…` y `/api/index.php?_ruta=/…` y usa la que responda (comprueba abriendo `api/index.php/ping`). Si aun así falla,
pulsa **🩺 Diagnóstico** (o la insignia roja): dice si el problema es PHP, `composer install` (carpeta `api/vendor`), MySQL, certificados SSL o que el servidor
no tiene salida a Internet hacia alguna API. Para activar las URL bonitas en Apache: `a2enmod rewrite` y `AllowOverride All` en el `<Directory>` del sitio.

### Frontend en Live Server + backend (PHP + MySQL) en un hosting

Live Server solo sirve archivos: no ejecuta PHP ni MySQL. Para guardar en MySQL, la carpeta `api/` y la base van en un hosting con PHP ≥ 8.1 y MySQL; **FlightPHP ya viene en `api/vendor/`** (no hace falta `composer`).

1. En el panel del hosting crea una base MySQL y anota *host, nombre, usuario y contraseña*. En phpMyAdmin importa `database/schema.sql` y luego `database/seed.sql` (si el hosting no te deja crear la base `practica06_geovisualizacion`, quita las líneas `CREATE DATABASE` y `USE` de ambos archivos antes de importar).
2. Sube por FTP/Administrador de archivos la carpeta **`api/`** completa (incluida `vendor/`). Copia `api/config.local.php.ejemplo` a `api/config.local.php` y pon ahí tus datos de MySQL y tu correo.
3. Abre `https://TU-HOSTING/…/api/index.php/ping`: debe mostrar `{"ok":true,"ping":true,…}`.
4. En `config.js` (raíz del proyecto) pon `window.P06_API = 'https://TU-HOSTING/…/api'` (sin barra final) o abre Live Server con `?api=https://TU-HOSTING/…/api`.
5. Abre la página en Live Server y pulsa **🩺 Diagnóstico**: MySQL, tablas y las 5 APIs deben salir ✔.

CORS ya permite `localhost`/`127.0.0.1` en cualquier puerto; para GitHub Pages añade `'cors_origins' => ['https://TU-USUARIO.github.io']` en `config.local.php`. Ojo: algunos hostings gratuitos bloquean las conexiones salientes (cURL) hacia otras webs o muestran una página de verificación anti-bot a las peticiones desde otro dominio; el Diagnóstico lo evidencia. En ese caso sube también el frontend al mismo hosting y ábrelo desde ahí (`./api`).

## Rutas nuevas

| Ruta | Fuente | Propósito |
|---|---|---|
| `GET /api/geo/clima?lat&lon` | NASA POWER | Climatología mensual: T2M, lluvia, radiación, HR |
| `GET /api/geo/actual?lat&lon` | Open-Meteo | Ahora, suelo superficial, ET0, pronóstico 3 días |
| `GET /api/geo/suelo?lat&lon` | SoilGrids | pH, arcilla, arena, limo, C orgánico (0–30 cm) |
| `GET /api/geo/punto?lat&lon` | las 4 + nombre | **Todo en una llamada** (cURL paralelo); lo usa el clic del globo |
| `GET /api/geo/ocurrencias/conteos?lat&lon&radio_km[&especie_id]` | GBIF | Registros por especie en el radio y en el mundo |
| `GET /api/geo/ocurrencias/mapa?especie_id` | GBIF | Muestra de puntos para dibujar en el globo |
| `GET /api/geo/geocodificar` · `GET /api/geo/buscar?q` | Nominatim · Open-Meteo | coordenadas→nombre · nombre→coordenadas |
| `GET /api/geo/cache/estado` · `GET /api/geo/diagnostico` | MySQL | Caché · diagnóstico de cURL/SSL/tablas |
| `POST/GET/DELETE /api/geo/analisis` | MySQL | Análisis + decisiones geo, enlazado a la simulación |
| `GET /api/geo/ranking` · `GET /api/geo/ubicaciones` | MySQL | Ranking guardado · catálogo de lugares |
| `POST/GET /api/geo/comparaciones` | MySQL | Comparaciones A/B geográficas |

## Índice de idoneidad (0–100)

`idoneidad = 100 · (0,7 · media ponderada + 0,3 · factor más limitante)` (igual que el estrés global de la P05).

| Variable | Fuente | Peso |
|---|---|---|
| Frío de vernalización (días efectivos / requerimiento; usa `eficaciaFrio()` de la P05) | NASA POWER | 25 % |
| Registros GBIF en el radio (escala log; 200 = 1) | GBIF | 20 % |
| Precipitación anual (rango de la especie + aridez P/ET0) | NASA POWER | 15 % |
| Temperatura media anual | NASA POWER | 10 % |
| Calor en floración (primavera vs 21 °C) | NASA POWER | 10 % |
| pH del suelo | SoilGrids | 10 % |
| Luz en floración (radiación vs cielo despejado) | NASA POWER | 5 % |
| Textura / drenaje (arcilla) | SoilGrids | 5 % |

Si una fuente falla, los pesos se **renormalizan** y el panel muestra la *cobertura de datos*. Clases: ≥80 Óptima · ≥60 Buena · ≥40 Marginal · <40 No apta. Los rangos por especie (`t_anual_*`, `precip_*`, `ph_*`, `arcilla_max`) son **parámetros de simulación** de la tabla `especies`, no constantes biológicas universales.

## Reglas geo-agronómicas (se guardan en `decisiones`)

| Código | Umbral | Recomendación |
|---|---|---|
| `GEO_RIEGO` (crítica) | lluvia anual < 400 mm | Riego suplementario obligatorio |
| `GEO_CALOR_MEDIO` (crítica) | T media > 35 °C | Estrés térmico severo, variedad resistente |
| `GEO_FRIO` (alta) | frío efectivo < 60 % | Bulbos pre-enfriados |
| `GEO_GBIF0` (alta) | 0 registros en el radio | Especie no reportada, alto riesgo |
| `GEO_ARCILLA` (alta) | arcilla > máx. de la especie | Mejorar drenaje / especie que tolera más humedad |
| `GEO_PH_ACIDO` (media) | pH < 5,5 | Encalar antes de sembrar |
| `GEO_RAD` (media) | radiación > 25 MJ/m²/día | Sombra parcial |
| además | `GEO_ARIDEZ`, `GEO_CALOR_FLOR`, `GEO_PH_ALC`, `GEO_MO`, `GEO_GBIF_BAJO`, `GEO_OK` | |

## Del clima real al simulador

`geo.parametrosSim()` convierte 12 promedios mensuales en una **serie diaria** (interpolación lineal circular, `modelos.interpMensual`): **temperatura** ← T2M; **humedad del sustrato** ← lluvia/ET0 (Hargreaves radiativo) + retención por arcilla; **luz** ← radiación / cielo despejado (FAO-56); **nutrientes** ← carbono orgánico y pH. Siembra en otoño local, con opciones de **bulbo pre-enfriado** e **invernadero** (el termostato de la P05 manda sobre la temperatura). El motor es el de la P05; solo cambió de dónde salen T, agua y luz.

## Pruebas

```bash
npm test   # 12 pruebas de la lógica pura (proyección, clima, idoneidad, reglas, simulación, A/B)
```
Los climas de `test/geo.test.mjs` son **valores aproximados escritos a mano** para probar sin red; no son datos de NASA ni se guardan en la base. La interfaz completa (clic → panel → A/B → ranking → simular → guardar) también se probó en un navegador sin cabeza con el 3D y las APIs simulados.

### Lo que NO se pudo comprobar al construirlo (hazlo tú)

El entorno donde se escribió no tenía PHP, MySQL ni internet: **el PHP y el SQL solo se revisaron de forma estática y las APIs reales no se llamaron**. Antes de entregar:
1. Corre `probar_apis.sh`; todo debe dar HTTP 200 y `/geo/diagnostico` sin `false`.
2. Confirma que los parámetros de NASA POWER (`T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN,RH2M`) son válidos; si alguno falla, quítalo de `Geo::specNasa` (solo los tres primeros de energía/lluvia/T2M son imprescindibles).
3. SoilGrids limita ~5 consultas/min y a veces da 5xx: la app sigue sin suelo y marca la fuente en rojo. Usa `precargar.php` antes de la demo.
4. Toma las 4 capturas (`capturas/LEEME.md`) con datos reales.

## Seguridad

Lista blanca de hosts + solo HTTPS en cURL (anti-SSRF) · el navegador nunca recibe URLs ni claves · claves solo por entorno o `config.local.php` (ignorado por git) · la clave de caché es el hash de la URL **pública** · PDO preparado + validación de rangos · CORS con lista blanca · salida HTML escapada en el cliente.
