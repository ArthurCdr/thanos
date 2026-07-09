#!/usr/bin/env bash
# Instalador do BM Runner para macOS — SEM admin, SEM sudo, SEM Homebrew.
# Uso (one-liner que o usuario cola no Terminal):
#   curl -fsSL https://raw.githubusercontent.com/ArthurCdr/thanos/main/instalar.sh | bash
#
# Faz TUDO: baixa o Node (local, na pasta do app), baixa o app, instala
# dependencias, cria um atalho na area de trabalho e abre o painel.

set -e

# ===== repositorio de distribuicao =====
GH_USER="ArthurCdr"
GH_REPO="thanos"
GH_BRANCH="main"
# ===== versao do Node (binario oficial) =====
NODE_VERSION="v20.18.1"
# ============================================

APP_DIR="$HOME/bm-runner"
NODE_DIR="$APP_DIR/.node"
PORT=4850
TARBALL="https://github.com/$GH_USER/$GH_REPO/archive/refs/heads/$GH_BRANCH.tar.gz"

echo ""
echo "================  Instalador BM Runner  ================"
echo ""

mkdir -p "$APP_DIR"

# 1) Node 20+ ? Usa o do sistema se servir; senao baixa um LOCAL (sem admin).
precisa_node() {
  ! command -v node >/dev/null 2>&1 || [ "$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]
}
if precisa_node; then
  ARCH="$(uname -m)"
  case "$ARCH" in
    arm64)  NARCH="darwin-arm64" ;;
    x86_64) NARCH="darwin-x64" ;;
    *) echo "❌ Arquitetura não suportada: $ARCH"; exit 1 ;;
  esac
  echo "→ Node não encontrado. Baixando Node $NODE_VERSION (local, sem senha/admin)…"
  mkdir -p "$NODE_DIR"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-$NARCH.tar.gz" \
    | tar xz --strip-components=1 -C "$NODE_DIR"
  export PATH="$NODE_DIR/bin:$PATH"
  echo "→ Node local: $(node -v)"
else
  echo "→ Node $(node -v) OK (do sistema)"
fi

# 2) baixar/atualizar o app (tarball — nao precisa de git)
echo "→ Baixando o app…"
# --strip-components=1 remove a pasta "REPO-branch/" do zip. Nao apaga .node/ nem
# config.json/progress.json/relatorios (nao vem no tarball) → dados preservados.
curl -fsSL "$TARBALL" | tar xz --strip-components=1 -C "$APP_DIR"
cd "$APP_DIR"

# 3) dependencias (sem baixar navegadores — usamos o do AdsPower)
echo "→ Instalando dependências (Playwright)…"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --silent

# 4) atalho pra reabrir depois sem terminal
LAUNCH="$HOME/Desktop/Abrir Painel BM.command"
cat > "$LAUNCH" <<EOF
#!/usr/bin/env bash
cd "$APP_DIR"
[ -d "$NODE_DIR/bin" ] && export PATH="$NODE_DIR/bin:\$PATH"
(sleep 1.5; open "http://localhost:$PORT") &
node server.mjs
EOF
chmod +x "$LAUNCH"
echo "→ Atalho criado na Área de Trabalho: \"Abrir Painel BM\""

# 5) sobe agora
echo ""
echo "================  Pronto! Abrindo o painel…  ================"
echo "  Painel: http://localhost:$PORT"
echo "  (Feche esta janela do Terminal para desligar o painel.)"
echo ""
[ -d "$NODE_DIR/bin" ] && export PATH="$NODE_DIR/bin:$PATH"
(sleep 1.5; open "http://localhost:$PORT") &
node server.mjs
