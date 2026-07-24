export {};

declare global {
  interface Window {
    evanDesktop?: {
      selectProjectLocation: () => Promise<
        | { canceled: true }
        | { canceled: false; locationId: string; path: string }
      >;
      createProject: (input: {
        title: string;
        locationId?: string | null;
      }) => Promise<{
        id: string;
        title: string;
        projectDirName?: string;
        projectPath?: string;
        nodes: unknown[];
        groups: unknown[];
        viewport: { x: number; y: number; zoom: number };
      }>;
    };
  }
}
