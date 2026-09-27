import territoryData from '../data/territories.js';
import upgradeData from '../data/upgrades.js';
import {Territory} from './territory.js';
import * as tooltips from './tooltips.js';
import * as map from './map.js';

const shareUrl = 'https://script.google.com/macros/s/AKfycbxChZAQ2rNlbmSXK2JONfbWGLN_F97T7VWs9rSgHnozfHQOb2SUrM1qxzj7iSHuIST_/exec';

let apiData;
const guilds = [];
try {
  const response = await fetch('https://wynnmap.zatzou.com/api/v3/terr/state');
  if (!response.ok) {
    throw new Error(`Response status: ${response.status}`);
  }

  apiData = (await response.json())['terrs'];
  const guildNames = Object.values(apiData)
      .filter(territory => territory['guild']['uuid'] !== null)
      .map(territory => `${territory['guild']['name']} [${territory['guild']['prefix']}]`);
  guilds.push(...new Set(guildNames));
  guilds.sort();
} catch (error) {
  document.querySelector('#loadTerritories').disabled = true;
  document.querySelector('#loadTreasury').disabled = true;
  apiData = Object.fromEntries(Object.keys(territoryData).map(name => [name, {acquired: null}]));
}

const availableTerritories = Object.keys(territoryData);
let hq = null;
const hqDistances = {};
const territories = {};
const tributes = {'emeralds': 0, 'ore': 0, 'wood': 0, 'fish': 0, 'crops': 0};
const selection = new Set();

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('id')) {
  fetch(`${shareUrl}?id=${urlParams.get('id')}`)
    .then(response => response.json())
    .then(data => fromJSON(data));
  window.history.replaceState({}, document.title, window.location.href.split('?')[0]);
} else {
  try {
      loadFromLocalStorage();
  } catch (error) {
      localStorage.clear();
      location.reload();
  }
}

createInputMenu('#loadTerritories', '#loadTerritoriesResults', guilds, guild => {
  const guildPrefix = guild.split('[').at(-1).split(']')[0];
  const territoryNames = Object.entries(apiData)
      .filter(([name, territory]) => territory['guild']['prefix'] === guildPrefix && name in territoryData &&
          !(name in territories))
      .sort(([, first], [, second]) => second['hq'] - first['hq'])
      .map(([name]) => name);
  addTerritories(territoryNames);
  return `Added ${territoryNames.length}!`;
});

createInputMenu('#addTerritory', '#addTerritoryResults', availableTerritories, territoryName => {
  addTerritories([territoryName]);
  return 'Added!';
});

function addTerritories(territoryNames) {
  for (const territoryName of territoryNames) {
    addTerritory(territoryName);
  }
  tooltips.sortTerritories();
  updateTotal();
  updateLocalStorage();
}

function updateTotal() {
  tooltips.updateTotal(territories, tributes);
  map.refresh();
}

function createInputMenu(inputTag, resultListTag, items, callback) {
  const input = document.querySelector(inputTag);
  const resultList = document.querySelector(resultListTag);

  function updateChoices() {
    const choices = createMatchingList(items, input.value);
    resultList.replaceChildren(...choices);
    input.className = choices.length > 0 ? 'active' : '';
  }

  input.addEventListener('click', updateChoices);
  input.addEventListener('input', updateChoices);
  resultList.addEventListener('click', event => {
    if (event.target.tagName.toLowerCase() === 'li') {
      resultList.replaceChildren();
      input.className = 'success';
      input.disabled = true;
      input.value = callback(event.target.innerText);
      setTimeout(() => {
        input.className = '';
        input.disabled = false;
        input.value = '';
      }, 1200);
    }
  });
  input.addEventListener('focusout', event => {
    if (resultList.matches(':hover')) {
      input.focus();
    } else {
      event.target.value = '';
      input.classList.remove('active');
      resultList.innerHTML = '';
    }
  });
}

function createMatchingList(items, input) {
  let amount = 0;
  const addedItems = [];
  const lines = [];
  for (const regExp of [new RegExp(`^${input}`, 'i'), new RegExp(input, 'i')]) {
    for (const item of items) {
      if (item.match(regExp) && !addedItems.includes(item)) {
        if (amount++ >= 12) {
          const span = document.createElement('span');
          span.innerText = '...';
          lines.push(span);
          return lines;
        }
        const listItem = document.createElement('li');
        listItem.innerText = item;
        lines.push(listItem);
        addedItems.push(item);
      }
    }
  }
  return lines;
}

function addTerritory(territoryName, baseTreasury = null) {
  availableTerritories.splice(availableTerritories.indexOf(territoryName), 1);
  territories[territoryName] = new Territory(territoryName,
      territoryData[territoryName].connections.filter(conn => conn in territories).length,
      territoryData[territoryName]['resources'],
      territoryName in apiData ? apiData[territoryName]['acquired'] : null,
      hqDistances[territoryName], baseTreasury);
  const territoryBox = tooltips.addTerritory(territories[territoryName]);
  territoryBox.addEventListener('click', () => toggleSelected(territoryName));
  territoryBox.addEventListener('dblclick', () => editTerritory(territoryName));
  if (hq === null) {
    setHq(territoryName);
  } else if (hqDistances[territoryName] <= 3) {
    territories[hq].hqBonus += 0.25;
    tooltips.updateTerritoryStats(territories[hq]);
  }
  for (const connection of territoryData[territoryName].connections) {
    if (connection in territories) {
      territories[connection].connections++;
      tooltips.updateTerritoryStats(territories[connection]);
    }
  }
}

const openEditModal = createModal('.modal-edit', () => {
  for (const territory of getSelected()) {
    tooltips.updateTerritory(territory);
  }
  tooltips.sortTerritories();
  updateTotal();
  updateLocalStorage();
  setTimeout(clearSelection, 200);
});

function editTerritory(territoryName) {
  selection.add(territoryName);
  renderSelection();
  editTerritories();
}

function editTerritories() {
  const selectedTerritories = getSelected();
  const upgradeSpans = document.querySelectorAll('.modal .upgrades li > span');
  const upgradeTooltips = document.querySelectorAll('.modal .upgrades .tooltip');
  for (const [index, upgrade] of Object.keys(upgradeData).entries()) {
    const level = Math.min(...selectedTerritories.map(territory => territory.upgrades[upgrade]));
    upgradeSpans[index].innerText = level;
    tooltips.updateUpgrade(upgradeTooltips[index], upgrade, level);
  }
  openEditModal();
}

document.querySelector('#editTerrs').addEventListener('click', editTerritories);

for (const item of document.querySelectorAll('.modal .upgrades li')) {
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  item.appendChild(tooltip);
  item.addEventListener('contextmenu', event => event.preventDefault());
  item.addEventListener('mousedown', event => {
    const [image, span] = event.currentTarget.childNodes;
    const upgrade = Object.keys(upgradeData).find(key => upgradeData[key]['name'] === image.alt);
    const step = event.shiftKey ? 3 : 1;
    let upgradeValue = +span.innerText;
    if (event.button === 0) {
      upgradeValue = Math.min(upgradeValue + step, upgradeData[upgrade]['effects'].length - 1);
    } else if (event.button === 2) {
      upgradeValue = Math.max(upgradeValue - step, 0);
    }
    span.innerText = upgradeValue;
    tooltips.updateUpgrade(item.querySelector('.tooltip'), upgrade, upgradeValue);
    for (const territory of getSelected()) {
      territory.upgrades[upgrade] = upgradeValue;
      territory.update();
    }
  });
}

function createModal(modalWrapperTag, callbackOnClose = () => void 0) {
  const modal = document.querySelector(modalWrapperTag);

  modal.querySelector('.close').addEventListener('click', exitModal);
  modal.addEventListener('click', event => {
    if (event.target === modal) {
      exitModal();
    }
  });

  function exitModal() {
    modal.classList.add('fade-out');
    setTimeout(() => {
      modal.style.display = 'none';
      modal.classList.remove('fade-out');
    }, 350);
    callbackOnClose();
  }

  return () => {
    modal.style.display = 'block';
    modal.classList.add('fade-in');
  };
}

document.querySelector('#resetTerrs').addEventListener('click', () => {
  if (!confirm('Warning!\nThis will reset the upgrades for all selected territories.')) {
    return;
  }
  for (const territory of getSelected()) {
    for (const upgrade of Object.keys(territory.upgrades)) {
      territory.upgrades[upgrade] = 0;
    }
    territory.update();
    tooltips.updateTerritory(territory);
  }
  tooltips.sortTerritories();
  updateTotal();
  updateLocalStorage();
  clearSelection();
});

document.querySelector('#removeTerrs').addEventListener('click', () => {
  if (!confirm('Warning!\nThis will remove all selected territories.')) {
    return;
  }
  let hqRemoved = false;
  for (const territoryName of selection) {
    delete territories[territoryName];
    tooltips.removeTerritory(territoryName);
    availableTerritories.push(territoryName);
    if (territoryName === hq) {
      hqRemoved = true;
    } else if (hqDistances[territoryName] <= 3 && !hqRemoved) {
      territories[hq].hqBonus -= 0.25;
      tooltips.updateTerritoryStats(territories[hq]);
    }
    for (const connection of territoryData[territoryName].connections) {
      if (connection in territories) {
        territories[connection].connections--;
        tooltips.updateTerritoryStats(territories[connection]);
      }
    }
  }
  availableTerritories.sort();
  if (hqRemoved) {
    if (Object.keys(territories).length > 0) {
      setHq(Object.keys(territories)[0]);
    } else {
      setHq(null);
    }
  }
  selection.clear();
  renderSelection();
  updateTotal();
  updateLocalStorage();
});

const openTributeModal = createModal('.modal-tributes', () => {
  for (const resource of Object.keys(tributes)) {
    tributes[resource] = +document.querySelector(`#${resource}Tributes`).value;
  }
  localStorage.setItem('tributes', JSON.stringify(tributes));
  updateTotal();
});
document.querySelector('#tributes').addEventListener('click', openTributeModal);

document.querySelector('#setHq').addEventListener('click', () => {
  setHq([...selection][0]);
  clearSelection();
});

function setHq(territoryName) {
  if (territoryName == null) {
    hq = null;
    localStorage.removeItem('hq');
    return;
  }
  const oldHq = hq;
  hq = territoryName;
  localStorage.setItem('hq', hq);
  updateHqDistances();
  const centralTerrs = Object.values(territories).filter(terr => terr.distanceToHq <= 3).length;
  territories[hq].hqBonus = 1.25 + 0.25 * centralTerrs;
  if (oldHq in territories) {
    territories[oldHq].hqBonus = 1;
  }
  for (const territory of Object.values(territories)) {
    territory.distanceToHq = hqDistances[territory.name];
    territory.updateTreasury();
    territory.updateProduction();
    tooltips.updateTerritoryProduction(territory);
    tooltips.updateTerritoryStats(territory);
  }
  tooltips.sortTerritories();
  updateTotal();
}

function updateHqDistances() {
  for (const key of Object.keys(hqDistances)) {
    delete hqDistances[key];
  }
  const queue = [hq];
  hqDistances[hq] = 0;
  while (queue.length > 0) {
    const currentTerritory = queue.shift();
    for (const connection of territoryData[currentTerritory].connections) {
      if (!(connection in hqDistances)) {
        queue.push(connection);
        hqDistances[connection] = hqDistances[currentTerritory] + 1;
      }
    }
  }
}

function setStorages() {
  for (const territory of getSelected()) {
    const isHq = territory.name === hq;
    if (!isHq) {
      territory.upgrades.emeraldStorage = 0;
      territory.upgrades.resourceStorage = 0;
    }
    const minEms = Math.round((territory.costs.emeralds + territory.production.emeralds) / 60);
    const minRes = Math.max(...['ore', 'wood', 'fish', 'crops']
        .map(res => Math.round((territory.costs[res] + territory.production[res]) / 60)));
    while ((isHq ? 5000 : 3000) * upgradeData.emeraldStorage.effects[territory.upgrades.emeraldStorage] < minEms) {
      territory.upgrades.emeraldStorage++;
    }
    while ((isHq ? 1500 : 300) * upgradeData.resourceStorage.effects[territory.upgrades.resourceStorage] < minRes) {
      territory.upgrades.resourceStorage++;
    }
    tooltips.updateTerritory(territory);
  }
  tooltips.sortTerritories();
  updateTotal();
  updateLocalStorage();
  clearSelection();
}
document.querySelector('#setStorages').addEventListener('click', setStorages);

document.querySelector('#loadTreasury').addEventListener('click', event => {
  setTreasury(territories);
  event.target.classList.add('success');
  event.target.disabled = true;
  event.target.innerText = 'Treasury loaded!';
  setTimeout(() => {
    event.target.classList.remove('success');
    event.target.disabled = false;
    event.target.innerText = 'Load from Wynn';
  }, 800);
});
createTreasuryMenu('#globalTreasury', '#globalTreasuryOptions', treasuryValue => {
  setTreasury(territories, treasuryValue);
});
createTreasuryMenu('#selectedTreasury', '#selectedTreasuryOptions', treasuryValue => {
  setTreasury(getSelected(), treasuryValue);
});

function createTreasuryMenu(buttonTag, optionListTag, callback) {
  const button = document.querySelector(buttonTag);
  const optionList = document.querySelector(optionListTag);
  button.addEventListener('click', () => button.classList.toggle('active'));
  optionList.addEventListener('click', event => {
    if (event.target.tagName.toLowerCase() === 'li') {
      callback(Number(event.target.getAttribute('data-value')));
      button.classList.add(event.target.className);
      setTimeout(() => {
        button.classList.remove(event.target.className);
      }, 700);
    }
  });
}

function setTreasury(items, value = null) {
  for (const territory of Object.values(items)) {
    territory.setBaseTreasury(value);
    territory.updateProduction();
    tooltips.updateTerritoryProduction(territory);
  }
  updateTotal();
  updateLocalStorage();
}

document.addEventListener('click', event => {
  for (const element of document.querySelectorAll('.active')) {
    if (event.target !== element) {
      element.classList.remove('active');
    }
  }
});

document.querySelector('#selectAll').addEventListener('click', () => {
  Object.keys(territories).forEach(territoryName => selection.add(territoryName));
  renderSelection();
});

document.querySelector('#selectNone').addEventListener('click', clearSelection);

function getSelected() {
  return [...selection].map(territoryName => territories[territoryName]);
}

function toggleSelected(territoryName) {
  if (!selection.delete(territoryName)) {
    selection.add(territoryName);
  }
  renderSelection();
}

function clearSelection() {
  selection.clear();
  renderSelection();
}

function renderSelection() {
  for (const card of document.querySelectorAll('#cards .tooltip:not(.total)')) {
    card.classList.toggle('selected', selection.has(card.getAttribute('data-name')));
  }
  map.refresh();
  const amount = selection.size;
  for (const element of document.querySelectorAll('[data-value=selection]')) {
    element.innerText = amount > 0 ? `(${amount})` : '';
  }
  document.querySelector('#editTerrs').disabled = amount === 0;
  document.querySelector('#resetTerrs').disabled = amount === 0;
  document.querySelector('#removeTerrs').disabled = amount === 0;
  document.querySelector('#setHq').disabled = amount !== 1;
  document.querySelector('#setStorages').disabled = amount === 0;
  document.querySelector('#selectedTreasury').disabled = amount === 0;
}

document.querySelector('#export').addEventListener('click', () => {
  const anchorElement = document.createElement('a');
  anchorElement.download = 'Economy.json';
  anchorElement.href = 'data:attachment/text,' + encodeURI(JSON.stringify(toJSON()));
  anchorElement.click();
});

function createTerritorySaveObject() {
  const territorySaveObject = {};
  for (const territory of Object.values(territories)) {
    territorySaveObject[territory.name] = {
      treasury: Math.round(territory.baseTreasury * 100) / 100,
      upgrades: Object.entries(territory.upgrades).filter(([, value]) => value > 0)
          .reduce((object, [name, value]) => ({...object, [name]: value}), {}),
    };
  }
  return territorySaveObject;
}

function updateLocalStorage() {
  localStorage.setItem('territories', JSON.stringify(createTerritorySaveObject()));
}

function loadFromLocalStorage() {
  const savedHq = localStorage.getItem('hq');
  const savedTerritories = localStorage.getItem('territories');
  const savedTributes = localStorage.getItem('tributes');
  fromJSON({
    hq: savedHq,
    territories: savedTerritories === null ? {} : JSON.parse(savedTerritories),
    tributes: savedTributes === null ? tributes : JSON.parse(savedTributes),
  });
}

function toJSON() {
  return {hq: hq, territories: createTerritorySaveObject(), tributes: tributes};
}

const fileInput = document.querySelector('#import-file');
document.querySelector('#import').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    if (typeof reader.result === 'string') {
      fromJSON(JSON.parse(reader.result));
    }
  });
  reader.readAsText(fileInput.files[0]);
  fileInput.value = null;
}, false);

function fromJSON(saveObject) {
  if (saveObject === null) {
    loadFromLocalStorage();
    return;
  }
  for (const territoryName of Object.keys(territories)) {
    delete territories[territoryName];
    tooltips.removeTerritory(territoryName);
    availableTerritories.push(territoryName);
  }
  availableTerritories.sort();
  clearSelection();
  tooltips.init();
  setHq(null);
  for (const [territoryName, territoryData] of Object.entries(saveObject.territories)) {
    addTerritory(territoryName, territoryData.treasury);
    for (const [upgradeName, upgradeValue] of Object.entries(territoryData.upgrades)) {
      territories[territoryName].upgrades[upgradeName] = upgradeValue;
    }
    territories[territoryName].update();
  }
  setHq(saveObject.hq);
  Object.entries(saveObject.tributes).forEach(([resource, amount]) => {
    tributes[resource] = amount;
    document.querySelector(`#${resource}Tributes`).value = amount;
  });
  localStorage.setItem('tributes', JSON.stringify(tributes));
  for (const territory of Object.values(territories)) {
    tooltips.updateTerritory(territory);
  }
  tooltips.sortTerritories();
  updateTotal();
  updateLocalStorage();
}

document.querySelector('#share').addEventListener('click', () => {
  fetch(shareUrl, {
    body: JSON.stringify(toJSON()), headers: {'Content-Type': 'text/plain'}, method: 'POST',
  })
      .then(response => response.json())
      .then(data => alert(`${window.location.href.split('?')[0]}?id=${data.id}`));
});

document.querySelector('#clear').addEventListener('click', () => {
  if (confirm('Warning!\nThis is going to reset everything you did on this page.')) {
    localStorage.clear();
    location.reload();
  }
});

document.querySelector('aside footer span').addEventListener('click', createModal('.modal-credit'));

const mapCallbacks = {
  getTerritory: territoryName => territories[territoryName],
  isSelected: territoryName => selection.has(territoryName),
  getHq: () => hq,
  getHqDistance: territoryName => hq === null ? null : hqDistances[territoryName] ?? 'Not connected',
  onToggleSelect: toggleSelected,
  onEdit: editTerritory,
  onAdd: territoryName => addTerritories([territoryName]),
};

function setView(view) {
  document.body.classList.toggle('map-mode', view === 'map');
  document.querySelector('#viewCards').classList.toggle('current', view !== 'map');
  document.querySelector('#viewMap').classList.toggle('current', view === 'map');
  localStorage.setItem('view', view);
  if (view === 'map') {
    map.initMap(document.querySelector('#map'), mapCallbacks);
  }
}

document.querySelector('#viewCards').addEventListener('click', () => setView('cards'));
document.querySelector('#viewMap').addEventListener('click', () => setView('map'));
document.querySelector('#cards').addEventListener('click', event => {
  if (event.target.closest('.total h4')) {
    event.target.closest('.total').classList.toggle('collapsed');
  }
});
setView(localStorage.getItem('view') ?? 'cards');
