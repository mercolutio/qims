import './pruefplan.css';
import { GetPruefplan, SavePruefplanEntry, UpdatePruefplanEntry, DeletePruefplanEntry, GetDropdowns, GetDurchfuehrungen } from '../wailsjs/go/main/App';

let pruefplanData = [];
let durchfuehrungen = [];
let dropdownCache = {};
let activeView = 'durchfuehrungen'; // 'durchfuehrungen' or 'definitionen'

const haeufigkeiten = [
    { value: 'pro_schicht', label: 'Pro Schicht' },
    { value: 'taeglich', label: 'Täglich' },
    { value: 'woechentlich', label: 'Wöchentlich' },
    { value: 'monatlich', label: 'Monatlich' },
    { value: 'quartal', label: 'Quartalsweise' },
    { value: 'jaehrlich', label: 'Jährlich' },
];

export async function renderPruefplanTab() {
    const content = document.getElementById('tabContent');
    content.innerHTML = `
        <div class="pruefplan">
            <div class="pp-toolbar">
                <div class="pp-view-toggle">
                    <button class="pp-view-btn ${activeView === 'durchfuehrungen' ? 'active' : ''}" data-view="durchfuehrungen">Durchführungen</button>
                    <button class="pp-view-btn ${activeView === 'definitionen' ? 'active' : ''}" data-view="definitionen">Prüfpläne</button>
                </div>
                <button class="btn btn-primary" id="ppAdd" style="${activeView === 'definitionen' ? '' : 'display:none'}">+ Prüfung anlegen</button>
                <button class="btn" id="ppRefresh">Aktualisieren</button>
                <span class="count" id="ppCount"></span>
            </div>
            <div class="pp-table" id="ppTable">
                <p style="padding:40px;text-align:center;color:#bbb;">Laden...</p>
            </div>
        </div>
    `;

    document.querySelectorAll('.pp-view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            activeView = btn.dataset.view;
            renderPruefplanTab();
        });
    });

    document.getElementById('ppAdd').addEventListener('click', () => showEntryModal(null));
    document.getElementById('ppRefresh').addEventListener('click', () => {
        if (activeView === 'durchfuehrungen') loadDurchfuehrungen();
        else loadPruefplan();
    });

    for (const kat of ['fertigungsbereich', 'abteilung_zsb', 'station', 'pruefart']) {
        try {
            const result = await GetDropdowns(kat);
            dropdownCache[kat] = JSON.parse(result).map(o => o.wert);
        } catch { dropdownCache[kat] = []; }
    }

    if (activeView === 'durchfuehrungen') loadDurchfuehrungen();
    else loadPruefplan();
}

// ===== DURCHFÜHRUNGEN VIEW =====

async function loadDurchfuehrungen() {
    const result = await GetDurchfuehrungen('', '');
    try { durchfuehrungen = JSON.parse(result); } catch { durchfuehrungen = []; }
    renderDurchfuehrungenTable();
}

function renderDurchfuehrungenTable() {
    const container = document.getElementById('ppTable');
    document.getElementById('ppCount').textContent = `${durchfuehrungen.length} Durchführung${durchfuehrungen.length !== 1 ? 'en' : ''}`;

    if (durchfuehrungen.length === 0) {
        container.innerHTML = '<p style="padding:40px;text-align:center;color:#bbb;">Keine Durchführungen vorhanden.</p>';
        return;
    }

    const today = new Date().toISOString().split('T')[0];

    let html = `<table><thead><tr>
        <th>Bezeichnung</th>
        <th>Fert.bereich</th>
        <th>Abteilung</th>
        <th>Station</th>
        <th>Prüfart</th>
        <th>Fälligkeit</th>
        <th>Uhrzeit</th>
        <th>Status</th>
        <th>Gebracht von</th>
        <th>Gebracht am</th>
        <th>Gemessen am</th>
        <th>Messung</th>
    </tr></thead><tbody>`;

    for (const d of durchfuehrungen) {
        let statusClass = '';
        let statusText = d.status;

        switch (d.status) {
            case 'offen':
                if (d.faelligkeit_datum < today) {
                    statusClass = 'faellig';
                    statusText = 'Überfällig';
                } else if (d.faelligkeit_datum === today) {
                    statusClass = 'heute';
                    statusText = 'Offen';
                } else {
                    statusClass = 'inaktiv';
                    statusText = 'Geplant';
                }
                break;
            case 'gebracht':
                statusClass = 'gebracht';
                statusText = 'Gebracht';
                break;
            case 'gemessen':
                statusClass = 'ok';
                statusText = 'Gemessen';
                break;
        }

        html += `<tr>
            <td><strong>${d.bezeichnung}</strong></td>
            <td>${d.fertigungsbereich || ''}</td>
            <td>${d.abteilung || ''}</td>
            <td>${d.station || ''}</td>
            <td>${d.pruefart || ''}</td>
            <td>${formatDate(d.faelligkeit_datum)}</td>
            <td>${d.faelligkeit_uhrzeit || ''}</td>
            <td><span class="pp-status ${statusClass}">${statusText}</span></td>
            <td>${d.gebracht_von || '-'}</td>
            <td>${d.gebracht_am ? d.gebracht_am.substring(11, 16) : '-'}</td>
            <td>${d.gemessen_am ? d.gemessen_am.substring(11, 16) : '-'}</td>
            <td>${d.messung_id ? `<a href="#" class="pp-messung-link" data-id="${d.messung_id}">#${d.messung_id}</a>` : '-'}</td>
        </tr>`;
    }

    html += '</tbody></table>';
    container.innerHTML = html;

    // Click on Messung link → switch to Messungen tab and search for ID
    container.querySelectorAll('.pp-messung-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const messungId = link.dataset.id;
            // Switch to Messungen tab
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            const messungenTab = document.querySelector('.tab[data-tab="messungen"]');
            if (messungenTab) {
                messungenTab.classList.add('active');
                messungenTab.click();
                // Set search to the ID after a short delay
                setTimeout(() => {
                    const searchInput = document.getElementById('searchInput');
                    if (searchInput) {
                        searchInput.value = messungId;
                        searchInput.dispatchEvent(new Event('input'));
                    }
                }, 300);
            }
        });
    });
}

// ===== DEFINITIONEN VIEW (original) =====

async function loadPruefplan() {
    const result = await GetPruefplan();
    try { pruefplanData = JSON.parse(result); } catch { pruefplanData = []; }
    renderDefinitionenTable();
}

function renderDefinitionenTable() {
    const container = document.getElementById('ppTable');
    document.getElementById('ppCount').textContent = `${pruefplanData.length} Prüfung${pruefplanData.length !== 1 ? 'en' : ''}`;

    if (pruefplanData.length === 0) {
        container.innerHTML = '<p style="padding:40px;text-align:center;color:#bbb;">Keine Prüfungen angelegt.</p>';
        return;
    }

    const today = new Date().toISOString().split('T')[0];
    const nowTime = new Date().getHours().toString().padStart(2,'0') + ':' + new Date().getMinutes().toString().padStart(2,'0');

    let html = `<table><thead><tr>
        <th>Bezeichnung</th>
        <th>Fertigungsbereich</th>
        <th>Abteilung</th>
        <th>Station</th>
        <th>Prüfart</th>
        <th>Häufigkeit</th>
        <th>Ziel-Uhrzeit</th>
        <th>Nächste Fälligkeit</th>
        <th>Status</th>
        <th></th>
    </tr></thead><tbody>`;

    for (const entry of pruefplanData) {
        const faelligkeit = entry.naechste_faelligkeit || '';
        const zielUhrzeit = entry.ziel_uhrzeit || '07:00';
        let statusClass = 'ok';
        let statusText = 'OK';

        if (!entry.aktiv) {
            statusClass = 'inaktiv';
            statusText = 'Inaktiv';
        } else if (!faelligkeit) {
            statusClass = 'inaktiv';
            statusText = 'Nicht geplant';
        } else if (faelligkeit < today) {
            statusClass = 'faellig';
            statusText = 'Überfällig';
        } else if (faelligkeit === today && nowTime >= zielUhrzeit) {
            statusClass = 'heute';
            statusText = 'Jetzt fällig';
        } else if (faelligkeit === today && nowTime < zielUhrzeit) {
            statusClass = 'ok';
            statusText = `Ab ${zielUhrzeit} fällig`;
        } else {
            statusClass = 'ok';
            statusText = 'Geplant';
        }

        const hLabel = haeufigkeiten.find(h => h.value === entry.haeufigkeit)?.label || entry.haeufigkeit;

        html += `<tr>
            <td><strong>${entry.bezeichnung || ''}</strong></td>
            <td>${entry.fertigungsbereich || ''}</td>
            <td>${entry.abteilung || ''}</td>
            <td>${entry.station || ''}</td>
            <td>${entry.pruefart || ''}</td>
            <td><span class="pp-haeufigkeit">${hLabel}</span></td>
            <td>${zielUhrzeit} Uhr</td>
            <td>${faelligkeit ? formatDate(faelligkeit) : '-'}</td>
            <td><span class="pp-status ${statusClass}">${statusText}</span></td>
            <td class="pp-actions">
                <button title="Bearbeiten" data-id="${entry.id}" class="pp-edit">&#9998;</button>
                <button title="Löschen" data-id="${entry.id}" class="pp-del delete">&#10005;</button>
            </td>
        </tr>`;
    }

    html += '</tbody></table>';
    container.innerHTML = html;

    container.querySelectorAll('.pp-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const entry = pruefplanData.find(e => e.id == btn.dataset.id);
            if (entry) showEntryModal(entry);
        });
    });

    container.querySelectorAll('.pp-del').forEach(btn => {
        btn.addEventListener('click', async () => {
            await DeletePruefplanEntry(parseInt(btn.dataset.id));
            loadPruefplan();
        });
    });
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) return `${parts[2]}.${parts[1]}.${parts[0]}`;
    return dateStr;
}

function showEntryModal(entry) {
    document.querySelectorAll('.pp-modal-overlay').forEach(m => m.remove());
    const isEdit = !!entry;
    const overlay = document.createElement('div');
    overlay.className = 'pp-modal-overlay';

    overlay.innerHTML = `
        <div class="pp-modal">
            <h3>${isEdit ? 'Prüfung bearbeiten' : 'Neue Prüfung anlegen'}</h3>
            <div class="pp-modal-field">
                <label>Bezeichnung</label>
                <input type="text" id="ppBezeichnung" value="${entry?.bezeichnung || ''}" />
            </div>
            <div class="pp-modal-row">
                <div class="pp-modal-field">
                    <label>Fertigungsbereich</label>
                    <select id="ppFertigungsbereich">
                        <option value=""></option>
                        ${(dropdownCache['fertigungsbereich'] || []).map(v => `<option value="${v}" ${v === entry?.fertigungsbereich ? 'selected' : ''}>${v}</option>`).join('')}
                    </select>
                </div>
                <div class="pp-modal-field">
                    <label>Abteilung</label>
                    <select id="ppAbteilung">
                        <option value=""></option>
                        ${(dropdownCache['abteilung_zsb'] || []).map(v => `<option value="${v}" ${v === entry?.abteilung ? 'selected' : ''}>${v}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="pp-modal-row">
                <div class="pp-modal-field">
                    <label>Station</label>
                    <select id="ppStation">
                        <option value=""></option>
                        ${(dropdownCache['station'] || []).map(v => `<option value="${v}" ${v === entry?.station ? 'selected' : ''}>${v}</option>`).join('')}
                    </select>
                </div>
                <div class="pp-modal-field">
                    <label>Prüfart</label>
                    <select id="ppPruefart">
                        <option value=""></option>
                        ${(dropdownCache['pruefart'] || []).map(v => `<option value="${v}" ${v === entry?.pruefart ? 'selected' : ''}>${v}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="pp-modal-row">
                <div class="pp-modal-field">
                    <label>Häufigkeit</label>
                    <select id="ppHaeufigkeit">
                        ${haeufigkeiten.map(h => `<option value="${h.value}" ${h.value === entry?.haeufigkeit ? 'selected' : ''}>${h.label}</option>`).join('')}
                    </select>
                </div>
                <div class="pp-modal-field">
                    <label>Ziel-Uhrzeit</label>
                    <input type="time" id="ppZielUhrzeit" value="${entry?.ziel_uhrzeit || '07:00'}" />
                </div>
            </div>
            <div class="pp-modal-row">
                <div class="pp-modal-field">
                    <label>Nächste Fälligkeit</label>
                    <input type="date" id="ppFaelligkeit" value="${entry?.naechste_faelligkeit || new Date().toISOString().split('T')[0]}" />
                </div>
            </div>
            <div class="pp-modal-buttons">
                <button class="cancel" id="ppCancel">Abbrechen</button>
                <button class="confirm" id="ppConfirm">${isEdit ? 'Speichern' : 'Anlegen'}</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    document.getElementById('ppCancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    document.getElementById('ppConfirm').addEventListener('click', async () => {
        const data = {
            bezeichnung: document.getElementById('ppBezeichnung').value,
            fertigungsbereich: document.getElementById('ppFertigungsbereich').value,
            abteilung: document.getElementById('ppAbteilung').value,
            station: document.getElementById('ppStation').value,
            pruefart: document.getElementById('ppPruefart').value,
            haeufigkeit: document.getElementById('ppHaeufigkeit').value,
            ziel_uhrzeit: document.getElementById('ppZielUhrzeit').value,
            naechste_faelligkeit: document.getElementById('ppFaelligkeit').value,
            intervall_wert: 1,
        };

        if (!data.bezeichnung) return;

        if (isEdit) await UpdatePruefplanEntry(entry.id, JSON.stringify(data));
        else await SavePruefplanEntry(JSON.stringify(data));

        overlay.remove();
        loadPruefplan();
    });
}
