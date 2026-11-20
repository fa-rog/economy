import territoryData from '../data/territories.js';
import mapImages from '../data/mapImages.js';
import * as tooltips from './tooltips.js';

// In-game coordinates (x, z) are mapped to Leaflet's simple CRS as [lat, lng] = [-z, x], i.e. 1 block = 1 px at zoom 0
const WORLD_BOUNDS = [[1, -2560], [6912, 2048]];
const OVERSCROLL = 0.75;
const RESOURCE_COLORS = {'emeralds': '#5f5', 'ore': '#ddd', 'wood': '#fa0', 'fish': '#5ff', 'crops': '#ff5'};
const SELECTED_COLOR = '#f5f';
const HQ_PATH_COLOR = '#fa0';
const DIFFICULTY_COLORS = {
  'Very Low': '#5f5', 'Low': '#0a0', 'Medium': '#ff5', 'High': '#f55', 'Very High': '#a00',
};
const DIFFICULTY_LABEL_COLORS = {
  'Very Low': 'green', 'Low': 'green', 'Medium': 'yellow', 'High': 'red', 'Very High': 'red',
};
const UNMANAGED_DEFENCE_COLOR = '#777';
const MULTIHIT_INSET = 4;
const UNMANAGED_ROUTE_COST = 1000;
const DEFAULT_MODES = {display: 'resources', routes: 'fastest', territories: 'all', labels: 'shown'};

let L;
let map;
let container;
let callbacks;
let initPromise = null;
let refreshScheduled = false;
let hovered = null;
let pinned = null;
let hqParents = {};
let hqPath = new Set();
let hoverTooltip;
let legendElement;
let modes = loadModes();
const picked = new Set();
let previouslySelected = new Set();
const territoryLayers = {};
const routesByTerritory = {};
const routesByKey = new Map();
const routes = [];

export function initMap(element, mapCallbacks) {
  if (initPromise === null) {
    initPromise = createMap(element, mapCallbacks);
  } else {
    initPromise.then(() => map.invalidateSize());
  }
  return initPromise;
}

export function refresh() {
  if (map === undefined || refreshScheduled) {
    return;
  }
  refreshScheduled = true;
  queueMicrotask(() => {
    refreshScheduled = false;
    render();
  });
}

export function clearPicked() {
  picked.clear();
  refresh();
}

function loadModes() {
  try {
    return {...DEFAULT_MODES, ...JSON.parse(localStorage.getItem('mapModes'))};
  } catch (error) {
    return {...DEFAULT_MODES};
  }
}

function setMode(mode, value) {
  modes[mode] = value;
  try {
    localStorage.setItem('mapModes', JSON.stringify(modes));
  } catch (error) {
    // Saving the view modes is not critical
  }
  updateModeControls();
  updateLegend();
  render();
}

async function createMap(element, mapCallbacks) {
  L = await import('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet-src.esm.js');
  container = element;
  callbacks = mapCallbacks;
  map = L.map(container, {
    attributionControl: false,
    boxZoom: false,
    crs: L.CRS.Simple,
    doubleClickZoom: false,
    maxBounds: WORLD_BOUNDS,
    maxBoundsViscosity: 1,
    maxZoom: 3,
    minZoom: -3,
    zoomControl: false,
  });
  const limitCenter = map._limitCenter;
  map._limitCenter = (center, zoom, bounds) => limitCenter.call(map, center, zoom, bounds && boundsForZoom(zoom));
  for (const image of mapImages) {
    L.imageOverlay(image.url, [[-image.z1, image.x1], [-image.z2 - 1, image.x2 + 1]], {className: 'map-image'})
        .addTo(map);
  }
  createPatterns();
  createRoutes();
  createTerritories();
  createModeControls();
  L.control.zoom({position: 'bottomright'}).addTo(map);
  createLegend();
  createOverlays();

  map.on('click', () => {
    if (picked.size > 0) {
      clearPicked();
    }
  });
  map.on('zoomend', updateZoomClass);
  map.on('zoomend', updateMultihitBorderBounds);
  map.on('zoomend resize', updateMaxBounds);
  map.on('moveend', () => {
    try {
      localStorage.setItem('mapView', JSON.stringify({center: map.getCenter(), zoom: map.getZoom()}));
    } catch (error) {
      // Saving the map position is not critical
    }
  });
  restoreView();
  updateMaxBounds();
  updateZoomClass();
  render();
}

function restoreView() {
  let savedView = null;
  try {
    savedView = JSON.parse(localStorage.getItem('mapView'));
  } catch (error) {
    // Fall back to default view
  }
  if (savedView !== null) {
    map.setView(savedView.center, savedView.zoom);
    return;
  }
  const managed = Object.keys(territoryData).filter(name => callbacks.getTerritory(name));
  const names = managed.length > 0 ? managed : Object.keys(territoryData);
  map.fitBounds(L.latLngBounds(names.map(name => territoryLayers[name].rectangle.getBounds())), {padding: [20, 20]});
}

function boundsForZoom(zoom) {
  const margin = map.getSize().multiplyBy(OVERSCROLL / map.getZoomScale(zoom, 0));
  return L.latLngBounds([WORLD_BOUNDS[0][0] - margin.y, WORLD_BOUNDS[0][1] - margin.x],
      [WORLD_BOUNDS[1][0] + margin.y, WORLD_BOUNDS[1][1] + margin.x]);
}

function updateMaxBounds() {
  map.setMaxBounds(boundsForZoom(map.getZoom()));
}

function toBounds({start, end}) {
  return [[-start[1], start[0]], [-end[1], end[0]]];
}

function centerOf(name) {
  const {start, end} = territoryData[name].location;
  return [-(start[1] + end[1]) / 2, (start[0] + end[0]) / 2];
}

function colorsOf(name) {
  const resources = territoryData[name].resources;
  const colors = ['ore', 'wood', 'fish', 'crops'].filter(resource => resources[resource] > 0)
      .map(resource => RESOURCE_COLORS[resource]);
  if (resources.emeralds > 9000 || colors.length === 0) {
    colors.unshift(RESOURCE_COLORS.emeralds);
  }
  return colors;
}

function patternId(colors) {
  return 'stripes' + colors.map(color => color.replace('#', '-')).join('');
}

function fillOf(name) {
  if (modes.display === 'defences') {
    const territory = callbacks.getTerritory(name);
    return territory ? DIFFICULTY_COLORS[territory.difficulty] : UNMANAGED_DEFENCE_COLOR;
  }
  const colors = colorsOf(name);
  return colors.length === 1 ? colors[0] : `url(#${patternId(colors)})`;
}

function isVisible(name) {
  return modes.territories !== 'managed' || Boolean(callbacks.getTerritory(name));
}

function createPatterns() {
  const svgNamespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('class', 'map-patterns');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  const defs = document.createElementNS(svgNamespace, 'defs');
  const stripeWidth = 6;
  const combinations = new Set(Object.keys(territoryData).map(colorsOf).filter(colors => colors.length > 1)
      .map(colors => colors.join()));
  for (const combination of combinations) {
    const colors = combination.split(',');
    const pattern = document.createElementNS(svgNamespace, 'pattern');
    pattern.setAttribute('id', patternId(colors));
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('patternTransform', 'rotate(45)');
    pattern.setAttribute('width', `${stripeWidth * colors.length}`);
    pattern.setAttribute('height', `${stripeWidth}`);
    for (const [index, color] of colors.entries()) {
      const stripe = document.createElementNS(svgNamespace, 'rect');
      stripe.setAttribute('x', `${stripeWidth * index}`);
      stripe.setAttribute('width', `${stripeWidth}`);
      stripe.setAttribute('height', `${stripeWidth}`);
      stripe.setAttribute('fill', color);
      pattern.appendChild(stripe);
    }
    defs.appendChild(pattern);
  }
  svg.appendChild(defs);
  container.appendChild(svg);
}

function createRoutes() {
  for (const [name, data] of Object.entries(territoryData)) {
    routesByTerritory[name] ??= [];
    for (const connection of data.connections) {
      const key = routeKey(name, connection);
      if (!(connection in territoryData) || routesByKey.has(key)) {
        continue;
      }
      const route = {
        from: name,
        to: connection,
        line: L.polyline([centerOf(name), centerOf(connection)], {interactive: false}).addTo(map),
      };
      routes.push(route);
      routesByKey.set(key, route);
      routesByTerritory[name].push(route);
      (routesByTerritory[connection] ??= []).push(route);
    }
  }
}

function createTerritories() {
  for (const [name, data] of Object.entries(territoryData)) {
    const rectangle = L.rectangle(toBounds(data.location), {fillColor: fillOf(name)}).addTo(map);
    const label = L.marker(centerOf(name), {interactive: false, keyboard: false}).addTo(map);
    territoryLayers[name] = {rectangle, label, labelHtml: null, multihitBorder: null};

    rectangle.on('mouseover', event => {
      setHovered(name);
      showHover(name, event.originalEvent);
    });
    rectangle.on('mousemove', event => positionElement(hoverTooltip, event.originalEvent, 16));
    rectangle.on('mouseout', () => {
      setHovered(null);
      hoverTooltip.hidden = true;
    });
    rectangle.on('click', event => {
      L.DomEvent.stopPropagation(event);
      if (callbacks.getTerritory(name)) {
        callbacks.onToggleSelect(name);
      } else {
        const wasPicked = picked.has(name);
        picked.clear();
        if (!wasPicked) {
          picked.add(name);
        }
        render();
      }
    });
    rectangle.on('dblclick', event => {
      L.DomEvent.stopPropagation(event);
      if (callbacks.getTerritory(name)) {
        callbacks.onEdit(name);
      } else {
        picked.delete(name);
        callbacks.onAdd(name);
      }
    });
  }
}

function createModeControls() {
  const control = L.control({position: 'topleft'});
  control.onAdd = () => {
    const element = L.DomUtil.create('div', 'tooltip map-modes');
    element.innerHTML = `
      <div class="mode-group" data-mode="display" title="Territory coloring">
        <button data-value="resources">Resources</button><button data-value="defences">Defences</button>
      </div>
      <div class="mode-group" data-mode="routes" title="Route to HQ">
        <button data-value="fastest" title="Fewest territories">Fastest</button><button data-value="cheapest"
          title="Fewest territories outside the claim">Cheapest</button>
      </div>
      <div class="mode-group" data-mode="labels" title="Territory labels">
        <button data-value="shown">Labels</button><button data-value="hidden">Clean</button>
      </div>
      <div class="mode-group" data-mode="territories" title="Shown territories">
        <button data-value="all">All</button><button data-value="managed">Managed</button>
      </div>`;
    for (const group of element.querySelectorAll('.mode-group')) {
      for (const button of group.querySelectorAll('button')) {
        button.addEventListener('click', () => setMode(group.dataset.mode, button.dataset.value));
      }
    }
    L.DomEvent.disableClickPropagation(element);
    L.DomEvent.disableScrollPropagation(element);
    return element;
  };
  control.addTo(map);
  updateModeControls();
}

function updateModeControls() {
  container.classList.toggle('hide-labels', modes.labels === 'hidden');
  for (const group of container.querySelectorAll('.map-modes .mode-group')) {
    for (const button of group.querySelectorAll('button')) {
      button.classList.toggle('current', modes[group.dataset.mode] === button.dataset.value);
    }
  }
}

function createLegend() {
  const legend = L.control({position: 'bottomleft'});
  legend.onAdd = () => {
    legendElement = L.DomUtil.create('div', 'tooltip map-legend');
    L.DomEvent.disableClickPropagation(legendElement);
    updateLegend();
    return legendElement;
  };
  legend.addTo(map);
}

function updateLegend() {
  if (legendElement === undefined) {
    return;
  }
  let colorLines;
  if (modes.display === 'defences') {
    const difficultyLine = Object.entries(DIFFICULTY_COLORS)
        .map(([difficulty, color]) => `<span class="swatch" style="background-color: ${color}"></span>${difficulty}`);
    colorLines = `<p>${difficultyLine.join(' ')}</p>`;
  } else {
    const resourceLine = ['emeralds', 'ore', 'wood', 'fish', 'crops'].map(resource => {
      const label = resource === 'emeralds' ? 'City' : resource.charAt(0).toUpperCase() + resource.slice(1);
      return `<span class="swatch" style="background-color: ${RESOURCE_COLORS[resource]}"></span>${label}`;
    });
    colorLines = `<p>${resourceLine.join(' ')}</p>`;
  }
  const routeLabel = modes.routes === 'cheapest' ? 'Cheapest route to HQ' : 'Fastest route to HQ';
  const multiLegend = modes.display === 'defences' ? '<span class="swatch multihit"></span>Multi' : '';
  legendElement.innerHTML = `${colorLines}
    <p><span class="swatch outline" style="border-color: ${SELECTED_COLOR}"></span>Selected
      <span class="label-hq">♛</span> HQ
      <span class="swatch" style="background-color: ${HQ_PATH_COLOR}; height: 3px"></span>${routeLabel}
      ${multiLegend}</p>
    <p class="gray">Click: select, double-click: add / edit</p>`;
}

function createOverlays() {
  hoverTooltip = document.createElement('div');
  hoverTooltip.className = 'tooltip map-hover';
  hoverTooltip.hidden = true;
  container.appendChild(hoverTooltip);
}

function updateZoomClass() {
  const zoom = map.getZoom();
  container.classList.toggle('zoom-far', zoom <= -2);
  container.classList.toggle('zoom-mid', zoom === -1);
  container.classList.toggle('zoom-near', zoom >= 0);
}

function render() {
  for (const name of picked) {
    if (callbacks.getTerritory(name) || !isVisible(name)) {
      picked.delete(name);
    }
  }
  if (hovered !== null && !isVisible(hovered)) {
    hovered = null;
    hoverTooltip.hidden = true;
  }
  const selected = new Set(Object.keys(territoryData).filter(name => callbacks.isSelected(name)));
  if ([...selected].some(name => !previouslySelected.has(name))) {
    picked.clear();
  }
  previouslySelected = selected;
  const chosen = [...selected, ...picked];
  pinned = chosen.length === 1 ? chosen[0] : null;
  hqParents = computeHqParents();
  hqPath = computeHqPath();
  for (const name of Object.keys(territoryLayers)) {
    styleTerritory(name);
    updateLabel(name);
  }
  if (hovered !== null && !hoverTooltip.hidden) {
    renderHoverContent(hovered);
  }
}

function styleTerritory(name) {
  const territory = callbacks.getTerritory(name);
  const layers = territoryLayers[name];
  const visible = isVisible(name);
  if (visible !== map.hasLayer(layers.rectangle)) {
    for (const layer of [layers.rectangle, layers.label]) {
      if (visible) {
        layer.addTo(map);
      } else {
        layer.remove();
      }
    }
  }
  const color = fillOf(name);
  const style = territory ?
      {color: color, dashArray: null, fillColor: color, fillOpacity: 0.5, opacity: 1, weight: 2} :
      {color: color, dashArray: '4 4', fillColor: color, fillOpacity: 0.3, opacity: 0.8, weight: 1};
  if (callbacks.isSelected(name) || picked.has(name)) {
    Object.assign(style, {color: SELECTED_COLOR, fillOpacity: 0.7, weight: 3});
  }
  if (name === hovered) {
    style.fillOpacity += 0.2;
  }
  layers.rectangle.setStyle(style);
  updateMultihitBorder(name, visible, style.color);
  for (const route of routesByTerritory[name]) {
    styleRoute(route);
  }
}

function updateMultihitBorder(name, visible, color) {
  const territory = callbacks.getTerritory(name);
  const layers = territoryLayers[name];
  const shown = visible && modes.display === 'defences' && territory && territory.upgrades.multi > 0;
  if (!shown) {
    layers.multihitBorder?.remove();
    layers.multihitBorder = null;
    return;
  }
  layers.multihitBorder ??= L.rectangle(multihitBorderBounds(name), {fill: false, interactive: false, weight: 2})
      .addTo(map);
  layers.multihitBorder.setStyle({color: color});
}

function multihitBorderBounds(name) {
  const {start, end} = territoryData[name].location;
  const size = Math.min(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]));
  const inset = Math.min(MULTIHIT_INSET / map.getZoomScale(map.getZoom(), 0), size / 4);
  const [x1, x2] = [start[0], end[0]].sort((a, b) => a - b);
  const [z1, z2] = [start[1], end[1]].sort((a, b) => a - b);
  return [[-(z1 + inset), x1 + inset], [-(z2 - inset), x2 - inset]];
}

function updateMultihitBorderBounds() {
  for (const [name, layers] of Object.entries(territoryLayers)) {
    layers.multihitBorder?.setBounds(multihitBorderBounds(name));
  }
}

function setHovered(name) {
  const previous = hovered;
  const previousPath = hqPath;
  hovered = name;
  hqPath = computeHqPath();
  if (previous !== null) {
    styleTerritory(previous);
  }
  if (name !== null) {
    styleTerritory(name);
  }
  for (const route of new Set([...previousPath, ...hqPath])) {
    styleRoute(route);
  }
}

function routeKey(from, to) {
  return [from, to].sort().join('|');
}

function computeHqParents() {
  const hq = callbacks.getHq();
  if (hq === null || !(hq in territoryData)) {
    return {};
  }
  const parents = {[hq]: null};
  if (modes.routes !== 'cheapest') {
    const queue = [hq];
    for (let i = 0; i < queue.length; i++) {
      for (const connection of territoryData[queue[i]].connections) {
        if (connection in territoryData && !(connection in parents)) {
          parents[connection] = queue[i];
          queue.push(connection);
        }
      }
    }
    return parents;
  }
  const costs = {[hq]: 0};
  const done = new Set();
  for (;;) {
    let current = null;
    for (const [name, cost] of Object.entries(costs)) {
      if (!done.has(name) && (current === null || cost < costs[current])) {
        current = name;
      }
    }
    if (current === null) {
      return parents;
    }
    done.add(current);
    for (const connection of territoryData[current].connections) {
      if (!(connection in territoryData) || done.has(connection)) {
        continue;
      }
      const cost = costs[current] + 1 + (callbacks.getTerritory(connection) ? 0 : UNMANAGED_ROUTE_COST);
      if (!(connection in costs) || cost < costs[connection]) {
        costs[connection] = cost;
        parents[connection] = current;
      }
    }
  }
}

function computeHqPath() {
  return new Set([...findHqPath(hovered), ...findHqPath(pinned)]);
}

function findHqPath(name) {
  const path = [];
  if (name === null) {
    return path;
  }
  for (let current = name; current in hqParents && hqParents[current] !== null; current = hqParents[current]) {
    path.push(routesByKey.get(routeKey(current, hqParents[current])));
  }
  return path;
}

function styleRoute(route) {
  const endpoints = [route.from, route.to];
  if (hqPath.has(route)) {
    route.line.setStyle({color: HQ_PATH_COLOR, opacity: 1, weight: 3});
  } else if (!endpoints.every(isVisible)) {
    route.line.setStyle({opacity: 0});
  } else if (endpoints.includes(hovered)) {
    route.line.setStyle({color: 'white', opacity: 1, weight: 2});
  } else if (endpoints.every(name => callbacks.getTerritory(name))) {
    route.line.setStyle({color: '#fffacd', opacity: 0.9, weight: 2});
  } else {
    route.line.setStyle({color: 'black', opacity: 0.85, weight: 1.5});
  }
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function resourceIcons(name) {
  const resources = territoryData[name].resources;
  const icons = [];
  if (resources.emeralds > 9000) {
    icons.push('<span class="green">✦</span>');
  }
  for (const resource of ['ore', 'wood', 'fish', 'crops']) {
    const count = resources[resource] >= 7200 ? 2 : resources[resource] > 0 ? 1 : 0;
    for (let i = 0; i < count; i++) {
      icons.push(`<img alt="" src="assets/img/resources/${resource}.png">`);
    }
  }
  return icons;
}

function updateLabel(name) {
  const territory = callbacks.getTerritory(name);
  const icons = resourceIcons(name);
  let html = icons.length > 0 ? `<div class="label-icons">${icons.join('')}</div>` : '';
  html += `<div class="label-name">${escapeHtml(name)}</div>`;
  if (territory) {
    const difficulty = territory.difficulty;
    const multihit = territory.upgrades.multi > 0 ? ' ⚔' : '';
    html += `<div class="label-stats ${DIFFICULTY_LABEL_COLORS[difficulty]}">${difficulty}${multihit}</div>`;
  }
  if (name === callbacks.getHq()) {
    html = `<div class="label-hq">♛</div>` + html;
  }
  const selected = callbacks.isSelected(name) || picked.has(name);
  const classes = ['territory-label', territory ? 'managed' : '', selected ? 'selected' : ''];
  html = `<div class="${classes.join(' ')}">${html}</div>`;
  const layers = territoryLayers[name];
  if (layers.labelHtml !== html) {
    layers.labelHtml = html;
    layers.label.setIcon(L.divIcon({className: 'territory-label-anchor', html: html, iconSize: [0, 0]}));
  }
}

function renderHoverContent(name) {
  const territory = callbacks.getTerritory(name);
  if (territory) {
    tooltips.renderTerritoryDetails(territory, hoverTooltip);
  } else {
    tooltips.renderBaseTerritoryDetails(name, territoryData[name], callbacks.getHqDistance(name), hoverTooltip);
  }
  const hint = document.createElement('p');
  hint.className = 'dark-gray';
  hint.innerText = territory ? 'Click to select, double-click to edit' : 'Click to select, double-click to add';
  hoverTooltip.append(document.createElement('br'), hint);
}

function showHover(name, event) {
  renderHoverContent(name);
  hoverTooltip.hidden = false;
  positionElement(hoverTooltip, event, 16);
}

function positionElement(element, event, offset) {
  const bounds = container.getBoundingClientRect();
  let x = event.clientX - bounds.left + offset;
  let y = event.clientY - bounds.top + offset;
  if (x + element.offsetWidth > bounds.width) {
    x = Math.max(0, x - element.offsetWidth - 2 * offset);
  }
  if (y + element.offsetHeight > bounds.height) {
    y = Math.max(0, bounds.height - element.offsetHeight);
  }
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
}
