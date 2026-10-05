document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-prestataires-page]');
    const list = document.querySelector('#prestataires-list');
    const count = document.querySelector('#prestataires-count');
    const refreshButton = document.querySelector('#refresh-prestataires');
    const typeFilter = document.querySelector('#prestataire-type');
    const searchInput = document.querySelector('[data-provider-search]');
    const logoutButton = document.querySelector('#logout-button');
    const errorPanel = document.querySelector('[data-provider-error]');
    const errorMessage = document.querySelector('[data-provider-error-message]');
    const retryButton = document.querySelector('[data-provider-retry]');
    const notice = document.querySelector('[data-provider-notice]');
    const detailsDialog = document.querySelector('[data-provider-details-dialog]');
    const detailsBody = document.querySelector('[data-provider-details-body]');
    const confirmDialog = document.querySelector('[data-provider-confirm-dialog]');
    const confirmTitle = document.querySelector('#provider-confirm-title');
    const confirmMessage = document.querySelector('[data-provider-confirm-message]');
    const confirmIcon = document.querySelector('[data-provider-confirm-icon]');
    const confirmError = document.querySelector('[data-provider-confirm-error]');
    const confirmSubmit = document.querySelector('[data-provider-confirm-submit]');
    const token = localStorage.getItem('goying_access_token');
    const role = localStorage.getItem('goying_role');
    const isPendingPage = page?.dataset.status === 'en_attente';
    const isRefusedPage = page?.dataset.status === 'refuse';
    let loadedProviders = [];
    let noticeTimeout;
    let pendingAction = null;

    if (!page || !list || !token || role !== 'prestataires') {
        clearSession();
        return;
    }

    logoutButton?.addEventListener('click', logout);
    refreshButton?.addEventListener('click', loadProviders);
    retryButton?.addEventListener('click', loadProviders);
    typeFilter?.addEventListener('change', filterProviders);
    searchInput?.addEventListener('input', filterProviders);
    list.addEventListener('click', handleListClick);

    if (isPendingPage || isRefusedPage) {
        document.querySelector('[data-provider-details-close]')?.addEventListener('click', () => detailsDialog.close());
    }

    if (isPendingPage || isRefusedPage) {
        document.querySelector('[data-provider-confirm-cancel]')?.addEventListener('click', () => confirmDialog.close());
        document.querySelector('[data-provider-confirm-submit]')?.addEventListener('click', confirmPendingAction);
        document.querySelector('[data-provider-confirm-form]')?.addEventListener('submit', (event) => event.preventDefault());
        detailsDialog?.addEventListener('click', (event) => {
            if (event.target === detailsDialog) detailsDialog.close();
        });
        confirmDialog?.addEventListener('click', (event) => {
            if (event.target === confirmDialog && !confirmSubmit.disabled) confirmDialog.close();
        });
        confirmDialog?.addEventListener('cancel', (event) => {
            if (confirmSubmit.disabled) event.preventDefault();
        });
    }

    loadProviders();

    async function loadProviders() {
        if (refreshButton?.disabled) return;
        setLoading(true);
        if (isPendingPage) {
            errorPanel.hidden = true;
            setPendingSkeleton();
        } else if (isRefusedPage) {
            errorPanel.hidden = true;
            setRefusedSkeleton();
        } else {
            list.innerHTML = '<p class="status-text">Chargement...</p>';
        }

        try {
            const response = await fetch(page.dataset.endpoint, {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            });
            const payload = await readPayload(response);
            if (!response.ok) {
                if ([401, 403].includes(response.status)) {
                    logout();
                    return;
                }
                throw new Error(apiError(payload, 'Impossible de charger les prestataires.'));
            }

            if (!Array.isArray(payload.prestataires)) {
                throw new Error('La réponse du serveur est invalide.');
            }
            loadedProviders = payload.prestataires;
            populateTypes(loadedProviders);
            filterProviders();

            if (isPendingPage) {
                page.querySelector('[data-provider-updated]').textContent = new Intl.DateTimeFormat('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit',
                }).format(new Date());
                errorPanel.hidden = true;
            } else if (isRefusedPage) {
                page.querySelector('[data-refused-updated]').textContent = new Intl.DateTimeFormat('fr-FR', {
                    hour: '2-digit',
                    minute: '2-digit',
                }).format(new Date());
                errorPanel.hidden = true;
            }
        } catch (error) {
            if (isPendingPage) {
                count.textContent = '—';
                page.querySelector('[data-provider-action-count]').textContent = '—';
                errorMessage.textContent = 'Une erreur est survenue lors du chargement des prestataires. Réessayez.';
                errorPanel.hidden = false;
                list.innerHTML = '';
                console.error('Échec du chargement des demandes de prestataires.', error);
            } else if (isRefusedPage) {
                count.textContent = '—';
                page.querySelector('[data-refused-total]').textContent = '—';
                page.querySelector('[data-refused-types]').textContent = '—';
                errorMessage.textContent = 'Une erreur est survenue lors du chargement des demandes refusées. Réessayez.';
                errorPanel.hidden = false;
                list.innerHTML = '';
                list.setAttribute('aria-busy', 'false');
                console.error('Échec du chargement des demandes refusées.', error);
            } else {
                count.textContent = '0';
                list.innerHTML = `<p class="status-text error">${escapeHtml(error.message)}</p>`;
            }
        } finally {
            setLoading(false);
        }
    }

    function setLoading(loading) {
        if (refreshButton) {
            refreshButton.disabled = loading;
            refreshButton.setAttribute('aria-busy', String(loading));
            refreshButton.innerHTML = loading
                ? '<span aria-hidden="true">↻</span> Actualisation…'
                : '<span aria-hidden="true">↻</span> Actualiser';
        }
        if (retryButton) retryButton.disabled = loading;
        if (isRefusedPage) list.setAttribute('aria-busy', String(loading));
    }

    function setPendingSkeleton() {
        list.innerHTML = '<div class="provider-pending-skeleton" aria-hidden="true"></div>'.repeat(3);
    }

    function setRefusedSkeleton() {
        list.innerHTML = '<div class="provider-refused-skeleton" aria-hidden="true"></div>'.repeat(3);
    }

    function populateTypes(providers) {
        if (!typeFilter) return;
        const current = typeFilter.value;
        const types = [...new Set(providers
            .map((provider) => provider.specialty || provider.categorie || provider.specialite)
            .filter(Boolean))]
            .sort();
        typeFilter.innerHTML = '<option value="">Tous les types</option>' +
            types.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('');
        typeFilter.value = types.includes(current) ? current : '';
    }

    function filterProviders() {
        const selectedType = typeFilter?.value || '';
        const query = normalize(searchInput?.value || '');
        const providers = loadedProviders.filter((provider) => {
            const type = provider.specialty || provider.categorie || provider.specialite || '';
            const matchesType = !selectedType || type === selectedType;
            const searchText = [
                provider.nom,
                provider.nom_complet,
                provider.name,
                provider.email,
                provider.telephone,
                provider.phone,
                provider.description,
                provider.bio,
                provider.location,
                provider.commune,
                provider.ville,
                provider.categorie,
                provider.specialite,
                provider.specialty,
            ].map(clean).join(' ');
            return matchesType && (!query || normalize(searchText).includes(query));
        });

        count.textContent = String(loadedProviders.length);
        if (isRefusedPage) {
            page.querySelector('[data-refused-total]').textContent = String(loadedProviders.length);
            const types = new Set(loadedProviders
                .map((provider) => clean(provider.specialty || provider.categorie || provider.specialite))
                .filter(Boolean)
                .map(normalize));
            page.querySelector('[data-refused-types]').textContent = String(types.size);
        }
        const actionCount = page.querySelector('[data-provider-action-count]');
        if (actionCount) actionCount.textContent = String(loadedProviders.length);

        if (providers.length) {
            list.innerHTML = providers.map(renderProvider).join('');
            attachImageFallbacks();
        } else if (isRefusedPage && loadedProviders.length) {
            list.innerHTML = '<div class="provider-refused-empty"><span aria-hidden="true">⌕</span><h3>Aucun résultat</h3><p>Aucune demande refusée ne correspond à votre recherche ou au type sélectionné.</p></div>';
        } else if (isRefusedPage) {
            list.innerHTML = '<div class="provider-refused-empty"><span aria-hidden="true">✓</span><h3>Aucun prestataire refusé</h3><p>Il n’y a actuellement aucune demande refusée.</p><button type="button" data-empty-refresh>Actualiser</button></div>';
        } else if (isPendingPage && loadedProviders.length && query) {
            list.innerHTML = '<div class="provider-pending-empty"><span aria-hidden="true">⌕</span><h3>Aucun résultat</h3><p>Aucune demande ne correspond à votre recherche.</p></div>';
        } else if (isPendingPage) {
            list.innerHTML = '<div class="provider-pending-empty"><span aria-hidden="true">✓</span><h3>Aucune nouvelle demande</h3><p>Toutes les demandes de prestataires ont été traitées.</p><button type="button" class="provider-pending-empty-refresh" data-empty-refresh>Actualiser</button></div>';
        } else {
            list.innerHTML = '<div class="empty-state"><h2>Aucun prestataire</h2><p class="status-text">Cette section ne contient aucun prestataire pour le moment.</p></div>';
        }
    }

    function renderProvider(provider) {
        if (isPendingPage) return renderPendingProvider(provider);
        if (isRefusedPage) return renderRefusedProvider(provider);

        const name = provider.nom || provider.nom_complet || provider.name || 'Prestataire sans nom';
        const photo = provider.photo || provider.photo_url || provider.avatarUrl || '';
        const statusLabel = {
            en_attente: 'En attente',
            approuve: 'Disponible',
            refuse: 'Demande rejetée',
        }[String(provider.statut || '').toLowerCase()] || provider.statut || page.dataset.status;
        const deleteButton = `<button type="button" class="status-button danger-button" data-action="supprimer" data-id="${escapeHtml(provider.id)}">Supprimer</button>`;
        const actionButtons = page.dataset.status === 'refuse'
            ? ''
            : page.dataset.status === 'en_attente'
                ? `<div class="provider-actions">
                    <button type="button" class="status-button" data-action="approuver" data-id="${escapeHtml(provider.id)}">Approuver</button>
                    <button type="button" class="status-button danger-button" data-action="refuser" data-id="${escapeHtml(provider.id)}">Refuser</button>
                </div>`
                : page.dataset.status === 'disponible'
                    ? `<div class="provider-actions">
                        <button type="button" class="status-button" data-action="prendre" data-id="${escapeHtml(provider.id)}">Marquer comme pris</button>
                        ${deleteButton}
                    </div>`
                    : page.dataset.status === 'approuve'
                        ? `<div class="provider-actions">
                            <a class="status-button" href="/prestataires/${encodeURIComponent(provider.id)}/modifier">Modifier</a>
                            ${deleteButton}
                        </div>`
                        : `<div class="provider-actions">
                            <button type="button" class="status-button" data-action="rendre-disponible" data-id="${escapeHtml(provider.id)}">Rendre disponible</button>
                            ${deleteButton}
                        </div>`;

        return `<article class="provider-card">
            ${photo ? `<img src="${escapeHtml(photo)}" alt="Photo de ${escapeHtml(name)}" loading="lazy">` : '<div class="provider-avatar">P</div>'}
            <div class="provider-content">
                <div class="house-heading">
                    <div><p class="eyebrow">${escapeHtml(provider.categorie || provider.specialite || provider.specialty || 'Prestataire')}</p><h2>${escapeHtml(name)}</h2></div>
                    <span class="statut">${escapeHtml(statusLabel)}</span>
                </div>
                ${provider.telephone || provider.phone ? `<p><strong>Téléphone :</strong> ${escapeHtml(provider.telephone || provider.phone)}</p>` : ''}
                ${provider.email ? `<p><strong>Email :</strong> ${escapeHtml(provider.email)}</p>` : ''}
                ${provider.description || provider.bio ? `<p class="status-text">${escapeHtml(provider.description || provider.bio)}</p>` : ''}
                ${actionButtons}
            </div>
        </article>`;
    }

    function renderPendingProvider(provider) {
        const name = clean(provider.nom || provider.nom_complet || provider.name) || 'Prestataire sans nom';
        const photo = clean(provider.photo_url || provider.avatarUrl || provider.photo);
        const specialty = clean(provider.categorie || provider.specialite || provider.specialty) || 'Type non renseigné';
        const email = clean(provider.email);
        const phone = clean(provider.telephone || provider.phone);
        const description = clean(provider.description || provider.bio);
        const initial = name.charAt(0).toLocaleUpperCase('fr');
        const escapedId = escapeHtml(provider.id);

        return `<article class="provider-pending-card">
            <div class="provider-pending-card-header">
                <div class="provider-pending-avatar">
                    ${photo
                        ? `<img src="${escapeHtml(photo)}" alt="Photo de ${escapeHtml(name)}" loading="lazy"><span aria-hidden="true">${escapeHtml(initial)}</span>`
                        : `<span class="is-visible" aria-hidden="true">${escapeHtml(initial)}</span>`}
                </div>
                <div class="provider-pending-identity">
                    <span class="provider-pending-type">${escapeHtml(specialty)}</span>
                    <h3>${escapeHtml(name)}</h3>
                    <span class="provider-pending-status"><i aria-hidden="true"></i> En attente</span>
                </div>
            </div>
            <div class="provider-pending-contact">
                ${email ? `<a href="mailto:${escapeHtml(email)}"><span aria-hidden="true">✉</span>${escapeHtml(email)}</a>` : ''}
                ${phone ? `<a href="tel:${escapeHtml(phone)}"><span aria-hidden="true">⌕</span>${escapeHtml(phone)}</a>` : ''}
                ${!email && !phone ? '<span class="provider-pending-no-contact">Coordonnées non renseignées</span>' : ''}
            </div>
            ${description
                ? `<div class="provider-pending-description"><p>${escapeHtml(description)}</p><button type="button" data-provider-details="${escapedId}">Voir plus</button></div>`
                : '<p class="provider-pending-no-description">Aucune description renseignée.</p>'}
            <div class="provider-pending-card-footer">
                <button type="button" class="provider-pending-details" data-provider-details="${escapedId}">Voir les détails</button>
                <div class="provider-pending-actions">
                    <button type="button" class="provider-pending-approve" data-action="approuver" data-id="${escapedId}"><span aria-hidden="true">✓</span> Approuver</button>
                    <button type="button" class="provider-pending-refuse" data-action="refuser" data-id="${escapedId}"><span aria-hidden="true">×</span> Refuser</button>
                </div>
            </div>
        </article>`;
    }

    function renderRefusedProvider(provider) {
        const name = clean(provider.nom || provider.nom_complet || provider.name) || 'Prestataire sans nom';
        const photo = clean(provider.photo_url || provider.avatarUrl || provider.photo);
        const specialty = clean(provider.categorie || provider.specialite || provider.specialty) || 'Type non renseigné';
        const email = clean(provider.email);
        const phone = clean(provider.telephone || provider.phone);
        const description = clean(provider.description || provider.bio);
        const initial = name.charAt(0).toLocaleUpperCase('fr');
        const escapedId = escapeHtml(provider.id);

        return `<article class="provider-refused-card">
            <div class="provider-refused-card-header">
                <div class="provider-refused-avatar">
                    ${photo
                        ? `<img src="${escapeHtml(photo)}" alt="Photo de ${escapeHtml(name)}" loading="lazy"><span aria-hidden="true">${escapeHtml(initial)}</span>`
                        : `<span class="is-visible" aria-hidden="true">${escapeHtml(initial)}</span>`}
                </div>
                <div class="provider-refused-identity">
                    <span class="provider-refused-type">${escapeHtml(specialty)}</span>
                    <h3>${escapeHtml(name)}</h3>
                    <span class="provider-refused-status"><i aria-hidden="true"></i> Demande rejetée</span>
                </div>
            </div>
            <div class="provider-refused-contact">
                ${email ? `<a href="mailto:${escapeHtml(email)}"><span aria-hidden="true">✉</span>${escapeHtml(email)}</a>` : ''}
                ${phone ? `<a href="tel:${escapeHtml(phone)}"><span aria-hidden="true">⌕</span>${escapeHtml(phone)}</a>` : ''}
                ${!email && !phone ? '<span class="provider-refused-no-contact">Coordonnées non renseignées</span>' : ''}
            </div>
            ${description
                ? `<div class="provider-refused-description"><p>${escapeHtml(description)}</p><button type="button" data-provider-details="${escapedId}">Voir plus</button></div>`
                : '<p class="provider-refused-no-description">Aucune description renseignée.</p>'}
            <div class="provider-refused-card-footer">
                <button type="button" class="provider-refused-details" data-provider-details="${escapedId}">Voir les détails</button>
                <button type="button" class="provider-refused-approve" data-action="approuver" data-id="${escapedId}"><span aria-hidden="true">✓</span> Approuver</button>
            </div>
        </article>`;
    }

    function attachImageFallbacks() {
        document.querySelectorAll('.provider-pending-avatar img, .provider-refused-avatar img').forEach((image) => {
            if (image.dataset.fallbackBound) return;
            image.dataset.fallbackBound = 'true';
            image.addEventListener('error', () => {
                image.hidden = true;
                image.nextElementSibling.classList.add('is-visible');
            }, { once: true });
        });
    }

    function handleListClick(event) {
        const detailsButton = event.target.closest('[data-provider-details]');
        if (detailsButton && (isPendingPage || isRefusedPage)) {
            openDetails(detailsButton.dataset.providerDetails);
            return;
        }
        if (event.target.closest('[data-empty-refresh]')) {
            loadProviders();
            return;
        }
        const button = event.target.closest('[data-action]');
        if (!button) return;

        if ((isPendingPage && ['approuver', 'refuser'].includes(button.dataset.action))
            || (isRefusedPage && button.dataset.action === 'approuver')) {
            openActionConfirmation(button.dataset.id, button.dataset.action);
            return;
        }
        performExistingAction(button);
    }

    function openDetails(providerId) {
        const provider = loadedProviders.find((item) => item.id === providerId);
        if (!provider) return;
        const name = clean(provider.nom || provider.nom_complet || provider.name) || 'Prestataire sans nom';
        const photo = clean(provider.photo_url || provider.avatarUrl || provider.photo);
        const specialty = clean(provider.categorie || provider.specialite || provider.specialty);
        const statusLabel = isRefusedPage ? 'Demande rejetée' : 'En attente';
        const values = [
            ['Type', specialty],
            ['Statut', statusLabel],
            ['Email', clean(provider.email)],
            ['Téléphone', clean(provider.telephone || provider.phone)],
            ['Lieu', clean(provider.location) || [provider.commune, provider.ville, provider.pays].map(clean).filter(Boolean).join(' · ')],
            ['Expérience', clean(provider.experienceYears || provider.anneesExperience || provider.annees_experience)],
            ['Compétences', formatSkills(provider.skills || provider.competences)],
            ['Tarif', clean(provider.priceRate || provider.price_rate || provider.tarifMensuel || provider.tarif_mensuel)],
            ['Prix négociable', typeof (provider.priceNegotiable ?? provider.prixNegociable) === 'boolean'
                ? ((provider.priceNegotiable ?? provider.prixNegociable) ? 'Oui' : 'Non')
                : clean(provider.priceNegotiable || provider.prixNegociable)],
            ['Service', clean(provider.typeService || provider.type_service)],
            ['Permis de conduire', clean(provider.permisConduire || provider.permis_conduire)],
            ['Véhicule', clean(provider.modeleVehicule || provider.modele_vehicule)],
            ['Transmission', clean(provider.transmission)],
            ['Date de création', clean(provider.createdAt || provider.created_at)],
            ['Description', clean(provider.description || provider.bio)],
        ].filter(([, value]) => value);

        detailsBody.innerHTML = `<div class="provider-pending-detail-profile">
            <div class="provider-pending-avatar provider-pending-avatar-large">
                ${photo
                    ? `<img src="${escapeHtml(photo)}" alt="Photo de ${escapeHtml(name)}"><span aria-hidden="true">${escapeHtml(name.charAt(0).toLocaleUpperCase('fr'))}</span>`
                    : `<span class="is-visible" aria-hidden="true">${escapeHtml(name.charAt(0).toLocaleUpperCase('fr'))}</span>`}
            </div>
            <div><h3>${escapeHtml(name)}</h3><p>${escapeHtml(specialty || 'Type non renseigné')}</p><span class="${isRefusedPage ? 'provider-refused-status' : 'provider-pending-status'}"><i aria-hidden="true"></i> ${escapeHtml(statusLabel)}</span></div>
        </div>
        <dl class="provider-pending-detail-list">${values.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`;
        attachImageFallbacks();
        detailsDialog.showModal();
    }

    function openActionConfirmation(providerId, action) {
        const provider = loadedProviders.find((item) => item.id === providerId);
        if (!provider) return;
        pendingAction = { id: providerId, action };
        const name = clean(provider.nom || provider.nom_complet || provider.name) || 'Prestataire sans nom';
        const approving = action === 'approuver';
        confirmTitle.textContent = isRefusedPage
            ? 'Approuver ce prestataire ?'
            : approving ? 'Confirmer l’approbation' : 'Confirmer le refus';
        confirmMessage.textContent = isRefusedPage
            ? `Confirmez-vous que le profil de « ${name} » a été complété et peut maintenant être approuvé ? Il sera ajouté aux prestataires approuvés et disponibles.`
            : approving
                ? `Êtes-vous sûr de vouloir approuver le prestataire « ${name} » ?`
                : `Êtes-vous sûr de vouloir refuser la demande de « ${name} » ?`;
        confirmIcon.textContent = approving ? '✓' : '×';
        confirmIcon.classList.toggle('is-danger', !approving);
        confirmSubmit.textContent = approving ? 'Confirmer l’approbation' : 'Confirmer le refus';
        confirmSubmit.classList.toggle('is-danger', !approving);
        confirmError.hidden = true;
        confirmDialog.showModal();
    }

    async function confirmPendingAction() {
        if (!pendingAction || confirmSubmit.disabled) return;
        const { id, action } = pendingAction;
        confirmSubmit.disabled = true;
        confirmDialog.querySelector('[data-provider-confirm-cancel]').disabled = true;
        confirmSubmit.textContent = action === 'approuver' ? 'Approbation…' : 'Refus…';
        confirmError.hidden = true;

        try {
            const response = await fetch(`/prestataires/${encodeURIComponent(id)}/${action}`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            });
            const payload = await readPayload(response);
            if (!response.ok) {
                if ([401, 403].includes(response.status)) {
                    logout();
                    return;
                }
                throw new Error(apiError(payload, 'La demande n’a pas pu être mise à jour.'));
            }

            confirmDialog.close();
            pendingAction = null;
            showNotice(action === 'approuver' ? 'Prestataire approuvé avec succès.' : 'Demande refusée.');
            await loadProviders();
        } catch (error) {
            confirmError.textContent = 'L’action a échoué. La demande est conservée dans la liste. Réessayez.';
            confirmError.hidden = false;
            console.error('Échec du traitement de la demande prestataire.', error);
        } finally {
            confirmSubmit.disabled = false;
            confirmDialog.querySelector('[data-provider-confirm-cancel]').disabled = false;
            if (confirmDialog.open) {
                confirmSubmit.textContent = action === 'approuver' ? 'Confirmer l’approbation' : 'Confirmer le refus';
            }
        }
    }

    async function performExistingAction(button) {
        if (button.dataset.action === 'supprimer' && !window.confirm('Supprimer définitivement ce prestataire ?')) return;
        button.disabled = true;

        try {
            const isDeletion = button.dataset.action === 'supprimer';
            const response = await fetch(
                isDeletion
                    ? `/prestataires/api/${encodeURIComponent(button.dataset.id)}`
                    : `/prestataires/${encodeURIComponent(button.dataset.id)}/${button.dataset.action}`,
                {
                    method: isDeletion ? 'DELETE' : 'PATCH',
                    headers: { Authorization: `Bearer ${token}` },
                    cache: 'no-store',
                },
            );
            const payload = await readPayload(response);
            if (!response.ok) throw new Error(apiError(payload, 'Impossible de mettre à jour le prestataire.'));
            await loadProviders();
        } catch (error) {
            alert(error.message);
            button.disabled = false;
        }
    }

    function showNotice(message) {
        if (!notice) return;
        window.clearTimeout(noticeTimeout);
        notice.textContent = message;
        notice.hidden = false;
        noticeTimeout = window.setTimeout(() => {
            notice.hidden = true;
        }, 5000);
    }

    async function readPayload(response) {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
            throw new Error('Réponse inattendue du serveur.');
        }
        return response.json();
    }

    function apiError(payload, fallback) {
        return typeof payload.detail === 'string' ? payload.detail : fallback;
    }

    function formatSkills(value) {
        if (Array.isArray(value)) return value.map(clean).filter(Boolean).join(', ');
        return clean(value);
    }

    function clean(value) {
        if (value === null || value === undefined || typeof value === 'object') return '';
        const text = String(value).trim();
        return ['null', 'undefined', 'nan'].includes(text.toLowerCase()) ? '' : text;
    }

    function normalize(value) {
        return clean(value).toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function logout() {
        clearSession();
        window.location.href = '/';
    }

    function clearSession() {
        localStorage.removeItem('goying_access_token');
        localStorage.removeItem('goying_role');
        window.location.href = '/';
    }
});

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
    }[character]));
}
