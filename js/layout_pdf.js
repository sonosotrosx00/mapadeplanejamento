/* Impressão do Mapa de Planejamento num layout (.qpt do QGIS ou "Simples") e geração do PDF (A3 / A4)
   - lê o .qpt: página, rótulos, retângulos/elipses, figuras (SVG/PNG em base64), quadros de mapa e barra de escala;
   - desenha o mapa (fundo em blocos + linhas, áreas e pontos) na resolução de impressão;
   - textos dos rótulos editáveis antes de imprimir; cada item pode ficar de fora; legenda automática no lugar de um item.
   Limites: rótulos com expressões do QGIS só entendem a escala (map_scale) e o nome do layout; o resto da expressão sai em branco.
   Fontes do QGIS (Calibri etc.) saem em Helvetica. Itens girados saem sem giro. */
const LayoutPDF = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const PT = 25.4 / 72;           // 1 pt em mm
  const DPI = 150;                // resolução das imagens do mapa e das figuras
  const R = 6378137, MAXM = 20037508.342789244;

  let L_ = null;                  // layout atual { nome, w, h, itens: [...] }
  const est = { incluir: {}, textos: {}, legendaEm: "" };

  /* ---------- leitura do .qpt ---------- */
  const num = (s, i = 0) => { const v = String(s || "").split(",")[i]; return v == null ? 0 : parseFloat(v) || 0; };
  const corQ = s => { const p = String(s || "").split(","); return p.length >= 3 ? [+p[0], +p[1], +p[2], p[3] != null && !String(p[3]).includes("rgb") ? +p[3] : 255] : null; };
  const corXml = el => el ? [+el.getAttribute("red"), +el.getAttribute("green"), +el.getAttribute("blue"), +(el.getAttribute("alpha") ?? 255)] : null;
  function opcoes(el) { const o = {}; el && el.querySelectorAll("Option[name]").forEach(x => { if (x.getAttribute("value") != null && !(x.getAttribute("name") in o)) o[x.getAttribute("name")] = x.getAttribute("value"); }); return o; }

  function lerQpt(texto, nome) {
    const doc = new DOMParser().parseFromString(texto, "application/xml");
    const raiz = doc.documentElement;
    if (!raiz || raiz.nodeName !== "Layout") throw new Error("não parece um layout do QGIS (.qpt)");
    const pg = raiz.querySelector("PageCollection > LayoutItem");
    const w = pg ? num(pg.getAttribute("size"), 0) : 297, h = pg ? num(pg.getAttribute("size"), 1) : 210;
    const itens = [];
    [...raiz.children].filter(e => e.nodeName === "LayoutItem").forEach((e, k) => {
      const tipo = e.getAttribute("type");
      if (e.getAttribute("visibility") === "0") return;
      const pos = e.getAttribute("positionOnPage") || e.getAttribute("position");
      let x = num(pos, 0), y = num(pos, 1); const iw = num(e.getAttribute("size"), 0), ih = num(e.getAttribute("size"), 1);
      const rp = +(e.getAttribute("referencePoint") || 0);   // 0 sup.esq, 1 sup.meio, 2 sup.dir, 3 meio.esq, 4 centro, 5 meio.dir, 6 inf.esq, 7 inf.meio, 8 inf.dir
      x -= [0, .5, 1, 0, .5, 1, 0, .5, 1][rp] * iw; y -= [0, 0, 0, .5, .5, .5, 1, 1, 1][rp] * ih;
      const base = { k: "i" + k, tipo, id: e.getAttribute("id") || "", uuid: e.getAttribute("uuid") || "", x, y, w: iw, h: ih, z: +(e.getAttribute("zValue") || 0),
        moldura: e.getAttribute("frame") === "true" ? { cor: corXml(e.querySelector(":scope > FrameColor")), esp: num(e.getAttribute("outlineWidthM"), 0) || .3 } : null,
        fundo: e.getAttribute("background") === "true" ? corXml(e.querySelector(":scope > BackgroundColor")) : null };
      if (tipo === "65641") {   // rótulo
        const ts = e.querySelector("text-style") || e;
        const tam = parseFloat(ts.getAttribute("fontSize") || "10"), un = ts.getAttribute("fontSizeUnit") || "Point";
        itens.push({ ...base, cls: "rotulo", texto: e.getAttribute("labelText") || "", halign: +(e.getAttribute("halign") || 1), valign: +(e.getAttribute("valign") || 32),
          mx: +(e.getAttribute("marginX") || 0), my: +(e.getAttribute("marginY") || 0),
          tam: un === "MM" ? tam / PT : tam, negrito: ts.getAttribute("forcedBold") === "1" || +(ts.getAttribute("fontWeight") || 50) >= 63,
          cor: corQ(ts.getAttribute("textColor")) || [0, 0, 0, 255], html: e.getAttribute("htmlState") === "1" });
      } else if (tipo === "65643") {   // forma
        const o = opcoes(e.querySelector("symbol"));
        itens.push({ ...base, cls: "forma", forma: +(e.getAttribute("shapeType") || 1), raio: num(e.getAttribute("cornerRadiusMeasure"), 0),
          preench: o.style !== "no" ? corQ(o.color) : null, contorno: o.outline_style !== "no" ? corQ(o.outline_color) : null, espC: parseFloat(o.outline_width || ".26") });
      } else if (tipo === "65640") {   // figura
        const f = e.getAttribute("file") || "";
        itens.push({ ...base, cls: "figura", dado: f.startsWith("base64:") ? f.slice(7) : null, svg: e.getAttribute("mode") !== "1", arquivo: f.startsWith("base64:") ? "" : f });
      } else if (tipo === "65639") {   // mapa
        itens.push({ ...base, cls: "mapa" });
      } else if (tipo === "65646") {   // barra de escala
        const ts = e.querySelector("text-style");
        itens.push({ ...base, cls: "escala", mapa: e.getAttribute("mapUuid") || "", unidade: e.getAttribute("unitLabel") || "m", tam: ts ? parseFloat(ts.getAttribute("fontSize") || "7") : 7, cor: ts ? corQ(ts.getAttribute("textColor")) : [0, 0, 0, 255] });
      } else if (tipo !== "65638") {
        itens.push({ ...base, cls: "outro" });
      }
    });
    itens.sort((a, b) => a.z - b.z);
    // o mapa principal é o maior; os outros viram mapa de localização
    const mapas = itens.filter(i => i.cls === "mapa").sort((a, b) => b.w * b.h - a.w * a.h);
    mapas.forEach((m, i) => m.principal = i === 0);
    return { nome: nome || raiz.getAttribute("name") || "layout", w, h, itens };
  }

  /* ---------- layout "Simples" (sem .qpt) ---------- */
  function simples() {
    const w = 420, h = 297, V = [20, 83, 45, 255];
    const it = [
      { k: "s1", cls: "forma", forma: 1, x: 8, y: 8, w: w - 16, h: h - 16, z: 0, preench: null, contorno: V, espC: .5 },
      { k: "s2", cls: "mapa", principal: true, x: 12, y: 12, w: 320, h: h - 24, z: 1, moldura: { cor: [80, 80, 80, 255], esp: .3 } },
      { k: "s3", cls: "rotulo", id: "Titulo", texto: "MAPA DE PLANEJAMENTO", x: 338, y: 14, w: 74, h: 24, z: 2, halign: 1, valign: 32, mx: 0, my: 0, tam: 15, negrito: true, cor: V },
      { k: "s4", cls: "rotulo", id: "Subtitulo", texto: "Planejamento Operacional · Concessionária Belém Limpa", x: 338, y: 40, w: 74, h: 10, z: 2, halign: 1, valign: 32, mx: 0, my: 0, tam: 8, negrito: false, cor: [90, 90, 90, 255] },
      { k: "s5", cls: "forma", forma: 1, x: 338, y: 54, w: 74, h: 120, z: 1, preench: [248, 250, 248, 255], contorno: [200, 210, 200, 255], espC: .3, id: "Legenda" },
      { k: "s6", cls: "mapa", principal: false, x: 338, y: 180, w: 74, h: 62, z: 1, moldura: { cor: [120, 120, 120, 255], esp: .25 } },
      { k: "s7", cls: "escala", x: 338, y: 248, w: 60, h: 10, z: 2, unidade: "m", tam: 7, cor: [0, 0, 0, 255] },
      { k: "s8", cls: "rotulo", id: "Escala", texto: "Escala [% map_scale %]", x: 338, y: 262, w: 74, h: 6, z: 2, halign: 1, valign: 32, mx: 0, my: 0, tam: 8, negrito: false, cor: [60, 60, 60, 255] },
      { k: "s9", cls: "rotulo", id: "Data", texto: "Gerado em " + new Date().toLocaleDateString("pt-BR") + " · Base de ruas: OpenStreetMap · Bairros: IBGE 2022", x: 338, y: 270, w: 74, h: 14, z: 2, halign: 1, valign: 32, mx: 0, my: 0, tam: 6.5, negrito: false, cor: [110, 110, 110, 255] }
    ];
    return { nome: "Simples", w, h, itens: it, simples: true, legendaPadrao: "s5" };
  }

  /* ---------- escolha do layout e painel de itens ---------- */
  async function usarArquivo(nome, texto) {
    L_ = texto ? lerQpt(texto, nome) : simples();
    est.incluir = {}; est.textos = {}; est.editado = {};
    L_.itens.forEach(i => { est.incluir[i.k] = i.cls !== "outro" && !(i.cls === "figura" && !i.dado); if (i.cls === "rotulo") est.textos[i.k] = i.texto; });
    // legenda automática: no item chamado "legenda" (ex.: "Caixa legenda"), se houver
    const leg = L_.itens.find(i => i.cls === "forma" && /legenda/i.test(i.id)) || L_.itens.find(i => i.cls === "figura" && /legenda/i.test(i.id));
    est.legendaEm = L_.legendaPadrao || (leg ? leg.k : "");
    // rótulo do título: o que se chama "Titulo"; senão, o de texto mais longo entre os de letra grande
    const rots = L_.itens.filter(i => i.cls === "rotulo" && !/\[%/.test(i.texto));
    const tit = rots.find(i => /^t[ií]tulo$/i.test(i.id.trim())) || rots.find(i => /t[ií]tulo/i.test(i.id) && !/localiza|legenda|setor|turno|escala|folha|horario|frequencia|dias/i.test(i.id))
      || rots.filter(i => i.tam >= 9).sort((a, b) => b.texto.length - a.texto.length)[0];
    L_.titulo = tit ? tit.k : "";
    aplicarTitulo();
    painel();
  }
  // o título do projeto entra no rótulo do título, enquanto você não editar esse texto à mão
  function aplicarTitulo() {
    if (!L_ || !L_.titulo || est.editado[L_.titulo]) return;
    const orig = L_.itens.find(i => i.k === L_.titulo).texto;
    est.textos[L_.titulo] = Plano.titulo || orig;
    const ta = document.querySelector(`[data-txt="${L_.titulo}"]`); if (ta) ta.value = est.textos[L_.titulo];
  }
  function painel() {
    const box = $("lyItens"); if (!L_) { box.innerHTML = ""; return; }
    const nomeTipo = { rotulo: "Texto", forma: "Forma", figura: "Figura", mapa: "Mapa", escala: "Barra de escala", outro: "Outro (não impresso)" };
    const lista = L_.itens.filter(i => i.cls !== "outro" || true);
    $("lyResumo").textContent = `${L_.nome} · ${Math.round(L_.w)}×${Math.round(L_.h)} mm · ${L_.itens.length} itens`;
    const opcoesLeg = `<option value="">(sem legenda automática)</option>` + L_.itens.filter(i => ["figura", "forma", "rotulo"].includes(i.cls) && i.w > 25 && i.h > 15)
      .map(i => `<option value="${i.k}" ${est.legendaEm === i.k ? "selected" : ""}>${nomeTipo[i.cls]} ${esc(i.id || "")} (${Math.round(i.w)}×${Math.round(i.h)} mm)</option>`).join("");
    $("lyLegenda").innerHTML = opcoesLeg;
    box.innerHTML = lista.map(i => `<div class="ly-it ${i.cls}">
      <label class="ly-ck"><input type="checkbox" data-inc="${i.k}" ${est.incluir[i.k] ? "checked" : ""} ${i.cls === "outro" ? "disabled" : ""}> ${nomeTipo[i.cls]}${i.id && i.cls !== "rotulo" ? " · " + esc(i.id) : ""}${i.cls === "mapa" ? (i.principal ? " (principal)" : " (localização)") : ""}${i.cls === "figura" && !i.dado ? " · arquivo externo, não dá para imprimir" : ""}</label>
      ${i.cls === "rotulo" ? `<textarea data-txt="${i.k}" rows="${Math.min(4, Math.max(1, Math.ceil((est.textos[i.k] || "").length / 45)))}">${esc(est.textos[i.k])}</textarea>` : ""}
    </div>`).join("");
  }
  function ligar() {
    $("lyItens").addEventListener("change", e => { if (e.target.dataset.inc) est.incluir[e.target.dataset.inc] = e.target.checked; });
    $("lyItens").addEventListener("input", e => { if (e.target.dataset.txt) { est.textos[e.target.dataset.txt] = e.target.value; est.editado[e.target.dataset.txt] = true; } });
    $("inTitulo").addEventListener("input", aplicarTitulo);
    $("lyLegenda").onchange = e => { est.legendaEm = e.target.value; };
    if ($("lyPaginas")) { ["focus", "mousedown"].forEach(ev => $("lyPaginas").addEventListener(ev, opcoesPaginas)); opcoesPaginas(); }
    $("lySel").onchange = async e => {
      const v = e.target.value;
      if (v === "arquivo") { $("lyArq").click(); return; }
      try { await carregarPadrao(v); } catch (err) { Plano.log("Layout: " + esc(err.message), "erro"); }
    };
    $("lyArq").onchange = async e => {
      const f = e.target.files[0]; e.target.value = ""; if (!f) return;
      try { await usarArquivo(f.name.replace(/\.qpt$/i, ""), await f.text()); Plano.log(`Layout <b>${esc(f.name)}</b> carregado.`, "ok"); }
      catch (err) { Plano.log("Layout: " + esc(err.message), "erro"); }
    };
    $("btPdf").onclick = () => gerar().catch(err => { console.error(err); Plano.log("PDF: " + esc(err.message || err), "erro"); $("btPdf").disabled = false; $("btPdf").textContent = "Gerar PDF"; });
  }
  async function carregarPadrao(v) {
    if (v === "simples") return usarArquivo("Simples", null);
    const r = await fetch(v); if (!r.ok) throw new Error("não achei o arquivo " + v);
    return usarArquivo(v.split("/").pop().replace(/\.qpt$/i, ""), await r.text());
  }

  /* ---------- mapa em imagem ---------- */
  const merc = ([lat, lon]) => [lon * Math.PI / 180 * R, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * R];
  function extensaoDados() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = p => { const [x, y] = merc(p); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
    itensPDF().forEach(it => {
      if (it.tipo === "ponto") add(it.coords); else if (it.tipo === "linha") it.coords.forEach(l => l.forEach(add)); else it.coords.forEach(p => p.forEach(a => a.forEach(add)));
    });
    return isFinite(x0) ? [x0, y0, x1, y1] : null;
  }
  function extensaoBelem() {
    let ext = null;
    (window.BAIRROS_BELEM.features || []).filter(f => f.properties.distrito !== "Mosqueiro" && f.properties.distrito !== "Outeiro").forEach(f => {
      BuscaRuas.polysDe(f.geometry).forEach(p => p[0].forEach(pt => { const [x, y] = merc(pt); ext = ext ? [Math.min(ext[0], x), Math.min(ext[1], y), Math.max(ext[2], x), Math.max(ext[3], y)] : [x, y, x, y]; }));
    });
    return ext;
  }
  function carregaImg(src) {
    return new Promise(ok => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; setTimeout(() => ok(null), 15000); });
  }
  // desenha um mapa no tamanho w×h mm; devolve { url, escala, mpp }
  async function desenharMapa(wmm, hmm, ext, opc) {
    const W = Math.round(wmm / 25.4 * DPI), H = Math.round(hmm / 25.4 * DPI);
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
    // enquadra a extensão no quadro, com folga
    const folga = opc.folga ?? .08;
    const cx = (ext[0] + ext[2]) / 2, cy = (ext[1] + ext[3]) / 2;
    let mpp = Math.max((ext[2] - ext[0]) / W, (ext[3] - ext[1]) / H) * (1 + 2 * folga);
    mpp = Math.max(mpp, .08);
    const X = x => (x - cx) / mpp + W / 2, Y = y => H / 2 - (y - cy) / mpp;
    // fundo em blocos (tiles)
    const base = Plano.BASES[opc.base] || null;
    let falhas = 0;
    if (base) {
      const zMax = base.url.includes("Light_Gray") ? 16 : 19;
      const z = Math.max(2, Math.min(zMax, Math.round(Math.log2(2 * MAXM / 256 / mpp))));
      const res = 2 * MAXM / 256 / Math.pow(2, z);
      const tx0 = Math.floor((cx - W / 2 * mpp + MAXM) / (256 * res)), tx1 = Math.floor((cx + W / 2 * mpp + MAXM) / (256 * res));
      const ty0 = Math.floor((MAXM - (cy + H / 2 * mpp)) / (256 * res)), ty1 = Math.floor((MAXM - (cy - H / 2 * mpp)) / (256 * res));
      const pedidos = [];
      for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
        const url = base.url.replace("{z}", z).replace("{x}", tx).replace("{y}", ty);
        pedidos.push(carregaImg(url).then(im => {
          if (!im) { falhas++; return; }
          const xm = tx * 256 * res - MAXM, ym = MAXM - ty * 256 * res, lado = 256 * res / mpp;
          g.drawImage(im, X(xm), Y(ym), lado + .6, lado + .6);
        }));
      }
      if (pedidos.length > 600) throw new Error("mapa grande demais para o fundo: aproxime ou use 'sem fundo'");
      await Promise.all(pedidos);
      if (opc.clarear) { g.fillStyle = `rgba(255,255,255,${opc.clarear})`; g.fillRect(0, 0, W, H); }
    }
    // dados do projeto
    const pxMm = DPI / 25.4, esp = e => Math.max(1, (e || 3) * 0.2646 * pxMm * (opc.fatorLinha || 1));
    const traco = (pts) => { pts.forEach((p, i) => { const [x, y] = merc(p); i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)); }); };
    const ordem = { area: 0, linha: 1, ponto: 2 };
    (opc.dados === false ? [] : itensPDF()).sort((a, b) => ordem[a.tipo] - ordem[b.tipo]).forEach(it => {
      g.setLineDash(it.tracejado ? [esp(it.espessura) * 3, esp(it.espessura) * 2] : []);
      g.lineJoin = "round"; g.lineCap = "round"; g.strokeStyle = it.cor; g.lineWidth = esp(it.espessura);
      if (it.tipo === "linha") { it.coords.forEach(l => { g.beginPath(); traco(l); g.stroke(); }); }
      else if (it.tipo === "area") {
        g.beginPath(); it.coords.forEach(p => p.forEach(a => { traco(a); g.closePath(); }));
        if (it.preenchimento) { g.globalAlpha = .18; g.fillStyle = it.cor; g.fill("evenodd"); g.globalAlpha = 1; }
        g.stroke();
      } else if (it.tipo === "ponto") {
        const [x, y] = merc(it.coords); g.setLineDash([]); g.beginPath(); g.arc(X(x), Y(y), esp(it.espessura) * 1.8, 0, 2 * Math.PI);
        g.fillStyle = it.cor; g.fill(); g.lineWidth = esp(1.5); g.strokeStyle = "#fff"; g.stroke();
      }
    });
    g.setLineDash([]);
    if (opc.extra) opc.extra(g, X, Y, mpp);
    const lat = Math.atan(Math.sinh(cy / R)) * 180 / Math.PI;
    const mppChao = mpp * Math.cos(lat * Math.PI / 180);
    return { url: cv.toDataURL("image/jpeg", .9), escala: mppChao / (25.4 / DPI / 1000), mppChao, falhas, ext: [cx - W / 2 * mpp, cy - H / 2 * mpp, cx + W / 2 * mpp, cy + H / 2 * mpp] };
  }

  /* ---------- figuras (SVG/PNG em base64) ---------- */
  async function figuraPng(it, s) {
    const src = it.svg ? "data:image/svg+xml;base64," + it.dado : "data:image/png;base64," + it.dado;
    const im = await carregaImg(src); if (!im) return null;
    const W = Math.max(8, Math.round(it.w * s / 25.4 * DPI * 1.5)), H = Math.max(8, Math.round(it.h * s / 25.4 * DPI * 1.5));
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    // figura do QGIS no modo "esticar" (resizeMode 1) ou "ajustar": usa ajustar mantendo a proporção
    const iw = im.naturalWidth || W, ih = im.naturalHeight || H, k = Math.min(W / iw, H / ih);
    try { g.drawImage(im, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k); return cv.toDataURL("image/png"); } catch (e) { return null; }
  }

  /* ---------- legenda automática ---------- */
  const PLURAL = { passagem: "Passagens", avenida: "Avenidas", rodovia: "Rodovias", travessa: "Travessas", rua: "Ruas", alameda: "Alamedas", vila: "Vilas", estrada: "Estradas", conjunto: "Conjuntos" };
  function entradasLegenda() {
    const out = [], grupos = new Map();
    itensPDF().forEach(it => {
      const k = it.tipo + "|" + it.cor + "|" + it.espessura + "|" + !!it.tracejado + "|" + (it.tipo === "linha" ? "" : it.grupo);
      if (!grupos.has(k)) grupos.set(k, { it, nomes: [] });
      if (!grupos.get(k).nomes.includes(it.nome)) grupos.get(k).nomes.push(it.nome);
    });
    grupos.forEach(({ it, nomes }) => {
      let rot;
      if (it.tipo === "area" && it.grupo === "Municípios") rot = nomes.length >= 7 ? "Região Metropolitana de Belém" : nomes.map(n => n.replace(/^Município de /, "")).join(", ");
      else if (it.tipo === "area") rot = it.grupo === "Bairros" && nomes.length <= 3 ? nomes.join(", ") : it.grupo === "Bairros" ? `Limites dos bairros (${nomes.length})` : (nomes.length > 3 ? `${it.grupo || "Áreas"} (${nomes.length})` : nomes.join(", "));
      else if (it.tipo === "ponto") rot = nomes.length > 2 ? `${it.grupo || "Pontos"} (${nomes.length})` : nomes.join(", ");
      else { const tipos = [...new Set(nomes.map(n => Comandos.tipoDe(n)).filter(Boolean))].map(t => PLURAL[t]); rot = tipos.length ? tipos.join(" e ") : (nomes.length > 2 ? (it.grupo || "Linhas") : nomes.join(", ")); }
      out.push({ ...it, rot });
    });
    return out;
  }
  // itens visíveis do Planejar / Desenhar Rotas, no formato que o desenho do PDF usa
  function itensPDF() {
    return (Plano.itens || []).filter(d => d.visivel !== false && d.coords && d.coords.length).map(d => ({
      tipo: d.tipo === "poligono" ? "area" : d.tipo, nome: d.nomeBase || d.nome || "", grupo: d.grupo || "",
      coords: d.tipo === "ponto" ? d.coords[0] : d.tipo === "poligono" ? [[[...d.coords, d.coords[0]]]] : [d.coords],
      cor: d.cor || "#1e7b34", espessura: d.espessura || (d.tipo === "poligono" ? 3 : 5), tracejado: !!d.tracejada, preenchimento: d.tipo === "poligono" && d.preenchido !== false
    }));
  }
  function desenharLegenda(doc, x, y, w, h, s, fundoBranco) {
    const ents = entradasLegenda(); if (!ents.length) return;
    if (fundoBranco) { doc.setFillColor(255, 255, 255); doc.rect(x, y, w, h, "F"); }
    doc.setFont("helvetica", "bold"); doc.setFontSize(9 * s); doc.setTextColor(20, 83, 45);
    doc.text("LEGENDA", x + 3 * s, y + 5 * s);
    let yy = y + 10 * s; doc.setFont("helvetica", "normal");
    const tam = Math.max(6, Math.min(8.5, (h / s - 12) / ents.length / 0.6)) * s;
    for (const e of ents) {
      if (yy > y + h - 2) break;
      const c = hex(e.cor);
      doc.setDrawColor(...c); doc.setFillColor(...c);
      if (e.tipo === "linha") { doc.setLineWidth(Math.max(.25, e.espessura * .2646 * s)); if (e.tracejado) doc.setLineDashPattern([1.5, 1], 0); doc.line(x + 3 * s, yy - 1 * s, x + 11 * s, yy - 1 * s); doc.setLineDashPattern([], 0); }
      else if (e.tipo === "area") { doc.setLineWidth(.35 * s); if (e.tracejado) doc.setLineDashPattern([1.2, .8], 0); doc.rect(x + 3 * s, yy - 3 * s, 8 * s, 4 * s, e.preenchimento ? "FD" : "S"); doc.setLineDashPattern([], 0); }
      else { doc.circle(x + 7 * s, yy - 1 * s, 1.4 * s, "F"); }
      doc.setTextColor(40, 40, 40); doc.setFontSize(tam);
      const linhas = doc.splitTextToSize(e.rot, w - 16 * s).slice(0, 2);
      doc.text(linhas, x + 13 * s, yy);
      yy += Math.max(5.5 * s, linhas.length * tam * PT * 1.2 + 2.2 * s);
    }
  }
  const hex = h => { const v = parseInt(String(h).replace("#", ""), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };

  /* ---------- texto dos rótulos ---------- */
  function textoFinal(t, escala) {
    return String(t || "").replace(/\[%([\s\S]*?)%\]/g, (m, ex) => {
      if (/map_scale/.test(ex)) return "1:" + (Math.round(escala / 10) * 10).toLocaleString("pt-BR");
      if (/@layout_name/.test(ex)) return L_.nome;
      if (/now\(\)|@now/.test(ex)) return new Date().toLocaleDateString("pt-BR");
      return "";
    }).replace(/1:1:/, "1:");
  }

  /* ---------- PDF ---------- */
  async function gerar() {
    if (!L_) await carregarPadrao($("lySel").value);
    aplicarTitulo();
    const bt = $("btPdf"); bt.disabled = true;
    const papel = $("lyPapel").value;   // "A3" | "A4" | "original"
    const paisagem = L_.w >= L_.h;
    const alvo = papel === "original" ? [L_.w, L_.h] : papel === "A4" ? (paisagem ? [297, 210] : [210, 297]) : (paisagem ? [420, 297] : [297, 420]);
    const s = Math.min(alvo[0] / L_.w, alvo[1] / L_.h), ox = (alvo[0] - L_.w * s) / 2, oy = (alvo[1] - L_.h * s) / 2;
    const P = (x, y) => [ox + x * s, oy + y * s];
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "mm", format: alvo, orientation: paisagem ? "landscape" : "portrait", compress: true });
    const extTudo = extensaoDados();
    if (!extTudo) { Plano.log("O mapa está vazio: faça um pedido ou desenhe antes de imprimir.", "erro"); bt.disabled = false; return; }
    const base = $("lyFundo").value;   // ruas | cinza | satelite | osm | ""
    const itens = L_.itens.filter(i => est.incluir[i.k]);
    const grupoPag = $("lyPaginas") ? $("lyPaginas").value : "";
    const pags = paginas(grupoPag, extTudo);
    if (pags.length > 25 && !confirm(`Vão ser ${pags.length} páginas: pode levar alguns minutos e o arquivo fica grande. Continuar?`)) { bt.disabled = false; return; }
    Plano.log(pags.length > 1 ? `Montando o PDF: ${pags.length} páginas, uma para cada item de "${esc(grupoPag)}"…` : "Montando o PDF…");
    let escala = 0, falhas = 0;
    try {
      for (let pi = 0; pi < pags.length; pi++) {
        if (pi) doc.addPage(alvo, paisagem ? "landscape" : "portrait");
        bt.textContent = pags.length > 1 ? `Página ${pi + 1} de ${pags.length}…` : "Gerando…";
        const r = await pagina(doc, pags[pi], itens, s, P, base);
        if (!pi) escala = r.escala; falhas += r.falhas;
      }
    } finally { bt.textContent = "Gerar PDF"; }
    const nome = `${(Plano.titulo || "Mapa de planejamento").replace(/[\\/:*?"<>|]/g, "-")}${pags.length > 1 ? " - por " + grupoPag.replace(/[\\/:*?"<>|]/g, "-") : ""} - ${papel === "original" ? Math.round(alvo[0]) + "x" + Math.round(alvo[1]) : papel}.pdf`;
    doc.save(nome);
    Plano.log(`PDF pronto: <b>${esc(nome)}</b>${pags.length > 1 ? ` · ${pags.length} páginas` : ` · escala aproximada 1:${Math.round(escala).toLocaleString("pt-BR")}`}${falhas ? ` · <i>${falhas} bloco(s) do fundo não carregaram (sem internet?)</i>` : ""}`, falhas ? "aviso" : "ok");
    bt.disabled = false;
  }

  /* ---------- páginas: uma com tudo, ou uma para cada item de um grupo (bairros, áreas, rotas…) ---------- */
  const grupoDe = d => d.grupo || (d.tipo === "poligono" ? "Áreas" : d.tipo === "linha" ? "Linhas" : "Pontos");
  const nomeCurto = n => String(n || "").replace(/^Limite do bairro /, "").replace(/^Município de /, "");
  function opcoesPaginas() {
    const sel = $("lyPaginas"); if (!sel) return;
    const atual = sel.value, grupos = new Map();
    (Plano.itens || []).filter(d => d.visivel !== false && d.tipo !== "ponto" && d.coords && d.coords.length).forEach(d => {
      const g = grupoDe(d); if (!grupos.has(g)) grupos.set(g, new Set()); grupos.get(g).add(d.nomeBase || d.nome);
    });
    sel.innerHTML = `<option value="">Uma página com tudo</option>` + [...grupos].filter(([, n]) => n.size >= 2)
      .map(([g, n]) => `<option value="${esc(g)}">Uma página para cada item de "${esc(g)}" (${n.size})</option>`).join("");
    sel.value = [...sel.options].some(o => o.value === atual) ? atual : "";
  }
  function paginas(grupo, extTudo) {
    if (!grupo) return [{ ext: extTudo, sufixo: "" }];
    const porNome = new Map();
    (Plano.itens || []).filter(d => d.visivel !== false && d.tipo !== "ponto" && grupoDe(d) === grupo && d.coords && d.coords.length).forEach(d => {
      const k = d.nomeBase || d.nome; if (!porNome.has(k)) porNome.set(k, []); porNome.get(k).push(d);
    });
    const out = [];
    porNome.forEach((lista, nome) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      lista.forEach(d => d.coords.forEach(pt => { const [x, y] = merc(pt); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }));
      if (isFinite(x0)) out.push({ ext: [x0, y0, x1, y1], sufixo: nomeCurto(nome) });
    });
    out.sort((a, b) => a.sufixo.localeCompare(b.sufixo, "pt"));
    return out.length ? out : [{ ext: extTudo, sufixo: "" }];
  }

  // desenha uma página do layout no PDF (mapa enquadrado em pag.ext; título com o nome do item, no modo uma página por item)
  async function pagina(doc, pag, itens, s, P, base) {
    const ext = pag.ext;
    let escala = 0, extPrincipal = null, falhas = 0;
    // primeiro o mapa principal (a escala dele vai para a barra e os textos)
    const principal = itens.find(i => i.cls === "mapa" && i.principal);
    const imgs = {};
    if (principal) {
      // linhas 50% mais grossas que na tela: no papel, a espessura da tela fica fina demais
      const r = await desenharMapa(principal.w * s, principal.h * s, ext, { base, clarear: base === "satelite" ? 0 : .12, fatorLinha: 1.5 });
      imgs[principal.k] = r.url; escala = r.escala; extPrincipal = r.ext; falhas += r.falhas;
    }
    for (const i of itens) {
      if (i.cls === "mapa" && !i.principal) {
        const eb = extensaoBelem() || ext;
        const r = await desenharMapa(i.w * s, i.h * s, eb, { base: "cinza", folga: .03, dados: false, extra: (g, X, Y) => {
          // contorno dos bairros de Belém e retângulo da área do mapa principal
          g.strokeStyle = "rgba(90,100,95,.55)"; g.lineWidth = 1;
          (window.BAIRROS_BELEM.features || []).forEach(f => BuscaRuas.polysDe(f.geometry).forEach(p => p.forEach(a => {
            g.beginPath(); a.forEach((pt, n) => { const [x, y] = merc(pt); n ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)); }); g.closePath(); g.stroke();
          })));
          if (extPrincipal) { g.strokeStyle = "#dc2626"; g.lineWidth = 3; g.strokeRect(X(extPrincipal[0]), Y(extPrincipal[3]), Math.max(4, X(extPrincipal[2]) - X(extPrincipal[0])), Math.max(4, Y(extPrincipal[1]) - Y(extPrincipal[3]))); }
        } });
        imgs[i.k] = r.url; falhas += r.falhas;
      }
      if (i.cls === "figura" && i.dado) imgs[i.k] = await figuraPng(i, s);
    }
    // legenda automática: o que estiver dentro da caixa dela (e por cima) sai do PDF
    const alvoLeg = itens.find(i => i.k === est.legendaEm);
    // (vale o centro do item: textos da legenda antiga às vezes vazam um pouco da caixa)
    const dentroLeg = i => { if (!alvoLeg || i === alvoLeg || i.z <= alvoLeg.z || i.cls === "mapa") return false; const cx = i.x + i.w / 2, cy = i.y + i.h / 2; return cx >= alvoLeg.x && cx <= alvoLeg.x + alvoLeg.w && cy >= alvoLeg.y && cy <= alvoLeg.y + alvoLeg.h; };
    for (const i of itens) {
      if (dentroLeg(i)) continue;
      const [x, y] = P(i.x, i.y), w = i.w * s, h = i.h * s;
      if (i.fundo && i.fundo[3] > 0 && i.cls !== "mapa") { doc.setFillColor(...i.fundo.slice(0, 3)); doc.rect(x, y, w, h, "F"); }
      if (i === alvoLeg && i.cls !== "forma") { desenharLegenda(doc, x, y, w, h, s, true); continue; }
      if (i.cls === "forma") {
        const modo = (i.preench && i.preench[3] > 0 ? "F" : "") + (i.contorno ? "D" : "");
        if (!modo) continue;
        if (i.preench) doc.setFillColor(...i.preench.slice(0, 3));
        if (i.contorno) { doc.setDrawColor(...i.contorno.slice(0, 3)); doc.setLineWidth(i.espC * s); }
        if (i.forma === 0) doc.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, modo);
        else if (i.forma === 2) doc.triangle(x + w / 2, y, x + w, y + h, x, y + h, modo);
        else if (i.raio > 0) doc.roundedRect(x, y, w, h, i.raio * s, i.raio * s, modo); else doc.rect(x, y, w, h, modo);
        if (i === alvoLeg) desenharLegenda(doc, x + 1 * s, y + 1 * s, w - 2 * s, h - 2 * s, s, false);
      } else if (i.cls === "figura" && imgs[i.k]) {
        doc.addImage(imgs[i.k], "PNG", x, y, w, h, undefined, "FAST");
      } else if (i.cls === "mapa" && imgs[i.k]) {
        doc.addImage(imgs[i.k], "JPEG", x, y, w, h, undefined, "FAST");
      } else if (i.cls === "rotulo") {
        const txt = textoFinal((est.textos[i.k] ?? i.texto) + (pag.sufixo && i.k === L_.titulo ? " – " + pag.sufixo : ""), escala).replace(/<[^>]+>/g, "");
        if (!txt.trim()) continue;
        doc.setFont("helvetica", i.negrito ? "bold" : "normal"); doc.setTextColor(...i.cor.slice(0, 3));
        const lw = Math.max(1, w - 2 * i.mx * s);
        // a Helvetica é mais larga que a Calibri do QGIS: diminui a letra (até 55%) até caber na caixa
        const quebras = txt.split("\n").length;
        let tam = i.tam * s, linhas, lh, alt;
        for (let k = 0; k < 12; k++) {
          doc.setFontSize(tam);
          linhas = txt.split("\n").flatMap(l => doc.splitTextToSize(l, lw));
          lh = tam * PT * 1.15; alt = linhas.length * lh;
          const cabe = alt <= h + .3 && (linhas.length <= quebras || alt <= h * .95);
          if (cabe || tam <= i.tam * s * .55) break;
          tam *= .93;
        }
        let ty = (i.valign & 128) ? y + (h - alt) / 2 : (i.valign & 64) ? y + h - alt - i.my * s : y + i.my * s;
        const al = (i.halign & 4) ? "center" : (i.halign & 2) ? "right" : "left";
        const tx = al === "center" ? x + w / 2 : al === "right" ? x + w - i.mx * s : x + i.mx * s;
        linhas.forEach((l, n) => doc.text(l, tx, ty + (n + .8) * lh, { align: al }));
      } else if (i.cls === "escala" && escala) {
        barraEscala(doc, x, y, w, h, s, escala, i);
      }
      if (i.moldura && i.moldura.cor) { doc.setDrawColor(...i.moldura.cor.slice(0, 3)); doc.setLineWidth(i.moldura.esp * s); doc.rect(x, y, w, h, "S"); }
    }
    return { escala, falhas };
  }
  function barraEscala(doc, x, y, w, h, s, escala, i) {
    const mPorMm = escala / 1000;
    const alvoMm = w * .8, bruto = alvoMm * mPorMm, pot = Math.pow(10, Math.floor(Math.log10(bruto)));
    const passo = [1, 2, 2.5, 5, 10].map(k => k * pot).filter(v => v <= bruto).pop() || pot;
    const segMm = passo / 2 / mPorMm, by = y + h * .55;
    doc.setDrawColor(30, 30, 30); doc.setLineWidth(.3 * s);
    doc.setFillColor(30, 30, 30); doc.rect(x, by, segMm, 1.4 * s, "FD");
    doc.setFillColor(255, 255, 255); doc.rect(x + segMm, by, segMm, 1.4 * s, "FD");
    doc.setFont("helvetica", "normal"); doc.setFontSize(i.tam * s); doc.setTextColor(...(i.cor || [0, 0, 0]).slice(0, 3));
    const fmt = v => v >= 1000 ? (v / 1000).toLocaleString("pt-BR") + " km" : Math.round(v) + " m";
    doc.text("0", x, by - 1 * s, { align: "center" });
    doc.text(fmt(passo / 2), x + segMm, by - 1 * s, { align: "center" });
    doc.text(fmt(passo), x + 2 * segMm, by - 1 * s, { align: "center" });
  }

  return { ligar, carregarPadrao, gerar, lerQpt, entradasLegenda, get layout() { return L_; } };
})();
