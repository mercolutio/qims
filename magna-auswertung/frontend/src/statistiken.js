import './statistiken.css';
import { ExecuteSQL } from '../wailsjs/go/main/App';

async function query(sql) {
    const result = await ExecuteSQL(sql);
    try {
        const parsed = JSON.parse(result);
        if (parsed.error) return { columns: [], rows: [] };
        return parsed;
    } catch { return { columns: [], rows: [] }; }
}

export async function renderStatistikenTab() {
    const content = document.getElementById('tabContent');
    content.innerHTML = '<div class="stats-dashboard"><p style="text-align:center;color:#999;padding:40px;">Dashboard wird geladen...</p></div>';

    // Load all data in parallel
    const [totalRes, ergebnisRes, fbRes, zweckRes, stationRes, ppRes, wfRes, punctRes] = await Promise.all([
        query("SELECT COUNT(*) as c FROM messungen"),
        query("SELECT messergebnis, COUNT(*) as c FROM messungen WHERE messergebnis != '' AND messergebnis IS NOT NULL GROUP BY messergebnis"),
        query("SELECT fertigungsbereich, COUNT(*) as c FROM messungen WHERE fertigungsbereich != '' GROUP BY fertigungsbereich ORDER BY c DESC"),
        query("SELECT pruefzweck, COUNT(*) as c FROM messungen WHERE pruefzweck != '' GROUP BY pruefzweck ORDER BY c DESC"),
        query("SELECT station, messergebnis, COUNT(*) as c FROM messungen WHERE station != '' AND messergebnis != '' GROUP BY station, messergebnis"),
        query("SELECT SUM(CASE WHEN naechste_faelligkeit < date('now') THEN 1 ELSE 0 END) as ueberfaellig, SUM(CASE WHEN naechste_faelligkeit = date('now') THEN 1 ELSE 0 END) as heute, SUM(CASE WHEN naechste_faelligkeit > date('now') THEN 1 ELSE 0 END) as geplant, COUNT(*) as gesamt FROM pruefplan WHERE aktiv = 1"),
        query("SELECT node_type, status, details, erstellt_am FROM workflow_logs ORDER BY id DESC LIMIT 5"),
        query(`SELECT d.id, p.bezeichnung, d.faelligkeit_datum, d.faelligkeit_uhrzeit, d.gebracht_am, d.gemessen_am, d.status,
            CASE
                WHEN d.gebracht_am IS NULL THEN 'offen'
                WHEN substr(d.gebracht_am, 12, 5) <= d.faelligkeit_uhrzeit THEN 'frueh'
                WHEN substr(d.gebracht_am, 12, 5) <= substr(d.faelligkeit_uhrzeit, 1, 2) || ':' || printf('%02d', CAST(substr(d.faelligkeit_uhrzeit, 4, 2) AS INTEGER) + 15) THEN 'puenktlich'
                ELSE 'spaet'
            END as timing
            FROM pruefplan_durchfuehrungen d
            JOIN pruefplan p ON d.pruefplan_id = p.id
            WHERE d.status != 'offen'
            ORDER BY d.faelligkeit_datum DESC, d.faelligkeit_uhrzeit ASC
            LIMIT 20`),
    ]);

    // Parse data
    const total = totalRes.rows[0]?.[0] || 0;

    const ergebnis = {};
    for (const row of ergebnisRes.rows) {
        ergebnis[row[0]] = row[1];
    }
    const okCount = ergebnis['OK'] || 0;
    const nokCount = ergebnis['NOK'] || 0;
    const gzCount = ergebnis['GZ'] || 0;
    const evaluatedTotal = okCount + nokCount + gzCount;
    const okRate = evaluatedTotal > 0 ? Math.round(okCount / evaluatedTotal * 100) : 0;
    const nokRate = evaluatedTotal > 0 ? Math.round(nokCount / evaluatedTotal * 100) : 0;

    const ppData = ppRes.rows[0] || [0, 0, 0, 0];
    const ppUeberfaellig = ppData[0] || 0;
    const ppHeute = ppData[1] || 0;
    const ppGeplant = ppData[2] || 0;
    const ppGesamt = ppData[3] || 0;
    const ppCompliance = ppGesamt > 0 ? Math.round((ppGesamt - ppUeberfaellig) / ppGesamt * 100) : 100;

    // Build dashboard
    let html = '<div class="stats-dashboard">';

    // === ROW 1: KPIs ===
    html += `<div class="stats-kpis">
        <div class="kpi-card">
            <div class="kpi-value dark">${total}</div>
            <div class="kpi-label">Messungen gesamt</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-value green">${okRate}%</div>
            <div class="kpi-label">OK-Rate</div>
            <div class="kpi-sub">${okCount} von ${evaluatedTotal} bewertet</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-value red">${nokRate}%</div>
            <div class="kpi-label">NOK-Rate</div>
            <div class="kpi-sub">${nokCount} von ${evaluatedTotal} bewertet</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-value ${ppCompliance >= 80 ? 'green' : ppCompliance >= 50 ? 'orange' : 'red'}">${ppCompliance}%</div>
            <div class="kpi-label">Prüfplan-Compliance</div>
            <div class="kpi-sub">${ppUeberfaellig} überfällig von ${ppGesamt}</div>
        </div>
    </div>`;

    // === ROW 2: Donut + Fertigungsbereich ===
    html += '<div class="stats-row">';

    // Donut Chart
    const noneCount = total - evaluatedTotal;
    let gradientParts = [];
    let offset = 0;
    const addSlice = (count, color) => {
        if (count <= 0 || total <= 0) return;
        const pct = count / total * 100;
        gradientParts.push(`${color} ${offset}% ${offset + pct}%`);
        offset += pct;
    };
    addSlice(okCount, '#2e7d32');
    addSlice(nokCount, '#c62828');
    addSlice(gzCount, '#ef6c00');
    addSlice(noneCount, '#ddd');
    const gradient = gradientParts.length > 0 ? gradientParts.join(', ') : '#ddd 0% 100%';

    html += `<div class="stats-card">
        <h3>Messergebnis-Verteilung</h3>
        <div class="donut-container">
            <div class="donut" style="background: conic-gradient(${gradient});">
                <div class="donut-hole">
                    <span class="donut-total">${evaluatedTotal}</span>
                    <span class="donut-label">bewertet</span>
                </div>
            </div>
            <div class="donut-legend">
                <div class="donut-legend-item"><span class="legend-dot ok"></span> OK <span class="legend-value">${okCount}</span></div>
                <div class="donut-legend-item"><span class="legend-dot nok"></span> NOK <span class="legend-value">${nokCount}</span></div>
                <div class="donut-legend-item"><span class="legend-dot gz"></span> GZ <span class="legend-value">${gzCount}</span></div>
                ${noneCount > 0 ? `<div class="donut-legend-item"><span class="legend-dot none"></span> Nicht bewertet <span class="legend-value">${noneCount}</span></div>` : ''}
            </div>
        </div>
    </div>`;

    // Fertigungsbereich Bar Chart
    const fbMax = Math.max(...fbRes.rows.map(r => r[1]), 1);
    html += `<div class="stats-card">
        <h3>Messungen pro Fertigungsbereich</h3>
        <div class="bar-chart">
            ${fbRes.rows.map(r => `
                <div class="bar-row">
                    <span class="bar-label">${r[0]}</span>
                    <div class="bar-track"><div class="bar-fill red" style="width: ${r[1] / fbMax * 100}%"></div></div>
                    <span class="bar-count">${r[1]}</span>
                </div>
            `).join('')}
            ${fbRes.rows.length === 0 ? '<p class="stats-empty">Keine Daten</p>' : ''}
        </div>
    </div>`;
    html += '</div>';

    // === ROW 3: Prüfzweck + Station ===
    html += '<div class="stats-row">';

    // Prüfzweck Bar Chart
    const zweckMax = Math.max(...zweckRes.rows.map(r => r[1]), 1);
    html += `<div class="stats-card">
        <h3>Messungen nach Prüfzweck</h3>
        <div class="bar-chart">
            ${zweckRes.rows.map(r => `
                <div class="bar-row">
                    <span class="bar-label">${r[0]}</span>
                    <div class="bar-track"><div class="bar-fill dark" style="width: ${r[1] / zweckMax * 100}%"></div></div>
                    <span class="bar-count">${r[1]}</span>
                </div>
            `).join('')}
            ${zweckRes.rows.length === 0 ? '<p class="stats-empty">Keine Daten</p>' : ''}
        </div>
    </div>`;

    // Station Stacked Bar Chart
    const stationData = {};
    for (const row of stationRes.rows) {
        const station = row[0];
        const result = row[1];
        const count = row[2];
        if (!stationData[station]) stationData[station] = { OK: 0, NOK: 0, GZ: 0, total: 0 };
        stationData[station][result] = (stationData[station][result] || 0) + count;
        stationData[station].total += count;
    }
    const stationMax = Math.max(...Object.values(stationData).map(s => s.total), 1);

    html += `<div class="stats-card">
        <h3>Messergebnis nach Station</h3>
        <div class="bar-chart">
            ${Object.entries(stationData).map(([station, data]) => `
                <div class="bar-row">
                    <span class="bar-label">${station}</span>
                    <div class="stacked-bar-track">
                        ${data.OK > 0 ? `<div class="stacked-segment ok" style="width: ${data.OK / stationMax * 100}%" title="OK: ${data.OK}"></div>` : ''}
                        ${data.NOK > 0 ? `<div class="stacked-segment nok" style="width: ${data.NOK / stationMax * 100}%" title="NOK: ${data.NOK}"></div>` : ''}
                        ${data.GZ > 0 ? `<div class="stacked-segment gz" style="width: ${data.GZ / stationMax * 100}%" title="GZ: ${data.GZ}"></div>` : ''}
                    </div>
                    <span class="bar-count">${data.total}</span>
                </div>
            `).join('')}
            ${Object.keys(stationData).length === 0 ? '<p class="stats-empty">Keine Daten</p>' : ''}
        </div>
    </div>`;
    html += '</div>';

    // === ROW 4: Prüfplan Status + Workflow Logs ===
    html += '<div class="stats-row">';

    // Prüfplan Status
    html += `<div class="stats-card">
        <h3>Prüfplan-Status</h3>
        <div class="pp-status-cards">
            <div class="pp-status-card overdue">
                <div class="pp-num">${ppUeberfaellig}</div>
                <div class="pp-lbl">Überfällig</div>
            </div>
            <div class="pp-status-card today">
                <div class="pp-num">${ppHeute}</div>
                <div class="pp-lbl">Heute fällig</div>
            </div>
            <div class="pp-status-card done">
                <div class="pp-num">${total}</div>
                <div class="pp-lbl">Abgegeben</div>
            </div>
        </div>
    </div>`;

    // Workflow Logs
    html += `<div class="stats-card">
        <h3>Letzte Workflow-Aktivitäten</h3>
        <div class="wf-log-list">
            ${wfRes.rows.length === 0 ? '<p class="stats-empty">Keine Aktivitäten</p>' : ''}
            ${wfRes.rows.map(r => {
                const nodeType = r[0] || '';
                const status = r[1] || '';
                const details = r[2] || '';
                const time = r[3] || '';
                const iconMap = { email: 'E', condition: '?', trigger: 'T', delay: 'Z' };
                return `<div class="wf-log-item">
                    <span class="wf-log-icon ${nodeType}">${iconMap[nodeType] || '?'}</span>
                    <span class="wf-log-details">${details}</span>
                    <span class="wf-log-time">${time}</span>
                </div>`;
            }).join('')}
        </div>
    </div>`;
    html += '</div>';

    // === ROW 5: Pünktlichkeitsanalyse ===
    const punctData = punctRes.rows || [];
    const frueh = punctData.filter(r => r[7] === 'frueh').length;
    const puenktlich = punctData.filter(r => r[7] === 'puenktlich').length;
    const spaet = punctData.filter(r => r[7] === 'spaet').length;
    const punctTotal = frueh + puenktlich + spaet;

    html += '<div class="stats-row">';

    // Pünktlichkeits-KPIs
    html += `<div class="stats-card">
        <h3>Prüfplan-Pünktlichkeit</h3>
        <div class="pp-status-cards">
            <div class="pp-status-card" style="background:#e8f5e9;">
                <div class="pp-num" style="color:#2e7d32;">${punctTotal > 0 ? Math.round((frueh + puenktlich) / punctTotal * 100) : 0}%</div>
                <div class="pp-lbl">Pünktlich / Früh</div>
            </div>
            <div class="pp-status-card" style="background:#fce4ec;">
                <div class="pp-num" style="color:#c62828;">${punctTotal > 0 ? Math.round(spaet / punctTotal * 100) : 0}%</div>
                <div class="pp-lbl">Verspätet</div>
            </div>
        </div>
        <div class="bar-chart" style="margin-top:16px;">
            <div class="bar-row">
                <span class="bar-label">Früh</span>
                <div class="bar-track"><div class="bar-fill green" style="width:${punctTotal > 0 ? frueh / punctTotal * 100 : 0}%"></div></div>
                <span class="bar-count">${frueh}</span>
            </div>
            <div class="bar-row">
                <span class="bar-label">Pünktlich</span>
                <div class="bar-track"><div class="bar-fill" style="width:${punctTotal > 0 ? puenktlich / punctTotal * 100 : 0}%;background:#1565c0;"></div></div>
                <span class="bar-count">${puenktlich}</span>
            </div>
            <div class="bar-row">
                <span class="bar-label">Verspätet</span>
                <div class="bar-track"><div class="bar-fill red" style="width:${punctTotal > 0 ? spaet / punctTotal * 100 : 0}%"></div></div>
                <span class="bar-count">${spaet}</span>
            </div>
        </div>
    </div>`;

    // Einzelne Durchführungen Timeline
    html += `<div class="stats-card">
        <h3>Letzte Durchführungen</h3>
        <div class="wf-log-list">
            ${punctData.length === 0 ? '<p class="stats-empty">Keine Durchführungen</p>' : ''}
            ${punctData.map(r => {
                const bezeichnung = r[1] || '';
                const datum = r[2] || '';
                const sollZeit = r[3] || '';
                const gebrachtAm = r[4] || '';
                const gemessenAm = r[5] || '';
                const status = r[6] || '';
                const timing = r[7] || '';

                const istZeit = gebrachtAm ? gebrachtAm.substring(11, 16) : '-';
                const diffMinutes = gebrachtAm && sollZeit ?
                    (parseInt(istZeit.split(':')[0]) * 60 + parseInt(istZeit.split(':')[1])) -
                    (parseInt(sollZeit.split(':')[0]) * 60 + parseInt(sollZeit.split(':')[1])) : 0;

                const timingColor = timing === 'spaet' ? '#c62828' : timing === 'frueh' ? '#2e7d32' : '#1565c0';
                const timingIcon = timing === 'spaet' ? '!' : timing === 'frueh' ? '↑' : '✓';
                const timingText = timing === 'spaet' ? `+${diffMinutes} Min.` :
                                   timing === 'frueh' ? `${diffMinutes} Min.` :
                                   'Pünktlich';

                return `<div class="wf-log-item">
                    <span class="wf-log-icon" style="background:${timingColor}">${timingIcon}</span>
                    <span class="wf-log-details">
                        <strong>${bezeichnung}</strong> | Soll: ${sollZeit} → Ist: ${istZeit}
                        ${status === 'gemessen' ? ' ✓' : ''}
                    </span>
                    <span class="wf-log-time" style="color:${timingColor};font-weight:600;">${timingText}</span>
                </div>`;
            }).join('')}
        </div>
    </div>`;

    html += '</div>';

    html += '</div>';

    content.innerHTML = html;
}
