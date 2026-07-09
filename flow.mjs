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

// 7: adicionar perfil de cobranca LLC (EUA + fuso NY + endereco) e definir padrao
export async function addCobrancaLLC(ctx) {
  const { page, h, cfg, bm } = ctx;
  const d = cfg.defaults || {};
  const end = d.endereco || {};
  console.log("\n-- adicionando cobranca LLC (EUA) --");
  await h.settle(page);
  await h.tentar("Adicionar forma de pagamento", async () => {
    await page.getByRole("button", { name: /Adicionar forma de pagamento|Adicionar/ }).first().click({ timeout: 6000 });
  });
  await h.settle(page);
  await h.tentar(`definir Pais = ${d.pais}`, async () => {
    await page.getByText(/País\/região/).first().click({ timeout: 6000 });
    await page.getByText(d.pais).first().click({ timeout: 6000 });
  });
  await h.human();
  await h.tentar(`definir Fuso = ${d.fuso}`, async () => {
    await page.getByRole("button", { name: /GMT/ }).first().click({ timeout: 6000 });
    await h.digitar(page.getByRole("searchbox").first(), d.fuso, { timeout: 5000, modo: "fill" }); // searchbox c/ autocomplete
    await page.getByText(new RegExp(d.fuso, "i")).first().click({ timeout: 5000 });
  });
  await h.human();
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
  await h.tentar(`Endereco 1 = ${end.endereco1}`, async () => {
    await h.digitar(page.getByRole("textbox", { name: "Endereço 1" }), end.endereco1 || "", { timeout: 5000 });
  });
  await h.opcional("marcar 'endereco legal registrado'", async () => {
    await page.getByText("O endereço legal registrado").first().click({ timeout: 4000 });
  });
  await h.tentar(`Cidade = ${end.cidade}`, async () => {
    await h.digitar(page.getByRole("textbox", { name: "Cidade" }), end.cidade || "", { timeout: 5000 });
  });
  await h.tentar(`CEP = ${end.cep}`, async () => {
    await h.digitar(page.getByRole("textbox", { name: "Código postal" }), end.cep || "", { timeout: 5000, modo: "fill" }); // CEP
  });
  await h.tentar(`Estado = ${end.estado}`, async () => {
    await page.getByText("Estado", { exact: true }).first().click({ timeout: 4000 });
    const lista = page.getByRole("listbox");
    const opt = (await lista.count())
      ? lista.getByText(end.estado, { exact: true })
      : page.getByText(end.estado, { exact: true });
    await opt.first().click({ timeout: 5000 });
  });
  await h.human();
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
export async function descobrirContas(ctx) {
  const { page, h, bm } = ctx;
  console.log("\n-- descobrindo contas de anuncios (IDs) --");
  if (bm.businessId) await irPara(ctx, url.billingAccounts(bm.businessId), "Contas (descoberta)");
  else await h.settle(page);
  const achadas = [];
  try {
    const rows = page.getByRole("row").filter({ hasNot: page.getByRole("columnheader") });
    const n = await rows.count();
    for (let i = 0; i < Math.min(n, 12); i++) {
      const t = (await rows.nth(i).innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const m = t.match(/Identifica[cç][aã]o:?\s*(\d{6,})/i);
      if (m) achadas.push({ id: m[1], nomeAtual: t.slice(0, t.indexOf(m[0])).trim() || null });
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
  async function linhaRename() {
    for (const alvoTexto of [conta?.nomeAtual, nome]) {
      if (!alvoTexto) continue;
      const l = page.getByRole("row").filter({ hasText: alvoTexto }).first();
      if (await l.count()) return l;
    }
    return linhaConta(page, c);
  }
  const linha = await linhaRename();
  await logBotoes(linha, `linha da conta ${c}`); // harvest: nome real do kebab '3 pontinhos'
  await h.tentar(`abrir a conta ${conta?.nomeAtual ? `"${conta.nomeAtual}"` : `nº ${c}`} (Details/Mais)`, async () => {
    // a lista mostra "Details" (nao "Mais"); tenta ambos, escopado a linha da conta
    await linha
      .getByRole("button", { name: /Mais|Details|Detalhes/ })
      .first()
      .click({ timeout: 6000 });
  });
  await h.settle(page);
  h.marco(page, "conta aberta (rename)"); // harvest: URL da conta aberta
  await h.tentar("clicar em Editar (no menu da conta)", async () => {
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
    // verificacao pos-salvar: se a Meta recusou o nome, NAO marca ✓ — degrada pra manual
    const err = await erroDeNome(page);
    if (err) throw new Error(`Meta recusou o nome "${nome}" (${err})`);
  });
  await h.human();
}

// 8c: atribuir parceiro (partner BM) na conta c
export async function atribuirParceiro(ctx, c) {
  const { page, h, cfg } = ctx;
  const partnerId = cfg.defaults?.partnerBusinessId || "";
  console.log(`\n-- [conta ${c}] atribuir parceiro ${partnerId} --`);
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
  await renomearConta(ctx, c, conta);
  await atribuirParceiro(ctx, c);
}

// ---------- ETAPAS DA ESTEIRA ----------
// 1) convite: aceitar + capturar business_id + renomear BM
export async function etapaConvite(ctx) {
  await aceitarConvite(ctx);
  await renomearBM(ctx);
}

// 2) pagamento: cartao + perfil de cobranca LLC
export async function etapaPagamento(ctx) {
  await addCartao(ctx);
  await addCobrancaLLC(ctx);
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
