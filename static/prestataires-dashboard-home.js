document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-provider-dashboard]');
    if (!page) return;

    const token = localStorage.getItem('goying_access_token');
    const role = localStorage.getItem('goying_role');
    const errorPanel = page.querySelector('[data-dashboard-error]');
    const errorMessage = page.querySelector('[data-dashboard-error-message]');
    const retryButton = page.querySelector('[data-retry]');
    const statNames = ['total', 'pending', 'approved', 'refused', 'appointments', 'reserved', 'taken', 'bookable'];
    const apiUrls = {
        approved: '/prestataires/api/approuves',
        pending: '/prestataires/api/en-attente',
        refused: '/prestataires/api/refuses',
        appointments: '/prestataires/api/rendez-vous',
        taken: '/prestataires/api/pris',
        bookable: '/prestataires/api/disponibles',
    };

    page.querySelector('[data-logout]').addEventListener('click', logout);
    retryButton.addEventListener('click', loadDashboard);
    if (!token || role !== 'prestataires') {
        logout();
        return;
    }

    loadDashboard();

    async function loadDashboard() {
        retryButton.disabled = true;
        errorPanel.hidden = true;
        setStats(null);
        try {
            const authorization = { Authorization: `Bearer ${token}` };
            const dashboardResponse = await fetch(page.dataset.dashboardUrl, {
                headers: authorization,
                cache: 'no-store',
            });
            const dashboardPayload = await readPayload(dashboardResponse);
            if (!dashboardResponse.ok) {
                if (dashboardResponse.status === 401 || dashboardResponse.status === 403) logout();
                throw new Error(apiError(dashboardPayload, 'Accès au dashboard refusé.'));
            }

            const results = await Promise.allSettled(
                Object.entries(apiUrls).map(async ([name, url]) => {
                    const response = await fetch(url, { headers: authorization, cache: 'no-store' });
                    const payload = await readPayload(response);
                    if (!response.ok) throw new Error(apiError(payload, `Impossible de charger ${name}.`));
                    return [name, payload];
                }),
            );
            const failures = [];
            const values = {};
            results.forEach((result, index) => {
                const name = Object.keys(apiUrls)[index];
                if (result.status === 'rejected') {
                    values[name] = null;
                    failures.push(`${labelFor(name)} : ${result.reason.message || 'erreur inconnue'}`);
                } else {
                    values[result.value[0]] = result.value[1];
                }
            });

            const providers = getRecords(values.approved, 'prestataires');
            const pending = getRecords(values.pending, 'prestataires');
            const refused = getRecords(values.refused, 'prestataires');
            const bookings = getRecords(values.appointments, 'rendez_vous');
            const taken = getRecords(values.taken, 'prestataires');
            const bookable = getRecords(values.bookable, 'prestataires');
            const activeReservedProviders = new Set(
                bookings
                    .filter((booking) => ['confirme', 'approved', 'approuve', 'en cours', 'in progress', 'a valider'].includes(normalize(booking.status)))
                    .map((booking) => booking.providerId || (booking.provider && booking.provider.id))
                    .filter((providerId) => typeof providerId === 'string' && providerId.trim()),
            );
            const pendingAppointments = bookings.filter((booking) => ['en attente', 'en_attente', 'pending'].includes(normalize(booking.status))).length;
            const counts = {
                total: providers.length + pending.length + refused.length,
                pending: pending.length,
                approved: providers.length,
                refused: refused.length,
                appointments: pendingAppointments,
                reserved: activeReservedProviders.size,
                taken: taken.length,
                bookable: bookable.length,
            };
            setStats(counts);
            if (failures.length) {
                errorMessage.textContent = `Certaines statistiques n’ont pas pu être chargées. ${failures.join(' · ')}`;
                errorPanel.hidden = false;
                results.forEach((result, index) => {
                    if (result.status === 'rejected') {
                        setOneStat(Object.keys(apiUrls)[index], '—');
                    }
                });
                if (values.pending === null || values.approved === null || values.refused === null) {
                    setOneStat('total', '—');
                }
            }
        } catch (error) {
            errorMessage.textContent = error.message || 'Une erreur est survenue lors du chargement du dashboard.';
            errorPanel.hidden = false;
            setStats(null);
        } finally {
            retryButton.disabled = false;
        }
    }

    function getRecords(payload, key) {
        const records = payload && payload[key];
        return Array.isArray(records) ? records : [];
    }

    function setStats(counts) {
        statNames.forEach((name) => setOneStat(name, counts ? String(counts[name]) : '—'));
    }

    function setOneStat(name, value) {
        const stat = page.querySelector(`[data-stat="${name}"]`);
        if (stat) stat.textContent = value;
        page.querySelectorAll(`[data-shortcut-count="${name}"]`).forEach((shortcut) => {
            shortcut.textContent = value;
        });
    }

    function normalize(value) {
        return String(value || '').trim().toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function labelFor(name) {
        return {
            approved: 'Prestataires approuvés',
            pending: 'Nouvelles demandes',
            refused: 'Prestataires refusés',
            appointments: 'Rendez-vous',
            taken: 'Prestataires pris',
            bookable: 'Profils réservables',
        }[name] || name;
    }

    async function readPayload(response) {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
            throw new Error('Réponse inattendue du serveur.');
        }
        return response.json();
    }

    function apiError(payload, fallback) {
        return typeof payload.detail === 'string' ? payload.detail : fallback;
    }

    function logout() {
        localStorage.removeItem('goying_access_token');
        localStorage.removeItem('goying_role');
        window.location.href = '/';
    }
});
