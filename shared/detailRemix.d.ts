export type DetailRemixInputPort =
  | 'competitor-detail'
  | 'own-detail'
  | 'character-reference'
  | 'product-reference'
  | 'brand-logo';

export interface DetailRemixInputRefs {
  competitorDetailNodeIds: string[];
  ownDetailNodeIds: string[];
  characterReference: { enabled: boolean; nodeIds: string[] };
  productNodeIds: string[];
  brandLogoNodeIds: string[];
}

export interface DetailRemixProductSheetCell {
  index: number;
  label: string;
}

export interface DetailRemixProductSheet {
  rows: number;
  columns: number;
  cells: DetailRemixProductSheetCell[];
}

export interface DetailRemixFolderImportState {
  folderName: string;
  status: 'idle' | 'uploading' | 'completed' | 'partial_failed' | 'failed';
  total: number;
  uploaded: number;
  failed: number;
  nodeIds: string[];
  startedAt?: string;
  completedAt?: string;
}

export interface DetailRemixQueueSection {
  status: string;
  total: number;
  completed: number;
  failed: number;
  currentIndex?: number;
}

export interface DetailRemixNodeData {
  schemaVersion: 1;
  inputRefs: DetailRemixInputRefs;
  folderImports: {
    competitor: DetailRemixFolderImportState;
    own: DetailRemixFolderImportState;
  };
  queueProgress: {
    ownKnowledge: DetailRemixQueueSection & { sellingPointCount: number };
    competitor: DetailRemixQueueSection;
    composition: DetailRemixQueueSection;
  };
  analysis: { ownSellingPoints: any[]; pages: any[]; [key: string]: any };
  recognitionProvider: 'gemini-web' | 'codex-cli';
  /** Paid full re-generations allowed after a targeted repair still fails quality control. */
  maxStructuralRegenerations: 0 | 1 | 2 | 3;
  /** Rank the user's own product references ahead of auto-cropped views. */
  preferSuppliedProductReferences: boolean;
  /** 卖点与精确参数的自由文本；填了就不再必须导入我方详情图。 */
  productBrief: string;
  /** Optional manual override of the grid manifest; empty means detect it from the picture. */
  productSheet: DetailRemixProductSheet | null;
  /** What the last run actually read off the supplied reference. Display only. */
  detectedProductSheet: DetailRemixProductSheet | null;
  productSheetWarnings: string[];
  status: 'idle' | 'ready' | 'analyzing' | 'generating-final' | 'generating-plates' | 'plates-ready' | 'composing' | 'completed' | 'outdated' | 'cancelled' | 'error';
  jobId?: string;
  pendingRequestId?: string;
  pendingRequestFingerprint?: string;
  activeInputFingerprint?: string;
  jobStatus?: string;
  stage?: string;
  stageLabel?: string;
  recognitionModel?: string;
  currentPageIndex?: number;
  pageCount?: number;
  version?: number;
  productViewCount?: number;
  verifiedFactCount?: number;
  needsRegeneration?: boolean;
  compositionNeedsRegeneration?: boolean;
  lastJobUpdatedAt?: string;
  errorMessage?: string;
  [key: string]: any;
}

export const DETAIL_REMIX_SCHEMA_VERSION: 1;
export const DETAIL_REMIX_STRICT_PARAMETER_MODE: 'STRICT_PARAMETER_MODE';
export const DETAIL_REMIX_MARKETING_MODE: 'MARKETING_MODE';
export const DETAIL_REMIX_STRICT_FACT_MIN_CONFIDENCE: number;
export const DETAIL_REMIX_STRICT_PARAMETER_TAIL_PAGE_COUNT: 2;
export const DETAIL_REMIX_STRICT_PAGE_CATEGORIES: readonly string[];
export const DETAIL_REMIX_NODE_WIDTH: 460;
export const DETAIL_REMIX_NODE_HEIGHT: 620;
export const DETAIL_REMIX_INPUT_PORTS: readonly DetailRemixInputPort[];
export const DETAIL_REMIX_PORT_LABELS: Readonly<Record<DetailRemixInputPort, string>>;
export const DETAIL_REMIX_STATUSES: readonly string[];
export const DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA: Readonly<Record<string, any>>;
export const DETAIL_REMIX_OWN_KNOWLEDGE_OUTPUT_SCHEMA: Readonly<Record<string, any>>;
export const DETAIL_REMIX_FINAL_VALIDATION_OUTPUT_SCHEMA: Readonly<Record<string, any>>;
export const DETAIL_REMIX_ADVISORY_VALIDATION_KEYS: readonly string[];
export const DETAIL_REMIX_VALIDATION_FAILURE_LABELS: Readonly<Record<string, string>>;
export function classifyFinalDetailValidation(validation?: any): {
  blocking: string[];
  advisory: string[];
  passed: boolean;
  advisoryOnly: boolean;
};
export function describeFinalDetailValidationFailures(keys?: any): string[];
export function buildFinalDetailRegenerationPrompt(options?: any): string;
export function canonicalDetailRemixFactField(value: any, label?: any): string;
export function normalizeDetailRemixFactValue(value: any): string;
export function detailRemixAllowsStrictParameterMode(pageIndex?: number, pageCount?: number): boolean;
export function detailRemixPageMode(value?: any): 'STRICT_PARAMETER_MODE' | 'MARKETING_MODE';
export function isDetailRemixStrictParameterPage(value?: any): boolean;
export function detailRemixStrictPageCategory(value?: any): string;
export function normalizeDetailRemixInputRefs(value?: any): DetailRemixInputRefs;
export function createDetailRemixNodeData(overrides?: Partial<DetailRemixNodeData> | any): DetailRemixNodeData;
export const normalizeDetailRemixNodeData: typeof createDetailRemixNodeData;
export function syncDetailRemixInputRefs(node: any, inputPortByParentId?: Record<string, string>): any;
export function assignDetailRemixInputPort(node: any, parent: any, requestedPort?: string): any;
export function buildDetailRemixInputMapping(inputRefs?: any): Record<string, DetailRemixInputPort>;
export function activeDetailRemixInputRefs(value?: any): DetailRemixInputRefs & { characterReference: { enabled: boolean; nodeIds: string[]; activeNodeIds: string[] } };
export function detailRemixInputFingerprint(value?: any): string;
export function validateDetailRemixPreflight(value: any, nodes: any[], options?: { phase?: 'final' | 'plates' | 'composition' }): { ok: boolean; error?: string; refs?: any };
export function markDetailRemixDependentsStale(nodes: any[], changedNodeId: string): any[];
export function parseOwnSellingPointsResponse(value: any): any;
export function parseCompetitorPageResponse(value: any): any;
export function parseFinalDetailValidationResponse(value: any): any;
export const MAX_DETAIL_REMIX_PRODUCT_SHEET_CELLS: number;
export function normalizeDetailRemixProductSheet(value?: any): DetailRemixProductSheet | null;
export function parseProductSheetResponse(value: any): any;
export const DETAIL_REMIX_PRODUCT_BRIEF_OUTPUT_SCHEMA: any;
export const DETAIL_REMIX_STRICT_FIELD_KEYS: readonly string[];
export function buildProductBriefInstruction(): string;
export function parseProductBriefResponse(value: any): {
  brandIdentity: { name: string; slogan: string };
  sellingPoints: Array<{ id: string; title: string; description: string }>;
  verifiedFacts: Array<Record<string, any>>;
};
export function productSheetFromDetection(detection?: any): DetailRemixProductSheet | null;
export function buildProductSheetInstruction(): string;
export const DETAIL_REMIX_PRODUCT_SHEET_OUTPUT_SCHEMA: any;
export function describeDetailRemixProductSheet(sheet?: any, referenceLabel?: string): string;
export function buildOwnSellingPointsInstruction(options?: any): string;
export function buildCompetitorPageInstruction(options?: any): string;
export function buildDetailCopyReplacementPlan(options?: any): any[];
export function buildFinalDetailPrompt(options?: any): string;
export function buildFinalDetailValidationInstruction(options?: any): string;
export function buildFinalDetailRepairPrompt(options?: any): string;
