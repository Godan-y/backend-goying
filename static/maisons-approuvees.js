document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-approved-houses-page]');
    if (!page) return;

    const list = page.querySelector('[data-houses-list]');
    const search = page.querySelector('[data-search-houses]');
    const filter = page.querySelector('[data-filter-houses]');
    const sort = page.querySelector('[data-sort-houses]');
    const visibleCount = page.querySelector('[data-visible-count]');
    const feedback = page.querySelector('[data-feedback]');
    const emptyState = page.querySelector('[data-empty-state]');
    const noResults = page.querySelector('[data-no-results]');
    const photoDialog = document.querySelector('[data-photo-dialog]');
    const dialogImage = photoDialog.querySelector('[data-dialog-image]');
    const dialogCaption = photoDialog.querySelector('[data-dialog-caption]');
    const deleteDialog = document.querySelector('[data-delete-dialog]');
    const deleteTitle = deleteDialog.querySelector('[data-delete-title]');
    const deleteError = deleteDialog.querySelector('[data-delete-error]');
    const confirmDelete = deleteDialog.querySelector('[data-confirm-delete]');
    let activeGallery = null;
    let pendingDelete = null;

    search.addEventListener('input', applyFilters);
    filter.addEventListener('change', applyFilters);
    sort.addEventListener('change', applyFilters);
    list.addEventListener('click', handleListClick);
    list.addEventListener('error', handleImageError, true);
    confirmDelete.addEventListener('click', deleteHouse);

    photoDialog.addEventListener('click', (event) => {
        if (event.target === photoDialog || event.target.closest('[data-close-photo]')) {
            photoDialog.close();
        }
    });
    photoDialog.querySelectorAll('[data-dialog-step]').forEach((button) => {
        button.addEventListener('click', () => movePhoto(Number(button.dataset.dialogStep)));
    });

    list.querySelectorAll('[data-format-date]').forEach((time) => {
        const formatted = formatDate(time.textContent.trim());
        if (formatted) time.textContent = formatted;
    });
    list.querySelectorAll('[data-price-value]').forEach((price) => {
        const amount = Number(price.textContent.trim().replace(',', '.'));
        if (Number.isFinite(amount)) {
            price.textContent = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(amount);
        }
    });

    applyFilters();
    updateStatistics();

    function cards() {
        return Array.from(list.querySelectorAll('[data-house-card]'));
    }

    function normalize(value) {
        return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
    }

    function transactionType(card) {
        const value = normalize(card.dataset.transaction).replace(/_/g, ' ');
        if (['a louer', 'louer', 'location'].includes(value)) return 'rent';
        if (['a vendre', 'vendre', 'vente'].includes(value)) return 'sale';
        return '';
    }

    function parsePrice(value) {
        const parsed = Number(String(value || '').replace(',', '.'));
        return Number.isFinite(parsed) ? parsed : null;
    }

    function applyFilters() {
        const query = normalize(search.value.trim());
        const selectedFilter = filter.value;
        const allCards = cards();
        const shown = allCards.filter((card) => {
            const availability = normalize(card.dataset.availability);
            const transaction = transactionType(card);
            const matchesSearch = !query || normalize(card.dataset.search).includes(query);
            const matchesFilter = selectedFilter === 'all'
                || (selectedFilter === 'available' && availability === 'disponible')
                || (selectedFilter === 'unavailable' && availability === 'indisponible')
                || selectedFilter === transaction;
            return matchesSearch && matchesFilter;
        });

        shown.sort((left, right) => {
            if (sort.value === 'price-asc' || sort.value === 'price-desc') {
                const a = parsePrice(left.dataset.price);
                const b = parsePrice(right.dataset.price);
                if (a === null) return b === null ? 0 : 1;
                if (b === null) return -1;
                return sort.value === 'price-asc' ? a - b : b - a;
            }
            const a = Date.parse(left.dataset.date) || 0;
            const b = Date.parse(right.dataset.date) || 0;
            return sort.value === 'date-asc' ? a - b : b - a;
        });

        shown.forEach((card) => list.appendChild(card));
        allCards.forEach((card) => { card.hidden = !shown.includes(card); });
        visibleCount.textContent = String(shown.length);
        emptyState.hidden = allCards.length !== 0;
        noResults.hidden = allCards.length === 0 || shown.length !== 0;
    }

    function updateStatistics() {
        const allCards = cards();
        const totals = {
            total: allCards.length,
            available: allCards.filter((card) => card.dataset.availability === 'disponible').length,
            unavailable: allCards.filter((card) => card.dataset.availability === 'indisponible').length,
            rent: allCards.filter((card) => transactionType(card) === 'rent').length,
            sale: allCards.filter((card) => transactionType(card) === 'sale').length,
        };
        Object.entries(totals).forEach(([name, value]) => {
            page.querySelector(`[data-stat="${name}"]`).textContent = String(value);
        });
    }

    async function handleListClick(event) {
        const expandButton = event.target.closest('[data-expand-toggle]');
        if (expandButton) {
            const text = expandButton.parentElement.querySelector('[data-expandable]');
            const expanded = text.classList.toggle('is-expanded');
            expandButton.textContent = expanded ? 'Voir moins' : 'Voir plus';
            return;
        }

        const galleryButton = event.target.closest('[data-gallery-step]');
        if (galleryButton) {
            changeGallery(galleryButton.closest('[data-gallery]'), Number(galleryButton.dataset.galleryStep));
            return;
        }

        const photoButton = event.target.closest('[data-gallery-photo]');
        if (photoButton) {
            activeGallery = photoButton.closest('[data-gallery]');
            showDialogPhoto(photoButton);
            photoDialog.showModal();
            return;
        }

        const deleteButton = event.target.closest('[data-delete-house]');
        if (deleteButton) {
            pendingDelete = deleteButton.closest('[data-house-card]');
            deleteTitle.textContent = pendingDelete.dataset.houseTitle;
            deleteError.hidden = true;
            deleteError.textContent = '';
            deleteDialog.showModal();
            return;
        }

        const availabilityButton = event.target.closest('[data-availability-action]');
        if (availabilityButton) await changeAvailability(availabilityButton);
    }

    function galleryPhotos(gallery) {
        return Array.from(gallery.querySelectorAll('[data-gallery-photo]:not(.is-broken)'));
    }

    function changeGallery(gallery, direction) {
        const photos = galleryPhotos(gallery);
        if (photos.length < 2) return;
        const index = photos.findIndex((photo) => photo.classList.contains('is-active'));
        const next = (index + direction + photos.length) % photos.length;
        photos.forEach((photo, photoIndex) => {
            photo.hidden = photoIndex !== next;
            photo.classList.toggle('is-active', photoIndex === next);
        });
        const counter = gallery.querySelector('[data-photo-count]');
        if (counter) counter.textContent = `${next + 1} / ${photos.length}`;
    }

    function showDialogPhoto(photoButton) {
        const image = photoButton.querySelector('img');
        if (!image) return;
        dialogImage.src = image.currentSrc || image.src;
        dialogImage.alt = image.alt;
        dialogCaption.textContent = image.alt;
        const multiple = galleryPhotos(activeGallery).length > 1;
        photoDialog.querySelectorAll('[data-dialog-step]').forEach((button) => {
            button.hidden = !multiple;
        });
    }

    function movePhoto(direction) {
        if (!activeGallery) return;
        changeGallery(activeGallery, direction);
        const activePhoto = activeGallery.querySelector('[data-gallery-photo].is-active');
        if (activePhoto) showDialogPhoto(activePhoto);
    }

    function handleImageError(event) {
        if (event.target instanceof HTMLImageElement) {
            const photo = event.target.closest('[data-gallery-photo]');
            const gallery = event.target.closest('[data-gallery]');
            if (!photo || !gallery) return;
            photo.classList.add('is-broken');
            photo.hidden = true;
            const photos = galleryPhotos(gallery);
            const activePhoto = photos[0];
            if (activePhoto && !photos.some((item) => item.classList.contains('is-active'))) {
                activePhoto.classList.add('is-active');
                activePhoto.hidden = false;
            }
            if (!photos.length) gallery.querySelector('.approved-photo-fallback')?.classList.add('is-visible');
            const counter = gallery.querySelector('[data-photo-count]');
            if (counter) {
                const index = photos.findIndex((item) => item.classList.contains('is-active'));
                counter.textContent = `${Math.max(index + 1, 1)} / ${photos.length}`;
                counter.hidden = photos.length < 2;
            }
            gallery.querySelectorAll('[data-gallery-step]').forEach((button) => {
                button.hidden = photos.length < 2;
            });
            if (activeGallery === gallery && photoDialog.open && activePhoto) showDialogPhoto(activePhoto);
        }
    }

    async function changeAvailability(button) {
        const card = button.closest('[data-house-card]');
        const nextStatus = button.dataset.nextStatus;
        if (!card || !['disponible', 'indisponible'].includes(nextStatus)) return;
        setCardBusy(card, true);
        try {
            const response = await fetch(`/api/maisons/${encodeURIComponent(card.dataset.houseId)}/${nextStatus}`, {
                method: 'POST',
                headers: authHeaders(),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(errorMessage(payload, 'Impossible de modifier la disponibilité.'));
            const actualStatus = payload.disponibilite;
            if (!['disponible', 'indisponible'].includes(actualStatus)) {
                throw new Error('Le serveur n’a pas renvoyé une disponibilité valide.');
            }
            setAvailability(card, actualStatus);
            updateStatistics();
            applyFilters();
            showFeedback('Disponibilité mise à jour avec succès.', false);
        } catch (error) {
            showFeedback(error.message || 'Erreur lors de la mise à jour.', true);
        } finally {
            setCardBusy(card, false);
        }
    }

    function setAvailability(card, availability) {
        card.dataset.availability = availability;
        const label = card.querySelector('[data-availability-label]');
        label.textContent = availability === 'disponible' ? 'Disponible' : 'Indisponible';
        label.classList.toggle('is-available', availability === 'disponible');
        label.classList.toggle('is-unavailable', availability === 'indisponible');
        const button = card.querySelector('[data-availability-action]');
        if (!button) return;
        button.dataset.nextStatus = availability === 'disponible' ? 'indisponible' : 'disponible';
        button.textContent = availability === 'disponible' ? 'Rendre indisponible' : 'Rendre disponible';
    }

    function setCardBusy(card, busy) {
        card.querySelectorAll('button, a').forEach((control) => {
            if ('disabled' in control) control.disabled = busy;
            control.setAttribute('aria-busy', String(busy));
        });
    }

    async function deleteHouse() {
        if (!pendingDelete) return;
        const card = pendingDelete;
        confirmDelete.disabled = true;
        confirmDelete.textContent = 'Suppression…';
        try {
            const response = await fetch(`/api/maisons/${encodeURIComponent(card.dataset.houseId)}`, {
                method: 'DELETE',
                headers: authHeaders(),
            });
            const payload = await response.json();
            if (!response.ok) {
                const detail = payload && payload.detail;
                if (detail && typeof detail === 'object' && detail.deleted_from_firestore === true) {
                    card.remove();
                    pendingDelete = null;
                    deleteDialog.close();
                    updateStatistics();
                    applyFilters();
                    showFeedback(errorMessage(payload, 'Maison supprimée de Firestore, mais le nettoyage des photos a échoué.'), true);
                    return;
                }
                throw new Error(errorMessage(payload, 'Impossible de supprimer la maison.'));
            }
            card.remove();
            pendingDelete = null;
            deleteDialog.close();
            updateStatistics();
            applyFilters();
            showFeedback(payload.message || 'Maison supprimée avec succès.', false);
        } catch (error) {
            deleteError.textContent = error.message || 'Erreur lors de la suppression.';
            deleteError.hidden = false;
        } finally {
            confirmDelete.disabled = false;
            confirmDelete.textContent = 'Confirmer la suppression';
        }
    }

    function authHeaders() {
        const token = localStorage.getItem('goying_access_token');
        return token ? { Authorization: `Bearer ${token}` } : {};
    }

    function errorMessage(payload, fallback) {
        const detail = payload && payload.detail;
        if (typeof detail === 'string') return detail;
        if (detail && typeof detail.message === 'string') return detail.message;
        return fallback;
    }

    function showFeedback(message, isError) {
        feedback.textContent = message;
        feedback.classList.toggle('is-error', isError);
        feedback.classList.add('is-visible');
    }

    function formatDate(value) {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return '';
        return new Intl.DateTimeFormat('fr-FR', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
        }).format(parsed);
    }
});
