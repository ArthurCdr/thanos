// adspower.mjs — Local API do AdsPower (abre/fecha o perfil).
// GET /api/v1/browser/start?user_id=XXX → data.ws.puppeteer (endpoint CDP)
// GET /api/v1/browser/stop?user_id=XXX  → fecha o perfil
// Limite ~1 req/s → espera ~1,3s entre chamadas.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeAdsPower(cfg) {
  const ap = cfg.adspower || {};

  async function apReq(path) {
    const headers = ap.apiKey ? { Authorization: `Bearer ${ap.apiKey}` } : {};
    await sleep(1300); // AdsPower limita ~1 req/s
    const r = await fetch(`${ap.apiHost}${path}`, { headers });
    const j = await r.json();
    if (j.code !== 0) throw new Error(j.msg || "AdsPower retornou erro");
    return j.data;
  }

  async function startProfile(userId) {
    const d = await apReq(
      `/api/v1/browser/start?user_id=${encodeURIComponent(userId)}&open_tabs=1`
    );
    const ws = d?.ws?.puppeteer;
    if (!ws) throw new Error("AdsPower nao retornou ws.puppeteer");
    return ws;
  }

  async function stopProfile(userId) {
    try {
      await apReq(`/api/v1/browser/stop?user_id=${encodeURIComponent(userId)}`);
    } catch (e) {
      console.log(`   (aviso ao fechar perfil: ${e.message})`);
    }
  }

  return { apReq, startProfile, stopProfile };
}
