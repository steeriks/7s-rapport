'use strict';

// ============================================================
// STORAGE HELPERS
// ============================================================
const DB = {
  get: (key, fallback = null) => {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  set: (key, val) => localStorage.setItem(key, JSON.stringify(val)),
};

function getSettings() {
  return DB.get('settings', {
    sagesman: '',
    centralEmail: '',
    ejsPublicKey: '',
    ejsServiceId: '',
    ejsTemplateId: '',
    dailyTime: '20:00',
  });
}

function saveSettings(s) { DB.set('settings', s); }
function getReports()    { return DB.get('reports', []); }
function saveReports(r)  { DB.set('reports', r); }

function addReport(report) {
  const reports = getReports();
  reports.unshift(report);
  saveReports(reports);
}

function deleteReport(id) {
  saveReports(getReports().filter(r => r.id !== id));
}

// ============================================================
// TIDSNUMMER  (SoldF 2001: DDTIMMI — 6 siffror)
// Dag i månaden + timme + minut, alltid med inledande nollor.
// Exempel: onsdag 4 mars kl 21:15 → 042115
// ============================================================
function toTidsnummer(datetimeLocalValue) {
  if (!datetimeLocalValue) return '––––––';
  // datetime-local format: "YYYY-MM-DDTHH:MM"
  const [datePart, timePart] = datetimeLocalValue.split('T');
  if (!datePart || !timePart) return '––––––';
  const day  = datePart.split('-')[2];       // "04"
  const [hh, mm] = timePart.split(':');      // "21", "15"
  return `${day}${hh}${mm}`;                 // "042115"
}

// Human-readable fallback for PDF/headings
function formatDateTime(datetimeLocalValue) {
  if (!datetimeLocalValue) return '–';
  const d = new Date(datetimeLocalValue);
  return d.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ============================================================
// REPORT → TEXT  (Signal / clipboard format)
// ============================================================
function reportToText(r) {
  const tidsnr = toTidsnummer(r.stund);
  // Include coord system label if stored
  const stalleFull = r.stalleSystem && r.stalleSystem !== 'WGS84'
    ? `[${r.stalleSystem}] ${r.stalle || '–'}`
    : r.stalle || '–';

  const lines = [
    '═══════════════════════════',
    '       7S RAPPORT',
    '═══════════════════════════',
    `1. Stund:          ${tidsnr}`,
    `2. Ställe:         ${stalleFull}`,
    `3. Styrka:         ${r.styrka || '–'}`,
    `4. Slag:           ${r.slag || '–'}`,
    `5. Sysselsättning: ${r.sysselsattning || '–'}`,
    `6. Symbol:         ${r.symbol || '–'}`,
    `7. Sagesman:       ${r.sagesman || '–'}`,
  ];
  if (r.sedan) lines.push(`8. Sedan:          ${r.sedan}`);
  lines.push('═══════════════════════════');
  return lines.join('\n');
}

// ============================================================
// PDF GENERATION
// ============================================================
function generatePDF(reports) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageW = doc.internal.pageSize.getWidth();
  const margin = 15;
  const colLabel = margin + 2;
  const colValue = margin + 48;
  const lineH = 7;
  let y = 20;

  function checkPage() {
    if (y > 270) { doc.addPage(); y = 20; }
  }

  // Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(45, 74, 30);
  doc.text('7S Rapporter', margin, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text(
    `Genererad: ${new Date().toLocaleString('sv-SE')}  |  Antal rapporter: ${reports.length}`,
    margin, y
  );
  y += 10;

  doc.setDrawColor(45, 74, 30);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  const fields = [
    ['1. Stund',          r => `${toTidsnummer(r.stund)}  (${formatDateTime(r.stund)})`],
    ['2. Ställe',         r => {
      const sys = r.stalleSystem && r.stalleSystem !== 'WGS84' ? `[${r.stalleSystem}] ` : '';
      return sys + (r.stalle || '–');
    }],
    ['3. Styrka',         r => r.styrka || '–'],
    ['4. Slag',           r => r.slag || '–'],
    ['5. Sysselsättning', r => r.sysselsattning || '–'],
    ['6. Symbol',         r => r.symbol || '–'],
    ['7. Sagesman',       r => r.sagesman || '–'],
    ['8. Sedan',          r => r.sedan || ''],
  ];

  reports.forEach((r, idx) => {
    checkPage();

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(45, 74, 30);
    doc.text(`Rapport #${idx + 1}`, margin, y);
    y += lineH;

    doc.setFontSize(10);
    doc.setTextColor(30);

    fields.forEach(([label, getter]) => {
      const val = getter(r);
      if (!val) return;
      checkPage();
      doc.setFont('helvetica', 'bold');
      doc.text(`${label}:`, colLabel, y);
      doc.setFont('helvetica', 'normal');
      const maxWidth = pageW - colValue - margin;
      const wrapped = doc.splitTextToSize(val, maxWidth);
      doc.text(wrapped, colValue, y);
      y += lineH * wrapped.length;
    });

    y += 3;
    doc.setDrawColor(180);
    doc.setLineWidth(0.2);
    doc.line(margin, y, pageW - margin, y);
    y += 6;
  });

  return doc;
}

function downloadPDF(doc, filename) {
  doc.save(filename);
}

// ============================================================
// EMAIL (EmailJS)
// ============================================================
async function sendEmailWithText(subject, body) {
  const s = getSettings();
  if (!s.ejsPublicKey || !s.ejsServiceId || !s.ejsTemplateId) {
    showToast('Konfigurera EmailJS i Inställningar först');
    return false;
  }
  if (!s.centralEmail) {
    showToast('Ange central e-postadress i Inställningar');
    return false;
  }
  emailjs.init(s.ejsPublicKey);
  try {
    await emailjs.send(s.ejsServiceId, s.ejsTemplateId, {
      to_email:  s.centralEmail,
      subject,
      message:   body,
      from_name: s.sagesman || 'Okänd',
    });
    return true;
  } catch (err) {
    console.error('EmailJS error:', err);
    showToast('E-postfel: ' + (err.text || 'Okänt fel'));
    return false;
  }
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

// ============================================================
// TABS
// ============================================================
function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'reports') renderReports();
    });
  });
}

// ============================================================
// FORM — NY RAPPORT
// ============================================================
let currentReport = null;

function resetForm() {
  document.getElementById('reportForm').reset();
  const now = new Date();
  now.setSeconds(0, 0);
  // datetime-local expects "YYYY-MM-DDTHH:MM" in local time
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString().slice(0, 16);
  document.getElementById('stund').value = local;
  updateTidsnummerBadge(local);
  const s = getSettings();
  if (s.sagesman) document.getElementById('sagesman').value = s.sagesman;
}

function updateTidsnummerBadge(value) {
  const badge = document.getElementById('tidsnummerBadge');
  if (badge) badge.textContent = toTidsnummer(value) || '––––––';
}

function initForm() {
  const form      = document.getElementById('reportForm');
  const sendPanel = document.getElementById('sendPanel');

  resetForm();

  // Live tidsnummer update
  document.getElementById('stund').addEventListener('input', e => {
    updateTidsnummerBadge(e.target.value);
  });

  // GPS button — labels with selected coordinate system
  document.getElementById('gpsBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { showToast('GPS ej tillgänglig'); return; }
    showToast('Hämtar position…');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude.toFixed(5);
        const lon = pos.coords.longitude.toFixed(5);
        document.getElementById('stalle').value = `${lat}, ${lon}`;
        // Force WGS84 decimal in selector since that's what the browser provides
        document.getElementById('stalleSystem').value = 'WGS84';
        showToast('✓ GPS-position hämtad (WGS84)');
      },
      err => {
        const msgs = {
          1: 'Åtkomst till plats nekad',
          2: 'Position ej tillgänglig',
          3: 'Tidsgräns för GPS',
        };
        showToast(msgs[err.code] || 'Kunde inte hämta GPS');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  // Submit
  form.addEventListener('submit', e => {
    e.preventDefault();
    currentReport = {
      id:            Date.now().toString(),
      stund:         document.getElementById('stund').value,
      stalle:        document.getElementById('stalle').value.trim(),
      stalleSystem:  document.getElementById('stalleSystem').value,
      styrka:        document.getElementById('styrka').value.trim(),
      slag:          document.getElementById('slag').value.trim(),
      sysselsattning:document.getElementById('sysselsattning').value.trim(),
      symbol:        document.getElementById('symbol').value.trim(),
      sagesman:      document.getElementById('sagesman').value.trim(),
      sedan:         document.getElementById('sedan').value.trim(),
      created:       new Date().toISOString(),
    };
    addReport(currentReport);
    showSendPanel(currentReport);
  });

  // Rensa
  document.getElementById('clearBtn').addEventListener('click', () => {
    resetForm();
    sendPanel.classList.add('hidden');
    form.classList.remove('hidden');
  });

  // Ny rapport (från sendPanel)
  document.getElementById('newReportBtn').addEventListener('click', () => {
    resetForm();
    sendPanel.classList.add('hidden');
    form.classList.remove('hidden');
  });
}

function showSendPanel(report) {
  document.getElementById('reportForm').classList.add('hidden');
  const panel = document.getElementById('sendPanel');
  panel.classList.remove('hidden');

  const text = reportToText(report);
  document.getElementById('previewText').textContent = text;

  document.getElementById('copySignalBtn').onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('✓ Kopierat! Klistra in i Signal.');
    } catch {
      showToast('Kopiera texten ovan manuellt');
    }
  };

  document.getElementById('shareBtn').onclick = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: '7S Rapport', text }); }
      catch { /* user cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        showToast('✓ Kopierat till urklipp');
      } catch {
        showToast('Delning ej tillgänglig');
      }
    }
  };

  document.getElementById('sendEmailBtn').onclick = async () => {
    const s = getSettings();
    const subject = `7S Rapport – tidsnr ${toTidsnummer(report.stund)} – ${report.sagesman || ''}`;
    if (s.ejsPublicKey && s.ejsServiceId && s.ejsTemplateId) {
      const ok = await sendEmailWithText(subject, text);
      if (ok) showToast('✓ E-post skickad till Stab/högre chef');
    } else {
      window.location.href =
        `mailto:${s.centralEmail || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    }
  };

  document.getElementById('downloadPdfBtn').onclick = () => {
    const doc = generatePDF([report]);
    downloadPDF(doc, `7S-rapport-${toTidsnummer(report.stund)}-${report.sagesman || report.id}.pdf`);
    showToast('PDF nedladdad');
  };
}

// ============================================================
// SPARADE RAPPORTER
// ============================================================
function renderReports() {
  const list    = document.getElementById('reportsList');
  const reports = getReports();

  if (reports.length === 0) {
    list.innerHTML = '<p class="empty-msg">Inga sparade rapporter.</p>';
    return;
  }

  list.innerHTML = reports.map(r => `
    <div class="report-item" data-id="${r.id}">
      <div class="report-item-header">
        <div class="report-item-title">${escapeHtml(r.slag ? r.slag.substring(0, 40) : 'Rapport')}</div>
        <div class="report-item-time">
          <span class="tidsnr-small">${toTidsnummer(r.stund)}</span>
          <br>${escapeHtml(formatDateTime(r.stund))}
        </div>
      </div>
      <div class="report-item-detail">
        📍 ${escapeHtml(r.stalle || '–')}  |  👤 ${escapeHtml(r.sagesman || '–')}
      </div>
      <div class="report-item-actions">
        <button class="btn secondary view-btn" data-id="${r.id}">Visa</button>
        <button class="btn signal copy-btn"    data-id="${r.id}">Kopiera</button>
        <button class="btn pdf pdf-btn"        data-id="${r.id}">PDF</button>
        <button class="btn danger del-btn"     data-id="${r.id}">Radera</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = getReports().find(x => x.id === btn.dataset.id);
      if (r) showModal('Rapport', reportToText(r));
    });
  });

  list.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const r = getReports().find(x => x.id === btn.dataset.id);
      if (!r) return;
      try {
        await navigator.clipboard.writeText(reportToText(r));
        showToast('✓ Kopierat till urklipp');
      } catch { showToast('Kunde inte kopiera'); }
    });
  });

  list.querySelectorAll('.pdf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = getReports().find(x => x.id === btn.dataset.id);
      if (!r) return;
      const doc = generatePDF([r]);
      downloadPDF(doc, `7S-rapport-${toTidsnummer(r.stund)}-${r.sagesman || r.id}.pdf`);
      showToast('PDF nedladdad');
    });
  });

  list.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('Radera denna rapport?')) {
        deleteReport(btn.dataset.id);
        renderReports();
        showToast('Rapport raderad');
      }
    });
  });
}

// Dagssammanfattning
function initDailyBtn() {
  document.getElementById('sendDailyBtn').addEventListener('click', async () => {
    const today        = todayISO();
    const todayReports = getReports().filter(r => r.created && r.created.startsWith(today));

    if (todayReports.length === 0) {
      showToast('Inga rapporter för idag');
      return;
    }

    const doc      = generatePDF(todayReports);
    const filename = `7S-dagsrapport-${today}.pdf`;
    downloadPDF(doc, filename);

    const allText = todayReports.map(reportToText).join('\n\n');
    const s       = getSettings();

    if (s.ejsPublicKey && s.ejsServiceId && s.ejsTemplateId && s.centralEmail) {
      const subject = `7S Dagsrapport ${today} — ${todayReports.length} rapporter — ${s.sagesman || ''}`;
      const ok = await sendEmailWithText(subject, allText);
      if (ok) { showToast(`✓ ${todayReports.length} rapporter skickade till Stab/högre chef`); return; }
    }

    if (s.centralEmail) {
      const subject = `7S Dagsrapport ${today} — ${todayReports.length} rapporter`;
      window.location.href =
        `mailto:${s.centralEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(allText)}`;
    } else {
      showToast('PDF nedladdad — ange Stab/högre chef e-post i Inställningar för automatisk sändning');
    }
  });
}

// ============================================================
// INSTÄLLNINGAR
// ============================================================
function initSettings() {
  const s = getSettings();
  document.getElementById('settingName').value  = s.sagesman    || '';
  document.getElementById('settingEmail').value = s.centralEmail || '';
  document.getElementById('ejsPublicKey').value = s.ejsPublicKey || '';
  document.getElementById('ejsServiceId').value = s.ejsServiceId || '';
  document.getElementById('ejsTemplateId').value= s.ejsTemplateId|| '';
  document.getElementById('dailyTime').value    = s.dailyTime   || '20:00';

  document.getElementById('saveSettingsBtn').addEventListener('click', () => {
    const updated = {
      sagesman:     document.getElementById('settingName').value.trim(),
      centralEmail: document.getElementById('settingEmail').value.trim(),
      ejsPublicKey: document.getElementById('ejsPublicKey').value.trim(),
      ejsServiceId: document.getElementById('ejsServiceId').value.trim(),
      ejsTemplateId:document.getElementById('ejsTemplateId').value.trim(),
      dailyTime:    document.getElementById('dailyTime').value,
    };
    saveSettings(updated);

    if (updated.sagesman) {
      const f = document.getElementById('sagesman');
      if (f) f.value = updated.sagesman;
    }

    document.getElementById('settingsSaved').classList.remove('hidden');
    setTimeout(() => document.getElementById('settingsSaved').classList.add('hidden'), 2500);
    scheduleDailyReminder(updated.dailyTime);
  });

  document.getElementById('clearAllBtn').addEventListener('click', () => {
    if (confirm('Radera ALLA sparade rapporter? Det går inte att ångra.')) {
      saveReports([]);
      showToast('Alla rapporter raderade');
    }
  });
}

// ============================================================
// DAGLIG PÅMINNELSE
// ============================================================
function scheduleDailyReminder(timeStr) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().then(p => {
      if (p === 'granted') DB.set('reminderTime', timeStr);
    });
  } else if (Notification.permission === 'granted') {
    DB.set('reminderTime', timeStr);
  }
}

function checkDailyReminder() {
  const reminderTime = DB.get('reminderTime', '20:00');
  const [rh, rm]     = reminderTime.split(':').map(Number);
  const now          = new Date();
  const todayKey     = todayISO();

  if (DB.get('lastNotified', '') === todayKey) return;
  if (now.getHours() >= rh && now.getMinutes() >= rm) {
    if (Notification.permission === 'granted') {
      const n = getReports().filter(r => r.created && r.created.startsWith(todayKey)).length;
      if (n > 0) {
        new Notification('7S Dagsrapport', {
          body: `Du har ${n} rapport(er) att skicka till Stab/högre chef idag.`,
          icon: 'icon-192.png',
        });
        DB.set('lastNotified', todayKey);
      }
    }
  }
}

// ============================================================
// MODAL
// ============================================================
function showModal(title, body) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>${escapeHtml(title)}</h3>
      <div class="preview-box" style="max-height:300px;overflow-y:auto">${escapeHtml(body)}</div>
      <div class="btn-group" style="margin-top:16px;flex-direction:row">
        <button class="btn secondary" id="modalCopy">Kopiera</button>
        <button class="btn primary"   id="modalClose">Stäng</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#modalClose').onclick = () => overlay.remove();
  overlay.querySelector('#modalCopy').onclick  = async () => {
    try { await navigator.clipboard.writeText(body); showToast('Kopierat!'); } catch {}
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ============================================================
// UTILS
// ============================================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// SERVICE WORKER
// ============================================================
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('SW registration failed:', err);
    });
  }
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  registerSW();
  initTabs();
  initForm();
  initDailyBtn();
  initSettings();
  checkDailyReminder();
});
