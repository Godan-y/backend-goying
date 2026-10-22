import {
    browserSessionPersistence,
    setPersistence,
    signInWithEmailAndPassword,
    signOut,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import { apiErrorMessage, auth, firebaseErrorMessage } from "./admin-firebase.js";

const form = document.querySelector("#admin-login-form");
const message = document.querySelector("#admin-login-message");
const submitButton = form.querySelector('button[type="submit"]');
const passwordInput = form.elements.password;
const togglePasswordButton = document.querySelector("#admin-toggle-password");

togglePasswordButton.addEventListener("click", () => {
    const passwordIsHidden = passwordInput.type === "password";
    passwordInput.type = passwordIsHidden ? "text" : "password";
    togglePasswordButton.setAttribute("aria-pressed", String(passwordIsHidden));
    togglePasswordButton.setAttribute(
        "aria-label",
        passwordIsHidden ? "Masquer le mot de passe" : "Afficher le mot de passe",
    );
});

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.hidden = true;
    submitButton.disabled = true;
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;

    try {
        await setPersistence(auth, browserSessionPersistence);
        const credential = await signInWithEmailAndPassword(auth, email, password);
        const idToken = await credential.user.getIdToken();
        const response = await fetch("/api/admin/session", {
            method: "POST",
            headers: { Authorization: `Bearer ${idToken}` },
            credentials: "same-origin",
            cache: "no-store",
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            await signOut(auth);
            throw new Error(apiErrorMessage(payload, "Accès administrateur refusé."));
        }
        window.location.replace("/admin/users");
    } catch (error) {
        showMessage(error.message || firebaseErrorMessage(error));
        if (error?.code?.startsWith("auth/")) {
            showMessage(firebaseErrorMessage(error));
        }
    } finally {
        passwordInput.value = "";
        passwordInput.type = "password";
        togglePasswordButton.setAttribute("aria-pressed", "false");
        togglePasswordButton.setAttribute("aria-label", "Afficher le mot de passe");
        submitButton.disabled = false;
    }
});

function showMessage(text) {
    message.textContent = text;
    message.classList.add("is-error");
    message.hidden = false;
}
