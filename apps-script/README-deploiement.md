# Passage en production — Google Sheet privé + Apps Script

Objectif : la page web peut **écrire** les commandes, mais le Google Sheet reste
**privé** (aucun partage public, aucune clé d'API dans le dépôt GitHub).

## 1. Créer le classeur

1. Google Drive → **Nouveau > Google Sheets**, nommer par ex. `Noël 2026 — commandes`.
2. Ne le partager avec personne (ou uniquement avec les personnes de confiance,
   en lecture). Il n'a **jamais** besoin d'être public.
3. Noter son ID dans l'URL : `https://docs.google.com/spreadsheets/d/`**`<ID>`**`/edit`.

## 2. Créer le script

1. Dans le classeur : **Extensions > Apps Script**.
2. Remplacer le contenu de `Code.gs` par celui de ce dossier.
3. **Paramètres du projet** (roue crantée) → *Propriétés du script* → ajouter :

| Propriété | Valeur | Obligatoire |
|---|---|---|
| `SHEET_ID` | l'ID du classeur (ou omettre si le script est lié au classeur) | non |
| `ADMIN_USER` | `admin` (ou autre) | non (défaut `admin`) |
| `ADMIN_PASS` | le mot de passe admin, connu de toi seul | **oui** |
| `NOTIFY_EMAIL` | ton e-mail, pour recevoir chaque commande | non |

4. Lancer une fois la fonction `setup` (menu *Exécuter*) et accepter les
   autorisations. Les onglets `Commandes` et `Lignes` sont créés, et le journal
   confirme que `ADMIN_PASS` est bien défini.

## 3. Déployer le Web App

**Déployer > Nouveau déploiement > Application Web** :

- Description : `commandes noel 2026`
- **Exécuter en tant que : moi** (c'est ce qui permet d'écrire dans un Sheet privé)
- **Qui a accès : tout le monde** (l'URL seule ne donne aucun accès en lecture :
  lister les commandes exige le mot de passe admin, vérifié côté serveur)

Copier l'URL `https://script.google.com/macros/s/AKfycb…/exec`.

## 4. Brancher la page

Dans `assets/config.js` :

```js
endpoint: "https://script.google.com/macros/s/AKfycb…/exec",
```

Recharger la page : le badge en haut à droite passe de `local` à `Google Sheet`.
Le champ `adminPassLocal` de `config.js` n'est alors plus utilisé — c'est
`ADMIN_PASS` côté Apps Script qui fait foi.

## 5. Vérifier

1. Ouvrir l'URL du Web App dans un navigateur : elle doit répondre
   `{"ok":true,"service":"commande-vins-noel-2026"}`.
2. Passer une commande de test depuis la page → une ligne apparaît dans
   `Commandes` et les détails dans `Lignes`.
3. Espace **Admin** → se connecter avec `ADMIN_USER` / `ADMIN_PASS` → le
   formulaire agrégé se remplit.
4. Supprimer les lignes de test dans le Sheet.

## Notes

- **Après chaque modification de `Code.gs`**, refaire *Déployer > Gérer les
  déploiements > (crayon) > Nouvelle version*, sinon l'ancienne version continue
  de tourner.
- Le script ne renvoie jamais de données sans mot de passe ; en cas de fuite du
  mot de passe, il suffit de changer `ADMIN_PASS` dans les propriétés du script.
- `LockService` protège les écritures simultanées (deux personnes qui valident
  en même temps).
