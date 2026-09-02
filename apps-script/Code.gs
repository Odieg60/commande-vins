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

// L'etape 1 est obligatoire cote serveur aussi : une requete forgee sans
// coordonnees valides est refusee, sinon le Sheet se remplit de lignes
// inexploitables (impossible de savoir a qui facturer ni ou envoyer l'e-mail).
function validate_(c) {
  if (!c) return 'Commande absente.';
  if (!String(c.prenom || '').trim()) return 'Prénom obligatoire.';
  if (!String(c.nom || '').trim()) return 'Nom obligatoire.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(c.email || '').trim())) return 'E-mail invalide.';
  if (!c.lignes || !c.lignes.length) return 'Commande vide.';
  for (var i = 0; i < c.lignes.length; i++) {
    var l = c.lignes[i];
    if (!l.ref || !(Number(l.cartons) > 0) || !(Number(l.bouteilles) > 0)) {
      return 'Ligne de commande invalide (' + (l.ref || '?') + ').';
    }
  }
  return null;
}

function submit_(c) {
  var err = validate_(c);
  if (err) return { ok: false, error: err };
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

    var mailSent = mailConfirmation_(c);   // e-mail au participant
    notify_(c);                            // copie a l'organisateur
    return { ok: true, id: c.id, mailSent: mailSent };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------ e-mails ---
 * L'e-mail de confirmation est LE support des coordonnees bancaires : le
 * depot GitHub etant public, l'IBAN ne vit que dans les Script Properties
 * (PAY_BENEFICIAIRE / PAY_IBAN) et n'apparait jamais dans la page.
 */

function money_(n) {
  return 'CHF ' + Number(n).toFixed(2);
}

function esc_(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Recapitulatif HTML des lignes commandees, partage par les deux e-mails.
function tableHtml_(c) {
  var h = '<table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;font:14px Helvetica,Arial,sans-serif">' +
    '<tr style="background:#f2e6ea">' +
    '<th align="left">Réf.</th><th align="left">Vin</th>' +
    '<th align="right">Cartons</th><th align="right">Bouteilles</th><th align="right">Total TTC</th></tr>';
  c.lignes.forEach(function (l, i) {
    h += '<tr style="background:' + (i % 2 ? '#ffffff' : '#fbf9f5') + '">' +
      '<td>' + esc_(l.ref) + '</td>' +
      '<td><b>' + esc_(l.nom) + '</b><br><span style="color:#6b6660;font-size:12px">' +
      esc_(l.appellation) + ' · ' + esc_(l.cl) + ' · ' + esc_(l.mill) + '</span></td>' +
      '<td align="right">' + l.cartons + ' × ' + (l.btl || Math.round(l.bouteilles / l.cartons)) + '</td>' +
      '<td align="right">' + l.bouteilles + '</td>' +
      '<td align="right">' + money_(l.total_ttc) + '</td></tr>';
  });
  h += '<tr style="border-top:2px solid #21201d"><td colspan="2"><b>Total</b></td>' +
    '<td align="right"><b>' + c.total_cartons + '</b></td>' +
    '<td align="right"><b>' + c.total_bouteilles + '</b></td>' +
    '<td align="right"><b>' + money_(c.total_ttc) + '</b></td></tr></table>';
  return h;
}

// E-mail envoye au participant : recapitulatif + coordonnees de paiement.
// Renvoie true si l'envoi a reussi (remonte a la page dans la reponse JSON).
function mailConfirmation_(c) {
  if (!c.email) return false;
  var p = props_();
  var benef = p.getProperty('PAY_BENEFICIAIRE') || '';
  var iban = p.getProperty('PAY_IBAN') || '';
  var echeance = p.getProperty('PAY_DEADLINE') || '';
  var orgName = p.getProperty('ORG_NAME') || 'Commande groupée Noël 2026';
  var orgMail = p.getProperty('ORG_EMAIL') || '';
  var enlev = p.getProperty('ENLEVEMENT') ||
    'du 12.10 au 13.11.2026, sur préavis de min. 72 h au 021 822 02 45';
  var ref = c.prenom + ' ' + c.nom + ' — ' + c.id;

  var pay = '<h3 style="margin:22px 0 6px">Paiement</h3>' +
    '<table cellpadding="4" cellspacing="0" border="0" style="font:14px Helvetica,Arial,sans-serif">' +
    '<tr><td style="color:#6b6660">Montant</td><td><b>' + money_(c.total_ttc) + '</b> (TTC)</td></tr>' +
    (echeance ? '<tr><td style="color:#6b6660">À payer avant le</td><td><b>' + esc_(echeance) + '</b></td></tr>' : '') +
    (benef ? '<tr><td style="color:#6b6660">Bénéficiaire</td><td><b>' + esc_(benef) + '</b></td></tr>' : '') +
    (iban ? '<tr><td style="color:#6b6660">IBAN</td><td><b>' + esc_(iban) + '</b></td></tr>' : '') +
    '<tr><td style="color:#6b6660">Référence</td><td><b>' + esc_(ref) + '</b></td></tr>' +
    '</table>' +
    (benef && iban ? '' :
      '<p style="color:#a45b12;font:13px Helvetica,Arial,sans-serif">Les coordonnées bancaires ne sont pas encore configurées ' +
      '(Script Properties PAY_BENEFICIAIRE et PAY_IBAN) — elles vous seront transmises séparément.</p>');

  var html = '<div style="font:15px/1.5 Helvetica,Arial,sans-serif;color:#21201d;max-width:640px">' +
    '<h2 style="font-family:Georgia,serif;margin:0 0 4px">Commande enregistrée</h2>' +
    '<p style="color:#6b6660;margin:0 0 18px">' + esc_(c.prenom) + ', voici le récapitulatif de votre commande <b>' + esc_(c.id) + '</b>.</p>' +
    tableHtml_(c) +
    '<p style="color:#6b6660;font-size:13px;margin:8px 0 0">Prix TTC, TVA ' +
    (Math.round((c.tva || 0.081) * 1000) / 10) + ' % incluse, arrondis au 5 centimes supérieur.</p>' +
    pay +
    '<h3 style="margin:22px 0 6px">Enlèvement</h3>' +
    '<p style="margin:0;color:#6b6660">' + esc_(enlev) + '. Sous réserve de disponibilité des stocks.</p>' +
    '<p style="margin:22px 0 0;color:#6b6660;font-size:13px">Merci d\'indiquer la référence ci-dessus lors du virement, ' +
    'elle permet de rapprocher votre paiement de votre commande.</p></div>';

  var plain = 'Commande ' + c.id + ' enregistrée.\n\n' +
    c.lignes.map(function (l) {
      return l.ref + ' — ' + l.nom + ' : ' + l.cartons + ' carton(s) = ' + l.bouteilles + ' bt. — ' + money_(l.total_ttc);
    }).join('\n') +
    '\n\nTotal : ' + c.total_cartons + ' carton(s), ' + c.total_bouteilles + ' bouteilles, ' + money_(c.total_ttc) + ' TTC\n\n' +
    'PAIEMENT\nMontant : ' + money_(c.total_ttc) +
    (echeance ? '\nÀ payer avant le : ' + echeance : '') +
    (benef ? '\nBénéficiaire : ' + benef : '') +
    (iban ? '\nIBAN : ' + iban : '') +
    '\nRéférence : ' + ref +
    '\n\nEnlèvement : ' + enlev + '\n';

  try {
    var opts = { name: orgName, htmlBody: html };
    if (orgMail) opts.replyTo = orgMail;
    MailApp.sendEmail(c.email, 'Noël 2026 — votre commande ' + c.id + ' (' + money_(c.total_ttc) + ')', plain, opts);
    return true;
  } catch (e) {
    // Quota MailApp atteint ou adresse invalide : la commande reste enregistree.
    Logger.log('mailConfirmation_ : ' + e);
    return false;
  }
}

// Copie a l'organisateur : renseigner la Script Property NOTIFY_EMAIL.
function notify_(c) {
  var to = props_().getProperty('NOTIFY_EMAIL');
  if (!to) return;
  try {
    MailApp.sendEmail(to,
      'Noël 2026 — commande de ' + c.prenom + ' ' + c.nom + ' (' + money_(c.total_ttc) + ')',
      c.prenom + ' ' + c.nom + ' (' + c.email + (c.tel ? ', ' + c.tel : '') + ')\n' +
      c.total_cartons + ' carton(s), ' + c.total_bouteilles + ' bouteilles\n' +
      'Total TTC : ' + money_(c.total_ttc) + ' — HT : ' + money_(c.total_ht) + '\n\n' +
      c.lignes.map(function (l) {
        return l.ref + ' — ' + l.nom + ' : ' + l.cartons + ' carton(s) = ' + l.bouteilles + ' bt.';
      }).join('\n'),
      { htmlBody: '<div style="font:15px/1.5 Helvetica,Arial,sans-serif"><p><b>' + esc_(c.prenom + ' ' + c.nom) +
        '</b><br>' + esc_(c.email) + (c.tel ? ' · ' + esc_(c.tel) : '') + '</p>' + tableHtml_(c) +
        '<p style="color:#6b6660;font-size:13px">Total HT : ' + money_(c.total_ht) + '</p></div>' });
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
  Logger.log('PAY_BENEFICIAIRE : ' + (p.getProperty('PAY_BENEFICIAIRE') || '*** MANQUANT ***'));
  Logger.log('PAY_IBAN     : ' + (p.getProperty('PAY_IBAN') || '*** MANQUANT ***'));
  Logger.log('PAY_DEADLINE : ' + (p.getProperty('PAY_DEADLINE') || '(aucune échéance)'));
  Logger.log('ORG_NAME     : ' + (p.getProperty('ORG_NAME') || 'Commande groupée Noël 2026 (défaut)'));
  Logger.log('ORG_EMAIL    : ' + (p.getProperty('ORG_EMAIL') || '(pas de reply-to)'));
  Logger.log('Quota e-mails restant aujourd\'hui : ' + MailApp.getRemainingDailyQuota());
}
