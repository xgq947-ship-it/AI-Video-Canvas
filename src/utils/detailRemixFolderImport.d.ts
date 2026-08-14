export interface DetailRemixFolderFileLike {
  name?: string;
  webkitRelativePath?: string;
  relativePath?: string;
}

export type DetailRemixFolderRole = 'competitor' | 'own';

export const DETAIL_REMIX_IMPORT_NODE_WIDTH: number;
export const DETAIL_REMIX_IMPORT_COLUMN_GAP: number;
export const DETAIL_REMIX_IMPORT_ROW_GAP: number;
export const DETAIL_REMIX_IMPORT_CONTROLLER_GAP: number;
export const DETAIL_REMIX_IMPORT_LAYOUT_VERSION: number;

export function detailRemixFolderFilePath(file: DetailRemixFolderFileLike): string;
export function isVisibleDetailRemixFolderFile(file: DetailRemixFolderFileLike): boolean;
export function sortDetailRemixFolderFiles<T extends DetailRemixFolderFileLike>(files: T[]): T[];
export function detailRemixFolderName(files: DetailRemixFolderFileLike[], fallback?: string): string;
export function buildDetailRemixFolderPlacements(
  controller: { x?: number; y?: number },
  role: DetailRemixFolderRole,
  count: number,
): Array<{ x: number; y: number }>;
export function buildDetailRemixFolderRowPlacements(
  controller: { x?: number; y?: number },
  rows: {
    own?: Array<{ id: string; resultAspectRatio?: string; aspectRatio?: string }>;
    competitor?: Array<{ id: string; resultAspectRatio?: string; aspectRatio?: string }>;
  },
): {
  own: Array<{ id: string; x: number; y: number }>;
  competitor: Array<{ id: string; x: number; y: number }>;
};
export function reflowDetailRemixFolderNodes<T extends {
  id: string;
  x?: number;
  y?: number;
  detailRemix?: any;
  detailRemixImport?: {
    controllerNodeId: string;
    role: DetailRemixFolderRole;
    layoutVersion?: number;
    [key: string]: unknown;
  };
  resultAspectRatio?: string;
  aspectRatio?: string;
}>(nodes: T[], controllerId: string): T[];
export function migrateDetailRemixFolderLayouts<T extends {
  id: string;
  x?: number;
  y?: number;
  detailRemix?: any;
  detailRemixImport?: {
    controllerNodeId: string;
    role: DetailRemixFolderRole;
    layoutVersion?: number;
    [key: string]: unknown;
  };
  resultAspectRatio?: string;
  aspectRatio?: string;
}>(nodes: T[]): T[];
