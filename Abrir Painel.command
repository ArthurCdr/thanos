#!/usr/bin/env bash
# Clique 2x neste arquivo para abrir o painel (sem usar o Terminal na mao).
cd "$(dirname "$0")"
(sleep 1.5; open "http://localhost:4850") &
node server.mjs
