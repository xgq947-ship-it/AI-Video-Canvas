export declare const DEFAULT_BACKEND_RESTART_MESSAGE: string;

export declare function readApiResponse<T = unknown>(
  response: Response,
  fallbackMessage: string
): Promise<T | undefined>;
