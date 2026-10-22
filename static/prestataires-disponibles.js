document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-available-providers-page]');
    const list = document.querySelector('[data-available-list]');
    const refreshButton = document.querySelector('[data-available-refresh]');
    const refreshLabel = document.querySelector('[data-available-refresh-label]');
    const logoutButton = document.querySelector('[data-available-logout]');
    const retryButton = document.querySelector('[data-available-retry]');
    const errorPanel = document.querySelector('[data-available-error]');
    const searchInput = document.querySelector('[data-available-search]');
    const clearSearchButton = document.querySelector('[data-available-clear]');
    const typeFilter = document.querySelector('[data-available-type]');
    const resetButton = document.querySelector('[data-available-reset]');
    const visibleCount = document.querySelector('[data-available-visible-count]');
    const summary = document.querySelector('[data-available-summary]');
    const detailsDialog = document.querySelector('[data-available-details-dialog]');
    const detailsBody = document.querySelector('[data-available-details-body]');
    const confirmDialog = document.querySelector('[data-available-confirm-dialog]');
    const confirmTitle = document.querySelector('#available-confirm-title');
    const confirmMessage = document.querySelector('[data-available-confirm-message]');
    const confirmIcon = document.querySelector('[data-available-confirm-icon]');
    const confirmError = document.querySelector('[data-available-confirm-error]');
    const confirmSubmit = document.querySelector('[data-available-confirm-submit]');
    const token = localStorage.getItem('goying_access_token');
    const role = localStorage.getItem('goying_role');

    let providers = [];
    let pendingAction = null;
    let noticeTimeout;

    if (!page || !list || !token || role !== 'prestataires') {
        clearSession();
        window.location.href = '/';
        return;
    }

    refreshButton.addEventListener('click', loadProviders);
    retryButton.addEventListener('click', loadProviders);
    logoutButton.addEventListener('click', () => {
        clearSession();
        window.location.href = '/';
    });
    searchInput.addEventListener('input', () => {
        clearSearchButton.hidden = !searchInput.value;
        renderProviders();
    });
    clearSearchButton.addEventListener('click', () => {
        searchInput.value = '';
        clearSearchButton.hidden = true;
        searchInput.focus();
        renderProviders();
    });
    typeFilter.addEventListener('change', renderProviders);
    resetButton.addEventListener('click', resetFilters);
    list.addEventListener('click', handleListClick);
    confirmSubmit.addEventListener('click', confirmAction);
    document.querySelector('[data-available-details-close]').addEventListener('click', () => detailsDialog.close());
    document.querySelector('[data-available-confirm-cancel]').addEventListener('click', () => confirmDialog.close());
    detailsDialog.addEventListener('click', (event) => {
        if (event.target === detailsDialog) detailsDialog.close();
    });
    confirmDialog.addEventListener('click', (event) => {
        if (event.target === confirmDialog && !confirmSubmit.disabled) confirmDialog.close();
    });

    loadProviders();

    async function loadProviders() {
        if (refreshButton.disabled) return;
        setLoading(true);
        errorPanel.hidden = true;
        list.innerHTML = '<div class="provider-available-skeleton" aria-hidden="true"></div>'.repeat(3);
        list.setAttribute('aria-busy', 'true');

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
            if (!response.ok) throw new Error(apiError(payload));
            if (!Array.isArray(payload.prestataires)) throw new Error('Réponse invalide');

            providers = payload.prestataires;
            populateTypes();
            updateStatistics();
            page.querySelector('[data-available-updated]').textContent = new Intl.DateTimeFormat('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
            }).format(new Date());
            renderProviders();
        } catch (error) {
            console.error('Échec du chargement des prestataires disponibles.', error);
            providers = [];
            visibleCount.textContent = '—';
            summary.textContent = 'Les prestataires ne sont pas disponibles pour le moment.';
            page.querySelectorAll('[data-available-stat]').forEach((element) => {
                element.textContent = '—';
            });
            list.replaceChildren();
            errorPanel.hidden = false;
        } finally {
            setLoading(false);
        }
    }

    function setLoading(loading) {
        refreshButton.disabled = loading;
        retryButton.disabled = loading;
        refreshButton.setAttribute('aria-busy', String(loading));
        refreshLabel.textContent = loading ? 'Actualisation…' : 'Actualiser';
        list.setAttribute('aria-busy', String(loading));
    }

    function updateStatistics() {
        const uniqueTypes = new Set(providers
            .map((provider) => normalize(providerType(provider)))
            .filter(Boolean));
        const phoneCount = providers.filter((provider) => clean(provider.phone || provider.telephone)).length;
        page.querySelector('[data-available-stat="total"]').textContent = String(providers.length);
        page.querySelector('[data-available-stat="types"]').textContent = String(uniqueTypes.size);
        page.querySelector('[data-available-stat="phones"]').textContent = String(phoneCount);
    }

    function populateTypes() {
        const current = normalize(typeFilter.value);
        const typesByKey = new Map();
        providers.forEach((provider) => {
            const type = providerType(provider);
            const key = normalize(type);
            if (key && !typesByKey.has(key)) typesByKey.set(key, type);
        });
        const types = [...typesByKey.entries()].sort((left, right) => left[1].localeCompare(right[1], 'fr'));
        typeFilter.innerHTML = '<option value="">Tous les types</option>' +
            types.map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join('');
        typeFilter.value = typesByKey.has(current) ? current : '';
    }

    function renderProviders() {
        const query = normalize(searchInput.value);
        const selectedType = normalize(typeFilter.value);
        const filtered = providers.filter((provider) => {
            const searchable = [
                provider.name, provider.nom, provider.nom_complet,
                provider.specialty, provider.categorie, provider.specialite,
                provider.phone, provider.telephone, provider.email,
                provider.bio, provider.description, provider.location,
                provider.commune, provider.ville, provider.pays,
                provider.skills, provider.competences,
            ].map(value => Array.isArray(value) ? value.join(' ') : clean(value)).join(' ');
            return (!selectedType || normalize(providerType(provider)) === selectedType)
                && (!query || normalize(searchable).includes(query));
        });

        visibleCount.textContent = String(filtered.length);
        summary.textContent = filtered.length === providers.length
            ? `${providers.length} profil(s) actuellement réservables`
            : `${filtered.length} résultat(s) sur ${providers.length} prestataire(s) disponible(s)`;
        resetButton.hidden = !searchInput.value && !typeFilter.value;

        if (filtered.length) {
            list.innerHTML = filtered.map(renderProvider).join('');
            attachImageFallbacks();
            return;
        }

        if (providers.length) {
            renderEmpty(
                'Aucun résultat',
                'Aucun prestataire ne correspond à votre recherche ou au type sélectionné.',
                'reset',
            );
        } else {
            renderEmpty(
                'Aucun prestataire disponible',
                'Aucun prestataire ne peut actuellement être réservé dans cette catégorie.',
                'refresh',
            );
        }
    }

    function renderEmpty(title, message, action) {
        list.innerHTML = `<div class="provider-available-empty">
            <span aria-hidden="true">${action === 'reset' ? '⌕' : '◎'}</span>
            <h3>${title}</h3>
            <p>${message}</p>
            ${action === 'reset'
                ? '<button type="button" data-available-empty-reset>Réinitialiser les filtres</button>'
                : '<button type="button" data-available-empty-refresh>Actualiser</button>'}
        </div>`;
    }

    function renderProvider(provider) {
        const name = clean(provider.name || provider.nom || provider.nom_complet) || 'Prestataire sans nom';
        const photo = clean(provider.photo_profil || provider.avatarUrl || provider.photo_url || provider.photo);
        const type = providerType(provider) || 'Type non renseigné';
        const phone = clean(provider.phone || provider.telephone);
        const email = clean(provider.email);
        const description = clean(provider.description || provider.bio);
        const initial = initials(name);
        const id = clean(provider.id);
        const escapedId = escapeHtml(id);

        return `<article class="provider-available-card" data-provider-id="${escapedId}">
            <header class="provider-available-card-header">
                <div class="provider-available-avatar">
                    ${photo
                        ? `<img src="${escapeHtml(photo)}" alt="Photo de ${escapeHtml(name)}" loading="lazy"><span aria-hidden="true">${escapeHtml(initial)}</span>`
                        : `<span class="is-visible" aria-hidden="true">${escapeHtml(initial)}</span>`}
                </div>
                <div class="provider-available-identity">
                    <span class="provider-available-type">${escapeHtml(type)}</span>
                    <h3>${escapeHtml(name)}</h3>
                    <span class="provider-available-status"><i aria-hidden="true"></i> Disponible</span>
                </div>
            </header>
            <div class="provider-available-contact">
                ${phone ? `<a href="tel:${escapeHtml(phone)}"><span aria-hidden="true">⌕</span>${escapeHtml(phone)}</a>` : ''}
                ${email ? `<a href="mailto:${escapeHtml(email)}"><span aria-hidden="true">✉</span>${escapeHtml(email)}</a>` : ''}
                ${!phone && !email ? '<span class="provider-available-no-contact">Coordonnées non renseignées</span>' : ''}
            </div>
            ${description
                ? `<div class="provider-available-description"><p>${escapeHtml(description)}</p><button type="button" data-available-details="${escapedId}">Lire la suite</button></div>`
                : '<p class="provider-available-no-description">Aucune description renseignée.</p>'}
            <footer class="provider-available-card-actions">
                <button type="button" class="provider-available-profile" data-available-details="${escapedId}">Voir le profil</button>
                <button type="button" class="provider-available-take" data-available-action="prendre" data-id="${escapedId}">Marquer comme pris</button>
                <button type="button" class="provider-available-delete" data-available-action="supprimer" data-id="${escapedId}">Supprimer</button>
            </footer>
        </article>`;
    }

    function handleListClick(event) {
        const reset = event.target.closest('[data-available-empty-reset]');
        if (reset) {
            resetFilters();
            return;
        }
        const refresh = event.target.closest('[data-available-empty-refresh]');
        if (refresh) {
            loadProviders();
            return;
        }
        const detailButton = event.target.closest('[data-available-details]');
        if (detailButton) {
            openDetails(detailButton.dataset.availableDetails);
            return;
        }
        const actionButton = event.target.closest('[data-available-action]');
        if (!actionButton) return;
        openConfirmation(actionButton.dataset.id, actionButton.dataset.availableAction);
    }

    function openDetails(id) {
        const provider = providers.find((item) => String(item.id) === id);
        if (!provider) return;
        const name = clean(provider.name || provider.nom || provider.nom_complet) || 'Prestataire sans nom';
        const photo = clean(provider.photo_profil || provider.avatarUrl || provider.photo_url || provider.photo);
        const detailValues = [
            ['Type', providerType(provider)],
            ['Statut', 'Disponible'],
            ['Téléphone', clean(provider.phone || provider.telephone)],
            ['E-mail', clean(provider.email)],
            ['Localisation', clean(provider.location) || [provider.commune, provider.ville, provider.pays].map(clean).filter(Boolean).join(' · ')],
            ['Description', clean(provider.description || provider.bio)],
            ['Expérience', clean(provider.experienceYears || provider.anneesExperience || provider.annees_experience)],
            ['Compétences', formatSkills(provider.skills || provider.competences)],
            ['Tarif', clean(provider.priceRate || provider.price_rate || provider.tarifMensuel || provider.tarif_mensuel)],
            ['Prix négociable', booleanLabel(provider.priceNegotiable ?? provider.prixNegociable)],
            ['Service', clean(provider.typeService || provider.type_service)],
            ['Permis de conduire', clean(provider.permisConduire || provider.permis_conduire)],
            ['Véhicule', clean(provider.modeleVehicule || provider.modele_vehicule)],
            ['Transmission', clean(provider.transmission)],
            ['Note', clean(provider.rating)],
            ['Nombre d’avis', clean(provider.reviewsCount || provider.reviews_count)],
            ['Profil vérifié', booleanLabel(provider.verified)],
            ['Date de création', clean(provider.createdAt || provider.created_at)],
        ].filter(([, value]) => value);
        const initial = initials(name);

        detailsBody.innerHTML = `<div class="provider-available-detail-profile">
            <div class="provider-available-avatar provider-available-avatar-large">
                ${photo
                    ? `<img src="${escapeHtml(photo)}" alt="Photo de ${escapeHtml(name)}"><span aria-hidden="true">${escapeHtml(initial)}</span>`
                    : `<span class="is-visible" aria-hidden="true">${escapeHtml(initial)}</span>`}
            </div>
            <div><h3>${escapeHtml(name)}</h3><p>${escapeHtml(providerType(provider) || 'Type non renseigné')}</p><span class="provider-available-status"><i aria-hidden="true"></i> Disponible</span></div>
        </div>
        <dl class="provider-available-detail-list">${detailValues.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`;
        attachImageFallbacks(detailsBody);
        detailsDialog.showModal();
    }

    function openConfirmation(id, action) {
        const provider = providers.find((item) => String(item.id) === id);
        if (!provider) return;
        const name = clean(provider.name || provider.nom || provider.nom_complet) || 'Prestataire sans nom';
        pendingAction = { id, action };
        const deleting = action === 'supprimer';
        confirmTitle.textContent = deleting ? 'Supprimer ce prestataire ?' : 'Confirmer le changement de disponibilité';
        confirmMessage.textContent = deleting
            ? `Cette action peut supprimer définitivement le profil « ${name} ». Voulez-vous continuer ?`
            : `Voulez-vous marquer « ${name} » comme pris ? Il ne sera alors plus affiché parmi les prestataires disponibles.`;
        confirmIcon.textContent = deleting ? '!' : '✓';
        confirmIcon.classList.toggle('is-danger', deleting);
        confirmSubmit.textContent = deleting ? 'Supprimer définitivement' : 'Confirmer';
        confirmSubmit.classList.toggle('is-danger', deleting);
        confirmError.hidden = true;
        confirmSubmit.disabled = false;
        confirmDialog.showModal();
    }

    async function confirmAction() {
        if (!pendingAction || confirmSubmit.disabled) return;
        const action = pendingAction;
        const deleting = action.action === 'supprimer';
        confirmSubmit.disabled = true;
        confirmSubmit.textContent = deleting ? 'Suppression…' : 'Mise à jour…';
        confirmDialog.querySelector('[data-available-confirm-cancel]').disabled = true;
        confirmError.hidden = true;

        try {
            const response = await fetch(
                deleting
                    ? `/prestataires/api/${encodeURIComponent(action.id)}`
                    : `/prestataires/${encodeURIComponent(action.id)}/${action.action}`,
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
            if (!response.ok) throw new Error(apiError(payload));

            confirmDialog.close();
            pendingAction = null;
            showNotice(deleting ? 'Prestataire supprimé.' : 'Prestataire marqué comme pris.');
            await loadProviders();
        } catch (error) {
            console.error('Échec de la mise à jour du prestataire disponible.', error);
            confirmError.textContent = 'L’action a échoué. Le profil est conservé dans la liste. Réessayez.';
            confirmError.hidden = false;
        } finally {
            confirmSubmit.disabled = false;
            confirmDialog.querySelector('[data-available-confirm-cancel]').disabled = false;
            confirmSubmit.textContent = deleting ? 'Supprimer définitivement' : 'Confirmer';
        }
    }

    function attachImageFallbacks(root = list) {
        root.querySelectorAll('.provider-available-avatar img').forEach((image) => {
            if (image.dataset.fallbackBound) return;
            image.dataset.fallbackBound = 'true';
            image.addEventListener('error', () => {
                image.hidden = true;
                image.nextElementSibling.classList.add('is-visible');
            }, { once: true });
        });
    }

    function showNotice(message) {
        const notice = page.querySelector('[data-available-notice]');
        window.clearTimeout(noticeTimeout);
        notice.textContent = message;
        notice.hidden = false;
        noticeTimeout = window.setTimeout(() => {
            notice.hidden = true;
        }, 5000);
    }

    function resetFilters() {
        searchInput.value = '';
        typeFilter.value = '';
        clearSearchButton.hidden = true;
        renderProviders();
    }

    function providerType(provider) {
        return clean(provider.specialty || provider.categorie || provider.specialite);
    }

    function initials(name) {
        return clean(name).split(/\s+/).filter(Boolean).slice(0, 2)
            .map((part) => part.charAt(0).toLocaleUpperCase('fr')).join('') || 'P';
    }

    function formatSkills(value) {
        if (Array.isArray(value)) return value.map(clean).filter(Boolean).join(', ');
        return clean(value);
    }

    function booleanLabel(value) {
        if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
        return clean(value);
    }

    async function readPayload(response) {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
            throw new Error('Réponse inattendue du serveur.');
        }
        return response.json();
    }

    function apiError(payload) {
        return typeof payload.detail === 'string' ? payload.detail : 'Impossible de mettre à jour le prestataire.';
    }

    function clean(value) {
        if (value === null || value === undefined || typeof value === 'object') return '';
        const text = String(value).trim();
        return ['null', 'undefined', 'nan'].includes(text.toLowerCase()) ? '' : text;
    }

    function normalize(value) {
        return clean(value).toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
