document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-purchase-requests-page]');
    if (!page) return;

    const list = page.querySelector('[data-purchase-requests-list]');
    const count = page.querySelector('[data-purchase-requests-count]');
    const countLabel = page.querySelector('[data-purchase-requests-count-label]');
    const total = page.querySelector('[data-purchase-requests-total]');
    const newCount = page.querySelector('[data-purchase-requests-new]');
    const search = page.querySelector('[data-purchase-requests-search]');
    const feedback = page.querySelector('[data-purchase-requests-feedback]');
    const refreshButton = page.querySelector('[data-purchase-requests-refresh]');
    const refreshLabel = page.querySelector('[data-purchase-requests-refresh-label]');
    const logoutButton = page.querySelector('[data-purchase-requests-logout]');
    const detailsDialog = document.querySelector('[data-purchase-request-dialog]');
    const detailsTitle = detailsDialog?.querySelector('[data-purchase-request-dialog-title]');
    const detailsBody = detailsDialog?.querySelector('[data-purchase-request-dialog-body]');
    const detailsClose = detailsDialog?.querySelector('[data-purchase-request-dialog-close]');
    const actionDialog = document.querySelector('[data-purchase-request-action-dialog]');
    const actionTitle = actionDialog?.querySelector('[data-purchase-request-action-title]');
    const actionMessage = actionDialog?.querySelector('[data-purchase-request-action-message]');
    const actionButtons = actionDialog?.querySelector('[data-purchase-request-action-buttons]');
    const actionClose = actionDialog?.querySelector('[data-purchase-request-action-close]');
    const token = localStorage.getItem('goying_access_token');
    const statusTransitions = {
        'Nouvelle': ['Vendeur contacté', 'Acheteur contacté', 'Véhicule disponible', 'Vente annulée'],
        'Vendeur contacté': ['Acheteur contacté', 'Véhicule disponible', 'Vente annulée'],
        'Acheteur contacté': ['Vendeur contacté', 'Véhicule disponible', 'Vente annulée'],
        'Véhicule disponible': ['Mise en relation effectuée', 'Vente annulée'],
        'Mise en relation effectuée': ['Vente réalisée', 'Vente annulée'],
        'Vente réalisée': [],
        'Vente annulée': [],
    };

    if (!list || !count || !countLabel || !total || !newCount || !search || !feedback
        || !refreshButton || !refreshLabel || !logoutButton || !token
        || !detailsDialog || !detailsTitle || !detailsBody
        || !detailsClose || !actionDialog || !actionTitle || !actionMessage
        || !actionButtons || !actionClose
        || localStorage.getItem('goying_role') !== 'voitures') {
        clearSession();
        window.location.href = '/';
        return;
    }

    let requests = [];
    let isLoading = false;
    let hasLoaded = false;
    let activeActionRequest = null;
    const updatingRequestIds = new Set();

    logoutButton.addEventListener('click', () => {
        clearSession();
        window.location.href = '/';
    });
    refreshButton.addEventListener('click', loadRequests);
    search.addEventListener('input', renderRequests);
    list.addEventListener('click', handleRequestClick);
    list.addEventListener('error', handleImageError, true);
    actionButtons.addEventListener('click', handleActionConfirmation);
    actionClose.addEventListener('click', () => actionDialog.close());
    detailsClose.addEventListener('click', () => detailsDialog.close());
    detailsDialog.addEventListener('click', (event) => {
        if (event.target === detailsDialog) detailsDialog.close();
    });
    actionDialog.addEventListener('click', (event) => {
        if (event.target === actionDialog) actionDialog.close();
    });

    loadRequests();

    async function loadRequests() {
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
                throw new Error(payload.detail || 'Impossible de charger les demandes d’achat.');
            }
            if (!Array.isArray(payload.requests)) {
                throw new Error('La réponse du serveur ne contient pas la liste des demandes d’achat.');
            }

            requests = payload.requests;
            hasLoaded = true;
            updateStatistics();
            renderRequests();
            feedback.textContent = '';
            feedback.className = 'vehicle-sales-feedback';
        } catch (error) {
            const message = error instanceof TypeError
                ? 'Erreur réseau. Vérifiez votre connexion puis réessayez.'
                : error instanceof Error
                    ? error.message
                    : 'Impossible de charger les demandes d’achat.';
            if (!hasLoaded) {
                list.innerHTML = `<div class="vehicle-sales-state is-error" role="alert">
                    <span aria-hidden="true">!</span>
                    <strong>Les demandes n’ont pas pu être chargées.</strong>
                    <p>${escapeHtml(message)}</p>
                    <button type="button" data-purchase-requests-retry>Réessayer</button>
                </div>`;
                list.querySelector('[data-purchase-requests-retry]')
                    ?.addEventListener('click', loadRequests);
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
        total.textContent = String(requests.length);
        newCount.textContent = String(requests.filter((item) => clean(item.status).toLocaleLowerCase('fr') === 'nouvelle').length);
        count.textContent = String(filteredRequests().length);
    }

    function filteredRequests() {
        const query = clean(search.value).toLocaleLowerCase('fr');
        if (!query) return requests;
        return requests.filter((item) => [
            item.brand,
            item.model,
            item.vehicleType,
            item.condition,
            item.fuel,
            item.transmission,
            item.city,
            item.commune,
            item.buyerCommune,
            item.buyerName,
            item.buyerUid,
            item.buyerWhatsApp,
            item.description,
            item.status,
            item.vehicleId,
            item.id,
            item.seller?.brand,
            item.seller?.model,
            item.seller?.sellerWhatsApp,
        ].some((value) => clean(value).toLocaleLowerCase('fr').includes(query)));
    }

    function renderRequests() {
        if (!hasLoaded) return;
        const filtered = filteredRequests();
        count.textContent = String(filtered.length);
        countLabel.textContent = filtered.length === 1 ? 'demande' : 'demandes';

        if (!requests.length) {
            list.innerHTML = `<div class="vehicle-sales-state">
                <span aria-hidden="true">⌕</span>
                <strong>Aucune demande d'achat</strong>
                <p>Aucune demande d'achat de véhicule n'a encore été enregistrée.</p>
            </div>`;
            return;
        }
        if (!filtered.length) {
            list.innerHTML = `<div class="vehicle-sales-state">
                <span aria-hidden="true">⌕</span>
                <strong>Aucun résultat</strong>
                <p>Aucune demande ne correspond à « ${escapeHtml(search.value)} ».</p>
            </div>`;
            return;
        }

        list.innerHTML = filtered.map(renderRequest).join('');
    }

    function renderRequest(item) {
        const title = [item.brand, item.model].map(clean).filter(Boolean).join(' ') || 'Voiture recherchée';
        const status = formatStatus(item.status);
        const whatsapp = clean(item.buyerWhatsApp);
        const image = safeImage(item.mainImageUrl);
        const imageGallery = image
            ? `<div class="vehicle-sale-gallery purchase-request-gallery"><img src="${escapeHtml(image)}" alt="Photo du véhicule ${escapeHtml(title)}" loading="lazy"><span class="vehicle-sale-status ${statusClass(item.status)}">${escapeHtml(status)}</span></div>`
            : `<div class="vehicle-sale-gallery is-empty purchase-request-gallery">
                <span class="vehicle-sale-status ${statusClass(item.status)}">${escapeHtml(status)}</span>
                <svg aria-hidden="true" viewBox="0 0 96 64" focusable="false"><path d="M17 40h62l-5-17a8 8 0 0 0-8-6H32a8 8 0 0 0-8 6l-7 17Z"/><path d="M13 40h70v12H13z"/><circle cx="27" cy="52" r="7"/><circle cx="69" cy="52" r="7"/></svg>
                <span>Photo indisponible</span>
            </div>`;
        const year = clean(item.year) || 'Année inconnue';
        const vehicleType = clean(item.vehicleType) || 'Type non renseigné';
        const buyerName = clean(item.buyerName) || 'Acheteur non renseigné';
        const buyerCommune = clean(item.buyerCommune);
        const vehicleLocation = [item.commune, item.city].map(clean).filter(Boolean).join(', ');
        const features = [
            ['Kilométrage', item.mileage === 0 || item.mileage ? `${formatNumber(item.mileage)} km` : 'Non renseigné', '↗'],
            ['Transmission', item.transmission, '⚙'],
            ['Carburant', item.fuel, '◉'],
            ['État', item.condition, '✓'],
        ];

        return `<article class="vehicle-sale-card">
            ${imageGallery}
            <div class="vehicle-sale-content purchase-request-content">
                <header class="vehicle-sale-heading purchase-request-heading">
                    <h2 title="${escapeHtml(title)}">${escapeHtml(title)}</h2>
                    <p><span>${escapeHtml(year)}</span><span aria-hidden="true">•</span><span>${escapeHtml(vehicleType)}</span></p>
                </header>
                <p class="purchase-request-price"><strong>${escapeHtml(formatPrice(item.priceUsd))} <small>USD</small></strong>${item.priceNegotiable ? '<span>Négociable</span>' : ''}</p>
                <dl class="purchase-request-features">
                    ${features.map(([label, value, icon]) => `<div><dt><span aria-hidden="true">${icon}</span>${label}</dt><dd title="${escapeHtml(clean(value) || 'Non renseigné')}">${escapeHtml(clean(value) || 'Non renseigné')}</dd></div>`).join('')}
                </dl>
                <div class="purchase-request-location">
                    <span aria-hidden="true">⌖</span>
                    <div><small>Localisation du véhicule</small><strong title="${escapeHtml(vehicleLocation || 'Non renseignée')}">${escapeHtml(vehicleLocation || 'Non renseignée')}</strong></div>
                </div>
                <div class="purchase-request-buyer">
                    <span aria-hidden="true">♙</span>
                    <div><small>Acheteur</small><strong title="${escapeHtml(buyerName)}">${escapeHtml(buyerName)}</strong></div>
                    ${whatsapp ? `<span class="purchase-request-buyer-phone">☎ ${escapeHtml(whatsapp)}</span>` : ''}
                </div>
                ${buyerCommune ? `<div class="purchase-request-buyer-location"><small>Commune de l’acheteur</small><strong title="${escapeHtml(buyerCommune)}">${escapeHtml(buyerCommune)}</strong></div>` : ''}
                ${clean(item.description) ? `<p class="purchase-request-description-preview">${escapeHtml(clean(item.description))}</p>` : ''}
                ${renderRequestActions(item, requests.indexOf(item))}
            </div>
        </article>`;
    }

    function renderRequestActions(item, index) {
        const status = clean(item.status) || 'Nouvelle';
        const terminal = ['Vente réalisée', 'Vente annulée'].includes(status);
        const contacts = buildWhatsAppDetails(item);
        let primaryAction = '';
        if (['Nouvelle', 'Vendeur contacté', 'Acheteur contacté'].includes(status)) {
            primaryAction = `<button type="button" class="is-primary" data-open-request-action="availability" data-request-index="${index}">Vérifier la disponibilité</button>`;
        } else if (status === 'Véhicule disponible') {
            primaryAction = `<button type="button" class="is-primary is-connect" data-open-request-action="connect" data-request-index="${index}">🤝 Mettre en relation</button>`;
        } else if (status === 'Mise en relation effectuée') {
            primaryAction = `<button type="button" class="is-primary" data-open-request-action="sale" data-request-index="${index}">Vente réalisée</button>`;
        }
        const buyerContact = contacts.buyerDigits
            ? `<a href="${whatsappUrl(contacts.buyerDigits, contacts.buyerMessage)}" target="_blank" rel="noopener noreferrer" data-whatsapp-contact="buyer">Contacter l’acheteur</a>`
            : '<span class="is-unavailable">Acheteur sans WhatsApp valide</span>';
        const sellerContact = contacts.sellerDigits
            ? `<a href="${whatsappUrl(contacts.sellerDigits, contacts.sellerMessage)}" target="_blank" rel="noopener noreferrer" data-whatsapp-contact="seller">Contacter le vendeur</a>`
            : '<span class="is-unavailable">Vendeur sans WhatsApp valide</span>';
        const connectionPending = status === 'Acheteur contacté'
            ? '<button type="button" disabled title="Confirmez d’abord que le véhicule est disponible.">🤝 Mettre en relation</button>'
            : '';
        const moreActions = [
            ...(!terminal ? [`<button type="button" data-open-request-action="status" data-request-index="${index}">Modifier le statut</button>`] : []),
            ...(!terminal ? [`<button type="button" data-open-request-action="cancel" data-request-index="${index}">Annuler la demande</button>`] : []),
            `<button type="button" class="is-danger" data-open-request-action="delete" data-request-index="${index}">Supprimer la demande</button>`,
        ].join('');

        return `<section class="purchase-request-card-actions" aria-label="Actions administrateur">
            <h3>Actions administrateur</h3>
            <div class="purchase-request-action-primary">
                <button type="button" data-view-purchase-request="${index}">Voir la demande <span aria-hidden="true">→</span></button>
                ${primaryAction}
            </div>
            <div class="purchase-request-action-contacts">
                ${terminal ? '' : `${buyerContact}${sellerContact}${connectionPending}`}
            </div>
            ${moreActions ? `<details class="purchase-request-more">
                <summary aria-label="Plus d'actions">⋮ <span>Plus</span></summary>
                <div class="purchase-request-more-menu">${moreActions}</div>
            </details>` : ''}
        </section>`;
    }

    function handleRequestClick(event) {
        const target = event.target.closest('button, a');
        if (!target) return;
        if (target.matches('[data-view-purchase-request]')) {
            const request = requests[Number(target.dataset.viewPurchaseRequest)];
            if (request) showRequestDetails(request);
            return;
        }
        if (target.matches('[data-open-request-action]')) {
            const request = requests[Number(target.dataset.requestIndex)];
            if (request) openRequestAction(request, target.dataset.openRequestAction);
            return;
        }
        if (target.matches('[data-whatsapp-contact]')) {
            const who = target.dataset.whatsappContact === 'seller' ? 'vendeur' : 'acheteur';
            setFeedback(`WhatsApp ${who} ouvert. Le statut ne change qu’après confirmation de l’action.`);
        }
    }

    function openRequestAction(item, action) {
        activeActionRequest = item;
        actionButtons.replaceChildren();
        let title = '';
        let message = '';
        let buttons = [];

        if (action === 'availability') {
            title = 'Vérifier la disponibilité';
            message = '<p>Le vendeur a-t-il confirmé que le véhicule est toujours disponible ?</p>';
            buttons = [
                ['Annuler', '', 'is-secondary'],
                ['Non, indisponible', 'Vente annulée', 'is-danger'],
                ['Oui, disponible', 'Véhicule disponible', 'is-primary'],
            ];
        } else if (action === 'connect') {
            const details = buildWhatsAppDetails(item);
            if (clean(item.status) !== 'Véhicule disponible'
                || !details.buyerDigits || !details.sellerDigits) {
                setFeedback('La mise en relation nécessite un véhicule confirmé disponible et deux numéros WhatsApp valides.', true);
                return;
            }
            title = 'Confirmer la mise en relation';
            message = `<p>Voulez-vous mettre cet acheteur en relation avec le vendeur ?</p>
                <dl class="purchase-request-confirmation">
                    <div><dt>Véhicule</dt><dd>${escapeHtml(details.sellerTitle)}</dd></div>
                    <div><dt>Acheteur</dt><dd>${escapeHtml(clean(item.buyerName) || 'Acheteur')}</dd></div>
                    <div><dt>WhatsApp acheteur</dt><dd>${escapeHtml(details.buyerPhone)}</dd></div>
                    <div><dt>Localisation véhicule</dt><dd>${escapeHtml(details.sellerLocation || details.requestLocation || 'Non renseignée')}</dd></div>
                    <div><dt>Prix</dt><dd>${escapeHtml(formatPrice(item.priceUsd))} USD</dd></div>
                </dl>`;
            buttons = [
                ['Annuler', '', 'is-secondary'],
                ['Confirmer la mise en relation', 'Mise en relation effectuée', 'is-primary'],
            ];
        } else if (action === 'sale') {
            title = 'Confirmer la vente';
            message = '<p>Confirmer que la vente de ce véhicule a été réalisée ?</p>';
            buttons = [
                ['Annuler', '', 'is-secondary'],
                ['Confirmer la vente', 'Vente réalisée', 'is-primary'],
            ];
        } else if (action === 'cancel') {
            title = 'Annuler la demande';
            message = '<p>Voulez-vous vraiment annuler cette demande d’achat ?</p>';
            buttons = [
                ['Annuler', '', 'is-secondary'],
                ['Confirmer l’annulation', 'Vente annulée', 'is-danger'],
            ];
        } else if (action === 'delete') {
            const vehicleTitle = [item.brand, item.model].map(clean).filter(Boolean).join(' ') || 'ce véhicule';
            title = 'Supprimer la demande d’achat';
            message = `<p>Voulez-vous vraiment supprimer la demande concernant « ${escapeHtml(vehicleTitle)} » de ${escapeHtml(clean(item.buyerName) || 'cet acheteur')} ? Cette action est définitive.</p>`;
            buttons = [
                ['Annuler', '', 'is-secondary'],
                ['Confirmer la suppression', '__delete__', 'is-danger'],
            ];
        } else if (action === 'status') {
            title = 'Mettre à jour le statut';
            const availableStatuses = (statusTransitions[clean(item.status) || 'Nouvelle'] || [])
                .filter((status) => status !== 'Vente annulée');
            if (!availableStatuses.length) {
                setFeedback('Aucune mise à jour de statut n’est autorisée pour cette demande.', true);
                return;
            }
            message = '<p>Sélectionnez le nouveau statut de cette demande.</p>';
            buttons = [
                ['Annuler', '', 'is-secondary'],
                ...availableStatuses.map((status) => [status, status, status === 'Vente annulée' ? 'is-danger' : '']),
            ];
        } else {
            return;
        }

        actionTitle.textContent = title;
        actionMessage.innerHTML = message;
        actionButtons.innerHTML = buttons.map(([label, status, style]) => status
            ? `<button type="button" class="${style}" data-save-request-status="${escapeHtml(status)}">${escapeHtml(label)}</button>`
            : `<button type="button" class="${style}" data-close-request-action>${escapeHtml(label)}</button>`
        ).join('');
        actionDialog.showModal();
    }

    async function handleActionConfirmation(event) {
        const button = event.target.closest('button');
        if (!button) return;
        if (button.hasAttribute('data-close-request-action')) {
            actionDialog.close();
            return;
        }
        const nextStatus = button.dataset.saveRequestStatus;
        if (!nextStatus || !activeActionRequest) return;
        if (nextStatus === '__delete__') {
            await deletePurchaseRequest(activeActionRequest);
            return;
        }
        await updateRequestStatus(activeActionRequest, nextStatus);
    }

    async function deletePurchaseRequest(item) {
        const requestId = clean(item.id);
        if (!requestId || updatingRequestIds.has(requestId)) return;

        updatingRequestIds.add(requestId);
        const confirmationButtons = [...actionButtons.querySelectorAll('button')];
        const confirmButton = actionButtons.querySelector('[data-save-request-status="__delete__"]');
        confirmationButtons.forEach((button) => { button.disabled = true; });
        if (confirmButton) confirmButton.textContent = 'Suppression…';
        list.querySelectorAll(`[data-request-index="${requests.indexOf(item)}"]`).forEach((button) => {
            if ('disabled' in button) button.disabled = true;
        });

        try {
            const response = await fetch(`${page.dataset.endpoint}/${encodeURIComponent(requestId)}`, {
                method: 'DELETE',
                headers: { Authorization: ['Bearer', token].join(' ') },
            });
            const payload = await readJsonResponse(response);
            if (response.status === 401 || response.status === 403) {
                clearSession();
                window.location.href = '/';
                return;
            }
            if (!response.ok) {
                throw new Error(payload.detail || 'Impossible de supprimer la demande d’achat.');
            }

            requests = requests.filter((request) => clean(request.id) !== requestId);
            if (detailsDialog.open) detailsDialog.close();
            actionDialog.close();
            updateStatistics();
            renderRequests();
            setFeedback('Demande d’achat supprimée.');
        } catch (error) {
            const message = error instanceof TypeError
                ? 'Erreur réseau. Vérifiez votre connexion puis réessayez.'
                : error instanceof Error
                    ? error.message
                    : 'Impossible de supprimer la demande d’achat.';
            setFeedback(message, true);
            confirmationButtons.forEach((button) => { button.disabled = false; });
            if (confirmButton) confirmButton.textContent = 'Confirmer la suppression';
        } finally {
            updatingRequestIds.delete(requestId);
            list.querySelectorAll(`[data-request-index="${requests.indexOf(item)}"]`).forEach((button) => {
                if ('disabled' in button) button.disabled = false;
            });
        }
    }

    async function updateRequestStatus(item, status) {
        const requestId = clean(item.id);
        if (!requestId || updatingRequestIds.has(requestId)) return;

        updatingRequestIds.add(requestId);
        const confirmationButtons = [...actionButtons.querySelectorAll('button')];
        confirmationButtons.forEach((button) => { button.disabled = true; });
        const confirmButton = actionButtons.querySelector(`[data-save-request-status="${CSS.escape(status)}"]`);
        if (confirmButton) confirmButton.textContent = 'Mise à jour…';
        list.querySelectorAll(`[data-request-index="${requests.indexOf(item)}"]`).forEach((button) => {
            if ('disabled' in button) button.disabled = true;
        });

        try {
            const response = await fetch(`${page.dataset.endpoint}/${encodeURIComponent(requestId)}/statut`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ status }),
            });
            const payload = await readJsonResponse(response);
            if (response.status === 401 || response.status === 403) {
                clearSession();
                window.location.href = '/';
                return;
            }
            if (!response.ok) {
                throw new Error(payload.detail || 'Impossible de mettre à jour la demande.');
            }

            item.status = payload.status;
            updateStatistics();
            renderRequests();
            actionDialog.close();
            setFeedback('Demande mise à jour avec succès.');
            if (detailsDialog.open) {
                detailsDialog.close();
                showRequestDetails(item);
            }
        } catch (error) {
            const message = error instanceof TypeError
                ? 'Erreur réseau. Vérifiez votre connexion puis réessayez.'
                : error instanceof Error
                    ? error.message
                    : 'Impossible de mettre à jour la demande.';
            setFeedback(message, true);
            confirmationButtons.forEach((button) => { button.disabled = false; });
            if (confirmButton) {
                confirmButton.textContent = confirmButton.dataset.saveRequestStatus;
            }
        } finally {
            updatingRequestIds.delete(requestId);
            list.querySelectorAll(`[data-request-index="${requests.indexOf(item)}"]`).forEach((button) => {
                if ('disabled' in button) button.disabled = false;
            });
        }
    }

    function setFeedback(message, isError = false) {
        feedback.textContent = message;
        feedback.className = isError
            ? 'vehicle-sales-feedback is-error'
            : 'vehicle-sales-feedback is-success';
    }

    function buildWhatsAppDetails(item) {
        const seller = item.seller && typeof item.seller === 'object' ? item.seller : null;
        const buyerPhone = clean(item.buyerWhatsApp);
        const sellerPhone = clean(seller?.sellerWhatsApp);
        const buyerDigits = normalizeWhatsAppPhone(buyerPhone);
        const sellerDigits = normalizeWhatsAppPhone(sellerPhone);
        const title = [item.brand, item.model].map(clean).filter(Boolean).join(' ') || 'Voiture recherchée';
        const sellerTitle = [seller?.brand, seller?.model].map(clean).filter(Boolean).join(' ') || title;
        const requestLocation = [item.commune, item.city].map(clean).filter(Boolean).join(', ');
        const sellerLocation = [seller?.commune, seller?.city].map(clean).filter(Boolean).join(', ');
        const photo = safeImage(item.mainImageUrl)
            || safeImage(seller?.imageUrl)
            || safeImage(Array.isArray(seller?.imageUrls) ? seller.imageUrls[0] : '');
        const messagePhoto = photo ? `\n📸 Photo principale : ${photo}` : '';
        const buyerName = clean(item.buyerName) || 'Acheteur';
        const buyerMessage = [
            `Bonjour ${buyerName},`,
            '',
            'Nous avons bien reçu votre demande concernant le véhicule :',
            '',
            `🚗 ${title}`,
            clean(item.year) ? `📅 ${clean(item.year)}` : '',
            item.priceUsd === 0 || item.priceUsd ? `💰 ${formatPrice(item.priceUsd)} USD${item.priceNegotiable ? ' (négociable)' : ''}` : '',
            requestLocation ? `📍 ${requestLocation}` : '',
            '',
            'Nous vérifions la disponibilité du véhicule auprès du vendeur et reviendrons vers vous dès que nous aurons sa confirmation.',
            '',
            'Merci pour votre confiance.',
            'Goying',
            messagePhoto,
        ].filter((line) => line !== '').join('\n');
        const sellerMessage = [
            'Bonjour,',
            '',
            'Nous vous contactons au nom de Goying concernant votre véhicule :',
            '',
            `🚗 ${sellerTitle}`,
            `📅 ${clean(seller?.year) || clean(item.year) || 'Année non renseignée'}`,
            (seller?.priceUsd ?? item.priceUsd) === 0 || (seller?.priceUsd ?? item.priceUsd)
                ? `💰 ${formatPrice(seller?.priceUsd ?? item.priceUsd)} USD` : '',
            sellerLocation ? `📍 ${sellerLocation}` : requestLocation ? `📍 ${requestLocation}` : '',
            '',
            'Un acheteur intéressé a effectué une demande d’achat pour ce véhicule.',
            'Pouvez-vous nous confirmer qu’il est toujours disponible ? Nous mettrons l’acheteur en relation avec vous après votre confirmation.',
            messagePhoto,
            '',
            'Cordialement,',
            'Goying',
        ].filter((line) => line !== '').join('\n');
        const connectionMessage = [
            `Bonjour ${buyerName},`,
            '',
            'Bonne nouvelle ! Le véhicule que vous avez demandé est toujours disponible.',
            '',
            `🚗 Véhicule : ${sellerTitle}`,
            `📅 Année : ${clean(seller?.year) || clean(item.year) || 'Non renseignée'}`,
            (seller?.priceUsd ?? item.priceUsd) === 0 || (seller?.priceUsd ?? item.priceUsd)
                ? `💰 Prix : ${formatPrice(seller?.priceUsd ?? item.priceUsd)} USD` : '',
            sellerLocation ? `📍 Localisation : ${sellerLocation}` : requestLocation ? `📍 Localisation : ${requestLocation}` : '',
            '',
            'Voici le WhatsApp du vendeur pour convenir d’une visite et poursuivre la transaction :',
            sellerPhone ? `📱 ${sellerPhone}` : '',
            photo ? `📸 Photo principale : ${photo}` : '',
            '',
            'Merci d’être passé par Goying.',
        ].filter((line) => line !== '').join('\n');
        return {
            buyerDigits, sellerDigits, buyerPhone, sellerPhone, buyerMessage, sellerMessage,
            connectionMessage, photo, sellerTitle, sellerLocation, requestLocation,
        };
    }

    function showRequestDetails(item) {
        const seller = item.seller && typeof item.seller === 'object' ? item.seller : null;
        const details = buildWhatsAppDetails(item);
        const { buyerDigits, sellerDigits, buyerPhone, buyerMessage,
            sellerMessage, photo, sellerTitle, sellerLocation } = details;
        const title = [item.brand, item.model].map(clean).filter(Boolean).join(' ') || 'Voiture recherchée';
        const requestPrice = formatPrice(item.priceUsd);
        const imageMarkup = photo
            ? `<img class="purchase-request-detail-image" src="${escapeHtml(photo)}" alt="Photo du véhicule ${escapeHtml(title)}">`
            : '';
        const sellerStatus = seller ? clean(seller.status) || 'Statut indisponible' : '';
        const sellerMissing = !seller
            ? '<p class="purchase-request-seller-error" role="status"><strong>Informations du vendeur indisponibles.</strong><br>Les informations du vendeur associées à ce véhicule ne sont plus disponibles.</p>'
            : !sellerDigits
                ? '<p class="purchase-request-seller-error" role="status"><strong>Informations du vendeur indisponibles.</strong><br>Le véhicule est trouvé, mais son numéro WhatsApp est absent ou invalide.</p>'
                : '';
        detailsTitle.textContent = title;
        detailsBody.innerHTML = `${imageMarkup}
            <section class="purchase-request-detail-section">
                <h3>🚗 Véhicule demandé</h3>
                ${renderDetailRows([
                    ['Marque', item.brand], ['Modèle', item.model], ['Année', item.year],
                    ['Type', item.vehicleType], ['Kilométrage', item.mileage === 0 || item.mileage ? `${formatNumber(item.mileage)} km` : ''],
                    ['Transmission', item.transmission], ['Carburant', item.fuel], ['État', item.condition],
                    ['Prix demandé', item.priceUsd === 0 || item.priceUsd ? `${requestPrice} USD` : ''],
                    ['Négociable', item.priceNegotiable ? 'Oui' : 'Non'],
                ])}
            </section>
            <section class="purchase-request-detail-section">
                <h3>📍 Localisation du véhicule</h3>
                ${renderDetailRows([['Ville', item.city], ['Commune', item.commune]])}
            </section>
            <section class="purchase-request-detail-section">
                <h3>👤 Acheteur</h3>
                ${renderDetailRows([
                    ['Nom', item.buyerName], ['WhatsApp', buyerPhone],
                    ['Commune', item.buyerCommune], ['UID acheteur', item.buyerUid],
                ])}
            </section>
            <section class="purchase-request-detail-section">
                <h3>📄 Demande</h3>
                ${renderDetailRows([
                    ['Statut', formatStatus(item.status)], ['Date', formatDate(item.createdAt)],
                    ['Référence demande', item.id], ['Référence véhicule', item.vehicleId],
                    ['Description', item.description],
                ])}
            </section>
            <section class="purchase-request-detail-section">
                <h3>🏷️ Vendeur associé</h3>
                ${seller ? renderDetailRows([
                    ['Véhicule', sellerTitle], ['Année', seller.year],
                    ['Prix vendeur', seller.priceUsd === 0 || seller.priceUsd ? `${formatPrice(seller.priceUsd)} USD` : ''],
                    ['Localisation', sellerLocation], ['Statut du véhicule', sellerStatus],
                ]) : ''}
                ${sellerMissing}
            </section>
            <footer class="purchase-request-detail-actions">
                ${buyerDigits ? `<a href="${whatsappUrl(buyerDigits, buyerMessage)}" target="_blank" rel="noopener noreferrer" data-whatsapp-contact="buyer"><span aria-hidden="true">◉</span> Contacter l’acheteur</a>` : '<span class="vehicle-sale-contact is-unavailable">WhatsApp acheteur non renseigné</span>'}
                ${sellerDigits ? `<a class="is-whatsapp" href="${whatsappUrl(sellerDigits, sellerMessage)}" target="_blank" rel="noopener noreferrer" data-whatsapp-contact="seller"><span aria-hidden="true">◉</span> Contacter le vendeur</a>` : ''}
                ${buyerDigits && sellerDigits && clean(item.status) === 'Véhicule disponible' ? `<button type="button" class="is-connect" data-open-request-action="connect" data-request-index="${requests.indexOf(item)}">🤝 Mettre en relation</button>` : ''}
                <button type="button" class="is-danger" data-open-request-action="delete" data-request-index="${requests.indexOf(item)}">Supprimer la demande</button>
                ${photo ? `<a href="${escapeHtml(photo)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">▧</span> Voir la photo</a>` : ''}
            </footer>`;

        detailsBody.querySelectorAll('[data-open-request-action]').forEach((button) => {
            button.addEventListener('click', () => {
                openRequestAction(item, button.dataset.openRequestAction);
            });
        });
        detailsBody.querySelectorAll('[data-whatsapp-contact]').forEach((link) => {
            link.addEventListener('click', () => {
                const who = link.dataset.whatsappContact === 'seller' ? 'vendeur' : 'acheteur';
                setFeedback(`WhatsApp ${who} ouvert. Le statut ne change qu’après confirmation de l’action.`);
            });
        });

        detailsDialog.showModal();
    }

    function renderDetailRows(fields) {
        return `<dl class="purchase-request-detail-grid">${fields.map(([label, value]) => `
            <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(clean(value) || 'Non renseigné')}</dd></div>
        `).join('')}</dl>`;
    }

    function whatsappUrl(phoneDigits, message) {
        return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;
    }

    function normalizeWhatsAppPhone(value) {
        const phone = clean(value).replace(/[\s().-]/g, '');
        const digits = phone.startsWith('+')
            ? phone.slice(1)
            : phone.startsWith('00')
                ? phone.slice(2)
                : phone;
        return /^[1-9]\d{7,14}$/.test(digits) ? digits : '';
    }

    function statusClass(value) {
        const status = clean(value).toLocaleLowerCase('fr').replaceAll('_', ' ');
        if (['nouvelle', 'nouveau', 'new'].includes(status)) return 'is-pending';
        if (['vendeur contacté', 'vendeur contacte', 'acheteur contacté', 'acheteur contacte', 'véhicule disponible', 'vehicule disponible'].includes(status)) return 'is-contacted';
        if (['mise en relation effectuée', 'mise en relation effectuee', 'vente réalisée', 'vente realisee'].includes(status)) return 'is-completed';
        if (['vente annulée', 'vente annulee', 'annulée', 'annulee', 'annulé', 'annule'].includes(status)) return 'is-cancelled';
        return 'is-other';
    }

    function formatStatus(value) {
        const status = clean(value);
        if (status.toLocaleLowerCase('fr') === 'nouvelle') return 'Nouvelle';
        return status || 'Statut inconnu';
    }

    function safeImage(value) {
        if (typeof value !== 'string') return '';
        try {
            return new URL(value).protocol === 'https:' ? value : '';
        } catch {
            return '';
        }
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
