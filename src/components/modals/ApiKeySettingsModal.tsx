import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, Trash2, Wand2, X } from 'lucide-react';

interface ApiKeyField {
    name: string;
    provider: string;
    label: string;
    secret: boolean;
    configured: boolean;
    source: 'manual' | 'environment' | 'none';
    maskedValue: string;
}

interface OptimizerProvider {
    id: string;
    label: string;
    apiKeyField: string | null;
    defaultModel: string;
    keyConfigured: boolean;
}

interface ApiKeySettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    canvasTheme: 'dark' | 'light';
}

export const ApiKeySettingsModal: React.FC<ApiKeySettingsModalProps> = ({ isOpen, onClose, canvasTheme }) => {
    const [fields, setFields] = useState<ApiKeyField[]>([]);
    const [values, setValues] = useState<Record<string, string>>({});
    const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());
    const [clearFields, setClearFields] = useState<Set<string>>(new Set());
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const [optimizerProviders, setOptimizerProviders] = useState<OptimizerProvider[]>([]);
    const [optimizerProvider, setOptimizerProvider] = useState('deepseek');
    const [optimizerModel, setOptimizerModel] = useState('');
    const [initialOptimizer, setInitialOptimizer] = useState<{ provider: string; model: string }>({ provider: 'deepseek', model: '' });

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setIsLoading(true);
        setError('');
        setSaved(false);
        setValues({});
        setClearFields(new Set());

        Promise.all([
            fetch('/api/settings/api-keys').then(async response => {
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || '读取 API 配置失败');
                if (!cancelled) setFields(result.fields || []);
            }),
            fetch('/api/settings/optimizer').then(async response => {
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || '读取优化后端配置失败');
                if (!cancelled) {
                    setOptimizerProviders(result.providers || []);
                    const current = result.current || { provider: 'deepseek', model: '' };
                    setOptimizerProvider(current.provider);
                    setOptimizerModel(current.model || '');
                    setInitialOptimizer({ provider: current.provider, model: current.model || '' });
                }
            })
        ])
            .catch(fetchError => {
                if (!cancelled) setError(fetchError.message || '读取配置失败');
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false);
            });

        return () => { cancelled = true; };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const groups = useMemo(() => {
        const grouped = new Map<string, ApiKeyField[]>();
        fields.forEach(field => {
            const current = grouped.get(field.provider) || [];
            current.push(field);
            grouped.set(field.provider, current);
        });
        return Array.from(grouped.entries());
    }, [fields]);

    const apiKeyDirty = Object.values(values).some(value => value.trim()) || clearFields.size > 0;
    const optimizerDirty = optimizerProvider !== initialOptimizer.provider || optimizerModel.trim() !== initialOptimizer.model;
    const hasChanges = apiKeyDirty || optimizerDirty;
    const selectedOptimizer = optimizerProviders.find(provider => provider.id === optimizerProvider);
    const isDark = canvasTheme === 'dark';

    const handleValueChange = (name: string, value: string) => {
        setValues(current => ({ ...current, [name]: value }));
        setClearFields(current => {
            const next = new Set(current);
            next.delete(name);
            return next;
        });
        setSaved(false);
    };

    const toggleClear = (name: string) => {
        setClearFields(current => {
            const next = new Set(current);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
        setValues(current => ({ ...current, [name]: '' }));
        setSaved(false);
    };

    const handleSave = async () => {
        if (!hasChanges || isSaving) return;
        setIsSaving(true);
        setError('');
        setSaved(false);

        try {
            if (apiKeyDirty) {
                const changedValues = Object.fromEntries(
                    Object.entries(values).filter(([, value]) => value.trim())
                );
                const response = await fetch('/api/settings/api-keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ values: changedValues, clear: Array.from(clearFields) })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'API 密钥保存失败');
                setFields(result.fields || []);
                setValues({});
                setClearFields(new Set());
            }

            if (optimizerDirty) {
                const response = await fetch('/api/settings/optimizer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider: optimizerProvider, model: optimizerModel.trim() })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || '优化后端保存失败');
                const current = result.current || { provider: optimizerProvider, model: optimizerModel.trim() };
                setOptimizerProvider(current.provider);
                setOptimizerModel(current.model || '');
                setInitialOptimizer({ provider: current.provider, model: current.model || '' });
            }

            setSaved(true);
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : '保存失败');
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className={`w-full max-w-[720px] max-h-[82vh] overflow-hidden rounded-2xl border shadow-2xl ${isDark ? 'border-neutral-700 bg-[#181818] text-white' : 'border-neutral-200 bg-white text-neutral-900'}`}>
                <div className={`flex items-start justify-between border-b px-6 py-5 ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}>
                    <div className="flex items-start gap-3">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isDark ? 'bg-blue-500/15 text-blue-400' : 'bg-blue-50 text-blue-600'}`}>
                            <KeyRound size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold">配置 API 密钥</h2>
                            <p className={`mt-1 text-xs ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>密钥仅保存在本机，不会写入项目文件或返回完整明文。</p>
                        </div>
                    </div>
                    <button onClick={onClose} className={`rounded-lg p-2 transition-colors ${isDark ? 'text-neutral-500 hover:bg-neutral-800 hover:text-white' : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-900'}`} aria-label="关闭 API 配置">
                        <X size={18} />
                    </button>
                </div>

                <div className="max-h-[calc(82vh-150px)] overflow-y-auto px-6 py-5">
                    {isLoading ? (
                        <div className="flex h-48 items-center justify-center gap-2 text-sm text-neutral-500"><Loader2 size={18} className="animate-spin" />正在读取配置</div>
                    ) : (
                        <div className="space-y-4">
                            {/* 提示词优化后端选择 */}
                            <section className={`rounded-xl border p-4 ${isDark ? 'border-neutral-800 bg-[#202020]' : 'border-neutral-200 bg-neutral-50'}`}>
                                <div className="mb-1 flex items-center gap-2">
                                    <Wand2 size={14} className={isDark ? 'text-purple-400' : 'text-purple-600'} />
                                    <h3 className="text-sm font-medium">提示词优化后端</h3>
                                </div>
                                <p className={`mb-3 text-[11px] ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>
                                    图片 / 视频节点“优化提示词”用哪个模型生成。CLI 后端用本机已登录的工具、无需密钥，但速度慢于云端 API。
                                </p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label htmlFor="optimizer-provider" className={`mb-1.5 block text-xs ${isDark ? 'text-neutral-300' : 'text-neutral-600'}`}>后端</label>
                                        <select
                                            id="optimizer-provider"
                                            value={optimizerProvider}
                                            onChange={event => { setOptimizerProvider(event.target.value); setSaved(false); }}
                                            className={`h-10 w-full rounded-lg border bg-transparent px-3 text-sm outline-none transition-colors ${isDark ? 'border-neutral-700 text-white focus:border-blue-500' : 'border-neutral-300 text-neutral-900 focus:border-blue-500'}`}
                                        >
                                            {optimizerProviders.map(provider => (
                                                <option key={provider.id} value={provider.id} className={isDark ? 'bg-[#202020]' : ''}>{provider.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label htmlFor="optimizer-model" className={`mb-1.5 block text-xs ${isDark ? 'text-neutral-300' : 'text-neutral-600'}`}>模型（可选）</label>
                                        <input
                                            id="optimizer-model"
                                            type="text"
                                            value={optimizerModel}
                                            onChange={event => { setOptimizerModel(event.target.value); setSaved(false); }}
                                            autoComplete="off"
                                            spellCheck={false}
                                            placeholder={selectedOptimizer?.defaultModel ? `默认：${selectedOptimizer.defaultModel}` : '留空用后端默认'}
                                            className={`h-10 w-full rounded-lg border bg-transparent px-3 text-sm outline-none transition-colors ${isDark ? 'border-neutral-700 text-white placeholder-neutral-600 focus:border-blue-500' : 'border-neutral-300 text-neutral-900 placeholder-neutral-400 focus:border-blue-500'}`}
                                        />
                                    </div>
                                </div>
                                {selectedOptimizer && !selectedOptimizer.keyConfigured && (
                                    <p className="mt-2 text-[11px] text-amber-400">该后端需要在下方填写 {selectedOptimizer.apiKeyField} 才能使用。</p>
                                )}
                            </section>

                            {groups.map(([provider, providerFields]) => (
                                <section key={provider} className={`rounded-xl border p-4 ${isDark ? 'border-neutral-800 bg-[#202020]' : 'border-neutral-200 bg-neutral-50'}`}>
                                    <div className="mb-3 flex items-center justify-between">
                                        <h3 className="text-sm font-medium">{provider}</h3>
                                        {providerFields.every(field => field.configured) && (
                                            <span className="flex items-center gap-1 text-[11px] text-emerald-400"><CheckCircle2 size={12} />已配置</span>
                                        )}
                                    </div>
                                    <div className="space-y-3">
                                        {providerFields.map(field => {
                                            const markedForClear = clearFields.has(field.name);
                                            return (
                                                <div key={field.name}>
                                                    <div className="mb-1.5 flex items-center justify-between gap-3">
                                                        <label htmlFor={`api-key-${field.name}`} className={`text-xs ${isDark ? 'text-neutral-300' : 'text-neutral-600'}`}>{field.label}</label>
                                                        <div className="flex items-center gap-2">
                                                            {field.configured && !markedForClear && (
                                                                <span className={`text-[10px] ${field.source === 'manual' ? 'text-blue-400' : 'text-neutral-500'}`}>{field.source === 'manual' ? '手动配置' : '.env 配置'} · {field.maskedValue}</span>
                                                            )}
                                                            {field.source === 'manual' && (
                                                                <button type="button" onClick={() => toggleClear(field.name)} className={`rounded p-1 transition-colors ${markedForClear ? 'bg-red-500/15 text-red-400' : 'text-neutral-500 hover:bg-neutral-700 hover:text-red-400'}`} title={markedForClear ? '取消清除' : '清除手动配置'}>
                                                                    <Trash2 size={13} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="relative">
                                                        <input
                                                            id={`api-key-${field.name}`}
                                                            type={field.secret && !visibleFields.has(field.name) ? 'password' : 'text'}
                                                            value={values[field.name] || ''}
                                                            onChange={event => handleValueChange(field.name, event.target.value)}
                                                            disabled={markedForClear}
                                                            autoComplete="off"
                                                            spellCheck={false}
                                                            placeholder={markedForClear ? '保存后清除手动配置' : field.configured ? '输入新值以替换当前配置' : '请输入密钥'}
                                                            className={`h-10 w-full rounded-lg border bg-transparent px-3 pr-10 text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isDark ? 'border-neutral-700 text-white placeholder-neutral-600 focus:border-blue-500' : 'border-neutral-300 text-neutral-900 placeholder-neutral-400 focus:border-blue-500'}`}
                                                        />
                                                        {field.secret && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setVisibleFields(current => {
                                                                    const next = new Set(current);
                                                                    if (next.has(field.name)) next.delete(field.name);
                                                                    else next.add(field.name);
                                                                    return next;
                                                                })}
                                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                                                                aria-label={visibleFields.has(field.name) ? '隐藏密钥' : '显示密钥'}
                                                            >
                                                                {visibleFields.has(field.name) ? <EyeOff size={15} /> : <Eye size={15} />}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </section>
                            ))}
                        </div>
                    )}
                </div>

                <div className={`flex items-center justify-between border-t px-6 py-4 ${isDark ? 'border-neutral-800 bg-[#151515]' : 'border-neutral-200 bg-neutral-50'}`}>
                    <div className="min-h-5 text-xs">
                        {error && <span className="text-red-400">{error}</span>}
                        {saved && <span className="flex items-center gap-1 text-emerald-400"><ShieldCheck size={14} />已保存并立即生效</span>}
                    </div>
                    <div className="flex gap-2">
                        <button onClick={onClose} className={`rounded-lg px-4 py-2 text-sm transition-colors ${isDark ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700' : 'bg-white text-neutral-600 hover:bg-neutral-100'}`}>关闭</button>
                        <button onClick={handleSave} disabled={!hasChanges || isSaving} className="flex min-w-24 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40">
                            {isSaving && <Loader2 size={14} className="animate-spin" />}
                            {isSaving ? '保存中' : '保存修改'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
