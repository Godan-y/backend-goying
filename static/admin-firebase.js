import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

const configElement = document.querySelector("#firebase-web-config");
const firebaseConfig = configElement ? JSON.parse(configElement.textContent) : {};

export const auth = getAuth(initializeApp(firebaseConfig));

export function apiErrorMessage(payload, fallback) {
    if (typeof payload?.detail === "string") {
        return payload.detail;
    }
    return fallback;
}

export function firebaseErrorMessage(error) {
    const messages = {
        "auth/invalid-credential": "Adresse email ou mot de passe incorrect.",
        "auth/invalid-email": "L'adresse email n'est pas valide.",
        "auth/user-disabled": "Ce compte Firebase est désactivé.",
        "auth/too-many-requests": "Trop de tentatives. Réessayez plus tard.",
        "auth/network-request-failed": "Connexion impossible. Vérifiez votre réseau.",
    };
    return messages[error?.code] || "La connexion Firebase a échoué.";
}

