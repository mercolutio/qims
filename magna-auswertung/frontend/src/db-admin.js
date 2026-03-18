import './db-admin.css';
import { GetDBTables, ExecuteSQL } from '../wailsjs/go/main/App';

let tables = [];
let selectedTable = null;
let tableData = { columns: [], rows: [] };

export function renderDBAdminTab() {
    const content = document.getElementById('tabContent');
    content.innerHTML = `
        <div class="db-admin">
            <div class="db-admin-top">
                <div class="db-tables">
                    <h3>Tabellen</h3>
                    <div id="dbTableList">Laden...</div>
                </div>
                <div class="db-data" id="dbDataPanel">
                    <div class="db-data-header">
                        <h3 id="dbTableName">Tabelle wählen</h3>
                        <button class="db-btn-add-col" id="dbAddColumn" style="display:none;">+ Spalte</button>
                        <button class="db-btn-add-row" id="dbAddRow" style="display:none;">+ Zeile</button>
                        <span class="row-count" id="dbRowCount"></span>
                    </div>
                    <div class="db-data-scroll" id="dbDataScroll">
                        <p style="padding:40px;text-align:center;color:#bbb;">Klicke links auf eine Tabelle</p>
                    </div>
                </div>
            </div>
            <div class="db-console">
                <h3>SQL Konsole</h3>
                <div class="db-console-input">
                    <textarea id="dbSqlInput" placeholder="SELECT * FROM messungen LIMIT 10;"></textarea>
                    <button class="btn-run" id="dbRunSql">Ausführen</button>
                </div>
                <div class="db-console-result" id="dbSqlResult"></div>
            </div>
        </div>
    `;

    loadTables();

    document.getElementById('dbRunSql').addEventListener('click', runSQL);
    document.getElementById('dbSqlInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            runSQL();
        }
    });
}

async function loadTables() {
    const result = await GetDBTables();
    try {
        tables = JSON.parse(result);
    } catch { tables = []; }

    const list = document.getElementById('dbTableList');
    if (tables.length === 0) {
        list.innerHTML = '<p style="color:#bbb;font-size:12px;">Keine Tabellen</p>';
        return;
    }

    list.innerHTML = tables.map(t => `
        <div class="db-table-item ${t === selectedTable ? 'active' : ''}" data-table="${t}">${t}</div>
    `).join('');

    list.querySelectorAll('.db-table-item').forEach(item => {
        item.addEventListener('click', () => {
            selectedTable = item.dataset.table;
            loadTableData(selectedTable);
            // Update active state
            list.querySelectorAll('.db-table-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
        });
    });
}

async function loadTableData(tableName) {
    document.getElementById('dbTableName').textContent = tableName;
    document.getElementById('dbDataScroll').innerHTML = '<p style="padding:20px;text-align:center;color:#bbb;">Laden...</p>';

    const result = await ExecuteSQL('SELECT * FROM ' + tableName + ' ORDER BY id DESC LIMIT 500');
    try {
        tableData = JSON.parse(result);
    } catch {
        tableData = { columns: [], rows: [], error: 'Parse error' };
    }

    if (tableData.error) {
        document.getElementById('dbDataScroll').innerHTML = `<p style="padding:20px;color:red;">${tableData.error}</p>`;
        return;
    }

    document.getElementById('dbRowCount').textContent = `${tableData.rows.length} Zeilen`;
    document.getElementById('dbAddColumn').style.display = 'inline-block';
    document.getElementById('dbAddRow').style.display = 'inline-block';

    // Bind add column/row buttons
    document.getElementById('dbAddColumn').onclick = showAddColumnDialog;
    document.getElementById('dbAddRow').onclick = addRow;

    renderTableData();
}

function showAddColumnDialog() {
    // Remove existing modal
    document.querySelectorAll('.db-modal-overlay').forEach(m => m.remove());

    const overlay = document.createElement('div');
    overlay.className = 'db-modal-overlay';
    overlay.innerHTML = `
        <div class="db-modal">
            <h3>Spalte hinzufügen</h3>
            <div class="db-modal-field">
                <label>Spaltenname</label>
                <input type="text" id="dbColName" placeholder="z.B. status" />
            </div>
            <div class="db-modal-field">
                <label>Datentyp</label>
                <select id="dbColType">
                    <option value="TEXT">TEXT</option>
                    <option value="INTEGER">INTEGER</option>
                    <option value="REAL">REAL</option>
                    <option value="DATETIME">DATETIME</option>
                    <option value="BOOLEAN">BOOLEAN</option>
                </select>
            </div>
            <div class="db-modal-field">
                <label>Standardwert (optional)</label>
                <input type="text" id="dbColDefault" placeholder="" />
            </div>
            <div class="db-modal-error" id="dbColError" style="display:none;color:#c62828;font-size:13px;padding:8px;background:#fce4ec;border-radius:4px;margin-top:4px;"></div>
            <div class="db-modal-buttons">
                <button class="db-modal-btn cancel" id="dbColCancel">Abbrechen</button>
                <button class="db-modal-btn confirm" id="dbColConfirm">Hinzufügen</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('dbColName').focus();
    document.getElementById('dbColCancel').onclick = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    document.getElementById('dbColConfirm').onclick = async () => {
        const name = document.getElementById('dbColName').value.trim();
        if (!name) { document.getElementById('dbColName').style.borderColor = 'red'; return; }

        const colName = name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
        const colType = document.getElementById('dbColType').value;
        const defaultVal = document.getElementById('dbColDefault').value.trim();

        let query = 'ALTER TABLE ' + selectedTable + ' ADD COLUMN ' + colName + ' ' + colType;
        if (defaultVal) {
            query += " DEFAULT '" + defaultVal.replace(/'/g, "''") + "'";
        }

        const errDiv = document.getElementById('dbColError');
        errDiv.style.display = 'none';

        const result = await ExecuteSQL(query);
        try {
            const parsed = JSON.parse(result);
            if (parsed.error) {
                errDiv.textContent = parsed.error;
                errDiv.style.display = 'block';
                return;
            }
        } catch {}

        overlay.remove();
        loadTableData(selectedTable);
    };

    document.getElementById('dbColName').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('dbColConfirm').click();
    });
}

async function addRow() {
    // Insert a row with default/empty values
    const query = `INSERT INTO ${selectedTable} DEFAULT VALUES`;
    const result = await ExecuteSQL(query);
    try {
        const parsed = JSON.parse(result);
        if (parsed.error) {
            // If DEFAULT VALUES doesn't work, try with explicit NULLs
            const cols = tableData.columns.filter(c => c !== 'id');
            const vals = cols.map(() => "''").join(', ');
            const query2 = `INSERT INTO ${selectedTable} (${cols.join(', ')}) VALUES (${vals})`;
            const result2 = await ExecuteSQL(query2);
            const parsed2 = JSON.parse(result2);
            if (parsed2.error) {
                alert('Fehler: ' + parsed2.error);
                return;
            }
        }
    } catch {}

    loadTableData(selectedTable);
}

function renderTableData() {
    const container = document.getElementById('dbDataScroll');
    if (!tableData.columns || tableData.columns.length === 0) {
        container.innerHTML = '<p style="padding:20px;text-align:center;color:#bbb;">Keine Daten</p>';
        return;
    }

    const hasId = tableData.columns.includes('id');

    let html = '<table><thead><tr>';
    html += tableData.columns.map(c => `<th>${c}</th>`).join('');
    if (hasId) html += '<th></th>';
    html += '</tr></thead><tbody>';

    for (let rowIdx = 0; rowIdx < tableData.rows.length; rowIdx++) {
        const row = tableData.rows[rowIdx];
        html += '<tr>';
        for (let colIdx = 0; colIdx < row.length; colIdx++) {
            const val = row[colIdx];
            const isId = tableData.columns[colIdx] === 'id';
            const displayVal = val === null ? '<span class="null-value">NULL</span>' : escapeHtml(String(val));
            const truncated = val !== null && String(val).length > 80
                ? escapeHtml(String(val).substring(0, 80)) + '...'
                : displayVal;

            if (isId) {
                html += `<td>${displayVal}</td>`;
            } else {
                html += `<td class="editable" data-row="${rowIdx}" data-col="${colIdx}">${truncated}</td>`;
            }
        }
        if (hasId) {
            const idColIdx = tableData.columns.indexOf('id');
            const rowId = row[idColIdx];
            html += `<td><button class="db-row-delete" data-id="${rowId}" title="Zeile löschen">&#10005;</button></td>`;
        }
        html += '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;

    // Bind double-click for inline editing
    container.querySelectorAll('td.editable').forEach(td => {
        td.addEventListener('dblclick', () => startEditing(td));
    });

    // Bind row delete (double-click to confirm)
    container.querySelectorAll('.db-row-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('confirm')) {
                // Second click = delete
                ExecuteSQL('DELETE FROM ' + selectedTable + ' WHERE id = ' + btn.dataset.id).then(() => {
                    loadTableData(selectedTable);
                });
            } else {
                // First click = show confirm state
                container.querySelectorAll('.db-row-delete.confirm').forEach(b => {
                    b.classList.remove('confirm');
                    b.innerHTML = '&#10005;';
                });
                btn.classList.add('confirm');
                btn.innerHTML = 'Löschen?';
                // Reset after 3 seconds
                setTimeout(() => {
                    if (btn.classList.contains('confirm')) {
                        btn.classList.remove('confirm');
                        btn.innerHTML = '&#10005;';
                    }
                }, 3000);
            }
        });
    });
}

function startEditing(td) {
    if (td.classList.contains('editing')) return;

    const rowIdx = parseInt(td.dataset.row);
    const colIdx = parseInt(td.dataset.col);
    const currentVal = tableData.rows[rowIdx][colIdx];
    const colName = tableData.columns[colIdx];

    td.classList.add('editing');
    td.innerHTML = `<input type="text" value="${currentVal !== null ? escapeHtml(String(currentVal)) : ''}" />`;

    const input = td.querySelector('input');
    input.focus();
    input.select();

    const save = async () => {
        const newVal = input.value;
        const idColIdx = tableData.columns.indexOf('id');
        const rowId = tableData.rows[rowIdx][idColIdx];

        if (String(newVal) !== String(currentVal || '')) {
            const escaped = newVal.replace(/'/g, "''");
            const query = `UPDATE ${selectedTable} SET ${colName} = '${escaped}' WHERE id = ${rowId}`;
            const result = await ExecuteSQL(query);
            try {
                const parsed = JSON.parse(result);
                if (parsed.error) {
                    alert('Fehler: ' + parsed.error);
                    td.classList.remove('editing');
                    td.textContent = currentVal !== null ? String(currentVal) : '';
                    return;
                }
            } catch {}
            tableData.rows[rowIdx][colIdx] = newVal;
        }

        td.classList.remove('editing');
        td.textContent = newVal || '';
    };

    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') {
            td.classList.remove('editing');
            td.textContent = currentVal !== null ? String(currentVal) : '';
        }
    });
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// SQL Console
async function runSQL() {
    const input = document.getElementById('dbSqlInput');
    const query = input.value.trim();
    if (!query) return;

    const resultDiv = document.getElementById('dbSqlResult');
    resultDiv.className = 'db-console-result';
    resultDiv.textContent = 'Ausführen...';

    const result = await ExecuteSQL(query);
    let parsed;
    try { parsed = JSON.parse(result); } catch {
        resultDiv.className = 'db-console-result error';
        resultDiv.textContent = 'Fehler beim Parsen der Antwort';
        return;
    }

    if (parsed.error) {
        resultDiv.className = 'db-console-result error';
        resultDiv.textContent = parsed.error;
        return;
    }

    if (parsed.type === 'exec') {
        resultDiv.textContent = `Erfolgreich. ${parsed.affected} Zeile(n) betroffen.`;
        // Reload table if one is selected
        if (selectedTable) loadTableData(selectedTable);
        return;
    }

    // SELECT result
    if (!parsed.columns || parsed.columns.length === 0) {
        resultDiv.textContent = 'Keine Ergebnisse.';
        return;
    }

    let html = `<p>${parsed.rows.length} Ergebnis(se)</p><table><tr>`;
    html += parsed.columns.map(c => `<th>${c}</th>`).join('');
    html += '</tr>';
    for (const row of parsed.rows) {
        html += '<tr>' + row.map(v => `<td>${v === null ? '<em>NULL</em>' : escapeHtml(String(v))}</td>`).join('') + '</tr>';
    }
    html += '</table>';
    resultDiv.innerHTML = html;
}
