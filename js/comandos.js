/* Comandos do Mapa de Planejamento
   ---------------------------------
   Transforma o texto digitado num "plano de ações" que o mapa executa:
     { acoes: [
       { tipo: "ruas",   camada, bairro, ruas: [{ nome, cor, espessura, tracejado }] },
       { tipo: "bairro", bairro, cor, espessura, preenchimento },
       { tipo: "ponto",  nome, endereco | lat+lon, cor },
       { tipo: "titulo", texto },
       { tipo: "limpar" }
     ] }
   Dois caminhos:
     1. Interpretador próprio (sem IA, sem internet): entende listas de ruas, bairro, cores por tipo de via e espessura.
     2. IA (Gemini, com a chave gratuita de cada pessoa, guardada só neste navegador): para pedidos mais livres.
   Para tirar a IA: apague a função "comIA" e o bloco "IA" do index.html; o interpretador continua funcionando. */
const Comandos = (() => {
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  /* ---------- cores ---------- */
  const CORES = {
    "vermelho escuro": "#991b1b", "vermelho": "#dc2626", "azul escuro": "#1e3a8a", "azul claro": "#38bdf8", "azul": "#2563eb",
    "verde escuro": "#166534", "verde claro": "#86efac", "verde": "#16a34a", "amarelo": "#facc15", "laranja": "#f97316",
    "roxo": "#7c3aed", "lilas": "#a78bfa", "rosa": "#ec4899", "preto": "#111827", "branco": "#ffffff",
    "cinza": "#6b7280", "marrom": "#92400e", "vinho": "#7f1d1d", "turquesa": "#14b8a6", "dourado": "#ca8a04"
  };
  const NOMES_COR = Object.keys(CORES).sort((a, b) => b.length - a.length);
  const RE_COR = new RegExp("(#[0-9a-f]{6}\\b|" + NOMES_COR.join("|") + ")", "i");
  function cor(txt) { const m = norm(txt).match(RE_COR); return m ? (m[1].startsWith("#") ? m[1] : CORES[m[1]]) : null; }

  /* ---------- tipos de via ---------- */
  const TIPOS = [
    ["passagem", /^(passagem|passagens|passag|pass|psg|pas|ps)\b\.?/],
    ["avenida",  /^(avenidas?|av|avs|aven)\b\.?/],
    ["rodovia",  /^(rodovias?|rod|br)\b\.?/],
    ["travessa", /^(travessas?|trav|tv|tvs|tr)\b\.?/],
    ["rua",      /^(ruas?|r)\b\.?/],
    ["alameda",  /^(alamedas?|al)\b\.?/],
    ["vila",     /^(vilas?|vl)\b\.?/],
    ["estrada",  /^(estradas?|estr|est)\b\.?/],
    ["conjunto", /^(conjuntos?|conj|cj)\b\.?/]
  ];
  function tipoDe(nome) { const n = norm(nome).trim(); const t = TIPOS.find(([, re]) => re.test(n)); return t ? t[0] : ""; }

  // "Passagem Assunção: de Av. X até Av. Y", "Passagem Assunção - da Av. X à Av. Y", "Passagem Assunção entre Av. X e Tv. Y"
  function trecho(l) {
    let m = l.match(/^(.+?)\s*(?:[-–:]\s*|\s)(?:d[eoa]s?|desde|do cruzamento com)\s+(.+?)\s+(?:at[eé](?:\s+[aào]s?)?|[àa]s?|ao)\s+(.+?)\s*$/i);
    if (m && tipoDe(m[2])) return { nome: m[1].trim(), de: m[2].trim(), ate: m[3].trim() };
    m = l.match(/^(.+?)\s*[-–:]?\s+entre\s+(?:a\s+|o\s+)?(.+?)\s+e\s+(?:a\s+|o\s+)?(.+?)\s*$/i);
    if (m) return { nome: m[1].trim(), de: m[2].trim(), ate: m[3].trim() };
    return { nome: l.trim(), de: "", ate: "" };
  }

  /* ---------- interpretador sem IA ---------- */
  function interpretar(texto) {
    const t = String(texto || "");
    const n = norm(t);
    const acoes = [];
    if (/^\s*(limpar|apagar tudo|comecar de novo)\b/.test(n)) return { acoes: [{ tipo: "limpar" }] };

    // bairro: "no bairro do Telégrafo de Belém", "bairro Pedreira", "bairro: Marco"
    let bairro = null;
    const mb = t.match(/bairros?\s*[:\-]?\s*(?:d[oa]s?\s+|de\s+)?([A-ZÀ-Úa-zà-ú][A-Za-zÀ-ú'´`\- ]{1,40}?)(?=\s+(?:de|em)\s+bel[eé]m\b|\s*[(\n,.;:]|\s+com\b|\s+e\s|\s+em\s|\s+na\s+cor\b|$)/i);
    if (mb) bairro = mb[1].trim();

    // título do layout: título "..." ou título: ...
    const mt = t.match(/t[ií]tulo\s*[:=]?\s*["“]([^"”]+)["”]/i) || t.match(/t[ií]tulo\s*:\s*([^\n]+)/i);
    if (mt) acoes.push({ tipo: "titulo", texto: mt[1].trim() });

    // lista de ruas: o que estiver entre parênteses; senão, as linhas que começam por um tipo de via
    let bloco = null;
    const mp = t.match(/\(([^()]{3,})\)/s);
    if (mp) bloco = mp[1];
    let linhas = bloco
      ? bloco.split(/\n|;|,(?![^()]*\))/)
      : t.split(/\n|;/).filter(l => tipoDe(l.trim()));
    linhas = linhas.map(l => l.replace(/^[\s\-•*\d.)]+/, "").trim()).filter(l => l.length > 2 && !/^(com|e|em)\b/i.test(l));
    // tira repetidas (ex.: "Passagem União" duas vezes)
    const vistas = new Set(); const ruas = [];
    linhas.forEach(l => { const k = norm(l).replace(/[^a-z0-9]+/g, " ").trim(); if (!vistas.has(k)) { vistas.add(k); ruas.push(l); } });

    // regras de cor: "passagens em vermelho", "av. e rodovias em azul", "travessas na cor verde", "todas em preto"
    const regras = [];
    const reRegra = /((?:passage(?:m|ns)|avenidas?|av\.?|rodovias?|rod\.?|travessas?|trav\.?|tv\.?|ruas?|vilas?|alamedas?|estradas?|todas?|demais|outras|restante)(?:\s*(?:,|e)\s*(?:passage(?:m|ns)|avenidas?|av\.?|rodovias?|rod\.?|travessas?|trav\.?|tv\.?|ruas?|vilas?|alamedas?|estradas?))*)\s+(?:em|de|na cor|com a cor|cor)\s+(#[0-9a-f]{6}|[a-zà-ú]+(?:\s+(?:escuro|claro))?)/gi;
    let m;
    const fora = bloco ? t.replace(bloco, " ") : t;   // as regras ficam fora da lista de ruas
    while ((m = reRegra.exec(fora))) {
      const c = cor(m[2]); if (!c) continue;
      const tipos = m[1].split(/\s*(?:,|\be\b)\s*/).map(x => {
        const nx = norm(x).trim();
        if (/^(todas?|demais|outras|restante)$/.test(nx)) return "*";
        return tipoDe(nx);
      }).filter(Boolean);
      regras.push({ tipos, cor: c });
    }
    // espessura: "tamanho 2", "espessura de 3", "largura 2,5"
    const me = n.match(/(?:tamanho|espessura|largura|grossura|linha de)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)/);
    const espessura = me ? parseFloat(me[1].replace(",", ".")) : 3;
    const tracejado = /tracejad|pontilhad/.test(n);

    const corGeral = regras.find(r => r.tipos.includes("*"));
    const corDe = nome => { const tp = tipoDe(nome); const r = regras.find(r => r.tipos.includes(tp)) || corGeral; return r ? r.cor : null; };
    if (ruas.length) {
      acoes.push({ tipo: "ruas", camada: "Ruas" + (bairro ? " - " + bairro : ""), bairro,
        ruas: ruas.map(l => { const t = trecho(l); return { nome: t.nome, de: t.de, ate: t.ate, cor: corDe(t.nome), espessura, tracejado }; }) });
    }

    // "destacar/contornar o bairro X"
    if (bairro && /(contorn|destac|pint|marc|limite)\w*\s+(?:o\s+)?bairro/.test(n)) {
      acoes.push({ tipo: "bairro", bairro, cor: cor(n.split("bairro").pop()) || "#111827", espessura: 2, preenchimento: /preench|pint/.test(n) });
    }
    // pontos: "ponto em Av. X com Tv. Y" / "ponto: lat, lon"
    const reP = /ponto\s*(?:em|no|na|:)\s*([^\n;]+)/gi;
    while ((m = reP.exec(t))) {
      const alvo = m[1].trim(), ll = alvo.match(/(-?\d{1,2}[.,]\d+)\s*[,; ]\s*(-?\d{1,3}[.,]\d+)/);
      const semCor = alvo.replace(new RegExp("\\s*(?:em|na cor|cor)?\\s*" + RE_COR.source + "\\s*$", "i"), "").trim();
      // "Av. X com Tv. Y" = esquina: o mapa acha o cruzamento na base de ruas
      acoes.push(ll ? { tipo: "ponto", nome: "Ponto", lat: +ll[1].replace(",", "."), lon: +ll[2].replace(",", "."), cor: cor(alvo) || "#dc2626" }
                    : { tipo: "ponto", nome: semCor, endereco: semCor, bairro, cor: cor(alvo) || "#dc2626" });
    }
    return { acoes, origem: "interpretador" };
  }

  /* ---------- IA (Gemini) ---------- */
  const CFG_IA = "plano_ia";
  function lerCfg() { try { return JSON.parse(localStorage.getItem(CFG_IA) || "{}"); } catch (e) { return {}; } }
  function salvarCfg(c) { try { localStorage.setItem(CFG_IA, JSON.stringify(c)); } catch (e) {} }
  const PROMPT = `Você converte pedidos de mapas (Belém/PA, serviços de limpeza urbana) em JSON.
Responda SOMENTE com JSON no formato:
{"acoes":[
 {"tipo":"ruas","camada":"nome da camada","bairro":"nome do bairro ou null","ruas":[{"nome":"Passagem X","de":"rua do início do trecho ou vazio","ate":"rua do fim do trecho ou vazio","cor":"#rrggbb","espessura":3,"tracejado":false}]},
 {"tipo":"bairro","bairro":"Nome","cor":"#rrggbb","espessura":2,"preenchimento":false},
 {"tipo":"ponto","nome":"rótulo","endereco":"endereço completo, Belém, PA","cor":"#rrggbb"},
 {"tipo":"titulo","texto":"título para o layout de impressão"},
 {"tipo":"limpar"}
]}
Regras: escreva o nome completo das vias (Av. -> Avenida, Trav./Tv. -> Travessa, Psg./Pass. -> Passagem, Rod. -> Rodovia).
Não repita ruas. Cores em hexadecimal. "Tamanho N" ou "espessura N" = espessura N. Se o pedido não citar cor para uma via, use "#374151".
Não invente ruas que não foram pedidas. Pedido:`;

  async function comIA(texto, log) {
    const c = lerCfg();
    if (!c.chave) throw new Error("cole a sua chave do Gemini em Configurar IA (é gratuita em aistudio.google.com).");
    const modelos = [...new Set([c.modelo || "gemini-flash-latest", "gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"])];
    let ultimoErro = null;
    for (const mod of modelos) {
      try {
        log && log(`Perguntando à IA (${mod})…`);
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${mod}:generateContent`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": c.chave },
          body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: PROMPT + "\n" + texto }] }],
            generationConfig: { temperature: 0.1, responseMimeType: "application/json" } })
        });
        if (r.status === 429 || r.status === 503 || r.status === 404) { ultimoErro = new Error(`modelo ${mod} indisponível agora (${r.status})`); continue; }
        if (!r.ok) throw new Error(`a IA respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
        const j = await r.json();
        const txt = (((j.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || "").join("") || "";
        const plano = JSON.parse(txt.replace(/^```(?:json)?|```$/g, "").trim());
        if (!plano || !Array.isArray(plano.acoes)) throw new Error("a IA não devolveu um plano válido");
        plano.origem = "IA (" + mod + ")";
        return plano;
      } catch (e) { ultimoErro = e; if (/chave|API key|PERMISSION|401|403/i.test(String(e.message))) throw e; }
    }
    throw ultimoErro || new Error("a IA não respondeu");
  }

  return { interpretar, comIA, lerCfg, salvarCfg, tipoDe, cor, CORES, norm, trecho };
})();
if (typeof module !== "undefined") module.exports = Comandos;
