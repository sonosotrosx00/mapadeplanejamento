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
    if (bairro && /^(com|e|em|na|no|de|da|do|que|uma?)\b/i.test(bairro)) bairro = null;   // "os bairros com uma linha…" não é nome de bairro

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
    if (bairro && /(contorn|desta[cq]|pint|marc|limite)\w*\s+(?:o\s+)?bairro/.test(n)) {
      acoes.push({ tipo: "bairro", bairro, cor: cor(n.split("bairro").pop()) || "#111827", espessura: 2, preenchimento: /preench|pint/.test(n) });
    }
    // "destaque a região metropolitana", "marque os bairros com linha tracejada vermelha"
    if (/regi[aã]o metropolitana|grande bel[eé]m|\brmb\b/.test(n)) {
      const i = n.search(/regi[aã]o metropolitana|grande bel[eé]m|\brmb\b/), fr = n.slice(Math.max(0, i - 40), i + 60);
      acoes.push({ tipo: "municipios", municipios: ["RMB"], cor: cor(fr.split(/,|\be\s+(?:tamb|marque|quero)/)[0]) || "#1d4ed8", espessura: 3, tracejado: /tracejad|pontilhad/.test(fr.split(/,/)[0]), preenchimento: !/sem preench|so o contorno|só o contorno/.test(fr) });
    } else {
      // "destaque Belém", "contorne o município de Belém", "a cidade de Belém" = só o município de Belém
      const mm = n.match(/(?:desta[cq]|contorn|marc|limite|real[cç]|ressalt)\w*\s+(?:o\s+|a\s+)?(?:(?:municipio|cidade|limite)\s+de\s+)?(belem|ananindeua|marituba|benevides|castanhal|santa barbara(?: do para)?|santa izabel(?: do para)?)\b/);
      if (mm) {
        const fr = n.slice(mm.index, mm.index + 80).split(/,|\be\s+(?:tamb|marque|quero)/)[0];
        const PROPRIO = ["Belém", "Ananindeua", "Marituba", "Benevides", "Castanhal", "Santa Bárbara do Pará", "Santa Izabel do Pará"];
        acoes.push({ tipo: "municipios", municipios: [PROPRIO.find(x => norm(x).startsWith(mm[1])) || mm[1]], cor: cor(fr) || "#1d4ed8", espessura: 3, tracejado: /tracejad|pontilhad/.test(fr), preenchimento: !/sem preench|so o contorno/.test(fr) });
      }
    }
    if (/\b(?:os|todos os|cada) bairros\b/.test(n) && !bairro) {
      const i = n.search(/\b(?:os|todos os|cada) bairros\b/), fr = n.slice(i, i + 90).split(/\be\s+tamb|\.|;/)[0];
      acoes.push({ tipo: "bairros", bairros: ["todos"], municipio: /regi[aã]o metropolitana|\brmb\b/.test(fr) ? "RMB" : "Belém", cor: cor(fr) || "#dc2626", espessura: 2, tracejado: /tracejad|pontilhad/.test(fr) || !/cont[ií]nu/.test(fr), preenchimento: /preench|pint/.test(fr) });
    }
    // rotas e linhas, uma ou várias no mesmo pedido:
    //   "rota em vermelho da Vila X, Cremação até a Rua Y, Ananindeua (passando por Z)"
    //   "linha azul de <link> até <link> e uma linha vermelha de <link> até <link>, tamanho 3"
    //   "linha reta de A até B" = reta entre os pontos (sem seguir as ruas)
    const reRota = /\b(rota|trajeto|caminho|percurso|linha)\b([\s\S]*?)\b(?:d[aeo]s?|desde|saindo d[aeo]s?)\s+([\s\S]+?)\s+(?:at[eé]|para|pra)\s+(?:[ao]s?\s+)?([\s\S]+?)(?:\s*,?\s*(?:passando|com paradas?)\s+(?:por|em|n[ao]s?)\s+([\s\S]+?))?\s*$/i;
    const clausulas = t.split(/\s*(?:\n|;|,?\s+\be\s+(?:tamb[eé]m\s+)?(?:quero\s+que\s+(?:voc[eê]\s+)?(?:fa[cç]a|trace|desenhe|crie)\s+)?(?=(?:uma|outra|a|o)?\s*(?:nova\s+)?(?:linha|rota|trajeto|caminho|percurso)\b))\s*/i);
    const rotas = clausulas.map(c => ({ c, m: c.match(reRota) })).filter(x => x.m && !/^\s*ponto/i.test(x.c) && !/\bbairros\b/i.test(x.c));
    if (rotas.length) {
      const fimEsp = /[,;]?\s*(?:e\s+)?(?:use|usar|com|de)?\s*(?:tamanho|espessura|largura|grossura)\s*(?:de\s*)?\d+(?:[.,]\d+)?[\s\S]*$/i;
      const limpa = s => s.replace(fimEsp, "").replace(new RegExp("\\s*(?:em|na cor|cor)\\s+" + RE_COR.source + "\\s*$", "i"), "").replace(/[\s,.;–-]+$/, "").trim();
      rotas.forEach(({ c, m: mr }) => {
        const nc = norm(c), linha = /^linha$/i.test(mr[1]) && !/rota|trajeto/i.test(mr[2]);   // "linha / rota" = rota
        acoes.push({ tipo: "rota", nome: linha ? "Linha" : "Rota", de: limpa(mr[3]), ate: limpa(mr[4]),
          paradas: mr[5] ? mr[5].split(/\s*(?:;|\be\b|,(?=\s*(?:rua|av|avenida|tv|trav|travessa|passagem|vila|rod)))\s*/i).map(limpa).filter(Boolean) : [],
          cor: cor(mr[1] + mr[2]) || cor(nc) || (acoes.some(x => x.cor === "#dc2626") ? "#1e40af" : "#dc2626"), espessura: me ? espessura : (linha ? 3 : 4),
          modo: /\breta\b/.test(norm(mr[2])) || /linha reta/.test(nc) ? "reta" : /\ba p[eé]\b|caminhando/.test(nc) ? "pe" : "carro",
          marcos: !linha });
      });
      return { acoes, origem: "interpretador" };
    }
    // rota sem "de … até …": "<link> <link> trace uma rota entre esses dois pontos", "linha entre A e B",
    // ou os lugares em linhas separadas e o pedido embaixo. Vai na ordem em que os lugares aparecem.
    if (/\b(rota|linha|trajeto|caminho|percurso)\b/.test(n) && !/\bponto\s*(?:em|no|na|:)/i.test(t)) {
      let lugares = (t.match(/https?:\/\/[^\s)<>"]+/g) || []).map(l => l.replace(/[),.;]+$/, ""));
      let tirarRuas = false;
      // sem links, só com "entre"/"ligando" (para não confundir com uma lista de ruas que fala de "linha")
      if (lugares.length < 2 && /\b(entre|ligando|ligar|ligue)\b/.test(n) && !ruas.some(r => /\bentre\b/i.test(r))) {
        const me2 = t.match(/\bentre\s+(?!(?:esses|estes|os|eles|elas|dois|2)\b)([\s\S]+?)\s+e\s+([\s\S]+?)\s*[.?!]?\s*$/i);
        const tira = x => x.replace(/^(?:[ao]s?|d[ao]s?)\s+/i, "").replace(/[,;]?\s*(?:e\s+)?(?:use|usar|com|de)?\s*(?:tamanho|espessura|largura|grossura)\s*(?:de\s*)?\d+(?:[.,]\d+)?[\s\S]*$/i, "").replace(new RegExp("\\s*(?:em|na cor|cor)\\s+" + RE_COR.source + "\\s*$", "i"), "").replace(/[\s,.;]+$/, "").trim();
        if (me2) lugares = [tira(me2[1]), tira(me2[2])];
        else { lugares = t.split(/\n/).map(x => x.trim()).filter(x => x && !/\b(rota|linha|trajeto|caminho|percurso|quero|trace|tracar|traçar|desenh|fa[cç]a)/i.test(x)); tirarRuas = true; }
      }
      if (lugares.length >= 2) {
        const soLinha = /\blinha\b/.test(n) && !/\b(rota|trajeto|caminho|percurso)\b/.test(n);
        if (tirarRuas) for (let i = acoes.length - 1; i >= 0; i--) if (acoes[i].tipo === "ruas") acoes.splice(i, 1);
        acoes.push({ tipo: "rota", nome: soLinha ? "Linha" : "Rota", de: lugares[0], ate: lugares[lugares.length - 1], paradas: lugares.slice(1, -1),
          cor: cor(n) || "#dc2626", espessura: me ? espessura : (soLinha ? 3 : 4),
          modo: /linha reta|\bem reta\b/.test(n) ? "reta" : /\ba p[eé]\b|caminhando/.test(n) ? "pe" : "carro", marcos: !soLinha });
        return { acoes, origem: "interpretador" };
      }
    }
    // pontos: "ponto em Av. X com Tv. Y" / "ponto: lat, lon"
    const reP = /ponto\s*(?:em|no|na|:)\s*([^\n;]+)/gi;
    while ((m = reP.exec(t))) {
      // link do Google Maps vai inteiro para a busca (que pega o pino, não o centro da tela)
      const alvo = m[1].trim(), ll = /google\.|goo\.gl/i.test(alvo) ? null : alvo.match(/(-?\d{1,2}[.,]\d+)\s*[,; ]\s*(-?\d{1,3}[.,]\d+)/);
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
{"entendi":"uma frase curta, em português, dizendo o que você vai fazer",
 "avisos":["o que foi pedido e NÃO dá para fazer com as ações abaixo (deixe vazio se deu tudo)"],
 "acoes":[
 {"tipo":"ruas","camada":"nome da camada","bairro":"nome do bairro ou null","ruas":[{"nome":"Passagem X","de":"rua do início do trecho ou vazio","ate":"rua do fim do trecho ou vazio","cor":"#rrggbb","espessura":3,"tracejado":false}]},
 {"tipo":"bairro","bairro":"Nome","cor":"#rrggbb","espessura":2,"preenchimento":false},
 {"tipo":"bairros","bairros":["todos"] ou ["Nome","Nome"],"municipio":"Belém" ou "RMB" ou nome do município,"cor":"#rrggbb","espessura":2,"tracejado":true,"preenchimento":false},
 {"tipo":"municipios","municipios":["RMB"] ou ["Belém","Ananindeua"],"cor":"#rrggbb","espessura":3,"tracejado":false,"preenchimento":true},
 {"tipo":"ponto","nome":"rótulo","endereco":"endereço completo, Belém, PA","cor":"#rrggbb"},
 {"tipo":"rota","nome":"nome da rota","de":"endereço de saída","ate":"endereço de chegada","paradas":["endereço da parada"],"cor":"#rrggbb","espessura":4,"modo":"carro","marcos":true},
 {"tipo":"titulo","texto":"título para o layout de impressão"},
 {"tipo":"editar","alvos":["nome do item como está no mapa" ou "grupo:Nome do grupo"],"tipoItem":"linha|area|ponto (opcional)","cor":"#rrggbb","espessura":3,"tracejado":true,"preenchimento":false,"visivel":true,"novoNome":"(opcional)"},
 {"tipo":"apagar","alvos":["nome do item como está no mapa" ou "grupo:Nome do grupo"]},
 {"tipo":"limpar"}
]}
Dados que o mapa tem: ruas de Belém; os 71 bairros de Belém; os bairros de Marituba e Benevides; o limite dos 7 municípios da
Região Metropolitana de Belém (RMB: Belém, Ananindeua, Marituba, Benevides, Santa Bárbara do Pará, Santa Izabel do Pará, Castanhal).
Ananindeua, Castanhal e as Santas não têm bairros oficiais no IBGE. "Destacar a região metropolitana" = ação "municipios" com ["RMB"]; "destacar Belém" (ou a cidade/o município de Belém) = "municipios" com ["Belém"] só.
"Marcar os bairros" sem dizer quais = ação "bairros" com ["todos"] (de Belém, ou "RMB" se o pedido falar dos bairros da região toda).
Se não der para fazer algo com estas ações, NÃO invente outra coisa no lugar: explique em "avisos".
Pedido de correção do que já está no mapa ("muda a rota para verde", "tira os bairros do Mosqueiro", "a linha ficou fina", "deixa Belém sem preenchimento")
= ações "editar" ou "apagar", só com os campos que mudam; não desenhe de novo o que já existe. Em "editar" e "apagar" escreva só os campos que mudam.
Regras: escreva o nome completo das vias (Av. -> Avenida, Trav./Tv. -> Travessa, Psg./Pass. -> Passagem, Rod. -> Rodovia).
Não repita ruas. Cores em hexadecimal. "Tamanho N" ou "espessura N" = espessura N. Se o pedido não citar cor para uma via, use "#374151".
Não invente ruas que não foram pedidas.
Pedido de rota, trajeto ou caminho "de/da A até B" é UMA ação "rota" (não use dois "ponto"). Em "de", "ate" e "paradas" escreva o endereço como foi pedido,
mantendo o tipo da via (Rua, Vila, Passagem…), o número, o bairro e a cidade (Belém, Ananindeua, Marituba…); se não disser a cidade, é Belém.
"modo" é "pe" quando o pedido falar a pé, "reta" quando pedir linha reta; senão "carro" (segue as ruas).
"Linha de A até B" também é uma ação "rota", com "nome":"Linha" e "marcos":false (sem pontos de saída e chegada); "rota/trajeto" usa "marcos":true.
Várias linhas ou rotas no mesmo pedido = uma ação "rota" para cada uma, cada uma com a sua cor.
Link do Google Maps, coordenada ou nome de lugar salvo (ex.: "Base Norte") vão copiados exatamente como vieram em de/ate/paradas/endereco. Pedido:`;

  // modelos que deram 404 para esta chave ficam de fora por 1 dia (não perde tempo perguntando a eles)
  const CH_FORA = "plano_ia_fora";
  const lerFora = () => { try { const o = JSON.parse(localStorage.getItem(CH_FORA) || "{}"); const agora = Date.now(); return Object.keys(o).filter(k => agora - o[k] < 864e5); } catch (e) { return []; } };
  const marcarFora = m => { try { const o = JSON.parse(localStorage.getItem(CH_FORA) || "{}"); o[m] = Date.now(); localStorage.setItem(CH_FORA, JSON.stringify(o)); } catch (e) {} };
  // pedido ao Gemini com tempo limite e SEM a etapa de "pensar" (é ela que fazia a resposta demorar)
  let semPensar = true;
  async function chamar(mod, chave, corpo, limiteMs) {
    const ir = async gc => {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), limiteMs);
      try {
        return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${mod}:generateContent`, {
          method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
          body: JSON.stringify({ ...corpo, generationConfig: gc }) });
      } catch (e) { throw new Error(e.name === "AbortError" ? `o modelo ${mod} não respondeu em ${Math.round(limiteMs / 1000)} s` : "sem conexão com a IA"); }
      finally { clearTimeout(tm); }
    };
    const gc = corpo.generationConfig || {};
    if (semPensar) {
      const r = await ir({ ...gc, thinkingConfig: { thinkingBudget: 0 } });
      if (r.status !== 400) return r;
      const t = await r.clone().text();
      if (!/think/i.test(t)) return r;
      semPensar = false;                     // este modelo não aceita desligar: vai do jeito normal
    }
    return ir(gc);
  }
  async function comIA(texto, log, extra) {
    const c = lerCfg();
    if (!c.chave) throw new Error("cole a sua chave do Gemini em Configurar IA (é gratuita em aistudio.google.com).");
    const fora = lerFora();
    const modelos = [...new Set([c.modelo || "gemini-flash-latest", "gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite"])].filter(m => !fora.includes(m) || m === c.modelo);
    let ultimoErro = null;
    for (const mod of modelos) {
      try {
        log && log(`Perguntando à IA (${mod})…`);
        const t0 = Date.now();
        const r = await chamar(mod, c.chave, { contents: [{ role: "user", parts: [{ text: (extra ? PROMPT.replace(/ Pedido:$/, "") + "\n\n" + extra + "\n\nPedido:" : PROMPT) + "\n" + texto }] }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json" } }, 30000);
        if (r.status === 404) marcarFora(mod);
        if (r.status === 429 || r.status === 503 || r.status === 404) { ultimoErro = new Error(`modelo ${mod} indisponível agora (${r.status})`); continue; }
        if (!r.ok) throw new Error(`a IA respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
        const j = await r.json();
        const txt = (((j.candidates || [])[0] || {}).content || {}).parts?.map(p => p.text || "").join("") || "";
        const plano = JSON.parse(txt.replace(/^```(?:json)?|```$/g, "").trim());
        if (!plano || !Array.isArray(plano.acoes)) throw new Error("a IA não devolveu um plano válido");
        plano.origem = "IA (" + mod + ")"; plano.segundos = Math.round((Date.now() - t0) / 100) / 10;
        return plano;
      } catch (e) { ultimoErro = e; if (/chave|API key|PERMISSION|401|403|sem conexão/i.test(String(e.message))) throw e; }
    }
    throw ultimoErro || new Error("a IA não respondeu");
  }

  // testa a chave em cada modelo com um pedido mínimo e diz quais respondem
  const MODELOS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"];
  async function testarChave(chave) {
    if (!chave) return [{ modelo: "", ok: false, texto: "cole a chave primeiro" }];
    return Promise.all(MODELOS.map(async m => {
      try {
        const t0 = Date.now();
        const r = await chamar(m, chave, { contents: [{ role: "user", parts: [{ text: "Responda só: ok" }] }], generationConfig: { maxOutputTokens: 20 } }, 15000);
        if (r.ok) return { modelo: m, ok: true, texto: `funcionando (${Math.round((Date.now() - t0) / 100) / 10} s)` };
        if (r.status === 404) marcarFora(m);
        const t = await r.text();
        const texto = r.status === 429 ? "limite atingido (cota gratuita)" : r.status === 404 ? "indisponível para esta chave" : r.status === 503 ? "ocupado agora" : (r.status === 400 && /API key/i.test(t)) || r.status === 403 ? "chave inválida ou sem permissão" : "erro " + r.status;
        return { modelo: m, ok: false, texto };
      } catch (e) { return { modelo: m, ok: false, texto: /não respondeu/.test(e.message) ? "não respondeu em 15 s" : "sem conexão" }; }
    }));
  }

  return { interpretar, comIA, testarChave, lerCfg, salvarCfg, tipoDe, cor, CORES, norm, trecho };
})();
if (typeof module !== "undefined") module.exports = Comandos;
