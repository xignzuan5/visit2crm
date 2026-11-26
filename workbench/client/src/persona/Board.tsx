import React, { useState } from 'react';
import {
  ArrowDownWideNarrow,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarDays,
  ChevronRight,
  Filter,
  MessageSquareText,
  Target,
  UsersRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { dimensions, type Profile } from './model';
import { Radar } from './Radar';

export const dateLabel = (s: string) => s.replace(/-/g, '.');
export function Avatar({ p }: { p: Profile }) {
  return <span className={'avatar ink' + p.id}>{p.name.slice(-2)}</span>;
}
export function Board({
  profiles,
  asOf,
  source,
}: {
  profiles: Profile[];
  asOf: string;
  source: 'real' | 'demo';
}) {
  const [industry, setIndustry] = useState(''),
    [sort, setSort] = useState('');
  const industries = [
    ...new Set(
      profiles.flatMap((p) =>
        p.deals.flatMap((d) => (d.industry ? [d.industry] : [])),
      ),
    ),
  ].sort();
  const list = profiles
    .filter((p) => !industry || p.deals.some((d) => d.industry === industry))
    .sort((a, b) =>
      sort === ''
        ? a.id.localeCompare(b.id)
        : (b.axes[Number(sort)].score ?? -1) -
            (a.axes[Number(sort)].score ?? -1) || a.id.localeCompare(b.id),
    );
  const sum = (key: 'active' | 'won' | 'closedCount') =>
    profiles.reduce((n, p) => n + p[key], 0);
  const kpis = [
    { name: '团队成员', n: profiles.length, unit: '人', icon: UsersRound },
    {
      name: '已记录拜访',
      n: profiles.reduce((s, p) => s + p.visits.length, 0),
      unit: '次',
      icon: MessageSquareText,
    },
    { name: '在跟商机', n: sum('active'), unit: '单', icon: BriefcaseBusiness },
    {
      name: '近一年赢单率',
      n: sum('closedCount')
        ? Math.round((sum('won') * 100) / sum('closedCount'))
        : '—',
      unit: '%',
      icon: Target,
    },
  ];
  return (
    <>
      <div className="pagehead">
        <div>
          <h1>团队看板</h1>
          <p>从拜访原话了解销售擅长，把新商机交给合适的人。</p>
        </div>
        <Link className="solid" to="/dispatch">
          新商机匹配 <ArrowUpRight size={16} />
        </Link>
      </div>
      <section className="kpis" aria-label="团队概况">
        {kpis.map((k) => (
          <div key={k.name}>
            <span className="klabel">
              <k.icon size={16} />
              {k.name}
            </span>
            <strong>
              {k.n}
              <small>{k.unit}</small>
            </strong>
            {k.name === '近一年赢单率' && (
              <span className="kfoot">
                {sum('won')} 赢 / {sum('closedCount')} 结案
              </span>
            )}
          </div>
        ))}
      </section>
      <div className="sectionhead">
        <div>
          <h2>
            成员画像 <span className="count">{list.length}</span>
          </h2>
        </div>
        <div className="filters">
          <label>
            <Filter size={14} />
            <select
              aria-label="按行业筛选"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
            >
              <option value="">全部行业</option>
              {industries.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            <ArrowDownWideNarrow size={15} />
            <select
              aria-label="按维度排序"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="">默认顺序</option>
              {dimensions.map((dim, i) => (
                <option key={dim} value={i}>
                  {dim}优先
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="cardgrid">
        {list.map((p) => {
          const top = p.axes
            .filter((a) => a.score !== null)
            .sort((a, b) => b.score! - a.score!)[0];
          return (
            <Link
              key={p.id}
              className="member"
              to={
                '/person/' +
                encodeURIComponent(p.id) +
                (sort === '' ? '' : '?axis=' + sort)
              }
            >
              <div className="memberbody">
                <div>
                  <Avatar p={p} />
                  <h3>{p.name}</h3>
                  <div className="industry">
                    {p.industries[0]?.value ?? '行业待补充'}
                  </div>
                  <span className="ability">
                    {sort !== ''
                      ? dimensions[Number(sort)] +
                        ' · ' +
                        (p.axes[Number(sort)].score ?? '数据不足')
                      : top
                        ? '擅长' + top.name
                        : '数据不足'}
                  </span>
                </div>
                <Radar profile={p} />
              </div>
              <div className="membermetrics">
                <div>
                  <b>{p.visits.length}</b>
                  <small>拜访</small>
                </div>
                <div>
                  <b>{p.active}</b>
                  <small>在跟商机</small>
                </div>
                <div title={p.won + ' 赢 / ' + p.closedCount + ' 结案'}>
                  <b>{p.winRate === null ? '—' : p.winRate + '%'}</b>
                  <small>近一年赢单率</small>
                </div>
                <ChevronRight size={16} />
              </div>
            </Link>
          );
        })}
      </div>
      <div className="dateline">
        <CalendarDays size={14} />{' '}
        {source === 'real' ? '北京时间统计日' : '演示快照截至'}{' '}
        {dateLabel(asOf)} · 行业筛选按全部商机经历
      </div>
    </>
  );
}
