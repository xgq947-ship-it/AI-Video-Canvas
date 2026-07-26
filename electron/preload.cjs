const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('evanDesktop', {
    selectProjectLocation: () => ipcRenderer.invoke('project:select-location'),
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
    getAppInfo: () => ipcRenderer.invoke('app:info'),
    chrome: {
        getStatus: () => ipcRenderer.invoke('chrome:get-status'),
        openDownload: () => ipcRenderer.invoke('chrome:open-download'),
        retry: () => ipcRenderer.invoke('chrome:retry')
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
