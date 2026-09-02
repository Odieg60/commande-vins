/**
 * Commande groupée de vins — Noël 2026
 * Backend Google Apps Script : reçoit les commandes de la page web et les écrit
 * dans un Google Sheet qui reste PRIVÉ (jamais partagé publiquement).
 *
 * Le Web App est déployé « Exécuter en tant que : moi » + « Accès : tout le
 * monde ». Conséquence : la page peut écrire, mais personne ne peut lire le
 * Sheet ni lister les commandes sans le mot de passe admin, qui est stocké
 * dans les Script Properties (donc jamais dans le dépôt GitHub).
 *
 * Deux onglets sont créés automatiquement :
 *   - "Commandes" : une ligne par personne (récapitulatif)
 *   - "Lignes"    : une ligne par référence commandée (détail exploitable)
 */

var SHEET_ORDERS = 'Commandes';
var SHEET_LINES = 'Lignes';

var HEAD_ORDERS = ['ID', 'Date', 'Prénom', 'Nom', 'Email', 'Téléphone',
  'Cartons', 'Bouteilles', 'Total HT', 'TVA %', 'Total TTC', 'Références'];

var HEAD_LINES = ['ID commande', 'Date', 'Prénom', 'Nom', 'Email', 'Réf.',
  'Désignation', 'Appellation', 'Couleur', 'cl', 'Emb.', 'Mill.',
  'Cartons', 'Bouteilles', 'Prix bt. HT', 'Total HT', 'Total TTC'];

/* ------------------------------------------------------------------ utils */

function props_() { return PropertiesService.getScriptProperties(); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function book_() {
  var id = props_().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function tab_(name, header) {
  var ss = book_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function checkAdmin_(user, pass) {
  var p = props_();
  var u = p.getProperty('ADMIN_USER') || 'admin';
  var expected = p.getProperty('ADMIN_PASS');
  if (!expected) return 'Mot de passe admin non configuré (Script Property ADMIN_PASS).';
  if (String(user) !== u || String(pass) !== expected) return 'Identifiants incorrects.';
  return null;
}

/* ------------------------------------------------------------- endpoints */

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    switch (body.action) {
      case 'submit': return json_(submit_(body.commande));
      case 'list': return json_(list_(body.user, body.pass));
      default: return json_({ ok: false, error: 'Action inconnue.' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

// Petit contrôle de vie dans le navigateur (ne renvoie aucune donnée).
function doGet() {
  return json_({ ok: true, service: 'commande-vins-noel-2026' });
}

/* ---------------------------------------------------------------- écriture */

function submit_(c) {
  if (!c || !c.email || !c.lignes || !c.lignes.length) {
    return { ok: false, error: 'Commande vide ou incomplète.' };
  }
  // Verrou : plusieurs personnes peuvent valider en même temps.
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var shO = tab_(SHEET_ORDERS, HEAD_ORDERS);
    var shL = tab_(SHEET_LINES, HEAD_LINES);
    var when = c.date ? new Date(c.date) : new Date();

    shO.appendRow([c.id, when, c.prenom, c.nom, c.email, c.tel || '',
      c.total_cartons, c.total_bouteilles, c.total_ht,
      Math.round((c.tva || 0.081) * 1000) / 10, c.total_ttc, c.lignes.length]);

    var rows = c.lignes.map(function (l) {
      return [c.id, when, c.prenom, c.nom, c.email, l.ref, l.nom, l.appellation,
        l.couleur, l.cl, l.emb, l.mill, l.cartons, l.bouteilles,
        l.prix_ht, l.total_ht, l.total_ttc];
    });
    shL.getRange(shL.getLastRow() + 1, 1, rows.length, HEAD_LINES.length).setValues(rows);

    notify_(c);
    return { ok: true, id: c.id };
  } finally {
    lock.releaseLock();
  }
}

// Notification e-mail optionnelle : renseigner la Script Property NOTIFY_EMAIL.
function notify_(c) {
  var to = props_().getProperty('NOTIFY_EMAIL');
  if (!to) return;
  try {
    MailApp.sendEmail(to,
      'Noël 2026 — commande de ' + c.prenom + ' ' + c.nom,
      c.prenom + ' ' + c.nom + ' (' + c.email + ')\n' +
      c.total_cartons + ' carton(s), ' + c.total_bouteilles + ' bouteilles\n' +
      'Total TTC : CHF ' + c.total_ttc + '\n\n' +
      c.lignes.map(function (l) {
        return l.ref + ' — ' + l.nom + ' : ' + l.cartons + ' carton(s) = ' + l.bouteilles + ' bt.';
      }).join('\n'));
  } catch (e) { /* l'échec d'un e-mail ne doit pas faire échouer la commande */ }
}

/* ----------------------------------------------------------------- lecture */

function list_(user, pass) {
  var err = checkAdmin_(user, pass);
  if (err) return { ok: false, error: err };

  var shL = tab_(SHEET_LINES, HEAD_LINES);
  var shO = tab_(SHEET_ORDERS, HEAD_ORDERS);
  var byId = {};
  var out = [];

  var o = shO.getDataRange().getValues();
  for (var i = 1; i < o.length; i++) {
    if (!o[i][0]) continue;
    var cmd = {
      id: o[i][0],
      date: o[i][1] instanceof Date ? o[i][1].toISOString() : String(o[i][1]),
      prenom: o[i][2], nom: o[i][3], email: o[i][4], tel: o[i][5],
      total_cartons: Number(o[i][6]) || 0,
      total_bouteilles: Number(o[i][7]) || 0,
      total_ht: Number(o[i][8]) || 0,
      total_ttc: Number(o[i][10]) || 0,
      lignes: []
    };
    byId[cmd.id] = cmd;
    out.push(cmd);
  }

  var l = shL.getDataRange().getValues();
  for (var j = 1; j < l.length; j++) {
    var cmd2 = byId[l[j][0]];
    if (!cmd2) continue;
    cmd2.lignes.push({
      ref: String(l[j][5]), nom: l[j][6], appellation: l[j][7], couleur: l[j][8],
      cl: l[j][9], emb: l[j][10], mill: String(l[j][11]),
      cartons: Number(l[j][12]) || 0, bouteilles: Number(l[j][13]) || 0,
      btl: (Number(l[j][12]) ? Number(l[j][13]) / Number(l[j][12]) : 0),
      prix_ht: Number(l[j][14]) || 0,
      total_ht: Number(l[j][15]) || 0,
      total_ttc: Number(l[j][16]) || 0,
      groupe: ''
    });
  }
  return { ok: true, commandes: out };
}

/* ------------------------------------------------------- initialisation ---
 * À lancer UNE FOIS depuis l'éditeur Apps Script (menu Exécuter) après avoir
 * renseigné les Script Properties : crée les deux onglets et vérifie la conf.
 */
function setup() {
  tab_(SHEET_ORDERS, HEAD_ORDERS);
  tab_(SHEET_LINES, HEAD_LINES);
  var p = props_();
  Logger.log('SHEET_ID     : ' + (p.getProperty('SHEET_ID') || '(classeur actif)'));
  Logger.log('ADMIN_USER   : ' + (p.getProperty('ADMIN_USER') || 'admin (défaut)'));
  Logger.log('ADMIN_PASS   : ' + (p.getProperty('ADMIN_PASS') ? 'défini' : '*** MANQUANT ***'));
  Logger.log('NOTIFY_EMAIL : ' + (p.getProperty('NOTIFY_EMAIL') || '(aucune notification)'));
}
