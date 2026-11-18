/* Mapa de Planejamento: o mapa, os pedidos em texto (com ou sem IA), o KML do My Maps e os traçados de referência.
   Os itens (linhas, áreas, pontos) ficam no "Planejar / Desenhar Rotas" do MapaBL (ferramentas_mapa.js): o mesmo lugar
   onde se desenha à mão, edita vértices, usa o ímã de rua, exporta KML/KMZ/DXF/GeoJSON/Excel e liga ao QGIS. */
const Plano = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const COR_PADRAO = "#374151";
  let titulo = U.ler("plano_titulo", "");

  /* ---------- mapa e fundos ---------- */
  const BASES = {
    ruas:     { nome: "Ruas",          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", attr: "Mapa base © Esri" },
    cinza:    { nome: "Cinza claro",   url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", attr: "Mapa base © Esri", max: 16 },
    satelite: { nome: "Satélite",      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attr: "Imagem © Esri" },
    osm:      { nome: "OpenStreetMap", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attr: "© OpenStreetMap" }
  };
  let mapa;
  function iniciarMapa() {
    mapa = L.map("mapa", { zoomControl: true }).setView([-1.43, -48.47], 13);
    const camadasBase = {};
    Object.entries(BASES).forEach(([k, b]) => camadasBase[b.nome] = L.tileLayer(b.url, { attribution: b.attr, maxNativeZoom: b.max || 19, maxZoom: 20, crossOrigin: true }));
    const inicial = BASES[U.ler("plano_base", "ruas")] ? U.ler("plano_base", "ruas") : "ruas";
    camadasBase[BASES[inicial].nome].addTo(mapa);
    L.control.layers(camadasBase, null, { position: "topleft" }).addTo(mapa);
    mapa.on("baselayerchange", e => { const k = Object.keys(BASES).find(k => BASES[k].nome === e.name); if (k) U.guardar("plano_base", k); });
  }

  /* ---------- itens do planejamento ---------- */
  const itens = () => FerramentasMapa.desenhos;
  // a base de ruas vem em pedaços (um por quadra): emenda os que se tocam (até 3 m) numa linha contínua
  function emendar(linhas) {
    const perto = (a, b) => Math.abs(a[0] - b[0]) < 3e-5 && Math.abs(a[1] - b[1]) < 3e-5;
    const resto = linhas.filter(l => l.length > 1).map(l => l.map(p => [p[0], p[1]])), out = [];
    while (resto.length) {
      let cad = resto.shift(), mudou = true;
      while (mudou) {
        mudou = false;
        for (let i = 0; i < resto.length; i++) {
          const l = resto[i], a = cad[0], z = cad[cad.length - 1];
          if (perto(z, l[0])) cad = cad.concat(l.slice(1));
          else if (perto(z, l[l.length - 1])) cad = cad.concat(l.slice(0, -1).reverse());
          else if (perto(a, l[l.length - 1])) cad = l.slice(0, -1).concat(cad);
          else if (perto(a, l[0])) cad = l.slice(1).reverse().concat(cad);
          else continue;
          resto.splice(i, 1); mudou = true; break;
        }
      }
      out.push(cad);
    }
    return out;
  }
  // uma rua que ainda fica em partes separadas (ex.: dois trechos) vira um item por parte, como no My Maps
  function itensDeLinhas(nome, linhas, est, obs) {
    return emendar(linhas).map((l, k, arr) => FerramentasMapa.novoItem("linha", l, {
      nome: arr.length > 1 ? `${nome} (parte ${k + 1})` : nome, nomeBase: nome, cor: est.cor || COR_PADRAO, espessura: est.espessura || 3, tracejada: !!est.tracejado, obs: obs || "", grupo: est.grupo || "" }));
  }
  function limparItens() { itens().length = 0; U.guardar("desenhos_mymaps", []); FerramentasMapa.renderizarDesenhosNoMapa(); }
  function substituirPorNome(nomeBase, grupo) {
    const lista = itens(); for (let i = lista.length - 1; i >= 0; i--) if ((lista[i].nomeBase || lista[i].nome) === nomeBase && (lista[i].grupo || "") === (grupo || "")) lista.splice(i, 1);
  }

  /* ---------- mensagens ---------- */
  function log(txt, tipo) {
    const d = document.createElement("div"); d.className = "log-l " + (tipo || ""); d.innerHTML = txt;
    $("log").appendChild(d); $("log").scrollTop = $("log").scrollHeight;
  }

  /* ---------- OpenStreetMap online (reserva para ruas fora da base) ---------- */
  const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
  const semAcento = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
  function padraoNome(nome) {
    const nucleo = semAcento(nome).replace(/^\s*(passagem|passagens|pass|psg|avenida|av|rodovia|rod|travessa|trav|tv|rua|r|alameda|al|vila|vl|estrada|conjunto)\b\.?\s*/i, "").trim();
    const cls = { a: "[aáàâã]", e: "[eéê]", i: "[ií]", o: "[oóôõ]", u: "[uúü]", c: "[cç]" };
    return nucleo.replace(/[.*+?^${}()|[\]\\"]/g, "").split("").map(ch => cls[ch.toLowerCase()] || ch).join("");
  }
  // uma consulta só para todas as ruas que faltaram, aos 3 servidores ao mesmo tempo (vale o primeiro que responder, até 20 s)
  async function overpassVarias(nomes, bairroObj) {
    let s = 90, w = 180, n = -90, e = -180;
    bairroObj.polys.forEach(p => p[0].forEach(([y, x]) => { s = Math.min(s, y); n = Math.max(n, y); w = Math.min(w, x); e = Math.max(e, x); }));
    const q = `[out:json][timeout:18];way["highway"]["name"~"${nomes.map(padraoNome).filter(Boolean).join("|")}",i](${s - .002},${w - .002},${n + .002},${e + .002});out geom;`;
    const ctls = OVERPASS.map(() => new AbortController());
    const corrida = OVERPASS.map((url, k) => fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ctls[k].signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    const limite = new Promise((_, rej) => setTimeout(() => rej(new Error("tempo esgotado")), 20000));
    let j;
    try { j = await Promise.race([Promise.any(corrida), limite]); }
    catch (err) { return { erro: err.errors ? "servidores ocupados" : err.message }; }
    finally { ctls.forEach(c => c.abort()); }
    const ways = (j.elements || []).filter(x => x.geometry && x.geometry.length > 1 && x.tags && x.tags.name);
    const out = {};
    nomes.forEach(nome => {
      const rx = new RegExp(padraoNome(nome), "i"), tipo = Comandos.tipoDe(nome);
      let ws = ways.filter(x => rx.test(semAcento(x.tags.name)) || rx.test(x.tags.name));
      const doTipo = ws.filter(x => Comandos.tipoDe(x.tags.name) === tipo);
      if (tipo && doTipo.length) ws = doTipo;
      const linhas = ws.map(x => x.geometry.map(g => [g.lat, g.lon]))
        .filter(l => LOC.pontoNoPoligono(l[Math.floor(l.length / 2)], bairroObj.polys) || l.some(p => LOC.pontoNoPoligono(p, bairroObj.polys)));
      if (linhas.length) out[nome] = { ok: true, linhas, nomeBase: ws[0].tags.name, metros: linhas.reduce((t, l) => t + BuscaRuas.comprLinha(l), 0), aviso: "achada no OpenStreetMap online" };
    });
    return { achadas: out };
  }
  async function geocodificar(endereco) {
    const vb = "-48.62,-1.02,-48.28,-1.53";   // Belém
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&viewbox=${vb}&bounded=1&q=${encodeURIComponent(endereco + ", Belém, Pará")}`, { headers: { "Accept-Language": "pt-BR" } });
    const j = await r.json(); return j && j[0] ? { lat: +j[0].lat, lon: +j[0].lon, nome: j[0].display_name } : null;
  }

  /* ---------- execução do pedido ---------- */
  async function executar(plano) {
    const acoes = (plano && plano.acoes) || [];
    if (!acoes.length) { log("Não entendi o pedido. Veja os exemplos em <b>Como pedir</b>.", "erro"); return; }
    const novos = [];
    for (const a of acoes) {
      if (a.tipo === "limpar") { limparItens(); log("Mapa limpo."); continue; }
      if (a.tipo === "titulo") { definirTitulo(a.texto || ""); log(`Título do layout: <b>${esc(titulo)}</b>`); continue; }
      if (a.tipo === "bairro") {
        const b = BuscaRuas.bairro(a.bairro);
        if (!b) { log(`Bairro "${esc(a.bairro)}" não encontrado.`, "erro"); continue; }
        novos.push(...itensBairro(b, a.cor || "#111827", a.espessura || 2, !!a.preenchimento, false));
        log(`Bairro <b>${esc(b.nome)}</b> desenhado.`, "ok"); continue;
      }
      if (a.tipo === "ponto") { const it = await executarPonto(a); if (it) novos.push(it); continue; }
      if (a.tipo === "ruas") { novos.push(...await executarRuas(a)); continue; }
      log(`Ação "${esc(a.tipo)}" não reconhecida.`, "aviso");
    }
    if (novos.length) FerramentasMapa.adicionarItens(novos);   // salva, desenha, enquadra e abre o planejamento
    else FerramentasMapa.renderizarDesenhosNoMapa();
  }
  function itensBairro(b, cor, esp, preench, tracejado) {
    substituirPorNome("Limite do bairro " + b.nome, "Bairros");
    // a área do planejamento é um anel só: um item por polígono do bairro
    return b.polys.map((pol, k) => FerramentasMapa.novoItem("poligono", pol[0].slice(0, -1).map(p => [p[0], p[1]]), {
      nome: "Limite do bairro " + b.nome + (b.polys.length > 1 ? ` (${k + 1})` : ""), nomeBase: "Limite do bairro " + b.nome, cor, espessura: esp, tracejada: tracejado, preenchido: preench, grupo: "Bairros", obs: "IBGE, Censo 2022" }));
  }
  async function executarRuas(a) {
    let b = null; const novos = [];
    if (a.bairro) { b = BuscaRuas.bairro(a.bairro); if (!b) log(`Bairro "${esc(a.bairro)}" não encontrado: procurei em Belém toda.`, "aviso"); }
    if (b && !itens().some(d => (d.nomeBase || d.nome) === "Limite do bairro " + b.nome)) novos.push(...itensBairro(b, "#6b7280", 1.5, false, true));
    const lista = a.ruas || [], grupo = a.camada || "Ruas";
    const achados = lista.map(r => BuscaRuas.achar(r.nome, b, 25, r.de, r.ate));
    const faltam = [...new Set(lista.filter((r, k) => !achados[k].ok).map(r => r.nome))];
    if (faltam.length && b && navigator.onLine !== false) {
      log(`Procurando ${faltam.length} rua(s) no OpenStreetMap online (até 20 s)…`);
      const on = await overpassVarias(faltam, b);
      if (on.erro) log(`OpenStreetMap online: ${esc(on.erro)}. Desenhe a rua em <b>Planejar / Desenhar Rotas</b> ou abra o KML do My Maps em Arquivos.`, "aviso");
      lista.forEach((r, k) => { if (!achados[k].ok && on.achadas && on.achadas[r.nome]) achados[k] = on.achadas[r.nome]; });
    }
    let ok = 0; const semCor = [];
    lista.forEach((r, k) => {
      const x = achados[k], nome = r.de || r.ate ? `${r.nome} (${r.de || "…"} – ${r.ate || "…"})` : r.nome;
      if (!x.ok) { log(`✗ <b>${esc(nome)}</b>: ${esc(x.motivo || "não encontrada")}${x.sugestoes && x.sugestoes.length ? " · parecidas: " + x.sugestoes.map(esc).join(", ") : ""}`, "erro"); return; }
      if (!r.cor) semCor.push(r.nome);
      substituirPorNome(nome, grupo);
      novos.push(...itensDeLinhas(nome, x.linhas, { cor: r.cor, espessura: r.espessura, tracejado: r.tracejado, grupo }, `${x.nomeBase} · ${Math.round(x.metros)} m`));
      ok++;
      log(`✓ <b>${esc(nome)}</b> · ${Math.round(x.metros)} m${x.aviso ? ` · <i>${esc(x.aviso)}</i>` : ""}`, x.aviso ? "aviso" : "ok");
    });
    log(`<b>${ok} de ${lista.length}</b> rua(s) no planejamento.`, ok === lista.length ? "ok" : "aviso");
    if (semCor.length) log(`Sem cor definida no pedido (fiquei com cinza): ${semCor.map(esc).join(", ")}. Mude a cor no planejamento.`, "aviso");
    return novos;
  }
  async function executarPonto(a) {
    let pos = a.lat != null ? { lat: a.lat, lon: a.lon, nome: a.nome } : null;
    if (!pos && a.endereco) {
      const b = a.bairro ? BuscaRuas.bairro(a.bairro) : null;
      const e = BuscaRuas.esquina(a.endereco, b);
      if (e && e.ok) pos = e;
      else {
        if (e && !e.ok) log(`Esquina: ${esc(e.motivo)}. Tentando o endereço no OpenStreetMap…`, "aviso");
        try { pos = await geocodificar(a.endereco); } catch (err) { pos = null; }
      }
    }
    if (!pos) { log(`✗ Ponto "${esc(a.nome || a.endereco)}": não achei o lugar.`, "erro"); return null; }
    log(`✓ Ponto <b>${esc(a.nome || pos.nome)}</b>`, "ok");
    return FerramentasMapa.novoItem("ponto", [[pos.lat, pos.lon]], { nome: a.nome || pos.nome || "Ponto", cor: a.cor || "#dc2626", categoria: "Outro", status: "Planejado", obs: pos.nome || "", grupo: "Pontos" });
  }

  /* ---------- KML (My Maps, Google Earth) com estilo e aprendizado ---------- */
  const corKml = c => { const s = String(c || "").trim().replace("#", ""); return s.length === 8 ? "#" + s.slice(6, 8) + s.slice(4, 6) + s.slice(2, 4) : s.length === 6 ? "#" + s : null; };
  function lerKml(texto, nomeArq) {
    const doc = new DOMParser().parseFromString(texto, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("o arquivo KML está com problema");
    const filho = (el, tag) => [...el.children].find(c => c.localName === tag);
    const txt = (el, t) => el && el.getElementsByTagName(t)[0] ? el.getElementsByTagName(t)[0].textContent : null;
    const estilos = {};
    doc.querySelectorAll("Style[id]").forEach(s => {
      const ls = s.getElementsByTagName("LineStyle")[0], ps = s.getElementsByTagName("PolyStyle")[0], is = s.getElementsByTagName("IconStyle")[0];
      estilos["#" + s.getAttribute("id")] = { cor: corKml(txt(ls, "color") || txt(is, "color") || txt(ps, "color")), largura: parseFloat(txt(ls, "width") || "0") || null };
    });
    doc.querySelectorAll("StyleMap[id]").forEach(m => {
      const par = [...m.getElementsByTagName("Pair")].find(p => (p.getElementsByTagName("key")[0] || {}).textContent === "normal");
      const u = par && par.getElementsByTagName("styleUrl")[0]; if (u && estilos[u.textContent.trim()]) estilos["#" + m.getAttribute("id")] = estilos[u.textContent.trim()];
    });
    const coords = el => el.textContent.trim().split(/\s+/).map(c => { const [x, y] = c.split(",").map(Number); return [y, x]; }).filter(p => isFinite(p[0]) && isFinite(p[1]));
    const saida = [];
    doc.querySelectorAll("Placemark").forEach(pm => {
      let pasta = nomeArq; for (let p = pm.parentElement; p; p = p.parentElement) if (p.localName === "Folder" || p.localName === "Document") { const n = filho(p, "name"); if (n) { pasta = n.textContent.trim(); break; } }
      const nome = (filho(pm, "name") || {}).textContent?.trim() || "";
      const su = filho(pm, "styleUrl"), est = (su && estilos[su.textContent.trim()]) || {};
      const inline = filho(pm, "Style"); const ls = inline && inline.getElementsByTagName("LineStyle")[0];
      const cor = corKml(txt(ls, "color")) || est.cor, largura = parseFloat(txt(ls, "width")) || est.largura;
      // espessura do KML (px no Google) fica pela metade no mapa, para não cobrir as ruas vizinhas
      const esp = largura ? Math.max(1, Math.round(largura)) / 2 : 3;
      [...pm.getElementsByTagName("LineString")].map(x => coords(x.getElementsByTagName("coordinates")[0])).filter(l => l.length > 1)
        .forEach(l => saida.push({ pasta, nome, tipo: "linha", coords: l, cor: cor || "#2563eb", espessura: esp }));
      [...pm.getElementsByTagName("Polygon")].forEach(pg => { const anel = coords(pg.getElementsByTagName("LinearRing")[0].getElementsByTagName("coordinates")[0]); if (anel.length > 3) saida.push({ pasta, nome, tipo: "poligono", coords: anel.slice(0, -1), cor: cor || "#2563eb", espessura: esp }); });
      [...pm.getElementsByTagName("Point")].forEach(pt => { const p = coords(pt.getElementsByTagName("coordinates")[0])[0]; if (p) saida.push({ pasta, nome, tipo: "ponto", coords: [p], cor: cor || "#dc2626", espessura: 3 }); });
    });
    return saida;
  }
  function importarKml(texto, nomeArq) {
    const lidos = lerKml(texto, nomeArq.replace(/\.km[lz]$/i, ""));
    if (!lidos.length) throw new Error("não achei linhas, áreas nem pontos no KML");
    const novos = lidos.map(x => FerramentasMapa.novoItem(x.tipo, x.coords, { nome: x.nome || x.pasta, nomeBase: x.nome, cor: x.cor, espessura: x.espessura, grupo: x.pasta, obs: "importado de " + nomeArq }));
    FerramentasMapa.adicionarItens(novos);
    log(`KML <b>${esc(nomeArq)}</b>: ${lidos.length} item(ns) no planejamento, com as cores e espessuras do arquivo.`, "ok");
    // aprender: linhas com nome viram traçado de referência dos bairros que elas tocam
    const porNome = {};
    lidos.filter(x => x.tipo === "linha" && x.nome).forEach(x => (porNome[x.nome] = porNome[x.nome] || []).push(x.coords));
    const ref = Object.entries(porNome).flatMap(([nome, linhas]) => [...new Set(linhas.flat().map(p => BuscaRuas.bairroDoPonto(p)).filter(Boolean))].map(bairro => ({ nome, bairro, linhas, origem: nomeArq })));
    if (ref.length && confirm(`Guardar as ${Object.keys(porNome).length} linha(s) com nome deste KML como traçados de referência?\n\nDepois, quando você pedir uma rua com o mesmo nome no mesmo bairro, o mapa usa exatamente este traçado (vale para trechos de OS e para nomes diferentes do OpenStreetMap).`)) {
      const n = BuscaRuas.aprender(ref);
      log(`${n} traçado(s) de referência guardado(s) (${esc([...new Set(ref.map(x => x.bairro))].join(", "))}).`, "ok");
      mostrarReferencias();
    }
  }
  function mostrarReferencias() {
    const R = BuscaRuas.referencias(), el = $("refInfo"); if (!el) return;
    const porBairro = {}; R.forEach(r => porBairro[r.bairro] = (porBairro[r.bairro] || 0) + 1);
    el.innerHTML = R.length ? `<b>${R.length}</b> traçado(s) de referência: ${Object.entries(porBairro).map(([b, n]) => `${esc(b)} (${n})`).join(", ")}` : "Nenhum traçado de referência ainda.";
  }

  /* ---------- projeto (arquivo .json) ---------- */
  function baixar(nome, conteudo, tipo) { U.baixar(nome, conteudo, tipo); }
  const nomeArq = () => (titulo || "mapa de planejamento").replace(/[\\/:*?"<>|]/g, "-");
  function abrirArquivo(f) {
    const r = new FileReader();
    r.onload = () => {
      try {
        if (/\.kml$/i.test(f.name)) { importarKml(r.result, f.name); return; }
        const j = JSON.parse(r.result);
        if (j && j.tipo === "mapa_planejamento") {
          if (j.referencias) BuscaRuas.juntarReferencias(j.referencias);
          limparItens(); if (j.titulo != null) definirTitulo(j.titulo);
          if ((j.itens || []).length) FerramentasMapa.adicionarItens(j.itens);
          mostrarReferencias(); log(`Projeto <b>${esc(f.name)}</b> aberto: ${(j.itens || []).length} item(ns).`, "ok");
        } else throw new Error("para GeoJSON, shapefile ou KMZ use Planejar / Desenhar Rotas › Trazer arquivo para editar aqui");
      } catch (e) { log(`Não consegui abrir ${esc(f.name)}: ${esc(e.message)}`, "erro"); }
    };
    r.readAsText(f);
  }
  function definirTitulo(t) { titulo = t || ""; U.guardar("plano_titulo", titulo); if ($("inTitulo")) $("inTitulo").value = titulo; }

  /* ---------- painel principal ---------- */
  function resumo() {
    const L = itens(), n = t => L.filter(d => d.tipo === t).length;
    const km = L.filter(d => d.tipo === "linha" && d.visivel !== false).reduce((s, d) => s + (d.metros || 0), 0);
    $("resItens").innerHTML = L.length
      ? `<b>${n("linha")}</b> linha(s) · ${U.fmtKm(km)} &nbsp; <b>${n("poligono")}</b> área(s) &nbsp; <b>${n("ponto")}</b> ponto(s)`
      : "Nada no mapa ainda. Faça um pedido acima, abra um KML ou desenhe em <b>Planejar / Desenhar Rotas</b>.";
  }
  function aoVoltar() { resumo(); }

  async function rodarPedido() {
    const txt = $("pedido").value.trim(); if (!txt) return;
    const bt = $("btExecutar"); bt.disabled = true;
    log(`<span class="pedido-eco">${esc(txt.length > 140 ? txt.slice(0, 140) + "…" : txt)}</span>`);
    try {
      let plano;
      if ($("ckIA").checked) {
        try { plano = await Comandos.comIA(txt, s => log(s)); log(`Plano feito pela ${esc(plano.origem)}.`); }
        catch (e) { log(`IA: ${esc(e.message)} Usei o interpretador sem IA.`, "aviso"); plano = Comandos.interpretar(txt); }
      } else plano = Comandos.interpretar(txt);
      await executar(plano);
    } catch (e) { console.error(e); log("Erro: " + esc(e.message || e), "erro"); }
    bt.disabled = false; resumo();
  }

  function iniciar() {
    BuscaRuas.iniciar();
    iniciarMapa();
    FerramentasMapa.init(mapa);
    FerramentasExtra.init(mapa);
    Painel.ligarGaveta();
    definirTitulo(titulo);
    $("inTitulo").oninput = e => definirTitulo(e.target.value);
    $("btExecutar").onclick = rodarPedido;
    $("pedido").addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) rodarPedido(); });
    document.querySelectorAll("[data-exemplo]").forEach(b => b.onclick = () => { $("pedido").value = b.dataset.exemplo.replace(/\\n/g, "\n"); $("pedido").focus(); });
    $("btPlanejamento").onclick = () => FerramentasMapa.abrirEstudioPainel();
    $("btLimpar").onclick = () => { if (confirm("Apagar todos os itens do planejamento?")) { limparItens(); resumo(); log("Planejamento apagado."); } };
    $("btSalvarProj").onclick = () => baixar(nomeArq() + " (projeto).json", JSON.stringify({ tipo: "mapa_planejamento", versao: 2, titulo, itens: itens(), referencias: BuscaRuas.referencias() }), "application/json");
    $("btAbrirProj").onclick = () => $("inArq").click();
    $("inArq").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) { abrirArquivo(f); setTimeout(resumo, 600); } };
    $("btApagarRef").onclick = () => { if (confirm("Apagar todos os traçados de referência guardados neste navegador?")) { BuscaRuas.apagarReferencias(); mostrarReferencias(); } };
    mostrarReferencias();
    // IA
    const cfg = Comandos.lerCfg();
    $("inChave").value = cfg.chave || ""; $("selModelo").value = cfg.modelo || "gemini-flash-latest"; $("ckIA").checked = !!cfg.usar && !!cfg.chave;
    const salvarIA = () => Comandos.salvarCfg({ chave: $("inChave").value.trim(), modelo: $("selModelo").value, usar: $("ckIA").checked });
    ["inChave", "selModelo", "ckIA"].forEach(id => $(id).addEventListener("change", salvarIA));
    $("ckIA").addEventListener("change", () => { if ($("ckIA").checked && !$("inChave").value.trim()) { $("cfgIA").open = true; $("inChave").focus(); } });
    resumo();
    const L = itens(); if (L.length) { const g = L.flatMap(d => d.coords); if (g.length) mapa.fitBounds(L.flatMap(d => d.coords), { padding: [30, 30] }); }
  }

  return { iniciar, executar, aoVoltar, log, BASES, get mapa() { return mapa; }, get titulo() { return titulo; }, get itens() { return itens(); } };
})();
