const dialog = document.querySelector("#login-dialog");
const form = document.querySelector("#login-form");
const closeDialogButton = document.querySelector("#close-dialog");
const passwordInput = document.querySelector("#mot_de_passe");
const togglePasswordButton = document.querySelector("#toggle-password");
const loginTitle = document.querySelector("#login-title");
const loginMessage = document.querySelector("#login-message");
const selectedRole = document.querySelector("#selected-role");
const dashboardTitle = document.querySelector("#dashboard-title");
const dashboardStatus = document.querySelector("#dashboard-status");
const dashboardLink = document.querySelector("#dashboard-link");
let validatedSessionRole = null;

const managedSpaces = {
    maisons: {
        label: "Maisons",
        page: "/gestion/maisons",
        verificationUrl: "/dashboard/maisons/data",
    },
    prestataires: {
        label: "Prestataires",
        page: "/gestion/prestataires",
        verificationUrl: "/dashboard/prestataires",
    },
    voitures: {
        label: "Voitures",
        page: "/gestion/voitures",
        verificationUrl: "/dashboard/voitures",
    },
};

document.querySelectorAll(".service-action").forEach((button) => {
    button.addEventListener("click", () => {
        if (button.dataset.role === validatedSessionRole) {
            window.location.assign(managedSpaces[validatedSessionRole].page);
            return;
        }

        selectedRole.value = button.dataset.role;
        loginTitle.textContent = button.dataset.label;
        loginMessage.textContent = "";
        loginMessage.className = "form-message";
        form.reset();
        selectedRole.value = button.dataset.role;
        passwordInput.type = "password";
        togglePasswordButton.setAttribute("aria-pressed", "false");
        togglePasswordButton.setAttribute("aria-label", "Afficher le mot de passe");
        dialog.showModal();
        document.querySelector("#nom").focus();
    });
});

closeDialogButton.addEventListener("click", () => {
    dialog.close();
});

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

    const submitButton = form.querySelector(".submit-button");
    const nom = document.querySelector("#nom").value.trim();
    const motDePasse = passwordInput.value;

    loginMessage.textContent = "Vérification du compte...";
    loginMessage.className = "form-message";
    submitButton.disabled = true;

    try {
        const loginResponse = await fetch("/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                nom,
                mot_de_passe: motDePasse,
            }),
        });
        let loginPayload;
        try {
            loginPayload = await loginResponse.json();
        } catch {
            throw new Error("Le service de connexion est momentanément indisponible. Réessayez.");
        }

        if (!loginResponse.ok) {
            throw new Error(getLoginError(loginResponse.status, loginPayload.detail));
        }

        const managedSpace = managedSpaces[loginPayload.role];
        if (!managedSpace || loginPayload.role !== selectedRole.value) {
            throw new Error("Ce compte n'a pas accès à l'espace sélectionné.");
        }

        if (typeof loginPayload.access_token !== "string" || !loginPayload.access_token) {
            throw new Error("Le service de connexion est momentanément indisponible. Réessayez.");
        }

        localStorage.setItem("goying_access_token", loginPayload.access_token);
        localStorage.setItem("goying_role", loginPayload.role);
        loginMessage.textContent = "Connexion réussie. Ouverture de votre espace...";
        loginMessage.className = "form-message success";
        window.location.assign(managedSpace.page);
    } catch (error) {
        loginMessage.textContent = error instanceof TypeError
            ? "Connexion impossible. Vérifiez votre connexion et réessayez."
            : error.message;
        loginMessage.className = "form-message error";
    } finally {
        submitButton.disabled = false;
    }
});

function getLoginError(status, detail) {
    if (status === 401) {
        return "Nom ou mot de passe incorrect.";
    }
    if (status === 403 && detail === "Votre compte est désactivé") {
        return "Ce compte gestionnaire est désactivé. Contactez un administrateur.";
    }
    if (status === 403) {
        return "Ce compte n'a pas accès à l'espace sélectionné.";
    }
    return "Le service de connexion est momentanément indisponible. Réessayez.";
}

async function restoreManagedSession() {
    const token = localStorage.getItem("goying_access_token");
    const role = localStorage.getItem("goying_role");
    const managedSpace = managedSpaces[role];

    if (!token || !managedSpace) {
        localStorage.removeItem("goying_access_token");
        localStorage.removeItem("goying_role");
        return;
    }

    dashboardStatus.textContent = "Vérification de votre session...";
    dashboardStatus.classList.add("is-loading");

    try {
        const response = await fetch(managedSpace.verificationUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
        });

        if (
            localStorage.getItem("goying_access_token") !== token
            || localStorage.getItem("goying_role") !== role
        ) {
            return;
        }

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem("goying_access_token");
            localStorage.removeItem("goying_role");
            dashboardStatus.textContent = "Votre session a expiré. Sélectionnez un espace pour vous reconnecter.";
            return;
        }

        if (!response.ok) {
            throw new Error("Session momentanément indisponible.");
        }

        validatedSessionRole = role;
        document.querySelectorAll(".service-action").forEach((button) => {
            if (button.dataset.role === role) {
                button.textContent = "Ouvrir cet espace";
                button.removeAttribute("aria-haspopup");
            }
        });
        dashboardTitle.textContent = "Espace " + managedSpace.label;
        dashboardStatus.textContent = "Votre session est active. Vous pouvez reprendre votre gestion.";
        dashboardLink.href = managedSpace.page;
        dashboardLink.textContent = "Continuer vers " + managedSpace.label;
        dashboardLink.hidden = false;
    } catch {
        if (
            localStorage.getItem("goying_access_token") !== token
            || localStorage.getItem("goying_role") !== role
        ) {
            return;
        }
        dashboardStatus.textContent = "Impossible de vérifier votre session pour le moment. Réessayez dans quelques instants.";
    } finally {
        dashboardStatus.classList.remove("is-loading");
    }
}

restoreManagedSession();
