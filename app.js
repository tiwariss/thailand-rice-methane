(function () {
  'use strict';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const NODATA = '#a9a9a9', LAND = '#ececec', ink = '#222222', TH_BOUNDS = [[5.4, 97.2], [20.6, 105.8]];
  const G = window.DATA_GRID, P = window.DATA_PROVINCES, B = window.DATA_BASEMAP;
  const APP = (window.APP = { interval: 2000, monthInterval: 650 });
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = (v, d) => (v === null || v === undefined || Number.isNaN(v) ? 'No data' : d3.format(',.' + d + 'f')(v));

  // fixed colour scale per view: sqrt, 0 at the low end, clamped at vmax
  function makeScale(vmax) {
    const s = d3.scaleSqrt().domain([0, vmax]).range([0, 1]).clamp(true);
    return (v) => (v === null || v === undefined || Number.isNaN(v) ? NODATA : d3.interpolateCividis(s(v)));
  }
  function legendBar(parent, vmax, digits, w) {
    const h = 34, x0 = 6, x1 = w - 12;
    const svg = d3.select(parent).append('svg').attr('width', w).attr('height', h).attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img').attr('aria-label', 'Colour scale, 0 to ' + vmax);   // viewBox: lets phones shrink it (s215)
    const id = 'g' + Math.random().toString(36).slice(2, 8);
    const gr = svg.append('defs').append('linearGradient').attr('id', id);
    d3.range(0, 1.0001, 0.05).forEach((t) => gr.append('stop').attr('offset', t * 100 + '%').attr('stop-color', d3.interpolateCividis(t)));
    svg.append('rect').attr('x', x0).attr('y', 2).attr('width', x1 - x0).attr('height', 11).attr('fill', 'url(#' + id + ')');
    const sx = d3.scaleSqrt().domain([0, vmax]).range([x0, x1]);
    [0, 0.25, 0.5, 0.75, 1].map((q) => q * q * vmax).forEach((v, i) => {
      svg.append('line').attr('x1', sx(v)).attr('x2', sx(v)).attr('y1', 13).attr('y2', 17).attr('stroke', ink);
      svg.append('text').attr('x', sx(v)).attr('y', 28).attr('text-anchor', i === 0 ? 'start' : i === 4 ? 'end' : 'middle')
        .text((i === 4 ? '≥ ' : '') + d3.format(',.' + (v < 10 && v > 0 ? digits : 0) + 'f')(v));
    });
  }
  function noDataSwatch(parent) {
    const nd = document.createElement('div'); nd.className = 'nd';
    const sw = document.createElement('span'); sw.className = 'sw'; nd.append(sw, document.createTextNode('No data')); parent.append(nd);
  }
  function legend(map, title, unit, vmax, digits, note) {
    const ctl = L.control({ position: 'bottomright' });
    ctl.onAdd = function () {
      const div = L.DomUtil.create('div', 'legend'); L.DomEvent.disableClickPropagation(div);
      const t = document.createElement('div'); t.className = 'lt'; t.textContent = title; div.append(t);
      if (note) { const n = document.createElement('div'); n.className = 'lu ln'; n.textContent = note; div.append(n); }
      const u = document.createElement('div'); u.className = 'lu'; u.textContent = unit; div.append(u);
      legendBar(div, vmax, digits, 190); noDataSwatch(div);
      return div;
    };
    ctl.addTo(map);
    return ctl;
  }
  function baseMap(el, opts) {
    const map = L.map(el, Object.assign({ zoomSnap: 0.25, minZoom: 4, maxZoom: 11, attributionControl: false }, opts || {})).fitBounds(TH_BOUNDS);
    map._fitted = map.getSize().x > 0;
    [['base', 250], ['lines', 450], ['hl', 460]].forEach(([n, z]) => { map.createPane(n).style.zIndex = z; });
    map.getPane('lines').style.pointerEvents = 'none'; map.getPane('hl').style.pointerEvents = 'none';
    L.geoJSON(B, { pane: 'base', interactive: false, style: { color: '#ffffff', weight: 0.7, fillColor: LAND, fillOpacity: 1 } }).addTo(map);
    return map;
  }
  function ensureFit(map) { map.invalidateSize(); if (!map._fitted && map.getSize().x > 0) { map.fitBounds(TH_BOUNDS); map._fitted = true; } }
  function player(btn, step, intervalKey) {
    let timer = null;
    const stop = () => { if (timer) clearInterval(timer); timer = null; btn.setAttribute('aria-pressed', 'false'); btn.textContent = '▶ Play'; };
    const start = () => { if (timer) return; btn.setAttribute('aria-pressed', 'true'); btn.textContent = '❚❚ Pause'; timer = setInterval(step, APP[intervalKey]); };
    btn.addEventListener('click', () => (timer ? stop() : start()));
    return { stop, start, playing: () => !!timer };
  }

  // ================= seasonal grid
  (function grid() {
    const col = makeScale(G.vmax);
    let month = 1, sel = null, hover = null;
    const map = baseMap('map-grid');
    const renderer = L.canvas({ padding: 0.3 });
    const centre = (i) => [G.cells[i][0] + G.cellsize / 2, G.cells[i][1] + G.cellsize / 2];
    const tipText = (i) => { const [x, y] = centre(i); return `Cell ${x.toFixed(2)}°E, ${y.toFixed(2)}°N · ${MONTHS[month - 1]} (reference period) · ${fmt(G.months[i][month - 1], 2)} t CH₄`; };
    // s203: Thailand painted in the scale's 0 colour under the cells (no-rice land reads as 0), and cells that cross the
    // national outline cut along it (data/national_cells.js; 0 = wholly outside, not drawn)
    const NC = window.DATA_NATIONAL_CELLS || {};
    const toLL = (g) => (g.type === 'Polygon' ? g.coordinates.map((ring) => ring.map(([lx, ly]) => [ly, lx]))
      : g.coordinates.map((poly) => poly.map((ring) => ring.map(([lx, ly]) => [ly, lx]))));
    const cellShape = (i, opts) => {
      const [x, y] = G.cells[i], g = NC[i];
      const r = g ? L.polygon(toLL(g), opts) : L.rectangle([[y, x], [y + G.cellsize, x + G.cellsize]], opts);
      r.outside = g === 0; return r;
    };
    L.geoJSON(P.geo, { renderer, interactive: false, style: { stroke: false, fillOpacity: 1, fillColor: col(0) } }).addTo(map);
    const layers = G.cells.map(([x, y], i) => {
      const r = cellShape(i, { renderer, stroke: false, fillOpacity: 1, fillColor: col(G.months[i][0]) });
      r.cellIndex = i;
      r.bindTooltip(() => tipText(i), { sticky: true, className: 'tip', direction: 'top', offset: [0, -6] });
      r.on('mouseover', () => { hover = i; info(i); });
      r.on('mouseout', () => { hover = null; info(null); });
      r.on('click', () => select(i));
      return r.outside ? r : r.addTo(map);
    });
    L.geoJSON(P.geo, { pane: 'lines', interactive: false, style: { color: '#ffffff', weight: 0.4, fill: false, opacity: 0.35 } }).addTo(map);   // s218: fainter province lines
    // s220: a click selects the whole province (outline on the map + its monthly chart); hover still reads one cell
    let hl = null;
    const selectedInfo = document.getElementById('grid-selected');
    function info(i) {
      document.getElementById('grid-info').textContent = i === null
        ? 'Hover to read a cell. Click to select its province.'
        : tipText(i);
      selectedInfo.hidden = !gsel;
      if (gsel) selectedInfo.textContent = `Selected: ${gsel} · ${MONTHS[month - 1]} (reference period) · ${fmt(PM[gsel][month - 1], 2)} Gg CH₄`;
    }
    function selectProv(p) {
      if (!PM[p]) return;
      gsel = p;
      if (hl) map.removeLayer(hl);
      const f = P.geo.features.find((ft) => ft.properties.province === p);
      hl = L.layerGroup([   // white halo under a dark line so the outline shows on dark and bright cells
        L.geoJSON(f, { pane: 'hl', interactive: false, style: { color: '#ffffff', weight: 5, fill: false, opacity: 0.95 } }),
        L.geoJSON(f, { pane: 'hl', interactive: false, style: { color: ink, weight: 2.2, fill: false } })]).addTo(map);
      provSeason(); peakMap(); info(hover);
      if (APP.writeHash) APP.writeHash();
    }
    function select(i) { if (cellProv[i]) selectProv(cellProv[i].p); }   // a cell selects its province (largest share of the cell)
    const gridLegend = document.getElementById('grid-legend');
    legendBar(gridLegend, G.vmax, 1, 190);
    noDataSwatch(gridLegend);
    document.getElementById('grid-ref').textContent = G.period;
    const NAT = d3.range(12).map((k) => d3.sum(G.months, (r) => r[k]) / 1000);
    // s218: Thailand by month, the current month highlighted; a bar click shows that month
    function bars(card, vals, h, label, digits) {
      card.replaceChildren();
      const w = Math.max(240, card.clientWidth || 300), mg = { t: 14, r: 6, b: 18, l: 34 };
      const x = d3.scaleBand().domain(d3.range(1, 13)).range([mg.l, w - mg.r]).padding(0.18);
      const yy = d3.scaleLinear().domain([0, d3.max(vals) * 1.08 || 1]).nice().range([h - mg.b, mg.t]);
      const svg = d3.select(card).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img')
        .attr('aria-label', label + ' by month; highest in ' + MONTHS[vals.indexOf(d3.max(vals))]);
      svg.append('g').attr('transform', `translate(${mg.l},0)`).call(d3.axisLeft(yy).ticks(h < 110 ? 2 : 4).tickSize(-(w - mg.l - mg.r))).call((g) => g.select('.domain').remove());
      svg.append('g').attr('transform', `translate(0,${h - mg.b})`).call(d3.axisBottom(x).tickSize(0).tickFormat((m) => MONTHS[m - 1][0])).call((g) => g.select('.domain').attr('stroke', '#9a9a9a'));
      svg.selectAll('rect.bar').data(vals).join('rect').attr('class', 'bar')
        .attr('x', (d, k) => x(k + 1)).attr('width', x.bandwidth()).attr('y', (d) => yy(d)).attr('height', (d) => yy(0) - yy(d))
        .attr('fill', (d, k) => (k + 1 === month ? d3.interpolateCividis(0.92) : '#c9c9c9'))
        .attr('stroke', (d, k) => (k + 1 === month ? ink : 'none')).style('cursor', 'pointer')
        .on('click', (e, d) => { gpl.stop(); setMonth(vals.indexOf(d) + 1); });
      svg.append('text').attr('x', x(month) + x.bandwidth() / 2).attr('y', yy(vals[month - 1]) - 3).attr('text-anchor', 'middle')
        .attr('font-weight', 700).text(fmt(vals[month - 1], digits));
    }
    // s219: province monthly series = sum over the province's cells of (cell month / cell year) x the province's allocated t
    const PM = {}, cellProv = {};
    Object.entries(G.byprov).forEach(([p, list]) => {
      const m = new Array(12).fill(0);
      list.forEach(([i, t]) => {
        const yr = d3.sum(G.months[i]); if (yr > 0) G.months[i].forEach((v, k) => { m[k] += v / yr * t / 1000; });
        if (!cellProv[i] || cellProv[i].t < t) cellProv[i] = { p, t };
      });
      PM[p] = m;
    });
    const peakOf = (p) => { const m = PM[p]; return m && d3.max(m) > 0 ? m.indexOf(d3.max(m)) + 1 : null; };
    let gsel = null;   // selected province on the monthly view
    function provSeason() {
      const box = document.getElementById('gprov-chart'), title = document.getElementById('gprov-title'), sub = document.getElementById('gprov-sub');
      if (!box) return;
      if (!gsel) { title.textContent = 'One province by month'; sub.textContent = 'Select a province on the peak-month map, or a cell on the main map.'; box.replaceChildren(); return; }
      const m = PM[gsel], yr = d3.sum(m), pk = peakOf(gsel);
      title.textContent = gsel;
      sub.textContent = `Gg CH₄ per month · peak in ${MONTHS[pk - 1]} · ${fmt(yr, 1)} Gg per year (2022–24 rice area)`;
      bars(box, m, 120, gsel + ' estimated rice methane', 1);
    }
    const PEAKS = [8, 9, 10, 11, 12, 1];   // months that are a provincial peak (Aug-Jan), coloured in season order
    const peakCol = d3.scaleOrdinal().domain(PEAKS).range(d3.quantize((t) => d3.interpolatePlasma(0.1 + t * 0.75), PEAKS.length));
    function peakMap() {
      const box = document.getElementById('peak-map'); if (!box) return;
      box.replaceChildren();
      const w = Math.max(240, box.clientWidth || 300), h = Math.max(220, Math.min(box.clientHeight || 300, 440, Math.round(w * 0.9))), mw = Math.min(w * 0.6, h * 0.62);
      const proj = d3.geoMercator().fitExtent([[4, 4], [mw, h - 4]], P.geo), path = d3.geoPath(proj);
      const svg = d3.select(box).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img')
        .attr('aria-label', 'Map of each province coloured by its peak month of estimated rice methane');
      svg.append('g').selectAll('path').data(P.geo.features).join('path').attr('d', path)
        .attr('fill', (f) => { const pk = peakOf(f.properties.province); return pk ? (peakCol.domain().includes(pk) ? peakCol(pk) : NODATA) : NODATA; })
        .attr('stroke', (f) => (f.properties.province === gsel ? ink : '#ffffff')).attr('stroke-width', (f) => (f.properties.province === gsel ? 2 : 0.5))
        .style('cursor', 'pointer').on('click', (e, f) => selectProv(f.properties.province))
        .append('title').text((f) => { const pk = peakOf(f.properties.province); return f.properties.province + (pk ? ': peak in ' + MONTHS[pk - 1] : ': no rice'); });
      svg.select('g').selectAll('path').filter((f) => f.properties.province === gsel).raise();
      const counts = d3.rollup(Object.keys(PM), (v) => v.length, peakOf);
      const lg = svg.append('g').attr('transform', `translate(${mw + 24},${h * 0.2})`);
      lg.append('text').attr('y', -8).attr('font-weight', 700).text('Peak month');
      PEAKS.forEach((mo, k) => {
        const g = lg.append('g').attr('transform', `translate(0,${k * 22})`);
        g.append('rect').attr('width', 14).attr('height', 14).attr('fill', peakCol(mo));
        g.append('text').attr('x', 20).attr('y', 11).text(`${MONTHS[mo - 1].slice(0, 3)} (${counts.get(mo) || 0})`);
      });
      lg.append('text').attr('y', PEAKS.length * 22 + 10).attr('fill', '#666').text('(number of provinces)');
    }
    function seasonChart() {
      const card = document.getElementById('season-chart'); if (!card) return;
      bars(card, NAT, 92, 'Thailand estimated rice methane', 0);
      provSeason();
    }
    window.addEventListener('resize', () => { if (!document.getElementById('view-grid').hidden) { seasonChart(); peakMap(); } });
    APP.peakMap = peakMap;
    APP.gridProv = { series: PM, peak: peakOf, select: selectProv, selected: () => gsel };
    APP.seasonChart = seasonChart;
    function setMonth(m) {
      month = m;
      document.getElementById('grid-slider').value = m;
      document.getElementById('grid-period').textContent = MONTHS[m - 1];
      document.getElementById('grid-total').textContent = `Thailand estimate: ${fmt(NAT[m - 1], 1)} Gg CH₄`;
      layers.forEach((r, i) => r.setStyle({ fillColor: col(G.months[i][m - 1]) }));
      layers.forEach((r) => { if (r.isTooltipOpen()) r.setTooltipContent(tipText(r.cellIndex)); });
      info(hover);
      seasonChart();
      if (APP.writeHash) APP.writeHash();
    }
    const ticks = document.getElementById('grid-ticks');
    MONTHS.forEach((m) => { const s = document.createElement('span'); s.textContent = m[0]; ticks.append(s); });
    const slider = document.getElementById('grid-slider');
    slider.addEventListener('input', () => setMonth(+slider.value));
    const gpl = player(document.getElementById('grid-play'), () => setMonth(month % 12 + 1), 'monthInterval');
    document.getElementById('grid-csv').addEventListener('click', () => {
      const rows = ['cell_lower_left_lon,cell_lower_left_lat,month,reference_period,ch4_t'];
      G.cells.forEach(([x, y], i) => rows.push(`${x},${y},${month},2022-24 area; May 2022-May 2023 dates,${G.months[i][month - 1]}`));
      download(rows.join('\n'), `rice_ch4_grid_month${String(month).padStart(2, '0')}.csv`, 'grid-msg');
    });
    document.getElementById('grid-link').addEventListener('click', () => copyLink('grid-msg'));
    APP.grid = { nat: NAT, map, setMonth, select, month: () => month, fill: (i) => layers[i].options.fillColor,
      colour: col, value: (i, m) => G.months[i][m - 1], layer: (i) => layers[i], tipText,
      stop: gpl.stop, start: gpl.start, playing: gpl.playing, selected: () => gsel, selectProv };
    setMonth(10);
  })();

  // ================= annual provinces (main view)
  (function prov() {
    const map = baseMap('map-prov', { doubleClickZoom: false });
    new ResizeObserver(() => {
      if (map.getContainer().clientWidth) map.invalidateSize({ animate: false });
    }).observe(map.getContainer());
    const col = makeScale(P.vmax);
    const Y0 = P.years[0], last = P.years[P.years.length - 1];
    let year = last, sel = null, selectionSource = null, metric = 'total';
    const totalSeries = P.series;
    const metricLabels = { total: 'Total rice methane', controlled: 'Water-controlled rice methane', rainfed: 'Rainfed rice methane' };
    const val = (p, y) => { const s = P.series[p]; if (!s) return null; const v = s[y - Y0]; return v === undefined ? null : v; };
    // Historical reporting units include the split-off province until separate data are available.
    const PARENT = { 'Amnat Charoen': 'Ubon Ratchathani', 'Nong Bua Lamphu': 'Udon Thani', 'Sa Kaeo': 'Prachin Buri', 'Bueng Kan': 'Nong Khai' };
    const buengKanStart = 2012;
    const groupedThrough = (p) => p === 'Bueng Kan' ? buengKanStart - 1 : 1993;
    const splits = Object.keys(PARENT);
    const merged = (p) => !!PARENT[p] && year <= groupedThrough(p) && totalSeries[p][year - Y0] === null && totalSeries[PARENT[p]][year - Y0] !== null;
    const provinceForYear = (p) => merged(p) ? PARENT[p] : p;
    const selectionMembers = () => sel === null ? [] : [sel, ...splits.filter((p) => PARENT[p] === sel && merged(p))];
    const selectedLabel = () => selectionMembers().join(' + ');
    const tipText = (p) => (merged(p)
      ? `${p} / ${metricLabels[metric]} · ${year} · part of ${PARENT[p]} through ${groupedThrough(p)}; included in ${PARENT[p]}: ${fmt(val(PARENT[p], year), 2)} Gg CH₄ per year`
      : `${p} / ${metricLabels[metric]} · ${year} · ${val(p, year) === null ? 'No data' : fmt(val(p, year), 2) + ' Gg CH₄ per year'}`);
    const byName = {};
    // 10 km detail inside the selected province (one reference period: 2022-24 rice area); light fill underneath so cells stand out
    const detailBox = document.getElementById('detail-toggle');
    const detailOn = () => metric === 'total' && (!detailBox || detailBox.checked);
    // s201: the selected province's background is the 10 km scale's 0 colour, so cells with no rice read as 0, not as blank gaps
    const fillFor = (p) => (detailOn() && sel !== null && provinceForYear(p) === sel && G.byprov[p] ? dcol(0) : merged(p) ? col(val(PARENT[p], year)) : col(val(p, year)));
    const opFor = (p) => (detailOn() && sel && G.byprov[sel] && provinceForYear(p) !== sel ? 0.35 : 1);   // fade the neighbours while the detail is shown
    const geo = L.geoJSON(P.geo, {
      style: (f) => ({ color: '#ffffff', weight: 0.6, fillOpacity: opFor(f.properties.province), fillColor: fillFor(f.properties.province) }),
      onEachFeature: (f, lyr) => {
        const p = f.properties.province; byName[p] = lyr;
        lyr.bindTooltip(() => tipText(p), { sticky: true, className: 'tip', direction: 'top', offset: [0, -6] });
        lyr.on('mouseover', () => { document.getElementById('prov-info').textContent = tipText(p); });
        lyr.on('click', () => select(p));
      },
    }).addTo(map);
    const originalBorders = Object.fromEntries(splits.map((child) => {
      const parent = PARENT[child];
      return [parent, byName[parent].getLatLngs()];
    }));
    function updateHistoricalBorders() {
      for (const child of splits) {
        const childLayer = byName[child];
        const combined = merged(child);
        if (combined !== map.hasLayer(childLayer)) continue;
        const parent = PARENT[child];
        if (combined) {
          childLayer.remove();
          const border = L.GeoJSON.geometryToLayer(window.DATA_HISTORICAL_OUTLINES[parent]).getLatLngs();
          byName[parent].setLatLngs(border);
        } else {
          byName[parent].setLatLngs(originalBorders[parent]);
          childLayer.addTo(map);
        }
      }
    }
    map.createPane('detail').style.zIndex = 430;
    // SVG leaves gaps between cells clickable and does not retain a canvas
    // over the province polygons after the detail layers are cleared.
    const dcol = makeScale(G.vmax_piece), drend = L.svg({ pane: 'detail', padding: 0.3 });
    const detail = L.layerGroup().addTo(map);
    let dLegend = null, dCount = 0, dSum = 0, dVisibleCount = 0;
    function showDetail() {
      detail.clearLayers(); dCount = 0; dSum = 0; dVisibleCount = 0;
      if (dLegend) { map.removeControl(dLegend); dLegend = null; }
      const historical = sel && selectionMembers().length > 1;
      const cells = !sel || !detailOn() ? [] : historical
        ? window.DATA_HISTORICAL_CELLS[sel]
        : (G.byprov[sel] || []).map(([i, t]) => [i, t, window.DATA_CLIPPED_CELLS[sel]?.[i]]);
      const name = selectedLabel();
      cells.forEach(([i, t, geometry]) => {
        const [x, y] = G.cells[i];
        dCount += 1; dSum += t;
        if (!geometry) return;
        const r = L.geoJSON({ type: 'Feature', properties: {}, geometry }, {
          renderer: drend, pane: 'detail',
          style: { stroke: false, fillOpacity: 1, fillColor: dcol(t) }
        });
        const txt = `${name} · cell ${(x + 0.05).toFixed(2)}°E, ${(y + 0.05).toFixed(2)}°N · ${fmt(t, 1)} t CH₄ per year (2022–24 rice area)`;
        r.cellT = t; r.cellText = txt;
        r.bindTooltip(txt, { sticky: true, className: 'tip', direction: 'top', offset: [0, -6] });
        r.on('mouseover', () => { document.getElementById('prov-info').textContent = txt; });
        r.on('click', clearSelection);
        detail.addLayer(r); dVisibleCount += 1;
      });
      if (dCount) {
        dLegend = L.control({ position: 'bottomleft' });
        dLegend.onAdd = function () {
          const div = L.DomUtil.create('div', 'legend'); L.DomEvent.disableClickPropagation(div);
          const t = document.createElement('div'); t.className = 'lt'; t.textContent = '10 km detail';
          const n = document.createElement('div'); n.className = 'lu ln'; n.textContent = 'Rice area 2022–24 (does not change with the year)';
          const u = document.createElement('div'); u.className = 'lu'; u.textContent = 't CH₄ per cell per year';
          div.append(t, n, u); legendBar(div, G.vmax_piece, 0, 250);
          return div;
        };
        dLegend.addTo(map);
      }
      map.getContainer().classList.toggle('detail-on', dCount > 0);   // s215: lets phones hide the province legend while the 10 km legend shows
      const note = document.getElementById('detail-note');
      if (note) note.textContent = dCount ? `10 km grid for ${selectedLabel()}: ${fmt(dSum / 1000, 1)} Gg CH₄ per year in total (2022–24 rice area, so it can differ from the yearly province value). Hover over a cell for its value.` : '';
    }
    let hl = null;
    function updateOutline() {
      if (hl) map.removeLayer(hl);
      const outline = selectionMembers().length > 1 ? window.DATA_HISTORICAL_OUTLINES[sel] : byName[sel].feature;
      hl = L.geoJSON(outline, {
        pane: 'hl', interactive: false, style: { color: ink, weight: 2.5, fill: false },
      }).addTo(map);
    }
    function selectionBounds() {
      return L.latLngBounds(selectionMembers().map((p) => byName[p].getBounds()));
    }
    function moveToBounds(bounds, options = {}) {
      map.stop();
      map.invalidateSize({ animate: false });
      if (reduceMotion || APP._reading) {
        map.fitBounds(bounds, { ...options, animate: false });
      } else {
        map.flyToBounds(bounds, { ...options, duration: 0.32 });
      }
    }
    function fitSelection() {
      moveToBounds(selectionBounds(), { maxZoom: 9, padding: [40, 40] });
    }
    function clearSelection() {
      if (sel === null) return;
      const nearbyBounds = selectionBounds();
      const maxZoom = Math.max(map.getMinZoom(), map.getZoom() - 1);
      sel = null;
      selectionSource = null;
      document.getElementById('clear-selection').hidden = true;
      if (hl) { map.removeLayer(hl); hl = null; }
      showDetail();
      geo.eachLayer((l) => {
        l.closeTooltip();
        l.setStyle({ fillColor: fillFor(l.feature.properties.province), fillOpacity: opFor(l.feature.properties.province) });
      });
      const card = document.getElementById('chart');
      card.replaceChildren();
      card.hidden = true;
      document.getElementById('chart-hint').hidden = false;
      document.getElementById('prov-info').textContent = 'Hover or tap a province to read its value.';
      ranking(false);
      moveToBounds(nearbyBounds, { maxZoom });
      if (APP.writeHash) APP.writeHash();
    }
    function select(p) {
      const province = provinceForYear(p);
      if (sel === province) { clearSelection(); return; }
      selectionSource = p;
      sel = province;
      document.getElementById('clear-selection').hidden = false;
      updateOutline();
      geo.eachLayer((l) => l.setStyle({ fillColor: fillFor(l.feature.properties.province), fillOpacity: opFor(l.feature.properties.province) }));
      showDetail();
      document.getElementById('prov-info').textContent = tipText(sel);
      chart(); ranking(false); fitSelection(); bringCard();
      if (APP.writeHash) APP.writeHash();
    }
    if (detailBox) detailBox.addEventListener('change', () => { if (sel) { geo.eachLayer((l) => l.setStyle({ fillColor: fillFor(l.feature.properties.province), fillOpacity: opFor(l.feature.properties.province) })); showDetail(); } });
    // s204: national total for the year and emissions view = sum over provinces with data; partial years say how many provinces
    function nationalTotal() {
      const names = Object.keys(P.series); let sum = 0, n = 0;
      names.forEach((p) => { const v = P.series[p][year - Y0]; if (v !== null && v !== undefined) { sum += v; n += 1; } });
      return { sum, n, of: names.length };
    }
    function national() {
      const el = document.getElementById('prov-national'); if (!el) return;
      const t = nationalTotal(); el.replaceChildren();
      // s205: the series is our calculation (each year's official OAE area x BTR1's 2022 factors and shares); only 2022 is the official level
      const lab = document.createTextNode(`Thailand estimate (our calculation), ${metricLabels[metric].toLowerCase()}: `);
      const b = document.createElement('b'); b.textContent = `${fmt(t.sum, 1)} Gg CH₄`;
      el.append(lab, b);
      const grouped = splits.filter(merged).map((p) => `${p} with ${PARENT[p]}`);
      if (grouped.length) {
        const note = document.createElement('span');
        note.className = 'part';
        note.textContent = ` (grouped: ${grouped.join('; ')})`;
        el.append(note);
      }
    }
    function setYear(y, animate) {
      const previousArea = selectionMembers().join('|');
      year = y;
      updateHistoricalBorders();
      if (selectionSource !== null) sel = provinceForYear(selectionSource);
      const areaChanged = previousArea !== selectionMembers().join('|');
      document.getElementById('prov-slider').value = y;
      document.getElementById('prov-period').textContent = String(y);
      national(); natChart();
      geo.eachLayer((l) => { l.setStyle({ fillColor: fillFor(l.feature.properties.province), fillOpacity: opFor(l.feature.properties.province) }); if (l.isTooltipOpen()) l.setTooltipContent(tipText(l.feature.properties.province)); });
      if (areaChanged) { updateOutline(); showDetail(); }
      if (hl) hl.bringToFront();
      if (sel) { document.getElementById('prov-info').textContent = tipText(sel); chart(); }
      ranking(animate !== false);
      if (areaChanged) fitSelection();
      if (APP.writeHash) APP.writeHash();
    }
    // --- ranking: rows glide to their new place; entrants rise from below, leavers sink and fade
    const ROW = 30, rows = new Map();
    const ol = document.getElementById('rank');
    ol.parentElement.style.setProperty('--rank-row-height', ROW + 'px');
    // Use up to three years, requiring a record for every year in the ranking window.
    const rankStart = (y) => Math.max(y < buengKanStart ? Y0 : buengKanStart, y - 2);
    const rankWindow = (y) => y - rankStart(y) + 1;
    const rankBasis = (y) => rankWindow(y) === 1 ? 'single year' : `${rankWindow(y)}-year average`;
    function ranksOf(y) {
      const years = d3.range(rankStart(y), y + 1);
      const list = Object.keys(P.series).map((p) => {
        const values = years.map((n) => val(p, n));
        return { p, v: values.includes(null) ? null : d3.mean(values) };
      }).filter((d) => d.v !== null).sort((a, b) => b.v - a.v);
      return { list, pos: new Map(list.map((d, k) => [d.p, k + 1])) };
    }
    function makeRow(p) {
      const li = document.createElement('li'); const b = document.createElement('button'); b.dataset.province = p;
      const rk = document.createElement('span'); rk.className = 'rk';
      const nm = document.createElement('span'); nm.className = 'nm';
      const nt = document.createElement('span'); nt.className = 'nmt'; nt.textContent = p;
      const bar = document.createElement('span'); bar.className = 'bar'; nm.append(nt, bar);
      const vl = document.createElement('span'); vl.className = 'vl';
      const mv = document.createElement('span'); mv.className = 'mv';
      b.append(rk, nm, vl, mv);
      b.addEventListener('click', () => select(p));
      li.append(b); li.dataset.province = p; return li;
    }
    function ranking(animate) {
      const now = ranksOf(year), prev = year > Y0 && rankWindow(year) === 3 && rankWindow(year - 1) === 3 ? ranksOf(year - 1) : null;
      const yr = Object.keys(P.series).map((p) => val(p, year)).filter((v) => v !== null);
      const nMissing = Object.keys(P.series).length - yr.length;
      const span = rankWindow(year) === 1 ? String(year) : `${rankStart(year)}–${String(year).slice(2)}`;
      document.getElementById('rank-title').textContent = `${metricLabels[metric]}: province rankings, ${span}`;
      document.getElementById('rank-total').textContent = `Ranking basis: ${rankBasis(year)} (Gg CH₄ per year). `
        + (prev ? 'Arrows compare with the previous year’s list. ' : '')
        + `All ${yr.length} provinces with data, ${year}: ${fmt(d3.sum(yr), 1)} Gg CH₄` + (nMissing ? ` (${nMissing} without a record)` : '') + '.' + (now.list.length > 10 ? ` Scroll to see all ${now.list.length} ranked provinces.` : '');
      const ranked = now.list, vmax = ranked[0]?.v || 1;
      const focused = ol.contains(document.activeElement) ? document.activeElement : null;
      ol.style.height = ranked.length * ROW + 'px';
      const anim = animate && !reduceMotion;
      if (!anim) ol.classList.add('noanim');
      rows.forEach((li, p) => {   // leavers
        if (now.pos.has(p)) return;
        rows.delete(p);
        if (!anim) { li.remove(); return; }
        li.classList.add('leave'); li.style.transform = `translateY(${ranked.length * ROW}px)`; setTimeout(() => li.remove(), 920);
      });
      ranked.forEach((d, k) => {
        let li = rows.get(d.p); const isNew = !li;
        if (isNew) {
          li = makeRow(d.p); rows.set(d.p, li); ol.append(li);
          if (anim) { li.classList.add('enter'); li.style.transform = `translateY(${ranked.length * ROW}px)`; li.getBoundingClientRect(); li.classList.remove('enter'); }
        }
        const next = ol.children[k] || null;
        if (next !== li) {
          if (ol.moveBefore) ol.moveBefore(li, next);
          else ol.insertBefore(li, next);
        }
        const oldRank = li.dataset.rank ? +li.dataset.rank : null;
        li.style.transform = `translateY(${k * ROW}px)`; li.dataset.rank = k + 1;
        const b = li.firstChild; b.setAttribute('aria-current', String(d.p === sel));
        const pr = prev ? prev.pos.get(d.p) : undefined, ch = pr === undefined ? null : pr - (k + 1);
        b.setAttribute('aria-label', `${k + 1}. ${d.p}, ${fmt(d.v, 1)} Gg` + (ch ? (ch > 0 ? `, up ${ch}` : `, down ${-ch}`) : ''));
        b.querySelector('.rk').textContent = k + 1;
        b.querySelector('.bar').style.width = (d.v / vmax * 100) + '%';
        b.querySelector('.vl').textContent = fmt(d.v, 1) + ' Gg';
        const mv = b.querySelector('.mv'); mv.className = 'mv' + (ch > 0 ? ' up' : '');
        mv.textContent = ch === null ? '' : ch > 0 ? '▲' + ch : ch < 0 ? '▼' + -ch : '–';
        if (anim && oldRank && oldRank > k + 1) { li.classList.add('flash'); setTimeout(() => li.classList.remove('flash'), 900); }
      });
      if (focused?.isConnected && focused !== document.activeElement) focused.focus({ preventScroll: true });
      if (!anim) { ol.getBoundingClientRect(); ol.classList.remove('noanim'); }   // jump instantly, keep motion for later changes
    }
    // s215: after a selection, make the province card visible: on wide screens the sidebar scrolls to its top;
    // on narrow screens the page scrolls just enough to show the card under the map (only if it is below the fold)
    function bringCard() {
      const card = document.getElementById('chart-card');
      if (window.matchMedia('(min-width: 901px)').matches) return;
      const r = card.getBoundingClientRect();
      if (r.top > window.innerHeight * 0.75) window.scrollTo({ top: window.scrollY + r.top - window.innerHeight * 0.4, behavior: 'smooth' });
    }
    // Thailand trend from the provincial estimates
    window.addEventListener('resize', natChart);
    function natChart() {
      const card = document.getElementById('nat-chart');
      card.replaceChildren();
      const s = P.years.map((y, i) => ({ y, v: d3.sum(Object.values(P.series), (ser) => (ser[i] === null || ser[i] === undefined ? 0 : ser[i])) }));
      const cur = s.find((d) => d.y === year);
      const sub = document.createElement('p'); sub.className = 'sub'; sub.id = 'nat-sub';
      sub.textContent = `${metricLabels[metric]}, Gg CH₄ per year · ${year}: ${fmt(cur.v, 1)} Gg`;
      card.append(sub);
      // s218: axis zoomed to the data (not from 0) so year-to-year change shows; BTR1 official totals as dots (total view only)
      const OFF = metric === 'total' && window.DATA_OFFICIAL ? Object.entries(window.DATA_OFFICIAL).map(([y, v]) => ({ y: +y, v })) : [];
      const w = Math.max(260, card.clientWidth), h = 84, m = { t: 6, r: 12, b: 16, l: 40 };
      const x = d3.scaleLinear().domain([Y0, last]).range([m.l, w - m.r]);
      const all = s.map((d) => d.v).concat(OFF.map((d) => d.v)), lo = d3.min(all), hi = d3.max(all), pad = (hi - lo) * 0.12;
      const yy = d3.scaleLinear().domain([lo - pad, hi + pad]).nice().range([h - m.b, m.t]);
      const svg = d3.select(card).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img')
        .attr('aria-label', `Thailand ${metricLabels[metric].toLowerCase()} by year, 1988 to 2024`);
      svg.append('g').attr('transform', `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(Math.min(8, Math.floor(w / 60))).tickFormat(d3.format('d')));
      svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(yy).ticks(3).tickSize(-(w - m.l - m.r))).call((g) => g.select('.domain').remove());
      svg.append('line').attr('x1', x(year)).attr('x2', x(year)).attr('y1', m.t).attr('y2', h - m.b).attr('stroke', '#9a9a9a').attr('stroke-dasharray', '3 3');
      svg.append('path').datum(s).attr('fill', 'none').attr('stroke', ink).attr('stroke-width', 1.6).attr('d', d3.line().x((d) => x(d.y)).y((d) => yy(d.v)));
      svg.append('g').selectAll('circle').data(OFF).join('circle').attr('class', 'off-dot').attr('cx', (d) => x(d.y)).attr('cy', (d) => yy(d.v)).attr('r', 2.4)
        .attr('fill', '#ffffff').attr('stroke', '#666666').attr('stroke-width', 1.1).append('title').text((d) => `${d.y} BTR1 official: ${fmt(d.v, 1)} Gg CH₄`);
      svg.append('circle').attr('id', 'nat-dot').attr('cx', x(year)).attr('cy', yy(cur.v)).attr('r', 4.5).attr('fill', d3.interpolateCividis(0.92)).attr('stroke', ink).attr('stroke-width', 1.2);
      const key = document.createElement('p'); key.className = 'sub';
      key.textContent = 'Line: our estimate (OAE area × BTR1 2022 factors).' + (OFF.length ? ' Dots: BTR1 official, 2000–22.' : '') + ' Axis not from 0.';
      card.append(key);
    }
    function chart() {
      const card = document.getElementById('chart'); card.hidden = false; document.getElementById('chart-hint').hidden = true;
      card.replaceChildren();
      const s = P.years.map((y, i) => ({ y, v: P.series[sel] ? P.series[sel][i] : null }));
      const t = document.createElement('p'); t.className = 'ttl'; t.textContent = selectedLabel();
      card.append(t);
      const w = Math.max(260, card.clientWidth), h = 200, m = { t: 8, r: 10, b: 24, l: 40 };
      const x = d3.scaleLinear().domain([Y0, last]).range([m.l, w - m.r]);
      // rank among all provinces with data, each year (single-year values, 1 = highest)
      const rk = P.years.map((y) => ({ y, r: rankIn(sel, y) }));
      const curR = rankIn(sel, year), n = Object.keys(P.series).filter((p) => val(p, year) !== null).length;
      const r3 = ranksOf(year).pos.get(sel);
      const rs = document.createElement('p'); rs.className = 'sub'; rs.id = 'chart-rank';
      rs.textContent = `Rank among provinces · ${year}: ${curR === null ? 'No data' : curR + ' of ' + n}` + (r3 && rankWindow(year) > 1 ? ` · ${rankBasis(year)} rank: ${r3}` : '');
      card.append(rs);
      const h2 = 120, mr = { t: 8, r: 10, b: 22, l: 40 };
      const rmax = Math.max(10, d3.max(rk, (d) => d.r) || 10);
      const ry = d3.scaleLinear().domain([1, rmax]).range([mr.t, h2 - mr.b]);   // rank 1 at the top
      const s2 = d3.select(card).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${w} ${h2}`).attr('role', 'img').attr('aria-label', `Rank of ${sel} among provinces, 1988 to 2024`);
      s2.append('g').attr('transform', `translate(0,${h2 - mr.b})`).call(d3.axisBottom(x).ticks(Math.min(8, Math.floor(w / 60))).tickFormat(d3.format('d')));
      const rt = [1, 10, rmax].filter((v, i, a) => a.indexOf(v) === i);
      s2.append('g').attr('transform', `translate(${mr.l},0)`).call(d3.axisLeft(ry).tickValues(rt).tickFormat((v) => '#' + v).tickSize(-(w - mr.l - mr.r))).call((g) => g.select('.domain').remove());
      s2.append('rect').attr('x', mr.l).attr('y', ry(1) - 4).attr('width', w - mr.l - mr.r).attr('height', ry(10) - ry(1) + 8).attr('fill', '#f2f2f2');
      s2.append('text').attr('x', w - mr.r - 2).attr('y', ry(10) - 2).attr('text-anchor', 'end').style('fill', '#666').text('Top 10');
      s2.append('line').attr('x1', x(year)).attr('x2', x(year)).attr('y1', mr.t).attr('y2', h2 - mr.b).attr('stroke', '#9a9a9a').attr('stroke-dasharray', '3 3');
      s2.append('path').datum(rk).attr('fill', 'none').attr('stroke', ink).attr('stroke-width', 1.4).attr('d', d3.line().defined((d) => d.r !== null).x((d) => x(d.y)).y((d) => ry(d.r)));
      if (curR !== null) s2.append('circle').attr('id', 'rank-dot').attr('cx', x(year)).attr('cy', ry(curR)).attr('r', 4).attr('fill', d3.interpolateCividis(0.92)).attr('stroke', ink).attr('stroke-width', 1.2);
      const cur = val(sel, year);
      const sub = document.createElement('p'); sub.className = 'sub'; sub.id = 'chart-sub';
      sub.textContent = `${metricLabels[metric]}, Gg per year · ${year}: ${cur === null ? 'No data' : fmt(cur, 2) + ' Gg'}`;
      card.append(sub);
      const yy = d3.scaleLinear().domain([0, (d3.max(s, (d) => d.v) || 1) * 1.1]).nice().range([h - m.b, m.t]);
      const svg = d3.select(card).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img').attr('aria-label', `Annual estimated methane for ${sel}, 1988 to 2024`);
      svg.append('g').attr('transform', `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(Math.min(8, Math.floor(w / 60))).tickFormat(d3.format('d')));
      svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(yy).ticks(5).tickSize(-(w - m.l - m.r))).call((g) => g.select('.domain').remove());
      svg.append('line').attr('x1', x(year)).attr('x2', x(year)).attr('y1', m.t).attr('y2', h - m.b).attr('stroke', '#9a9a9a').attr('stroke-dasharray', '3 3');
      svg.append('path').datum(s).attr('fill', 'none').attr('stroke', ink).attr('stroke-width', 1.6).attr('d', d3.line().defined((d) => d.v !== null).x((d) => x(d.y)).y((d) => yy(d.v)));
      if (cur !== null) svg.append('circle').attr('id', 'chart-dot').attr('cx', x(year)).attr('cy', yy(cur)).attr('r', 4.5).attr('fill', d3.interpolateCividis(0.92)).attr('stroke', ink).attr('stroke-width', 1.2);
    }
    function rankIn(p, y) {
      const v = val(p, y); if (v === null) return null;
      return 1 + Object.keys(P.series).filter((q) => { const u = val(q, y); return u !== null && u > v; }).length;
    }
    const ticks = document.getElementById('prov-ticks');
    [1988, 1995, 2000, 2005, 2010, 2015, 2020, 2024].forEach((y) => { const s = document.createElement('span'); s.textContent = y; ticks.append(s); });
    const slider = document.getElementById('prov-slider'); slider.min = Y0; slider.max = last;
    slider.addEventListener('input', () => setYear(+slider.value, true));
    const pl = player(document.getElementById('prov-play'), () => setYear(year >= last ? Y0 : year + 1, true), 'interval');
    let provinceLegend = legend(map, metricLabels[metric], 'Gg CH4 per province per year', P.vmax, 1);
    function setMetric(next) {
      if (!Object.hasOwn(metricLabels, next)) return;
      metric = next;
      P.series = metric === 'total' ? totalSeries : P.components[metric];
      document.getElementById('emission-type').value = metric;
      document.getElementById('metric-note').textContent = metric === 'controlled'
        ? 'Irrigated main-season plus dry-season rice. Use this view to screen where water-management feasibility could be assessed.'
        : metric === 'rainfed' ? 'Rainfed classes plus deep-water rice, following the inventory grouping.'
        : 'Total includes water-controlled and rainfed rice.';
      if (detailBox) detailBox.disabled = metric !== 'total';
      map.removeControl(provinceLegend);
      provinceLegend = legend(map, metricLabels[metric], 'Gg CH4 per province per year', P.vmax, 1);
      showDetail();
      setYear(year, false);
    }
    document.getElementById('emission-type').addEventListener('change', (event) => setMetric(event.target.value));
    const search = document.getElementById('province-search');
    const options = document.getElementById('province-options');
    Object.keys(totalSeries).sort().forEach((province) => {
      const option = document.createElement('option');
      option.value = province;
      options.append(option);
    });
    document.getElementById('province-search-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const name = Object.keys(totalSeries).find((p) => p.toLowerCase() === search.value.trim().toLowerCase());
      document.getElementById('search-message').textContent = name ? '' : 'Choose a province from the suggestions.';
      if (name) {
        if (sel !== provinceForYear(name)) select(name);
        else { selectionSource = name; fitSelection(); }
      }
    });
    document.getElementById('clear-selection').addEventListener('click', clearSelection);
    document.getElementById('prov-csv').addEventListener('click', () => {
      const out = ['province,year,component,ch4_Gg'];
      Object.keys(P.series).sort().forEach((p) => P.years.forEach((y) => out.push(`"${p}",${y},${metric},${val(p, y) === null ? '' : val(p, y)}`)));
      download(out.join('\n'), 'rice_ch4_' + metric + '_provinces_1988_2024.csv', 'prov-msg');
    });
    document.getElementById('prov-link').addEventListener('click', () => copyLink('prov-msg'));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && sel && !gridVisible()) clearSelection();
    });
    APP.prov = { map, setYear, select, setMetric, metric: () => metric, year: () => year, fill: (p) => byName[p].options.fillColor, colour: col, value: val, layer: (p) => byName[p],
      tipText, stop: pl.stop, start: pl.start, playing: pl.playing, selected: () => sel,
      refreshCharts: () => { natChart(); if (sel) chart(); },
      detailCount: () => dCount, detailSum: () => dSum, detailLayers: () => detail.getLayers(), detailColour: dcol };
    setYear(last, false);   // open on the latest historical year
  })();

  // ================= shared: download, shareable link (#prov/2024/Province or #grid/10/cell)
  function download(text, name, msgId) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    document.getElementById(msgId).textContent = 'Saved ' + name;
  }
  function copyLink(msgId) {
    const msg = document.getElementById(msgId);
    try { navigator.clipboard.writeText(location.href).then(() => { msg.textContent = 'Link copied'; }, () => { msg.textContent = location.href; }); } catch (e) { msg.textContent = location.href; }
  }
  const gridView = document.getElementById('view-grid');
  const provView = document.getElementById('view-prov');
  const gridButton = document.getElementById('show-grid');
  const provButton = document.getElementById('show-prov');
  const mapViews = gridButton.parentElement;
  const annualSlot = document.getElementById('annual-switch-slot');
  const monthlySlot = document.getElementById('monthly-switch-slot');
  function gridVisible() { return !gridView.hidden; }
  function showView(seasonal) {
    APP.prov.stop();
    APP.grid.stop();
    const focused = mapViews.contains(document.activeElement);
    gridView.hidden = !seasonal;
    provView.hidden = seasonal;
    (seasonal ? monthlySlot : annualSlot).append(mapViews);
    if (focused) (seasonal ? gridButton : provButton).focus({ preventScroll: true });
    document.getElementById('grid-tools').hidden = !seasonal;
    document.getElementById('prov-tools').hidden = seasonal;
    gridButton.setAttribute('aria-pressed', String(seasonal));
    provButton.setAttribute('aria-pressed', String(!seasonal));
    ensureFit(seasonal ? APP.grid.map : APP.prov.map);
    if (!seasonal) APP.prov.refreshCharts(); else { APP.seasonChart(); APP.peakMap(); }
    APP.writeHash();
  }
  gridButton.addEventListener('click', () => { if (!gridVisible()) showView(true); });
  provButton.addEventListener('click', () => { if (gridVisible()) showView(false); });

  APP.writeHash = function () {
    if (!APP.grid || !APP.prov || APP._reading) return;
    const h = gridVisible() ? `#grid/${APP.grid.month()}${APP.grid.selected() ? '/' + encodeURIComponent(APP.grid.selected()) : ''}`
      : `#prov/${APP.prov.year()}/${APP.prov.selected() ? encodeURIComponent(APP.prov.selected()) : ''}/${APP.prov.metric()}`;
    try { history.replaceState(null, '', h); } catch (e) { /* some browsers block this on file:// */ }
  };
  (function readHash() {
    const parts = decodeURIComponent(location.hash.slice(1)).split('/');
    APP._reading = true;
    try {
      if (parts[0] === 'prov') {
        if (parts[3]) APP.prov.setMetric(parts[3]);
        const y = +parts[1]; if (P.years.includes(y)) APP.prov.setYear(y, false);
        if (parts[2] && P.series[parts[2]]) APP.prov.select(parts[2]);
      } else if (parts[0] === 'grid') {
        showView(true);
        const m = +parts[1]; if (m >= 1 && m <= 12) APP.grid.setMonth(m);
        if (parts[2]) { const i = +parts[2]; if (Number.isInteger(i) && i >= 0 && i < G.cells.length) APP.grid.select(i); else APP.grid.selectProv(parts[2]); }   // old links used a cell number
      }
    } finally { APP._reading = false; }
  })();
})();
