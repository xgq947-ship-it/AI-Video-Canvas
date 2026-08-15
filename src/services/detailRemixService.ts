/** Frontend contract for the single-generation e-commerce detail remix job. */

import type { DetailRemixProductSheet } from '../../shared/detailRemix';

export type DetailRemixRecognitionProvider = 'auto' | 'codex-cli' | 'gemini-web';

export type DetailRemixJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'partial_failed'
  | 'failed'
  | 'cancelled'
  | 'recovery_required';

export type DetailRemixJobStage =
  | 'queued'
  | 'extracting_selling_points'
  | 'detecting_product_sheet'
  | 'analyzing_competitor'
  | 'generating_final'
  | 'validating_final'
  | 'revalidating_final'
  | 'repairing_final'
  | 'regenerating_final'
  | 'failed_validation'
  | 'final_partial_failed'
  // Legacy stages remain in the read contract for existing saved jobs.
  | 'generating_plates'
  | 'plates_completed'
  | 'plates_partial_failed'
  | 'composition_queued'
  | 'composing_products'
  | 'composition_completed'
  | 'composition_partial_failed'
  | 'composition_failed'
  | 'failed'
  | 'cancelled'
  | 'recovery_required';

export interface DetailRemixSellingPoint {
  id?: string;
  title?: string;
  description?: string;
  headline?: string;
  supportCopy?: string;
  sourceNodeIds?: string[];
  [key: string]: unknown;
}

export interface DetailRemixPageResult {
  index: number;
  queuePosition?: number;
  id?: string;
  pageId?: string;
  sourceNodeId?: string;
  sourceImage?: string;
  resultNodeId?: string;
  rawResultUrl?: string;
  finalUrl?: string;
  resultUrl?: string;
  finalPrompt?: string;
  prompt?: string;
  // Legacy two-stage fields.
  plateNodeId?: string;
  compositeNodeId?: string;
  analysis?: Record<string, unknown>;
  mappedSellingPoints?: DetailRemixSellingPoint[];
  mappedFacts?: Array<Record<string, unknown>>;
  rawPlateUrl?: string;
  plateUrl?: string;
  compositeRawUrl?: string;
  compositeUrl?: string;
  blankPrompt?: string;
  platePrompt?: string;
  composePrompt?: string;
  aspectRatio?: string;
  resultAspectRatio?: string;
  generationAspectRatio?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  outputWidth?: number;
  outputHeight?: number;
  status?: string;
  recognitionStatus?: string;
  recognitionLastError?: string;
  recognitionAttempts?: number;
  recognitionFormatRetries?: number;
  composeStatus?: string;
  codexImageJobId?: string;
  repairCodexImageJobId?: string;
  plateCodexImageJobId?: string;
  composeCodexImageJobId?: string;
  error?: string;
  validationStatus?: string;
  terminalStatus?: 'FAILED_VALIDATION' | string;
  validation?: Record<string, unknown>;
  validationAttempts?: number;
  validationRejudgeCount?: number;
  /** Advisory-only findings the page shipped with after the repair budget was spent. */
  validationWarnings?: string[];
  deliveredWithWarnings?: boolean;
  qualityFailedCandidateUrl?: string;
  repairAttempts?: number;
  structuralRegenerationAttempts?: number;
  regenerationCount?: number;
  regenerationRequestedAt?: string;
  previousResults?: Array<{
    resultNodeId?: string;
    rawResultUrl?: string;
    finalUrl?: string;
    resultUrl?: string;
    qualityFailedCandidateUrl?: string;
    status?: string;
    terminalStatus?: string;
    validation?: Record<string, unknown>;
    repairAttempts?: number;
    completedAt?: string;
    supersededAt?: string;
  }>;
}

export interface DetailRemixJob {
  id: string;
  workflowId: string;
  nodeId: string;
  status: DetailRemixJobStatus | string;
  stage: DetailRemixJobStage | string;
  phase?: 'final' | 'plates' | 'composition' | string;
  stageLabel?: string;
  recognitionProvider?: DetailRemixRecognitionProvider | string;
  recognitionModel?: string;
  imageModel?: string;
  imageResolution?: string;
  resolution?: string;
  aspectRatio?: string;
  sizingMode?: 'match-competitor' | string;
  brandIdentity?: Record<string, unknown>;
  brandLogoUrl?: string;
  /** Grid manifest the run resolved for the supplied product reference, if any. */
  productSheet?: DetailRemixProductSheet | null;
  productSheetWarnings?: string[];
  productViews?: Array<{
    id?: string;
    sourceImageIndex?: number;
    sourceNodeId?: string;
    imageUrl?: string;
    viewAngle?: string;
    visibleSides?: string[];
    description?: string;
    quality?: number;
  }>;
  verifiedFacts?: Array<{
    id?: string;
    field?: string;
    factType?: string;
    label?: string;
    value?: string;
    normalizedValue?: string;
    displayText?: string;
    sourceImageIndexes?: number[];
    evidenceImageIndex?: number;
    evidenceImageId?: string;
    evidenceRegion?: { x: number; y: number; width: number; height: number };
    confidence?: number;
    evidence?: Array<{
      evidenceImageIndex?: number;
      evidenceImageId?: string;
      evidenceRegion?: { x: number; y: number; width: number; height: number };
      confidence?: number;
      sourceText?: string;
    }>;
  }>;
  useCharacterReference?: boolean;
  characterReferenceEnabled?: boolean;
  productNodeIds?: string[];
  characterReferenceNodeIds?: string[];
  ownDetails?: Array<{ imageUrl?: string; sourceNodeId?: string; order?: number; sourceWidth?: number; sourceHeight?: number }>;
  competitorDetails?: Array<{ imageUrl?: string; sourceNodeId?: string; order?: number; sourceWidth?: number; sourceHeight?: number }>;
  ownRecognition?: {
    status?: string;
    totalImages?: number;
    processedImages?: number;
    sellingPointCount?: number;
    productViewCount?: number;
    verifiedFactCount?: number;
    knowledgeSchemaVersion?: number;
    chunks?: Array<{
      index?: number;
      startIndex?: number;
      imageCount?: number;
      sourceNodeIds?: string[];
      status?: string;
      attempts?: number;
      error?: string;
    }>;
  };
  pages: DetailRemixPageResult[];
  ownSellingPoints?: DetailRemixSellingPoint[];
  resultNodeIds?: string[];
  plannedResultNodeIds?: string[];
  plateResultNodeIds?: string[];
  compositeResultNodeIds?: string[];
  dismissedResultNodeIds?: string[];
  currentPageIndex?: number;
  currentCompositionIndex?: number;
  pageCount?: number;
  version?: number;
  cancelSubmitted?: boolean;
  cancelledChildJobIds?: string[];
  error?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateDetailRemixJobParams {
  jobId?: string;
  workflowId: string;
  nodeId: string;
  competitorImages: string[];
  competitorDetails?: Array<{
    imageUrl: string;
    nodeId: string;
    order: number;
    sourceWidth?: number;
    sourceHeight?: number;
  }>;
  ownDetailImages: string[];
  competitorNodeIds: string[];
  ownDetailNodeIds: string[];
  characterReferenceEnabled: boolean;
  characterImages?: string[];
  characterNodeIds?: string[];
  productImages?: string[];
  productNodeIds?: string[];
  recognitionProvider?: DetailRemixRecognitionProvider;
  imageModel: string;
  sizingMode?: 'match-competitor';
  aspectRatio?: string;
  resolution?: string;
  /** Paid full re-generations allowed after a targeted repair still fails quality control. */
  maxStructuralRegenerations?: number;
  /** Rank supplied product references ahead of auto-cropped views from the own detail pages. */
  preferSuppliedProductReferences?: boolean;
  /** Grid manifest describing the first supplied product reference. */
  productSheet?: DetailRemixProductSheet | null;
}

export interface ComposeDetailRemixProductsParams {
  workflowId: string;
  productImage?: string;
  productImages?: string[];
  productNodeIds?: string[];
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data?.error || fallback);
  return data;
}

export async function createDetailRemixJob(
  params: CreateDetailRemixJobParams,
): Promise<DetailRemixJob> {
  const response = await fetch('/api/detail-remix-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...params,
      // Canonical aliases keep the client compatible with jobs created while
      // the workflow contract was being rolled out.
      competitorDetails: params.competitorDetails || params.competitorImages,
      ownDetails: params.ownDetailImages,
      useCharacterReference: params.characterReferenceEnabled,
      characterReferenceImages: params.characterReferenceEnabled
        ? (params.characterImages || [])
        : [],
    }),
  });
  return readJson(response, '无法创建详情复刻任务');
}

export async function getDetailRemixJob(jobId: string, workflowId: string): Promise<DetailRemixJob> {
  const response = await fetch(
    `/api/detail-remix-jobs/${encodeURIComponent(jobId)}?workflowId=${encodeURIComponent(workflowId)}`,
    { cache: 'no-store' },
  );
  return readJson(response, '无法读取详情复刻任务');
}

export async function getLatestDetailRemixJob(
  nodeId: string,
  workflowId: string,
): Promise<DetailRemixJob | null> {
  const response = await fetch(
    `/api/detail-remix-jobs/latest?workflowId=${encodeURIComponent(workflowId)}&nodeId=${encodeURIComponent(nodeId)}`,
    { cache: 'no-store' },
  );
  if (response.status === 404) return null;
  return readJson(response, '无法读取最新详情复刻任务');
}

export async function composeDetailRemixProducts(
  jobId: string,
  params: ComposeDetailRemixProductsParams,
): Promise<DetailRemixJob> {
  const response = await fetch(`/api/detail-remix-jobs/${encodeURIComponent(jobId)}/compose-products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return readJson(response, '无法开始产品合成');
}

export async function cancelDetailRemixJob(
  jobId: string,
  workflowId: string,
): Promise<DetailRemixJob> {
  const response = await fetch(`/api/detail-remix-jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId }),
  });
  return readJson(response, '取消详情复刻任务失败');
}

export async function retryFailedDetailRemixPages(
  jobId: string,
  workflowId: string,
  pageIndexes?: number[],
): Promise<DetailRemixJob> {
  const response = await fetch(`/api/detail-remix-jobs/${encodeURIComponent(jobId)}/retry-failed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId, ...(pageIndexes?.length ? { pageIndexes } : {}) }),
  });
  return readJson(response, '无法重试失败详情页');
}

/** Accepts delivered pages and quality-failed pages alike; both already cost a paid generation. */
export async function regenerateDetailRemixPages(
  jobId: string,
  workflowId: string,
  pageIndexes: number[],
): Promise<DetailRemixJob> {
  const response = await fetch(`/api/detail-remix-jobs/${encodeURIComponent(jobId)}/regenerate-page`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId, pageIndexes }),
  });
  return readJson(response, '无法重新生成指定详情页');
}

/** Best-effort tombstone: deleting a canvas result must not be undone by recovery. */
export async function dismissDetailRemixResultNodes(
  nodeIds: string[],
  workflowId: string,
): Promise<void> {
  if (!workflowId || nodeIds.length === 0) return;
  try {
    const response = await fetch('/api/detail-remix-jobs/dismiss-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId, nodeIds }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.error('Failed to dismiss detail remix result nodes:', error);
  }
}
