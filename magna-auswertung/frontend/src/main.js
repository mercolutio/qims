import './style.css';
import { GetMessungen, DeleteMessung, CheckConnection, ExportCSV, GetDropdowns, AddDropdown, DeleteDropdown, ExecuteSQL, GetWorkflows } from '../wailsjs/go/main/App';
import { renderFormBuilderTab } from './formbuilder.js';
import { renderWorkflowTab } from './workflow-builder.js';
import { renderDBAdminTab } from './db-admin.js';
import { renderPruefplanTab } from './pruefplan.js';
import { renderStatistikenTab } from './statistiken.js';
import { renderEinstellungenTab, loadContextMenuConfig } from './einstellungen.js';

let allMessungen = [];
let sortCol = null;
let sortDir = 'desc';
let searchTerm = '';
let activeTab = 'messungen';
let hiddenColumns = new Set();
let columnFilters = {}; // { column_key: Set of selected values }

// Known label mappings for nicer display
const labelMap = {
    id: 'ID', datum: 'Datum', fertigungsbereich: 'Fert.bereich',
    abteilung_zsb: 'Abt. ZSB', abteilung_uzsb: 'Abt. UZSB',
    name: 'Name', batch_nr: 'Batch-Nr.', station: 'Station',
    pruefzweck: 'Prüfzweck', pruefart: 'Prüfart',
    einstellmassnahme: 'Einstellm.', nok_id: 'NOK-ID',
    bemerkungen: 'Bemerkungen', messung_planmaessig: 'Planmäßig',
    ausgeschleust: 'Ausgeschl.', erstellt_am: 'Erstellt am',
    form_id: 'Form-ID', daten_json: 'Daten (JSON)',
};

// Hidden by default (internal columns)
const defaultHidden = new Set(['form_id', 'daten_json']);

let columns = [];

async function loadColumns() {
    try {
        const result = await ExecuteSQL('PRAGMA table_info(messungen)');
        const parsed = JSON.parse(result);
        if (parsed.columns && parsed.rows) {
            columns = parsed.rows.map(r => {
                const key = r[1];
                return { key, label: labelMap[key] || key };
            });
            // Set default hidden columns on first load
            if (hiddenColumns.size === 0) {
                defaultHidden.forEach(k => hiddenColumns.add(k));
            }
        }
    } catch {
        // Fallback
        columns = [{ key: 'id', label: 'ID' }, { key: 'datum', label: 'Datum' }];
    }
}

const kategorien = [
    { key: 'fertigungsbereich', label: 'Fertigungsbereich' },
    { key: 'abteilung_zsb', label: 'Abteilung (ZSB)' },
    { key: 'abteilung_uzsb', label: 'Abteilung (UZSB/HF-Teil)' },
    { key: 'station', label: 'Station' },
    { key: 'pruefzweck', label: 'Prüfzweck' },
    { key: 'pruefart', label: 'Prüfart' },
    { key: 'einstellmassnahme', label: 'Einstellmaßnahme' },
];

// Suppress default context menu (our custom ones still work)
document.addEventListener('contextmenu', (e) => {
    // Allow our custom context menu on table rows
    if (e.target.closest('tr[data-id]')) return;
    e.preventDefault();
});

document.querySelector('#app').innerHTML = `
<header class="app-header">
    <span class="logo-text">QIMS</span>
    <span class="header-divider"></span>
    <span class="header-subtitle">Datenauswertung</span>
</header>
<nav class="tab-bar">
    <button class="tab active" data-tab="messungen">Messungen</button>
    <button class="tab" data-tab="formbuilder">Formular Designer</button>
    <button class="tab" data-tab="workflows">Workflows</button>
    <button class="tab" data-tab="statistiken">Statistiken</button>
    <button class="tab" data-tab="pruefplan">Prüfplan</button>
    <button class="tab" data-tab="einstellungen">Einstellungen</button>
    <button class="tab" data-tab="dbadmin">Datenbank</button>
</nav>
<div class="main-content" id="tabContent">
</div>
<div class="status-bar" id="statusBar">Verbinde mit Server...</div>
`;

// ===== TAB NAVIGATION =====
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeTab = tab.dataset.tab;
        cachedCMConfig = null; // invalidate context menu cache on tab switch
        if (activeTab === 'messungen') renderMessungenTab();
        else if (activeTab === 'formbuilder') renderFormBuilderTab();
        else if (activeTab === 'workflows') renderWorkflowTab();
        else if (activeTab === 'statistiken') renderStatistikenTab();
        else if (activeTab === 'pruefplan') renderPruefplanTab();
        else if (activeTab === 'einstellungen') renderEinstellungenTab();
        else if (activeTab === 'dbadmin') renderDBAdminTab();
    });
});

// ===== MESSUNGEN TAB =====
async function renderMessungenTab() {
    await loadColumns();
    document.getElementById('tabContent').innerHTML = `
        <div class="toolbar">
            <input type="text" id="searchInput" placeholder="Suchen..." value="${searchTerm}" />
            <button class="btn" id="btnRefresh">Aktualisieren</button>
            <button class="btn btn-primary" id="btnExport">CSV Export</button>
            <div class="column-toggle-wrapper">
                <button class="btn" id="btnColumns">Spalten</button>
                <div class="column-toggle-menu" id="columnMenu" style="display:none;">
                    ${columns.map(col => `
                        <label class="column-toggle-item">
                            <input type="checkbox" data-key="${col.key}" ${!hiddenColumns.has(col.key) ? 'checked' : ''} />
                            <span>${col.label}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
            <span class="count" id="countLabel"></span>
        </div>
        <div class="table-container">
            <table>
                <thead><tr id="tableHead"></tr></thead>
                <tbody id="tableBody"></tbody>
            </table>
        </div>
    `;

    document.getElementById('searchInput').addEventListener('input', (e) => {
        searchTerm = e.target.value;
        renderTable();
    });
    document.getElementById('btnRefresh').addEventListener('click', loadMessungen);

    // Column toggle
    const btnColumns = document.getElementById('btnColumns');
    const columnMenu = document.getElementById('columnMenu');
    btnColumns.addEventListener('click', (e) => {
        e.stopPropagation();
        columnMenu.style.display = columnMenu.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', (e) => {
        if (!columnMenu.contains(e.target) && e.target !== btnColumns) columnMenu.style.display = 'none';
    });
    columnMenu.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) hiddenColumns.delete(cb.dataset.key);
            else hiddenColumns.add(cb.dataset.key);
            renderTable();
        });
    });
    document.getElementById('btnExport').addEventListener('click', async () => {
        const result = await ExportCSV();
        if (result.startsWith('OK:')) alert('Export gespeichert: ' + result.substring(3));
        else alert(result);
    });

    loadMessungen();
}

function getVisibleColumns() {
    return columns.filter(col => !hiddenColumns.has(col.key));
}

function renderHead() {
    const head = document.getElementById('tableHead');
    const visible = getVisibleColumns();
    head.innerHTML = visible.map(col => {
        let cls = '';
        if (sortCol === col.key) cls = sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc';
        const hasFilter = columnFilters[col.key] ? ' filtered' : '';
        return `<th class="${cls}${hasFilter}" data-key="${col.key}">
            <span class="th-label">${col.label}</span>
            <button class="th-filter-btn${hasFilter}" data-key="${col.key}" title="Filter"></button>
        </th>`;
    }).join('') + '<th></th>';

    // Sort on label click
    head.querySelectorAll('.th-label').forEach(label => {
        label.addEventListener('click', () => {
            const key = label.parentElement.dataset.key;
            if (sortCol === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            else { sortCol = key; sortDir = 'asc'; }
            renderTable();
        });
    });

    // Filter dropdown on button click
    head.querySelectorAll('.th-filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showColumnFilter(btn, btn.dataset.key);
        });
    });
}

function showColumnFilter(btn, colKey) {
    // Remove existing filter dropdowns
    document.querySelectorAll('.col-filter-dropdown').forEach(d => d.remove());

    // Get unique values for this column
    const uniqueVals = new Set();
    allMessungen.forEach(m => {
        const val = m[colKey];
        uniqueVals.add(val === null || val === undefined ? '' : String(val));
    });
    const sorted = [...uniqueVals].sort();

    const currentFilter = columnFilters[colKey];

    const dropdown = document.createElement('div');
    dropdown.className = 'col-filter-dropdown';

    let html = '<div class="col-filter-header">';
    html += '<button class="col-filter-all" id="cfSelectAll">Alle</button>';
    html += '<button class="col-filter-none" id="cfSelectNone">Keine</button>';
    if (currentFilter) html += '<button class="col-filter-clear" id="cfClear">Filter löschen</button>';
    html += '</div>';
    html += '<div class="col-filter-list">';
    sorted.forEach(val => {
        const displayVal = val === '' ? '(leer)' : val;
        const checked = !currentFilter || currentFilter.has(val) ? 'checked' : '';
        html += `<label class="col-filter-item"><input type="checkbox" value="${val.replace(/"/g, '&quot;')}" ${checked} /><span>${displayVal}</span></label>`;
    });
    html += '</div>';
    html += '<button class="col-filter-apply" id="cfApply">Anwenden</button>';

    dropdown.innerHTML = html;

    // Position below the button
    const rect = btn.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.top = (rect.bottom + 2) + 'px';
    dropdown.style.left = rect.left + 'px';
    document.body.appendChild(dropdown);

    // Select All / None
    dropdown.querySelector('#cfSelectAll')?.addEventListener('click', () => {
        dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    });
    dropdown.querySelector('#cfSelectNone')?.addEventListener('click', () => {
        dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    });
    dropdown.querySelector('#cfClear')?.addEventListener('click', () => {
        delete columnFilters[colKey];
        dropdown.remove();
        renderTable();
    });

    // Apply
    dropdown.querySelector('#cfApply').addEventListener('click', () => {
        const selected = new Set();
        dropdown.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
            selected.add(cb.value);
        });
        if (selected.size === sorted.length) {
            delete columnFilters[colKey]; // All selected = no filter
        } else {
            columnFilters[colKey] = selected;
        }
        dropdown.remove();
        renderTable();
    });

    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', function handler(e) {
            if (!dropdown.contains(e.target)) {
                dropdown.remove();
                document.removeEventListener('click', handler);
            }
        });
    }, 10);
}

function getFiltered() {
    let data = [...allMessungen];

    // Apply column filters
    for (const [colKey, allowedValues] of Object.entries(columnFilters)) {
        data = data.filter(m => {
            const val = m[colKey];
            const strVal = val === null || val === undefined ? '' : String(val);
            return allowedValues.has(strVal);
        });
    }

    // Apply search
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        data = data.filter(m =>
            Object.values(m).some(v => String(v).toLowerCase().includes(term))
        );
    }

    return data;
}

function renderTable() {
    let data = getFiltered();

    if (sortCol) {
        data.sort((a, b) => {
            let va = a[sortCol] ?? '';
            let vb = b[sortCol] ?? '';
            if (sortCol === 'id') { va = Number(va); vb = Number(vb); }
            else { va = String(va).toLowerCase(); vb = String(vb).toLowerCase(); }
            if (va < vb) return sortDir === 'asc' ? -1 : 1;
            if (va > vb) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    renderHead();
    const tbody = document.getElementById('tableBody');

    const visible = getVisibleColumns();

    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${visible.length + 1}">
            <div class="empty-state"><p>Keine Messungen gefunden</p></div>
        </td></tr>`;
    } else {
        // Build color maps for all menus
        const allMenus = (cachedCMConfig || { menus: [] }).menus || [];
        const colColorMaps = {}; // { column: { value: color } }
        allMenus.forEach(m => {
            if (!colColorMaps[m.target_column]) colColorMaps[m.target_column] = {};
            m.items.forEach(i => { colColorMaps[m.target_column][i.value] = i.color; });
        });

        // Primary menu for row border color
        const primaryCol = allMenus[0]?.target_column || 'messergebnis';
        const primaryMap = colColorMaps[primaryCol] || {};

        tbody.innerHTML = data.map(m => {
            const primaryVal = m[primaryCol] || '';
            const rowColor = primaryMap[primaryVal] || '';
            const rowStyle = rowColor ? `border-left: 3px solid ${rowColor}` : '';

            return `<tr style="${rowStyle}" data-id="${m.id}">
                ${visible.map(col => {
                    const val = m[col.key] ?? '';
                    if (col.key === 'messung_planmaessig' || col.key === 'ausgeschleust') {
                        const cls = val === 'ja' ? 'badge-ja' : 'badge-nein';
                        return `<td><span class="badge ${cls}">${val}</span></td>`;
                    }
                    // Dynamic badge for any context menu column
                    const colMap = colColorMaps[col.key];
                    if (colMap && val && colMap[val]) {
                        return `<td><span class="badge" style="background:${colMap[val]}15;color:${colMap[val]}">${val}</span></td>`;
                    }
                    return `<td>${val}</td>`;
                }).join('')}
                <td><button class="btn-delete" data-id="${m.id}" title="Löschen">&#10005;</button></td>
            </tr>`;
        }).join('');
    }

    document.getElementById('countLabel').textContent = `${data.length} Messung${data.length !== 1 ? 'en' : ''}`;

    tbody.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Messung wirklich löschen?')) return;
            const result = await DeleteMessung(parseInt(btn.dataset.id));
            if (result === 'OK') loadMessungen();
            else alert(result);
        });
    });

    // Context menu on rows
    tbody.querySelectorAll('tr[data-id]').forEach(tr => {
        tr.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showContextMenu(e.clientX, e.clientY, parseInt(tr.dataset.id));
        });
    });
}

let cachedCMConfig = null;

async function ensureCMConfig() {
    if (!cachedCMConfig) {
        cachedCMConfig = await loadContextMenuConfig();
    }
    return cachedCMConfig;
}

// Invalidate cache when switching to settings tab
const origRenderEinstellungen = renderEinstellungenTab;

async function showContextMenu(x, y, messungId) {
    const cmConfig = await ensureCMConfig();
    const menus = cmConfig.menus || [];

    // Remove existing
    document.querySelectorAll('.context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    let html = '';
    menus.forEach((m, mIdx) => {
        if (mIdx > 0) html += '<div class="context-menu-divider"></div>';
        html += `<div class="context-menu-group-label">${m.name}</div>`;

        if (m.timestamp_mode) {
            // Timestamp mode: single button to set current timestamp
            html += `<div class="context-menu-item" data-value="__TIMESTAMP__" data-col="${m.target_column}">
                <span class="dot" style="background:#1565c0"></span> Zeitstempel setzen
            </div>`;
            html += `<div class="context-menu-item" data-value="" data-col="${m.target_column}">
                <span class="dot dot-clear"></span> Zurücksetzen
            </div>`;
        } else {
            html += m.items.map(item =>
                `<div class="context-menu-item" data-value="${item.value}" data-col="${m.target_column}">
                    <span class="dot" style="background:${item.color}"></span> ${item.label}
                </div>`
            ).join('');
            html += `<div class="context-menu-item" data-value="" data-col="${m.target_column}">
                <span class="dot dot-clear"></span> Zurücksetzen
            </div>`;
        }
    });

    menu.innerHTML = html;
    document.body.appendChild(menu);

    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', async () => {
            let value = item.dataset.value;
            const col = item.dataset.col;

            // Generate timestamp if needed
            if (value === '__TIMESTAMP__') {
                const now = new Date();
                value = now.getFullYear() + '-' +
                    String(now.getMonth() + 1).padStart(2, '0') + '-' +
                    String(now.getDate()).padStart(2, '0') + ' ' +
                    String(now.getHours()).padStart(2, '0') + ':' +
                    String(now.getMinutes()).padStart(2, '0') + ':' +
                    String(now.getSeconds()).padStart(2, '0');
            }

            const escaped = value.replace(/'/g, "''");
            await ExecuteSQL(`UPDATE messungen SET ${col} = '${escaped}' WHERE id = ${messungId}`);
            menu.remove();

            // Check for workflows that should trigger
            if (value) {
                await checkClientWorkflows(messungId, col, value);
            }

            loadMessungen();
        });
    });

    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', function handler() {
            menu.remove();
            document.removeEventListener('click', handler);
        });
    }, 10);
}

const executedWorkflowIds = new Set();

async function checkClientWorkflows(messungId, changedCol, changedValue, depth = 0) {
    // Prevent infinite cascade loops
    if (depth > 5) return;
    if (depth === 0) executedWorkflowIds.clear();

    // Load the full row data fresh from DB
    let rowData = {};
    try {
        const res = await ExecuteSQL(`SELECT * FROM messungen WHERE id = ${messungId}`);
        const parsed = JSON.parse(res);
        if (parsed.columns && parsed.rows && parsed.rows[0]) {
            parsed.columns.forEach((col, i) => {
                const v = parsed.rows[0][i];
                rowData[col] = v !== null ? String(v) : '';
            });
        }
    } catch { return; }

    // Load active workflows
    let workflows = [];
    try {
        const result = await GetWorkflows();
        workflows = JSON.parse(result) || [];
    } catch { return; }

    const activeWfs = workflows.filter(w => w.active);
    let dbChanged = false; // Track if any workflow wrote to the DB

    for (const wf of activeWfs) {
        let def;
        try { def = JSON.parse(wf.definition); } catch { continue; }

        const nodes = def.nodes || [];
        if (nodes.length === 0) continue;

        // Check trigger
        const trigger = nodes[0];
        if (trigger.type !== 'trigger') continue;

        // Get the field value from the full row
        const fieldVal = rowData[trigger.field] || '';

        // Evaluate trigger condition
        let matches = false;
        switch (trigger.operator) {
            case 'equals': matches = fieldVal.toLowerCase() === (trigger.value || '').toLowerCase(); break;
            case 'not_equals': matches = fieldVal.toLowerCase() !== (trigger.value || '').toLowerCase(); break;
            case 'contains': matches = fieldVal.toLowerCase().includes((trigger.value || '').toLowerCase()); break;
            case 'not_empty': matches = fieldVal !== ''; break;
            case 'empty': matches = fieldVal === ''; break;
            default: matches = false;
        }

        if (!matches) continue;
        if (executedWorkflowIds.has(wf.id)) continue; // Skip already executed
        executedWorkflowIds.add(wf.id);

        // Execute remaining nodes client-side
        for (let i = 1; i < nodes.length; i++) {
            const node = nodes[i];

            if (node.type === 'show_text' && node.display_text) {
                await showTextPopup(node, rowData);
            }

            if (node.type === 'user_input' && node.target_column) {
                const userValue = await showUserInputPopup(node);
                if (userValue !== null) {
                    const esc = userValue.replace(/'/g, "''");
                    await ExecuteSQL(`UPDATE messungen SET ${node.target_column} = '${esc}' WHERE id = ${messungId}`);
                    rowData[node.target_column] = userValue;
                    dbChanged = true;
                }
            }

            if (node.type === 'set_value' && node.target_column) {
                let val = node.set_value || '';
                for (const [k, v] of Object.entries(rowData)) {
                    val = val.replaceAll('{{' + k + '}}', v);
                }
                if (val.includes('{{today}}')) {
                    const now = new Date();
                    val = val.replaceAll('{{today}}', now.toISOString().slice(0, 19).replace('T', ' '));
                }
                const esc = val.replace(/'/g, "''");
                await ExecuteSQL(`UPDATE messungen SET ${node.target_column} = '${esc}' WHERE id = ${messungId}`);
                rowData[node.target_column] = val;
                dbChanged = true;
            }
        }
    }

    // Cascade: if any workflow wrote to the DB, re-check all workflows
    if (dbChanged) {
        await checkClientWorkflows(messungId, null, null, depth + 1);
    }
}

function showTextPopup(node, data) {
    return new Promise((resolve) => {
        document.querySelectorAll('.user-input-overlay').forEach(o => o.remove());

        // Replace placeholders
        let text = node.display_text || '';
        if (data) {
            for (const [key, val] of Object.entries(data)) {
                text = text.replaceAll('{{' + key + '}}', String(val));
            }
        }

        const typeColors = {
            info: { bg: '#e1f5fe', border: '#0277bd', color: '#01579b' },
            warning: { bg: '#fff3e0', border: '#ef6c00', color: '#e65100' },
            error: { bg: '#fce4ec', border: '#c62828', color: '#b71c1c' },
            success: { bg: '#e8f5e9', border: '#2e7d32', color: '#1b5e20' },
        };
        const tc = typeColors[node.display_type] || typeColors.info;

        const overlay = document.createElement('div');
        overlay.className = 'user-input-overlay';
        overlay.innerHTML = `
            <div class="user-input-modal">
                <div class="show-text-box" style="background:${tc.bg};border:2px solid ${tc.border};color:${tc.color};padding:20px;border-radius:8px;font-size:15px;line-height:1.5;white-space:pre-wrap;">
                    ${text}
                </div>
                <div class="user-input-buttons" style="margin-top:16px;">
                    <button class="ui-confirm">OK</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        overlay.querySelector('.ui-confirm').onclick = () => { overlay.remove(); resolve(); };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(); } });
    });
}

function showUserInputPopup(node) {
    return new Promise((resolve) => {
        document.querySelectorAll('.user-input-overlay').forEach(o => o.remove());

        const overlay = document.createElement('div');
        overlay.className = 'user-input-overlay';

        const isSelect = node.input_type === 'select' && node.input_options && node.input_options.length > 0;

        let inputHtml = '';
        if (isSelect) {
            inputHtml = `<div class="ui-button-group">
                ${node.input_options.map(o => `<button class="ui-option-btn" data-value="${o}">${o}</button>`).join('')}
            </div>`;
        } else if (node.input_type === 'textarea') {
            inputHtml = `<textarea id="uiValue" rows="4" placeholder="Eingabe..."></textarea>`;
        } else {
            inputHtml = `<input type="text" id="uiValue" placeholder="Eingabe..." autofocus />`;
        }

        overlay.innerHTML = `
            <div class="user-input-modal">
                <h3>${node.prompt_text || 'Bitte Wert eingeben'}</h3>
                ${!isSelect ? `<div class="user-input-field">
                    <label>${node.target_column}</label>
                    ${inputHtml}
                </div>
                <div class="user-input-buttons">
                    <button class="ui-cancel">Abbrechen</button>
                    <button class="ui-confirm">OK</button>
                </div>` : `
                ${inputHtml}
                <div class="user-input-buttons" style="margin-top:16px;">
                    <button class="ui-cancel">Abbrechen</button>
                </div>`}
            </div>
        `;

        document.body.appendChild(overlay);

        // Button-based selection
        if (isSelect) {
            overlay.querySelectorAll('.ui-option-btn').forEach(btn => {
                btn.addEventListener('click', () => { overlay.remove(); resolve(btn.dataset.value); });
            });
            overlay.querySelector('.ui-cancel').onclick = () => { overlay.remove(); resolve(null); };
            overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(null); } });
            return;
        }

        const valueEl = overlay.querySelector('#uiValue');
        if (valueEl && valueEl.tagName === 'INPUT') valueEl.focus();

        overlay.querySelector('.ui-cancel').onclick = () => { overlay.remove(); resolve(null); };
        overlay.querySelector('.ui-confirm').onclick = () => {
            const val = valueEl.value;
            overlay.remove();
            resolve(val);
        };
        overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(null); } });

        if (valueEl.tagName === 'INPUT') {
            valueEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { overlay.querySelector('.ui-confirm').click(); }
            });
        }
    });
}

async function loadMessungen() {
    const result = await GetMessungen();
    try {
        const parsed = JSON.parse(result);
        if (parsed.error) { alert(parsed.error); allMessungen = []; }
        else allMessungen = parsed;
    } catch { allMessungen = []; }
    renderTable();
}

// ===== DROPDOWNS TAB =====
let selectedKategorie = kategorien[0].key;

function renderDropdownsTab() {
    document.getElementById('tabContent').innerHTML = `
        <div class="dropdown-manager">
            <div class="kategorie-sidebar">
                <h3>Kategorien</h3>
                <ul id="kategorieList">
                    ${kategorien.map(k => `
                        <li class="${k.key === selectedKategorie ? 'active' : ''}" data-key="${k.key}">${k.label}</li>
                    `).join('')}
                </ul>
            </div>
            <div class="kategorie-content">
                <div class="kategorie-header">
                    <h3 id="kategorieTitle">${kategorien.find(k => k.key === selectedKategorie).label}</h3>
                </div>
                <div class="add-row">
                    <input type="text" id="newWert" placeholder="Neuen Wert eingeben..." />
                    <button class="btn btn-primary" id="btnAdd">Hinzufügen</button>
                </div>
                <div class="werte-list" id="werteList">
                    <p class="loading">Laden...</p>
                </div>
            </div>
        </div>
    `;

    document.querySelectorAll('#kategorieList li').forEach(li => {
        li.addEventListener('click', () => {
            selectedKategorie = li.dataset.key;
            renderDropdownsTab();
        });
    });

    document.getElementById('btnAdd').addEventListener('click', addWert);
    document.getElementById('newWert').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addWert();
    });

    loadDropdownWerte();
}

async function addWert() {
    const input = document.getElementById('newWert');
    const wert = input.value.trim();
    if (!wert) return;

    const result = await AddDropdown(selectedKategorie, wert, 0);
    if (result === 'OK') {
        input.value = '';
        loadDropdownWerte();
    } else {
        alert(result);
    }
}

async function loadDropdownWerte() {
    const result = await GetDropdowns(selectedKategorie);
    const list = document.getElementById('werteList');

    try {
        const parsed = JSON.parse(result);
        if (parsed.error) {
            list.innerHTML = `<p class="error">${parsed.error}</p>`;
            return;
        }

        if (parsed.length === 0) {
            list.innerHTML = '<p class="empty">Noch keine Werte vorhanden. Fügen Sie oben einen neuen Wert hinzu.</p>';
            return;
        }

        list.innerHTML = parsed.map(o => `
            <div class="wert-item">
                <span class="wert-text">${o.wert}</span>
                <button class="btn-delete" data-id="${o.id}" title="Löschen">&#10005;</button>
            </div>
        `).join('');

        list.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Wert wirklich löschen?')) return;
                const result = await DeleteDropdown(parseInt(btn.dataset.id));
                if (result === 'OK') loadDropdownWerte();
                else alert(result);
            });
        });
    } catch {
        list.innerHTML = '<p class="error">Fehler beim Laden</p>';
    }
}

// ===== INIT =====
CheckConnection().then((result) => {
    const bar = document.getElementById('statusBar');
    if (result === 'OK') {
        bar.textContent = 'Verbunden mit Server';
        bar.classList.add('connected');
        renderMessungenTab();
    } else {
        bar.textContent = result;
        bar.classList.add('disconnected');
    }
});
