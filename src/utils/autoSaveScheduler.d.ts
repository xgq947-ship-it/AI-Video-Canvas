export interface AutoSaveSchedulerState {
    isDirty: boolean;
    nodeCount: number;
    save: (() => Promise<void>) | null;
}

export interface AutoSaveSchedulerOptions {
    intervalMs: number;
    getState: () => AutoSaveSchedulerState;
    onSaved?: () => void;
    setTimer?: (handler: () => void, timeout: number) => any;
    clearTimer?: (handle: any) => void;
    logger?: Pick<Console, 'error'> | null;
}

export interface AutoSaveScheduler {
    tick: () => Promise<void>;
    stop: () => void;
}

export function createAutoSaveScheduler(options: AutoSaveSchedulerOptions): AutoSaveScheduler;
