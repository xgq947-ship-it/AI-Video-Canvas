import React, { useEffect, useRef, useState } from 'react';
import { Folder, FolderOpen, FolderPlus, Loader2, RotateCcw, X } from 'lucide-react';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, locationId?: string | null) => Promise<void>;
  canvasTheme?: 'dark' | 'light';
}

interface SelectedLocation {
  locationId: string;
  path: string;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  onClose,
  onCreate,
  canvasTheme = 'dark',
}) => {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectingLocation, setSelectingLocation] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<SelectedLocation | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isDark = canvasTheme === 'dark';
  const canSelectLocation = Boolean(window.evanDesktop?.selectProjectLocation);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setError('');
    setCreating(false);
    setSelectingLocation(false);
    setSelectedLocation(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  if (!isOpen) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = name.trim();
    if (!value) {
      setError('请输入项目名称');
      return;
    }
    try {
      setCreating(true);
      setError('');
      await onCreate(value, selectedLocation?.locationId);
      onClose();
    } catch (cause: any) {
      setError(cause?.message || '项目创建失败');
    } finally {
      setCreating(false);
    }
  };

  const chooseLocation = async () => {
    if (!window.evanDesktop?.selectProjectLocation) {
      setError('选择项目路径仅在 Evan 桌面应用中可用');
      return;
    }
    try {
      setSelectingLocation(true);
      setError('');
      const result = await window.evanDesktop.selectProjectLocation();
      if (result.canceled === false) {
        setSelectedLocation({
          locationId: result.locationId,
          path: result.path
        });
      }
    } catch (cause: any) {
      setError(cause?.message || '无法打开文件夹选择器');
    } finally {
      setSelectingLocation(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm" onMouseDown={event => {
      if (event.target === event.currentTarget && !creating) onClose();
    }}>
      <form onSubmit={submit} className={`w-full max-w-[520px] rounded-3xl border p-7 shadow-2xl ${isDark ? 'border-neutral-700 bg-[#191919] text-white' : 'border-neutral-200 bg-white text-neutral-900'}`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white"><FolderPlus size={21} /></div>
            <div>
              <h2 className="text-lg font-semibold">新建项目</h2>
              <p className={`mt-1 text-xs ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>项目素材会自动保存到同名文件夹</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={creating} className={`rounded-lg p-1.5 ${isDark ? 'text-neutral-400 hover:bg-neutral-800 hover:text-white' : 'text-neutral-500 hover:bg-neutral-100'}`}><X size={18} /></button>
        </div>

        <label className="mt-6 block text-sm font-medium" htmlFor="new-project-name">项目名称</label>
        <input
          ref={inputRef}
          id="new-project-name"
          value={name}
          maxLength={40}
          onChange={event => { setName(event.target.value); setError(''); }}
          placeholder="例如：莫妮卡上海篇"
          disabled={creating}
          className={`mt-2 w-full rounded-xl border px-4 py-3 text-sm outline-none transition-colors focus:border-blue-500 ${isDark ? 'border-neutral-700 bg-neutral-900 text-white placeholder:text-neutral-600' : 'border-neutral-300 bg-white text-neutral-900 placeholder:text-neutral-400'}`}
        />

        <div className="mt-5 flex items-center justify-between">
          <label className="text-sm font-medium">存放位置</label>
          {selectedLocation && (
            <button
              type="button"
              onClick={() => setSelectedLocation(null)}
              disabled={creating || selectingLocation}
              className={`flex items-center gap-1 text-xs ${isDark ? 'text-neutral-400 hover:text-white' : 'text-neutral-500 hover:text-neutral-900'}`}
            >
              <RotateCcw size={13} />
              恢复默认
            </button>
          )}
        </div>

        <div className={`mt-2 rounded-2xl border p-3.5 ${isDark ? 'border-neutral-700 bg-neutral-900/80' : 'border-neutral-200 bg-neutral-50'}`}>
          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${selectedLocation ? 'bg-blue-500/15 text-blue-400' : isDark ? 'bg-neutral-800 text-neutral-400' : 'bg-white text-neutral-500'}`}>
              {selectedLocation ? <FolderOpen size={19} /> : <Folder size={19} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {selectedLocation ? '自定义文件夹' : 'Evan 默认项目目录'}
              </p>
              <p
                className={`mt-1 truncate text-xs ${isDark ? 'text-neutral-500' : 'text-neutral-500'}`}
                title={selectedLocation?.path}
              >
                {selectedLocation?.path || '项目保存在应用数据目录，升级应用不会丢失'}
              </p>
            </div>
            <button
              type="button"
              onClick={chooseLocation}
              disabled={creating || selectingLocation || !canSelectLocation}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${isDark ? 'border-neutral-700 bg-neutral-800 text-neutral-200 hover:bg-neutral-700' : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100'}`}
            >
              {selectingLocation
                ? <Loader2 size={14} className="animate-spin" />
                : <FolderOpen size={14} />}
              选择文件夹
            </button>
          </div>
          <p className={`mt-3 text-[11px] leading-5 ${isDark ? 'text-neutral-500' : 'text-neutral-500'}`}>
            {selectedLocation
              ? `创建后会存放在“所选文件夹/${name.trim() || '项目名称'}”`
              : canSelectLocation
                ? '可以选择桌面、其他磁盘或任意有写入权限的文件夹'
                : '浏览器开发模式不能选择系统路径，请使用 Evan 桌面应用'}
          </p>
        </div>

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="mt-7 flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={creating} className={`rounded-xl px-4 py-2.5 text-sm ${isDark ? 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}>取消</button>
          <button type="submit" disabled={creating || !name.trim()} className="flex min-w-24 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
            {creating && <Loader2 size={15} className="animate-spin" />}
            创建项目
          </button>
        </div>
      </form>
    </div>
  );
};
