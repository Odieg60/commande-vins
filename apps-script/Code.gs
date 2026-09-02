/**
 * Commande groupée de vins — Noël 2026
 * Backend Google Apps Script : reçoit les commandes de la page web et les écrit
 * dans un Google Sheet qui reste PRIVÉ (jamais partagé publiquement).
 *
 * Le Web App est déployé « Exécuter en tant que : moi » + « Accès : tout le
 * monde », et l'enregistrement exige le code d'invitation (SUBMIT_CODE).
 *
 * Deux onglets, créés automatiquement :
 *   - "Commandes" : une ligne par personne (récapitulatif)
 *   - "Lignes"    : une ligne par référence commandée (détail exploitable)
 *
 * CARTONS OUVERTS
 * Schenk ne livre qu'en cartons entiers, mais on peut commander à la bouteille :
 * ces « bouteilles seules » restent EN ATTENTE jusqu'à ce que le groupe complète
 * le carton. Règles appliquées ici :
 *   - premier arrivé, premier servi : les bouteilles les plus anciennes d'une
 *     référence sont confirmées d'abord ;
 *   - à la clôture, un carton incomplet n'est pas commandé (bouteilles perdues) ;
 *   - quand une commande boucle un carton, les autres participants de ce carton
 *     reçoivent un e-mail avec le complément à payer.
 */

var SHEET_ORDERS = 'Commandes';
var SHEET_LINES = 'Lignes';

var HEAD_ORDERS = ['ID', 'Date', 'Prénom', 'Nom', 'Email', 'Téléphone',
  'Cartons', 'Bouteilles (cartons)', 'Total HT', 'TVA %', 'Total TTC à payer',
  'Références', 'Bouteilles seules', 'TTC en attente'];

var HEAD_LINES = ['ID commande', 'Date', 'Prénom', 'Nom', 'Email', 'Réf.',
  'Désignation', 'Appellation', 'Couleur', 'cl', 'Emb.', 'Mill.',
  'Cartons', 'Bouteilles', 'Prix bt. HT', 'Total HT', 'Total TTC',
  'Bouteilles seules', 'Bt/carton', 'Confirmées', 'Confirmé le'];

// Index des colonnes de l'onglet Lignes (0-based), pour éviter les nombres nus.
var L_ID = 0, L_DATE = 1, L_PRENOM = 2, L_NOM = 3, L_EMAIL = 4, L_REF = 5,
  L_DESIG = 6, L_APPEL = 7, L_COUL = 8, L_CL = 9, L_EMB = 10, L_MILL = 11,
  L_CARTONS = 12, L_BOUT = 13, L_PRIX = 14, L_THT = 15, L_TTTC = 16,
  L_SEULES = 17, L_BTL = 18, L_CONF = 19, L_CONFDATE = 20;

var O_ID = 0, O_TTC = 10, O_ATTENTE = 13;

var TVA_ = 0.081;   // TVA suisse, comme dans la page

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

// Cree l'onglet si besoin, et met a jour la ligne d'en-tete si des colonnes ont
// ete ajoutees depuis (les colonnes existantes gardent leur position).
function tab_(name, header) {
  var ss = book_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return sh;
  }
  var actuel = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  if (actuel.length < header.length || String(actuel[header.length - 1] || '') !== header[header.length - 1]) {
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Arrondi au 5 centimes superieur, puis prix bouteille TTC (identique a la page).
function ceil5_(n) { return Math.ceil(n * 20 - 1e-9) / 20; }
function ttc_(ht) { return ceil5_(Number(ht) * (1 + TVA_)); }
function money_(n) { return 'CHF ' + Number(n).toFixed(2); }

function esc_(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function checkAdmin_(user, pass) {
  var p = props_();
  var u = p.getProperty('ADMIN_USER') || 'admin';
  var expected = p.getProperty('ADMIN_PASS');
  if (!expected) return 'Mot de passe admin non configuré (Script Property ADMIN_PASS).';
  if (String(user) !== u || String(pass) !== expected) return 'Identifiants incorrects.';
  return null;
}

// Verifie le seul code d'invitation, sans rien ecrire : permet a la page de
// bloquer des l'etape 1 au lieu d'attendre la validation de la commande.
function checkCode_(code) {
  var attendu = String(props_().getProperty('SUBMIT_CODE') || '').trim();
  if (!attendu) {
    return { ok: false, codeError: true, error: 'Commandes momentanément fermées (code d\'invitation non configuré).' };
  }
  if (String(code || '').trim().toLowerCase() !== attendu.toLowerCase()) {
    return { ok: false, codeError: true, error: 'Code d\'invitation invalide — utilisez le lien qui vous a été envoyé.' };
  }
  return { ok: true };
}

/* ------------------------------------------------------------- endpoints */

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    switch (body.action) {
      case 'submit': return json_(submit_(body.commande, body.code));
      case 'list': return json_(list_(body.user, body.pass));
      case 'check': return json_(checkCode_(body.code));
      case 'etat': return json_(etat_(body.code));
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

/* --------------------------------------------------------------- validation */

var DOMAINES_JETABLES_ = ['example.com', 'example.org', 'example.net', 'exemple.com',
  'exemple.fr', 'test.com', 'test.ch', 'test.fr', 'toto.com', 'aaa.com', 'azerty.com',
  'mailinator.com', 'yopmail.com', 'yopmail.fr', 'jetable.org', 'trashmail.com',
  'guerrillamail.com', 'sharklasers.com', '10minutemail.com', 'tempmail.com',
  'temp-mail.org', 'dispostable.com', 'maildrop.cc', 'fakemail.net', 'mailnesia.com'];

function emailValide_(brut) {
  var v = String(brut || '').trim().replace(/\s+/g, '');
  if (!v) return { erreur: 'E-mail obligatoire.' };
  if (v.length > 254) return { erreur: 'E-mail trop long.' };
  if ((v.match(/@/g) || []).length !== 1) return { erreur: 'E-mail invalide.' };
  var part = v.split('@'), local = part[0], dom = part[1].toLowerCase();
  v = local + '@' + dom;
  if (!local || local.length > 64) return { erreur: 'E-mail invalide.' };
  if (!/^[A-Za-z0-9!#$%&'*+\/=?^_`{|}~.-]+$/.test(local) || /^\.|\.$|\.\./.test(local)) {
    return { erreur: 'E-mail invalide.' };
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/.test(dom) || /\.\.|^-|-$/.test(dom)) {
    return { erreur: 'Domaine e-mail invalide.' };
  }
  if (DOMAINES_JETABLES_.indexOf(dom) !== -1) return { erreur: 'Adresse de test ou jetable refusée.' };
  return { valeur: v, erreur: null };
}

function validate_(c) {
  if (!c) return 'Commande absente.';
  if (!String(c.prenom || '').trim()) return 'Prénom obligatoire.';
  if (!String(c.nom || '').trim()) return 'Nom obligatoire.';
  var mail = emailValide_(c.email);
  if (mail.erreur) return mail.erreur;
  c.email = mail.valeur;
  if (!c.lignes || !c.lignes.length) return 'Commande vide.';
  for (var i = 0; i < c.lignes.length; i++) {
    var l = c.lignes[i];
    var cartons = Number(l.cartons) || 0;
    var seules = Number(l.seules) || 0;
    var btl = Number(l.btl) || 0;
    if (!l.ref || btl <= 0) return 'Ligne de commande invalide (' + (l.ref || '?') + ').';
    if (cartons < 0 || seules < 0 || (cartons === 0 && seules === 0)) {
      return 'Ligne de commande vide (' + l.ref + ').';
    }
    // Au-dela d'un carton, ce sont des cartons : les bouteilles seules ne
    // servent qu'a completer un carton ouvert.
    if (seules >= btl) return 'Bouteilles seules trop nombreuses sur la réf. ' + l.ref + ' (prenez un carton).';
  }
  return null;
}

/* ---------------------------------------------------------------- écriture */

// Cherche un ID de commande dans la premiere colonne de l'onglet Commandes.
function exists_(sh, id) {
  if (!id) return false;
  var last = sh.getLastRow();
  if (last < 2) return false;
  var col = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0]) === String(id)) return true;
  }
  return false;
}

function submit_(c, code) {
  // Code d'invitation : premier controle, avant toute ecriture et tout e-mail.
  var vu = checkCode_(code);
  if (!vu.ok) return vu;

  var err = validate_(c);
  if (err) return { ok: false, error: err };

  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var shO = tab_(SHEET_ORDERS, HEAD_ORDERS);
    var shL = tab_(SHEET_LINES, HEAD_LINES);
    var when = c.date ? new Date(c.date) : new Date();

    // Idempotence : meme ID deja enregistre = on ne reecrit rien, aucun e-mail.
    if (exists_(shO, c.id)) {
      return { ok: true, id: c.id, duplicate: true, mailSent: false };
    }

    var totaux = totauxCommande_(c);   // cartons, bouteilles fermes, montants

    shO.appendRow([c.id, when, c.prenom, c.nom, c.email, c.tel || '',
      totaux.cartons, totaux.bouteilles, totaux.ht,
      Math.round(TVA_ * 1000) / 10, totaux.ttcFerme, c.lignes.length,
      totaux.seules, 0]);

    var rows = c.lignes.map(function (l) {
      var cartons = Number(l.cartons) || 0;
      var btl = Number(l.btl) || 0;
      var bout = cartons * btl;
      return [c.id, when, c.prenom, c.nom, c.email, l.ref, l.nom, l.appellation,
        l.couleur, l.cl, l.emb, l.mill, cartons, bout,
        Number(l.prix_ht) || 0,
        Math.round(Number(l.prix_ht) * bout * 100) / 100,
        Math.round(ttc_(l.prix_ht) * bout * 100) / 100,
        Number(l.seules) || 0, btl, 0, ''];
    });
    shL.getRange(shL.getLastRow() + 1, 1, rows.length, HEAD_LINES.length).setValues(rows);

    // Reconciliation : quelles bouteilles seules sont confirmees, et qui doit
    // etre prevenu qu'un carton vient de se boucler.
    var rec = reconcilier_(shL, shO, c.id);

    var mailSent = mailConfirmation_(c, rec.alloc);
    notify_(c, rec.alloc);
    rec.aPrevenir.forEach(function (p) { mailCartonBoucle_(p); });

    return {
      ok: true, id: c.id, mailSent: mailSent,
      alloc: rec.alloc,
      montant_a_payer: Math.round((totaux.ttcFerme + rec.montantConfirme) * 100) / 100,
      montant_en_attente: Math.round(rec.montantAttente * 100) / 100
    };
  } finally {
    lock.releaseLock();
  }
}

function totauxCommande_(c) {
  var t = { cartons: 0, bouteilles: 0, seules: 0, ht: 0, ttcFerme: 0 };
  c.lignes.forEach(function (l) {
    var cartons = Number(l.cartons) || 0;
    var btl = Number(l.btl) || 0;
    var bout = cartons * btl;
    t.cartons += cartons;
    t.bouteilles += bout;
    t.seules += Number(l.seules) || 0;
    t.ht += Number(l.prix_ht) * bout;
    t.ttcFerme += ttc_(l.prix_ht) * bout;
  });
  t.ht = Math.round(t.ht * 100) / 100;
  t.ttcFerme = Math.round(t.ttcFerme * 100) / 100;
  return t;
}

/* ------------------------------------------------- cartons ouverts ------- */

// Regroupe les lignes de l'onglet Lignes par reference, dans l'ordre des dates.
function lignesParRef_(valeurs) {
  var parRef = {};
  for (var i = 1; i < valeurs.length; i++) {
    var v = valeurs[i];
    if (!v[L_ID] || !v[L_REF]) continue;
    var seules = Number(v[L_SEULES]) || 0;
    if (seules <= 0) continue;
    var ref = String(v[L_REF]);
    (parRef[ref] = parRef[ref] || []).push({
      row: i + 1,                       // ligne réelle dans le Sheet
      id: String(v[L_ID]),
      date: v[L_DATE] instanceof Date ? v[L_DATE].getTime() : 0,
      prenom: v[L_PRENOM], nom: v[L_NOM], email: v[L_EMAIL],
      desig: v[L_DESIG], cl: v[L_CL], mill: v[L_MILL],
      prix_ht: Number(v[L_PRIX]) || 0,
      btl: Number(v[L_BTL]) || 0,
      seules: seules,
      conf: Number(v[L_CONF]) || 0,
      confDate: v[L_CONFDATE]
    });
  }
  Object.keys(parRef).forEach(function (ref) {
    parRef[ref].sort(function (a, b) { return a.date - b.date || a.row - b.row; });
  });
  return parRef;
}

/**
 * Recalcule, pour chaque reference, combien de bouteilles seules sont
 * confirmees (premier arrive, premier servi), met le Sheet a jour, et renvoie :
 *   - alloc            : { ref: nb confirmees } pour la commande courante
 *   - montantConfirme  : TTC des bouteilles seules confirmees de cette commande
 *   - montantAttente   : TTC des bouteilles seules encore en attente
 *   - aPrevenir        : les autres participants dont des bouteilles viennent
 *                        d'etre confirmees (un objet par commande concernee)
 */
function reconcilier_(shL, shO, idCourant) {
  var valeurs = shL.getDataRange().getValues();
  var parRef = lignesParRef_(valeurs);
  var alloc = {}, montantConfirme = 0, montantAttente = 0;
  var nouveaux = {};      // idCommande -> { prenom, email, lignes[], montant }
  var majOrdres = {};     // idCommande -> montant nouvellement confirme

  Object.keys(parRef).forEach(function (ref) {
    var lignes = parRef[ref];
    var btl = lignes[0].btl || 6;
    var total = lignes.reduce(function (s, l) { return s + l.seules; }, 0);
    var quota = Math.floor(total / btl) * btl;   // seules les bouteilles d'un carton complet

    lignes.forEach(function (l) {
      var conf = Math.min(l.seules, Math.max(0, quota));
      quota -= conf;

      if (conf !== l.conf) {
        shL.getRange(l.row, L_CONF + 1).setValue(conf);
      }
      var nouvellesConf = conf - l.conf;

      if (l.id === idCourant) {
        alloc[ref] = conf;
        montantConfirme += ttc_(l.prix_ht) * conf;
        montantAttente += ttc_(l.prix_ht) * (l.seules - conf);
      } else if (nouvellesConf > 0) {
        // Un carton vient de se boucler grace a la commande courante.
        var n = nouveaux[l.id] || (nouveaux[l.id] = {
          id: l.id, prenom: l.prenom, nom: l.nom, email: l.email, lignes: [], montant: 0
        });
        n.lignes.push({
          ref: ref, desig: l.desig, cl: l.cl, mill: l.mill,
          n: nouvellesConf, prix_ht: l.prix_ht,
          montant: ttc_(l.prix_ht) * nouvellesConf
        });
        n.montant += ttc_(l.prix_ht) * nouvellesConf;
      }

      if (nouvellesConf > 0) {
        if (!l.confDate) shL.getRange(l.row, L_CONFDATE + 1).setValue(new Date());
        majOrdres[l.id] = (majOrdres[l.id] || 0) + ttc_(l.prix_ht) * nouvellesConf;
      }
    });
  });

  // Les montants des commandes deja enregistrees evoluent : on les met a jour
  // pour que le Sheet reste la source de verite.
  var ordres = shO.getDataRange().getValues();
  Object.keys(majOrdres).forEach(function (id) {
    for (var i = 1; i < ordres.length; i++) {
      if (String(ordres[i][O_ID]) !== id) continue;
      var ttc = (Number(ordres[i][O_TTC]) || 0) + majOrdres[id];
      shO.getRange(i + 1, O_TTC + 1).setValue(Math.round(ttc * 100) / 100);
      break;
    }
  });
  // Montant en attente de chaque commande, recalcule a partir des lignes.
  majAttente_(shL, shO);

  return {
    alloc: alloc,
    montantConfirme: montantConfirme,
    montantAttente: montantAttente,
    aPrevenir: Object.keys(nouveaux).map(function (k) { return nouveaux[k]; })
  };
}

// Recalcule la colonne "TTC en attente" de chaque commande.
function majAttente_(shL, shO) {
  var l = shL.getDataRange().getValues();
  var attente = {};
  for (var i = 1; i < l.length; i++) {
    if (!l[i][L_ID]) continue;
    var seules = Number(l[i][L_SEULES]) || 0;
    var conf = Number(l[i][L_CONF]) || 0;
    if (seules - conf <= 0) continue;
    var id = String(l[i][L_ID]);
    attente[id] = (attente[id] || 0) + ttc_(l[i][L_PRIX]) * (seules - conf);
  }
  var o = shO.getDataRange().getValues();
  for (var j = 1; j < o.length; j++) {
    if (!o[j][O_ID]) continue;
    var v = Math.round((attente[String(o[j][O_ID])] || 0) * 100) / 100;
    if (Number(o[j][O_ATTENTE]) !== v) shO.getRange(j + 1, O_ATTENTE + 1).setValue(v);
  }
}

/**
 * Etat public des cartons ouverts, pour la page (protege par le code
 * d'invitation). Ne renvoie que des prenoms et des quantites : ni e-mails,
 * ni montants, ni noms de famille.
 */
function etat_(code) {
  var vu = checkCode_(code);
  if (!vu.ok) return vu;

  var shL = tab_(SHEET_LINES, HEAD_LINES);
  var parRef = lignesParRef_(shL.getDataRange().getValues());
  var refs = {};

  Object.keys(parRef).forEach(function (ref) {
    var lignes = parRef[ref];
    var btl = lignes[0].btl || 6;
    var total = lignes.reduce(function (s, l) { return s + l.seules; }, 0);
    var attente = total % btl;              // bouteilles du carton encore ouvert
    if (attente === 0) return;              // rien d'ouvert sur cette reference
    // Les dernieres bouteilles arrivees sont celles qui restent en attente.
    var reste = attente, participants = [];
    for (var i = lignes.length - 1; i >= 0 && reste > 0; i--) {
      var n = Math.min(lignes[i].seules, reste);
      reste -= n;
      participants.unshift({ prenom: String(lignes[i].prenom || '').split(' ')[0], n: n });
    }
    refs[ref] = { attente: attente, btl: btl, participants: participants };
  });

  return { ok: true, refs: refs };
}

/* ------------------------------------------------------------ e-mails ---
 * L'e-mail est LE support des coordonnees bancaires : le depot GitHub etant
 * public, l'IBAN ne vit que dans les Script Properties.
 */

function infosPaiement_() {
  var p = props_();
  return {
    benef: p.getProperty('PAY_BENEFICIAIRE') || '',
    iban: p.getProperty('PAY_IBAN') || '',
    echeance: p.getProperty('PAY_DEADLINE') || '',
    orgName: p.getProperty('ORG_NAME') || 'Commande groupée Noël 2026',
    orgMail: p.getProperty('ORG_EMAIL') || '',
    enlev: String(p.getProperty('ENLEVEMENT') || '').trim()
  };
}

function blocPaiement_(montant, ref, titre) {
  var i = infosPaiement_();
  return '<h3 style="margin:22px 0 6px">' + (titre || 'Paiement') + '</h3>' +
    '<table cellpadding="4" cellspacing="0" border="0" style="font:14px Helvetica,Arial,sans-serif">' +
    '<tr><td style="color:#6b6660">Montant</td><td><b>' + money_(montant) + '</b> (TTC)</td></tr>' +
    (i.echeance ? '<tr><td style="color:#6b6660">À payer avant le</td><td><b>' + esc_(i.echeance) + '</b></td></tr>' : '') +
    (i.benef ? '<tr><td style="color:#6b6660">Bénéficiaire</td><td><b>' + esc_(i.benef) + '</b></td></tr>' : '') +
    (i.iban ? '<tr><td style="color:#6b6660">IBAN</td><td><b>' + esc_(i.iban) + '</b></td></tr>' : '') +
    '<tr><td style="color:#6b6660">Référence</td><td><b>' + esc_(ref) + '</b></td></tr>' +
    '</table>' +
    (i.benef && i.iban ? '' :
      '<p style="color:#a45b12;font:13px Helvetica,Arial,sans-serif">Les coordonnées bancaires ne sont pas encore ' +
      'configurées (Script Properties PAY_BENEFICIAIRE et PAY_IBAN) — elles vous seront transmises séparément.</p>');
}

// Recapitulatif HTML des lignes, avec les bouteilles seules en attente.
function tableHtml_(c, alloc) {
  alloc = alloc || {};
  var payer = 0, attente = 0, cartons = 0, bouteilles = 0;
  var h = '<table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;font:14px Helvetica,Arial,sans-serif">' +
    '<tr style="background:#f2e6ea">' +
    '<th align="left">Réf.</th><th align="left">Vin</th>' +
    '<th align="right">Cartons</th><th align="right">Bouteilles</th><th align="right">Montant TTC</th></tr>';

  c.lignes.forEach(function (l, i) {
    var btl = Number(l.btl) || 0;
    var nbCartons = Number(l.cartons) || 0;
    var seules = Number(l.seules) || 0;
    var conf = Math.min(seules, Number(alloc[l.ref] || 0));
    var enAttente = seules - conf;
    var unite = ttc_(l.prix_ht);
    var ferme = unite * (nbCartons * btl + conf);
    payer += ferme;
    attente += unite * enAttente;
    cartons += nbCartons;
    bouteilles += nbCartons * btl + conf;

    h += '<tr style="background:' + (i % 2 ? '#ffffff' : '#fbf9f5') + '">' +
      '<td>' + esc_(l.ref) + '</td>' +
      '<td><b>' + esc_(l.nom) + '</b><br><span style="color:#6b6660;font-size:12px">' +
      esc_(l.appellation) + ' · ' + esc_(l.cl) + ' · ' + esc_(l.mill) + '</span>' +
      (enAttente ? '<br><span style="color:#a45b12;font-size:12px">' + enAttente +
        ' bouteille(s) en attente — carton ouvert, non facturé</span>' : '') +
      (conf ? '<br><span style="color:#2f6b46;font-size:12px">' + conf +
        ' bouteille(s) hors carton confirmée(s)</span>' : '') +
      '</td>' +
      '<td align="right">' + (nbCartons ? nbCartons + ' × ' + btl : '—') + '</td>' +
      '<td align="right">' + (nbCartons * btl + conf) +
      (enAttente ? ' <span style="color:#a45b12">(' + enAttente + ')</span>' : '') + '</td>' +
      '<td align="right">' + money_(ferme) +
      (enAttente ? '<br><span style="color:#a45b12;font-size:12px">(' + money_(unite * enAttente) + ')</span>' : '') +
      '</td></tr>';
  });

  h += '<tr style="border-top:2px solid #21201d"><td colspan="2"><b>Total à payer</b></td>' +
    '<td align="right"><b>' + cartons + '</b></td>' +
    '<td align="right"><b>' + bouteilles + '</b></td>' +
    '<td align="right"><b>' + money_(payer) + '</b></td></tr>';
  if (attente > 0) {
    h += '<tr><td colspan="4" style="color:#a45b12">En attente (cartons ouverts, non facturé)</td>' +
      '<td align="right" style="color:#a45b12">(' + money_(attente) + ')</td></tr>';
  }
  h += '</table>';
  return { html: h, payer: payer, attente: attente };
}

// E-mail au participant : recapitulatif + coordonnees de paiement.
function mailConfirmation_(c, alloc) {
  if (!c.email) return false;
  var i = infosPaiement_();
  var t = tableHtml_(c, alloc);
  var ref = c.prenom + ' ' + c.nom + ' — ' + c.id;

  var html = '<div style="font:15px/1.5 Helvetica,Arial,sans-serif;color:#21201d;max-width:640px">' +
    '<h2 style="font-family:Georgia,serif;margin:0 0 4px">Commande enregistrée</h2>' +
    '<p style="color:#6b6660;margin:0 0 18px">' + esc_(c.prenom) + ', voici le récapitulatif de votre commande <b>' + esc_(c.id) + '</b>.</p>' +
    t.html +
    '<p style="color:#6b6660;font-size:13px;margin:8px 0 0">Prix TTC, TVA ' +
    (Math.round(TVA_ * 1000) / 10) + ' % incluse, arrondis au 5 centimes supérieur.</p>' +
    (t.attente > 0 ?
      '<div style="margin:18px 0;padding:10px 12px;border-left:3px solid #a45b12;background:#fdf6ee">' +
      '<b>Les montants entre parenthèses ne sont pas à payer.</b><br>' +
      'Ces bouteilles sont dans un carton ouvert qui n\'est pas encore complet. ' +
      'Si quelqu\'un du groupe le termine, vous recevrez un nouvel e-mail avec le complément à payer. ' +
      'Si le carton reste incomplet à la clôture, ces bouteilles ne seront pas commandées — ' +
      'et vous ne les paierez pas.</div>' : '') +
    blocPaiement_(t.payer, ref) +
    (i.enlev ? '<h3 style="margin:22px 0 6px">Enlèvement</h3>' +
      '<p style="margin:0;color:#6b6660">' + esc_(i.enlev) + '.</p>' : '') +
    '<p style="margin:22px 0 0;color:#6b6660;font-size:13px">Merci d\'indiquer la référence ci-dessus lors du virement, ' +
    'elle permet de rapprocher votre paiement de votre commande.</p></div>';

  var plain = 'Commande ' + c.id + ' enregistrée.\n\n' +
    c.lignes.map(function (l) {
      var btl = Number(l.btl) || 0;
      var conf = Math.min(Number(l.seules) || 0, Number((alloc || {})[l.ref] || 0));
      var att = (Number(l.seules) || 0) - conf;
      return l.ref + ' — ' + l.nom + ' : ' + (Number(l.cartons) || 0) + ' carton(s)' +
        (conf ? ' + ' + conf + ' bt. confirmée(s)' : '') +
        (att ? ' + (' + att + ' bt. en attente)' : '') +
        ' = ' + money_(ttc_(l.prix_ht) * ((Number(l.cartons) || 0) * btl + conf));
    }).join('\n') +
    '\n\nÀ PAYER : ' + money_(t.payer) +
    (t.attente > 0 ? '\nEn attente, non facturé : (' + money_(t.attente) + ')' +
      '\nCes bouteilles sont dans un carton ouvert. Si le groupe le complète, un nouvel e-mail vous indiquera le complément à payer.' : '') +
    '\n\nPAIEMENT' +
    (i.echeance ? '\nÀ payer avant le : ' + i.echeance : '') +
    (i.benef ? '\nBénéficiaire : ' + i.benef : '') +
    (i.iban ? '\nIBAN : ' + i.iban : '') +
    '\nRéférence : ' + ref +
    (i.enlev ? '\n\nEnlèvement : ' + i.enlev : '') + '\n';

  try {
    var opts = { name: i.orgName, htmlBody: html };
    if (i.orgMail) opts.replyTo = i.orgMail;
    MailApp.sendEmail(c.email, 'Noël 2026 — votre commande ' + c.id + ' (' + money_(t.payer) + ')', plain, opts);
    return true;
  } catch (e) {
    Logger.log('mailConfirmation_ : ' + e);
    return false;
  }
}

// E-mail envoye quand un carton ouvert vient d'etre boucle par quelqu'un
// d'autre : les bouteilles en attente deviennent dues.
function mailCartonBoucle_(p) {
  if (!p.email) return false;
  var i = infosPaiement_();
  var ref = p.prenom + ' ' + p.nom + ' — ' + p.id;

  var lignes = p.lignes.map(function (l) {
    return '<tr><td>' + esc_(l.ref) + '</td>' +
      '<td><b>' + esc_(l.desig) + '</b><br><span style="color:#6b6660;font-size:12px">' +
      esc_(l.cl) + ' · ' + esc_(l.mill) + '</span></td>' +
      '<td align="right">' + l.n + '</td>' +
      '<td align="right">' + money_(l.montant) + '</td></tr>';
  }).join('');

  var html = '<div style="font:15px/1.5 Helvetica,Arial,sans-serif;color:#21201d;max-width:640px">' +
    '<h2 style="font-family:Georgia,serif;margin:0 0 4px">Carton bouclé</h2>' +
    '<p style="color:#6b6660;margin:0 0 18px">' + esc_(p.prenom) +
    ', quelqu\'un du groupe a complété un carton ouvert : vos bouteilles en attente sont désormais confirmées ' +
    'et seront commandées.</p>' +
    '<table cellpadding="6" cellspacing="0" border="0" style="border-collapse:collapse;font:14px Helvetica,Arial,sans-serif">' +
    '<tr style="background:#f2e6ea"><th align="left">Réf.</th><th align="left">Vin</th>' +
    '<th align="right">Bouteilles</th><th align="right">Montant TTC</th></tr>' + lignes +
    '<tr style="border-top:2px solid #21201d"><td colspan="3"><b>Complément à payer</b></td>' +
    '<td align="right"><b>' + money_(p.montant) + '</b></td></tr></table>' +
    blocPaiement_(p.montant, ref, 'Complément à payer') +
    '<p style="margin:22px 0 0;color:#6b6660;font-size:13px">Ce montant s\'ajoute à celui de votre commande initiale ' +
    '(' + esc_(p.id) + '). Même référence de virement.</p></div>';

  var plain = 'Carton bouclé — vos bouteilles en attente sont confirmées.\n\n' +
    p.lignes.map(function (l) {
      return l.ref + ' — ' + l.desig + ' : ' + l.n + ' bt. — ' + money_(l.montant);
    }).join('\n') +
    '\n\nCOMPLÉMENT À PAYER : ' + money_(p.montant) +
    (i.echeance ? '\nÀ payer avant le : ' + i.echeance : '') +
    (i.benef ? '\nBénéficiaire : ' + i.benef : '') +
    (i.iban ? '\nIBAN : ' + i.iban : '') +
    '\nRéférence : ' + ref + '\n';

  try {
    var opts = { name: i.orgName, htmlBody: html };
    if (i.orgMail) opts.replyTo = i.orgMail;
    MailApp.sendEmail(p.email, 'Noël 2026 — carton bouclé, complément ' + money_(p.montant), plain, opts);
    return true;
  } catch (e) {
    Logger.log('mailCartonBoucle_ : ' + e);
    return false;
  }
}

// Copie a l'organisateur : renseigner la Script Property NOTIFY_EMAIL.
function notify_(c, alloc) {
  var to = props_().getProperty('NOTIFY_EMAIL');
  if (!to) return;
  try {
    var t = tableHtml_(c, alloc);
    MailApp.sendEmail(to,
      'Noël 2026 — commande de ' + c.prenom + ' ' + c.nom + ' (' + money_(t.payer) + ')',
      c.prenom + ' ' + c.nom + ' (' + c.email + (c.tel ? ', ' + c.tel : '') + ')\n' +
      'À payer : ' + money_(t.payer) + (t.attente ? ' — en attente : (' + money_(t.attente) + ')' : '') + '\n\n' +
      c.lignes.map(function (l) {
        return l.ref + ' — ' + l.nom + ' : ' + (Number(l.cartons) || 0) + ' carton(s)' +
          ((Number(l.seules) || 0) ? ' + ' + l.seules + ' bt. seule(s)' : '');
      }).join('\n'),
      { htmlBody: '<div style="font:15px/1.5 Helvetica,Arial,sans-serif"><p><b>' + esc_(c.prenom + ' ' + c.nom) +
        '</b><br>' + esc_(c.email) + (c.tel ? ' · ' + esc_(c.tel) : '') + '</p>' + t.html + '</div>' });
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
      total_attente: Number(o[i][O_ATTENTE]) || 0,
      lignes: []
    };
    byId[cmd.id] = cmd;
    out.push(cmd);
  }

  var l = shL.getDataRange().getValues();
  for (var j = 1; j < l.length; j++) {
    var cmd2 = byId[l[j][L_ID]];
    if (!cmd2) continue;
    var cartons = Number(l[j][L_CARTONS]) || 0;
    var bout = Number(l[j][L_BOUT]) || 0;
    cmd2.lignes.push({
      ref: String(l[j][L_REF]), nom: l[j][L_DESIG], appellation: l[j][L_APPEL],
      couleur: l[j][L_COUL], cl: l[j][L_CL], emb: l[j][L_EMB], mill: String(l[j][L_MILL]),
      cartons: cartons, bouteilles: bout,
      btl: Number(l[j][L_BTL]) || (cartons ? bout / cartons : 0),
      seules: Number(l[j][L_SEULES]) || 0,
      confirmees: Number(l[j][L_CONF]) || 0,
      prix_ht: Number(l[j][L_PRIX]) || 0,
      groupe: ''
    });
  }
  return { ok: true, commandes: out };
}

/* ------------------------------------------------------- initialisation ---
 * À lancer UNE FOIS depuis l'éditeur (menu Exécuter) après avoir renseigné les
 * Script Properties : crée ou met à jour les onglets et vérifie la conf.
 */
function setup() {
  tab_(SHEET_ORDERS, HEAD_ORDERS);
  tab_(SHEET_LINES, HEAD_LINES);
  var p = props_();
  Logger.log('SHEET_ID     : ' + (p.getProperty('SHEET_ID') || '(classeur actif)'));
  Logger.log('ADMIN_USER   : ' + (p.getProperty('ADMIN_USER') || 'admin (défaut)'));
  Logger.log('ADMIN_PASS   : ' + (p.getProperty('ADMIN_PASS') ? 'défini' : '*** MANQUANT ***'));
  Logger.log('SUBMIT_CODE  : ' + (p.getProperty('SUBMIT_CODE') ? 'défini — lien : …/?c=' + p.getProperty('SUBMIT_CODE') : '*** MANQUANT : toutes les commandes seront refusées ***'));
  Logger.log('NOTIFY_EMAIL : ' + (p.getProperty('NOTIFY_EMAIL') || '(aucune notification)'));
  Logger.log('PAY_BENEFICIAIRE : ' + (p.getProperty('PAY_BENEFICIAIRE') || '*** MANQUANT ***'));
  Logger.log('PAY_IBAN     : ' + (p.getProperty('PAY_IBAN') || '*** MANQUANT ***'));
  Logger.log('PAY_DEADLINE : ' + (p.getProperty('PAY_DEADLINE') || '(aucune échéance)'));
  Logger.log('ORG_NAME     : ' + (p.getProperty('ORG_NAME') || 'Commande groupée Noël 2026 (défaut)'));
  Logger.log('ORG_EMAIL    : ' + (p.getProperty('ORG_EMAIL') || '(pas de reply-to)'));
  Logger.log('Quota e-mails restant aujourd\'hui : ' + MailApp.getRemainingDailyQuota());
}
