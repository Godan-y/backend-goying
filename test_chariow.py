
import os
import requests

api_key = os.getenv("CHARIOW_API_KEY")

if not api_key:
    print("Clé absente : configure CHARIOW_API_KEY dans le terminal.")
    raise SystemExit(1)

try:
    response = requests.get(
        "https://api.chariow.com/v1/store",
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=15,
    )
    print("Code HTTP :", response.status_code)

    if response.ok:
        data = response.json()
        store = data.get("data", {})
        print("Message :", data.get("message"))
        print("Boutique :", store.get("name", "Nom non fourni"))
    else:
        print("La requête a échoué.")
        print("Raison HTTP :", response.reason)
        print("Type de réponse :", response.headers.get("Content-Type", "inconnu"))
        for header in ("Server", "Via", "Content-Length", "X-Request-Id", "CF-Ray"):
            value = response.headers.get(header)
            if value:
                print(f"{header} :", value)
        try:
            error = response.json()
        except ValueError:
            excerpt = response.text[:500].replace(api_key, "[masqué]")
            print("Réponse non JSON.")
            print("Extrait local (500 caractères max) :",
                  excerpt if excerpt else "[vide]")
        else:
            if isinstance(error, dict):
                for field in ("message", "errors"):
                    detail = error.get(field)
                    if detail is not None:
                        text = str(detail).replace(api_key, "[masqué]")
                        print(f"{field.capitalize()} :", text)
            else:
                print("Réponse JSON inattendue ; contenu ignoré.")
except requests.RequestException:
    print("Impossible de joindre Chariow. Vérifie la connexion réseau.")
