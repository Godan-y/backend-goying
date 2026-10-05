document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-vehicle-submissions-page]');
    if (!page) return;

    const list = page.querySelector('[data-vehicle-submissions-list]');
    const count = page.querySelector('[data-vehicle-submissions-count]');
    const countLabel = page.querySelector('[data-vehicle-submissions-count-label]');
    const total = page.querySelector('[data-vehicle-submissions-total]');
    const pending = page.querySelector('[data-vehicle-submissions-pending]');
    const approved = page.querySelector('[data-vehicle-submissions-approved]');
    const rejected = page.querySelector('[data-vehicle-submissions-rejected]');
    const processed = page.querySelector('[data-vehicle-submissions-processed]');
    const search = page.querySelector('[data-vehicle-submissions-search]');
    const statusFilter = page.querySelector('[data-vehicle-submissions-status-filter]');
    const feedback = page.querySelector('[data-vehicle-submissions-feedback]');
    const refreshButton = page.querySelector('[data-vehicle-submissions-refresh]');
    const refreshLabel = page.querySelector('[data-vehicle-submissions-refresh-label]');
    const logoutButton = page.querySelector('[data-vehicle-submissions-logout]');
    const detailsDialog = document.querySelector('[data-vehicle-submission-dialog]');
    const detailsTitle = detailsDialog?.querySelector('[data-vehicle-submission-dialog-title]');
    const detailsBody = detailsDialog?.querySelector('[data-vehicle-submission-dialog-body]');
    const detailsClose = detailsDialog?.querySelector('[data-vehicle-submission-dialog-close]');
    const token = localStorage.getItem('goying_access_token');

    if (!list || !count || !countLabel || !total || !pending || !approved || !rejected
        || !processed || !search || !statusFilter || !feedback
        || !refreshButton || !refreshLabel || !logoutButton || !token
        || !detailsDialog || !detailsTitle || !detailsBody || !detailsClose
        || localStorage.getItem('goying_role') !== 'voitures') {
        clearSession();
        window.location.href = '/';
        return;
    }

    let submissions = [];
    let isLoading = false;
    let hasLoaded = false;

    logoutButton.addEventListener('click', () => {
        clearSession();
        window.location.href = '/';
    });
    refreshButton.addEventListener('click', loadSubmissions);
    search.addEventListener('input', renderSubmissions);
    statusFilter.addEventListener('change', renderSubmissions);
    list.addEventListener('click', handleSubmissionClick);
    list.addEventListener('error', handleImageError, true);
    detailsClose.addEventListener('click', () => detailsDialog.close());
    detailsDialog.addEventListener('click', (event) => {
        if (event.target === detailsDialog) detailsDialog.close();
    });

    loadSubmissions();

    async function loadSubmissions() {
        if (isLoading) return;
        isLoading = true;
        refreshButton.disabled = true;
        refreshButton.setAttribute('aria-busy', 'true');
        refreshLabel.textContent = 'Actualisation…';
        list.setAttribute('aria-busy', 'true');
        if (!hasLoaded) feedback.textContent = '';

        try {
            const response = await fetch(page.dataset.endpoint, {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            });
            const payload = await readJsonResponse(response);
            if (response.status === 401 || response.status === 403) {
                clearSession();
                window.location.href = '/';
                return;
            }
            if (!response.ok) {
                throw new Error(payload.detail || 'Impossible de charger les propositions.');
            }
            if (!Array.isArray(payload.submissions)) {
                throw new Error('La réponse du serveur ne contient pas la liste des propositions.');
            }

            submissions = payload.submissions;
            hasLoaded = true;
            updateStatusFilter();
            updateStatistics();
            renderSubmissions();
            feedback.textContent = '';
            feedback.className = 'vehicle-sales-feedback';
        } catch (error) {
            const message = error instanceof TypeError
                ? 'Erreur réseau. Vérifiez votre connexion puis réessayez.'
                : error instanceof Error
                    ? error.message
                    : 'Impossible de charger les propositions.';
            if (!hasLoaded) {
                list.innerHTML = `<div class="vehicle-sales-state is-error" role="alert">
                    <span aria-hidden="true">!</span>
                <strong>Impossible de charger les propositions</strong>
                    <p>${escapeHtml(message)}</p>
                    <button type="button" data-vehicle-submissions-retry>Réessayer</button>
                </div>`;
                list.querySelector('[data-vehicle-submissions-retry]')
                    ?.addEventListener('click', loadSubmissions);
            }
            feedback.textContent = message;
            feedback.className = 'vehicle-sales-feedback is-error';
        } finally {
            isLoading = false;
            refreshButton.disabled = false;
            refreshButton.removeAttribute('aria-busy');
            refreshLabel.textContent = 'Actualiser';
            list.setAttribute('aria-busy', 'false');
        }
    }

    function updateStatistics() {
        total.textContent = String(submissions.length);
        pending.textContent = String(submissions.filter((item) => isPending(item.status)).length);
        approved.textContent = String(submissions.filter((item) => statusClass(item.status) === 'is-approved').length);
        rejected.textContent = String(submissions.filter((item) => statusClass(item.status) === 'is-rejected').length);
        processed.textContent = String(submissions.filter((item) => statusClass(item.status) === 'is-processed').length);
        count.textContent = String(filteredSubmissions().length);
    }

    function updateStatusFilter() {
        const selectedStatus = statusFilter.value;
        const statuses = [...new Set(submissions.map((item) => clean(item.status)).filter(Boolean))]
            .sort((first, second) => formatStatus(first).localeCompare(formatStatus(second), 'fr'));
        statusFilter.innerHTML = '<option value="">Tous les statuts</option>'
            + statuses.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(formatStatus(status))}</option>`).join('');
        if (statuses.includes(selectedStatus)) statusFilter.value = selectedStatus;
    }

    function filteredSubmissions() {
        const query = clean(search.value).toLocaleLowerCase('fr');
        return submissions.filter((item) => {
            const matchesStatus = !statusFilter.value || clean(item.status) === statusFilter.value;
            if (!matchesStatus) return false;
            if (!query) return true;
            return [
                item.brand,
                item.model,
                item.vehicleType,
                item.color,
                item.condition,
                item.fuel,
                item.transmission,
                item.listingIntent,
                item.pricePeriod,
                item.commune,
                item.address,
                item.locationComment,
                item.visitAddress,
                item.ownerName,
                item.ownerEmail,
                item.ownerPhone,
                item.ownerUid,
                item.preferredContact,
                item.availableDays,
                item.availableHours,
                item.status,
                item.additionalInformation,
                item.id,
            ].some((value) => clean(value).toLocaleLowerCase('fr').includes(query));
        });
    }

    function renderSubmissions() {
        if (!hasLoaded) return;
        const filtered = filteredSubmissions();
        count.textContent = String(filtered.length);
        countLabel.textContent = filtered.length === 1 ? 'proposition' : 'propositions';

        if (!submissions.length) {
            list.innerHTML = `<div class="vehicle-sales-state">
                <svg aria-hidden="true" viewBox="0 0 96 64" focusable="false"><path d="M17 40h62l-5-17a8 8 0 0 0-8-6H32a8 8 0 0 0-8 6l-7 17Z"/><path d="M13 40h70v12H13z"/><circle cx="27" cy="52" r="7"/><circle cx="69" cy="52" r="7"/></svg>
                <strong>Aucune proposition</strong>
                <p>Aucun propriétaire n'a encore soumis de véhicule.</p>
            </div>`;
            return;
        }
        if (!filtered.length) {
            list.innerHTML = `<div class="vehicle-sales-state">
                <span aria-hidden="true">⌕</span>
                <strong>Aucun résultat</strong>
                <p>Aucune proposition ne correspond à « ${escapeHtml(search.value)} ».</p>
            </div>`;
            return;
        }

        list.innerHTML = filtered.map(renderSubmission).join('');
    }

    function renderSubmission(item) {
        const title = [item.brand, item.model].map(clean).filter(Boolean).join(' ') || 'Véhicule proposé';
        const photoUrls = safeImages(item.photoUrls);
        const status = formatStatus(item.status);
        const vehicleType = clean(item.vehicleType) || 'Type non renseigné';
        const year = clean(item.year) || 'Année inconnue';
        const ownerName = clean(item.ownerName) || 'Propriétaire non renseigné';
        const location = clean(item.commune) || 'Commune non renseignée';
        const hasOwnerContact = Boolean(clean(item.ownerPhone) || clean(item.ownerEmail));
        const gallery = photoUrls.length
            ? `<div class="vehicle-sale-gallery vehicle-submission-gallery">
                <img src="${escapeHtml(photoUrls[0])}" alt="Photo de ${escapeHtml(title)}" loading="lazy">
                <span class="vehicle-sale-status ${statusClass(item.status)}">${escapeHtml(status)}</span>
                <span class="vehicle-submission-type-badge">${escapeHtml(vehicleType)}</span>
                ${photoUrls.length > 1 ? `<span class="vehicle-sale-photo-count"><span aria-hidden="true">▧</span> ${photoUrls.length} photos</span>` : ''}
            </div>`
            : `<div class="vehicle-sale-gallery is-empty vehicle-submission-gallery">
                <span class="vehicle-sale-status ${statusClass(item.status)}">${escapeHtml(status)}</span>
                <span class="vehicle-submission-type-badge">${escapeHtml(vehicleType)}</span>
                <svg aria-hidden="true" viewBox="0 0 96 64" focusable="false"><path d="M17 40h62l-5-17a8 8 0 0 0-8-6H32a8 8 0 0 0-8 6l-7 17Z"/><path d="M13 40h70v12H13z"/><circle cx="27" cy="52" r="7"/><circle cx="69" cy="52" r="7"/></svg>
                <span>Photo indisponible</span>
            </div>`;
        const features = [
            ['Année', year, '▦'],
            ['Kilométrage', item.mileage === 0 || item.mileage ? `${formatNumber(item.mileage)} km` : 'Non renseigné', '↗'],
            ['Carburant', item.fuel, '◉'],
            ['Transmission', item.transmission, '⚙'],
            ['Couleur', item.color, '◈'],
            ['Places', item.seats === 0 || item.seats ? `${clean(item.seats)} places` : '', '♙'],
            ['État', item.condition, '✓'],
        ];
        const listingIntent = clean(item.listingIntent) || clean(item.pricePeriod) || 'Intention non renseignée';

        return `<article class="vehicle-sale-card">
            ${gallery}
            <div class="vehicle-sale-content vehicle-submission-content">
                <header class="vehicle-sale-heading vehicle-submission-heading">
                    <h2 title="${escapeHtml(title)}">${escapeHtml(title)}</h2>
                    <p><span>${escapeHtml(year)}</span><span aria-hidden="true">•</span><span>${escapeHtml(vehicleType)}</span></p>
                </header>
                <p class="vehicle-submission-price"><strong>${escapeHtml(formatPrice(item.desiredPrice))} <small>USD</small></strong><span>${escapeHtml(listingIntent)}</span></p>
                <dl class="vehicle-submission-features">
                    ${features.map(([label, value, icon]) => `<div><dt><span aria-hidden="true">${icon}</span>${label}</dt><dd title="${escapeHtml(clean(value) || 'Non renseigné')}">${escapeHtml(clean(value) || 'Non renseigné')}</dd></div>`).join('')}
                </dl>
                <div class="vehicle-submission-location">
                    <span aria-hidden="true">⌖</span><div><small>Localisation</small><strong title="${escapeHtml(location)}">${escapeHtml(location)}</strong></div>
                    ${clean(item.address) ? `<p title="${escapeHtml(item.address)}">${escapeHtml(item.address)}</p>` : ''}
                </div>
                <div class="vehicle-submission-owner"><span aria-hidden="true">♙</span><strong title="${escapeHtml(ownerName)}">${escapeHtml(ownerName)}</strong><small>${hasOwnerContact ? 'Contact disponible dans les détails' : 'Coordonnées non renseignées'}</small></div>
                ${clean(item.additionalInformation) ? `<p class="vehicle-submission-description-preview">${escapeHtml(clean(item.additionalInformation))}</p>` : ''}
                <footer class="vehicle-submission-card-actions">
                    <button type="button" data-view-submission="${submissions.indexOf(item)}">Voir les détails <span aria-hidden="true">→</span></button>
                </footer>
            </div>
        </article>`;
    }

    function handleSubmissionClick(event) {
        const button = event.target.closest('[data-view-submission]');
        if (!button) return;
        const submission = submissions[Number(button.dataset.viewSubmission)];
        if (submission) showSubmissionDetails(submission);
    }

    function showSubmissionDetails(item) {
        const title = [item.brand, item.model].map(clean).filter(Boolean).join(' ') || 'Véhicule proposé';
        const photoUrls = safeImages(item.photoUrls);
        const ownerPhone = clean(item.ownerPhone);
        const phoneDigits = /^\+[1-9]\d{7,14}$/.test(ownerPhone) ? ownerPhone.slice(1) : '';
        const preferredContact = clean(item.preferredContact);
        const usesWhatsApp = preferredContact.toLocaleLowerCase('fr').includes('whatsapp');
        const contactHref = phoneDigits
            ? usesWhatsApp ? `https://wa.me/${phoneDigits}` : `tel:${ownerPhone}`
            : '';
        const ownerEmail = clean(item.ownerEmail);
        const gallery = photoUrls.length
            ? `<div class="vehicle-submission-detail-photos">${photoUrls.map((url, index) => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(url)}" alt="Photo ${index + 1} de ${escapeHtml(title)}" loading="lazy"></a>`).join('')}</div>`
            : '';

        detailsTitle.textContent = title;
        detailsBody.innerHTML = `${gallery}
            <section class="vehicle-submission-detail-section">
                <h3>Véhicule</h3>
                ${renderDetailRows([
                    ['Marque', item.brand], ['Modèle', item.model], ['Année', item.year],
                    ['Type', item.vehicleType], ['État', item.condition],
                    ['Kilométrage', item.mileage === 0 || item.mileage ? `${formatNumber(item.mileage)} km` : ''],
                    ['Carburant', item.fuel], ['Transmission', item.transmission],
                    ['Couleur', item.color], ['Places', item.seats],
                ])}
            </section>
            <section class="vehicle-submission-detail-section">
                <h3>Vente / location</h3>
                ${renderDetailRows([
                    ['Intention', item.listingIntent],
                    ['Prix souhaité', item.desiredPrice === 0 || item.desiredPrice ? `${formatPrice(item.desiredPrice)} USD` : ''],
                    ['Période du prix', item.pricePeriod], ['Jours disponibles', item.availableDays],
                    ['Heures disponibles', item.availableHours],
                ])}
            </section>
            <section class="vehicle-submission-detail-section">
                <h3>Localisation</h3>
                ${renderDetailRows([
                    ['Commune', item.commune], ['Adresse', item.address],
                    ['Commentaire de localisation', item.locationComment], ['Adresse de visite', item.visitAddress],
                ])}
            </section>
            <section class="vehicle-submission-detail-section">
                <h3>Propriétaire</h3>
                ${renderDetailRows([
                    ['Nom', item.ownerName], ['Email', ownerEmail], ['Téléphone', ownerPhone],
                    ['Contact préféré', preferredContact], ['ID propriétaire', item.ownerUid],
                ])}
            </section>
            ${clean(item.additionalInformation) ? `<section class="vehicle-submission-detail-section">
                <h3>Informations complémentaires</h3><p class="vehicle-submission-detail-copy">${escapeHtml(clean(item.additionalInformation))}</p>
            </section>` : ''}
            <section class="vehicle-submission-detail-section">
                <h3>Informations administratives</h3>
                ${renderDetailRows([
                    ['Date de soumission', formatDate(item.createdAt)], ['Référence', item.id],
                    ['Statut', formatStatus(item.status)],
                ])}
            </section>
            <footer class="vehicle-submission-detail-actions">
                ${contactHref ? `<a class="is-whatsapp" href="${escapeHtml(contactHref)}"${usesWhatsApp && phoneDigits ? ' target="_blank" rel="noopener noreferrer"' : ''}><span aria-hidden="true">◉</span> Contacter sur ${escapeHtml(preferredContact || 'téléphone')}</a>` : ''}
                ${ownerEmail ? `<a href="mailto:${encodeURIComponent(ownerEmail)}"><span aria-hidden="true">✉</span> Envoyer un email</a>` : ''}
            </footer>`;
        detailsDialog.showModal();
    }

    function renderDetailRows(fields) {
        return `<dl class="vehicle-submission-detail-grid">${fields.map(([label, value]) => `
            <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(clean(value) || 'Non renseigné')}</dd></div>
        `).join('')}</dl>`;
    }

    function statusClass(value) {
        const status = clean(value).toLocaleLowerCase('fr').replaceAll('_', ' ');
        if (isPending(status)) return 'is-pending';
        if (['approuvé', 'approuvée', 'approuve', 'approuvee', 'accepté', 'accepte'].includes(status)) return 'is-approved';
        if (['refusé', 'refusée', 'refuse', 'refusee', 'rejeté', 'rejete'].includes(status)) return 'is-rejected';
        if (['traité', 'traitée', 'traite', 'traitee', 'terminé', 'terminee'].includes(status)) return 'is-processed';
        if (['archivé', 'archivée', 'archive', 'archivee'].includes(status)) return 'is-archived';
        return 'is-unknown';
    }

    function safeImages(values) {
        if (!Array.isArray(values)) return [];
        return [...new Set(values.filter((value) => {
            if (typeof value !== 'string') return false;
            try {
                return new URL(value).protocol === 'https:';
            } catch {
                return false;
            }
        }))];
    }

    function isPending(value) {
        return ['en attente', 'en_attente', 'pending'].includes(clean(value).toLocaleLowerCase('fr'));
    }

    function formatStatus(value) {
        const status = clean(value);
        return isPending(status) ? 'En attente' : status || 'Statut inconnu';
    }

    function formatPrice(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return 'Prix non renseigné';
        return new Intl.NumberFormat('fr-FR', {
            minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
            maximumFractionDigits: 2,
        }).format(amount);
    }

    function formatNumber(value) {
        const amount = Number(value);
        return Number.isFinite(amount) ? new Intl.NumberFormat('fr-FR').format(amount) : '—';
    }

    function formatDate(value) {
        const date = parseDate(value);
        return date
            ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
            : 'Date inconnue';
    }

    function parseDate(value) {
        if (value && typeof value === 'object' && typeof value.seconds === 'number') {
            return new Date(value.seconds * 1000);
        }
        if (value && typeof value === 'object' && typeof value._seconds === 'number') {
            return new Date(value._seconds * 1000);
        }
        if (typeof value !== 'string' && typeof value !== 'number') return null;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function handleImageError(event) {
        const image = event.target;
        if (!(image instanceof HTMLImageElement)) return;
        const gallery = image.closest('.vehicle-sale-gallery');
        if (!gallery) return;
        const statusBadge = gallery.querySelector('.vehicle-sale-status');
        gallery.classList.add('is-empty');
        gallery.replaceChildren();
        const label = document.createElement('span');
        label.textContent = 'Photo indisponible';
        if (statusBadge) gallery.append(statusBadge);
        gallery.insertAdjacentHTML('beforeend', '<svg aria-hidden="true" viewBox="0 0 96 64" focusable="false"><path d="M17 40h62l-5-17a8 8 0 0 0-8-6H32a8 8 0 0 0-8 6l-7 17Z"/><path d="M13 40h70v12H13z"/><circle cx="27" cy="52" r="7"/><circle cx="69" cy="52" r="7"/></svg>');
        gallery.append(label);
    }

    async function readJsonResponse(response) {
        try {
            return await response.json();
        } catch {
            throw new Error('La réponse du serveur est illisible. Réessayez.');
        }
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

    function clearSession() {
        localStorage.removeItem('goying_access_token');
        localStorage.removeItem('goying_role');
    }
});
