import territoryData from '../data/territories.js';
import mapImages from '../data/mapImages.js';
import * as tooltips from './tooltips.js';

// In-game coordinates (x, z) are mapped to Leaflet's simple CRS as [lat, lng] = [-z, x], i.e. 1 block = 1 px at zoom 0
const worldBounds = [[1, -2560], [6912, 2048]];
const overscroll = 0.75;
const resourceColors = {'emeralds': '#5f5', 'ore': '#ddd', 'wood': '#fa0', 'fish': '#5ff', 'crops': '#ff5'};
const selectedColor = '#f5f';
const hqPathColor = '#fa0';
const difficultyColors = {'Very Low': 'green', 'Low': 'green', 'Medium': 'yellow', 'High': 'red', 'Very High': 'red'};

let L;
let map;
let container;
let callbacks;
let initPromise = null;
let refreshScheduled = false;
let hovered = null;
let hqPath = new Set();
let hoverTooltip;
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

async function createMap(element, mapCallbacks) {
  L = await import('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet-src.esm.js');
  container = element;
  callbacks = mapCallbacks;
  map = L.map(container, {
    attributionControl: false,
    boxZoom: false,
    crs: L.CRS.Simple,
    doubleClickZoom: false,
    maxBounds: worldBounds,
    maxBoundsViscosity: 1,
    maxZoom: 3,
    minZoom: -3,
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
  createLegend();
  createOverlays();

  map.on('zoomend', updateZoomClass);
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
  const margin = map.getSize().multiplyBy(overscroll / map.getZoomScale(zoom, 0));
  return L.latLngBounds([worldBounds[0][0] - margin.y, worldBounds[0][1] - margin.x],
      [worldBounds[1][0] + margin.y, worldBounds[1][1] + margin.x]);
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
      .map(resource => resourceColors[resource]);
  if (resources.emeralds > 9000 || colors.length === 0) {
    colors.unshift(resourceColors.emeralds);
  }
  return colors;
}

function patternId(colors) {
  return 'stripes' + colors.map(color => color.replace('#', '-')).join('');
}

function fillOf(name) {
  const colors = colorsOf(name);
  return colors.length === 1 ? colors[0] : `url(#${patternId(colors)})`;
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
    territoryLayers[name] = {rectangle, label, labelHtml: null};

    rectangle.on('mouseover', event => {
      setHovered(name);
      showHover(name, event.originalEvent);
    });
    rectangle.on('mousemove', event => positionElement(hoverTooltip, event.originalEvent, 16));
    rectangle.on('mouseout', () => {
      setHovered(null);
      hoverTooltip.hidden = true;
    });
    rectangle.on('click', () => {
      if (callbacks.getTerritory(name)) {
        callbacks.onToggleSelect(name);
      } else {
        callbacks.onAdd(name);
      }
    });
    rectangle.on('dblclick', () => {
      if (callbacks.getTerritory(name)) {
        callbacks.onEdit(name);
      }
    });
  }
}

function createLegend() {
  const legend = L.control({position: 'bottomleft'});
  legend.onAdd = () => {
    const element = L.DomUtil.create('div', 'tooltip map-legend');
    const resourceLines = ['emeralds', 'ore', 'wood', 'fish', 'crops'].map(resource => {
      const label = resource === 'emeralds' ? 'City' : resource.charAt(0).toUpperCase() + resource.slice(1);
      return `<span class="swatch" style="background-color: ${resourceColors[resource]}"></span>${label}`;
    });
    element.innerHTML = `<p>${resourceLines.join(' ')}</p>
      <p><span class="swatch outline" style="border-color: ${selectedColor}"></span>Selected
        <span class="label-hq">♛</span> HQ
        <span class="swatch" style="background-color: ${hqPathColor}; height: 3px"></span>Fastest route to HQ</p>
      <p class="gray">Click: add / select, double-click: edit</p>`;
    L.DomEvent.disableClickPropagation(element);
    return element;
  };
  legend.addTo(map);
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
  hqPath = new Set(hovered === null ? [] : findHqPath(hovered));
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
  const color = fillOf(name);
  const style = territory ?
      {color: color, dashArray: null, fillOpacity: 0.5, opacity: 1, weight: 2} :
      {color: color, dashArray: '4 4', fillOpacity: 0.3, opacity: 0.8, weight: 1};
  if (callbacks.isSelected(name)) {
    Object.assign(style, {color: selectedColor, fillOpacity: 0.7, weight: 3});
  }
  if (name === hovered) {
    style.fillOpacity += 0.2;
  }
  territoryLayers[name].rectangle.setStyle(style);
  for (const route of routesByTerritory[name]) {
    styleRoute(route);
  }
}

function setHovered(name) {
  const previous = hovered;
  const previousPath = hqPath;
  hovered = name;
  hqPath = new Set(name === null ? [] : findHqPath(name));
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

function findHqPath(name) {
  const hq = callbacks.getHq();
  if (hq === null || hq === name) {
    return [];
  }
  const parents = {[hq]: null};
  const queue = [hq];
  while (queue.length > 0 && !(name in parents)) {
    const current = queue.shift();
    for (const connection of territoryData[current].connections) {
      if (connection in territoryData && !(connection in parents)) {
        parents[connection] = current;
        queue.push(connection);
      }
    }
  }
  const path = [];
  for (let current = name; current in parents && parents[current] !== null; current = parents[current]) {
    path.push(routesByKey.get(routeKey(current, parents[current])));
  }
  return path;
}

function styleRoute(route) {
  const endpoints = [route.from, route.to];
  if (hqPath.has(route)) {
    route.line.setStyle({color: hqPathColor, opacity: 1, weight: 3});
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

function updateLabel(name) {
  const territory = callbacks.getTerritory(name);
  const resources = territoryData[name].resources;
  const icons = ['ore', 'wood', 'fish', 'crops'].filter(resource => resources[resource] > 0)
      .map(resource => `<img alt="" src="assets/img/resources/${resource}.png">`);
  if (resources.emeralds > 9000) {
    icons.unshift('<span class="green">✦</span>');
  }
  let html = `<div class="label-icons">${icons.join('')}</div><div class="label-name">${escapeHtml(name)}</div>`;
  if (territory) {
    const difficulty = territory.difficulty;
    html += `<div class="label-stats ${difficultyColors[difficulty]}">${difficulty}</div>`;
  }
  if (name === callbacks.getHq()) {
    html = `<div class="label-hq">♛</div>` + html;
  }
  const classes = ['territory-label', territory ? 'managed' : '', callbacks.isSelected(name) ? 'selected' : ''];
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
  hint.innerText = territory ? 'Click to select, double-click to edit' : 'Click to add';
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
