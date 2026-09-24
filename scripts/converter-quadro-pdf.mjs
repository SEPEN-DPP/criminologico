#!/usr/bin/env node
/*
 * Converte o PDF "Quadro de Equipes Técnicas — 8 Regionais" (Coordenadoria de
 * Execução Penal) no .json que o DPP importa em Configurações → Centros →
 * "Quadro de profissionais". O site usa essa lista para selecionar psicólogo(a)
 * e assistente social na aba "Equipe examinadora" do exame.
 *
 * Uso (dentro de scripts/, depois de `npm install`):
 *   node converter-quadro-pdf.mjs "C:\caminho\Quadro_Equipes_Tecnicas.pdf" "C:\caminho\saida.json"
 *
 * O .json gerado tem nome e matrícula de servidores: NÃO salve dentro do
 * repositório (ele vai para o GitHub) — guarde junto do PDF, na pasta da SEPEN.
 *
 * Só entram as 8 regionais (páginas até "FORA DA ESTRUTURA DAS 8 REGIONAIS").
 * Cada unidade do PDF é casada com o nome oficial em UNIDADES_INFO (index.html);
 * as que não casarem aparecem como aviso no final — ajuste ALIASES abaixo.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const [pdfPath, saidaPath] = process.argv.slice(2);
if (!pdfPath || !saidaPath) {
  console.error('Uso: node converter-quadro-pdf.mjs "<quadro.pdf>" "<saida.json>"');
  process.exit(1);
}

const aqui = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(aqui, "..", "index.html"), "utf8");
const UNIDADES_INFO = eval("(" + html.match(/const UNIDADES_INFO = (\{[\s\S]*?\n\});/)[1] + ")");

const norm = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[–—-]/g, " ").replace(/\s+/g, " ").trim();
const mapaUnid = {};
Object.keys(UNIDADES_INFO).forEach(u => { mapaUnid[norm(u)] = u; });
/* nomes do PDF que diferem do nome oficial no sistema */
const ALIASES = {
  "Hospital De Custodia E Tratamento Psiquiatrico": Object.keys(UNIDADES_INFO).find(u => /^Hospital de Cust/.test(u)),
  /* o próprio PDF pede para confirmar essa equivalência — os profissionais levam a observação */
  "Penitenciaria De Sao Pedro De Alcantara": "Complexo Penitenciário do Estado",
};
Object.entries(ALIASES).forEach(([de, para]) => { if (para) mapaUnid[norm(de)] = para; });

const MATRICULA = /^(\d{7}-\d-\d{2}|—)$/;
const CARGO = { "Psicólogo(a)": "psi", "Assistente Social": "as", "Médico(a)": "med" };
/* colunas da tabela no PDF (coordenada x): nome | matrícula | cargo | vínculo */
const coluna = x => x < 230 ? "nome" : x < 305 ? "mat" : x < 390 ? "cargo" : "vinc";
const ignorar = /^Cobertura adicional|unidade\(s\) oficial|^\(/;

const pdf = await getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), verbosity: 0 }).promise;
const profs = [], semCorrespondencia = [];
let sr = null, unidade = null, pendentes = [], atual = null, fim = false;

for (let p = 2; p <= pdf.numPages && !fim; p++) {
  const tc = await (await pdf.getPage(p)).getTextContent();
  const linhas = [];
  tc.items.filter(i => i.str.trim()).forEach(i => {
    const x = i.transform[4], y = i.transform[5];
    let l = linhas.find(l => Math.abs(l.y - y) < 2.5);
    if (!l) linhas.push(l = { y, itens: [] });
    l.itens.push({ x, s: i.str.trim() });
  });
  linhas.sort((a, b) => b.y - a.y).forEach(l => l.itens.sort((a, b) => a.x - b.x));

  for (const l of linhas) {
    const txt = l.itens.map(i => i.s).join(" ");
    if (/^FORA DA ESTRUTURA/.test(txt)) { fim = true; break; }
    const mSR = txt.match(/^(SR0\d) ·/);
    if (mSR) { sr = mSR[1]; atual = null; pendentes = []; continue; }
    if (/^Psic\./.test(txt)) continue;

    /* cabeçalho "Nome | Matrícula | Cargo | Vínculo": a 1ª linha solta antes dele é a unidade */
    if (l.itens[0].s === "Nome" && l.itens.some(i => i.s === "Matrícula")) {
      const bruto = pendentes[0] || "?";
      const limpo = bruto.replace(/\[[^\]]*\]/g, "").replace(/\(confirmar\)/i, "").trim();
      const sede = /^Equipe da sede/.test(limpo);
      const sistema = sede ? null : (mapaUnid[norm(limpo)] || null);
      if (!sede && !sistema) semCorrespondencia.push(sr + " — " + limpo);
      unidade = { pdf: limpo, sistema, sede, confirmar: /\(confirmar\)/i.test(bruto) || pendentes.slice(1).some(t => /confirmar/i.test(t)) };
      pendentes = []; atual = null;
      continue;
    }

    const c = { nome: [], mat: [], cargo: [], vinc: [] };
    l.itens.forEach(i => c[coluna(i.x)].push(i.s));
    if (c.mat.length && MATRICULA.test(c.mat[0]) && unidade) {
      atual = { nomeBruto: c.nome.join(" "), matricula: c.mat[0] === "—" ? "" : c.mat[0], cargo: c.cargo.join(" "), vinculo: c.vinc.join(" "), unidade, sr };
      profs.push(atual);
      continue;
    }
    /* continuação da linha anterior (nome ou vínculo quebrados em duas linhas) */
    if (atual && l.itens[0].x > 50 && !ignorar.test(txt)) {
      if (c.nome.length) atual.nomeBruto += " " + c.nome.join(" ");
      if (c.vinc.length) atual.vinculo += " " + c.vinc.join(" ");
      continue;
    }
    if (l.itens[0].x < 52) { if (!ignorar.test(txt)) pendentes.push(txt); atual = null; }
  }
}

const saida = profs.map(p => {
  const obs = (p.nomeBruto.match(/\[[^\]]*\]/g) || []).map(s => s.slice(1, -1).trim());
  if (p.unidade.confirmar) obs.push("lotação no quadro: " + p.unidade.pdf + " — confirmar equivalência com o COPE");
  const item = {
    nome: p.nomeBruto.replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim(),
    matricula: p.matricula,
    cargo: CARGO[p.cargo] || p.cargo,
    vinculo: p.vinculo.replace(/\s+/g, " ").trim(),
    sr: p.sr,
    unidade: p.unidade.sistema || (p.unidade.sede ? "" : p.unidade.pdf),
    sede: p.unidade.sede,
  };
  if (obs.length) item.obs = obs.join("; ");
  return item;
});

fs.writeFileSync(saidaPath, JSON.stringify(saida, null, 1));
const conta = c => saida.filter(p => p.cargo === c).length;
console.log(`${saida.length} profissionais: ${conta("psi")} psicólogos(as), ${conta("as")} assistentes sociais, ${conta("med")} médicos(as) → ${saidaPath}`);
if (semCorrespondencia.length) console.log("ATENÇÃO — unidades sem correspondência no sistema (ajuste ALIASES):\n  " + semCorrespondencia.join("\n  "));
