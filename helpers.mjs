// helpers.mjs — interacao com o usuario + ritmo humano + degradacao pra manual.
// A camada de pergunta/pausa ("io") e plugavel:
//   - terminal (default): readline no console
//   - painel web (server.mjs): a pergunta vira um card com botoes no navegador
// tentar()  : acao automatica; se falhar, vira PAUSA manual (nunca lanca).
// opcional(): tenta, mas NAO pausa se nao aparecer (passos que podem nem existir).
// settle()  : espera a tela assentar depois de navegar/clicar.
// digitar() : modo "fill" (atomico) ou "humano" (char a char + validacao do valor final).
// marco()   : loga a URL atual (harvest dos enderecos reais de cada secao).

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// io de terminal (default): pergunta via readline.
export function ioTerminal() {
  const rl = readline.createInterface({ input, output });
  return {
    perguntar: ({ text, kind }) =>
      rl.question(`\n👉 ${text}${kind === "pause" ? "\n   [Enter pra continuar] " : " "}`),
    close: () => rl.close(),
  };
}

export function makeHelpers(cfg, io = ioTerminal()) {
  const pacing = cfg.pacing || {};
  const minMs = pacing.minMs ?? 1500;
  const maxMs = pacing.maxMs ?? 3500;
  const typeDelayMs = pacing.typeDelayMs ?? 120;
  const settleMs = pacing.settleMs ?? 1200;

  const ask = async (q) =>
    String(await io.perguntar({ text: q, kind: "ask" })).trim().toLowerCase();
  const pause = async (q) =>
    String(await io.perguntar({ text: q, kind: "pause" })).trim().toLowerCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const human = () => sleep(minMs + Math.random() * (maxMs - minMs));

  // Espera a pagina assentar depois de uma navegacao/clique que troca de tela.
  async function settle(page) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
    } catch {
      /* segue: timeout de load nao deve travar o fluxo */
    }
    await sleep(settleMs);
  }

  // Preenche um campo. Dois modos:
  //   modo "fill"   -> fill() atomico (campos com mascara, searchbox, IDs). fill ja valida valor.
  //   modo "humano" -> limpa de forma confiavel e digita caractere a caractere, e VALIDA o
  //                    valor final; se sair errado, LANCA -> tentar()/opcional() degradam pra manual
  //                    (em vez de salvar errado silenciosamente).
  async function digitar(loc, texto, { timeout = 6000, modo = "humano" } = {}) {
    const alvo = String(texto ?? "");
    await loc.click({ timeout });

    if (modo === "fill") {
      await loc.fill(alvo, { timeout });
      return;
    }

    // limpa de forma confiavel (fill("") + select-all/delete cobre campos que reescrevem)
    try { await loc.fill("", { timeout }); } catch { /* alguns campos nao aceitam fill vazio */ }
    await loc.press("ControlOrMeta+A").catch(() => {});
    await loc.press("Delete").catch(() => {});

    await loc.pressSequentially(alvo, { delay: typeDelayMs, timeout });

    // valida: compara so alfanumericos (mascara/acentos nao geram falso-positivo)
    let got = null;
    try { got = await loc.inputValue({ timeout: 1500 }); } catch { /* campo sem inputValue */ }
    if (got != null) {
      const norm = (s) => String(s).replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (norm(got) !== norm(alvo)) {
        throw new Error(`campo ficou "${got}", esperava "${alvo}"`);
      }
    }
  }

  const marco = (page, label) => console.log(`   🌐 [${label}] ${page.url()}`);

  async function tentar(label, fn) {
    try {
      await fn();
      console.log(`   ✓ ${label}`);
      return true;
    } catch (e) {
      console.log(`   ⚠ "${label}" nao rolou sozinho (${String(e.message).slice(0, 60)}…)`);
      await pause(`Faca manualmente: ${label}`);
      return false;
    }
  }

  async function opcional(label, fn) {
    try {
      await fn();
      console.log(`   ✓ (opcional) ${label}`);
      return true;
    } catch {
      console.log(`   – (opcional) ${label}: nao apareceu, seguindo.`);
      return false;
    }
  }

  return {
    ask, pause, human, settle, digitar, marco, tentar, opcional,
    close: () => io.close?.(),
  };
}
