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
  // OpenStreetMap online (Nominatim): região metropolitana (Belém, Ananindeua, Marituba); recusa resultado genérico ("Belém, Pará")
  const GENERICO = /^(city|town|municipality|state|region|country|county|state_district|suburb|city_district|quarter|neighbourhood|borough)$/;
  async function geocodificar(endereco) {
    const vb = "-48.62,-1.02,-48.25,-1.53";
    const cidade = /ananindeua|marituba|benevides|santa b[aá]rbara|bel[eé]m/i.test(endereco) ? "" : ", Belém";
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=br&viewbox=${vb}&bounded=1&q=${encodeURIComponent(endereco + cidade + ", Pará")}`, { headers: { "Accept-Language": "pt-BR" } });
    const j = await r.json();
    const ok = (j || []).find(x => !GENERICO.test(x.addresstype || "") && !(x.category === "boundary" || x.type === "administrative"));
    return ok ? { lat: +ok.lat, lon: +ok.lon, nome: ok.name || ok.display_name.split(",")[0], como: "OpenStreetMap" } : null;
  }
  /* ---------- links do Google Maps e lugares salvos ---------- */
  // link completo: o pino vem em "!3d<lat>!4d<lon>"; sem pino, usa "@lat,lon" ou "?q=lat,lon"
  function lerLinkGoogle(s) {
    const t = String(s || "");
    if (!/google\.[a-z.]+\/maps|maps\.google\./i.test(t)) return null;
    const pino = t.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) || t.match(/[?&](?:q|ll|query|destination|daddr)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i)
      || t.match(/\/maps\/(?:search|place|dir)\/(-?\d{1,2}\.\d+)(?:,|%2C)(?:\+|%20|\s)*(-?\d{1,3}\.\d+)/i);   // pino solto: /maps/search/-1.45,+-48.47
    const lugar = t.match(/\/place\/([^/@?]+)/);
    let nome = ""; try { nome = lugar ? decodeURIComponent(lugar[1].replace(/\+/g, " ")).split(",")[0] : ""; } catch (e) {}
    // lugar escrito em graus/minutos/segundos (1°26'53.6"S 48°28'13.3"W): sem pino no link, usa ele
    const gms = lerGMS(nome);
    if (gms) nome = "Coordenada " + nome.trim();
    if (pino) return { lat: +pino[1], lon: +pino[2], nome: nome || "Lugar do Google Maps", como: "link do Google Maps" };
    if (gms) return { ...gms, nome, como: "link do Google Maps (coordenada)" };
    // só "@lat,lon": é o centro da tela do Google, não o pino
    const tela = t.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (!tela) return null;
    return { lat: +tela[1], lon: +tela[2], nome: nome || "Lugar do Google Maps", como: "link do Google Maps SEM o pino: usei o centro da tela do Google, confira no mapa (copie o link depois que a página do lugar terminar de abrir)" };
  }
  // 1°26'53.6"S 48°28'13.3"W  ou  1 26 53.6 S, 48 28 13.3 W
  function lerGMS(s) {
    const re = /(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['’′]\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:"|”|″|'')?\s*([NSns])[\s,;]+(\d{1,3})\s*[°º]\s*(\d{1,2})\s*['’′]\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:"|”|″|'')?\s*([EWOLewol])/;
    const m = String(s || "").match(re); if (!m) return null;
    const g = (a, b, c) => +a + +b / 60 + +String(c).replace(",", ".") / 3600;
    const lat = g(m[1], m[2], m[3]) * (/[Ss]/.test(m[4]) ? -1 : 1), lon = g(m[5], m[6], m[7]) * (/[WwOo]/.test(m[8]) ? -1 : 1);
    return { lat, lon };
  }
  const ehLinkCurto = s => /(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(String(s || ""));
  const MSG_LINK_CURTO = "não consegui abrir o link curto do Google Maps agora. Abra o link no navegador, copie o endereço completo da barra (começa com google.com/maps/place/…) e cole no lugar do curto.";
  // link curto (maps.app.goo.gl): a função api/expandir.js do site abre o link no servidor e devolve o link completo com o pino
  const curtos = {};
  async function abrirLinkCurto(s) {
    const u = (String(s).match(/https:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/[A-Za-z0-9_-]+/) || [])[0]; if (!u) return null;
    if (!curtos[u]) curtos[u] = fetch("api/expandir?u=" + encodeURIComponent(u)).then(r => r.ok ? r.json() : null).then(j => j && j.url ? lerLinkGoogle(j.url) : null).catch(() => null);
    const g = await curtos[u]; if (!g) delete curtos[u];
    return g;
  }
  const CHAVE_LUG = "plano_lugares";
  function lugaresSalvos() { let L = []; try { L = JSON.parse(localStorage.getItem(CHAVE_LUG) || "[]"); } catch (e) {} return L; }
  function guardarLugares(L) { try { localStorage.setItem(CHAVE_LUG, JSON.stringify(L)); } catch (e) {} }
  const todosLugares = () => [...lugaresSalvos(), ...(window.LUGARES_PADRAO || []).map(l => ({ ...l, padrao: true }))];
  function acharLugarSalvo(txt) {
    const q = Comandos.norm(txt).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); if (q.length < 4) return null;
    const nomes = l => [l.nome, ...(l.apelidos || [])].map(n => Comandos.norm(n).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim());
    const l = todosLugares().find(l => nomes(l).some(n => n === q)) || todosLugares().find(l => nomes(l).some(n => q.includes(n) || (q.length >= 6 && n.includes(q))));
    return l ? { lat: l.lat, lon: l.lon, nome: l.nome, como: "lugar salvo" } : null;
  }

  // acha um lugar escrito de qualquer jeito: link do Google Maps, coordenada, lugar salvo, esquina, rua (+ bairro) na base local ou nome no OpenStreetMap
  async function resolverLugar(txt, bairroPedido) {
    const s = String(txt || "").trim(); if (!s) return null;
    // pino sem nome (link de coordenada): o nome vira "perto da <rua mais próxima>"
    const nomear = p => {
      if (p.nome !== "Lugar do Google Maps" || typeof LOC === "undefined" || !LOC.pertoDe) return p;
      const r = LOC.pertoDe([p.lat, p.lon], 120); if (!r) return p;
      const b = BuscaRuas.bairroDoPonto([p.lat, p.lon]);
      return { ...p, nome: "Perto da " + LOC.nomeDe(r.si) + (b ? ", " + b : "") };
    };
    const g = lerLinkGoogle(s); if (g) return nomear(g);
    if (ehLinkCurto(s)) { const c = await abrirLinkCurto(s); return c ? nomear(c) : { erro: MSG_LINK_CURTO }; }
    const salvo = acharLugarSalvo(s); if (salvo) return salvo;
    const gms = lerGMS(s); if (gms) return { ...gms, nome: s, como: "coordenada" };
    const ll = s.match(/(-?\d{1,2}[.,]\d+)\s*[,; ]\s*(-?\d{1,3}[.,]\d+)/);
    if (ll) return { lat: +ll[1].replace(",", "."), lon: +ll[2].replace(",", "."), nome: s, como: "coordenada" };
    const partes = s.split(/\s*,\s*|\s+[–-]\s+/).map(x => x.trim()).filter(Boolean);
    // bairro escrito depois da rua ("…, 9 Cremação" ou "…, Cremação")
    let bairro = bairroPedido ? BuscaRuas.bairro(bairroPedido) : null;
    if (!bairro) for (const p of partes.slice(1)) { const sem = p.replace(/^(n[º°o.]?\s*)?\d+\s*/i, "").trim(); if (sem.length > 3 && !Comandos.tipoDe(sem)) { const b = BuscaRuas.bairro(sem); if (b && Comandos.norm(b.nome).startsWith(Comandos.norm(sem).slice(0, 5))) { bairro = b; break; } } }
    if (/\s(com|x|esquina com|esq\.?)\s/i.test(partes[0])) { const e = BuscaRuas.esquina(partes[0], bairro); if (e && e.ok) return { lat: e.lat, lon: e.lon, nome: e.nome, como: "esquina" }; }
    const rua = partes[0].replace(/[,\s]+(n[º°o.]?\s*)?\d+\w?\s*$/i, "").trim();
    const daBase = () => {
      let x = BuscaRuas.achar(rua, bairro, 60), foraDoBairro = false;
      if (!x.ok && bairro) { x = BuscaRuas.achar(rua, null); foraDoBairro = x.ok; }
      if (!x.ok) return null;
      const l = x.linhas.slice().sort((a, b) => b.length - a.length)[0], p = l[Math.floor(l.length / 2)];
      const ondeFica = BuscaRuas.bairroDoPonto(p);
      return { lat: p[0], lon: p[1], nome: x.nomeBase + (ondeFica ? ", " + ondeFica : ""),
        como: "meio da rua" + (/\d/.test(partes.join(" ")) ? ", o número da casa não é usado" : "")
          + (foraDoBairro ? `; ATENÇÃO: no mapa ela não fica na ${bairro.nome}, e sim ${ondeFica ? "na " + ondeFica : "fora de Belém"}: confira` : "") };
    };
    const online = async () => { try { return await geocodificar(s); } catch (e) { return null; } };
    // com tipo de via (Rua, Vila, Passagem…): base local primeiro; nome de lugar (empresa, praça): OpenStreetMap primeiro
    return Comandos.tipoDe(rua) ? (daBase() || await online()) : (await online() || daBase());
  }
  // tira vértices que não mudam o desenho (Douglas-Peucker, tolerância em metros): a rota do serviço vem com centenas de pontos
  function simplificar(c, tol = 2) {
    if (c.length < 3) return c;
    const kx = 111320 * Math.cos(c[0][0] * Math.PI / 180), ky = 110574;
    const d = (p, a, b) => { const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; let t = L ? -(ax * dx + ay * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(ax + t * dx, ay + t * dy); };
    const manter = new Uint8Array(c.length); manter[0] = manter[c.length - 1] = 1;
    const pilha = [[0, c.length - 1]];
    while (pilha.length) {
      const [i, j] = pilha.pop(); let k = -1, max = tol;
      for (let n = i + 1; n < j; n++) { const v = d(c[n], c[i], c[j]); if (v > max) { max = v; k = n; } }
      if (k >= 0) { manter[k] = 1; pilha.push([i, k], [k, j]); }
    }
    return c.filter((_, n) => manter[n]);
  }
  const fmtMin = s => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };
  async function executarRota(a) {
    const textos = [a.de, ...(a.paradas || []), a.ate].filter(Boolean);
    if (textos.length < 2) { log("Rota: diga de onde sai e até onde vai.", "erro"); return []; }
    const pts = [];
    for (const t of textos) {
      const p = await resolverLugar(t, a.bairro);
      const curto = t.length > 60 ? t.slice(0, 57) + "…" : t;
      if (p && p.erro) { log(`✗ Rota: ${esc(curto)}: ${esc(p.erro)}`, "erro"); return []; }
      if (!p) { log(`✗ Rota: não achei <b>${esc(curto)}</b>. Cole o link do Google Maps do lugar, uma esquina ("Av. X com Tv. Y"), a coordenada, ou salve o lugar em Lugares salvos.`, "erro"); return []; }
      pts.push(p); log(`· ${esc(curto)} → <b>${esc(p.nome)}</b> <i>(${esc(p.como)})</i>`);
    }
    const pe = a.modo === "pe", reta = a.modo === "reta";
    let rt;
    if (reta) {
      // linha reta entre os pontos (sem seguir as ruas)
      const c = pts.map(p => [p.lat, p.lon]); rt = { geometry: { coordinates: c.map(([y, x]) => [x, y]) }, distance: BuscaRuas.comprLinha(c), duration: 0 };
    } else {
      let r;
      try { r = await fetch((pe ? CFG.rotas.pe : CFG.rotas.carro) + pts.map(p => `${p.lon},${p.lat}`).join(";") + "?overview=full&geometries=geojson").then(x => x.json()); }
      catch (e) { r = null; }
      if (!r || r.code !== "Ok" || !r.routes || !r.routes[0]) { log("✗ Rota: o serviço de rotas não respondeu agora. Tente de novo em instantes.", "erro"); return []; }
      rt = r.routes[0];
    }
    let coordsRota = rt.geometry.coordinates.map(([x, y]) => [y, x]);
    if (!reta && coordsRota.length) {
      // o serviço de rotas começa/termina na rua mais próxima por onde dá para passar (de carro ou a pé);
      // se o pino fica longe dela (dentro de uma vila, por exemplo), liga o pino até a rota com um trecho reto
      const ini = [pts[0].lat, pts[0].lon], fim = [pts[pts.length - 1].lat, pts[pts.length - 1].lon];
      const dIni = BuscaRuas.comprLinha([ini, coordsRota[0]]), dFim = BuscaRuas.comprLinha([coordsRota[coordsRota.length - 1], fim]);
      if (dIni > 8) { coordsRota.unshift(ini); log(`· A rota ${pe ? "a pé" : "de carro"} começa na rua mais próxima, a ${Math.round(dIni)} m do ponto de saída: liguei os dois em linha reta.${pe ? "" : " Se for passagem ou vila, peça \"a pé\"."}`, "aviso"); }
      if (dFim > 8) { coordsRota.push(fim); log(`· A rota termina na rua mais próxima, a ${Math.round(dFim)} m do ponto de chegada: liguei os dois em linha reta.`, "aviso"); }
    }
    const km = U.fmtKm(BuscaRuas.comprLinha(coordsRota)), tempo = reta ? "em linha reta" : fmtMin(rt.duration) + (pe ? " a pé" : " de carro");
    // link ou coordenada no pedido: o nome que aparece é o do lugar achado
    const nomes = textos.map((t, i) => /^https?:\/\/|^-?\d{1,2}[.,]\d+\s*[,; ]/.test(t.trim()) ? pts[i].nome : t);
    const tipoNome = a.nome === "Linha" ? "Linha" : "Rota";
    const nome = a.nome && a.nome !== "Rota" && a.nome !== "Linha" ? a.nome : `${tipoNome} ${nomes[0]} → ${nomes[nomes.length - 1]}`;
    // pedir de novo a mesma rota troca a anterior (não duplica a linha e os pinos)
    substituirPorNome(nome, tipoNome === "Linha" ? "Linhas" : "Rotas");
    if (a.marcos !== false) pts.forEach((p, i) => { const ult = i === pts.length - 1; substituirPorNome(`${i === 0 ? "Saída" : ult ? "Chegada" : "Parada " + i}: ${nomes[i]}`, "Rotas"); });
    const itensRota = [FerramentasMapa.novoItem("linha", simplificar(coordsRota), { nome, nomeBase: nome, cor: a.cor || "#dc2626", espessura: a.espessura || 4, grupo: tipoNome === "Linha" ? "Linhas" : "Rotas", obs: `${km} · ${tempo} · ${nomes.join(" → ")}` })];
    if (a.marcos !== false) pts.forEach((p, i) => {
      const ult = i === pts.length - 1, rot = i === 0 ? "Saída" : ult ? "Chegada" : "Parada " + i;
      itensRota.push(FerramentasMapa.novoItem("ponto", [[p.lat, p.lon]], { nome: `${rot}: ${nomes[i]}`, nomeBase: `${rot}: ${nomes[i]}`, cor: i === 0 ? "#1e7b34" : ult ? "#c0392b" : "#e8590c", categoria: "Outro", status: "Planejado", grupo: "Rotas", obs: p.nome }));
    });
    log(`✓ <b>${esc(nome)}</b> · ${km} · ${tempo}`, "ok");
    return itensRota;
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
      if (a.tipo === "rota") { novos.push(...await executarRota(a)); continue; }
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
    if (!pos) pos = await resolverLugar(a.endereco || a.nome, a.bairro);
    if (pos && pos.erro) { log(`✗ Ponto: ${esc(pos.erro)}`, "erro"); return null; }
    if (!pos) { log(`✗ Ponto "${esc(a.nome || a.endereco)}": não achei o lugar. Escreva a rua e o bairro, uma esquina ou a coordenada, ou use Novo ponto no Planejar.`, "erro"); return null; }
    // link ou coordenada no pedido: o nome do ponto é o do lugar achado
    if (a.nome && /^https?:\/\/|^-?\d{1,2}[.,]\d+\s*[,; ]/.test(a.nome.trim())) a = { ...a, nome: pos.nome };
    log(`✓ Ponto <b>${esc(a.nome || pos.nome)}</b>${pos.como ? ` <i>(${esc(pos.como)})</i>` : ""}`, "ok");
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

  /* ---------- painel "Lugares salvos" ---------- */
  let marcaLugar = null;
  function listarLugares() {
    const box = $("lugLista"); if (!box) return;
    const L = todosLugares();
    box.innerHTML = L.length ? L.map((l, i) => `<div class="lug"><div class="lug-n"><b>${esc(l.nome)}</b>${l.padrao ? ' <span class="nota">(do site)</span>' : ""}<br><span class="nota">${l.endereco ? esc(l.endereco) + " · " : ""}${(+l.lat).toFixed(6)}, ${(+l.lon).toFixed(6)}</span></div>
      <button type="button" class="sec" data-lug-ver="${i}" title="Ver no mapa">Ver</button>${l.padrao ? "" : `<button type="button" class="sec" data-lug-tira="${esc(l.nome)}" title="Excluir">&times;</button>`}</div>`).join("")
      : `<p class="nota">Nenhum lugar salvo.</p>`;
    box.querySelectorAll("[data-lug-ver]").forEach(b => b.onclick = () => {
      const l = L[+b.dataset.lugVer]; if (marcaLugar) mapa.removeLayer(marcaLugar);
      marcaLugar = window.L.marker([l.lat, l.lon]).bindTooltip(l.nome, { permanent: true, direction: "top", className: "dica" }).addTo(mapa); mapa.setView([l.lat, l.lon], 17);
    });
    box.querySelectorAll("[data-lug-tira]").forEach(b => b.onclick = () => { if (!confirm(`Excluir "${b.dataset.lugTira}" dos lugares salvos?`)) return; guardarLugares(lugaresSalvos().filter(l => l.nome !== b.dataset.lugTira)); listarLugares(); });
  }
  function salvarLugar(nome, pos, endereco) {
    nome = (nome || pos.nome || "").trim(); if (!nome) { alert("Dê um nome ao lugar."); return false; }
    const L = lugaresSalvos().filter(l => Comandos.norm(l.nome) !== Comandos.norm(nome));
    L.push({ nome, lat: +pos.lat.toFixed(7), lon: +pos.lon.toFixed(7), endereco: endereco || "" });
    guardarLugares(L); listarLugares(); log(`Lugar <b>${esc(nome)}</b> salvo: use o nome nos pedidos (ex.: "rota da ${esc(nome)} até …").`, "ok");
    return true;
  }
  function ligarLugares() {
    $("btLugSalvar").onclick = async () => {
      const txt = $("lugOnde").value.trim(), nome = $("lugNome").value.trim();
      if (!txt) { alert("Cole o link do Google Maps ou a coordenada, ou use Marcar no mapa."); return; }
      const pos = lerLinkGoogle(txt) || await resolverLugar(txt);
      if (pos && pos.erro) { alert(pos.erro); return; }
      if (!pos || pos.erro) { alert("Não consegui ler esse lugar. Cole o link completo do Google Maps ou a coordenada (ex.: -1.385236, -48.402400)."); return; }
      if (salvarLugar(nome || (pos.como === "link do Google Maps" ? pos.nome : ""), pos)) { $("lugNome").value = ""; $("lugOnde").value = ""; }
    };
    $("btLugMapa").onclick = () => {
      const nome = $("lugNome").value.trim(); if (!nome) { alert("Escreva o nome do lugar primeiro."); $("lugNome").focus(); return; }
      FerramentasMapa.pararTudo(); mapa.getContainer().classList.add("cursor-desenho"); $("lugDica").textContent = "Clique no mapa no lugar exato.";
      mapa.once("click", e => { mapa.getContainer().classList.remove("cursor-desenho"); $("lugDica").textContent = ""; if (salvarLugar(nome, { lat: e.latlng.lat, lon: e.latlng.lng })) $("lugNome").value = ""; });
    };
    listarLugares();
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
          if (Array.isArray(j.lugares)) { const L = lugaresSalvos(); j.lugares.forEach(l => { if (!L.some(x => Comandos.norm(x.nome) === Comandos.norm(l.nome))) L.push(l); }); guardarLugares(L); listarLugares(); }
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
    $("btSalvarProj").onclick = () => baixar(nomeArq() + " (projeto).json", JSON.stringify({ tipo: "mapa_planejamento", versao: 3, titulo, itens: itens(), referencias: BuscaRuas.referencias(), lugares: lugaresSalvos() }), "application/json");
    $("btAbrirProj").onclick = () => $("inArq").click();
    $("inArq").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) { abrirArquivo(f); setTimeout(resumo, 600); } };
    $("btApagarRef").onclick = () => { if (confirm("Apagar todos os traçados de referência guardados neste navegador?")) { BuscaRuas.apagarReferencias(); mostrarReferencias(); } };
    mostrarReferencias();
    ligarLugares();
    // IA
    const cfg = Comandos.lerCfg();
    $("inChave").value = cfg.chave || ""; $("selModelo").value = cfg.modelo || "gemini-flash-latest"; $("ckIA").checked = !!cfg.usar && !!cfg.chave;
    const salvarIA = () => Comandos.salvarCfg({ chave: $("inChave").value.trim(), modelo: $("selModelo").value, usar: $("ckIA").checked });
    ["inChave", "selModelo", "ckIA"].forEach(id => $(id).addEventListener("change", salvarIA));
    $("ckIA").addEventListener("change", () => { if ($("ckIA").checked && !$("inChave").value.trim()) { $("cfgIA").open = true; $("inChave").focus(); } });
    $("btTestarIA").onclick = async () => {
      const bt = $("btTestarIA"), out = $("testeIA"); bt.disabled = true; out.textContent = "Testando…";
      const res = await Comandos.testarChave($("inChave").value.trim());
      const bons = res.filter(r => r.ok).length;
      out.innerHTML = res.map(r => `<span style="color:${r.ok ? "#166534" : "#b42318"}">${r.ok ? "✓" : "✗"} ${esc(r.modelo)}: ${esc(r.texto)}</span>`).join("<br>")
        + (bons ? `<br><b>A chave funciona</b> (${bons} de ${res.length} modelos respondendo agora).` : `<br><b>Nenhum modelo respondeu.</b>`);
      bt.disabled = false;
    };
    resumo();
    const L = itens(); if (L.length) { const g = L.flatMap(d => d.coords); if (g.length) mapa.fitBounds(L.flatMap(d => d.coords), { padding: [30, 30] }); }
  }

  return { iniciar, executar, aoVoltar, log, BASES, get mapa() { return mapa; }, get titulo() { return titulo; }, get itens() { return itens(); } };
})();
