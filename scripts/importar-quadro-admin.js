#!/usr/bin/env node
/*
 * Importa o quadro de profissionais (.json gerado por converter-quadro-pdf.mjs)
 * direto no Firestore, em profissionais/quadro, via Admin SDK — alternativa ao
 * botão "Importar quadro" em Configurações → Centros (que exige login DPP).
 *
 * Uso (dentro de scripts/):
 *   node importar-quadro-admin.js "<chave-servico.json>" "<quadro.json>"            (só confere)
 *   node importar-quadro-admin.js "<chave-servico.json>" "<quadro.json>" --gravar   (grava)
 *
 * A chave de serviço é a mesma de seed-contas-admin.js. Ela dá acesso total ao
 * banco: não a coloque dentro do repositório.
 */
const fs = require("fs");
const path = require("path");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const [chave, arquivo, modo] = process.argv.slice(2);
if (!chave || !arquivo) {
  console.error('Uso: node importar-quadro-admin.js "<chave-servico.json>" "<quadro.json>" [--gravar]');
  process.exit(1);
}
const sa = JSON.parse(fs.readFileSync(chave, "utf8"));
if (sa.project_id !== "criminologico") {
  console.error("A chave é do projeto \"" + sa.project_id + "\", não do criminologico — nada foi feito.");
  process.exit(1);
}

const itens = JSON.parse(fs.readFileSync(arquivo, "utf8")).map(p => ({
  nome: String(p.nome || "").trim(), matricula: String(p.matricula || "").trim(), cargo: p.cargo,
  vinculo: String(p.vinculo || ""), sr: p.sr, unidade: String(p.unidade || ""), sede: !!p.sede,
  ...(p.obs ? { obs: String(p.obs) } : {}),
}));
const invalidos = itens.filter(p => !p.nome || !["psi", "as", "med"].includes(p.cargo) || !/^SR0\d$/.test(p.sr || ""));
if (!itens.length || invalidos.length) {
  console.error("Arquivo fora do formato esperado (" + invalidos.length + " item(ns) inválido(s)) — nada foi feito.");
  process.exit(1);
}
const conta = c => itens.filter(p => p.cargo === c).length;
console.log(`Arquivo: ${itens.length} profissionais (${conta("psi")} psicólogos(as), ${conta("as")} assistentes sociais, ${conta("med")} médicos(as)).`);

const db = getFirestore(initializeApp({ credential: cert(sa) }));
(async () => {
  const ref = db.doc("profissionais/quadro");
  const atual = await ref.get();
  console.log("No banco hoje:", atual.exists ? `${atual.data().total} profissionais (arquivo ${atual.data().fonte})` : "nenhum quadro importado");
  if (modo !== "--gravar") { console.log("Só conferência. Para gravar, rode de novo com --gravar no final."); return; }
  await ref.set({
    itens, total: itens.length, fonte: path.basename(arquivo),
    importadoPor: "admin-sdk", importadoPorNome: "Importação via script (Admin SDK)", importadoEm: FieldValue.serverTimestamp(),
  });
  const gravado = (await ref.get()).data();
  console.log(`Gravado: ${gravado.total} profissionais em profissionais/quadro.`);
})().catch(e => { console.error("ERRO:", e.message); process.exit(1); });
