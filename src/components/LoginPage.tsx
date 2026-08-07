import React, { useEffect, useRef, useState } from 'react';
import type { AuthStatus } from '../hooks/useAuth';

export interface LoginPageProps {
  status: AuthStatus;
  error?: string | null;
  keepSignedIn: boolean;
  onToggleKeepSignedIn: (value: boolean) => void;
  onSignIn: () => void;
  appVersion?: string;
}

/**
 * 首次登录页。刻意采用独立的电影感深色底（不跟随画布主题），
 * 签名元素是背后极安静、缓慢漂移的“生成中的画布”——节点图 + 极光光缝。
 */
export const LoginPage: React.FC<LoginPageProps> = ({
  status,
  error,
  keepSignedIn,
  onToggleKeepSignedIn,
  onSignIn,
  appVersion,
}) => {
  const busy = status === 'authenticating';
  const [showSlowHint, setShowSlowHint] = useState(false);

  useEffect(() => {
    if (!busy) {
      setShowSlowHint(false);
      return;
    }
    const t = setTimeout(() => setShowSlowHint(true), 4500);
    return () => clearTimeout(t);
  }, [busy]);

  const buttonLabel = busy ? '正在等待浏览器授权…' : status === 'error' ? '重试 Google 登录' : '使用 Google 账号继续';

  return (
    <div className="lp-root" role="dialog" aria-modal="true" aria-label="登录 AI Canvas">
      <LoginStyles />
      <CanvasBackdrop />
      <div className="lp-vignette" aria-hidden="true" />
      <div className="lp-grain" aria-hidden="true" />

      <main className="lp-stage">
        <header className="lp-head">
          <span className="lp-mark" aria-hidden="true">
            <span className="lp-mark-core" />
          </span>
          <h1 className="lp-wordmark">AI&nbsp;Canvas</h1>
          <p className="lp-tagline">本地优先的 AI 视频创作画布</p>
        </header>

        <section className="lp-panel">
          <span className="lp-panel-seam" aria-hidden="true" />

          <button
            type="button"
            className="lp-google"
            onClick={onSignIn}
            disabled={busy}
            data-busy={busy ? 'true' : 'false'}
          >
            <span className="lp-google-icon" aria-hidden="true">
              {busy ? <Spinner /> : <GoogleG />}
            </span>
            <span className="lp-google-label">{buttonLabel}</span>
            <span className="lp-google-sweep" aria-hidden="true" />
          </button>

          <label className="lp-keep">
            <input
              type="checkbox"
              checked={keepSignedIn}
              onChange={(e) => onToggleKeepSignedIn(e.target.checked)}
            />
            <span className="lp-keep-box" aria-hidden="true">
              <CheckIcon />
            </span>
            <span className="lp-keep-text">在此设备上保持登录</span>
          </label>

          <div className="lp-status" aria-live="polite">
            {status === 'error' && error ? (
              <p className="lp-error">{error}</p>
            ) : showSlowHint ? (
              <p className="lp-hint">没有自动跳转？请在系统默认浏览器中完成授权。</p>
            ) : null}
          </div>
        </section>

        <ul className="lp-reassure">
          <li>
            <Dot /> 首次使用免费试用 7 天
          </li>
          <li>
            <Dot /> 画布、素材与生成结果仅保存在本地
          </li>
        </ul>
      </main>

      <footer className="lp-foot">
        <span>本地优先 · 云端仅保存账号与授权状态</span>
        {appVersion ? <span className="lp-ver">v{appVersion}</span> : null}
      </footer>
    </div>
  );
};

/** 背后的“生成中的画布”：缓慢漂移的节点图，两条边有信号脉冲。极安静。 */
const CanvasBackdrop: React.FC = () => {
  const nodes = useRef(
    [
      [16, 26], [30, 62], [24, 84], [44, 34], [52, 72],
      [63, 20], [70, 50], [78, 80], [86, 38], [92, 64],
      [8, 52], [38, 14],
    ] as Array<[number, number]>
  ).current;
  const edges = useRef(
    [
      [0, 1], [1, 2], [0, 3], [3, 4], [4, 2], [3, 5], [5, 6], [6, 4],
      [6, 7], [5, 8], [8, 9], [9, 7], [10, 0], [11, 3], [1, 10],
    ] as Array<[number, number]>
  ).current;
  const pulses = useRef([[3, 6], [8, 9]] as Array<[number, number]>).current;

  return (
    <svg className="lp-graph" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g className="lp-graph-edges">
        {edges.map(([a, b], i) => (
          <line key={i} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} />
        ))}
      </g>
      <g className="lp-graph-pulses">
        {pulses.map(([a, b], i) => (
          <line
            key={i}
            x1={nodes[a][0]}
            y1={nodes[a][1]}
            x2={nodes[b][0]}
            y2={nodes[b][1]}
            style={{ animationDelay: `${i * 2.6}s` }}
          />
        ))}
      </g>
      <g className="lp-graph-nodes">
        {nodes.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 4 === 0 ? 0.9 : 0.55} style={{ animationDelay: `${(i % 6) * 0.9}s` }} />
        ))}
      </g>
    </svg>
  );
};

const GoogleG: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 48 48">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

const Spinner: React.FC = () => (
  <svg className="lp-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.4" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

const CheckIcon: React.FC = () => (
  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
    <path d="M2.5 6.2l2.2 2.3 4.8-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Dot: React.FC = () => <span className="lp-reassure-dot" aria-hidden="true" />;

/** 全部样式集中于此，类名统一 lp- 前缀，避免与全局/Tailwind 冲突。 */
const LoginStyles: React.FC = () => (
  <style>{`
.lp-root{
  --ink:#0B0E14; --ink-deep:#06080D;
  --panel:rgba(18,22,31,0.55); --line:rgba(255,255,255,0.09);
  --text:#F3F5FA; --muted:#98A2B3; --faint:#6B7482;
  --gold:#E7C08B; --gold-soft:#F1D6A6; --teal:#57C9BD;
  position:fixed; inset:0; z-index:9999;
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  background:
    radial-gradient(120% 90% at 50% -10%, #121826 0%, var(--ink) 42%, var(--ink-deep) 100%);
  color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Helvetica Neue",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased; overflow:hidden;
  animation:lp-fade 0.9s ease both;
}
@keyframes lp-fade{from{opacity:0}to{opacity:1}}

/* --- signature: drifting node graph + aurora --- */
.lp-graph{
  position:absolute; inset:-6%; width:112%; height:112%;
  opacity:0.5; animation:lp-drift 46s ease-in-out infinite alternate;
}
@keyframes lp-drift{from{transform:translate3d(-1.4%,-1%,0) scale(1.02)}to{transform:translate3d(1.6%,1.4%,0) scale(1.06)}}
.lp-graph-edges line{ stroke:rgba(146,163,190,0.14); stroke-width:0.14; }
.lp-graph-nodes circle{ fill:rgba(178,196,224,0.55); animation:lp-breathe 6s ease-in-out infinite; }
@keyframes lp-breathe{0%,100%{opacity:0.35}50%{opacity:0.85}}
.lp-graph-pulses line{
  stroke:var(--gold); stroke-width:0.24; stroke-linecap:round;
  stroke-dasharray:5 95; stroke-dashoffset:100;
  filter:drop-shadow(0 0 0.6px var(--gold-soft));
  animation:lp-pulse 5.2s linear infinite;
}
@keyframes lp-pulse{0%{stroke-dashoffset:100;opacity:0}12%{opacity:1}60%{opacity:1}100%{stroke-dashoffset:0;opacity:0}}

.lp-root::before{ /* teal aurora */
  content:""; position:absolute; width:70vw; height:70vw; left:-14vw; top:-22vw;
  background:radial-gradient(circle at 50% 50%, rgba(87,201,189,0.14), transparent 62%);
  filter:blur(14px); animation:lp-aurora-a 30s ease-in-out infinite alternate; pointer-events:none;
}
.lp-root::after{ /* warm aurora */
  content:""; position:absolute; width:60vw; height:60vw; right:-16vw; bottom:-20vw;
  background:radial-gradient(circle at 50% 50%, rgba(231,192,139,0.12), transparent 60%);
  filter:blur(16px); animation:lp-aurora-b 36s ease-in-out infinite alternate; pointer-events:none;
}
@keyframes lp-aurora-a{from{transform:translate(0,0)}to{transform:translate(6vw,4vw)}}
@keyframes lp-aurora-b{from{transform:translate(0,0)}to{transform:translate(-5vw,-3vw)}}

.lp-vignette{ position:absolute; inset:0; pointer-events:none;
  background:radial-gradient(120% 100% at 50% 40%, transparent 55%, rgba(3,5,9,0.66) 100%); }
.lp-grain{ position:absolute; inset:0; pointer-events:none; opacity:0.05; mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }

/* --- foreground --- */
.lp-stage{ position:relative; z-index:2; display:flex; flex-direction:column; align-items:center;
  width:min(92vw,420px); text-align:center; }

.lp-head{ display:flex; flex-direction:column; align-items:center; margin-bottom:34px; }
.lp-mark{ position:relative; width:34px; height:34px; margin-bottom:22px; display:grid; place-items:center;
  transform:rotate(45deg); border:1px solid var(--line); border-radius:9px;
  box-shadow:0 0 0 6px rgba(231,192,139,0.05), 0 10px 40px rgba(231,192,139,0.10); }
.lp-mark-core{ width:11px; height:11px; border-radius:3px;
  background:linear-gradient(140deg,var(--gold-soft),var(--gold));
  box-shadow:0 0 14px 2px rgba(231,192,139,0.55); animation:lp-core 4.5s ease-in-out infinite; }
@keyframes lp-core{0%,100%{opacity:0.7;transform:scale(0.92)}50%{opacity:1;transform:scale(1.06)}}

.lp-wordmark{ margin:0; font-size:31px; font-weight:300; letter-spacing:0.30em; padding-left:0.30em;
  text-transform:uppercase; color:#FAFBFF; }
.lp-tagline{ margin:12px 0 0; font-size:14px; font-weight:300; letter-spacing:0.06em; color:var(--muted); }

.lp-panel{ position:relative; width:100%; padding:24px 24px 20px;
  background:var(--panel); border:1px solid var(--line); border-radius:18px;
  backdrop-filter:blur(22px) saturate(120%); -webkit-backdrop-filter:blur(22px) saturate(120%);
  box-shadow:0 30px 80px -30px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05); }
.lp-panel-seam{ position:absolute; top:-1px; left:22%; right:22%; height:1px;
  background:linear-gradient(90deg,transparent,rgba(231,192,139,0.6),transparent); }

.lp-google{ position:relative; width:100%; height:52px; display:flex; align-items:center; justify-content:center;
  gap:11px; padding:0 18px; border-radius:12px; cursor:pointer; overflow:hidden;
  border:1px solid rgba(255,255,255,0.14);
  background:linear-gradient(180deg,#FFFFFF,#EDEFF3); color:#14161B;
  font-size:15px; font-weight:500; letter-spacing:0.01em;
  box-shadow:0 8px 24px -10px rgba(0,0,0,0.6); transition:transform .18s ease, box-shadow .18s ease, filter .18s ease; }
.lp-google:hover:not(:disabled){ transform:translateY(-1px); box-shadow:0 14px 30px -12px rgba(0,0,0,0.7); }
.lp-google:active:not(:disabled){ transform:translateY(0); }
.lp-google:disabled{ cursor:default; filter:saturate(0.7) brightness(0.97); color:#3A3E46; }
.lp-google:focus-visible{ outline:none; box-shadow:0 0 0 2px var(--ink), 0 0 0 4px var(--gold); }
.lp-google-icon{ display:grid; place-items:center; width:18px; height:18px; color:#14161B; }
.lp-google-label{ line-height:1; }
.lp-google-sweep{ position:absolute; inset:0; pointer-events:none; transform:translateX(-120%);
  background:linear-gradient(100deg,transparent 40%,rgba(255,255,255,0.55) 50%,transparent 60%); }
.lp-google:hover:not(:disabled) .lp-google-sweep{ animation:lp-sweep .7s ease; }
@keyframes lp-sweep{to{transform:translateX(120%)}}
.lp-spin{ animation:lp-rot 0.9s linear infinite; }
@keyframes lp-rot{to{transform:rotate(360deg)}}

.lp-keep{ display:flex; align-items:center; justify-content:center; gap:9px; margin-top:16px;
  cursor:pointer; user-select:none; }
.lp-keep input{ position:absolute; opacity:0; width:0; height:0; }
.lp-keep-box{ width:17px; height:17px; border-radius:5px; border:1px solid rgba(255,255,255,0.22);
  display:grid; place-items:center; color:transparent; background:rgba(255,255,255,0.03); transition:all .16s ease; }
.lp-keep input:checked + .lp-keep-box{ background:linear-gradient(140deg,var(--gold-soft),var(--gold));
  border-color:var(--gold); color:#1a1206; }
.lp-keep input:focus-visible + .lp-keep-box{ outline:none; box-shadow:0 0 0 2px var(--ink), 0 0 0 4px var(--gold); }
.lp-keep-text{ font-size:13px; color:var(--muted); letter-spacing:0.02em; }

.lp-status{ min-height:0; margin-top:12px; }
.lp-status:empty{ margin-top:0; }
.lp-error{ margin:0; font-size:12.5px; color:#F1B4A0; letter-spacing:0.02em; }
.lp-hint{ margin:0; font-size:12.5px; color:var(--faint); letter-spacing:0.02em; }

.lp-reassure{ list-style:none; margin:26px 0 0; padding:0; display:flex; flex-direction:column; gap:9px; }
.lp-reassure li{ display:flex; align-items:center; justify-content:center; gap:9px;
  font-size:12.5px; font-weight:300; color:var(--faint); letter-spacing:0.03em; }
.lp-reassure-dot{ width:4px; height:4px; border-radius:50%; background:var(--gold); opacity:0.8;
  box-shadow:0 0 8px 1px rgba(231,192,139,0.4); }

.lp-foot{ position:absolute; z-index:2; bottom:26px; display:flex; align-items:center; gap:10px;
  font-size:11px; color:#535B69; letter-spacing:0.04em; }
.lp-ver{ padding-left:10px; border-left:1px solid rgba(255,255,255,0.08); }

@media (max-width:480px){
  .lp-wordmark{ font-size:26px; }
  .lp-panel{ padding:22px 18px 18px; }
}
@media (prefers-reduced-motion:reduce){
  .lp-root,.lp-graph,.lp-graph-nodes circle,.lp-graph-pulses line,.lp-mark-core,
  .lp-root::before,.lp-root::after,.lp-spin{ animation:none !important; }
  .lp-graph-pulses line{ opacity:0; }
}
`}</style>
);

export default LoginPage;
