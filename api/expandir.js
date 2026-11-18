/* Abre um link curto do Google Maps (maps.app.goo.gl/…) e devolve o link completo, que traz o pino do lugar.
   Função da Vercel (roda no servidor, porque o navegador não consegue seguir esse redirecionamento por causa do bloqueio do Google).
   Uso: GET /api/expandir?u=https://maps.app.goo.gl/XXXX  ->  { "url": "https://www.google.com/maps/place/…" }
   Segurança: só aceita links curtos do Google Maps e só segue redirecionamentos para domínios do Google. Não guarda nada. */
const ENTRADA = /^https:\/\/(maps\.app\.goo\.gl\/[A-Za-z0-9_-]+|goo\.gl\/maps\/[A-Za-z0-9_-]+)\/?(\?.*)?$/;
const GOOGLE = /^https:\/\/([a-z0-9-]+\.)*(google\.[a-z.]+|goo\.gl|app\.goo\.gl|maps\.app\.goo\.gl)(\/|$)/i;

async function expandir(u) {
  if (!ENTRADA.test(u)) throw Object.assign(new Error("só aceito link curto do Google Maps (maps.app.goo.gl/…)"), { status: 400 });
  let atual = u;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(atual, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (planejamento)" } });
    const prox = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && prox) {
      const abs = new URL(prox, atual).toString();
      if (!GOOGLE.test(abs)) throw Object.assign(new Error("o link não leva ao Google Maps"), { status: 400 });
      atual = abs;
      if (/\/maps\/(place|search|dir|@)/.test(abs) || /[?&](q|ll)=/.test(abs)) return abs;
      continue;
    }
    break;
  }
  if (atual === u) throw Object.assign(new Error("o Google não abriu este link (pode ter expirado)"), { status: 404 });
  return atual;
}

module.exports = async (req, res) => {
  const u = String((req.query && req.query.u) || new URL(req.url, "http://x").searchParams.get("u") || "").trim();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    const url = await expandir(u);
    res.setHeader("Cache-Control", "public, s-maxage=86400, max-age=3600");
    res.statusCode = 200; res.end(JSON.stringify({ url }));
  } catch (e) {
    res.statusCode = e.status || 502; res.end(JSON.stringify({ erro: e.message || "falha ao abrir o link" }));
  }
};
module.exports.expandir = expandir;
