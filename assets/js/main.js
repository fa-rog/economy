import territoryData from '../data/territories.json' assert {type: 'json'};
import upgradeData from '../data/upgrades.json' assert {type: 'json'};
import {Territory} from './territory.js';
import * as tooltips from './tooltips.js';

const shareUrl = 'https://script.google.com/macros/s/AKfycbydJgjEt2H-aSjr5_QenG5x4dBisHNXGNp4jhIjffLIRZ1joAGWzVYTkOXezrLLZDzI/exec';

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('id')) {
  fetch(`${shareUrl}?id=${urlParams.get('id')}`)
      .then(response => response.json())
      .then(data => fromJSON(data.data));
  window.history.replaceState({}, document.title, window.location.href.split('?')[0]);
}

let apiData;
const guilds = new Set();
fetch('https://api.wynncraft.com/public_api.php?action=territoryList')
    .then(response => response.json())
    .then(data => {
      apiData = data['territories'];
      Object.values(apiData).forEach(territory => guilds.add(territory['guild']));
      Object.values(apiData).forEach(territory => guilds.add(territory['guildPrefix']));
    });

const availableTerritories = Object.keys(territoryData);
let hq = null;
const hqDistances = {};
const territories = {};
const tributes = {'emeralds': 0, 'ore': 0, 'wood': 0, 'fish': 0, 'crops': 0};
for (const [resource, amount] of Object.entries(tributes)) {
  document.querySelector(`#${resource}Tributes`).value = amount;
}
tooltips.init();
tooltips.updateTotal(territories, tributes);

createInputMenu('#loadTerritories', '#loadTerritoriesResults', guilds, guild => {
  let counter = 0;
  for (const territory of Object.values(apiData)) {
    if ((guild === territory['guild'] || guild === territory['guildPrefix']) &&
        !(territory['territory'] in territories)) {
      addTerritory(territory['territory']);
      counter++;
    }
  }
  tooltips.sortTerritories();
  tooltips.updateTotal(territories, tributes);
  return `Added ${counter}!`;
});

createInputMenu('#addTerritory', '#addTerritoryResults', availableTerritories, territoryName => {
  addTerritory(territoryName);
  tooltips.sortTerritories();
  tooltips.updateTotal(territories, tributes);
  return 'Added!';
});

function createInputMenu(inputTag, resultListTag, items, callback) {
  const input = document.querySelector(inputTag);
  const resultList = document.querySelector(resultListTag);
  input.addEventListener('input', () => {
    const choices = createMatchingList(items, input.value);
    resultList.replaceChildren(...choices);
    input.className = choices.length > 0 ? 'active' : '';
  });
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

function addTerritory(territoryName) {
  availableTerritories.splice(availableTerritories.indexOf(territoryName), 1);
  territories[territoryName] = new Territory(territoryName,
      territoryData[territoryName].connections.filter(conn => conn in territories).length,
      territoryData[territoryName]['resources'], apiData[territoryName]['acquired'],
      hqDistances[territoryName]);
  tooltips.addTerritory(territories[territoryName]).addEventListener('click', event => {
    event.currentTarget.classList.toggle('selected');
    updateSelection();
  });
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
  for (const selected of document.querySelectorAll('.selected')) {
    const territory = territories[selected.getAttribute('data-name')];
    tooltips.updateTerritory(territory);
  }
  tooltips.sortTerritories();
  tooltips.updateTotal(territories, tributes);
  setTimeout(clearSelection, 100);
});

document.querySelector('#editTerrs').addEventListener('click', () => {
  const selectedTerritories = [...document.querySelectorAll('.selected')];
  const upgradeSpans = document.querySelectorAll('.modal .upgrades span');
  for (const [index, upgrade] of Object.keys(upgradeData).entries()) {
    upgradeSpans[index].innerText = Math.min(...selectedTerritories.map(selected => {
      return territories[selected.getAttribute('data-name')].upgrades[upgrade];
    }));
  }
  openEditModal();
});

for (const item of document.querySelectorAll('.modal .upgrades li')) {
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
    for (const selected of document.querySelectorAll('.selected')) {
      const territory = territories[selected.getAttribute('data-name')];
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
  for (const selected of document.querySelectorAll('.selected')) {
    const territory = territories[selected.getAttribute('data-name')];
    for (const upgrade of Object.keys(territory.upgrades)) {
      territory.upgrades[upgrade] = 0;
    }
    territory.update();
    tooltips.updateTerritory(territory);
  }
  tooltips.sortTerritories();
  tooltips.updateTotal(territories, tributes);
  clearSelection();
});

document.querySelector('#removeTerrs').addEventListener('click', () => {
  let hqRemoved = false;
  for (const selected of document.querySelectorAll('.selected')) {
    const territoryName = selected.getAttribute('data-name');
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
  if (hqRemoved) {
    if (Object.keys(territories).length > 0) {
      setHq(Object.keys(territories)[0]);
    } else {
      setHq(null);
    }
  }
  updateSelection();
  tooltips.updateTotal(territories, tributes);
});

const openTributeModal = createModal('.modal-tributes', () => {
  for (const resource of Object.keys(tributes)) {
    tributes[resource] = +document.querySelector(`#${resource}Tributes`).value;
  }
  tooltips.updateTotal(territories, tributes);
});
document.querySelector('#tributes').addEventListener('click', openTributeModal);

document.querySelector('#setHq').addEventListener('click', () => {
  setHq(document.querySelector('.selected').getAttribute('data-name'));
  clearSelection();
});

function setHq(territoryName) {
  if (territoryName == null) {
    hq = null;
    return;
  }
  const oldHq = hq;
  hq = territoryName;
  updateHqDistances();
  for (const territory of Object.values(territories)) {
    territory.distanceToHq = hqDistances[territory.name];
    territory.updateTreasury();
    territory.updateProduction();
    tooltips.updateTerritoryProduction(territory);
  }
  if (oldHq in territories) {
    territories[oldHq].hqBonus = 1;
    tooltips.updateTerritoryStats(territories[oldHq]);
  }
  const centralTerrs = Object.values(territories).filter(terr => terr.distanceToHq <= 3).length;
  territories[hq].hqBonus = 1.25 + 0.25 * centralTerrs;
  tooltips.updateTerritoryStats(territories[hq]);
  tooltips.sortTerritories();
  tooltips.updateTotal(territories, tributes);
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
  setTreasury(document.querySelectorAll('.selected'), treasuryValue);
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
  for (const item of Object.values(items)) {
    const territory = item instanceof Element ? territories[item.getAttribute('data-name')] : item;
    territory.updateTreasury(value);
    territory.updateProduction();
    tooltips.updateTerritoryProduction(territory);
  }
  tooltips.updateTotal(territories, tributes);
}

document.addEventListener('click', event => {
  for (const element of document.querySelectorAll('.active')) {
    if (event.target !== element) {
      element.classList.remove('active');
    }
  }
});

document.querySelector('#selectAll').addEventListener('click', () => {
  for (const tooltip of document.querySelectorAll('.tooltip:not(.total)')) {
    tooltip.className = 'tooltip selected';
  }
  updateSelection();
});

document.querySelector('#selectNone').addEventListener('click', clearSelection);

function clearSelection() {
  for (const tooltip of document.querySelectorAll('.tooltip:not(.total)')) {
    tooltip.className = 'tooltip';
  }
  updateSelection();
}

function updateSelection() {
  const amount = document.querySelectorAll('.selected').length;
  for (const element of document.querySelectorAll('[data-value=selection]')) {
    element.innerText = amount > 0 ? `(${amount})` : '';
  }
  document.querySelector('#editTerrs').disabled = amount === 0;
  document.querySelector('#resetTerrs').disabled = amount === 0;
  document.querySelector('#removeTerrs').disabled = amount === 0;
  document.querySelector('#setHq').disabled = amount !== 1;
  document.querySelector('#selectedTreasury').disabled = amount === 0;
}

document.querySelector('#export').addEventListener('click', () => {
  const anchorElement = document.createElement('a');
  anchorElement.download = 'Economy.json';
  anchorElement.href = 'data:attachment/text,' + encodeURI(JSON.stringify(toJSON()));
  anchorElement.click();
});

function toJSON() {
  const exportObject = {hq: hq, territories: {}};
  for (const territory of Object.values(territories)) {
    exportObject.territories[territory.name] = {
      treasury: Math.round((territory.treasuryBonus - 1) * 100) / 100,
      upgrades: Object.entries(territory.upgrades).filter(([, value]) => value > 0)
          .reduce((object, [name, value]) => ({...object, [name]: value}), {}),
    };
  }
  return exportObject;
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
  for (const territoryName of Object.keys(territories)) {
    delete territories[territoryName];
    tooltips.removeTerritory(territoryName);
    availableTerritories.push(territoryName);
  }
  setHq(null);
  for (const [territoryName, territoryData] of Object.entries(saveObject.territories)) {
    addTerritory(territoryName);
    territories[territoryName].treasuryBonus = territoryData.treasury;
    for (const [upgradeName, upgradeValue] of Object.entries(territoryData.upgrades)) {
      territories[territoryName].upgrades[upgradeName] = upgradeValue;
    }
    territories[territoryName].update();
  }
  setHq(saveObject.hq);
  for (const territory of Object.values(territories)) {
    tooltips.updateTerritory(territory);
  }
  tooltips.sortTerritories();
  tooltips.updateTotal(territories, tributes);
}

document.querySelector('#share').addEventListener('click', () => {
  fetch(shareUrl, {
    body: JSON.stringify({data: toJSON()}), headers: {'Content-Type': 'text/plain'}, method: 'POST',
  })
      .then(response => response.json())
      .then(data => alert(`${window.location.href.split('?')[0]}?id=${data.id}`));
});

document.querySelector('aside footer span').addEventListener('click', createModal('.modal-credit'));