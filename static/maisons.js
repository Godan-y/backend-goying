document.addEventListener('DOMContentLoaded', () => {
    const availableList = document.getElementById('liste-maisons-disponibles');
    const takenList = document.getElementById('liste-maisons-prises');
    const container = availableList || takenList;
    if (!container) return;

    const isTakenPage = Boolean(takenList);
    const statut = availableList ? 'disponible' : 'indisponible';
    const counter = document.getElementById('compteur-maisons');
    const refreshButton = document.getElementById('actualiser-maisons');
    const notice = document.getElementById('taken-houses-notice');
    const photoDialog = document.getElementById('taken-house-photo-dialog');
    const dialogImage = document.getElementById('taken-house-photo-dialog-image');
    const dialogFallback = document.getElementById('taken-house-photo-dialog-fallback');
    const dialogCount = document.getElementById('taken-house-photo-dialog-count');
    let activePhotoGallery = null;
    let activePhotoIndex = 0;

    loadHouses();
    if (refreshButton) refreshButton.addEventListener('click', loadHouses);
    const logoutButton = document.querySelector('[data-house-logout]');
    if (logoutButton) logoutButton.addEventListener('click', () => {
        localStorage.removeItem('goying_access_token');
        localStorage.removeItem('goying_role');
        window.location.href = '/';
    });
    if (photoDialog) {
        photoDialog.querySelector('[data-taken-photo-close]').addEventListener('click', () => photoDialog.close());
        photoDialog.querySelectorAll('[data-taken-photo-step]').forEach((button) => {
            button.addEventListener('click', () => showTakenPhoto(activePhotoIndex + Number(button.dataset.takenPhotoStep)));
        });
        photoDialog.addEventListener('click', (event) => {
            if (event.target === photoDialog) photoDialog.close();
        });
        photoDialog.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') photoDialog.close();
            if (event.key === 'ArrowLeft') showTakenPhoto(activePhotoIndex - 1);
            if (event.key === 'ArrowRight') showTakenPhoto(activePhotoIndex + 1);
        });
        dialogImage.addEventListener('error', () => {
            dialogImage.hidden = true;
            dialogFallback.hidden = false;
        });
        dialogImage.addEventListener('load', () => {
            dialogImage.hidden = false;
            dialogFallback.hidden = true;
        });
    }

    function showTakenPhoto(index) {
        if (!activePhotoGallery || !photoDialog) return;
        const images = [...activePhotoGallery.querySelectorAll('[data-gallery-image]')];
        if (!images.length) return;
        activePhotoIndex = (index + images.length) % images.length;
        const image = images[activePhotoIndex];
        dialogImage.hidden = false;
        dialogFallback.hidden = true;
        dialogImage.src = image.src;
        dialogImage.alt = image.alt;
        dialogCount.textContent = `${activePhotoIndex + 1} / ${images.length}`;
        if (!photoDialog.open) photoDialog.showModal();
    }

    function showTakenNotice(message, type = 'success') {
        if (!notice) return;
        notice.hidden = false;
        notice.className = `taken-houses-notice is-${type}`;
        notice.textContent = message;
    }

    async function loadHouses() {
        container.setAttribute('aria-busy', 'true');
        if (availableList) {
            container.innerHTML = '<div class="available-houses-loading"><span aria-hidden="true"></span><p>Chargement des maisons…</p></div>';
        } else {
            container.innerHTML = '<div class="taken-houses-loading"><span class="taken-houses-skeleton taken-houses-skeleton-photo"></span><span class="taken-houses-skeleton taken-houses-skeleton-content"></span><span class="taken-houses-spinner" aria-hidden="true"></span><span>Chargement de l’historique…</span></div>';
        }
        if (refreshButton) {
            refreshButton.disabled = true;
            refreshButton.setAttribute('aria-busy', 'true');
            refreshButton.innerHTML = '<span aria-hidden="true">↻</span> Actualisation…';
        }

        try {
            const response = await fetch(`/api/maisons?statut=${statut}`, { cache: 'no-store' });
            const payload = await response.json();
            if (!response.ok) throw new Error(formatApiError(payload.detail, response.status));

            const maisons = Array.isArray(payload) ? payload : [];
            if (counter) {
                counter.textContent = String(maisons.length);
                counter.setAttribute('aria-label', isTakenPage
                    ? `${maisons.length} maison${maisons.length === 1 ? '' : 's'} vendue${maisons.length === 1 ? '' : 's'} ou louée${maisons.length === 1 ? '' : 's'}`
                    : `${maisons.length} maison${maisons.length === 1 ? '' : 's'} disponible${maisons.length === 1 ? '' : 's'}`);
            }
            const countLabel = document.getElementById('available-houses-count-label');
            if (availableList && countLabel) {
                countLabel.textContent = `${maisons.length} maison${maisons.length === 1 ? '' : 's'} disponible${maisons.length === 1 ? '' : 's'}`;
            }
            const takenCountLabel = document.getElementById('taken-houses-count-label');
            if (isTakenPage && takenCountLabel) {
                takenCountLabel.textContent = `${maisons.length} maison${maisons.length === 1 ? '' : 's'} vendue${maisons.length === 1 ? '' : 's'} / louée${maisons.length === 1 ? '' : 's'}`;
            }
            if (!maisons.length) {
                container.innerHTML = availableList
                    ? '<div class="available-houses-empty"><span aria-hidden="true">⌂</span><h2>Aucune maison disponible</h2><p>Aucune maison n’est actuellement disponible sur la plateforme.</p><a href="/maisons/ajouter">＋ Ajouter une maison</a></div>'
                    : '<div class="taken-houses-empty"><span aria-hidden="true">⌂</span><h2>Aucune maison vendue ou louée</h2><p>Aucune maison n’est actuellement présente dans l’historique.</p><a href="/maisons/disponibles">Voir les maisons disponibles</a></div>';
                return;
            }

            container.innerHTML = maisons.map((maison) => availableList
                ? renderAvailableHouse(maison)
                : renderTakenHouse(maison)).join('');
        } catch (error) {
            if (counter) counter.textContent = '0';
            container.innerHTML = availableList
                ? `<div class="available-houses-error" role="alert"><span aria-hidden="true">!</span><div><h2>Impossible de charger les maisons</h2><p>${escapeHtml(error.message)}</p><button type="button" data-houses-retry>Réessayer</button></div></div>`
                : `<div class="taken-houses-error" role="alert"><span aria-hidden="true">!</span><div><h2>Impossible de charger l’historique</h2><p>${escapeHtml(error.message)}</p><button type="button" data-houses-retry>Réessayer</button></div></div>`;
        } finally {
            container.removeAttribute('aria-busy');
            if (refreshButton) {
                refreshButton.disabled = false;
                refreshButton.removeAttribute('aria-busy');
                refreshButton.innerHTML = '<span aria-hidden="true">↻</span> Actualiser';
            }
        }
    }

    container.addEventListener('click', async (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        const retryButton = target.closest('[data-houses-retry]');
        if (retryButton) {
            await loadHouses();
            return;
        }

        const galleryButton = target.closest('[data-gallery-step]');
        if (galleryButton) {
            const gallery = galleryButton.closest('[data-house-gallery]');
            if (!gallery) return;
            const images = [...gallery.querySelectorAll('[data-gallery-image]')];
            if (images.length < 2) return;
            const currentIndex = Number(gallery.dataset.currentIndex || 0);
            const nextIndex = (currentIndex + Number(galleryButton.dataset.galleryStep) + images.length) % images.length;
            images.forEach((image, index) => image.hidden = index !== nextIndex);
            gallery.dataset.currentIndex = String(nextIndex);
            const photoLink = gallery.querySelector('.available-house-photo-link');
            if (photoLink) {
                photoLink.href = images[nextIndex].src;
                photoLink.setAttribute('aria-label', `Agrandir la photo ${nextIndex + 1} de ${images[nextIndex].alt}`);
            }
            const fallback = gallery.querySelector('[data-gallery-fallback]');
            if (fallback) fallback.hidden = true;
            const counterLabel = gallery.querySelector('[data-gallery-counter]');
            if (counterLabel) counterLabel.textContent = `${nextIndex + 1} / ${images.length}`;
            const totalLabel = gallery.querySelector('.available-house-photo-count');
            if (totalLabel) totalLabel.textContent = `${nextIndex + 1} / ${images.length}`;
            return;
        }

        const photoLink = target.closest('.taken-house-photo-link');
        if (photoLink) {
            event.preventDefault();
            activePhotoGallery = photoLink.closest('[data-house-gallery]');
            const galleryIndex = Number(activePhotoGallery?.dataset.currentIndex || 0);
            showTakenPhoto(galleryIndex);
            return;
        }

        const button = event.target.closest('.status-button');
        if (!button) return;

        const originalText = button.innerHTML;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.innerHTML = '<span class="taken-houses-button-spinner" aria-hidden="true"></span> Mise à jour…';
        try {
            const token = getHouseAdminToken();
            const response = await fetch(`/api/maisons/${encodeURIComponent(button.dataset.maisonId)}/${button.dataset.nextStatus}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            const payload = await readApiPayload(response);
            if (!response.ok) throw new Error(formatApiError(payload.detail, response.status));
            if (isTakenPage) {
                showTakenNotice(payload.message || 'Maison remise disponible.', 'success');
            }
            await loadHouses();
        } catch (error) {
            if (isTakenPage) showTakenNotice(error.message || 'Impossible de remettre cette maison disponible.', 'error');
            else alert(error.message);
            button.disabled = false;
            button.removeAttribute('aria-busy');
            button.innerHTML = originalText;
        }
    });

    function renderTakenHouse(maison) {
        const title = safeDisplayValue(maison.titre) || 'Maison sans titre';
        const photos = [...new Set([
            ...(Array.isArray(maison.photo_urls) ? maison.photo_urls : []),
            maison.photo_url,
        ].map(safePhotoUrl).filter(Boolean))];
        const firstPhoto = photos[0];
        const location = [maison.commune, maison.quartier].map(safeDisplayValue).filter(Boolean).join(', ');
        const address = safeDisplayValue(maison.avenue);
        const statusValue = safeDisplayValue(maison.statut) || safeDisplayValue(maison.disponibilite) || statut;
        const type = safeDisplayValue(maison.type_maison) || 'Propriété';
        const bedrooms = safeDisplayValue(maison.chambres);
        const bathrooms = safeDisplayValue(maison.salles_bains);
        const area = safeDisplayValue(maison.superficie);
        const description = safeDisplayValue(maison.description);
        const extraInformation = safeDisplayValue(maison.informations_complementaires);
        const customInformation = Array.isArray(maison.informations_personnalisees)
            ? maison.informations_personnalisees.filter((item) => item && typeof item === 'object' && (safeDisplayValue(item.nom) || safeDisplayValue(item.valeur)))
            : [];
        const transaction = maison.type === 'a_louer' ? 'À louer' : maison.type === 'a_vendre' ? 'À vendre' : safeDisplayValue(maison.type);
        const gallery = firstPhoto
            ? `<div class="available-house-gallery taken-house-gallery" data-house-gallery data-current-index="0">
                <a class="available-house-photo-link taken-house-photo-link" href="${escapeHtml(firstPhoto)}" aria-label="Agrandir les photos de ${escapeHtml(title)}">
                    ${photos.map((photoUrl, index) => `<img data-gallery-image src="${escapeHtml(photoUrl)}" alt="Photo de ${escapeHtml(title)}${photos.length > 1 ? `, ${index + 1} sur ${photos.length}` : ''}" loading="${index ? 'lazy' : 'eager'}"${index ? ' hidden' : ''} onerror="handleGalleryImageError(this)" onload="handleGalleryImageLoad(this)">`).join('')}
                    <span class="available-house-photo-fallback" data-gallery-fallback hidden>⌂<br>Photo indisponible</span>
                    <span class="available-house-zoom" aria-hidden="true">⤢</span>
                </a>
                ${photos.length > 1 ? `<div class="available-house-gallery-controls"><button type="button" data-gallery-step="-1" aria-label="Photo précédente">‹</button><span data-gallery-counter>1 / ${photos.length}</span><button type="button" data-gallery-step="1" aria-label="Photo suivante">›</button></div>` : ''}
                ${photos.length > 1 ? `<span class="available-house-photo-count">1 / ${photos.length}</span>` : ''}
            </div>`
            : '<div class="available-house-gallery taken-house-gallery is-empty"><div class="available-house-photo-fallback">⌂<br>Photo indisponible</div></div>';
        const features = [
            bedrooms ? `<span><b aria-hidden="true">▤</b>${escapeHtml(bedrooms)} chambre${bedrooms === '1' ? '' : 's'}</span>` : '',
            bathrooms ? `<span><b aria-hidden="true">♨</b>${escapeHtml(bathrooms)} salle${bathrooms === '1' ? '' : 's'} de bains</span>` : '',
            area ? `<span><b aria-hidden="true">⌗</b>${escapeHtml(area)}</span>` : '',
        ].filter(Boolean);
        const customDetails = customInformation.length
            ? `<div class="taken-house-custom-details">${customInformation.map((item) => `<p><strong>${escapeHtml(safeDisplayValue(item.nom))}</strong>${safeDisplayValue(item.valeur) ? ` : ${escapeHtml(safeDisplayValue(item.valeur))}` : ''}</p>`).join('')}</div>`
            : '';

        return `<article class="maison available-house-card taken-house-card">
            ${gallery}
            <div class="contenu available-house-content taken-house-content">
                <div class="available-house-type-row">
                    <span class="available-house-type">${escapeHtml(type)}</span>
                    <span class="taken-house-status"><i aria-hidden="true"></i>${escapeHtml(statusValue)}</span>
                </div>
                <div class="available-house-heading">
                    <h2>${escapeHtml(title)}</h2>
                    ${transaction ? `<span class="available-house-transaction">${escapeHtml(transaction)}</span>` : ''}
                </div>
                ${location ? `<p class="available-house-location taken-house-location"><span aria-hidden="true">⌖</span>${escapeHtml(location)}</p>` : ''}
                <p class="available-house-address taken-house-address"><span aria-hidden="true">⌂</span><span><small>Adresse</small>${escapeHtml(address || 'Non renseignée')}</span></p>
                ${features.length ? `<div class="available-house-features">${features.join('')}</div>` : ''}
                <div class="available-house-price"><small>Prix</small><strong>${escapeHtml(formatPrice(maison.prix, maison.devise))}</strong></div>
                ${description ? `<section class="available-house-description"><h3>Description</h3>${renderDescription(description, title)}</section>` : ''}
                ${extraInformation ? `<details class="available-house-extra"><summary>Informations complémentaires</summary><p>${escapeHtml(extraInformation)}</p>${customDetails}</details>` : customDetails}
                <div class="house-actions available-house-actions taken-house-actions">
                    <a class="available-house-edit" href="/maisons/${encodeURIComponent(maison.id)}/modifier"><span aria-hidden="true">✎</span> Modifier</a>
                    <button type="button" class="status-button taken-house-reactivate" data-maison-id="${escapeHtml(maison.id)}" data-next-status="disponible"><span aria-hidden="true">↻</span> Remettre disponible</button>
                    <button type="button" class="delete-house-button available-house-delete" data-maison-id="${escapeHtml(maison.id)}"><span aria-hidden="true">⌫</span> Supprimer</button>
                </div>
            </div>
        </article>`;
    }

    function renderAvailableHouse(maison) {
        const title = safeDisplayValue(maison.titre) || 'Maison sans titre';
        const photos = [...new Set([
            ...(Array.isArray(maison.photo_urls) ? maison.photo_urls : []),
            maison.photo_url,
        ].map(safePhotoUrl).filter(Boolean))];
        const firstPhoto = photos[0];
        const location = [maison.commune, maison.quartier].map(safeDisplayValue).filter(Boolean).join(', ');
        const address = safeDisplayValue(maison.avenue);
        const bedrooms = safeDisplayValue(maison.chambres);
        const area = safeDisplayValue(maison.superficie);
        const price = formatPrice(maison.prix, maison.devise);
        const description = safeDisplayValue(maison.description);
        const extraInformation = safeDisplayValue(maison.informations_complementaires);
        const transaction = maison.type === 'a_louer'
            ? 'À louer'
            : maison.type === 'a_vendre'
                ? 'À vendre'
                : '';
        const gallery = firstPhoto
            ? `<div class="available-house-gallery" data-house-gallery data-current-index="0">
                <a class="available-house-photo-link" href="${escapeHtml(firstPhoto)}" target="_blank" rel="noopener noreferrer" aria-label="Agrandir la photo de ${escapeHtml(title)}">
                    ${photos.map((photoUrl, index) => `<img data-gallery-image src="${escapeHtml(photoUrl)}" alt="Photo de ${escapeHtml(title)}${photos.length > 1 ? `, ${index + 1} sur ${photos.length}` : ''}" loading="${index ? 'lazy' : 'eager'}"${index ? ' hidden' : ''} onerror="handleGalleryImageError(this)" onload="handleGalleryImageLoad(this)">`).join('')}
                    <span class="available-house-photo-fallback" data-gallery-fallback hidden>Photo indisponible</span>
                    <span class="available-house-zoom" aria-hidden="true">⤢</span>
                </a>
                ${photos.length > 1 ? `<div class="available-house-gallery-controls"><button type="button" data-gallery-step="-1" aria-label="Photo précédente">‹</button><span data-gallery-counter>1 / ${photos.length}</span><button type="button" data-gallery-step="1" aria-label="Photo suivante">›</button></div>` : ''}
                <span class="available-house-photo-count">1 / ${photos.length}</span>
            </div>`
            : '<div class="available-house-gallery is-empty"><div class="available-house-photo-fallback">Photo non disponible</div></div>';
        const extras = [bedrooms ? `<span><b aria-hidden="true">▤</b>${escapeHtml(bedrooms)} chambre${bedrooms === '1' ? '' : 's'}</span>` : '', area ? `<span><b aria-hidden="true">⌗</b>${escapeHtml(area)}</span>` : ''].filter(Boolean);

        return `<article class="maison available-house-card">
            ${gallery}
            <div class="contenu available-house-content">
                <div class="available-house-type-row">
                    <span class="available-house-type">${escapeHtml(safeDisplayValue(maison.type_maison) || 'Propriété')}</span>
                    <span class="available-house-status"><i aria-hidden="true"></i> Disponible</span>
                </div>
                <div class="available-house-heading">
                    <h2>${escapeHtml(title)}</h2>
                    ${transaction ? `<span class="available-house-transaction">${escapeHtml(transaction)}</span>` : ''}
                </div>
                ${location ? `<p class="available-house-location"><span aria-hidden="true">⌖</span>${escapeHtml(location)}</p>` : ''}
                ${address ? `<p class="available-house-address"><span aria-hidden="true">⌂</span><span><small>Adresse</small>${escapeHtml(address)}</span></p>` : ''}
                ${extras.length ? `<div class="available-house-features">${extras.join('')}</div>` : ''}
                <div class="available-house-price"><small>Prix affiché</small><strong>${escapeHtml(price)}</strong></div>
                ${description ? `<section class="available-house-description"><h3>Description</h3>${renderDescription(description, title)}</section>` : ''}
                ${extraInformation ? `<details class="available-house-extra"><summary>Informations complémentaires</summary><p>${escapeHtml(extraInformation)}</p></details>` : ''}
                <div class="house-actions available-house-actions">
                    <a class="available-house-edit" href="/maisons/${encodeURIComponent(maison.id)}/modifier"><span aria-hidden="true">✎</span> Modifier</a>
                    <button type="button" class="status-button available-house-mark" data-maison-id="${escapeHtml(maison.id)}" data-next-status="indisponible"><span aria-hidden="true">◇</span> Marquer vendue / louée</button>
                    <button type="button" class="delete-house-button available-house-delete" data-maison-id="${escapeHtml(maison.id)}"><span aria-hidden="true">⌫</span> Supprimer</button>
                </div>
            </div>
        </article>`;
    }
});

function getHouseAdminToken() {
    const token = localStorage.getItem('goying_access_token');
    const role = localStorage.getItem('goying_role');
    if (token && role === 'maisons') return token;

    localStorage.removeItem('goying_access_token');
    localStorage.removeItem('goying_role');
    window.location.href = '/';
    throw new Error('Authentification requise. Reconnectez-vous pour effectuer cette action.');
}

async function readApiPayload(response) {
    try {
        return await response.json();
    } catch {
        return {};
    }
}

function formatApiError(detail, status) {
    if (status === 401 || status === 403) {
        localStorage.removeItem('goying_access_token');
        localStorage.removeItem('goying_role');
        window.location.href = '/';
        return 'Authentification requise. Reconnectez-vous puis réessayez.';
    }
    if (Array.isArray(detail)) return detail.map((item) => item.msg || item.detail || String(item)).join(' ; ');
    if (detail && typeof detail === 'object') return detail.message || detail.detail || JSON.stringify(detail);
    return detail || `La requête a échoué (HTTP ${status}).`;
}

function renderDescription(description, title) {
    const previewLength = 250;
    if (description.length <= previewLength) {
        return `<p>${escapeHtml(description)}</p>`;
    }
    const preview = description.slice(0, previewLength).trimEnd();
    return `<details class="available-house-description-toggle"><summary><span class="available-house-read-more">Lire la suite</span><span class="available-house-read-less">Réduire</span></summary><p class="available-house-description-full">${escapeHtml(description)}</p><span class="sr-only">Description complète de ${escapeHtml(title)}</span></details><p class="available-house-description-preview">${escapeHtml(preview)}…</p>`;
}

function safeDisplayValue(value) {
    if (value === null || value === undefined || typeof value === 'object') return '';
    const text = String(value).trim();
    return text && !['undefined', 'null', 'nan'].includes(text.toLowerCase()) ? text : '';
}

function safePhotoUrl(value) {
    const photoUrl = safeDisplayValue(value);
    if (!photoUrl) return '';
    try {
        const url = new URL(photoUrl, window.location.origin);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
        return '';
    }
}

function handleGalleryImageError(image) {
    const gallery = image.closest('[data-house-gallery]');
    if (!gallery) {
        image.remove();
        return;
    }

    const failedIndex = [...gallery.querySelectorAll('[data-gallery-image]')].indexOf(image);
    const wasActive = !image.hidden;
    image.remove();
    const images = [...gallery.querySelectorAll('[data-gallery-image]')];
    let currentIndex = Number(gallery.dataset.currentIndex || 0);
    if (wasActive) currentIndex = Math.min(failedIndex, images.length - 1);
    else if (failedIndex < currentIndex) currentIndex -= 1;

    const fallback = gallery.querySelector('[data-gallery-fallback]');
    const link = gallery.querySelector('.available-house-photo-link');
    if (images.length) {
        gallery.dataset.currentIndex = String(Math.max(0, currentIndex));
        images.forEach((candidate, index) => candidate.hidden = index !== currentIndex);
        if (link) {
            link.href = images[currentIndex].src;
            link.setAttribute('aria-label', `Agrandir la photo de ${images[currentIndex].alt}`);
        }
    } else {
        gallery.dataset.currentIndex = '0';
        if (fallback) fallback.hidden = false;
        if (link) {
            link.removeAttribute('href');
            link.removeAttribute('target');
        }
    }

    const total = images.length;
    const displayedIndex = total ? currentIndex + 1 : 0;
    const counter = gallery.querySelector('[data-gallery-counter]');
    const photoCount = gallery.querySelector('.available-house-photo-count');
    const controls = gallery.querySelector('.available-house-gallery-controls');
    if (counter) counter.textContent = `${displayedIndex} / ${total}`;
    if (photoCount) photoCount.textContent = `${displayedIndex} / ${total}`;
    if (controls) controls.hidden = total < 2;
}

function handleGalleryImageLoad(image) {
    const gallery = image.closest('[data-house-gallery]');
    if (gallery && !image.hidden) {
        const fallback = gallery.querySelector('[data-gallery-fallback]');
        if (fallback) fallback.hidden = true;
    }
}

function formatPrice(price, currency) {
    if (price === null || price === undefined || price === '') return 'Prix non précisé';
    const numericPrice = Number(price);
    const formattedPrice = Number.isFinite(numericPrice)
        ? new Intl.NumberFormat('fr-FR').format(numericPrice)
        : safeDisplayValue(price);
    return `${formattedPrice} ${safeDisplayValue(currency) || '$'}`;
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
