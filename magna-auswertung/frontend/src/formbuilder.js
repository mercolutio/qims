import './formbuilder.css';
import { GetFormulare, GetFormular, GetActiveFormular, SaveFormular, UpdateFormular, ActivateFormular, DeleteFormular, GetDropdowns, AddDropdown, DeleteDropdown } from '../wailsjs/go/main/App';

let flowDef = { pruefzwecke: [] };
let formId = null;
let formName = 'Neuer Flow';
let selectedPZ = null;       // selected Pruefzweck index
let selectedStep = null;     // selected step id
let selectedField = null;    // selected field id (within a step)

const stepTypes = [
    { type: 'pruefplan', label: 'Prüfplan', icon: 'P', color: '#1565c0' },
    { type: 'input_fields', label: 'Eingabefelder', icon: 'E', color: '#ef6c00' },
    { type: 'form', label: 'Messformular', icon: 'F', color: '#2e7d32' },
];

const fieldTypes = [
    { type: 'textbox', label: 'Textfeld', icon: 'T' },
    { type: 'dropdown', label: 'Dropdown', icon: 'D' },
    { type: 'radiogroup', label: 'Radio-Gruppe', icon: 'R' },
    { type: 'datefield', label: 'Datumsfeld', icon: '#' },
    { type: 'label', label: 'Label', icon: 'L' },
    { type: 'autocomplete', label: 'Autocomplete', icon: 'A' },
];

const pruefzweckIcons = ['1', '2', '3', '4', '5', 'E', 'S', 'W', 'K', 'N'];

function generateId(prefix = 'el') {
    return prefix + '-' + Math.random().toString(36).substring(2, 9);
}

function createDefaultStep(type) {
    const base = { id: generateId('step'), type };
    switch (type) {
        case 'pruefplan':
            return { ...base, title: 'Prüfplan wählen', prefill_from_plan: true };
        case 'input_fields':
            return { ...base, title: 'Eingabe', fields: [], save_directly: false, auto_values: {} };
        case 'form':
            return { ...base, title: 'Messdaten erfassen', rows: [], auto_values: {} };
        default:
            return base;
    }
}

function createDefaultField(type) {
    const base = { id: generateId('el'), type, flex: 1 };
    switch (type) {
        case 'textbox':
            return { ...base, field_key: '', label: 'Neues Textfeld', required: false, placeholder: '' };
        case 'dropdown':
            return { ...base, field_key: '', label: 'Neues Dropdown', required: false, dropdown_kategorie: '' };
        case 'radiogroup':
            return { ...base, field_key: '', label: 'Neue Radio-Gruppe', required: false, options: ['ja', 'nein'] };
        case 'datefield':
            return { ...base, field_key: 'datum', label: 'Datum', required: true, default_today: true };
        case 'label':
            return { ...base, text: 'Label-Text' };
        case 'autocomplete':
            return { ...base, field_key: '', label: 'Autocomplete', required: false, dropdown_kategorie: '' };
        default:
            return base;
    }
}

// ===== HELPERS =====

function getCurrentPZ() {
    if (selectedPZ === null || !flowDef.pruefzwecke[selectedPZ]) return null;
    return flowDef.pruefzwecke[selectedPZ];
}

function findStepById(id) {
    const pz = getCurrentPZ();
    if (!pz) return null;
    return pz.steps.find(s => s.id === id) || null;
}

function findFieldById(id) {
    const step = findStepById(selectedStep);
    if (!step) return null;
    if (step.type === 'form') {
        for (const row of (step.rows || [])) {
            const f = row.elements.find(e => e.id === id);
            if (f) return f;
        }
    } else if (step.type === 'input_fields') {
        return (step.fields || []).find(f => f.id === id) || null;
    }
    return null;
}

function getStepIcon(type) {
    const st = stepTypes.find(s => s.type === type);
    return st ? st.icon : '?';
}

function getStepColor(type) {
    const st = stepTypes.find(s => s.type === type);
    return st ? st.color : '#666';
}

function getStepTypeName(type) {
    const st = stepTypes.find(s => s.type === type);
    return st ? st.label : type;
}

function getFieldCount(step) {
    if (step.type === 'form') return (step.rows || []).reduce((n, r) => n + r.elements.length, 0);
    if (step.type === 'input_fields') return (step.fields || []).length;
    return 0;
}

// ===== RENDER =====

export function renderFormBuilderTab() {
    const content = document.getElementById('tabContent');
    content.innerHTML = `
        <div class="fd-layout">
            <div class="fd-sidebar" id="fdSidebar"></div>
            <div class="fd-canvas-wrapper">
                <div class="fd-toolbar">
                    <input type="text" id="fdFormName" value="${formName}" placeholder="Flow-Name..." />
                    <div class="fd-toolbar-btns">
                        <button class="btn btn-primary" id="fdSave">Speichern</button>
                        <button class="btn" id="fdLoad">Laden</button>
                        <button class="btn" id="fdNew">Neu</button>
                        <button class="btn btn-activate" id="fdActivate">Aktivieren</button>
                    </div>
                </div>
                <div class="fd-canvas" id="fdCanvas"></div>
            </div>
            <div class="fd-properties" id="fdProperties">
                <div class="fd-prop-empty">Nichts ausgewählt</div>
            </div>
        </div>
    `;

    renderSidebar();
    renderCanvas();
    bindToolbarEvents();

    document.getElementById('fdFormName').addEventListener('input', (e) => { formName = e.target.value; });

    if (!formId && flowDef.pruefzwecke.length === 0) loadActiveFlow();
}

async function loadActiveFlow() {
    try {
        const result = await GetActiveFormular();
        if (result && result !== 'null' && result !== '') {
            const f = JSON.parse(result);
            if (f && f.definition) {
                formId = f.id;
                formName = f.name;
                const def = JSON.parse(f.definition);
                flowDef = def.pruefzwecke ? def : { pruefzwecke: [] };
                selectedPZ = flowDef.pruefzwecke.length > 0 ? 0 : null;
                selectedStep = null;
                selectedField = null;
                document.getElementById('fdFormName').value = formName;
                renderSidebar();
                renderCanvas();
                renderProperties();
            }
        }
    } catch { /* ignore */ }
}

// ===== SIDEBAR (Prüfzwecke) =====

function renderSidebar() {
    const sb = document.getElementById('fdSidebar');
    let html = '<h3>Prüfzwecke</h3>';

    flowDef.pruefzwecke.forEach((pz, idx) => {
        const isSelected = selectedPZ === idx;
        html += `
            <div class="fd-pz-item ${isSelected ? 'selected' : ''}" data-idx="${idx}">
                <span class="fd-pz-icon">${pz.icon || '?'}</span>
                <div class="fd-pz-info">
                    <div class="fd-pz-name">${pz.name}</div>
                    <div class="fd-pz-steps">${pz.steps.length} Schritte</div>
                </div>
                ${isSelected ? '<button class="fd-pz-delete" data-idx="' + idx + '">&#10005;</button>' : ''}
            </div>
        `;
    });

    html += `<button class="fd-add-pz" id="fdAddPZ">+ Prüfzweck</button>`;
    sb.innerHTML = html;

    sb.querySelectorAll('.fd-pz-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('fd-pz-delete')) return;
            selectedPZ = parseInt(item.dataset.idx);
            selectedStep = null;
            selectedField = null;
            renderSidebar();
            renderCanvas();
            renderProperties();
        });
    });

    sb.querySelectorAll('.fd-pz-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.idx);
            flowDef.pruefzwecke.splice(idx, 1);
            if (selectedPZ >= flowDef.pruefzwecke.length) selectedPZ = flowDef.pruefzwecke.length > 0 ? 0 : null;
            selectedStep = null;
            selectedField = null;
            renderSidebar();
            renderCanvas();
            renderProperties();
        });
    });

    document.getElementById('fdAddPZ')?.addEventListener('click', () => {
        const pz = {
            id: generateId('pz'),
            name: 'Neuer Prüfzweck',
            icon: pruefzweckIcons[flowDef.pruefzwecke.length % pruefzweckIcons.length],
            description: '',
            steps: []
        };
        flowDef.pruefzwecke.push(pz);
        selectedPZ = flowDef.pruefzwecke.length - 1;
        selectedStep = null;
        selectedField = null;
        renderSidebar();
        renderCanvas();
        renderProperties();
    });
}

// ===== CANVAS (Steps) =====

function renderCanvas() {
    const canvas = document.getElementById('fdCanvas');
    const pz = getCurrentPZ();

    if (!pz) {
        canvas.innerHTML = '<div class="fd-empty">Prüfzweck auswählen oder erstellen</div>';
        return;
    }

    let html = '';

    if (pz.steps.length === 0) {
        html += `<div class="fd-empty">Keine Schritte vorhanden</div>`;
    } else {
        pz.steps.forEach((step, idx) => {
            const isSelected = selectedStep === step.id;
            const color = getStepColor(step.type);
            const count = getFieldCount(step);

            html += `
                <div class="fd-step ${isSelected ? 'selected' : ''}" data-id="${step.id}">
                    <div class="fd-step-header" style="border-left: 4px solid ${color};">
                        <span class="fd-step-icon" style="background:${color};">${getStepIcon(step.type)}</span>
                        <div class="fd-step-info">
                            <div class="fd-step-type">${getStepTypeName(step.type)}</div>
                            <div class="fd-step-title">${step.title || ''}</div>
                        </div>
                        <div class="fd-step-meta">${count > 0 ? count + ' Felder' : ''}</div>
                    </div>
                    <button class="fd-step-delete" data-id="${step.id}">&#10005;</button>
                </div>
            `;

            // Connector + add button
            html += `
                <div class="fd-connector">
                    <div class="fd-connector-line"></div>
                    <button class="fd-add-step-btn" data-after="${idx}" title="Schritt einfügen">+</button>
                    <div class="fd-connector-line"></div>
                    ${idx < pz.steps.length - 1 ? '<div class="fd-connector-arrow"></div>' : ''}
                </div>
            `;
        });
    }

    // Final add button
    html += `<button class="fd-add-step-final" id="fdAddStepEnd">+ Schritt hinzufügen</button>`;

    canvas.innerHTML = html;
    bindCanvasEvents();
}

function bindCanvasEvents() {
    document.querySelectorAll('.fd-step').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.classList.contains('fd-step-delete')) return;
            selectedStep = el.dataset.id;
            selectedField = null;
            renderCanvas();
            renderProperties();
        });
    });

    document.querySelectorAll('.fd-step-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const pz = getCurrentPZ();
            if (!pz) return;
            pz.steps = pz.steps.filter(s => s.id !== btn.dataset.id);
            if (selectedStep === btn.dataset.id) { selectedStep = null; selectedField = null; }
            renderCanvas();
            renderProperties();
        });
    });

    document.querySelectorAll('.fd-add-step-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            showStepTypeMenu(btn, parseInt(btn.dataset.after));
        });
    });

    document.getElementById('fdAddStepEnd')?.addEventListener('click', (e) => {
        const pz = getCurrentPZ();
        if (!pz) return;
        showStepTypeMenu(e.target, pz.steps.length - 1);
    });
}

function showStepTypeMenu(anchor, afterIdx) {
    document.querySelectorAll('.fd-type-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'fd-type-menu';
    menu.innerHTML = stepTypes.map(st => `
        <div class="fd-type-menu-item" data-type="${st.type}">
            <span class="fd-type-menu-icon" style="background:${st.color}">${st.icon}</span>
            <span>${st.label}</span>
        </div>
    `).join('');

    anchor.parentElement.style.position = 'relative';
    anchor.parentElement.appendChild(menu);

    menu.querySelectorAll('.fd-type-menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const pz = getCurrentPZ();
            if (!pz) return;
            const step = createDefaultStep(item.dataset.type);
            pz.steps.splice(afterIdx + 1, 0, step);
            selectedStep = step.id;
            selectedField = null;
            menu.remove();
            renderCanvas();
            renderProperties();
        });
    });

    setTimeout(() => {
        document.addEventListener('click', function handler(e) {
            if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', handler); }
        });
    }, 10);
}

// ===== PROPERTIES PANEL =====

function renderProperties() {
    const panel = document.getElementById('fdProperties');

    // Field selected
    if (selectedField) {
        const field = findFieldById(selectedField);
        if (field) { renderFieldProperties(panel, field); return; }
    }

    // Step selected
    if (selectedStep) {
        const step = findStepById(selectedStep);
        if (step) { renderStepProperties(panel, step); return; }
    }

    // Prüfzweck selected
    const pz = getCurrentPZ();
    if (pz) { renderPZProperties(panel, pz); return; }

    panel.innerHTML = '<div class="fd-prop-empty">Nichts ausgewählt</div>';
}

// --- Prüfzweck Properties ---

function renderPZProperties(panel, pz) {
    panel.innerHTML = `
        <h3>Prüfzweck</h3>
        <div class="fd-prop-group"><label>Name</label><input type="text" id="fpPZName" value="${pz.name}" /></div>
        <div class="fd-prop-group"><label>Icon</label>
            <div class="fd-icon-picker">${pruefzweckIcons.map(i =>
                `<span class="fd-icon-opt ${pz.icon === i ? 'selected' : ''}" data-icon="${i}">${i}</span>`
            ).join('')}</div>
        </div>
        <div class="fd-prop-group"><label>Beschreibung</label><textarea id="fpPZDesc">${pz.description || ''}</textarea></div>
        <div class="fd-prop-group"><label>ID</label><input type="text" value="${pz.id}" disabled /></div>
    `;

    document.getElementById('fpPZName')?.addEventListener('input', (e) => {
        pz.name = e.target.value;
        renderSidebar();
    });
    document.getElementById('fpPZDesc')?.addEventListener('input', (e) => { pz.description = e.target.value; });

    panel.querySelectorAll('.fd-icon-opt').forEach(opt => {
        opt.addEventListener('click', () => {
            pz.icon = opt.dataset.icon;
            renderSidebar();
            renderProperties();
        });
    });
}

// --- Step Properties ---

function renderStepProperties(panel, step) {
    let html = `<h3>${getStepTypeName(step.type)}</h3>`;
    html += `<div class="fd-prop-group"><label>Titel</label><input type="text" id="fpStepTitle" value="${step.title || ''}" /></div>`;

    if (step.type === 'pruefplan') {
        html += `<div class="fd-prop-group"><div class="checkbox-row"><input type="checkbox" id="fpPrefill" ${step.prefill_from_plan ? 'checked' : ''} /><span>Aus Prüfplan vorbelegen</span></div></div>`;
    }

    if (step.type === 'input_fields') {
        html += `<div class="fd-prop-group"><div class="checkbox-row"><input type="checkbox" id="fpSaveDirect" ${step.save_directly ? 'checked' : ''} /><span>Direkt speichern</span></div></div>`;
        html += renderFieldList(step.fields || [], 'fields');
        html += renderFieldToolbox();
    }

    if (step.type === 'form') {
        html += renderFormRows(step);
        html += renderFieldToolbox();
    }

    if (step.type === 'input_fields' || step.type === 'form') {
        html += `<div class="fd-prop-group fd-auto-values">
            <label>Auto-Werte (JSON)</label>
            <textarea id="fpAutoValues">${JSON.stringify(step.auto_values || {}, null, 2)}</textarea>
        </div>`;
    }

    html += `<button class="fd-prop-delete" id="fpDeleteStep">Schritt entfernen</button>`;
    panel.innerHTML = html;
    bindStepPropertyEvents(step);
}

function renderFieldList(fields, listType) {
    let html = '<div class="fd-field-list">';
    if (fields.length === 0) {
        html += '<div class="fd-field-empty">Keine Felder</div>';
    } else {
        fields.forEach(f => {
            const isSelected = selectedField === f.id;
            html += `
                <div class="fd-field-item ${isSelected ? 'selected' : ''}" data-id="${f.id}" data-list="${listType}">
                    <span class="fd-field-type-badge">${(fieldTypes.find(ft => ft.type === f.type) || {}).icon || '?'}</span>
                    <span class="fd-field-label">${f.label || f.text || f.field_key || 'Feld'}</span>
                    <button class="fd-field-remove" data-id="${f.id}" data-list="${listType}">&#10005;</button>
                </div>
            `;
        });
    }
    html += '</div>';
    return html;
}

function renderFormRows(step) {
    let html = '<div class="fd-form-rows">';
    (step.rows || []).forEach((row, rIdx) => {
        html += `<div class="fd-form-row-label">Zeile ${rIdx + 1} <button class="fd-row-remove" data-row="${rIdx}">&#10005;</button></div>`;
        html += renderFieldList(row.elements, 'row-' + rIdx);
    });
    html += `<button class="fd-add-row-btn" id="fpAddRow">+ Zeile</button>`;
    html += '</div>';
    return html;
}

function renderFieldToolbox() {
    return `<div class="fd-field-toolbox">
        <label>Feld hinzufügen</label>
        <div class="fd-field-toolbox-items">
            ${fieldTypes.map(ft => `
                <button class="fd-field-add-btn" data-type="${ft.type}" title="${ft.label}">
                    <span>${ft.icon}</span>
                </button>
            `).join('')}
        </div>
    </div>`;
}

function bindStepPropertyEvents(step) {
    const bind = (id, key, transform) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => { step[key] = transform ? transform(el.value) : el.value; renderCanvas(); });
    };
    const bindCheck = (id, key) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', () => { step[key] = el.checked; });
    };

    bind('fpStepTitle', 'title');
    bindCheck('fpPrefill', 'prefill_from_plan');
    bindCheck('fpSaveDirect', 'save_directly');

    document.getElementById('fpAutoValues')?.addEventListener('input', (e) => {
        try { step.auto_values = JSON.parse(e.target.value); } catch { /* ignore parse errors while typing */ }
    });

    // Field items click
    document.querySelectorAll('.fd-field-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('fd-field-remove')) return;
            selectedField = item.dataset.id;
            renderProperties();
        });
    });

    // Field remove
    document.querySelectorAll('.fd-field-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const fid = btn.dataset.id;
            const list = btn.dataset.list;
            if (list === 'fields') {
                step.fields = (step.fields || []).filter(f => f.id !== fid);
            } else if (list.startsWith('row-')) {
                const rIdx = parseInt(list.split('-')[1]);
                if (step.rows[rIdx]) {
                    step.rows[rIdx].elements = step.rows[rIdx].elements.filter(f => f.id !== fid);
                    if (step.rows[rIdx].elements.length === 0) step.rows.splice(rIdx, 1);
                }
            }
            if (selectedField === fid) selectedField = null;
            renderCanvas();
            renderProperties();
        });
    });

    // Field toolbox add buttons
    document.querySelectorAll('.fd-field-add-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const field = createDefaultField(btn.dataset.type);
            if (step.type === 'input_fields') {
                if (!step.fields) step.fields = [];
                step.fields.push(field);
            } else if (step.type === 'form') {
                if (!step.rows) step.rows = [];
                if (step.rows.length === 0) step.rows.push({ id: generateId('row'), elements: [] });
                step.rows[step.rows.length - 1].elements.push(field);
            }
            selectedField = field.id;
            renderCanvas();
            renderProperties();
        });
    });

    // Add row (form type)
    document.getElementById('fpAddRow')?.addEventListener('click', () => {
        if (!step.rows) step.rows = [];
        step.rows.push({ id: generateId('row'), elements: [] });
        renderProperties();
    });

    // Remove row
    document.querySelectorAll('.fd-row-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const rIdx = parseInt(btn.dataset.row);
            step.rows.splice(rIdx, 1);
            selectedField = null;
            renderCanvas();
            renderProperties();
        });
    });

    // Delete step
    document.getElementById('fpDeleteStep')?.addEventListener('click', () => {
        const pz = getCurrentPZ();
        if (!pz) return;
        pz.steps = pz.steps.filter(s => s.id !== step.id);
        selectedStep = null;
        selectedField = null;
        renderCanvas();
        renderProperties();
    });
}

// --- Field Properties ---

function renderFieldProperties(panel, field) {
    const typeName = (fieldTypes.find(ft => ft.type === field.type) || {}).label || field.type;
    let html = `<h3>Feld: ${typeName}</h3>`;
    html += `<button class="fd-prop-back" id="fpBackToStep">&#8592; Zurück zum Schritt</button>`;

    html += `<div class="fd-prop-group"><label>Typ</label><input type="text" value="${typeName}" disabled /></div>`;

    if (field.type === 'label') {
        html += `<div class="fd-prop-group"><label>Text</label><input type="text" id="fpText" value="${field.text || ''}" /></div>`;
    } else {
        html += `<div class="fd-prop-group"><label>Label</label><input type="text" id="fpLabel" value="${field.label || ''}" /></div>`;
        html += `<div class="fd-prop-group"><label>Feld-Key (DB)</label><input type="text" id="fpFieldKey" value="${field.field_key || ''}" /></div>`;
        html += `<div class="fd-prop-group"><div class="checkbox-row"><input type="checkbox" id="fpRequired" ${field.required ? 'checked' : ''} /><span>Pflichtfeld</span></div></div>`;
    }

    html += `<div class="fd-prop-group"><label>Breite (Flex)</label>
        <select id="fpFlex">
            <option value="1" ${field.flex === 1 ? 'selected' : ''}>1 (schmal)</option>
            <option value="2" ${field.flex === 2 ? 'selected' : ''}>2 (mittel)</option>
            <option value="3" ${field.flex === 3 ? 'selected' : ''}>3 (breit)</option>
        </select></div>`;

    if (field.type === 'textbox') {
        html += `<div class="fd-prop-group"><label>Placeholder</label><input type="text" id="fpPlaceholder" value="${field.placeholder || ''}" /></div>`;
    }

    if (field.type === 'dropdown' || field.type === 'autocomplete') {
        html += `<div class="fd-prop-group"><label>Dropdown-Kategorie</label><input type="text" id="fpKategorie" value="${field.dropdown_kategorie || ''}" /></div>`;
        html += `<div class="fd-prop-group">
            <label>Dropdown-Werte</label>
            <div class="fd-dropdown-values" id="fpDropdownValues"><p class="loading">Laden...</p></div>
            <div class="fd-dropdown-add">
                <input type="text" id="fpNewDropdownValue" placeholder="Neuer Wert..." />
                <button class="fd-btn-add-dd" id="fpAddDropdownValue">+</button>
            </div>
        </div>`;
    }

    if (field.type === 'radiogroup') {
        html += `<div class="fd-prop-group"><label>Optionen (kommagetrennt)</label><input type="text" id="fpOptions" value="${(field.options || []).join(', ')}" /></div>`;
    }

    if (field.type === 'datefield') {
        html += `<div class="fd-prop-group"><div class="checkbox-row"><input type="checkbox" id="fpDefaultToday" ${field.default_today ? 'checked' : ''} /><span>Heutiges Datum als Standard</span></div></div>`;
    }

    panel.innerHTML = html;
    bindFieldPropertyEvents(field);
}

function bindFieldPropertyEvents(field) {
    const bind = (id, key, transform) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => { field[key] = transform ? transform(el.value) : el.value; renderCanvas(); });
    };
    const bindCheck = (id, key) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', () => { field[key] = el.checked; });
    };

    bind('fpLabel', 'label');
    bind('fpText', 'text');
    bind('fpFieldKey', 'field_key');
    bind('fpPlaceholder', 'placeholder');
    bind('fpFlex', 'flex', v => parseInt(v));
    bind('fpOptions', 'options', v => v.split(',').map(s => s.trim()).filter(s => s));
    bindCheck('fpRequired', 'required');
    bindCheck('fpDefaultToday', 'default_today');

    // Dropdown kategorie
    const katInput = document.getElementById('fpKategorie');
    if (katInput) {
        katInput.addEventListener('input', () => {
            field.dropdown_kategorie = katInput.value;
            loadDropdownValues(katInput.value);
        });
        if (field.dropdown_kategorie) loadDropdownValues(field.dropdown_kategorie);
        else {
            const c = document.getElementById('fpDropdownValues');
            if (c) c.innerHTML = '<p class="empty">Kategorie eingeben</p>';
        }
    }

    document.getElementById('fpAddDropdownValue')?.addEventListener('click', () => addDropdownValue(field));
    document.getElementById('fpNewDropdownValue')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addDropdownValue(field);
    });

    document.getElementById('fpBackToStep')?.addEventListener('click', () => {
        selectedField = null;
        renderProperties();
    });
}

async function loadDropdownValues(kategorie) {
    const container = document.getElementById('fpDropdownValues');
    if (!container || !kategorie) { if (container) container.innerHTML = '<p class="empty">Kategorie eingeben</p>'; return; }
    container.innerHTML = '<p class="loading">Laden...</p>';
    try {
        const result = await GetDropdowns(kategorie);
        const values = JSON.parse(result);
        if (!Array.isArray(values) || values.length === 0) { container.innerHTML = '<p class="empty">Keine Werte</p>'; return; }
        container.innerHTML = values.map(v => `
            <div class="fd-dd-value"><span>${v.wert}</span><button class="fd-dd-del" data-id="${v.id}">&#10005;</button></div>
        `).join('');
        container.querySelectorAll('.fd-dd-del').forEach(btn => {
            btn.addEventListener('click', async () => { await DeleteDropdown(parseInt(btn.dataset.id)); loadDropdownValues(kategorie); });
        });
    } catch { container.innerHTML = '<p class="error">Fehler</p>'; }
}

async function addDropdownValue(field) {
    const input = document.getElementById('fpNewDropdownValue');
    if (!input) return;
    const wert = input.value.trim();
    if (!wert || !field.dropdown_kategorie) { if (!field.dropdown_kategorie) alert('Bitte Kategorie eingeben.'); return; }
    const result = await AddDropdown(field.dropdown_kategorie, wert, 0);
    if (result === 'OK') { input.value = ''; loadDropdownValues(field.dropdown_kategorie); } else alert(result);
}

// ===== TOOLBAR =====

function bindToolbarEvents() {
    document.getElementById('fdSave').addEventListener('click', saveFlow);
    document.getElementById('fdLoad').addEventListener('click', showFlowList);
    document.getElementById('fdNew').addEventListener('click', newFlow);
    document.getElementById('fdActivate').addEventListener('click', activateFlow);
}

async function saveFlow() {
    formName = document.getElementById('fdFormName').value || 'Unbenannt';
    const payload = JSON.stringify({
        name: formName,
        canvas_width: 700,
        canvas_height: 800,
        definition: JSON.stringify(flowDef),
    });

    let result;
    if (formId) { result = await UpdateFormular(formId, payload); }
    else { result = await SaveFormular(payload); }

    try {
        const parsed = JSON.parse(result);
        if (parsed.id) { formId = parsed.id; alert('Flow gespeichert!'); }
        else if (parsed.error) alert('Fehler: ' + parsed.error);
        else alert('Flow gespeichert!');
    } catch { alert(result); }
}

async function showFlowList() {
    const result = await GetFormulare();
    let formulare = [];
    try { formulare = JSON.parse(result); } catch { }

    const overlay = document.createElement('div');
    overlay.className = 'fb-form-list';
    overlay.innerHTML = `
        <div class="fb-form-list-content">
            <h3>Gespeicherte Flows</h3>
            ${formulare.length === 0 ? '<p>Keine Flows vorhanden.</p>' : ''}
            ${formulare.map(f => `
                <div class="fb-form-list-item" data-id="${f.id}">
                    <div>
                        <div class="name">${f.name}</div>
                        <div class="meta">v${f.version} | ${f.aktualisiert_am}</div>
                    </div>
                    ${f.active ? '<span class="active-badge">AKTIV</span>' : ''}
                </div>
            `).join('')}
            <button class="fb-form-list-close">Schließen</button>
        </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('.fb-form-list-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelectorAll('.fb-form-list-item').forEach(item => {
        item.addEventListener('click', async () => {
            const id = parseInt(item.dataset.id);
            try {
                const r = await GetFormular(id);
                const f = JSON.parse(r);
                formId = f.id;
                formName = f.name;
                const def = JSON.parse(f.definition);
                flowDef = def.pruefzwecke ? def : { pruefzwecke: [] };
                selectedPZ = flowDef.pruefzwecke.length > 0 ? 0 : null;
                selectedStep = null;
                selectedField = null;
                document.getElementById('fdFormName').value = formName;
                renderSidebar();
                renderCanvas();
                renderProperties();
            } catch (e) { alert('Fehler: ' + e.message); }
            overlay.remove();
        });
    });
}

function newFlow() {
    formId = null;
    formName = 'Neuer Flow';
    flowDef = { pruefzwecke: [] };
    selectedPZ = null;
    selectedStep = null;
    selectedField = null;
    document.getElementById('fdFormName').value = formName;
    renderSidebar();
    renderCanvas();
    renderProperties();
}

async function activateFlow() {
    if (!formId) { alert('Bitte zuerst speichern.'); return; }
    const result = await ActivateFormular(formId);
    if (result.includes('activated') || result === 'OK') {
        alert('Flow "' + formName + '" ist jetzt aktiv.');
    } else alert('Fehler: ' + result);
}
