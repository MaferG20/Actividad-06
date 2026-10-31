<?php
// Convierte las respuestas (muy distintas entre sí) de cada API a UN formato simple y estable para el frontend.
final class Normalizar
{
    private const MESES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    /** NASA POWER · climatología mensual (comunidad AG). Valor de relleno de la API: -999 */
    public static function nasa(array $j): ?array
    {
        $p = $j['properties']['parameter'] ?? null;
        if (!is_array($p)) return null;
        $serie = function (string $k) use ($p): ?array {
            if (!isset($p[$k]) || !is_array($p[$k])) return null;
            $o = [];
            foreach (self::MESES as $m) {
                $v = $p[$k][$m] ?? null;
                if (!is_numeric($v) || $v <= -900) return null;       // serie con huecos → inválida
                $o[] = round((float)$v, 2);
            }
            return $o;
        };
        $t = $serie('T2M');
        $pr = $serie('PRECTOTCORR');
        $rs = $serie('ALLSKY_SFC_SW_DWN');
        if (!$t || !$pr || !$rs) return null;
        $unidad = (string)($j['parameters']['ALLSKY_SFC_SW_DWN']['units'] ?? 'MJ/m^2/day');
        $k = stripos($unidad, 'kw') !== false ? 3.6 : 1.0;            // si viniera en kWh/m²/día → MJ/m²/día
        $rs = array_map(fn($v) => round($v * $k, 2), $rs);
        $c = $j['geometry']['coordinates'] ?? [];
        return [
            'fuente'        => 'NASA POWER (climatología mensual, comunidad AG)',
            't2m'           => $t,                                    // °C media mensual a 2 m
            't2m_max'       => $serie('T2M_MAX') ?? $t,
            't2m_min'       => $serie('T2M_MIN') ?? $t,
            'precip_mm_dia' => $pr,                                   // mm/día (PRECTOTCORR)
            'rad_mj_dia'    => $rs,                                   // MJ/m²/día (ALLSKY_SFC_SW_DWN)
            'hr'            => $serie('RH2M') ?? array_fill(0, 12, null),
            'elevacion_m'   => isset($c[2]) && is_numeric($c[2]) ? (int)round((float)$c[2]) : null,
            'rad_unidad_origen' => $unidad,
        ];
    }

    /** Open-Meteo · clima actual + suelo superficial + 3 días de pronóstico */
    public static function openMeteo(array $j): ?array
    {
        $cur = $j['current'] ?? null;
        if (!is_array($cur)) return null;
        $horas = $j['hourly']['time'] ?? [];
        $idx = array_search(substr((string)($cur['time'] ?? ''), 0, 13) . ':00', $horas, true);
        $h = fn(string $k) => ($idx !== false && isset($j['hourly'][$k][$idx])) ? $j['hourly'][$k][$idx] : null;
        $d = $j['daily'] ?? [];
        $dias = [];
        foreach (($d['time'] ?? []) as $i => $f) {
            $dias[] = ['fecha' => $f, 'tmax' => $d['temperature_2m_max'][$i] ?? null, 'tmin' => $d['temperature_2m_min'][$i] ?? null,
                       'lluvia_mm' => $d['precipitation_sum'][$i] ?? null, 'et0_mm' => $d['et0_fao_evapotranspiration'][$i] ?? null];
        }
        return [
            'fuente'            => 'Open-Meteo',
            'hora'              => $cur['time'] ?? null,
            'zona'              => $j['timezone'] ?? null,
            'elevacion_m'       => isset($j['elevation']) ? (int)round((float)$j['elevation']) : null,
            'temp_c'            => $cur['temperature_2m'] ?? null,
            'hr'                => $cur['relative_humidity_2m'] ?? null,
            'precip_mm'         => $cur['precipitation'] ?? null,
            'viento_kmh'        => $cur['wind_speed_10m'] ?? null,
            'suelo_temp_6cm_c'  => $h('soil_temperature_6cm'),
            'suelo_humedad'     => $h('soil_moisture_3_to_9cm'),     // m³/m³
            'pronostico'        => $dias,
        ];
    }

    /** SoilGrids v2.0 · promedio ponderado por espesor de 0-5, 5-15 y 15-30 cm; se divide entre d_factor para volver a unidades reales */
    public static function soilgrids(array $j): ?array
    {
        $capas = $j['properties']['layers'] ?? null;
        if (!is_array($capas)) return null;
        $espesor = ['0-5cm' => 5, '5-15cm' => 10, '15-30cm' => 15];
        $res = [];
        foreach ($capas as $l) {
            $df = (float)($l['unit_measure']['d_factor'] ?? 10);
            if ($df <= 0) $df = 10.0;
            $suma = 0.0; $w = 0.0;
            foreach (($l['depths'] ?? []) as $d) {
                $m = $d['values']['mean'] ?? null;
                $e = $espesor[$d['label'] ?? ''] ?? null;
                if ($m === null || $e === null) continue;
                $suma += (float)$m * $e;
                $w += $e;
            }
            if ($w > 0 && isset($l['name'])) $res[$l['name']] = round(($suma / $w) / $df, 2);
        }
        if (!isset($res['phh2o']) && !isset($res['clay'])) return null;    // agua, hielo o zona urbana: sin dato
        return [
            'fuente'   => 'SoilGrids v2.0 (ISRIC, 250 m), promedio 0-30 cm',
            'ph'       => $res['phh2o'] ?? null,
            'arcilla'  => $res['clay'] ?? null,      // %
            'arena'    => $res['sand'] ?? null,      // %
            'limo'     => $res['silt'] ?? null,      // %
            'carbono'  => $res['soc'] ?? null,       // g/kg de carbono orgánico
        ];
    }

    public static function gbifConteo(array $j): ?int
    {
        return isset($j['count']) && is_numeric($j['count']) ? (int)$j['count'] : null;
    }

    /** Une varias páginas de occurrence/search en [[lat, lon, año, país], ...] sin duplicados (rejilla 0,01°) */
    public static function gbifPuntos(array $paginas): array
    {
        $vistos = [];
        $out = [];
        foreach ($paginas as $j) {
            foreach (($j['results'] ?? []) as $r) {
                $la = $r['decimalLatitude'] ?? null;
                $lo = $r['decimalLongitude'] ?? null;
                if (!is_numeric($la) || !is_numeric($lo)) continue;
                $k = round((float)$la, 2) . ',' . round((float)$lo, 2);
                if (isset($vistos[$k])) continue;
                $vistos[$k] = true;
                $out[] = [round((float)$la, 3), round((float)$lo, 3), isset($r['year']) ? (int)$r['year'] : null, $r['countryCode'] ?? null];
            }
        }
        return $out;
    }

    /** Nominatim · geocodificación inversa (coordenadas → nombre del lugar) */
    public static function reverso(array $j): ?array
    {
        if (isset($j['error']) || !isset($j['address'])) return null;
        $a = $j['address'];
        $nombre = $a['city'] ?? $a['town'] ?? $a['village'] ?? $a['municipality'] ?? $a['county'] ?? $a['state_district'] ?? $a['state'] ?? ($j['name'] ?? null);
        if (!$nombre) return null;
        return ['nombre' => $nombre, 'region' => $a['state'] ?? null, 'pais' => $a['country'] ?? null, 'codigo_pais' => isset($a['country_code']) ? strtoupper($a['country_code']) : null];
    }

    /** Open-Meteo Geocoding · búsqueda por nombre (nombre → coordenadas) */
    public static function buscar(array $j): array
    {
        $o = [];
        foreach (($j['results'] ?? []) as $r) {
            $o[] = ['nombre' => $r['name'] ?? '', 'region' => $r['admin1'] ?? null, 'pais' => $r['country'] ?? null, 'codigo_pais' => $r['country_code'] ?? null,
                    'lat' => $r['latitude'] ?? null, 'lon' => $r['longitude'] ?? null, 'elevacion_m' => $r['elevation'] ?? null];
        }
        return $o;
    }
}
