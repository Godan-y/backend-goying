document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-approved-providers-page]');
    if (!page) return;

    const list = page.querySelector('[data-provider-list]');
    const search = page.querySelector('[data-provider-search]');
    const categoryFilter = page.querySelector('[data-provider-category]');
    const availabilityFilter = page.querySelector('[data-provider-availability]');
    const sort = page.querySelector('[data-provider-sort]');
    const refreshButton = page.querySelector('[data-provider-refresh]');
    const refreshLabel = page.querySelector('[data-refresh-label]');
    const visibleCount = page.querySelector('[data-provider-visible-count]');
    const resultSummary = page.querySelector('[data-provider-result-summary]');
    const errorPanel = page.querySelector('[data-provider-error]');
    const errorMessage = page.querySelector('[data-provider-error-message]');
    const feedback = page.querySelector('[data-provider-feedback]');
    const emptyState = page.querySelector('[data-provider-empty]');
    const noResults = page.querySelector('[data-provider-no-results]');
    const deleteDialog = document.querySelector('[data-provider-delete-dialog]');
    const deleteName = deleteDialog.querySelector('[data-provider-delete-name]');
    const deleteError = deleteDialog.querySelector('[data-provider-delete-error]');
    const confirmDelete = deleteDialog.querySelector('[data-provider-confirm-delete]');
    let providers = [];
    let pendingDeleteId = null;
    let hasLoaded = false;
    const token = localStorage.getItem('goying_access_token');

    page.querySelector('[data-provider-logout]').addEventListener('click', logout);
    page.querySelector('[data-provider-retry]').addEventListener('click', loadProviders);
    refreshButton.addEventListener('click', loadProviders);
    search.addEventListener('input', applyFilters);
    categoryFilter.addEventListener('change', applyFilters);
    availabilityFilter.addEventListener('change', applyFilters);
    sort.addEventListener('change', applyFilters);
    list.addEventListener('click', handleCardClick);
    list.addEventListener('error', handleImageError, true);
    confirmDelete.addEventListener('click', deleteProvider);

    if (!token || localStorage.getItem('goying_role') !== 'prestataires') {
        logout();
        return;
    }

    loadProviders();

    async function loadProviders() {
        if (refreshButton.disabled) return;
        refreshButton.disabled = true;
        refreshButton.setAttribute('aria-busy', 'true');
        refreshLabel.textContent = 'Actualisation…';
        errorPanel.hidden = true;
        feedback.textContent = '';
        if (!hasLoaded) {
            list.innerHTML = '<div class="approved-provider-loading"><span></span>Chargement des prestataires…</div>';
        } else {
            list.classList.add('is-refreshing');
        }

        try {
            const response = await fetch(page.dataset.endpoint, {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            });
            const payload = await response.json();
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) logout();
                throw new Error(apiError(payload, 'Impossible de charger les prestataires.'));
            }
            if (!payload || !Array.isArray(payload.prestataires)) {
                throw new Error('Réponse inattendue : la liste des prestataires est invalide.');
            }
            providers = payload.prestataires.filter((provider) => provider && typeof provider === 'object');
            hasLoaded = true;
            populateCategoryFilter();
            updateStatistics();
            applyFilters();
            if (!providers.length) {
                resultSummary.textContent = 'Aucun profil approuvé dans la liste.';
            } else {
                resultSummary.textContent = `${providers.length} profil(s) approuvé(s) chargé(s).`;
            }
        } catch (error) {
            errorMessage.textContent = error.message || 'Une erreur est survenue lors du chargement.';
            errorPanel.hidden = false;
            if (!hasLoaded) {
                list.replaceChildren();
                visibleCount.textContent = '—';
                resultSummary.textContent = 'Les profils n’ont pas pu être chargés.';
                setStatistics(null);
            }
        } finally {
            refreshButton.disabled = false;
            refreshButton.removeAttribute('aria-busy');
            refreshLabel.textContent = 'Actualiser';
            list.classList.remove('is-refreshing');
        }
    }

    function populateCategoryFilter() {
        const selected = categoryFilter.value;
        const categories = new Map();
        providers.forEach((provider) => {
            const category = firstText(provider.specialty, provider.categorie, provider.specialite, provider.type);
            if (category) categories.set(normalize(category), category);
        });
        categoryFilter.replaceChildren(new Option('Toutes les catégories', ''));
        Array.from(categories.entries())
            .sort((left, right) => left[1].localeCompare(right[1], 'fr'))
            .forEach(([key, label]) => categoryFilter.add(new Option(label, key)));
        categoryFilter.value = categories.has(selected) ? selected : '';

        const states = providers.map((provider) => availabilityOf(provider));
        page.querySelector('[data-reserved-option]').hidden = !states.includes('reserved');
        page.querySelector('[data-other-option]').hidden = !states.includes('other');
        if (availabilityFilter.value === 'reserved' && !states.includes('reserved')) availabilityFilter.value = 'all';
        if (availabilityFilter.value === 'other' && !states.includes('other')) availabilityFilter.value = 'all';
    }

    function displayName(provider) {
        const explicitName = firstText(provider.name, provider.nom_complet, provider.fullName);
        if (explicitName) return explicitName;
        return [provider.prenom, provider.nom, provider.postNom]
            .map((value) => cleanText(value))
            .filter(Boolean)
            .join(' ') || 'Prestataire sans nom';
    }

    function categoryOf(provider) {
        return firstText(provider.specialty, provider.categorie, provider.specialite, provider.type) || 'Service non précisé';
    }

    function availabilityOf(provider) {
        const value = normalize(firstText(provider.availability, provider.status, provider.disponibilite, provider.statut));
        if (['disponible', 'available'].includes(value)) return 'available';
        if (['indisponible', 'unavailable', 'occupé', 'occupe', 'busy', 'pris'].includes(value)) return 'unavailable';
        if (['réservé', 'reserve', 'reserved'].includes(value)) return 'reserved';
        return 'other';
    }

    function availabilityLabel(state) {
        return {
            available: 'Disponible',
            unavailable: 'Indisponible',
            reserved: 'Réservé',
            other: 'Disponibilité non renseignée',
        }[state];
    }

    function updateStatistics() {
        const states = providers.map((provider) => availabilityOf(provider));
        const categories = providers.map((provider) => normalize(categoryOf(provider)));
        const stats = {
            total: providers.length,
            drivers: categories.filter((category) => category.includes('chauffeur')).length,
            housekeepers: categories.filter((category) => category.includes('menagere')).length,
            available: states.filter((state) => state === 'available').length,
            unavailable: states.filter((state) => state === 'unavailable').length,
        };
        setStatistics(stats);
    }

    function setStatistics(stats) {
        Object.entries(stats || {
            total: '—',
            drivers: '—',
            housekeepers: '—',
            available: '—',
            unavailable: '—',
        }).forEach(([name, count]) => {
            const target = page.querySelector(`[data-provider-stat="${name}"]`);
            if (target) target.textContent = String(count);
        });
    }

    function applyFilters() {
        const query = normalize(search.value.trim());
        const selectedCategory = categoryFilter.value;
        const selectedAvailability = availabilityFilter.value;
        let visible = providers.filter((provider) => {
            const category = categoryOf(provider);
            const state = availabilityOf(provider);
            const searchText = normalize([
                displayName(provider),
                category,
                provider.phone,
                provider.telephone,
                provider.email,
                provider.location,
                provider.commune,
                provider.ville,
                provider.pays,
            ].map(cleanText).filter(Boolean).join(' '));
            return (!query || searchText.includes(query))
                && (!selectedCategory || normalize(category) === selectedCategory)
                && (selectedAvailability === 'all' || state === selectedAvailability);
        });

        visible.sort((left, right) => {
            if (sort.value === 'name-desc') return displayName(right).localeCompare(displayName(left), 'fr');
            if (sort.value === 'date-asc' || sort.value === 'date-desc') {
                const leftDate = dateValue(left.createdAt || left.created_at);
                const rightDate = dateValue(right.createdAt || right.created_at);
                return sort.value === 'date-asc' ? leftDate - rightDate : rightDate - leftDate;
            }
            return displayName(left).localeCompare(displayName(right), 'fr');
        });

        list.innerHTML = visible.map(renderProvider).join('');
        visibleCount.textContent = String(visible.length);
        emptyState.hidden = providers.length > 0 || !hasLoaded;
        noResults.hidden = !hasLoaded || providers.length === 0 || visible.length > 0;
        if (providers.length && !visible.length) {
            resultSummary.textContent = 'Aucun profil ne correspond aux critères sélectionnés.';
        } else if (hasLoaded) {
            resultSummary.textContent = visible.length === providers.length
                ? `${providers.length} profil(s) approuvé(s) chargé(s).`
                : `${visible.length} résultat(s) sur ${providers.length} prestataire(s) approuvé(s).`;
        }
    }

    function renderProvider(provider) {
        const name = displayName(provider);
        const imageUrl = firstText(provider.avatarUrl, provider.photo_url, provider.photo, provider.profileImageUrl);
        const category = categoryOf(provider);
        const status = availabilityOf(provider);
        const phone = firstText(provider.phone, provider.telephone);
        const email = cleanText(provider.email);
        const location = firstText(provider.location, [provider.commune, provider.ville, provider.pays].map(cleanText).filter(Boolean).join(' · '));
        const description = firstText(provider.description, provider.bio);
        const skills = skillList(provider.skills || provider.competences);
        const createdAt = formatDate(provider.createdAt || provider.created_at);
        const initial = initials(name);
        const image = imageUrl
            ? `<img class="approved-provider-photo" src="${escapeHtml(imageUrl)}" alt="Photo de ${escapeHtml(name)}" loading="lazy"><div class="approved-provider-avatar is-hidden" aria-hidden="true">${escapeHtml(initial)}</div>`
            : `<div class="approved-provider-avatar" aria-label="Avatar de ${escapeHtml(name)}">${escapeHtml(initial)}</div>`;
        const contact = [
            phone ? `<p><span aria-hidden="true">☎</span><strong>Téléphone</strong><a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a></p>` : '',
            email ? `<p><span aria-hidden="true">✉</span><strong>E-mail</strong><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>` : '',
            location ? `<p><span aria-hidden="true">⌖</span><strong>Localisation</strong><span>${escapeHtml(location)}</span></p>` : '',
        ].filter(Boolean).join('');
        const skillsMarkup = skills.length
            ? `<div class="approved-provider-skills">${skills.map((skill) => `<span>${escapeHtml(skill)}</span>`).join('')}</div>`
            : '';

        return `<article class="approved-provider-card" data-provider-card data-provider-id="${escapeHtml(provider.id || '')}" data-provider-name="${escapeHtml(name)}">
            <div class="approved-provider-card-header">
                <div class="approved-provider-portrait">${image}</div>
                <div class="approved-provider-card-title">
                    <p>${escapeHtml(category)}</p>
                    <h3>${escapeHtml(name)}</h3>
                    ${createdAt ? `<small>Inscrit le ${escapeHtml(createdAt)}</small>` : ''}
                </div>
                <div class="approved-provider-badges">
                    <span class="approved-provider-badge is-approved">Approuvé</span>
                    <span class="approved-provider-badge is-${status}">${escapeHtml(availabilityLabel(status))}</span>
                </div>
            </div>
            ${contact ? `<div class="approved-provider-contact">${contact}</div>` : '<p class="approved-provider-muted">Aucune coordonnée renseignée.</p>'}
            ${description ? `<section class="approved-provider-description"><h4>Présentation professionnelle</h4><p data-provider-description>${escapeHtml(description)}</p>${description.length > 180 ? '<button type="button" data-expand-description>Lire la suite</button>' : ''}</section>` : ''}
            ${skillsMarkup ? `<section class="approved-provider-competencies"><h4>Compétences et spécialités</h4>${skillsMarkup}</section>` : ''}
            <div class="approved-provider-actions">
                ${provider.id ? `<a href="/prestataires/${encodeURIComponent(provider.id)}/modifier">Modifier</a>` : ''}
                ${provider.id ? `<button type="button" data-delete-provider>Supprimer</button>` : ''}
            </div>
        </article>`;
    }

    async function handleCardClick(event) {
        const expandButton = event.target.closest('[data-expand-description]');
        if (expandButton) {
            const description = expandButton.parentElement.querySelector('[data-provider-description]');
            const expanded = description.classList.toggle('is-expanded');
            expandButton.textContent = expanded ? 'Lire moins' : 'Lire la suite';
            return;
        }

        const deleteButton = event.target.closest('[data-delete-provider]');
        if (!deleteButton) return;
        const card = deleteButton.closest('[data-provider-card]');
        pendingDeleteId = card.dataset.providerId;
        deleteName.textContent = card.dataset.providerName;
        deleteError.textContent = '';
        deleteError.hidden = true;
        deleteDialog.showModal();
    }

    function handleImageError(event) {
        if (!(event.target instanceof HTMLImageElement)) return;
        event.target.hidden = true;
        const fallback = event.target.parentElement.querySelector('.approved-provider-avatar');
        if (fallback) fallback.classList.remove('is-hidden');
    }

    async function deleteProvider() {
        if (!pendingDeleteId || confirmDelete.disabled) return;
        confirmDelete.disabled = true;
        confirmDelete.textContent = 'Suppression…';
        try {
            const response = await fetch(`/prestataires/api/${encodeURIComponent(pendingDeleteId)}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(apiError(payload, 'Impossible de supprimer ce prestataire.'));
            providers = providers.filter((provider) => String(provider.id) !== pendingDeleteId);
            pendingDeleteId = null;
            deleteDialog.close();
            populateCategoryFilter();
            updateStatistics();
            applyFilters();
            feedback.textContent = payload.message || 'Prestataire supprimé.';
            feedback.classList.add('is-visible');
            feedback.classList.remove('is-error');
        } catch (error) {
            deleteError.textContent = error.message || 'Une erreur est survenue lors de la suppression.';
            deleteError.hidden = false;
        } finally {
            confirmDelete.disabled = false;
            confirmDelete.textContent = 'Confirmer la suppression';
        }
    }

    function skillList(value) {
        if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
        return typeof value === 'string' ? value.split(/[,\n;]/).map((skill) => skill.trim()).filter(Boolean) : [];
    }

    function firstText(...values) {
        for (const value of values) {
            const text = cleanText(value);
            if (text) return text;
        }
        return '';
    }

    function cleanText(value) {
        if (value === null || value === undefined || typeof value === 'object') return '';
        const text = String(value).trim();
        return ['null', 'undefined', 'nan'].includes(text.toLowerCase()) ? '' : text;
    }

    function normalize(value) {
        return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
    }

    function initials(name) {
        return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => Array.from(part)[0].toLocaleUpperCase('fr')).join('') || 'P';
    }

    function dateValue(value) {
        if (value && typeof value === 'object' && Number.isFinite(value.seconds)) return value.seconds * 1000;
        const parsed = Date.parse(value || '');
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function formatDate(value) {
        const timestamp = dateValue(value);
        if (!timestamp) return '';
        return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }).format(timestamp);
    }

    function apiError(payload, fallback) {
        return payload && typeof payload.detail === 'string' ? payload.detail : fallback;
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

    function logout() {
        localStorage.removeItem('goying_access_token');
        localStorage.removeItem('goying_role');
        window.location.href = '/';
    }
});
