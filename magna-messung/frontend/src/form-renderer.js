import { GetDropdowns, SaveMessungDynamic } from '../wailsjs/go/main/App';

function getTodayDate() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `${day}.${month}.${year}`;
}

function showToast(message, type = 'success') {
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

export async function renderDynamicForm(formular) {
    const formId = formular.id;
    const definition = JSON.parse(formular.definition);

    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    // Build HTML
    const rows = definition.rows;
    let html = '<div class="messung-fieldset"><div class="messung-title">Messung</div>';

    for (const row of rows) {
        html += '<div class="form-row">';
        for (const el of row.elements) {
            const flexClass = el.flex === 3 ? 'flex-3' : el.flex === 2 ? 'flex-2' : 'flex-1';
            const reqMark = el.required ? '* ' : '';

            if (el.type === 'textbox') {
                html += `<div class="form-group ${flexClass}">
                    <label>${reqMark}${el.label}</label>
                    <input type="text" id="field-${el.field_key}" placeholder="${el.placeholder || ''}" />
                </div>`;
            } else if (el.type === 'dropdown') {
                html += `<div class="form-group ${flexClass}">
                    <label>${reqMark}${el.label}</label>
                    <select id="field-${el.field_key}" data-kategorie="${el.dropdown_kategorie || ''}">
                        <option value=""></option>
                    </select>
                </div>`;
            } else if (el.type === 'datefield') {
                html += `<div class="form-group ${flexClass}">
                    <label>${reqMark}${el.label}</label>
                    <input type="text" id="field-${el.field_key}" value="${el.default_today ? getTodayDate() : ''}" />
                </div>`;
            } else if (el.type === 'radiogroup') {
                html += `<div class="radio-group" style="flex: ${el.flex || 1}">
                    <div class="radio-group-label">${reqMark}${el.label}</div>
                    <div class="radio-group-options">
                    ${(el.options || []).map(opt =>
                        `<label><input type="radio" name="radio-${el.field_key}" value="${opt}" /> ${opt}</label>`
                    ).join('')}
                    </div>
                </div>`;
            } else if (el.type === 'label') {
                html += `<div class="form-group ${flexClass}">
                    <span style="font-size:13px;color:#333;padding-top:20px;">${el.text || ''}</span>
                </div>`;
            }
        }
        html += '</div>';
    }

    html += `<div class="form-row bottom-row">
        <button class="btn btn-help" type="button">?</button>
        <button class="btn btn-submit" type="button" id="btnFertigDynamic">Fertig</button>
        <span class="pflichtfeld-hint">* = Pflichtfeld</span>
    </div></div>`;

    mainContent.innerHTML = html;

    // Load dropdowns
    for (const select of mainContent.querySelectorAll('select[data-kategorie]')) {
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
        } catch (e) { console.error('Dropdown load error:', e); }
    }

    // All form elements for validation/submission
    const allElements = rows.flatMap(r => r.elements).filter(e => e.type !== 'label');

    // Bind submit - use direct DOM reference
    const btn = mainContent.querySelector('#btnFertigDynamic');
    if (!btn) {
        console.error('btnFertigDynamic NOT FOUND in DOM');
        return;
    }

    btn.onclick = async function() {
        // Clear previous errors
        mainContent.querySelectorAll('.field-error').forEach(function(e) { e.classList.remove('field-error'); });
        mainContent.querySelectorAll('.field-error-msg').forEach(function(e) { e.remove(); });

        const missing = [];
        const daten = {};

        for (const el of allElements) {
            let value = '';
            let fieldEl = null;

            if (el.type === 'radiogroup') {
                const checked = document.querySelector('input[name="radio-' + el.field_key + '"]:checked');
                value = checked ? checked.value : '';
                fieldEl = mainContent.querySelector('.radio-group input[name="radio-' + el.field_key + '"]');
                if (fieldEl) fieldEl = fieldEl.closest('.radio-group');
            } else {
                const input = document.getElementById('field-' + el.field_key);
                value = input ? input.value.trim() : '';
                fieldEl = input ? input.closest('.form-group') : null;
            }

            daten[el.field_key] = value;

            if (el.required && !value) {
                missing.push(el.label);
                if (fieldEl) {
                    fieldEl.classList.add('field-error');
                }
            }
        }

        if (missing.length > 0) {
            showToast('Bitte füllen Sie alle Pflichtfelder aus', 'error');
            // Scroll to first error
            const firstError = mainContent.querySelector('.field-error');
            if (firstError) firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        try {
            const result = await SaveMessungDynamic(formId, JSON.stringify(daten));
            if (result === 'OK') {
                showToast('Messung erfolgreich gespeichert!', 'success');
                for (const el of allElements) {
                    if (el.type === 'radiogroup') {
                        document.querySelectorAll('input[name="radio-' + el.field_key + '"]').forEach(function(r) { r.checked = false; });
                    } else if (el.type === 'datefield' && el.default_today) {
                        // keep date
                    } else if (el.type === 'dropdown') {
                        const sel = document.getElementById('field-' + el.field_key);
                        if (sel) sel.selectedIndex = 0;
                    } else {
                        const input = document.getElementById('field-' + el.field_key);
                        if (input) input.value = '';
                    }
                }
            } else {
                showToast(result, 'error');
            }
        } catch (err) {
            console.error('Submit error:', err);
            alert('Fehler: ' + err.message);
        }
    };
}
