/* Busca de ruas pelo nome, dentro de um bairro de Belém
   - base de ruas: data/ruas.js (a mesma do MapaBL, vinda do OpenStreetMap) + js/localizador.js (LOC.acharRua corrige abreviações e erros)
   - bairros: data/bairros_belem.js (IBGE, Censo 2022)
   Sem internet. Se a rua não estiver na base, o mapa pode tentar o OpenStreetMap online (Overpass) — ver plano.js. */
const BuscaRuas = (() => {
  const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  let pronto = false;
  const BAIRROS = [];

  function iniciar() {
    if (pronto) return;
    LOC.iniciar(DADOS_RUAS);
    (BAIRROS_BELEM.features || []).forEach(f => BAIRROS.push({ nome: f.properties.bairro, k: norm(f.properties.bairro), polys: polysDe(f.geometry) }));
    pronto = true;
  }
  // GeoJSON [lon, lat] -> formato do LOC: [polígono][anel][[lat, lon]]
  function polysDe(g) {
    const pol = c => c.map(anel => anel.map(([x, y]) => [y, x]));
    return g.type === "Polygon" ? [pol(g.coordinates)] : g.type === "MultiPolygon" ? g.coordinates.map(pol) : [];
  }
  function lev(a, b) {
    const m = a.length, n = b.length; let p = Array.from({ length: n + 1 }, (_, j) => j), c = new Array(n + 1);
    for (let i = 1; i <= m; i++) { c[0] = i; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); [p, c] = [c, p]; }
    return p[n];
  }
  function bairro(nome) {
    iniciar();
    const k = norm(nome).replace(/^(bairro\s+)?(d[oa]s?\s+)?/, ""); if (!k) return null;
    return BAIRROS.find(b => b.k === k) || BAIRROS.find(b => b.k.startsWith(k) || k.startsWith(b.k))
      || BAIRROS.map(b => ({ b, d: lev(b.k, k) })).filter(x => x.d <= 2).sort((a, b) => a.d - b.d).map(x => x.b)[0] || null;
  }
  const nomesBairros = () => { iniciar(); return BAIRROS.map(b => b.nome).sort((a, b) => a.localeCompare(b, "pt")); };

  /* ---------- geometria ---------- */
  const M_LAT = 110574, mLon = lat => 111320 * Math.cos(lat * Math.PI / 180);
  function distSeg(p, a, b) { // metros do ponto p ao segmento ab ([lat, lon])
    const kx = mLon(p[0]), ky = M_LAT;
    const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let t = L ? -(ax * dx + ay * dy) / L : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(ax + t * dx, ay + t * dy);
  }
  function pertoDoBairro(p, polys, margem) {
    if (LOC.pontoNoPoligono(p, polys)) return true;
    for (const pol of polys) for (const anel of pol) for (let i = 1; i < anel.length; i++) if (distSeg(p, anel[i - 1], anel[i]) <= margem) return true;
    return false;
  }
  function meio(linha) { return linha[Math.floor(linha.length / 2)]; }
  function comprLinha(l) { let m = 0; for (let i = 1; i < l.length; i++) m += Math.hypot((l[i][1] - l[i - 1][1]) * mLon(l[i][0]), (l[i][0] - l[i - 1][0]) * M_LAT); return m; }

  /* ---------- traçados de referência (aprendidos de um KML) ----------
     Quando o nome usado na OS é diferente do OpenStreetMap (ex.: "Passagem Padre Marcos" = "Passagem Estélio Maroja")
     ou a OS cobre só um trecho, o traçado do KML vale mais que a base. Guardados neste navegador, por nome + bairro. */
  const CHAVE_REF = "plano_referencias";
  let REFS = null;
  const chaveNome = s => norm(s).replace(/^(passagem|passagens|pass|psg|avenida|av|rodovia|rod|travessa|trav|tv|rua|r|alameda|al|vila|vl|estrada|conjunto)\b\.?\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
  function refs() { if (!REFS) { try { REFS = JSON.parse(localStorage.getItem(CHAVE_REF) || "[]"); } catch (e) { REFS = []; } } return REFS; }
  function guardarRefs() { try { localStorage.setItem(CHAVE_REF, JSON.stringify(REFS)); } catch (e) {} }
  // nome + bairro + linhas; substitui o que já houver com o mesmo nome no mesmo bairro
  function aprender(lista) {
    refs();
    lista.forEach(x => {
      const k = chaveNome(x.nome), tipo = (typeof Comandos !== "undefined") ? Comandos.tipoDe(x.nome) : "";
      REFS = REFS.filter(r => !(r.k === k && r.tipo === tipo && r.bairro === x.bairro && r.origem === x.origem));
    });
    const novos = {};
    lista.forEach(x => {
      const k = chaveNome(x.nome), tipo = (typeof Comandos !== "undefined") ? Comandos.tipoDe(x.nome) : "", id = k + "|" + tipo + "|" + x.bairro;
      if (!novos[id]) { novos[id] = { k, tipo, nome: x.nome, bairro: x.bairro, origem: x.origem || "", linhas: [] }; REFS.push(novos[id]); }
      novos[id].linhas.push(...x.linhas);
    });
    guardarRefs();
    return Object.keys(novos).length;
  }
  function referencia(nome, bairroObj) {
    const k = chaveNome(nome), tipo = (typeof Comandos !== "undefined") ? Comandos.tipoDe(nome) : "";
    const L = refs().filter(r => r.k === k && (!bairroObj || r.bairro === bairroObj.nome));
    return L.find(r => r.tipo === tipo) || L.find(r => !r.tipo || !tipo) || null;
  }
  // em que bairro está a linha (pelo ponto do meio)
  function bairroDoPonto(p) { iniciar(); const b = BAIRROS.find(b => LOC.pontoNoPoligono(p, b.polys)); return b ? b.nome : ""; }
  const referencias = () => refs().slice();
  function apagarReferencias() { REFS = []; guardarRefs(); }
  function juntarReferencias(lista) { if (Array.isArray(lista)) { refs(); lista.forEach(r => { if (!REFS.some(x => x.k === r.k && x.tipo === r.tipo && x.bairro === r.bairro)) REFS.push(r); }); guardarRefs(); } }

  /* ---------- rua ---------- */
  // devolve { ok, nomeBase, conf, linhas, metros, aviso } ou { ok:false, motivo, sugestoes }
  // de / ate (opcionais): corta a rua entre os dois cruzamentos (mesmo localizador do MapaBL)
  function achar(nome, bairroObj, margem = 25, de, ate) {
    iniciar();
    const ref = !de && !ate ? referencia(nome, bairroObj) : null;
    if (ref) return { ok: true, nomeBase: ref.nome, conf: "referência", linhas: ref.linhas, metros: ref.linhas.reduce((s, l) => s + comprLinha(l), 0), aviso: `traçado de referência${ref.origem ? " (" + ref.origem + ")" : ""}` };
    if (de || ate) {
      const t = LOC.localizar({ rua: nome, de: de || "", ate: ate || "", area: bairroObj ? 1 : null }, bairroObj ? { 1: bairroObj.polys } : {});
      if (t.ok && t.tipo === "trecho") return { ok: true, nomeBase: t.ruaBase, conf: t.conf, linhas: t.linhas, metros: t.metros || t.linhas.reduce((s, l) => s + comprLinha(l), 0), aviso: "" };
      const todo = achar(nome, bairroObj, margem);
      if (todo.ok) todo.aviso = `não achei o trecho entre "${de || "?"}" e "${ate || "?"}": desenhei a rua inteira no bairro` + (todo.aviso ? " · " + todo.aviso : "");
      return todo;
    }
    const r = LOC.acharRua(nome);
    if (!r || !r.segs || !r.segs.length) return { ok: false, motivo: "não está na base de ruas", sugestoes: LOC.sugerirRuas(nome, 4).map(s => s.nome) };
    let segs = r.segs.slice();
    // tipo da via digitado (Passagem, Avenida...) desempata nomes iguais: "Passagem União" x "Rua União"
    const tipo = (typeof Comandos !== "undefined") ? Comandos.tipoDe(nome) : "";
    if (tipo) { const doTipo = segs.filter(si => Comandos.tipoDe(LOC.nomeDe(si)) === tipo); if (doTipo.length) segs = doTipo; }
    let aviso = "";
    if (bairroObj) {
      const noBairro = segs.filter(si => LOC.linhasDe([si]).some(l => pertoDoBairro(meio(l), bairroObj.polys, margem)));
      if (!noBairro.length) return { ok: false, motivo: `existe em Belém, mas não no bairro ${bairroObj.nome}`, sugestoes: [], foraDoBairro: true };
      segs = noBairro;
    }
    const nomes = [...new Set(segs.map(si => LOC.nomeDe(si)))];
    if (nomes.length > 1) aviso = "juntou: " + nomes.join(" / ");
    else if (tipo && Comandos.tipoDe(nomes[0]) && Comandos.tipoDe(nomes[0]) !== tipo) aviso = `na base o nome é "${nomes[0]}": confira se é a mesma via`;
    else if (r.conf !== "exata") aviso = `nome parecido na base: "${nomes[0]}"`;
    return { ok: true, nomeBase: nomes[0], conf: r.conf, linhas: LOC.linhasDe(segs), metros: segs.reduce((s, si) => s + LOC.comprSeg(si), 0), aviso };
  }

  /* ---------- esquina de duas ruas ("Av. X com Tv. Y") ---------- */
  function esquina(txt, bairroObj) {
    const partes = String(txt).split(/\s+(?:com|x|esquina com|esq\.?|e)\s+/i).map(s => s.trim()).filter(Boolean);
    if (partes.length !== 2) return null;
    const a = achar(partes[0], bairroObj, 300), b = achar(partes[1], bairroObj, 300);
    if (!a.ok || !b.ok) return { ok: false, motivo: `não achei ${!a.ok ? partes[0] : partes[1]}` };
    let best = null, bd = 1e9;
    for (const la of a.linhas) for (const pa of la) for (const lb of b.linhas) for (let i = 1; i < lb.length; i++) {
      const d = distSeg(pa, lb[i - 1], lb[i]); if (d < bd) { bd = d; best = pa; }
    }
    return bd <= 40 ? { ok: true, lat: best[0], lon: best[1], nome: `${a.nomeBase} × ${b.nomeBase}` } : { ok: false, motivo: `${a.nomeBase} e ${b.nomeBase} não se cruzam (mais perto: ${Math.round(bd)} m)` };
  }

  return { iniciar, bairro, nomesBairros, achar, esquina, polysDe, aprender, referencias, apagarReferencias, juntarReferencias, bairroDoPonto, comprLinha };
})();
if (typeof module !== "undefined") module.exports = BuscaRuas;
