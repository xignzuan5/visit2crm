import React, { useState } from 'react';
import { ArrowRight, ArrowUpRight, FileSearch, ScanSearch } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar } from './Board';
import { VisitDetail } from './Person';
import { recommend, stages, type Order, type Profile } from './model';
import type { Visit } from '../../../shared/persona';

const blank = {
  industry: '',
  amount: '',
  size: '',
  stage: '',
  competitor: '',
  need: '',
};
export function Dispatch({
  profiles,
  real,
}: {
  profiles: Profile[];
  real: boolean;
}) {
  const [form, setForm] = useState(blank),
    [order, setOrder] = useState<Order | null>(null),
    [visit, setVisit] = useState<{ v: Visit; company: string } | null>(null);
  const industries = [
    ...new Set(
      profiles.flatMap((p) =>
        p.deals.flatMap((d) => (d.industry ? [d.industry] : [])),
      ),
    ),
  ].sort();
  const rivals = [
    ...new Set(
      profiles.flatMap((p) =>
        p.deals.flatMap((d) => (d.competitor ? [d.competitor] : [])),
      ),
    ),
  ].sort();
  const results = order ? recommend(profiles, order) : [];
  const change = (key: keyof typeof blank, value: string) => {
    setForm({ ...form, [key]: value });
    setOrder(null);
  };
  const select = (
    label: string,
    key: 'industry' | 'size' | 'stage',
    values: readonly string[],
  ) => (
    <label>
      {label}
      <select
        required={!real || key === 'stage'}
        value={form[key]}
        onChange={(e) => change(key, e.target.value)}
      >
        <option value="">{real && key === 'size' ? '未填' : '请选择'}</option>
        {values.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <div className="pagehead">
        <div>
          <h1>派单推荐</h1>
          <p>描述新商机，查看适合跟进的销售及其拜访和成交依据。</p>
        </div>
      </div>
      <div className="dispatchgrid">
        <form
          className="panel orderform"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.need.trim())
              setOrder({
                ...form,
                industry: form.industry.trim(),
                need: form.need.trim(),
                amount: form.amount ? Number(form.amount) : null,
              });
          }}
        >
          <div className="formhead">
            <h2>新商机</h2>
            <button
              className="textbtn"
              type="button"
              onClick={() => {
                setForm({
                  industry: '智能制造',
                  amount: '85',
                  size: '中型',
                  stage: '方案验证',
                  competitor: '砾帆方案',
                  need: '希望产线断网时仍能保留批次追溯记录',
                });
                setOrder(null);
              }}
            >
              填入示例
            </button>
          </div>
          <div className="formfields">
            <label>
              所属行业
              <input
                required={!real}
                list="industries"
                placeholder="选择或输入行业"
                value={form.industry}
                onChange={(e) => change('industry', e.target.value)}
              />
              <datalist id="industries">
                {industries.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </label>
            <label>
              预计金额（万元）
              <input
                type="number"
                required={!real}
                min="0.01"
                step="0.01"
                placeholder="如 85"
                value={form.amount}
                onChange={(e) => change('amount', e.target.value)}
              />
            </label>
            {select('客户规模', 'size', ['小型', '中型', '大型'])}
            {select('当前阶段', 'stage', stages)}
            <label className="full">
              已知竞争对手（选填）
              <input
                list="rivals"
                placeholder="多个名称用顿号分隔"
                value={form.competitor}
                onChange={(e) => change('competitor', e.target.value)}
              />
              <datalist id="rivals">
                {rivals.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </label>
            <label className="full">
              关键需求
              <textarea
                required
                placeholder="客户最想解决什么问题？"
                value={form.need}
                onChange={(e) => change('need', e.target.value)}
                onBlur={(e) => change('need', e.target.value.trim())}
              />
            </label>
          </div>
          <button
            className="solid"
            type="submit"
            disabled={(!real && !form.industry.trim()) || !form.need.trim()}
          >
            <ScanSearch size={17} /> 匹配销售
          </button>
        </form>
        <section className="matches" aria-live="polite">
          <h2>
            推荐人选 {order && <span className="count">{results.length}</span>}
          </h2>
          {!order ? (
            <div className="panel waiting">
              <FileSearch size={34} />
              <h3>等待商机信息</h3>
              <p>填写左侧条件后，这里将显示最多 3 位适合跟进的销售。</p>
            </div>
          ) : results.length === 0 ? (
            <p>现有记录缺少可匹配的依据。</p>
          ) : (
            results.map(({ profile: p, reasons }, i) => {
              const strength = p.axes
                .filter((a) => a.score !== null)
                .sort((a, b) => b.score! - a.score!)[0];
              const precedent = reasons.find((r) => r.deal)?.deal;
              const record = precedent
                ? `有${precedent.industry ?? '行业未填的'}客户${precedent.company}的${precedent.amount == null ? '金额未填的' : precedent.amount + '万元'}${precedent.outcome}记录`
                : reasons[0].label;
              const focus = strength
                ? `${strength.evidence.length}次拜访可回看其${strength.name}的做法`
                : '可展开核对匹配依据';
              return (
                <article className="panel match" key={p.id}>
                  <div className="matchhead">
                    <Avatar p={p} />
                    <div>
                      <small>推荐 {String(i + 1).padStart(2, '0')}</small>
                      <h3>{p.name}</h3>
                    </div>
                    <Link
                      aria-label={'查看' + p.name + '的画像'}
                      to={'/person/' + encodeURIComponent(p.id)}
                    >
                      <ArrowUpRight size={17} />
                    </Link>
                  </div>
                  <p>
                    {record}，{focus}。
                    {strength && (
                      <Link
                        className="textbtn"
                        to={
                          '/person/' +
                          encodeURIComponent(p.id) +
                          '?axis=' +
                          p.axes.indexOf(strength)
                        }
                      >
                        查看该维度
                      </Link>
                    )}
                  </p>
                  <details open={i === 0}>
                    <summary>匹配依据 · {reasons.length} 项</summary>
                    <ul>
                      {reasons.map((r) => (
                        <li key={r.label}>
                          <b>{r.label}</b>
                          {r.deal && (
                            <span>
                              {r.deal.company} · {r.deal.industry ?? '行业未填'}{' '}
                              ·{' '}
                              {r.deal.amount == null
                                ? '金额未填'
                                : r.deal.amount + ' 万'}{' '}
                              · {r.deal.size ?? '规模未填'} · {r.deal.outcome} ·{' '}
                              {r.deal.competitor ?? '竞争对手未填'}
                            </span>
                          )}
                          {r.visit && (
                            <>
                              <span>“{r.quote}”</span>
                              <button
                                className="textbtn"
                                onClick={() =>
                                  setVisit({
                                    v: r.visit!,
                                    company: p.deals.find(
                                      (d) => d.id === r.visit!.dealId,
                                    )!.company,
                                  })
                                }
                              >
                                {r.visit.date} · {r.visit.title}{' '}
                                <ArrowRight size={13} />
                              </button>
                            </>
                          )}
                          {!r.deal && !r.visit && (
                            <span>统计已结案商机，样本截至当前统计日。</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                </article>
              );
            })
          )}
        </section>
      </div>
      {visit && (
        <VisitDetail
          v={visit.v}
          company={visit.company}
          onClose={() => setVisit(null)}
        />
      )}
    </>
  );
}
