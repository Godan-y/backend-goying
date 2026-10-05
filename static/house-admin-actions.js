document.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('.delete-house-button');
    if (!button) return;

    const houseId = button.dataset.maisonId;
    if (!houseId || !window.confirm('Supprimer définitivement cette maison ?')) return;

    const token = localStorage.getItem('goying_access_token');
    if (!token || localStorage.getItem('goying_role') !== 'maisons') {
        clearHouseAdminSession();
        window.location.href = '/';
        window.alert('Votre session immobilière a expiré. Veuillez vous reconnecter.');
        return;
    }

    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const originalText = button.innerHTML;
    button.innerHTML = '<span aria-hidden="true">↻</span> Suppression…';
    try {
        const response = await fetch(`/api/maisons/${encodeURIComponent(houseId)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                clearHouseAdminSession();
                window.location.href = '/';
                throw new Error('Votre session immobilière a expiré. Veuillez vous reconnecter.');
            }
            const detail = payload.detail;
            const message = typeof detail === 'object' ? detail.message : detail;
            throw new Error(message || 'Impossible de supprimer la maison');
        }
        const card = button.closest('.maison');
        if (card) card.remove();
        updateHouseCount();
        const notice = document.getElementById('taken-houses-notice');
        if (notice) {
            notice.hidden = false;
            notice.className = 'taken-houses-notice is-success';
            notice.textContent = payload.message || 'Maison supprimée.';
        }
    } catch (error) {
        window.alert(error.message);
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.innerHTML = originalText;
    }
});

function clearHouseAdminSession() {
    localStorage.removeItem('goying_access_token');
    localStorage.removeItem('goying_role');
}

function updateHouseCount() {
    const counter = document.getElementById('compteur-maisons');
    const list = document.querySelector('#liste-maisons-disponibles, #liste-maisons-prises');
    if (!counter || !list) return;

    const count = list.querySelectorAll('.maison').length;
    const isTakenList = list.id === 'liste-maisons-prises';
    const plural = count === 1 ? '' : 's';
    counter.textContent = String(count);
    counter.setAttribute(
        'aria-label',
        isTakenList
            ? `${count} maison${plural} vendue${plural} / louée${plural}`
            : `${count} maison${plural} disponible${plural}`,
    );
    const label = document.getElementById('available-houses-count-label');
    if (label && !isTakenList) {
        label.textContent = `${count} maison${count === 1 ? '' : 's'} disponible${count === 1 ? '' : 's'}`;
    }
    const takenLabel = document.getElementById('taken-houses-count-label');
    if (takenLabel && isTakenList) {
        takenLabel.textContent = `${count} maison${count === 1 ? '' : 's'} vendue${count === 1 ? '' : 's'} / louée${count === 1 ? '' : 's'}`;
    }
    if (count === 0 && list.id === 'liste-maisons-disponibles') {
        list.innerHTML = '<div class="available-houses-empty"><span aria-hidden="true">⌂</span><h2>Aucune maison disponible</h2><p>Aucune maison n’est actuellement disponible sur la plateforme.</p><a href="/maisons/ajouter">＋ Ajouter une maison</a></div>';
    }
    if (count === 0 && isTakenList) {
        list.innerHTML = '<div class="taken-houses-empty"><span aria-hidden="true">⌂</span><h2>Aucune maison vendue ou louée</h2><p>Aucune maison n’est actuellement présente dans l’historique.</p><a href="/maisons/disponibles">Voir les maisons disponibles</a></div>';
    }
}
