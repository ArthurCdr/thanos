// runner.mjs — modo TERMINAL: roda uma etapa da esteira (ou tudo) via readline.
// (O painel web faz a mesma coisa pelo navegador: node server.mjs)
//
// Uso:
//   node runner.mjs                          → etapa "tudo" com ./config.json
//   node runner.mjs --etapa=convite          → só aceitar convites + renomear BMs
//   node runner.mjs --etapa=pagamento        → só cartão + cobrança LLC
//   node runner.mjs --etapa=contas           → só contas (acesso/rename/parceiro)
//   node runner.mjs ./outro.json --etapa=contas

import { readFileSync } from "node:fs";
import { makeHelpers } from "./helpers.mjs";
import { executarEtapa } from "./orquestra.mjs";

const args = process.argv.slice(2);
const CONFIG_PATH = args.find((a) => a.endsWith(".json")) || "./config.json";
const etapa = (args.find((a) => a.startsWith("--etapa=")) || "--etapa=tudo").split("=")[1];

const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const h = makeHelpers(cfg);

executarEtapa({ cfg, h, etapa, progressPath: "./progress.json" })
  .catch((e) => {
    console.error("Erro fatal:", e);
    process.exitCode = 1;
  })
  .finally(() => h.close());
