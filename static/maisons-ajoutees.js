document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-added-houses-page]');
    if (!page) return;

    const list = document.querySelector('#added-houses-list');
    const search = document.querySelector('#house-search');
    const statusFilter = document.querySelector('#house-status-filter');
    const sort = document.querySelector('#house-sort');
    const visibleCount = document.querySelector('#houses-visible-count');
    const totalCount = document.querySelector('#houses-total');
    const availableCount = document.querySelector('#houses-available');
    const unavailableCount = document.querySelector('#houses-unavailable');
    const pendingCount = document.querySelector('#houses-pending');
    const noResults = document.querySelector('#houses-no-results');
    const feedback = document.querySelector('#houses-feedback');
    const deleteDialog = document.querySelector('#house-delete-dialog');
    const deleteName = document.querySelector('#house-delete-name');
    const confirmDelete = document.querySelector('#confirm-house-delete');
    const photoDialog = document.querySelector('#house-photo-dialog');
    const photoDialogImage = document.querySelector('#house-photo-dialog-image');
    const photoDialogCaption = document.querySelector('#house-photo-dialog-caption');
    let pendingDeleteButton = null;

    document.querySelector('#logout-button')?.addEventListener('click', () => {
        localStorage.removeItem('goying_access_token');
        localStorage.removeItem('goying_role');
        window.location.href = '/';
    });
    document.querySelector('#retry-houses')?.addEventListener('click', () => window.location.reload());
    search.addEventListener('input', applyFilters);
    statusFilter.addEventListener('change', applyFilters);
    sort.addEventListener('change', applyFilters);

    list.addEventListener('click', handleListClick);
    list.addEventListener('submit', handleHouseStatusChange);
    list.addEventListener('error', handleImageError, true);
    confirmDelete.addEventListener('click', deleteHouse);
    photoDialog.addEventListener('click', (event) => {
        if (event.target === photoDialog || event.target.closest('[data-close-photo]')) photoDialog.close();
    });
    document.querySelectorAll('[data-close-photo]').forEach((button) => {
        button.addEventListener('click', () => photoDialog.close());
    });

    updateStatistics();
    applyFilters();

    function getCards() {
        return Array.from(list.querySelectorAll('[data-house-card]'));
    }

    function updateStatistics() {
        if (page.dataset.loadError === 'true') {
            totalCount.textContent = '—';
            availableCount.textContent = '—';
            unavailableCount.textContent = '—';
            pendingCount.textContent = '—';
            return;
        }
        const cards = getCards();
        const states = cards.map((card) => getHouseState(card));
        totalCount.textContent = cards.length;
        availableCount.textContent = states.filter((state) => state === 'available').length;
        unavailableCount.textContent = states.filter((state) => state === 'unavailable').length;
        pendingCount.textContent = states.filter((state) => state === 'pending').length;
    }

    function getHouseState(card) {
        if (card.dataset.approved !== 'true') return 'pending';
        const status = normalize(card.dataset.status);
        if (['disponible', 'available', 'a vendre', 'a louer'].includes(status)) return 'available';
        return 'unavailable';
    }

    function applyFilters() {
        const query = normalize(search.value);
        const filter = statusFilter.value;
        const cards = getCards();
        const visibleCards = cards.filter((card) => {
            const matchesSearch = !query || normalize(card.dataset.search).includes(query);
            const state = getHouseState(card);
            const transaction = normalize(card.dataset.transaction);
            const matchesStatus = filter === 'all'
                || (filter === 'available' && state === 'available')
                || (filter === 'unavailable' && state === 'unavailable')
                || (filter === 'pending' && state === 'pending')
                || (filter === 'rent' && ['a louer', 'louer', 'rent'].includes(transaction))
                || (filter === 'sale' && ['a vendre', 'vendre', 'sale'].includes(transaction));
            return matchesSearch && matchesStatus;
        });

        const sortValue = sort.value;
        visibleCards.sort((left, right) => {
            if (sortValue === 'date-asc') return Number(right.dataset.order) - Number(left.dataset.order);
            if (sortValue === 'price-asc' || sortValue === 'price-desc') {
                const leftPrice = parsePrice(left.dataset.price);
                const rightPrice = parsePrice(right.dataset.price);
                if (leftPrice === null) return rightPrice === null ? 0 : 1;
                if (rightPrice === null) return -1;
                return sortValue === 'price-asc' ? leftPrice - rightPrice : rightPrice - leftPrice;
            }
            return Number(left.dataset.order) - Number(right.dataset.order);
        });

        visibleCards.forEach((card) => list.appendChild(card));
        cards.forEach((card) => {
            card.hidden = !visibleCards.includes(card);
        });
        visibleCount.textContent = visibleCards.length;
        noResults.hidden = visibleCards.length > 0 || cards.length === 0 || page.dataset.loadError === 'true';
    }

    async function handleListClick(event) {
        const deleteButton = event.target.closest('[data-house-delete]');
        if (deleteButton) {
            pendingDeleteButton = deleteButton;
            deleteName.textContent = deleteButton.dataset.houseTitle || 'ce bien immobilier';
            deleteDialog.showModal();
            return;
        }

        const expandButton = event.target.closest('[data-expand-text]');
        if (expandButton) {
            const text = expandButton.parentElement.querySelector('[data-expandable-text]');
            const expanded = text.classList.toggle('is-expanded');
            expandButton.textContent = expanded ? 'Voir moins' : 'Voir plus';
            return;
        }

        const galleryButton = event.target.closest('[data-gallery-direction]');
        if (galleryButton) {
            changeGallery(galleryButton.closest('[data-house-gallery]'), Number(galleryButton.dataset.galleryDirection));
            return;
        }

        const photoButton = event.target.closest('[data-gallery-photo]');
        if (photoButton) openPhoto(photoButton);
    }

    function changeGallery(gallery, direction) {
        const photos = Array.from(gallery.querySelectorAll('[data-gallery-photo]'));
        if (photos.length < 2) return;
        const currentIndex = photos.findIndex((photo) => photo.classList.contains('is-active'));
        const nextIndex = (currentIndex + direction + photos.length) % photos.length;
        photos.forEach((photo, index) => {
            const active = index === nextIndex;
            photo.classList.toggle('is-active', active);
            photo.hidden = !active;
        });
        const counter = gallery.querySelector('[data-photo-count]');
        if (counter) counter.textContent = `${nextIndex + 1} / ${photos.length}`;
    }

    function openPhoto(photoButton) {
        const image = photoButton.querySelector('img');
        if (!image || photoButton.hidden) return;
        photoDialogImage.src = image.src;
        photoDialogImage.alt = image.alt;
        photoDialogCaption.textContent = image.alt;
        photoDialog.showModal();
    }

    function handleImageError(event) {
        if (event.target instanceof HTMLImageElement) {
            event.target.closest('[data-house-gallery]')?.classList.add('is-empty');
        }
    }

    async function handleHouseStatusChange(event) {
        const form = event.target.closest('[data-house-actions] form');
        if (!form) return;
        event.preventDefault();

        const button = form.querySelector('[data-house-status-action]');
        const card = form.closest('[data-house-card]');
        const token = localStorage.getItem('goying_access_token');
        if (!token) {
            feedback.textContent = 'Votre session a expiré. Reconnectez-vous avant de modifier ce bien.';
            feedback.classList.add('is-error');
            return;
        }

        button.disabled = true;
        const originalLabel = button.textContent;
        button.textContent = 'Mise à jour...';
        feedback.textContent = '';
        feedback.classList.remove('is-error');
        try {
            const response = await fetch(form.action, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(formatApiError(payload.detail));

            if (form.action.endsWith('/approuver')) card.dataset.approved = 'true';
            card.dataset.status = String(payload.disponibilite || payload.statut || 'disponible').toLowerCase();
            updateStatusBadge(card);
            updateActionButtons(card);
            updateStatistics();
            applyFilters();
            feedback.textContent = payload.message || 'Le statut du bien a été mis à jour.';
        } catch (error) {
            feedback.textContent = error.message;
            feedback.classList.add('is-error');
            button.disabled = false;
            button.textContent = originalLabel;
        }
    }

    function updateStatusBadge(card) {
        const badge = card.querySelector('[data-house-status-label]');
        const state = getHouseState(card);
        badge.classList.remove('is-pending', 'is-available', 'is-unavailable');
        badge.classList.add(state === 'available' ? 'is-available' : state === 'pending' ? 'is-pending' : 'is-unavailable');
        badge.textContent = state === 'available' ? 'Disponible' : state === 'pending' ? 'En attente' : 'Indisponible';
    }

    function updateActionButtons(card) {
        const actions = card.querySelector('[data-house-actions]');
        const state = getHouseState(card);
        const id = card.dataset.houseId;
        const endpoint = state === 'pending'
            ? 'approuver'
            : state === 'available' ? 'indisponible' : 'disponible';
        const label = state === 'pending'
            ? 'Approuver le bien'
            : state === 'available' ? 'Rendre indisponible' : 'Rendre disponible';
        let form = actions.querySelector('form');
        if (!form) {
            form = document.createElement('form');
            actions.prepend(form);
        }
        form.action = `/api/maisons/${encodeURIComponent(id)}/${endpoint}`;
        form.method = 'POST';
        form.innerHTML = `<button type="submit" class="status-button" data-house-status-action>${label}</button>`;
    }

    async function deleteHouse() {
        if (!pendingDeleteButton) return;
        const button = pendingDeleteButton;
        const card = button.closest('[data-house-card]');
        const token = localStorage.getItem('goying_access_token');
        if (!token) {
            deleteDialog.close();
            feedback.textContent = 'Votre session a expiré. Reconnectez-vous avant de supprimer ce bien.';
            feedback.classList.add('is-error');
            return;
        }

        confirmDelete.disabled = true;
        confirmDelete.textContent = 'Suppression...';
        try {
            const response = await fetch(`/api/maisons/${encodeURIComponent(card.dataset.houseId)}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(formatApiError(payload.detail));

            card.remove();
            deleteDialog.close();
            pendingDeleteButton = null;
            ensureEmptyState();
            updateStatistics();
            applyFilters();
            feedback.textContent = payload.message || 'La maison a été supprimée.';
            feedback.classList.remove('is-error');
        } catch (error) {
            deleteDialog.close();
            feedback.textContent = error.message;
            feedback.classList.add('is-error');
        } finally {
            confirmDelete.disabled = false;
            confirmDelete.textContent = 'Confirmer la suppression';
        }
    }

    function ensureEmptyState() {
        if (getCards().length || list.querySelector('[data-empty-state]')) return;
        list.innerHTML = `<div class="added-houses-empty" data-empty-state>
            <span aria-hidden="true">⌂</span>
            <h2>Aucune maison enregistrée pour le moment</h2>
            <p>Ajoutez votre premier bien pour commencer à gérer votre portefeuille immobilier.</p>
            <a class="added-houses-add-link" href="/maisons/ajouter">+ Ajouter une maison</a>
        </div>`;
    }
});

function parsePrice(value) {
    if (!value) return null;
    const price = Number(value);
    return Number.isFinite(price) ? price : null;
}

function normalize(value) {
    return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/_/g, ' ');
}

function formatApiError(detail) {
    if (Array.isArray(detail)) return detail.map((item) => item.msg || item.detail || String(item)).join(' ; ');
    if (detail && typeof detail === 'object') return detail.message || detail.msg || detail.detail || JSON.stringify(detail);
    return detail || 'Une erreur est survenue';
}
