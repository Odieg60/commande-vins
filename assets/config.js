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
  // Délai INTERNE donné aux participants : il doit rester avant celui de Schenk
  // (30.09.2026), le temps d'agréger et de transmettre la commande groupée.
  deadline: "25.09.2026",

  // Échéance de paiement, affichée dans la page.
  deadlinePaiement: "30.09.2026",

  // Bénéficiaire et IBAN. LAISSER VIDE en production : le dépôt est public, et
  // les vraies coordonnées vivent dans les Script Properties de l'Apps Script
  // (PAY_BENEFICIAIRE / PAY_IBAN), qui les envoie dans l'e-mail de confirmation.
  // Si on les remplit ici, elles s'affichent aussi dans la page — pratique pour
  // tester en local, à ne pas commiter avec de vraies valeurs.
  beneficiaire: "",
  iban: "",

  enlevement: "du 12.10 au 13.11.2026, sur préavis de min. 72 h au 021 822 02 45",
  contact: "vente@schenk-wine.ch"
};
