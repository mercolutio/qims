import './einstellungen.css';
import { GetSetting, SaveSetting, ExecuteSQL } from '../wailsjs/go/main/App';

const defaultColors = [
    '#2e7d32', '#c62828', '#ef6c00', '#1565c0', '#7b1fa2',
    '#00838f', '#558b2f', '#d84315', '#4527a0', '#ad1457',
    '#f9a825', '#6d4c41', '#37474f', '#e65100', '#1b5e20',
];

let cmConfig = { menus: [] };
let dbColumns = [];

export async function renderEinstellungenTab() {
    const content = document.getElementById('tabContent');
    content.innerHTML = '<div class="settings-page"><p style="text-align:center;color:#999;padding:40px;">Laden...</p></div>';

    const [settingResult, colResult] = await Promise.all([
        GetSetting('kontextmenu'),
        ExecuteSQL('PRAGMA table_info(messungen)')
    ]);

    // Parse config — support old format (single menu) and new format (multiple menus)
    try {
        const parsed = JSON.parse(settingResult);
        if (parsed.value) {
            const val = JSON.parse(parsed.value);
            if (val.menus) {
                cmConfig = val;
            } else if (val.items) {
                // Migrate old format
                cmConfig = { menus: [{ name: 'Bewertung', target_column: val.target_column || 'messergebnis', items: val.items }] };
            }
        }
    } catch {}

    if (cmConfig.menus.length === 0) {
        cmConfig = { menus: [{ name: 'Bewertung', target_column: 'messergebnis', items: [
            { label: 'OK', value: 'OK', color: '#2e7d32' },
            { label: 'NOK', value: 'NOK', color: '#c62828' },
            { label: 'GZ', value: 'GZ', color: '#ef6c00' },
        ]}]};
    }

    try {
        const parsed = JSON.parse(colResult);
        if (parsed.rows) dbColumns = parsed.rows.map(r => r[1]);
    } catch {}

    renderPage();
}

function renderPage() {
    let html = '<div class="settings-page">';

    cmConfig.menus.forEach((menu, menuIdx) => {
        html += `<div class="settings-section" data-menu="${menuIdx}">
            <div class="settings-section-header">
                <input type="text" class="settings-menu-name" value="${menu.name}" data-menu="${menuIdx}" placeholder="Menü-Name..." />
                <button class="settings-menu-delete" data-menu="${menuIdx}" title="Menü löschen">&#10005;</button>
            </div>
            <div class="settings-field">
                <label>Ziel-Spalte</label>
                <select class="cm-target-col" data-menu="${menuIdx}">
                    ${dbColumns.map(c => `<option value="${c}" ${c === menu.target_column ? 'selected' : ''}>${c}</option>`).join('')}
                </select>
            </div>
            <div class="settings-field">
                <div class="checkbox-row">
                    <input type="checkbox" class="cm-timestamp-check" data-menu="${menuIdx}" ${menu.timestamp_mode ? 'checked' : ''} />
                    <span>Zeitstempel-Modus (schreibt aktuellen Zeitpunkt bei Klick)</span>
                </div>
            </div>
            <div class="settings-field">
                <label>Einträge</label>
                <div class="cm-items-list">
                    ${menu.items.map((item, idx) => `
                        <div class="cm-item" data-menu="${menuIdx}" data-idx="${idx}">
                            <div class="cm-color-dot" style="background:${item.color}" data-menu="${menuIdx}" data-idx="${idx}" title="Farbe ändern"></div>
                            <input type="text" value="${item.label}" data-field="label" data-menu="${menuIdx}" data-idx="${idx}" placeholder="Label" />
                            <input type="text" value="${item.value}" data-field="value" data-menu="${menuIdx}" data-idx="${idx}" placeholder="Wert" style="max-width:100px;" />
                            <button class="cm-item-delete" data-menu="${menuIdx}" data-idx="${idx}">&#10005;</button>
                        </div>
                    `).join('')}
                    ${menu.items.length === 0 ? '<p style="padding:16px;text-align:center;color:#bbb;font-size:13px;">Keine Einträge</p>' : ''}
                </div>
                <button class="cm-add-btn" data-menu="${menuIdx}">+ Eintrag hinzufügen</button>
            </div>
        </div>`;
    });

    html += `<button class="cm-add-menu-btn" id="cmAddMenu">+ Neues Kontextmenü hinzufügen</button>`;
    html += `<div style="margin-top:16px;">
        <button class="settings-save-btn" id="cmSave">Speichern</button>
        <span class="settings-toast" id="cmToast">Gespeichert!</span>
    </div>`;
    html += '</div>';

    document.getElementById('tabContent').innerHTML = html;
    bindEvents();
}

function bindEvents() {
    // Menu name
    document.querySelectorAll('.settings-menu-name').forEach(input => {
        input.addEventListener('input', () => {
            cmConfig.menus[parseInt(input.dataset.menu)].name = input.value;
        });
    });

    // Menu delete
    document.querySelectorAll('.settings-menu-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            cmConfig.menus.splice(parseInt(btn.dataset.menu), 1);
            renderPage();
        });
    });

    // Target column
    document.querySelectorAll('.cm-target-col').forEach(sel => {
        sel.addEventListener('change', () => {
            cmConfig.menus[parseInt(sel.dataset.menu)].target_column = sel.value;
        });
    });

    // Timestamp mode
    document.querySelectorAll('.cm-timestamp-check').forEach(cb => {
        cb.addEventListener('change', () => {
            cmConfig.menus[parseInt(cb.dataset.menu)].timestamp_mode = cb.checked;
        });
    });

    // Label/Value inputs
    document.querySelectorAll('.cm-item input[type="text"]').forEach(input => {
        input.addEventListener('input', () => {
            const menuIdx = parseInt(input.dataset.menu);
            const idx = parseInt(input.dataset.idx);
            cmConfig.menus[menuIdx].items[idx][input.dataset.field] = input.value;
        });
    });

    // Delete items
    document.querySelectorAll('.cm-item-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            cmConfig.menus[parseInt(btn.dataset.menu)].items.splice(parseInt(btn.dataset.idx), 1);
            renderPage();
        });
    });

    // Color dots
    document.querySelectorAll('.cm-color-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
            e.stopPropagation();
            showColorPicker(dot, parseInt(dot.dataset.menu), parseInt(dot.dataset.idx));
        });
    });

    // Add item
    document.querySelectorAll('.cm-add-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const menuIdx = parseInt(btn.dataset.menu);
            const menu = cmConfig.menus[menuIdx];
            const usedColors = new Set(menu.items.map(i => i.color));
            const nextColor = defaultColors.find(c => !usedColors.has(c)) || defaultColors[0];
            menu.items.push({ label: '', value: '', color: nextColor });
            renderPage();
        });
    });

    // Add menu
    document.getElementById('cmAddMenu')?.addEventListener('click', () => {
        cmConfig.menus.push({ name: 'Neues Menü', target_column: dbColumns[0] || '', items: [] });
        renderPage();
    });

    // Save
    document.getElementById('cmSave')?.addEventListener('click', async () => {
        await SaveSetting('kontextmenu', JSON.stringify(cmConfig));
        const toast = document.getElementById('cmToast');
        if (toast) { toast.classList.add('visible'); setTimeout(() => toast.classList.remove('visible'), 2000); }
    });
}

function showColorPicker(dot, menuIdx, itemIdx) {
    document.querySelectorAll('.cm-color-picker').forEach(p => p.remove());

    const picker = document.createElement('div');
    picker.className = 'cm-color-picker';
    picker.innerHTML = defaultColors.map(c =>
        `<div class="cm-color-option ${cmConfig.menus[menuIdx].items[itemIdx].color === c ? 'selected' : ''}" data-color="${c}" style="background:${c}"></div>`
    ).join('');

    dot.parentElement.style.position = 'relative';
    dot.parentElement.appendChild(picker);

    picker.querySelectorAll('.cm-color-option').forEach(opt => {
        opt.addEventListener('click', () => {
            cmConfig.menus[menuIdx].items[itemIdx].color = opt.dataset.color;
            dot.style.background = opt.dataset.color;
            picker.remove();
        });
    });

    setTimeout(() => {
        document.addEventListener('click', function handler(e) {
            if (!picker.contains(e.target) && e.target !== dot) { picker.remove(); document.removeEventListener('click', handler); }
        });
    }, 10);
}

// Export for main.js
export async function loadContextMenuConfig() {
    try {
        const result = await GetSetting('kontextmenu');
        const parsed = JSON.parse(result);
        if (parsed.value) {
            const val = JSON.parse(parsed.value);
            if (val.menus) return val;
            if (val.items) return { menus: [{ name: 'Bewertung', target_column: val.target_column, items: val.items }] };
        }
    } catch {}
    return { menus: [{ name: 'Bewertung', target_column: 'messergebnis', items: [
        { label: 'OK', value: 'OK', color: '#2e7d32' },
        { label: 'NOK', value: 'NOK', color: '#c62828' },
        { label: 'GZ', value: 'GZ', color: '#ef6c00' },
    ]}]};
}
