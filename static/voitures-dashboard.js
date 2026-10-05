document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-car-dashboard]');
    if (!page) return;

    const token = localStorage.getItem('goying_access_token');
    const role = localStorage.getItem('goying_role');
    const errorPanel = page.querySelector('[data-car-dashboard-error]');
    const errorMessage = page.querySelector('[data-car-error-message]');
    const retryButton = page.querySelector('[data-car-retry]');
    const refreshButton = page.querySelector('[data-car-refresh]');
    const recentVehicles = page.querySelector('[data-recent-vehicles]');
    const recentBookings = page.querySelector('[data-recent-bookings]');
    const statNames = ['total', 'available', 'unavailable', 'activeBookings', 'upcomingBookings', 'inProgressBookings'];
    const authorization = { Authorization: `Bearer ${token || ''}` };

    page.querySelector('[data-car-logout]').addEventListener('click', logout);
    retryButton.addEventListener('click', loadDashboard);
    refreshButton.addEventListener('click', loadDashboard);

    if (!token || role !== 'voitures') {
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
        setStats(null);
        recentVehicles.innerHTML = '<div class="car-preview-loading">Chargement des véhicules…</div>';
        recentBookings.innerHTML = '<div class="car-preview-loading">Chargement des réservations…</div>';

        try {
            const dashboardResponse = await fetch(page.dataset.dashboardUrl, {
                headers: authorization,
                cache: 'no-store',
            });
            await readPayload(dashboardResponse);
            if (!dashboardResponse.ok) {
                if ([401, 403].includes(dashboardResponse.status)) logout();
                throw new Error('Votre accès au dashboard a expiré ou n’est pas autorisé.');
            }

            const [vehiclesResult, bookingsResult] = await Promise.allSettled([
                fetchJson('/api/voitures'),
                fetchJson('/api/voitures/reservations'),
            ]);
            const failures = [];
            let vehicles = null;
            let bookings = null;

            if (vehiclesResult.status === 'fulfilled') {
                vehicles = Array.isArray(vehiclesResult.value.vehicles) ? vehiclesResult.value.vehicles : null;
                if (!vehicles) failures.push('La liste des véhicules est invalide.');
            } else {
                failures.push('Les véhicules n’ont pas pu être chargés.');
            }

            if (bookingsResult.status === 'fulfilled') {
                bookings = Array.isArray(bookingsResult.value.reservations) ? bookingsResult.value.reservations : null;
                if (!bookings) failures.push('La liste des réservations est invalide.');
            } else {
                failures.push('Les réservations n’ont pas pu être chargées.');
            }

            if (vehicles) {
                renderVehicles(vehicles);
                updateVehicleStats(vehicles);
            } else {
                recentVehicles.innerHTML = '<div class="car-preview-empty">Véhicules indisponibles. Réessayez le chargement.</div>';
                setStat('total', '—');
                setStat('available', '—');
                setStat('unavailable', '—');
            }

            if (bookings) {
                renderBookings(bookings);
                updateBookingStats(bookings);
            } else {
                recentBookings.innerHTML = '<div class="car-preview-empty">Réservations indisponibles. Réessayez le chargement.</div>';
                setStat('activeBookings', '—');
                setStat('upcomingBookings', '—');
                setStat('inProgressBookings', '—');
            }

            if (failures.length) {
                errorMessage.textContent = 'Impossible de charger certaines données. Utilisez « Réessayer ».';
                errorPanel.hidden = false;
            }
        } catch (error) {
            errorMessage.textContent = error.message || 'Impossible de charger les données.';
            errorPanel.hidden = false;
            setStats(null);
            recentVehicles.innerHTML = '<div class="car-preview-empty">Impossible de charger les véhicules.</div>';
            recentBookings.innerHTML = '<div class="car-preview-empty">Impossible de charger les réservations.</div>';
        } finally {
            refreshButton.disabled = false;
            retryButton.disabled = false;
            refreshButton.removeAttribute('aria-busy');
            refreshButton.innerHTML = '<span aria-hidden="true">↻</span> Actualiser';
        }
    }

    async function fetchJson(url) {
        const response = await fetch(url, {
            headers: authorization,
            cache: 'no-store',
        });
        const payload = await readPayload(response);
        if (!response.ok) {
            if ([401, 403].includes(response.status)) logout();
            throw new Error('Accès refusé ou données indisponibles.');
        }
        return payload;
    }

    async function readPayload(response) {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            throw new Error('Réponse inattendue du serveur.');
        }
        return response.json();
    }

    function updateVehicleStats(vehicles) {
        const available = vehicles.filter((vehicle) => vehicle.isAvailable !== false);
        setStat('total', vehicles.length);
        setStat('available', available.length);
        setStat('unavailable', vehicles.length - available.length);
    }

    function updateBookingStats(bookings) {
        const activeStatuses = new Set(['En attente', 'Confirmé', 'En cours']);
        const active = bookings.filter((booking) => activeStatuses.has(booking.status));
        const upcoming = active.filter((booking) =>
            ['En attente', 'Confirmé'].includes(booking.status) && isUpcoming(booking.date)
        );
        setStat('activeBookings', active.length);
        setStat('upcomingBookings', upcoming.length);
        setStat('inProgressBookings', active.filter((booking) => booking.status === 'En cours').length);
    }

    function setStats(stats) {
        statNames.forEach((name) => setStat(name, stats ? stats[name] : '—'));
    }

    function setStat(name, value) {
        page.querySelectorAll(`[data-car-stat="${name}"]`).forEach((node) => {
            node.textContent = String(value);
        });
    }

    function renderVehicles(vehicles) {
        if (!vehicles.length) {
            recentVehicles.innerHTML = `<div class="car-preview-empty">
                <span aria-hidden="true">▱</span><strong>Aucune voiture enregistrée</strong>
                <p>Commencez par ajouter votre premier véhicule à la plateforme.</p>
                <a href="/voitures/ajouter">Ajouter une voiture à louer</a>
            </div>`;
            return;
        }
        recentVehicles.innerHTML = vehicles.slice(0, 4).map(renderVehicle).join('');
        recentVehicles.querySelectorAll('.car-preview-vehicle-image img').forEach((image) => {
            image.addEventListener('error', () => {
                image.hidden = true;
                image.nextElementSibling?.classList.add('is-visible');
            }, { once: true });
        });
    }

    function renderVehicle(vehicle) {
        const id = clean(vehicle.id);
        const title = [vehicle.brand, vehicle.model].map(clean).filter(Boolean).join(' ') || 'Voiture sans nom';
        const image = Array.isArray(vehicle.imageUrls) && vehicle.imageUrls.length
            ? clean(vehicle.imageUrls[0])
            : clean(vehicle.imageUrl);
        const available = vehicle.isAvailable !== false;
        const category = clean(vehicle.category);
        const price = vehicle.pricePerDay !== null && vehicle.pricePerDay !== undefined && vehicle.pricePerDay !== ''
            ? `${formatNumber(vehicle.pricePerDay)} ${clean(vehicle.currency)} / jour`
            : 'Prix non renseigné';
        return `<article class="car-preview-vehicle">
            <div class="car-preview-vehicle-image">
                ${image
                    ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" loading="lazy"><span class="car-preview-image-fallback" aria-hidden="true">▱</span>`
                    : '<span class="car-preview-image-fallback is-visible" aria-hidden="true">▱</span>'}
            </div>
            <div class="car-preview-vehicle-info">
                <div class="car-preview-vehicle-title"><div>${category ? `<small>${escapeHtml(category)}</small>` : ''}<strong>${escapeHtml(title)}</strong></div>
                    <span class="car-preview-status ${available ? 'is-available' : 'is-unavailable'}">${available ? 'Disponible' : 'Indisponible'}</span>
                </div>
                <p>${escapeHtml(price)}</p>
                <small>${[clean(vehicle.fuel), clean(vehicle.transmission), vehicle.seats ? `${vehicle.seats} places` : ''].filter(Boolean).map(escapeHtml).join(' · ')}</small>
                ${id ? `<a href="/voitures/${encodeURIComponent(id)}/modifier">Voir / modifier</a>` : ''}
            </div>
        </article>`;
    }

    function renderBookings(bookings) {
        if (!bookings.length) {
            recentBookings.innerHTML = '<div class="car-preview-empty">Aucune réservation à gérer pour le moment.</div>';
            return;
        }
        recentBookings.innerHTML = bookings.slice(0, 4).map(renderBooking).join('');
    }

    function renderBooking(booking) {
        const title = clean(booking.itemName) || 'Voiture non renseignée';
        const client = clean(booking.clientName);
        const date = formatDate(booking.date);
        const amount = clean(booking.costInfo);
        const status = clean(booking.status) || 'Statut non renseigné';
        return `<article class="car-preview-booking">
            <span class="car-booking-icon" aria-hidden="true">▤</span>
            <div class="car-preview-booking-info">
                <div><strong>${escapeHtml(title)}</strong><span class="car-preview-status ${bookingStatusClass(status)}">${escapeHtml(status)}</span></div>
                <p>${client ? `Client : ${escapeHtml(client)}` : 'Client non renseigné'}${date ? ` · ${escapeHtml(date)}` : ''}</p>
                <small>${amount ? escapeHtml(amount) : 'Montant non renseigné'}</small>
            </div>
        </article>`;
    }

    function bookingStatusClass(status) {
        if (status === 'En attente') return 'is-pending';
        if (status === 'Confirmé') return 'is-confirmed';
        if (status === 'En cours') return 'is-progress';
        return 'is-muted';
    }

    function parseDate(value) {
        if (value && typeof value === 'object' && Number.isFinite(value.seconds)) return value.seconds * 1000;
        if (typeof value !== 'string' || !value.trim()) return null;
        const timestamp = Date.parse(value);
        return Number.isFinite(timestamp) ? timestamp : null;
    }

    function isUpcoming(value) {
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
            const today = new Date();
            const localToday = [
                today.getFullYear(),
                String(today.getMonth() + 1).padStart(2, '0'),
                String(today.getDate()).padStart(2, '0'),
            ].join('-');
            return value >= localToday;
        }
        const timestamp = parseDate(value);
        return timestamp !== null && timestamp > Date.now();
    }

    function formatDate(value) {
        const timestamp = parseDate(value);
        if (timestamp === null) return '';
        return new Intl.DateTimeFormat('fr-FR', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        }).format(timestamp);
    }

    function formatNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(number) : 'Prix non renseigné';
    }

    function clean(value) {
        if (value === null || value === undefined || typeof value === 'object') return '';
        const text = String(value).trim();
        return ['null', 'undefined', 'nan'].includes(text.toLowerCase()) ? '' : text;
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
