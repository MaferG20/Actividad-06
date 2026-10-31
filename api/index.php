<?php
declare(strict_types=1);

// ---------- Enrutado SIN depender de mod_rewrite / .htaccess ----------
// Muchos servidores (Apache con AllowOverride None, mod_rewrite apagado, Nginx) devuelven 404 para /api/especies porque nunca llega
// a este archivo. Por eso la API también se puede llamar de estas 3 formas equivalentes (el frontend elige la que funcione):
//   /api/geo/punto?lat=..          (bonita: requiere mod_rewrite + .htaccess)
//   /api/index.php/geo/punto?lat=..  (PATH_INFO: funciona en cualquier Apache/PHP)
//   /api/index.php?_ruta=/geo/punto&lat=..  (cadena de consulta: funciona en cualquier servidor)
// Debe ejecutarse ANTES de que Flight lea REQUEST_URI (Flight::set() ya inicializa el motor).
(function (): void {
    $uri = $_SERVER['REQUEST_URI'] ?? '/';
    $base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    if (isset($_GET['_ruta']) && is_string($_GET['_ruta']) && str_starts_with($_GET['_ruta'], '/')) {
        $resto = $_GET; unset($resto['_ruta']);
        $uri = $base . $_GET['_ruta'] . ($resto ? '?' . http_build_query($resto) : '');
        $_SERVER['QUERY_STRING'] = http_build_query($resto);
        $_GET = $resto;
    }
    $uri = preg_replace('#/index\.php(?=/|\?|$)#', '', $uri, 1);       // /api/index.php/x  →  /api/x
    $_SERVER['REQUEST_URI'] = $uri;
})();

if (!is_file(__DIR__ . '/vendor/autoload.php')) {   // el error más común al subir el proyecto al servidor
    http_response_code(500); header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'Falta la carpeta api/vendor: ejecuta «composer install» dentro de api/ (o sube vendor/)'], JSON_UNESCAPED_UNICODE);
    exit;
}
require __DIR__ . '/vendor/autoload.php';   // composer install  (flightphp/core)

$config = require __DIR__ . '/config.php';
Flight::set('config', $config);
foreach (['Http', 'Cache', 'Normalizar', 'Proxy', 'Geo'] as $clase) require_once __DIR__ . "/lib/$clase.php";   // P06: proxy de APIs públicas

// ---------- CORS controlado (lista blanca) ----------
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin && (in_array($origin, $config['cors_origins'], true) || preg_match('#^https?://(localhost|127\.0\.0\.1)(:\d+)?$#', $origin))) {   // Live Server en cualquier puerto + lista blanca
    header("Access-Control-Allow-Origin: $origin");
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
header('X-Content-Type-Options: nosniff');

// ---------- Conexión PDO (sentencias preparadas reales, errores como excepciones) ----------
Flight::register('db', PDO::class, [
    sprintf('mysql:host=%s;port=%s;dbname=%s;charset=%s', $config['db']['host'], $config['db']['port'], $config['db']['name'], $config['db']['charset']),
    $config['db']['user'], $config['db']['pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false],
]);

// ---------- Utilidades ----------
const MODELOS = ['lineal', 'exponencial', 'logistico', 'gompertz'];
const SEVERIDADES = ['critica', 'alta', 'media', 'info', 'ok'];

// OJO: en Flight 3 Flight::json() solo deja el cuerpo en un búfer que se envía al final de la ruta; un exit justo después lo pierde
// (respuesta vacía con código 200). Por eso aquí se escribe la respuesta directamente antes de salir.
function fallo(int $code, string $msg): never {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function cuerpo(): array {
    $d = json_decode(Flight::request()->getBody(), true);
    if (!is_array($d)) fallo(400, 'Cuerpo JSON inválido');
    return $d;
}
function num(array $a, string $k, float $min, float $max, ?float $def = null): float {
    $v = $a[$k] ?? $def;
    if ($v === null || !is_numeric($v)) fallo(422, "Campo '$k' numérico requerido");
    $v = (float)$v;
    if ($v < $min || $v > $max) fallo(422, "Campo '$k' fuera de rango ($min–$max)");
    return $v;
}
function texto(array $a, string $k, int $max, bool $req = true): ?string {
    $v = isset($a[$k]) ? trim((string)$a[$k]) : '';
    if ($v === '') { if ($req) fallo(422, "Campo '$k' requerido"); return null; }
    return mb_substr($v, 0, $max);
}
// --- P06: validación de entradas para las rutas /geo ---
function coord(string $k, float $min, float $max): float {
    $v = Flight::request()->query[$k] ?? null;
    if ($v === null || !is_numeric($v)) fallo(422, "Parámetro '$k' numérico requerido");
    $v = (float)$v;
    if ($v < $min || $v > $max) fallo(422, "Parámetro '$k' fuera de rango ($min a $max)");
    return $v;
}
function numn(array $a, string $k, float $min, float $max): ?float {   // numérico OPCIONAL (null si falta)
    $v = $a[$k] ?? null;
    if ($v === null || $v === '') return null;
    if (!is_numeric($v)) fallo(422, "Campo '$k' debe ser numérico");
    $v = (float)$v;
    if ($v < $min || $v > $max) fallo(422, "Campo '$k' fuera de rango ($min–$max)");
    return $v;
}
function entn(array $a, string $k): ?int { return isset($a[$k]) && is_numeric($a[$k]) && $a[$k] >= 0 ? (int)$a[$k] : null; }
function jsonTxt(mixed $v, int $max = 6000): ?string {
    if (!is_array($v)) return null;
    $s = json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return $s !== false && strlen($s) <= $max ? $s : null;
}
function geo(): Geo { static $g = null; return $g ??= new Geo(Flight::db(), Flight::get('config')); }
function especiePorId(int $id): array {
    $st = Flight::db()->prepare('SELECT * FROM especies WHERE id = ?'); $st->execute([$id]);
    return $st->fetch() ?: fallo(404, 'Especie no encontrada');
}

function entero(mixed $v, int $def, int $min, int $max): int { return max($min, min($max, is_numeric($v) ? (int)$v : $def)); }

// ---------- Manejo global de errores (sin filtrar detalles internos) ----------
Flight::map('error', function (Throwable $e) {
    error_log($e->getMessage());
    // Mensaje útil pero sin detalles internos (ni usuario/clave/host): solo la CATEGORÍA del fallo
    $msg = $e instanceof PDOException
        ? 'No se pudo usar MySQL (¿servicio apagado, base practica06_geovisualizacion sin importar o usuario/clave en api/config.local.php?)'
        : 'Error interno del servidor';
    Flight::json(['ok' => false, 'error' => $msg], 500);
});
Flight::map('notFound', fn() => Flight::json(['ok' => false, 'error' => 'Ruta no encontrada'], 404));

// ======================= RUTAS =======================
// Sin base de datos ni red: sirve para que el frontend descubra qué forma de URL acepta el servidor
Flight::route('GET /ping', fn() => Flight::json(['ok' => true, 'ping' => true, 'php' => PHP_VERSION]));

Flight::route('GET /health', function () {
    Flight::db()->query('SELECT 1');
    Flight::json(['ok' => true, 'db' => 'conectada', 'hora' => date('c')]);
});

// --- Catálogo de especies ---
Flight::route('GET /especies', function () {
    Flight::json(['ok' => true, 'data' => Flight::db()->query('SELECT * FROM especies ORDER BY id')->fetchAll()]);
});
Flight::route('GET /especies/@id:[0-9]+', function ($id) {
    $st = Flight::db()->prepare('SELECT * FROM especies WHERE id = ?'); $st->execute([(int)$id]);
    $r = $st->fetch(); if (!$r) fallo(404, 'Especie no encontrada');
    Flight::json(['ok' => true, 'data' => $r]);
});

// --- Simulaciones ---
Flight::route('GET /simulaciones', function () {
    $q = Flight::request()->query;
    $limite = entero($q['limite'] ?? 50, 50, 1, 200);
    $sql = 'SELECT s.*, e.nombre_cientifico, e.nombre_comun FROM simulaciones s JOIN especies e ON e.id = s.especie_id';
    $args = [];
    if (!empty($q['especie_id']) && is_numeric($q['especie_id'])) { $sql .= ' WHERE s.especie_id = ?'; $args[] = (int)$q['especie_id']; }
    $sql .= ' ORDER BY s.id DESC LIMIT ' . $limite;   // $limite ya es entero acotado
    $st = Flight::db()->prepare($sql); $st->execute($args);
    Flight::json(['ok' => true, 'data' => $st->fetchAll()]);
});
Flight::route('GET /simulaciones/@id:[0-9]+', function ($id) {
    $db = Flight::db();
    $st = $db->prepare('SELECT s.*, e.nombre_cientifico FROM simulaciones s JOIN especies e ON e.id = s.especie_id WHERE s.id = ?');
    $st->execute([(int)$id]); $sim = $st->fetch(); if (!$sim) fallo(404, 'Simulación no encontrada');
    $m = $db->prepare('SELECT * FROM mediciones WHERE simulacion_id = ? ORDER BY dia'); $m->execute([(int)$id]);
    $d = $db->prepare('SELECT * FROM decisiones WHERE simulacion_id = ? ORDER BY dia'); $d->execute([(int)$id]);
    Flight::json(['ok' => true, 'data' => $sim + ['mediciones' => $m->fetchAll(), 'decisiones' => $d->fetchAll()]]);
});
Flight::route('POST /simulaciones', function () {
    $b = cuerpo(); $db = Flight::db();
    $modelo = (string)($b['modelo'] ?? '');
    if (!in_array($modelo, MODELOS, true)) fallo(422, 'Modelo no válido');
    $esp = $db->prepare('SELECT id FROM especies WHERE id = ?'); $esp->execute([(int)($b['especie_id'] ?? 0)]);
    if (!$esp->fetch()) fallo(422, 'Especie inexistente');
    $meds = is_array($b['mediciones'] ?? null) ? array_slice($b['mediciones'], 0, 1500) : [];
    $decs = is_array($b['decisiones'] ?? null) ? array_slice($b['decisiones'], 0, 200) : [];

    $db->beginTransaction();
    try {
        $ins = $db->prepare('INSERT INTO simulaciones (especie_id,nombre,notas,modelo,luz,agua,temp,nutr,co2,r,k,termostato,escenario,biomasa_final,altura_final,dias_madurez,dias_totales,estres_medio,aborto)
                             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        $ins->execute([
            (int)$b['especie_id'], texto($b, 'nombre', 100), texto($b, 'notas', 1000, false), $modelo,
            num($b, 'luz', 0, 100), num($b, 'agua', 0, 100), num($b, 'temp', -10, 45), num($b, 'nutr', 0, 100), (int)num($b, 'co2', 200, 2000, 420),
            num($b, 'r', 0.001, 1), num($b, 'k', 0.1, 1000), empty($b['termostato']) ? 0 : 1, in_array($b['escenario'] ?? 'A', ['A', 'B'], true) ? $b['escenario'] : 'A',
            num($b, 'biomasa_final', 0, 100000, 0), num($b, 'altura_final', 0, 1000, 0),
            isset($b['dias_madurez']) && is_numeric($b['dias_madurez']) ? (int)$b['dias_madurez'] : null,
            (int)num($b, 'dias_totales', 0, 5000, 0), num($b, 'estres_medio', 0, 100, 0), empty($b['aborto']) ? 0 : 1,
        ]);
        $sid = (int)$db->lastInsertId();

        $im = $db->prepare('INSERT INTO mediciones (simulacion_id,dia,fase,biomasa,altura,hojas,bulbillos,icr,estres_hidrico,estres_termico,estres_luminico,estres_nutricional,estres_global,frio_acum,salud_bulbo,temp,agua,luz,nutr)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE biomasa = VALUES(biomasa)');
        foreach ($meds as $m) {
            if (!is_array($m)) continue;
            $im->execute([$sid, (int)num($m, 'dia', 0, 5000), (int)num($m, 'fase', 0, 6), num($m, 'biomasa', 0, 100000), num($m, 'altura', 0, 1000),
                (int)num($m, 'hojas', 0, 255, 0), (int)num($m, 'bulbillos', 0, 255, 0), num($m, 'icr', -10, 10, 0),
                num($m, 'estres_hidrico', 0, 100, 0), num($m, 'estres_termico', 0, 100, 0), num($m, 'estres_luminico', 0, 100, 0), num($m, 'estres_nutricional', 0, 100, 0), num($m, 'estres_global', 0, 100, 0),
                num($m, 'frio_acum', 0, 100, 0), num($m, 'salud_bulbo', 0, 100, 100), num($m, 'temp', -10, 45, 0), num($m, 'agua', 0, 100, 0), num($m, 'luz', 0, 100, 0), num($m, 'nutr', 0, 100, 0)]);
        }
        $id_ = $db->prepare('INSERT INTO decisiones (simulacion_id,dia,codigo,severidad,titulo,detalle,umbral,valor) VALUES (?,?,?,?,?,?,?,?)');
        foreach ($decs as $d) {
            if (!is_array($d) || !in_array($d['severidad'] ?? '', SEVERIDADES, true)) continue;
            $id_->execute([$sid, (int)num($d, 'dia', 0, 5000, 0), texto($d, 'codigo', 30), $d['severidad'], texto($d, 'titulo', 120), texto($d, 'detalle', 255, false), texto($d, 'umbral', 60, false), isset($d['valor']) && is_numeric($d['valor']) ? (float)$d['valor'] : null]);
        }
        $db->commit();
    } catch (Throwable $e) { $db->rollBack(); throw $e; }
    Flight::json(['ok' => true, 'id' => $sid], 201);
});
Flight::route('DELETE /simulaciones/@id:[0-9]+', function ($id) {
    $st = Flight::db()->prepare('DELETE FROM simulaciones WHERE id = ?'); $st->execute([(int)$id]);
    if (!$st->rowCount()) fallo(404, 'Simulación no encontrada');
    Flight::json(['ok' => true]);
});
Flight::route('GET /simulaciones/@id:[0-9]+/csv', function ($id) {
    $st = Flight::db()->prepare('SELECT dia,fase,biomasa,altura,hojas,bulbillos,icr,estres_hidrico,estres_termico,estres_luminico,estres_nutricional,estres_global,frio_acum,salud_bulbo,temp,agua,luz,nutr FROM mediciones WHERE simulacion_id = ? ORDER BY dia');
    $st->execute([(int)$id]); $filas = $st->fetchAll();
    header('Content-Type: text/csv; charset=utf-8'); header("Content-Disposition: attachment; filename=simulacion_$id.csv");
    $out = fopen('php://output', 'w'); fwrite($out, "\xEF\xBB\xBF");
    if ($filas) { fputcsv($out, array_keys($filas[0])); foreach ($filas as $f) fputcsv($out, $f); }
    fclose($out);
});

// --- Comparaciones A/B ---
Flight::route('POST /comparaciones', function () {
    $b = cuerpo();
    if (!in_array($b['ganador'] ?? '', ['A', 'B', 'empate'], true)) fallo(422, 'Ganador no válido');
    $st = Flight::db()->prepare('INSERT INTO comparaciones_ab (sim_a_id,sim_b_id,ganador,puntaje_a,puntaje_b) VALUES (?,?,?,?,?)');
    try { $st->execute([(int)($b['sim_a_id'] ?? 0), (int)($b['sim_b_id'] ?? 0), $b['ganador'], num($b, 'puntaje_a', -10, 10), num($b, 'puntaje_b', -10, 10)]); }
    catch (PDOException $e) { fallo(422, 'Simulaciones A/B inexistentes'); }
    Flight::json(['ok' => true, 'id' => (int)Flight::db()->lastInsertId()], 201);
});
Flight::route('GET /comparaciones', function () {
    Flight::json(['ok' => true, 'data' => Flight::db()->query('SELECT c.*, a.nombre AS nombre_a, b.nombre AS nombre_b FROM comparaciones_ab c JOIN simulaciones a ON a.id=c.sim_a_id JOIN simulaciones b ON b.id=c.sim_b_id ORDER BY c.id DESC LIMIT 50')->fetchAll()]);
});

// --- Reportes ---
Flight::route('GET /reportes', function () {
    $db = Flight::db();
    $top = $db->query('SELECT s.id, s.nombre, e.nombre_cientifico, s.modelo, s.biomasa_final, s.dias_madurez, s.estres_medio FROM simulaciones s JOIN especies e ON e.id = s.especie_id ORDER BY s.biomasa_final DESC LIMIT 5')->fetchAll();
    // Eficiencia = biomasa final por día hasta la floración (g/día); solo corridas que llegaron a florecer
    $efi = $db->query('SELECT e.nombre_cientifico, COUNT(*) AS corridas, ROUND(AVG(s.biomasa_final),2) AS biomasa_prom, ROUND(AVG(s.dias_madurez),1) AS dias_madurez_prom,
                              ROUND(AVG(s.biomasa_final / s.dias_madurez),4) AS eficiencia_g_dia
                       FROM simulaciones s JOIN especies e ON e.id = s.especie_id WHERE s.dias_madurez IS NOT NULL AND s.dias_madurez > 0
                       GROUP BY e.id, e.nombre_cientifico ORDER BY eficiencia_g_dia DESC')->fetchAll();
    $madurez = $db->query('SELECT ROUND(AVG(dias_madurez),1) AS prom, MIN(dias_madurez) AS minimo, MAX(dias_madurez) AS maximo, COUNT(dias_madurez) AS n FROM simulaciones WHERE dias_madurez IS NOT NULL')->fetch();
    Flight::json(['ok' => true, 'top_biomasa' => $top, 'eficiencia_especies' => $efi, 'madurez' => $madurez]);
});

// ======================= P06 · PROXY GEO (APIs públicas) =======================
// El navegador solo manda lat/lon/ids. Las URL, las claves y la caché viven aquí.

// Diagnóstico para XAMPP: ¿hay cURL? ¿certificados? ¿existen las tablas nuevas?
//   ?probar=1 → además llama de verdad a cada API externa desde ESTE servidor (sin caché) y dice qué falla: sin internet, firewall, SSL…
Flight::route('GET /geo/diagnostico', function () {
    $cfg = Flight::get('config'); $tablas = []; $dbOk = false; $dbError = null;
    try {
        $db = Flight::db(); $db->query('SELECT 1'); $dbOk = true;
        foreach (['especies', 'cache_api', 'ubicaciones', 'analisis_geo', 'comparaciones_geo'] as $t) {
            try { $db->query("SELECT 1 FROM $t LIMIT 1"); $tablas[$t] = true; } catch (Throwable $e) { $tablas[$t] = false; }
        }
    } catch (Throwable $e) { $dbError = 'No conecta con MySQL (revisa servicio, nombre de la base y api/config.local.php)'; }

    $apis = null;
    if ((Flight::request()->query['probar'] ?? '') === '1' && function_exists('curl_init')) {
        Http::$cfg = $cfg['http']; $g = new Geo(null, $cfg);   // solo arma las URL: no necesita MySQL
        $sp = ['NASA POWER' => $g->specNasa(14.29, -89.9), 'Open-Meteo' => $g->specOpenMeteo(14.29, -89.9), 'SoilGrids' => $g->specSuelo(14.29, -89.9),
               'GBIF' => $g->specGbifMatch('Tulipa gesneriana'), 'Nominatim' => $g->specReverso(14.29, -89.9)];
        $req = []; foreach ($sp as $n => $s) $req[$n] = ['url' => $s['url'], 'timeout' => (int)$s['timeout']];
        $apis = [];
        foreach (Http::multi($req) as $n => $r) {
            $apis[$n] = ['ok' => $r['error'] === null && $r['status'] >= 200 && $r['status'] < 300, 'http' => $r['status'], 'ms' => $r['ms'] ?? null, 'error' => $r['error']];
        }
    }
    Flight::json(['ok' => true, 'php' => PHP_VERSION, 'curl' => function_exists('curl_init'),
        'curl_version' => function_exists('curl_version') ? (curl_version()['version'] ?? null) : null,
        'mysql' => $dbOk, 'mysql_error' => $dbError,
        'cacert_configurado' => !empty($cfg['http']['cacert']), 'user_agent_personalizado' => !str_contains($cfg['http']['user_agent'], 'tu-correo@ejemplo.com'),
        'claves_configuradas' => array_map(fn($v) => !empty($v), $cfg['claves']), 'tablas' => $tablas, 'apis' => $apis]);
});

// NASA POWER: climatología mensual (T2M, lluvia, radiación...)  →  GET /api/geo/clima?lat=14.29&lon=-89.9
Flight::route('GET /geo/clima', function () {
    $lat = coord('lat', -90, 90); $lon = coord('lon', -180, 180);
    $r = geo()->proxy()->pedir(['nasa' => geo()->specNasa($lat, $lon)]);
    $n = $r['nasa']['ok'] ? Normalizar::nasa($r['nasa']['json']) : null;
    if (!$n) fallo(502, 'NASA POWER no respondió o no tiene datos para ese punto (HTTP ' . $r['nasa']['status'] . ')');
    Flight::json(['ok' => true, 'data' => $n + ['lat' => $lat, 'lon' => $lon], 'fuentes' => Geo::meta($r)]);
});

// Open-Meteo: clima ahora, suelo superficial y pronóstico de 3 días
Flight::route('GET /geo/actual', function () {
    $lat = coord('lat', -90, 90); $lon = coord('lon', -180, 180);
    $r = geo()->proxy()->pedir(['actual' => geo()->specOpenMeteo($lat, $lon)]);
    $n = $r['actual']['ok'] ? Normalizar::openMeteo($r['actual']['json']) : null;
    if (!$n) fallo(502, 'Open-Meteo no respondió (HTTP ' . $r['actual']['status'] . ')');
    Flight::json(['ok' => true, 'data' => $n, 'fuentes' => Geo::meta($r)]);
});

// SoilGrids: pH, arcilla, arena, limo y carbono orgánico (0-30 cm). Si la API está saturada devuelve 502 y el front sigue sin suelo.
Flight::route('GET /geo/suelo', function () {
    $lat = coord('lat', -90, 90); $lon = coord('lon', -180, 180);
    $r = geo()->proxy()->pedir(['suelo' => geo()->specSuelo($lat, $lon)]);
    $n = $r['suelo']['ok'] ? Normalizar::soilgrids($r['suelo']['json']) : null;
    if (!$n) fallo(502, 'SoilGrids no respondió o no hay dato de suelo en ese punto (HTTP ' . $r['suelo']['status'] . ')');
    Flight::json(['ok' => true, 'data' => $n, 'fuentes' => Geo::meta($r)]);
});

// Geocodificación inversa (coordenadas → nombre) y búsqueda por nombre (nombre → coordenadas)
Flight::route('GET /geo/geocodificar', function () {
    $lat = coord('lat', -90, 90); $lon = coord('lon', -180, 180);
    $r = geo()->proxy()->pedir(['lugar' => geo()->specReverso($lat, $lon)]);
    $n = $r['lugar']['ok'] ? Normalizar::reverso($r['lugar']['json']) : null;
    Flight::json(['ok' => true, 'data' => $n, 'fuentes' => Geo::meta($r)]);   // null = sin nombre (océano, polo...)
});
Flight::route('GET /geo/buscar', function () {
    $q = trim((string)(Flight::request()->query['q'] ?? ''));
    if (mb_strlen($q) < 2 || mb_strlen($q) > 80) fallo(422, "Parámetro 'q' de 2 a 80 caracteres requerido");
    $r = geo()->proxy()->pedir(['b' => geo()->specBuscar($q)]);
    if (!$r['b']['ok']) fallo(502, 'Open-Meteo Geocoding no respondió');
    Flight::json(['ok' => true, 'data' => Normalizar::buscar($r['b']['json'])]);
});

// TODO de un punto en una sola llamada (4 APIs en paralelo con curl_multi) → lo que usa el clic en el globo
Flight::route('GET /geo/punto', function () {
    $lat = coord('lat', -90, 90); $lon = coord('lon', -180, 180);
    $p = geo()->punto($lat, $lon);
    if (!$p['clima'] && !$p['suelo'] && !$p['actual']) fallo(502, 'Ninguna API externa respondió: revisa conexión, certificados SSL (cacert) y /api/geo/diagnostico');
    Flight::json(['ok' => true, 'data' => $p]);
});

// GBIF: registros por especie dentro de un radio y en todo el mundo (para el índice de idoneidad y el ranking)
Flight::route('GET /geo/ocurrencias/conteos', function () {
    $q = Flight::request()->query;
    $lat = coord('lat', -90, 90); $lon = coord('lon', -180, 180);
    $radio = entero($q['radio_km'] ?? Flight::get('config')['gbif']['radio_km'], 250, 10, 2000);
    $db = Flight::db();
    if (!empty($q['especie_id']) && is_numeric($q['especie_id'])) $lista = [especiePorId((int)$q['especie_id'])];
    else $lista = $db->query('SELECT * FROM especies ORDER BY id')->fetchAll();
    $res = geo()->conteos($lista, $lat, $lon, $radio);
    Flight::json(['ok' => true, 'data' => $res['items'], 'fuentes' => $res['fuentes']]);
});
// GBIF: muestra de puntos de ocurrencia de una especie para dibujarlos en el globo
Flight::route('GET /geo/ocurrencias/mapa', function () {
    $id = entero(Flight::request()->query['especie_id'] ?? 0, 0, 0, 1000000);
    $m = geo()->mapa(especiePorId($id));
    if (!$m) fallo(502, 'GBIF no respondió o no reconoce el nombre de esta especie');
    Flight::json(['ok' => true, 'data' => $m]);
});

// Estado de la caché (para demostrar que no se excede el límite de uso de las APIs)
Flight::route('GET /geo/cache/estado', function () {
    $c = new Cache(Flight::db()); $e = $c->estado();
    Flight::json(['ok' => true, 'proveedores' => $e, 'entradas' => array_sum(array_map(fn($x) => (int)$x['entradas'], $e)), 'aciertos' => array_sum(array_map(fn($x) => (int)$x['aciertos'], $e))]);
});

// --- Ubicaciones, análisis geoespaciales y comparaciones A/B geográficas ---
Flight::route('GET /geo/ubicaciones', function () {
    Flight::json(['ok' => true, 'data' => Flight::db()->query(
        'SELECT u.*, (SELECT COUNT(*) FROM analisis_geo a WHERE a.ubicacion_id = u.id) AS analisis,
                (SELECT MAX(a.idoneidad) FROM analisis_geo a WHERE a.ubicacion_id = u.id) AS mejor_idoneidad
         FROM ubicaciones u ORDER BY u.preset DESC, u.nombre')->fetchAll()]);
});

Flight::route('POST /geo/analisis', function () {
    $b = cuerpo(); $db = Flight::db();
    $esp = $db->prepare('SELECT id FROM especies WHERE id = ?'); $esp->execute([(int)($b['especie_id'] ?? 0)]);
    if (!$esp->fetch()) fallo(422, 'Especie inexistente');
    $simId = null;
    if (!empty($b['simulacion_id'])) {
        $sq = $db->prepare('SELECT id FROM simulaciones WHERE id = ?'); $sq->execute([(int)$b['simulacion_id']]);
        if (!$sq->fetch()) fallo(422, 'Simulación inexistente');
        $simId = (int)$b['simulacion_id'];
    }
    $lat = round(num($b, 'lat', -90, 90), 3); $lon = round(num($b, 'lon', -180, 180), 3);   // 3 decimales ≈ 110 m
    $r = is_array($b['resumen'] ?? null) ? $b['resumen'] : fallo(422, "Falta 'resumen' climático");
    $i = is_array($b['idoneidad'] ?? null) ? $b['idoneidad'] : fallo(422, "Falta 'idoneidad'");
    $s = is_array($b['suelo'] ?? null) ? $b['suelo'] : [];
    $g = is_array($b['gbif'] ?? null) ? $b['gbif'] : [];
    $decs = is_array($b['decisiones'] ?? null) ? array_slice($b['decisiones'], 0, 40) : [];
    $elev = numn($b, 'elevacion_m', -500, 9000);

    $db->beginTransaction();
    try {
        $u = $db->prepare('INSERT INTO ubicaciones (nombre,pais,codigo_pais,lat,lon,elevacion_m) VALUES (?,?,?,?,?,?)
                           ON DUPLICATE KEY UPDATE nombre = IF(preset = 1, nombre, VALUES(nombre)), pais = COALESCE(VALUES(pais), pais),
                             codigo_pais = COALESCE(VALUES(codigo_pais), codigo_pais), elevacion_m = COALESCE(VALUES(elevacion_m), elevacion_m), id = LAST_INSERT_ID(id)');
        $cc = strtoupper(texto($b, 'codigo_pais', 2, false) ?? '');
        $u->execute([texto($b, 'nombre', 120), texto($b, 'pais', 80, false), $cc !== '' ? $cc : null, $lat, $lon, $elev === null ? null : (int)round($elev)]);
        $ubicId = (int)$db->lastInsertId();

        $ins = $db->prepare('INSERT INTO analisis_geo (ubicacion_id,especie_id,simulacion_id,temp_media,temp_min_mes,temp_max_mes,precip_anual,radiacion_mj,et0_anual,aridez,frio_efectivo,
                               ph,arcilla,arena,limo,carbono_org,textura,gbif_region,gbif_radio_km,gbif_total,idoneidad,clase,factor_limitante,detalle,fuentes,notas)
                             VALUES (' . implode(',', array_fill(0, 26, '?')) . ')');
        $ins->execute([$ubicId, (int)$b['especie_id'], $simId,
            num($r, 'temp_media', -60, 60), num($r, 'temp_min_mes', -80, 60), num($r, 'temp_max_mes', -60, 70),
            num($r, 'precip_anual', 0, 20000), num($r, 'radiacion_mj', 0, 45), numn($r, 'et0_anual', 0, 10000), numn($r, 'aridez', 0, 100), numn($r, 'frio_efectivo', 0, 400),
            numn($s, 'ph', 0, 14), numn($s, 'arcilla', 0, 100), numn($s, 'arena', 0, 100), numn($s, 'limo', 0, 100), numn($s, 'carbono', 0, 1000), texto($s, 'textura', 40, false),
            entn($g, 'region'), entn($g, 'radio_km'), entn($g, 'total'),
            num($i, 'puntaje', 0, 100), texto($i, 'clase', 10), texto($i, 'factor_limitante', 20, false),
            jsonTxt($i['detalle'] ?? null), jsonTxt($b['fuentes'] ?? null), texto($b, 'notas', 1000, false)]);
        $aid = (int)$db->lastInsertId();

        $di = $db->prepare('INSERT INTO decisiones (analisis_id,dia,codigo,severidad,titulo,detalle,umbral,valor) VALUES (?,?,?,?,?,?,?,?)');
        foreach ($decs as $d) {
            if (!is_array($d) || !in_array($d['severidad'] ?? '', SEVERIDADES, true)) continue;
            $v = isset($d['valor']) && is_numeric($d['valor']) ? max(-999999.0, min(999999.0, (float)$d['valor'])) : null;   // DECIMAL(8,2)
            $di->execute([$aid, 0, texto($d, 'codigo', 30), $d['severidad'], texto($d, 'titulo', 120), texto($d, 'detalle', 255, false), texto($d, 'umbral', 60, false), $v]);
        }
        $db->commit();
    } catch (Throwable $e) { $db->rollBack(); throw $e; }
    Flight::json(['ok' => true, 'id' => $aid, 'ubicacion_id' => $ubicId], 201);
});

Flight::route('GET /geo/analisis', function () {
    $q = Flight::request()->query;
    $sql = 'SELECT a.id, a.creada_en, a.idoneidad, a.clase, a.simulacion_id, a.especie_id, e.nombre_cientifico, u.nombre, u.pais, u.lat, u.lon
            FROM analisis_geo a JOIN especies e ON e.id = a.especie_id JOIN ubicaciones u ON u.id = a.ubicacion_id';
    $args = [];
    if (!empty($q['especie_id']) && is_numeric($q['especie_id'])) { $sql .= ' WHERE a.especie_id = ?'; $args[] = (int)$q['especie_id']; }
    $sql .= ' ORDER BY a.id DESC LIMIT ' . entero($q['limite'] ?? 50, 50, 1, 200);
    $st = Flight::db()->prepare($sql); $st->execute($args);
    Flight::json(['ok' => true, 'data' => $st->fetchAll()]);
});
Flight::route('GET /geo/analisis/@id:[0-9]+', function ($id) {
    $db = Flight::db();
    $st = $db->prepare('SELECT a.*, e.nombre_cientifico, u.nombre, u.pais, u.lat, u.lon FROM analisis_geo a JOIN especies e ON e.id = a.especie_id JOIN ubicaciones u ON u.id = a.ubicacion_id WHERE a.id = ?');
    $st->execute([(int)$id]); $a = $st->fetch(); if (!$a) fallo(404, 'Análisis no encontrado');
    $d = $db->prepare('SELECT * FROM decisiones WHERE analisis_id = ? ORDER BY FIELD(severidad, "critica","alta","media","info","ok"), id'); $d->execute([(int)$id]);
    Flight::json(['ok' => true, 'data' => $a + ['decisiones' => $d->fetchAll()]]);
});
Flight::route('DELETE /geo/analisis/@id:[0-9]+', function ($id) {
    $st = Flight::db()->prepare('DELETE FROM analisis_geo WHERE id = ?'); $st->execute([(int)$id]);
    if (!$st->rowCount()) fallo(404, 'Análisis no encontrado');
    Flight::json(['ok' => true]);
});

// Ranking GUARDADO de idoneidad de una especie: el análisis más reciente de cada ubicación
Flight::route('GET /geo/ranking', function () {
    $id = entero(Flight::request()->query['especie_id'] ?? 0, 0, 0, 1000000);
    $st = Flight::db()->prepare('SELECT a.id, a.idoneidad, a.clase, a.factor_limitante, a.temp_media, a.precip_anual, a.frio_efectivo, a.ph, a.gbif_region, a.simulacion_id, a.creada_en, u.nombre, u.pais, u.lat, u.lon
        FROM analisis_geo a JOIN ubicaciones u ON u.id = a.ubicacion_id
        WHERE a.especie_id = ? AND a.id = (SELECT MAX(a2.id) FROM analisis_geo a2 WHERE a2.ubicacion_id = a.ubicacion_id AND a2.especie_id = a.especie_id)
        ORDER BY a.idoneidad DESC LIMIT 50');
    $st->execute([$id]);
    Flight::json(['ok' => true, 'data' => $st->fetchAll()]);
});

Flight::route('POST /geo/comparaciones', function () {
    $b = cuerpo();
    if (!in_array($b['ganador'] ?? '', ['A', 'B', 'empate'], true)) fallo(422, 'Ganador no válido');
    $st = Flight::db()->prepare('INSERT INTO comparaciones_geo (especie_id,analisis_a_id,analisis_b_id,sim_a_id,sim_b_id,ganador,puntaje_a,puntaje_b) VALUES (?,?,?,?,?,?,?,?)');
    try {
        $st->execute([(int)($b['especie_id'] ?? 0), (int)($b['analisis_a_id'] ?? 0), (int)($b['analisis_b_id'] ?? 0),
            !empty($b['sim_a_id']) ? (int)$b['sim_a_id'] : null, !empty($b['sim_b_id']) ? (int)$b['sim_b_id'] : null,
            $b['ganador'], num($b, 'puntaje_a', -10, 10), num($b, 'puntaje_b', -10, 10)]);
    } catch (PDOException $e) { fallo(422, 'Especie, análisis o simulaciones inexistentes'); }
    Flight::json(['ok' => true, 'id' => (int)Flight::db()->lastInsertId()], 201);
});
Flight::route('GET /geo/comparaciones', function () {
    Flight::json(['ok' => true, 'data' => Flight::db()->query(
        'SELECT c.*, e.nombre_cientifico, ua.nombre AS lugar_a, ub.nombre AS lugar_b, a.idoneidad AS idoneidad_a, b.idoneidad AS idoneidad_b
         FROM comparaciones_geo c JOIN especies e ON e.id = c.especie_id
         JOIN analisis_geo a ON a.id = c.analisis_a_id JOIN ubicaciones ua ON ua.id = a.ubicacion_id
         JOIN analisis_geo b ON b.id = c.analisis_b_id JOIN ubicaciones ub ON ub.id = b.ubicacion_id
         ORDER BY c.id DESC LIMIT 50')->fetchAll()]);
});

Flight::start();
