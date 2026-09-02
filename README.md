# Commande groupée de vins — Noël 2026

Page web pour collecter les commandes de vin d'une dizaine de personnes sur la
liste de Noël Schenk / Obrist, puis les agréger en un seul formulaire à
transmettre à `vente@schenk-wine.ch`.

## Ce que fait la page

1. **Coordonnées** — prénom, nom, e-mail **obligatoires** (téléphone
   optionnel). Sans eux, pas d'accès au catalogue ni au récapitulatif, et le
   contrôle est refait côté serveur : une requête forgée sans coordonnées
   valides est rejetée par l'Apps Script.

   L'e-mail est vérifié sérieusement, puisque c'est le seul moyen de joindre la
   personne : syntaxe stricte (un seul `@`, domaine réel avec extension de 2 à
   24 lettres, pas de point en début/fin ni de double point), nettoyage
   automatique (espaces, `mailto:`, domaine en minuscules), refus des adresses
   de test et jetables (`example.com`, `test.com`, `yopmail`, `mailinator`…) et
   détection des fautes de frappe courantes — `ludi@gmial.com` propose
   `ludi@gmail.com` en un clic. Les mêmes règles sont appliquées côté serveur.
2. **Choix des vins** — les 144 références du PDF, groupées par domaine/région,
   avec recherche, filtres couleur et domaine. Les quantités se choisissent
   **uniquement par carton entier** (6, 12, 24 ou 3 bouteilles selon la
   référence, colonne `Emb.` du PDF). Total live en bas d'écran.
3. **Récapitulatif** puis validation : la commande est stockée avec le détail
   ligne par ligne.
4. **E-mail de confirmation** (en production) : le participant reçoit
   automatiquement le récapitulatif de sa commande avec le montant, le
   bénéficiaire, l'IBAN, l'échéance et la référence à indiquer au virement.
   L'organisateur en reçoit une copie s'il a renseigné `NOTIFY_EMAIL`.
5. **Espace admin** (utilisateur + mot de passe) : toutes les commandes
   individuelles, le **formulaire agrégé** par référence (cartons, nombre de
   bouteilles, totaux), export CSV et impression/PDF.

Les prix affichés aux participants sont **TTC**, TVA 8.1 % incluse — le PDF
Schenk est en HT (« TVA non comprise »). L'espace admin affiche les deux, car
Schenk facture en HT.

**Arrondi** : le prix bouteille TTC est arrondi au **5 centimes supérieur**
(usage suisse). Tous les autres montants en découlent — sous-totaux, totaux par
personne et total groupé sont donc eux aussi des multiples de 0.05, et les
additions sont vérifiables à la main. Les colonnes HT restent exactes.

## Coordonnées de paiement

Elles ne sont **pas** dans ce dépôt. Le bénéficiaire et l'IBAN vivent dans les
*Script Properties* de l'Apps Script (`PAY_BENEFICIAIRE`, `PAY_IBAN`) et ne
partent que dans l'e-mail de confirmation envoyé au participant. La page se
contente d'annoncer l'échéance (`deadlinePaiement` dans `assets/config.js`) et
que les coordonnées arrivent par e-mail.

Pour un test en local, on peut remplir `beneficiaire` et `iban` dans
`assets/config.js` : elles s'affichent alors aussi dans la page — à ne pas
commiter avec de vraies valeurs.

## Version locale (aucune installation)

Ouvrir `index.html` dans un navigateur (double-clic suffit).

- Les commandes sont stockées dans le `localStorage` du navigateur.
- Admin : `admin` / `noel2026` (défini dans `assets/config.js`).
- Une sélection en cours est conservée si on ferme l'onglet.
- Bouton **Vider les données locales** dans l'espace admin (deux clics pour
  confirmer) : efface les commandes de test et le brouillon de ce navigateur.
  Il n'apparaît qu'en mode local.

Pour tester à plusieurs sur le réseau local :

```bash
python3 -m http.server 8000
# puis http://localhost:8000
```

⚠️ En mode local, chaque navigateur ne voit que ses propres commandes : c'est
une version de test de l'interface et des calculs, pas un stockage partagé.

## Version partagée (Google Sheet privé)

Voir [`apps-script/README-deploiement.md`](apps-script/README-deploiement.md).
En résumé : un Web App Apps Script tourne sous ton compte et écrit dans un Sheet
qui reste privé ; la page ne fait qu'y poster. Le mot de passe admin vit dans
les *Script Properties*, jamais dans ce dépôt. Il suffit ensuite de renseigner
`endpoint` dans `assets/config.js`.

Hébergement de la page : GitHub Pages (dépôt public sans secret) ou n'importe
quel hébergeur statique.

## Structure

```
index.html                     interface (3 étapes + admin)
assets/config.js               TVA, endpoint, identifiants locaux  ← à éditer
assets/catalogue.js            144 références extraites du PDF
assets/app.js                  logique : totaux, stockage, agrégation
assets/styles.css              styles (clair/sombre, impression)
apps-script/Code.gs            backend Google Sheet
apps-script/README-deploiement.md  procédure de mise en production
```

## Rappels de la liste Schenk

- Commandes jusqu'au **30.09.2026** (l'app annonce le **25.09.2026** aux
  participants, pour laisser le temps d'agréger et de transmettre).
- Enlèvement du **12.10 au 13.11.2026**, sur préavis de min. 72 h au 021 822 02 45.
- Sites : Rolle, Vevey, Waltenschwil, Chamoson, Sion, Penthalaz.
- Paiement à 30 jours nets après enlèvement, au plus tard le 18.12.2026.
- Sous réserve de disponibilité des stocks.
