// relatorio.mjs — relatorios TXT por execucao de etapa, em ./relatorios/.
// Cada entrada e gravada NA HORA que a etapa conclui numa BM (crash nao perde nada).

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const dois = (n) => String(n).padStart(2, "0");
const stampArquivo = (d) =>
  `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}_${dois(d.getHours())}${dois(d.getMinutes())}`;
const hora = (d = new Date()) => `${dois(d.getHours())}:${dois(d.getMinutes())}`;
const LINHA = "─".repeat(60);

export function makeRelatorio({ etapa, userId, dir = "./relatorios" }) {
  let caminho = null;
  let entradas = 0;
  let falhas = 0;

  function garantirArquivo() {
    if (caminho) return;
    mkdirSync(dir, { recursive: true });
    const d = new Date();
    caminho = join(dir, `relatorio_${etapa}_${stampArquivo(d)}.txt`);
    appendFileSync(
      caminho,
      `RELATÓRIO — ETAPA ${etapa.toUpperCase()}\n` +
      `Início: ${d.toLocaleString("pt-BR")}\n` +
      `Perfil AdsPower: ${userId || "?"}\n${LINHA}\n`,
      "utf8"
    );
  }

  function registrar(texto) {
    garantirArquivo();
    entradas++;
    appendFileSync(caminho, `[${hora()}] ${texto}\n${LINHA}\n`, "utf8");
  }

  function falha(texto) {
    garantirArquivo();
    falhas++;
    appendFileSync(caminho, `[${hora()}] ✖ ${texto}\n${LINHA}\n`, "utf8");
  }

  function fechar() {
    if (!caminho) return null; // nada foi processado — nao cria arquivo vazio
    appendFileSync(
      caminho,
      `Fim: ${new Date().toLocaleString("pt-BR")} — ${entradas} registro(s), ${falhas} falha(s).\n`,
      "utf8"
    );
    return caminho;
  }

  return { registrar, falha, fechar, get caminho() { return caminho; } };
}

// Texto do registro por etapa concluida numa BM.
export function textoEtapa(etapa, { cfg, bm, rec }) {
  const nome = rec.nome || `BM seq ${bm.seq ?? "?"}`;
  const token = String(bm.inviteLink || "").slice(-14);
  if (etapa === "convite") {
    return (
      `✔ Invite aceito — BM renomeada para: ${nome}\n` +
      `        business_id: ${rec.businessId || "(não capturado)"}\n` +
      `        LLC: ${bm.llcNome || "-"}\n` +
      `        invite (final): …${token}`
    );
  }
  if (etapa === "pagamento") {
    const d = cfg.defaults || {};
    return (
      `✔ Pagamento — ${nome}: cartão salvo + cobrança LLC configurada\n` +
      `        LLC: ${bm.llcNome || "-"} | País: ${d.pais || "-"} | Fuso: ${d.fuso || "-"}\n` +
      `        business_id: ${rec.businessId || "-"}`
    );
  }
  if (etapa === "contas") {
    const partner = cfg.defaults?.partnerBusinessId || "-";
    const feitas = (rec.contas || []).filter((c) => c.feita);
    const linhas = feitas.length
      ? feitas.map((c) => `        • ID ${c.id}: ${c.nome || "-"} — acesso ✓ · renomeada ✓ · parceiro ${partner} ✓`).join("\n")
      : "        (nenhuma conta registrada — modo posicional)";
    return `✔ Contas — ${nome}: ${feitas.length || "?"} conta(s) processada(s)\n${linhas}`;
  }
  return `✔ ${etapa} — ${nome}`;
}
