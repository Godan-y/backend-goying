document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-vehicles-page]');
    const list = document.querySelector('#vehicles-list');
    const count = document.querySelector('#vehicles-count');
    const totalCount = document.querySelector('#vehicles-total');
    const availableCount = document.querySelector('#vehicles-available');
    const unavailableCount = document.querySelector('#vehicles-unavailable');
    const feedback = document.querySelector('#vehicles-feedback');
    const refreshButton = document.querySelector('#refresh-vehicles');
    const refreshLabel = refreshButton?.querySelector('[data-refresh-label]');
    const logoutButton = document.querySelector('#logout-button');
    const deleteDialog = document.querySelector('#fleet-delete-dialog');
    const deleteName = document.querySelector('#fleet-delete-name');
    const deleteError = document.querySelector('#fleet-delete-error');
    const deleteConfirm = document.querySelector('#fleet-delete-confirm');
    const deleteCancel = document.querySelector('#fleet-delete-cancel');
    const token = localStorage.getItem('goying_access_token');
    const role = localStorage.getItem('goying_role');

    if (!page || !list || !count || !totalCount || !availableCount || !unavailableCount
        || !feedback || !refreshButton || !refreshLabel || !logoutButton || !deleteDialog
        || !deleteName || !deleteError || !deleteConfirm || !deleteCancel || !token || role !== 'voitures') {
        clearSession();
        window.location.href = '/';
        return;
    }

    let vehicles = [];
    let hasLoaded = false;
    let isLoading = false;
    let pendingDeleteId = null;
    let isDeleting = false;

    logoutButton.addEventListener('click', () => {
        clearSession();
        window.location.href = '/';
    });
    refreshButton.addEventListener('click', () => loadVehicles());
    list.addEventListener('click', handleVehicleAction);
    list.addEventListener('error', handleImageError, true);
    deleteConfirm.addEventListener('click', deleteVehicle);
    deleteDialog.addEventListener('close', clearPendingDelete);
    deleteDialog.addEventListener('cancel', (event) => {
        if (isDeleting) event.preventDefault();
    });

    loadVehicles();

    async function loadVehicles() {
        if (isLoading) return false;
        isLoading = true;
        refreshButton.disabled = true;
        refreshButton.setAttribute('aria-busy', 'true');
        refreshLabel.textContent = 'Actualisation…';
        list.setAttribute('aria-busy', 'true');
        if (!hasLoaded) feedback.textContent = '';

        try {
            const response = await fetch(page.dataset.endpoint, {
                headers: authHeaders(),
                cache: 'no-store',
            });
            const payload = await readJsonResponse(response);
            if (!response.ok) throw new Error(formatApiError(payload.detail));
            if (!Array.isArray(payload.vehicles)) {
                throw new Error('La réponse du serveur ne contient pas la liste des véhicules.');
            }

            vehicles = payload.vehicles;
            hasLoaded = true;
            updateStatistics();
            renderVehicles();
            showFeedback('', 'success');
            return true;
        } catch (error) {
            const message = getErrorMessage(error);
            if (!hasLoaded) renderLoadError(message);
            showFeedback(message, 'error');
            return false;
        } finally {
            isLoading = false;
            refreshButton.disabled = false;
            refreshButton.removeAttribute('aria-busy');
            refreshLabel.textContent = 'Actualiser';
            list.setAttribute('aria-busy', 'false');
        }
    }

    async function handleVehicleAction(event) {
        const featureToggle = event.target.closest('[data-toggle-features]');
        if (featureToggle) {
            toggleFeatures(featureToggle);
            return;
        }

        const galleryButton = event.target.closest('[data-gallery-step]');
        if (galleryButton) {
            changeGalleryPhoto(galleryButton);
            return;
        }

        if (event.target.closest('[data-retry-vehicles]')) {
            loadVehicles();
            return;
        }

        const button = event.target.closest('[data-vehicle-action]');
        if (!button || button.disabled) return;
        const vehicle = vehicles.find((item) => String(item.id) === button.dataset.id);
        if (!vehicle) {
            showFeedback('Ce véhicule n’est plus présent dans la liste. Actualisez les données.', 'error');
            return;
        }

        if (button.dataset.vehicleAction === 'delete') {
            pendingDeleteId = String(vehicle.id);
            deleteName.textContent = `${vehicle.brand || 'Véhicule'} ${vehicle.model || ''}`.trim();
            deleteError.textContent = '';
            deleteError.hidden = true;
            deleteConfirm.disabled = false;
            deleteCancel.disabled = false;
            deleteConfirm.textContent = 'Supprimer';
            deleteDialog.showModal();
            return;
        }

        if (button.dataset.vehicleAction === 'availability') {
            await changeAvailability(button, vehicle);
        }
    }

    async function changeAvailability(button, vehicle) {
        const nextAvailability = button.dataset.available === 'true';
        const card = button.closest('[data-vehicle-card]');
        setCardBusy(card, true);
        button.textContent = 'Mise à jour…';
        showFeedback('', 'success');

        try {
            const response = await fetch(`/api/voitures/${encodeURIComponent(vehicle.id)}/availability`, {
                method: 'PATCH',
                headers: {
                    ...authHeaders(),
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ is_available: nextAvailability }),
            });
            const payload = await readJsonResponse(response);
            if (!response.ok) throw new Error(formatApiError(payload.detail));
            if (payload.isAvailable !== nextAvailability) {
                throw new Error('Le serveur n’a pas confirmé le nouvel état de disponibilité. Actualisez les données.');
            }

            vehicle.isAvailable = payload.isAvailable;
            updateStatistics();
            renderVehicles();
            showFeedback(payload.message || 'Disponibilité mise à jour.', 'success');
        } catch (error) {
            showFeedback(getErrorMessage(error), 'error');
            setCardBusy(card, false);
            button.textContent = button.dataset.available === 'true' ? 'Rendre disponible' : 'Rendre indisponible';
        }
    }

    async function deleteVehicle() {
        if (!pendingDeleteId || isDeleting) return;
        const vehicleId = pendingDeleteId;
        const vehicle = vehicles.find((item) => String(item.id) === vehicleId);
        if (!vehicle) {
            deleteError.textContent = 'Ce véhicule n’est plus présent dans la liste. Actualisez les données.';
            deleteError.hidden = false;
            return;
        }

        isDeleting = true;
        deleteConfirm.disabled = true;
        deleteCancel.disabled = true;
        deleteConfirm.textContent = 'Suppression…';
        deleteError.textContent = '';
        deleteError.hidden = true;
        showFeedback('', 'success');

        try {
            const response = await fetch(`/api/voitures/${encodeURIComponent(vehicleId)}`, {
                method: 'DELETE',
                headers: authHeaders(),
            });
            const payload = await readJsonResponse(response);
            if (!response.ok) {
                const message = formatApiError(payload.detail);
                if (message.toLocaleLowerCase('fr').includes('voiture a été supprimée')) {
                    removeVehicle(vehicleId);
                    pendingDeleteId = null;
                    deleteDialog.close();
                    showFeedback(message, 'error');
                    return;
                }
                throw new Error(message);
            }

            removeVehicle(vehicleId);
            pendingDeleteId = null;
            deleteDialog.close();
            showFeedback(payload.message || 'Véhicule supprimé de la flotte.', 'success');
        } catch (error) {
            deleteError.textContent = getErrorMessage(error);
            deleteError.hidden = false;
        } finally {
            isDeleting = false;
            deleteConfirm.disabled = false;
            deleteCancel.disabled = false;
            deleteConfirm.textContent = 'Supprimer';
        }
    }

    function removeVehicle(vehicleId) {
        vehicles = vehicles.filter((vehicle) => String(vehicle.id) !== vehicleId);
        updateStatistics();
        renderVehicles();
    }

    function updateStatistics() {
        const available = vehicles.filter((vehicle) => vehicle.isAvailable === true).length;
        const unavailable = vehicles.filter((vehicle) => vehicle.isAvailable === false).length;
        count.textContent = String(vehicles.length);
        totalCount.textContent = String(vehicles.length);
        availableCount.textContent = String(available);
        unavailableCount.textContent = String(unavailable);
    }

    function renderVehicles() {
        list.innerHTML = vehicles.length
            ? vehicles.map(renderVehicle).join('')
            : `<div class="fleet-empty-state">
                <span class="fleet-empty-icon" aria-hidden="true">🚗</span>
                <h2>Aucun véhicule</h2>
                <p class="status-text">Aucun véhicule n’est actuellement enregistré dans votre flotte.</p>
                <a class="primary-button fleet-empty-action" href="/voitures/ajouter">+ Ajouter une voiture à louer</a>
            </div>`;
    }

    function renderLoadError(message) {
        count.textContent = '—';
        totalCount.textContent = '—';
        availableCount.textContent = '—';
        unavailableCount.textContent = '—';
        list.innerHTML = `<div class="fleet-load-error" role="alert">
            <span class="fleet-load-error-icon" aria-hidden="true">!</span>
            <h2>Impossible de charger les véhicules</h2>
            <p>${escapeHtml(message)}</p>
            <button type="button" class="secondary-button" data-retry-vehicles>Réessayer</button>
        </div>`;
    }

    function renderVehicle(vehicle) {
        const id = String(vehicle.id ?? '');
        const brand = vehicle.brand || 'Marque inconnue';
        const model = vehicle.model || '';
        const name = `${brand} ${model}`.trim();
        const photos = getPhotoUrls(vehicle);
        const isAvailable = vehicle.isAvailable === true;
        const isUnavailable = vehicle.isAvailable === false;
        const statusLabel = isAvailable ? 'Disponible' : isUnavailable ? 'Indisponible' : 'Statut à vérifier';
        const statusClass = isAvailable ? 'is-available' : isUnavailable ? 'is-unavailable' : 'is-unknown';
        const features = getFeatures(vehicle.features);
        const visibleFeatures = features.slice(0, 4);
        const hiddenFeatures = features.slice(4);
        const price = vehicle.pricePerDay !== null && vehicle.pricePerDay !== undefined && vehicle.pricePerDay !== '';
        const availableAction = isUnavailable || isAvailable;
        const nextAvailable = isUnavailable;
        const nextLabel = isAvailable ? 'Rendre indisponible' : 'Rendre disponible';

        return `<article class="vehicle-card fleet-vehicle-card" data-vehicle-card data-id="${escapeHtml(id)}">
            <div class="fleet-vehicle-image${photos.length ? '' : ' is-empty'}" data-photo-index="0">
                ${photos.length
                    ? `<img src="${escapeHtml(photos[0])}" alt="${escapeHtml(name)}" loading="lazy" data-vehicle-image data-photos="${escapeHtml(JSON.stringify(photos))}" data-vehicle-name="${escapeHtml(name)}">
                        <div class="vehicle-image-placeholder" hidden><span aria-hidden="true">🚗</span><small>Photo indisponible</small></div>
                        ${photos.length > 1 ? `<button type="button" class="fleet-gallery-step is-previous" data-gallery-step="-1" aria-label="Photo précédente pour ${escapeHtml(name)}">‹</button>
                        <button type="button" class="fleet-gallery-step is-next" data-gallery-step="1" aria-label="Photo suivante pour ${escapeHtml(name)}">›</button>
                        <span class="fleet-gallery-count" aria-live="polite">1 / ${photos.length}</span>` : ''}
                    `
                    : '<div class="vehicle-image-placeholder"><span aria-hidden="true">🚗</span><small>Photo indisponible</small></div>'}
                <span class="fleet-availability-badge ${statusClass}">${statusLabel}</span>
            </div>
            <div class="vehicle-content">
                <div class="fleet-vehicle-heading">
                    <p class="eyebrow">${escapeHtml(vehicle.category || 'Véhicule')}</p>
                    <h2 title="${escapeHtml(name)}">${escapeHtml(name)}</h2>
                </div>
                <p class="fleet-vehicle-price">${price
                    ? `${escapeHtml(vehicle.pricePerDay)} ${escapeHtml(vehicle.currency || '')} <span>/ jour</span>`
                    : '<span class="fleet-missing-value">Prix non renseigné</span>'}</p>
                <div class="fleet-vehicle-specs">
                    ${vehicle.fuel ? `<p><span class="fleet-spec-icon" aria-hidden="true">◉</span><span><small>Carburant</small><strong>${escapeHtml(vehicle.fuel)}</strong></span></p>` : ''}
                    ${vehicle.transmission ? `<p><span class="fleet-spec-icon" aria-hidden="true">⚙</span><span><small>Transmission</small><strong>${escapeHtml(vehicle.transmission)}</strong></span></p>` : ''}
                    ${vehicle.seats !== null && vehicle.seats !== undefined && vehicle.seats !== '' ? `<p><span class="fleet-spec-icon" aria-hidden="true">♙</span><span><small>Places</small><strong>${escapeHtml(vehicle.seats)}</strong></span></p>` : ''}
                </div>
                ${features.length ? `<section class="fleet-features" aria-label="Équipements">
                    <h3>Équipements</h3>
                    <div class="fleet-feature-tags">${visibleFeatures.map((feature) => `<span>${escapeHtml(feature)}</span>`).join('')}
                        ${hiddenFeatures.map((feature) => `<span data-extra-feature hidden>${escapeHtml(feature)}</span>`).join('')}
                    </div>
                    ${hiddenFeatures.length ? `<button type="button" class="fleet-feature-toggle" data-toggle-features aria-expanded="false">Voir ${hiddenFeatures.length} de plus</button>` : ''}
                </section>` : ''}
                <div class="vehicle-actions fleet-vehicle-actions">
                    <button type="button" class="status-button fleet-availability-button" data-vehicle-action="availability" data-id="${escapeHtml(id)}" data-available="${nextAvailable}"${availableAction ? '' : ' disabled'}>${availableAction ? nextLabel : 'Statut à vérifier'}</button>
                    <a class="secondary-button vehicle-edit-link" href="/voitures/${encodeURIComponent(id)}/modifier">Modifier</a>
                    <button type="button" class="danger-button fleet-delete-button" data-vehicle-action="delete" data-id="${escapeHtml(id)}">Supprimer</button>
                </div>
            </div>
        </article>`;
    }

    function getPhotoUrls(vehicle) {
        const candidates = [
            vehicle.imageUrl,
            ...(Array.isArray(vehicle.imageUrls) ? vehicle.imageUrls : []),
        ];
        const urls = [];
        candidates.forEach((candidate) => {
            if (typeof candidate !== 'string' || !candidate.trim()) return;
            try {
                const url = new URL(candidate.trim(), window.location.href);
                if (!['http:', 'https:'].includes(url.protocol)) return;
                const normalized = url.href;
                if (!urls.includes(normalized)) urls.push(normalized);
            } catch {
                return;
            }
        });
        return urls;
    }

    function getFeatures(value) {
        const candidates = Array.isArray(value)
            ? value
            : typeof value === 'string'
                ? value.split(',')
                : [];
        return candidates
            .filter((feature) => feature !== null && feature !== undefined)
            .map((feature) => String(feature).trim())
            .filter(Boolean);
    }

    function handleImageError(event) {
        const image = event.target;
        if (!(image instanceof HTMLImageElement) || !image.matches('[data-vehicle-image]')) return;
        image.closest('.fleet-vehicle-image')?.classList.add('is-empty');
        image.hidden = true;
        const placeholder = image.parentElement.querySelector('.vehicle-image-placeholder');
        if (placeholder) placeholder.hidden = false;
    }

    function changeGalleryPhoto(button) {
        const imageContainer = button.closest('.fleet-vehicle-image');
        const image = imageContainer?.querySelector('[data-vehicle-image]');
        if (!image || !image.dataset.photos) return;

        const photos = JSON.parse(image.dataset.photos);
        if (!Array.isArray(photos) || photos.length < 2) return;
        const currentIndex = Number(imageContainer.dataset.photoIndex || 0);
        const nextIndex = (currentIndex + Number(button.dataset.galleryStep) + photos.length) % photos.length;
        imageContainer.dataset.photoIndex = String(nextIndex);
        image.src = photos[nextIndex];
        image.alt = `${image.dataset.vehicleName || 'Véhicule'}, photo ${nextIndex + 1}`;
        imageContainer.classList.remove('is-empty');
        image.hidden = false;
        const placeholder = imageContainer.querySelector('.vehicle-image-placeholder');
        if (placeholder) placeholder.hidden = true;
        const counter = imageContainer.querySelector('.fleet-gallery-count');
        if (counter) counter.textContent = `${nextIndex + 1} / ${photos.length}`;
    }

    function toggleFeatures(button) {
        const section = button.closest('.fleet-features');
        const isExpanded = button.getAttribute('aria-expanded') === 'true';
        section.querySelectorAll('[data-extra-feature]').forEach((feature) => {
            feature.hidden = isExpanded;
        });
        button.setAttribute('aria-expanded', String(!isExpanded));
        const extraCount = section.querySelectorAll('[data-extra-feature]').length;
        button.textContent = isExpanded ? `Voir ${extraCount} de plus` : 'Réduire';
    }

    function setCardBusy(card, busy) {
        if (!card) return;
        card.querySelectorAll('button').forEach((control) => {
            if (busy && !control.disabled) {
                control.disabled = true;
                control.dataset.disabledForAction = 'true';
            } else if (!busy && control.dataset.disabledForAction === 'true') {
                control.disabled = false;
                delete control.dataset.disabledForAction;
            }
        });
        card.setAttribute('aria-busy', String(busy));
    }

    function showFeedback(message, type) {
        feedback.textContent = message;
        feedback.className = `fleet-feedback${message ? ` is-${type}` : ''}`;
        feedback.setAttribute('role', type === 'error' ? 'alert' : 'status');
    }

    function clearPendingDelete() {
        if (isDeleting) return;
        pendingDeleteId = null;
        deleteError.textContent = '';
        deleteError.hidden = true;
    }

    function authHeaders() {
        const currentToken = localStorage.getItem('goying_access_token');
        return currentToken ? { Authorization: `Bearer ${currentToken}` } : {};
    }

    async function readJsonResponse(response) {
        try {
            return await response.json();
        } catch {
            throw new Error('La réponse du serveur est illisible. Actualisez la page puis réessayez.');
        }
    }

    function formatApiError(detail) {
        if (Array.isArray(detail)) return detail.map((item) => item.msg || item.detail || String(item)).join(' ; ');
        if (detail && typeof detail === 'object') return detail.msg || detail.detail || JSON.stringify(detail);
        return detail || 'Une erreur est survenue.';
    }

    function getErrorMessage(error) {
        if (error instanceof TypeError) return 'Erreur réseau lors de la communication avec le serveur.';
        return error instanceof Error ? error.message : 'Une erreur est survenue.';
    }
});

function clearSession() {
    localStorage.removeItem('goying_access_token');
    localStorage.removeItem('goying_role');
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    }[character]));
}
