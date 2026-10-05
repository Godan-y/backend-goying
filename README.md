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
- `POST /login`
- `POST /api/login`
- `GET /dashboard/prestataires` avec un token de rôle `prestataires`
- `GET /dashboard/maisons` avec un token de rôle `maisons`
- `GET /dashboard/voitures` avec un token de rôle `voitures`
- `POST /api/voitures/ventes` avec un token de rôle `voitures` (photos dans S3, annonce dans `vehicleSales`)
- `GET /api/voitures/ventes` avec un token de rôle `voitures`
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
