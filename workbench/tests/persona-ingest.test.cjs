// Run after npm run build:server.
const test = require('node:test');
const assert = require('node:assert/strict');
const { ingest } = require('../dist/server/modules/persona/ingest.js');
const { fieldNames } = require('../dist/shared/persona.js');

function fixture() {
  const fields = Object.fromEntries(
    Object.keys(fieldNames).map((k) => [
      k,
      { known: false, summary: '', quote: '' },
    ]),
  );
  fields.competition = { known: true, summary: '有替代方案', quote: '旧工具' };
  const turns = [
    { role: '客户', text: '我们还在用旧工具。' },
    { role: '销售', text: '这份样本可以对比。', signal: 'comparison' },
    { role: '客户', text: '如何校验？', signal: 'technical_question' },
    { role: '销售', text: '用样本复核差异。', signal: 'technical_answer' },
    { role: '客户', text: '跑过了，结果一致。', signal: 'validated' },
    { role: '客户', text: '明天再试一次。', signal: 'next' },
  ];
  return {
    id: 'v',
    dealId: 'd',
    title: '虚构复盘',
    date: '2026-11-26',
    fields,
    turns,
  };
}
function store() {
  const saved = { sellers: new Map(), deals: new Map(), visits: new Map() };
  function save(collection, row) {
    if (row.sellerId && !saved.sellers.has(row.sellerId))
      return 'missingParent';
    if (row.dealId && !saved.deals.has(row.dealId)) return 'missingParent';
    const map = saved[collection],
      value = JSON.stringify(row);
    if (map.get(row.id) === value) return 'unchanged';
    map.set(row.id, value);
    return 'written';
  }
  return {
    saved,
    writer: Object.fromEntries(
      Object.keys(saved).map((k) => [k, (row) => save(k, row)]),
    ),
  };
}
const parents = {
  sellers: [{ id: 's', name: '虚构销售' }],
  deals: [
    {
      id: 'd',
      sellerId: 's',
      company: '虚构公司',
      stage: '验证',
      outcome: '在跟',
    },
  ],
};
test('同批关联、重复写入和按编号更新', async () => {
  const db = store(),
    v = fixture(),
    batch = { ...parents, visits: [v] };
  assert.equal((await ingest(batch, db.writer)).written.length, 3);
  assert.equal(
    (await ingest(batch, db.writer)).skipped.filter(
      (s) => s.reason === '内容相同',
    ).length,
    3,
  );
  assert.equal(
    (await ingest({ visits: [{ ...v, title: '已修订' }] }, db.writer)).written
      .length,
    1,
  );
  assert.equal(db.saved.visits.size, 1);
  assert.equal(JSON.parse(db.saved.visits.get('v')).title, '已修订');
});
test('逐条拒绝引文、缺字段、错角色和未知标注，保留有效兄弟记录', async () => {
  const v = fixture(),
    db = store();
  const visits = [
    null,
    {
      ...v,
      id: 'quote',
      fields: {
        ...v.fields,
        competition: {
          known: true,
          summary: '比较',
          quote: '这份样本可以对比。',
        },
      },
    },
    { ...v, id: 'fields', fields: {} },
    { ...v, id: 'role', turns: [{ role: '旁白', text: '说明' }] },
    {
      ...v,
      id: 'signal',
      turns: [{ role: '客户', text: '继续', signal: 'unknown' }],
    },
    v,
  ];
  const r = await ingest({ ...parents, visits }, db.writer);
  assert.deepEqual(
    r.skipped.map((x) => x.index),
    [0, 1, 2, 3, 4],
  );
  for (const [i, field] of [
    '记录',
    'fields.competition.quote',
    'fields',
    'turns.0.role',
    'turns.0.signal',
  ].entries())
    assert.ok(r.skipped[i].reason.includes(field));
  assert.deepEqual([...db.saved.visits.keys()], ['v']);
});
test('标注逐项检查角色和紧邻发言，竞争引文取首次定位', async () => {
  for (const [at, mutate] of [
    [1, (v) => v.turns.splice(1, 0, { role: '客户', text: '旧工具' })],
    [1, (v) => (v.turns[1].role = '客户')],
    [2, (v) => (v.turns[2].role = '销售')],
    [3, (v) => delete v.turns[2].signal],
    [3, (v) => (v.turns[3].role = '客户')],
    [4, (v) => delete v.turns[3].signal],
    [4, (v) => (v.turns[4].role = '销售')],
    [5, (v) => (v.turns[5].role = '销售')],
  ]) {
    const db = store(),
      v = fixture();
    mutate(v);
    const r = await ingest({ ...parents, visits: [v] }, db.writer);
    assert.match(r.skipped[0].reason, /turns\.\d+\.signal/, String(at));
    assert.equal(db.saved.visits.size, 0);
  }
});
test('缺商机、引用无效销售都能定位，其他商机和拜访可以继续', async () => {
  const db = store(),
    v = fixture();
  const r = await ingest(
    {
      ...parents,
      deals: [
        { ...parents.deals[0], id: 'other', sellerId: 'missing' },
        ...parents.deals,
      ],
      visits: [{ ...v, id: 'invalid', dealId: 'other' }, v],
    },
    db.writer,
  );
  assert.deepEqual(
    r.skipped.map((s) => s.id),
    ['other', 'invalid'],
  );
  assert.match(r.skipped[0].reason, /sellerId/);
  assert.match(r.skipped[1].reason, /dealId/);
  assert.deepEqual(
    r.written.map((s) => s.id),
    ['s', 'd', 'v'],
  );
});
