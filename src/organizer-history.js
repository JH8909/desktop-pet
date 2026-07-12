const path = require('path');

async function restoreBatch(items, dependencies) {
  const restored = [];
  const errors = [];
  const remainingItems = [];

  for (const item of [...items].reverse()) {
    try {
      if (item.deleted) {
        await dependencies.ensureDir(item.source);
        restored.push({ source: '(已删除空文件夹)', target: item.source });
        continue;
      }
      if (!(await dependencies.exists(item.target))) {
        throw new Error('撤销目标不存在，已保留记录');
      }
      const dest = await dependencies.uniquePath(item.source);
      await dependencies.ensureDir(path.dirname(dest));
      await dependencies.moveItem(item.target, dest);
      restored.push({ source: item.target, target: dest });
    } catch (err) {
      errors.push({ item, message: err.message });
      remainingItems.push(item);
    }
  }

  return { restored, errors, remainingItems: remainingItems.reverse() };
}

function buildNextBatch(previousBatch, movedItems, options = {}) {
  const reason = options.reason || 'organize';
  const items = Array.isArray(movedItems) ? movedItems : [];
  const previousItems = previousBatch && Array.isArray(previousBatch.items) ? previousBatch.items : [];
  const shouldAppend = reason === 'drop' && previousBatch?.reason === 'drop';

  return {
    time: Date.now(),
    reason,
    items: shouldAppend ? [...previousItems, ...items] : items
  };
}

module.exports = { restoreBatch, buildNextBatch };
