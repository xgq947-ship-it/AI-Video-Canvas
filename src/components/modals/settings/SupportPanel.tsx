import React, { useState } from 'react';
import { MessageCircle } from 'lucide-react';

/**
 * 二维码放在 public/ 下，vite build 会原样拷进 dist/，打包后由 express.static(dist)
 * 提供。图片不存在时不留一个破图占位，而是直接说明该把文件放在哪。
 */
const WECHAT_QR_SRC = '/support/wechat-qr.png';

interface SupportPanelProps {
    isDark: boolean;
}

export const SupportPanel: React.FC<SupportPanelProps> = ({ isDark }) => {
    const [qrFailed, setQrFailed] = useState(false);

    return (
        <div className="flex flex-col items-center py-6 text-center">
            <div className={`flex h-16 w-16 items-center justify-center rounded-full ${isDark ? 'bg-white text-black' : 'bg-neutral-900 text-white'}`}>
                <MessageCircle size={30} />
            </div>

            <h3 className="mt-5 text-lg font-semibold">支持 Evan</h3>
            <p className={`mt-2 max-w-md text-xs leading-6 ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>
                这个项目现在是、将来也会完全免费：没有订阅，没有广告。
                如果 Evan 帮到了你，欢迎扫码加我微信，聊聊你在用它做什么、哪里还不好用。
            </p>

            <div className={`mt-6 rounded-3xl border p-4 ${isDark ? 'border-white/10 bg-white/[0.03]' : 'border-neutral-200 bg-neutral-50'}`}>
                {qrFailed ? (
                    <div className={`flex h-56 w-56 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-5 text-[11px] leading-5 ${isDark ? 'border-white/15 text-neutral-500' : 'border-neutral-300 text-neutral-500'}`}>
                        <span>还没有放二维码图片</span>
                        <code className={`rounded px-1.5 py-0.5 text-[10px] ${isDark ? 'bg-white/10 text-neutral-300' : 'bg-neutral-200 text-neutral-700'}`}>
                            public/support/wechat-qr.png
                        </code>
                        <span>把图片放到这个路径，重新构建即可显示。</span>
                    </div>
                ) : (
                    <img
                        src={WECHAT_QR_SRC}
                        alt="微信二维码"
                        onError={() => setQrFailed(true)}
                        className="h-56 w-56 rounded-2xl bg-white object-contain"
                    />
                )}
            </div>

            {/* 「扫二维码，添加我为朋友」已经印在图片里，这里不再重复一遍。 */}
        </div>
    );
};
