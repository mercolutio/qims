import './style.css';
import { SaveMessung, CheckConnection, GetDropdowns, GetActiveFormular, GetNokIDs, GetPruefplan, GetDurchfuehrungen, MarkGebracht } from '../wailsjs/go/main/App';
import { renderDynamicForm } from './form-renderer.js';

let selectedPruefzweck = '';
let selectedNokId = '';
let selectedBatchNr = '';
let selectedMitarbeiter = '';
let selectedPruefplanEntry = null;
let activeFlowDef = null; // cached flow definition

function getCurrentSchicht() {
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 14) return { name: 'Frühschicht', start: '06:00', end: '14:00' };
    if (hour >= 14 && hour < 22) return { name: 'Spätschicht', start: '14:00', end: '22:00' };
    return { name: 'Nachtschicht', start: '22:00', end: '06:00' };
}

function getTodayDate() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `${day}.${month}.${year}`;
}

// Suppress default context menu
document.addEventListener('contextmenu', (e) => e.preventDefault());

// Base layout
document.querySelector('#app').innerHTML = `
<header class="app-header">
    <span class="logo-text">QIMS</span>
    <span class="header-divider"></span>
    <span class="header-subtitle">Messung Erfassung</span>
</header>
<div class="main-content" id="formContent">
    <p style="text-align:center;color:#999;padding:40px;">Laden...</p>
</div>
<div class="status-bar" id="statusBar">Verbinde mit Server...</div>
`;

// ===== STEP 1: Prüfzweck Auswahl =====
async function renderStep1() {
    // Load active flow definition if not cached
    if (!activeFlowDef) {
        try {
            const result = await GetActiveFormular();
            if (result && result !== 'null' && result !== '') {
                const f = JSON.parse(result);
                if (f && f.definition) {
                    const def = JSON.parse(f.definition);
                    if (def.pruefzwecke) activeFlowDef = def;
                }
            }
        } catch {}
    }

    // Use flow definition or fallback
    const pruefzwecke = activeFlowDef?.pruefzwecke || [
        { id: 'erstteilabnahme', name: 'Erstteilabnahme', icon: '1', description: 'Prüfung des ersten produzierten Teils', steps: [] },
        { id: 'einstellteil', name: 'Einstellteil', icon: 'E', description: 'Prüfung nach Maschineneinstellung', steps: [] },
        { id: 'sonderpruefung', name: 'Sonderprüfung', icon: 'S', description: 'Außerplanmäßige Sonderprüfung', steps: [] },
    ];

    document.getElementById('formContent').innerHTML = `
    <div class="step-container">
        <div class="step-header">
            <div class="step-indicator">
                <span class="step-dot active">1</span>
                <span class="step-line"></span>
                <span class="step-dot">2</span>
            </div>
            <h2 class="step-title">Prüfzweck wählen</h2>
            <p class="step-subtitle">Welche Art von Messung möchten Sie durchführen?</p>
        </div>
        <div class="step-buttons">
            ${pruefzwecke.map(pz => `
                <button class="step-choice-btn" data-value="${pz.name}" data-idx="${pruefzwecke.indexOf(pz)}">
                    <span class="step-choice-icon">${pz.icon || '?'}</span>
                    <div>
                        <div class="step-choice-title">${pz.name}</div>
                        <div class="step-choice-desc">${pz.description || ''}</div>
                    </div>
                </button>
            `).join('')}
        </div>
    </div>`;

    const pzList = activeFlowDef?.pruefzwecke || [];

    document.querySelectorAll('.step-choice-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedPruefzweck = btn.dataset.value;
            selectedNokId = '';
            selectedBatchNr = '';
            selectedMitarbeiter = '';
            selectedPruefplanEntry = null;

            const pzIdx = parseInt(btn.dataset.idx);
            const pzDef = pzList[pzIdx];

            if (pzDef && pzDef.steps && pzDef.steps.length > 0) {
                // Dynamic: execute steps from flow definition
                executeFlowSteps(pzDef, 0);
            } else {
                // Fallback to hardcoded
                if (selectedPruefzweck === 'Erstteilabnahme') renderStepPruefplan();
                else if (selectedPruefzweck === 'Einstellteil') renderStepNokId();
                else renderStep2();
            }
        });
    });
}

// ===== DYNAMIC FLOW STEP EXECUTOR =====
let currentPZDef = null;
let currentStepIdx = 0;
let collectedData = {};

async function executeFlowSteps(pzDef, stepIdx) {
    currentPZDef = pzDef;
    currentStepIdx = stepIdx;

    if (stepIdx >= pzDef.steps.length) {
        // All steps done — if last step has save_directly, we already saved
        // Otherwise show success and go back
        renderStep1();
        return;
    }

    const step = pzDef.steps[stepIdx];

    switch (step.type) {
        case 'pruefplan':
            renderStepPruefplan();
            break;
        case 'input_fields':
            renderDynamicInputStep(step);
            break;
        case 'form':
            renderDynamicFormStep(step);
            break;
        default:
            executeFlowSteps(pzDef, stepIdx + 1);
    }
}

function renderDynamicInputStep(step) {
    const pz = currentPZDef;
    const totalSteps = pz.steps.length + 1;
    const currentNum = currentStepIdx + 2;

    document.getElementById('formContent').innerHTML = `
    <div class="step-container">
        <div class="step-header">
            <div class="step-indicator">
                <span class="step-dot done">&#10003;</span>
                <span class="step-line done"></span>
                <span class="step-dot active">${currentNum}</span>
            </div>
            <div class="step-header-row">
                <button class="step-back" id="btnBack">&#8592; Zurück</button>
                <div>
                    <h2 class="step-title">${step.title || selectedPruefzweck}</h2>
                    <p class="step-subtitle">${selectedPruefzweck}</p>
                </div>
            </div>
        </div>
        <div class="step-nok-input">
            ${(step.fields || []).map(f => {
                if (f.type === 'autocomplete') {
                    return `<div class="form-group" style="position:relative;">
                        <label>${f.required ? '* ' : ''}${f.label}</label>
                        <input type="text" id="dynfield-${f.field_key}" placeholder="${f.placeholder || f.label + '...'}" autocomplete="off" />
                        <div class="autocomplete-list" id="suggest-${f.field_key}"></div>
                    </div>`;
                }
                return `<div class="form-group">
                    <label>${f.required ? '* ' : ''}${f.label}</label>
                    <input type="text" id="dynfield-${f.field_key}" placeholder="${f.placeholder || f.label + '...'}" />
                </div>`;
            }).join('')}
            <button class="btn btn-submit" type="button" id="btnDynSubmit">${step.save_directly ? 'Fertig' : 'Weiter'}</button>
        </div>
    </div>`;

    document.getElementById('btnBack').addEventListener('click', () => {
        if (currentStepIdx > 0) executeFlowSteps(pz, currentStepIdx - 1);
        else renderStep1();
    });

    // Load autocomplete for NOK-ID fields
    (step.fields || []).filter(f => f.type === 'autocomplete').forEach(async f => {
        let ids = [];
        try { ids = JSON.parse(await GetNokIDs()) || []; } catch {}
        const input = document.getElementById('dynfield-' + f.field_key);
        const suggList = document.getElementById('suggest-' + f.field_key);
        if (!input || !suggList) return;
        input.addEventListener('input', () => {
            const val = input.value.trim().toLowerCase();
            if (!val || ids.length === 0) { suggList.style.display = 'none'; return; }
            const matches = ids.filter(id => id.toLowerCase().includes(val)).slice(0, 8);
            if (matches.length === 0) { suggList.style.display = 'none'; return; }
            suggList.innerHTML = matches.map(m => `<div class="autocomplete-item">${m}</div>`).join('');
            suggList.style.display = 'block';
            suggList.querySelectorAll('.autocomplete-item').forEach(item => {
                item.addEventListener('mousedown', (e) => { e.preventDefault(); input.value = item.textContent; suggList.style.display = 'none'; });
            });
        });
        input.addEventListener('blur', () => { setTimeout(() => { suggList.style.display = 'none'; }, 150); });
    });

    document.getElementById('btnDynSubmit').addEventListener('click', async () => {
        // Validate required fields
        const fields = step.fields || [];
        document.querySelectorAll('.field-error').forEach(e => e.classList.remove('field-error'));
        const missing = [];

        for (const f of fields) {
            if (f.type === 'label') continue;
            const el = document.getElementById('dynfield-' + f.field_key);
            const val = el ? el.value.trim() : '';
            collectedData[f.field_key] = val;
            if (f.required && !val) {
                missing.push(f.label);
                if (el) el.closest('.form-group')?.classList.add('field-error');
            }
        }

        if (missing.length > 0) {
            showToast('Bitte alle Pflichtfelder ausfüllen', 'error');
            return;
        }

        if (step.save_directly) {
            // Merge auto_values and save
            const messung = { ...collectedData, ...(step.auto_values || {}), datum: getTodayDate() };
            const result = await SaveMessung(messung);
            if (result === 'OK') {
                showToast('Erfolgreich gespeichert!', 'success');
                collectedData = {};
                setTimeout(() => renderStep1(), 1500);
            } else {
                showToast(result, 'error');
            }
        } else {
            executeFlowSteps(currentPZDef, currentStepIdx + 1);
        }
    });
}

async function renderDynamicFormStep(step) {
    const pz = currentPZDef;
    const totalSteps = pz.steps.length + 1;
    const currentNum = currentStepIdx + 2;

    document.getElementById('formContent').innerHTML = `
    <div class="step-container">
        <div class="step-header">
            <div class="step-indicator">
                <span class="step-dot done">&#10003;</span>
                <span class="step-line done"></span>
                <span class="step-dot active">${currentNum}</span>
            </div>
            <div class="step-header-row">
                <button class="step-back" id="btnBack">&#8592; Zurück</button>
                <div>
                    <h2 class="step-title">${selectedPruefzweck}</h2>
                    <p class="step-subtitle">${step.title || 'Messdaten erfassen'}</p>
                </div>
            </div>
        </div>
        <div id="dynFormContent"></div>
    </div>`;

    document.getElementById('btnBack').addEventListener('click', () => {
        if (currentStepIdx > 0) executeFlowSteps(pz, currentStepIdx - 1);
        else renderStep1();
    });

    const container = document.getElementById('dynFormContent');
    let html = '<div class="messung-fieldset">';

    for (const row of (step.rows || [])) {
        html += '<div class="form-row">';
        for (const el of row.elements) {
            const flexClass = el.flex === 3 ? 'flex-3' : el.flex === 2 ? 'flex-2' : 'flex-1';
            const reqMark = el.required ? '* ' : '';
            const prefillVal = collectedData[el.field_key] || '';
            const isReadonly = prefillVal ? 'readonly' : '';

            if (el.type === 'textbox') {
                html += `<div class="form-group ${flexClass}"><label>${reqMark}${el.label}</label>
                    <input type="text" id="dynfield-${el.field_key}" value="${prefillVal}" ${isReadonly} placeholder="${el.placeholder || ''}" /></div>`;
            } else if (el.type === 'dropdown') {
                html += `<div class="form-group ${flexClass}"><label>${reqMark}${el.label}</label>
                    <select id="dynfield-${el.field_key}" data-kategorie="${el.dropdown_kategorie || ''}"><option value=""></option></select></div>`;
            } else if (el.type === 'datefield') {
                html += `<div class="form-group ${flexClass}"><label>${reqMark}${el.label}</label>
                    <input type="text" id="dynfield-${el.field_key}" value="${el.default_today ? getTodayDate() : ''}" /></div>`;
            } else if (el.type === 'radiogroup') {
                html += `<div class="radio-group" style="flex:${el.flex || 1}">
                    <div class="radio-group-label">${reqMark}${el.label}</div>
                    <div class="radio-group-options">
                    ${(el.options || []).map(opt => `<label><input type="radio" name="dynradio-${el.field_key}" value="${opt}" /> ${opt}</label>`).join('')}
                    </div></div>`;
            } else if (el.type === 'label') {
                html += `<div class="form-group ${flexClass}"><span style="font-size:13px;color:#333;padding-top:20px;">${el.text || ''}</span></div>`;
            }
        }
        html += '</div>';
    }

    html += `<div class="form-row bottom-row">
        <button class="btn btn-help" type="button">?</button>
        <button class="btn btn-submit" type="button" id="btnDynFormSubmit">Fertig</button>
        <span class="pflichtfeld-hint">* = Pflichtfeld</span>
    </div></div>`;

    container.innerHTML = html;

    // Load dropdowns
    for (const select of container.querySelectorAll('select[data-kategorie]')) {
        const kat = select.dataset.kategorie;
        if (!kat) continue;
        try {
            const result = await GetDropdowns(kat);
            const optionen = JSON.parse(result);
            if (Array.isArray(optionen)) {
                for (const o of optionen) {
                    const opt = document.createElement('option');
                    opt.value = o.wert;
                    opt.textContent = o.wert;
                    select.appendChild(opt);
                }
            }
        } catch {}
    }

    // Prefill from prüfplan if available
    if (selectedPruefplanEntry) {
        const pp = selectedPruefplanEntry;
        const prefillMap = { fertigungsbereich: pp.fertigungsbereich, abteilung_zsb: pp.abteilung, station: pp.station, pruefart: pp.pruefart };
        for (const [key, val] of Object.entries(prefillMap)) {
            if (!val) continue;
            const el = document.getElementById('dynfield-' + key);
            if (!el) continue;
            if (el.tagName === 'SELECT') {
                const exists = [...el.options].some(o => o.value === val);
                if (!exists) { const opt = document.createElement('option'); opt.value = val; opt.textContent = val; el.appendChild(opt); }
            }
            el.value = val;
        }
    }

    // Submit
    document.getElementById('btnDynFormSubmit').onclick = async () => {
        document.querySelectorAll('.field-error').forEach(e => e.classList.remove('field-error'));
        const allFields = (step.rows || []).flatMap(r => r.elements).filter(e => e.type !== 'label');
        const missing = [];
        const formData = { ...collectedData };

        for (const f of allFields) {
            let val = '';
            if (f.type === 'radiogroup') {
                const checked = document.querySelector(`input[name="dynradio-${f.field_key}"]:checked`);
                val = checked ? checked.value : '';
            } else {
                const el = document.getElementById('dynfield-' + f.field_key);
                val = el ? el.value.trim() : '';
            }
            formData[f.field_key] = val;
            if (f.required && !val) {
                missing.push(f.label);
                const el = document.getElementById('dynfield-' + f.field_key);
                if (el) el.closest('.form-group')?.classList.add('field-error');
            }
        }

        if (missing.length > 0) {
            showToast('Bitte alle Pflichtfelder ausfüllen', 'error');
            return;
        }

        // Merge auto_values
        const messung = { ...formData, ...(step.auto_values || {}) };

        const result = await SaveMessung(messung);
        let messungId = null;
        try {
            const parsed = JSON.parse(result);
            if (parsed.id) messungId = parsed.id;
            else if (parsed.ID) messungId = parsed.ID;
        } catch {}

        if (result.startsWith('Fehler')) {
            showToast(result, 'error');
            return;
        }

        // Link to Durchführung if a Prüfplan entry was selected
        if (selectedPruefplanEntry && messungId) {
            const gebrachtVon = formData.name || '';
            // Find the matching Durchführung
            try {
                const dfResult = await GetDurchfuehrungen('offen', '');
                const dfs = JSON.parse(dfResult) || [];
                const matching = dfs.find(d => d.pruefplan_id === selectedPruefplanEntry.id);
                if (matching) {
                    await MarkGebracht(matching.id, messungId, gebrachtVon);
                }
            } catch {}
        }

        showToast('Messung erfolgreich gespeichert!', 'success');
        collectedData = {};
        setTimeout(() => renderStep1(), 1500);
    };
}

// ===== STEP PRÜFPLAN (nur bei Erstteilabnahme) =====
async function renderStepPruefplan() {
    const schicht = getCurrentSchicht();

    document.getElementById('formContent').innerHTML = `
    <div class="step-container">
        <div class="step-header">
            <div class="step-indicator">
                <span class="step-dot done">&#10003;</span>
                <span class="step-line done"></span>
                <span class="step-dot active">2</span>
                <span class="step-line"></span>
                <span class="step-dot">3</span>
            </div>
            <div class="step-header-row">
                <button class="step-back" id="btnBack">&#8592; Zurück</button>
                <div>
                    <h2 class="step-title">Prüfplan - ${schicht.name}</h2>
                    <p class="step-subtitle">${schicht.start} - ${schicht.end} Uhr | Wählen Sie die durchzuführende Prüfung</p>
                </div>
            </div>
        </div>
        <div id="pruefplanList" class="step-pruefplan-list">
            <p style="text-align:center;color:#999;padding:20px;">Laden...</p>
        </div>
    </div>`;

    document.getElementById('btnBack').addEventListener('click', renderStep1);

    // Load Prüfplan
    let entries = [];
    try {
        const result = await GetPruefplan();
        entries = JSON.parse(result) || [];
    } catch {}

    // Filter: nur aktive und jetzt fällige (Datum + Uhrzeit)
    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().getHours().toString().padStart(2,'0') + ':' + new Date().getMinutes().toString().padStart(2,'0');
    const faellige = entries.filter(e => {
        if (!e.aktiv) return false;
        if (!e.naechste_faelligkeit) return true;
        if (e.naechste_faelligkeit < today) return true; // überfällig
        if (e.naechste_faelligkeit === today) {
            const ziel = e.ziel_uhrzeit || '00:00';
            return nowTime >= ziel; // nur wenn Ziel-Uhrzeit erreicht
        }
        return false;
    });

    const container = document.getElementById('pruefplanList');

    if (faellige.length === 0) {
        container.innerHTML = `
            <div class="step-empty">
                <p>Keine fälligen Prüfungen für die ${schicht.name}</p>
                <button class="btn btn-submit" id="btnSkipPlan" type="button">Trotzdem fortfahren</button>
            </div>`;
        document.getElementById('btnSkipPlan').addEventListener('click', () => {
            if (currentPZDef) executeFlowSteps(currentPZDef, currentStepIdx + 1);
            else renderStep2();
        });
        return;
    }

    container.innerHTML = faellige.map(e => {
        const haeufigkeiten = {
            pro_schicht: 'Pro Schicht', taeglich: 'Täglich', woechentlich: 'Wöchentlich',
            monatlich: 'Monatlich', quartal: 'Quartalsweise', jaehrlich: 'Jährlich'
        };
        const hLabel = haeufigkeiten[e.haeufigkeit] || e.haeufigkeit;
        const zielUhr = e.ziel_uhrzeit || '';
        const isOverdue = e.naechste_faelligkeit && e.naechste_faelligkeit < today;

        return `
        <button class="step-pruefplan-item ${isOverdue ? 'overdue' : ''}" data-id="${e.id}">
            <div class="pp-item-main">
                <div class="pp-item-title">${e.bezeichnung || 'Unbenannt'}</div>
                <div class="pp-item-details">
                    ${e.fertigungsbereich ? `<span>${e.fertigungsbereich}</span>` : ''}
                    ${e.abteilung ? `<span>${e.abteilung}</span>` : ''}
                    ${e.station ? `<span>Station ${e.station}</span>` : ''}
                    ${e.pruefart ? `<span>${e.pruefart}</span>` : ''}
                </div>
            </div>
            <div class="pp-item-meta">
                <span class="pp-item-freq">${hLabel}${zielUhr ? ' | ' + zielUhr + ' Uhr' : ''}</span>
                ${isOverdue ? '<span class="pp-item-overdue">Überfällig</span>' : ''}
            </div>
        </button>`;
    }).join('');

    container.querySelectorAll('.step-pruefplan-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = parseInt(btn.dataset.id);
            selectedPruefplanEntry = faellige.find(e => e.id === id);
            // Continue with next step in flow
            if (currentPZDef) {
                executeFlowSteps(currentPZDef, currentStepIdx + 1);
            } else {
                renderStep2();
            }
        });
    });
}

// ===== STEP NOK-ID (nur bei Einstellteil) =====
async function renderStepNokId() {
    document.getElementById('formContent').innerHTML = `
    <div class="step-container">
        <div class="step-header">
            <div class="step-indicator">
                <span class="step-dot done">&#10003;</span>
                <span class="step-line done"></span>
                <span class="step-dot active">2</span>
            </div>
            <div class="step-header-row">
                <button class="step-back" id="btnBack">&#8592; Zurück</button>
                <div>
                    <h2 class="step-title">Einstellteil-Daten</h2>
                    <p class="step-subtitle">Bitte NOK-ID, Batch-Nr. und Name angeben</p>
                </div>
            </div>
        </div>
        <div class="step-nok-input">
            <div class="form-group" style="position:relative;">
                <label>* NOK-ID</label>
                <input type="text" id="nokIdInput" placeholder="NOK-ID eingeben..." autocomplete="off" autofocus />
                <div class="autocomplete-list" id="nokSuggestions"></div>
            </div>
            <div class="form-group">
                <label>* Batch-Nr./Tagesstempel</label>
                <input type="text" id="batchInput" placeholder="Batch-Nr. eingeben..." />
            </div>
            <div class="form-group">
                <label>* Name Mitarbeiter</label>
                <input type="text" id="mitarbeiterInput" placeholder="Name eingeben..." />
            </div>
            <div class="form-group">
                <label>* Einstellmaßnahme</label>
                <input type="text" id="einstellmassnahmeInput" placeholder="Einstellmaßnahme eingeben..." />
            </div>
            <button class="btn btn-submit" type="button" id="btnNokWeiter">Fertig</button>
        </div>
    </div>`;

    document.getElementById('btnBack').addEventListener('click', renderStep1);

    // Load existing NOK-IDs for autocomplete
    let nokIds = [];
    try {
        const result = await GetNokIDs();
        nokIds = JSON.parse(result) || [];
    } catch {}

    const input = document.getElementById('nokIdInput');
    const suggList = document.getElementById('nokSuggestions');
    input.focus();

    input.addEventListener('input', () => {
        const val = input.value.trim().toLowerCase();
        if (!val || nokIds.length === 0) {
            suggList.style.display = 'none';
            return;
        }
        const matches = nokIds.filter(id => id.toLowerCase().includes(val)).slice(0, 8);
        if (matches.length === 0) {
            suggList.style.display = 'none';
            return;
        }
        suggList.innerHTML = matches.map(m =>
            `<div class="autocomplete-item">${m}</div>`
        ).join('');
        suggList.style.display = 'block';

        suggList.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = item.textContent;
                suggList.style.display = 'none';
            });
        });
    });

    input.addEventListener('blur', () => {
        setTimeout(() => { suggList.style.display = 'none'; }, 150);
    });

    const weiter = () => {
        // Clear previous errors
        document.querySelectorAll('.field-error').forEach(e => e.classList.remove('field-error'));

        const nokVal = document.getElementById('nokIdInput').value.trim();
        const batchVal = document.getElementById('batchInput').value.trim();
        const nameVal = document.getElementById('mitarbeiterInput').value.trim();

        const missing = [];
        const emVal = document.getElementById('einstellmassnahmeInput').value;

        if (!nokVal) { missing.push('NOK-ID'); document.getElementById('nokIdInput').closest('.form-group').classList.add('field-error'); }
        if (!batchVal) { missing.push('Batch-Nr.'); document.getElementById('batchInput').closest('.form-group').classList.add('field-error'); }
        if (!nameVal) { missing.push('Name'); document.getElementById('mitarbeiterInput').closest('.form-group').classList.add('field-error'); }
        if (!emVal) { missing.push('Einstellmaßnahme'); document.getElementById('einstellmassnahmeInput').closest('.form-group').classList.add('field-error'); }

        if (missing.length > 0) {
            showToast('Bitte alle Felder ausfüllen', 'error');
            return;
        }

        selectedNokId = nokVal;
        selectedBatchNr = batchVal;
        selectedMitarbeiter = nameVal;

        // Direkt speichern — kein weiteres Formular nötig
        const messung = {
            datum: getTodayDate(),
            pruefzweck: selectedPruefzweck,
            nok_id: nokVal,
            batch_nr: batchVal,
            name: nameVal,
            fertigungsbereich: '',
            abteilung_zsb: '',
            abteilung_uzsb: '',
            station: '',
            pruefart: '',
            einstellmassnahme: emVal,
            bemerkungen: '',
            messung_planmaessig: 'ja',
            ausgeschleust: 'nein',
        };

        SaveMessung(messung).then((result) => {
            if (result === 'OK') {
                showToast('Einstellteil erfolgreich gespeichert!', 'success');
                setTimeout(() => renderStep1(), 1500);
            } else {
                showToast(result, 'error');
            }
        });
    };

    document.getElementById('btnNokWeiter').addEventListener('click', weiter);
    document.getElementById('nokIdInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') weiter();
    });
}

// ===== STEP 2: Messformular =====
function renderStep2() {
    const isEinstellteil = selectedPruefzweck === 'Einstellteil';
    const lastStep = isEinstellteil ? '3' : '2';

    document.getElementById('formContent').innerHTML = `
    <div class="step-container">
        <div class="step-header">
            <div class="step-indicator">
                <span class="step-dot done">&#10003;</span>
                <span class="step-line done"></span>
                ${isEinstellteil ? '<span class="step-dot done">&#10003;</span><span class="step-line done"></span>' : ''}
                <span class="step-dot active">${lastStep}</span>
            </div>
            <div class="step-header-row">
                <button class="step-back" id="btnBack">&#8592; Zurück</button>
                <div>
                    <h2 class="step-title">${selectedPruefzweck}${selectedNokId ? ' - ' + selectedNokId : ''}</h2>
                    <p class="step-subtitle">Messdaten erfassen</p>
                </div>
            </div>
        </div>
        <div id="messFormular"></div>
    </div>`;

    document.getElementById('btnBack').addEventListener('click', () => {
        if (isEinstellteil) renderStepNokId();
        else if (selectedPruefzweck === 'Erstteilabnahme') renderStepPruefplan();
        else renderStep1();
    });
    renderMessFormular();
}

async function renderMessFormular() {
    const isEinstellteil = selectedPruefzweck === 'Einstellteil';
    const container = document.getElementById('messFormular');
    container.innerHTML = `
    <div class="messung-fieldset">
        <div class="form-row">
            <div class="form-group flex-1">
                <label>* Datum</label>
                <input type="text" id="datum" value="${getTodayDate()}" />
            </div>
            <div class="form-group flex-2">
                <label>* Fertigungsbereich</label>
                <select id="fertigungsbereich"><option value=""></option></select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group flex-1">
                <label>* Abteilung (ZSB)</label>
                <select id="abteilungZSB"><option value=""></option></select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group flex-1">
                <label>* Abteilung (UZSB/HF-Teil)</label>
                <select id="abteilungUZSB"><option value=""></option></select>
            </div>
        </div>
        ${isEinstellteil ? `
            <input type="hidden" id="name" value="${selectedMitarbeiter}" />
            <input type="hidden" id="batchNr" value="${selectedBatchNr}" />
        ` : `
        <div class="form-row">
            <div class="form-group flex-2">
                <label>* Name</label>
                <input type="text" id="name" />
            </div>
            <div class="form-group flex-2">
                <label>Batch-Nr./Tagesstempel</label>
                <input type="text" id="batchNr" />
            </div>
        </div>
        `}
        <div class="form-row">
            <div class="form-group flex-small">
                <label>* Station</label>
                <select id="station"><option value=""></option></select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group flex-1">
                <label>* Prüfart</label>
                <select id="pruefart"><option value=""></option></select>
            </div>
            ${selectedPruefzweck !== 'Erstteilabnahme' ? `
            <div class="form-group flex-1">
                <label>* Einstellmaßnahme</label>
                <select id="einstellmassnahme"><option value=""></option></select>
            </div>
            ` : '<input type="hidden" id="einstellmassnahme" value="" />'}
        </div>
        ${selectedPruefzweck === 'Einstellteil' ? `
            <input type="hidden" id="nokId" value="${selectedNokId}" />
        ` : selectedPruefzweck === 'Erstteilabnahme' ? `
            <input type="hidden" id="nokId" value="" />
        ` : `
        <div class="form-row">
            <div class="form-group flex-1">
                <label>* NOK-ID</label>
                <input type="text" id="nokId" />
            </div>
        </div>
        `}
        <div class="form-row">
            <div class="form-group flex-1">
                <label>Bemerkungen/Eingestellte Schweißnähte</label>
                <input type="text" id="bemerkungen" />
            </div>
        </div>
        <div class="form-row radio-row">
            ${selectedPruefzweck === 'Erstteilabnahme' ? `
                <input type="hidden" name="planmaessig" value="ja" />
            ` : `
            <div class="radio-group" style="flex:1">
                <div class="radio-group-label">* Messung Planmäßig?</div>
                <div class="radio-group-options">
                    <label><input type="radio" name="planmaessig" value="ja" /> Ja</label>
                    <label><input type="radio" name="planmaessig" value="nein" /> Nein</label>
                </div>
            </div>
            `}
            <div class="radio-group" style="flex:1">
                <div class="radio-group-label">* Ausgeschleustes Bauteil?</div>
                <div class="radio-group-options">
                    <label><input type="radio" name="ausgeschleust" value="ja" /> Ja</label>
                    <label><input type="radio" name="ausgeschleust" value="nein" /> Nein</label>
                </div>
            </div>
        </div>
        <div class="form-row bottom-row">
            <button class="btn btn-help" type="button">?</button>
            <button class="btn btn-submit" type="button" id="btnFertig">Fertig</button>
            <span class="pflichtfeld-hint">* = Pflichtfeld</span>
        </div>
    </div>`;

    await loadDropdowns();

    // Prüfplan-Daten vorausfüllen wenn vorhanden
    if (selectedPruefplanEntry) {
        const pp = selectedPruefplanEntry;
        const prefill = [
            { id: 'fertigungsbereich', val: pp.fertigungsbereich },
            { id: 'abteilungZSB', val: pp.abteilung },
            { id: 'station', val: pp.station },
            { id: 'pruefart', val: pp.pruefart },
        ];
        for (const { id, val } of prefill) {
            if (!val) continue;
            const el = document.getElementById(id);
            if (!el) continue;
            // Add option if it doesn't exist in dropdown
            if (el.tagName === 'SELECT') {
                const exists = [...el.options].some(o => o.value === val);
                if (!exists) {
                    const opt = document.createElement('option');
                    opt.value = val;
                    opt.textContent = val;
                    el.appendChild(opt);
                }
            }
            el.value = val;
        }
    }

    bindFormEvents();
}

function bindFormEvents() {
    document.getElementById('btnFertig').onclick = () => {
        const isErstteil = selectedPruefzweck === 'Erstteilabnahme';
        const pflichtfelder = [
            { id: 'datum', label: 'Datum' },
            { id: 'fertigungsbereich', label: 'Fertigungsbereich' },
            { id: 'abteilungZSB', label: 'Abteilung (ZSB)' },
            { id: 'abteilungUZSB', label: 'Abteilung (UZSB/HF-Teil)' },
            { id: 'name', label: 'Name' },
            { id: 'station', label: 'Station' },
            { id: 'pruefart', label: 'Prüfart' },
            ...(!isErstteil ? [{ id: 'einstellmassnahme', label: 'Einstellmaßnahme' }] : []),
        ];

        // Clear previous errors
        document.querySelectorAll('.field-error').forEach(e => e.classList.remove('field-error'));

        const missing = [];
        for (const feld of pflichtfelder) {
            const el = document.getElementById(feld.id);
            if (!el.value || el.value.trim() === '') {
                missing.push(feld.label);
                if (el.closest('.form-group')) el.closest('.form-group').classList.add('field-error');
            }
        }

        const planmaessigHidden = document.querySelector('input[type="hidden"][name="planmaessig"]');
        const planmaessig = planmaessigHidden || document.querySelector('input[name="planmaessig"]:checked');
        if (!planmaessig) {
            missing.push('Messung Planmäßig?');
        }
        const ausgeschleust = document.querySelector('input[name="ausgeschleust"]:checked');
        if (!ausgeschleust) {
            missing.push('Ausgeschleustes Bauteil?');
        }

        if (missing.length > 0) {
            showToast('Bitte füllen Sie alle Pflichtfelder aus', 'error');
            const firstErr = document.querySelector('.field-error');
            if (firstErr) firstErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        const messung = {
            datum: document.getElementById('datum').value,
            fertigungsbereich: document.getElementById('fertigungsbereich').value,
            abteilung_zsb: document.getElementById('abteilungZSB').value,
            abteilung_uzsb: document.getElementById('abteilungUZSB').value,
            name: document.getElementById('name').value,
            batch_nr: document.getElementById('batchNr').value,
            station: document.getElementById('station').value,
            pruefzweck: selectedPruefzweck,
            pruefart: document.getElementById('pruefart').value,
            einstellmassnahme: document.getElementById('einstellmassnahme').value,
            nok_id: document.getElementById('nokId').value,
            bemerkungen: document.getElementById('bemerkungen').value,
            messung_planmaessig: planmaessig.value,
            ausgeschleust: ausgeschleust.value,
        };

        SaveMessung(messung).then((result) => {
            if (result === 'OK') {
                showToast('Messung erfolgreich gespeichert!', 'success');
                // Reset and go back to step 1 after delay
                setTimeout(() => renderStep1(), 1500);
            } else {
                showToast(result, 'error');
            }
        });
    };
}

function showToast(message, type) {
    document.querySelectorAll('.toast-message').forEach(t => t.remove());
    const toast = document.createElement('div');
    toast.className = `toast-message toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

async function loadDropdowns() {
    const dropdownMap = {
        'fertigungsbereich': 'fertigungsbereich',
        'abteilung_zsb': 'abteilungZSB',
        'abteilung_uzsb': 'abteilungUZSB',
        'station': 'station',
        'pruefart': 'pruefart',
        'einstellmassnahme': 'einstellmassnahme',
    };

    for (const [kategorie, elementId] of Object.entries(dropdownMap)) {
        try {
            const result = await GetDropdowns(kategorie);
            const optionen = JSON.parse(result);
            const select = document.getElementById(elementId);
            if (select && Array.isArray(optionen)) {
                optionen.forEach(o => {
                    const option = document.createElement('option');
                    option.value = o.wert;
                    option.textContent = o.wert;
                    select.appendChild(option);
                });
            }
        } catch { /* ignore */ }
    }
}

// Init
CheckConnection().then(async (result) => {
    const bar = document.getElementById('statusBar');
    if (result === 'OK') {
        bar.textContent = 'Verbunden mit Server';
        bar.classList.add('connected');
        renderStep1();
    } else {
        bar.textContent = result;
        bar.classList.add('disconnected');
        renderStep1();
    }
});
