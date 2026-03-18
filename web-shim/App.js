// Web shim for Auswertung app — replaces Wails Go bindings with fetch API calls
const API = '/api';

async function apiGet(path) {
    const res = await fetch(API + path);
    return await res.text();
}

async function apiPost(path, body) {
    const res = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    return await res.text();
}

async function apiPut(path, body) {
    const res = await fetch(API + path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    return await res.text();
}

async function apiDelete(path) {
    const res = await fetch(API + path, { method: 'DELETE' });
    return await res.text();
}

// Messungen
export function GetMessungen() { return apiGet('/messungen'); }
export function DeleteMessung(id) { return apiDelete('/messungen/' + id).then(() => 'OK'); }
export function ExportCSV() { return Promise.resolve('Fehler: CSV Export nur in Desktop-App verfügbar'); }

// Dropdowns
export function GetDropdowns(kategorie) { return apiGet('/dropdowns?kategorie=' + kategorie); }
export function AddDropdown(kategorie, wert, position) {
    return apiPost('/dropdowns', JSON.stringify({ kategorie, wert, position })).then(r => {
        try { const p = JSON.parse(r); return p.id ? 'OK' : r; } catch { return r; }
    });
}
export function DeleteDropdown(id) { return apiDelete('/dropdowns/' + id).then(() => 'OK'); }

// Formulare
export function GetFormulare() { return apiGet('/formulare'); }
export function GetFormular(id) { return apiGet('/formulare/' + id); }
export function GetActiveFormular() { return apiGet('/formulare/active'); }
export function SaveFormular(json) { return apiPost('/formulare', json); }
export function UpdateFormular(id, json) { return apiPut('/formulare/' + id, json); }
export function ActivateFormular(id) { return apiPost('/formulare/' + id + '/activate', '{}'); }
export function DeleteFormular(id) { return apiDelete('/formulare/' + id).then(() => 'OK'); }

// Workflows
export function GetWorkflows() { return apiGet('/workflows'); }
export function GetWorkflow(id) { return apiGet('/workflows/' + id); }
export function SaveWorkflow(json) { return apiPost('/workflows', json); }
export function UpdateWorkflow(id, json) { return apiPut('/workflows/' + id, json); }
export function DeleteWorkflow(id) { return apiDelete('/workflows/' + id).then(() => 'OK'); }

// Prüfplan
export function GetPruefplan() { return apiGet('/pruefplan'); }
export function SavePruefplanEntry(json) { return apiPost('/pruefplan', json); }
export function UpdatePruefplanEntry(id, json) { return apiPut('/pruefplan/' + id, json); }
export function DeletePruefplanEntry(id) { return apiDelete('/pruefplan/' + id).then(() => 'OK'); }

// Durchführungen
export function GetDurchfuehrungen(status, datum) {
    let params = [];
    if (status) params.push('status=' + status);
    if (datum) params.push('datum=' + datum);
    return apiGet('/durchfuehrungen' + (params.length ? '?' + params.join('&') : ''));
}

// Einstellungen
export function GetSetting(key) { return apiGet('/einstellungen/' + key); }
export function SaveSetting(key, value) { return apiPut('/einstellungen/' + key, JSON.stringify({ value })).then(() => 'OK'); }

// Database
export function GetDBTables() { return apiGet('/db/tables'); }
export function ExecuteSQL(query) { return apiPost('/db/query', JSON.stringify({ query })); }

// Connection
export function CheckConnection() { return apiGet('/health').then(() => 'OK').catch(() => 'Fehler'); }
