document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-house-dashboard]');
    if (!page) return;

    const token = localStorage.getItem('goying_access_token');
    const role = localStorage.getItem('goying_role');
    const errorPanel = page.querySelector('[data-house-error]');
    const errorMessage = page.querySelector('[data-house-error-message]');
    const retryButton = page.querySelector('[data-house-retry]');
    const refreshButton = page.querySelector('[data-house-refresh]');
    const housesList = page.querySelector('[data-recent-houses]');
    const bookingsList = page.querySelector('[data-recent-bookings]');
    const statNames = ['total', 'approuvees', 'disponibles', 'prises', 'reservees', 'soumises'];

    page.querySelector('[data-house-logout]').addEventListener('click', logout);
    retryButton.addEventListener('click', loadDashboard);
    refreshButton.addEventListener('click', loadDashboard);

    if (!token || role !== 'maisons') {
        logout();
        return;
    }

    loadDashboard();

    async function loadDashboard() {
        if (refreshButton.disabled) return;
        refreshButton.disabled = true;
        retryButton.disabled = true;
        refreshButton.setAttribute('aria-busy', 'true');
        refreshButton.innerHTML = '<span aria-hidden="true">↻</span> Actualisation…';
        errorPanel.hidden = true;
        updateStatistics(null);
        housesList.innerHTML = '<div class="house-preview-loading">Chargement des maisons…</div>';
        bookingsList.innerHTML = '<div class="house-preview-loading">Chargement des réservations…</div>';

        try {
            const headers = { Authorization: `Bearer ${token}` };
            const dashboardResponse = await fetch(page.dataset.dashboardUrl, {
                headers,
                cache: 'no-store',
            });
            const dashboardPayload = await readPayload(dashboardResponse);
            if (!dashboardResponse.ok) {
                if ([401, 403].includes(dashboardResponse.status)) logout();
                throw new Error('Votre accès à cet espace a expiré ou n’est pas autorisé.');
            }

            const response = await fetch(page.dataset.overviewUrl, {
                headers,
                cache: 'no-store',
            });
            const payload = await readPayload(response);
            if (!response.ok) {
                if ([401, 403].includes(response.status)) logout();
                throw new Error('Les données immobilières ne sont pas disponibles pour le moment.');
            }

            const statistics = payload.statistics;
            const houses = payload.maisons;
            const bookings = payload.reservations;
            if (!statistics || !Array.isArray(houses) || !Array.isArray(bookings)) {
                throw new Error('Le serveur a renvoyé des données incomplètes.');
            }

            updateStatistics(statistics);
            renderHouses(houses);
            renderBookings(bookings);
        } catch (error) {
            errorMessage.textContent = error.message || 'Vérifiez votre connexion puis réessayez.';
            errorPanel.hidden = false;
            updateStatistics(null);
            housesList.innerHTML = '<div class="house-preview-empty">Impossible de charger les maisons.</div>';
            bookingsList.innerHTML = '<div class="house-preview-empty">Impossible de charger les réservations.</div>';
        } finally {
            refreshButton.disabled = false;
            retryButton.disabled = false;
            refreshButton.removeAttribute('aria-busy');
            refreshButton.innerHTML = '<span aria-hidden="true">↻</span> Actualiser';
        }
    }

    async function readPayload(response) {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            if (!response.ok) throw new Error('Le service est momentanément indisponible.');
            throw new Error('Réponse inattendue du serveur.');
        }
        return response.json();
    }

    function updateStatistics(statistics) {
        statNames.forEach((name) => {
            const value = statistics && Number.isFinite(statistics[name])
                ? String(statistics[name])
                : '—';
            page.querySelectorAll(`[data-house-stat="${name}"], [data-house-shortcut="${name}"]`)
                .forEach((element) => {
                    element.textContent = value;
                });
        });
        page.querySelectorAll('[data-house-empty]').forEach((element) => {
            const key = element.dataset.houseEmpty;
            element.hidden = !statistics || statistics[key] !== 0;
        });
    }

    function renderHouses(houses) {
        if (!houses.length) {
            housesList.innerHTML = `<div class="house-preview-empty">
                <span aria-hidden="true">⌂</span>
                <strong>Aucune maison enregistrée</strong>
                <p>Commencez par ajouter votre premier bien immobilier à GOYING.</p>
                <a href="/maisons/ajouter">Ajouter une maison</a>
            </div>`;
            return;
        }

        housesList.innerHTML = houses.map(renderHouse).join('');
        housesList.querySelectorAll('.house-preview-photo img').forEach((image) => {
            image.addEventListener('error', () => {
                image.hidden = true;
                image.nextElementSibling.classList.add('is-visible');
            }, { once: true });
        });
    }

    function renderHouse(house) {
        const title = firstValue(house.titre, house.type_maison, 'Bien immobilier sans titre');
        const image = safeImageUrl(firstValue(
            Array.isArray(house.photo_urls) ? house.photo_urls[0] : '',
            house.photo_url,
        ));
        const location = [house.commune, house.quartier, house.avenue]
            .map(clean)
            .filter(Boolean)
            .join(' · ');
        const transaction = transactionLabel(house.type);
        const price = formatPrice(house.prix, house.devise);
        const approval = house.approuvee === true
            ? '<span class="house-status is-approved">Approuvée</span>'
            : house.approuvee === false
                ? '<span class="house-status is-pending">Non approuvée</span>'
                : '';
        const availability = availabilityLabel(house);

        return `<article class="house-preview-card">
            <div class="house-preview-photo">
                ${image
                    ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy"><span class="house-photo-fallback" aria-hidden="true">⌂</span>`
                    : '<span class="house-photo-fallback is-visible" aria-hidden="true">⌂</span>'}
                <span class="house-transaction-badge">${escapeHtml(transaction || 'Bien immobilier')}</span>
            </div>
            <div class="house-preview-card-body">
                <div class="house-preview-card-title">
                    <div><small>${escapeHtml(clean(house.type_maison) || 'Type non renseigné')}</small><h4>${escapeHtml(title)}</h4></div>
                    ${price ? `<strong>${escapeHtml(price)}</strong>` : ''}
                </div>
                ${location ? `<p class="house-preview-location"><span aria-hidden="true">⌖</span>${escapeHtml(location)}</p>` : ''}
                <div class="house-preview-badges">${approval}${availability}</div>
            </div>
        </article>`;
    }

    function renderBookings(bookings) {
        if (!bookings.length) {
            bookingsList.innerHTML = '<div class="house-preview-empty">Aucune réservation immobilière récente.</div>';
            return;
        }
        bookingsList.innerHTML = bookings.map((booking) => {
            const title = clean(booking.title) || 'Bien immobilier non renseigné';
            const client = clean(booking.clientName);
            const status = clean(booking.status);
            const date = formatDate(booking.date || booking.createdAt);
            const details = [client && `Client : ${client}`, date, clean(booking.location)]
                .filter(Boolean)
                .join(' · ');
            return `<article class="house-booking-preview">
                <span class="house-booking-icon" aria-hidden="true">▤</span>
                <div class="house-booking-copy">
                    <div><strong>${escapeHtml(title)}</strong>${status ? `<span class="house-status ${bookingStatusClass(status)}">${escapeHtml(status)}</span>` : ''}</div>
                    <p>${escapeHtml(details || 'Détails non renseignés')}</p>
                    ${booking.costInfo ? `<small>${escapeHtml(clean(booking.costInfo))}</small>` : ''}
                </div>
            </article>`;
        }).join('');
    }

    function availabilityLabel(house) {
        const value = normalize(firstValue(house.disponibilite, house.statut));
        if (value === 'disponible' || (house.approuvee === true && ['a_louer', 'a_vendre'].includes(value))) {
            return '<span class="house-status is-available">Disponible</span>';
        }
        if (value === 'indisponible') {
            return '<span class="house-status is-unavailable">Indisponible</span>';
        }
        return '';
    }

    function transactionLabel(value) {
        const normalized = normalize(value);
        if (['a_louer', 'location', 'louer', 'rent'].includes(normalized)) return 'À louer';
        if (['a_vendre', 'vente', 'vendre', 'sale'].includes(normalized)) return 'À vendre';
        return clean(value);
    }

    function bookingStatusClass(status) {
        const normalized = normalize(status);
        if (['confirme', 'approuve', 'approved'].includes(normalized)) return 'is-approved';
        if (['en attente', 'pending', 'en_attente'].includes(normalized)) return 'is-pending';
        if (['annule', 'annulee', 'cancelled', 'canceled'].includes(normalized)) return 'is-unavailable';
        return 'is-neutral';
    }

    function formatPrice(value, currency) {
        if (value === null || value === undefined || value === '') return '';
        const amount = Number(value);
        const formatted = Number.isFinite(amount)
            ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(amount)
            : clean(value);
        const unit = clean(currency);
        return `${formatted}${unit ? ` ${unit}` : ''}`;
    }

    function formatDate(value) {
        if (!value) return '';
        const timestamp = Date.parse(String(value));
        if (!Number.isFinite(timestamp)) return '';
        return new Intl.DateTimeFormat('fr-FR', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        }).format(timestamp);
    }

    function safeImageUrl(value) {
        if (!value) return '';
        try {
            const url = new URL(value, window.location.origin);
            return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
        } catch {
            return '';
        }
    }

    function firstValue(...values) {
        for (const value of values) {
            const cleaned = clean(value);
            if (cleaned) return cleaned;
        }
        return '';
    }

    function clean(value) {
        if (value === null || value === undefined || typeof value === 'object') return '';
        const text = String(value).trim();
        return ['null', 'undefined', 'nan'].includes(text.toLowerCase()) ? '' : text;
    }

    function normalize(value) {
        return clean(value)
            .toLocaleLowerCase('fr')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>'"]/g, (character) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;',
        }[character]));
    }

    function logout() {
        localStorage.removeItem('goying_access_token');
        localStorage.removeItem('goying_role');
        window.location.href = '/';
    }
});
