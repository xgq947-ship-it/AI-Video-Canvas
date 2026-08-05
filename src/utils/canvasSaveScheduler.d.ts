export interface CanvasSaveScheduler {
    request(): boolean;
    flush(): boolean;
    cancel(): boolean;
    readonly pending: boolean;
    stop(): void;
}

export function createCanvasSaveScheduler(options: {
    delayMs: number;
    save: () => Promise<void> | void;
    onError?: (error: unknown) => void;
    setTimer?: typeof setTimeout;
    clearTimer?: typeof clearTimeout;
}): CanvasSaveScheduler;
