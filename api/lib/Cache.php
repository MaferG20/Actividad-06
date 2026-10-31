<?php
// Caché de respuestas de APIs externas en MySQL (tabla cache_api). La clave es el SHA-256 de la URL PÚBLICA:
// nunca incluye la API key, así que un volcado de la base no filtra credenciales.
final class Cache
{
    public function __construct(private PDO $db) {}

    /** @return array{status:int,cuerpo:string}|null  null si no existe o ya expiró */
    public function obtener(string $clave): ?array
    {
        $st = $this->db->prepare('SELECT status, cuerpo FROM cache_api WHERE clave = ? AND expira_en > NOW()');
        $st->execute([$clave]);
        $r = $st->fetch();
        if (!$r) return null;
        $this->db->prepare('UPDATE cache_api SET aciertos = aciertos + 1 WHERE clave = ?')->execute([$clave]);
        return ['status' => (int)$r['status'], 'cuerpo' => (string)$r['cuerpo']];
    }

    public function guardar(string $clave, string $proveedor, string $url, int $status, string $cuerpo, int $ttl): void
    {
        $st = $this->db->prepare(
            'INSERT INTO cache_api (clave, proveedor, url, status, cuerpo, expira_en)
             VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))
             ON DUPLICATE KEY UPDATE url = VALUES(url), status = VALUES(status), cuerpo = VALUES(cuerpo),
                                     creada_en = NOW(), expira_en = VALUES(expira_en), aciertos = 0'
        );
        $st->execute([$clave, $proveedor, mb_substr($url, 0, 1000), $status, $cuerpo, $ttl]);
        if (random_int(1, 100) === 1) $this->limpiar();     // mantenimiento ocasional
    }

    public function limpiar(): int
    {
        return $this->db->exec('DELETE FROM cache_api WHERE expira_en < NOW()');
    }

    public function estado(): array
    {
        return $this->db->query(
            "SELECT proveedor, COUNT(*) AS entradas, SUM(aciertos) AS aciertos, SUM(status <> 200) AS errores_en_cache,
                    MIN(expira_en) AS expira_primero, MAX(creada_en) AS ultima_descarga
             FROM cache_api WHERE expira_en > NOW() GROUP BY proveedor ORDER BY proveedor"
        )->fetchAll();
    }
}
