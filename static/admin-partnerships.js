import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { auth, apiErrorMessage } from "./admin-firebase.js";

const $ = (selector) => document.querySelector(selector);

const message = $("#partnership-message");
const loading = $("#partnership-loading");
const empty = $("#partnership-empty");
const tableWrap = $("#partnership-table-wrap");
const rows = $("#partnership-rows");
const searchInput = $("#partnership-search");
const statusFilter = $("#partnership-status-filter");

let firebaseUser = null;
let requests = [];
let nextCursor = null;
let cursorHistory = [];
let currentCursor = null;
let pageNumber = 1;
let requestInProgress = false;

const statusLabels = {
    nouveau: "Nouveau",
    en_cours: "En cours",
    acceptee: "Acceptée",
    refusee: "Refusée",
};

function showMessage(text, isError = false) {
    message.textContent = text;
    message.hidden = !text;
    message.dataset.type = isError ? "error" : "success";
}

function formatDate(value) {
    if (!value) return "Date inconnue";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date inconnue";
    return new Intl.DateTimeFormat("fr-FR", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(date);
}

async function apiRequest(path, options = {}) {
    if (!firebaseUser) throw new Error("Connexion administrateur requise.");

    const token = await firebaseUser.getIdToken();
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${token}`);

    if (options.body) headers.set("Content-Type", "application/json");

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
        throw new Error(apiErrorMessage(payload, "Une erreur est survenue."));
    }
    return payload;
}

function addCell(row, text, label) {
    const cell = document.createElement("td");
    cell.dataset.label = label;
    cell.textContent = text || "—";
    row.appendChild(cell);
    return cell;
}

function createButton(text, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "admin-users-reset-button";
    button.textContent = text;
    button.addEventListener("click", action);
    return button;
}

function showDetails(item) {
    const content = $("#partnership-detail-content");
    content.replaceChildren();

    const fields = [
        ["Organisation", item.organizationName],
        ["Type d’entité", item.entityType],
        ["Nom du contact", item.contactName],
        ["Email officiel", item.officialEmail],
        ["Téléphone", item.phone],
        ["Domaine de collaboration", item.collaborationArea],
        ["Statut", statusLabels[item.status] || item.status],
        ["Créée le", formatDate(item.createdAt)],
        ["Dernière mise à jour", formatDate(item.updatedAt)],
    ];

    for (const [label, value] of fields) {
        const term = document.createElement("dt");
        term.textContent = label;

        const description = document.createElement("dd");
        description.textContent = value || "Non renseigné";

        content.append(term, description);
    }

    $("#partnership-detail-dialog").showModal();
}

async function changeStatus(item, newStatus, button) {
    if (item.status === newStatus) return;

    button.disabled = true;
    showMessage("");

    try {
        await apiRequest(
            `/api/partnership-requests/${encodeURIComponent(item.id)}`,
            {
                method: "PATCH",
                body: JSON.stringify({ status: newStatus }),
            }
        );

        item.status = newStatus;
        showMessage("Statut de la demande mis à jour.");
        renderRows();
    } catch (error) {
        showMessage(error.message || "Impossible de modifier le statut.", true);
        button.disabled = false;
    }
}

function renderRows() {
    rows.replaceChildren();

    const query = searchInput.value.trim().toLocaleLowerCase("fr");
    const selectedStatus = statusFilter.value;

    const filtered = requests.filter((item) => {
        const searchable = [
            item.organizationName,
            item.entityType,
            item.contactName,
            item.officialEmail,
            item.phone,
            item.collaborationArea,
        ].filter(Boolean).join(" ").toLocaleLowerCase("fr");

        return searchable.includes(query)
            && (!selectedStatus || item.status === selectedStatus);
    });

    $("#partnership-count").textContent = String(requests.length);
    empty.hidden = filtered.length !== 0;
    tableWrap.hidden = filtered.length === 0;

    for (const item of filtered) {
        const row = document.createElement("tr");

        addCell(row, item.organizationName, "Organisation");
        addCell(row, item.contactName, "Contact");
        addCell(row, item.collaborationArea, "Collaboration");
        addCell(row, formatDate(item.createdAt), "Date");

        const statusCell = addCell(
            row,
            statusLabels[item.status] || item.status || "Inconnu",
            "Statut"
        );

        const actionCell = document.createElement("td");
        actionCell.dataset.label = "Actions";
        actionCell.appendChild(createButton("Détails", () => showDetails(item)));

        const select = document.createElement("select");
        select.setAttribute("aria-label", `Modifier le statut de ${item.organizationName || "la demande"}`);

        for (const [value, label] of Object.entries(statusLabels)) {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = label;
            option.selected = item.status === value;
            select.appendChild(option);
        }

        const saveButton = createButton("Enregistrer", () => {
            changeStatus(item, select.value, saveButton);
        });

        actionCell.append(select, saveButton);
        row.appendChild(actionCell);
        rows.appendChild(row);
    }

    $("#partnership-page-status").textContent = `Page ${pageNumber}`;
    $("#partnership-previous").disabled = pageNumber <= 1 || requestInProgress;
    $("#partnership-next").disabled = !nextCursor || requestInProgress;
}

async function loadRequests(cursor = null, page = 1) {
    if (requestInProgress) return;

    requestInProgress = true;
    loading.hidden = false;
    empty.hidden = true;
    tableWrap.hidden = true;
    $("#partnership-refresh").disabled = true;
    showMessage("");

    try {
        const params = new URLSearchParams({ limit: "50" });
        if (cursor) params.set("cursor", cursor);

        const result = await apiRequest(`/api/partnership-requests?${params}`);
        requests = Array.isArray(result.requests) ? result.requests : [];
        nextCursor = result.nextCursor || null;
        currentCursor = cursor;
        pageNumber = page;

        renderRows();
    } catch (error) {
        showMessage(error.message || "Impossible de charger les demandes.", true);
    } finally {
        requestInProgress = false;
        loading.hidden = true;
        $("#partnership-refresh").disabled = false;
        $("#partnership-previous").disabled = pageNumber <= 1;
        $("#partnership-next").disabled = !nextCursor;
    }
}

$("#partnership-filters").addEventListener("submit", (event) => {
    event.preventDefault();
    renderRows();
});

$("#partnership-reset").addEventListener("click", () => {
    searchInput.value = "";
    statusFilter.value = "";
    renderRows();
});

$("#partnership-refresh").addEventListener("click", () => {
    loadRequests(currentCursor, pageNumber);
});

$("#partnership-next").addEventListener("click", () => {
    if (!nextCursor) return;
    cursorHistory.push(currentCursor);
    loadRequests(nextCursor, pageNumber + 1);
});

$("#partnership-previous").addEventListener("click", () => {
    if (pageNumber <= 1) return;
    const previousCursor = cursorHistory.pop() || null;
    loadRequests(previousCursor, pageNumber - 1);
});

$("#partnership-detail-close").addEventListener("click", () => {
    $("#partnership-detail-dialog").close();
});

$("[data-admin-logout]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    showMessage("Déconnexion en cours…");

    try {
        const token = firebaseUser ? await firebaseUser.getIdToken() : null;
        await fetch("/api/admin/session", {
            method: "DELETE",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            credentials: "same-origin",
            cache: "no-store",
        });
    } catch {
        // La session Firebase sera tout de même fermée localement.
    }

    await signOut(auth);
    window.location.replace("/admin/login");
});

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.replace("/admin/login");
        return;
    }

    firebaseUser = user;
    loadRequests();
});
