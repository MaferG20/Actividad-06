<?php
// Cliente HTTP con cURL: peticiones sueltas o en PARALELO (curl_multi). Solo HTTPS, con tiempos límite.
final class Http
{
    /** Configuración global ('http' de config.php): user_agent, cacert */
    public static array $cfg = [];

    private static function nuevo(string $url, array $headers, int $timeout)
    {
        $ch = curl_init($url);
        $op = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 3,
            CURLOPT_CONNECTTIMEOUT => 6,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_ENCODING       => '',                       // acepta gzip/deflate
            CURLOPT_USERAGENT      => self::$cfg['user_agent'] ?? 'Practica06/1.0',
            CURLOPT_HTTPHEADER     => array_merge(['Accept: application/json'], $headers),
            CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,          // nunca http:// ni file:// (mitiga SSRF)
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
        ];
        if (!empty(self::$cfg['cacert'])) $op[CURLOPT_CAINFO] = self::$cfg['cacert'];
        curl_setopt_array($ch, $op);
        return $ch;
    }

    /**
     * Lanza varias peticiones a la vez. $reqs = [id => ['url'=>..., 'url_real'=>? (con API key), 'headers'=>[], 'timeout'=>int]]
     * Devuelve [id => ['status'=>int, 'cuerpo'=>string, 'error'=>?string]]
     */
    public static function multi(array $reqs): array
    {
        $out = [];
        if (!$reqs) return $out;
        $mh = curl_multi_init();
        $hs = [];
        foreach ($reqs as $id => $r) {
            $ch = self::nuevo($r['url_real'] ?? $r['url'], $r['headers'] ?? [], (int)($r['timeout'] ?? 15));
            curl_multi_add_handle($mh, $ch);
            $hs[$id] = $ch;
        }
        do {
            $st = curl_multi_exec($mh, $corriendo);
            if ($corriendo) curl_multi_select($mh, 1.0);
        } while ($corriendo > 0 && $st === CURLM_OK);

        foreach ($hs as $id => $ch) {
            $err = curl_error($ch);
            $out[$id] = [
                'status' => (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE),
                'cuerpo' => (string)curl_multi_getcontent($ch),
                'error'  => $err !== '' ? $err : null,
                'ms'     => (int)round(curl_getinfo($ch, CURLINFO_TOTAL_TIME) * 1000),
            ];
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
        }
        curl_multi_close($mh);
        return $out;
    }
}
