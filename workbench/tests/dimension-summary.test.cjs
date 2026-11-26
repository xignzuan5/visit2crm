// Run after npm run build:server.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  summarize,
} = require('../dist/server/modules/persona/dimension-summary.js');

function visit(id, buyer, champion) {
  const fields = {};
  const turns = [];
  for (const [key, quote] of Object.entries({
    economic_buyer: buyer,
    champion,
  })) {
    if (!quote) continue;
    turns.push({ role: '客户', text: quote });
    fields[key] = { known: true, summary: quote, quote };
  }
  return { id, dealId: 'deal', date: '2026-11-25', title: id, fields, turns };
}
function coverage(visits) {
  return summarize(
    {
      asOf: '2026-11-25',
      sellers: [{ id: 's', name: '虚构销售' }],
      deals: [{ id: 'deal', sellerId: 's', company: '虚构公司' }],
      visits,
    },
    30,
  ).dimensions[1];
}

test('仅有前提且缺少后续的拜访进入缺口与建议', () => {
  const d = coverage([
    visit('a', '预算由副总签字。', '我会带业务组试用。'),
    visit('b', '', '我来牵头推进。'),
    visit('c', '财务总监最后定。', ''),
    visit('d', '', ''),
  ]);
  assert.deepEqual(d.gaps.visitIds, ['b']);
  assert.deepEqual(d.advice.visitIds, ['b']);
  assert.deepEqual(d.strengths.visitIds, ['a', 'b']);
  assert.deepEqual(d.unaddressed.visitIds, ['c', 'd']);
  for (const subset of [
    [],
    [visit('c', '财务总监最后定。', '')],
    [visit('a', '预算由副总签字。', '我会带业务组试用。')],
  ]) {
    assert.deepEqual(coverage(subset).advice.visitIds, []);
  }
});

test('同一模板替换部门或标点只保留一句，后续候选仍可入选', () => {
  const d = coverage([
    visit('a', '预算由分管交付的副总签，只有他能调这笔钱。', ''),
    visit('b', '预算由分管仓务的副总签，只有他能调这笔钱！', ''),
    visit('c', '财务负责人会在周五审批会上决定是否拨款。', ''),
    visit('d', '', '我来安排夜班试用，再把结果带到会上。'),
  ]);
  assert.equal(
    d.quotes.filter((q) => q.text.includes('只有他能调这笔钱')).length,
    1,
  );
  assert.equal(d.quotes.length, 3);
});
