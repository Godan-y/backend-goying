document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('vehicle-form');
    if (!form) return;

    const status = document.getElementById('form-status');
    const submitButton = form.querySelector('[data-submit-vehicle]');
    const photoInput = document.getElementById('photos');
    const uploadZone = document.querySelector('[data-upload-zone]');
    const photoPreview = document.getElementById('vehicle-photo-preview');
    const availabilityInput = document.getElementById('is_available');
    const availabilityLabel = document.querySelector('[data-availability-label]');
    const summary = {
        title: document.querySelector('[data-summary-title]'),
        category: document.querySelector('[data-summary-category]'),
        fuel: document.querySelector('[data-summary-fuel]'),
        transmission: document.querySelector('[data-summary-transmission]'),
        seats: document.querySelector('[data-summary-seats]'),
        price: document.querySelector('[data-summary-price]'),
        availability: document.querySelector('[data-summary-availability]'),
        photos: document.querySelector('[data-summary-photos]'),
    };
    let selectedFiles = [];
    let submitting = false;

    if (!status || !submitButton || !photoInput || !uploadZone || !photoPreview
        || !availabilityInput || !availabilityLabel) return;

    form.addEventListener('invalid', handleInvalid, true);
    form.addEventListener('input', handleFieldChange);
    form.addEventListener('change', handleFieldChange);
    form.addEventListener('submit', submitVehicle);
    photoInput.addEventListener('change', () => appendFiles(photoInput.files));
    photoInput.addEventListener('focus', () => uploadZone.classList.add('is-focused'));
    photoInput.addEventListener('blur', () => uploadZone.classList.remove('is-focused'));
    availabilityInput.addEventListener('change', updateSummary);

    ['dragenter', 'dragover'].forEach((eventName) => {
        uploadZone.addEventListener(eventName, (event) => {
            event.preventDefault();
            uploadZone.classList.add('is-dragging');
        });
    });
    ['dragleave', 'drop'].forEach((eventName) => {
        uploadZone.addEventListener(eventName, (event) => {
            event.preventDefault();
            uploadZone.classList.remove('is-dragging');
        });
    });
    uploadZone.addEventListener('drop', (event) => appendFiles(event.dataTransfer?.files));
    photoPreview.addEventListener('click', (event) => {
        const button = event.target.closest('[data-remove-photo]');
        if (!button || submitting) return;
        const index = Number(button.dataset.removePhoto);
        if (!Number.isInteger(index) || index < 0 || index >= selectedFiles.length) return;
        selectedFiles.splice(index, 1);
        syncPhotoInput();
        renderPhotoPreviews();
        clearFieldError('photos');
    });

    updateSummary();

    function handleInvalid(event) {
        const field = event.target;
        if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
        if (!field.name || field.type === 'checkbox') return;
        const message = field.validity.customError
            ? field.validationMessage
            : field.validity.valueMissing
            ? 'Ce champ est obligatoire.'
            : field.validity.rangeUnderflow
                ? field.name === 'seats'
                    ? 'Le nombre de places doit être supérieur à zéro.'
                    : 'Le prix journalier ne peut pas être négatif.'
                : 'Vérifiez la valeur saisie.';
        showFieldError(field.name, message);
    }

    function handleFieldChange(event) {
        const field = event.target;
        if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
        if (field.name) {
            if (field.name === 'features' && field.value.split(',').every((feature) => !feature.trim())) return;
            if (field.checkValidity()) clearFieldError(field.name);
        }
        updateSummary();
    }

    function fileKey(file) {
        return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
    }

    function appendFiles(fileList) {
        const incomingFiles = Array.from(fileList || []);
        if (!incomingFiles.length) return;

        const acceptedFiles = [];
        const errors = [];
        incomingFiles.forEach((file) => {
            const extension = file.name.split('.').pop()?.toLowerCase();
            if (!['jpg', 'jpeg', 'png', 'webp'].includes(extension) || !file.type.startsWith('image/')) {
                errors.push(`${file.name} : format d’image non pris en charge.`);
            } else if (file.size === 0) {
                errors.push(`${file.name} : le fichier est vide.`);
            } else if (file.size > 10 * 1024 * 1024) {
                errors.push(`${file.name} : cette image dépasse la taille maximale autorisée de 10 Mo.`);
            } else {
                acceptedFiles.push(file);
            }
        });

        const existingKeys = new Set(selectedFiles.map(fileKey));
        selectedFiles = [
            ...selectedFiles,
            ...acceptedFiles.filter((file) => !existingKeys.has(fileKey(file))),
        ];
        syncPhotoInput();
        renderPhotoPreviews();

        if (errors.length) {
            const message = errors.join(' ');
            photoInput.setCustomValidity(selectedFiles.length ? '' : message);
            showFieldError('photos', message);
        } else if (selectedFiles.length) {
            photoInput.setCustomValidity('');
            clearFieldError('photos');
        }
    }

    function syncPhotoInput() {
        const transfer = new DataTransfer();
        selectedFiles.forEach((file) => transfer.items.add(file));
        photoInput.files = transfer.files;
    }

    function renderPhotoPreviews() {
        photoPreview.querySelectorAll('img').forEach((image) => URL.revokeObjectURL(image.src));
        photoPreview.replaceChildren();
        selectedFiles.forEach((file, index) => {
            const card = document.createElement('article');
            const image = document.createElement('img');
            const details = document.createElement('div');
            const name = document.createElement('strong');
            const size = document.createElement('small');
            const remove = document.createElement('button');
            const objectUrl = URL.createObjectURL(file);

            card.className = 'vehicle-photo-card';
            image.src = objectUrl;
            image.alt = `Aperçu de ${file.name}`;
            image.onload = () => URL.revokeObjectURL(objectUrl);
            image.onerror = () => URL.revokeObjectURL(objectUrl);
            details.className = 'vehicle-photo-details';
            name.textContent = file.name;
            size.textContent = formatFileSize(file.size);
            remove.type = 'button';
            remove.className = 'vehicle-photo-remove';
            remove.textContent = '×';
            remove.title = 'Retirer cette photo';
            remove.setAttribute('aria-label', `Retirer ${file.name}`);
            remove.dataset.removePhoto = String(index);

            if (index === 0) {
                const badge = document.createElement('span');
                badge.className = 'vehicle-photo-main-badge';
                badge.textContent = '★ Photo principale';
                card.append(badge);
            } else {
                const badge = document.createElement('span');
                badge.className = 'vehicle-photo-order-badge';
                badge.textContent = `Photo ${index + 1}`;
                card.append(badge);
            }

            details.append(name, size);
            card.append(image, details, remove);
            photoPreview.append(card);
        });
        updateSummary();
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return `${bytes} o`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
    }

    function updateSummary() {
        const brand = form.elements.namedItem('brand').value.trim();
        const model = form.elements.namedItem('model').value.trim();
        const category = form.elements.namedItem('category').value;
        const fuel = form.elements.namedItem('fuel').value;
        const transmission = form.elements.namedItem('transmission').value;
        const seats = form.elements.namedItem('seats').value;
        const price = form.elements.namedItem('price_per_day').value;
        const currency = form.elements.namedItem('currency').value;
        const isAvailable = availabilityInput.checked;
        const vehicleName = [brand, model].filter(Boolean).join(' ');
        const photoCount = selectedFiles.length;

        summary.title.textContent = vehicleName || 'Votre véhicule';
        summary.category.textContent = category || 'Catégorie du véhicule';
        summary.fuel.textContent = fuel || 'À renseigner';
        summary.transmission.textContent = transmission || 'À renseigner';
        summary.seats.textContent = seats ? `${seats} ${Number(seats) === 1 ? 'place' : 'places'}` : 'À renseigner';
        summary.price.textContent = price ? `${formatPrice(price)} ${currency} / jour` : 'À renseigner';
        summary.availability.classList.toggle('is-unavailable', !isAvailable);
        summary.availability.querySelector('span').textContent = isAvailable ? '✓' : '—';
        summary.availability.lastChild.textContent = isAvailable ? ' Disponible' : ' Non disponible';
        availabilityLabel.textContent = isAvailable ? 'Disponible' : 'Non disponible';
        summary.photos.textContent = `${photoCount} photo${photoCount === 1 ? '' : 's'} sélectionnée${photoCount === 1 ? '' : 's'}`;
    }

    async function submitVehicle(event) {
        event.preventDefault();
        if (submitting) return;
        clearAllFieldErrors();

        const token = localStorage.getItem('goying_access_token');
        if (!token) {
            showStatus('Votre session a expiré. Veuillez vous reconnecter.', 'error');
            return;
        }
        if (!form.reportValidity()) return;
        if (!selectedFiles.length) {
            showFieldError('photos', 'Ajoutez au moins une photo de la voiture.');
            return;
        }
        if (form.elements.namedItem('features').value.split(',').every((feature) => !feature.trim())) {
            showFieldError('features', 'Ajoutez au moins une fonctionnalité pour la voiture.');
            form.elements.namedItem('features').focus();
            return;
        }

        submitting = true;
        submitButton.disabled = true;
        submitButton.innerHTML = '<span class="vehicle-button-spinner" aria-hidden="true"></span> Ajout en cours…';
        showStatus('', 'loading');

        try {
            const formData = new FormData(form);
            formData.set('is_available', availabilityInput.checked ? 'true' : 'false');
            const response = await fetch(form.action, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });
            const payload = await readJsonResponse(response);
            if (!response.ok) {
                showBackendFieldError(payload.detail);
                throw new Error(formatApiError(payload.detail) || 'Impossible d’ajouter la voiture.');
            }

            const message = payload.message || 'Voiture ajoutée avec succès';
            form.reset();
            selectedFiles = [];
            syncPhotoInput();
            renderPhotoPreviews();
            availabilityInput.checked = true;
            updateSummary();
            showStatus(message, 'success');
        } catch (error) {
            if (!status.textContent) {
                showStatus(getErrorMessage(error), 'error');
            } else if (status.dataset.kind === 'loading') {
                showStatus(getErrorMessage(error), 'error');
            }
        } finally {
            submitting = false;
            submitButton.disabled = false;
            submitButton.innerHTML = '<span aria-hidden="true">＋</span> Ajouter la voiture';
        }
    }

    async function readJsonResponse(response) {
        try {
            return await response.json();
        } catch {
            throw new Error('La réponse du serveur est illisible. Vérifiez votre connexion puis réessayez.');
        }
    }

    function showBackendFieldError(detail) {
        const message = formatApiError(detail).toLocaleLowerCase('fr');
        if (message.includes('marque')) showFieldError('brand', 'La marque est obligatoire.');
        if (message.includes('modèle') || message.includes('modele')) showFieldError('model', 'Le modèle est obligatoire.');
        if (message.includes('catégorie') || message.includes('categorie')) showFieldError('category', 'Sélectionnez une catégorie.');
        if (message.includes('carburant')) showFieldError('fuel', 'Sélectionnez un carburant.');
        if (message.includes('transmission')) showFieldError('transmission', 'Sélectionnez une transmission.');
        if (message.includes('nombre de places') || message.includes('seats')) showFieldError('seats', 'Le nombre de places doit être supérieur à zéro.');
        if (message.includes('ville')) showFieldError('city', 'Indiquez la ville où le véhicule est visible.');
        if (message.includes('commune') || message.includes('quartier')) showFieldError('commune', 'Indiquez la commune ou le quartier.');
        if (message.includes('prix journalier')) showFieldError('price_per_day', 'Le prix journalier ne peut pas être négatif.');
        if (message.includes('devise')) showFieldError('currency', 'Sélectionnez une devise.');
        if (message.includes('fonctionnalité') || message.includes('fonctionnalite')) showFieldError('features', 'Ajoutez au moins une fonctionnalité pour la voiture.');
        if (message.includes('photo') || message.includes('image')) showFieldError('photos', formatApiError(detail));
    }

    function showFieldError(name, message) {
        const error = form.querySelector(`[data-field-error="${name}"]`);
        const field = form.elements.namedItem(name);
        if (!error) return;
        error.textContent = message;
        error.hidden = false;
        field?.setAttribute('aria-invalid', 'true');
    }

    function clearFieldError(name) {
        const error = form.querySelector(`[data-field-error="${name}"]`);
        const field = form.elements.namedItem(name);
        if (!error) return;
        error.textContent = '';
        error.hidden = true;
        field?.removeAttribute('aria-invalid');
    }

    function clearAllFieldErrors() {
        form.querySelectorAll('[data-field-error]').forEach((error) => {
            error.textContent = '';
            error.hidden = true;
        });
        form.querySelectorAll('[aria-invalid="true"]').forEach((field) => field.removeAttribute('aria-invalid'));
    }

    function showStatus(message, type) {
        status.hidden = !message && type === 'loading';
        status.className = `form-message vehicle-create-status is-${type}`;
        status.dataset.kind = type;
        status.textContent = message;
        if (message) status.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function formatApiError(detail) {
        if (Array.isArray(detail)) {
            return detail.map((item) => item.msg || item.detail || String(item)).join(' ; ');
        }
        if (detail && typeof detail === 'object') {
            return detail.message || detail.msg || detail.detail || 'Une erreur est survenue.';
        }
        return detail || '';
    }

    function getErrorMessage(error) {
        if (error instanceof TypeError) return 'Erreur réseau lors de l’envoi. Vérifiez votre connexion puis réessayez.';
        return error instanceof Error ? error.message : 'Impossible d’ajouter la voiture.';
    }

    function formatPrice(value) {
        const amount = Number(value);
        return Number.isFinite(amount)
            ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(amount)
            : value;
    }
});
