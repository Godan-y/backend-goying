document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-vehicle-sales-page]');
    if (!page) return;

    const list = page.querySelector('[data-sales-list]');
    const count = page.querySelector('[data-sales-count]');
    const countLabel = page.querySelector('[data-sales-count-label]');
    const total = page.querySelector('[data-sales-total]');
    const available = page.querySelector('[data-sales-available]');
    const search = page.querySelector('[data-sales-search]');
    const statusFilter = page.querySelector('[data-sales-status-filter]');
    const feedback = page.querySelector('[data-sales-feedback]');
    const refreshButton = page.querySelector('[data-sales-refresh]');
    const refreshLabel = page.querySelector('[data-sales-refresh-label]');
    const detailDialog = document.querySelector('[data-sales-detail-dialog]');
    const detailTitle = detailDialog?.querySelector('[data-sales-detail-title]');
    const detailBody = detailDialog?.querySelector('[data-sales-detail-body]');
    const detailClose = detailDialog?.querySelector('[data-sales-detail-close]');
    const actionDialog = document.querySelector('[data-sales-action-dialog]');
    const actionTitle = actionDialog?.querySelector('[data-sales-action-title]');
    const actionMessage = actionDialog?.querySelector('[data-sales-action-message]');
    const actionCancel = actionDialog?.querySelector('[data-sales-action-cancel]');
    const actionConfirm = actionDialog?.querySelector('[data-sales-action-confirm]');
    const actionClose = actionDialog?.querySelector('[data-sales-action-close]');
    const token = localStorage.getItem('goying_access_token');

    if (!list || !count || !countLabel || !total || !available || !search || !statusFilter || !feedback
        || !refreshButton || !refreshLabel || !token
        || !detailDialog || !detailTitle || !detailBody || !detailClose
        || !actionDialog || !actionTitle || !actionMessage || !actionCancel
        || !actionConfirm || !actionClose
        || localStorage.getItem('goying_role') !== 'voitures') {
        clearSession();
        window.location.href = '/';
        return;
    }

    let sales = [];
    let isLoading = false;
    let hasLoaded = false;
    let confirmedAction = null;
    const pendingSaleActions = new Set();

    page.querySelector('[data-sales-logout]').addEventListener('click', () => {
        clearSession();
        window.location.href = '/';
    });
    refreshButton.addEventListener('click', loadSales);
    search.addEventListener('input', renderSales);
    statusFilter.addEventListener('change', renderSales);
    list.addEventListener('error', handleImageError, true);
    list.addEventListener('click', handleSaleClick);
    detailBody.addEventListener('error', handleDetailImageError, true);
    detailBody.addEventListener('click', handleDetailActionClick);
    detailClose.addEventListener('click', () => detailDialog.close());
    actionCancel.addEventListener('click', () => actionDialog.close());
    actionClose.addEventListener('click', () => actionDialog.close());
    actionConfirm.addEventListener('click', runConfirmedAction);
    detailDialog.addEventListener('click', (event) => {
        if (event.target === detailDialog) detailDialog.close();
    });
    actionDialog.addEventListener('click', (event) => {
        if (event.target === actionDialog
            && (!confirmedAction || !pendingSaleActions.has(clean(confirmedAction.sale.id)))) {
            actionDialog.close();
        }
    });
    actionDialog.addEventListener('cancel', (event) => {
        if (confirmedAction && pendingSaleActions.has(clean(confirmedAction.sale.id))) {
            event.preventDefault();
        }
    });

    loadSales();

    async function loadSales() {
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
                throw new Error(payload.detail || 'Impossible de charger les annonces.');
            }
            if (!Array.isArray(payload.sales)) {
                throw new Error('La réponse du serveur ne contient pas la liste des annonces.');
            }

            sales = payload.sales;
            hasLoaded = true;
            updateStatusFilter();
            updateStatistics();
            renderSales();
            feedback.textContent = '';
            feedback.className = 'vehicle-sales-feedback';
        } catch (error) {
            const message = error instanceof TypeError
                ? 'Erreur réseau. Vérifiez votre connexion puis réessayez.'
                : error instanceof Error
                    ? error.message
                    : 'Impossible de charger les annonces.';
            if (!hasLoaded) {
                list.innerHTML = `<div class="vehicle-sales-state is-error" role="alert">
                    <span aria-hidden="true">!</span>
                    <strong>Impossible de charger les annonces</strong>
                    <p>${escapeHtml(message)}</p>
                    <button type="button" data-sales-retry>Réessayer</button>
                </div>`;
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
        total.textContent = String(sales.length);
        available.textContent = String(sales.filter((sale) => clean(sale.status).toLowerCase() === 'disponible').length);
        count.textContent = String(filteredSales().length);
    }

    function updateStatusFilter() {
        const current = statusFilter.value;
        const statuses = [...new Set(sales.map((sale) => clean(sale.status)).filter(Boolean))]
            .sort((first, second) => first.localeCompare(second, 'fr'));
        statusFilter.innerHTML = '<option value="">Tous les statuts</option>'
            + statuses.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join('');
        if (statuses.includes(current)) statusFilter.value = current;
    }

    function filteredSales() {
        const query = clean(search.value).toLocaleLowerCase('fr');
        return sales.filter((sale) => {
            if (statusFilter.value && clean(sale.status) !== statusFilter.value) return false;
            if (!query) return true;
            return [
                sale.brand,
                sale.model,
                sale.year,
                sale.vehicleType,
                sale.condition,
                sale.fuel,
                sale.transmission,
                sale.city,
                sale.commune,
                sale.sellerWhatsApp,
                sale.description,
                sale.status,
                sale.id,
                sale.createdBy,
            ].some((value) => clean(value).toLocaleLowerCase('fr').includes(query));
        });
    }

    function renderSales() {
        if (!hasLoaded) return;
        const filtered = filteredSales();
        count.textContent = String(filtered.length);
        countLabel.textContent = filtered.length === 1 ? 'annonce' : 'annonces';

        if (!sales.length) {
            list.innerHTML = `<div class="vehicle-sales-state">
                <span aria-hidden="true">▱</span>
                <strong>Aucune annonce de véhicule</strong>
                <p>Aucun véhicule n'est actuellement disponible dans les annonces de vente.</p>
                <a href="/voitures/vente/ajouter">Ajouter une annonce</a>
            </div>`;
            return;
        }
        if (!filtered.length) {
            list.innerHTML = `<div class="vehicle-sales-state">
                <span aria-hidden="true">⌕</span>
                <strong>Aucun résultat</strong>
                <p>Aucune annonce ne correspond aux critères sélectionnés.</p>
            </div>`;
            return;
        }

        list.innerHTML = filtered.map((sale) => renderSale(sale, sales.indexOf(sale))).join('');
    }

    function renderSale(sale, index) {
        const images = safeImages(sale);
        const title = [sale.brand, sale.model].map(clean).filter(Boolean).join(' ') || 'Voiture sans nom';
        const location = [sale.commune, sale.city].map(clean).filter(Boolean).join(', ');
        const price = formatPrice(sale.priceUsd);
        const whatsapp = clean(sale.sellerWhatsApp);
        const whatsappDigits = normalizeWhatsAppPhone(whatsapp);
        const whatsappLink = whatsappDigits
            ? `<a class="vehicle-sale-contact" href="https://wa.me/${whatsappDigits}?text=${encodeURIComponent(buildSellerMessage(sale))}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">◉</span> Contacter le vendeur</a>`
            : '<span class="vehicle-sale-contact is-unavailable">Contact vendeur indisponible</span>';
        const features = [
            ['Kilométrage', sale.mileage === 0 || sale.mileage ? `${formatNumber(sale.mileage)} km` : 'Non renseigné', '↗'],
            ['Transmission', sale.transmission, '⚙'],
            ['Carburant', sale.fuel, '◉'],
            ['État', sale.condition, '✓'],
        ];
        const status = clean(sale.status) || 'Statut inconnu';
        const normalizedStatus = status.toLocaleLowerCase('fr');
        const nextAvailabilityStatus = normalizedStatus === 'disponible'
            ? 'Indisponible'
            : normalizedStatus === 'indisponible' ? 'Disponible' : '';
        const year = clean(sale.year) || 'Année inconnue';
        const vehicleType = clean(sale.vehicleType) || 'Type inconnu';
        const managementActions = `<div class="vehicle-sale-management-actions">
            ${nextAvailabilityStatus ? `<button type="button" class="vehicle-sale-status-action" data-sale-action="status" data-sale-index="${index}" data-next-status="${nextAvailabilityStatus}">${nextAvailabilityStatus === 'Indisponible' ? 'Rendre indisponible' : 'Remettre disponible'}</button>` : ''}
            <button type="button" class="vehicle-sale-delete-action" data-sale-action="delete" data-sale-index="${index}">Supprimer</button>
        </div>`;
        const imageGallery = images.length
            ? `<div class="vehicle-sale-gallery">
                <img src="${escapeHtml(images[0])}" alt="Photo de ${escapeHtml(title)}" loading="lazy">
                <span class="vehicle-sale-status ${statusClass(status)}">${escapeHtml(status)}</span>
                ${images.length > 1 ? `<button type="button" class="vehicle-sale-photo-count" data-view-sale="${index}" aria-label="Voir les ${images.length} photos">${images.length} photos</button>` : ''}
            </div>`
            : `<div class="vehicle-sale-gallery is-empty">
                <span class="vehicle-sale-status ${statusClass(status)}">${escapeHtml(status)}</span>
                <svg aria-hidden="true" viewBox="0 0 96 64" focusable="false"><path d="M17 40h62l-5-17a8 8 0 0 0-8-6H32a8 8 0 0 0-8 6l-7 17Z"/><path d="M13 40h70v12H13z"/><circle cx="27" cy="52" r="7"/><circle cx="69" cy="52" r="7"/></svg>
                <span>Photo indisponible</span>
            </div>`;

        return `<article class="vehicle-sale-card">
            ${imageGallery}
            <div class="vehicle-sale-content">
                <header class="vehicle-sale-heading">
                    <h2 title="${escapeHtml(title)}">${escapeHtml(title)}</h2>
                    <p>${escapeHtml(year)} <span aria-hidden="true">•</span> ${escapeHtml(vehicleType)}</p>
                </header>
                <p class="vehicle-sale-price"><span>${escapeHtml(price)} <small>USD</small></span>${sale.priceNegotiable ? '<span class="vehicle-sale-negotiable">Négociable</span>' : ''}</p>
                <dl class="vehicle-sale-details">
                    ${features.map(([label, value, icon]) => `<div><dt><span aria-hidden="true">${icon}</span>${label}</dt><dd>${escapeHtml(clean(value) || 'Non renseigné')}</dd></div>`).join('')}
                </dl>
                <p class="vehicle-sale-location" title="${escapeHtml(location || 'Localisation non renseignée')}"><span aria-hidden="true">⌖</span><span>${escapeHtml(location || 'Localisation non renseignée')}</span></p>
                ${clean(sale.description) ? `<section class="vehicle-sale-description">
                    <p class="vehicle-sale-description-preview">${escapeHtml(clean(sale.description))}</p>
                    <details><summary>Voir la description complète</summary><p>${escapeHtml(clean(sale.description))}</p></details>
                </section>` : ''}
                <footer class="vehicle-sale-footer">
                    ${whatsappLink}
                    <button type="button" class="vehicle-sale-details-button" data-view-sale="${index}">Voir les détails <span aria-hidden="true">→</span></button>
                </footer>
                ${managementActions}
            </div>
        </article>`;
    }

    function handleSaleClick(event) {
        if (event.target.closest('[data-sales-retry]')) {
            loadSales();
            return;
        }
        const actionButton = event.target.closest('[data-sale-action]');
        if (actionButton) {
            const sale = sales[Number(actionButton.dataset.saleIndex)];
            if (sale) openSaleAction(sale, actionButton.dataset.saleAction, actionButton.dataset.nextStatus || '');
            return;
        }
        const button = event.target.closest('[data-view-sale]');
        if (!button) return;
        const sale = sales[Number(button.dataset.viewSale)];
        if (sale) showSaleDetails(sale);
    }

    function handleDetailActionClick(event) {
        const button = event.target.closest('[data-sale-action]');
        if (!button) return;
        const sale = sales[Number(button.dataset.saleIndex)];
        if (sale) openSaleAction(sale, button.dataset.saleAction, button.dataset.nextStatus || '');
    }

    function openSaleAction(sale, action, nextStatus) {
        if (pendingSaleActions.has(clean(sale.id))) return;
        confirmedAction = { sale, action, nextStatus };
        if (action === 'status') {
            actionTitle.textContent = nextStatus === 'Indisponible'
                ? 'Rendre l’annonce indisponible'
                : 'Remettre l’annonce disponible';
            actionMessage.textContent = nextStatus === 'Indisponible'
                ? 'Confirmer que cette annonce ne doit plus être proposée comme disponible ?'
                : 'Confirmer que cette annonce peut à nouveau être proposée comme disponible ?';
            actionConfirm.textContent = nextStatus === 'Indisponible'
                ? 'Confirmer indisponible'
                : 'Confirmer disponible';
            actionConfirm.className = 'is-primary';
        } else if (action === 'delete') {
            const title = [sale.brand, sale.model].map(clean).filter(Boolean).join(' ') || 'cette annonce';
            actionTitle.textContent = 'Supprimer l’annonce';
            actionMessage.textContent = `Voulez-vous vraiment supprimer l’annonce « ${title} » ? Cette action supprimera également ses photos enregistrées.`;
            actionConfirm.textContent = 'Confirmer la suppression';
            actionConfirm.className = 'is-danger';
        } else {
            confirmedAction = null;
            return;
        }
        actionDialog.showModal();
    }

    async function runConfirmedAction() {
        if (!confirmedAction) return;
        const { sale, action, nextStatus } = confirmedAction;
        const saleId = clean(sale.id);
        if (!saleId || pendingSaleActions.has(saleId)) return;

        pendingSaleActions.add(saleId);
        const actionButtons = [...actionDialog.querySelectorAll('button')];
        actionButtons.forEach((button) => { button.disabled = true; });
        actionConfirm.textContent = action === 'delete' ? 'Suppression…' : 'Mise à jour…';
        try {
            const response = await fetch(
                action === 'delete'
                    ? `${page.dataset.endpoint}/${encodeURIComponent(saleId)}`
                    : `${page.dataset.endpoint}/${encodeURIComponent(saleId)}/statut`,
                {
                    method: action === 'delete' ? 'DELETE' : 'PATCH',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        ...(action === 'status' ? { 'Content-Type': 'application/json' } : {}),
                    },
                    ...(action === 'status' ? { body: JSON.stringify({ status: nextStatus }) } : {}),
                },
            );
            const payload = await readJsonResponse(response);
            if (response.status === 401 || response.status === 403) {
                clearSession();
                window.location.href = '/';
                return;
            }
            if (!response.ok) throw new Error(payload.detail || 'Impossible de gérer cette annonce.');

            actionDialog.close();
            confirmedAction = null;
            if (action === 'delete') {
                if (detailDialog.open) detailDialog.close();
                sales = sales.filter((entry) => clean(entry.id) !== saleId);
                updateStatusFilter();
                updateStatistics();
                renderSales();
                setFeedback('Annonce et photos supprimées.');
            } else {
                sale.status = payload.status;
                sale.updatedAt = new Date().toISOString();
                updateStatusFilter();
                updateStatistics();
                renderSales();
                setFeedback('Statut de l’annonce mis à jour.');
                if (detailDialog.open) showSaleDetails(sale);
            }
        } catch (error) {
            const message = error instanceof TypeError
                ? 'Erreur réseau. Vérifiez votre connexion puis réessayez.'
                : error instanceof Error ? error.message : 'Impossible de gérer cette annonce.';
            if (action === 'delete') {
                await loadSales();
                if (!sales.some((entry) => clean(entry.id) === saleId)) {
                    actionDialog.close();
                    confirmedAction = null;
                }
            }
            setFeedback(message, true);
            actionConfirm.textContent = action === 'delete'
                ? 'Confirmer la suppression'
                : `Confirmer ${nextStatus.toLowerCase()}`;
        } finally {
            actionButtons.forEach((button) => { button.disabled = false; });
            pendingSaleActions.delete(saleId);
        }
    }

    function setFeedback(message, isError = false) {
        feedback.textContent = message;
        feedback.className = isError
            ? 'vehicle-sales-feedback is-error'
            : 'vehicle-sales-feedback is-success';
    }

    function showSaleDetails(sale) {
        const images = safeImages(sale);
        const title = [sale.brand, sale.model].map(clean).filter(Boolean).join(' ') || 'Voiture sans nom';
        const whatsapp = clean(sale.sellerWhatsApp);
        const whatsappDigits = normalizeWhatsAppPhone(whatsapp);
        const location = [sale.commune, sale.city].map(clean).filter(Boolean).join(', ');
        const imageGallery = images.length
            ? `<div class="vehicle-sale-detail-gallery">${images.map((image, index) => `
                <a href="${escapeHtml(image)}" target="_blank" rel="noopener noreferrer">
                    <img src="${escapeHtml(image)}" alt="Photo ${index + 1} de ${escapeHtml(title)}" loading="lazy">
                    <span>Photo ${index + 1}</span>
                </a>`).join('')}</div>`
            : '<p class="vehicle-sale-detail-no-photos">Aucune photo disponible pour cette annonce.</p>';
        const sellerLink = whatsappDigits
            ? `<a class="vehicle-sale-contact" href="https://wa.me/${whatsappDigits}?text=${encodeURIComponent(buildSellerMessage(sale))}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">◉</span> Contacter le vendeur</a>`
            : '<span class="vehicle-sale-contact is-unavailable">Contact vendeur indisponible</span>';

        detailTitle.textContent = title;
        detailBody.innerHTML = `${imageGallery}
            <section class="vehicle-sale-detail-section">
                <h3>🚗 Véhicule</h3>
                ${renderDetailRows([
                    ['Marque', sale.brand], ['Modèle', sale.model], ['Année', sale.year],
                    ['Type', sale.vehicleType], ['État', sale.condition], ['Carburant', sale.fuel],
                    ['Transmission', sale.transmission], ['Kilométrage', sale.mileage === 0 || sale.mileage ? `${formatNumber(sale.mileage)} km` : ''],
                    ['Statut', sale.status],
                ])}
            </section>
            <section class="vehicle-sale-detail-section">
                <h3>💰 Prix</h3>
                ${renderDetailRows([
                    ['Prix', sale.priceUsd === 0 || sale.priceUsd ? `${formatPrice(sale.priceUsd)} USD` : ''],
                    ['Négociable', sale.priceNegotiable ? 'Oui' : 'Non'],
                ])}
            </section>
            <section class="vehicle-sale-detail-section">
                <h3>📍 Localisation</h3>
                ${renderDetailRows([['Ville', sale.city], ['Commune', sale.commune], ['Adresse complète', location]])}
            </section>
            ${clean(sale.description) ? `<section class="vehicle-sale-detail-section">
                <h3>📝 Description</h3><p class="vehicle-sale-detail-description">${escapeHtml(clean(sale.description))}</p>
            </section>` : ''}
            <section class="vehicle-sale-detail-section">
                <h3>ℹ️ Informations administratives</h3>
                ${renderDetailRows([
                    ['Vendeur WhatsApp', whatsapp], ['Ajoutée le', formatDate(sale.createdAt)],
                    ['Modifiée le', formatDate(sale.updatedAt)], ['Ajoutée par', sale.createdBy],
                    ['Référence', sale.id],
                ])}
            </section>
            <footer class="vehicle-sale-detail-actions">
                ${sellerLink}
                ${availabilityActionMarkup(sale)}
                <button type="button" class="vehicle-sale-delete-action" data-sale-action="delete" data-sale-index="${sales.indexOf(sale)}">Supprimer l’annonce</button>
            </footer>`;
        if (!detailDialog.open) detailDialog.showModal();
    }

    function availabilityActionMarkup(sale) {
        const normalizedStatus = clean(sale.status).toLocaleLowerCase('fr');
        const nextStatus = normalizedStatus === 'disponible'
            ? 'Indisponible'
            : normalizedStatus === 'indisponible' ? 'Disponible' : '';
        if (!nextStatus) return '';
        const label = nextStatus === 'Indisponible' ? 'Rendre indisponible' : 'Remettre disponible';
        return `<button type="button" class="vehicle-sale-status-action" data-sale-action="status" data-sale-index="${sales.indexOf(sale)}" data-next-status="${nextStatus}">${label}</button>`;
    }

    function renderDetailRows(fields) {
        return `<dl class="vehicle-sale-detail-grid">${fields.map(([label, value]) => `
            <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(clean(value) || 'Non renseigné')}</dd></div>
        `).join('')}</dl>`;
    }

    function buildSellerMessage(sale) {
        const title = [sale.brand, sale.model].map(clean).filter(Boolean).join(' ') || 'votre véhicule';
        const location = [sale.commune, sale.city].map(clean).filter(Boolean).join(', ');
        const photo = safeImages(sale)[0];
        return [
            'Bonjour,',
            '',
            `Je vous contacte au sujet de votre annonce Goying : ${title}.`,
            clean(sale.year) ? `Année : ${clean(sale.year)}` : '',
            sale.priceUsd === 0 || sale.priceUsd ? `Prix : ${formatPrice(sale.priceUsd)} USD` : '',
            location ? `Localisation : ${location}` : '',
            photo ? `Photo : ${photo}` : '',
            '',
            'Cordialement,',
            'Goying',
        ].filter((line) => line !== '').join('\n');
    }

    function normalizeWhatsAppPhone(value) {
        const phone = clean(value).replace(/[\s().-]/g, '');
        const digits = phone.startsWith('+') ? phone.slice(1) : phone;
        return /^[1-9]\d{7,14}$/.test(digits) ? digits : '';
    }

    function safeImages(sale) {
        const candidates = [
            ...(Array.isArray(sale.imageUrls) ? sale.imageUrls : []),
            sale.imageUrl,
        ];
        return [...new Set(candidates.filter((value) => {
            if (typeof value !== 'string') return false;
            try {
                return new URL(value).protocol === 'https:';
            } catch {
                return false;
            }
        }))];
    }

    function statusClass(status) {
        const normalized = status.toLocaleLowerCase('fr');
        if (normalized === 'disponible') return 'is-available';
        if (normalized === 'indisponible') return 'is-unavailable';
        if (normalized === 'réservé' || normalized === 'reserve' || normalized === 'réservée' || normalized === 'reservee') {
            return 'is-reserved';
        }
        if (normalized === 'vendu' || normalized === 'vendue') return 'is-sold';
        return 'is-other';
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
        const timestamp = new Date(value);
        return Number.isNaN(timestamp.getTime()) ? null : timestamp;
    }

    function handleImageError(event) {
        const image = event.target;
        if (!(image instanceof HTMLImageElement)) return;
        const gallery = image.closest('.vehicle-sale-gallery');
        if (!gallery) return;
        const statusBadge = gallery.querySelector('.vehicle-sale-status');
        gallery.classList.add('is-empty');
        gallery.replaceChildren();
        const icon = document.createElement('span');
        const label = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '▣';
        label.textContent = 'Photo indisponible';
        if (statusBadge) gallery.append(statusBadge);
        gallery.append(icon, label);
    }

    function handleDetailImageError(event) {
        const image = event.target;
        if (!(image instanceof HTMLImageElement)) return;
        const photo = image.closest('.vehicle-sale-detail-gallery a');
        if (!photo) return;
        image.remove();
        const unavailable = document.createElement('span');
        unavailable.className = 'vehicle-sale-detail-photo-unavailable';
        unavailable.textContent = 'Photo indisponible';
        photo.prepend(unavailable);
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
