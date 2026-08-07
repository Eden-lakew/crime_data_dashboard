import { state, COLORS } from './main.js';

// =========================================================================
// --- Temporal Analysis Drawer ---
// =========================================================================

let activeTemporalTab = 'month';
let drawerOpen = false;
let ambientView = 'population';
// Active station filter — null means city-wide
let activeStation = null; // { name, lat, lng, radiusMeters }

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const HOURS  = Array.from({ length: 24 }, (_, i) => `${i}:00`);
const SEASONS = ['Winter', 'Spring', 'Summer', 'Fall'];

const MONTH_TO_SEASON = {
    12: 'Winter', 1: 'Winter', 2: 'Winter',
    3: 'Spring', 4: 'Spring', 5: 'Spring',
    6: 'Summer', 7: 'Summer', 8: 'Summer',
    9: 'Fall', 10: 'Fall', 11: 'Fall'
};

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
    ['month', 'day', 'season', 'hour'].forEach(t => {
        document.getElementById(`tab-${t}`)
            .classList.toggle('active-tab', t === tab);
    });
    updateTemporalChart();
};
 
window.switchAmbientView = function (view) {
    ambientView = view;
    const popBtn = document.getElementById('ambient-toggle-pop');
    const rateBtn = document.getElementById('ambient-toggle-rate');
    if (popBtn) popBtn.classList.toggle('active-tab', view === 'population');
    if (rateBtn) rateBtn.classList.toggle('active-tab', view === 'rate');
    updateTemporalChart();
};

// ── Station selection (called from main.js on marker click) ──────────────
window.setTemporalStation = function (name, lat, lng) {
    activeStation = { name, lat, lng };

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
                    ${getCurrentRadius() !== null ? `${getCurrentRadius()}m buffer` : 'no buffer selected'}
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
// ── Per-crime-type summary for the active station ─────────────────────────
function getStationSummary() {
    if (!activeStation || !state.data.crimes) return null;

    const activeCrimeTypes = Array.from(state.activeLayers)
        .filter(k => k.startsWith('crime-'))
        .map(k => k.replace('crime-', ''));
    const useAll = activeCrimeTypes.length === 0;

    const perType = {};

    state.data.crimes.features.forEach(f => {
        const p = f.properties;
        const type = p.TYPE || 'Unknown';
        if (!useAll && !activeCrimeTypes.includes(type)) return;
        if (!f.geometry?.coordinates) return;
        const [cLng, cLat] = f.geometry.coordinates;
        if (cLng === 0 && cLat === 0) return;
        const dist = getDistanceMeters(activeStation.lat, activeStation.lng, cLat, cLng);
        const radius = getCurrentRadius();
        if (radius === null || dist > radius) return;

        if (!perType[type]) {
            perType[type] = { hourCounts: {}, dayCounts: {}, seasonCounts: {}, total: 0 };
        }
        const b = perType[type];
        b.total++;

        const h = parseInt(p.HOUR);
        if (!isNaN(h)) b.hourCounts[h] = (b.hourCounts[h] || 0) + 1;

        const y = parseInt(p.YEAR), m = parseInt(p.MONTH), d = parseInt(p.DAY);
        if (y && m && d) {
            const dow = (new Date(y, m - 1, d).getDay() + 6) % 7;
            b.dayCounts[DAYS[dow]] = (b.dayCounts[DAYS[dow]] || 0) + 1;
            b.seasonCounts[MONTH_TO_SEASON[m]] = (b.seasonCounts[MONTH_TO_SEASON[m]] || 0) + 1;
        }
    });

    const peak = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0];

    return Object.entries(perType)
        .map(([type, b]) => {
            const peakHour   = peak(b.hourCounts);
            const peakDay    = peak(b.dayCounts);
            const peakSeason = peak(b.seasonCounts);
            return {
                type,
                total: b.total,
                peakDay: peakDay ? peakDay[0] : '—',
                peakHour: peakHour ? `${peakHour[0]}:00` : '—',
                peakSeason: peakSeason ? peakSeason[0] : '—'
            };
        })
        .sort((a, b) => b.total - a.total);
}

function renderStationSummary() {
    const el = document.getElementById('temporal-station-summary');
    if (!el) return;
    const summary = getStationSummary();
    if (!summary || summary.length === 0) { el.innerHTML = ''; return; }

    el.innerHTML = summary.map(s => `
        <div style="font-size:0.78rem; color:#cbd5e1; padding:2px 0;">
            <span style="font-weight:600; color:#f1f5f9;">${s.type}</span>
            peaks <span style="color:#a7f3d0;">${s.peakDay}, ${s.peakHour}</span>
            &nbsp;·&nbsp; highest season: <span style="color:#a7f3d0;">${s.peakSeason}</span>
            <span style="color:#64748b;">(${s.total} total)</span>
        </div>
    `).join('');
}
function getCurrentRadius() {
    const bufferSelect = document.getElementById('buffer-zone-select');
    if (!bufferSelect || bufferSelect.value === 'none') return null;
    return parseInt(bufferSelect.value);
}
function getStationCERByType(stationName, radius) {
    const cerData = state.data.cer;
    if (!cerData?.[stationName]?.[String(radius)] || radius === null) return null;
    const { ambient, crimeByType } = cerData[stationName][String(radius)];
    if (!ambient || !crimeByType) return null;

    const activeCrimeTypes = Array.from(state.activeLayers)
        .filter(k => k.startsWith('crime-')).map(k => k.replace('crime-', ''));
    const types = activeCrimeTypes.length > 0 ? activeCrimeTypes : Object.keys(crimeByType);

    const result = {}; // { type: { bucketLabel: rate|null } }

    types.forEach(type => {
        if (activeTemporalTab === 'month') {
            result[type] = {};
            MONTHS.forEach((label, i) => {
                const monthKey = String(i + 1);
                const hourObj = ambient[monthKey];
                if (!hourObj) { result[type][label] = null; return; }
                let c = 0, a = 0;
                Object.keys(hourObj).forEach(hourKey => {
                    c += crimeByType[type]?.[monthKey]?.[hourKey] || 0;
                    a += hourObj[hourKey];
                });
                result[type][label] = a > 0 ? (c / a) * 10000 : null;
            });
        }

        if (activeTemporalTab === 'season') {
            const totals = {};
            SEASONS.forEach(s => { totals[s] = { crime: 0, ambient: 0 }; });
            Object.entries(ambient).forEach(([monthKey, hourObj]) => {
                const season = MONTH_TO_SEASON[parseInt(monthKey)];
                if (!season) return;
                Object.entries(hourObj).forEach(([hourKey, v]) => {
                    totals[season].crime += crimeByType[type]?.[monthKey]?.[hourKey] || 0;
                    totals[season].ambient += v;
                });
            });
            result[type] = {};
            SEASONS.forEach(s => {
                result[type][s] = totals[s].ambient > 0 ? (totals[s].crime / totals[s].ambient) * 10000 : null;
            });
        }

        if (activeTemporalTab === 'hour') {
            const totals = {};
            HOURS.forEach(h => { totals[h] = { crime: 0, ambient: 0 }; });
            Object.entries(ambient).forEach(([monthKey, hourObj]) => {
                Object.entries(hourObj).forEach(([hourKey, v]) => {
                    const label = `${hourKey}:00`;
                    if (!totals[label]) return;
                    totals[label].crime += crimeByType[type]?.[monthKey]?.[hourKey] || 0;
                    totals[label].ambient += v;
                });
            });
            result[type] = {};
            HOURS.forEach(h => {
                result[type][h] = totals[h].ambient > 0 ? (totals[h].crime / totals[h].ambient) * 10000 : null;
            });
        }
    });

    return result; // 'day' tab still unsupported — no ambient equivalent
}
 
function getAmbientByBucket(stationName, radius) {
    const cerData = state.data.cer;
    if (!cerData?.[stationName]?.[String(radius)] || radius === null) return null;
    const { ambient } = cerData[stationName][String(radius)];
    if (!ambient) return null;

    if (activeTemporalTab === 'month') {
        const result = {};
        MONTHS.forEach((label, i) => {
            const hourObj = ambient[String(i + 1)];
            if (!hourObj) { result[label] = null; return; }
            const vals = Object.values(hourObj);
            result[label] = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
        });
        return result;
    }

    if (activeTemporalTab === 'season') {
        const totals = {}, counts = {};
        SEASONS.forEach(s => { totals[s] = 0; counts[s] = 0; });
        Object.entries(ambient).forEach(([monthKey, hourObj]) => {
            const season = MONTH_TO_SEASON[parseInt(monthKey)];
            if (!season) return;
            Object.values(hourObj).forEach(v => { totals[season] += v; counts[season] += 1; });
        });
        const result = {};
        SEASONS.forEach(s => { result[s] = counts[s] > 0 ? totals[s] / counts[s] : null; });
        return result;
    }

    if (activeTemporalTab === 'hour') {
        const totals = {};
        const counts = {};
        HOURS.forEach(h => { totals[h] = 0; counts[h] = 0; });
        Object.values(ambient).forEach(hourObj => {
            Object.entries(hourObj).forEach(([hourKey, v]) => {
                const label = `${hourKey}:00`;
                if (totals[label] === undefined) return;
                totals[label] += v;
                counts[label] += 1;
            });
        });
        const result = {};
        HOURS.forEach(h => {
            result[h] = counts[h] > 0 ? totals[h] / counts[h] : null;
        });
        return result;
    }

    return null; // 'day' tab still unsupported — no ambient equivalent
}
 
function getFilteredCrimeTotal(stationName, radius) {
    const cerData = state.data.cer;
    if (!cerData?.[stationName]?.[String(radius)] || radius === null) return 0;
    const { crimeByType } = cerData[stationName][String(radius)];
    if (!crimeByType) return 0;
 
    const activeCrimeTypes = Array.from(state.activeLayers)
        .filter(k => k.startsWith('crime-')).map(k => k.replace('crime-', ''));
    const typesToSum = activeCrimeTypes.length > 0 ? activeCrimeTypes : Object.keys(crimeByType);
 
    let total = 0;
    typesToSum.forEach(type => {
        Object.values(crimeByType[type] || {}).forEach(hourObj => {
            total += Object.values(hourObj).reduce((s, v) => s + v, 0);
        });
    });
    return total;
}
// ── Per-station ranking when no station is selected ────────────────────────
function getAllStationsSummary() {
    if (!state.data.transit || !state.data.crimes) return [];
    const radius = getCurrentRadius(); // null = nearest-station mode (no buffer)
    const activeCrimeTypes = Array.from(state.activeLayers)
        .filter(k => k.startsWith('crime-'))
        .map(k => k.replace('crime-', ''));
    const useAll = activeCrimeTypes.length === 0;

    const seenNames = new Set();
    const stations = [];
    state.data.transit.features.forEach(t => {
        const name = t.properties.STATION || 'Unknown';
        if (seenNames.has(name)) return; // skip duplicate coordinate entries — matches main.js's convention
        seenNames.add(name);
        stations.push({
            name,
            lat: t.geometry.coordinates[1],
            lng: t.geometry.coordinates[0],
            hourCounts: {}, dayCounts: {}, typeCounts: {}, total: 0
        });
});

    function attribute(s, p) {
        s.total++;
        const h = parseInt(p.HOUR);
        if (!isNaN(h)) s.hourCounts[h] = (s.hourCounts[h] || 0) + 1;
        const y = parseInt(p.YEAR), m = parseInt(p.MONTH), d = parseInt(p.DAY);
        if (y && m && d) {
            const dow = (new Date(y, m - 1, d).getDay() + 6) % 7;
            s.dayCounts[DAYS[dow]] = (s.dayCounts[DAYS[dow]] || 0) + 1;
        }
        s.typeCounts[p.TYPE || 'Unknown'] = (s.typeCounts[p.TYPE || 'Unknown'] || 0) + 1;
    }

    state.data.crimes.features.forEach(f => {
        const p = f.properties;
        const type = p.TYPE || 'Unknown';
        if (!useAll && !activeCrimeTypes.includes(type)) return;
        const coords = f.geometry?.coordinates;
        if (!coords || (coords[0] === 0 && coords[1] === 0)) return;
        const [cLng, cLat] = coords;

         if (radius !== null) {
            // Buffer mode — crime can count toward every station within radius
            stations.forEach(s => {
                const dist = getDistanceMeters(s.lat, s.lng, cLat, cLng);
                if (dist <= radius) attribute(s, p);
            });
        }
    });

    const peak = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0];

    return stations.map(s => {
        const peakHour = peak(s.hourCounts);
        const peakDay  = peak(s.dayCounts);
        const domType  = peak(s.typeCounts);
        return {
            name: s.name, lat: s.lat, lng: s.lng,
            total: s.total,
            peakHour: peakHour ? `${peakHour[0]}:00` : '—',
            peakDay: peakDay ? peakDay[0] : '—',
            domType: domType ? `${domType[0]} (${domType[1]})` : '—',
        };
    }).sort((a, b) => b.total - a.total);
}
let rankSortKey = 'total';
let rankSortDir = -1; // -1 = desc, 1 = asc

window.sortStationRanking = function (key) {
    rankSortDir = (rankSortKey === key) ? -rankSortDir : -1;
    rankSortKey = key;
    renderStationRanking();
};

function renderStationRanking() {
    const container = document.getElementById('temporal-chart-container');
    if (!container) return;
 
    const radius = getCurrentRadius();
    const countLabel = radius !== null
    ? `Count (${radius}m buffer)`
    : 'Count (no buffer selected)';
 
    let rows = getAllStationsSummary();
    rows.sort((a, b) => {
        const va = a[rankSortKey], vb = b[rankSortKey];
        if (typeof va === 'number') return (va - vb) * rankSortDir;
        return String(va).localeCompare(String(vb)) * rankSortDir;
    });
 
    container.innerHTML = `
        <table style="width:100%; border-collapse:collapse; font-size:0.8rem; font-family:Outfit,sans-serif;">
            <thead>
                <tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
                    <th style="text-align:left; padding:6px 8px; color:#94a3b8; cursor:pointer;" onclick="sortStationRanking('name')">Station</th>
                    <th style="text-align:right; padding:6px 8px; color:#94a3b8; cursor:pointer;" onclick="sortStationRanking('total')">${countLabel}</th>
                    <th style="text-align:left; padding:6px 8px; color:#94a3b8; cursor:pointer;" onclick="sortStationRanking('peakHour')">Peak hour</th>
                    <th style="text-align:left; padding:6px 8px; color:#94a3b8; cursor:pointer;" onclick="sortStationRanking('peakDay')">Peak day</th>
                    <th style="text-align:left; padding:6px 8px; color:#94a3b8; cursor:pointer;" onclick="sortStationRanking('domType')">Dominant type</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map(r => `
                    <tr style="border-bottom:1px solid rgba(255,255,255,0.05); cursor:pointer;"
                        onmouseover="this.style.background='rgba(255,255,255,0.03)'"
                        onmouseout="this.style.background='transparent'"
                        onclick="setTemporalStation('${r.name.replace(/'/g, "\\'")}', ${r.lat}, ${r.lng})">
                        <td style="padding:6px 8px; color:#f1f5f9; font-weight:600;">${r.name}</td>
                        <td style="padding:6px 8px; text-align:right; color:#f1f5f9;">${r.total}</td>
                        <td style="padding:6px 8px; color:#a7f3d0;">${r.peakHour}</td>
                        <td style="padding:6px 8px; color:#94a3b8;">${r.peakDay}</td>
                        <td style="padding:6px 8px; color:#94a3b8;">${r.domType}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>`;
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
                  : activeTemporalTab === 'season' ? SEASONS
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
            const radius = getCurrentRadius();
            if (radius === null || dist > radius) return;
        }

        let key;
        if (activeTemporalTab === 'month') {
            const m = parseInt(p.MONTH);
            if (!m || m < 1 || m > 12) return;
            key = MONTHS[m - 1];
        } else if (activeTemporalTab === 'day') {
            const y = parseInt(p.YEAR);
            const m = parseInt(p.MONTH);
            const d = parseInt(p.DAY);
            if (!y || !m || !d) return;
            const dateObj = new Date(y, m - 1, d);
            if (isNaN(dateObj.getTime())) return;
            // getDay(): 0=Sun..6=Sat — remap so array is Mon..Sun to match DAYS
            const jsDay = dateObj.getDay();
            const dowIndex = (jsDay + 6) % 7; // Mon=0 ... Sun=6
            key = DAYS[dowIndex];
        } else if (activeTemporalTab === 'season') {
            const m = parseInt(p.MONTH);
            if (!m || m < 1 || m > 12) return;
            key = MONTH_TO_SEASON[m];
        }
        else {
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

export function updateTemporalChart() {
    if (!drawerOpen) return;

    updateStationBadge();
    const tabsRow = document.getElementById('temporal-tabs-row');
    const ambientSection = document.getElementById('ambient-section');

    if (!activeStation) {
        if (tabsRow) tabsRow.style.display = 'none';
        if (ambientSection) ambientSection.style.display = 'none';
        const summaryEl = document.getElementById('temporal-station-summary');
        if (summaryEl) summaryEl.innerHTML = '';
        renderStationRanking();
        return;
    }
    if (tabsRow) tabsRow.style.display = 'flex';
    if (ambientSection) ambientSection.style.display = 'block';
    renderStationSummary();
 
    const chartContainer = document.getElementById('temporal-chart-container');
    if (chartContainer && !document.getElementById('temporal-chart-svg')) {
        chartContainer.innerHTML = `<svg id="temporal-chart-svg" width="100%" height="100%" style="overflow: visible;"></svg>`;
    }
 
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
 
    const label = document.getElementById('temporal-chart-label');
    if (label) {
        label.textContent = allTypes[0] === 'All Crimes'
            ? 'All crime types'
            : allTypes.join(', ');
    }
 
    const container = document.getElementById('temporal-chart-container');
    const W  = container.clientWidth  || 800;
    const H  = container.clientHeight || 180;
    const mL = 52, mR = 16, mT = 6, mB = allTypes.length > 1 ? 44 : 28;
    const cW = W - mL - mR;
    const cH = H - mT - mB;
 
    const typeColorMap = {};
    allTypes.forEach((t, i) => { typeColorMap[t] = colorForType(t, i); });
 
    const bucketTotals = buckets.map(b =>
        allTypes.reduce((s, t) => s + (counts[b][t] || 0), 0)
    );
    const maxVal = Math.max(...bucketTotals, 1);
 
    const rawStep   = maxVal / 4;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
    const tickStep  = Math.ceil(rawStep / magnitude) * magnitude || 1;
    const ticks     = [];
    for (let v = 0; v <= maxVal * 1.05; v += tickStep) ticks.push(v);
 
    const groupW = cW / buckets.length;
    const barPad = Math.max(1, groupW * 0.12);
    const barW   = Math.max(2, groupW - barPad * 2);
 
    let inner = '';
 
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
 
    inner += `<line x1="0" y1="0" x2="0" y2="${cH}"
                    stroke="rgba(255,255,255,0.1)" stroke-width="1"/>`;
 
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
 
    const radius = getCurrentRadius();

    const sparsityEl = document.getElementById('temporal-sparsity-warning');
    if (sparsityEl) {
        const totalFiltered = activeStation && radius !== null ? getFilteredCrimeTotal(activeStation.name, radius) : null;
        const showWarning = ambientView === 'rate' && totalFiltered !== null && totalFiltered < 10;
        sparsityEl.style.display = showWarning ? 'flex' : 'none';
        if (showWarning) {
            sparsityEl.innerHTML = `Only ${totalFiltered} incidents in this filter — the rate may not be statistically meaningful.`;
        }
    }

    const bottomSvg = document.getElementById('ambient-chart-svg');
    const aH = 90;

    if (bottomSvg && activeStation && radius !== null) {
        if (ambientView === 'population') {
            const popData = getAmbientByBucket(activeStation.name, radius);
            const vals = popData ? buckets.map(b => popData[b]).filter(v => v !== null) : [];
            const maxVal2 = Math.max(...vals, 1);
            const points = buckets.map((b, i) => {
                const val = popData[b];
                if (val === null) return null;
                return { x: (i * groupW + groupW / 2).toFixed(1), y: (aH - (val / maxVal2) * aH).toFixed(1), val };
            }).filter(p => p !== null);
            const linePoints = points.map(p => `${p.x},${p.y}`).join(' ');
            const dots = points.map(p => `
                <circle cx="${p.x}" cy="${p.y}" r="8" fill="transparent" style="cursor:pointer;"
                    onmouseover="var tt=document.getElementById('temporal-tooltip'); tt.innerHTML='${Math.round(p.val).toLocaleString()} people'; tt.style.display='block';"
                    onmouseout="document.getElementById('temporal-tooltip').style.display='none';"/>
                <circle cx="${p.x}" cy="${p.y}" r="3" fill="#10b981" pointer-events="none"/>`).join('');
            bottomSvg.innerHTML = `<g transform="translate(${mL}, 4)">
                <polygon points="0,${aH} ${linePoints} ${cW},${aH}" fill="#10b981" opacity="0.15"/>
                <polyline points="${linePoints}" fill="none" stroke="#10b981" stroke-width="2"/>
                ${dots}
            </g>`;
        } else {
            const rateByType = getStationCERByType(activeStation.name, radius);
            if (!rateByType) { bottomSvg.innerHTML = ''; }
            else {
                const types = Object.keys(rateByType);
                let allVals = [];
                types.forEach(t => { allVals.push(...buckets.map(b => rateByType[t][b]).filter(v => v !== null)); });
                const maxVal2 = Math.max(...allVals, 0.01);

                let linesHtml = '';
                let legendHtml = '';
                let lx = 0;

                types.forEach((type, idx) => {
                    const color = colorForType(type, idx);
                    const points = buckets.map((b, i) => {
                        const val = rateByType[type][b];
                        if (val === null) return null;
                        return { x: (i * groupW + groupW / 2).toFixed(1), y: (aH - (val / maxVal2) * aH).toFixed(1), val };
                    }).filter(p => p !== null);
                    if (points.length < 2) return;
                    const linePoints = points.map(p => `${p.x},${p.y}`).join(' ');
                    const safeType = type.replace(/'/g, "\\'");
                    const dots = points.map(p => `
                        <circle cx="${p.x}" cy="${p.y}" r="7" fill="transparent" style="cursor:pointer;"
                            onmouseover="var tt=document.getElementById('temporal-tooltip'); tt.innerHTML='<b>${safeType}</b>: ${p.val.toFixed(2)} per 10k'; tt.style.display='block';"
                            onmouseout="document.getElementById('temporal-tooltip').style.display='none';"/>
                        <circle cx="${p.x}" cy="${p.y}" r="2.5" fill="${color}" pointer-events="none"/>`).join('');
                    linesHtml += `<polyline points="${linePoints}" fill="none" stroke="${color}" stroke-width="2" opacity="0.9"/>${dots}`;

                    legendHtml += `<rect x="${lx}" y="0" width="8" height="8" fill="${color}" rx="2"/>
                        <text x="${lx+12}" y="8" fill="#94a3b8" font-size="9" font-family="Outfit, sans-serif">${type}</text>`;
                    lx += Math.min(type.length * 5.5 + 20, 150);
                });

                bottomSvg.innerHTML = `<g transform="translate(${mL}, 20)">${linesHtml}</g>
                    <g transform="translate(${mL}, 4)">${legendHtml}</g>`;
            }
        }
    } else if (bottomSvg) {
        bottomSvg.innerHTML = '';
    }
}
 
window.updateTemporalChart = updateTemporalChart;