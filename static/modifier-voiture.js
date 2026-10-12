document.addEventListener('DOMContentLoaded', async () => {
    const page = document.querySelector('[data-vehicle-edit-page]');
    const form = document.querySelector('#vehicle-edit-form');
    const status = document.querySelector('#form-status');
    const token = localStorage.getItem('goying_access_token');
    if (!page || !form || !token || localStorage.getItem('goying_role') !== 'voitures') {
        window.location.href = '/';
        return;
    }
    const id = page.dataset.vehicleId;
    try {
        const response = await fetch(`/api/voitures/details/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } });
        const vehicle = await response.json();
        if (!response.ok) throw new Error(vehicle.detail || 'Voiture introuvable');
        for (const name of ['brand', 'model', 'category', 'fuel', 'transmission', 'seats', 'currency', 'city']) form.elements[name].value = vehicle[name] || '';
        window.KinshasaCommunes.setSavedValue(form.elements.commune, vehicle.commune);
        form.elements.price_per_day.value = vehicle.pricePerDay ?? '';
        form.elements.features.value = (vehicle.features || []).join(', ');
        form.elements.is_available.checked = vehicle.isAvailable !== false;
    } catch (error) {
        status.className = 'form-message error';
        status.textContent = error.message;
        form.hidden = true;
    }
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const response = await fetch(`/api/voitures/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    brand: form.elements.brand.value, model: form.elements.model.value, category: form.elements.category.value,
                    fuel: form.elements.fuel.value, transmission: form.elements.transmission.value, seats: Number(form.elements.seats.value),
                    price_per_day: Number(form.elements.price_per_day.value), currency: form.elements.currency.value,
                    features: form.elements.features.value.split(','), is_available: form.elements.is_available.checked,
                    city: form.elements.city.value, commune: form.elements.commune.value,
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.detail || 'Impossible de modifier la voiture');
            if (form.elements.photos.files.length) {
                const photos = new FormData();
                for (const photo of form.elements.photos.files) photos.append('photos', photo);
                const photoResponse = await fetch(`/api/voitures/${encodeURIComponent(id)}/photos`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: photos });
                const photoPayload = await photoResponse.json();
                if (!photoResponse.ok) throw new Error(photoPayload.detail || 'Voiture modifiée, mais les photos n’ont pas été ajoutées');
            }
            window.location.href = '/voitures/liste';
        } catch (error) {
            status.className = 'form-message error';
            status.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    });
});
