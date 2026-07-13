// orquestra.mjs — esteira de etapas: abre o perfil AdsPower 1x e roda UMA etapa
// (convite | pagamento | contas) — ou "tudo" — para todas as BMs pendentes.
// Usado pelo terminal (runner.mjs) e pelo painel web (server.mjs).
//
// progress.json v3:
//   { versao: 3, bms: { <inviteLink>: {
//       seq, nome, businessId,
//       etapas: { convite, pagamento, contas },   // null ou timestamp ISO
//       contas: [{ id, nomeAtual, nome, feita }]
//   } } }
// Formatos antigos (done: [link | {link,nome,businessId}]) migram sozinhos:
// entrada antiga = BM totalmente concluida.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { chromium } from "playwright";
import { makeAdsPower } from "./adspower.mjs";
import { etapaConvite, etapaPagamento, etapaContas, nomeBM } from "./flow.mjs";
import { makeRelatorio, textoEtapa } from "./relatorio.mjs";

export const ETAPAS = ["convite", "pagamento", "contas"];
const FN_ETAPA = { convite: etapaConvite, pagamento: etapaPagamento, contas: etapaContas };

// Rede de seguranca de processo: erros de protocolo do navegador (ex.: dialogs
// "Sair da pagina?") chegam como rejeicao/excecao NAO tratada e, sem isso,
// matariam o processo inteiro (painel/terminal). Logamos e seguimos.
if (!globalThis.__bmGuard) {
  globalThis.__bmGuard = true;
  process.on("unhandledRejection", (e) =>
    console.log(`   ⚠ (ignorado) rejeição: ${String(e?.message || e).slice(0, 90)}`)
  );
  process.on("uncaughtException", (e) =>
    console.log(`   ⚠ (ignorado) exceção: ${String(e?.message || e).slice(0, 90)}`)
  );
}

// Aceita/descarta dialogs de uma page (senao o auto-handle do Playwright crasha).
function armarDialogos(alvo) {
  alvo.on("dialog", (d) => d.accept().catch(() => d.dismiss().catch(() => {})));
}

// Chave de progresso: invite link (BM nova) OU business_id (BM já aceita, sem invite).
export const chaveBM = (bm) =>
  bm.inviteLink || (bm.businessId ? `bid:${bm.businessId}` : JSON.stringify(bm));

const recordVazio = () => ({
  seq: null, nome: null, businessId: null,
  etapas: { convite: null, pagamento: null, contas: null },
  contas: [],
});

export function migrarProgress(progress) {
  if (progress?.versao === 3 && progress.bms) return progress;
  const novo = { versao: 3, bms: {} };
  for (const d of progress?.done || []) {
    const link = typeof d === "string" ? d : d.link;
    const nome = typeof d === "object" ? d.nome || null : null;
    const mSeq = String(nome || "").match(/(\d+)/);
    novo.bms[link] = {
      seq: mSeq ? Number(mSeq[1]) : null,
      nome,
      businessId: typeof d === "object" ? d.businessId || null : null,
      etapas: { convite: "migrado", pagamento: "migrado", contas: "migrado" },
      contas: [],
    };
  }
  return novo;
}

export function lerProgress(progressPath) {
  const bruto = existsSync(progressPath)
    ? JSON.parse(readFileSync(progressPath, "utf8"))
    : { done: [] };
  return migrarProgress(bruto);
}

export async function executarEtapa({ cfg, h, etapa = "tudo", progressPath = "./progress.json" }) {
  const etapasARodar = etapa === "tudo" ? ETAPAS : [etapa];
  if (etapa !== "tudo" && !ETAPAS.includes(etapa)) {
    console.log(`❌ Etapa desconhecida: "${etapa}" (use: ${ETAPAS.join(" | ")} | tudo)`);
    return { ok: false };
  }

  const ap = makeAdsPower(cfg);
  const bms = cfg.businessManagers || [];
  const userId = cfg.adspower?.userId;
  const SEQ_INICIAL = Number.isFinite(cfg.defaults?.seqInicial) ? cfg.defaults.seqInicial : 1;

  const pr = lerProgress(progressPath);
  const save = () => writeFileSync(progressPath, JSON.stringify(pr, null, 2));
  save(); // persiste a migracao logo de cara

  // proximo seq LIVRE: sempre acima de qualquer seq ja usado (recalcula a cada uso,
  // entao bumps por nome duplicado sao respeitados e nunca reutilizados).
  const proximoSeqLivre = () => {
    const usados = Object.values(pr.bms).map((r) => r.seq).filter(Number.isFinite);
    return Math.max(SEQ_INICIAL, ...(usados.length ? [Math.max(...usados) + 1] : [SEQ_INICIAL]));
  };

  // ha algo a fazer?
  const pendencia = (bm) => {
    const rec = pr.bms[chaveBM(bm)];
    return etapasARodar.some((e) => !rec?.etapas?.[e]);
  };
  const fila = bms.filter(pendencia);
  console.log(`\nEtapa: ${etapa.toUpperCase()} — ${fila.length}/${bms.length} BM(s) pendente(s).`);
  if (!fila.length) {
    console.log("Nada a fazer nessa etapa. ✅");
    return { ok: true, concluidas: 0 };
  }
  if (!userId) {
    console.log("❌ Faltou adspower.userId no config.");
    return { ok: false, motivo: "sem adspower.userId" };
  }

  const rel = makeRelatorio({ etapa, userId });
  let started = false;
  let browser;
  let feitas = 0;
  try {
    console.log(`\n🟢 Abrindo perfil AdsPower ${userId}…`);
    const ws = await ap.startProfile(userId);
    started = true;
    browser = await chromium.connectOverCDP(ws);
    const browserCtx = browser.contexts()[0] || (await browser.newContext());
    const page = browserCtx.pages()[0] || (await browserCtx.newPage());
    // trata dialogs (pagina atual + qualquer popup/aba nova) pra nao crashar
    armarDialogos(page);
    browserCtx.on("page", armarDialogos);

    for (let i = 0; i < bms.length; i++) {
      const bm = bms[i];
      const link = chaveBM(bm);
      const rec = (pr.bms[link] ||= recordVazio());
      const pendentes = etapasARodar.filter((e) => !rec.etapas[e]);
      if (!pendentes.length) {
        console.log(`\n⏭  BM ${i + 1} (${rec.nome || "?"}): etapa(s) já feita(s), pulando.`);
        continue;
      }

      // hidrata a BM com o que ja sabemos (etapas anteriores)
      if (rec.seq == null && pendentes.includes("convite")) rec.seq = proximoSeqLivre();
      bm.seq = rec.seq;
      bm.businessId = rec.businessId || bm.businessId || null;
      bm.contas = rec.contas || [];

      const ctx = {
        page, cfg, bm, h,
        salvarBM: () => { rec.contas = bm.contas || []; rec.seq = bm.seq; save(); },
        // chamado quando o rename da BM pula pro proximo numero por nome duplicado
        bumpSeq: (n) => { rec.seq = bm.seq = n; save(); },
      };

      try {
        for (const e of pendentes) {
          if (e !== "convite" && !bm.businessId) {
            console.log(`\n⚠ BM ${i + 1}: sem business_id salvo — rode a etapa CONVITE primeiro. Pulando.`);
            break;
          }
          if (e !== "convite" && bm.seq == null) {
            // BM migrada sem seq: atribui um agora pra derivar nomes de conta
            rec.seq = bm.seq = proximoSeqLivre();
          }
          await FN_ETAPA[e](ctx);
          // persiste tudo que a etapa descobriu (rec.seq pode ter mudado por auto-skip)
          rec.seq = bm.seq;
          rec.businessId = bm.businessId || rec.businessId;
          rec.nome = rec.seq != null ? nomeBM(cfg, bm) : rec.nome;
          rec.contas = bm.contas || rec.contas;
          rec.etapas[e] = new Date().toISOString();
          save();
          rel.registrar(textoEtapa(e, { cfg, bm, rec }));
          console.log(`\n✅ ${rec.nome || `BM ${i + 1}`}: etapa ${e.toUpperCase()} concluída.`);
          feitas++;
        }
      } catch (e2) {
        console.log(`\n❌ ${rec.nome || `BM ${i + 1}`} falhou: ${e2.message}`);
        rel.falha(`${rec.nome || `BM ${i + 1}`} falhou: ${e2.message}`);
        if ((await h.ask("Pular pra próxima BM? (s/n)")) === "n") break;
        continue;
      }

      const restam = bms.slice(i + 1).some(pendencia);
      if (restam && (await h.ask("Próxima BM? (s = continua / p = pausa e sai)")) === "p") break;
    }
  } finally {
    if (started) {
      console.log(`\n🔴 Fechando perfil ${userId}…`);
      await ap.stopProfile(userId).catch(() => {});
    }
    if (browser) await browser.close().catch(() => {});
    const arq = rel.fechar();
    if (arq) console.log(`📄 Relatório salvo: ${arq}`);
    console.log("Fim. Rode de novo quando quiser — retoma de onde parou.");
  }
  return { ok: true, concluidas: feitas, relatorio: rel.caminho };
}
