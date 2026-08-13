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
 *   2) Copie scripts/contas-dpp.example.json para scripts/contas-dpp.local.json
 *      e preencha com nome/e-mail de quem deve ter acesso DPP (esse arquivo
 *      fica de fora do git — nunca comite dados pessoais reais).
 *   3) Nesta pasta "scripts": npm install firebase-admin
 *   4) node seed-contas-admin.js "C:\caminho\para\chave-servico.json"
 *
 * As contas sao criadas SEM senha (nenhuma senha fixa fica no codigo). Depois
 * de criar, cada pessoa define a propria senha em "Esqueci minha senha" na
 * tela de login, usando o e-mail institucional dela.
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

// Contas DPP (acesso total) — lidas de um arquivo local, fora do git (nunca comitar dados pessoais reais).
const fullAccessPath = path.join(__dirname, "contas-dpp.local.json");
if (!fs.existsSync(fullAccessPath)) {
  console.error(
    `Não encontrei ${fullAccessPath}.\n` +
    `Copie scripts/contas-dpp.example.json para scripts/contas-dpp.local.json e preencha com nome/e-mail de quem deve ter acesso DPP.`
  );
  process.exit(1);
}
const FULL_ACCESS = JSON.parse(fs.readFileSync(fullAccessPath, "utf8"));
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
        userRecord = await auth.createUser({ email: c.email });
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
  console.log(`\nConcluido: ${ok} conta(s) criada(s) agora (sem senha), ${jaExistia} ja existiam, de ${contas.length} no total.`);
  if (ok) console.log(`Cada pessoa criada agora precisa usar "Esqueci minha senha" na tela de login (com o e-mail institucional dela) antes do primeiro acesso.`);
  if (falhas.length) {
    console.log(`\nFalhas (${falhas.length}):`);
    falhas.forEach(f => console.log(" - " + f));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
