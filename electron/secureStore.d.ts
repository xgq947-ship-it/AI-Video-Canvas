export interface SecureStore {
  /** safeStorage 加密是否可用（不可用时 set 会抛错，绝不明文落盘） */
  isAvailable(): boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export function createSecureStore(options: {
  dir: string;
  fileName?: string;
}): SecureStore;
