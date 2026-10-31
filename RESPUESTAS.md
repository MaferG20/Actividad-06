# Respuestas · Práctica 06 · Observatorio Global de Cultivos

> Repaso antes de entregar: ajusta con tus propios resultados reales (números, capturas) y asegúrate de poder explicar cada parte.

## 1. ¿Qué APIs integré y por qué?
| API | Datos | Por qué |
|---|---|---|
| **NASA POWER** | Climatología mensual: temperatura (T2M), lluvia (PRECTOTCORR), radiación solar (ALLSKY_SFC_SW_DWN), humedad | Cobertura global, sin registro, hecha para agroclimatología. De aquí sale la serie que mueve el simulador. |
| **SoilGrids (ISRIC)** | pH, arcilla, arena, limo y carbono orgánico 0–30 cm a 250 m | Es la única fuente global de suelo a esa resolución; define textura, drenaje y nutrientes. |
| **GBIF** | Registros de ocurrencia de cada especie (conteo por radio, conteo mundial, puntos) | Es la evidencia real de dónde se ha observado la especie. |
| **Open-Meteo** | Clima actual, suelo superficial, ET0 y pronóstico; geocodificación por nombre | Sin API key; da el «ahora» y el buscador de lugares. |
| **Nominatim (OSM)** | Coordenadas → nombre del lugar | La API de geocodificación de Open-Meteo solo busca nombre→coordenadas, no hace el camino inverso; por eso usé Nominatim para eso. |

## 2. Proxy PHP y flujo
`frontend → fetch → FlightPHP (/api/geo/punto) → Geo → Proxy::pedir → ¿está en MySQL (cache_api) y vigente? → sí: JSON guardado · no: cURL (varias a la vez con curl_multi) → API externa → se guarda en cache_api → Normalizar → JSON simple → frontend`.

El navegador solo envía `lat/lon/especie_id`; **nunca recibe URLs ni claves**. Las claves (si una API la exigiera, p. ej. Open-Meteo comercial) se leen de variables de entorno o de `config.local.php` (fuera de git) y se inyectan en `url_real`, que nunca se guarda ni se devuelve; la clave de caché es el SHA-256 de la URL *pública*. Además el proxy solo permite HTTPS y una lista blanca de hosts, así nadie puede usarlo para llamar a otros destinos (SSRF). Ninguna de mis 5 fuentes obliga a tener key, pero el mecanismo quedó listo.

## 3. ¿Cómo construí el globo?
**Desde cero** con Three.js (sin three-globe): una `SphereGeometry` con textura equirectangular, cuadrícula de meridianos/paralelos, atmósfera con shader de Fresnel y estrellas. Convención de proyección (igual al mapeo UV de `SphereGeometry`):

`x = r·cos(lat)·cos(lon)`  `y = r·sin(lat)`  `z = −r·cos(lat)·sin(lon)` (lon 0 → +X, polo norte → +Y).

La inversa, para el clic, es `lat = asin(y/r)`, `lon = atan2(−z, x)`. Hay una prueba unitaria que comprueba la ida y vuelta.

## 4. ¿Cómo georreferencié marcadores y ocurrencias GBIF?
Cada (lat, lon) pasa por `latLonAVec3`. Las ocurrencias (cientos de puntos) van en **un solo `THREE.Points`** a radio 1,004·R, así es 1 llamada de dibujo y la esfera las oculta cuando están al otro lado. Los pines A/B se colocan en la superficie y se orientan con un cuaternión (`setFromUnitVectors(Y, normal)`) para que «salgan» perpendiculares. Los marcadores de ubicaciones son mallas con `userData`; el clic usa *raycasting* (marcadores primero, luego la esfera → `vec3ALatLon`). El arco A–B es una curva de Bézier cuadrática elevada según el ángulo entre los puntos.

## 5. Índice de idoneidad
`100·(0,7·media ponderada + 0,3·factor más limitante)`, con pesos: frío de vernalización 25 %, registros GBIF 20 %, lluvia/aridez 15 %, temperatura anual 10 %, calor en floración 10 %, pH 10 %, luz 5 %, textura 5 %. Cada variable se convierte a 0–1 comparándola con el rango de la especie (tabla `especies`). La parte del «más limitante» sigue la ley del mínimo: un lugar sin frío suficiente no puede ser «bueno» aunque el resto sea perfecto. Si falta una fuente, se renormalizan los pesos y se muestra la cobertura.

## 6. Reglas geo-agronómicas (ejemplos)
1. **Lluvia anual < 400 mm** → crítica: «Riego suplementario obligatorio».
2. **pH < 5,5** → media: «Suelo ácido, encalar antes de sembrar».
3. **0 registros GBIF en el radio** → alta: «Especie no reportada en esta región, alto riesgo».
4. Frío efectivo < 60 % del requerimiento → «Usar bulbos pre-enfriados».
5. Arcilla > máximo de la especie → «Mejorar drenaje o probar la especie que más humedad tolera».
Se calculan en `js/geo.js` y se guardan en la tabla `decisiones` ligadas al análisis (`analisis_id`).

## 7. Caché
Tabla `cache_api` (clave = SHA-256 de la URL pública, cuerpo JSON, `expira_en`, `aciertos`). Vigencias: NASA POWER 30 días, SoilGrids 90 días, GBIF 1 día (conteos) y 7 días (puntos), Open-Meteo 15 min, nombre del lugar 30 días. Además: las coordenadas se redondean (NASA a 0,25°, suelo y clima a 2 decimales) para que clics cercanos compartan caché; URLs repetidas en una misma petición se descargan una sola vez; y hay **caché negativa de 2 min** si una API falla o responde 429, para no martillarla. La página «🗄 Caché de APIs» muestra entradas y aciertos.

## 8. Simulación con datos reales
Clic → `/geo/punto` → `derivarClima` (ET0, aridez, luz) → «▶ Simular aquí» → `parametrosSim` construye `p.serie` (T, humedad y luz mensuales) + nutrientes del suelo → el laboratorio 3D de la P05 reinicia con esos parámetros y, cada día, `modelos.avanzarDia` interpola la serie para el día del año. Al guardar se crea la simulación (`/simulaciones`) y el análisis (`/geo/analisis`) enlazado con `simulacion_id`.

## 9. Comparador A/B
Fijo dos puntos (A y B) para la misma especie y corro **el ciclo completo de cada uno sin interfaz** con su clima real. Comparo idoneidad, frío efectivo, T media, lluvia, pH, arcilla, registros GBIF, biomasa final, días a floración, estrés medio y aborto. El ganador sale de un puntaje final = **60 % desempeño simulado** (50 % biomasa + 30 % rapidez + 20 % bajo estrés, el comparador de la P05) **+ 40 % idoneidad/100**; si la diferencia es < 0,02 se declara empate. Se puede repetir con bulbos pre-enfriados o invernadero, y se guarda en `comparaciones_geo`.

## 10. Dificultades
- El motor de la P05 usaba constantes: lo extendí con una **serie mensual** interpolada por día (sin saltos en el cambio de año) sin romper los resultados anteriores (el seed antiguo da lo mismo).
- **Unidades**: la luz del simulador es «% de luz solar»; usé radiación / radiación de cielo despejado (FAO-56). La humedad del sustrato la estimé desde lluvia/ET0 (Hargreaves).
- **SoilGrids** devuelve valores escalados (`d_factor`), a veces no responde y tiene límite de uso → degradación elegante (sin suelo) + caché + precarga.
- NASA marca vacíos con `-999`: la serie con huecos se descarta.
- GBIF limita `offset+limit` a 100 000 y refleja *esfuerzo de observación*, no distribución natural; lo tomo como evidencia, con peso de 20 %.
- MySQL no permite `CHECK` sobre columnas con claves foráneas con acciones, así que la regla «la decisión es de una simulación o de un análisis» se valida en la aplicación.
- Un campo `DECIMAL(8,2)` desbordaba con millones de registros GBIF: se acota el valor antes de guardar.

## 11. Valor del mapa 3D frente a un formulario
El globo hace obvia la **relación espacial**: ver dónde está realmente la especie (GBIF), cuán lejos están A y B, cómo cambian clima y suelo con la latitud y la altitud. Es realmente útil para explorar sin saber las coordenadas, comparar regiones y elegir sitios candidatos; un formulario es mejor cuando ya tienes la coordenada exacta. Por eso cada marcador lleva a una acción (consultar, simular, comparar).

## 12. Conectar IoT en tiempo real y satélite (NDVI, Sentinel-2)
Sensores (humedad, temperatura del suelo) publicarían por MQTT/HTTP a un endpoint del servidor que guarde lecturas en una tabla de series temporales; el simulador usaría esa lectura real en lugar de la serie climática (asimilación de datos: se corrige el estado simulado con la medición). Para NDVI: pedir a un servicio STAC/Sentinel Hub o Google Earth Engine el índice por parcela y fecha (mismo proxy y caché), guardarlo y comparar NDVI observado vs biomasa simulada para detectar estrés que el modelo no vio; en el globo, como una capa de tiles sobre la esfera.

## 13. Escalar a miles de ubicaciones
Una **cola de trabajos** (Redis/RabbitMQ) con **workers** que consuman las ubicaciones; limitador de tasa por proveedor (SoilGrids ≈ 5/min); caché distribuida (Redis) delante de MySQL y rejilla de coordenadas para compartir resultados entre puntos cercanos; peticiones por lotes (NASA POWER y Open-Meteo admiten varios puntos) y descargas masivas offline (rásteres de SoilGrids, GBIF downloads) en vez de punto a punto; el frontend recibiría resultados por polling/WebSocket. `api/tools/precargar.php` es la versión mínima de un worker.

## 14. Decisiones que antes no se podían tomar
En la P05 el clima era un parámetro que el usuario inventaba. Ahora un agrónomo puede **elegir dónde sembrar** con evidencia (idoneidad, frío disponible, suelo, registros de la especie), decidir si necesita **riego, encalado, drenaje, sombra o bulbo pre-enfriado**, comparar dos fincas o regiones antes de invertir, **elegir qué especie del catálogo** encaja mejor en un sitio y ajustar la **fecha de siembra** según el clima real del hemisferio. Un investigador obtiene un ranking reproducible y guardado en MySQL.
