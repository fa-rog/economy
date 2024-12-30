import upgradeData from '../data/upgrades.js';

const colors = {
  'emeralds': 'green',
  'ore': 'white',
  'wood': 'gold',
  'fish': 'aqua',
  'crops': 'yellow',
  'Very Low': 'green',
  'Low': 'green',
  'Medium': 'yellow',
  'High': 'red',
  'Very High': 'red',
};
const mainElement = document.querySelector('main');
const resources = ['emeralds', 'ore', 'wood', 'fish', 'crops'];

export function init() {
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip total';
  const title = document.createElement('h4');
  title.innerText = 'Guild Output';
  tooltip.appendChild(title);
  const subtitle = document.createElement('span');
  subtitle.className = 'gray';
  subtitle.innerText = 'Total resource output and overall costs';
  tooltip.appendChild(subtitle);
  tooltip.appendChild(document.createElement('br'));
  tooltip.appendChild(document.createElement('br'));
  const productionSection = document.createElement('section');
  productionSection.setAttribute('data-type', 'production');
  tooltip.appendChild(productionSection);
  tooltip.appendChild(document.createElement('br'));
  const costSpan = document.createElement('span');
  costSpan.className = 'green';
  costSpan.innerText = 'Overall Cost (per hour):';
  tooltip.appendChild(costSpan);
  const costSection = document.createElement('section');
  costSection.setAttribute('data-type', 'costs');
  tooltip.appendChild(costSection);
  mainElement.replaceChildren(tooltip);
}

export function updateTotal(territories, tributes) {
  updateTotalProduction(territories, tributes);
  updateTotalCosts(territories, tributes);
}

function updateTotalProduction(territories, tributes) {
  const lines = [];
  for (const resource of resources) {
    const color = colors[resource];
    const production = Object.values(territories)
        .reduce((sum, terr) => sum + terr.production[resource],
            tributes[resource] > 0 ? tributes[resource] : 0);
    const line = createResourceImageLine(resource);
    line.appendChild(createSpan(`+${round(production)} ${capitalize(resource)} per Hour`, color));
    lines.push(line);
    if (tributes[resource] > 0) {
      const tributeLine = createResourceImageLine(resource);
      tributeLine.appendChild(createSpan(`(${tributes[resource]} from Tributes)`, color));
      lines.push(tributeLine);
    }
  }
  document.querySelector(`.total [data-type="production"]`).replaceChildren(...lines);
}

function updateTotalCosts(territories, tributes) {
  const lines = [];
  for (const resource of resources) {
    const cost = Object.values(territories)
        .reduce((sum, terr) => sum + terr.costs[resource],
            tributes[resource] < 0 ? -tributes[resource] : 0);
    const production = Object.values(territories)
        .reduce((sum, terr) => sum + terr.production[resource],
            tributes[resource] > 0 ? tributes[resource] : 0);
    const line = document.createElement('p');
    line.appendChild(createSpan('- ', 'green'));
    if (resource !== 'emeralds') {
      const image = document.createElement('img');
      image.alt = '';
      image.src = `assets/img/resources/${resource}_gray.png`;
      line.appendChild(image);
      line.appendChild(createSpan(' '));
    }
    line.appendChild(createSpan(`${format(cost)} ${capitalize(resource)} `, 'gray'));
    const difference = round(production - cost);
    if (difference >= 0) {
      line.appendChild(createSpan(`(+${format(difference)}) `, 'blue'));
    } else {
      line.appendChild(createSpan(`(${format(difference)}) `, 'red'));
    }
    if (production > 0) {
      const percentage = Math.floor(100 * cost / production);
      line.appendChild(createSpan(`(${percentage}%)`, percentage > 100 ? 'red' : 'dark-gray'));
    } else {
      line.appendChild(createSpan('(No output)', 'dark-red'));
    }
    lines.push(line);
  }
  document.querySelector(`.total [data-type="costs"]`).replaceChildren(...lines);
}

export function addTerritory(territory) {
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.setAttribute('data-name', territory.name);
  tooltip.appendChild(document.createElement('h4'));
  tooltip.appendChild(document.createElement('br'));
  const productionSection = document.createElement('section');
  productionSection.setAttribute('data-type', 'production');
  tooltip.appendChild(productionSection);
  tooltip.appendChild(document.createElement('br'));
  const upgradesSection = document.createElement('section');
  upgradesSection.setAttribute('data-type', 'upgrades');
  tooltip.appendChild(upgradesSection);
  tooltip.appendChild(document.createElement('br'));
  const statsSection = document.createElement('section');
  statsSection.setAttribute('data-type', 'stats');
  tooltip.appendChild(statsSection);
  mainElement.appendChild(tooltip);
  updateTerritory(territory);
  return tooltip;
}

export function removeTerritory(territoryName) {
  document.querySelector(`[data-name="${territoryName}"]`).remove();
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function round(number, digits = 0) {
  return Math.round(number * (10 ** digits)) / (10 ** digits);
}

function format(number) {
  const tier = Math.log10(Math.abs(number)) / 3 | 0;
  return round(number / (10 ** (3 * tier)), 2) + ['', 'k', 'M', 'G'][tier];
}

function createSpan(text, color) {
  const span = document.createElement('span');
  if (color !== undefined) {
    span.className = color;
  }
  span.innerText = text;
  return span;
}

function createResourceImageLine(resource) {
  const line = document.createElement('p');
  if (resource !== 'emeralds') {
    const image = document.createElement('img');
    image.alt = '';
    image.src = `assets/img/resources/${resource}.png`;
    line.appendChild(image);
    line.appendChild(createSpan(' '));
  }
  return line;
}

export function updateTerritory(territory) {
  updateTerritoryProduction(territory);
  updateTerritoryUpgrades(territory);
  updateTerritoryStats(territory);
}

export function updateTerritoryProduction(territory) {
  const lines = [];
  for (const [resource, production] of Object.entries(territory.production)) {
    if (production > 0) {
      const color = colors[resource];
      const line = createResourceImageLine(resource);
      line.appendChild(createSpan(`+${round(production)} ${capitalize(resource)} per Hour`, color));
      lines.push(line);
    }
  }
  if (territory.treasuryBonus > 1) {
    lines.push(document.createElement('br'));
    const treasuryLine = document.createElement('p');
    treasuryLine.appendChild(createSpan('✦ Treasury Bonus: ', 'light-purple'));
    treasuryLine.appendChild(createSpan(`${round(100 * (territory.treasuryBonus - 1), 2)}%`));
    lines.push(treasuryLine);
  }
  document.querySelector(`[data-name="${territory.name}"] [data-type="production"]`)
      .replaceChildren(...lines);
}

function updateTerritoryUpgrades(territory) {
  const lines = [];
  if (Object.values(territory.upgrades).some(value => value > 0)) {
    const heading = document.createElement('p');
    heading.appendChild(createSpan('Upgrades:', 'light-purple'));
    lines.push(heading);
    for (const [upgrade, level] of Object.entries(territory.upgrades)) {
      if (level > 0) {
        const line = document.createElement('p');
        line.appendChild(createSpan('- ', 'light-purple'));
        line.appendChild(createSpan(upgradeData[upgrade].name, 'gray'));
        line.appendChild(createSpan(` [Lv. ${level}]`, 'dark-gray'));
        lines.push(line);
      }
    }
  } else {
    const text = document.createElement('p');
    text.appendChild(createSpan('No upgrades active', 'gray'));
    lines.push(text);
  }
  document.querySelector(`[data-name="${territory.name}"] [data-type="upgrades"]`)
      .replaceChildren(...lines);
}

export function updateTerritoryStats(territory) {
  const title = document.querySelector(`[data-name="${territory.name}"] h4`);
  title.innerText = territory.name;
  if (territory.distanceToHq === 0) {
    title.innerText += ' (HQ)';
  } else if (territory.distanceToHq === 1) {
    title.innerText += ' (Conn)';
  } else if (territory.distanceToHq <= 3) {
    title.innerText += ' (Ext)';
  }
  const lines = [];
  const difficulty = territory.difficulty;
  const heading = document.createElement('p');
  heading.appendChild(createSpan('Total Stats (', 'light-purple'));
  heading.appendChild(createSpan(difficulty, colors[difficulty]));
  heading.appendChild(createSpan('):', 'light-purple'));
  lines.push(heading);
  let upgradeFactor = territory.connectionBonus * territory.hqBonus;
  const damage = 1000 * upgradeData.damage.effects[territory.upgrades['damage']] * upgradeFactor;
  const damageLine = document.createElement('p');
  damageLine.appendChild(createSpan('- ', 'light-purple'));
  damageLine.appendChild(createSpan(`Damage: ${round(damage)} – ${round(1.5 * damage)}`, 'gray'));
  lines.push(damageLine);
  const attack = 0.5 * upgradeData.attack.effects[territory.upgrades['attack']];
  const attackLine = document.createElement('p');
  attackLine.appendChild(createSpan('- ', 'light-purple'));
  attackLine.appendChild(createSpan(`Attacks per Second: ${attack.toFixed(1)}`, 'gray'));
  lines.push(attackLine);
  const health = 300000 * upgradeData.health.effects[territory.upgrades['health']] * upgradeFactor;
  const healthLine = document.createElement('p');
  healthLine.appendChild(createSpan('- ', 'light-purple'));
  healthLine.appendChild(createSpan(`Health: ${round(health)}`, 'gray'));
  lines.push(healthLine);
  const defence = 10 * upgradeData.defence.effects[territory.upgrades['defence']];
  const defenceLine = document.createElement('p');
  defenceLine.appendChild(createSpan('- ', 'light-purple'));
  defenceLine.appendChild(createSpan(`Defence: ${defence.toFixed(1)}%`, 'gray'));
  lines.push(defenceLine);
  document.querySelector(`[data-name="${territory.name}"] [data-type="stats"]`)
      .replaceChildren(...lines);
}

export function sortTerritories() {
  Array.from(mainElement.querySelectorAll('.tooltip:not(.total)'))
      .sort((...tooltips) => tooltips
          .map(tooltip => tooltip.innerText.includes('HQ') ? 100 :
              tooltip.querySelectorAll('[data-type="upgrades"] p').length)
          .reduce((first, second) => second - first))
      .forEach(tooltip => mainElement.appendChild(tooltip));
}