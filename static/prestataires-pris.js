document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-taken-providers-page]');
    const list = document.querySelector('[data-taken-list]');
    const refreshButton = document.querySelector('[data-taken-refresh]');
    const refreshLabel = document.querySelector('[data-taken-refresh-label]');
    const logoutButton = document.querySelector('[data-taken-logout]');
    const retryButton = document.querySelector('[data-taken-retry]');
    const errorPanel = document.querySelector('[data-taken-error]');
    const searchInput = document.querySelector('[data-taken-search]');
    const clearSearchButton = document.querySelector('[data-taken-clear]');
    const typeFilter = document.querySelector('[data-taken-type]');
    const resetButton = document.querySelector('[data-taken-reset]');
    const visibleCount = document.querySelector('[data-taken-visible-count]');
    const summary = document.querySelector('[data-taken-summary]');
    const detailsDialog = document.querySelector('[data-taken-details-dialog]');
    const detailsBody = document.querySelector('[data-taken-details-body]');
    const confirmDialog = document.querySelector('[data-taken-confirm-dialog]');
    const confirmTitle = document.querySelector('#taken-confirm-title');
    const confirmMessage = document.querySelector('[data-taken-confirm-message]');
    const confirmIcon = document.querySelector('[data-taken-confirm-icon]');
    const confirmError = document.querySelector('[data-taken-confirm-error]');
    const confirmSubmit = document.querySelector('[data-taken-confirm-submit]');
    const confirmCancel = document.querySelector('[data-taken-confirm-cancel]');
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
    document.querySelector('[data-taken-details-close]').addEventListener('click', () => detailsDialog.close());
    confirmCancel.addEventListener('click', () => confirmDialog.close());
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
        list.innerHTML = '<div class="provider-taken-skeleton" aria-hidden="true"></div>'.repeat(3);
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
            page.querySelector('[data-taken-updated]').textContent = new Intl.DateTimeFormat('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
            }).format(new Date());
            renderProviders();
        } catch (error) {
            console.error('Échec du chargement des prestataires indisponibles.', error);
            providers = [];
            visibleCount.textContent = '—';
            summary.textContent = 'Les prestataires ne sont pas disponibles pour le moment.';
            page.querySelectorAll('[data-taken-stat]').forEach((element) => {
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
        const types = new Set(providers.map((provider) => normalize(providerType(provider))).filter(Boolean));
        const phoneCount = providers.filter((provider) => clean(provider.phone || provider.telephone)).length;
        page.querySelector('[data-taken-stat="total"]').textContent = String(providers.length);
        page.querySelector('[data-taken-stat="types"]').textContent = String(types.size);
        page.querySelector('[data-taken-stat="phones"]').textContent = String(phoneCount);
    }

    function populateTypes() {
        const selected = normalize(typeFilter.value);
        const typesByKey = new Map();
        providers.forEach((provider) => {
            const type = providerType(provider);
            const key = normalize(type);
            if (key && !typesByKey.has(key)) typesByKey.set(key, displayType(type));
        });
        const types = [...typesByKey.entries()].sort((left, right) => left[1].localeCompare(right[1], 'fr'));
        typeFilter.innerHTML = '<option value="">Tous les types</option>' +
            types.map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join('');
        typeFilter.value = typesByKey.has(selected) ? selected : '';
    }

    function renderProviders() {
        const query = normalize(searchInput.value);
        const selectedType = normalize(typeFilter.value);
        const filtered = providers.filter((provider) => {
            const searchText = [
                provider.name, provider.nom, provider.nom_complet,
                provider.specialty, provider.categorie, provider.specialite,
                provider.phone, provider.telephone, provider.email,
                provider.description, provider.bio, provider.location,
                provider.commune, provider.ville, provider.pays,
                provider.skills, provider.competences,
            ].map((value) => Array.isArray(value) ? value.join(' ') : clean(value)).join(' ');
            return (!selectedType || normalize(providerType(provider)) === selectedType)
                && (!query || normalize(searchText).includes(query));
        });

        visibleCount.textContent = String(filtered.length);
        summary.textContent = filtered.length === providers.length
            ? `${providers.length} profil(s) momentanément indisponibles`
            : `${filtered.length} résultat(s) sur ${providers.length} prestataire(s) indisponible(s)`;
        resetButton.hidden = !searchInput.value && !typeFilter.value;

        if (filtered.length) {
            list.innerHTML = filtered.map(renderProvider).join('');
            attachImageFallbacks();
            return;
        }

        if (providers.length) {
            renderEmpty('Aucun résultat', 'Aucun prestataire ne correspond à votre recherche ou au type sélectionné.', 'reset');
        } else {
            renderEmpty(
                'Aucun prestataire pris',
                'Tous les prestataires actuellement suivis sont disponibles, ou aucune indisponibilité n’est enregistrée.',
                'refresh',
            );
        }
    }

    function renderEmpty(title, message, action) {
        list.innerHTML = `<div class="provider-taken-empty">
            <span aria-hidden="true">${action === 'reset' ? '⌕' : '✓'}</span>
            <h3>${title}</h3>
            <p>${message}</p>
            ${action === 'reset'
                ? '<button type="button" data-taken-empty-reset>Réinitialiser les filtres</button>'
                : '<button type="button" data-taken-empty-refresh>Actualiser</button>'}
        </div>`;
    }

    function renderProvider(provider) {
        const name = clean(provider.name || provider.nom || provider.nom_complet) || 'Prestataire sans nom';
        const photo = clean(provider.avatarUrl || provider.photo_url || provider.photo);
        const type = displayType(providerType(provider)) || 'Type non renseigné';
        const phone = clean(provider.phone || provider.telephone);
        const email = clean(provider.email);
        const description = clean(provider.description || provider.bio);
        const initial = initials(name);
        const id = escapeHtml(provider.id);

        return `<article class="provider-taken-card">
            <header class="provider-taken-card-header">
                <div class="provider-taken-avatar">
                    ${photo
                        ? `<img src="${escapeHtml(photo)}" alt="Photo de ${escapeHtml(name)}" loading="lazy"><span aria-hidden="true">${escapeHtml(initial)}</span>`
                        : `<span class="is-visible" aria-hidden="true">${escapeHtml(initial)}</span>`}
                </div>
                <div class="provider-taken-identity">
                    <span class="provider-taken-type">${escapeHtml(type)}</span>
                    <h3>${escapeHtml(name)}</h3>
                    <span class="provider-taken-status"><i aria-hidden="true"></i> Indisponible</span>
                </div>
            </header>
            <div class="provider-taken-contact">
                ${phone ? `<a href="tel:${escapeHtml(phone)}"><span aria-hidden="true">⌕</span>${escapeHtml(phone)}</a>` : ''}
                ${email ? `<a href="mailto:${escapeHtml(email)}"><span aria-hidden="true">✉</span>${escapeHtml(email)}</a>` : ''}
                ${!phone && !email ? '<span class="provider-taken-no-contact">Coordonnées non renseignées</span>' : ''}
            </div>
            ${description
                ? `<div class="provider-taken-description"><p>${escapeHtml(description)}</p><button type="button" data-taken-details="${id}">Lire la suite</button></div>`
                : '<p class="provider-taken-no-description">Aucune description renseignée.</p>'}
            <footer class="provider-taken-card-actions">
                <button type="button" class="provider-taken-profile" data-taken-details="${id}">Voir le profil</button>
                <button type="button" class="provider-taken-available" data-taken-action="rendre-disponible" data-id="${id}">Rendre disponible</button>
                <button type="button" class="provider-taken-delete" data-taken-action="supprimer" data-id="${id}">Supprimer</button>
            </footer>
        </article>`;
    }

    function handleListClick(event) {
        if (event.target.closest('[data-taken-empty-refresh]')) {
            loadProviders();
            return;
        }
        if (event.target.closest('[data-taken-empty-reset]')) {
            resetFilters();
            return;
        }
        const detailsButton = event.target.closest('[data-taken-details]');
        if (detailsButton) {
            openDetails(detailsButton.dataset.takenDetails);
            return;
        }
        const actionButton = event.target.closest('[data-taken-action]');
        if (actionButton) openConfirmation(actionButton.dataset.id, actionButton.dataset.takenAction);
    }

    function openDetails(id) {
        const provider = providers.find((item) => String(item.id) === id);
        if (!provider) return;
        const name = clean(provider.name || provider.nom || provider.nom_complet) || 'Prestataire sans nom';
        const photo = clean(provider.avatarUrl || provider.photo_url || provider.photo);
        const values = [
            ['Type', displayType(providerType(provider))],
            ['Statut', 'Indisponible'],
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

        detailsBody.innerHTML = `<div class="provider-taken-detail-profile">
            <div class="provider-taken-avatar provider-taken-avatar-large">
                ${photo
                    ? `<img src="${escapeHtml(photo)}" alt="Photo de ${escapeHtml(name)}"><span aria-hidden="true">${escapeHtml(initials(name))}</span>`
                    : `<span class="is-visible" aria-hidden="true">${escapeHtml(initials(name))}</span>`}
            </div>
            <div><h3>${escapeHtml(name)}</h3><p>${escapeHtml(displayType(providerType(provider)) || 'Type non renseigné')}</p><span class="provider-taken-status"><i aria-hidden="true"></i> Indisponible</span></div>
        </div>
        <dl class="provider-taken-detail-list">${values.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`;
        attachImageFallbacks(detailsBody);
        detailsDialog.showModal();
    }

    function openConfirmation(id, action) {
        const provider = providers.find((item) => String(item.id) === id);
        if (!provider) return;
        const name = clean(provider.name || provider.nom || provider.nom_complet) || 'Prestataire sans nom';
        const makingAvailable = action === 'rendre-disponible';
        pendingAction = { id, action };
        confirmTitle.textContent = makingAvailable ? 'Rendre ce prestataire disponible ?' : 'Supprimer ce prestataire ?';
        confirmMessage.textContent = makingAvailable
            ? `Le prestataire « ${name} » pourra de nouveau apparaître parmi les professionnels disponibles si les autres conditions de réservation sont satisfaites.`
            : `Cette action peut supprimer définitivement le profil « ${name} ». Voulez-vous continuer ?`;
        confirmIcon.textContent = makingAvailable ? '✓' : '!';
        confirmIcon.classList.toggle('is-danger', !makingAvailable);
        confirmSubmit.textContent = makingAvailable ? 'Confirmer' : 'Supprimer définitivement';
        confirmSubmit.classList.toggle('is-danger', !makingAvailable);
        confirmError.hidden = true;
        confirmSubmit.disabled = false;
        confirmDialog.showModal();
    }

    async function confirmAction() {
        if (!pendingAction || confirmSubmit.disabled) return;
        const action = pendingAction;
        const makingAvailable = action.action === 'rendre-disponible';
        confirmSubmit.disabled = true;
        confirmCancel.disabled = true;
        confirmSubmit.textContent = makingAvailable ? 'Mise à jour…' : 'Suppression…';
        confirmError.hidden = true;

        try {
            const deleting = action.action === 'supprimer';
            const response = await fetch(
                deleting
                    ? `/prestataires/api/${encodeURIComponent(action.id)}`
                    : `/prestataires/${encodeURIComponent(action.id)}/rendre-disponible`,
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
            showNotice(deleting ? 'Prestataire supprimé.' : 'Prestataire rendu disponible.');
            await loadProviders();
        } catch (error) {
            console.error('Échec de la mise à jour du prestataire indisponible.', error);
            confirmError.textContent = 'L’action a échoué. Le profil est conservé dans la liste. Réessayez.';
            confirmError.hidden = false;
        } finally {
            confirmSubmit.disabled = false;
            confirmCancel.disabled = false;
            confirmSubmit.textContent = makingAvailable ? 'Confirmer' : 'Supprimer définitivement';
        }
    }

    function attachImageFallbacks(root = list) {
        root.querySelectorAll('.provider-taken-avatar img').forEach((image) => {
            if (image.dataset.fallbackBound) return;
            image.dataset.fallbackBound = 'true';
            image.addEventListener('error', () => {
                image.hidden = true;
                image.nextElementSibling.classList.add('is-visible');
            }, { once: true });
        });
    }

    function showNotice(message) {
        const notice = page.querySelector('[data-taken-notice]');
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

    function displayType(value) {
        const type = clean(value);
        if (!type) return '';
        const key = normalize(type);
        const commonTypes = {
            menagere: 'Ménagère',
            chauffeur: 'Chauffeur',
            chauffeuse: 'Chauffeuse',
        };
        return commonTypes[key] || type.charAt(0).toLocaleUpperCase('fr') + type.slice(1);
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
