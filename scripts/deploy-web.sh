#!/usr/bin/env bash
# Publica la web en https://cieloerp.com (DigitalOcean App Platform, sitio estático).
# Compila el export estático apuntando a la API y lo sube a la rama `deploy-static`
# del repo; DigitalOcean (autodeploy) lo publica solo en ~1 minuto.
# Uso: scripts/deploy-web.sh   (desde la raíz del repo, con .env.local presente)
set -euo pipefail

API_URL="${API_URL:-https://api.cieloerp.com}"
REPO_URL="$(git remote get-url mio)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

NEXT_PUBLIC_API_URL="$API_URL" npm run build:firebase
cp -R out/. "$TMP"/
touch "$TMP/.nojekyll"
cd "$TMP"
git init -q -b deploy-static
git add -A
git -c user.name="deploy" -c user.email="deploy@localhost" commit -q -m "build estático ($(date -u +%FT%TZ)), API: $API_URL"
git push -q --force "$REPO_URL" deploy-static:deploy-static
echo "Publicado. DigitalOcean desplegará https://cieloerp.com en ~1 minuto."
