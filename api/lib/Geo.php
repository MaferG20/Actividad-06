<?php
// Orquesta las 5 fuentes externas: construye las URL, las manda al Proxy (caché + cURL paralelo) y normaliza.
final class Geo
{
    private ?Proxy $proxy;

    /** $db puede ser null solo para CONSTRUIR las URL (diagnóstico sin MySQL); proxy()/punto()/conteos() sí lo necesitan */
    public function __construct(private ?PDO $db, private array $cfg)
    {
        $this->proxy = $db ? new Proxy($db, $cfg) : null;
    }

    public function proxy(): Proxy { return $this->proxy ?? throw new RuntimeException('Geo sin conexión a MySQL'); }

    private static function snap(float $v, float $paso): string { return number_format(round($v / $paso) * $paso, 2, '.', ''); }
    private static function n(float $v, int $d = 2): string { return number_format($v, $d, '.', ''); }

    // ------------------------- constructores de peticiones (spec) -------------------------
    public function specNasa(float $lat, float $lon): array
    {   // la rejilla de NASA POWER es de ~0,5°: se ajusta a 0,25° para que clics cercanos compartan caché
        $url = 'https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,ALLSKY_SFC_SW_DWN,RH2M&community=AG'
             . '&longitude=' . self::snap($lon, 0.25) . '&latitude=' . self::snap($lat, 0.25) . '&format=JSON';
        return ['prov' => 'nasa_power', 'url' => $url, 'ttl' => $this->cfg['ttl']['nasa_power'], 'timeout' => $this->cfg['http']['timeout']];
    }

    public function specOpenMeteo(float $lat, float $lon): array
    {
        $q = 'latitude=' . self::n($lat) . '&longitude=' . self::n($lon)
           . '&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m'
           . '&hourly=soil_temperature_6cm,soil_moisture_3_to_9cm'
           . '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration'
           . '&forecast_days=3&timezone=auto';
        $s = ['prov' => 'open_meteo', 'url' => 'https://api.open-meteo.com/v1/forecast?' . $q, 'ttl' => $this->cfg['ttl']['open_meteo'], 'timeout' => $this->cfg['http']['timeout']];
        $clave = $this->cfg['claves']['open_meteo'] ?? null;
        if ($clave) {   // API key solo en el servidor: va en url_real, que jamás se guarda ni se envía al cliente
            $s['url_real'] = 'https://customer-api.open-meteo.com/v1/forecast?' . $q . '&apikey=' . rawurlencode($clave);
        }
        return $s;
    }

    public function specSuelo(float $lat, float $lon): array
    {   // 250 m de resolución: se redondea a 2 decimales (~1 km) para reutilizar caché
        $url = 'https://rest.isric.org/soilgrids/v2.0/properties/query?lon=' . self::n($lon) . '&lat=' . self::n($lat)
             . '&property=phh2o&property=clay&property=sand&property=silt&property=soc'
             . '&depth=0-5cm&depth=5-15cm&depth=15-30cm&value=mean';
        return ['prov' => 'soilgrids', 'url' => $url, 'ttl' => $this->cfg['ttl']['soilgrids'], 'timeout' => $this->cfg['http']['timeout_suelo']];
    }

    public function specReverso(float $lat, float $lon): array
    {
        $url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=es&lat=' . self::n($lat) . '&lon=' . self::n($lon);
        return ['prov' => 'nominatim', 'url' => $url, 'ttl' => $this->cfg['ttl']['nominatim'], 'timeout' => $this->cfg['http']['timeout']];
    }

    public function specBuscar(string $q): array
    {
        $url = 'https://geocoding-api.open-meteo.com/v1/search?name=' . rawurlencode($q) . '&count=6&language=es&format=json';
        return ['prov' => 'open_meteo', 'url' => $url, 'ttl' => $this->cfg['ttl']['nominatim'], 'timeout' => $this->cfg['http']['timeout']];
    }

    public function specGbifMatch(string $nombre): array
    {
        return ['prov' => 'gbif', 'url' => 'https://api.gbif.org/v1/species/match?kingdom=Plantae&name=' . rawurlencode($nombre), 'ttl' => $this->cfg['ttl']['gbif_match'], 'timeout' => $this->cfg['http']['timeout']];
    }

    /** Número de registros georreferenciados (sin duplicar ni con problemas de coordenadas). Con lat/lon: dentro de $radioKm */
    public function specGbifConteo(int $key, ?float $lat, ?float $lon, int $radioKm): array
    {
        $url = 'https://api.gbif.org/v1/occurrence/search?limit=0&hasCoordinate=true&hasGeospatialIssue=false&taxonKey=' . $key;
        if ($lat !== null && $lon !== null) $url .= '&geoDistance=' . self::n($lat, 1) . ',' . self::n($lon, 1) . ',' . $radioKm . 'km';
        return ['prov' => 'gbif', 'url' => $url, 'ttl' => $this->cfg['ttl']['gbif_conteo'], 'timeout' => $this->cfg['http']['timeout']];
    }

    public function specGbifPuntos(int $key, int $offset, int $limite): array
    {
        $url = 'https://api.gbif.org/v1/occurrence/search?hasCoordinate=true&hasGeospatialIssue=false&taxonKey=' . $key . '&limit=' . $limite . '&offset=' . $offset;
        return ['prov' => 'gbif', 'url' => $url, 'ttl' => $this->cfg['ttl']['gbif_puntos'], 'timeout' => $this->cfg['http']['timeout']];
    }

    /** Resumen id → estado de caché/HTTP de cada llamada (para mostrar en el frontend y guardar en `fuentes`) */
    public static function meta(array $r): array
    {
        $m = [];
        foreach ($r as $id => $x) $m[$id] = ['cache' => $x['cache'], 'status' => $x['status']];
        return $m;
    }

    // ------------------------- operaciones -------------------------
    /** Todo lo que se sabe de un punto (4 APIs en paralelo): clima NASA + ahora Open-Meteo + suelo SoilGrids + nombre */
    public function punto(float $lat, float $lon): array
    {
        $r = $this->proxy()->pedir([
            'nasa'   => $this->specNasa($lat, $lon),
            'actual' => $this->specOpenMeteo($lat, $lon),
            'suelo'  => $this->specSuelo($lat, $lon),
            'lugar'  => $this->specReverso($lat, $lon),
        ]);
        $clima  = $r['nasa']['ok']   ? Normalizar::nasa($r['nasa']['json'])         : null;
        $actual = $r['actual']['ok'] ? Normalizar::openMeteo($r['actual']['json'])  : null;
        $suelo  = $r['suelo']['ok']  ? Normalizar::soilgrids($r['suelo']['json'])   : null;
        $lugar  = $r['lugar']['ok']  ? Normalizar::reverso($r['lugar']['json'])     : null;
        if ($clima) {
            $clima['lat'] = $lat;
            $clima['lon'] = $lon;
            if ($clima['elevacion_m'] === null) $clima['elevacion_m'] = $actual['elevacion_m'] ?? null;
        }
        return ['lat' => $lat, 'lon' => $lon, 'lugar' => $lugar, 'clima' => $clima, 'actual' => $actual, 'suelo' => $suelo, 'fuentes' => self::meta($r)];
    }

    /** Obtiene (y guarda en especies.gbif_key) el taxonKey de GBIF de cada especie. Los cultivares comparten el de su especie. */
    public function resolverTaxones(array $especies): array
    {
        $keys = [];
        $pend = [];
        foreach ($especies as $e) {
            $id = (int)$e['id'];
            if (!empty($e['gbif_key'])) { $keys[$id] = (int)$e['gbif_key']; continue; }
            $pend['m' . $id] = $this->specGbifMatch(preg_replace('/\s+cv\..*$/i', '', (string)$e['nombre_cientifico']));
        }
        if ($pend) {
            $r = $this->proxy()->pedir($pend);
            $upd = $this->db->prepare('UPDATE especies SET gbif_key = ? WHERE id = ?');
            foreach ($pend as $pid => $_) {
                $id = (int)substr($pid, 1);
                $k = null;
                $j = $r[$pid]['json'] ?? null;
                if ($r[$pid]['ok'] && !empty($j['usageKey']) && ($j['matchType'] ?? 'NONE') !== 'NONE') $k = (int)$j['usageKey'];
                if ($k) $upd->execute([$k, $id]);
                $keys[$id] = $k;
            }
        }
        return $keys;
    }

    /** Registros GBIF por especie: dentro de $radioKm del punto y en todo el mundo */
    public function conteos(array $especies, float $lat, float $lon, int $radioKm): array
    {
        $keys = $this->resolverTaxones($especies);
        $specs = [];
        foreach ($especies as $e) {
            $id = (int)$e['id'];
            if (empty($keys[$id])) continue;
            $specs['r' . $id] = $this->specGbifConteo($keys[$id], $lat, $lon, $radioKm);
            $specs['t' . $id] = $this->specGbifConteo($keys[$id], null, null, 0);
        }
        $r = $specs ? $this->proxy()->pedir($specs) : [];
        $items = [];
        foreach ($especies as $e) {
            $id = (int)$e['id'];
            $reg = isset($r['r' . $id]) && $r['r' . $id]['ok'] ? Normalizar::gbifConteo($r['r' . $id]['json']) : null;
            $tot = isset($r['t' . $id]) && $r['t' . $id]['ok'] ? Normalizar::gbifConteo($r['t' . $id]['json']) : null;
            $items[] = ['especie_id' => $id, 'gbif_key' => $keys[$id] ?? null, 'region' => $reg, 'total' => $tot, 'radio_km' => $radioKm];
        }
        return ['items' => $items, 'fuentes' => self::meta($r)];
    }

    /** Muestra de ocurrencias de una especie repartida por el mundo (varias páginas a distinto offset) para dibujar en el globo */
    public function mapa(array $esp): ?array
    {
        $id = (int)$esp['id'];
        $k = $this->resolverTaxones([$esp])[$id] ?? null;
        if (!$k) return null;
        $t = $this->proxy()->pedir(['t' => $this->specGbifConteo($k, null, null, 0)])['t'];
        $total = $t['ok'] ? Normalizar::gbifConteo($t['json']) : null;
        if ($total === null) return null;
        if ($total === 0) return ['especie_id' => $id, 'total' => 0, 'puntos' => [], 'muestra' => 0];
        $por = (int)$this->cfg['gbif']['puntos_por_pagina'];
        $pag = max(1, min((int)$this->cfg['gbif']['paginas'], (int)ceil($total / $por)));
        $tope = min($total, 100000) - $por;           // GBIF solo permite offset + limit <= 100 000
        $specs = [];
        for ($i = 0; $i < $pag; $i++) {
            $off = ($pag === 1 || $tope <= 0) ? 0 : (int)floor($i * $tope / ($pag - 1));
            $specs['p' . $i] = $this->specGbifPuntos($k, $off, $por);
        }
        $r = $this->proxy()->pedir($specs);
        $paginas = [];
        foreach ($r as $x) if ($x['ok']) $paginas[] = $x['json'];
        $puntos = Normalizar::gbifPuntos($paginas);
        return ['especie_id' => $id, 'total' => $total, 'puntos' => $puntos, 'muestra' => count($puntos), 'fuentes' => self::meta($r)];
    }
}
