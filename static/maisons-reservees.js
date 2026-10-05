document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-reservations-page]');
    const list = document.querySelector('#reservations-list');
    const count = document.querySelector('#reservations-count');
    const refreshButton = document.querySelector('#refresh-reservations');
    const logoutButton = document.querySelector('#logout-button');
    const notice = document.querySelector('#reservations-notice');
    const confirmDialog = document.querySelector('#reservation-confirm-dialog');
    const confirmTitle = document.querySelector('#reservation-confirm-title');
    const confirmMessage = document.querySelector('#reservation-confirm-message');
    const confirmButton = document.querySelector('#confirm-reservation-action');
    const cancelButton = document.querySelector('#cancel-reservation-action');
    const token = localStorage.getItem('goying_access_token');
    const role = localStorage.getItem('goying_role');
    let reservations = [];
    let pendingAction = null;
    let loading = false;
    let acting = false;
    let noticeTimer = null;

    if (!page || !list || !count || !refreshButton || !token || role !== 'maisons') {
        clearSession();
        window.location.href = '/';
        return;
    }

    logoutButton.addEventListener('click', () => {
        clearSession();
        window.location.href = '/';
    });
    refreshButton.addEventListener('click', () => loadReservations());
    list.addEventListener('click', handleListClick);
    confirmButton.addEventListener('click', executePendingAction);
    cancelButton.addEventListener('click', closeConfirmation);
    confirmDialog.addEventListener('cancel', () => {
        pendingAction = null;
    });
    loadReservations();

    async function loadReservations() {
        if (loading) return false;
        loading = true;
        refreshButton.disabled = true;
        refreshButton.setAttribute('aria-busy', 'true');
        refreshButton.textContent = 'Actualisation…';
        list.setAttribute('aria-busy', 'true');
        if (!reservations.length) {
            list.innerHTML = '<div class="reservation-loading"><span class="reservation-spinner" aria-hidden="true"></span><p>Chargement des réservations…</p></div>';
        }

        try {
            const response = await fetch(page.dataset.endpoint, {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            });
            const payload = await readResponse(response);
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    clearSession();
                    window.location.href = '/';
                }
                throw new Error(formatApiError(payload.detail, response.status));
            }

            reservations = Array.isArray(payload.reservations) ? payload.reservations : [];
            count.textContent = String(reservations.length);
            list.innerHTML = reservations.length
                ? reservations.map(renderReservation).join('')
                : '<div class="reservation-empty"><span aria-hidden="true">⌂</span><h2>Aucune réservation immobilière</h2><p>Les nouvelles demandes apparaîtront ici dès leur réception.</p><a href="/maisons/disponibles">Consulter les maisons disponibles</a></div>';
            return true;
        } catch (error) {
            list.innerHTML = `<div class="reservation-load-error" role="alert"><span aria-hidden="true">!</span><div><h2>Impossible de charger les réservations</h2><p>${escapeHtml(error.message)}</p><button type="button" class="reservation-retry" data-retry>Réessayer</button></div></div>`;
            return false;
        } finally {
            loading = false;
            refreshButton.disabled = false;
            refreshButton.removeAttribute('aria-busy');
            refreshButton.textContent = 'Actualiser';
            list.removeAttribute('aria-busy');
        }
    }

    async function readResponse(response) {
        try {
            return await response.json();
        } catch {
            return {};
        }
    }

    async function handleListClick(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const retryButton = target.closest('[data-retry]');
        if (retryButton) {
            await loadReservations();
            return;
        }

        const expandButton = target.closest('[data-expand]');
        if (expandButton) {
            const text = document.getElementById(expandButton.dataset.expand);
            if (!text) return;
            const expanded = expandButton.getAttribute('aria-expanded') === 'true';
            text.classList.toggle('is-expanded', !expanded);
            expandButton.setAttribute('aria-expanded', String(!expanded));
            expandButton.textContent = expanded ? 'Lire la suite' : 'Réduire';
            return;
        }

        const copyButton = target.closest('[data-copy-reference]');
        if (copyButton) {
            try {
                await navigator.clipboard.writeText(copyButton.dataset.copyReference);
                showNotice('Identifiant de réservation copié.', 'success');
            } catch {
                showNotice('Impossible de copier l’identifiant sur cet appareil.', 'error');
            }
            return;
        }

        const actionButton = target.closest('[data-reservation-action]');
        if (!actionButton || actionButton.disabled) return;
        const reservation = reservations.find((item) => item.id === actionButton.dataset.id);
        if (!reservation) {
            showNotice('Cette réservation ne figure plus dans la liste. Actualisez la page.', 'error');
            return;
        }
        openConfirmation(reservation, actionButton.dataset.reservationAction);
    }

    function openConfirmation(reservation, action) {
        if (acting || !confirmDialog) return;
        const property = bookingProperty(reservation);
        const title = reservationTitle(reservation, property);
        pendingAction = { id: reservation.id, action };
        const releasing = action === 'release';
        confirmTitle.textContent = releasing
            ? 'Annuler la réservation et libérer le bien ?'
            : 'Approuver la réservation ?';
        confirmMessage.textContent = releasing
            ? `La réservation de « ${title} » sera marquée comme annulée et le bien redeviendra disponible.`
            : `La réservation de « ${title} » sera confirmée et le bien deviendra indisponible.`;
        confirmButton.textContent = releasing ? 'Confirmer l’annulation et la libération' : 'Approuver et rendre indisponible';
        confirmDialog.showModal();
    }

    function closeConfirmation() {
        pendingAction = null;
        if (confirmDialog.open) confirmDialog.close();
    }

    async function executePendingAction() {
        if (!pendingAction || acting) return;
        const action = pendingAction;
        acting = true;
        confirmButton.disabled = true;
        cancelButton.disabled = true;
        confirmButton.textContent = 'Enregistrement…';
        try {
            const endpointAction = action.action === 'approve' ? 'approuver' : 'liberer';
            const response = await fetch(
                `/maisons/api/reservations/${encodeURIComponent(action.id)}/${endpointAction}`,
                {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${token}` },
                },
            );
            const payload = await readResponse(response);
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    clearSession();
                    window.location.href = '/';
                }
                throw new Error(formatApiError(payload.detail, response.status));
            }

            closeConfirmation();
            const refreshed = await loadReservations();
            showNotice(
                refreshed
                    ? payload.message || 'La réservation a été mise à jour.'
                    : `${payload.message || 'La réservation a été mise à jour.'} La liste n’a pas pu être actualisée.`,
                refreshed ? 'success' : 'error',
            );
        } catch (error) {
            showNotice(error.message, 'error');
        } finally {
            acting = false;
            confirmButton.disabled = false;
            cancelButton.disabled = false;
            if (confirmDialog.open) confirmButton.textContent = pendingAction?.action === 'release'
                ? 'Confirmer l’annulation et la libération'
                : 'Approuver et rendre indisponible';
        }
    }

    function showNotice(message, kind) {
        if (!notice) return;
        window.clearTimeout(noticeTimer);
        notice.textContent = message;
        notice.className = `reservation-notice is-${kind}`;
        notice.hidden = false;
        noticeTimer = window.setTimeout(() => {
            notice.hidden = true;
        }, 6500);
    }

    function renderReservation(reservation) {
        const property = bookingProperty(reservation);
        const title = reservationTitle(reservation, property);
        const image = safeImageUrl(firstValue(
            reservation.photo_bien,
            reservation.photo_url,
            firstArrayValue(reservation.photo_urls),
            property.imageUrl,
            property.photo_url,
            firstArrayValue(property.photo_urls),
            firstArrayValue(property.imageUrls),
        ));
        const location = firstValue(
            reservation.localisation,
            [property.commune, property.quartier, property.avenue].filter(isPresent).join(', '),
            property.localisation,
            property.address,
            property.location,
        );
        const type = firstValue(reservation.type_bien, property.type_maison, property.propertyType);
        const transactionType = formatTransactionType(firstValue(reservation.type, property.type));
        const price = formatPrice(reservation, property);
        const clientName = firstValue(reservation.clientName, reservation.nom_client);
        const phone = firstValue(
            reservation.clientWhatsApp,
            reservation.clientPhone,
            reservation.telephone_client,
            reservation.phone_client,
        );
        const email = firstValue(reservation.clientEmail, reservation.email_client);
        const status = firstValue(reservation.status, reservation.statut);
        const statusNormalized = normalize(status);
        const isCancelled = ['annule', 'annulee', 'cancelled', 'canceled', 'refuse', 'refusee'].includes(statusNormalized);
        const isApproved = !isCancelled && (
            reservation.approved === true
            || ['confirme', 'approuve', 'approved', 'confirmed'].includes(statusNormalized)
        );
        const isPending = ['en attente', 'en_attente', 'attente', 'pending'].includes(statusNormalized);
        const hasPropertyLink = Boolean(firstValue(reservation.propertyId, reservation.bien_id, property.id));
        const availability = getAvailability(property, isApproved);
        const reservationId = firstValue(reservation.id);
        const characteristicsValue = [
            reservation.informations_personnalisees,
            reservation.informations_complementaires,
            property.informations_personnalisees,
            property.informations_complementaires,
        ].find((value) => value !== null && value !== undefined && (typeof value !== 'string' || value.trim()));
        const characteristics = formatCharacteristics(characteristicsValue);
        const description = firstValue(reservation.description, property.description);
        const visitDetails = firstValue(reservation.details, reservation.visitDetails);
        const plannedDate = formatDate(reservation.date || reservation.date_visite);
        const creationDate = formatDate(reservation.date_reservation || reservation.createdAt);
        const acknowledged = typeof reservation.acknowledgedByClient === 'boolean'
            ? reservation.acknowledgedByClient
            : null;
        const whatsappNumber = window.normalizeWhatsappNumber(
            phone,
            firstValue(
                reservation.clientCountryCode,
                reservation.clientCountry,
                reservation.clientPays,
                reservation.pays_client,
                reservation.clientPhoneCountry,
            ),
        );
        const whatsappMessage = createWhatsappMessage({ clientName, title, location, plannedDate });
        const whatsappUrl = whatsappNumber
            ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(whatsappMessage)}`
            : '';
        const canApprove = isPending
            && !isApproved
            && !isCancelled
            && hasPropertyLink
            && availability === 'disponible';
        const canRelease = isApproved && property.reservedByBookingId === reservationId;
        const actionMarkup = canApprove
            ? `<button type="button" class="property-reservation-action is-primary" data-reservation-action="approve" data-id="${escapeHtml(reservationId)}">Approuver et rendre indisponible</button>`
            : canRelease
                ? `<button type="button" class="property-reservation-action is-secondary" data-reservation-action="release" data-id="${escapeHtml(reservationId)}">Annuler et rendre disponible</button>`
                : '';
        let actionExplanation = '';
        if (isCancelled) {
            actionExplanation = 'Cette réservation a été annulée et ne peut plus être approuvée.';
        } else if (isPending && !hasPropertyLink) {
            actionExplanation = 'Aucune maison liée à cette réservation n’a pu être identifiée.';
        } else if (isApproved && !canRelease) {
            actionExplanation = 'La réservation est approuvée, mais la maison n’est pas enregistrée comme indisponible à cause de cette réservation. Vérifiez sa disponibilité avant toute réactivation.';
        } else if (isPending && availability !== 'disponible') {
            actionExplanation = 'La disponibilité de la maison est indisponible ou ne peut pas être vérifiée. Cette réservation ne peut pas être approuvée ici.';
        } else if (!isApproved && !isPending) {
            actionExplanation = 'Le statut actuel ne permet pas de traiter cette réservation.';
        }
        const safeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
        const safeTel = phone.replace(/[^\d+]/g, '');
        const hasDetails = Boolean(
            plannedDate || creationDate || description || characteristics.length || visitDetails || acknowledged !== null,
        );

        return `<article class="appointment-card property-booking-card${isCancelled ? ' is-cancelled' : ''}" data-reservation-id="${escapeHtml(reservationId)}">
            <header class="property-booking-header">
                <div class="property-booking-photo${image ? '' : ' is-empty'}">
                    ${image
                        ? `<a href="${escapeHtml(image)}" target="_blank" rel="noopener noreferrer" aria-label="Ouvrir la photo de ${escapeHtml(title)} en grand"><img src="${escapeHtml(image)}" alt="Photo de ${escapeHtml(title)}" loading="lazy" onerror="this.closest('.property-booking-photo').classList.add('is-empty'); this.remove();"><span class="property-photo-fallback" aria-hidden="true">Photo indisponible</span></a>`
                        : '<div class="property-photo-fallback">Photo non renseignée</div>'}
                </div>
                <div class="property-booking-summary">
                    <p class="eyebrow">Réservation immobilière</p>
                    <h2>${escapeHtml(title)}</h2>
                    ${location ? `<p class="property-booking-meta">${bookingIcon('location')}${escapeHtml(location)}</p>` : '<p class="property-booking-meta is-missing">Localisation non renseignée</p>'}
                    ${price ? `<p class="property-booking-price">${escapeHtml(price)}</p>` : ''}
                    <div class="property-booking-classification">
                        ${type ? `<span>${escapeHtml(type)}</span>` : ''}
                        ${transactionType ? `<span>${escapeHtml(transactionType)}</span>` : ''}
                    </div>
                    <div class="property-booking-status-row">
                        <span class="property-booking-status ${isCancelled ? 'is-cancelled' : isApproved ? 'is-confirmed' : isPending ? 'is-pending' : 'is-unknown'}">${isCancelled ? 'Annulée' : isApproved ? 'Approuvée' : isPending ? 'En attente' : 'Statut à vérifier'}</span>
                        ${isApproved && statusNormalized === 'confirme' ? '<span class="property-booking-status is-confirmed">Confirmée</span>' : ''}
                        ${availability ? `<span class="property-booking-status ${availability === 'disponible' ? 'is-available' : 'is-unavailable'}">${availability === 'disponible' ? 'Disponible' : 'Indisponible'}</span>` : ''}
                    </div>
                    ${reservationId ? `<div class="property-booking-reference">Réservation <code>${escapeHtml(reservationId)}</code><button type="button" class="property-copy-reference" data-copy-reference="${escapeHtml(reservationId)}" aria-label="Copier l’identifiant de réservation">Copier</button></div>` : ''}
                </div>
            </header>

            ${clientName || phone || email ? `<section class="property-booking-section">
                <h3>Informations du client</h3>
                <div class="property-client-details">
                    ${clientName ? `<p>${bookingIcon('user')}<span><strong>${escapeHtml(clientName)}</strong></span></p>` : '<p class="is-missing">Nom du client non renseigné</p>'}
                    ${safeEmail ? `<p>${bookingIcon('email')}<a href="mailto:${escapeHtml(safeEmail)}">${escapeHtml(safeEmail)}</a></p>` : email ? `<p>${bookingIcon('email')}<span>${escapeHtml(email)}</span></p>` : ''}
                    ${phone ? `<p>${bookingIcon('phone')}<a href="tel:${escapeHtml(safeTel)}">${escapeHtml(phone)}</a></p>` : ''}
                </div>
            </section>` : '<section class="property-booking-section"><h3>Informations du client</h3><p class="property-booking-missing">Coordonnées du client non renseignées.</p></section>'}

            ${hasDetails ? `<section class="property-booking-section">
                <h3>Détails de la réservation</h3>
                <div class="property-reservation-details">
                    ${plannedDate ? `<div class="property-detail-item">${bookingIcon('calendar')}<div><strong>Date prévue</strong><p>${escapeHtml(plannedDate)}</p></div></div>` : ''}
                    ${creationDate ? `<div class="property-detail-item">${bookingIcon('clock')}<div><strong>Date de création</strong><p>${escapeHtml(creationDate)}</p></div></div>` : ''}
                    ${description ? `<div class="property-detail-item property-detail-wide">${bookingIcon('description')}<div><strong>Description du bien</strong>${renderExpandableText(description, `description-${reservationId}`)}</div></div>` : ''}
                    ${characteristics.length ? `<div class="property-detail-item property-detail-wide">${bookingIcon('list')}<div><strong>Informations complémentaires</strong><ul>${characteristics.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div></div>` : ''}
                    ${visitDetails ? `<div class="property-detail-item property-detail-wide">${bookingIcon('visit')}<div><strong>Détails de la visite</strong>${renderExpandableText(visitDetails, `visit-${reservationId}`)}</div></div>` : ''}
                    ${acknowledged !== null ? `<div class="property-detail-item">${bookingIcon('check')}<div><strong>Prise de connaissance du client</strong><p>${acknowledged ? 'Confirmée' : 'Non confirmée'}</p></div></div>` : ''}
                </div>
            </section>` : '<section class="property-booking-section"><h3>Détails de la réservation</h3><p class="property-booking-missing">Aucun détail complémentaire n’a été renseigné.</p></section>'}

            <div class="property-booking-actions">
                ${whatsappUrl
                    ? `<a class="property-whatsapp-button" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener noreferrer">${bookingIcon('whatsapp')}Contacter le client sur WhatsApp</a>`
                    : `<p class="property-whatsapp-unavailable" role="status">Numéro WhatsApp absent ou ambigu. Vérifiez le numéro et le pays du client avant de le contacter.</p>`}
                ${actionMarkup}
                ${actionExplanation ? `<p class="property-action-explanation">${escapeHtml(actionExplanation)}</p>` : ''}
                ${isApproved && !canRelease ? `<a class="property-availability-link" href="/maisons/disponibles">Vérifier la disponibilité du bien</a>` : ''}
            </div>
        </article>`;
    }
});

function clearSession() {
    localStorage.removeItem('goying_access_token');
    localStorage.removeItem('goying_role');
}

function formatApiError(detail, status) {
    if (Array.isArray(detail)) return detail.map((item) => item.msg || item.detail || String(item)).join(' ; ');
    if (detail && typeof detail === 'object') return detail.msg || detail.detail || JSON.stringify(detail);
    if (detail) return detail;
    return status ? `La requête a échoué (HTTP ${status}).` : 'Une erreur est survenue.';
}

function bookingProperty(reservation) {
    return reservation.property && typeof reservation.property === 'object' && !Array.isArray(reservation.property)
        ? reservation.property
        : {};
}

function reservationTitle(reservation, property) {
    return firstValue(
        reservation.titre_bien,
        reservation.itemName,
        reservation.title,
        property.titre,
        property.title,
    ) || 'Bien immobilier';
}

function firstValue(...values) {
    for (const value of values) {
        if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'object') continue;
        const text = String(value).trim();
        if (text && !['undefined', 'null', 'nan'].includes(text.toLowerCase())) return text;
    }
    return '';
}

function firstArrayValue(value) {
    if (!Array.isArray(value)) return '';
    for (const item of value) {
        const candidate = typeof item === 'object' && item ? firstValue(item.url, item.photo_url, item.imageUrl) : firstValue(item);
        if (candidate) return candidate;
    }
    return '';
}

function isPresent(value) {
    return typeof value === 'string' && value.trim() && !['undefined', 'null', 'nan'].includes(value.trim().toLowerCase());
}

function formatPrice(reservation, property) {
    const amount = firstValue(property.prix, property.price, reservation.prix, reservation.costInfo);
    if (!amount) return '';
    const currency = firstValue(property.devise, property.currency, reservation.devise, reservation.currency);
    if (!currency || amount.toLowerCase().includes(currency.toLowerCase())) return amount;
    return `${amount} ${currency}`;
}

function formatTransactionType(value) {
    const normalized = normalize(value).replaceAll(' ', '_');
    if (['a_louer', 'louer', 'location', 'rent', 'rental'].includes(normalized)) return 'À louer';
    if (['a_vendre', 'vendre', 'vente', 'sale', 'sell'].includes(normalized)) return 'À vendre';
    return '';
}

function getAvailability(property, isApproved) {
    if (property.reservedByBookingId) return 'indisponible';
    if (isApproved) return 'indisponible';
    const status = normalize(firstValue(property.statut));
    if (property.approuvee === true && ['a louer', 'a vendre', 'a_louer', 'a_vendre'].includes(status)) {
        return 'disponible';
    }
    const availability = status || normalize(firstValue(property.disponibilite));
    if (['disponible', 'available'].includes(availability)) return 'disponible';
    if (['indisponible', 'unavailable'].includes(availability)) return 'indisponible';
    return '';
}

function formatCharacteristics(value) {
    if (Array.isArray(value)) {
        return value.map((item) => {
            if (item && typeof item === 'object') {
                const label = firstValue(item.nom, item.label, item.name);
                const content = firstValue(item.valeur, item.value, item.description);
                return label && content ? `${label} : ${content}` : label || content;
            }
            return firstValue(item);
        }).filter(Boolean);
    }
    if (value && typeof value === 'object') {
        return Object.entries(value)
            .map(([key, item]) => {
                const content = firstValue(item);
                return content ? `${key} : ${content}` : '';
            })
            .filter(Boolean);
    }
    const text = firstValue(value);
    if (!text) return [];
    try {
        const parsed = JSON.parse(text);
        if (parsed !== value) return formatCharacteristics(parsed);
    } catch {
        // Plain text is the existing fallback format.
    }
    return text.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

function renderExpandableText(value, id) {
    const expandable = value.length > 300;
    return `<p${expandable ? ` class="property-expandable-text" id="${escapeHtml(id)}"` : ''}>${escapeHtml(value)}</p>${expandable ? `<button type="button" class="property-expand-button" data-expand="${escapeHtml(id)}" aria-expanded="false">Lire la suite</button>` : ''}`;
}

function safeImageUrl(value) {
    const url = firstValue(value);
    if (!url) return '';
    try {
        const parsed = new URL(url, window.location.origin);
        return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : '';
    } catch {
        return '';
    }
}

function bookingIcon(name) {
    const paths = {
        user: '<circle cx="12" cy="8" r="4"></circle><path d="M5 21a7 7 0 0 1 14 0"></path>',
        email: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m3 7 9 6 9-6"></path>',
        phone: '<path d="M5 4h4l2 5-3 2a15 15 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"></path>',
        calendar: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18"></path>',
        clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
        description: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6M8 13h8M8 17h8"></path>',
        list: '<path d="M9 6h11M9 12h11M9 18h11"></path><path d="M4 6h.01M4 12h.01M4 18h.01"></path>',
        visit: '<path d="M3 5h18v14H3zM7 9h10M7 13h7"></path>',
        check: '<path d="m5 12 4 4L19 6"></path>',
        location: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2"></circle>',
        whatsapp: '<path d="M20 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.2-4.1A8.5 8.5 0 1 1 20 11.5Z"></path><path d="M8 8.5c.8 2.3 2.2 3.7 4.5 4.5l1.2-1.2 2.3 1.1c-.2 1.4-1 2.1-2.4 2-3.7-.4-6.7-3.4-7.1-7.1-.1-1.4.6-2.2 2-2.4l1.1 2.3Z"></path>',
    };
    return `<svg class="property-detail-icon property-icon-${name}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
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
        const text = String(value).trim();
        const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        date = dateOnly
            ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
            : new Date(text);
        if (Number.isNaN(date.getTime())) return text;
    }
    if (!date || Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    }).format(date);
}

function createWhatsappMessage({ clientName, title, location, plannedDate }) {
    const greeting = clientName ? `Bonjour ${clientName}` : 'Bonjour';
    const home = title ? `le bien ${title}` : 'votre réservation immobilière';
    const place = location ? ` situé à ${location}` : '';
    const date = plannedDate ? `, prévue le ${plannedDate}` : '';
    return `${greeting}, je vous contacte au sujet de votre réservation pour ${home}${place}${date}. Nous souhaitons assurer le suivi de votre demande. Merci de nous confirmer votre disponibilité. Cordialement, l’équipe Goying.`;
}

function normalize(value) {
    return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    }[character]));
}
