/* =========================================================================
   Commande groupée de vins — Noël 2026
   Application 100 % front. Deux modes de stockage :
     - MODE LOCAL   : CONFIG.endpoint vide  -> localStorage
     - MODE DISTANT : CONFIG.endpoint défini -> Web App Google Apps Script
                      qui écrit dans un Google Sheet privé.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.CONFIG;
  var CAT = window.CATALOGUE;
  var GROUPES = window.GROUPES;
  var TVA = CFG.tva;
  var LS_DRAFT = 'noel2026.brouillon';
  var LS_ORDERS = 'noel2026.commandes';

  // Code d'invitation : passe dans l'URL (/?c=LE_CODE), verifie cote serveur
  // contre la Script Property SUBMIT_CODE. Jamais stocke dans le depot.
  var CODE_URL = (function () {
    try { return (new URLSearchParams(location.search).get('c') || '').trim(); }
    catch (e) { return ''; }
  })();

  var BY_REF = {};
  CAT.forEach(function (w) { BY_REF[w.ref] = w; });

  /* ----------------------------- utilitaires ----------------------------- */
  var $ = function (id) { return document.getElementById(id); };
  var nf = new Intl.NumberFormat('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function chf(n) { return 'CHF ' + nf.format(Math.round(n * 100) / 100); }
  // Arrondi au 5 centimes SUPERIEUR (usage suisse).
  function ceil5(n) { return Math.ceil(n * 20 - 1e-9) / 20; }
  // Prix bouteille TTC : la TVA est appliquee au prix HT puis arrondie au 5 ct
  // superieur. Tous les autres montants derivent de ce prix arrondi, donc
  // chaque sous-total et le total sont eux aussi des multiples de 0.05.
  function ttc(ht) { return ceil5(ht * (1 + TVA)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function slugCouleur(c) { return c === 'rosé' ? 'rose' : c; }
  function pctTVA() { return String(Math.round(TVA * 1000) / 10); }
  // Les coordonnées bancaires ne sont affichées que si elles sont renseignées
  // dans config.js. Sinon elles arrivent uniquement par l'e-mail de
  // confirmation, envoyé par l'Apps Script (dépôt public = pas d'IBAN dedans).
  function hasPayInfo() { return !!(CFG.beneficiaire && CFG.iban); }
  function payLine(sep) {
    return hasPayInfo()
      ? 'À payer à ' + esc(CFG.beneficiaire) + sep + 'IBAN ' + esc(CFG.iban)
      : 'Les coordonnées de paiement vous sont envoyées par e-mail après validation.';
  }
  function norm(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /* -------------------------- validation e-mail --------------------------
   * Objectif : eviter les adresses fantaisistes ou mal tapees, sinon la
   * personne ne recoit jamais ses coordonnees de paiement et sa commande est
   * inexploitable (l'e-mail est la seule facon de la joindre).
   */
  var DOMAINES_JETABLES = [
    'example.com', 'example.org', 'example.net', 'exemple.com', 'exemple.fr',
    'test.com', 'test.ch', 'test.fr', 'toto.com', 'aaa.com', 'azerty.com',
    'mailinator.com', 'yopmail.com', 'yopmail.fr', 'jetable.org', 'trashmail.com',
    'guerrillamail.com', 'sharklasers.com', '10minutemail.com', 'tempmail.com',
    'temp-mail.org', 'dispostable.com', 'maildrop.cc', 'fakemail.net', 'mailnesia.com'
  ];

  // Fautes de frappe courantes sur les domaines suisses et grand public.
  var CORRECTIONS = {
    'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.con': 'gmail.com',
    'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmali.com': 'gmail.com',
    'gnail.com': 'gmail.com', 'gmail.fr': 'gmail.com', 'gamil.com': 'gmail.com',
    'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmal.com': 'hotmail.com',
    'hotmail.co': 'hotmail.com', 'hotmailcom': 'hotmail.com',
    'outlok.com': 'outlook.com', 'outllok.com': 'outlook.com', 'outloo.com': 'outlook.com',
    'yaho.com': 'yahoo.com', 'yahou.com': 'yahoo.com', 'yaho.fr': 'yahoo.fr',
    'bluwin.ch': 'bluewin.ch', 'bluewin.c': 'bluewin.ch', 'bluewn.ch': 'bluewin.ch',
    'bluewin.cj': 'bluewin.ch', 'sunrise.c': 'sunrise.ch', 'netplu.ch': 'netplus.ch',
    'ikmail.com': 'icloud.com', 'iclou.com': 'icloud.com', 'icloud.co': 'icloud.com'
  };

  // Renvoie { valeur, erreur, suggestion } — valeur est l'adresse nettoyee.
  function analyseEmail(brut) {
    var v = String(brut || '').trim().replace(/\s+/g, '').replace(/^mailto:/i, '');
    if (!v) return { valeur: '', erreur: 'E-mail obligatoire.' };
    if (v.length > 254) return { valeur: v, erreur: 'E-mail trop long.' };
    if ((v.match(/@/g) || []).length !== 1) return { valeur: v, erreur: 'L\'e-mail doit contenir un seul « @ ».' };

    var part = v.split('@');
    var local = part[0], domaine = part[1].toLowerCase();
    v = local + '@' + domaine;

    if (!local || local.length > 64) return { valeur: v, erreur: 'Partie avant le « @ » invalide.' };
    if (!/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/.test(local) || /^\.|\.$|\.\./.test(local)) {
      return { valeur: v, erreur: 'Caractère non autorisé avant le « @ ».' };
    }
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/.test(domaine) || /\.\.|^-|-$/.test(domaine)) {
      return { valeur: v, erreur: 'Domaine invalide (exemple attendu : prenom.nom@bluewin.ch).' };
    }
    if (CORRECTIONS[domaine]) {
      return { valeur: v, erreur: 'Domaine probablement mal tapé.', suggestion: local + '@' + CORRECTIONS[domaine] };
    }
    if (DOMAINES_JETABLES.indexOf(domaine) !== -1) {
      return { valeur: v, erreur: 'Adresse de test ou jetable refusée : sans e-mail valable, vous ne recevrez pas les coordonnées de paiement.' };
    }
    return { valeur: v, erreur: null };
  }

  /* ------------------------------- état ---------------------------------- */
  var state = {
    identite: { prenom: '', nom: '', email: '', tel: '' },
    lignes: {},            // { ref: nbCartons }
    filtres: { q: '', groupe: '', couleur: '', onlyPicked: false, onlyOpen: false },
    etat: {},              // cartons ouverts du groupe, par référence
    code: CODE_URL,        // code d'invitation (URL, sinon champ de secours)
    codeOk: null,          // null = pas encore verifie, true/false = reponse serveur
    identiteOk: false,     // l'étape 1 doit être validée avant les étapes 2 et 3
    step: 1
  };

  try {
    var raw = localStorage.getItem(LS_DRAFT);
    if (raw) {
      var d = JSON.parse(raw);
      if (d && d.identite) state.identite = d.identite;
      if (d && d.lignes) state.lignes = d.lignes;
      if (!state.code && d && d.code) state.code = d.code;   // survit a un rechargement sans ?c=
    }
  } catch (e) { /* brouillon illisible : on ignore */ }

  function saveDraft() {
    try {
      localStorage.setItem(LS_DRAFT, JSON.stringify({ identite: state.identite, lignes: state.lignes, code: state.code }));
    } catch (e) { /* quota / navigation privée : sans conséquence */ }
  }

  /* --------------------------- cartons ouverts ---------------------------
   * On peut commander a la bouteille, mais Schenk ne livre qu'en cartons
   * entiers : ces bouteilles restent EN ATTENTE jusqu'a ce que le groupe
   * complete le carton. state.etat contient ce que le groupe a deja engage,
   * par reference : { attente: 2, btl: 6, participants: [{prenom, n}] }.
   */
  function qty(ref) {
    var v = state.lignes[ref];
    if (v == null) return { c: 0, s: 0 };
    if (typeof v === 'number') return { c: v, s: 0 };   // ancien brouillon
    return { c: Number(v.c) || 0, s: Number(v.s) || 0 };
  }

  // Bouteilles deja en attente dans le groupe sur cette reference (hors moi).
  function attenteGroupe(ref) {
    var e = state.etat && state.etat[ref];
    return e ? Number(e.attente) || 0 : 0;
  }

  // Combien de MES bouteilles seules seraient confirmees : premier arrive,
  // premier servi, donc celles du groupe passent avant les miennes.
  function confirmables(ref, seules, btl) {
    if (seules <= 0) return 0;
    var a = attenteGroupe(ref);
    return (a + seules >= btl) ? Math.min(seules, btl - a) : 0;
  }

  /* ------------------------------ totaux --------------------------------- */
  function lignes() {
    var out = [];
    Object.keys(state.lignes).forEach(function (ref) {
      var q = qty(ref);
      var w = BY_REF[ref];
      if (!w || (q.c <= 0 && q.s <= 0)) return;
      var conf = confirmables(ref, q.s, w.btl);
      var fermes = q.c * w.btl + conf;          // bouteilles dues
      var attente = q.s - conf;                 // bouteilles non facturees
      var unite = ttc(w.prix_ht);
      out.push({
        ref: ref, nom: w.nom, appellation: w.appellation, couleur: w.couleur,
        cl: w.cl, mill: w.mill, emb: w.emb, btl: w.btl, groupe: w.groupe,
        prix_ht: w.prix_ht, prix_ttc: unite,
        cartons: q.c, seules: q.s, confirmees: conf, attente: attente,
        bouteilles: fermes,
        total_ht: w.prix_ht * fermes,
        total_ttc: unite * fermes,
        total_attente: unite * attente
      });
    });
    out.sort(function (a, b) {
      var g = GROUPES.indexOf(a.groupe) - GROUPES.indexOf(b.groupe);
      return g !== 0 ? g : a.nom.localeCompare(b.nom, 'fr');
    });
    return out;
  }

  function totaux(ls) {
    return ls.reduce(function (t, l) {
      t.cartons += l.cartons; t.bouteilles += l.bouteilles;
      t.seules += l.seules; t.attente += l.attente;
      t.ht += l.total_ht; t.ttc += l.total_ttc; t.ttcAttente += l.total_attente;
      t.refs += 1;
      return t;
    }, { cartons: 0, bouteilles: 0, seules: 0, attente: 0, ht: 0, ttc: 0, ttcAttente: 0, refs: 0 });
  }

  /* ----------------------------- stockage -------------------------------- */
  var Store = {
    remote: function () { return !!(CFG.endpoint && CFG.endpoint.trim()); },

    post: function (payload) {
      // text/plain : évite le preflight CORS, qu'Apps Script ne gère pas.
      return fetch(CFG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json(); });
    },

    submit: function (order) {
      if (!this.remote()) {
        var all = Store.localAll();
        all.push(order);
        localStorage.setItem(LS_ORDERS, JSON.stringify(all));
        var m = montantsLocaux(order);
        return Promise.resolve({
          ok: true, id: order.id, mode: 'local',
          montant_a_payer: m.payer, montant_en_attente: m.attente
        });
      }
      return this.post({ action: 'submit', code: state.code, commande: order });
    },

    // Verifie le code sans rien ecrire (blocage immediat a l'etape 1).
    check: function (code) {
      if (!this.remote()) return Promise.resolve({ ok: true });
      return this.post({ action: 'check', code: code });
    },

    // Etat des cartons ouverts du groupe. En local, on le reconstitue depuis
    // les commandes stockees dans ce navigateur.
    etat: function (code) {
      if (!this.remote()) return Promise.resolve({ ok: true, refs: etatLocal() });
      return this.post({ action: 'etat', code: code });
    },

    list: function (user, pass) {
      if (!this.remote()) {
        if (user !== CFG.adminUser || pass !== CFG.adminPassLocal) {
          return Promise.resolve({ ok: false, error: 'Identifiants incorrects.' });
        }
        return Promise.resolve({ ok: true, commandes: reconcilierLocal(Store.localAll()), mode: 'local' });
      }
      return this.post({ action: 'list', user: user, pass: pass });
    },

    localAll: function () {
      // (mode local uniquement)
      try { return JSON.parse(localStorage.getItem(LS_ORDERS) || '[]'); } catch (e) { return []; }
    }
  };

  // ---- mode local : etat des cartons ouverts calcule depuis localStorage
  function seulesParRef() {
    var parRef = {};
    Store.localAll().forEach(function (o) {
      (o.lignes || []).forEach(function (l) {
        var s = Number(l.seules) || 0;
        if (s <= 0) return;
        var btl = Number(l.btl) || (BY_REF[l.ref] ? BY_REF[l.ref].btl : 6);
        (parRef[l.ref] = parRef[l.ref] || { btl: btl, total: 0, lignes: [] });
        parRef[l.ref].total += s;
        parRef[l.ref].lignes.push({ prenom: o.prenom, n: s, date: o.date });
      });
    });
    return parRef;
  }

  /* Mode local : recalcule le champ confirmees de chaque ligne, premier arrive
     premier servi — c'est ce que fait reconcilier_() cote Apps Script. */
  function reconcilierLocal(cmds) {
    var parRef = {};
    cmds.forEach(function (o) {
      (o.lignes || []).forEach(function (l) {
        l.confirmees = 0;
        var sq = Number(l.seules) || 0;
        if (!sq) return;
        var btl = Number(l.btl) || (BY_REF[l.ref] ? BY_REF[l.ref].btl : 6);
        (parRef[l.ref] = parRef[l.ref] || { btl: btl, total: 0, lignes: [] });
        parRef[l.ref].total += sq;
        parRef[l.ref].lignes.push({ l: l, date: o.date, n: sq });
      });
    });
    Object.keys(parRef).forEach(function (ref) {
      var e = parRef[ref];
      var quota = Math.floor(e.total / e.btl) * e.btl;
      e.lignes.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
      e.lignes.forEach(function (x) {
        var conf = Math.min(x.n, Math.max(0, quota));
        quota -= conf;
        x.l.confirmees = conf;
      });
    });
    return cmds;
  }

  // Repartition premier arrive / premier servi, comme reconcilier_() cote serveur.
  function montantsLocaux(order) {
    var parRef = seulesParRef();
    var payer = 0, attente = 0;
    (order.lignes || []).forEach(function (l) {
      var unite = ttc(l.prix_ht);
      var btl = Number(l.btl) || 6;
      payer += unite * (Number(l.cartons) || 0) * btl;
      var s = Number(l.seules) || 0;
      if (!s) return;
      var e = parRef[l.ref];
      var total = e ? e.total : s;
      var quota = Math.floor(total / btl) * btl;
      // les bouteilles des autres, arrivees avant, passent en premier
      var avant = total - s;
      var conf = Math.max(0, Math.min(s, quota - Math.min(avant, quota)));
      payer += unite * conf;
      attente += unite * (s - conf);
    });
    return { payer: Math.round(payer * 100) / 100, attente: Math.round(attente * 100) / 100 };
  }

  function etatLocal() {
    var parRef = seulesParRef(), out = {};
    Object.keys(parRef).forEach(function (ref) {
      var e = parRef[ref];
      var attente = e.total % e.btl;
      if (!attente) return;
      e.lignes.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
      var reste = attente, participants = [];
      for (var i = e.lignes.length - 1; i >= 0 && reste > 0; i--) {
        var n = Math.min(e.lignes[i].n, reste);
        reste -= n;
        participants.unshift({ prenom: String(e.lignes[i].prenom || '').split(' ')[0], n: n });
      }
      out[ref] = { attente: attente, btl: e.btl, participants: participants };
    });
    return out;
  }

  /* ---------------------------- navigation ------------------------------- */
  function show(step) {
    // Etape 1 obligatoire : aucun acces au catalogue ni au recapitulatif sans
    // prenom, nom et e-mail valides.
    if ((step === 2 || step === 3) && !state.identiteOk) {
      step = 1;
      $('e-nom').textContent = 'Renseignez vos coordonnées avant de choisir vos vins.';
    }
    state.step = step;
    ['1', '2', '3', 'done', 'admin'].forEach(function (k) {
      $('view-' + k).classList.toggle('hidden', String(step) !== k);
    });
    $('steps').classList.toggle('hidden', step === 'done' || step === 'admin');
    $('totalbar').classList.toggle('hidden', step !== 2);
    Array.prototype.forEach.call(document.querySelectorAll('.step'), function (el) {
      var n = Number(el.dataset.step);
      el.classList.toggle('on', n === step);
      el.classList.toggle('done', n < step);
    });
    window.scrollTo(0, 0);
  }

  /* ------------------------------ étape 1 -------------------------------- */
  function fillIdentite() {
    $('f-prenom').value = state.identite.prenom;
    $('f-nom').value = state.identite.nom;
    $('f-email').value = state.identite.email;
    $('f-tel').value = state.identite.tel;
  }

  function readIdentite() {
    state.identite = {
      prenom: $('f-prenom').value.trim(),
      nom: $('f-nom').value.trim(),
      email: $('f-email').value.trim(),
      tel: $('f-tel').value.trim()
    };
    saveDraft();
  }

  function validIdentite() {
    readIdentite();
    var i = state.identite, ok = true;
    $('e-prenom').textContent = ''; $('e-nom').textContent = ''; $('e-email').textContent = '';
    if (!i.prenom) { $('e-prenom').textContent = 'Prénom obligatoire.'; ok = false; }
    if (!i.nom) { $('e-nom').textContent = 'Nom obligatoire.'; ok = false; }
    if ($('f-code') && !$('f-code').classList.contains('hidden')) {
      // champ de secours affiche : on prend ce qui y est tape
      if ($('f-code').value.trim()) state.code = $('f-code').value.trim();
    }
    $('e-code').textContent = '';
    if (Store.remote() && !state.code) {
      $('e-code').textContent = 'Code d\'invitation obligatoire — utilisez le lien qui vous a été envoyé.';
      ok = false;
    }
    var m = analyseEmail(i.email);
    if (m.valeur !== i.email) {                 // on nettoie ce qui a ete saisi
      i.email = m.valeur; $('f-email').value = m.valeur; saveDraft();
    }
    if (m.erreur) {
      $('e-email').innerHTML = esc(m.erreur) +
        (m.suggestion ? ' Vouliez-vous dire <a href="#" data-fix="' + esc(m.suggestion) + '">' +
          esc(m.suggestion) + '</a> ?' : '');
      ok = false;
    }
    state.identiteOk = ok;
    return ok;
  }

  // Verifie l'identite sans afficher d'erreur (reprise d'un brouillon, garde-fou
  // avant l'envoi).
  function identiteComplete() {
    var i = state.identite;
    return !!(i.prenom && i.nom && !analyseEmail(i.email).erreur &&
      (!Store.remote() || state.code));
  }

  function erreurCode(msg) {
    state.code = '';
    state.codeOk = false;
    state.identiteOk = false;
    saveDraft();
    $('grp-code').classList.remove('hidden');
    $('f-code').value = '';
    $('e-code').textContent = msg;
    show(1);
    $('f-code').focus();
  }

  /* ------------------------------ étape 2 -------------------------------- */
  function initFiltres() {
    var sel = $('f-groupe');
    GROUPES.forEach(function (g) {
      var o = document.createElement('option');
      o.value = g; o.textContent = g;
      sel.appendChild(o);
    });
    $('tva-label').textContent = pctTVA();
  }

  function visibles() {
    var f = state.filtres, q = norm(f.q);
    return CAT.filter(function (w) {
      if (f.groupe && w.groupe !== f.groupe) return false;
      if (f.couleur && w.couleur !== f.couleur) return false;
      var sel = qty(w.ref);
      if (f.onlyPicked && sel.c <= 0 && sel.s <= 0) return false;
      if (f.onlyOpen && !(attenteGroupe(w.ref) > 0)) return false;
      if (q) {
        var hay = norm(w.nom + ' ' + w.appellation + ' ' + w.ref + ' ' + w.groupe + ' ' + w.mill);
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function renderCatalogue() {
    var list = visibles(), host = $('catalogue');
    if (!list.length) {
      host.innerHTML = '<div class="card empty">Aucune référence ne correspond à ces filtres.</div>';
      renderTotaux();
      return;
    }
    var html = '', current = null;
    list.forEach(function (w) {
      if (w.groupe !== current) {
        if (current !== null) html += '</tbody></table></div>';
        current = w.groupe;
        html += '<div class="group"><h3>' + esc(w.groupe) + '</h3>' +
          '<div class="scroll-x"><table><thead><tr>' +
          '<th>Réf.</th><th>Vin</th><th class="num">Prix bt. TTC</th>' +
          '<th class="num">Carton</th><th>Cartons</th><th>Bouteilles seules</th>' +
          '<th class="num">Bouteilles</th><th class="num">Sous-total TTC</th>' +
          '</tr></thead><tbody>';
      }
      html += rowHtml(w);
    });
    html += '</tbody></table></div>';
    host.innerHTML = html;
    renderTotaux();
  }

  function rowClass(w) {
    var q = qty(w.ref);
    return (q.c > 0 || q.s > 0) ? 'picked' : '';
  }

  function rowHtml(w) {
    var q = qty(w.ref);
    var unite = ttc(w.prix_ht);
    var conf = confirmables(w.ref, q.s, w.btl);
    var attente = q.s - conf;
    var sub = (q.c * w.btl + conf) * unite;
    var a = attenteGroupe(w.ref);
    var e = state.etat[w.ref];
    var manque = a > 0 ? w.btl - a : 0;

    var badge = '';
    if (a > 0) {
      var qui = (e.participants || []).map(function (p) { return esc(p.prenom) + ' (' + p.n + ')'; }).join(', ');
      badge = '<div class="open-carton">Carton ouvert <b>' + a + '/' + w.btl + '</b> · il manque ' +
        manque + ' bt.' + (qui ? ' · ' + qui : '') +
        ' <button type="button" class="mini" data-act="fill">Compléter (' + manque + ')</button></div>';
    } else if (q.s > 0) {
      badge = '<div class="open-carton mine">Vous ouvrez un carton <b>' + q.s + '/' + w.btl +
        '</b> · il manque ' + (w.btl - q.s) + ' bt. pour qu\'il soit commandé</div>';
    }

    return '<tr data-ref="' + w.ref + '" class="' + rowClass(w) + '">' +
      '<td class="ref">' + w.ref + '</td>' +
      '<td><div class="wine-name"><span class="dot ' + slugCouleur(w.couleur) + '"></span>' + esc(w.nom) + '</div>' +
      '<div class="wine-meta">' + esc(w.appellation) + ' · ' + esc(w.couleur) + ' · ' + esc(w.cl) +
      ' · ' + esc(w.mill === 'NM' ? 'sans millésime' : w.mill) + '</div>' + badge + '</td>' +
      '<td class="num">' + nf.format(unite) + '</td>' +
      '<td class="num"><span class="tag">' + w.btl + ' bt.</span><br><small>' + nf.format(w.btl * unite) + '</small></td>' +
      '<td><span class="stepper">' +
      '<button type="button" data-act="c-" aria-label="Retirer un carton">−</button>' +
      '<input type="number" min="0" max="999" step="1" value="' + q.c + '" data-act="c" aria-label="Cartons ' + esc(w.nom) + '">' +
      '<button type="button" data-act="c+" aria-label="Ajouter un carton">+</button>' +
      '</span></td>' +
      '<td><span class="stepper">' +
      '<button type="button" data-act="s-" aria-label="Retirer une bouteille">−</button>' +
      '<input type="number" min="0" max="' + (w.btl - 1) + '" step="1" value="' + q.s + '" data-act="s" aria-label="Bouteilles seules ' + esc(w.nom) + '">' +
      '<button type="button" data-act="s+" aria-label="Ajouter une bouteille">+</button>' +
      '</span>' + (q.s > 0 && attente > 0 ? '<div class="wine-meta att">en attente</div>' : '') +
      (conf > 0 ? '<div class="wine-meta ok">carton bouclé</div>' : '') + '</td>' +
      '<td class="num">' + (q.c * w.btl + conf || '—') +
      (attente > 0 ? ' <span class="att">(' + attente + ')</span>' : '') + '</td>' +
      '<td class="num"><b>' + (sub ? nf.format(sub) : '—') + '</b>' +
      (attente > 0 ? '<div class="wine-meta att">(' + nf.format(attente * unite) + ')</div>' : '') + '</td>' +
      '</tr>';
  }

  function refreshRow(ref) {
    var tr = document.querySelector('tr[data-ref="' + ref + '"]');
    if (!tr) return;
    var w = BY_REF[ref];
    var html = rowHtml(w);
    tr.className = rowClass(w);
    tr.innerHTML = html.replace(/^<tr[^>]*>/, '').replace(/<\/tr>$/, '');
  }

  function setQty(ref, c, s) {
    var w = BY_REF[ref];
    c = Math.max(0, Math.min(999, Math.floor(Number(c) || 0)));
    s = Math.max(0, Math.min(w.btl - 1, Math.floor(Number(s) || 0)));
    if (c === 0 && s === 0) delete state.lignes[ref];
    else state.lignes[ref] = { c: c, s: s };
    saveDraft();
    refreshRow(ref);
    renderTotaux();
  }

  function renderTotaux() {
    var t = totaux(lignes());
    $('t-cartons').textContent = t.cartons;
    $('t-bouteilles').textContent = t.bouteilles;
    $('t-refs').textContent = t.refs;
    $('t-total').textContent = chf(t.ttc);
    $('fig-attente').classList.toggle('hidden', t.attente === 0);
    $('t-attente').textContent = '(' + chf(t.ttcAttente) + ')';
    $('t-attente-n').textContent = t.attente;
    $('btn-to-3').disabled = t.refs === 0;
  }

  // Recupere l'etat des cartons ouverts. Photo a l'instant de l'appel : deux
  // personnes qui commandent en meme temps ne se voient pas mutuellement, d'ou
  // le bouton Actualiser et le rechargement en entrant a l'etape 2.
  function chargerEtat(afficherRetour) {
    var b = $('btn-refresh-etat');
    if (afficherRetour) { b.disabled = true; b.textContent = 'Actualisation…'; }
    return Store.etat(state.code).then(function (r) {
      if (r && r.ok) {
        state.etat = r.refs || {};
        renderCatalogue();
      }
    }).catch(function () { /* hors ligne : on garde l'etat precedent */ })
      .then(function () {
        if (afficherRetour) { b.disabled = false; b.textContent = 'Actualiser'; }
      });
  }

  /* ------------------------------ étape 3 -------------------------------- */
  function renderRecap() {
    var ls = lignes(), t = totaux(ls), i = state.identite;
    $('recap-id').innerHTML =
      '<dt>Nom</dt><dd>' + esc(i.prenom + ' ' + i.nom) + '</dd>' +
      '<dt>E-mail</dt><dd>' + esc(i.email) + '</dd>' +
      (i.tel ? '<dt>Téléphone</dt><dd>' + esc(i.tel) + '</dd>' : '');
    $('recap-table').innerHTML = tableLignes(ls, t);
    $('recap-note').innerHTML =
      '<b>À payer : ' + chf(t.ttc) + '</b> — TVA ' + pctTVA() + ' % incluse, prix arrondis au 5 ct supérieur.<br>' +
      (t.attente > 0 ?
        '<b>Entre parenthèses : ' + chf(t.ttcAttente) + ' — à ne pas payer.</b> Ces ' + t.attente +
        ' bouteille(s) sont dans un carton ouvert, pas encore complet. Si quelqu\'un du groupe le termine, ' +
        'vous recevrez un e-mail avec le complément à payer. Sinon elles ne seront pas commandées.<br>' : '') +
      'Commandes jusqu\'au ' + esc(CFG.deadline) + ' · <b>paiement avant le ' + esc(CFG.deadlinePaiement) + '</b>.<br>' +
      payLine(' · ');
  }

  function tableLignes(ls, t) {
    var h = '<thead><tr><th>Réf.</th><th>Vin</th><th class="num">Cartons</th>' +
      '<th class="num">Bouteilles</th><th class="num">Prix bt. TTC</th><th class="num">Total TTC</th></tr></thead><tbody>';
    ls.forEach(function (l) {
      h += '<tr><td class="ref">' + l.ref + '</td>' +
        '<td><div class="wine-name"><span class="dot ' + slugCouleur(l.couleur) + '"></span>' + esc(l.nom) + '</div>' +
        '<div class="wine-meta">' + esc(l.appellation) + ' · ' + esc(l.cl) + ' · ' + esc(l.mill) + ' · ' + esc(l.groupe) + '</div>' +
        (l.attente > 0 ? '<div class="wine-meta att">' + l.attente +
          ' bouteille(s) en attente — carton ouvert, non facturé</div>' : '') +
        (l.confirmees > 0 ? '<div class="wine-meta ok">' + l.confirmees +
          ' bouteille(s) hors carton, carton bouclé</div>' : '') + '</td>' +
        '<td class="num">' + (l.cartons ? l.cartons + ' × ' + l.btl : '—') + '</td>' +
        '<td class="num">' + l.bouteilles +
        (l.attente > 0 ? ' <span class="att">(' + l.attente + ')</span>' : '') + '</td>' +
        '<td class="num">' + nf.format(l.prix_ttc) + '</td>' +
        '<td class="num">' + nf.format(l.total_ttc) +
        (l.attente > 0 ? '<div class="wine-meta att">(' + nf.format(l.total_attente) + ')</div>' : '') +
        '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td colspan="2">À payer — ' + t.refs + ' référence(s)</td>' +
      '<td class="num">' + t.cartons + '</td><td class="num">' + t.bouteilles + '</td>' +
      '<td></td><td class="num">' + chf(t.ttc) + '</td></tr>' +
      (t.attente > 0 ? '<tr class="att"><td colspan="3">En attente — cartons ouverts, non facturé</td>' +
        '<td class="num">(' + t.attente + ')</td><td></td><td class="num">(' + chf(t.ttcAttente) + ')</td></tr>' : '') +
      '</tfoot>';
    return h;
  }

  function makeOrder() {
    var ls = lignes(), t = totaux(ls), i = state.identite;
    return {
      id: 'CMD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
      date: new Date().toISOString(),
      prenom: i.prenom, nom: i.nom, email: i.email, tel: i.tel,
      tva: TVA,
      total_cartons: t.cartons, total_bouteilles: t.bouteilles,
      total_seules: t.seules,
      total_ht: Math.round(t.ht * 100) / 100, total_ttc: Math.round(t.ttc * 100) / 100,
      total_attente: Math.round(t.ttcAttente * 100) / 100,
      lignes: ls.map(function (l) {
        return {
          ref: l.ref, nom: l.nom, appellation: l.appellation, couleur: l.couleur,
          cl: l.cl, mill: l.mill, emb: l.emb, btl: l.btl, groupe: l.groupe,
          cartons: l.cartons, seules: l.seules, bouteilles: l.cartons * l.btl,
          prix_ht: l.prix_ht,
          total_ht: Math.round(l.total_ht * 100) / 100,
          total_ttc: Math.round(l.total_ttc * 100) / 100
        };
      })
    };
  }

  function submit() {
    if (!identiteComplete()) {          // ceinture et bretelles avant l'envoi
      state.identiteOk = false;
      show(1);
      validIdentite();
      return;
    }
    var btn = $('btn-submit');
    btn.disabled = true; btn.textContent = 'Envoi…';
    $('submit-err').textContent = '';
    var order = makeOrder();
    Store.submit(order).then(function (res) {
      if (res && res.codeError) { erreurCode(res.error); return; }
      if (!res || !res.ok) throw new Error((res && res.error) || 'Réponse inattendue du serveur.');
      var t = totaux(lignes());
      // Le serveur est l'autorite sur ce qui est confirme ou en attente.
      var payer = typeof res.montant_a_payer === 'number' ? res.montant_a_payer : t.ttc;
      var attente = typeof res.montant_en_attente === 'number' ? res.montant_en_attente : t.ttcAttente;
      $('done-text').innerHTML = 'Merci ' + esc(state.identite.prenom) + '. Votre commande <b>' + esc(res.id || order.id) +
        '</b> est enregistrée : <b>' + t.cartons + ' carton(s)</b>' +
        (t.seules ? ' et ' + t.seules + ' bouteille(s) hors carton' : '') + ', <b>' + chf(payer) + '</b> TTC à payer' +
        (attente > 0 ? ' — <span class="att">(' + chf(attente) + ' en attente)</span>' : '') + '.' +
        (Store.remote() ? '' : '<br><small>Mode local : la commande est stockée dans ce navigateur uniquement.</small>');
      var ref = state.identite.prenom + ' ' + state.identite.nom + ' — ' + (res.id || order.id);
      var pay = '<b>Paiement</b> : ' + chf(payer) + ' à verser avant le <b>' + esc(CFG.deadlinePaiement) + '</b><br>' +
        (attente > 0 ? '<span class="att">' + chf(attente) + ' en attente : bouteilles dans un carton ouvert, ' +
          'à ne pas payer. Si le groupe le complète, un nouvel e-mail vous donnera le complément.</span><br>' : '');
      if (hasPayInfo()) {
        pay += 'Bénéficiaire : <b>' + esc(CFG.beneficiaire) + '</b><br>' +
               'IBAN : <b>' + esc(CFG.iban) + '</b><br>';
      }
      pay += 'Référence à indiquer : <b>' + esc(ref) + '</b><br>';
      if (res.duplicate) {
        // Le serveur a reconnu un ID deja enregistre : rien n'a ete duplique.
        pay += '<span class="muted">Cette commande était déjà enregistrée — rien n\'a été dupliqué, ' +
               'et l\'e-mail de confirmation est parti lors du premier enregistrement.</span>';
      } else {
        pay += res.mailSent
          ? 'Un e-mail récapitulatif avec les coordonnées bancaires vient d\'être envoyé à <b>' + esc(state.identite.email) + '</b>.'
          : (Store.remote()
              ? '<span class="muted">L\'e-mail de confirmation n\'a pas pu être envoyé — les coordonnées de paiement te seront transmises directement.</span>'
              : '<span class="muted">Mode local : aucun e-mail n\'est envoyé. En production, ce récapitulatif part par e-mail avec les coordonnées bancaires.</span>');
      }
      $('done-paiement').innerHTML = pay;
      $('done-table').innerHTML = tableLignes(lignes(), t);
      state.lignes = {}; saveDraft();
      chargerEtat();
      show('done');
    }).catch(function (err) {
      $('submit-err').textContent = 'Envoi impossible : ' + err.message +
        ' Votre sélection est conservée.';
    }).then(function () {
      btn.disabled = false; btn.textContent = 'Valider définitivement ma commande';
    });
  }

  /* ------------------------------- admin --------------------------------- */
  var adminData = [], adminTab = 'agg';

  function adminLogin() {
    var u = $('a-user').value.trim(), p = $('a-pass').value;
    $('a-err').textContent = '';
    var btn = $('btn-admin-login'); btn.disabled = true;
    Store.list(u, p).then(function (res) {
      if (!res || !res.ok) { $('a-err').textContent = (res && res.error) || 'Connexion refusée.'; return; }
      adminData = res.commandes || [];
      sessionStorage.setItem('noel2026.admin', JSON.stringify({ u: u, p: p }));
      $('admin-login').classList.add('hidden');
      $('admin-panel').classList.remove('hidden');
      renderAdmin();
    }).catch(function (e) {
      $('a-err').textContent = 'Erreur réseau : ' + e.message;
    }).then(function () { btn.disabled = false; });
  }

  function adminRefresh() {
    var s = JSON.parse(sessionStorage.getItem('noel2026.admin') || '{}');
    Store.list(s.u, s.p).then(function (res) {
      if (res && res.ok) { adminData = res.commandes || []; renderAdmin(); }
    });
  }

  // Les lignes relues du Google Sheet ne portent pas le domaine/region (colonne
  // absente de l'onglet Lignes) : on le recupere dans le catalogue via la
  // reference, sinon le formulaire agrege perd ses intertitres.
  function enrichir(l) {
    var w = BY_REF[l.ref] || {};
    return {
      ref: l.ref,
      nom: l.nom || w.nom,
      appellation: l.appellation || w.appellation,
      couleur: l.couleur || w.couleur,
      cl: l.cl || w.cl,
      mill: l.mill || w.mill,
      emb: l.emb || w.emb,
      btl: l.btl || w.btl,
      groupe: l.groupe || w.groupe || 'Autres',
      prix_ht: l.prix_ht,
      cartons: Number(l.cartons) || 0,
      bouteilles: Number(l.bouteilles) || 0,
      seules: Number(l.seules) || 0,
      confirmees: Number(l.confirmees) || 0
    };
  }

  function aggregate() {
    var map = {};
    adminData.forEach(function (o) {
      (o.lignes || []).map(enrichir).forEach(function (l) {
        var a = map[l.ref] || (map[l.ref] = {
          ref: l.ref, nom: l.nom, appellation: l.appellation, couleur: l.couleur,
          cl: l.cl, mill: l.mill, emb: l.emb, btl: l.btl, groupe: l.groupe,
          prix_ht: l.prix_ht, cartons: 0, bouteilles: 0, seules: 0, confirmees: 0,
          attente: 0, ht: 0, ttc: 0, par: []
        });
        var bt = l.bouteilles + l.confirmees;          // bouteilles reellement commandees
        a.cartons += l.cartons;
        a.bouteilles += bt;
        a.seules += l.seules;
        a.confirmees += l.confirmees;
        a.attente += l.seules - l.confirmees;
        a.ht += l.prix_ht * bt;
        a.ttc += ttc(l.prix_ht) * bt;
        a.par.push(o.prenom + ' ' + o.nom + ' (' + l.cartons +
          (l.seules ? ' + ' + l.seules + ' bt.' : '') + ')');
      });
    });
    var arr = Object.keys(map).map(function (k) { return map[k]; });
    var rang = function (g) { var i = GROUPES.indexOf(g); return i === -1 ? 999 : i; };
    arr.sort(function (a, b) {
      var g = rang(a.groupe) - rang(b.groupe);
      return g !== 0 ? g : String(a.nom).localeCompare(String(b.nom), 'fr');
    });
    return arr;
  }

  function renderAdmin() {
    var agg = aggregate();
    var tAtt = agg.reduce(function (s, a) { return s + a.attente; }, 0);
    var tc = agg.reduce(function (s, a) { return s + a.cartons; }, 0);
    var tb = agg.reduce(function (s, a) { return s + a.bouteilles; }, 0);
    var tht = agg.reduce(function (s, a) { return s + a.ht; }, 0);
    var tttc = agg.reduce(function (s, a) { return s + a.ttc; }, 0);

    $('admin-sub').innerHTML = adminData.length + ' commande(s) · ' + agg.length + ' référence(s) · ' +
      tc + ' carton(s) · ' + tb + ' bouteilles · <b>' + chf(tttc) + ' TTC</b>' +
      (tAtt ? ' · <span class="att">' + tAtt + ' bt. en attente, non commandées</span>' : '') +
      ' <span class="muted">(' + chf(tht) + ' HT)</span>' +
      (Store.remote() ? '' : ' · <span class="tag">mode local</span>');

    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
      b.classList.toggle('on', b.dataset.tab === adminTab);
    });

    if (!adminData.length) {
      $('admin-content').innerHTML = '<div class="empty">Aucune commande enregistrée pour l\'instant.</div>';
      return;
    }
    $('admin-content').innerHTML = adminTab === 'agg' ? htmlAgg(agg, tc, tb, tht, tttc) : htmlPeople();
  }

  function htmlAgg(agg, tc, tb, tht, tttc) {
    var h = '<div class="note" style="margin-bottom:12px">Formulaire à transmettre à ' + esc(CFG.contact) +
      ' — la colonne <b>Nbre de BTES</b> reprend la logique du formulaire Schenk. ' +
      'Schenk facture <b>HT</b> ; la colonne TTC sert à la refacturation interne.</div>' +
      '<div class="scroll-x"><table><thead><tr>' +
      '<th>Réf.</th><th>Vin</th><th class="num">Cartons</th><th class="num">Bt. hors carton</th>' +
      '<th class="num">Nbre de BTES</th>' +
      '<th class="num">Prix bt. HT</th><th class="num">Total HT</th><th class="num">Total TTC</th><th>Détail</th>' +
      '</tr></thead><tbody>';
    var current = null;
    agg.forEach(function (a) {
      if (a.groupe !== current) {
        current = a.groupe;
        h += '<tr><td colspan="9" style="background:var(--panel-2);font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:.75rem">' + esc(a.groupe) + '</td></tr>';
      }
      h += '<tr><td class="ref">' + a.ref + '</td>' +
        '<td><div class="wine-name"><span class="dot ' + slugCouleur(a.couleur) + '"></span>' + esc(a.nom) + '</div>' +
        '<div class="wine-meta">' + esc(a.appellation) + ' · ' + esc(a.cl) + ' · ' + esc(a.mill) + ' · ' + esc(a.emb) + '</div></td>' +
        '<td class="num">' + a.cartons + '</td>' +
        '<td class="num">' + (a.confirmees || '—') +
        (a.attente ? ' <span class="att">(' + a.attente + ' perdue(s))</span>' : '') + '</td>' +
        '<td class="num"><b>' + a.bouteilles + '</b></td>' +
        '<td class="num">' + nf.format(a.prix_ht) + '</td>' +
        '<td class="num">' + nf.format(a.ht) + '</td>' +
        '<td class="num">' + nf.format(a.ttc) + '</td>' +
        '<td class="wine-meta">' + esc(a.par.join(', ')) + '</td></tr>';
    });
    var perdues = agg.filter(function (a) { return a.attente > 0; });
    h += '</tbody><tfoot><tr><td colspan="2">Total commande groupée</td>' +
      '<td class="num">' + tc + '</td>' +
      '<td class="num">' + agg.reduce(function (n, a) { return n + a.confirmees; }, 0) + '</td>' +
      '<td class="num">' + tb + '</td><td></td>' +
      '<td class="num">' + chf(tht) + '</td><td class="num">' + chf(tttc) + '</td><td></td></tr></tfoot></table></div>';
    if (perdues.length) {
      h += '<div class="note warn" style="margin-top:12px"><b>Cartons ouverts non complétés — ' +
        'ces bouteilles ne sont PAS commandées et ne sont pas facturées :</b><ul style="margin:6px 0 0">' +
        perdues.map(function (a) {
          return '<li>' + esc(a.ref + ' — ' + a.nom) + ' : ' + a.attente + ' bt. sur ' + a.btl +
            ' · ' + esc(a.par.join(', ')) + '</li>';
        }).join('') + '</ul></div>';
    }
    return h;
  }

  function htmlPeople() {
    var h = '<div class="scroll-x"><table><thead><tr><th>Commande</th><th>Personne</th><th>Contact</th>' +
      '<th class="num">Cartons</th><th class="num">Bouteilles</th><th class="num">Total TTC</th>' +
      '<th class="num">En attente</th></tr></thead><tbody>';
    var ttcSum = 0, attSum = 0;
    adminData.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }).forEach(function (o) {
      var ls = (o.lignes || []).map(enrichir);
      var t = ls.reduce(function (s, l) { return s + ttc(l.prix_ht) * (l.bouteilles + l.confirmees); }, 0);
      var att = ls.reduce(function (s, l) { return s + ttc(l.prix_ht) * (l.seules - l.confirmees); }, 0);
      ttcSum += t; attSum += att;
      h += '<tr><td class="ref">' + esc(o.id) + '<div class="wine-meta">' +
        esc(new Date(o.date).toLocaleString('fr-CH')) + '</div></td>' +
        '<td class="wine-name">' + esc(o.prenom + ' ' + o.nom) + '</td>' +
        '<td class="wine-meta">' + esc(o.email) + (o.tel ? '<br>' + esc(o.tel) : '') + '</td>' +
        '<td class="num">' + o.total_cartons + '</td>' +
        '<td class="num">' + ls.reduce(function (n, l) { return n + l.bouteilles + l.confirmees; }, 0) + '</td>' +
        '<td class="num"><b>' + nf.format(t) + '</b></td>' +
        '<td class="num att">' + (att ? '(' + nf.format(att) + ')' : '—') + '</td></tr>';
      ls.forEach(function (l) {
        var enAttente = l.seules - l.confirmees;
        h += '<tr><td></td><td colspan="2" class="wine-meta">' + esc(l.ref + ' — ' + l.nom + ' (' + l.cl + ', ' + l.mill + ')') +
          (l.seules ? ' · ' + l.seules + ' bt. hors carton' +
            (enAttente ? ' dont ' + enAttente + ' en attente' : ' confirmée(s)') : '') + '</td>' +
          '<td class="num wine-meta">' + l.cartons + '</td>' +
          '<td class="num wine-meta">' + (l.bouteilles + l.confirmees) + '</td>' +
          '<td class="num wine-meta">' + nf.format(ttc(l.prix_ht) * (l.bouteilles + l.confirmees)) + '</td>' +
          '<td class="num wine-meta att">' + (enAttente ? '(' + nf.format(ttc(l.prix_ht) * enAttente) + ')' : '') + '</td></tr>';
      });
    });
    h += '</tbody><tfoot><tr><td colspan="5">Total ' + adminData.length + ' commande(s)</td>' +
      '<td class="num">' + chf(ttcSum) + '</td>' +
      '<td class="num att">' + (attSum ? '(' + chf(attSum) + ')' : '—') + '</td></tr></tfoot></table></div>';
    return h;
  }

  // Bouton de test : efface les commandes et le brouillon de CE navigateur.
  // Visible uniquement en mode local — en mode Google Sheet il n'y a rien à
  // effacer côté navigateur, et surtout rien à supprimer côté serveur d'ici.
  var resetArmed = 0;
  function resetLocal() {
    var btn = $('btn-reset'), msg = $('reset-msg');
    if (Date.now() - resetArmed > 6000) {          // 1er clic : on arme
      resetArmed = Date.now();
      btn.textContent = 'Confirmer la suppression ?';
      btn.classList.add('primary');
      msg.textContent = 'Efface les commandes et le brouillon de ce navigateur. Irréversible.';
      setTimeout(function () {
        if (Date.now() - resetArmed >= 6000) {
          btn.textContent = 'Vider les données locales';
          btn.classList.remove('primary');
          msg.textContent = '';
        }
      }, 6100);
      return;
    }
    resetArmed = 0;                                 // 2e clic : on efface
    var n = Store.localAll().length;
    try {
      localStorage.removeItem(LS_ORDERS);
      localStorage.removeItem(LS_DRAFT);
    } catch (e) { /* navigation privée */ }
    state.lignes = {};
    state.identite = { prenom: '', nom: '', email: '', tel: '' };
    fillIdentite();
    adminData = [];
    btn.textContent = 'Vider les données locales';
    btn.classList.remove('primary');
    renderAdmin();
    $('reset-msg').textContent = n + ' commande(s) et le brouillon ont été supprimés de ce navigateur.';
  }

  function csv(rows, name) {
    var body = rows.map(function (r) {
      return r.map(function (c) {
        var s = String(c == null ? '' : c);
        return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(';');
    }).join('\r\n');
    var blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function csvAgg() {
    var rows = [['Ref', 'Nbre de BTES', 'Cartons', 'Bt hors carton confirmees', 'Bt en attente non commandees',
      'Designation', 'Appellation', 'Couleur', 'cl', 'Emb', 'Mill', 'Prix bt HT', 'Total HT', 'Total TTC', 'Demandeurs']];
    aggregate().forEach(function (a) {
      rows.push([a.ref, a.bouteilles, a.cartons, a.confirmees, a.attente,
        a.nom, a.appellation, a.couleur, a.cl, a.emb, a.mill,
        a.prix_ht.toFixed(2), a.ht.toFixed(2), a.ttc.toFixed(2), a.par.join(' / ')]);
    });
    csv(rows, 'commande-groupee-noel-2026.csv');
  }

  function csvDet() {
    var rows = [['Commande', 'Date', 'Prenom', 'Nom', 'Email', 'Tel', 'Ref', 'Designation', 'cl', 'Mill',
      'Cartons', 'Bt hors carton', 'Bt confirmees', 'Bt en attente', 'Bouteilles facturees',
      'Prix bt HT', 'Total HT', 'Total TTC', 'TTC en attente']];
    adminData.forEach(function (o) {
      (o.lignes || []).map(enrichir).forEach(function (l) {
        var bt = l.bouteilles + l.confirmees;
        var att = l.seules - l.confirmees;
        rows.push([o.id, o.date, o.prenom, o.nom, o.email, o.tel || '', l.ref, l.nom, l.cl, l.mill,
          l.cartons, l.seules, l.confirmees, att, bt, l.prix_ht.toFixed(2),
          (l.prix_ht * bt).toFixed(2), (ttc(l.prix_ht) * bt).toFixed(2),
          (ttc(l.prix_ht) * att).toFixed(2)]);
      });
    });
    csv(rows, 'commandes-detail-noel-2026.csv');
  }

  /* ------------------------------ événements ----------------------------- */
  function bind() {
    // Le badge n'a d'utilite qu'en local (pour ne pas croire qu'on ecrit en base).
    $('mode-badge').classList.toggle('hidden', Store.remote());
    // Le champ n'apparait que si le code n'est pas deja dans l'URL (ni memorise).
    $('grp-code').classList.toggle('hidden', !Store.remote() || !!state.code);
    $('f-code').addEventListener('input', function () {
      state.code = this.value.trim();
      state.codeOk = null;                   // nouveau code : a revalider
      $('e-code').textContent = '';
      saveDraft();
    });
    $('h-deadline').textContent = CFG.deadline;
    $('h-paiement').innerHTML = 'Paiement avant le <b>' + esc(CFG.deadlinePaiement) + '</b> · ' + payLine(' · ');

    $('btn-to-2').addEventListener('click', function () {
      if (!validIdentite()) return;
      if (!Store.remote() || state.codeOk === true) { renderCatalogue(); show(2); chargerEtat(); return; }
      var b = this, texte = b.textContent;
      b.disabled = true; b.textContent = 'Vérification du code…';
      Store.check(state.code).then(function (r) {
        if (r && r.ok) { state.codeOk = true; renderCatalogue(); show(2); chargerEtat(); }
        else if (r && r.codeError) { erreurCode(r.error); }
        else { renderCatalogue(); show(2); }   // serveur muet : le submit tranchera
      }).catch(function () {
        renderCatalogue(); show(2);           // hors ligne : on n'enferme personne
      }).then(function () {
        b.disabled = false; b.textContent = texte;
      });
    });
    $('btn-back-1').addEventListener('click', function () { show(1); });
    $('btn-to-3').addEventListener('click', function () { renderRecap(); show(3); });
    $('btn-back-2').addEventListener('click', function () { renderCatalogue(); show(2); chargerEtat(); });
    $('btn-submit').addEventListener('click', submit);
    $('btn-print-done').addEventListener('click', function () { window.print(); });
    $('btn-new').addEventListener('click', function () {
      state.lignes = {};
      state.identite = { prenom: '', nom: '', email: '', tel: '' };
      state.identiteOk = false;
      saveDraft(); fillIdentite();
      $('e-prenom').textContent = ''; $('e-nom').textContent = ''; $('e-email').textContent = '';
      show(1);
    });

    ['f-prenom', 'f-nom', 'f-email', 'f-tel'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        readIdentite();
        state.identiteOk = identiteComplete();
      });
    });

    $('e-email').addEventListener('click', function (ev) {
      var a = ev.target.closest('a[data-fix]');
      if (!a) return;
      ev.preventDefault();
      $('f-email').value = a.dataset.fix;
      readIdentite();
      validIdentite();
    });

    $('f-search').addEventListener('input', function () { state.filtres.q = this.value; renderCatalogue(); });
    $('f-groupe').addEventListener('change', function () { state.filtres.groupe = this.value; renderCatalogue(); });
    $('f-couleur').addEventListener('change', function () { state.filtres.couleur = this.value; renderCatalogue(); });
    $('btn-only-picked').addEventListener('click', function () {
      state.filtres.onlyPicked = !state.filtres.onlyPicked;
      this.classList.toggle('primary', state.filtres.onlyPicked);
      this.textContent = state.filtres.onlyPicked ? 'Tout le catalogue' : 'Ma sélection';
      renderCatalogue();
    });

    // délégation sur le catalogue (clics + saisie directe)
    $('catalogue').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-act]');
      if (!b) return;
      var ref = b.closest('tr').dataset.ref;
      var q = qty(ref), w = BY_REF[ref];
      switch (b.dataset.act) {
        case 'c+': setQty(ref, q.c + 1, q.s); break;
        case 'c-': setQty(ref, q.c - 1, q.s); break;
        case 's+': setQty(ref, q.c, q.s + 1); break;
        case 's-': setQty(ref, q.c, q.s - 1); break;
        case 'fill':   // compléter le carton ouvert par le groupe
          setQty(ref, q.c, Math.min(w.btl - 1, w.btl - attenteGroupe(ref)));
          break;
      }
    });
    $('catalogue').addEventListener('change', function (ev) {
      var i = ev.target.closest('input[data-act]');
      if (!i) return;
      var ref = i.closest('tr').dataset.ref, q = qty(ref);
      if (i.dataset.act === 'c') setQty(ref, i.value, q.s);
      else setQty(ref, q.c, i.value);
    });

    $('btn-open-only').addEventListener('click', function () {
      state.filtres.onlyOpen = !state.filtres.onlyOpen;
      this.classList.toggle('primary', state.filtres.onlyOpen);
      renderCatalogue();
    });
    $('btn-refresh-etat').addEventListener('click', function () { chargerEtat(true); });

    // admin
    $('btn-admin').addEventListener('click', function () { show('admin'); });
    $('btn-admin-back').addEventListener('click', function () {
      show(state.identiteOk && Object.keys(state.lignes).length ? 2 : 1);
    });
    $('btn-admin-login').addEventListener('click', adminLogin);
    $('a-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') adminLogin(); });
    $('btn-admin-out').addEventListener('click', function () {
      sessionStorage.removeItem('noel2026.admin');
      adminData = [];
      $('admin-panel').classList.add('hidden');
      $('admin-login').classList.remove('hidden');
      $('a-pass').value = '';
      show(1);
    });
    $('btn-refresh').addEventListener('click', adminRefresh);
    $('btn-csv-agg').addEventListener('click', csvAgg);
    $('btn-csv-det').addEventListener('click', csvDet);
    $('btn-print-admin').addEventListener('click', function () { window.print(); });
    $('btn-reset').classList.toggle('hidden', Store.remote());
    $('btn-reset').addEventListener('click', resetLocal);
    document.querySelector('.tabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-tab]');
      if (b) { adminTab = b.dataset.tab; $('reset-msg').textContent = ''; renderAdmin(); }
    });
  }

  /* -------------------------------- init --------------------------------- */
  initFiltres();
  fillIdentite();
  // Le code arrive dans l'URL : on le memorise tout de suite, pour qu'un simple
  // rechargement (sans ?c=) ne le perde pas.
  if (CODE_URL) saveDraft();
  if (Store.remote() && state.code) {
    Store.check(state.code).then(function (r) {
      if (r && r.ok) state.codeOk = true;
      else if (r && r.codeError) erreurCode(r.error);
    }).catch(function () { /* hors ligne : on verifiera au clic */ });
  }
  state.identiteOk = identiteComplete();
  bind();
  renderCatalogue();
  show(1);

  // exposé pour les tests automatisés
  window.__app = { state: state, lignes: lignes, totaux: totaux, setQty: setQty, Store: Store, aggregate: aggregate };
})();
