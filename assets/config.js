// ---------------------------------------------------------------------------
// Configuration — le seul fichier à modifier pour passer du local à la prod.
// ---------------------------------------------------------------------------
window.CONFIG = {

  // Laisser vide ("") = MODE LOCAL : tout est stocké dans le navigateur
  // (localStorage), aucun réseau. Idéal pour tester.
  //
  // En production : coller ici l'URL du Web App Google Apps Script
  // (voir apps-script/README-deploiement.md), du type
  // "https://script.google.com/macros/s/AKfycb..../exec"
  endpoint: "",

  // TVA suisse appliquée aux prix HT du PDF Schenk (« TVA non comprise »).
  tva: 0.081,

  // Identifiant admin. En MODE LOCAL le mot de passe ci-dessous est vérifié
  // dans le navigateur (donc lisible dans le code : c'est juste un garde-fou
  // pour la démo). En production, le mot de passe réel est stocké côté
  // Apps Script (Script Properties) et n'apparaît jamais dans ce dépôt.
  adminUser: "admin",
  adminPassLocal: "noel2026",

  // Informations affichées dans l'app.
  deadline: "30.09.2026",
  enlevement: "du 12.10 au 13.11.2026, sur préavis de min. 72 h au 021 822 02 45",
  contact: "vente@schenk-wine.ch"
};
