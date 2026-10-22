(() => {
    const communes = [
        'Bandalungwa',
        'Barumbu',
        'Bumbu',
        'Gombe',
        'Kalamu',
        'Kasa-Vubu',
        'Kimbanseke',
        'Kinshasa',
        'Kintambo',
        'Kisenso',
        'Lemba',
        'Limete',
        'Lingwala',
        'Makala',
        'Maluku',
        'Masina',
        'Matete',
        'Mont-Ngafula',
        "N'Djili",
        'Ngaba',
        'Ngaliema',
        'Ngiri-Ngiri',
        "N'Sele",
        'Selembao',
    ];

    function initializeCommuneSelects() {
        document.querySelectorAll('select[data-kinshasa-commune]').forEach((select) => {
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = 'Sélectionnez votre commune';
            select.replaceChildren(placeholder);

            communes.forEach((commune) => {
                const option = document.createElement('option');
                option.value = commune;
                option.textContent = commune;
                select.append(option);
            });
        });
    }

    function setSavedValue(select, value) {
        const savedValue = String(value ?? '').trim();
        if (!savedValue) {
            select.value = '';
            return;
        }

        let option = Array.from(select.options).find((item) => item.value === savedValue);
        if (!option) {
            option = document.createElement('option');
            option.value = savedValue;
            option.textContent = `${savedValue} (valeur existante)`;
            select.append(option);
        }
        select.value = savedValue;
    }

    initializeCommuneSelects();
    window.KinshasaCommunes = { values: communes, setSavedValue };
})();
