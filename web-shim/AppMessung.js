// Web shim for Messung app — replaces Wails Go bindings with fetch API calls
const API = '/api';

async function apiGet(path) {
    const res = await fetch(API + path);
    return await res.text();
}

async function apiPost(path, body) {
    const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    return await res.text();
}

// Messungen
export function SaveMessung(m) {
    return apiPost('/messungen', JSON.stringify(m));
}

export function SaveMessungDynamic(formId, datenJSON) {
    return apiPost('/messungen', JSON.stringify({ form_id: formId, daten: JSON.parse(datenJSON) }));
}

// Dropdowns
export function GetDropdowns(kategorie) { return apiGet('/dropdowns?kategorie=' + kategorie); }

// Formulare
export function GetActiveFormular() { return apiGet('/formulare/active'); }

// Prüfplan
export function GetPruefplan() { return apiGet('/pruefplan'); }

// Durchführungen
export function GetDurchfuehrungen(status, datum) {
    let params = [];
    if (status) params.push('status=' + status);
    if (datum) params.push('datum=' + datum);
    return apiGet('/durchfuehrungen' + (params.length ? '?' + params.join('&') : ''));
}

export function MarkGebracht(durchfuehrungID, messungID, gebrachtVon) {
    return apiPost('/durchfuehrungen/' + durchfuehrungID + '/gebracht', JSON.stringify({ messung_id: messungID, gebracht_von: gebrachtVon })).then(() => 'OK');
}

// NOK-IDs
export function GetNokIDs() {
    return apiPost('/db/query', JSON.stringify({ query: "SELECT DISTINCT nok_id FROM messungen WHERE nok_id != '' ORDER BY nok_id" }))
        .then(r => {
            try {
                const d = JSON.parse(r);
                return JSON.stringify((d.rows || []).map(row => row[0]).filter(v => v));
            } catch { return '[]'; }
        });
}

// Connection
export function CheckConnection() { return apiGet('/health').then(() => 'OK').catch(() => 'Fehler'); }
