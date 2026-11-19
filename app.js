(function () {
  'use strict';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const NODATA = '#a9a9a9', LAND = '#ececec', ink = '#222222', TH_BOUNDS = [[5.4, 97.2], [20.6, 105.8]];
  const G = window.DATA_GRID, P = window.DATA_PROVINCES, B = window.DATA_BASEMAP;
  const APP = (window.APP = { interval: 2000, previewInterval: window.PREVIEW_MS || 650 });
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

  // ================= seasonal grid: compact preview + expandable full map (one month state)
  (function grid() {
    const col = makeScale(G.vmax);
    let month = 1, sel = null, hover = null;
    // --- full map (inside the overlay)
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
      r.on('click', () => select(i));
      return r.outside ? r : r.addTo(map);
    });
    L.geoJSON(P.geo, { pane: 'lines', interactive: false, style: { color: '#ffffff', weight: 0.5, fill: false, opacity: 0.9 } }).addTo(map);
    const hl = L.rectangle([[0, 0], [0, 0]], { pane: 'hl', color: ink, weight: 2.5, fill: false, interactive: false });
    function info(i) { document.getElementById('grid-info').textContent = tipText(i); }
    function select(i) {
      sel = i; const [x, y] = G.cells[i];
      hl.setBounds([[y, x], [y + G.cellsize, x + G.cellsize]]).addTo(map); hl.bringToFront(); info(i);
      if (APP.writeHash) APP.writeHash();
    }
    legend(map, 'Estimated methane allocation', 't CH₄ per 0.1° cell per month', G.vmax, 1, 'Estimated allocation · seasonal timing applied by province');
    // --- compact preview (no pan/zoom; Expand for detail)
    const pmap = baseMap('map-preview', { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, zoomSnap: 0.1 });
    const prend = L.canvas({ padding: 0.1 });
    L.geoJSON(P.geo, { renderer: prend, interactive: false, style: { stroke: true, weight: 0.6, color: col(0), fillOpacity: 1, fillColor: col(0) } }).addTo(pmap);   // s203: 0 colour under the cells
    const players = G.cells.map(([x, y], i) => {   // hairline stroke in the fill colour hides seams
      const r = cellShape(i, { renderer: prend, stroke: true, weight: 0.6, opacity: 1, color: col(G.months[i][0]), fillOpacity: 1, interactive: false, fillColor: col(G.months[i][0]) });
      return r.outside ? r : r.addTo(pmap);
    });
    const pvLeg = document.getElementById('pv-legend');
    const lt = document.createElement('div'); lt.className = 'lu'; lt.textContent = 'Estimated methane allocation, t CH₄ per 0.1° cell per month · seasonal timing applied by province';
    pvLeg.append(lt); legendBar(pvLeg, G.vmax, 1, 220); noDataSwatch(pvLeg);
    document.getElementById('pv-ref').textContent = G.period;
    document.getElementById('grid-ref').textContent = G.period;
    // --- national seasonal chart (overlay)
    const NAT = d3.range(12).map((k) => d3.sum(G.months, (r) => r[k]) / 1000);
    const NATSUM = d3.sum(NAT);
    function drawSeason() {
      const el = document.getElementById('season-chart'); el.replaceChildren();
      const w = Math.max(280, el.clientWidth || 600), h = 190, mg = { t: 18, r: 8, b: 22, l: 34 };
      const x = d3.scaleBand().domain(d3.range(1, 13)).range([mg.l, w - mg.r]).padding(0.2);
      const y = d3.scaleLinear().domain([0, d3.max(NAT) * 1.15]).nice().range([h - mg.b, mg.t]);
      const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img')
        .attr('aria-label', `Thailand estimated rice methane by month; ${MONTHS[month - 1]}: ${NAT[month - 1].toFixed(1)} Gg`);
      svg.append('g').attr('transform', `translate(0,${h - mg.b})`).call(d3.axisBottom(x).tickFormat((m) => MONTHS[m - 1][0]).tickSize(0)).call((g) => g.select('.domain').attr('stroke', '#9a9a9a'));
      svg.append('g').attr('transform', `translate(${mg.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(w - mg.l - mg.r))).call((g) => { g.select('.domain').remove(); g.selectAll('.tick line').attr('stroke', '#e6e6e6'); });
      svg.append('g').selectAll('rect').data(NAT).join('rect').attr('class', (d, k) => (k + 1 === month ? 'bar cur' : 'bar'))
        .attr('x', (d, k) => x(k + 1)).attr('width', x.bandwidth()).attr('y', (d) => y(d)).attr('height', (d) => y(0) - y(d))
        .attr('fill', (d, k) => (k + 1 === month ? ink : '#c9c9c9')).style('cursor', 'pointer').on('click', (ev, d) => setMonth(NAT.indexOf(d) + 1));
      svg.append('text').attr('id', 'season-label').attr('x', x(month) + x.bandwidth() / 2).attr('y', y(NAT[month - 1]) - 5).attr('text-anchor', 'middle').style('font-weight', 700)
        .text(`${NAT[month - 1].toFixed(1)} Gg · ${(NAT[month - 1] / NATSUM * 100).toFixed(1)}%`);
    }
    window.addEventListener('resize', () => { if (isOpen()) drawSeason(); });
    function setMonth(m) {
      month = m;
      document.getElementById('grid-slider').value = m;
      document.getElementById('grid-period').textContent = MONTHS[m - 1];
      document.getElementById('pv-month').textContent = MONTHS[m - 1];
      layers.forEach((r, i) => r.setStyle({ fillColor: col(G.months[i][m - 1]) }));
      players.forEach((r, i) => { const c = col(G.months[i][m - 1]); r.setStyle({ fillColor: c, color: c }); });
      layers.forEach((r) => { if (r.isTooltipOpen()) r.setTooltipContent(tipText(r.cellIndex)); });
      if (sel !== null) info(sel); else if (hover !== null) info(hover);
      if (isOpen()) drawSeason();
      if (APP.writeHash) APP.writeHash();
    }
    // --- preview playback: Jan..Dec once, then rest on October
    const REST = 10; let pvTimer = null, pvDone = false;
    const pvPause = document.getElementById('pv-pause');
    function pvStop(label) { if (pvTimer) clearInterval(pvTimer); pvTimer = null; pvPause.setAttribute('aria-pressed', 'false'); pvPause.textContent = label || '▶ Resume'; }
    function pvRun() {
      if (pvTimer) return; pvPause.setAttribute('aria-pressed', 'true'); pvPause.textContent = '❚❚ Pause';
      pvTimer = setInterval(() => {
        if (month >= 12) { pvStop('▶ Resume'); pvDone = true; pvPause.disabled = true; setMonth(REST); return; }
        setMonth(month + 1);
      }, APP.previewInterval);
    }
    function pvReplay() { pvStop(); pvDone = false; pvPause.disabled = false; setMonth(1); pvRun(); }
    pvPause.addEventListener('click', () => { if (pvTimer) pvStop('▶ Resume'); else if (!pvDone) pvRun(); });
    document.getElementById('pv-replay').addEventListener('click', pvReplay);
    // --- expand / close
    const ov = document.getElementById('view-grid'), expandBtn = document.getElementById('pv-expand');
    const isOpen = () => !ov.hidden;
    function open() {
      pvStop(pvDone ? '▶ Resume' : '▶ Resume'); if (!pvDone) pvPause.disabled = false;
      ov.hidden = false; document.body.classList.add('modal-open');
      setTimeout(() => { ensureFit(map); drawSeason(); }, 0);
      document.getElementById('grid-close').focus();
      if (APP.writeHash) APP.writeHash();
    }
    function close() {
      gpl.stop(); ov.hidden = true; document.body.classList.remove('modal-open'); expandBtn.focus();
      if (APP.writeHash) APP.writeHash();
    }
    expandBtn.addEventListener('click', open);
    document.getElementById('grid-close').addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });
    const ticks = document.getElementById('grid-ticks');
    MONTHS.forEach((m) => { const s = document.createElement('span'); s.textContent = m[0]; ticks.append(s); });
    const slider = document.getElementById('grid-slider');
    slider.addEventListener('input', () => setMonth(+slider.value));
    const gpl = player(document.getElementById('grid-play'), () => setMonth(month % 12 + 1), 'previewInterval');
    document.getElementById('grid-csv').addEventListener('click', () => {
      const rows = ['cell_lower_left_lon,cell_lower_left_lat,month,reference_period,ch4_t'];
      G.cells.forEach(([x, y], i) => rows.push(`${x},${y},${month},2022-24 area; May 2022-May 2023 dates,${G.months[i][month - 1]}`));
      download(rows.join('\n'), `rice_ch4_grid_month${String(month).padStart(2, '0')}.csv`, 'grid-msg');
    });
    document.getElementById('grid-link').addEventListener('click', () => copyLink('grid-msg'));
    APP.grid = { nat: NAT, drawSeason, map, pmap, setMonth, select, open, close, isOpen, month: () => month, fill: (i) => layers[i].options.fillColor,
      pfill: (i) => players[i].options.fillColor, colour: col, value: (i, m) => G.months[i][m - 1], layer: (i) => layers[i], tipText,
      stop: gpl.stop, start: gpl.start, playing: gpl.playing, selected: () => sel, previewPlaying: () => !!pvTimer, previewDone: () => pvDone, replay: pvReplay };
    setMonth(1);
    if (reduceMotion) { pvDone = true; pvPause.disabled = true; setMonth(REST); } else setTimeout(() => { if (!isOpen()) pvRun(); }, 400);   // a shared #grid link opens the full map instead
  })();

  // ================= annual provinces (main view)
  (function prov() {
    const map = baseMap('map-prov');
    const col = makeScale(P.vmax);
    const Y0 = P.years[0], last = P.years[P.years.length - 1];
    let year = last, sel = null, metric = 'total';
    const totalSeries = P.series;
    const metricLabels = { total: 'Total rice methane', controlled: 'Water-controlled rice methane', rainfed: 'Rainfed rice methane' };
    const val = (p, y) => { const s = P.series[p]; if (!s) return null; const v = s[y - Y0]; return v === undefined ? null : v; };
    const label = (p) => (p === 'Nong Khai' ? 'Nong Khai (incl. Bueng Kan)' : p);
    // s212: provinces created in 1993 are drawn as part of the province they were split from until then (their rice is in its value)
    const PARENT = { 'Amnat Charoen': 'Ubon Ratchathani', 'Nong Bua Lamphu': 'Udon Thani', 'Sa Kaeo': 'Prachin Buri' };
    const merged = (p) => !!PARENT[p] && val(p, year) === null && val(PARENT[p], year) !== null;
    const tipText = (p) => (merged(p)
      ? `${label(p)} / ${metricLabels[metric]} · ${year} · part of ${label(PARENT[p])} until 1993; included in ${label(PARENT[p])}: ${fmt(val(PARENT[p], year), 2)} Gg CH₄ per year`
      : `${label(p)} / ${metricLabels[metric]} · ${year} · ${val(p, year) === null ? 'No data' : fmt(val(p, year), 2) + ' Gg CH₄ per year'}`);
    const byName = {};
    // 10 km detail inside the selected province (one reference period: 2022-24 rice area); light fill underneath so cells stand out
    const detailBox = document.getElementById('detail-toggle');
    const detailOn = () => metric === 'total' && (!detailBox || detailBox.checked);
    // s201: the selected province's background is the 10 km scale's 0 colour, so cells with no rice read as 0, not as blank gaps
    const fillFor = (p) => (detailOn() && p === sel && G.byprov[p] ? dcol(0) : merged(p) ? col(val(PARENT[p], year)) : col(val(p, year)));
    const hasMergedChild = (p) => Object.keys(PARENT).some((c) => PARENT[c] === p && merged(c));
    const strokeFor = (p) => (merged(p) ? col(val(PARENT[p], year)) : hasMergedChild(p) ? col(val(p, year)) : '#ffffff');   // hide the line inside a merged pair; neighbours keep their white outlines
    const opFor = (p) => (detailOn() && sel && G.byprov[sel] && p !== sel ? 0.35 : 1);   // fade the neighbours while the detail is shown
    const geo = L.geoJSON(P.geo, {
      style: (f) => ({ color: strokeFor(f.properties.province), weight: 0.6, fillOpacity: opFor(f.properties.province), fillColor: fillFor(f.properties.province) }),
      onEachFeature: (f, lyr) => {
        const p = f.properties.province; byName[p] = lyr;
        lyr.bindTooltip(() => tipText(p), { sticky: true, className: 'tip', direction: 'top', offset: [0, -6] });
        lyr.on('mouseover', () => { document.getElementById('prov-info').textContent = tipText(p); });
        lyr.on('click', () => select(p, true));
      },
    }).addTo(map);
    map.createPane('detail').style.zIndex = 430;
    // SVG leaves gaps between cells clickable and does not retain a canvas
    // over the province polygons after the detail layers are cleared.
    const dcol = makeScale(G.vmax_piece), drend = L.svg({ pane: 'detail', padding: 0.3 });
    const detail = L.layerGroup().addTo(map);
    let dLegend = null, dCount = 0, dSum = 0, dVisibleCount = 0;
    function showDetail() {
      detail.clearLayers(); dCount = 0; dSum = 0; dVisibleCount = 0;
      if (dLegend) { map.removeControl(dLegend); dLegend = null; }
      const cells = sel && detailOn() ? G.byprov[sel] || [] : [];
      cells.forEach(([i, t]) => {
        const [x, y] = G.cells[i];
        dCount += 1; dSum += t;
        const geometry = window.DATA_CLIPPED_CELLS[sel] && window.DATA_CLIPPED_CELLS[sel][i];
        if (!geometry) return;
        const r = L.geoJSON({ type: 'Feature', properties: {}, geometry }, {
          renderer: drend, pane: 'detail',
          style: { stroke: false, fillOpacity: 1, fillColor: dcol(t) }
        });
        const txt = `${label(sel)} · cell ${(x + 0.05).toFixed(2)}°E, ${(y + 0.05).toFixed(2)}°N · ${fmt(t, 1)} t CH₄ per year (2022–24 rice area)`;
        r.cellT = t; r.cellText = txt;
        r.bindTooltip(txt, { sticky: true, className: 'tip', direction: 'top', offset: [0, -6] });
        r.on('mouseover', () => { document.getElementById('prov-info').textContent = txt; });
        r.on('click', () => select(sel, false));
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
      if (note) note.textContent = dCount ? `10 km grid for ${label(sel)}: ${fmt(dSum / 1000, 1)} Gg CH₄ per year in total (2022–24 rice area, so it can differ from the yearly province value). Hover or tap a cell for its value.` : '';
    }
    let hl = null;
    function clearSelection() {
      sel = null;
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
      map.fitBounds(TH_BOUNDS);
      if (APP.writeHash) APP.writeHash();
    }
    function select(p, zoom) {
      if (sel === p) { clearSelection(); return; }
      sel = p;
      document.getElementById('clear-selection').hidden = false;
      if (hl) map.removeLayer(hl);
      hl = L.geoJSON(byName[p].feature, { pane: 'hl', interactive: false, style: { color: ink, weight: 2.5, fill: false } }).addTo(map);
      geo.eachLayer((l) => l.setStyle({ fillColor: fillFor(l.feature.properties.province), fillOpacity: opFor(l.feature.properties.province) }));
      showDetail();
      if (zoom) map.fitBounds(byName[p].getBounds(), { maxZoom: 9, padding: [40, 40] });
      document.getElementById('prov-info').textContent = tipText(p);
      chart(); ranking(false); bringCard();
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
      // s210: the provinces without data (Amnat Charoen, Nong Bua Lamphu, Sa Kaeo, 1988-1993) were created in 1993 from Ubon Ratchathani,
      // Udon Thani and Prachin Buri, whose areas include them until then; the national sum is complete (log §210)
      if (t.n < t.of) {
        const missing = Object.keys(P.series).filter((p) => { const v = P.series[p][year - Y0]; return v === null || v === undefined; });
        const s = document.createElement('span'); s.className = 'part';
        const names = (a) => (a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0]);
        s.textContent = ` (${names(missing)} are included in ${names(missing.map((p) => PARENT[p] || p))} until 1993)`; el.append(s);
      }
      // s206/s210: Thailand's official national rice CH4, 2000-2022 (BTR1 Table 2-136, Gg at GWP 28), from data/official.js
      const OFFICIAL = window.DATA_OFFICIAL || {};
      if (metric === 'total' && OFFICIAL[year]) { const s = document.createElement('span'); s.className = 'part'; s.textContent = ` · official (BTR1): ${fmt(OFFICIAL[year], 1)} Gg`; el.append(s); }
    }
    function setYear(y, animate) {
      year = y;
      document.getElementById('prov-slider').value = y;
      document.getElementById('prov-period').textContent = String(y);
      national(); natChart();
      geo.eachLayer((l) => { l.setStyle({ color: strokeFor(l.feature.properties.province), fillColor: fillFor(l.feature.properties.province), fillOpacity: opFor(l.feature.properties.province) }); if (l.isTooltipOpen()) l.setTooltipContent(tipText(l.feature.properties.province)); });
      if (hl) hl.bringToFront();
      if (sel) { document.getElementById('prov-info').textContent = tipText(sel); chart(); }
      ranking(animate !== false);
      if (APP.writeHash) APP.writeHash();
    }
    // --- ranking: rows glide to their new place; entrants rise from below, leavers sink and fade
    const ROW = 30, rows = new Map();
    const ol = document.getElementById('rank'); ol.style.height = 10 * ROW + 'px';
    // ranked on the 3-year average (y-2..y; all three years needed) so one-year area swings between near-equal provinces do not reshuffle the list
    const RANK_FROM = Y0 + 2;
    const avg3 = (p, y) => { const v = [val(p, y - 2), val(p, y - 1), val(p, y)]; return v.some((x) => x === null) ? null : (v[0] + v[1] + v[2]) / 3; };
    function ranksOf(y) {
      const r = y < RANK_FROM ? [] : Object.keys(P.series).map((p) => ({ p, v: avg3(p, y) })).filter((d) => d.v !== null).sort((a, b) => b.v - a.v);
      return { list: r, pos: new Map(r.map((d, k) => [d.p, k + 1])) };
    }
    function makeRow(p) {
      const li = document.createElement('li'); const b = document.createElement('button'); b.dataset.province = p;
      const rk = document.createElement('span'); rk.className = 'rk';
      const nm = document.createElement('span'); nm.className = 'nm';
      const nt = document.createElement('span'); nt.className = 'nmt'; nt.textContent = label(p);
      const bar = document.createElement('span'); bar.className = 'bar'; nm.append(nt, bar);
      const vl = document.createElement('span'); vl.className = 'vl';
      const mv = document.createElement('span'); mv.className = 'mv';
      b.append(rk, nm, vl, mv);
      b.addEventListener('click', () => select(p, true));
      li.append(b); li.dataset.province = p; return li;
    }
    function ranking(animate) {
      const now = ranksOf(year), prev = year > RANK_FROM ? ranksOf(year - 1) : null;
      const yr = Object.keys(P.series).map((p) => val(p, year)).filter((v) => v !== null);
      const nMissing = Object.keys(P.series).length - yr.length;
      document.getElementById('rank-title').textContent = year < RANK_FROM ? `${metricLabels[metric]}: top 10 (from ${RANK_FROM})` : `${metricLabels[metric]}: top 10, ${year - 2}–${String(year).slice(2)} average`;
      document.getElementById('rank-total').textContent = (year < RANK_FROM ? `The ranking uses a 3-year average, so it starts in ${RANK_FROM}. ` : 'Ranked on the 3-year average (Gg CH₄ per year); arrows compare with the previous year’s list. ')
        + `All ${yr.length} provinces with data, ${year}: ${fmt(d3.sum(yr), 1)} Gg CH₄` + (nMissing ? ` (${nMissing} without a record)` : '') + '.';
      const top = now.list.slice(0, 10), vmax = top.length ? top[0].v : 1, keep = new Set(top.map((d) => d.p));
      const anim = animate && !reduceMotion;
      if (!anim) ol.classList.add('noanim');
      rows.forEach((li, p) => {   // leavers
        if (keep.has(p)) return;
        rows.delete(p);
        if (!anim) { li.remove(); return; }
        li.classList.add('leave'); li.style.transform = `translateY(${10 * ROW}px)`; setTimeout(() => li.remove(), 920);
      });
      top.forEach((d, k) => {
        let li = rows.get(d.p); const isNew = !li;
        if (isNew) {
          li = makeRow(d.p); rows.set(d.p, li); ol.append(li);
          if (anim) { li.classList.add('enter'); li.style.transform = `translateY(${10 * ROW}px)`; li.getBoundingClientRect(); li.classList.remove('enter'); }
        }
        const oldRank = li.dataset.rank ? +li.dataset.rank : null;
        li.style.transform = `translateY(${k * ROW}px)`; li.dataset.rank = k + 1;
        const b = li.firstChild; b.setAttribute('aria-current', String(d.p === sel));
        const pr = prev ? prev.pos.get(d.p) : undefined, ch = pr === undefined ? null : pr - (k + 1);
        b.setAttribute('aria-label', `${k + 1}. ${label(d.p)}, ${fmt(d.v, 1)} Gg` + (ch ? (ch > 0 ? `, up ${ch}` : `, down ${-ch}`) : ''));
        b.querySelector('.rk').textContent = k + 1;
        b.querySelector('.bar').style.width = (d.v / vmax * 100) + '%';
        b.querySelector('.vl').textContent = fmt(d.v, 1) + ' Gg';
        const mv = b.querySelector('.mv'); mv.className = 'mv' + (ch > 0 ? ' up' : '');
        mv.textContent = ch === null ? '' : ch > 0 ? '▲' + ch : ch < 0 ? '▼' + -ch : '–';
        if (anim && oldRank && oldRank > k + 1) { li.classList.add('flash'); setTimeout(() => li.classList.remove('flash'), 900); }
      });
      if (!anim) { ol.getBoundingClientRect(); ol.classList.remove('noanim'); }   // jump instantly, keep motion for later changes
    }
    // s215: after a selection, make the province card visible: on wide screens the sidebar scrolls to its top;
    // on narrow screens the page scrolls just enough to show the card under the map (only if it is below the fold)
    function bringCard() {
      const side = document.getElementById('side'), card = document.getElementById('chart-card');
      if (!side || !card) return;
      if (window.matchMedia('(min-width: 901px)').matches) { side.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      const r = card.getBoundingClientRect();
      if (r.top > window.innerHeight * 0.75) window.scrollTo({ top: window.scrollY + r.top - window.innerHeight * 0.4, behavior: 'smooth' });
    }
    // s214: Thailand total trend: our estimate (sum of provinces, all years complete) and BTR1's official values (total view only)
    function natChart() {
      const card = document.getElementById('nat-chart'); if (!card) return;
      card.replaceChildren();
      const OFF = window.DATA_OFFICIAL || {};
      const s = P.years.map((y, i) => ({ y, v: d3.sum(Object.values(P.series), (ser) => (ser[i] === null || ser[i] === undefined ? 0 : ser[i])) }));
      const off = metric === 'total' ? Object.keys(OFF).map((y) => ({ y: +y, v: OFF[y] })) : [];
      const cur = s.find((d) => d.y === year);
      const sub = document.createElement('p'); sub.className = 'sub'; sub.id = 'nat-sub';
      sub.textContent = `${metricLabels[metric]}, Gg CH₄ per year · ${year}: ${fmt(cur.v, 1)} Gg` + (off.length && OFF[year] ? ` (official ${fmt(OFF[year], 1)})` : '');
      card.append(sub);
      const w = Math.max(260, card.clientWidth), h = 220, m = { t: 8, r: 10, b: 24, l: 44 };
      const x = d3.scaleLinear().domain([Y0, last]).range([m.l, w - m.r]);
      const yy = d3.scaleLinear().domain([0, d3.max(s.concat(off), (d) => d.v) * 1.1]).nice().range([h - m.b, m.t]);
      const svg = d3.select(card).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img')
        .attr('aria-label', `Thailand ${metricLabels[metric].toLowerCase()} by year, 1988 to 2024`);
      svg.append('g').attr('transform', `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(Math.min(8, Math.floor(w / 60))).tickFormat(d3.format('d')));
      svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(yy).ticks(5).tickSize(-(w - m.l - m.r))).call((g) => g.select('.domain').remove());
      svg.append('line').attr('x1', x(year)).attr('x2', x(year)).attr('y1', m.t).attr('y2', h - m.b).attr('stroke', '#9a9a9a').attr('stroke-dasharray', '3 3');
      svg.append('path').datum(s).attr('fill', 'none').attr('stroke', ink).attr('stroke-width', 1.6).attr('d', d3.line().x((d) => x(d.y)).y((d) => yy(d.v)));
      svg.selectAll('circle.off').data(off).join('circle').attr('class', 'off').attr('cx', (d) => x(d.y)).attr('cy', (d) => yy(d.v)).attr('r', 2.6)
        .attr('fill', '#ffffff').attr('stroke', d3.interpolateCividis(0.25)).attr('stroke-width', 1.2);
      svg.append('circle').attr('id', 'nat-dot').attr('cx', x(year)).attr('cy', yy(cur.v)).attr('r', 4.5).attr('fill', d3.interpolateCividis(0.92)).attr('stroke', ink).attr('stroke-width', 1.2);
      const key = document.createElement('p'); key.className = 'sub';
      key.textContent = off.length ? 'Line: our estimate (official rice area × BTR1 2022 factors). Open circles: BTR1 official, 2000–2022.' : 'Line: our estimate (official rice area × BTR1 2022 factors).';
      card.append(key);
    }
    function chart() {
      const card = document.getElementById('chart'); card.hidden = false; document.getElementById('chart-hint').hidden = true;
      card.replaceChildren();
      const s = P.years.map((y, i) => ({ y, v: P.series[sel] ? P.series[sel][i] : null }));
      const t = document.createElement('p'); t.className = 'ttl'; t.textContent = label(sel);
      const cur = val(sel, year);
      const sub = document.createElement('p'); sub.className = 'sub'; sub.id = 'chart-sub';
      sub.textContent = `${metricLabels[metric]}, Gg per year · ${year}: ${cur === null ? 'No data' : fmt(cur, 2) + ' Gg'}`;
      card.append(t, sub);
      const w = Math.max(260, card.clientWidth), h = 200, m = { t: 8, r: 10, b: 24, l: 40 };
      const x = d3.scaleLinear().domain([Y0, last]).range([m.l, w - m.r]);
      const yy = d3.scaleLinear().domain([0, (d3.max(s, (d) => d.v) || 1) * 1.1]).nice().range([h - m.b, m.t]);
      const svg = d3.select(card).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img').attr('aria-label', `Annual estimated methane for ${label(sel)}, 1988 to 2024`);
      svg.append('g').attr('transform', `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(Math.min(8, Math.floor(w / 60))).tickFormat(d3.format('d')));
      svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(yy).ticks(5).tickSize(-(w - m.l - m.r))).call((g) => g.select('.domain').remove());
      svg.append('line').attr('x1', x(year)).attr('x2', x(year)).attr('y1', m.t).attr('y2', h - m.b).attr('stroke', '#9a9a9a').attr('stroke-dasharray', '3 3');
      svg.append('path').datum(s).attr('fill', 'none').attr('stroke', ink).attr('stroke-width', 1.6).attr('d', d3.line().defined((d) => d.v !== null).x((d) => x(d.y)).y((d) => yy(d.v)));
      if (cur !== null) svg.append('circle').attr('id', 'chart-dot').attr('cx', x(year)).attr('cy', yy(cur)).attr('r', 4.5).attr('fill', d3.interpolateCividis(0.92)).attr('stroke', ink).attr('stroke-width', 1.2);
      // rank among all provinces with data, each year (single-year values, 1 = highest)
      const rk = P.years.map((y) => ({ y, r: rankIn(sel, y) }));
      const curR = rankIn(sel, year), n = Object.keys(P.series).filter((p) => val(p, year) !== null).length;
      const r3 = ranksOf(year).pos.get(sel);
      const rs = document.createElement('p'); rs.className = 'sub'; rs.id = 'chart-rank';
      rs.textContent = `Rank among provinces · ${year}: ${curR === null ? 'No data' : curR + ' of ' + n}` + (r3 ? ` · Top 10 list (3-year average): ${r3}` : '');
      card.append(rs);
      const h2 = 120, mr = { t: 8, r: 10, b: 22, l: 40 };
      const rmax = Math.max(10, d3.max(rk, (d) => d.r) || 10);
      const ry = d3.scaleLinear().domain([1, rmax]).range([mr.t, h2 - mr.b]);   // rank 1 at the top
      const s2 = d3.select(card).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${w} ${h2}`).attr('role', 'img').attr('aria-label', `Rank of ${label(sel)} among provinces, 1988 to 2024`);
      s2.append('g').attr('transform', `translate(0,${h2 - mr.b})`).call(d3.axisBottom(x).ticks(Math.min(8, Math.floor(w / 60))).tickFormat(d3.format('d')));
      const rt = [1, 10, rmax].filter((v, i, a) => a.indexOf(v) === i);
      s2.append('g').attr('transform', `translate(${mr.l},0)`).call(d3.axisLeft(ry).tickValues(rt).tickFormat((v) => '#' + v).tickSize(-(w - mr.l - mr.r))).call((g) => g.select('.domain').remove());
      s2.append('rect').attr('x', mr.l).attr('y', ry(1) - 4).attr('width', w - mr.l - mr.r).attr('height', ry(10) - ry(1) + 8).attr('fill', '#f2f2f2');
      s2.append('text').attr('x', w - mr.r - 2).attr('y', ry(10) - 2).attr('text-anchor', 'end').style('fill', '#666').text('Top 10');
      s2.append('line').attr('x1', x(year)).attr('x2', x(year)).attr('y1', mr.t).attr('y2', h2 - mr.b).attr('stroke', '#9a9a9a').attr('stroke-dasharray', '3 3');
      s2.append('path').datum(rk).attr('fill', 'none').attr('stroke', ink).attr('stroke-width', 1.4).attr('d', d3.line().defined((d) => d.r !== null).x((d) => x(d.y)).y((d) => ry(d.r)));
      if (curR !== null) s2.append('circle').attr('id', 'rank-dot').attr('cx', x(year)).attr('cy', ry(curR)).attr('r', 4).attr('fill', d3.interpolateCividis(0.92)).attr('stroke', ink).attr('stroke-width', 1.2);
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
        if (sel !== name) select(name, true);
        else map.fitBounds(byName[name].getBounds(), { maxZoom: 9, padding: [40, 40] });
      }
    });
    document.getElementById('clear-selection').addEventListener('click', clearSelection);
    document.getElementById('prov-csv').addEventListener('click', () => {
      const out = ['province,year,component,ch4_Gg'];
      Object.keys(P.series).sort().forEach((p) => P.years.forEach((y) => out.push(`"${label(p)}",${y},${metric},${val(p, y) === null ? '' : val(p, y)}`)));
      download(out.join('\n'), 'rice_ch4_' + metric + '_provinces_1988_2024.csv', 'prov-msg');
    });
    document.getElementById('prov-link').addEventListener('click', () => copyLink('prov-msg'));
    document.getElementById('prov-reset').addEventListener('click', clearSelection);
    document.addEventListener('click', (event) => {
      if (!sel || APP.grid.isOpen()) return;
      const control = event.target.closest('.map, .pv-map, button, input, select, label, a, #chart, #rank, [role="dialog"], .leaflet-control');
      if (!control) clearSelection();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && sel && !APP.grid.isOpen()) clearSelection();
    });
    APP.prov = { map, setYear, select, setMetric, metric: () => metric, year: () => year, fill: (p) => byName[p].options.fillColor, colour: col, value: val, layer: (p) => byName[p],
      tipText, stop: pl.stop, start: pl.start, playing: pl.playing, selected: () => sel,
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
  APP.writeHash = function () {
    if (!APP.grid || !APP.prov || APP._reading) return;
    const h = APP.grid.isOpen() ? `#grid/${APP.grid.month()}${APP.grid.selected() !== null ? '/' + APP.grid.selected() : ''}`
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
        if (parts[2] && P.series[parts[2]]) APP.prov.select(parts[2], true);
      } else if (parts[0] === 'grid') {
        APP.grid.open();
        const m = +parts[1]; if (m >= 1 && m <= 12) APP.grid.setMonth(m);
        const i = +parts[2]; if (parts[2] !== undefined && i >= 0 && i < G.cells.length) APP.grid.select(i);
      }
    } finally { APP._reading = false; }
  })();
})();
