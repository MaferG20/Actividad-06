<?php
// PROXY SEGURO: el navegador NUNCA recibe URLs ni claves; solo manda lat/lon/ids al servidor.
//   frontend → FlightPHP → Proxy::pedir → [MySQL caché] → cURL (en paralelo) → API externa → MySQL → JSON
final class Proxy
{
    // Lista blanca de hosts (defensa contra SSRF): cualquier otro destino se rechaza
    private const HOSTS = [
        'power.larc.nasa.gov', 'api.open-meteo.com', 'customer-api.open-meteo.com', 'geocoding-api.open-meteo.com',
        'rest.isric.org', 'api.gbif.org', 'nominatim.openstreetmap.org',
    ];
    private Cache $cache;

    public function __construct(PDO $db, private array $cfg)
    {
        Http::$cfg = $cfg['http'];
        $this->cache = new Cache($db);
    }

    public function cache(): Cache { return $this->cache; }

    private static function permitida(string $url): bool
    {
        $p = parse_url($url);
        return ($p['scheme'] ?? '') === 'https' && in_array($p['host'] ?? '', self::HOSTS, true);
    }

    /**
     * $specs = [id => ['prov'=>'nasa_power', 'url'=>pública, 'url_real'=>? con key, 'ttl'=>seg, 'timeout'=>seg]]
     * @return array<string,array{ok:bool,status:int,json:?array,cache:string,error:?string}>
     */
    public function pedir(array $specs): array
    {
        $out = [];
        $faltan = [];                 // clave => spec (una sola llamada HTTP por URL distinta)
        $ids = [];                    // clave => [ids que comparten esa URL]
        foreach ($specs as $id => $s) {
            if (!self::permitida($s['url']) || (isset($s['url_real']) && !self::permitida($s['url_real']))) {
                $out[$id] = ['ok' => false, 'status' => 0, 'json' => null, 'cache' => 'BLOQ', 'error' => 'Destino no permitido'];
                continue;
            }
            $clave = hash('sha256', $s['url']);
            $hit = $this->cache->obtener($clave);
            if ($hit) {
                $out[$id] = $this->resultado($hit['status'], $hit['cuerpo'], $hit['status'] === 200 ? 'HIT' : 'NEG', null);
                continue;
            }
            $faltan[$clave] = $s;
            $ids[$clave][] = $id;
        }
        if ($faltan) {
            $res = Http::multi($faltan);                         // todas las que faltan, en paralelo
            foreach ($res as $clave => $r) {
                $s = $faltan[$clave];
                $json = json_decode($r['cuerpo'], true);
                $ok = $r['error'] === null && $r['status'] >= 200 && $r['status'] < 300 && is_array($json);
                if ($ok) {
                    $this->cache->guardar($clave, $s['prov'], $s['url'], 200, $r['cuerpo'], (int)$s['ttl']);
                } else {                                         // caché negativa breve: no martillar una API caída o con límite (429)
                    $this->cache->guardar($clave, $s['prov'], $s['url'], $r['status'] ?: 599, mb_substr($r['cuerpo'], 0, 500), (int)$this->cfg['ttl']['error']);
                }
                $res2 = $this->resultado($ok ? 200 : ($r['status'] ?: 599), $r['cuerpo'], $ok ? 'MISS' : 'ERR', $r['error']);
                foreach ($ids[$clave] as $id) $out[$id] = $res2;
            }
        }
        return $out;
    }

    private function resultado(int $status, string $cuerpo, string $cache, ?string $error): array
    {
        $json = $status === 200 ? json_decode($cuerpo, true) : null;
        return ['ok' => $status === 200 && is_array($json), 'status' => $status, 'json' => is_array($json) ? $json : null, 'cache' => $cache, 'error' => $error];
    }
}
