import { state, COLORS } from './main.js';

// =========================================================================
// --- Temporal Analysis Drawer ---
// =========================================================================

let activeTemporalTab = 'month';
let drawerOpen = false;

// Active station filter — null means city-wide
let activeStation = null; // { name, lat, lng, radiusMeters }

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const HOURS  = Array.from({ length: 24 }, (_, i) => `${i}:00`);

// ── Drawer open / close ──────────────────────────────────────────────────
window.toggleTemporalDrawer = function () {
    drawerOpen = !drawerOpen;
    const drawer = document.getElementById('temporal-drawer');
    const arrow  = document.getElementById('temporal-drawer-arrow');
    drawer.style.transform = drawerOpen ? 'translateY(0)' : 'translateY(100%)';
    arrow.textContent = drawerOpen ? '▼' : '▲';
    if (drawerOpen) updateTemporalChart();
};

// ── Tab switching ────────────────────────────────────────────────────────
window.switchTemporalTab = function (tab) {
    activeTemporalTab = tab;
    ['month', 'day', 'hour'].forEach(t => {
        document.getElementById(`tab-${t}`)
            .classList.toggle('active-tab', t === tab);
    });
    updateTemporalChart();
};

// ── Station selection (called from main.js on marker click) ──────────────
window.setTemporalStation = function (name, lat, lng) {
    const bufferSelect = document.getElementById('buffer-zone-select');
    const radius = bufferSelect && bufferSelect.value !== 'none'
        ? parseInt(bufferSelect.value)
        : 150;

    activeStation = { name, lat, lng, radiusMeters: radius };

    // Open drawer if closed
    if (!drawerOpen) {
        drawerOpen = true;
        const drawer = document.getElementById('temporal-drawer');
        const arrow  = document.getElementById('temporal-drawer-arrow');
        drawer.style.transform = 'translateY(0)';
        arrow.textContent = '▼';
    }

    updateStationBadge();
    updateTemporalChart();
};

// ── Clear station (reset to city-wide) ───────────────────────────────────
window.clearTemporalStation = function () {
    activeStation = null;
    updateStationBadge();
    updateTemporalChart();
};

// ── Update the station name + clear button in the tab row ────────────────
function updateStationBadge() {
    const badge = document.getElementById('temporal-station-badge');
    if (!badge) return;

    if (activeStation) {
        badge.innerHTML = `
            <span style="
                display: inline-flex;
                align-items: center;
                gap: 6px;
                background: rgba(16,185,129,0.12);
                border: 1px solid rgba(16,185,129,0.3);
                border-radius: 6px;
                padding: 3px 8px;
                font-size: 0.75rem;
                color: #a7f3d0;
                font-weight: 600;
            ">
                🚆 ${activeStation.name}
                <span style="color:#475569; font-size:0.7rem;">
                    ${activeStation.radiusMeters}m buffer
                </span>
                <button onclick="clearTemporalStation()" style="
                    background: rgba(239,68,68,0.15);
                    border: 1px solid rgba(239,68,68,0.3);
                    border-radius: 4px;
                    color: #fca5a5;
                    font-size: 0.7rem;
                    padding: 1px 6px;
                    cursor: pointer;
                    font-family: Outfit, sans-serif;
                ">✕ Clear</button>
            </span>`;
    } else {
        badge.innerHTML = '';
    }
}

// ── Haversine distance (duplicated here to avoid main.js dependency) ─────
function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const r1 = lat1 * Math.PI / 180;
    const r2 = lat2 * Math.PI / 180;
    const dr = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a  = Math.sin(dr/2)**2 + Math.cos(r1)*Math.cos(r2)*Math.sin(dl/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── Aggregate crime data for the active tab ──────────────────────────────
function getTemporalData() {
    if (!state.data.crimes) return null;

    const activeCrimeTypes = Array.from(state.activeLayers)
        .filter(k => k.startsWith('crime-'))
        .map(k => k.replace('crime-', ''));

    const useAll = activeCrimeTypes.length === 0;

    const buckets = activeTemporalTab === 'month' ? MONTHS
                  : activeTemporalTab === 'day'   ? DAYS
                  : HOURS;

    const counts = {};
    buckets.forEach(b => { counts[b] = {}; });

    state.data.crimes.features.forEach(f => {
        const p    = f.properties;
        const type = p.TYPE || 'Unknown';
        if (!useAll && !activeCrimeTypes.includes(type)) return;

        // Station filter — skip crimes outside buffer
        if (activeStation) {
            if (!f.geometry?.coordinates) return;
            const [cLng, cLat] = f.geometry.coordinates;
            if (cLng === 0 && cLat === 0) return;
            const dist = getDistanceMeters(activeStation.lat, activeStation.lng, cLat, cLng);
            if (dist > activeStation.radiusMeters) return;
        }

        let key;
        if (activeTemporalTab === 'month') {
            const m = parseInt(p.MONTH);
            if (!m || m < 1 || m > 12) return;
            key = MONTHS[m - 1];
        } else if (activeTemporalTab === 'day') {
            const d = parseInt(p.DAY);
            if (!d || d < 1 || d > 7) return;
            key = DAYS[d - 1];
        } else {
            const h = parseInt(p.HOUR);
            if (isNaN(h) || h < 0 || h > 23) return;
            key = `${h}:00`;
        }

        const displayType = useAll ? 'All Crimes' : type;
        counts[key][displayType] = (counts[key][displayType] || 0) + 1;
    });

    const allTypes = useAll ? ['All Crimes'] : activeCrimeTypes;
    return { buckets, counts, allTypes };
}

// ── Color helper ─────────────────────────────────────────────────────────
function colorForType(type, index) {
    if (type === 'All Crimes') return '#3b82f6';
    const key = 'crime-' + type;
    return COLORS[key] ||
        ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899'][index % 6];
}

// ── Main render ───────────────────────────────────────────────────────────
export function updateTemporalChart() {
    if (!drawerOpen) return;

    const svg = document.getElementById('temporal-chart-svg');
    if (!svg) return;

    const data = getTemporalData();
    if (!data) {
        svg.innerHTML = `
            <text x="50%" y="50%" text-anchor="middle"
                  fill="#475569" font-family="Outfit, sans-serif" font-size="14">
                No crime data loaded.
            </text>`;
        return;
    }

    const { buckets, counts, allTypes } = data;

    // Update "Showing:" label
    const label = document.getElementById('temporal-chart-label');
    if (label) {
        label.textContent = allTypes[0] === 'All Crimes'
            ? 'All crime types'
            : allTypes.join(', ');
    }

    // Update station badge
    updateStationBadge();

    // ── Dimensions ──────────────────────────────────────────────────────
    const container = document.getElementById('temporal-chart-container');
    const W  = container.clientWidth  || 800;
    const H  = container.clientHeight || 180;
    const mL = 52, mR = 16, mT = 6, mB = allTypes.length > 1 ? 44 : 28;
    const cW = W - mL - mR;
    const cH = H - mT - mB;

    // ── Color map ────────────────────────────────────────────────────────
    const typeColorMap = {};
    allTypes.forEach((t, i) => { typeColorMap[t] = colorForType(t, i); });

    // ── Scale ────────────────────────────────────────────────────────────
    const bucketTotals = buckets.map(b =>
        allTypes.reduce((s, t) => s + (counts[b][t] || 0), 0)
    );
    const maxVal = Math.max(...bucketTotals, 1);

    const rawStep   = maxVal / 4;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
    const tickStep  = Math.ceil(rawStep / magnitude) * magnitude || 1;
    const ticks     = [];
    for (let v = 0; v <= maxVal * 1.05; v += tickStep) ticks.push(v);

    // ── Bar geometry ─────────────────────────────────────────────────────
    const groupW = cW / buckets.length;
    const barPad = Math.max(1, groupW * 0.12);
    const barW   = Math.max(2, groupW - barPad * 2);

    // ── SVG content ──────────────────────────────────────────────────────
    let inner = '';

    // Grid + Y labels
    ticks.forEach(tick => {
        const y = cH - (tick / maxVal) * cH;
        inner += `
            <line x1="0" y1="${y.toFixed(1)}" x2="${cW}" y2="${y.toFixed(1)}"
                  stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
            <text x="-6" y="${(y+4).toFixed(1)}" text-anchor="end"
                  fill="#475569" font-size="10" font-family="Outfit, sans-serif">
                ${tick >= 1000 ? (tick/1000).toFixed(tick % 1000 === 0 ? 0 : 1)+'k' : tick}
            </text>`;
    });

    // Bars + X labels
    const labelEvery = buckets.length > 16 ? 2 : 1;

    buckets.forEach((bucket, i) => {
        const x = i * groupW + barPad;
        let yOffset = 0;

        allTypes.forEach(type => {
            const val = counts[bucket][type] || 0;
            if (val === 0) return;
            const bH    = Math.max(1, (val / maxVal) * cH);
            const y     = cH - yOffset - bH;
            const color = typeColorMap[type];
            const safeLabel = bucket.replace(/'/g, "\\'");
            const safeType  = type.replace(/'/g, "\\'");

            inner += `
                <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}"
                      width="${barW.toFixed(1)}" height="${bH.toFixed(1)}"
                      fill="${color}" opacity="0.85" rx="2"
                      style="cursor:pointer; transition:opacity 0.15s;"
                      onmouseover="
                          this.setAttribute('opacity','1');
                          var tt=document.getElementById('temporal-tooltip');
                          tt.innerHTML='<b>${safeLabel}</b>: ${val.toLocaleString()} ${safeType}';
                          tt.style.display='block';
                      "
                      onmouseout="
                          this.setAttribute('opacity','0.85');
                          document.getElementById('temporal-tooltip').style.display='none';
                      "
                />`;
            yOffset += bH;
        });

        if (i % labelEvery === 0) {
            inner += `
                <text x="${(x + barW/2).toFixed(1)}" y="${(cH+16).toFixed(1)}"
                      text-anchor="middle" fill="#64748b"
                      font-size="${buckets.length > 16 ? 9 : 11}"
                      font-family="Outfit, sans-serif">
                    ${bucket}
                </text>`;
        }
    });

    // Y axis spine
    inner += `<line x1="0" y1="0" x2="0" y2="${cH}"
                    stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`;

    // Tooltip
    inner += `
        <foreignObject x="${cW - 240}" y="-8" width="240" height="60"
                       style="pointer-events:none; overflow:visible;">
            <div xmlns="http://www.w3.org/1999/xhtml">
                <div id="temporal-tooltip" style="
                    display:none;
                    background:rgba(15,23,42,0.95);
                    border:1px solid rgba(255,255,255,0.12);
                    border-radius:6px; padding:6px 10px;
                    font-family:Outfit,sans-serif; font-size:0.78rem;
                    color:#f8fafc; white-space:nowrap; pointer-events:none;
                "></div>
            </div>
        </foreignObject>`;

    // Legend
    if (allTypes.length > 1) {
        let lx = 0;
        let legendRow = '';
        allTypes.forEach((type, idx) => {
            const color = typeColorMap[type];
            legendRow += `
                <rect x="${lx}" y="0" width="10" height="10" fill="${color}" rx="2"/>
                <text x="${lx+14}" y="9" fill="#94a3b8"
                      font-size="10" font-family="Outfit, sans-serif">${type}</text>`;
            lx += Math.min(type.length * 6.5 + 28, 180);
        });
        inner += `<g transform="translate(0, ${cH+26})">${legendRow}</g>`;
    }

    svg.innerHTML = `<g transform="translate(${mL}, ${mT})">${inner}</g>`;
}

window.updateTemporalChart = updateTemporalChart;