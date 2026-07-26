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
    }
});
