import upgradeData from '../data/upgrades.js';

export class Territory {
  constructor(name, connections, resources, acquired, hqDistance, baseTreasury) {
    this.name = name;
    this.connections = connections;
    this.resources = resources;
    this.acquired = acquired === null ? new Date() : new Date(acquired);
    this.distanceToHq = hqDistance;
    this.hqBonus = 1;
    this.costs = {};
    this.production = {};
    this.upgrades = Object.keys(upgradeData).reduce((object, key) => ({...object, [key]: 0}), {});
    this.setBaseTreasury(baseTreasury);
    this.update();
  }

  get connectionBonus() {
    return 1 + 0.3 * this.connections;
  }

  get difficulty() {
    let num = ['damage', 'attack', 'health', 'defence', 'aura', 'volley']
        .map(upgrade => this.upgrades[upgrade]).reduce((sum, value) => sum + value, 0);
    num += 5 * (this.upgrades['aura'] > 0) + 3 * (this.upgrades['volley'] > 0);
    const tier = (num >= 6) + (num >= 19) + (num >= 31) + (num >= 49) + (this.distanceToHq === 0);
    return ['Very Low', 'Low', 'Medium', 'High', 'Very High'][Math.min(tier, 4)];
  }

  setBaseTreasury(value) {
    if (value === null) {
      const hoursHeld = (new Date() - this.acquired) / 3600000;
      if (hoursHeld >= 24 * 12) {
        this.baseTreasury = 0.3;
      } else if (hoursHeld >= 24 * 5) {
        this.baseTreasury = 0.25;
      } else if (hoursHeld >= 24) {
        this.baseTreasury = 0.2;
      } else if (hoursHeld >= 1) {
        this.baseTreasury = 0.1;
      } else {
        this.baseTreasury = 0;
      }
    } else {
      this.baseTreasury = value;
    }
    this.updateTreasury();
  }

  updateTreasury() {
    this.treasuryBonus =
        1 + this.baseTreasury * Math.min(1, Math.max(0.4, 1.3 - 0.15 * this.distanceToHq));
  }

  update() {
    this.updateCosts();
    this.updateProduction();
  }

  updateCosts() {
    for (const resource of Object.keys(this.resources)) {
      this.costs[resource] = Object.entries(upgradeData)
          .filter(([, upgrade]) => upgrade['resource'] === resource)
          .map(([name, upgrade]) => upgrade.costs[this.upgrades[name]])
          .reduce((sum, cost) => sum + cost, 0);
    }
  }

  updateProduction() {
    const emeraldFactor = upgradeData.efficientEmeralds.effects[this.upgrades.efficientEmeralds] *
        4 / upgradeData.emeraldRate.effects[this.upgrades.emeraldRate];
    this.production.emeralds = this.resources.emeralds * emeraldFactor * this.treasuryBonus;
    const resourceFactor = upgradeData.efficientResources.effects[this.upgrades.efficientResources] *
        4 / upgradeData.resourceRate.effects[this.upgrades.resourceRate];
    for (const resource of ['ore', 'wood', 'fish', 'crops']) {
      this.production[resource] = this.resources[resource] * resourceFactor * this.treasuryBonus;
    }
  }

  toString() {
    return this.name;
  };
}