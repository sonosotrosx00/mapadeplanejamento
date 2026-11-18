/* Compatibilidade com as ferramentas do MapaBL
   ------------------------------------------
   ferramentas_mapa.js (Street View, Planejar / Desenhar Rotas, Acompanhar no QGIS), ferramentas_extra.js (Busca, Régua,
   Trajeto, Camadas), importar_geo.js, exportar.js e util.js são CÓPIAS SEM ALTERAÇÃO de mapablv2/js.
   Este arquivo dá a elas o que esperam do MapaBL (CFG, DADOS_GEO, App, Painel), sem nada de capina.
   Ao corrigir uma ferramenta no MapaBL, copie o arquivo para cá de novo. */
window.CFG = {
  recursos: { busca: true, regua: true, trajeto: true, camadas: true, planejamento: true, sincronizarQgis: true, formulario: false, capinaNoPlanejamento: false },
  rotas: { carro: "https://routing.openstreetmap.de/routed-car/route/v1/driving/", pe: "https://routing.openstreetmap.de/routed-foot/route/v1/foot/" },
  areasPadrao: [],          // sem as 10 áreas da capina: o campo "Área" dos itens fica livre
  metaEquipeMDia: 1950,
  servicos: []
};
window.DADOS_GEO = { areas: [], pontos: [], rotas: [], estudoAreas: {} };

const Painel = (() => {
  const $ = id => document.getElementById(id);
  // mesma tela do MapaBL: o conteúdo da ferramenta aparece no painel, com "Voltar ao painel"
  function mostrar(html, manter) {
    const rol = $("rolagem"), pos = rol.scrollTop;
    $("detalhe").innerHTML = `<div class="det-topo"><button class="sec" type="button" id="btVoltar">&larr; Voltar ao painel</button></div>` + html;
    $("detalhe").hidden = false; $("principal").hidden = true;
    rol.scrollTop = manter ? pos : 0;
    $("btVoltar").onclick = App.fechar;
    gaveta("meio", true);
  }
  function fechar() { $("detalhe").hidden = true; $("detalhe").innerHTML = ""; $("principal").hidden = false; }
  // gaveta do celular (igual ao MapaBL)
  const ALTURAS = ["baixo", "meio", "alto"];
  function gaveta(alt, soSeBaixo) {
    const p = $("painel"); if (!p || (soSeBaixo && p.dataset.altura !== "baixo")) return;
    p.dataset.altura = alt; setTimeout(() => typeof Plano !== "undefined" && Plano.mapa && Plano.mapa.invalidateSize(), 220);
  }
  function ligarGaveta() {
    const p = $("painel"), alca = $("alca"); if (!alca) return; let y0 = null, h0 = 0, moveu = false;
    alca.onclick = () => { if (moveu) { moveu = false; return; } gaveta(ALTURAS[(ALTURAS.indexOf(p.dataset.altura) + 1) % 3]); };
    alca.addEventListener("pointerdown", e => { y0 = e.clientY; h0 = p.getBoundingClientRect().height; moveu = false; alca.setPointerCapture(e.pointerId); });
    alca.addEventListener("pointermove", e => { if (y0 == null) return; const dy = y0 - e.clientY; if (Math.abs(dy) > 6) { moveu = true; p.style.transition = "none"; p.style.height = Math.max(120, h0 + dy) + "px"; } });
    alca.addEventListener("pointerup", () => { if (y0 == null) return; y0 = null; p.style.transition = ""; if (!moveu) return; const h = p.getBoundingClientRect().height / window.innerHeight; p.style.height = ""; gaveta(h < .32 ? "baixo" : h < .72 ? "meio" : "alto"); });
  }
  return { mostrarPersonalizado: mostrar, fechar, gaveta, ligarGaveta };
})();

const App = (() => {
  const ui = { aberto: null, areaAberta: null, mapaLimpo: true, mostrar: {} };
  function abrirPersonalizado(tipo, fnRender) { ui.aberto = { tipo }; if (fnRender) fnRender(); }
  function fechar() { ui.aberto = null; Painel.fechar(); if (typeof Plano !== "undefined") Plano.aoVoltar(); }
  return { ui, abrirPersonalizado, fechar, alternarMapaLimpo: () => {} };
})();
