<?php
// Llena la caché de MySQL con las ubicaciones de ejemplo ANTES de la demo (línea de comandos):
//     php api/tools/precargar.php
// Respeta el límite de SoilGrids (≈5 consultas/min): espera 13 s después de cada descarga real de suelo.
// También es la base de la respuesta «¿cómo escalar a miles de ubicaciones?»: un worker que consume una cola.
foreach (['Http', 'Cache', 'Normalizar', 'Proxy', 'Geo'] as $c) require __DIR__ . "/../lib/$c.php";
$cfg = require __DIR__ . '/../config.php';
$d = $cfg['db'];
$db = new PDO("mysql:host={$d['host']};port={$d['port']};dbname={$d['name']};charset={$d['charset']}", $d['user'], $d['pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$geo = new Geo($db, $cfg);
$especies = $db->query('SELECT * FROM especies ORDER BY id')->fetchAll();
$n = 0;
foreach ($db->query('SELECT * FROM ubicaciones WHERE preset = 1 ORDER BY id')->fetchAll() as $u) {
    $lat = (float)$u['lat'];
    $lon = (float)$u['lon'];
    $t0 = microtime(true);
    $p = $geo->punto($lat, $lon);
    $c = $geo->conteos($especies, $lat, $lon, (int)$cfg['gbif']['radio_km']);
    $est = fn($k) => $p['fuentes'][$k]['cache'] ?? '-';
    printf("[%d] %-24s nasa=%-4s suelo=%-4s actual=%-4s lugar=%-4s gbif_llamadas=%d  (%.1fs)\n", ++$n, $u['nombre'], $est('nasa'), $est('suelo'), $est('actual'), $est('lugar'), count($c['fuentes']), microtime(true) - $t0);
    if (($p['fuentes']['suelo']['cache'] ?? '') === 'MISS') sleep(13);
}
echo "Listo. Revisa GET /api/geo/cache/estado\n";
