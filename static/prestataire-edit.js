document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-provider-edit]');
    const form = document.querySelector('#provider-edit-form');
    const photoEditor = window.initializeProviderPhotoEditor(
        document.querySelector('[data-provider-photo-editor]'),
    );
    const photoError = document.querySelector('[data-provider-photo-error]');
    const status = document.querySelector('#form-status');
    const logoutButton = document.querySelector('#logout-button');
    const token = localStorage.getItem('goying_access_token');
    const role = localStorage.getItem('goying_role');

    function clearSession() {
        localStorage.removeItem('goying_access_token');
        localStorage.removeItem('goying_role');
    }

    if (!page || !form || !token || role !== 'prestataires') {
        clearSession();
        window.location.href = '/';
        return;
    }

    logoutButton.addEventListener('click', () => {
        clearSession();
        window.location.href = '/';
    });

    const providerId = page.dataset.providerId;
    const fields = {
        nom: ['nom'],
        post_nom: ['postNom'],
        prenom: ['prenom'],
        telephone: ['phone', 'telephone'],
        description: ['description', 'bio'],
        pays: ['pays'],
        ville: ['ville'],
        commune: ['commune'],
        annees_experience: ['anneesExperience', 'experienceYears'],
        competences: ['competences'],
        tarif_mensuel: ['tarifMensuel', 'priceRate'],
        permis_conduire: ['permisConduire'],
        type_service: ['typeService'],
        transmission: ['transmission'],
        modele_vehicule: ['modeleVehicule'],
    };

    function firstValue(provider, names) {
        for (const name of names) {
            if (provider[name] !== undefined && provider[name] !== null) return provider[name];
        }
        return '';
    }

    async function loadProvider() {
        status.textContent = 'Chargement du prestataire...';
        try {
            const response = await fetch(`/prestataires/api/${encodeURIComponent(providerId)}`, {
                headers: { Authorization: 'Bearer ' + token },
                cache: 'no-store',
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.detail || 'Impossible de charger le prestataire');

            const provider = payload.prestataire;
            Object.entries(fields).forEach(([field, names]) => {
                const value = field === 'competences' && !provider.competences && Array.isArray(provider.skills)
                    ? provider.skills.join(', ')
                    : firstValue(provider, names);
                form.elements[field].value = value;
            });
            if (!form.elements.nom.value && provider.name) {
                const nameParts = String(provider.name).trim().split(/\s+/);
                form.elements.prenom.value = nameParts.shift() || '';
                form.elements.nom.value = nameParts.join(' ') || form.elements.prenom.value;
            }
            if (!form.elements.pays.value && provider.location) {
                const locationParts = String(provider.location).split(' - ').map((part) => part.trim());
                [form.elements.commune.value, form.elements.ville.value, form.elements.pays.value] = locationParts;
            }
            const category = String(provider.categorie || provider.specialty || '').toLowerCase();
            form.elements.type.value = category.includes('chauffeur')
                ? 'chauffeur'
                : 'menagere';
            photoEditor.setCurrentPhoto(provider.photo_profil || '');
            form.elements.prix_negociable.checked = Boolean(
                provider.prixNegociable ?? provider.priceNegotiable,
            );
            status.textContent = '';
        } catch (error) {
            status.className = 'form-message error';
            status.textContent = error.message;
            form.querySelector('button[type="submit"]').disabled = true;
        }
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submitButton = form.querySelector('button[type="submit"]');
        const formData = new FormData(form);
        submitButton.disabled = true;
        status.className = 'form-message';
        if (photoError.textContent) {
            status.className = 'form-message error';
            status.textContent = photoError.textContent;
            submitButton.disabled = false;
            return;
        }
        status.textContent = 'Enregistrement en cours...';

        try {
            const photoData = await photoEditor.readDataUrl();
            const updates = {
                nom: formData.get('nom') || '',
                post_nom: formData.get('post_nom') || '',
                prenom: formData.get('prenom') || '',
                telephone: formData.get('telephone') || '',
                description: formData.get('description') || '',
                pays: formData.get('pays') || '',
                ville: formData.get('ville') || '',
                commune: formData.get('commune') || '',
                annees_experience: formData.get('annees_experience') || '',
                competences: formData.get('competences') || '',
                tarif_mensuel: formData.get('tarif_mensuel') || '',
                prix_negociable: formData.get('prix_negociable') === 'on',
                permis_conduire: formData.get('permis_conduire') || '',
                type_service: formData.get('type_service') || '',
                transmission: formData.get('transmission') || '',
                modele_vehicule: formData.get('modele_vehicule') || '',
                type: formData.get('type') || '',
            };
            if (photoData) updates.photo_profil_data = photoData;
            const response = await fetch(`/prestataires/api/${encodeURIComponent(providerId)}`, {
                method: 'PUT',
                headers: {
                    Authorization: 'Bearer ' + token,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(updates),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.detail || 'Impossible de modifier le prestataire');
            status.className = 'form-message success';
            status.textContent = 'Prestataire modifié avec succès.';
        } catch (error) {
            status.className = 'form-message error';
            status.textContent = error.message;
        } finally {
            submitButton.disabled = false;
        }
    });

    loadProvider();
});
