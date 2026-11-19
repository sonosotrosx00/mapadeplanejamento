/* Assistente do pedido em texto (módulo opcional: para tirar, apague este arquivo e a linha dele no index.html).
   1. Correções em sequência: a IA recebe a lista do que já está no mapa e pode EDITAR ou APAGAR itens
      ("muda a rota para verde", "apaga os bairros do Mosqueiro", "deixa Belém sem preenchimento").
   2. Caderno da IA: regras da equipe (texto livre) e exemplos de pedidos que deram certo, mandados junto com cada pedido.
      Pedido igual a um exemplo guardado é feito direto, sem perguntar à IA.
   3. "Entendi" antes de fazer: mostra o plano em português, com os botões "Fazer no mapa" e "Corrigir o pedido". */
const Assistente = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nrm = s => Comandos.norm(String(s || "")).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const itens = () => FerramentasMapa.desenhos;
  const nomeDe = d => d.nomeBase || d.nome || "";

  /* ============================================================ 1. o que está no mapa */
  // texto curto que vai para a IA: cada item (ou grupo grande) numa linha
  function contexto() {
    const L = itens(); if (!L.length) return "";
    const grupos = new Map();
    L.forEach(d => { const k = (d.grupo || "") + "|" + nomeDe(d); if (!grupos.has(k)) grupos.set(k, { d, n: 0 }); grupos.get(k).n++; });
    const porGrupo = new Map();
    grupos.forEach(({ d, n }) => { const g = d.grupo || "(sem grupo)"; if (!porGrupo.has(g)) porGrupo.set(g, []); porGrupo.get(g).push({ d, n }); });
    const tipoTxt = { linha: "linha", poligono: "área", ponto: "ponto" };
    const est = d => `${tipoTxt[d.tipo]}, cor ${d.cor}${d.tipo !== "ponto" ? `, espessura ${d.espessura}` : ""}${d.tracejada ? ", tracejada" : ""}${d.tipo === "poligono" ? (d.preenchido === false ? ", sem preenchimento" : ", preenchida") : ""}${d.visivel === false ? ", escondida" : ""}`;
    const linhas = [];
    porGrupo.forEach((lista, g) => {
      if (lista.length > 6) {
        const d = lista[0].d;
        linhas.push(`- grupo "${g}": ${lista.length} itens (${est(d)}): ${lista.map(x => nomeDe(x.d)).join("; ")}`);
      } else lista.forEach(({ d, n }) => linhas.push(`- "${nomeDe(d)}" (grupo "${g}", ${est(d)}${n > 1 ? `, ${n} partes` : ""})`));
    });
    let txt = linhas.join("\n");
    if (txt.length > 6000) txt = txt.slice(0, 6000) + "\n…";
    return txt;
  }

  // quais itens um "alvo" indica: nome exato, "grupo:X", palavra de grupo (bairros, rota, pontos…), parte do nome ou "tudo"
  function acharAlvos(alvos, tipoItem) {
    const L = itens(), achados = new Set();
    const lista = (Array.isArray(alvos) ? alvos : [alvos]).filter(Boolean);
    lista.forEach(a => {
      const t = nrm(String(a).replace(/^grupo\s*:\s*/i, ""));
      if (!t) return;
      let r = [];
      if (/^(tudo|todos?|todas?|tudo no mapa|o mapa todo)$/.test(t)) r = L.slice();
      if (!r.length) r = L.filter(d => nrm(nomeDe(d)) === t);                                      // nome exato
      if (!r.length) r = L.filter(d => nrm(d.grupo) === t);                                        // grupo exato
      if (!r.length) {                                                                             // palavras de grupo
        const sing = t.replace(/^(os|as|o|a|do|da|dos|das)\s+/, "");
        if (/^(bairros?|limites? dos? bairros?)\b/.test(sing)) r = L.filter(d => d.grupo === "Bairros");
        else if (/^(municipios?|cidades?|limites? d[eo]s? municipios?|regiao metropolitana)\b/.test(sing)) r = L.filter(d => d.grupo === "Municípios");
        else if (/^(rotas?|trajetos?|caminhos?)$/.test(sing)) r = L.filter(d => d.grupo === "Rotas" && d.tipo === "linha");
        else if (/^linhas?$/.test(sing)) r = L.filter(d => d.tipo === "linha");
        else if (/^(pontos?|pinos?|marcadores?)$/.test(sing)) r = L.filter(d => d.tipo === "ponto");
        else if (/^(areas?|setores?|poligonos?)$/.test(sing)) r = L.filter(d => d.tipo === "poligono");
        else if (/^ruas?$/.test(sing)) r = L.filter(d => /^ruas/i.test(d.grupo || "") || (d.tipo === "linha" && !d.grupo));
        else if (/^(saida|chegada|pontos? da rota|pinos? da rota)$/.test(sing)) r = L.filter(d => d.grupo === "Rotas" && d.tipo === "ponto" && (/^(saida|chegada)$/.test(sing) ? nrm(nomeDe(d)).startsWith(sing) : true));
        // "bairros do Mosqueiro": bairros cujo distrito (IBGE) é o nome pedido
        const mDist = sing.match(/^bairros? d[aoe]s?\s+(.+)$/);
        if (mDist) {
          const dist = nrm(mDist[1]);
          const nomesDist = ((window.BAIRROS_BELEM || {}).features || []).filter(f => nrm(f.properties.distrito) === dist).map(f => nrm(f.properties.bairro));
          const daRmb = ((window.BAIRROS_RMB || {}).features || []).filter(f => nrm(f.properties.municipio) === dist).map(f => nrm(f.properties.bairro));
          const nomes = new Set([...nomesDist, ...daRmb]);
          if (nomes.size) r = L.filter(d => d.grupo === "Bairros" && [...nomes].some(b => nrm(nomeDe(d)).replace(/^limite do bairro /, "").replace(/ \(.*$/, "") === b));
        }
      }
      if (!r.length && t.length >= 3) r = L.filter(d => nrm(nomeDe(d)).includes(t) || nrm(nomeDe(d)).replace(/^(limite do bairro|municipio de|rota|linha) /, "") === t);
      r.forEach(d => achados.add(d));
    });
    let out = [...achados];
    if (tipoItem) { const tp = { area: "poligono", poligono: "poligono", linha: "linha", ponto: "ponto" }[tipoItem]; if (tp) out = out.filter(d => d.tipo === tp); }
    return out;
  }

  function executarEdicao(a, log) {
    const alvos = acharAlvos(a.alvos || a.alvo, a.tipoItem);
    if (!alvos.length) { log(`Não achei no mapa: <b>${esc([].concat(a.alvos || a.alvo || []).join(", "))}</b>.`, "erro"); return 0; }
    FerramentasMapa.guardarHistorico();
    if (a.tipo === "apagar") {
      a._apagados = [...new Set(alvos.map(nomeDe))];   // para o caderno saber que ação do plano saiu
      const fora = new Set(alvos); const L = itens();
      for (let i = L.length - 1; i >= 0; i--) if (fora.has(L[i])) L.splice(i, 1);
      FerramentasMapa.salvar();
      log(`Apaguei ${alvos.length} item(ns): ${esc(resumoNomes(alvos))}. (Ctrl+Z desfaz.)`, "ok");
      return alvos.length;
    }
    const mud = [];
    alvos.forEach(d => {
      if (a.cor) d.cor = a.cor;
      if (a.espessura != null && +a.espessura > 0) d.espessura = +a.espessura;
      if (a.tracejado != null) d.tracejada = !!a.tracejado;
      if (a.preenchimento != null && d.tipo === "poligono") d.preenchido = !!a.preenchimento;
      if (a.visivel != null) d.visivel = !!a.visivel;
      if (a.novoNome && alvos.length === 1) { d.nome = a.novoNome; d.nomeBase = a.novoNome; }
    });
    if (a.cor) mud.push(`cor <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${esc(a.cor)}"></span>`);
    if (a.espessura != null) mud.push("espessura " + a.espessura);
    if (a.tracejado != null) mud.push(a.tracejado ? "tracejado" : "linha contínua");
    if (a.preenchimento != null) mud.push(a.preenchimento ? "com preenchimento" : "sem preenchimento");
    if (a.visivel != null) mud.push(a.visivel ? "visível" : "escondido");
    if (a.novoNome && alvos.length === 1) mud.push(`nome "${esc(a.novoNome)}"`);
    FerramentasMapa.salvar();
    log(`Mudei ${alvos.length} item(ns) (${esc(resumoNomes(alvos))}): ${mud.join(", ") || "nada a mudar"}. (Ctrl+Z desfaz.)`, "ok");
    return alvos.length;
  }
  function resumoNomes(lista) {
    const nomes = [...new Set(lista.map(nomeDe))];
    return nomes.length > 3 ? `${nomes.slice(0, 3).join(", ")} e mais ${nomes.length - 3}` : nomes.join(", ");
  }

  // correções sem IA: "muda a rota para verde", "deixa os bairros em azul", "apaga a rota", "esconde os bairros", "tira o tracejado dos bairros"
  function interpretarCorrecao(texto) {
    const t = String(texto || "").trim(), n = Comandos.norm(t);
    const verboApaga = /^(apag|remov|exclu|delet|tir[ae]\s+(?!o tracejad|a cor|o preench))/;
    const verboEdita = /^(mud|troc|deix|pint|coloc|ponha|poe|bot|aument|diminu|engross|afin|escond|ocult|mostr|exib|renome|chame|tir[ae]\s+(o tracejad|o preench)|tracej|preench)/;
    if (!verboApaga.test(n) && !verboEdita.test(n)) return null;
    if (!itens().length) return null;
    // o alvo: o que vem depois do verbo, sem "a cor d…", "o tracejado d…" e sem o "para/em <cor>" do fim
    let alvo = t.replace(/^\S+\s+/, "")
      .replace(/^(?:a\s+cor|a\s+espessura|o\s+tracejado|o\s+preenchimento|a\s+grossura|o\s+nome)\s+d[aoe]s?\s+/i, "")
      .replace(/\s+(?:para|pra|em|de|com|sem|na cor|no|na)\s+[\s\S]*$/i, "")
      .replace(/^(?:a|o|as|os)\s+/i, "").replace(/[.!]+$/, "").trim();
    if (!alvo) return null;
    if (verboApaga.test(n)) return { acoes: [{ tipo: "apagar", alvos: [alvo] }], origem: "interpretador" };
    const a = { tipo: "editar", alvos: [alvo] };
    const c = Comandos.cor(n.replace(/^\S+\s+/, "").split(/\s+(?:para|pra|em|na cor)\s+/).slice(1).join(" ") || "");
    if (c) a.cor = c;
    const me = n.match(/(?:espessura|tamanho|grossura|largura)\s*(?:de|para|pra)?\s*(\d+(?:[.,]\d+)?)|(?:para|pra)\s+(\d+(?:[.,]\d+)?)\s*$/);
    if (me) a.espessura = parseFloat((me[1] || me[2]).replace(",", "."));
    else if (/^(aument|engross)/.test(n)) a.espessura = "+";
    else if (/^(diminu|afin)/.test(n)) a.espessura = "-";
    if (/tir[ae]\s+o tracejad|sem tracejad|continu/.test(n)) a.tracejado = false; else if (/tracejad|pontilhad/.test(n)) a.tracejado = true;
    if (/tir[ae]\s+o preench|sem preench|so o contorno/.test(n)) a.preenchimento = false; else if (/preench|pint[ae]\s/.test(n) && !c) a.preenchimento = true;
    if (/^(escond|ocult)/.test(n)) a.visivel = false; else if (/^(mostr|exib)/.test(n)) a.visivel = true;
    const mn = t.match(/^(?:renome\w*|chame)\s+[\s\S]+?\s+(?:para|de|como)\s+["“]?([^"”]+)["”]?\s*$/i);
    if (mn) { a.novoNome = mn[1].trim(); a.alvos = [t.replace(/^\S+\s+/, "").replace(/\s+(?:para|de|como)\s+["“]?[^"”]+["”]?\s*$/i, "").replace(/^(?:a|o|as|os)\s+/i, "")]; delete a.cor; }
    if (a.espessura === "+" || a.espessura === "-") {
      const d = acharAlvos(a.alvos)[0]; const e0 = d ? +d.espessura || 3 : 3; a.espessura = Math.max(1, e0 + (a.espessura === "+" ? 2 : -1));
    }
    return { acoes: [a], origem: "interpretador" };
  }

  /* ============================================================ 2. caderno da IA */
  const CH = "plano_caderno";
  function lerCaderno() { try { const c = JSON.parse(localStorage.getItem(CH) || "{}"); return { regras: c.regras || "", exemplos: Array.isArray(c.exemplos) ? c.exemplos : [] }; } catch (e) { return { regras: "", exemplos: [] }; } }
  function guardarCaderno(c) { try { localStorage.setItem(CH, JSON.stringify(c)); } catch (e) {} }
  const limparAcoes = acoes => JSON.parse(JSON.stringify(acoes || [], (k, v) => k.startsWith("_") ? undefined : v));

  // texto extra que vai junto com o pedido para a IA
  function extraParaIA() {
    const c = lerCaderno(), partes = [];
    if (c.regras.trim()) partes.push("Regras desta equipe (siga sempre, valem mais que as regras gerais):\n" + c.regras.trim());
    const ex = c.exemplos.slice(-8);
    if (ex.length) partes.push("Exemplos de pedidos desta equipe com o plano certo (imite o jeito de interpretar):\n" +
      ex.map(e => `Pedido: ${e.pedido}\nPlano: ${JSON.stringify({ acoes: e.acoes }).slice(0, 1500)}`).join("\n\n"));
    const ctx = contexto();
    if (ctx) partes.push("O que JÁ está no mapa agora (para corrigir, use as ações \"editar\" e \"apagar\" com os nomes exatamente como aqui; um pedido novo de desenho continua usando as outras ações):\n" + ctx);
    return partes.join("\n\n");
  }
  // pedido igual a um exemplo guardado: usa o plano dele direto
  function exemploIgual(pedido) {
    const k = nrm(pedido); const e = lerCaderno().exemplos.slice().reverse().find(x => nrm(x.pedido) === k);
    return e ? { acoes: limparAcoes(e.acoes), origem: "exemplo guardado no caderno" } : null;
  }

  // o último pedido e as correções feitas em seguida viram UM exemplo (o plano já corrigido)
  let ultimo = null;   // { pedido, acoes }
  function registrar(pedido, plano, correcao) {
    const acoes = (plano.acoes || []);
    const ehCorrecao = acoes.length && acoes.every(a => a.tipo === "editar" || a.tipo === "apagar");
    if (ehCorrecao && ultimo) { acoes.forEach(a => juntarCorrecao(ultimo.acoes, a)); ultimo.correcoes = (ultimo.correcoes || 0) + 1; }
    else if (!ehCorrecao && !acoes.some(a => a.tipo === "limpar" && acoes.length === 1)) ultimo = { pedido, acoes: acoes.map(a => ({ ...a })) };
    mostrarBotaoGuardar();
  }
  // aplica uma correção ao plano guardado: muda o estilo das ações que criaram os itens corrigidos (ou tira a ação)
  function juntarCorrecao(acoesPlano, corr) {
    const L = acharAlvos(corr.alvos || corr.alvo, corr.tipoItem), nomes = new Set(L.map(nomeDe));
    if (corr.tipo === "apagar") {
      // (os itens já saíram do mapa: compara com os nomes que cada ação criou)
      let tirou = false;
      for (let i = acoesPlano.length - 1; i >= 0; i--) {
        const cri = acoesPlano[i]._nomes || [];
        if (cri.length && cri.every(nm => corr._apagados && corr._apagados.includes(nm))) { acoesPlano.splice(i, 1); tirou = true; }
      }
      // apagou só uma parte do que uma ação criou (ex.: os bairros do Mosqueiro): a própria correção entra no fim do plano
      if (!tirou) acoesPlano.push({ tipo: "apagar", alvos: [].concat(corr.alvos || corr.alvo || []) });
      return;
    }
    let mudou = false;
    acoesPlano.forEach(a => {
      if (!(a._nomes || []).some(nm => nomes.has(nm))) return;
      // a correção vale para TODOS os itens que a ação criou? então muda a própria ação; senão, a correção entra no fim
      const linhaDaRota = a.tipo === "rota" && nomes.has((a._nomes || [])[0]);   // a rota: o 1º item é a linha (os outros são os pinos)
      if (!linhaDaRota && !(a._nomes || []).every(nm => nomes.has(nm))) return;
      mudou = true;
      if (corr.cor) a.cor = corr.cor;
      if (corr.espessura != null) a.espessura = corr.espessura;
      if (corr.tracejado != null) a.tracejado = corr.tracejado;
      if (corr.preenchimento != null) a.preenchimento = corr.preenchimento;
      if (a.tipo === "ruas") (a.ruas || []).forEach(r => { if (corr.cor) r.cor = corr.cor; if (corr.espessura != null) r.espessura = corr.espessura; if (corr.tracejado != null) r.tracejado = corr.tracejado; });
    });
    if (!mudou) acoesPlano.push(JSON.parse(JSON.stringify(corr, (k, v) => k.startsWith("_") ? undefined : v)));
  }
  function mostrarBotaoGuardar() {
    const box = $("guardarEx"); if (!box) return;
    if (!ultimo) { box.innerHTML = ""; return; }
    box.innerHTML = `<span class="nota" style="margin:0;flex:1">Saiu certo${ultimo.correcoes ? ` (com ${ultimo.correcoes} ${ultimo.correcoes > 1 ? "correções" : "correção"})` : ""}? Guarde para a IA aprender o jeito de vocês.</span>
      <button type="button" class="sec" id="btGuardarEx">Guardar como exemplo</button>`;
    $("btGuardarEx").onclick = () => {
      const c = lerCaderno();
      c.exemplos = c.exemplos.filter(e => nrm(e.pedido) !== nrm(ultimo.pedido));
      c.exemplos.push({ pedido: ultimo.pedido, acoes: limparAcoes(ultimo.acoes), quando: new Date().toISOString().slice(0, 10) });
      if (c.exemplos.length > 40) c.exemplos = c.exemplos.slice(-40);
      guardarCaderno(c); listarCaderno();
      box.innerHTML = `<span class="nota" style="margin:0;color:#166534">Exemplo guardado no caderno da IA.</span>`;
    };
  }
  function listarCaderno() {
    const box = $("cadLista"); if (!box) return;
    const c = lerCaderno();
    if ($("cadRegras") && document.activeElement !== $("cadRegras")) $("cadRegras").value = c.regras;
    box.innerHTML = c.exemplos.length ? c.exemplos.map((e, i) => `<div class="lug"><div class="lug-n">${esc(e.pedido.length > 110 ? e.pedido.slice(0, 110) + "…" : e.pedido)}<br><span class="nota">${e.acoes.length} ação(ões)${e.quando ? " · " + esc(e.quando) : ""}</span></div>
        <button type="button" class="sec" data-ex-usar="${i}" title="Pôr no campo do pedido">Usar</button><button type="button" class="sec" data-ex-tira="${i}" title="Excluir">&times;</button></div>`).join("")
      : `<p class="nota">Nenhum exemplo ainda. Depois de um pedido que saiu certo (mesmo depois de corrigir), clique em "Guardar como exemplo".</p>`;
    box.querySelectorAll("[data-ex-tira]").forEach(b => b.onclick = () => { const c2 = lerCaderno(); c2.exemplos.splice(+b.dataset.exTira, 1); guardarCaderno(c2); listarCaderno(); });
    box.querySelectorAll("[data-ex-usar]").forEach(b => b.onclick = () => { $("pedido").value = lerCaderno().exemplos[+b.dataset.exUsar].pedido; $("pedido").focus(); });
    const info = $("cadInfo"); if (info) info.textContent = `${c.exemplos.length} exemplo(s)${c.regras.trim() ? " · com regras" : ""}`;
  }
  function ligarCaderno() {
    if ($("cadRegras")) $("cadRegras").addEventListener("input", e => { const c = lerCaderno(); c.regras = e.target.value; guardarCaderno(c); listarCaderno(); });
    if ($("btCadBaixar")) $("btCadBaixar").onclick = () => U.baixar("caderno da IA.json", JSON.stringify({ tipo: "caderno_ia", ...lerCaderno() }, null, 1), "application/json");
    if ($("btCadAbrir")) $("btCadAbrir").onclick = () => $("inCad").click();
    if ($("inCad")) $("inCad").onchange = async e => {
      const f = e.target.files[0]; e.target.value = ""; if (!f) return;
      try {
        const j = JSON.parse(await f.text()); if (!j || j.tipo !== "caderno_ia") throw new Error("não é um caderno da IA");
        const c = lerCaderno();
        if (j.regras && !c.regras.includes(j.regras.trim())) c.regras = (c.regras.trim() ? c.regras.trim() + "\n" : "") + j.regras.trim();
        (j.exemplos || []).forEach(x => { if (!c.exemplos.some(e => nrm(e.pedido) === nrm(x.pedido))) c.exemplos.push(x); });
        guardarCaderno(c); listarCaderno(); Plano.log(`Caderno <b>${esc(f.name)}</b> juntado ao seu: ${c.exemplos.length} exemplo(s).`, "ok");
      } catch (err) { Plano.log("Caderno: " + esc(err.message), "erro"); }
    };
    listarCaderno();
  }

  /* ============================================================ 3. "Entendi" antes de fazer */
  const curto = s => { s = String(s || ""); return /^https?:\/\//.test(s) ? "link do Google Maps" : s.length > 60 ? s.slice(0, 57) + "…" : s; };
  const amostra = c => c ? `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:-1px;background:${esc(c)}"></span>` : "";
  function descrever(a) {
    const est = `${amostra(a.cor)}${a.tracejado ? " tracejado" : ""}${a.espessura ? " · tamanho " + a.espessura : ""}`;
    switch (a.tipo) {
      case "limpar": return "Apagar tudo o que está no mapa";
      case "titulo": return `Título do layout: <b>${esc(a.texto)}</b>`;
      case "bairro": return `Contorno do bairro <b>${esc(a.bairro)}</b> ${est}`;
      case "bairros": { const todos = !a.bairros || !a.bairros.length || a.bairros.some(b => /^tod/i.test(b)); return `${todos ? "Todos os bairros" : "Bairros " + esc(a.bairros.join(", "))} de <b>${esc(a.municipio === "RMB" ? "toda a Região Metropolitana" : (a.municipio || "Belém"))}</b> ${est}${a.preenchimento ? " · preenchidos" : ""}`; }
      case "municipios": { const m = [].concat(a.municipios || []); return `Limite de <b>${esc(m.some(x => /rmb|metropolitana|tod/i.test(x)) ? "toda a Região Metropolitana (7 municípios)" : m.join(", "))}</b> ${est}${a.preenchimento !== false ? " · preenchido" : ""}`; }
      case "ruas": return `${(a.ruas || []).length} rua(s)${a.bairro ? ` no bairro <b>${esc(a.bairro)}</b>` : ""}: ${esc((a.ruas || []).slice(0, 6).map(r => r.nome).join(", "))}${(a.ruas || []).length > 6 ? "…" : ""}`;
      case "ponto": return `Ponto em <b>${esc(curto(a.endereco || a.nome || `${a.lat}, ${a.lon}`))}</b> ${amostra(a.cor)}`;
      case "rota": return `${a.nome === "Linha" ? "Linha" : "Rota"} de <b>${esc(curto(a.de))}</b> até <b>${esc(curto(a.ate))}</b>${(a.paradas || []).length ? ` passando por ${esc(a.paradas.map(curto).join(", "))}` : ""} ${est}${a.modo === "pe" ? " · a pé" : a.modo === "reta" ? " · em linha reta" : ""}${a.marcos === false ? "" : " · com pinos de saída e chegada"}`;
      case "editar": return `Mudar <b>${esc([].concat(a.alvos || a.alvo || []).join(", "))}</b>: ${[a.cor ? "cor " + amostra(a.cor) : "", a.espessura != null ? "espessura " + a.espessura : "", a.tracejado != null ? (a.tracejado ? "tracejado" : "contínuo") : "", a.preenchimento != null ? (a.preenchimento ? "com preenchimento" : "sem preenchimento") : "", a.visivel != null ? (a.visivel ? "mostrar" : "esconder") : "", a.novoNome ? `nome "${esc(a.novoNome)}"` : ""].filter(Boolean).join(", ")}`;
      case "apagar": return `Apagar <b>${esc([].concat(a.alvos || a.alvo || []).join(", "))}</b>`;
      default: return esc(a.tipo);
    }
  }
  // mostra o plano e espera: resolve(true) = fazer, resolve(false) = corrigir
  let pendente = null;   // cartão ainda sem resposta: um pedido novo fecha ele como "não fiz"
  function confirmar(plano) {
    if (pendente) pendente(false);
    return new Promise(ok => {
      const box = document.createElement("div"); box.className = "log-l plano-conf";
      box.innerHTML = `<b>${plano.entendi ? "Entendi: " + esc(plano.entendi) : "Vou fazer:"}</b>
        <ul style="margin:4px 0 6px 18px;padding:0">${(plano.acoes || []).map(a => `<li>${descrever(a)}</li>`).join("")}</ul>
        <div class="linha" style="gap:6px"><button type="button" class="bt-fazer">Fazer no mapa</button><button type="button" class="sec bt-corrigir">Corrigir o pedido</button></div>`;
      $("log").appendChild(box); $("log").scrollTop = $("log").scrollHeight;
      const fim = r => { if (!box.querySelector(".linha")) return; pendente = null; box.querySelector(".linha").remove(); box.insertAdjacentHTML("beforeend", `<span class="nota" style="margin:0">${r ? "Feito." : "Não fiz. Mude o pedido e clique em Fazer no mapa."}</span>`); ok(r); };
      pendente = fim;
      box.querySelector(".bt-fazer").onclick = () => fim(true);
      box.querySelector(".bt-corrigir").onclick = () => { fim(false); $("pedido").focus(); };
      box.querySelector(".bt-fazer").focus();
    });
  }
  const querConfirmar = () => !$("ckConfirmar") || $("ckConfirmar").checked;

  function iniciar() {
    ligarCaderno();
    const ck = $("ckConfirmar");
    if (ck) { ck.checked = U.ler("plano_confirmar", true); ck.onchange = () => U.guardar("plano_confirmar", ck.checked); }
  }

  return { iniciar, contexto, acharAlvos, executarEdicao, interpretarCorrecao, extraParaIA, exemploIgual, registrar, confirmar, querConfirmar, descrever, lerCaderno };
})();
