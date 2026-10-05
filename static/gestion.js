const page = document.querySelector("[data-gestion-page]");
const pageTitle = document.querySelector("#page-title");
const pageStatus = document.querySelector("#page-status");
const sectionsList = document.querySelector("#gestion-sections");
const logoutButton = document.querySelector("#logout-button");

const token = localStorage.getItem("goying_access_token");
const role = localStorage.getItem("goying_role");
const expectedRole = page.dataset.role;
const dashboardUrl = page.dataset.dashboardUrl;

logoutButton.addEventListener("click", () => {
    clearSession();
    window.location.href = "/";
});

if (!token || role !== expectedRole) {
    clearSession();
    window.location.href = "/";
} else {
    loadDashboard();
}

async function loadDashboard() {
    try {
        const response = await fetch(dashboardUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        const payload = await response.json();

        if (!response.ok) {
            throw new Error(payload.detail || "Accès refusé");
        }

        pageTitle.textContent = payload.page;
        pageStatus.textContent = `Connexion réussie. Accès ${expectedRole} autorisé.`;
        pageStatus.className = "status-text success";

        sectionsList.replaceChildren();
        payload.sections.forEach((section) => {
            const item = document.createElement("li");
            item.textContent = section;
            sectionsList.appendChild(item);
        });
    } catch (error) {
        pageTitle.textContent = "Accès refusé";
        pageStatus.textContent = error.message;
        pageStatus.className = "status-text error";
        sectionsList.replaceChildren();
    }
}

function clearSession() {
    localStorage.removeItem("goying_access_token");
    localStorage.removeItem("goying_role");
}
