/* Exécute majCommande_ de Code.gs hors de Google, sur une fausse feuille de
 * calcul. Le but n'est pas de simuler Apps Script en entier, mais de vérifier
 * exactement ce qui est délicat ici : l'ordre des suppressions de lignes, le
 * recalcul des totaux de l'onglet Commandes, et les refus.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

function feuille(entete, lignes) {
  const data = [entete.slice(), ...lignes.map((r) => r.slice())];
  return {
    data,
    getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
    getRange: (r, c, nr, nc) => ({
      setValue: (v) => { data[r - 1][c - 1] = v; },
      getValues: () => {
        const out = [];
        for (let i = 0; i < (nr || 1); i++) {
          const src = data[r - 1 + i] || [];
          out.push(src.slice(c - 1, c - 1 + (nc || 1)));
        }
        return out;
      },
      setValues: (vals) => {
        vals.forEach((row, i) => {
          if (!data[r - 1 + i]) data[r - 1 + i] = [];
          row.forEach((v, j) => { data[r - 1 + i][c - 1 + j] = v; });
        });
      },
      setFontWeight: () => {}
    }),
    deleteRow: (r) => { data.splice(r - 1, 1); },
    appendRow: (row) => { data.push(row.slice()); },
    getLastRow: () => data.length,
    getLastColumn: () => entete.length,
    setFrozenRows: () => {}
  };
}

function charger(onglets) {
  const src = readFileSync(new URL('./apps-script/Code.gs', import.meta.url), 'utf8');
  const ctx = {
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ ADMIN_USER: 'admin', ADMIN_PASS: 'secret' }[k] || '') }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => onglets[n] || null, insertSheet: () => { throw new Error('onglet manquant : ' + n); } }), getActiveSpreadsheet: () => ({ getSheetByName: (n) => onglets[n] || null }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 'json' } },
    MailApp: { sendEmail: () => {} },
    GmailApp: { sendEmail: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => 'test@exemple.ch' }) },
    Utilities: { formatDate: (d) => String(d) }
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}

// 9.15 HT -> 9.90 TTC ; 12.25 -> 13.25
const HO = ['ID', 'Date', 'Prénom', 'Nom', 'Email', 'Téléphone', 'Cartons',
  'Bouteilles (cartons)', 'Total HT', 'TVA %', 'Total TTC à payer', 'Références',
  'Bouteilles seules', 'TTC en attente'];
const HL = ['ID commande', 'Date', 'Prénom', 'Nom', 'Email', 'Réf.', 'Désignation',
  'Appellation', 'Couleur', 'cl', 'Emb.', 'Mill.', 'Cartons', 'Bouteilles',
  'Prix bt. HT', 'Total HT', 'Total TTC', 'Bouteilles seules', 'Bt/carton',
  'Confirmées', 'Confirmé le'];

function jeu() {
  const d = new Date('2026-09-20T10:00:00Z');
  const O = feuille(HO, [
    ['CMD-A', d, 'Marc', 'Test', 'marc@bluewin.ch', '', 3, 18, 158.10, 8.1, 172.20, 2, 0, 0]
  ]);
  const L = feuille(HL, [
    ['CMD-A', d, 'Marc', 'Test', 'marc@bluewin.ch', '68526', 'Vinzel', 'La Côte', 'blanc', '75cl', 'CT06', '2025', 2, 12, 9.15, 109.80, 118.80, 0, 6, 0, ''],
    ['CMD-A', d, 'Marc', 'Test', 'marc@bluewin.ch', '66878', 'Attalens', 'Lavaux', 'rouge', '75cl', 'CT06', '2024', 1, 6, 12.25, 73.50, 79.50, 0, 6, 0, '']
  ]);
  return { O, L, ctx: charger({ Commandes: O, Lignes: L }) };
}

const admin = ['admin', 'secret'];
let n = 0;
const ok = (titre) => { console.log('  ok ', titre); n++; };

// 1. correction simple
{
  const { O, L, ctx } = jeu();
  const r = ctx.majCommande_(...admin, 'CMD-A', [{ ref: '68526', cartons: 3 }, { ref: '66878', cartons: 1 }]);
  assert.equal(r.ok, true);
  assert.equal(r.modifiees, 1, 'seule la ligne qui change compte');
  assert.equal(L.data[1][12], 3);                 // cartons
  assert.equal(L.data[1][13], 18);                // bouteilles
  assert.equal(L.data[1][16], 178.20);            // total TTC de la ligne
  assert.equal(O.data[1][6], 4);                  // cartons de la commande
  assert.equal(O.data[1][7], 24);                 // bouteilles
  assert.equal(O.data[1][10], 257.70);            // 178.20 + 79.50
  assert.equal(O.data[1][11], 2);                 // références
  ok('correction simple, totaux de la commande recalculés');
}

// 2. zéro retire la ligne, puis la commande
{
  const { O, L, ctx } = jeu();
  let r = ctx.majCommande_(...admin, 'CMD-A', [{ ref: '66878', cartons: 0 }]);
  assert.equal(r.ok, true);
  assert.equal(L.data.length, 2, 'il ne reste qu’une ligne');
  assert.equal(O.data[1][10], 118.80);
  assert.equal(O.data[1][11], 1);

  r = ctx.majCommande_(...admin, 'CMD-A', [{ ref: '68526', cartons: 0 }]);
  assert.equal(r.ok, true);
  assert.equal(r.supprimee, true);
  assert.equal(L.data.length, 1, 'plus que l’en-tête');
  assert.equal(O.data.length, 1, 'la commande a disparu');
  ok('zéro retire la ligne, puis la commande entière');
}

// 3. deux suppressions d'un coup : l'ordre des deleteRow ne doit pas décaler
{
  const { O, L, ctx } = jeu();
  const r = ctx.majCommande_(...admin, 'CMD-A',
    [{ ref: '68526', cartons: 0 }, { ref: '66878', cartons: 0 }]);
  assert.equal(r.ok, true);
  assert.equal(r.supprimee, true);
  assert.equal(L.data.length, 1);
  assert.equal(O.data.length, 1);
  ok('deux lignes supprimées en une fois, sans décalage');
}

// 4. une bouteille seule survit à la mise à zéro des cartons
{
  const d = new Date('2026-09-20T10:00:00Z');
  const O = feuille(HO, [['CMD-B', d, 'Eva', 'T', 'eva@bluewin.ch', '', 2, 12, 109.80, 8.1, 118.80, 1, 3, 29.70]]);
  const L = feuille(HL, [['CMD-B', d, 'Eva', 'T', 'eva@bluewin.ch', '68526', 'Vinzel', 'La Côte', 'blanc', '75cl', 'CT06', '2025', 2, 12, 9.15, 109.80, 118.80, 3, 6, 0, '']]);
  const ctx = charger({ Commandes: O, Lignes: L });
  const r = ctx.majCommande_(...admin, 'CMD-B', [{ ref: '68526', cartons: 0 }]);
  assert.equal(r.ok, true);
  assert.equal(r.supprimee, false);
  assert.equal(L.data.length, 2, 'la ligne est conservée');
  assert.equal(L.data[1][12], 0);
  assert.equal(L.data[1][17], 3, 'les bouteilles seules sont intactes');
  assert.equal(O.data[1][10], 0, 'plus rien de ferme à payer');
  assert.equal(O.data[1][13], 29.70, 'l’attente reste');
  ok('bouteilles seules préservées, attente recalculée');
}

// 5. les bouteilles confirmées restent comptées dans le total à payer
{
  const d = new Date('2026-09-20T10:00:00Z');
  const O = feuille(HO, [['CMD-C', d, 'Luc', 'T', 'luc@bluewin.ch', '', 1, 6, 82.35, 8.1, 118.80, 1, 3, 0]]);
  const L = feuille(HL, [['CMD-C', d, 'Luc', 'T', 'luc@bluewin.ch', '68526', 'Vinzel', 'La Côte', 'blanc', '75cl', 'CT06', '2025', 1, 6, 9.15, 54.90, 59.40, 3, 6, 3, d]]);
  const ctx = charger({ Commandes: O, Lignes: L });
  const r = ctx.majCommande_(...admin, 'CMD-C', [{ ref: '68526', cartons: 2 }]);
  assert.equal(r.ok, true);
  assert.equal(O.data[1][10], 148.50, '12 bouteilles de carton + 3 confirmées = 15 × 9.90');
  ok('bouteilles confirmées toujours comptées après correction');
}

// 6. refus
{
  const { O, L, ctx } = jeu();
  const avant = JSON.stringify([O.data, L.data]);

  assert.equal(ctx.majCommande_('admin', 'faux', 'CMD-A', [{ ref: '68526', cartons: 1 }]).ok, false);
  let r = ctx.majCommande_(...admin, 'CMD-A', [{ ref: '99999', cartons: 1 }]);
  assert.equal(r.ok, false); assert.match(r.error, /absente/);
  r = ctx.majCommande_(...admin, 'CMD-A', [{ ref: '68526', cartons: -1 }]);
  assert.equal(r.ok, false);
  r = ctx.majCommande_(...admin, 'CMD-A', [{ ref: '68526', cartons: 5000 }]);
  assert.equal(r.ok, false);
  r = ctx.majCommande_(...admin, 'CMD-INCONNUE', [{ ref: '68526', cartons: 1 }]);
  assert.equal(r.ok, false); assert.match(r.error, /introuvable/);
  r = ctx.majCommande_(...admin, 'CMD-A', [{ ref: '68526', cartons: 2 }]);
  assert.equal(r.ok, false); assert.match(r.error, /Aucun changement/);

  assert.equal(JSON.stringify([O.data, L.data]), avant, 'aucune écriture sur un refus');
  ok('refus : mot de passe, référence, quantité, commande inconnue — sans écriture');
}

// 7. l'action est bien routée dans doPost
{
  const { ctx } = jeu();
  const rep = ctx.doPost({ postData: { contents: JSON.stringify({
    action: 'majCommande', user: 'admin', pass: 'faux', commande: 'CMD-A', lignes: [] }) } });
  assert.match(String(rep), /"ok":false/);
  ok('action majCommande routée par doPost');
}

console.log('\n' + n + ' vérifications, aucune erreur.');
