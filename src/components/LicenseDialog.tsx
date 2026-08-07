import React, { useCallback, useRef, useState } from 'react';
import type { ActivateResult } from '../hooks/useLicense';

export interface LicenseDialogProps {
  onActivate: (licenseCode: string) => Promise<ActivateResult>;
  onClose: () => void;
}

type Stage = 'input' | 'activating' | 'success' | 'error';

/** 文档 §9 错误码 → 用户可读文案。不泄露任何数据库/服务器细节。 */
const ERROR_MESSAGES: Record<string, string> = {
  LICENSE_INVALID: '该授权码无效',
  LICENSE_ALREADY_USED: '该授权码已被使用',
  LICENSE_REVOKED: '该授权码已被撤销',
  LICENSE_DISABLED: '该授权码已被禁用',
  DEVICE_BLOCKED: '当前设备已被禁用',
  DEVICE_ALREADY_LICENSED: '当前设备已激活过其他授权码',
  DEVICE_NOT_FOUND: '设备尚未登记，请先重新登录后再试',
  USER_BLOCKED: '账号已被禁用',
  AUTH_REQUIRED: '请先登录后再激活',
  SIGNATURE_INVALID: '服务器返回的许可证校验失败，请稍后重试',
  NETWORK_ERROR: '网络连接失败，请稍后重试',
  SERVER_ERROR: '服务器繁忙，请稍后重试',
};

function errorMessage(result: ActivateResult): string {
  return result.message || ERROR_MESSAGES[result.code || ''] || '激活失败，请稍后重试';
}

/** 输入格式化：去除非字母数字、转大写、每 4 位插一个横线，最多 16 位有效字符。 */
function formatCode(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 16);
  const groups = clean.match(/.{1,4}/g) || [];
  return groups.join('-');
}

/**
 * 授权码激活弹窗（文档 §14.3）。沿用 LoginPage/TrialBanner 的电影感设计语言，
 * 作为居中弹窗叠加在画布上方，不是全屏——不打断用户已经在做的事，关掉即可回去。
 */
export const LicenseDialog: React.FC<LicenseDialogProps> = ({ onActivate, onClose }) => {
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<Stage>('input');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const digitsOnly = code.replace(/-/g, '').length;
  const canSubmit = digitsOnly === 16 && stage !== 'activating';

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setStage('activating');
    setError(null);
    try {
      const result = await onActivate(code);
      if (result.success) {
        setStage('success');
      } else {
        setStage('error');
        setError(errorMessage(result));
      }
    } catch (e) {
      setStage('error');
      setError((e as Error)?.message || '激活失败，请稍后重试');
    }
  }, [canSubmit, code, onActivate]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && stage !== 'activating') onClose();
    },
    [onClose, stage]
  );

  return (
    <div className="ld-overlay" onClick={handleOverlayClick} role="presentation">
      <LicenseDialogStyles />
      <div className="ld-card" role="dialog" aria-modal="true" aria-label="激活永久授权">
        <span className="ld-seam" aria-hidden="true" />

        {stage === 'success' ? (
          <div className="ld-success">
            <span className="ld-success-icon" aria-hidden="true">
              <CheckBadge />
            </span>
            <h2 className="ld-title">激活成功</h2>
            <p className="ld-desc">当前电脑已获得永久授权，可离线使用。</p>
            <button type="button" className="ld-primary" onClick={onClose}>
              完成
            </button>
          </div>
        ) : (
          <>
            <h2 className="ld-title">激活永久授权</h2>

            <label className="ld-field-label" htmlFor="ld-code-input">
              授权码
            </label>
            <input
              ref={inputRef}
              id="ld-code-input"
              className="ld-input"
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="AICV-____-____-____"
              value={code}
              disabled={stage === 'activating'}
              onChange={(e) => setCode(formatCode(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSubmit();
              }}
            />

            <p className="ld-hint">授权将绑定当前电脑，激活后无法在其他电脑使用。</p>

            {stage === 'error' && error ? <p className="ld-error">{error}</p> : null}

            <div className="ld-actions">
              <button type="button" className="ld-secondary" onClick={onClose} disabled={stage === 'activating'}>
                取消
              </button>
              <button type="button" className="ld-primary" onClick={handleSubmit} disabled={!canSubmit}>
                {stage === 'activating' ? <Spinner /> : null}
                {stage === 'activating' ? '正在激活…' : '立即激活'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const Spinner: React.FC = () => (
  <svg className="ld-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.6" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
  </svg>
);

const CheckBadge: React.FC = () => (
  <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="15" stroke="url(#ld-grad)" strokeWidth="1.4" />
    <path d="M10 16.5l4 4 8-9" stroke="url(#ld-grad)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    <defs>
      <linearGradient id="ld-grad" x1="0" y1="0" x2="32" y2="32">
        <stop offset="0%" stopColor="#F1D6A6" />
        <stop offset="100%" stopColor="#E7C08B" />
      </linearGradient>
    </defs>
  </svg>
);

const LicenseDialogStyles: React.FC = () => (
  <style>{`
.ld-overlay{
  position:fixed; inset:0; z-index:10000; display:flex; align-items:center; justify-content:center;
  background:rgba(4,6,10,0.6); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
  animation:ld-fade .18s ease both;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Helvetica Neue",system-ui,sans-serif;
}
@keyframes ld-fade{from{opacity:0}to{opacity:1}}

.ld-card{
  position:relative; width:min(90vw,380px); padding:28px 26px 24px;
  background:rgba(18,22,31,0.86); border:1px solid rgba(255,255,255,0.09); border-radius:18px;
  backdrop-filter:blur(22px) saturate(120%); -webkit-backdrop-filter:blur(22px) saturate(120%);
  box-shadow:0 30px 80px -24px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.05);
  color:#F3F5FA; animation:ld-pop .22s cubic-bezier(.2,.8,.2,1) both;
}
@keyframes ld-pop{from{opacity:0;transform:scale(0.96) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
.ld-seam{ position:absolute; top:-1px; left:20%; right:20%; height:1px;
  background:linear-gradient(90deg,transparent,rgba(231,192,139,0.6),transparent); }

.ld-title{ margin:0 0 18px; font-size:17px; font-weight:500; letter-spacing:0.01em; text-align:center; color:#FAFBFF; }

.ld-field-label{ display:block; margin-bottom:7px; font-size:11.5px; color:#98A2B3; letter-spacing:0.03em; }
.ld-input{
  width:100%; height:46px; padding:0 14px; border-radius:11px; box-sizing:border-box;
  background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); color:#F3F5FA;
  font-size:15px; font-weight:500; letter-spacing:0.06em; font-variant-numeric:tabular-nums;
  transition:border-color .15s ease, box-shadow .15s ease;
}
.ld-input::placeholder{ color:#4B525E; letter-spacing:0.04em; font-weight:400; }
.ld-input:focus{ outline:none; border-color:rgba(231,192,139,0.55); box-shadow:0 0 0 3px rgba(231,192,139,0.12); }
.ld-input:disabled{ opacity:0.6; }

.ld-hint{ margin:10px 2px 0; font-size:11.5px; line-height:1.5; color:#6B7482; }
.ld-error{ margin:10px 2px 0; font-size:12px; color:#F1B4A0; }

.ld-actions{ display:flex; gap:10px; margin-top:20px; }
.ld-secondary,.ld-primary{
  flex:1; height:42px; border-radius:11px; font-size:13.5px; font-weight:500; cursor:pointer;
  display:flex; align-items:center; justify-content:center; gap:7px; transition:filter .15s ease, transform .15s ease, opacity .15s ease;
}
.ld-secondary{ background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); color:#C7CDD8; }
.ld-secondary:hover:not(:disabled){ background:rgba(255,255,255,0.09); }
.ld-secondary:disabled{ opacity:0.4; cursor:default; }
.ld-primary{ background:linear-gradient(180deg,#F1D6A6,#E7C08B); border:none; color:#1a1206; }
.ld-primary:hover:not(:disabled){ filter:brightness(1.05); transform:translateY(-0.5px); }
.ld-primary:disabled{ opacity:0.4; cursor:default; filter:none; transform:none; }
.ld-primary:focus-visible,.ld-secondary:focus-visible{ outline:none; box-shadow:0 0 0 2px #0B0E14, 0 0 0 4px #E7C08B; }
.ld-spin{ animation:ld-rot .9s linear infinite; }
@keyframes ld-rot{to{transform:rotate(360deg)}}

.ld-success{ display:flex; flex-direction:column; align-items:center; text-align:center; padding-top:4px; }
.ld-success-icon{ margin-bottom:14px; }
.ld-success .ld-title{ margin-bottom:8px; }
.ld-success .ld-desc{ margin:0 0 22px; font-size:13px; line-height:1.6; color:#98A2B3; }
.ld-success .ld-primary{ width:100%; }

@media (prefers-reduced-motion:reduce){ .ld-overlay,.ld-card,.ld-spin{ animation:none !important; } }
`}</style>
);

export default LicenseDialog;
