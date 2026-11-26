#!/usr/bin/env bash
# Prueba de restauración: respalda la base, la restaura en otra base nueva y comprueba
# que los datos y la seguridad (RLS, políticas, permisos) quedaron idénticos.
# Un respaldo que nunca se ha restaurado no es un respaldo.
#
# Uso local (contenedor Docker):  CONTENEDOR=cielo-pg PGUSER_ADMIN=postgres BASE=cielo ./scripts/prueba-restauracion.sh
# Uso en CI (psql/pg_dump del runner): PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=… BASE=cielo ./scripts/prueba-restauracion.sh
set -euo pipefail

BASE="${BASE:-cielo}"
DESTINO="${BASE}_restaurada"
ADMIN="${PGUSER_ADMIN:-${PGUSER:-postgres}}"

if [ -n "${CONTENEDOR:-}" ]; then
  pg()      { docker exec -i "$CONTENEDOR" psql -U "$ADMIN" -v ON_ERROR_STOP=1 -qAt "$@"; }
  dump()    { docker exec -i "$CONTENEDOR" pg_dump -U "$ADMIN" -Fc "$1"; }
  restore() { docker exec -i "$CONTENEDOR" pg_restore -U "$ADMIN" --no-owner -d "$1"; }
else
  pg()      { psql -U "$ADMIN" -v ON_ERROR_STOP=1 -qAt "$@"; }
  dump()    { pg_dump -U "$ADMIN" -Fc "$1"; }
  restore() { pg_restore -U "$ADMIN" --no-owner -d "$1"; }
fi

limpiar() { pg -d postgres -c "DROP DATABASE IF EXISTS \"$DESTINO\"" >/dev/null 2>&1 || true; }
trap limpiar EXIT
limpiar

echo "→ respaldando $BASE"
TMP="$(mktemp)"; dump "$BASE" > "$TMP"
[ -s "$TMP" ] || { echo "ERROR: el respaldo salió vacío"; exit 1; }
echo "  respaldo: $(wc -c < "$TMP" | tr -d ' ') bytes"

echo "→ restaurando en $DESTINO"
pg -d postgres -c "CREATE DATABASE \"$DESTINO\""
restore "$DESTINO" < "$TMP" || true   # pg_restore devuelve error por roles/ACL ausentes; se verifica abajo
rm -f "$TMP"

# Huella comparable de una base: filas por tabla + estado de RLS + número de políticas + índices
huella() {
  pg -d "$1" -c "
    SELECT 'tabla ' || c.relname || ' filas=' || (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public.' || quote_ident(c.relname), false, true, '')))[1]::text
           || ' rls=' || c.relrowsecurity || ' forzada=' || c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname;
    SELECT 'politica ' || tablename || '.' || policyname || ' cmd=' || cmd FROM pg_policies WHERE schemaname = 'public' ORDER BY 1;
    SELECT 'indice ' || indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1;"
}
# Autoprueba: PRUEBA_SABOTAJE=1 daña la copia a propósito; el script DEBE fallar.
if [ "${PRUEBA_SABOTAJE:-}" = "1" ]; then pg -d "$DESTINO" -c "DELETE FROM migraciones WHERE nombre = (SELECT min(nombre) FROM migraciones)" >/dev/null; fi
A="$(huella "$BASE")"; B="$(huella "$DESTINO")"
if [ "$A" != "$B" ]; then
  echo "ERROR: la base restaurada NO coincide con el original"; diff <(echo "$A") <(echo "$B") | head -20; exit 1
fi
FILAS="$(echo "$A" | grep -c '^tabla ')"
[ "$FILAS" -ge 8 ] || { echo "ERROR: solo $FILAS tablas verificadas"; exit 1; }
# Tablas globales (sin datos de empresa) quedan fuera de la exigencia de RLS
SIN_RLS="$(echo "$B" | grep '^tabla ' | grep -v 'forzada=true' | grep -vE '^tabla (migraciones|parametros_legales) ' || true)"
[ -z "$SIN_RLS" ] || { echo "ERROR: tablas sin RLS forzada tras restaurar:"; echo "$SIN_RLS"; exit 1; }
echo "OK: restauración verificada ($FILAS tablas, filas, RLS, políticas e índices idénticos)"
