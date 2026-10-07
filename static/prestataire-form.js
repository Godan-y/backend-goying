document.addEventListener('DOMContentLoaded', () => {
    const page = document.querySelector('[data-provider-form]');
    const form = document.querySelector('#provider-form');
    const photoEditor = window.initializeProviderPhotoEditor(
        document.querySelector('[data-provider-photo-editor]'),
    );
    const photoError = document.querySelector('[data-provider-photo-error]');
    const status = document.querySelector('#form-status');
    const logoutButton = document.querySelector('#logout-button');
    const submitButton = document.querySelector('[data-provider-submit]');
    const countrySelect = document.querySelector('[data-provider-country]');
    const phoneCodeSelect = document.querySelector('[data-phone-code]');
    const phoneInput = document.querySelector('[data-phone-local]');
    const phoneNormalized = document.querySelector('[data-phone-normalized]');
    const phoneCallingCode = document.querySelector('[data-phone-calling-code]');
    const phoneRegion = document.querySelector('[data-phone-region]');
    const phonePreview = document.querySelector('[data-phone-preview]');
    const phoneError = document.querySelector('[data-phone-error]');
    const token = localStorage.getItem('goying_access_token');
    const role = localStorage.getItem('goying_role');
    const countryRegions = new Map([
        ['République démocratique du Congo', 'CD'],
        ["Côte d'Ivoire", 'CI'],
        ['Sénégal', 'SN'],
        ['Cameroun', 'CM'],
        ['France', 'FR'],
    ]);

    let validationTimer;
    let validationRequest = 0;
    let submitting = false;

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

    countrySelect.addEventListener('change', () => {
        const region = countryRegions.get(countrySelect.value);
        if (region) phoneCodeSelect.value = region;
        refreshPhoneFields();
    });
    phoneCodeSelect.addEventListener('change', refreshPhoneFields);
    phoneInput.addEventListener('input', () => {
        phoneError.hidden = true;
        phoneInput.removeAttribute('aria-invalid');
        phoneNormalized.value = '';
        clearTimeout(validationTimer);
        if (!phoneInput.value.trim()) {
            phonePreview.textContent = 'Saisissez le numéro pour vérifier son format.';
            return;
        }
        phonePreview.textContent = 'Vérification du numéro…';
        validationTimer = window.setTimeout(() => validatePhone(false), 350);
    });

    form.addEventListener('submit', submitProvider);
    refreshPhoneFields();

    function refreshPhoneFields() {
        const selected = phoneCodeSelect.selectedOptions[0];
        const callingCode = selected?.dataset.callingCode || '';
        phoneCallingCode.value = callingCode;
        phoneRegion.value = phoneCodeSelect.value;
        phoneError.hidden = true;
        phoneInput.removeAttribute('aria-invalid');
        phoneNormalized.value = '';
        if (phoneInput.value.trim()) {
            phonePreview.textContent = 'Vérification du numéro…';
            clearTimeout(validationTimer);
            validationTimer = window.setTimeout(() => validatePhone(false), 100);
        } else {
            phonePreview.textContent = callingCode
                ? `Le numéro vérifié apparaîtra ici avec l’indicatif +${callingCode}.`
                : 'Sélectionnez un indicatif et saisissez le numéro.';
        }
    }

    async function validatePhone(showError) {
        const currentRequest = ++validationRequest;
        const rawPhone = phoneInput.value.trim();
        const selected = phoneCodeSelect.selectedOptions[0];
        const payload = {
            telephone: rawPhone,
            indicatif_telephone: selected?.dataset.callingCode || '',
            region_telephone: phoneCodeSelect.value,
        };
        if (!rawPhone) {
            phoneNormalized.value = '';
            phonePreview.textContent = 'Le téléphone / WhatsApp est obligatoire.';
            if (showError) showPhoneError('Saisissez un numéro de téléphone.');
            return false;
        }

        try {
            const response = await fetch('/prestataires/api/telephone/valider', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
                cache: 'no-store',
            });
            const result = await readPayload(response);
            if (currentRequest !== validationRequest) return false;
            if ([401, 403].includes(response.status)) {
                clearSession();
                window.location.href = '/';
                return false;
            }
            if (!response.ok) throw new Error(formatApiError(result.detail));
            phoneNormalized.value = result.telephone;
            phonePreview.textContent = `Numéro international vérifié : ${result.telephone}`;
            phoneError.hidden = true;
            phoneInput.removeAttribute('aria-invalid');
            return true;
        } catch (error) {
            if (currentRequest !== validationRequest) return false;
            phoneNormalized.value = '';
            phonePreview.textContent = 'Le numéro n’a pas encore été validé.';
            showPhoneError(error.message);
            return false;
        }
    }

    async function submitProvider(event) {
        event.preventDefault();
        if (submitting) return;
        status.className = 'provider-form-message';
        status.textContent = '';
        if (!form.reportValidity()) {
            status.textContent = 'Vérifiez les champs obligatoires avant de continuer.';
            status.classList.add('is-error');
            return;
        }
        if (photoError.textContent) {
            status.className = 'provider-form-message is-error';
            status.textContent = photoError.textContent;
            return;
        }
        if (!await validatePhone(true)) {
            phoneInput.focus();
            return;
        }

        submitting = true;
        submitButton.disabled = true;
        submitButton.setAttribute('aria-busy', 'true');
        submitButton.dataset.originalLabel = submitButton.textContent.trim();
        submitButton.textContent = 'Ajout en cours…';
        status.textContent = 'Enregistrement du profil…';

        const formData = new FormData(form);
        try {
            const photoData = await photoEditor.readDataUrl();
            const profile = {
                nom: formData.get('nom'),
                post_nom: formData.get('post_nom') || '',
                prenom: formData.get('prenom') || '',
                telephone: phoneNormalized.value,
                indicatif_telephone: phoneCallingCode.value,
                region_telephone: phoneRegion.value,
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
                type: page.dataset.providerType,
            };
            if (photoData) profile.photo_profil_data = photoData;
            const response = await fetch('/prestataires/api', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(profile),
            });
            const payload = await readPayload(response);
            if ([401, 403].includes(response.status)) {
                clearSession();
                window.location.href = '/';
                return;
            }
            if (!response.ok) throw new Error(formatApiError(payload.detail));

            status.className = 'provider-form-message is-success';
            status.textContent = payload.message || 'Prestataire ajouté avec succès.';
            form.reset();
            photoEditor.reset();
            refreshPhoneFields();
        } catch (error) {
            status.className = 'provider-form-message is-error';
            status.textContent = error.message;
        } finally {
            submitting = false;
            submitButton.disabled = false;
            submitButton.removeAttribute('aria-busy');
            submitButton.textContent = submitButton.dataset.originalLabel || 'Ajouter le prestataire';
        }
    }

    function showPhoneError(message) {
        phoneError.textContent = message;
        phoneError.hidden = false;
        phoneInput.setAttribute('aria-invalid', 'true');
    }

    async function readPayload(response) {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
            throw new Error('Réponse inattendue du serveur.');
        }
        return response.json();
    }
});

function formatApiError(detail) {
    if (Array.isArray(detail)) {
        return detail.map((item) => {
            if (typeof item === 'string') return item;
            return item.msg || item.detail || JSON.stringify(item);
        }).join(' ; ');
    }
    if (detail && typeof detail === 'object') {
        return detail.msg || detail.detail || JSON.stringify(detail);
    }
    return detail || 'Impossible d’ajouter le prestataire';
}
