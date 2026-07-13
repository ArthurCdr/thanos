// flow.mjs — etapas do fluxo por BM (UI da Meta em PT-BR).
// Cada acao automatica passa por h.tentar() (degrada pra pausa manual);
// passos que podem nem aparecer usam h.opcional() (nao pausam).
// Antes de cada navegacao chamamos h.settle(page) (espera a tela) e depois
// h.marco(page, ...) (loga a URL — pra harvestar os enderecos reais de cada secao).
// Fonte da verdade do fluxo: docs/codegen-original-2026-06-30.txt

const RE_BUSINESS_ID = /business_id=(\d+)/;

export function nomeBM(cfg, bm) {
  const padrao = cfg.defaults?.padraoNomeBM || "AT{n}";
  return padrao.replaceAll("{n}", String(bm.seq));
}
export function nomeConta(cfg, bm, c) {
  const padrao = cfg.defaults?.padraoNomeConta || "CA{c}-AT{n}";
  return padrao.replaceAll("{c}", String(c)).replaceAll("{n}", String(bm.seq));
}

// c-esima linha de DADOS da tabela de contas (exclui cabecalho/columnheader), 0-based.
function linhaConta(page, c) {
  return page
    .getByRole("row")
    .filter({ hasNot: page.getByRole("columnheader") })
    .nth(c - 1);
}

// URLs reais (capturadas no teste) — navegamos por URL usando o business_id,
// em vez de depender do menu lateral dinamico que dava timeout.
const BASE = "https://business.facebook.com/latest";
const url = {
  settings: (id) => `${BASE}/settings/?business_id=${id}`,
  paymentMethods: (id) => `${BASE}/billing_hub/payment_methods/?business_id=${id}`, // cartao + cobranca LLC
  billingAccounts: (id) => `${BASE}/billing_hub/accounts/?business_id=${id}`,        // atribuir acesso (3 contas)
  adAccounts: (id) => `${BASE}/settings/ad_accounts?business_id=${id}`,              // renomear conta + parceiro
};

// Navega por URL + espera a tela + loga a URL final (harvest).
async function irPara(ctx, urlStr, label) {
  const { page, h } = ctx;
  await page.goto(urlStr, { waitUntil: "domcontentloaded" }).catch((e) =>
    console.log(`   ⚠ goto ${label} falhou: ${String(e.message).slice(0, 40)}`)
  );
  await h.settle(page);
  h.marco(page, label);
}

// Procura um textbox por nome acessivel na pagina E em todos os iframes.
// Resolve o caso do formulario de cartao, que costuma ficar dentro de um iframe.
async function textboxEmFrames(page, name) {
  for (const f of page.frames()) {
    try {
      const loc = f.getByRole("textbox", { name });
      if (await loc.count()) return loc.first();
    } catch {
      /* frame pode ter sido destruido durante a busca */
    }
  }
  return null;
}

// Harvest: lista os botoes (aria-label/texto) de um escopo — pra achar o nome
// real do kebab "3 pontinhos" e do "Atribuir acesso" (botoes de icone nao saem no texto).
async function logBotoes(scope, label) {
  try {
    const btns = scope.getByRole("button");
    const n = await btns.count();
    const nomes = [];
    for (let i = 0; i < Math.min(n, 18); i++) {
      const al = await btns.nth(i).getAttribute("aria-label").catch(() => null);
      const tx = (await btns.nth(i).innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      nomes.push((al || tx || "(sem nome)").slice(0, 30));
    }
    console.log(`   🔘 [${label}] ${n} botao(es): ${nomes.join(" | ")}`);
  } catch (e) {
    console.log(`   🔘 [${label}] nao consegui listar botoes (${String(e.message).slice(0, 40)})`);
  }
}

// Harvest: lista as linhas da tabela de contas (texto + ids) no console,
// pra eu mapear o DOM real e depois selecionar conta por ID em vez de posicao.
async function logContas(page, label) {
  try {
    const rows = page.getByRole("row").filter({ hasNot: page.getByRole("columnheader") });
    const n = await rows.count();
    console.log(`   📋 [${label}] ${n} linha(s) de conta detectada(s):`);
    for (let i = 0; i < Math.min(n, 8); i++) {
      const t = (await rows.nth(i).innerText()).replace(/\s+/g, " ").trim().slice(0, 100);
      console.log(`      [${i}] ${t}`);
    }
  } catch (e) {
    console.log(`   📋 [${label}] nao consegui ler as linhas (${String(e.message).slice(0, 40)})`);
  }
}

// Detecta mensagem de erro de nome (duplicado / em uso) VISIVEL na tela.
// Retorna o texto do erro, ou null. E o que impede o "✓ falso" pos-salvar.
const RE_ERRO_NOME = /j[áa]\s+(existe|em uso|est[áa]\s+em uso|foi\s+(usad|utilizad)o)|duplicad|n[ãa]o\s+(est[áa]\s+)?dispon[ií]vel|already\s+(exists|in use|taken)|is\s+(already\s+)?taken|name.{0,20}in use/i;
async function erroDeNome(page) {
  try {
    const loc = page.getByText(RE_ERRO_NOME);
    const n = await loc.count();
    for (let i = 0; i < Math.min(n, 6); i++) {
      const el = loc.nth(i);
      if (await el.isVisible().catch(() => false)) {
        return (await el.innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 90) || "nome em uso";
      }
    }
  } catch { /* ignore */ }
  return null;
}

// 1-4: aceitar convite (+ nome opcional), reauth manual, capturar business_id
export async function aceitarConvite(ctx) {
  const { page, h, cfg, bm } = ctx;
  console.log(`\n=== ${nomeBM(cfg, bm)} (seq ${bm.seq}) — abrindo convite ===`);
  // BM já aceita (sem invite link): só precisa do business_id — pula o aceite.
  if (!bm.inviteLink) {
    console.log("   (sem invite link — BM já aceita; pulando o aceite)");
    if (bm.businessId) await irPara(ctx, url.settings(bm.businessId), "settings (BM já aceita)");
    return;
  }
  await page.goto(bm.inviteLink, { waitUntil: "domcontentloaded" });
  await h.settle(page);

  const resp = await h.ask("Aceitar convite? (s = automatico / m = faco manual)");
  if (resp === "m") {
    await h.pause("Aceite o convite manualmente (login/senha se pedir).");
  } else {
    await h.opcional("Continuar com o Facebook", async () => {
      await page.getByRole("button", { name: "Continuar com o Facebook" }).first().click({ timeout: 8000 });
    });
    await h.settle(page);
    // Tela de Nome/Sobrenome (convite multi-admin do Instagram) — pode nao aparecer
    if (bm.admin?.nome) {
      await h.opcional("preencher Nome/Sobrenome", async () => {
        await h.digitar(page.getByRole("textbox", { name: "Nome", exact: true }), bm.admin.nome, { timeout: 5000 });
        await h.digitar(page.getByRole("textbox", { name: "Sobrenome" }), bm.admin.sobrenome || "", { timeout: 5000 });
      });
      await h.human();
    }
    // Avancar a(s) tela(s) do convite — na gravacao foram DOIS "Continuar".
    await h.opcional("Continuar (1a tela do convite)", async () => {
      await page.getByRole("button", { name: "Continuar" }).first().click({ timeout: 5000 });
    });
    await h.settle(page);
    await h.opcional("Continuar (2a tela do convite)", async () => {
      await page.getByRole("button", { name: "Continuar" }).first().click({ timeout: 5000 });
    });
    await h.settle(page);
    await h.tentar("clicar em Aceitar convite", async () => {
      await page.getByRole("button", { name: "Aceitar convite" }).first().click({ timeout: 8000 });
    });
  }

  // Reautenticacao de senha — SEMPRE manual (nunca automatizar senha)
  await h.pause("Se aparecer o campo de SENHA (reautenticacao), digite e confirme. Depois Enter.");
  await h.settle(page);

  // Captura business_id: URL atual -> senao raspa o HTML da pagina.
  h.marco(page, "pos-aceite");
  let m = page.url().match(RE_BUSINESS_ID);
  if (!m) {
    try { m = (await page.content()).match(RE_BUSINESS_ID); } catch { /* ignore */ }
  }
  if (m) {
    bm.businessId = m[1];
    console.log(`   ↳ business_id: ${bm.businessId}`);
  } else {
    console.log("   ⚠ business_id nao encontrado (navegacao por URL fica indisponivel nesta rodada).");
  }
}

// 5: renomear a BM — com verificacao pos-salvar + auto-skip pro proximo numero
// livre quando a Meta recusa por nome duplicado (nunca marca ✓ falso).
export async function renomearBM(ctx) {
  const { page, h, cfg, bm } = ctx;
  console.log(`\n-- renomeando BM para "${nomeBM(cfg, bm)}" --`);
  if (bm.businessId) await irPara(ctx, url.settings(bm.businessId), "Configuracoes");
  else await h.settle(page);
  await h.tentar("abrir Informacoes da empresa", async () => {
    await page.getByRole("link", { name: "Informações da empresa" }).first().click({ timeout: 8000 });
  });
  await h.settle(page);
  h.marco(page, "Informacoes da empresa");

  const MAX = 12;
  for (let tent = 1; tent <= MAX; tent++) {
    const nome = nomeBM(cfg, bm);
    try {
      await page.getByRole("button", { name: "Editar" }).first().click({ timeout: 6000 });
      await h.digitar(page.getByRole("textbox", { name: "Nome da empresa" }), nome, { timeout: 6000 });
      await page.getByRole("button", { name: "Salvar" }).first().click({ timeout: 6000 });
      await h.settle(page);
      const err = await erroDeNome(page);
      if (err) {
        console.log(`   ↷ "${nome}" recusado (${err}) → pulando pro próximo número`);
        bm.seq = (Number(bm.seq) || 0) + 1;
        ctx.bumpSeq?.(bm.seq);
        continue; // tenta AT(n+1)
      }
      console.log(`   ✓ Nome da empresa = ${nome}`);
      await h.human();
      return;
    } catch (e) {
      console.log(`   ⚠ "editar Nome da empresa" nao rolou sozinho (${String(e.message).slice(0, 50)}…)`);
      await h.pause(`Renomeie a BM para "${nome}" manualmente na janela. Depois Enter.`);
      await h.human();
      return;
    }
  }
  console.log("   ⚠ muitos nomes duplicados seguidos — parei.");
  await h.pause("Defina o nome da BM manualmente (e ajuste o seqInicial). Depois Enter.");
}

// Abre um combo (País/Moeda) clicando no CONTROLE clicável — não no <span> do
// rótulo (que não recebe clique). Tenta combobox/button por nome, senão sobe
// pro ancestral clicável do rótulo. Lança se não achar (→ tentar() vira manual).
// Acha o CONTROLE clicável do combo (não o <span> do rótulo). Usado tanto pra
// abrir quanto pra LER o valor (o valor selecionado fica no controle, não no rótulo).
async function acharCombo(page, labelRe) {
  const estrategias = [
    () => page.getByRole("combobox", { name: labelRe }),
    () => page.getByRole("button", { name: labelRe }),
    () => page.getByText(labelRe).first()
      .locator("xpath=ancestor-or-self::*[@role='combobox' or @role='button' or @tabindex='0'][1]"),
    () => page.getByText(labelRe).first().locator("xpath=ancestor::div[2]"),
    () => page.getByText(labelRe).first().locator("xpath=ancestor::div[1]"),
  ];
  for (const mk of estrategias) {
    try { const l = mk(); if (await l.count()) return l.first(); } catch { /* proxima */ }
  }
  return null;
}
async function abrirCombo(page, labelRe) {
  const c = await acharCombo(page, labelRe);
  if (!c) throw new Error("não achei o combo clicável (só o rótulo)");
  await c.click({ timeout: 3500 });
}
// Lê o texto do combo (rótulo + valor selecionado) — pra verificar sem cegueira.
async function valorCombo(page, labelRe) {
  const c = await acharCombo(page, labelRe);
  if (!c) return "";
  return String(await c.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
}

// Define País + Moeda na tela "Adicionar dados de pagamento" (antes do Avançar).
// A opção de país é um <div> com texto EXATO (nth(1) = div interno clicável).
// A moeda às vezes já vem certa ao escolher o país — só troca se estiver diferente.
export async function definirPaisMoeda(ctx) {
  const { page, h, cfg } = ctx;
  const d = cfg.defaults || {};

  // ESPERA o modal "Adicionar dados de pagamento" (País/região) renderizar.
  // É um modal client-side (não dispara rede), então o settle passa reto — sem
  // esta espera, agimos antes do combo existir e não achamos nada.
  const apareceu = await h.esperar(page.getByText(/País\/região/i), { timeout: 12000 });
  if (!apareceu) {
    console.log("   ⚠ tela de País/região não apareceu a tempo — pausando.");
    await h.pause("Abra/confirme a tela de forma de pagamento (com País/região). Depois Enter.");
  }
  await h.human();

  console.log(`   🔎 País (combo): "${(await valorCombo(page, /País\/região/i)).slice(0, 50)}"`);

  await h.tentar(`definir País = ${d.pais}`, async () => {
    // já está certo? não mexe (ex.: 2ª forma de pagamento herda o país)
    if ((await valorCombo(page, /País\/região/i)).includes(d.pais)) {
      console.log("   ✓ país já estava correto (não mexi)");
      return;
    }
    await abrirCombo(page, /País\/região/i);
    await h.human();
    const reExato = new RegExp("^" + String(d.pais).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
    const opt = page.locator("div").filter({ hasText: reExato });
    await ((await opt.count()) > 1 ? opt.nth(1) : opt.first()).click({ timeout: 6000 });
    // VERIFICA lendo o VALOR do combo (não o rótulo)
    const ctrl = await valorCombo(page, /País\/região/i);
    if (!ctrl.includes(d.pais)) {
      throw new Error(`país não mudou (combo: "${ctrl.slice(0, 50)}")`);
    }
    console.log("   ✓ país confirmado");
  });
  await h.human();

  if (d.moeda) {
    await h.tentar(`definir Moeda = ${d.moeda}`, async () => {
      if ((await valorCombo(page, /Moeda/i)).includes(d.moeda)) {
        console.log("   ✓ moeda já estava correta (não mexi)");
        return;
      }
      await abrirCombo(page, /Moeda/i);
      await h.human();
      const lista = page.getByLabel("Lista suspensa");
      const opt = (await lista.count())
        ? lista.getByText(d.moeda, { exact: true })
        : page.getByText(d.moeda, { exact: true });
      await opt.first().click({ timeout: 5000 });
      const ctrl = await valorCombo(page, /Moeda/i);
      if (!ctrl.includes(d.moeda)) {
        throw new Error(`moeda não mudou (combo: "${ctrl.slice(0, 50)}")`);
      }
      console.log("   ✓ moeda trocada e confirmada");
    });
    await h.human();
  }
}

// 6: adicionar cartao (nome/validade/CEP auto via frames; numero+CVV manuais)
export async function addCartao(ctx) {
  const { page, h, cfg, bm } = ctx;
  const cartao = cfg.defaults?.cartao || {};
  console.log("\n-- adicionando cartao --");
  if (bm.businessId) {
    await irPara(ctx, url.paymentMethods(bm.businessId), "Formas de pagamento (cartao)");
  } else {
    await h.settle(page);
    await h.tentar("abrir Cobranca e pagamentos", async () => {
      await page.getByRole("link", { name: "Cobrança e pagamentos" }).first().click({ timeout: 8000 });
    });
    await h.settle(page);
  }
  await h.tentar("abrir Formas de pagamento", async () => {
    await page.getByRole("link", { name: "Formas de pagamento" }).first().click({ timeout: 6000 });
  });
  await h.settle(page);
  await h.tentar("clicar em Adicionar", async () => {
    await page.getByRole("button", { name: /Adicionar forma de pagamento|Adicionar/ }).first().click({ timeout: 6000 });
  });
  await h.settle(page);

  // >>> País + Moeda ficam NESTA tela (antes do Avançar). Se não setar aqui,
  //     o cartão é criado no país padrão do perfil (ex.: Vietnã). <<<
  await definirPaisMoeda(ctx);

  await h.tentar("avancar (tela 1)", async () => {
    await page.getByRole("button", { name: "Avançar" }).first().click({ timeout: 6000 });
  });
  await h.settle(page);
  await h.opcional("avancar (tela 2)", async () => {
    await page.getByRole("button", { name: "Avançar" }).first().click({ timeout: 4000 });
  });
  await h.settle(page);

  // Diagnostico: quantos frames? (campo de cartao costuma ficar em iframe)
  console.log(`   (diagnostico: ${page.frames().length} frame(s) na tela do cartao)`);

  // Campos nao-sensiveis (nome/validade/CEP) — procura na pagina E nos iframes
  await h.opcional(`nome no cartao = ${cartao.nome || ""}`, async () => {
    const loc = await textboxEmFrames(page, "Nome no cartão");
    if (!loc) throw new Error("campo nao encontrado");
    await h.digitar(loc, cartao.nome || "");
  });
  await h.opcional(`validade = ${cartao.validade || ""}`, async () => {
    const loc = await textboxEmFrames(page, "MM/AA");
    if (!loc) throw new Error("campo nao encontrado");
    await h.digitar(loc, cartao.validade || "", { modo: "fill" }); // mascara MM/AA
  });
  await h.opcional(`CEP do cartao = ${cartao.cep || ""}`, async () => {
    const loc = await textboxEmFrames(page, "Código postal");
    if (!loc) throw new Error("campo nao encontrado");
    await h.digitar(loc, cartao.cep || "", { modo: "fill" }); // CEP (mascara/numerico)
  });

  // SENSIVEL: numero + CVV sempre manuais
  console.log("\n   ──────────── CARTAO (MANUAL) ────────────");
  console.log(`   BM ${nomeBM(cfg, bm)} — use o cartao descartavel DESTA BM.`);
  console.log("   Preencha NUMERO + CVV (e nome/validade/CEP se nao tiverem preenchido).");
  console.log("   ──────────────────────────────────────────");
  await h.pause("Confira o cartao e preencha o que faltar. Depois Enter.");

  await h.tentar("Salvar cartao", async () => {
    await page.getByRole("button", { name: "Salvar" }).first().click({ timeout: 6000 });
  });
  await h.opcional("Concluir", async () => {
    await page.getByRole("button", { name: "Concluir" }).first().click({ timeout: 5000 });
  });
  await h.human();
}

// Define o Fuso horário (fica na MESMA tela de País/Moeda, antes do Avançar).
// Botão mostra o valor atual (…GMT…); abre searchbox, filtra e escolhe a opção.
async function definirFuso(ctx) {
  const { page, h, cfg } = ctx;
  const fuso = cfg.defaults?.fuso;
  if (!fuso) return;
  const reFuso = new RegExp(fuso.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  await h.tentar(`definir Fuso = ${fuso}`, async () => {
    const atual0 = await page.getByRole("button", { name: /GMT/ }).first().innerText().catch(() => "");
    if (reFuso.test(atual0)) { console.log(`   ✓ fuso já estava com ${fuso}`); return; }
    await page.getByRole("button", { name: /GMT/ }).first().click({ timeout: 6000 });
    await h.esperar(page.getByRole("searchbox"), { timeout: 4000 });
    await page.getByRole("searchbox").first().fill(fuso, { timeout: 5000 });
    await h.human();
    // opção é um <div> cujo texto começa com o fuso; pega o nth clicável
    const opt = page.locator("div").filter({ hasText: new RegExp("^" + fuso.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") });
    const n = await opt.count();
    await (n > 2 ? opt.nth(2) : n > 1 ? opt.nth(1) : opt.first()).click({ timeout: 5000 });
    const btn = await page.getByRole("button", { name: /GMT/ }).first().innerText().catch(() => "");
    if (!reFuso.test(btn)) {
      throw new Error(`fuso não mudou (botão: "${String(btn).replace(/\s+/g, " ").slice(0, 40)}")`);
    }
    console.log("   ✓ fuso confirmado");
  });
  await h.human();
}

// Abre a conta na lista de billing (por ID/nome quando conhecido, senão posição).
async function abrirContaBilling(page, c, conta) {
  const clicar = async (loc) => {
    const n = await loc.count();
    if (!n) return false;
    await (n > 1 ? loc.nth(1) : loc.first()).click({ timeout: 5000 }); // n>1: pega o clicável interno
    return true;
  };
  if (conta?.nomeAtual) {
    const re = new RegExp(conta.nomeAtual.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (await clicar(page.getByRole("button", { name: re }))) return;
  }
  if (conta?.id) {
    if (await clicar(page.getByRole("button", { name: new RegExp(conta.id) }))) return;
  }
  // posição: c-ésimo botão de conta
  const l = page.getByRole("button", { name: /Identifica[cç][aã]o:/i });
  const n = await l.count();
  if (n) { await l.nth(Math.min(c - 1, n - 1)).click({ timeout: 5000 }); return; }
  throw new Error("não achei a conta na lista de billing");
}

// 7: cobranca LLC POR CONTA — abre a conta em billing, adiciona forma de pagamento
// (pais/moeda/fuso/endereco) e define como padrao.
export async function addCobrancaLLC(ctx, c = 1, conta = null) {
  const { page, h, cfg, bm } = ctx;
  const end = cfg.defaults?.endereco || {};
  console.log(`\n-- cobrança LLC [conta ${c}${conta?.id ? ` · ID ${conta.id}` : ""}] --`);

  // 1) lista de contas (billing) → abre a conta
  if (bm.businessId) await irPara(ctx, url.billingAccounts(bm.businessId), "Contas (cobrança)");
  else await h.settle(page);
  await h.tentar(`abrir a conta ${conta?.nomeAtual ? `"${conta.nomeAtual}"` : conta?.id ? `ID ${conta.id}` : `nº ${c}`}`, async () => {
    await abrirContaBilling(page, c, conta);
  });
  await h.settle(page);

  // 2) Adicionar forma de pagamento (desta conta)
  await h.tentar("Adicionar forma de pagamento", async () => {
    await page.getByRole("button", { name: /Adicionar forma de pagamento/ }).first().click({ timeout: 6000 });
  });
  await h.settle(page);

  // 3) País + Moeda + Fuso — todos na MESMA tela (antes do Avançar)
  await definirPaisMoeda(ctx);
  await definirFuso(ctx);

  // 4) Avançar → endereço (digitado completo)
  await h.tentar("Avancar", async () => {
    await page.getByRole("button", { name: "Avançar" }).first().click({ timeout: 6000 });
  });
  await h.settle(page);
  await h.tentar("abrir Editar do endereco", async () => {
    await page.getByRole("button", { name: "Editar" }).nth(1).click({ timeout: 6000 });
  });
  await h.tentar(`nome (LLC) = ${bm.llcNome}`, async () => {
    await h.digitar(page.getByRole("textbox", { name: "Adicione um nome" }), bm.llcNome || "", { timeout: 5000 });
  });
  await h.tentar(`Endereço 1 = ${end.endereco1}`, async () => {
    // digita completo (fill) e fecha o autocomplete de endereço pra não interceptar
    await h.digitar(page.getByRole("textbox", { name: "Endereço 1" }), end.endereco1 || "", { timeout: 5000, modo: "fill" });
    await page.keyboard.press("Escape").catch(() => {});
  });
  await h.opcional("marcar 'endereco legal registrado'", async () => {
    await page.getByText("O endereço legal registrado").first().click({ timeout: 4000 });
  });
  await h.tentar(`Cidade = ${end.cidade}`, async () => {
    await h.digitar(page.getByRole("textbox", { name: "Cidade" }), end.cidade || "", { timeout: 5000 });
  });
  await h.tentar(`CEP = ${end.cep}`, async () => {
    await h.digitar(page.getByRole("textbox", { name: "Código postal" }), end.cep || "", { timeout: 5000, modo: "fill" });
  });
  await h.tentar(`Estado = ${end.estado}`, async () => {
    // já certo? (não mexe)
    if ((await valorCombo(page, /^Estado$/i)).includes(end.estado)) { console.log("   ✓ estado já ok"); return; }
    // abre o combo de Estado (select como país/moeda) — o combobox que tem o label "Estado"
    await page.getByRole("combobox").locator("div").filter({ hasText: /^Estado$/ }).first().click({ timeout: 5000 });
    await h.human();
    // opção é um <div> com texto EXATO do estado (nth(1) = div interno clicável, igual país)
    const reEstado = new RegExp("^" + end.estado.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
    const opt = page.locator("div").filter({ hasText: reEstado });
    await ((await opt.count()) > 1 ? opt.nth(1) : opt.first()).click({ timeout: 5000 });
    // verifica pelo valor do combo
    const v = await valorCombo(page, /^Estado$/i);
    if (!v.includes(end.estado)) throw new Error(`estado não mudou (combo: "${v.slice(0, 40)}")`);
    console.log("   ✓ estado confirmado");
  });
  await h.human();

  // 5) Salvar → Definir como padrão → Salvar
  await h.tentar("Salvar endereco", async () => {
    await page.getByRole("button", { name: "Salvar" }).first().click({ timeout: 6000 });
  });
  await h.settle(page);
  await h.opcional("Definir como padrao", async () => {
    await page.getByRole("button", { name: "Definir como padrão" }).first().click({ timeout: 5000 });
  });
  await h.opcional("Salvar (confirmar padrao)", async () => {
    await page.getByRole("button", { name: "Salvar" }).first().click({ timeout: 5000 });
  });
  await h.human();
}

// Descoberta: le a lista de contas (billing_hub/accounts mostra "Identificação: <id>")
// e devolve [{ id, nomeAtual }] — dai em diante trabalhamos por ID, nao por posicao.
// Busca as contas de anúncio via Graph API, rodando DENTRO da aba do AdsPower
// (mesma sessão/IP → antidetect). Usa o token EAA que já está na própria página.
// Retorna [{id, nomeAtual}] ou null se não deu (aí cai no scraping do DOM).
async function contasViaAPI(page, businessId) {
  try {
    const res = await page.evaluate(async (bid) => {
      const txt = [document.documentElement.innerHTML, ...[...document.scripts].map((s) => s.textContent || "")].join("\n");
      const m = txt.match(/EAA[A-Za-z0-9]{20,}/);
      if (!m) return { erro: "sem token EAA na página" };
      const token = m[0];
      const u = `https://graph.facebook.com/v21.0/${bid}/owned_ad_accounts?fields=name,account_id&limit=200&access_token=${token}`;
      try { const r = await fetch(u); return await r.json(); }
      catch (e) { return { erro: String((e && e.message) || e) }; }
    }, businessId);
    if (res && Array.isArray(res.data)) {
      return res.data
        .map((a) => ({ id: String(a.account_id || a.id || "").replace(/^act_/, ""), nomeAtual: a.name || null }))
        .filter((a) => a.id);
    }
    console.log(`   ⚠ API de contas não retornou lista: ${JSON.stringify(res).slice(0, 120)}`);
    return null;
  } catch (e) {
    console.log(`   ⚠ contasViaAPI: ${String(e.message).slice(0, 50)}`);
    return null;
  }
}

export async function descobrirContas(ctx) {
  const { page, h, bm } = ctx;
  console.log("\n-- descobrindo contas de anuncios (IDs) --");
  if (bm.businessId) await irPara(ctx, url.billingAccounts(bm.businessId), "Contas (descoberta)");
  else await h.settle(page);

  // 1) tenta pela API (token da própria aba) — nome + id sem depender do DOM
  if (bm.businessId) {
    const viaApi = await contasViaAPI(page, bm.businessId);
    if (viaApi && viaApi.length) {
      console.log(`   ↳ (API) ${viaApi.length} conta(s):`);
      viaApi.forEach((a, i) => console.log(`      ${i + 1}. ${a.nomeAtual || "(sem nome)"} — ID ${a.id}`));
      return viaApi;
    }
  }

  // 2) fallback: raspa o DOM
  const achadas = [];
  try {
    // as contas aparecem como BOTÕES com "Identificação: <id>" (às vezes duplicados).
    let itens = page.getByRole("button", { name: /Identifica[cç][aã]o:/i });
    if (!(await itens.count())) {
      itens = page.getByRole("row").filter({ hasNot: page.getByRole("columnheader") });
    }
    const n = await itens.count();
    for (let i = 0; i < Math.min(n, 20); i++) {
      const t = (await itens.nth(i).innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const m = t.match(/Identifica[cç][aã]o:?\s*(\d{6,})/i);
      if (m && !achadas.some((a) => a.id === m[1])) {
        achadas.push({ id: m[1], nomeAtual: t.slice(0, t.indexOf(m[0])).trim() || null });
      }
    }
  } catch (e) {
    console.log(`   ⚠ descoberta falhou (${String(e.message).slice(0, 40)})`);
  }
  if (achadas.length) {
    console.log(`   ↳ ${achadas.length} conta(s):`);
    achadas.forEach((a, i) => console.log(`      ${i + 1}. ${a.nomeAtual || "(sem nome)"} — ID ${a.id}`));
  } else {
    console.log("   ⚠ nenhuma conta identificada — sigo no modo posicional (linha 1, 2, 3…).");
  }
  return achadas;
}

// Linha da conta: por ID quando conhecido (robusto), senao posicional (fallback).
function linhaPorContaOuPosicao(page, c, conta) {
  if (conta?.id) return page.getByRole("row").filter({ hasText: conta.id }).first();
  return linhaConta(page, c);
}

// 8a: atribuir acesso a conta c
export async function atribuirAcesso(ctx, c, conta = null) {
  const { page, h, bm } = ctx;
  console.log(`\n-- [conta ${c}${conta?.id ? ` · ID ${conta.id}` : ""}] atribuir acesso --`);
  // acesso fica em billing_hub/accounts (as 3 contas com Identificação aparecem aqui)
  if (bm.businessId) {
    await irPara(ctx, url.billingAccounts(bm.businessId), "Contas (acesso)");
  } else {
    await h.settle(page);
    await h.tentar("abrir Contas", async () => {
      await page.getByRole("link", { name: "Contas" }).first().click({ timeout: 6000 });
    });
    await h.settle(page);
  }
  await logContas(page, "Contas (acesso)");
  await h.tentar(`selecionar a conta ${conta?.id ? `ID ${conta.id}` : `nº ${c}`}`, async () => {
    await linhaPorContaOuPosicao(page, c, conta).click({ timeout: 6000 });
  });
  await h.settle(page);
  h.marco(page, "apos selecionar conta (acesso)"); // harvest: pra onde abre a conta
  await logBotoes(page, "apos selecionar conta (acesso)"); // harvest: nome real do 'Atribuir acesso'
  await h.tentar("Atribuir acesso (abrir)", async () => {
    await page.getByRole("button", { name: "Atribuir acesso" }).first().click({ timeout: 6000 });
  });
  await h.opcional("Atribuir acesso (confirmar)", async () => {
    await page.getByRole("button", { name: "Atribuir acesso" }).first().click({ timeout: 4000 });
  });
  await h.opcional("Concluir", async () => {
    await page.getByRole("button", { name: "Concluir" }).first().click({ timeout: 5000 });
  });
  await h.human();
}

// 8b: renomear conta de anuncios c
// Na pagina de Contas de anuncios o ID nao aparece na linha — casamos pelo NOME
// atual (vindo da descoberta); se ja renomeada (retomada), pelo nome novo; senao posicao.
export async function renomearConta(ctx, c, conta = null) {
  const { page, h, cfg, bm } = ctx;
  const nome = nomeConta(cfg, bm, c);
  console.log(`\n-- [conta ${c}] renomear para "${nome}" --`);
  if (bm.businessId) {
    await irPara(ctx, url.adAccounts(bm.businessId), "Contas de anuncios");
  } else {
    await h.settle(page);
    await h.tentar("abrir Contas de anuncios", async () => {
      await page.getByRole("link", { name: "Contas de anúncios" }).first().click({ timeout: 6000 });
    });
    await h.settle(page);
  }
  await logContas(page, "Contas de anuncios");
  // seleciona a conta pelo gridcell do nome atual (da descoberta); senão nome novo; senão posição
  await h.tentar(`selecionar conta ${conta?.nomeAtual ? `"${conta.nomeAtual}"` : `nº ${c}`}`, async () => {
    for (const alvo of [conta?.nomeAtual, nome].filter(Boolean)) {
      const gc = page.getByRole("gridcell", { name: alvo });
      if (await gc.count()) { await gc.first().click({ timeout: 5000 }); return; }
    }
    await linhaConta(page, c).click({ timeout: 5000 }); // fallback posição
  });
  await h.settle(page);
  await h.tentar("abrir 'Mais' (3 pontinhos) da conta", async () => {
    await page.getByRole("button", { name: "Mais", exact: true }).first().click({ timeout: 6000 });
  });
  await h.tentar("clicar em Editar", async () => {
    const menu = page.getByRole("menu");
    const alvo = (await menu.count())
      ? menu.getByText("Editar", { exact: true })
      : page.getByText("Editar", { exact: true });
    await alvo.first().click({ timeout: 5000 });
  });
  await h.tentar(`Nome da conta = ${nome}`, async () => {
    await h.digitar(page.getByRole("textbox", { name: "Nome da conta de anúncios" }), nome, { timeout: 5000 });
  });
  await h.tentar("Salvar alteracoes", async () => {
    await page.getByRole("button", { name: "Salvar alterações" }).first().click({ timeout: 6000 });
    await h.settle(page);
    const err = await erroDeNome(page);
    if (err) throw new Error(`Meta recusou o nome "${nome}" (${err})`);
  });
  await h.human();
}

// 8c: atribuir parceiro (partner BM) na conta c — auto-suficiente (abre a conta).
export async function atribuirParceiro(ctx, c, conta = null) {
  const { page, h, cfg, bm } = ctx;
  const partnerId = cfg.defaults?.partnerBusinessId || "";
  const nome = nomeConta(cfg, bm, c);
  console.log(`\n-- [conta ${c}] atribuir parceiro ${partnerId} --`);
  // abre a conta (nesta etapa o nome já é o novo CA{c}; fallback pelo nomeAtual)
  if (bm.businessId) await irPara(ctx, url.adAccounts(bm.businessId), "Contas de anúncios (parceiro)");
  else await h.settle(page);
  await h.tentar(`selecionar conta ${nome}`, async () => {
    for (const alvo of [nome, conta?.nomeAtual].filter(Boolean)) {
      const gc = page.getByRole("gridcell", { name: alvo });
      if (await gc.count()) { await gc.first().click({ timeout: 5000 }); return; }
    }
    await linhaConta(page, c).click({ timeout: 5000 });
  });
  await h.settle(page);
  await h.tentar("Atribuir parceiro", async () => {
    await page.getByRole("button", { name: "Atribuir parceiro" }).first().click({ timeout: 6000 });
  });
  await h.opcional("escolher 'Identificacao da empresa'", async () => {
    await page.getByRole("button", { name: "Identificação da empresa" }).first().click({ timeout: 4000 });
  });
  await h.tentar(`Partner business ID = ${partnerId}`, async () => {
    await h.digitar(page.getByRole("textbox", { name: "Enter partner business ID" }), partnerId, { timeout: 5000, modo: "fill" }); // ID interno
  });
  await h.tentar("ativar 'Gerenciar contas de anuncios'", async () => {
    await page.getByRole("switch", { name: "Gerenciar contas de anúncios" }).check({ timeout: 5000 });
  });
  await h.tentar("Atribuir", async () => {
    await page.getByRole("button", { name: "Atribuir", exact: true }).first().click({ timeout: 5000 });
  });
  await h.opcional("Concluir", async () => {
    await page.getByRole("button", { name: "Concluir" }).first().click({ timeout: 5000 });
  });
  await h.human();
}

export async function processarConta(ctx, c, conta = null) {
  await atribuirAcesso(ctx, c, conta);
  await atribuirParceiro(ctx, c, conta);
}

// ---------- ETAPAS DA ESTEIRA ----------
// 1) convite: aceitar + capturar business_id + renomear BM + renomear contas de anúncio
export async function etapaConvite(ctx) {
  const { cfg, bm } = ctx;
  await aceitarConvite(ctx);
  await renomearBM(ctx);

  // renomeia as contas de anúncio junto (descobre via API/DOM primeiro)
  const qtd = cfg.defaults?.qtdContasAnuncio || 1;
  if (!Array.isArray(bm.contas) || !bm.contas.length) {
    const achadas = await descobrirContas(ctx);
    bm.contas = achadas.slice(0, qtd).map((a) => ({ ...a, feita: false }));
    ctx.salvarBM?.();
  }
  const total = bm.contas.length ? Math.min(qtd, bm.contas.length) : qtd;
  for (let c = 1; c <= total; c++) {
    await renomearConta(ctx, c, bm.contas[c - 1] || null);
    if (bm.contas[c - 1]) { bm.contas[c - 1].nome = nomeConta(cfg, bm, c); ctx.salvarBM?.(); }
  }
}

// 2) pagamento: cartao + perfil de cobranca LLC
export async function etapaPagamento(ctx) {
  const { cfg, bm } = ctx;
  await addCartao(ctx); // cartão 1x (nível BM)

  // cobrança LLC é POR CONTA: descobre as contas (IDs) e roda em cada uma.
  const qtd = cfg.defaults?.qtdContasAnuncio || 1;
  if (!Array.isArray(bm.contas) || !bm.contas.length) {
    const achadas = await descobrirContas(ctx);
    bm.contas = achadas.slice(0, qtd).map((a) => ({ ...a, feita: false }));
    ctx.salvarBM?.();
  }
  const total = bm.contas.length ? Math.min(qtd, bm.contas.length) : qtd;
  for (let c = 1; c <= total; c++) {
    await addCobrancaLLC(ctx, c, bm.contas[c - 1] || null);
  }
}

// 3) contas: descobrir (IDs) + por conta: acesso, renomear, parceiro.
// ctx.salvarBM() persiste bm.contas apos cada conta (retomada fina).
export async function etapaContas(ctx) {
  const { cfg, bm } = ctx;
  const qtd = cfg.defaults?.qtdContasAnuncio || 1;

  if (!Array.isArray(bm.contas) || !bm.contas.length) {
    const achadas = await descobrirContas(ctx);
    bm.contas = achadas.slice(0, qtd).map((a) => ({ ...a, feita: false }));
    ctx.salvarBM?.();
  }

  const total = bm.contas.length ? Math.min(qtd, bm.contas.length) : qtd;
  for (let c = 1; c <= total; c++) {
    const conta = bm.contas[c - 1] || null;
    if (conta?.feita) {
      console.log(`\n⏭  conta ${c} (${conta.nome || conta.id}) já feita, pulando.`);
      continue;
    }
    await processarConta(ctx, c, conta);
    if (conta) {
      conta.feita = true;
      conta.nome = nomeConta(cfg, bm, c);
      ctx.salvarBM?.();
    }
  }
}

// "tudo": comportamento antigo — as 3 etapas em sequencia na mesma BM.
export async function processarBM(ctx) {
  await etapaConvite(ctx);
  await etapaPagamento(ctx);
  await etapaContas(ctx);
}
