document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-appointments-page]');
    const list = document.querySelector('#appointments-list');
    const count = document.querySelector('#appointments-count');
    const refreshButton = document.querySelector('#refresh-appointments');
    const refreshLabel = document.querySelector('[data-appointments-refresh-label]');
    const logoutButton = document.querySelector('#logout-button');
    const searchInput = document.querySelector('[data-appointment-search]');
    const serviceFilter = document.querySelector('[data-appointment-service]');
    const statusFilter = document.querySelector('[data-appointment-status]');
    const sortSelect = document.querySelector('[data-appointment-sort]');
    const errorPanel = document.querySelector('[data-appointments-error]');
    const retryButton = document.querySelector('[data-appointments-retry]');
    const summary = document.querySelector('[data-appointments-summary]');
    const actionDialog = document.querySelector('[data-action-dialog]');
    const actionTitle = document.querySelector('#appointment-action-title');
    const actionMessage = document.querySelector('[data-action-message]');
    const actionError = document.querySelector('[data-action-error]');
    const actionConfirm = document.querySelector('[data-action-confirm]');
    const token = localStorage.getItem('goying_access_token');
    const role = localStorage.getItem('goying_role');

    let appointments = [];
    let pendingAction = null;
    const appointmentMetadata = new WeakMap();

    if (!page || !list || !token || role !== 'prestataires') {
        clearSession();
        window.location.href = '/';
        return;
    }

    logoutButton.addEventListener('click', () => {
        clearSession();
        window.location.href = '/';
    });
    refreshButton.addEventListener('click', loadAppointments);
    retryButton.addEventListener('click', loadAppointments);
    searchInput.addEventListener('input', renderAppointments);
    serviceFilter.addEventListener('change', renderAppointments);
    statusFilter.addEventListener('change', renderAppointments);
    sortSelect.addEventListener('change', renderAppointments);
    list.addEventListener('click', handleAppointmentClick);
    list.addEventListener('click', handleWhatsAppClick);
    actionConfirm.addEventListener('click', confirmAppointmentAction);

    document.querySelectorAll('[data-action-cancel]').forEach((button) => {
        button.addEventListener('click', () => actionDialog.close());
    });
    actionDialog.addEventListener('click', (event) => {
        if (event.target === actionDialog && !actionConfirm.disabled) actionDialog.close();
    });

    loadAppointments();

    async function loadAppointments() {
        if (refreshButton.disabled) return;
        setLoading(true);
        errorPanel.hidden = true;
        list.innerHTML = '<div class="appointment-skeleton" aria-hidden="true"></div>'.repeat(3);

        try {
            const response = await fetch(page.dataset.endpoint, {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            });
            const payload = await readPayload(response);
            if ([401, 403].includes(response.status)) {
                clearSession();
                window.location.href = '/';
                return;
            }
            if (!response.ok) throw new Error(formatApiError(payload.detail));
            if (!Array.isArray(payload.rendez_vous)) throw new Error('Réponse invalide');

            appointments = payload.rendez_vous;
            appointments.forEach((appointment, index) => {
                appointmentMetadata.set(appointment, payload.booking_metadata?.[index] || {});
            });
            populateServices();
            updateStatistics();
            renderAppointments();
        } catch (error) {
            console.error('Échec du chargement des rendez-vous.', error);
            appointments = [];
            count.textContent = '—';
            summary.textContent = 'Les rendez-vous ne sont pas disponibles pour le moment.';
            setStatisticsUnavailable();
            list.innerHTML = '';
            errorPanel.hidden = false;
        } finally {
            setLoading(false);
            list.setAttribute('aria-busy', 'false');
        }
    }

    function setLoading(loading) {
        refreshButton.disabled = loading;
        retryButton.disabled = loading;
        refreshButton.setAttribute('aria-busy', String(loading));
        refreshLabel.textContent = loading ? 'Actualisation…' : 'Actualiser';
        list.setAttribute('aria-busy', String(loading));
    }

    function setStatisticsUnavailable() {
        page.querySelectorAll('[data-appointment-stat]').forEach((stat) => {
            stat.textContent = '—';
        });
    }

    function updateStatistics() {
        const counts = { total: appointments.length, pending: 0, active: 0, completed: 0 };
        appointments.forEach((appointment) => {
            const status = statusGroup(appointment.status);
            if (status === 'pending') counts.pending += 1;
            if (['confirmed', 'in-progress', 'awaiting'].includes(status)) counts.active += 1;
            if (status === 'completed') counts.completed += 1;
        });
        Object.entries(counts).forEach(([key, value]) => {
            page.querySelector(`[data-appointment-stat="${key}"]`).textContent = String(value);
        });
    }

    function populateServices() {
        const current = serviceFilter.value;
        const services = [...new Set(appointments
            .map((appointment) => clean(appointment.serviceType || bookingProvider(appointment).specialty || bookingProvider(appointment).categorie))
            .filter(Boolean))]
            .sort((left, right) => left.localeCompare(right, 'fr'));
        serviceFilter.innerHTML = '<option value="">Tous les services</option>' +
            services.map((service) => `<option value="${escapeHtml(service)}">${escapeHtml(service)}</option>`).join('');
        serviceFilter.value = services.includes(current) ? current : '';
    }

    function renderAppointments() {
        const query = normalize(searchInput.value);
        const selectedService = serviceFilter.value;
        const selectedStatus = statusFilter.value;
        const filtered = appointments.filter((appointment) => {
            const provider = bookingProvider(appointment);
            const service = clean(appointment.serviceType || provider.specialty || provider.categorie);
            const searchable = [
                appointment.clientName,
                appointment.clientWhatsApp,
                appointment.clientEmail,
                appointment.itemName,
                appointment.serviceType,
                provider.name,
                provider.phone,
                provider.telephone,
                service,
            ].map(clean).join(' ');
            return (!selectedService || service === selectedService)
                && (selectedStatus === 'all' || statusGroup(appointment.status) === selectedStatus)
                && (!query || normalize(searchable).includes(query));
        });

        const sorted = [...filtered].sort((left, right) => {
            const delta = appointmentTimestamp(left) - appointmentTimestamp(right);
            return sortSelect.value === 'oldest' ? delta : -delta;
        });

        count.textContent = String(sorted.length);
        summary.textContent = sorted.length === appointments.length
            ? `${appointments.length} rendez-vous chargés`
            : `${sorted.length} résultat(s) sur ${appointments.length} rendez-vous`;

        if (sorted.length) {
            list.innerHTML = sorted.map(renderAppointment).join('');
            attachImageFallbacks();
        } else if (appointments.length) {
            list.innerHTML = '<div class="appointment-empty"><span aria-hidden="true">⌕</span><h2>Aucun résultat</h2><p>Modifiez la recherche ou les filtres pour afficher des rendez-vous.</p></div>';
        } else {
            list.innerHTML = '<div class="appointment-empty"><span aria-hidden="true">▦</span><h2>Aucun rendez-vous à afficher</h2><p>Les demandes et prestations apparaîtront ici.</p><button type="button" data-appointment-refresh>Actualiser</button></div>';
        }
    }

    function renderAppointment(appointment) {
        const provider = bookingProvider(appointment);
        const providerName = clean(provider.name || provider.nom || appointment.itemName || appointment.providerName);
        const providerType = clean(appointment.serviceType || provider.specialty || provider.categorie || provider.specialite);
        const providerPhone = clean(appointment.providerPhone || appointmentMetadata.get(appointment)?.providerPhone || provider.phone || provider.telephone);
        const clientName = clean(appointment.clientName || appointment.nom_client);
        const clientPhone = clean(appointment.clientWhatsApp || appointment.telephone_client);
        const clientEmail = clean(appointment.clientEmail || appointment.email_client);
        const address = clean(appointment.serviceAddress || appointment.address || appointment.adresse);
        const locationType = clean(appointment.serviceLocationType || appointment.locationType || appointment.typeLieu);
        const pickup = firstValue(appointment, ['pickupAddress', 'pickUpAddress', 'pickupLocation', 'pickup', 'pickupPoint', 'origin', 'departureAddress', 'adresseDepart']);
        const destination = firstValue(appointment, ['destination', 'destinationAddress', 'dropoffAddress', 'dropOffAddress', 'destinationLocation', 'arrivalAddress', 'adresseArrivee']);
        const details = clean(appointment.details || appointment.description);
        const remarks = clean(appointment.remarks || appointment.notes || appointment.commentaire);
        const amount = formatAppointmentAmount(appointment);
        const pricingConditions = firstValue(appointment, ['pricingConditions', 'tariffConditions', 'costDetails', 'fareDetails', 'priceDescription']);
        const status = clean(appointment.status) || 'Statut non renseigné';
        const statusClass = statusClassName(statusGroup(status));
        const photo = clean(provider.photo_profil || provider.avatarUrl || provider.photo_url || provider.photo || appointment.providerPhoto);
        const initial = providerName ? providerName.charAt(0).toLocaleUpperCase('fr') : 'P';
        const id = bookingDocumentId(appointment);
        const waPhone = normalizeWhatsAppPhone(providerPhone);
        const whatsappButton = waPhone
            ? `<a class="appointment-whatsapp-button" data-appointment-whatsapp href="${buildWhatsAppLink(appointment, providerName, waPhone)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">◉</span> Contacter le prestataire sur WhatsApp</a>`
            : `<button type="button" class="appointment-whatsapp-button" disabled><span aria-hidden="true">◉</span> Contacter le prestataire sur WhatsApp</button>
                <p class="appointment-whatsapp-inline-warning">${providerPhone
                    ? 'Numéro du prestataire au format local ou invalide. Ajoutez un indicatif international vérifié pour utiliser WhatsApp.'
                    : 'Numéro du prestataire non renseigné. Le numéro du client ne sera jamais utilisé comme destinataire.'}</p>`;

        return `<article class="appointment-card-modern">
            <header class="appointment-card-heading">
                <div class="appointment-provider">
                    <div class="appointment-provider-avatar">
                        ${photo
                            ? `<img src="${escapeHtml(photo)}" alt="Photo de ${escapeHtml(providerName)}" loading="lazy"><span aria-hidden="true">${escapeHtml(initial)}</span>`
                            : `<span class="is-visible" aria-hidden="true">${escapeHtml(initial)}</span>`}
                    </div>
                    <div class="appointment-provider-copy">
                        <p class="appointment-service">${escapeHtml(providerType || 'Type de prestation non renseigné')}</p>
                        <h2>${escapeHtml(providerName || 'Prestataire non renseigné')}</h2>
                        ${providerPhone
                            ? `<a class="appointment-provider-phone" href="tel:${escapeHtml(providerPhone)}">${escapeHtml(providerPhone)}</a>`
                            : '<span class="appointment-provider-phone is-missing">Téléphone prestataire non renseigné</span>'}
                    </div>
                </div>
                <div class="appointment-heading-meta">
                    <span class="appointment-status-badge ${statusClass}">${escapeHtml(status)}</span>
                    <time>${escapeHtml(formatDate(appointment.date)) || 'Date non renseignée'}</time>
                    ${amount ? `<strong class="appointment-amount">${escapeHtml(amount)}</strong>` : ''}
                </div>
            </header>

            <div class="appointment-card-sections">
                <section class="appointment-info-section">
                    <h3>Client ayant demandé le rendez-vous</h3>
                    ${infoRow('Nom', clientName || 'Non renseigné')}
                    ${clientPhone
                        ? `<div class="appointment-info"><span>Téléphone / WhatsApp</span><strong><a href="tel:${escapeHtml(clientPhone)}">${escapeHtml(clientPhone)}</a></strong></div>`
                        : infoRow('Téléphone / WhatsApp', 'Non renseigné')}
                    ${clientEmail
                        ? `<div class="appointment-info"><span>E-mail</span><strong><a href="mailto:${escapeHtml(clientEmail)}">${escapeHtml(clientEmail)}</a></strong></div>`
                        : infoRow('E-mail', 'Non renseigné')}
                </section>
                <section class="appointment-info-section">
                    <h3>Détails de la prestation</h3>
                    ${infoRow('Service', providerType || 'Non renseigné')}
                    ${infoRow('Date et heure', formatDate(appointment.date) || 'Non renseigné')}
                    ${infoRow('Lieu', locationType)}
                    ${infoRow('Adresse', address)}
                    ${infoRow('Prise en charge', pickup)}
                    ${infoRow('Destination', destination)}
                    ${infoRow('Montant prévu', amount)}
                    ${infoRow('Conditions tarifaires', pricingConditions)}
                </section>
            </div>

            ${details || remarks ? `<section class="appointment-description">
                <h3>Description et remarques du client</h3>
                ${details ? `<p>${escapeHtml(details)}</p>` : ''}
                ${remarks ? `<p><strong>Remarques :</strong> ${escapeHtml(remarks)}</p>` : ''}
            </section>` : ''}

            ${renderProviderProfile(provider, providerName)}

            <footer class="appointment-card-actions">
                ${whatsappButton}
                ${!waPhone ? '' : '<p class="appointment-whatsapp-privacy">WhatsApp s’ouvrira avec le message prérempli. Aucun message ne sera envoyé automatiquement.</p>'}
                <div class="appointment-workflow-actions">
                    ${renderActionButtons(id, statusGroup(status), appointmentManagementMode(appointment), appointment.providerCompletionRequested === true)}
                    ${id ? `<button type="button" class="appointment-delete-button" data-appointment-delete data-id="${escapeHtml(id)}">Supprimer</button>` : ''}
                </div>
            </footer>
        </article>`;
    }

    function infoRow(label, value) {
        return value ? `<div class="appointment-info"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>` : '';
    }

    function renderProviderProfile(provider, providerName) {
        const skills = firstValue(provider, ['skills', 'competences']);
        const experience = firstValue(provider, ['experienceYears', 'anneesExperience', 'annees_experience']);
        const location = clean(provider.location) || [provider.commune, provider.city || provider.ville, provider.country || provider.pays]
            .map(clean).filter(Boolean).join(', ');
        const rate = firstValue(provider, ['priceRate', 'tarifMensuel', 'tarif_mensuel']);
        const specialty = firstValue(provider, ['specialty', 'categorie', 'specialite']);
        const phone = firstValue(provider, ['phone', 'telephone']);
        const email = clean(provider.email);
        const avatar = clean(provider.photo_profil || provider.avatarUrl || provider.photo_url || provider.photo);
        const profileRows = [
            infoRow('Spécialité', specialty),
            infoRow('Compétences', skills),
            infoRow('Expérience', experience ? `${experience} an(s)` : ''),
            infoRow('Localisation', location),
            infoRow('Tarif indicatif', rate),
            infoRow('E-mail', email),
            infoRow('Téléphone', phone),
            avatar ? `<div class="appointment-info"><span>Photo</span><strong><a href="${escapeHtml(avatar)}" target="_blank" rel="noopener noreferrer">Voir la photo</a></strong></div>` : '',
        ].filter(Boolean).join('');
        if (!profileRows) return '';
        return `<details class="appointment-provider-profile">
            <summary>Profil du prestataire · ${escapeHtml(providerName || 'Informations')}</summary>
            <div class="appointment-provider-profile-content">${profileRows}</div>
        </details>`;
    }

    function bookingDocumentId(appointment) {
        return clean(appointmentMetadata.get(appointment)?.documentId || appointment.id);
    }

    function bookingProvider(appointment) {
        const provider = appointmentMetadata.get(appointment)?.providerProfile || appointment.provider;
        return provider && typeof provider === 'object' && !Array.isArray(provider) ? provider : {};
    }

    function appointmentManagementMode(appointment) {
        return clean(appointmentMetadata.get(appointment)?.managementMode || appointment.managementMode) === 'admin'
            ? 'admin'
            : 'provider';
    }

    function displayFieldName(key) {
        return key
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/[_-]+/g, ' ')
            .replace(/^\w/, (character) => character.toLocaleUpperCase('fr'));
    }

    function renderActionButtons(id, status, managementMode, providerCompletionRequested) {
        const escapedId = escapeHtml(id);
        if (!id) return '';
        if (status === 'pending') {
            return `<button type="button" class="appointment-action-primary" data-appointment-action="confirmer" data-id="${escapedId}">Confirmer le rendez-vous</button>`;
        }
        if (['confirmed', 'in-progress'].includes(status)) {
            const completeButton = managementMode === 'admin'
                ? `<button type="button" class="appointment-action-primary" data-appointment-action="terminer" data-id="${escapedId}">Valider la fin de prestation</button>`
                : '<p class="appointment-action-note">En attente de la déclaration de fin par le prestataire.</p>';
            return `${completeButton}<button type="button" class="appointment-action-secondary" data-appointment-action="remettre-en-attente" data-id="${escapedId}">Remettre en attente</button>`;
        }
        if (status === 'awaiting') {
            const completeButton = managementMode === 'provider' && providerCompletionRequested
                ? `<button type="button" class="appointment-action-primary" data-appointment-action="terminer" data-id="${escapedId}">Confirmer la fin de prestation</button>`
                : '<p class="appointment-action-note">La demande de fin de prestation est incomplète.</p>';
            return `${completeButton}<button type="button" class="appointment-action-secondary" data-appointment-action="remettre-en-attente" data-id="${escapedId}">Remettre en attente</button>`;
        }
        return '';
    }

    function handleAppointmentClick(event) {
        const refresh = event.target.closest('[data-appointment-refresh]');
        if (refresh) {
            loadAppointments();
            return;
        }
        const deleteButton = event.target.closest('[data-appointment-delete]');
        if (deleteButton) {
            const appointment = appointments.find((item) => bookingDocumentId(item) === deleteButton.dataset.id);
            openActionConfirmation({
                id: deleteButton.dataset.id,
                action: 'delete',
                title: 'Supprimer le rendez-vous ?',
                message: `La suppression du rendez-vous${appointment ? ` de ${clean(appointment.clientName) || 'ce client'}` : ''} est définitive. Confirmez-vous cette action ?`,
            });
            return;
        }
        const actionButton = event.target.closest('[data-appointment-action]');
        if (!actionButton) return;
        const config = {
            confirmer: ['Confirmer le rendez-vous ?', 'La demande sera confirmée après validation par le serveur.'],
            terminer: ['Valider la fin de prestation ?', 'Confirmez que cette prestation est terminée.'],
            'remettre-en-attente': ['Remettre en attente ?', 'Le statut du rendez-vous sera remis en attente après confirmation du serveur.'],
        }[actionButton.dataset.appointmentAction];
        if (!config) return;
        openActionConfirmation({
            id: actionButton.dataset.id,
            action: actionButton.dataset.appointmentAction,
            title: config[0],
            message: config[1],
        });
    }

    function handleWhatsAppClick(event) {
        const link = event.target.closest('a[data-appointment-whatsapp]');
        if (!link) return;
        event.preventDefault();
        const whatsappWindow = window.open(link.href, '_blank');
        if (whatsappWindow) {
            whatsappWindow.opener = null;
            return;
        }
        const notice = document.querySelector('[data-appointments-notice]');
        notice.textContent = 'Le navigateur a bloqué l’ouverture de WhatsApp. Autorisez les fenêtres contextuelles puis réessayez.';
        notice.hidden = false;
    }

    function openActionConfirmation(action) {
        pendingAction = action;
        actionTitle.textContent = action.title;
        actionMessage.textContent = action.message;
        actionError.hidden = true;
        actionConfirm.disabled = false;
        actionConfirm.textContent = action.action === 'delete' ? 'Confirmer la suppression' : 'Confirmer';
        actionConfirm.classList.toggle('is-danger', action.action === 'delete');
        actionDialog.showModal();
    }

    async function confirmAppointmentAction() {
        if (!pendingAction || actionConfirm.disabled) return;
        const action = pendingAction;
        actionConfirm.disabled = true;
        actionConfirm.textContent = action.action === 'delete' ? 'Suppression…' : 'Mise à jour…';
        actionError.hidden = true;

        try {
            const deleting = action.action === 'delete';
            const response = await fetch(
                deleting
                    ? `/prestataires/rendez-vous/${encodeURIComponent(action.id)}`
                    : `/prestataires/rendez-vous/${encodeURIComponent(action.id)}/${action.action}`,
                {
                    method: deleting ? 'DELETE' : 'PATCH',
                    headers: { Authorization: `Bearer ${token}` },
                    cache: 'no-store',
                },
            );
            const payload = await readPayload(response);
            if ([401, 403].includes(response.status)) {
                clearSession();
                window.location.href = '/';
                return;
            }
            if (!response.ok) throw new Error(formatApiError(payload.detail));
            actionDialog.close();
            pendingAction = null;
            await loadAppointments();
        } catch (error) {
            console.error('Échec de la mise à jour du rendez-vous.', error);
            actionError.textContent = 'L’action a échoué. Le rendez-vous est conservé. Réessayez.';
            actionError.hidden = false;
        } finally {
            actionConfirm.disabled = false;
            actionConfirm.textContent = action.action === 'delete' ? 'Confirmer la suppression' : 'Confirmer';
        }
    }

    function buildWhatsAppLink(appointment, providerName, recipientNumber) {
        const provider = bookingProvider(appointment);
        const clientName = clean(appointment.clientName || appointment.nom_client);
        const clientPhone = clean(appointment.clientWhatsApp || appointment.telephone_client);
        const clientEmail = clean(appointment.clientEmail || appointment.email_client);
        const service = clean(appointment.serviceType || provider.specialty || provider.categorie || provider.specialite);
        const date = clean(appointment.date);
        const address = clean(appointment.serviceAddress || appointment.address || appointment.adresse);
        const locationType = clean(appointment.serviceLocationType || appointment.locationType || appointment.typeLieu);
        const pickup = firstValue(appointment, ['pickupAddress', 'pickUpAddress', 'pickupLocation', 'pickup', 'pickupPoint', 'origin', 'departureAddress', 'adresseDepart']);
        const destination = firstValue(appointment, ['destination', 'destinationAddress', 'dropoffAddress', 'dropOffAddress', 'destinationLocation', 'arrivalAddress', 'adresseArrivee']);
        const details = clean(appointment.details || appointment.description);
        const remarks = clean(appointment.remarks || appointment.notes || appointment.commentaire);
        const amount = formatAppointmentAmount(appointment);
        const tripDetails = [
            ['Type de trajet', firstValue(appointment, ['tripType', 'rideType', 'typeTrajet'])],
            ['Durée', firstValue(appointment, ['duration', 'tripDuration', 'duree'])],
            ['Nombre de passagers', firstValue(appointment, ['passengers', 'passengerCount', 'nombrePassagers'])],
        ];
        const lines = [`Bonjour${providerName ? ` ${providerName}` : ''},`, '', 'Je vous contacte au sujet d’un rendez-vous demandé sur Goying.'];
        const addSection = (title, items) => {
            const available = items.filter(([, value]) => value !== '');
            if (!available.length) return;
            lines.push('', title, ...available.map(([label, value]) => `- ${label} : ${value}`));
        };

        addSection('Informations du client', [
            ['Nom', clientName],
            ['Téléphone / WhatsApp', clientPhone],
            ['E-mail', clientEmail],
        ]);
        addSection('Détails du rendez-vous', [
            ['Prestation', service],
            ['Date et heure', date],
            ['Adresse', address],
            ['Lieu', locationType],
            ['Description', details],
            ['Remarques', remarks],
            ['Montant prévu', amount],
        ]);
        addSection('Détails du trajet', [
            ['Point de prise en charge', pickup],
            ['Destination', destination],
            ...tripDetails,
        ]);
        lines.push('', 'Merci de confirmer la prise en charge de ce rendez-vous.', '', 'Message préparé depuis l’espace d’administration Goying.');
        return `https://wa.me/${recipientNumber}?text=${encodeURIComponent(lines.join('\n'))}`;
    }

    function normalizeWhatsAppPhone(value) {
        const input = clean(value);
        const compact = input.replace(/[\s().-]/g, '');
        const hasInternationalPrefix = compact.startsWith('+') || compact.startsWith('00');
        if (!hasInternationalPrefix) return '';
        const digits = compact.startsWith('00')
            ? compact.slice(2).replace(/\D/g, '')
            : compact.slice(1).replace(/\D/g, '');
        return digits.length >= 8 && digits.length <= 15 && !digits.startsWith('0') ? digits : '';
    }

    function formatAppointmentAmount(appointment) {
        const amount = firstValue(appointment, ['costInfo', 'amount']);
        const currency = firstValue(appointment, ['currency', 'devise']);
        if (!amount) return '';
        return currency && !normalize(amount).includes(normalize(currency))
            ? `${amount} ${currency}`
            : amount;
    }

    function firstValue(source, keys) {
        for (const key of keys) {
            const rawValue = source[key];
            const value = Array.isArray(rawValue)
                ? rawValue.map(clean).filter(Boolean).join(', ')
                : clean(rawValue);
            if (value) return value;
        }
        return '';
    }

    function attachImageFallbacks() {
        list.querySelectorAll('.appointment-provider-avatar img').forEach((image) => {
            if (image.dataset.fallbackBound) return;
            image.dataset.fallbackBound = 'true';
            image.addEventListener('error', () => {
                image.hidden = true;
                image.nextElementSibling.classList.add('is-visible');
            }, { once: true });
        });
    }

    async function readPayload(response) {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
            throw new Error('Réponse inattendue du serveur.');
        }
        return response.json();
    }

    function statusGroup(status) {
        const normalized = normalize(status);
        if (['en attente', 'pending'].includes(normalized)) return 'pending';
        if (['confirme', 'approuve', 'approved'].includes(normalized)) return 'confirmed';
        if (['en cours', 'in progress'].includes(normalized)) return 'in-progress';
        if (['a valider'].includes(normalized)) return 'awaiting';
        if (['termine', 'completed'].includes(normalized)) return 'completed';
        if (['annule', 'cancelled'].includes(normalized)) return 'cancelled';
        return 'unknown';
    }

    function statusClassName(status) {
        return {
            pending: 'is-pending',
            confirmed: 'is-confirmed',
            'in-progress': 'is-progress',
            awaiting: 'is-awaiting',
            completed: 'is-completed',
            cancelled: 'is-cancelled',
        }[status] || 'is-unknown';
    }

    function appointmentTimestamp(appointment) {
        const parsed = Date.parse(appointment.date || appointment.createdAt || '');
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    function formatDate(value) {
        const raw = clean(value);
        if (!raw) return '';
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return raw;
        return new Intl.DateTimeFormat('fr-FR', {
            dateStyle: 'medium',
            ...(raw.includes('T') || raw.includes(':') ? { timeStyle: 'short' } : {}),
        }).format(parsed);
    }

    function clean(value) {
        if (value === null || value === undefined || typeof value === 'object') return '';
        const text = String(value).trim();
        return ['null', 'undefined', 'nan'].includes(text.toLowerCase()) ? '' : text;
    }

    function normalize(value) {
        return clean(value).toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function formatApiError(detail) {
        if (Array.isArray(detail)) return detail.map((item) => item.msg || item.detail || String(item)).join(' ; ');
        if (detail && typeof detail === 'object') return detail.msg || detail.detail || JSON.stringify(detail);
        return detail || 'Une erreur est survenue';
    }

    function clearSession() {
        localStorage.removeItem('goying_access_token');
        localStorage.removeItem('goying_role');
    }
});

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    }[character]));
}
