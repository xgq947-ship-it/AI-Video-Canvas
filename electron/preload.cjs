const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('evanDesktop', {
    selectProjectLocation: () => ipcRenderer.invoke('project:select-location'),
    selectLocalProject: () => ipcRenderer.invoke('project:select-local'),
    selectCodexCli: () => ipcRenderer.invoke('codex:select-cli'),
    openExternal: async (url) => {
        const result = await ipcRenderer.invoke('external:open', url);
        if (!result?.ok) throw new Error(result?.error || '无法打开外部链接');
    },
    createProject: async (input) => {
        const result = await ipcRenderer.invoke('project:create', input);
        if (!result?.ok) throw new Error(result?.error || '项目创建失败');
        return result.data;
    },
    importLocalProject: async (importId) => {
        const result = await ipcRenderer.invoke('project:import-local', { importId });
        if (!result?.ok) throw new Error(result?.error || '本地项目导入失败');
        return result.data;
    },
    revealProject: async (workflowId) => {
        const result = await ipcRenderer.invoke('project:reveal', workflowId);
        if (!result?.ok) throw new Error(result?.error || '无法打开项目目录');
        return result;
    },
    exportDetailRemix: async (input) => {
        const result = await ipcRenderer.invoke('detail-remix:export', input);
        if (!result?.ok) throw new Error(result?.error || '详情图导出失败');
        return result.data;
    },
    getAppInfo: () => ipcRenderer.invoke('app:info'),
    uninstall: {
        /** 只算路径不动手，用于在界面上如实列出会被扔掉的东西。 */
        plan: (keepUserData) => ipcRenderer.invoke('app:uninstall-plan', keepUserData),
        run: (keepUserData) => ipcRenderer.invoke('app:uninstall', keepUserData)
    },
    chrome: {
        getStatus: () => ipcRenderer.invoke('chrome:get-status'),
        openDownload: () => ipcRenderer.invoke('chrome:open-download'),
        retry: () => ipcRenderer.invoke('chrome:retry')
    },
    auth: {
        getConfig: () => ipcRenderer.invoke('auth:get-config'),
        getState: () => ipcRenderer.invoke('auth:get-state'),
        signIn: () => ipcRenderer.invoke('auth:sign-in'),
        signOut: () => ipcRenderer.invoke('auth:sign-out'),
        /** 订阅主进程推送的登录状态；返回取消订阅函数。 */
        onState: (callback) => {
            const listener = (_event, payload) => callback(payload);
            ipcRenderer.on('desktop:auth-state', listener);
            return () => ipcRenderer.removeListener('desktop:auth-state', listener);
        }
    },
    device: {
        getInfo: () => ipcRenderer.invoke('device:get-info')
    },
    license: {
        getState: () => ipcRenderer.invoke('license:get-state'),
        refresh: () => ipcRenderer.invoke('license:refresh'),
        activate: (licenseCode) => ipcRenderer.invoke('license:activate', licenseCode),
        /** 订阅主进程推送的试用/授权状态；返回取消订阅函数。 */
        onState: (callback) => {
            const listener = (_event, payload) => callback(payload);
            ipcRenderer.on('desktop:license-state', listener);
            return () => ipcRenderer.removeListener('desktop:license-state', listener);
        }
    },
    updates: {
        getState: () => ipcRenderer.invoke('update:get-state'),
        check: () => ipcRenderer.invoke('update:check'),
        download: () => ipcRenderer.invoke('update:download'),
        install: () => ipcRenderer.invoke('update:install'),
        openDownloadPage: () => ipcRenderer.invoke('update:open-download-page'),
        /** 订阅主进程推送的更新状态；返回取消订阅函数。 */
        onStatus: (callback) => {
            const listener = (_event, payload) => callback(payload);
            ipcRenderer.on('desktop:update-status', listener);
            return () => ipcRenderer.removeListener('desktop:update-status', listener);
        }
    }
});
