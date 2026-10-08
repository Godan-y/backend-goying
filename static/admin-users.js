import {
    onAuthStateChanged,
    signOut,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

import { apiErrorMessage, auth } from "./admin-firebase.js";

const root = document.querySelector("[data-admin-users]");
const message = document.querySelector("#admin-users-message");
const loading = document.querySelector("#admin-users-loading");
const empty = document.querySelector("#admin-users-empty");
const tableWrap = document.querySelector("#admin-users-table-wrap");
const rows = document.querySelector("#admin-users-rows");
const nextButton = document.querySelector("#admin-next-page");
const pageStatus = document.querySelector("#admin-page-status");
const filtersForm = document.querySelector("#admin-users-filters");
const dialog = document.querySelector("#admin-user-dialog");
const detailForm = document.querySelector("#admin-user-form");
const detailIdentity = document.querySelector("#admin-user-identity");

let firebaseUser = null;
let nextCursor = null;
let currentProfile = null;
let activeFilters = {};
let requestInProgress = false;

document.querySelector("[data-admin-logout]").addEventListener("click", logout);
document.querySelector("#admin-refresh").addEventListener("click", () => loadUsers());
document.querySelector("#admin-reset-filters").addEventListener("click", resetFilters);
filtersForm.addEventListener("submit", applyFilters);
nextButton.addEventListener("click", () => loadUsers(nextCursor));
detailForm.addEventListener("submit", saveProfile);
dialog.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => dialog.close());
});

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.replace("/admin/login");
        return;
    }
    firebaseUser = user;
    if (!requestInProgress) {
        loadUsers();
    }
});

async function apiRequest(path, options = {}) {
    if (!firebaseUser) {
        throw new Error("Session Firebase absente. Veuillez vous reconnecter.");
    }
    const idToken = await firebaseUser.getIdToken();
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${idToken}`);
    if (options.body) {
        headers.set("Content-Type", "application/json");
    }

    const response = await fetch(path, {
        ...options,
        headers,
        credentials: "same-origin",
        cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
        throw new Error(apiErrorMessage(payload, "Accès administrateur refusé."));
    }
    if (!response.ok) {
        throw new Error(apiErrorMessage(payload, "La demande n'a pas abouti."));
    }
    return payload;
}

function queryString(cursor) {
    const params = new URLSearchParams({ limit: "25" });
    for (const [key, value] of Object.entries(activeFilters)) {
        if (value) {
            params.set(key, value);
        }
    }
    if (cursor) {
        params.set("cursor", cursor);
    }
    return params.toString();
}

async function loadUsers(cursor = null) {
    if (!firebaseUser || requestInProgress) {
        return;
    }
    requestInProgress = true;
    setLoading(true);
    hideMessage();
    try {
        const payload = await apiRequest(`/api/admin/users?${queryString(cursor)}`);
        renderUsers(payload.users || []);
        nextCursor = payload.nextCursor || null;
        nextButton.hidden = !payload.hasMore || !nextCursor;
        pageStatus.textContent = payload.users?.length
            ? `${payload.users.length} utilisateur(s) affiché(s)`
            : "";
    } catch (error) {
        showMessage(error.message, true);
        if (/administrateur|session/i.test(error.message)) {
            window.setTimeout(() => window.location.replace("/admin/login"), 900);
        }
    } finally {
        setLoading(false);
        requestInProgress = false;
    }
}

function setLoading(isLoading) {
    loading.hidden = !isLoading;
    if (isLoading) {
        empty.hidden = true;
        tableWrap.hidden = true;
        nextButton.hidden = true;
    }
}

function renderUsers(users) {
    rows.replaceChildren();
    empty.hidden = users.length !== 0;
    tableWrap.hidden = users.length === 0;
    users.forEach((profile) => rows.appendChild(createUserRow(profile)));
}

function createUserRow(profile) {
    const row = document.createElement("tr");
    const identity = document.createElement("td");
    identity.dataset.label = "Utilisateur";
    const name = document.createElement("strong");
    name.textContent = profile.displayName || "Sans nom";
    const email = document.createElement("span");
    email.textContent = profile.email || "Email indisponible";
    const uid = document.createElement("small");
    uid.textContent = profile.uid || "";
    identity.append(name, email, uid);

    const role = makeCell(profile.role || "—", "Rôle");
    const status = makeCell(getStatusLabel(profile), "Statut");
    const admin = makeCell(profile.isAdmin === true ? "Administrateur" : "Utilisateur", "Administration");
    const actions = document.createElement("td");
    actions.dataset.label = "Actions";
    const detailsButton = makeButton("Détails", "admin-users-row-button", () => openDetails(profile.uid));
    const statusButton = profile.bloque === true
        ? makeButton("Débloquer", "admin-users-row-button", () => changeStatus(profile, "unblock"))
        : makeButton("Bloquer", "admin-users-row-button is-danger", () => changeStatus(profile, "block"));
    const activeButton = profile.actif === true
        ? makeButton("Désactiver", "admin-users-row-button", () => changeStatus(profile, "deactivate"))
        : makeButton("Activer", "admin-users-row-button", () => changeStatus(profile, "activate"));
    actions.append(detailsButton, statusButton, activeButton);
    row.append(identity, role, status, admin, actions);
    return row;
}

function makeCell(value, label) {
    const cell = document.createElement("td");
    cell.dataset.label = label;
    cell.textContent = value;
    return cell;
}

function makeButton(label, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
}

function getStatusLabel(profile) {
    if (profile.bloque === true || profile.statut === "bloque") {
        return "Bloqué";
    }
    if (profile.actif === false || profile.statut === "inactif") {
        return "Inactif";
    }
    return "Actif";
}

async function openDetails(uid) {
    try {
        const profile = await apiRequest(`/api/admin/users/${encodeURIComponent(uid)}`);
        currentProfile = profile;
        detailForm.elements.displayName.value = profile.displayName || "";
        detailForm.elements.telephone.value = profile.telephone || "";
        detailForm.elements.role.value = profile.role || "";
        detailForm.elements.isAdmin.checked = profile.isAdmin === true;
        detailIdentity.replaceChildren();
        for (const [label, value] of [
            ["UID", profile.uid],
            ["Email Firebase", profile.email || "Indisponible"],
            ["Statut", getStatusLabel(profile)],
        ]) {
            const line = document.createElement("p");
            const strong = document.createElement("strong");
            strong.textContent = `${label} : `;
            const text = document.createElement("span");
            text.textContent = value || "—";
            line.append(strong, text);
            detailIdentity.appendChild(line);
        }
        document.querySelector("#admin-user-auth-state").textContent = profile.firebaseAuthExists
            ? (profile.firebaseDisabled ? "Compte Firebase Authentication désactivé." : "Compte Firebase Authentication actif.")
            : "Aucun compte Firebase Authentication trouvé.";
        dialog.showModal();
    } catch (error) {
        showMessage(error.message, true);
    }
}

async function saveProfile(event) {
    event.preventDefault();
    if (!currentProfile) {
        return;
    }
    const form = detailForm.elements;
    const changes = {
        displayName: form.displayName.value.trim() || null,
        telephone: form.telephone.value.trim() || null,
        role: form.role.value.trim() || null,
        isAdmin: form.isAdmin.checked,
    };
    const privilegeChanged = changes.isAdmin !== (currentProfile.isAdmin === true);
    if (!window.confirm(
        privilegeChanged
            ? "Confirmer la modification du privilège d'administration globale ?"
            : "Confirmer l'enregistrement des informations autorisées ?",
    )) {
        return;
    }
    try {
        await apiRequest(`/api/admin/users/${encodeURIComponent(currentProfile.uid)}`, {
            method: "PATCH",
            body: JSON.stringify(changes),
        });
        const isRemovingOwnAdmin = currentProfile.uid === firebaseUser.uid
            && currentProfile.isAdmin === true
            && changes.isAdmin === false;
        dialog.close();
        showMessage("Profil utilisateur mis à jour.");
        await loadUsers();
        if (isRemovingOwnAdmin) {
            await logout();
        }
    } catch (error) {
        showMessage(error.message, true);
    }
}

async function changeStatus(profile, action) {
    const messages = {
        block: `Bloquer ${profile.displayName || profile.email || profile.uid} ?`,
        unblock: `Débloquer ${profile.displayName || profile.email || profile.uid} ?`,
        activate: `Activer ${profile.displayName || profile.email || profile.uid} ?`,
        deactivate: `Désactiver ${profile.displayName || profile.email || profile.uid} ?`,
    };
    if (!window.confirm(messages[action])) {
        return;
    }
    try {
        await apiRequest(`/api/admin/users/${encodeURIComponent(profile.uid)}/${action}`, {
            method: "POST",
        });
        showMessage({
            block: "Utilisateur bloqué.",
            unblock: "Utilisateur débloqué.",
            activate: "Utilisateur activé.",
            deactivate: "Utilisateur désactivé.",
        }[action]);
        await loadUsers();
    } catch (error) {
        showMessage(error.message, true);
    }
}

function applyFilters(event) {
    event.preventDefault();
    activeFilters = {
        search: document.querySelector("#admin-search").value.trim(),
        searchBy: document.querySelector("#admin-search-by").value,
        role: document.querySelector("#admin-role-filter").value.trim(),
        statut: document.querySelector("#admin-status-filter").value,
    };
    nextCursor = null;
    loadUsers();
}

function resetFilters() {
    filtersForm.reset();
    activeFilters = {};
    nextCursor = null;
    loadUsers();
}

async function logout() {
    try {
        const response = await fetch("/api/admin/session", {
            method: "DELETE",
            credentials: "same-origin",
            cache: "no-store",
        });
        if (!response.ok) {
            throw new Error("La session serveur n'a pas pu être fermée. Réessayez.");
        }
        await signOut(auth);
        window.location.replace("/");
    } catch (error) {
        showMessage(error.message || "La déconnexion a échoué.", true);
    }
}

function showMessage(text, isError = false) {
    message.textContent = text;
    message.classList.toggle("is-error", isError);
    message.classList.toggle("is-success", !isError);
    message.hidden = false;
}

function hideMessage() {
    message.hidden = true;
    message.textContent = "";
    message.classList.remove("is-error", "is-success");
}
