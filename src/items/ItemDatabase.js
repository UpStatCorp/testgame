// Item definitions. `type` drives how the hotbar uses the item.
export const ItemType = {
  WEAPON: 'weapon',
  TOOL: 'magic',
  RESOURCE: 'resource',
  CONSUMABLE: 'consumable',
  CURRENCY: 'currency',
};

export const ITEMS = {
  sword: {
    id: 'sword', name: 'Одноручный меч', type: ItemType.WEAPON, stackSize: 1, weapon: 'sword',
    description: 'Надёжный стальной клинок. Быстрые удары, умеренный урон.', stats: 'Урон 22 · Скорость: быстрая',
  },
  greatsword: {
    id: 'greatsword', name: 'Двуручный меч', type: ItemType.WEAPON, stackSize: 1, weapon: 'greatsword',
    description: 'Тяжёлый клинок северных кузнецов. Медленный, но сокрушительный широкий удар.', stats: 'Урон 60 · Скорость: медленная · Широкая дуга',
  },
  staff: {
    id: 'staff', name: 'Жезл телекинеза', type: ItemType.TOOL, stackSize: 1, weapon: 'staff',
    description: 'Древний жезл с кристаллом. Зажмите ЛКМ, чтобы поднять предмет, отпустите — чтобы бросить. Колесо — дистанция, ПКМ — аккуратно опустить.',
    stats: 'Магия · Бросок до 30 м/с',
  },
  stone: {
    id: 'stone', name: 'Камень', type: ItemType.RESOURCE, stackSize: 20, throwable: true,
    description: 'Обычный камень. ЛКМ с камнем в руке — бросить.', stats: 'Метательный',
  },
  wood: {
    id: 'wood', name: 'Древесина', type: ItemType.RESOURCE, stackSize: 50,
    description: 'Крепкие поленья. Пригодятся для строительства и костра.', stats: 'Ресурс',
  },
  potion: {
    id: 'potion', name: 'Зелье лечения', type: ItemType.CONSUMABLE, stackSize: 5, heal: 50,
    description: 'Алый эликсир с горьким привкусом. Мгновенно восстанавливает 50 здоровья.', stats: '+50 HP',
  },
  food: {
    id: 'food', name: 'Жареное мясо', type: ItemType.CONSUMABLE, stackSize: 10, heal: 20, stamina: 40, regen: 12,
    description: 'Сочное мясо с костра. Восстанавливает здоровье со временем и выносливость.', stats: '+20 HP, +12 HP за 10 с, +40 выносливости',
  },
  apple: {
    id: 'apple', name: 'Яблоко', type: ItemType.CONSUMABLE, stackSize: 20, heal: 8, stamina: 20,
    description: 'Хрустящее лесное яблоко.', stats: '+8 HP, +20 выносливости',
  },
  coin: {
    id: 'coin', name: 'Монета', type: ItemType.CURRENCY, stackSize: 999,
    description: 'Старая золотая монета с руной. Ценится у торговцев.', stats: 'Валюта',
  },
};

export function getItem(id) {
  return ITEMS[id];
}
