window.normalizeWhatsappNumber = function normalizeWhatsappNumber(value, country) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const compact = raw.replace(/[\s().-]/g, '');
    const countryNormalized = String(country ?? '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    const isDrc = ['cd', 'cod', 'drc', 'rdc', 'republique democratique du congo'].includes(countryNormalized);

    if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact.slice(1);
    if (/^00[1-9]\d{7,14}$/.test(compact)) return compact.slice(2);
    if (/^243\d{9}$/.test(compact)) return compact;
    if (isDrc && /^0\d{9}$/.test(compact)) return `243${compact.slice(1)}`;
    if (isDrc && /^[1-9]\d{8}$/.test(compact)) return `243${compact}`;
    return '';
};
