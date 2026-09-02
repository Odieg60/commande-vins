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
  function norm(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /* ------------------------------- état ---------------------------------- */
  var state = {
    identite: { prenom: '', nom: '', email: '', tel: '' },
    lignes: {},            // { ref: nbCartons }
    filtres: { q: '', groupe: '', couleur: '', onlyPicked: false },
    step: 1
  };

  try {
    var raw = localStorage.getItem(LS_DRAFT);
    if (raw) {
      var d = JSON.parse(raw);
      if (d && d.identite) state.identite = d.identite;
      if (d && d.lignes) state.lignes = d.lignes;
    }
  } catch (e) { /* brouillon illisible : on ignore */ }

  function saveDraft() {
    try {
      localStorage.setItem(LS_DRAFT, JSON.stringify({ identite: state.identite, lignes: state.lignes }));
    } catch (e) { /* quota / navigation privée : sans conséquence */ }
  }

  /* ------------------------------ totaux --------------------------------- */
  function lignes() {
    var out = [];
    Object.keys(state.lignes).forEach(function (ref) {
      var c = state.lignes[ref];
      var w = BY_REF[ref];
      if (!w || !c || c <= 0) return;
      var bouteilles = c * w.btl;
      var totalHT = w.prix_ht * bouteilles;
      out.push({
        ref: ref, nom: w.nom, appellation: w.appellation, couleur: w.couleur,
        cl: w.cl, mill: w.mill, emb: w.emb, btl: w.btl, groupe: w.groupe,
        prix_ht: w.prix_ht, prix_ttc: ttc(w.prix_ht),
        cartons: c, bouteilles: bouteilles,
        total_ht: totalHT, total_ttc: ttc(w.prix_ht) * bouteilles
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
      t.ht += l.total_ht; t.ttc += l.total_ttc; t.refs += 1;
      return t;
    }, { cartons: 0, bouteilles: 0, ht: 0, ttc: 0, refs: 0 });
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
        return Promise.resolve({ ok: true, id: order.id, mode: 'local' });
      }
      return this.post({ action: 'submit', commande: order });
    },

    list: function (user, pass) {
      if (!this.remote()) {
        if (user !== CFG.adminUser || pass !== CFG.adminPassLocal) {
          return Promise.resolve({ ok: false, error: 'Identifiants incorrects.' });
        }
        return Promise.resolve({ ok: true, commandes: Store.localAll(), mode: 'local' });
      }
      return this.post({ action: 'list', user: user, pass: pass });
    },

    localAll: function () {
      try { return JSON.parse(localStorage.getItem(LS_ORDERS) || '[]'); } catch (e) { return []; }
    }
  };

  /* ---------------------------- navigation ------------------------------- */
  function show(step) {
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(i.email)) { $('e-email').textContent = 'E-mail invalide.'; ok = false; }
    return ok;
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
      if (f.onlyPicked && !(state.lignes[w.ref] > 0)) return false;
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
          '<th class="num">Carton</th><th>Cartons</th><th class="num">Bouteilles</th><th class="num">Sous-total TTC</th>' +
          '</tr></thead><tbody>';
      }
      html += rowHtml(w);
    });
    html += '</tbody></table></div>';
    host.innerHTML = html;
    renderTotaux();
  }

  function rowHtml(w) {
    var c = state.lignes[w.ref] || 0;
    var sub = c * w.btl * ttc(w.prix_ht);
    return '<tr data-ref="' + w.ref + '"' + (c > 0 ? ' class="picked"' : '') + '>' +
      '<td class="ref">' + w.ref + '</td>' +
      '<td><div class="wine-name"><span class="dot ' + slugCouleur(w.couleur) + '"></span>' + esc(w.nom) + '</div>' +
      '<div class="wine-meta">' + esc(w.appellation) + ' · ' + esc(w.couleur) + ' · ' + esc(w.cl) +
      ' · ' + esc(w.mill === 'NM' ? 'sans millésime' : w.mill) + '</div></td>' +
      '<td class="num">' + nf.format(ttc(w.prix_ht)) + '</td>' +
      '<td class="num"><span class="tag">' + w.btl + ' bt.</span><br><small>' + nf.format(w.btl * ttc(w.prix_ht)) + '</small></td>' +
      '<td><span class="stepper">' +
      '<button type="button" data-act="minus" aria-label="Retirer un carton">−</button>' +
      '<input type="number" min="0" max="999" step="1" value="' + c + '" data-act="input" aria-label="Cartons ' + esc(w.nom) + '">' +
      '<button type="button" data-act="plus" aria-label="Ajouter un carton">+</button>' +
      '</span></td>' +
      '<td class="num">' + (c ? c * w.btl : '—') + '</td>' +
      '<td class="num"><b>' + (c ? nf.format(sub) : '—') + '</b></td>' +
      '</tr>';
  }

  function refreshRow(ref) {
    var tr = document.querySelector('tr[data-ref="' + ref + '"]');
    if (!tr) return;
    var w = BY_REF[ref], c = state.lignes[ref] || 0;
    tr.classList.toggle('picked', c > 0);
    tr.querySelector('[data-act="input"]').value = c;
    var tds = tr.querySelectorAll('td');
    tds[5].textContent = c ? c * w.btl : '—';
    tds[6].innerHTML = '<b>' + (c ? nf.format(c * w.btl * ttc(w.prix_ht)) : '—') + '</b>';
  }

  function setQty(ref, n) {
    n = Math.max(0, Math.min(999, Math.floor(Number(n) || 0)));
    if (n === 0) delete state.lignes[ref]; else state.lignes[ref] = n;
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
    $('btn-to-3').disabled = t.cartons === 0;
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
      'Total <b>TTC</b> (TVA ' + pctTVA() + ' % incluse, prix arrondis au 5 ct supérieur) : <b>' + chf(t.ttc) + '</b>.<br>' +
      'Commandes jusqu\'au ' + esc(CFG.deadline) + ' · enlèvement ' + esc(CFG.enlevement) + '.<br>' +
      'Paiement à 30 jours nets après enlèvement, au plus tard le 18.12.2026.';
  }

  function tableLignes(ls, t) {
    var h = '<thead><tr><th>Réf.</th><th>Vin</th><th class="num">Cartons</th>' +
      '<th class="num">Bouteilles</th><th class="num">Prix bt. TTC</th><th class="num">Total TTC</th></tr></thead><tbody>';
    ls.forEach(function (l) {
      h += '<tr><td class="ref">' + l.ref + '</td>' +
        '<td><div class="wine-name"><span class="dot ' + slugCouleur(l.couleur) + '"></span>' + esc(l.nom) + '</div>' +
        '<div class="wine-meta">' + esc(l.appellation) + ' · ' + esc(l.cl) + ' · ' + esc(l.mill) + ' · ' + esc(l.groupe) + '</div></td>' +
        '<td class="num">' + l.cartons + ' × ' + l.btl + '</td>' +
        '<td class="num">' + l.bouteilles + '</td>' +
        '<td class="num">' + nf.format(l.prix_ttc) + '</td>' +
        '<td class="num">' + nf.format(l.total_ttc) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td colspan="2">Total — ' + t.refs + ' référence(s)</td>' +
      '<td class="num">' + t.cartons + '</td><td class="num">' + t.bouteilles + '</td>' +
      '<td></td><td class="num">' + chf(t.ttc) + '</td></tr></tfoot>';
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
      total_ht: Math.round(t.ht * 100) / 100, total_ttc: Math.round(t.ttc * 100) / 100,
      lignes: ls.map(function (l) {
        return {
          ref: l.ref, nom: l.nom, appellation: l.appellation, couleur: l.couleur,
          cl: l.cl, mill: l.mill, emb: l.emb, btl: l.btl, groupe: l.groupe,
          cartons: l.cartons, bouteilles: l.bouteilles,
          prix_ht: l.prix_ht,
          total_ht: Math.round(l.total_ht * 100) / 100,
          total_ttc: Math.round(l.total_ttc * 100) / 100
        };
      })
    };
  }

  function submit() {
    var btn = $('btn-submit');
    btn.disabled = true; btn.textContent = 'Envoi…';
    var order = makeOrder();
    Store.submit(order).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Réponse inattendue du serveur.');
      var t = totaux(lignes());
      $('done-text').innerHTML = 'Merci ' + esc(state.identite.prenom) + '. Votre commande <b>' + esc(res.id || order.id) +
        '</b> est enregistrée : <b>' + t.cartons + ' carton(s)</b>, ' + t.bouteilles + ' bouteilles, <b>' + chf(t.ttc) + '</b> TTC.' +
        (Store.remote() ? '' : '<br><small>Mode local : la commande est stockée dans ce navigateur uniquement.</small>');
      $('done-table').innerHTML = tableLignes(lignes(), t);
      state.lignes = {}; saveDraft();
      show('done');
    }).catch(function (err) {
      alert('Envoi impossible : ' + err.message + '\nVotre sélection est conservée, réessayez.');
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

  function aggregate() {
    var map = {};
    adminData.forEach(function (o) {
      (o.lignes || []).forEach(function (l) {
        var a = map[l.ref] || (map[l.ref] = {
          ref: l.ref, nom: l.nom, appellation: l.appellation, couleur: l.couleur,
          cl: l.cl, mill: l.mill, emb: l.emb, btl: l.btl, groupe: l.groupe,
          prix_ht: l.prix_ht, cartons: 0, bouteilles: 0, ht: 0, ttc: 0, par: []
        });
        a.cartons += l.cartons;
        a.bouteilles += l.bouteilles;
        a.ht += l.prix_ht * l.bouteilles;
        a.ttc += ttc(l.prix_ht) * l.bouteilles;
        a.par.push(o.prenom + ' ' + o.nom + ' (' + l.cartons + ')');
      });
    });
    var arr = Object.keys(map).map(function (k) { return map[k]; });
    arr.sort(function (a, b) {
      var g = GROUPES.indexOf(a.groupe) - GROUPES.indexOf(b.groupe);
      return g !== 0 ? g : a.nom.localeCompare(b.nom, 'fr');
    });
    return arr;
  }

  function renderAdmin() {
    var agg = aggregate();
    var tc = agg.reduce(function (s, a) { return s + a.cartons; }, 0);
    var tb = agg.reduce(function (s, a) { return s + a.bouteilles; }, 0);
    var tht = agg.reduce(function (s, a) { return s + a.ht; }, 0);
    var tttc = agg.reduce(function (s, a) { return s + a.ttc; }, 0);

    $('admin-sub').innerHTML = adminData.length + ' commande(s) · ' + agg.length + ' référence(s) · ' +
      tc + ' carton(s) · ' + tb + ' bouteilles · <b>' + chf(tttc) + ' TTC</b>' +
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
      '<th>Réf.</th><th>Vin</th><th class="num">Cartons</th><th class="num">Nbre de BTES</th>' +
      '<th class="num">Prix bt. HT</th><th class="num">Total HT</th><th class="num">Total TTC</th><th>Détail</th>' +
      '</tr></thead><tbody>';
    var current = null;
    agg.forEach(function (a) {
      if (a.groupe !== current) {
        current = a.groupe;
        h += '<tr><td colspan="8" style="background:var(--panel-2);font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:.75rem">' + esc(a.groupe) + '</td></tr>';
      }
      h += '<tr><td class="ref">' + a.ref + '</td>' +
        '<td><div class="wine-name"><span class="dot ' + slugCouleur(a.couleur) + '"></span>' + esc(a.nom) + '</div>' +
        '<div class="wine-meta">' + esc(a.appellation) + ' · ' + esc(a.cl) + ' · ' + esc(a.mill) + ' · ' + esc(a.emb) + '</div></td>' +
        '<td class="num">' + a.cartons + '</td><td class="num"><b>' + a.bouteilles + '</b></td>' +
        '<td class="num">' + nf.format(a.prix_ht) + '</td>' +
        '<td class="num">' + nf.format(a.ht) + '</td>' +
        '<td class="num">' + nf.format(a.ttc) + '</td>' +
        '<td class="wine-meta">' + esc(a.par.join(', ')) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td colspan="2">Total commande groupée</td>' +
      '<td class="num">' + tc + '</td><td class="num">' + tb + '</td><td></td>' +
      '<td class="num">' + chf(tht) + '</td><td class="num">' + chf(tttc) + '</td><td></td></tr></tfoot></table></div>';
    return h;
  }

  function htmlPeople() {
    var h = '<div class="scroll-x"><table><thead><tr><th>Commande</th><th>Personne</th><th>Contact</th>' +
      '<th class="num">Cartons</th><th class="num">Bouteilles</th><th class="num">Total TTC</th></tr></thead><tbody>';
    var ttcSum = 0;
    adminData.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); }).forEach(function (o) {
      var t = (o.lignes || []).reduce(function (s, l) { return s + ttc(l.prix_ht) * l.bouteilles; }, 0);
      ttcSum += t;
      h += '<tr><td class="ref">' + esc(o.id) + '<div class="wine-meta">' +
        esc(new Date(o.date).toLocaleString('fr-CH')) + '</div></td>' +
        '<td class="wine-name">' + esc(o.prenom + ' ' + o.nom) + '</td>' +
        '<td class="wine-meta">' + esc(o.email) + (o.tel ? '<br>' + esc(o.tel) : '') + '</td>' +
        '<td class="num">' + o.total_cartons + '</td><td class="num">' + o.total_bouteilles + '</td>' +
        '<td class="num"><b>' + nf.format(t) + '</b></td></tr>';
      (o.lignes || []).forEach(function (l) {
        h += '<tr><td></td><td colspan="2" class="wine-meta">' + esc(l.ref + ' — ' + l.nom + ' (' + l.cl + ', ' + l.mill + ')') + '</td>' +
          '<td class="num wine-meta">' + l.cartons + '</td><td class="num wine-meta">' + l.bouteilles + '</td>' +
          '<td class="num wine-meta">' + nf.format(ttc(l.prix_ht) * l.bouteilles) + '</td></tr>';
      });
    });
    h += '</tbody><tfoot><tr><td colspan="5">Total ' + adminData.length + ' commande(s)</td>' +
      '<td class="num">' + chf(ttcSum) + '</td></tr></tfoot></table></div>';
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
    var rows = [['Ref', 'Nbre de BTES', 'Cartons', 'Designation', 'Appellation', 'Couleur', 'cl', 'Emb', 'Mill', 'Prix bt HT', 'Total HT', 'Total TTC', 'Demandeurs']];
    aggregate().forEach(function (a) {
      rows.push([a.ref, a.bouteilles, a.cartons, a.nom, a.appellation, a.couleur, a.cl, a.emb, a.mill,
        a.prix_ht.toFixed(2), a.ht.toFixed(2), a.ttc.toFixed(2), a.par.join(' / ')]);
    });
    csv(rows, 'commande-groupee-noel-2026.csv');
  }

  function csvDet() {
    var rows = [['Commande', 'Date', 'Prenom', 'Nom', 'Email', 'Tel', 'Ref', 'Designation', 'cl', 'Mill', 'Cartons', 'Bouteilles', 'Prix bt HT', 'Total HT', 'Total TTC']];
    adminData.forEach(function (o) {
      (o.lignes || []).forEach(function (l) {
        rows.push([o.id, o.date, o.prenom, o.nom, o.email, o.tel || '', l.ref, l.nom, l.cl, l.mill,
          l.cartons, l.bouteilles, l.prix_ht.toFixed(2),
          (l.prix_ht * l.bouteilles).toFixed(2), (ttc(l.prix_ht) * l.bouteilles).toFixed(2)]);
      });
    });
    csv(rows, 'commandes-detail-noel-2026.csv');
  }

  /* ------------------------------ événements ----------------------------- */
  function bind() {
    $('mode-badge').textContent = Store.remote() ? 'Google Sheet' : 'local';

    $('btn-to-2').addEventListener('click', function () {
      if (validIdentite()) { renderCatalogue(); show(2); }
    });
    $('btn-back-1').addEventListener('click', function () { show(1); });
    $('btn-to-3').addEventListener('click', function () { renderRecap(); show(3); });
    $('btn-back-2').addEventListener('click', function () { renderCatalogue(); show(2); });
    $('btn-submit').addEventListener('click', submit);
    $('btn-print-done').addEventListener('click', function () { window.print(); });
    $('btn-new').addEventListener('click', function () {
      state.lignes = {}; saveDraft(); fillIdentite(); show(1);
    });

    ['f-prenom', 'f-nom', 'f-email', 'f-tel'].forEach(function (id) {
      $(id).addEventListener('input', readIdentite);
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
      setQty(ref, (state.lignes[ref] || 0) + (b.dataset.act === 'plus' ? 1 : -1));
    });
    $('catalogue').addEventListener('change', function (ev) {
      var i = ev.target.closest('input[data-act="input"]');
      if (i) setQty(i.closest('tr').dataset.ref, i.value);
    });

    // admin
    $('btn-admin').addEventListener('click', function () { show('admin'); });
    $('btn-admin-back').addEventListener('click', function () { show(state.lignes && Object.keys(state.lignes).length ? 2 : 1); });
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
  bind();
  renderCatalogue();
  show(1);

  // exposé pour les tests automatisés
  window.__app = { state: state, lignes: lignes, totaux: totaux, setQty: setQty, Store: Store, aggregate: aggregate };
})();
