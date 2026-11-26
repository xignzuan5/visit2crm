import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  MessageSquareQuote,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { fieldNames, type FieldKey, type Visit } from '../../../shared/persona';
import { customerQuote, type Profile } from './model';
import { Avatar, dateLabel } from './Board';
import { Radar } from './Radar';

export function VisitDetail({
  v,
  company,
  turnIndex,
  onClose,
}: {
  v: Visit;
  company: string;
  turnIndex?: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    if (turnIndex !== undefined)
      d.querySelector('.cited-line')?.scrollIntoView({ block: 'center' });
    return () => d.close();
  }, [turnIndex]);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="visitdialog"
    >
      <header>
        <div>
          <small>拜访记录</small>
          <h2>
            {company} · {v.title}
          </h2>
          <p>{dateLabel(v.date)}</p>
        </div>
        <button className="iconbtn" aria-label="关闭拜访记录" onClick={onClose}>
          <X size={19} />
        </button>
      </header>
      <h3>商机情报</h3>
      <div className="fieldlist">
        {(Object.keys(fieldNames) as FieldKey[]).map((k) => (
          <div key={k}>
            <b>{fieldNames[k]}</b>
            {customerQuote(v, k) ? (
              <>
                <span>{v.fields[k].summary}</span>
                <q>{v.fields[k].quote}</q>
              </>
            ) : (
              <span className="mute">未知</span>
            )}
          </div>
        ))}
      </div>
      <h3>拜访对话</h3>
      <div className="turns">
        {v.turns.map((t, i) => (
          <p key={i} className={turnIndex === i ? 'cited-line' : undefined}>
            <b>{t.role}</b>
            {t.text}
          </p>
        ))}
      </div>
    </dialog>
  );
}
export function Person({
  p,
  initialAxis = 0,
}: {
  p: Profile;
  initialAxis?: number;
}) {
  const [axis, setAxis] = useState(initialAxis),
    [visit, setVisit] = useState<Visit | null>(null);
  const active = p.axes[axis];
  const company = (v: Visit) =>
    p.deals.find((d) => d.id === v.dealId)?.company ?? '';
  return (
    <>
      <Link className="back" to="/">
        <ArrowLeft size={15} />
        团队看板
      </Link>
      <div className="personhead">
        <Avatar p={p} />
        <div>
          <h1>{p.name}</h1>
          <p>个人画像 · {p.visits.length} 次拜访</p>
        </div>
        <Link to="/dispatch" className="outline">
          派单推荐 <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="personcols">
        <section className="panel radarbox">
          <h2>六维画像</h2>
          <Radar large profile={p} onSelect={setAxis} />
          <div className="axisgrid">
            {p.axes.map((a, i) => (
              <button
                key={a.name}
                className={i === axis ? 'selected' : ''}
                onClick={() => setAxis(i)}
                aria-pressed={i === axis}
              >
                {a.name}
                <b>{a.score ?? '数据不足'}</b>
              </button>
            ))}
          </div>
        </section>
        <section className="panel proof">
          <span className="eyebrow">
            <MessageSquareQuote size={16} /> 拜访依据
          </span>
          <div className="proofhead">
            <h2>{active.name}</h2>
            <strong>{active.score ?? '数据不足'}</strong>
          </div>
          <p>
            {active.evidence.length} 次有依据的拜访，共 {p.visits.length} 次 ·
            两次起显示分数
          </p>
          <div className="proofscroll" key={axis}>
            {active.evidence.length === 0 ? (
              <div className="empty">尚未找到这个维度的原话。</div>
            ) : (
              active.evidence.map((e) => (
                <article key={e.visit.id}>
                  <button
                    onClick={() => setVisit(e.visit)}
                    className="sourcelink"
                  >
                    {company(e.visit)} · {e.visit.title}{' '}
                    <ChevronRight size={14} />
                  </button>
                  <small>
                    {dateLabel(e.visit.date)} · {e.detail}
                  </small>
                  {e.turns.slice(0, 3).map((t, i) => (
                    <blockquote key={i}>
                      <b>{t.role}</b>“{t.text}”
                    </blockquote>
                  ))}
                  <button className="textbtn" onClick={() => setVisit(e.visit)}>
                    查看整次拜访
                  </button>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
      <section className="panel experience">
        <h2>成交经验</h2>
        <div className="expergrid">
          <div>
            <small>擅长行业 · 按历史赢单</small>
            <b>
              {p.industries
                .map((i) => i.value + ' ' + i.n + ' 单')
                .join(' / ') || '数据不足'}
            </b>
          </div>
          <div>
            <small>常见赢单金额区间</small>
            <b>
              {p.amounts[0]
                ? p.amounts[0].value + '（' + p.amounts[0].n + ' 单）'
                : '数据不足'}
            </b>
          </div>
          <div>
            <small>近一年赢单率</small>
            <b>
              {p.winRate === null ? '数据不足' : p.winRate + '%'} · {p.won} 赢 /{' '}
              {p.closedCount} 结案
            </b>
          </div>
        </div>
      </section>
      <section className="panel history">
        <h2>最近拜访</h2>
        {p.visits.map((v) => (
          <button key={v.id} onClick={() => setVisit(v)}>
            <span>
              {company(v)} <small>{v.title}</small>
            </span>
            <span>
              {dateLabel(v.date)} <ChevronRight size={15} />
            </span>
          </button>
        ))}
      </section>
      {visit && (
        <VisitDetail
          v={visit}
          company={company(visit)}
          onClose={() => setVisit(null)}
        />
      )}
    </>
  );
}
