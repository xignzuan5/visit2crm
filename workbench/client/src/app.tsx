import React, { useEffect, useState } from 'react';
import {
  Activity,
  BookOpenText,
  BriefcaseBusiness,
  ChevronRight,
  FlaskConical,
  LayoutGrid,
} from 'lucide-react';
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { axiosForBackend } from '@lark-apaas/client-toolkit/utils/getAxiosForBackend';
import type { Snapshot } from '../../shared/persona';
import { makeProfiles, type Profile } from './persona/model';
import { Board } from './persona/Board';
import { Person } from './persona/Person';
import { DimensionSummaryPage } from './persona/DimensionSummary';
import { Dispatch } from './persona/Dispatch';
import './styles/tokens.css';
import './persona/workbench.css';

function ProfileRoute({ profiles }: { profiles: Profile[] }) {
  const { id } = useParams(),
    [params] = useSearchParams();
  const p = profiles.find((x) => x.id === id),
    axis = Number(params.get('axis'));
  return p ? (
    <Person
      key={id}
      p={p}
      initialAxis={Number.isInteger(axis) && axis >= 0 && axis < 6 ? axis : 0}
    />
  ) : (
    <div className="empty">
      未找到这个销售。<Link to="/">返回团队看板</Link>
    </div>
  );
}
export default function Workbench() {
  const [data, setData] = useState<Snapshot | null>(null),
    [failed, setFailed] = useState(false),
    [attempt, retry] = useState(0);
  const path = useLocation().pathname;
  const summaryPage = /^\/dimensions\/?$/.test(path);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
  useEffect(() => {
    if (summaryPage || data) return;
    let active = true;
    setFailed(false);
    axiosForBackend<Snapshot>({ url: '/api/persona', method: 'GET' })
      .then(({ data: s }) => {
        if (
          !Array.isArray(s.sellers) ||
          !Array.isArray(s.deals) ||
          !Array.isArray(s.visits)
        )
          throw Error('读取画像失败');
        if (active) setData(s);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [attempt, summaryPage, data]);
  const profiles = React.useMemo(
    () => (data ? makeProfiles(data) : []),
    [data],
  );
  return (
    <div className="workbench">
      <header className="topbar">
        <div className="topinner">
          <Link className="brand" to="/">
            <span>
              <Activity size={21} />
            </span>
            销售画像工作台
          </Link>
          <nav aria-label="主导航">
            <NavLink
              to="/"
              end
              className={path.startsWith('/person/') ? 'active' : undefined}
            >
              <LayoutGrid size={16} />
              团队看板
            </NavLink>
            <NavLink to="/dimensions">
              <BookOpenText size={16} />
              维度归纳
            </NavLink>
            <NavLink to="/dispatch">
              <BriefcaseBusiness size={16} />
              派单推荐
            </NavLink>
          </nav>
          <span className="demoflag">
            <FlaskConical size={14} />
            演示数据
          </span>
        </div>
      </header>
      <main>
        <div className="breadcrumb">
          销售总监工作台 <ChevronRight size={12} />
          {summaryPage
            ? '维度归纳'
            : path === '/dispatch'
              ? '派单推荐'
              : path.startsWith('/person/')
                ? '个人画像'
                : '团队看板'}
        </div>
        {summaryPage ? (
          <DimensionSummaryPage />
        ) : failed ? (
          <section className="panel empty">
            <h2>暂时无法读取应用数据库</h2>
            <button className="outline" onClick={() => retry(attempt + 1)}>
              重新加载
            </button>
          </section>
        ) : !data ? (
          <div className="panel empty" role="status">
            正在读取拜访和商机记录…
          </div>
        ) : (
          <Routes>
            <Route
              path="/"
              element={<Board profiles={profiles} asOf={data.asOf} />}
            />
            <Route
              path="/person/:id"
              element={<ProfileRoute profiles={profiles} />}
            />
            <Route
              path="/dispatch"
              element={<Dispatch profiles={profiles} />}
            />
            <Route path="*" element={<Link to="/">返回团队看板</Link>} />
          </Routes>
        )}
      </main>
    </div>
  );
}
