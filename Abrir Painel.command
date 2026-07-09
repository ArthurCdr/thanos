#!/usr/bin/env bash
# Clique 2x neste arquivo para abrir o painel (sem usar o Terminal na mao).
cd "$(dirname "$0")"
# usa o Node local (baixado pelo instalador) se o sistema nao tiver
[ -d "./.node/bin" ] && export PATH="$PWD/.node/bin:$PATH"
(sleep 1.5; open "http://localhost:4850") &
node server.mjs
