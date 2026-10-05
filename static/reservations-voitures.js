document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-car-bookings-page]');
    const list = document.querySelector('#bookings-list');
    const count = document.querySelector('#bookings-count');
    const refreshButton = document.querySelector('#refresh-bookings');
    const refreshLabel = refreshButton?.querySelector('[data-refresh-label]');
    const logoutButton = document.querySelector('#logout-button');
    const feedback = document.querySelector('#bookings-feedback');
    const confirmDialog = document.querySelector('#booking-confirm-dialog');
    const confirmTitle = document.querySelector('#booking-confirm-title');
    const confirmDescription = document.querySelector('#booking-confirm-description');
    const confirmError = document.querySelector('#booking-confirm-error');
    const confirmCancel = document.querySelector('#booking-confirm-cancel');
    const confirmSubmit = document.querySelector('#booking-confirm-submit');
    const saleHistoryPanel = document.querySelector('.car-sale-history-panel');
    const saleHistoryList = document.querySelector('#sale-history-list');
    const saleHistoryCount = document.querySelector('#sale-history-count');
    const saleHistoryFeedback = document.querySelector('#sale-history-feedback');
    const token = localStorage.getItem('goying_access_token');
    const isHistory = page?.dataset.history === 'true';

    if (!page || !list || !count || !refreshButton || !refreshLabel || !logoutButton
        || !feedback || !confirmDialog || !confirmTitle || !confirmDescription
        || !confirmError || !confirmCancel || !confirmSubmit || !token
        || (isHistory && (!saleHistoryPanel || !saleHistoryList || !saleHistoryCount || !saleHistoryFeedback))
        || localStorage.getItem('goying_role') !== 'voitures') {
        clearSession();
        window.location.href = '/';
        return;
    }

    let bookings = [];
    let saleHistoryRequests = [];
    let hasLoaded = false;
    let isLoading = false;
    let isLoadingSaleHistory = false;
    let pendingAction = null;
    let isSubmittingAction = false;
    const busyBookingIds = new Set();
    const busySaleRequestIds = new Set();

    logoutButton.addEventListener('click', () => {
        clearSession();
        window.location.href = '/';
    });
    refreshButton.addEventListener('click', () => {
        loadBookings();
        if (isHistory) loadSaleHistory();
    });
    list.addEventListener('click', handleAction);
    list.addEventListener('error', handleImageError, true);
    saleHistoryList?.addEventListener('click', handleSaleHistoryAction);
    saleHistoryList?.addEventListener('error', handleImageError, true);
    confirmSubmit.addEventListener('click', submitConfirmedAction);
    confirmCancel.addEventListener('click', () => {
        if (!isSubmittingAction) confirmDialog.close();
    });
    confirmDialog.addEventListener('cancel', (event) => {
        if (isSubmittingAction) event.preventDefault();
    });
    confirmDialog.addEventListener('close', clearPendingAction);

    loadBookings();
    if (isHistory) loadSaleHistory();

    async function loadBookings() {
        if (isLoading) return false;
        isLoading = true;
        refreshButton.disabled = true;
        refreshButton.setAttribute('aria-busy', 'true');
        refreshLabel.textContent = 'Actualisation…';
        list.setAttribute('aria-busy', 'true');
        if (!hasLoaded) feedback.hidden = true;

        try {
            const response = await fetch(`/api/voitures/reservations?historique=${isHistory}`, {
                headers: authHeaders(),
                cache: 'no-store',
            });
            const payload = await readJsonResponse(response);
            if (!response.ok) throw new Error(formatApiError(payload.detail));
            if (!Array.isArray(payload.reservations)) {
                throw new Error('La réponse du serveur ne contient pas la liste des réservations.');
            }

            bookings = payload.reservations;
            hasLoaded = true;
            count.textContent = String(bookings.length);
            renderBookings();
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

    async function loadSaleHistory() {
        if (isLoadingSaleHistory) return;
        isLoadingSaleHistory = true;
        saleHistoryList.setAttribute('aria-busy', 'true');
        saleHistoryFeedback.hidden = true;
        try {
            const response = await fetch('/api/voitures/demandes-achat?historique=true', {
                headers: authHeaders(),
                cache: 'no-store',
            });
            const payload = await readJsonResponse(response);
            if ([401, 403].includes(response.status)) {
                clearSession();
                window.location.href = '/';
                return;
            }
            if (!response.ok) throw new Error(formatApiError(payload.detail));
            if (!Array.isArray(payload.requests)) {
                throw new Error('La réponse ne contient pas les demandes d’achat.');
            }

            saleHistoryRequests = payload.requests;
            saleHistoryCount.textContent = String(saleHistoryRequests.length);
            saleHistoryList.innerHTML = saleHistoryRequests.length
                ? saleHistoryRequests.map(renderSaleHistoryRequest).join('')
                : `<div class="car-bookings-empty">
                    <span aria-hidden="true">◷</span>
                    <h2>Aucune vente clôturée dans l’historique</h2>
                    <p>Les demandes d’achat réalisées ou annulées apparaîtront ici.</p>
                    <a href="/voitures/demandes-achat">Voir les demandes d’achat</a>
                </div>`;
        } catch (error) {
            const message = getErrorMessage(error);
            saleHistoryCount.textContent = '—';
            saleHistoryList.innerHTML = `<div class="car-bookings-error" role="alert">
                <span aria-hidden="true">!</span>
                <h2>Impossible de charger l’historique des ventes</h2>
                <p>${escapeHtml(message)}</p>
                <button type="button" data-retry-sale-history>Réessayer</button>
            </div>`;
            saleHistoryFeedback.textContent = message;
            saleHistoryFeedback.className = 'car-bookings-feedback is-error';
            saleHistoryFeedback.hidden = false;
        } finally {
            isLoadingSaleHistory = false;
            saleHistoryList.setAttribute('aria-busy', 'false');
        }
    }

    function renderSaleHistoryRequest(request) {
        const vehicleName = [request.brand, request.model].map(clean).filter(Boolean).join(' ')
            || 'Voiture demandée';
        const seller = request.seller && typeof request.seller === 'object' ? request.seller : {};
        const imageUrl = safeImageUrl(
            request.mainImageUrl || seller.imageUrl
                || (Array.isArray(seller.imageUrls) ? seller.imageUrls[0] : ''),
        );
        const buyerName = clean(request.buyerName) || 'Acheteur non renseigné';
        const status = clean(request.status);
        const location = [request.commune, request.city].map(clean).filter(Boolean).join(', ');
        const photo = imageUrl
            ? `<img class="car-booking-photo-image" src="${escapeHtml(imageUrl)}" alt="Photo de ${escapeHtml(vehicleName)}" loading="lazy">
                <div class="car-booking-photo-placeholder" hidden><span aria-hidden="true">🚗</span><small>Photo indisponible</small></div>`
            : '<div class="car-booking-photo-placeholder"><span aria-hidden="true">🚗</span><small>Photo indisponible</small></div>';
        const numericPrice = Number(request.priceUsd);
        const price = (request.priceUsd === 0 || request.priceUsd) && Number.isFinite(numericPrice)
            ? `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(numericPrice)} USD`
            : 'Non renseigné';

        return `<article class="car-booking-card car-sale-history-card">
            <header class="car-booking-card-header">
                <div class="car-booking-photo${imageUrl ? '' : ' is-empty'}">
                    ${photo}
                    <span class="car-booking-status-badge ${statusClassName(status)}">${escapeHtml(status)}</span>
                </div>
                <div class="car-booking-vehicle">
                    <p class="car-bookings-kicker">Achat d’un véhicule</p>
                    <h2 title="${escapeHtml(vehicleName)}">${escapeHtml(vehicleName)}</h2>
                    <p class="car-booking-reference">Demande <span>${escapeHtml(request.id || '—')}</span></p>
                </div>
            </header>
            <div class="car-booking-sections">
                <section class="car-booking-section car-booking-client">
                    <h3><span aria-hidden="true">♙</span> Acheteur</h3>
                    <strong class="car-booking-client-name">${escapeHtml(buyerName)}</strong>
                    <span class="car-booking-client-phone">${escapeHtml(clean(request.buyerWhatsApp) || 'WhatsApp non renseigné')}</span>
                    ${clean(request.buyerCommune) ? `<span class="car-sale-history-commune">Commune : ${escapeHtml(clean(request.buyerCommune))}</span>` : ''}
                </section>
                <section class="car-booking-section car-booking-rental">
                    <h3><span aria-hidden="true">▦</span> Vente</h3>
                    <div class="car-booking-detail-grid">
                        <div><small>Prix demandé</small><strong>${escapeHtml(price)}</strong></div>
                        <div><small>Année</small><strong>${escapeHtml(clean(request.year) || 'Non renseignée')}</strong></div>
                        <div><small>Localisation</small><strong>${escapeHtml(location || 'Non renseignée')}</strong></div>
                        <div><small>Clôturée le</small><strong>${escapeHtml(formatArchiveDate(request.updatedAt || request.createdAt))}</strong></div>
                    </div>
                </section>
            </div>
            <footer class="car-booking-actions">
                <button type="button" class="car-booking-action is-delete" data-sale-history-delete="${escapeHtml(request.id)}">Supprimer</button>
            </footer>
        </article>`;
    }

    function handleSaleHistoryAction(event) {
        if (event.target.closest('[data-retry-sale-history]')) {
            loadSaleHistory();
            return;
        }

        const button = event.target.closest('[data-sale-history-delete]');
        if (!button || button.disabled) return;
        const request = saleHistoryRequests.find((item) => String(item.id) === button.dataset.saleHistoryDelete);
        if (!request) {
            saleHistoryFeedback.textContent = 'Cette demande n’est plus dans l’historique. Actualisez les données.';
            saleHistoryFeedback.className = 'car-bookings-feedback is-error';
            saleHistoryFeedback.hidden = false;
            return;
        }
        const requestId = String(request.id);
        if (busySaleRequestIds.has(requestId)) return;

        const vehicleName = [request.brand, request.model].map(clean).filter(Boolean).join(' ')
            || 'ce véhicule';
        pendingAction = { action: 'delete-sale', bookingId: requestId };
        confirmTitle.textContent = 'Supprimer cette demande d’achat ?';
        confirmDescription.textContent = `Cette action supprimera définitivement la demande d’achat de ${vehicleName}, enregistrée au nom de ${clean(request.buyerName) || 'cet acheteur'}.`;
        confirmSubmit.textContent = 'Supprimer';
        confirmSubmit.classList.add('is-destructive');
        confirmError.textContent = '';
        confirmError.hidden = true;
        confirmSubmit.disabled = false;
        confirmCancel.disabled = false;
        confirmDialog.showModal();
    }

    function formatArchiveDate(value) {
        let dateValue = value;
        if (value && typeof value === 'object') {
            const seconds = value.seconds ?? value._seconds;
            if (typeof seconds === 'number') dateValue = seconds * 1000;
        }
        if (typeof dateValue !== 'string' && typeof dateValue !== 'number') return 'Date inconnue';
        const date = new Date(dateValue);
        if (Number.isNaN(date.getTime())) return 'Date inconnue';
        return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
    }

    function handleAction(event) {
        if (event.target.closest('[data-retry-bookings]')) {
            loadBookings();
            return;
        }

        const button = event.target.closest('[data-booking-action]');
        if (!button || button.disabled) return;
        const booking = bookings.find((item) => String(item.id) === button.dataset.id);
        if (!booking) {
            showFeedback('Cette réservation n’est plus dans la liste. Actualisez les données.', 'error');
            return;
        }

        const action = button.dataset.bookingAction;
        if (busyBookingIds.has(String(booking.id))) return;
        if (action !== 'annuler' && action !== 'delete') {
            performBookingAction(action, booking, false);
            return;
        }

        const confirmation = confirmationFor(action, booking);
        if (!confirmation) return;

        pendingAction = { action, bookingId: String(booking.id) };
        confirmTitle.textContent = confirmation.title;
        confirmDescription.textContent = confirmation.description;
        confirmSubmit.textContent = confirmation.submitLabel;
        confirmSubmit.classList.toggle('is-destructive', action === 'annuler' || action === 'delete');
        confirmError.textContent = '';
        confirmError.hidden = true;
        confirmSubmit.disabled = false;
        confirmCancel.disabled = false;
        confirmDialog.showModal();
    }

    function confirmationFor(action, booking) {
        const vehicleName = clean(booking.itemName) || 'ce véhicule';
        if (action === 'annuler') {
            return {
                title: 'Annuler cette réservation ?',
                description: `Cette action modifiera le statut de la réservation pour ${vehicleName}.`,
                submitLabel: 'Confirmer l’annulation',
            };
        }
        if (action === 'delete') {
            return {
                title: 'Supprimer cette réservation ?',
                description: `Cette action supprimera définitivement la réservation de ${vehicleName}.`,
                submitLabel: 'Supprimer',
            };
        }
        return null;
    }

    async function submitConfirmedAction() {
        if (!pendingAction || isSubmittingAction) return;
        const { action, bookingId } = pendingAction;
        if (action === 'delete-sale') {
            await submitSaleHistoryDeletion(bookingId);
            return;
        }
        const booking = bookings.find((item) => String(item.id) === bookingId);
        if (!booking) {
            confirmError.textContent = 'Cette réservation n’est plus dans la liste. Actualisez les données.';
            confirmError.hidden = false;
            return;
        }

        isSubmittingAction = true;
        confirmSubmit.disabled = true;
        confirmCancel.disabled = true;
        confirmError.textContent = '';
        confirmError.hidden = true;
        await performBookingAction(action, booking, true);
        isSubmittingAction = false;
        confirmSubmit.disabled = false;
        confirmCancel.disabled = false;
        const confirmation = confirmationFor(action, booking);
        confirmSubmit.textContent = confirmation?.submitLabel || 'Confirmer';
    }

    async function submitSaleHistoryDeletion(requestId) {
        const request = saleHistoryRequests.find((item) => String(item.id) === requestId);
        if (!request || busySaleRequestIds.has(requestId)) {
            confirmError.textContent = 'Cette demande n’est plus dans l’historique. Actualisez les données.';
            confirmError.hidden = false;
            return;
        }

        busySaleRequestIds.add(requestId);
        isSubmittingAction = true;
        confirmSubmit.disabled = true;
        confirmCancel.disabled = true;
        confirmSubmit.textContent = 'Suppression…';
        confirmError.textContent = '';
        confirmError.hidden = true;
        const card = Array.from(saleHistoryList.querySelectorAll('.car-sale-history-card'))
            .find((element) => element.querySelector('[data-sale-history-delete]')?.dataset.saleHistoryDelete === requestId);
        const deleteButton = card?.querySelector('[data-sale-history-delete]');
        if (deleteButton) {
            deleteButton.disabled = true;
            deleteButton.textContent = 'Suppression…';
        }

        try {
            const response = await fetch(`/api/voitures/demandes-achat/${encodeURIComponent(requestId)}`, {
                method: 'DELETE',
                headers: authHeaders(),
            });
            const payload = await readJsonResponse(response);
            if ([401, 403].includes(response.status)) {
                clearSession();
                window.location.href = '/';
                return;
            }
            if (!response.ok) throw new Error(formatApiError(payload.detail));

            saleHistoryRequests = saleHistoryRequests.filter((item) => String(item.id) !== requestId);
            saleHistoryCount.textContent = String(saleHistoryRequests.length);
            saleHistoryList.innerHTML = saleHistoryRequests.length
                ? saleHistoryRequests.map(renderSaleHistoryRequest).join('')
                : `<div class="car-bookings-empty">
                    <span aria-hidden="true">◷</span>
                    <h2>Aucune vente clôturée dans l’historique</h2>
                    <p>Les demandes d’achat réalisées ou annulées apparaîtront ici.</p>
                    <a href="/voitures/demandes-achat">Voir les demandes d’achat</a>
                </div>`;
            pendingAction = null;
            confirmDialog.close();
            saleHistoryFeedback.textContent = payload.message || 'Demande d’achat supprimée.';
            saleHistoryFeedback.className = 'car-bookings-feedback is-success';
            saleHistoryFeedback.hidden = false;
        } catch (error) {
            confirmError.textContent = getErrorMessage(error);
            confirmError.hidden = false;
            confirmSubmit.disabled = false;
            confirmCancel.disabled = false;
            confirmSubmit.textContent = 'Supprimer';
            if (deleteButton?.isConnected) {
                deleteButton.disabled = false;
                deleteButton.textContent = 'Supprimer';
            }
        } finally {
            busySaleRequestIds.delete(requestId);
            isSubmittingAction = false;
        }
    }

    async function performBookingAction(action, booking, requiresConfirmation) {
        const bookingId = String(booking.id);
        if (busyBookingIds.has(bookingId)) return;
        busyBookingIds.add(bookingId);
        const card = Array.from(list.querySelectorAll('[data-booking-card]'))
            .find((element) => element.dataset.id === bookingId);
        const actionButtons = card ? Array.from(card.querySelectorAll('[data-booking-action]')) : [];
        const clickedButton = actionButtons.find((button) => button.dataset.bookingAction === action);
        const clickedButtonLabel = clickedButton?.textContent;
        actionButtons.forEach((button) => { button.disabled = true; });
        if (clickedButton && !requiresConfirmation) {
            clickedButton.textContent = action === 'delete' ? 'Suppression…' : 'Mise à jour…';
        }
        if (requiresConfirmation) {
            confirmSubmit.textContent = action === 'delete' ? 'Suppression…' : 'Mise à jour…';
        }
        showFeedback('', 'success');
        try {
            const isDelete = action === 'delete';
            const endpoint = isDelete
                ? `/api/voitures/reservations/${encodeURIComponent(bookingId)}`
                : `/api/voitures/reservations/${encodeURIComponent(bookingId)}/${encodeURIComponent(action)}`;
            const response = await fetch(endpoint, {
                method: isDelete ? 'DELETE' : 'PATCH',
                headers: authHeaders(),
            });
            const payload = await readJsonResponse(response);
            if (!response.ok) throw new Error(formatApiError(payload.detail));

            if (isDelete) {
                removeBooking(bookingId);
            } else {
                if (typeof payload.status !== 'string' || !payload.status.trim()) {
                    throw new Error('Le serveur n’a pas renvoyé le nouveau statut de la réservation.');
                }
                booking.status = payload.status;
                if (!isBookingInCurrentList(booking)) removeBooking(bookingId);
                else renderBookings();
            }

            const successMessage = payload.message || (isDelete
                ? 'Réservation supprimée.'
                : `Statut mis à jour : ${booking.status}.`);
            pendingAction = null;
            if (requiresConfirmation) confirmDialog.close();
            showFeedback(successMessage, 'success');
        } catch (error) {
            if (requiresConfirmation) {
                confirmError.textContent = getErrorMessage(error);
                confirmError.hidden = false;
            } else {
                showFeedback(getErrorMessage(error), 'error');
            }
        } finally {
            busyBookingIds.delete(bookingId);
            if (card?.isConnected) {
                actionButtons.forEach((button) => { button.disabled = false; });
                if (clickedButton && clickedButtonLabel) clickedButton.textContent = clickedButtonLabel;
            }
        }
    }

    function renderBookings() {
        count.textContent = String(bookings.length);
        if (!bookings.length) {
            list.innerHTML = `<div class="car-bookings-empty">
                <span aria-hidden="true">▤</span>
                <h2>${isHistory ? 'Aucune réservation dans l’historique' : 'Aucune réservation à gérer'}</h2>
                <p>${isHistory
                    ? 'Les locations terminées ou annulées apparaîtront ici.'
                    : 'Aucune réservation automobile ne nécessite actuellement votre intervention.'}</p>
                ${isHistory ? '<a href="/voitures/reservations">Retour aux réservations à gérer</a>' : ''}
            </div>`;
            return;
        }
        list.innerHTML = bookings.map(renderBooking).join('');
    }

    function renderLoadError(message) {
        count.textContent = '—';
        list.innerHTML = `<div class="car-bookings-error" role="alert">
            <span aria-hidden="true">!</span>
            <h2>Impossible de charger les réservations</h2>
            <p>${escapeHtml(message)}</p>
            <button type="button" data-retry-bookings>Réessayer</button>
        </div>`;
    }

    function renderBooking(booking) {
        const status = clean(booking.status || booking.statut) || 'Statut non renseigné';
        const statusClass = statusClassName(status);
        const vehicleName = clean(booking.itemName) || 'Voiture non renseignée';
        const imageUrl = safeImageUrl(booking.vehicleImageUrl || booking.photo_bien);
        const clientName = clean(booking.clientName) || 'Nom du client non renseigné';
        const clientPhone = clean(booking.clientWhatsApp);
        const whatsappNumber = normalizeClientWhatsapp(booking);
        const date = clean(booking.date) || 'Date non renseignée';
        const amount = clean(booking.costInfo) || 'Montant non renseigné';
        const details = clean(booking.details);
        const duration = formatDuration(extractDetail(
            details,
            /dur(?:ée|ee)\s+(?:de\s+)?(\d+(?:[.,]\d+)?\s*(?:jour(?:\(s\)|s)?|day(?:\(s\)|s)?))/i,
        ));
        const pickup = extractDetail(details, /point\s+de\s+(?:retrait|prise\s+en\s+charge)\s*:\s*([^.;\n]+)/i);
        const dailyRate = formatDailyRate(booking);
        const whatsappUrl = whatsappNumber ? buildWhatsappUrl(booking, whatsappNumber, vehicleName, clientName, date, duration, pickup) : '';
        const actions = renderActions(booking, status);
        const imageMarkup = imageUrl
            ? `<img class="car-booking-photo-image" src="${escapeHtml(imageUrl)}" alt="Photo du véhicule ${escapeHtml(vehicleName)}" loading="lazy">
                <div class="car-booking-photo-placeholder" hidden><span aria-hidden="true">🚗</span><small>Photo indisponible</small></div>`
            : '<div class="car-booking-photo-placeholder"><span aria-hidden="true">🚗</span><small>Photo indisponible</small></div>';
        const whatsappMarkup = whatsappUrl
            ? `<a class="car-booking-whatsapp" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener noreferrer">
                <span aria-hidden="true">◉</span> Contacter sur WhatsApp
            </a>
            <small class="car-booking-whatsapp-note">WhatsApp s’ouvrira avec un message prérempli. Aucun message ne sera envoyé automatiquement.</small>`
            : `<p class="car-booking-whatsapp-unavailable" role="status">${clientPhone
                ? 'Numéro à vérifier'
                : 'Numéro WhatsApp indisponible'}</p>`;

        return `<article class="car-booking-card" data-booking-card data-id="${escapeHtml(booking.id)}">
            <header class="car-booking-card-header">
                <div class="car-booking-photo${imageUrl ? '' : ' is-empty'}">
                    ${imageMarkup}
                    <span class="car-booking-status-badge ${statusClass}">${escapeHtml(status)}</span>
                </div>
                <div class="car-booking-vehicle">
                    <p class="car-bookings-kicker">${escapeHtml(booking.serviceType || 'Automobile')}</p>
                    <h2 title="${escapeHtml(vehicleName)}">${escapeHtml(vehicleName)}</h2>
                    <p class="car-booking-reference">Réservation <span>${escapeHtml(booking.id || '—')}</span></p>
                </div>
            </header>

            <div class="car-booking-sections">
                <section class="car-booking-section car-booking-client">
                    <h3><span aria-hidden="true">♙</span> Client</h3>
                    <strong class="car-booking-client-name">${escapeHtml(clientName)}</strong>
                    ${clientPhone
                        ? `<a class="car-booking-client-phone" href="tel:${escapeHtml(clientPhone.replace(/[^\d+]/g, ''))}">${escapeHtml(clientPhone)}</a>`
                        : '<span class="car-booking-client-phone is-missing">Téléphone non renseigné</span>'}
                    ${whatsappMarkup}
                </section>

                <section class="car-booking-section car-booking-rental">
                    <h3><span aria-hidden="true">▦</span> Location</h3>
                    <div class="car-booking-detail-grid">
                        <div><small>Date</small><strong>${escapeHtml(date)}</strong></div>
                        <div><small>Montant</small><strong>${escapeHtml(amount)}</strong></div>
                        ${dailyRate ? `<div><small>Tarif journalier</small><strong>${escapeHtml(dailyRate)}</strong></div>` : ''}
                        <div><small>Durée</small><strong>${escapeHtml(duration || 'Non renseignée')}</strong></div>
                        <div><small>Point de retrait</small><strong>${escapeHtml(pickup || 'Non renseigné')}</strong></div>
                    </div>
                    ${details ? `<details class="car-booking-more-details">
                        <summary>Détails enregistrés</summary>
                        <p>${escapeHtml(details)}</p>
                    </details>` : ''}
                </section>
            </div>

            ${actions ? `<footer class="car-booking-actions">${actions}</footer>` : ''}
        </article>`;
    }

    function renderActions(booking, status) {
        const id = escapeHtml(booking.id || '');
        const buttons = {
            'En attente': actionButton(id, 'confirmer', 'Confirmer', 'is-primary'),
            'Confirmé': `${actionButton(id, 'démarrer', 'Démarrer la location', 'is-primary')}${actionButton(id, 'annuler', 'Annuler', 'is-destructive')}`,
            'En cours': `${actionButton(id, 'terminer', 'Terminer la location', 'is-primary')}${actionButton(id, 'annuler', 'Annuler', 'is-destructive')}`,
        };
        const workflow = !isHistory ? (buttons[status] || '') : '';
        const deleteAction = id
            ? actionButton(id, 'delete', 'Supprimer', 'is-delete')
            : '';
        if (!workflow && !deleteAction) return '';
        return `${workflow}${deleteAction}`;
    }

    function actionButton(id, action, label, className) {
        return `<button type="button" class="car-booking-action ${className}" data-booking-action="${action}" data-id="${id}">${label}</button>`;
    }

    function isBookingInCurrentList(booking) {
        const status = clean(booking.status);
        return isHistory
            ? status === 'Terminé' || status === 'Annulé'
            : status === 'En attente' || status === 'Confirmé' || status === 'En cours';
    }

    function removeBooking(bookingId) {
        bookings = bookings.filter((booking) => String(booking.id) !== bookingId);
        renderBookings();
    }

    function normalizeClientWhatsapp(booking) {
        const rawNumber = clean(booking.clientWhatsApp);
        if (!rawNumber) return '';
        const country = [
            booking.clientCountryCode,
            booking.clientCountry,
            booking.clientPays,
            booking.pays_client,
            booking.clientPhoneCountry,
        ].map(clean).find(Boolean) || '';

        if (typeof window.normalizeWhatsappNumber === 'function') {
            return window.normalizeWhatsappNumber(rawNumber, country);
        }

        const compact = rawNumber.replace(/[\s().-]/g, '');
        if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact.slice(1);
        if (/^00[1-9]\d{7,14}$/.test(compact)) return compact.slice(2);
        return '';
    }

    function buildWhatsappUrl(booking, phone, vehicleName, clientName, date, duration, pickup) {
        const greeting = clientName === 'Nom du client non renseigné' ? 'Bonjour,' : `Bonjour ${clientName},`;
        const lines = [
            greeting,
            '',
            `Je vous contacte au sujet de votre réservation du véhicule ${vehicleName}${date !== 'Date non renseignée' ? ` pour le ${date}` : ''}.`,
        ];
        const rentalDetails = [];
        if (duration) rentalDetails.push(`durée de ${duration}`);
        if (pickup) rentalDetails.push(`retrait prévu à ${pickup}`);
        if (rentalDetails.length) lines.push(`Votre réservation concerne une location avec ${rentalDetails.join(' et ')}.`);
        lines.push('', 'Nous restons à votre disposition pour le suivi de votre location.', 'Cordialement,', 'L’équipe Goying Auto.');
        return `https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}`;
    }

    function formatDailyRate(booking) {
        if (booking.pricePerDay === null || booking.pricePerDay === undefined || booking.pricePerDay === '') return '';
        return `${booking.pricePerDay}${booking.currency ? ` ${booking.currency}` : ''} / jour`;
    }

    function extractDetail(text, expression) {
        const match = text.match(expression);
        return match ? match[1].trim() : '';
    }

    function formatDuration(value) {
        const frenchDays = value.match(/^(\d+(?:[.,]\d+)?)\s*jour(?:\(s\)|s)?$/i);
        if (frenchDays) {
            const amount = Number(frenchDays[1].replace(',', '.'));
            return `${frenchDays[1]} ${amount === 1 ? 'jour' : 'jours'}`;
        }
        const englishDays = value.match(/^(\d+(?:[.,]\d+)?)\s*day(?:\(s\)|s)?$/i);
        if (englishDays) {
            const amount = Number(englishDays[1].replace(',', '.'));
            return `${englishDays[1]} ${amount === 1 ? 'jour' : 'jours'}`;
        }
        return value;
    }

    function safeImageUrl(value) {
        if (typeof value !== 'string' || !value.trim()) return '';
        try {
            const url = new URL(value.trim(), window.location.href);
            return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
        } catch {
            return '';
        }
    }

    function statusClassName(status) {
        const normalized = status.toLocaleLowerCase('fr');
        if (normalized === 'en attente') return 'is-pending';
        if (normalized === 'confirmé') return 'is-confirmed';
        if (normalized === 'en cours') return 'is-progress';
        if (normalized === 'terminé') return 'is-completed';
        if (normalized === 'annulé') return 'is-cancelled';
        if (normalized === 'vente réalisée') return 'is-completed';
        if (normalized === 'vente annulée') return 'is-cancelled';
        return 'is-unknown';
    }

    function handleImageError(event) {
        const image = event.target;
        if (!(image instanceof HTMLImageElement) || !image.matches('.car-booking-photo-image')) return;
        image.hidden = true;
        image.closest('.car-booking-photo')?.classList.add('is-empty');
        const placeholder = image.parentElement.querySelector('.car-booking-photo-placeholder');
        if (placeholder) placeholder.hidden = false;
    }

    function showFeedback(message, type) {
        feedback.textContent = message;
        feedback.hidden = !message;
        feedback.className = `car-bookings-feedback${message ? ` is-${type}` : ''}`;
        feedback.setAttribute('role', type === 'error' ? 'alert' : 'status');
    }

    function clearPendingAction() {
        if (isSubmittingAction) return;
        pendingAction = null;
        confirmError.textContent = '';
        confirmError.hidden = true;
    }

    function authHeaders() {
        const currentToken = localStorage.getItem('goying_access_token');
        return currentToken ? { Authorization: `Bearer ${currentToken}` } : {};
    }

    async function readJsonResponse(response) {
        try {
            return await response.json();
        } catch {
            throw new Error('La réponse du serveur est illisible. Actualisez puis réessayez.');
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

    function clean(value) {
        return value === null || value === undefined ? '' : String(value).trim();
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
