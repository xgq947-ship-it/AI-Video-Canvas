import React, { useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';

interface GenerationCancelButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  dark: boolean;
  onCancel: () => void | Promise<void>;
  label?: string;
}

/** 导演工作流镜头使用的轻量取消按钮。 */
export const GenerationCancelButton: React.FC<GenerationCancelButtonProps> = ({
  dark,
  onCancel,
  label = '取消生成',
  className = '',
  onClick,
  ...props
}) => {
  const [cancelling, setCancelling] = useState(false);

  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || cancelling) return;
    setCancelling(true);
    try {
      await onCancel();
    } catch {
      // 上层负责展示取消失败；按钮在这里恢复可点击。
    } finally {
      setCancelling(false);
    }
  };

  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || cancelling}
      onClick={handleClick}
      onPointerDown={event => event.stopPropagation()}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        dark
          ? 'border-red-400/30 bg-red-500/10 text-red-300 hover:bg-red-500/20'
          : 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
      } ${className}`}
    >
      {cancelling ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
      {cancelling ? '正在取消…' : label}
    </button>
  );
};
