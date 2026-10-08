# Backend Goying

Backend FastAPI connecté à Firebase Firestore pour gérer la connexion des gestionnaires et ouvrir chaque dashboard selon son rôle.

## Installation

```bash
pip install -r requirements.txt
```

Place la clé Firebase Admin SDK à la racine sous le nom `firebase-key.json`, ou configure le chemin avec la variable d'environnement `FIREBASE_CREDENTIALS`.

Configure aussi une clé secrète JWT avant de lancer le serveur :

```powershell
$env:JWT_SECRET_KEY="une-cle-longue-et-secrete"
```

Pour la connexion Firebase de l'interface d'administration globale, configure
les paramètres de l'application Web Firebase (la clé API Web n'est pas une clé
de service) :

```powershell
$env:FIREBASE_WEB_API_KEY="..."
$env:FIREBASE_WEB_AUTH_DOMAIN="votre-projet.firebaseapp.com"
$env:FIREBASE_WEB_PROJECT_ID="votre-projet"
$env:FIREBASE_WEB_APP_ID="..."
```

Active le fournisseur Email/Mot de passe dans Firebase Authentication. L'accès
à `/admin/users` exige une session Firebase vérifiée et un profil Firestore
actif avec `isAdmin: true`; le JWT des gestionnaires ne donne pas cet accès.
La page utilise une session serveur HttpOnly de huit heures et les endpoints
d'administration conservent leur contrôle Firebase côté API.

## Lancement

```bash
uvicorn main:app --reload
```

Sous Windows, tu peux aussi lancer :

```powershell
py -m uvicorn main:app --reload
```
git add .
git commit -m "Décris ta modification"
git push

Page d'accueil :
```text
http://127.0.0.1:8000/
```

Documentation interactive :

```text
http://127.0.0.1:8000/docs
```

## Fonctionnement de connexion

1. L'utilisateur ouvre la page d'accueil.
2. Il choisit un espace : Maisons, Prestataires ou Voitures.
3. Une fenêtre de connexion s'affiche.
4. Le frontend envoie `nom` et `mot_de_passe` à `POST /login`.
5. Le backend vérifie le compte dans Firebase.
6. Si le compte est actif et le mot de passe correct, l'API renvoie un JWT et le dashboard autorisé.
7. Le frontend appelle le dashboard avec l'en-tête `Authorization: Bearer ACCESS_TOKEN`.

Exemple :

```json
{
  "nom": "admin_maisons",
  "mot_de_passe": "Goying"
}
```

Réponse réussie :

```json
{
  "message": "Connexion réussie",
  "nom": "admin_maisons",
  "role": "maisons",
  "redirect": "/dashboard/maisons",
  "access_token": "...",
  "token_type": "bearer"
}
```

## Collections Firestore

Collection `gestionnaires` :

```text
gestionnaires
└── admin_maisons
    ├── nom: admin_maisons
    ├── mot_de_passe: HASH_BCRYPT
    ├── role: maisons
    └── statut: actif
```

Le backend accepte aussi une recherche par champ `nom`, mais le document ID comme `admin_maisons` est recommandé.

Collection `prestataires` :

```json
{
  "nom": "Sarah",
  "categorie": "coiffeuse",
  "telephone": "...",
  "photo": "AWS_URL",
  "statut": "en_attente",
  "date_creation": "..."
}
```

### Profils des comptes Firebase

Les utilisateurs déjà authentifiés par Firebase peuvent être associés à un profil
Firestore `users/{uid}`. La dépendance backend `require_user_profile` crée ce
profil lors de sa première utilisation si nécessaire, à partir de l'UID du token
Firebase vérifié. Le rôle initial est `null` : aucun privilège n'est accordé
automatiquement.

Le profil contient `uid`, `email`, `displayName`, `photoURL`, `role`, `statut`,
`actif`, `bloque`, `createdAt` et `updatedAt`; `telephone` est ajouté seulement
s'il est fourni lors d'une mise à jour autorisée. `lastLoginAt` n'est pas écrit
par les requêtes API. Aucun mot de passe n'est enregistré. Firebase
Authentication reste la source canonique de l'identité et de l'email; les claims
d'email et de nom sont seulement copiés à la création du profil et ne sont pas
resynchronisés à chaque requête.

Les profils bloqués ou désactivés sont refusés par `require_user_profile`, qui
est appliqué aux routes Firebase du portail prestataire et à la création d'avis.
`update_current_user_profile` n'autorise que les champs `displayName`,
`telephone` et `photoURL`; les rôles et statuts administratifs sont exclus.
La connexion JWT bcrypt des gestionnaires dans `gestionnaires` reste inchangée.

### Administration globale des profils Firebase

Les routes `/api/admin/users` sont réservées à un profil Firebase actif portant
`isAdmin: true`. Les rôles métier (`maisons`, `prestataires`, `voitures`) ne
donnent jamais cette permission. Le client ne peut pas modifier `isAdmin` via
la mise à jour de son propre profil.

Pour le premier administrateur, exécuter une seule fois depuis un environnement
opérateur disposant des identifiants Firebase Admin :

```powershell
py -m scripts.bootstrap_admin <UID_FIREBASE> --confirm I_CONFIRM_FIRST_ADMIN
```

La commande valide que le compte Firebase existe et est actif, refuse le
bootstrap si un administrateur ou le verrou de bootstrap existe déjà, puis
crée/actualise le profil, le compteur transactionnel et l'entrée
`adminActions`. Elle ne peut pas être appelée par une route HTTP. La collection
`systemConfig` contient le document `userAdministration` avec le nombre
d'administrateurs globaux actifs; ne pas modifier ce compteur manuellement.

Routes disponibles :

- `GET /api/admin/users` : liste paginée (1–100 éléments) avec `cursor`, filtres
  `role`, `statut`, `actif`, `bloque` et `isAdmin`; la réponse contient
  `users`, `nextCursor` et `hasMore`.
- Recherche exacte sans scan : `?search=<UID>&searchBy=uid` (défaut) ou
  `?search=<email>&searchBy=email`.
- `GET /api/admin/users/{uid}` : détail du profil et état du compte Firebase.
- `PATCH /api/admin/users/{uid}` : uniquement `displayName`, `telephone`,
  `role` (rôle métier non administrateur, ou `null`) et `isAdmin` (booléen).
- `POST /api/admin/users/{uid}/block|unblock|activate|deactivate` : contrôle
  des champs `bloque`, `actif` et `statut`.

Les modifications administratives et leurs entrées `adminActions` sont
écrites dans la même transaction Firestore. Le compteur empêche la désactivation
du dernier administrateur actif. Un blocage/désactivation empêche l'accès aux
routes qui passent par `require_user_profile`; cette phase ne désactive pas
Firebase Authentication et ne révoque pas les refresh tokens. La suppression
de comptes, la révocation effective des sessions et les éventuelles références
historiques ne sont pas incluses dans cette API. Les filtres combinés peuvent
nécessiter la création d'index Firestore proposés par Firebase.

## Routes principales

- `GET /`
- `GET /gestion/maisons`
- `GET /gestion/prestataires`
- `GET /gestion/voitures`
- `GET /voitures/vente/ajouter` pour le formulaire de création d'une annonce de vente automobile
- `GET /voitures/ventes` pour afficher les annonces de vente automobile
- `GET /voitures/demandes-achat` pour afficher les demandes d'achat automobile
- `GET /voitures/soumissions` pour afficher les propositions de véhicules des utilisateurs
- `GET /api`
- `GET /api/public/voitures` retourne uniquement les voitures disponibles, sans données privées
- `GET /api/public/voitures/ventes` retourne uniquement les annonces de vente disponibles, sans le WhatsApp du vendeur
- `POST /api/booking-reviews` accepte le jeton Firebase du client et enregistre un seul avis pour une réservation terminée
- `GET /api/provider-missions`, `POST /api/provider-missions/{booking_id}/complete` et `POST /api/provider-availability` utilisent le jeton Firebase d'un prestataire approuvé
- `POST /login`
- `POST /api/login`
- `GET /dashboard/prestataires` avec un token de rôle `prestataires`
- `GET /dashboard/maisons` avec un token de rôle `maisons`
- `GET /dashboard/voitures` avec un token de rôle `voitures`
- `GET /api/voitures` catalogue public des voitures à louer, sans authentification
- `GET /api/voitures/ventes` catalogue public des annonces de voitures à vendre, sans authentification
- `POST /api/voitures/ventes` avec un token de rôle `voitures` (photos dans S3, annonce dans `vehicleSales`)
- Les opérations de gestion, réservations, demandes d'achat et soumissions automobiles restent protégées par un token de rôle `voitures`
- `GET /api/voitures/demandes-achat` avec un token de rôle `voitures`
- `GET /api/voitures/soumissions` avec un token de rôle `voitures`
- `GET /prestataires/en-attente` avec un token de rôle `prestataires`
- `PATCH /prestataires/{prestataire_id}/approuver` avec un token de rôle `prestataires`
- `PATCH /prestataires/{prestataire_id}/refuser` avec un token de rôle `prestataires`

## Générer un hash bcrypt

```powershell
python -c "import bcrypt; print(bcrypt.hashpw(b'Goyingmaison1', bcrypt.gensalt()).decode())"
python -c "import bcrypt; print(bcrypt.hashpw(b'Goyingprestataire2', bcrypt.gensalt()).decode())"
python -c "import bcrypt; print(bcrypt.hashpw(b'Goyingvoiture3', bcrypt.gensalt()).decode())"
```
