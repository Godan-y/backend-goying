document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('#vehicle-sale-form');
    if (!form) return;

    const status = document.querySelector('#sale-form-status');
    const submitButton = form.querySelector('[data-submit-sale]');
    const photoInput = form.querySelector('#sale-photos');
    const uploadZone = form.querySelector('[data-sale-upload-zone]');
    const photoCount = form.querySelector('[data-sale-photo-count]');
    const photoError = form.querySelector('#sale-photo-error');
    const photoPreview = form.querySelector('#sale-photo-preview');
    const yearInput = form.elements.namedItem('year');
    const maxPhotos = 10;
    let selectedFiles = [];
    let submitting = false;

    if (!status || !submitButton || !photoInput || !uploadZone || !photoCount || !photoError || !photoPreview) return;

    yearInput.max = String(new Date().getFullYear());
    form.addEventListener('submit', submitSale);
    form.addEventListener('invalid', (event) => {
        const field = event.target;
        if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
        field.setAttribute('aria-invalid', 'true');
    }, true);
    form.addEventListener('input', clearValidity);
    form.addEventListener('change', clearValidity);
    photoInput.addEventListener('change', () => appendFiles(photoInput.files));
    uploadZone.addEventListener('dragover', (event) => {
        event.preventDefault();
        uploadZone.classList.add('is-dragging');
    });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('is-dragging'));
    uploadZone.addEventListener('drop', (event) => {
        event.preventDefault();
        uploadZone.classList.remove('is-dragging');
        appendFiles(event.dataTransfer?.files);
    });
    photoPreview.addEventListener('click', (event) => {
        const removeButton = event.target.closest('[data-remove-sale-photo]');
        if (!removeButton || submitting) return;
        const index = Number(removeButton.dataset.removeSalePhoto);
        if (!Number.isInteger(index) || index < 0 || index >= selectedFiles.length) return;
        selectedFiles.splice(index, 1);
        syncPhotoInput();
        renderPhotoPreviews();
        clearPhotoError();
    });

    function clearValidity(event) {
        const field = event.target;
        if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
            if (field.checkValidity()) field.removeAttribute('aria-invalid');
        }
    }

    function fileKey(file) {
        return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
    }

    function appendFiles(fileList) {
        const incomingFiles = Array.from(fileList || []);
        if (!incomingFiles.length) return;

        const existingKeys = new Set(selectedFiles.map(fileKey));
        const newFiles = incomingFiles.filter((file) => !existingKeys.has(fileKey(file)));
        const acceptedFiles = [];
        const errors = [];

        newFiles.forEach((file) => {
            const extension = file.name.split('.').pop()?.toLowerCase();
            if (!['jpg', 'jpeg', 'png', 'webp'].includes(extension) || !file.type.startsWith('image/')) {
                errors.push(`${file.name} : format d’image non pris en charge.`);
            } else if (file.size === 0) {
                errors.push(`${file.name} : le fichier est vide.`);
            } else if (file.size > 10 * 1024 * 1024) {
                errors.push(`${file.name} : la taille maximale est de 10 Mo par photo.`);
            } else {
                acceptedFiles.push(file);
            }
        });

        const availableSlots = maxPhotos - selectedFiles.length;
        if (acceptedFiles.length > availableSlots) {
            errors.push(`Vous pouvez sélectionner au maximum ${maxPhotos} photos.`);
        }
        selectedFiles = [...selectedFiles, ...acceptedFiles.slice(0, availableSlots)];
        syncPhotoInput();
        renderPhotoPreviews();

        if (errors.length) {
            showPhotoError(errors.join(' '));
        } else {
            clearPhotoError();
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
            const removeButton = document.createElement('button');
            const objectUrl = URL.createObjectURL(file);

            card.className = 'vehicle-photo-card';
            image.src = objectUrl;
            image.alt = `Aperçu de ${file.name}`;
            image.onload = () => URL.revokeObjectURL(objectUrl);
            image.onerror = () => URL.revokeObjectURL(objectUrl);
            details.className = 'vehicle-photo-details';
            name.textContent = file.name;
            removeButton.type = 'button';
            removeButton.className = 'vehicle-photo-remove';
            removeButton.textContent = '×';
            removeButton.setAttribute('aria-label', `Retirer ${file.name}`);
            removeButton.dataset.removeSalePhoto = String(index);
            card.append(image, details, removeButton);
            details.append(name);
            photoPreview.append(card);
        });
        photoCount.textContent = `${selectedFiles.length} / ${maxPhotos} photos sélectionnées`;
    }

    function showPhotoError(message) {
        photoInput.setCustomValidity(message);
        photoInput.setAttribute('aria-invalid', 'true');
        photoError.textContent = message;
        photoError.hidden = false;
    }

    function clearPhotoError() {
        photoInput.setCustomValidity('');
        photoInput.removeAttribute('aria-invalid');
        photoError.textContent = '';
        photoError.hidden = true;
    }

    async function submitSale(event) {
        event.preventDefault();
        if (submitting) return;

        const token = localStorage.getItem('goying_access_token');
        if (!token || localStorage.getItem('goying_role') !== 'voitures') {
            showStatus('Votre session de gestionnaire voitures a expiré. Veuillez vous reconnecter.', 'error');
            return;
        }
        if (!form.reportValidity()) return;
        if (!selectedFiles.length) {
            showPhotoError('Ajoutez au moins une photo du véhicule.');
            return;
        }

        submitting = true;
        submitButton.disabled = true;
        submitButton.innerHTML = '<span class="vehicle-button-spinner" aria-hidden="true"></span> Enregistrement…';
        showStatus('', 'loading');

        try {
            const formData = new FormData(form);
            formData.delete('price_negotiable');
            formData.set('price_negotiable', form.elements.namedItem('price_negotiable').checked ? 'true' : 'false');

            const response = await fetch(form.action, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });
            const payload = await readJsonResponse(response);
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    throw new Error('Votre session de gestionnaire voitures a expiré. Veuillez vous reconnecter.');
                }
                throw new Error(formatApiError(payload.detail) || 'Impossible d’ajouter l’annonce de vente.');
            }

            form.reset();
            selectedFiles = [];
            syncPhotoInput();
            renderPhotoPreviews();
            clearPhotoError();
            form.querySelectorAll('[aria-invalid="true"]').forEach((field) => field.removeAttribute('aria-invalid'));
            showStatus(payload.message || 'Annonce de vente ajoutée avec succès.', 'success');
        } catch (error) {
            const message = error instanceof TypeError
                ? 'Erreur réseau lors de l’envoi. Vérifiez votre connexion puis réessayez.'
                : error instanceof Error
                    ? error.message
                    : 'Impossible d’ajouter l’annonce de vente.';
            showStatus(message, 'error');
        } finally {
            submitting = false;
            submitButton.disabled = false;
            submitButton.innerHTML = '<span aria-hidden="true">＋</span> Ajouter l’annonce de vente';
        }
    }

    async function readJsonResponse(response) {
        try {
            return await response.json();
        } catch {
            throw new Error('La réponse du serveur est illisible. Vérifiez votre connexion puis réessayez.');
        }
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

    function showStatus(message, type) {
        status.hidden = !message && type === 'loading';
        status.className = `form-message vehicle-create-status is-${type}`;
        status.textContent = message;
        if (message) status.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
});
