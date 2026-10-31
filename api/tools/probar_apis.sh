#!/usr/bin/env bash
# Prueba 1) las APIs externas DIRECTAMENTE y 2) tu proxy PHP.  Uso:
#   bash api/tools/probar_apis.sh [URL_BASE_DE_TU_API]      (por defecto http://localhost/practica-06-geovisualizacion/api)
BASE="${1:-http://localhost/practica-06-geovisualizacion/api}"
LAT=14.29; LON=-89.90
UA="Practica06-Pruebas/1.0 (uso academico)"
t() { printf '%-34s' "$1"; curl -s -A "$UA" -m 40 -o /tmp/p06_resp.json -w "HTTP %{http_code}  %{time_total}s\n" "$2"; }

echo "=== 1) APIs externas (directo) ==="
t "NASA POWER climatología"   "https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN&community=AG&longitude=$LON&latitude=$LAT&format=JSON"
t "Open-Meteo actual"          "https://api.open-meteo.com/v1/forecast?latitude=$LAT&longitude=$LON&current=temperature_2m&hourly=soil_temperature_6cm&forecast_days=1"
t "Open-Meteo geocodificación" "https://geocoding-api.open-meteo.com/v1/search?name=Jutiapa&count=3&language=es"
t "SoilGrids (puede tardar)"   "https://rest.isric.org/soilgrids/v2.0/properties/query?lon=$LON&lat=$LAT&property=phh2o&property=clay&depth=0-5cm&value=mean"
t "GBIF species/match"         "https://api.gbif.org/v1/species/match?name=Tulipa%20gesneriana&kingdom=Plantae"
t "GBIF conteo en 250 km"      "https://api.gbif.org/v1/occurrence/search?taxonKey=2753573&geoDistance=52.3,4.6,250km&limit=0"
t "Nominatim (inverso)"        "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=$LAT&lon=$LON&zoom=10"

echo; echo "=== 2) Tu proxy PHP ($BASE) ==="
t "/health"                    "$BASE/health"
t "/geo/diagnostico"           "$BASE/geo/diagnostico"; cat /tmp/p06_resp.json; echo
t "/geo/clima"                 "$BASE/geo/clima?lat=$LAT&lon=$LON"
t "/geo/suelo"                 "$BASE/geo/suelo?lat=$LAT&lon=$LON"
t "/geo/actual"                "$BASE/geo/actual?lat=$LAT&lon=$LON"
t "/geo/punto (4 APIs paralelo)" "$BASE/geo/punto?lat=$LAT&lon=$LON"
t "/geo/punto otra vez (caché)" "$BASE/geo/punto?lat=$LAT&lon=$LON"
t "/geo/ocurrencias/conteos"   "$BASE/geo/ocurrencias/conteos?lat=$LAT&lon=$LON&radio_km=250"
t "/geo/ocurrencias/mapa"      "$BASE/geo/ocurrencias/mapa?especie_id=1"
t "/geo/cache/estado"          "$BASE/geo/cache/estado"; cat /tmp/p06_resp.json; echo
echo; echo "Si la segunda llamada a /geo/punto tarda mucho menos que la primera, la caché MySQL funciona."
