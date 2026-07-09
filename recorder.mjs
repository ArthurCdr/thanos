// recorder.mjs — codegen DENTRO do perfil AdsPower (fingerprint + sessao logada).
// Abre o perfil pela Local API, conecta via CDP e chama page.pause():
// o Playwright Inspector abre com o botao "Record" (= codegen) no navegador real.
//
// Uso:
//   node recorder.mjs                      -> abre em business.facebook.com
//   node recorder.mjs "https://..."        -> abre na URL passada (ex: link de convite)
//   node recorder.mjs ./config.json "url"  -> config custom + url

import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
// se o 1o arg terminar em .json, e config; senao e URL.
const CONFIG_PATH = args[0]?.endsWith(".json") ? args[0] : "./config.json";
const START_URL =
  (args[0]?.endsWith(".json") ? args[1] : args[0]) || "https://business.facebook.com";

const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apReq(path) {
  const ap = cfg.adspower || {};
  const headers = ap.apiKey ? { Authorization: `Bearer ${ap.apiKey}` } : {};
  await sleep(1300); // AdsPower limita ~1 req/s
  const r = await fetch(`${ap.apiHost}${path}`, { headers });
  const j = await r.json();
  if (j.code !== 0) throw new Error(j.msg || "AdsPower retornou erro");
  return j.data;
}

async function main() {
  const userId = cfg.adspower?.userId;
  if (!userId) { console.error("Faltou adspower.userId no config."); process.exit(1); }

  console.log(`\n🟢 Abrindo perfil AdsPower ${userId}…`);
  const d = await apReq(`/api/v1/browser/start?user_id=${encodeURIComponent(userId)}&open_tabs=1`);
  const ws = d?.ws?.puppeteer;
  if (!ws) throw new Error("AdsPower nao retornou ws.puppeteer");

  const browser = await chromium.connectOverCDP(ws);
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = ctx.pages()[0] || (await ctx.newPage());

  console.log(`🌐 Indo para: ${START_URL}`);
  await page.goto(START_URL, { waitUntil: "domcontentloaded" }).catch((e) =>
    console.log(`   (aviso ao navegar: ${e.message})`)
  );

  console.log("\n────────────────────────────────────────────────────");
  console.log(" O Playwright Inspector vai abrir.");
  console.log(" 1) Clique em  ● Record  no Inspector.");
  console.log(" 2) Faça os cliques na janela do AdsPower (BM real).");
  console.log(" 3) Copie o código gerado no Inspector.");
  console.log(" 4) Clique em  ▶ Resume  pra encerrar.");
  console.log("────────────────────────────────────────────────────");

  await page.pause(); // <- abre o Inspector com Record (codegen)

  console.log("\n✅ Gravação encerrada. NÃO fecho o perfil (deixo a sessão viva).");
  console.log("   Feche pelo AdsPower quando terminar, ou rode o runner.");
  // de proposito nao chamo browser/stop aqui: preserva a sessao pra você continuar.
  process.exit(0);
}

main().catch((e) => { console.error("Erro fatal:", e); process.exit(1); });
