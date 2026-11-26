import type { DataSource, Snapshot } from '../../../shared/persona';
import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpenText,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Ear,
  Lightbulb,
  ListChecks,
  MessageCircleQuestion,
  MessagesSquare,
  Network,
  Swords,
  X,
} from 'lucide-react';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type {
  TeamSummary,
  VisitSource,
  WindowDays,
} from '../../../shared/dimension-summary';
import { VisitDetail } from './Person';
import { dateLabel } from './Board';
import './summary.css';

const icons = [
  MessageCircleQuestion,
  Network,
  ListChecks,
  Swords,
  Ear,
  ClipboardCheck,
];
interface SourceList {
  title: string;
  ids: string[];
  note?: string;
  observed?: string[];
}
function Sources({
  list,
  sources,
  open,
  close,
}: {
  list: SourceList;
  sources: VisitSource[];
  open: (v: VisitSource) => void;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="visitdialog summary-sources"
      aria-label={list.title}
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <header>
        <div>
          <small>对应拜访</small>
          <h2>{list.title}</h2>
        </div>
        <button className="iconbtn" aria-label="关闭依据列表" onClick={close}>
          <X size={18} />
        </button>
      </header>
      {list.note && <p>{list.note}</p>}
      {sources
        .filter((s) => list.ids.includes(s.visit.id))
        .map((s) => (
          <button
            className="source-row"
            key={s.visit.id}
            onClick={() => open(s)}
          >
            <span>
              <b>
                {s.company} · {s.visit.title}
              </b>
              <small>
                {s.sellerName} · {s.visit.date}
                {list.observed &&
                  (list.observed.includes(s.visit.id)
                    ? ' · 有该维度依据'
                    : ' · 未见该维度依据')}
              </small>
            </span>
            <ChevronRight size={15} />
          </button>
        ))}
      {!list.ids.length && <p>这个时间段没有对应的拜访记录。</p>}
    </dialog>
  );
}
type SourceMeta = Pick<Snapshot, 'source' | 'hasRealVisits'>;
export function DimensionSummaryPage({
  source,
  onLoaded,
}: {
  source?: DataSource;
  onLoaded: (meta: SourceMeta) => void;
}) {
  const [days, setDays] = useState<WindowDays>(30),
    [data, setData] = useState<TeamSummary | null>(null);
  const [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [list, setList] = useState<SourceList | null>(null),
    [detail, setDetail] = useState<{
      source: VisitSource;
      turnIndex?: number;
    } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    setData(null);
    setFailed(false);
    setList(null);
    setDetail(null);
    axiosForBackend<TeamSummary & SourceMeta>({
      url: '/api/persona/dimension-summary',
      method: 'GET',
      params: { days, source },
      signal: abort.signal,
    })
      .then(({ data: summary }) => {
        if (!abort.signal.aborted) {
          setData(summary);
          onLoaded({
            source: summary.source,
            hasRealVisits: summary.hasRealVisits,
          });
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => abort.abort();
  }, [days, attempt, source, onLoaded]);
  const windowData = data?.days === days ? data : null;
  const visits = windowData?.visits ?? [],
    all = visits.map((s) => s.visit.id);
  function show(title: string, ids: string[], note?: string) {
    setList({ title, ids, note });
  }
  function claim(text: string, ids: string[], prefix = '') {
    return (
      <button className="summary-claim" onClick={() => show(text, ids)}>
        {prefix}
        <b>{ids.length} 次</b>
        {prefix ? '' : '拜访'}
        {text}。
      </button>
    );
  }
  return (
    <>
      <div className="pagehead summary-head">
        <div>
          <h1>维度归纳</h1>
          <p>按六个维度复盘近期拜访，点击结论可核对原始对话。</p>
        </div>
        <div className="window-switch" aria-label="拜访时间范围">
          {([30, 90] as const).map((n) => (
            <button
              key={n}
              aria-pressed={days === n}
              onClick={() => setDays(n)}
            >
              近 {n} 天
            </button>
          ))}
        </div>
      </div>
      {failed ? (
        <div className="empty panel" role="alert">
          未能读取归纳。
          <button className="outline" onClick={() => setAttempt((n) => n + 1)}>
            重新加载
          </button>
        </div>
      ) : !windowData ? (
        <div className="empty panel" role="status">
          正在归纳拜访…
        </div>
      ) : (
        <>
          <div className="summary-period">
            <CalendarDays size={16} />
            {dateLabel(windowData.from)} — {dateLabel(windowData.asOf)}
            <button
              className="textbtn"
              onClick={() => show('本期全部拜访', all)}
            >
              {visits.length} 次拜访 ·{' '}
              {new Set(visits.map((s) => s.sellerId)).size} 名销售{' '}
              <ChevronRight size={13} />
            </button>
          </div>
          <div className="summary-grid">
            {windowData.dimensions.map((d, i) => {
              const Icon = icons[i],
                strong = d.people.filter((p) => d.strongest.includes(p.id)),
                thin = d.people.filter((p) => p.score === null);
              return (
                <article className="panel summary-card" key={d.name}>
                  <h2>
                    <span>
                      <Icon size={18} />
                    </span>
                    {d.name}
                  </h2>
                  <div className="summary-findings">
                    {claim(d.strengths.text, d.strengths.visitIds)}{' '}
                    {claim(d.gaps.text, d.gaps.visitIds, '其中 ')}{' '}
                    {d.unaddressed.visitIds.length > 0 &&
                      claim(
                        d.unaddressed.text,
                        d.unaddressed.visitIds,
                        '另有 ',
                      )}
                  </div>
                  <div className="summary-people">
                    <div>
                      <small>擅长</small>
                      {strong.length ? (
                        strong.map((p) => (
                          <button
                            key={p.id}
                            onClick={() =>
                              setList({
                                title: p.name + ' · ' + d.name,
                                ids: p.reviewed,
                                observed: p.observed,
                                note: `本期 ${p.observed.length} 次有效观察，分项为 ${p.score}。以下列出该成员在窗口内的全部拜访。`,
                              })
                            }
                          >
                            {p.name} <ChevronRight size={12} />
                          </button>
                        ))
                      ) : (
                        <button
                          onClick={() =>
                            show(
                              d.name + ' · 成员依据',
                              all,
                              '需至少两次有效观察，且本期分项达到 75。',
                            )
                          }
                        >
                          本期暂无 <ChevronRight size={12} />
                        </button>
                      )}
                    </div>
                    <div>
                      <small>依据不足</small>
                      {thin.length ? (
                        thin.map((p) => (
                          <button
                            key={p.id}
                            onClick={() =>
                              setList({
                                title: p.name + ' · ' + d.name,
                                ids: p.reviewed,
                                observed: p.observed,
                                note: `本期审阅 ${p.reviewed.length} 次拜访，${p.observed.length} 次有该维度依据，至少两次才显示分项。`,
                              })
                            }
                          >
                            {p.name} <ChevronRight size={12} />
                          </button>
                        ))
                      ) : (
                        <button
                          onClick={() =>
                            setList({
                              title: d.name + ' · 成员依据',
                              ids: all,
                              observed: d.people.flatMap((p) => p.observed),
                              note: '本期每位成员均有至少两次有效观察。',
                            })
                          }
                        >
                          本期均有依据 <ChevronRight size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                  <details className="summary-quotes" open={i < 2}>
                    <summary>
                      <MessagesSquare size={15} />
                      代表性原话 <span>{d.quotes.length} 条</span>
                    </summary>
                    {d.quotes.map((q) => {
                      const source = visits.find(
                        (s) => s.visit.id === q.visitId,
                      )!;
                      return (
                        <button
                          key={q.visitId}
                          onClick={() =>
                            setDetail({ source, turnIndex: q.turnIndex })
                          }
                        >
                          <q>{q.text}</q>
                          <small>
                            {q.role} · {source.sellerName} · {source.visit.date}{' '}
                            <ChevronRight size={12} />
                          </small>
                        </button>
                      );
                    })}
                    {!d.quotes.length && <p>本期没有可引用的有效发言。</p>}
                  </details>
                  <div className="summary-advice">
                    <small>
                      <Lightbulb size={14} />
                      建议总监关注
                    </small>
                    {d.advice.visitIds.length ? (
                      <button
                        onClick={() =>
                          show(
                            d.name + ' · 建议依据',
                            d.advice.visitIds,
                            d.advice.text,
                          )
                        }
                      >
                        {d.advice.text} <BookOpenText size={14} />
                      </button>
                    ) : (
                      <p>{d.advice.text}</p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
      {list && (
        <Sources
          list={list}
          sources={visits}
          open={(source) => setDetail({ source })}
          close={() => setList(null)}
        />
      )}
      {detail && (
        <VisitDetail
          v={detail.source.visit}
          company={detail.source.company}
          turnIndex={detail.turnIndex}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}
