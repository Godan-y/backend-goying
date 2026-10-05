document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-submissions-page]');
    if (!page) return;

    const list = page.querySelector('#submissions-list');
    const count = page.querySelector('#submissions-count');
    const countLabel = page.querySelector('#submission-count-label');
    const refreshButton = page.querySelector('#refresh-submissions');
    const logoutButton = page.querySelector('#logout-button');
    const notice = page.querySelector('#submissions-notice');
    const photoDialog = document.querySelector('#submission-photo-dialog');
    const dialogImage = photoDialog.querySelector('[data-dialog-image]');
    const deleteDialog = document.querySelector('#submission-delete-dialog');
    const deleteError = deleteDialog.querySelector('[data-delete-error]');
    const confirmDelete = deleteDialog.querySelector('[data-confirm-delete]');
    const cancelDelete = deleteDialog.querySelector('[data-cancel-delete]');
    const token = localStorage.getItem('goying_access_token');
    const role = localStorage.getItem('goying_role');
    let submissions = [];
    let pendingDeleteId = '';
    let loading = false;
    let deleting = false;

    if (!list || !count || !countLabel || !refreshButton || !logoutButton || !notice
        || !photoDialog || !dialogImage || !deleteDialog || !deleteError || !confirmDelete || !cancelDelete
        || !token || role !== 'maisons') {
        clearSession();
        window.location.href = '/';
        return;
    }

    logoutButton.addEventListener('click', () => {
        clearSession();
        window.location.href = '/';
    });
    refreshButton.addEventListener('click', () => loadSubmissions());
    list.addEventListener('click', handleListClick);
    list.addEventListener('error', handleImageError, true);
    confirmDelete.addEventListener('click', deleteSubmission);
    cancelDelete.addEventListener('click', () => deleteDialog.close());
    deleteDialog.addEventListener('close', () => {
        if (!deleting) pendingDeleteId = '';
    });
    deleteDialog.addEventListener('cancel', () => {
        pendingDeleteId = '';
    });
    [photoDialog, deleteDialog].forEach((dialog) => {
        dialog.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                dialog.close();
            }
        });
    });
    deleteDialog.addEventListener('click', (event) => {
        if (event.target === deleteDialog) deleteDialog.close();
    });
    photoDialog.addEventListener('click', (event) => {
        if (event.target === photoDialog || event.target.closest('[data-close-photo]')) {
            photoDialog.close();
        }
    });

    loadSubmissions();

    async function loadSubmissions() {
        if (loading || deleting) return;
        loading = true;
        setLoading(true);
        hideNotice();

        if (submissions.length === 0) {
            count.textContent = '—';
            countLabel.textContent = 'Nombre indisponible';
            list.innerHTML = renderLoadingState();
        }

        try {
            const response = await fetch(page.dataset.endpoint, {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            });
            const payload = await readJsonResponse(response);
            if (!response.ok) throw new Error(formatApiError(payload.detail));
            if (!Array.isArray(payload.submissions)) {
                throw new Error('La réponse du serveur ne contient pas une liste de soumissions valide.');
            }

            submissions = payload.submissions;
            renderSubmissions();
        } catch (error) {
            submissions = [];
            count.textContent = '—';
            countLabel.textContent = 'Nombre indisponible';
            list.innerHTML = renderLoadError(getErrorMessage(error));
        } finally {
            loading = false;
            setLoading(false);
        }
    }

    async function handleListClick(event) {
        if (event.target.closest('[data-retry-submissions]')) {
            await loadSubmissions();
            return;
        }

        const photoButton = event.target.closest('[data-view-photo]');
        if (photoButton) {
            const photoUrl = safePhotoUrl(photoButton.dataset.photoUrl);
            if (!photoUrl) return;
            dialogImage.src = photoUrl;
            dialogImage.alt = photoButton.dataset.photoAlt || 'Photo de la proposition immobilière';
            photoDialog.showModal();
            return;
        }

        const deleteButton = event.target.closest('[data-delete-submission]');
        if (!deleteButton || loading || deleting) return;
        pendingDeleteId = deleteButton.dataset.deleteSubmission || '';
        if (!pendingDeleteId) return;
        deleteError.hidden = true;
        deleteError.textContent = '';
        deleteDialog.showModal();
    }

    async function deleteSubmission() {
        if (!pendingDeleteId || deleting || loading) return;
        deleting = true;
        setDeleteLoading(true);
        deleteError.hidden = true;
        deleteError.textContent = '';

        try {
            const endpoint = page.dataset.deleteEndpoint.replace(
                '__submission_id__',
                encodeURIComponent(pendingDeleteId),
            );
            const response = await fetch(endpoint, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            const payload = await readJsonResponse(response);
            const detail = payload.detail;
            const deletedFromFirestore = response.status === 502
                && Boolean(detail && typeof detail === 'object' && detail.deleted_from_firestore);

            if (!response.ok && !deletedFromFirestore) {
                throw new Error(formatApiError(detail));
            }

            const deletedId = pendingDeleteId;
            pendingDeleteId = '';
            deleteDialog.close();
            removeSubmission(deletedId);

            if (deletedFromFirestore) {
                showNotice(
                    formatApiError(detail),
                    'warning',
                );
            } else {
                showNotice('La soumission a été supprimée.', 'success');
            }
        } catch (error) {
            deleteError.textContent = getErrorMessage(error);
            deleteError.hidden = false;
        } finally {
            deleting = false;
            setDeleteLoading(false);
        }
    }

    function renderSubmissions() {
        count.textContent = String(submissions.length);
        countLabel.textContent = `${submissions.length} maison${submissions.length === 1 ? '' : 's'} soumise${submissions.length === 1 ? '' : 's'}`;
        list.setAttribute('aria-busy', 'false');
        list.innerHTML = submissions.length
            ? submissions.map(renderSubmission).join('')
            : renderEmptyState();
    }

    function renderSubmission(submission) {
        const id = firstValue(submission.id);
        const category = formatType(submission.category);
        const status = formatStatus(submission.status);
        const photoReference = firstValue(submission.referencePhotoUrl);
        const photo = safePhotoUrl(photoReference);
        const photoUnavailable = Boolean(photoReference) && !photo;
        const phone = firstValue(submission.reporterPhone);
        const whatsappNumber = window.normalizeWhatsappNumber
            ? window.normalizeWhatsappNumber(phone)
            : '';
        const email = firstValue(submission.reporterEmail);
        const name = firstValue(submission.reporterName);
        const createdAt = formatDate(submission.createdAt);
        const addressFields = [
            ['Commune', submission.commune],
            ['Quartier', submission.quartier],
            ['Avenue', submission.avenue],
            ['Province', submission.province],
            ['Pays', submission.country],
        ].map(([label, value]) => [label, firstValue(value)]).filter(([, value]) => value);
        const addressMarkup = addressFields.length
            ? addressFields.map(([label, value]) => `
                <div class="submitted-address-field">
                    <dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>
                </div>`).join('')
            : '<div class="submitted-address-field is-empty"><dt>Localisation</dt><dd>Adresse non renseignée</dd></div>';
        const phoneMarkup = phone
            ? `<a href="tel:${escapeHtml(encodeTel(phone))}">${escapeHtml(phone)}</a>`
            : '<span class="submitted-houses-missing">Non renseigné</span>';
        const emailMarkup = email
            ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`
            : '<span class="submitted-houses-missing">Non renseigné</span>';
        const whatsappMarkup = whatsappNumber
            ? `<a class="submitted-whatsapp-link" href="https://wa.me/${escapeHtml(whatsappNumber)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">◉</span> Contacter sur WhatsApp</a>`
            : '<p class="submitted-whatsapp-unavailable" role="status">WhatsApp indisponible : le numéro doit être vérifié.</p>';
        const safeId = escapeHtml(id);

        return `<article class="submitted-property-card">
            <div class="submitted-property-photo${photo ? '' : photoUnavailable ? ' is-unavailable' : ' is-empty'}">
                ${photo
                    ? `<button type="button" class="submitted-photo-trigger" data-view-photo data-photo-url="${escapeHtml(photo)}" data-photo-alt="Photo de ${escapeHtml(category || 'la proposition immobilière')}" aria-label="Agrandir la photo de ${escapeHtml(category || 'la proposition immobilière')}"><img src="${escapeHtml(photo)}" alt="Photo de ${escapeHtml(category || 'la proposition immobilière')}" loading="lazy"><span class="submitted-photo-zoom" aria-hidden="true">⌕</span></button>`
                    : ''}
                <div class="submitted-photo-fallback" role="img" aria-label="${photoUnavailable ? 'Photo indisponible' : 'Le soumissionnaire n’a pas fourni d’image'}">
                    <span aria-hidden="true">▧</span>
                    <strong>${photoUnavailable ? 'Photo indisponible' : 'Aucune photo'}</strong>
                    <small>${photoUnavailable ? 'Une image est enregistrée, mais elle n’a pas pu être chargée.' : 'Le soumissionnaire n’a pas fourni d’image.'}</small>
                </div>
            </div>
            <div class="submitted-property-content">
                <div class="submitted-property-heading">
                    <div>
                        <p class="submitted-property-eyebrow">Proposition immobilière</p>
                        <h2>${escapeHtml(category || 'Type non renseigné')}</h2>
                    </div>
                    <span class="submitted-property-status ${status.className}">${escapeHtml(status.label)}</span>
                </div>
                <section class="submitted-property-section" aria-labelledby="submission-address-${safeId}">
                    <h3 id="submission-address-${safeId}"><span aria-hidden="true">⌖</span> Localisation</h3>
                    <dl class="submitted-address-grid">${addressMarkup}</dl>
                </section>
                <section class="submitted-property-section submitted-reporter-section" aria-labelledby="submission-reporter-${safeId}">
                    <h3 id="submission-reporter-${safeId}"><span class="submitted-reporter-avatar" aria-hidden="true">♙</span> Personne ayant soumis le bien</h3>
                    <dl class="submitted-reporter-details">
                        <div><dt>Nom</dt><dd>${escapeHtml(name || 'Non renseigné')}</dd></div>
                        <div><dt>Téléphone</dt><dd>${phoneMarkup}</dd></div>
                        <div><dt>E-mail</dt><dd>${emailMarkup}</dd></div>
                    </dl>
                    ${whatsappMarkup}
                </section>
                <div class="submitted-property-meta">
                    <div><span aria-hidden="true">◷</span><div><small>Date de soumission</small><strong>${escapeHtml(createdAt || 'Non renseignée')}</strong></div></div>
                    <div class="submitted-reference"><span aria-hidden="true">⌗</span><div><small>Référence</small><code>${escapeHtml(id || 'Non disponible')}</code></div></div>
                </div>
                ${id ? `<button type="button" class="submitted-delete-button" data-delete-submission="${safeId}"><span aria-hidden="true">⌫</span> Supprimer la soumission</button>` : ''}
            </div>
        </article>`;
    }

    function removeSubmission(submissionId) {
        submissions = submissions.filter((submission) => firstValue(submission.id) !== submissionId);
        renderSubmissions();
    }

    function handleImageError(event) {
        const image = event.target;
        if (!(image instanceof HTMLImageElement) || !image.closest('.submitted-property-photo')) return;
        const photo = image.closest('.submitted-property-photo');
        photo.classList.add('is-unavailable');
        photo.querySelector('.submitted-photo-trigger')?.remove();
        const fallback = photo.querySelector('.submitted-photo-fallback');
        fallback.setAttribute('aria-label', 'Photo indisponible');
        fallback.querySelector('strong').textContent = 'Photo indisponible';
        fallback.querySelector('small').textContent = 'Une image est enregistrée, mais elle n’a pas pu être chargée.';
    }

    function setLoading(isLoading) {
        refreshButton.disabled = isLoading || deleting;
        refreshButton.setAttribute('aria-busy', String(isLoading));
        refreshButton.innerHTML = isLoading
            ? '<span aria-hidden="true">↻</span> Actualisation…'
            : '<span aria-hidden="true">↻</span> Actualiser';
        list.setAttribute('aria-busy', String(isLoading));
    }

    function setDeleteLoading(isLoading) {
        confirmDelete.disabled = isLoading;
        cancelDelete.disabled = isLoading;
        refreshButton.disabled = isLoading || loading;
        confirmDelete.textContent = isLoading ? 'Suppression…' : 'Supprimer';
    }

    function showNotice(message, type) {
        notice.className = `submitted-houses-notice is-${type}`;
        notice.textContent = message;
        notice.hidden = false;
    }

    function hideNotice() {
        notice.hidden = true;
        notice.textContent = '';
    }
});

function clearSession() {
    localStorage.removeItem('goying_access_token');
    localStorage.removeItem('goying_role');
}

function renderLoadingState() {
    return `<div class="submitted-houses-loading">
        <span class="submitted-houses-spinner" aria-hidden="true"></span>
        <p>Chargement des soumissions…</p>
    </div>`;
}

function renderLoadError(message) {
    return `<section class="submitted-houses-state is-error" role="alert">
        <span aria-hidden="true">!</span>
        <h2>Impossible de charger les soumissions</h2>
        <p>${escapeHtml(message)}</p>
        <button type="button" data-retry-submissions>Réessayer</button>
    </section>`;
}

function renderEmptyState() {
    return `<section class="submitted-houses-state" role="status">
        <span aria-hidden="true">▤</span>
        <h2>Aucune soumission</h2>
        <p>Aucune proposition immobilière n’a encore été envoyée par les utilisateurs.</p>
    </section>`;
}

function firstValue(value) {
    if (value === null || value === undefined || typeof value === 'object' || typeof value === 'boolean') return '';
    return String(value).trim();
}

function formatApiError(detail) {
    if (Array.isArray(detail)) return detail.map((item) => item.msg || item.detail || String(item)).join(' ; ');
    if (detail && typeof detail === 'object') return detail.message || detail.msg || detail.detail || 'Une erreur est survenue.';
    return detail || 'Une erreur est survenue.';
}

function getErrorMessage(error) {
    if (error instanceof TypeError) return 'Vérifiez votre connexion puis réessayez.';
    return error instanceof Error ? error.message : 'Une erreur est survenue.';
}

async function readJsonResponse(response) {
    try {
        return await response.json();
    } catch (error) {
        throw new Error('La réponse du serveur est illisible.');
    }
}

function formatDate(value) {
    if (value === null || value === undefined || value === '') return '';
    let date;
    if (typeof value === 'object') {
        const seconds = value.seconds ?? value._seconds;
        if (typeof seconds === 'number') date = new Date(seconds * 1000);
    } else if (typeof value === 'number') {
        date = new Date(value < 100000000000 ? value * 1000 : value);
    } else {
        date = new Date(String(value));
    }
    if (!date || Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function formatStatus(value) {
    const original = firstValue(value);
    const normalized = original.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s-]+/g, '_');
    const known = {
        en_attente: ['En attente', 'is-pending'],
        pending: ['En attente', 'is-pending'],
        approuvee: ['Approuvée', 'is-confirmed'],
        approuve: ['Approuvée', 'is-confirmed'],
        approved: ['Approuvée', 'is-confirmed'],
        accepted: ['Approuvée', 'is-confirmed'],
        refusee: ['Refusée', 'is-cancelled'],
        refuse: ['Refusée', 'is-cancelled'],
        rejected: ['Refusée', 'is-cancelled'],
        annulee: ['Annulée', 'is-cancelled'],
        annule: ['Annulée', 'is-cancelled'],
        cancelled: ['Annulée', 'is-cancelled'],
        canceled: ['Annulée', 'is-cancelled'],
    };
    if (!original) return { label: 'Statut non renseigné', className: 'is-unknown' };
    const mapped = known[normalized];
    if (mapped) return { label: mapped[0], className: mapped[1] };
    const readable = original.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return {
        label: readable.charAt(0).toLocaleUpperCase('fr') + readable.slice(1),
        className: 'is-unknown',
    };
}

function formatType(value) {
    const readable = firstValue(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return readable ? readable.charAt(0).toLocaleUpperCase('fr') + readable.slice(1) : '';
}

function safePhotoUrl(value) {
    const raw = firstValue(value);
    if (!raw) return '';
    try {
        const url = new URL(raw, window.location.origin);
        return url.protocol === 'https:' ? url.href : '';
    } catch {
        return '';
    }
}

function encodeTel(value) {
    return encodeURIComponent(value).replace(/%2B/gi, '+');
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    }[character]));
}
