document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('maison-create-form');
    if (!form) return;

    const status = document.getElementById('form-status');
    const submitButton = form.querySelector('[data-create-submit]');
    const customFieldsInput = document.getElementById('informations_personnalisees');
    const customFieldsContainer = document.getElementById('custom-information-rows');
    const photoInput = document.getElementById('photos');
    const photoPreview = document.getElementById('house-create-photo-preview');
    const uploadZone = document.querySelector('[data-create-upload-zone]');
    const typeMaison = document.getElementById('type_maison');
    const phoneInput = document.getElementById('telephone');
    const phoneGuidance = document.querySelector('[data-phone-guidance]');
    const summary = {
        title: document.querySelector('[data-summary-title]'),
        location: document.querySelector('[data-summary-location]'),
        price: document.querySelector('[data-summary-price]'),
        photos: document.querySelector('[data-summary-photos]'),
    };
    let selectedFiles = [];
    let submitting = false;

    function showMessage(message, type = 'error') {
        status.hidden = false;
        status.className = `form-message house-create-status ${type}`;
        status.textContent = message;
        status.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function updateFieldsForPropertyType() {
        const isResidential = ['villa', 'appartement', 'maison', 'studio'].includes(typeMaison.value);
        form.querySelectorAll('.residential-fields').forEach((field) => {
            field.hidden = !isResidential;
        });
    }

    function addCustomField() {
        const row = document.createElement('div');
        row.className = 'custom-information-row house-create-custom-row';
        row.innerHTML = `
            <label><span>Nom</span><input type="text" class="custom-information-label" placeholder="Nom de l'information"></label>
            <label><span>Valeur</span><input type="text" class="custom-information-value" placeholder="Valeur"></label>
            <button type="button" class="remove-information" aria-label="Supprimer cette information">×</button>`;
        row.querySelector('.remove-information').addEventListener('click', () => row.remove());
        customFieldsContainer.append(row);
    }

    document.getElementById('ajouter-information').addEventListener('click', addCustomField);
    typeMaison.addEventListener('change', updateFieldsForPropertyType);

    function fileKey(file) {
        return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
    }

    function appendFiles(files) {
        const incomingFiles = [...files];
        if (incomingFiles.some((file) => !file.type.startsWith('image/'))) {
            syncPhotoInput();
            showMessage('Tous les fichiers doivent être des images. Choisissez un autre fichier.', 'error');
            return;
        }

        const existingKeys = new Set(selectedFiles.map(fileKey));
        selectedFiles = [...selectedFiles, ...incomingFiles.filter((file) => !existingKeys.has(fileKey(file)))];
        syncPhotoInput();
        renderPhotoPreviews();
    }

    function syncPhotoInput() {
        const transfer = new DataTransfer();
        selectedFiles.forEach((file) => transfer.items.add(file));
        photoInput.files = transfer.files;
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return `${bytes} o`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
    }

    function renderPhotoPreviews() {
        photoPreview.replaceChildren();
        selectedFiles.forEach((file, index) => {
            const card = document.createElement('article');
            const image = document.createElement('img');
            const details = document.createElement('div');
            const name = document.createElement('strong');
            const size = document.createElement('small');
            const remove = document.createElement('button');
            const objectUrl = URL.createObjectURL(file);

            card.className = 'house-create-photo-card';
            image.src = objectUrl;
            image.alt = `Aperçu de ${file.name}`;
            image.onload = () => URL.revokeObjectURL(objectUrl);
            image.onerror = () => URL.revokeObjectURL(objectUrl);
            details.className = 'house-create-photo-details';
            name.textContent = file.name;
            size.textContent = formatFileSize(file.size);
            remove.type = 'button';
            remove.className = 'house-create-photo-remove';
            remove.textContent = 'Retirer';
            remove.setAttribute('aria-label', `Retirer ${file.name}`);
            remove.addEventListener('click', () => {
                selectedFiles = selectedFiles.filter((_, selectedIndex) => selectedIndex !== index);
                syncPhotoInput();
                renderPhotoPreviews();
            });

            if (index === 0) {
                const mainPhoto = document.createElement('span');
                mainPhoto.className = 'house-create-main-photo-badge';
                mainPhoto.textContent = '★ Photo principale';
                card.append(mainPhoto);
            }
            details.append(name, size);
            card.append(image, details, remove);
            photoPreview.append(card);
        });
        uploadZone.classList.toggle('has-files', photoInput.files.length > 0);
        updateSummary();
    }

    function updateSummary() {
        const title = form.elements.namedItem('titre').value.trim();
        const commune = form.elements.namedItem('commune').value.trim();
        const quartier = form.elements.namedItem('quartier').value.trim();
        const price = form.elements.namedItem('prix').value.trim();
        const transaction = form.elements.namedItem('type').selectedOptions[0]?.textContent.trim();
        const location = [commune, quartier].filter(Boolean).join(', ');
        const photoCount = photoInput.files.length;

        summary.title.textContent = title || 'Votre titre apparaîtra ici';
        summary.location.textContent = location || 'Commune et quartier';
        summary.price.textContent = price
            ? `${price}${transaction && transaction !== 'Sélectionner' ? ` · ${transaction}` : ''}`
            : transaction && transaction !== 'Sélectionner'
                ? transaction
                : 'Prix non renseigné';
        summary.photos.textContent = `${photoCount} photo${photoCount === 1 ? '' : 's'}`;
    }

    function updatePhoneGuidance() {
        phoneGuidance.textContent = phoneInput.value.trim()
            ? 'Numéro non vérifié pour WhatsApp. Vérifiez le numéro et le pays avant de le contacter; cette page ne le normalise pas.'
            : 'Numéro WhatsApp absent. Veuillez renseigner un numéro de téléphone valide avant de contacter ce numéro sur WhatsApp. Le champ reste facultatif.';
    }

    photoInput.addEventListener('change', () => appendFiles(photoInput.files));
    uploadZone.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            photoInput.click();
        }
    });
    ['dragenter', 'dragover'].forEach((eventName) => uploadZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        uploadZone.classList.add('is-dragging');
    }));
    ['dragleave', 'drop'].forEach((eventName) => uploadZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        uploadZone.classList.remove('is-dragging');
    }));
    uploadZone.addEventListener('drop', (event) => appendFiles(event.dataTransfer.files));
    form.addEventListener('input', updateSummary);
    form.elements.namedItem('type').addEventListener('change', updateSummary);
    phoneInput.addEventListener('input', updatePhoneGuidance);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (submitting) return;
        submitting = true;
        submitButton.disabled = true;
        submitButton.setAttribute('aria-busy', 'true');
        submitButton.innerHTML = '<span class="house-create-submit-spinner" aria-hidden="true"></span> Création de la maison…';
        customFieldsInput.value = JSON.stringify(
            [...form.querySelectorAll('.house-create-custom-row')].map((row) => ({
                nom: row.querySelector('.custom-information-label').value.trim(),
                valeur: row.querySelector('.custom-information-value').value.trim(),
            })).filter((field) => field.nom || field.valeur)
        );

        try {
            const headers = {};
            const token = localStorage.getItem('goying_access_token');
            if (token) headers.Authorization = `Bearer ${token}`;

            const response = await fetch(form.action, {
                method: 'POST',
                headers,
                body: new FormData(form),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(formatCreateError(payload.detail || payload.message, response.status));

            showMessage(payload.message || 'Maison ajoutée avec succès.', 'success');
            submitButton.innerHTML = '<span aria-hidden="true">✓</span> Maison ajoutée';
            window.setTimeout(() => { window.location.href = '/maisons'; }, 1200);
        } catch (error) {
            showMessage(error.message || 'Erreur réseau lors de la création.', 'error');
            submitButton.disabled = false;
            submitButton.removeAttribute('aria-busy');
            submitButton.innerHTML = '<span aria-hidden="true">＋</span> Ajouter la maison';
            submitting = false;
        }
    });

    updateFieldsForPropertyType();
    updateSummary();
    updatePhoneGuidance();
});

function formatCreateError(detail, status) {
    if (Array.isArray(detail)) {
        return detail.map((item) => item.msg || item.detail || String(item)).join(' ; ');
    }
    if (detail && typeof detail === 'object') {
        return detail.message || detail.detail || JSON.stringify(detail);
    }
    return detail || `La création a échoué (HTTP ${status}).`;
}
