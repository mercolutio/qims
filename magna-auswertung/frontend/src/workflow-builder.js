import './workflow-builder.css';
import { GetWorkflows, GetWorkflow, SaveWorkflow, UpdateWorkflow, DeleteWorkflow, GetActiveFormular, ExecuteSQL } from '../wailsjs/go/main/App';

let workflow = { nodes: [] };
let workflowId = null;
let workflowName = 'Neuer Workflow';
let selectedNode = null;
let formFields = [];
let allWorkflows = [];
let selectedWfIdx = null;

const nodeTypes = [
    { type: 'trigger', label: 'Trigger', icon: 'T', color: 'trigger' },
    { type: 'email', label: 'E-Mail', icon: 'E', color: 'email' },
    { type: 'delay', label: 'Verzögerung', icon: 'Z', color: 'delay' },
    { type: 'condition', label: 'Bedingung', icon: '?', color: 'condition' },
    { type: 'set_value', label: 'Wert setzen', icon: 'W', color: 'setvalue' },
    { type: 'user_input', label: 'Benutzereingabe', icon: 'B', color: 'userinput' },
    { type: 'show_text', label: 'Text anzeigen', icon: 'i', color: 'showtext' },
];

const operators = [
    { value: 'equals', label: 'ist gleich' },
    { value: 'not_equals', label: 'ist nicht gleich' },
    { value: 'contains', label: 'enthält' },
    { value: 'not_empty', label: 'ist nicht leer' },
    { value: 'empty', label: 'ist leer' },
    { value: 'greater', label: 'größer als' },
    { value: 'less', label: 'kleiner als' },
];

function generateId() {
    return 'node-' + Math.random().toString(36).substring(2, 9);
}

function createDefaultNode(type) {
    const base = { id: generateId(), type };
    switch (type) {
        case 'trigger':
            return { ...base, label: 'Trigger', field: '', operator: 'equals', value: '', event: 'data_changed', schedule_type: 'interval', schedule_interval: 1, schedule_unit: 'hours', schedule_time: '08:00', schedule_day: 1, schedule_month_day: 1 };
        case 'email':
            return { ...base, label: 'E-Mail senden', to: '', subject: '', body: '', mode: 'smtp' };
        case 'delay':
            return { ...base, label: 'Verzögerung', duration: 1, unit: 'hours' };
        case 'condition':
            return { ...base, label: 'Bedingung', field: '', operator: 'equals', value: '', yes_nodes: [], no_nodes: [] };
        case 'set_value':
            return { ...base, label: 'Wert setzen', target_column: '', set_value: '' };
        case 'user_input':
            return { ...base, label: 'Benutzereingabe', target_column: '', prompt_text: 'Bitte Wert eingeben', input_type: 'text' };
        case 'show_text':
            return { ...base, label: 'Text anzeigen', display_text: '', display_type: 'info' };
        default:
            return base;
    }
}

// ===== LOAD FORM FIELDS =====
const labelMap = {
    id: 'ID', datum: 'Datum', fertigungsbereich: 'Fertigungsbereich',
    abteilung_zsb: 'Abteilung (ZSB)', abteilung_uzsb: 'Abteilung (UZSB/HF-Teil)',
    name: 'Name', batch_nr: 'Batch-Nr./Tagesstempel', station: 'Station',
    pruefzweck: 'Prüfzweck', pruefart: 'Prüfart',
    einstellmassnahme: 'Einstellmaßnahme', nok_id: 'NOK-ID',
    bemerkungen: 'Bemerkungen', messung_planmaessig: 'Messung Planmäßig?',
    ausgeschleust: 'Ausgeschleustes Bauteil?', erstellt_am: 'Erstellt am',
    messergebnis: 'Messergebnis',
};

async function loadFormFields() {
    try {
        // Load all columns from DB
        const result = await ExecuteSQL('PRAGMA table_info(messungen)');
        const parsed = JSON.parse(result);
        if (parsed.columns && parsed.rows) {
            formFields = parsed.rows
                .map(r => r[1]) // column name
                .filter(key => key !== 'id' && key !== 'form_id' && key !== 'daten_json')
                .map(key => ({ key, label: labelMap[key] || key }));
        }
    } catch {
        // Fallback to form definition
        try {
            const result = await GetActiveFormular();
            if (result && result !== 'null') {
                const f = JSON.parse(result);
                if (f && f.definition) {
                    const def = JSON.parse(f.definition);
                    formFields = def.rows.flatMap(r => r.elements)
                        .filter(el => el.type !== 'label' && el.field_key)
                        .map(el => ({ key: el.field_key, label: el.label }));
                }
            }
        } catch { /* ignore */ }
    }
}

// ===== RENDER =====
export async function renderWorkflowTab() {
    const content = document.getElementById('tabContent');
    content.innerHTML = `
        <div class="workflow-builder">
            <div class="wf-palette">
                <div class="wf-palette-panel">
                    <h3>Workflows</h3>
                    <div id="wfList"></div>
                    <button class="wf-add-wf-btn" id="wfNew">+ Neuer Workflow</button>
                </div>
                <div class="wf-palette-panel">
                    <h3>Aktionen</h3>
                    <div id="wfPaletteItems"></div>
                </div>
            </div>
            <div class="wf-canvas-wrapper">
                <div class="wf-canvas-header">
                    <input type="text" id="wfName" value="${workflowName}" placeholder="Workflow-Name..." />
                    <div style="display:flex;gap:6px;">
                        <button class="btn btn-primary" id="wfSave" style="height:32px;padding:0 14px;font-size:13px;border:none;border-radius:4px;cursor:pointer;font-family:inherit;font-weight:500;background:var(--magna-red);color:#fff;">Speichern</button>
                        <button class="btn" id="wfToggleActive" style="height:32px;padding:0 14px;font-size:13px;border:none;border-radius:4px;cursor:pointer;font-family:inherit;"></button>
                    </div>
                </div>
                <div class="wf-canvas" id="wfCanvas"></div>
            </div>
            <div class="wf-properties" id="wfProperties">
                <div class="wf-prop-empty">Knoten anklicken um Eigenschaften zu bearbeiten</div>
            </div>
        </div>
    `;

    renderPalette();
    renderCanvas();
    bindToolbarEvents();
    loadFormFields();
    await loadWorkflowList();

    document.getElementById('wfName').addEventListener('input', (e) => {
        workflowName = e.target.value;
    });

    updateToggleButton();

    document.getElementById('wfToggleActive')?.addEventListener('click', async () => {
        if (!workflowId) { alert('Bitte zuerst speichern.'); return; }
        const isActive = allWorkflows.find(w => w.id === workflowId)?.active;
        await ExecuteSQL(`UPDATE workflows SET active = ${isActive ? 0 : 1} WHERE id = ${workflowId}`);
        await loadWorkflowList();
        updateToggleButton();
    });
}

function updateToggleButton() {
    const btn = document.getElementById('wfToggleActive');
    if (!btn) return;
    const isActive = allWorkflows.find(w => w.id === workflowId)?.active;
    if (!workflowId) {
        btn.textContent = 'Aktivieren';
        btn.style.background = '#2e7d32';
        btn.style.color = '#fff';
    } else if (isActive) {
        btn.textContent = 'Deaktivieren';
        btn.style.background = '#c62828';
        btn.style.color = '#fff';
    } else {
        btn.textContent = 'Aktivieren';
        btn.style.background = '#2e7d32';
        btn.style.color = '#fff';
    }
}

async function loadWorkflowList() {
    try {
        const result = await GetWorkflows();
        allWorkflows = JSON.parse(result) || [];
    } catch { allWorkflows = []; }
    renderWorkflowList();
}

function renderWorkflowList() {
    const list = document.getElementById('wfList');
    if (!list) return;

    if (allWorkflows.length === 0) {
        list.innerHTML = '<p style="color:#bbb;font-size:12px;text-align:center;padding:8px;">Keine Workflows</p>';
        return;
    }

    list.innerHTML = allWorkflows.map((wf, idx) => `
        <div class="wf-list-item ${wf.id === workflowId ? 'selected' : ''}" data-id="${wf.id}" data-idx="${idx}">
            <div class="wf-list-name">${wf.name}</div>
            ${wf.active ? '<span class="wf-list-active">AKTIV</span>' : ''}
            <button class="wf-list-delete" data-id="${wf.id}" title="Löschen">&#10005;</button>
        </div>
    `).join('');

    list.querySelectorAll('.wf-list-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            if (e.target.classList.contains('wf-list-delete')) return;
            const id = parseInt(item.dataset.id);
            try {
                const r = await GetWorkflow(id);
                const wf = JSON.parse(r);
                workflowId = wf.id;
                workflowName = wf.name;
                workflow = JSON.parse(wf.definition);
                selectedNode = null;
                document.getElementById('wfName').value = workflowName;
                renderCanvas();
                renderProperties();
                renderWorkflowList();
                updateToggleButton();
            } catch (e) { console.error(e); }
        });
    });

    list.querySelectorAll('.wf-list-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = parseInt(btn.dataset.id);
            await DeleteWorkflow(id);
            if (workflowId === id) {
                workflowId = null;
                workflowName = 'Neuer Workflow';
                workflow = { nodes: [] };
                selectedNode = null;
                document.getElementById('wfName').value = workflowName;
                renderCanvas();
                renderProperties();
            }
            await loadWorkflowList();
        });
    });
}

function renderPalette() {
    document.getElementById('wfPaletteItems').innerHTML = nodeTypes.map(nt => `
        <div class="wf-palette-item" draggable="true" data-type="${nt.type}">
            <span class="icon ${nt.color}">${nt.icon}</span>
            <span>${nt.label}</span>
        </div>
    `).join('');

    document.querySelectorAll('.wf-palette-item').forEach(item => {
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('node-type', item.dataset.type);
            e.dataTransfer.effectAllowed = 'copy';
        });
    });
}

function renderCanvas() {
    const canvas = document.getElementById('wfCanvas');
    let html = '';

    if (workflow.nodes.length === 0) {
        html = `<div class="wf-dropzone" id="wfFirstDrop">Trigger hierher ziehen um Workflow zu starten</div>`;
    } else {
        workflow.nodes.forEach((node, idx) => {
            html += renderNode(node);
            // Connector + add button between nodes
            if (idx < workflow.nodes.length - 1) {
                html += renderConnector(idx);
            }
        });
        // Final drop zone
        html += renderConnector(workflow.nodes.length - 1, true);
        html += `<div class="wf-dropzone" id="wfEndDrop">Nächste Aktion hierher ziehen</div>`;
    }

    canvas.innerHTML = html;
    bindCanvasEvents();
}

function renderNode(node) {
    const isSelected = selectedNode && selectedNode.id === node.id;
    let summary = getNodeSummary(node);

    return `
        <div class="wf-node ${isSelected ? 'selected' : ''}" data-id="${node.id}">
            <div class="wf-node-header ${node.type}">
                <span class="wf-node-icon ${node.type}">${getNodeIcon(node.type)}</span>
                <div>
                    <div class="wf-node-type">${getNodeTypeName(node.type)}</div>
                    <div class="wf-node-title">${node.label || ''}</div>
                </div>
            </div>
            <div class="wf-node-body">${summary}</div>
            <button class="wf-node-delete" data-id="${node.id}">&#10005;</button>
        </div>
    `;
}

function renderConnector(afterIdx, isLast) {
    return `
        <div class="wf-connector">
            <div class="wf-connector-line"></div>
            <button class="wf-add-btn" data-after="${afterIdx}" title="Aktion einfügen">+</button>
            <div class="wf-connector-line"></div>
            <div class="wf-connector-arrow"></div>
        </div>
    `;
}

function getNodeIcon(type) {
    const icons = { trigger: 'T', email: 'E', delay: 'Z', condition: '?' };
    return icons[type] || '?';
}

function getNodeTypeName(type) {
    const names = { trigger: 'Trigger', email: 'E-Mail', delay: 'Verzögerung', condition: 'Bedingung' };
    return names[type] || type;
}

function getNodeSummary(node) {
    switch (node.type) {
        case 'trigger': {
            if (node.event === 'pruefung_ueberfaellig') return `Prüfung überfällig (${node.overdue_minutes || 30} Min.)`;
            if (node.event === 'bauteil_gebracht') return 'Bauteil gebracht';
            if (node.event === 'pruefung_abgeschlossen') return 'Prüfung abgeschlossen';
            if (node.event === 'schicht_komplett') return 'Alle Schicht-Prüfungen erledigt';
            if (node.event === 'scheduled') {
                const types = { interval: 'Intervall', daily: 'Täglich', weekly: 'Wöchentlich', monthly: 'Monatlich' };
                const units = { minutes: 'Min.', hours: 'Std.', days: 'Tage' };
                let desc = types[node.schedule_type] || 'Intervall';
                if (node.schedule_type === 'interval') desc = `Alle ${node.schedule_interval || 1} ${units[node.schedule_unit] || 'Std.'}`;
                if (node.schedule_type === 'daily') desc = `Täglich um ${node.schedule_time || '08:00'}`;
                if (node.schedule_type === 'weekly') desc = `Wöchentlich ${['','Mo','Di','Mi','Do','Fr','Sa','So'][node.schedule_day||1]} ${node.schedule_time || '08:00'}`;
                if (node.schedule_type === 'monthly') desc = `Monatlich am ${node.schedule_month_day || 1}. um ${node.schedule_time || '08:00'}`;
                return desc;
            }
            if (!node.field) return 'Nicht konfiguriert';
            const fieldLabel = formFields.find(f => f.key === node.field)?.label || node.field;
            const opLabel = operators.find(o => o.value === node.operator)?.label || node.operator;
            if (node.operator === 'not_empty' || node.operator === 'empty') return `${fieldLabel} ${opLabel}`;
            return `${fieldLabel} ${opLabel} "${node.value}"`;
        }
        case 'email':
            if (!node.to) return 'Nicht konfiguriert';
            return `An: ${node.to} | ${node.mode === 'outlook' ? 'Outlook' : 'SMTP'}`;
        case 'delay':
            const units = { minutes: 'Minuten', hours: 'Stunden', days: 'Tage' };
            return `${node.duration} ${units[node.unit] || node.unit}`;
        case 'condition': {
            if (!node.field) return 'Nicht konfiguriert';
            const fLabel = formFields.find(f => f.key === node.field)?.label || node.field;
            const oLabel = operators.find(o => o.value === node.operator)?.label || node.operator;
            if (node.operator === 'not_empty' || node.operator === 'empty') return `Wenn ${fLabel} ${oLabel}`;
            return `Wenn ${fLabel} ${oLabel} "${node.value}"`;
        }
        case 'set_value':
            if (!node.target_column) return 'Nicht konfiguriert';
            return `${node.target_column} = "${node.set_value || ''}"`;
        case 'user_input':
            if (!node.target_column) return 'Nicht konfiguriert';
            return `Eingabe → ${node.target_column}`;
        case 'show_text':
            if (!node.display_text) return 'Nicht konfiguriert';
            return node.display_text.substring(0, 50) + (node.display_text.length > 50 ? '...' : '');
        default: return '';
    }
}

// ===== EVENTS =====

function bindCanvasEvents() {
    // Node selection
    document.querySelectorAll('.wf-node').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.classList.contains('wf-node-delete')) return;
            const id = el.dataset.id;
            selectedNode = workflow.nodes.find(n => n.id === id);
            renderCanvas();
            renderProperties();
        });
    });

    // Node delete
    document.querySelectorAll('.wf-node-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            workflow.nodes = workflow.nodes.filter(n => n.id !== id);
            if (selectedNode && selectedNode.id === id) selectedNode = null;
            renderCanvas();
            renderProperties();
        });
    });

    // Add buttons between nodes
    document.querySelectorAll('.wf-add-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const afterIdx = parseInt(btn.dataset.after);
            showAddMenu(btn, afterIdx);
        });
    });

    // Drop zones
    setupDropZone('wfFirstDrop', 0);
    setupDropZone('wfEndDrop', workflow.nodes.length);

    // Canvas click deselect
    document.getElementById('wfCanvas')?.addEventListener('click', (e) => {
        if (e.target.id === 'wfCanvas') {
            selectedNode = null;
            renderCanvas();
            renderProperties();
        }
    });
}

function setupDropZone(id, insertIdx) {
    const zone = document.getElementById(id);
    if (!zone) return;
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const type = e.dataTransfer.getData('node-type');
        if (type) {
            const node = createDefaultNode(type);
            workflow.nodes.splice(insertIdx, 0, node);
            selectedNode = node;
            renderCanvas();
            renderProperties();
        }
    });
}

function showAddMenu(btn, afterIdx) {
    // Remove any existing menu
    document.querySelectorAll('.wf-add-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'wf-add-menu';
    menu.style.cssText = 'position:absolute;background:#fff;border:1px solid #ddd;border-radius:6px;padding:6px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:50;';
    menu.innerHTML = nodeTypes.filter(nt => nt.type !== 'trigger').map(nt => `
        <div class="wf-palette-item" data-type="${nt.type}" style="margin-bottom:2px;cursor:pointer;">
            <span class="icon ${nt.color}">${nt.icon}</span>
            <span>${nt.label}</span>
        </div>
    `).join('');

    btn.parentElement.style.position = 'relative';
    btn.parentElement.appendChild(menu);

    menu.querySelectorAll('.wf-palette-item').forEach(item => {
        item.addEventListener('click', () => {
            const node = createDefaultNode(item.dataset.type);
            workflow.nodes.splice(afterIdx + 1, 0, node);
            selectedNode = node;
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

// ===== PROPERTIES =====

function renderProperties() {
    const panel = document.getElementById('wfProperties');
    if (!selectedNode) {
        panel.innerHTML = '<div class="wf-prop-empty">Knoten anklicken um Eigenschaften zu bearbeiten</div>';
        return;
    }

    const node = selectedNode;
    let html = `<h3>${getNodeTypeName(node.type)}</h3>`;

    // Label
    html += `<div class="wf-prop-group"><label>Bezeichnung</label><input type="text" id="wpLabel" value="${node.label || ''}" /></div>`;

    switch (node.type) {
        case 'trigger':
            html += renderTriggerProps(node);
            break;
        case 'email':
            html += renderEmailProps(node);
            break;
        case 'delay':
            html += renderDelayProps(node);
            break;
        case 'condition':
            html += renderConditionProps(node);
            break;
        case 'set_value':
            html += renderSetValueProps(node);
            break;
        case 'user_input':
            html += renderUserInputProps(node);
            break;
        case 'show_text':
            html += renderShowTextProps(node);
            break;
    }

    html += `<button class="wf-prop-delete" id="wpDelete">Knoten entfernen</button>`;
    panel.innerHTML = html;
    bindPropertyEvents(node);
}

function renderFieldSelect(id, value) {
    return `<select id="${id}">
        <option value="">-- Feld wählen --</option>
        ${formFields.map(f => `<option value="${f.key}" ${f.key === value ? 'selected' : ''}>${f.label}</option>`).join('')}
    </select>`;
}

function renderOperatorSelect(id, value) {
    return `<select id="${id}">
        ${operators.map(o => `<option value="${o.value}" ${o.value === value ? 'selected' : ''}>${o.label}</option>`).join('')}
    </select>`;
}

function renderTriggerProps(node) {
    let html = '';
    html += `<div class="wf-prop-group"><label>Ereignis</label>
        <select id="wpEvent">
            <option value="data_changed" ${node.event === 'data_changed' ? 'selected' : ''}>Datensatz geändert</option>
            <option value="messung_created" ${node.event === 'messung_created' ? 'selected' : ''}>Neue Messung erstellt</option>
            <option value="scheduled" ${node.event === 'scheduled' ? 'selected' : ''}>Zeitgesteuert</option>
            <option value="pruefung_ueberfaellig" ${node.event === 'pruefung_ueberfaellig' ? 'selected' : ''}>Prüfung überfällig</option>
            <option value="bauteil_gebracht" ${node.event === 'bauteil_gebracht' ? 'selected' : ''}>Bauteil gebracht</option>
            <option value="pruefung_abgeschlossen" ${node.event === 'pruefung_abgeschlossen' ? 'selected' : ''}>Prüfung abgeschlossen</option>
            <option value="schicht_komplett" ${node.event === 'schicht_komplett' ? 'selected' : ''}>Alle Prüfungen der Schicht erledigt</option>
        </select></div>`;

    if (node.event === 'scheduled') {
        html += `<div class="wf-prop-group"><label>Zeitplan</label>
            <select id="wpScheduleType">
                <option value="interval" ${node.schedule_type === 'interval' ? 'selected' : ''}>Intervall</option>
                <option value="daily" ${node.schedule_type === 'daily' ? 'selected' : ''}>Täglich um Uhrzeit</option>
                <option value="weekly" ${node.schedule_type === 'weekly' ? 'selected' : ''}>Wöchentlich</option>
                <option value="monthly" ${node.schedule_type === 'monthly' ? 'selected' : ''}>Monatlich</option>
            </select></div>`;

        if (node.schedule_type === 'interval' || !node.schedule_type) {
            html += `<div class="wf-prop-row">
                <div class="wf-prop-group"><label>Alle</label><input type="number" id="wpScheduleInterval" value="${node.schedule_interval || 1}" min="1" /></div>
                <div class="wf-prop-group"><label>Einheit</label>
                    <select id="wpScheduleUnit">
                        <option value="minutes" ${node.schedule_unit === 'minutes' ? 'selected' : ''}>Minuten</option>
                        <option value="hours" ${node.schedule_unit === 'hours' ? 'selected' : ''}>Stunden</option>
                        <option value="days" ${node.schedule_unit === 'days' ? 'selected' : ''}>Tage</option>
                    </select></div>
            </div>`;
        }

        if (node.schedule_type === 'daily') {
            html += `<div class="wf-prop-group"><label>Uhrzeit</label><input type="text" id="wpScheduleTime" value="${node.schedule_time || '08:00'}" placeholder="HH:MM" /></div>`;
        }

        if (node.schedule_type === 'weekly') {
            const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
            html += `<div class="wf-prop-group"><label>Wochentag</label>
                <select id="wpScheduleDay">
                    ${days.map((d, i) => `<option value="${i + 1}" ${node.schedule_day == (i + 1) ? 'selected' : ''}>${d}</option>`).join('')}
                </select></div>`;
            html += `<div class="wf-prop-group"><label>Uhrzeit</label><input type="text" id="wpScheduleTime" value="${node.schedule_time || '08:00'}" placeholder="HH:MM" /></div>`;
        }

        if (node.schedule_type === 'monthly') {
            html += `<div class="wf-prop-group"><label>Tag im Monat</label><input type="number" id="wpScheduleMonthDay" value="${node.schedule_month_day || 1}" min="1" max="28" /></div>`;
            html += `<div class="wf-prop-group"><label>Uhrzeit</label><input type="text" id="wpScheduleTime" value="${node.schedule_time || '08:00'}" placeholder="HH:MM" /></div>`;
        }

        // Optional: condition filter on data
        html += `<div class="wf-prop-group" style="margin-top:12px;padding-top:12px;border-top:1px solid #eee;">
            <label>Optional: Nur wenn Bedingung erfüllt</label></div>`;
        html += `<div class="wf-prop-group"><label>Feld</label>${renderFieldSelect('wpField', node.field)}</div>`;
        html += `<div class="wf-prop-group"><label>Operator</label>${renderOperatorSelect('wpOperator', node.operator)}</div>`;
        html += `<div class="wf-prop-group"><label>Wert</label><input type="text" id="wpValue" value="${node.value || ''}" /></div>`;
    } else if (node.event === 'pruefung_ueberfaellig') {
        html += `<div class="wf-prop-group"><label>Überfällig nach (Minuten)</label>
            <input type="number" id="wpOverdueMinutes" value="${node.overdue_minutes || 30}" min="1" /></div>`;
        html += `<div class="wf-prop-group" style="font-size:11px;color:var(--magna-label);">
            Workflow wird ausgelöst wenn eine Prüfung X Minuten nach Ziel-Uhrzeit noch nicht gebracht wurde.
        </div>`;
    } else if (node.event === 'bauteil_gebracht') {
        html += `<div class="wf-prop-group" style="font-size:11px;color:var(--magna-label);">
            Workflow wird ausgelöst wenn ein Werker ein Bauteil für eine Prüfplan-Durchführung bringt.
        </div>`;
    } else if (node.event === 'pruefung_abgeschlossen') {
        html += `<div class="wf-prop-group" style="font-size:11px;color:var(--magna-label);">
            Workflow wird ausgelöst wenn ein QS-Mitarbeiter das Messergebnis für eine Prüfplan-Durchführung einträgt.
        </div>`;
    } else if (node.event === 'schicht_komplett') {
        html += `<div class="wf-prop-group" style="font-size:11px;color:var(--magna-label);">
            Workflow wird ausgelöst wenn alle fälligen Prüfungen der aktuellen Schicht als gemessen markiert sind.
        </div>`;
    } else {
        html += `<div class="wf-prop-group"><label>Feld</label>${renderFieldSelect('wpField', node.field)}</div>`;
        html += `<div class="wf-prop-group"><label>Operator</label>${renderOperatorSelect('wpOperator', node.operator)}</div>`;
        html += `<div class="wf-prop-group"><label>Wert</label><input type="text" id="wpValue" value="${node.value || ''}" /></div>`;
    }
    return html;
}

function renderEmailProps(node) {
    let html = '';
    html += `<div class="wf-prop-group"><label>Modus</label>
        <select id="wpMode">
            <option value="smtp" ${node.mode === 'smtp' ? 'selected' : ''}>Automatisch (SMTP)</option>
            <option value="outlook" ${node.mode === 'outlook' ? 'selected' : ''}>In Outlook öffnen</option>
        </select></div>`;
    html += `<div class="wf-prop-group"><label>Empfänger</label><input type="text" id="wpTo" value="${node.to || ''}" placeholder="email@firma.de" /></div>`;
    html += `<div class="wf-prop-group"><label>Betreff</label><input type="text" id="wpSubject" value="${node.subject || ''}" /></div>`;
    html += `<div class="wf-prop-group"><label>Nachricht</label><textarea id="wpBody">${node.body || ''}</textarea></div>`;
    return html;
}

function renderDelayProps(node) {
    let html = `<div class="wf-prop-row">
        <div class="wf-prop-group"><label>Dauer</label><input type="number" id="wpDuration" value="${node.duration || 1}" min="1" /></div>
        <div class="wf-prop-group"><label>Einheit</label>
            <select id="wpUnit">
                <option value="minutes" ${node.unit === 'minutes' ? 'selected' : ''}>Minuten</option>
                <option value="hours" ${node.unit === 'hours' ? 'selected' : ''}>Stunden</option>
                <option value="days" ${node.unit === 'days' ? 'selected' : ''}>Tage</option>
            </select></div>
    </div>`;
    return html;
}

function renderConditionProps(node) {
    let html = '';
    html += `<div class="wf-prop-group"><label>Feld</label>${renderFieldSelect('wpField', node.field)}</div>`;
    html += `<div class="wf-prop-group"><label>Operator</label>${renderOperatorSelect('wpOperator', node.operator)}</div>`;
    html += `<div class="wf-prop-group"><label>Wert</label><input type="text" id="wpValue" value="${node.value || ''}" /></div>`;
    return html;
}

function renderSetValueProps(node) {
    let html = '';
    html += `<div class="wf-prop-group"><label>Ziel-Spalte</label>${renderFieldSelect('wpTargetCol', node.target_column)}</div>`;
    html += `<div class="wf-prop-group"><label>Wert</label><input type="text" id="wpSetValue" value="${node.set_value || ''}" placeholder="z.B. NOK oder {{today}}" /></div>`;
    html += `<div class="wf-prop-group" style="font-size:11px;color:var(--magna-label);">
        Platzhalter: <code>{{today}}</code> = aktueller Zeitstempel, <code>{{feldname}}</code> = Wert aus Messung
    </div>`;
    return html;
}

function renderShowTextProps(node) {
    let html = '';
    html += `<div class="wf-prop-group"><label>Anzeigetext</label><textarea id="wpDisplayText" rows="4">${node.display_text || ''}</textarea></div>`;
    html += `<div class="wf-prop-group"><label>Typ</label>
        <select id="wpDisplayType">
            <option value="info" ${node.display_type === 'info' ? 'selected' : ''}>Info (blau)</option>
            <option value="warning" ${node.display_type === 'warning' ? 'selected' : ''}>Warnung (orange)</option>
            <option value="error" ${node.display_type === 'error' ? 'selected' : ''}>Fehler (rot)</option>
            <option value="success" ${node.display_type === 'success' ? 'selected' : ''}>Erfolg (grün)</option>
        </select></div>`;
    html += `<div class="wf-prop-group" style="font-size:11px;color:var(--magna-label);">
        Platzhalter: <code>{{feldname}}</code> = Wert aus Messung
    </div>`;
    return html;
}

function renderUserInputProps(node) {
    let html = '';
    html += `<div class="wf-prop-group"><label>Abfrage-Text</label><input type="text" id="wpPromptText" value="${node.prompt_text || ''}" placeholder="Bitte Wert eingeben..." /></div>`;
    html += `<div class="wf-prop-group"><label>Ziel-Spalte</label>${renderFieldSelect('wpTargetCol', node.target_column)}</div>`;
    html += `<div class="wf-prop-group"><label>Eingabetyp</label>
        <select id="wpInputType">
            <option value="text" ${node.input_type === 'text' ? 'selected' : ''}>Textfeld</option>
            <option value="select" ${node.input_type === 'select' ? 'selected' : ''}>Auswahl (Dropdown)</option>
            <option value="textarea" ${node.input_type === 'textarea' ? 'selected' : ''}>Mehrzeilig</option>
        </select></div>`;
    if (node.input_type === 'select') {
        html += `<div class="wf-prop-group"><label>Optionen (kommagetrennt)</label><input type="text" id="wpInputOptions" value="${(node.input_options || []).join(', ')}" /></div>`;
    }
    return html;
}

function bindPropertyEvents(node) {
    const bind = (id, key, transform) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            node[key] = transform ? transform(el.value) : el.value;
            renderCanvas();
        });
        el.addEventListener('change', () => {
            node[key] = transform ? transform(el.value) : el.value;
            renderCanvas();
        });
    };

    bind('wpLabel', 'label');
    bind('wpField', 'field');
    bind('wpOperator', 'operator');
    bind('wpValue', 'value');
    bind('wpTargetCol', 'target_column');
    bind('wpSetValue', 'set_value');
    bind('wpPromptText', 'prompt_text');
    bind('wpDisplayText', 'display_text');
    bind('wpDisplayType', 'display_type');
    bind('wpInputOptions', 'input_options', v => v.split(',').map(s => s.trim()).filter(s => s));

    const inputTypeEl = document.getElementById('wpInputType');
    if (inputTypeEl) {
        inputTypeEl.addEventListener('change', () => {
            node.input_type = inputTypeEl.value;
            renderCanvas();
            renderProperties();
        });
    }
    // Event change needs to re-render properties for schedule options
    const eventEl = document.getElementById('wpEvent');
    if (eventEl) {
        eventEl.addEventListener('change', () => {
            node.event = eventEl.value;
            renderCanvas();
            renderProperties();
        });
    }

    // Schedule fields
    bind('wpOverdueMinutes', 'overdue_minutes', v => parseInt(v));
    bind('wpScheduleInterval', 'schedule_interval', v => parseInt(v));
    bind('wpScheduleUnit', 'schedule_unit');
    bind('wpScheduleTime', 'schedule_time');
    bind('wpScheduleDay', 'schedule_day', v => parseInt(v));
    bind('wpScheduleMonthDay', 'schedule_month_day', v => parseInt(v));

    const schedTypeEl = document.getElementById('wpScheduleType');
    if (schedTypeEl) {
        schedTypeEl.addEventListener('change', () => {
            node.schedule_type = schedTypeEl.value;
            renderProperties();
        });
    }
    bind('wpTo', 'to');
    bind('wpSubject', 'subject');
    bind('wpBody', 'body');
    bind('wpMode', 'mode');
    bind('wpDuration', 'duration', v => parseInt(v));
    bind('wpUnit', 'unit');

    document.getElementById('wpDelete')?.addEventListener('click', () => {
        workflow.nodes = workflow.nodes.filter(n => n.id !== node.id);
        selectedNode = null;
        renderCanvas();
        renderProperties();
    });
}

// ===== TOOLBAR =====

function bindToolbarEvents() {
    document.getElementById('wfSave').addEventListener('click', saveWorkflow);
    document.getElementById('wfNew').addEventListener('click', newWorkflow);
}

async function saveWorkflow() {
    workflowName = document.getElementById('wfName').value || 'Unbenannt';
    const payload = JSON.stringify({
        name: workflowName,
        definition: JSON.stringify(workflow),
    });

    let result;
    if (workflowId) {
        result = await UpdateWorkflow(workflowId, payload);
    } else {
        result = await SaveWorkflow(payload);
    }

    try {
        const parsed = JSON.parse(result);
        if (parsed.id) workflowId = parsed.id;
    } catch {}
    await loadWorkflowList();
}

async function showWorkflowList() {
    const result = await GetWorkflows();
    let workflows = [];
    try { workflows = JSON.parse(result); } catch {}

    const overlay = document.createElement('div');
    overlay.className = 'fb-form-list';
    overlay.innerHTML = `
        <div class="fb-form-list-content">
            <h3>Gespeicherte Workflows</h3>
            ${workflows.length === 0 ? '<p>Keine Workflows vorhanden.</p>' : ''}
            ${workflows.map(w => `
                <div class="fb-form-list-item" data-id="${w.id}">
                    <div>
                        <div class="name">${w.name}</div>
                        <div class="meta">${w.aktualisiert_am}</div>
                    </div>
                    ${w.active ? '<span class="active-badge">AKTIV</span>' : ''}
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
            const r = await GetWorkflow(id);
            try {
                const wf = JSON.parse(r);
                workflowId = wf.id;
                workflowName = wf.name;
                workflow = JSON.parse(wf.definition);
                selectedNode = null;
                document.getElementById('wfName').value = workflowName;
                renderCanvas();
                renderProperties();
            } catch (e) { alert('Fehler: ' + e.message); }
            overlay.remove();
        });
    });
}

function newWorkflow() {
    workflowId = null;
    workflowName = 'Neuer Workflow';
    workflow = { nodes: [] };
    selectedNode = null;
    document.getElementById('wfName').value = workflowName;
    renderCanvas();
    renderProperties();
}
