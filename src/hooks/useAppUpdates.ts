/**
 * useAppUpdates.ts
 *
 * 应用版本信息 + 更新状态。
 *
 * 平台差异（由主进程的 canInstallInApp 决定，前端不自己判断平台）：
 * - Windows：可以在应用内下载并安装。
 * - macOS：包未签名，Squirrel.Mac 会拒绝安装，所以只检查版本、跳转 GitHub 下载页。
 *
 * 浏览器开发模式下没有 window.evanDesktop，此时 status 恒为 'unsupported'，
 * 版本号回退到构建时注入的 __APP_VERSION__。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UpdateState } from '../types/electron';
import changelogData from '../../CHANGELOG.json';

export interface ChangelogEntry {
    version: string;
    date: string;
    summary?: string;
    added?: string[];
    improved?: string[];
    fixed?: string[];
}

export const CHANGELOG: ChangelogEntry[] = changelogData as ChangelogEntry[];

const fallbackState = (currentVersion: string): UpdateState => ({
    status: 'unsupported',
    version: null,
    currentVersion,
    percent: 0,
    message: '请在桌面应用中检查更新',
    canInstallInApp: false,
    releasesUrl: 'https://github.com/xgq947-ship-it/AI-Video-Canvas/releases/latest',
    checkedAt: null
});

export const useAppUpdates = () => {
    const desktop = typeof window !== 'undefined' ? window.evanDesktop : undefined;
    const [appVersion, setAppVersion] = useState<string>(__APP_VERSION__);
    const [update, setUpdate] = useState<UpdateState>(() => fallbackState(__APP_VERSION__));
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        if (!desktop) return;
        let cancelled = false;

        void desktop.getAppInfo().then(info => {
            if (!cancelled) setAppVersion(info.version);
        }).catch(() => { /* 拿不到就用构建时注入的版本 */ });

        void desktop.updates.getState().then(state => {
            if (!cancelled) setUpdate(state);
        }).catch(() => { /* 保持回退状态 */ });

        // 主进程会主动推状态（启动静默检查、下载进度等），必须订阅而不是轮询。
        const unsubscribe = desktop.updates.onStatus(state => {
            if (!cancelled) setUpdate(state);
        });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [desktop]);

    const check = useCallback(async () => {
        if (!desktop) return;
        setUpdate(previous => ({ ...previous, status: 'checking', message: '' }));
        await desktop.updates.check().catch(() => { /* 状态由主进程推 */ });
    }, [desktop]);

    const download = useCallback(async () => {
        if (!desktop) return;
        await desktop.updates.download().catch(() => { /* 状态由主进程推 */ });
    }, [desktop]);

    const install = useCallback(async () => {
        if (!desktop) return;
        await desktop.updates.install().catch(() => { /* 应用即将重启 */ });
    }, [desktop]);

    const openDownloadPage = useCallback(async () => {
        if (!desktop) {
            window.open(update.releasesUrl, '_blank', 'noopener');
            return;
        }
        await desktop.updates.openDownloadPage().catch(() => { /* ignore */ });
    }, [desktop, update.releasesUrl]);

    // 有新版可装时才提示：设置按钮上的小红点用这个。
    const hasPendingUpdate = update.status === 'available' || update.status === 'ready';

    const currentEntry = CHANGELOG.find(entry => entry.version === appVersion) || CHANGELOG[0];

    return {
        appVersion,
        update,
        hasPendingUpdate,
        changelog: CHANGELOG,
        currentEntry,
        isDesktop: Boolean(desktop),
        check,
        download,
        install,
        openDownloadPage
    };
};
