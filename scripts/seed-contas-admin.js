#!/usr/bin/env node
/*
 * Cria as contas institucionais (DIR/CPEN por unidade + SR por regional) via
 * Firebase Admin SDK, contornando o limite de "too many requests" que o
 * Identity Toolkit aplica no SDK client-side (createUserWithEmailAndPassword).
 *
 * Uso:
 *   1) No Firebase Console: Configuracoes do projeto > Contas de servico >
 *      Gerar nova chave privada. Salve o .json FORA da pasta do repo
 *      (ex.: Downloads) e nao faca commit dele.
 *   2) Nesta pasta "scripts": npm install firebase-admin
 *   3) node seed-contas-admin.js "C:\caminho\para\chave-servico.json"
 *
 * E seguro rodar mais de uma vez: contas que ja existem sao apenas puladas
 * (getUserByEmail) e o documento em usuarios/{uid} e regravado com merge,
 * sem duplicar nada.
 */
const fs = require("fs");
const path = require("path");
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const keyPath = process.argv[2];
if (!keyPath) {
  console.error("Uso: node seed-contas-admin.js <caminho-da-chave-de-servico.json>");
  process.exit(1);
}
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, "utf8"));

const app = initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth(app);
const db = getFirestore(app);

const indexPath = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(indexPath, "utf8");

function extrairObjeto(nomeConst) {
  const inicio = html.indexOf(`const ${nomeConst} = {`);
  if (inicio === -1) throw new Error(`Nao encontrei ${nomeConst} no index.html`);
  const inicioChave = html.indexOf("{", inicio);
  let depth = 0, i = inicioChave;
  for (; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") { depth--; if (depth === 0) break; }
  }
  const literal = html.slice(inicioChave, i + 1);
  return new Function(`return ${literal};`)();
}

const SR_INFO = extrairObjeto("SR_INFO");
const UNIDADES_INFO = extrairObjeto("UNIDADES_INFO");

const SENHA_PADRAO = "SENHA_REMOVIDA_DO_HISTORICO";
const contas = [];
Object.entries(UNIDADES_INFO).forEach(([nome, info]) => {
  const prefixo = (info.email || "").split("@")[0];
  if (!prefixo) return;
  contas.push({ email: prefixo + "dir@pp.sc.gov.br", nome: "Direção — " + nome, perfil: "DIR", unidade: nome, sr: info.sr });
  contas.push({ email: prefixo + "cpen@pp.sc.gov.br", nome: "CPEN — " + nome, perfil: "CPEN", unidade: nome, sr: info.sr });
});
Object.entries(SR_INFO).forEach(([sr, info]) => {
  contas.push({ email: sr.toLowerCase() + "@pp.sc.gov.br", nome: info.nome, perfil: "SR", unidade: null, sr });
});

// Contas DPP (acesso total) — mesma equipe cadastrada como Administrador no PAD.
const FULL_ACCESS = [
  { nome: "Bruna Longen", email: "brunawlongen@gmail.com" },
  { nome: "CRV", email: "crv@pp.sc.gov.br" },
  { nome: "Day Sestren", email: "day.sestren88@gmail.com" },
  { nome: "Ivana Schafer", email: "ivana.schafer@gmail.com" },
  { nome: "Jéssica Karla Veiga", email: "jessicaveiga9@gmail.com" },
  { nome: "Juliana Abel", email: "abeljuliana2012@gmail.com" },
  { nome: "Leila Karenina Farias", email: "leilakffarias@gmail.com" },
  { nome: "Ricardo de Brito", email: "ricardobritomarques12@gmail.com" },
  { nome: "Rodrigo Pastore", email: "rodrigo.l.pastore@gmail.com" },
  { nome: "SEPEN", email: "sepen@pp.sc.gov.br" },
];
FULL_ACCESS.forEach(p => contas.push({ email: p.email, nome: p.nome, perfil: "DPP", unidade: null, sr: null }));

async function main() {
  let ok = 0, jaExistia = 0;
  const falhas = [];
  for (const c of contas) {
    try {
      let userRecord;
      try {
        userRecord = await auth.getUserByEmail(c.email);
        jaExistia++;
      } catch (e) {
        if (e.code !== "auth/user-not-found") throw e;
        userRecord = await auth.createUser({ email: c.email, password: SENHA_PADRAO });
        ok++;
      }
      await db.collection("usuarios").doc(userRecord.uid).set({
        nome: c.nome, cpf: "", email: c.email, unidade: c.unidade, sr: c.sr,
        perfilSolicitado: c.perfil, perfil: c.perfil, status: "ATIVO",
        criadoEm: FieldValue.serverTimestamp(),
      }, { merge: true });
      console.log(`OK  ${c.email}`);
    } catch (e) {
      falhas.push(`${c.email}: ${e.code || e.message || e}`);
      console.log(`ERRO ${c.email}: ${e.code || e.message || e}`);
    }
  }
  console.log(`\nConcluido: ${ok} conta(s) criada(s) agora, ${jaExistia} ja existiam, de ${contas.length} no total.`);
  if (falhas.length) {
    console.log(`\nFalhas (${falhas.length}):`);
    falhas.forEach(f => console.log(" - " + f));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
