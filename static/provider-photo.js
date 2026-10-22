(() => {
    const MAX_PHOTO_SIZE = 10 * 1024 * 1024;

    window.initializeProviderPhotoEditor = (root) => {
        const input = root.querySelector('[data-provider-photo-input]');
        const preview = root.querySelector('[data-provider-photo-preview]');
        const placeholder = root.querySelector('[data-provider-photo-placeholder]');
        const removeButton = root.querySelector('[data-provider-photo-remove]');
        const error = root.querySelector('[data-provider-photo-error]');
        let selectedFile = null;
        let currentUrl = '';
        let objectUrl = '';

        function showPhoto(url) {
            preview.onerror = () => {
                preview.hidden = true;
                placeholder.hidden = false;
            };
            if (url) {
                preview.src = url;
                preview.hidden = false;
                placeholder.hidden = true;
            } else {
                preview.removeAttribute('src');
                preview.hidden = true;
                placeholder.hidden = false;
            }
        }

        function clearSelection(clearError = true) {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            objectUrl = '';
            selectedFile = null;
            input.value = '';
            removeButton.hidden = true;
            if (clearError) error.textContent = '';
            showPhoto(currentUrl);
        }

        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            error.textContent = '';
            if (!file) {
                clearSelection();
                return;
            }
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                error.textContent = 'Choisissez une image JPEG, PNG ou WebP.';
                clearSelection(false);
                return;
            }
            if (file.size === 0) {
                error.textContent = 'Le fichier image est vide.';
                clearSelection(false);
                return;
            }
            if (file.size > MAX_PHOTO_SIZE) {
                error.textContent = 'La photo dépasse la taille maximale autorisée de 10 Mo.';
                clearSelection(false);
                return;
            }
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            selectedFile = file;
            objectUrl = URL.createObjectURL(file);
            removeButton.hidden = false;
            showPhoto(objectUrl);
        });
        removeButton.addEventListener('click', clearSelection);

        return {
            setCurrentPhoto(url) {
                currentUrl = typeof url === 'string' ? url : '';
                if (!selectedFile) showPhoto(currentUrl);
            },
            hasSelection() {
                return Boolean(selectedFile);
            },
            readDataUrl() {
                if (!selectedFile) return Promise.resolve(null);
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.addEventListener('load', () => {
                        if (typeof reader.result !== 'string') {
                            reject(new Error("L'image sélectionnée n'a pas pu être lue."));
                            return;
                        }
                        resolve(reader.result);
                    });
                    reader.addEventListener('error', () => {
                        reject(new Error("Impossible de lire l'image sélectionnée."));
                    });
                    reader.readAsDataURL(selectedFile);
                });
            },
            reset() {
                clearSelection();
                currentUrl = '';
                showPhoto('');
            },
        };
    };
})();
