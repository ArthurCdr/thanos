// server.mjs — painel web do BM Runner (um processo, zero dependencia nova).
// Serve painel.html em http://127.0.0.1:4850, expoe a API e roda a MESMA
// orquestra/flow do terminal — as perguntas viram cards com botoes no navegador.
//
// Uso: node server.mjs   →  abrir http://localhost:4850

import http from "node:http";
import crypto from "node:crypto";
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeHelpers } from "./helpers.mjs";
import { makeAdsPower } from "./adspower.mjs";
import { executarEtapa, lerProgress, ETAPAS } from "./orquestra.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = 4850;
const CONFIG_PATH = join(DIR, "config.json");
const EXAMPLE_PATH = join(DIR, "config.example.json");
const PROGRESS_PATH = join(DIR, "progress.json");

// Primeira execucao: se nao existe config.json, cria a partir do exemplo.
if (!existsSync(CONFIG_PATH) && existsSync(EXAMPLE_PATH)) {
  copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
}

// ---------- estado ----------
const state = {
  running: false,
  pending: null, // { id, text, kind, options, allowText, resolve }
  logs: [],      // ultimas linhas
};
const clients = new Set(); // conexoes SSE

// ---------- log: intercepta console.log e retransmite pro painel ----------
const origLog = console.log;
console.log = (...args) => {
  origLog(...args);
  const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  state.logs.push(line);
  if (state.logs.length > 800) state.logs.splice(0, state.logs.length - 800);
  broadcast("log", { line });
};

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

// ---------- pergunta -> botoes ----------
function opcoesPara(text, kind) {
  if (kind === "pause") return { options: [{ value: "", label: "✅ Feito, continuar" }], allowText: false };
  if (/aceitar convite\?/i.test(text))
    return { options: [{ value: "s", label: "🤖 Automático" }, { value: "m", label: "🖱 Eu clico" }], allowText: false };
  if (/pular pra próxima bm/i.test(text))
    return { options: [{ value: "s", label: "⏭ Pular" }, { value: "n", label: "🛑 Parar" }], allowText: false };
  if (/próxima bm\?/i.test(text))
    return { options: [{ value: "s", label: "▶ Continuar" }, { value: "p", label: "⏸ Pausar aqui" }], allowText: false };
  // pergunta desconhecida: oferece s/n + campo livre
  return { options: [{ value: "s", label: "Sim (s)" }, { value: "n", label: "Não (n)" }], allowText: true };
}

const publicPending = () =>
  state.pending
    ? { id: state.pending.id, text: state.pending.text, kind: state.pending.kind,
        options: state.pending.options, allowText: state.pending.allowText }
    : null;

// io web: a pergunta fica pendente ate o clique chegar em POST /api/answer
const ioWeb = {
  perguntar: ({ text, kind }) =>
    new Promise((resolve) => {
      const { options, allowText } = opcoesPara(text, kind);
      state.pending = { id: crypto.randomUUID(), text, kind, options, allowText, resolve };
      broadcast("question", publicPending());
    }),
  close: () => {},
};

// ---------- config/progress ----------
const lerConfig = () => JSON.parse(readFileSync(CONFIG_PATH, "utf8"));

// Painel roda em localhost, maquina do proprio usuario — a apiKey do AdsPower e
// dado local dele (precisa ver/editar). Mandamos o config completo.
const cfgPainel = (cfg) => JSON.parse(JSON.stringify(cfg));

// ---------- execucao ----------
async function iniciarRun(etapa = "tudo") {
  const cfg = lerConfig(); // sempre rele o disco (painel pode ter salvo agora)
  const h = makeHelpers(cfg, ioWeb);

  state.running = true;
  broadcast("status", { running: true, etapa });
  try {
    await executarEtapa({ cfg, h, etapa, progressPath: PROGRESS_PATH });
  } catch (e) {
    console.log(`Erro fatal na execução: ${e.message}`);
  } finally {
    state.running = false;
    state.pending = null;
    broadcast("question", null);
    broadcast("status", { running: false });
    h.close();
  }
}

// ---------- http ----------
const json = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
};
const lerBody = (req) =>
  new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > 2_000_000) req.destroy(); });
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(readFileSync(join(DIR, "painel.html")));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      const cfg = lerConfig();
      const progress = lerProgress(PROGRESS_PATH); // ja migrado pra v3
      json(res, 200, {
        config: cfgPainel(cfg),
        progress,
        etapas: ETAPAS,
        running: state.running,
        pending: publicPending(),
        logs: state.logs.slice(-300),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/config") {
      if (state.running) return json(res, 409, { erro: "Pare a execução antes de editar o config." });
      const body = await lerBody(req);
      const cfg = lerConfig();
      if (body.defaults && typeof body.defaults === "object") cfg.defaults = body.defaults;
      if (Array.isArray(body.businessManagers)) {
        for (const bm of body.businessManagers) {
          if (!bm.inviteLink || typeof bm.inviteLink !== "string")
            return json(res, 400, { erro: "Toda BM precisa de inviteLink." });
        }
        cfg.businessManagers = body.businessManagers;
      }
      writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
      console.log("💾 config.json salvo pelo painel.");
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/adspower") {
      if (state.running) return json(res, 409, { erro: "Pare a execução antes de editar a conexão." });
      const body = await lerBody(req);
      const cfg = lerConfig();
      cfg.adspower = {
        apiHost: String(body.apiHost || "http://127.0.0.1:50325").trim(),
        apiKey: String(body.apiKey || "").trim(),
        userId: String(body.userId || "").trim(),
      };
      writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
      console.log("💾 Conexão AdsPower salva.");
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/adspower/test") {
      const cfg = lerConfig();
      const ap = makeAdsPower(cfg);
      const userId = cfg.adspower?.userId;
      try {
        // 1) API viva? (status)
        const r = await fetch(`${cfg.adspower?.apiHost}/status`).catch(() => null);
        if (!r || !r.ok) return json(res, 200, { ok: false, etapa: "api", msg: "Local API não respondeu. AdsPower aberto e Local API ligada?" });
        // 2) perfil existe? (user/list)
        if (userId) {
          const d = await ap.apReq(`/api/v1/user/list?user_id=${encodeURIComponent(userId)}`);
          const achou = (d?.list || []).some((p) => p.user_id === userId);
          if (!achou) return json(res, 200, { ok: false, etapa: "perfil", msg: `Perfil ${userId} não encontrado nessa conta AdsPower.` });
          const nome = (d.list.find((p) => p.user_id === userId) || {}).name || userId;
          return json(res, 200, { ok: true, msg: `Conectado ✓ — perfil "${nome}" encontrado.` });
        }
        return json(res, 200, { ok: true, msg: "Local API OK ✓ (preencha o ID do perfil pra validar ele também)." });
      } catch (e) {
        return json(res, 200, { ok: false, etapa: "erro", msg: e.message });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/run") {
      if (state.running) return json(res, 409, { erro: "Já existe uma execução em andamento." });
      const body = await lerBody(req).catch(() => ({}));
      const etapa = body.etapa || "tudo";
      if (etapa !== "tudo" && !ETAPAS.includes(etapa))
        return json(res, 400, { erro: `Etapa inválida: ${etapa}` });
      iniciarRun(etapa); // roda em background; eventos via SSE
      json(res, 200, { ok: true, etapa });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/answer") {
      const body = await lerBody(req);
      if (!state.pending || body.id !== state.pending.id)
        return json(res, 409, { erro: "Nenhuma pergunta pendente com esse id." });
      const { resolve } = state.pending;
      state.pending = null;
      broadcast("question", null);
      resolve(String(body.value ?? ""));
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`event: status\ndata: ${JSON.stringify({ running: state.running })}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    json(res, 404, { erro: "rota desconhecida" });
  } catch (e) {
    json(res, 500, { erro: e.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  origLog(`\n🖥  Painel BM Runner: http://localhost:${PORT}\n   (Ctrl+C para encerrar)`);
});
