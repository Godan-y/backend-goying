document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('maison-edit-form');
    if (!form) return;

    const houseId = form.dataset.maisonId;
    const status = document.getElementById('form-status');
    const submitButton = form.querySelector('button[type="submit"]');
    const token = localStorage.getItem('goying_access_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const photoInput = document.getElementById('photos');
    const photoPreviews = document.getElementById('new-photo-previews');
    const uploadZone = document.querySelector('[data-upload-zone]');
    const photoDialog = document.getElementById('house-photo-dialog');
    const dialogImage = document.getElementById('house-photo-dialog-image');
    const dialogCount = document.getElementById('house-photo-dialog-count');
    let existingPhotos = [];
    let activePhotoIndex = 0;

    function showMessage(message, type = 'error') {
        status.hidden = false;
        status.textContent = message;
        status.className = `form-message house-edit-status ${type}`;
        status.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function clearSession() {
        localStorage.removeItem('goying_access_token');
        localStorage.removeItem('goying_role');
        window.location.href = '/';
    }

    function addInformation(information = {}) {
        const row = document.createElement('div');
        row.className = 'custom-information-row house-edit-custom-row';
        row.innerHTML = `
            <label><span>Nom</span><input type="text" class="custom-information-label" placeholder="Ex. Électricité"></label>
            <label><span>Valeur</span><input type="text" class="custom-information-value" placeholder="Ex. Prépayée"></label>
            <button type="button" class="remove-information" aria-label="Supprimer cette information">×</button>`;
        row.querySelector('.custom-information-label').value = information.nom || '';
        row.querySelector('.custom-information-value').value = information.valeur || '';
        row.querySelector('.remove-information').addEventListener('click', () => row.remove());
        document.getElementById('custom-information-rows').append(row);
    }

    document.getElementById('ajouter-information').addEventListener('click', () => addInformation());
    const typeMaison = form.elements.namedItem('type_maison');

    function updateFieldsForPropertyType() {
        const isResidential = ['villa', 'appartement', 'maison', 'studio'].includes(typeMaison.value);
        form.querySelectorAll('.residential-fields').forEach((field) => {
            field.hidden = !isResidential;
        });
    }

    typeMaison.addEventListener('change', updateFieldsForPropertyType);

    function openPhoto(index) {
        if (!existingPhotos.length) return;
        activePhotoIndex = (index + existingPhotos.length) % existingPhotos.length;
        dialogImage.src = existingPhotos[activePhotoIndex];
        dialogImage.alt = `Photo ${activePhotoIndex + 1} sur ${existingPhotos.length}`;
        dialogCount.textContent = `${activePhotoIndex + 1} / ${existingPhotos.length}`;
        if (!photoDialog.open) photoDialog.showModal();
    }

    function renderExistingPhotos() {
        const container = document.getElementById('existing-photos');
        container.replaceChildren();
        if (!existingPhotos.length) {
            const empty = document.createElement('p');
            empty.className = 'house-edit-photo-empty';
            empty.textContent = 'Aucune photo enregistrée pour ce bien.';
            container.append(empty);
            return;
        }

        existingPhotos.forEach((url, index) => {
            const button = document.createElement('button');
            const image = document.createElement('img');
            button.type = 'button';
            button.className = `house-edit-photo${index === 0 ? ' is-featured' : ''}`;
            button.setAttribute('aria-label', `Agrandir la photo ${index + 1}`);
            image.src = url;
            image.alt = `Photo actuelle ${index + 1}`;
            image.loading = 'lazy';
            button.append(image);
            button.addEventListener('click', () => openPhoto(index));
            container.append(button);
        });
    }

    function appendDroppedFiles(files) {
        const incomingFiles = [...files];
        if (incomingFiles.some((file) => !file.type.startsWith('image/'))) {
            showMessage('Sélectionnez uniquement des fichiers image.');
            return;
        }
        const transfer = new DataTransfer();
        [...photoInput.files, ...incomingFiles].forEach((file) => transfer.items.add(file));
        photoInput.files = transfer.files;
        renderNewPhotoPreviews();
    }

    function renderNewPhotoPreviews() {
        photoPreviews.replaceChildren();
        [...photoInput.files].forEach((file, index) => {
            const preview = document.createElement('div');
            const image = document.createElement('img');
            const remove = document.createElement('button');
            preview.className = 'house-edit-new-photo';
            image.src = URL.createObjectURL(file);
            image.alt = file.name;
            image.onload = () => URL.revokeObjectURL(image.src);
            remove.type = 'button';
            remove.textContent = '×';
            remove.setAttribute('aria-label', `Retirer ${file.name}`);
            remove.addEventListener('click', () => {
                const transfer = new DataTransfer();
                [...photoInput.files].forEach((selectedFile, selectedIndex) => {
                    if (selectedIndex !== index) transfer.items.add(selectedFile);
                });
                photoInput.files = transfer.files;
                renderNewPhotoPreviews();
            });
            preview.append(image, remove);
            photoPreviews.append(preview);
        });
        uploadZone.classList.toggle('has-files', photoInput.files.length > 0);
    }

    photoInput.addEventListener('change', renderNewPhotoPreviews);
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
    uploadZone.addEventListener('drop', (event) => appendDroppedFiles(event.dataTransfer.files));

    photoDialog.querySelector('[data-photo-close]').addEventListener('click', () => photoDialog.close());
    photoDialog.querySelectorAll('[data-photo-step]').forEach((button) => {
        button.addEventListener('click', () => openPhoto(activePhotoIndex + Number(button.dataset.photoStep)));
    });
    photoDialog.addEventListener('click', (event) => {
        if (event.target === photoDialog) photoDialog.close();
    });
    photoDialog.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft') openPhoto(activePhotoIndex - 1);
        if (event.key === 'ArrowRight') openPhoto(activePhotoIndex + 1);
    });

    async function loadHouse() {
        if (!token || localStorage.getItem('goying_role') !== 'maisons') {
            clearSession();
            return;
        }
        try {
            const response = await fetch(`/api/maisons/${encodeURIComponent(houseId)}`, { headers, cache: 'no-store' });
            const house = await response.json();
            if (response.status === 401 || response.status === 403) {
                clearSession();
                return;
            }
            if (!response.ok) throw new Error(house.detail || 'Impossible de charger la maison');
            ['commune', 'quartier', 'avenue', 'titre', 'type_maison', 'description',
                'informations_complementaires', 'chambres', 'superficie', 'salles_bains',
                'prix', 'type', 'telephone'].forEach((name) => {
                const field = form.elements.namedItem(name);
                if (field && name === 'commune') {
                    window.KinshasaCommunes.setSavedValue(field, house[name]);
                } else if (field) {
                    field.value = house[name] ?? '';
                }
            });
            (house.informations_personnalisees || []).forEach(addInformation);
            updateFieldsForPropertyType();
            const photoUrls = house.photo_urls || (house.photo_url ? [house.photo_url] : []);
            existingPhotos = (Array.isArray(photoUrls) ? photoUrls : [])
                .filter((url) => typeof url === 'string' && url.trim());
            renderExistingPhotos();
        } catch (error) {
            showMessage(error.message || 'Impossible de charger la maison.');
            submitButton.disabled = true;
        }
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submitButton.disabled = true;
        submitButton.classList.add('is-saving');
        submitButton.textContent = 'Enregistrement…';
        document.getElementById('informations_personnalisees').value = JSON.stringify(
            [...form.querySelectorAll('.custom-information-row')].map((row) => ({
                nom: row.querySelector('.custom-information-label').value.trim(),
                valeur: row.querySelector('.custom-information-value').value.trim(),
            })).filter((item) => item.nom || item.valeur)
        );
        try {
            const response = await fetch(`/api/maisons/${encodeURIComponent(houseId)}`, {
                method: 'PUT', headers, body: new FormData(form),
            });
            const payload = await response.json();
            if (response.status === 401 || response.status === 403) {
                clearSession();
                return;
            }
            if (!response.ok) throw new Error(payload.detail || 'Impossible de modifier la maison');
            showMessage(payload.message || 'Maison modifiée avec succès.', 'success');
            setTimeout(() => { window.location.href = '/maisons'; }, 900);
        } catch (error) {
            showMessage(error.message || 'Impossible de modifier la maison.');
            submitButton.disabled = false;
            submitButton.classList.remove('is-saving');
            submitButton.innerHTML = '<span aria-hidden="true">▣</span> Enregistrer les modifications';
        }
    });

    loadHouse();
});
