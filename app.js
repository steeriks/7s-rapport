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
  deleteImages(id).catch(() => {});
}

// ============================================================
// INDEXEDDB — bildlagring
// ============================================================
const _IDB_NAME  = '7s-rapport-images';
const _IDB_STORE = 'images';

function _openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(_IDB_STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function saveImages(reportId, images) {
  if (!images || images.length === 0) return;
  const db = await _openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).put(images, reportId);
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

async function getImages(reportId) {
  const db = await _openIDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(_IDB_STORE, 'readonly');
    const req = tx.objectStore(_IDB_STORE).get(reportId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = e => reject(e.target.error);
  });
}

async function deleteImages(reportId) {
  const db = await _openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).delete(reportId);
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

async function clearAllImages() {
  const db = await _openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(_IDB_STORE, 'readwrite');
    tx.objectStore(_IDB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror    = e => reject(e.target.error);
  });
}

// ============================================================
// BILDKOMPRIMERING — canvas-baserad, max 1200px bredd
// ============================================================
function compressImage(file, maxW = 1200, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxW) { height = Math.round(height * maxW / width); width = maxW; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', quality), width, height, name: file.name });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ============================================================
// KOORDINATKONVERTERING — ren JavaScript, inga externa beroenden
// GPS ger alltid WGS84 decimal; konverteras här till valt system.
// Referensvärden från SoldF 2001: 59.326489, 18.070179
//   MGRS:     34VCL3330680074
//   DDM:      59°19.589'N 18°4.211'E
//   SWEREF99: 6580434, 674676
//   RT90:     6580599, 1628933
// ============================================================

const _DEG = Math.PI / 180;
const _AS  = Math.PI / (180 * 3600);   // bågsekunder → radianer

// Ellipsoidkonstanter
const _WGS84  = { a: 6378137.0,    f: 1 / 298.257223563 };
const _BESSEL = { a: 6377397.155,  f: 1 / 299.1528128   };
function _e2(ell) { return 2 * ell.f - ell.f * ell.f; }

// Transverse Mercator-projektion (Gauss-Krüger)
function _tm(latDeg, lonDeg, ell, lon0Deg, k0, FE, FN) {
  const e2 = _e2(ell);
  const phi  = latDeg * _DEG;
  const dlam = (lonDeg - lon0Deg) * _DEG;
  const sinp = Math.sin(phi), cosp = Math.cos(phi), tanp = Math.tan(phi);
  const N = ell.a / Math.sqrt(1 - e2 * sinp * sinp);
  const T = tanp * tanp;
  const C = (e2 / (1 - e2)) * cosp * cosp;
  const A = cosp * dlam;
  const e4 = e2 * e2, e6 = e4 * e2;
  const M = ell.a * (
    (1 - e2/4 - 3*e4/64 - 5*e6/256)   * phi
    - (3*e2/8 + 3*e4/32 + 45*e6/1024) * Math.sin(2*phi)
    + (15*e4/256 + 45*e6/1024)         * Math.sin(4*phi)
    - (35*e6/3072)                     * Math.sin(6*phi)
  );
  const E = FE + k0 * N * (
    A + (1 - T + C) * A**3 / 6
    + (5 - 18*T + T*T + 72*C - 58*e2/(1-e2)) * A**5 / 120
  );
  const Nv = FN + k0 * (
    M + N * tanp * (
      A*A / 2
      + (5 - T + 9*C + 4*C*C) * A**4 / 24
      + (61 - 58*T + T*T + 600*C - 330*e2/(1-e2)) * A**6 / 720
    )
  );
  return [E, Nv];
}

// Geodetiska koordinater → geocentriska XYZ
function _toXYZ(latDeg, lonDeg, ell) {
  const e2  = _e2(ell);
  const phi = latDeg * _DEG, lam = lonDeg * _DEG;
  const N   = ell.a / Math.sqrt(1 - e2 * Math.sin(phi)**2);
  return [
    N * Math.cos(phi) * Math.cos(lam),
    N * Math.cos(phi) * Math.sin(lam),
    N * (1 - e2)      * Math.sin(phi),
  ];
}

// Geocentriska XYZ → geodetiska koordinater (iterativt)
function _fromXYZ(xyz, ell) {
  const [X, Y, Z] = xyz;
  const e2 = _e2(ell);
  const p  = Math.sqrt(X*X + Y*Y);
  let phi  = Math.atan2(Z, p * (1 - e2));
  for (let i = 0; i < 10; i++) {
    const N = ell.a / Math.sqrt(1 - e2 * Math.sin(phi)**2);
    phi = Math.atan2(Z + e2 * N * Math.sin(phi), p);
  }
  return [phi / _DEG, Math.atan2(Y, X) / _DEG];
}

// Helmert-transformation (position vector-konvention, inverterad WGS84→lokal)
// h = [tx, ty, tz, rx_as, ry_as, rz_as]  (towgs84-parametrar lokal→WGS84)
function _helmertInv([X, Y, Z], [tx, ty, tz, rx_as, ry_as, rz_as]) {
  const rx = rx_as * _AS, ry = ry_as * _AS, rz = rz_as * _AS;
  return [
    X - tx + rz * Y - ry * Z,
    Y - ty - rz * X + rx * Z,
    Z - tz + ry * X - rx * Y,
  ];
}

// SWEREF99 TM (zon 33, centralmeridian 15°, GRS80 ≈ WGS84)
function _toSWEREF99(lat, lon) {
  const [E, N] = _tm(lat, lon, _WGS84, 15, 0.9996, 500000, 0);
  return `${Math.round(N)}, ${Math.round(E)}`;
}

// RT90 2.5 gon V (Bessels ellipsoid, Helmert-transformation)
const _RT90_H = [414.1, 41.3, 603.1, -0.855, 2.141, -7.023];
function _toRT90(lat, lon) {
  const xyz    = _toXYZ(lat, lon, _WGS84);
  const xyz_b  = _helmertInv(xyz, _RT90_H);
  const [la, lo] = _fromXYZ(xyz_b, _BESSEL);
  // Gauss-Krüger på Bessel: centralmeridian 15°48'29.8" = 15.80827778°
  const [E, N] = _tm(la, lo, _BESSEL, 15.80827778, 1.00000561024, 1500000, 0);
  return `${Math.round(N)}, ${Math.round(E)}`;
}

// WGS84 DDM  ex: 59°19.589'N 18°4.211'E
function _toDDM(lat, lon) {
  const fmt = v => {
    const d = Math.floor(Math.abs(v));
    const m = ((Math.abs(v) - d) * 60).toFixed(3);
    return `${d}°${m}'`;
  };
  return `${fmt(lat)}${lat >= 0 ? 'N' : 'S'} ${fmt(lon)}${lon >= 0 ? 'E' : 'W'}`;
}

// MGRS
const _MGRS_COL  = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const _MGRS_RODD = 'ABCDEFGHJKLMNPQRSTUV';
const _MGRS_REVEN= 'FGHJKLMNPQRSTUVABCDE';
const _MGRS_BAND = 'CDEFGHJKLMNPQRSTUVWX';

function _toMGRS(lat, lon, prec = 5) {
  if (lat < -80 || lat > 84) return null;
  const band = _MGRS_BAND[Math.min(Math.floor((lat + 80) / 8), 19)];
  const zone = Math.floor((lon + 180) / 6) + 1;
  const lon0 = (zone - 1) * 6 - 180 + 3;
  const FN   = lat < 0 ? 10000000 : 0;
  const [E, N] = _tm(lat, lon, _WGS84, lon0, 0.9996, 500000, FN);
  const colIdx = Math.floor(E / 100000) - 1;
  const rowIdx = Math.floor(N / 100000) % 20;
  const col = _MGRS_COL[(zone - 1) % 3][colIdx];
  const row = (zone % 2 === 0 ? _MGRS_REVEN : _MGRS_RODD)[rowIdx];
  if (!col || !row) return null;
  const div  = Math.pow(10, 5 - prec);
  const eStr = String(Math.floor((E % 100000) / div)).padStart(prec, '0');
  const nStr = String(Math.floor((N % 100000) / div)).padStart(prec, '0');
  return `${zone}${band}${col}${row}${eStr}${nStr}`;
}

// Gemensam konverteringsfunktion — anropas från GPS-hanteraren
function convertCoords(lat, lon, system) {
  try {
    switch (system) {
      case 'MGRS':      return _toMGRS(lat, lon, 5) || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      case 'WGS84 DDM': return _toDDM(lat, lon);
      case 'SWEREF99':  return _toSWEREF99(lat, lon);
      case 'RT90':      return _toRT90(lat, lon);
      default:          return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
  } catch (err) {
    console.error('Koordinatkonverteringsfel:', err);
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
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
async function generatePDF(reports) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pageW = doc.internal.pageSize.getWidth();
  const margin = 15;
  const colLabel = margin + 2;
  const colValue = margin + 48;
  const lineH = 7;
  let y = 20;

  function checkPage(needed = 0) {
    if (y + needed > 270) { doc.addPage(); y = 20; }
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

  for (let idx = 0; idx < reports.length; idx++) {
    const r = reports[idx];
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

    // Embedded images
    if (r.id) {
      const imgs = await getImages(r.id).catch(() => []);
      if (imgs.length > 0) {
        checkPage();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(30);
        doc.text('Bilder:', colLabel, y);
        y += lineH;
        const maxImgW = pageW - 2 * margin;  // 180mm
        const maxImgH = 140;                  // max höjd per bild (mm)
        for (let bi = 0; bi < imgs.length; bi++) {
          const img = imgs[bi];
          // Beräkna dimensioner — skala ner till maxImgW och cap på maxImgH
          let imgWmm = maxImgW;
          let imgHmm = img.height > 0 ? imgWmm * (img.height / img.width) : imgWmm;
          if (imgHmm > maxImgH) {
            imgHmm = maxImgH;
            imgWmm = img.width > 0 ? imgHmm * (img.width / img.height) : maxImgH;
          }
          checkPage(imgHmm + 6);
          // Detektera format ur data URL (JPEG eller PNG)
          const fmt = img.dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
          try {
            doc.addImage(img.dataUrl, fmt, margin, y, imgWmm, imgHmm);
            y += imgHmm + 4;
            // Bildnummer under bilden
            doc.setFontSize(8);
            doc.setTextColor(120);
            doc.text(`Bild ${bi + 1}${img.name ? ` — ${img.name}` : ''}`, margin, y);
            doc.setFontSize(10);
            doc.setTextColor(30);
            y += 5;
          } catch (err) {
            console.warn('Kunde inte bädda in bild i PDF:', err);
            doc.setFontSize(9);
            doc.setTextColor(180, 0, 0);
            doc.text(`[Bild ${bi + 1} kunde inte visas]`, margin, y);
            doc.setTextColor(30);
            y += lineH;
          }
        }
      }
    }

    y += 3;
    doc.setDrawColor(180);
    doc.setLineWidth(0.2);
    doc.line(margin, y, pageW - margin, y);
    y += 6;
  }

  return doc;
}

function downloadPDF(doc, filename) {
  doc.save(filename);
}

// ============================================================
// E-POST — öppnar enhetens inbyggda e-postklient via mailto:
// ============================================================
function openMailto(to, subject, body) {
  window.location.href =
    `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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
// KARTVÄLJARE — Leaflet + OpenStreetMap
// ============================================================
let _map         = null;
let _mapMarker   = null;
let _mapSelLng   = null;   // { lat, lng }

function initMapPicker() {
  document.getElementById('mapPickerBtn').addEventListener('click', openMapModal);
  document.getElementById('mapModalClose').addEventListener('click', closeMapModal);
  document.getElementById('mapModal').addEventListener('click', e => {
    if (e.target.id === 'mapModal') closeMapModal();
  });

  document.getElementById('mapGpsBtn').addEventListener('click', () => {
    if (!navigator.geolocation || !_map) return;
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        _map.setView([lat, lng], 15);
        placeMapMarker(lat, lng);
      },
      () => showToast('GPS ej tillgänglig')
    );
  });

  document.getElementById('mapConfirmBtn').addEventListener('click', () => {
    if (!_mapSelLng) return;
    _pendingCoords = { lat: _mapSelLng.lat, lon: _mapSelLng.lng };
    const system = document.getElementById('stalleSystem').value;
    document.getElementById('stalle').value = convertCoords(_mapSelLng.lat, _mapSelLng.lng, system);
    closeMapModal();
    showToast(`✓ Position vald (${system})`);
  });

  // "Öppna i"-knappar (verifiering i extern karta)
  document.getElementById('mapOpenGoogleBtn').addEventListener('click', () => {
    if (!_mapSelLng) return;
    window.open(`https://maps.google.com/?q=${_mapSelLng.lat},${_mapSelLng.lng}`, '_blank');
  });
  document.getElementById('mapOpenAppleBtn').addEventListener('click', () => {
    if (!_mapSelLng) return;
    window.open(`https://maps.apple.com/?ll=${_mapSelLng.lat},${_mapSelLng.lng}&q=Vald+position`, '_blank');
  });

  // When coordinate system changes while map is open, update preview
  document.getElementById('stalleSystem').addEventListener('change', () => {
    if (_mapSelLng) updateMapPreview(_mapSelLng.lat, _mapSelLng.lng);
  });
}

function openMapModal() {
  const modal = document.getElementById('mapModal');
  modal.classList.remove('hidden');

  if (!_map) {
    _map = L.map('mapContainer', { zoomControl: true }).setView([59.33, 18.07], 8);

    const osm  = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
      maxZoom: 19,
    });
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>, © <a href="https://opentopomap.org">OpenTopoMap</a>',
      maxZoom: 17,
    });
    osm.addTo(_map);
    L.control.layers({ 'Karta': osm, 'Topografisk': topo }, {}, { position: 'topright' }).addTo(_map);

    _map.on('click', e => placeMapMarker(e.latlng.lat, e.latlng.lng));
  }

  // Try to center on existing coordinate if it's WGS84 decimal
  const existing = document.getElementById('stalle').value.trim();
  const wgs = _parseWGS84(existing);
  if (wgs) {
    _map.setView([wgs.lat, wgs.lng], 14);
    placeMapMarker(wgs.lat, wgs.lng);
  }

  // Leaflet needs a moment after the element becomes visible
  requestAnimationFrame(() => _map.invalidateSize());
}

function closeMapModal() {
  document.getElementById('mapModal').classList.add('hidden');
  // Don't destroy the map — reuse it next time
}

function placeMapMarker(lat, lng) {
  if (_mapMarker) {
    _mapMarker.setLatLng([lat, lng]);
  } else {
    _mapMarker = L.marker([lat, lng], { draggable: true }).addTo(_map);
    _mapMarker.on('drag', () => {
      const p = _mapMarker.getLatLng();
      updateMapPreview(p.lat, p.lng);
    });
    _mapMarker.on('dragend', () => {
      const p = _mapMarker.getLatLng();
      placeMapMarker(p.lat, p.lng);
    });
  }
  updateMapPreview(lat, lng);
  document.getElementById('mapConfirmBtn').disabled = false;
  _map.panTo([lat, lng]);
}

function updateMapPreview(lat, lng) {
  _mapSelLng = { lat, lng };
  const system = document.getElementById('stalleSystem').value;
  const coords = convertCoords(lat, lng, system);
  document.getElementById('mapCoordPreview').textContent = `[${system}] ${coords}`;
  document.getElementById('mapOpenGoogleBtn').disabled = false;
  document.getElementById('mapOpenAppleBtn').disabled  = false;
}

// Parse "lat, lon" style WGS84 decimal from a string (for re-centering the map)
function _parseWGS84(str) {
  const m = str.match(/(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
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
let currentReport  = null;
let _pendingImages = [];   // { dataUrl, width, height, name }
let _pendingCoords = null; // { lat, lon } — rå WGS84 från GPS eller kartväljare

function renderImagePreview() {
  const container = document.getElementById('imagePreview');
  const badge     = document.getElementById('imgCountBadge');
  container.innerHTML = '';

  if (_pendingImages.length === 0) {
    badge.classList.add('hidden');
    return;
  }

  badge.classList.remove('hidden');
  badge.textContent = `${_pendingImages.length} bild${_pendingImages.length !== 1 ? 'er' : ''}`;

  _pendingImages.forEach((img, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'img-thumb';
    thumb.innerHTML = `
      <img src="${img.dataUrl}" alt="${escapeHtml(img.name)}">
      <button type="button" class="img-remove" data-idx="${idx}" title="Ta bort bild">✕</button>`;
    container.appendChild(thumb);
  });

  container.querySelectorAll('.img-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      _pendingImages.splice(Number(btn.dataset.idx), 1);
      renderImagePreview();
    });
  });
}

function initImagePicker() {
  const pickerBtn  = document.getElementById('imagePickerBtn');
  const imageInput = document.getElementById('imageInput');

  pickerBtn.addEventListener('click', () => imageInput.click());

  imageInput.addEventListener('change', async () => {
    const files = Array.from(imageInput.files);
    if (files.length === 0) return;
    showToast('Bearbetar bilder…');
    try {
      const compressed = await Promise.all(files.map(f => compressImage(f)));
      _pendingImages.push(...compressed);
      renderImagePreview();
      showToast(`✓ ${files.length} bild${files.length !== 1 ? 'er' : ''} tillagd`);
    } catch (err) {
      console.error('Bildkomprimering misslyckades:', err);
      showToast('Kunde inte lägga till bilder');
    }
    imageInput.value = '';
  });
}

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
  _pendingImages = [];
  _pendingCoords = null;
  renderImagePreview();
}

function updateTidsnummerBadge(value) {
  const badge = document.getElementById('tidsnummerBadge');
  if (badge) badge.textContent = toTidsnummer(value) || '––––––';
}

function initForm() {
  const form      = document.getElementById('reportForm');
  const sendPanel = document.getElementById('sendPanel');

  resetForm();
  initImagePicker();

  // Live tidsnummer update
  document.getElementById('stund').addEventListener('input', e => {
    updateTidsnummerBadge(e.target.value);
  });

  // GPS — anropar direkt utan föregående popups som kan störa iOS-dialogen
  document.getElementById('gpsBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { showToast('GPS ej tillgänglig på denna enhet'); return; }
    showToast('Hämtar position…');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat    = pos.coords.latitude;
        const lon    = pos.coords.longitude;
        _pendingCoords = { lat, lon };
        const system = document.getElementById('stalleSystem').value;
        const result = convertCoords(lat, lon, system);
        document.getElementById('stalle').value = result;
        showToast(`✓ Position hämtad (${system})`);
      },
      err => {
        if (err.code === 1) {
          showToast('Platstillstånd nekades — tryck ? för hjälp');
        } else if (err.code === 2) {
          showToast('Position ej tillgänglig — kontrollera att GPS är påslaget');
        } else {
          showToast('GPS-timeout — försök igen utomhus');
        }
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });

  // ?-knapp visar alltid hjälpen manuellt, stör aldrig GPS-anropet
  document.getElementById('gpshelpBtn').addEventListener('click', () => {
    showGpsPermissionHelp();
  });

  // Submit
  form.addEventListener('submit', async e => {
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
      imageCount:    _pendingImages.length,
      lat:           _pendingCoords?.lat ?? null,
      lon:           _pendingCoords?.lon ?? null,
    };
    if (_pendingImages.length > 0) {
      await saveImages(currentReport.id, _pendingImages.slice());
    }
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

// Genererar en GPX-fil för rapporten om WGS84-koordinater finns sparade.
function makeGpxFile(report) {
  if (report.lat == null || report.lon == null) return null;
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="7S Rapport" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="${report.lat.toFixed(6)}" lon="${report.lon.toFixed(6)}">
    <name>${escapeXml(report.sagesman || 'Observation')}</name>
    <desc>Tidsnr: ${toTidsnummer(report.stund)} | ${escapeXml(report.slag || '')}</desc>
    <time>${new Date(report.created).toISOString()}</time>
  </wpt>
</gpx>`;
  return new File([gpx], `observation-${toTidsnummer(report.stund)}.gpx`, { type: 'application/gpx+xml' });
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showSendPanel(report) {
  document.getElementById('reportForm').classList.add('hidden');
  const panel = document.getElementById('sendPanel');
  panel.classList.remove('hidden');

  const text = reportToText(report);
  document.getElementById('previewText').textContent = text;

  // Bygger filer (bilder + GPX) för navigator.share.
  // Returnerar en array — tom om inga filer finns eller canShare nekar.
  async function buildShareFiles(report) {
    const imgs = await getImages(report.id).catch(() => []);
    const imageFiles = imgs.map((img, i) => {
      const b64 = img.dataUrl.split(',')[1];
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
      return new File([arr], img.name || `bild-${i + 1}.jpg`, { type: 'image/jpeg' });
    });
    const gpxFile = makeGpxFile(report);
    if (!navigator.canShare) return imageFiles; // kan inte kolla — skicka bilderna
    const withGpx = [...imageFiles, ...(gpxFile ? [gpxFile] : [])];
    if (withGpx.length > 0 && navigator.canShare({ files: withGpx })) return withGpx;
    if (imageFiles.length > 0 && navigator.canShare({ files: imageFiles })) return imageFiles;
    return [];
  }

  document.getElementById('copySignalBtn').onclick = async () => {
    const files = await buildShareFiles(report);
    if (files.length > 0 && navigator.share) {
      // Filer finns — öppna delar-menyn så Signal kan ta emot bilder/GPX
      try {
        await navigator.share({ title: '7S Rapport', text, files });
      } catch { /* user cancelled */ }
    } else {
      // Inga filer — kopiera texten som vanligt
      try {
        await navigator.clipboard.writeText(text);
        showToast('✓ Kopierat! Klistra in i Signal.');
      } catch {
        showToast('Kopiera texten ovan manuellt');
      }
    }
  };

  document.getElementById('shareBtn').onclick = async () => {
    if (navigator.share) {
      try {
        const shareData = { title: '7S Rapport', text };
        const files = await buildShareFiles(report);
        if (files.length > 0) shareData.files = files;
        await navigator.share(shareData);
      } catch { /* user cancelled */ }
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
    const s       = getSettings();
    const subject = `7S Rpt TNR: ${toTidsnummer(report.stund)}`;
    const files   = await buildShareFiles(report);

    if (files.length > 0 && navigator.share) {
      // mailto: stöder inte bifogade filer. Öppna delar-menyn med filer —
      // välj din e-postklient (Mail, Gmail m.fl.) för att bifoga bilderna.
      try {
        await navigator.share({ title: subject, text, files });
      } catch { /* user cancelled */ }
    } else {
      // Inga filer — öppna e-postklienten direkt med förifylld mottagare
      openMailto(s.centralEmail || '', subject, text);
    }
  };

  document.getElementById('downloadPdfBtn').onclick = async () => {
    const doc = await generatePDF([report]);
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
        📍 ${escapeHtml(r.stalle || '–')}  |  👤 ${escapeHtml(r.sagesman || '–')}${r.imageCount > 0 ? `  |  📷 ${r.imageCount} bild${r.imageCount !== 1 ? 'er' : ''}` : ''}
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
    btn.addEventListener('click', async () => {
      const r = getReports().find(x => x.id === btn.dataset.id);
      if (!r) return;
      const doc = await generatePDF([r]);
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

    const doc      = await generatePDF(todayReports);
    const filename = `7S-dagsrapport-${today}.pdf`;
    downloadPDF(doc, filename);

    const allText = todayReports.map(reportToText).join('\n\n');
    const s       = getSettings();
    const subject = `7S Dagsrapport ${today} — ${todayReports.length} rapporter — ${s.sagesman || ''}`;
    openMailto(s.centralEmail || '', subject, allText);
  });
}

// ============================================================
// INSTÄLLNINGAR
// ============================================================
function initSettings() {
  const s = getSettings();
  document.getElementById('settingName').value  = s.sagesman    || '';
  document.getElementById('settingEmail').value = s.centralEmail || '';
  document.getElementById('dailyTime').value    = s.dailyTime   || '20:00';

  document.getElementById('saveSettingsBtn').addEventListener('click', () => {
    const updated = {
      sagesman:     document.getElementById('settingName').value.trim(),
      centralEmail: document.getElementById('settingEmail').value.trim(),
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
      clearAllImages().catch(() => {});
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
// GPS PERMISSION HELP
// ============================================================
function showGpsPermissionHelp() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isPWA = window.navigator.standalone === true;

  let instructions;
  if (isIOS && isPWA) {
    instructions = `
      <strong>Appen saknar tillstånd att använda din plats.</strong><br><br>
      Gör så här på iPhone/iPad:<br>
      <ol style="margin:10px 0 0 18px;line-height:1.8">
        <li>Öppna <strong>Inställningar</strong></li>
        <li>Scrolla ned och tryck på <strong>Integritet och säkerhet</strong></li>
        <li>Tryck på <strong>Platstjänster</strong></li>
        <li>Hitta <strong>7S Rapport</strong> (eller Safari) i listan</li>
        <li>Välj <strong>Vid användning av appen</strong></li>
      </ol><br>
      Återvänd sedan till appen och tryck 📍 igen.`;
  } else if (isIOS) {
    instructions = `
      <strong>Safari blockerar platsåtkomst.</strong><br><br>
      Gör så här:<br>
      <ol style="margin:10px 0 0 18px;line-height:1.8">
        <li>Öppna <strong>Inställningar</strong></li>
        <li>Tryck på <strong>Safari</strong></li>
        <li>Tryck på <strong>Plats</strong></li>
        <li>Välj <strong>Fråga</strong> eller <strong>Tillåt</strong></li>
      </ol><br>
      Återvänd till Safari och ladda om sidan, tryck sedan 📍 igen.`;
  } else {
    instructions = `
      <strong>Platstillstånd nekades.</strong><br><br>
      Tryck på låsikonen (🔒) i adressfältet och ändra
      <em>Plats</em> till <strong>Tillåt</strong>, ladda sedan om sidan.`;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>📍 Platstillstånd krävs</h3>
      <div style="font-size:14px;line-height:1.6;color:#333">${instructions}</div>
      <div class="btn-group" style="margin-top:18px">
        <button class="btn primary" id="gpsHelpClose">Förstått</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#gpsHelpClose').onclick = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
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
  initMapPicker();
  initDailyBtn();
  initSettings();
  checkDailyReminder();
});
