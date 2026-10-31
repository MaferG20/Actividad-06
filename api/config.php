<?php
// Configuración del backend. Los SECRETOS (API keys, clave de MySQL) NUNCA van en el frontend ni en git:
// se leen de variables de entorno o de api/config.local.php (ignorado por .gitignore; ver config.local.php.ejemplo).
$base = [
    'db' => [
        'host'    => getenv('P06_DB_HOST') ?: '127.0.0.1',
        'port'    => getenv('P06_DB_PORT') ?: '3306',
        'name'    => getenv('P06_DB_NAME') ?: 'practica06_geovisualizacion',
        'user'    => getenv('P06_DB_USER') ?: 'root',
        'pass'    => getenv('P06_DB_PASS') ?: '',
        'charset' => 'utf8mb4',
    ],
    // Orígenes permitidos si el front se sirve desde otro puerto (Live Server). Mismo origen no necesita CORS.
    'cors_origins' => ['http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:5501', 'http://127.0.0.1:5501', 'http://localhost:8080'],

    'http' => [
        // Nominatim (OSM) EXIGE un User-Agent que identifique tu app: pon tu correo real aquí o en P06_USER_AGENT
        'user_agent' => getenv('P06_USER_AGENT') ?: 'Practica06-ObservatorioCultivos/1.0 (uso academico; contacto: tu-correo@ejemplo.com)',
        // En XAMPP/Windows, si cURL da "error 60: SSL certificate problem", descarga https://curl.se/ca/cacert.pem
        // y apunta aquí (o en P06_CACERT) a su ruta, p. ej. C:/xampp/php/extras/ssl/cacert.pem
        'cacert'        => getenv('P06_CACERT') ?: null,
        'timeout'       => 15,
        'timeout_suelo' => 25,   // SoilGrids es lento
    ],

    // Tiempo de vida de la caché en MySQL (segundos), según qué tan rápido cambia el dato
    'ttl' => [
        'nasa_power'  => 30 * 86400,   // climatología multianual: casi no cambia
        'soilgrids'   => 90 * 86400,   // propiedades del suelo: estáticas
        'gbif_match'  => 90 * 86400,   // taxonKey de una especie
        'gbif_conteo' => 86400,        // GBIF suma registros a diario
        'gbif_puntos' => 7 * 86400,
        'open_meteo'  => 900,          // clima "ahora": 15 min
        'nominatim'   => 30 * 86400,   // nombre del lugar
        'error'       => 120,          // caché NEGATIVA: si una API falla, no se vuelve a llamar por 2 min
    ],

    // Claves de APIs que las requieran. Ninguna de las 5 fuentes usadas obliga a tener key, pero el proxy ya
    // sabe inyectarla en el servidor (Open-Meteo comercial). Se leen de variables de entorno o config.local.php.
    'claves' => [
        'open_meteo' => getenv('P06_OPENMETEO_KEY') ?: null,
    ],

    'gbif' => ['radio_km' => 250, 'puntos_por_pagina' => 300, 'paginas' => 3],
];
$local = __DIR__ . '/config.local.php';
return is_file($local) ? array_replace_recursive($base, require $local) : $base;
