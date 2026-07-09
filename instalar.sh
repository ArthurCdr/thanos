#!/usr/bin/env bash
# Instalador do BM Runner para macOS.
# Uso (one-liner que o usuario cola no Terminal):
#   curl -fsSL https://raw.githubusercontent.com/SEU_USUARIO/SEU_REPO/main/instalar.sh | bash
#
# Faz TUDO: instala Node (se faltar), baixa o app, instala dependencias,
# cria um atalho na area de trabalho e abre o painel no navegador.

set -e

# ===== repositorio de distribuicao =====
GH_USER="ArthurCdr"
GH_REPO="thanos"
GH_BRANCH="main"
# =======================================

APP_DIR="$HOME/bm-runner"
PORT=4850
TARBALL="https://github.com/$GH_USER/$GH_REPO/archive/refs/heads/$GH_BRANCH.tar.gz"

echo ""
echo "================  Instalador BM Runner  ================"
echo ""

# 1) Node 20+ ?
precisa_node() {
  ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]
}
if precisa_node; then
  echo "→ Node 20+ nao encontrado. Instalando…"
  if ! command -v brew >/dev/null 2>&1; then
    echo "→ Instalando Homebrew (pode pedir sua senha do Mac)…"
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
  fi
  brew install node
else
  echo "→ Node $(node -v) OK"
fi

# 2) baixar/atualizar o app (tarball — nao precisa de git)
echo "→ Baixando o app para $APP_DIR…"
mkdir -p "$APP_DIR"
# --strip-components=1 remove a pasta "REPO-branch/" de dentro do zip.
# config.json/progress.json/relatorios NAO vem no tarball → seus dados sao preservados.
curl -fsSL "$TARBALL" | tar xz --strip-components=1 -C "$APP_DIR"
cd "$APP_DIR"

# 3) dependencias (sem baixar navegadores — usamos o do AdsPower)
echo "→ Instalando dependencias (Playwright)…"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --silent

# 4) atalho pra reabrir depois sem terminal
LAUNCH="$HOME/Desktop/Abrir Painel BM.command"
cat > "$LAUNCH" <<EOF
#!/usr/bin/env bash
cd "$APP_DIR"
(sleep 1.5; open "http://localhost:$PORT") &
node server.mjs
EOF
chmod +x "$LAUNCH"
echo "→ Atalho criado na Area de Trabalho: \"Abrir Painel BM\""

# 5) sobe agora
echo ""
echo "================  Pronto! Abrindo o painel…  ================"
echo "  Painel: http://localhost:$PORT"
echo "  (Feche esta janela do Terminal para desligar o painel.)"
echo ""
(sleep 1.5; open "http://localhost:$PORT") &
node server.mjs
