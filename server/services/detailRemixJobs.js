import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

import { generateGoogleFlowWorkflowImage, isGoogleFlowImageWorkflowModel } from './googleFlowImageWorkflow.js';
import { generateJimengWorkflowImage, isJimengImageWorkflowModel } from './jimengImageWorkflow.js';
import { generateGeminiWebImage, isGeminiWebImageModel } from './geminiWebWorkflow.js';
import {
  cancelCodexImageJob,
  createCodexImageJob,
  getCodexImageJob,
} from './codexImageJobs.js';
import { getPromptOptimizerProvider } from './promptOptimizerProviders.js';
import { isOperationCancelled, operationCancelledError } from './operationCancelled.js';
import { resolveProjectMediaTarget } from '../utils/projectAssets.js';
import {
  getImageGenerationProvider,
  normalizeImageAspectRatio,
  normalizeImageResolution,
} from '../../shared/generationProviders.js';
import {
  DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA,
  DETAIL_REMIX_OWN_KNOWLEDGE_OUTPUT_SCHEMA,
  DETAIL_REMIX_FINAL_VALIDATION_OUTPUT_SCHEMA,
  DETAIL_REMIX_MARKETING_MODE,
  DETAIL_REMIX_STRICT_FACT_MIN_CONFIDENCE,
  DETAIL_REMIX_STRICT_PARAMETER_MODE,
  canonicalDetailRemixFactField,
  detailRemixAllowsStrictParameterMode,
  detailRemixPageMode,
  detailRemixStrictPageCategory,
  isDetailRemixMarketingLayoutSlot,
  isDetailRemixStrictParameterPage,
  normalizeDetailRemixFactValue,
  parseOwnSellingPointsResponse,
  parseCompetitorPageResponse,
  parseFinalDetailValidationResponse,
  normalizeDetailRemixProductSheet,
  classifyFinalDetailValidation,
  describeFinalDetailValidationFailures,
  buildOwnSellingPointsInstruction,
  buildCompetitorPageInstruction,
  buildFinalDetailPrompt,
  buildDetailCopyReplacementPlan,
  buildFinalDetailValidationInstruction,
  buildFinalDetailRepairPrompt,
  buildFinalDetailRegenerationPrompt,
  buildBlankDetailPrompt,
  buildProductComposePrompt,
} from '../../shared/detailRemix.js';

export const DEFAULT_DETAIL_REMIX_RECOGNITION_PROVIDER = 'gemini-web';
export const DEFAULT_DETAIL_REMIX_IMAGE_MODEL = 'google-flow-nano-banana-pro';
export const DETAIL_REMIX_JOB_SCHEMA_VERSION = 7;
const DETAIL_REMIX_KNOWLEDGE_SCHEMA_VERSION = 3;
const DETAIL_REMIX_COMPETITOR_ANALYSIS_VERSION = 3;
const DETAIL_REMIX_PIPELINE_VERSION = 'tail-strict-auto-copy-qa-v4';
const MAX_AUTO_PRODUCT_VIEW_REFERENCES = 3;
const MAX_FINAL_REPAIR_ATTEMPTS = 1;
/** Second opinions are recognition calls, not paid generations, so one is enough and cheap. */
const MAX_VALIDATION_REJUDGE_ATTEMPTS = 1;
/** Fresh re-generations after a structural failure. Each one costs a paid image. */
const DEFAULT_MAX_STRUCTURAL_REGENERATIONS = 1;
const MAX_STRUCTURAL_REGENERATIONS_LIMIT = 3;
const DETAIL_REMIX_RECOGNITION_TIMEOUT_MS = 10 * 60_000;
const MAX_DETAIL_REMIX_RECOGNITION_ATTEMPTS = 2;
const DEFAULT_RECOGNITION_CONCURRENCY = 2;
const MAX_RECOGNITION_CONCURRENCY = 3;
/** The quality gate submits nothing, so a failed call is always safe to repeat. */
const MAX_VALIDATION_CALL_ATTEMPTS = 3;
const VALIDATION_RETRY_DELAY_MS = 1_500;
/** Only applies where the absence of a submission can be proven. See runImageGenerationSafely. */
const MAX_UNSUBMITTED_GENERATION_RETRIES = 2;
const GENERATION_RETRY_DELAY_MS = 2_000;

// A job can be started by POST and subsequently observed by GET. Keeping the
// AbortController here lets cancel stop browser waits immediately; the durable
// JSON remains the source of truth across backend restarts.
const activeJobs = new Map();

const nowIso = context => (context.now ? context.now() : new Date().toISOString());
const newId = context => (context.newId ? context.newId() : crypto.randomUUID());

function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
  fs.renameSync(temporaryPath, filePath);
}

function safeSegment(value) {
  return String(value || 'detail-remix').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'detail-remix';
}

function getStorage(workflowId, dirs) {
  const imageTarget = resolveProjectMediaTarget(workflowId, 'images', dirs);
  const projectRoot = path.dirname(imageTarget.targetDir);
  const jobsDir = path.join(projectRoot, '.jobs', 'detail-remix');
  fs.mkdirSync(jobsDir, { recursive: true });
  return { imageTarget, projectRoot, jobsDir };
}

function jobPath(jobId, workflowId, dirs) {
  return path.join(getStorage(workflowId, dirs).jobsDir, `${safeSegment(jobId)}.json`);
}

function rebaseProjectImageUrl(value, imageTarget) {
  if (typeof value !== 'string' || !value || value.startsWith('data:')) return value;
  try {
    const parsed = new URL(value, 'http://evan.local');
    const segments = parsed.pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment));
    const projectsIndex = segments.indexOf('projects');
    if (projectsIndex < 0 || segments[projectsIndex + 2] !== 'images') return value;
    const filename = segments[projectsIndex + 3];
    if (!filename || path.basename(filename) !== filename) return value;
    return `${imageTarget.urlPrefix}/${encodeURIComponent(filename)}`;
  } catch {
    return value;
  }
}

function rebaseJobImageUrls(job, workflowId, dirs) {
  const { imageTarget } = getStorage(workflowId, dirs);
  const rebaseEntry = entry => ({
    ...entry,
    imageUrl: rebaseProjectImageUrl(entry?.imageUrl, imageTarget),
  });
  job.ownDetails = Array.isArray(job.ownDetails) ? job.ownDetails.map(rebaseEntry) : job.ownDetails;
  job.competitorDetails = Array.isArray(job.competitorDetails) ? job.competitorDetails.map(rebaseEntry) : job.competitorDetails;
  job.productImages = Array.isArray(job.productImages)
    ? job.productImages.map(value => rebaseProjectImageUrl(value, imageTarget))
    : job.productImages;
  job.characterReferenceImages = Array.isArray(job.characterReferenceImages)
    ? job.characterReferenceImages.map(value => rebaseProjectImageUrl(value, imageTarget))
    : job.characterReferenceImages;
  job.productViews = Array.isArray(job.productViews) ? job.productViews.map(view => ({
    ...view,
    imageUrl: rebaseProjectImageUrl(view?.imageUrl, imageTarget),
  })) : job.productViews;
  job.brandLogoUrl = rebaseProjectImageUrl(job.brandLogoUrl, imageTarget);
  job.pages = Array.isArray(job.pages) ? job.pages.map(page => ({
    ...page,
    sourceImage: rebaseProjectImageUrl(page.sourceImage, imageTarget),
    rawResultUrl: rebaseProjectImageUrl(page.rawResultUrl, imageTarget),
    finalUrl: rebaseProjectImageUrl(page.finalUrl, imageTarget),
    rawPlateUrl: rebaseProjectImageUrl(page.rawPlateUrl, imageTarget),
    plateUrl: rebaseProjectImageUrl(page.plateUrl, imageTarget),
    resultUrl: rebaseProjectImageUrl(page.resultUrl, imageTarget),
    compositeRawUrl: rebaseProjectImageUrl(page.compositeRawUrl, imageTarget),
    compositeUrl: rebaseProjectImageUrl(page.compositeUrl, imageTarget),
    previousResults: Array.isArray(page.previousResults) ? page.previousResults.map(result => ({
      ...result,
      rawResultUrl: rebaseProjectImageUrl(result?.rawResultUrl, imageTarget),
      finalUrl: rebaseProjectImageUrl(result?.finalUrl, imageTarget),
      resultUrl: rebaseProjectImageUrl(result?.resultUrl, imageTarget),
    })) : page.previousResults,
  })) : job.pages;
  job.resultUrls = Array.isArray(job.resultUrls)
    ? job.resultUrls.map(value => rebaseProjectImageUrl(value, imageTarget))
    : job.resultUrls;
  return job;
}

function readJob(jobId, workflowId, dirs) {
  const filePath = jobPath(jobId, workflowId, dirs);
  if (!fs.existsSync(filePath)) return null;
  return rebaseJobImageUrls(JSON.parse(fs.readFileSync(filePath, 'utf8')), workflowId, dirs);
}

function writeJob(job, context) {
  const filePath = jobPath(job.id, job.workflowId, context.dirs);
  if (fs.existsSync(filePath)) {
    try {
      const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      job.dismissedResultNodeIds = [...new Set([
        ...(persisted.dismissedResultNodeIds || []),
        ...(job.dismissedResultNodeIds || []),
      ])];
    } catch {
      // The next atomic write repairs a truncated/corrupt sidecar. Result Image
      // nodes in project.json remain the durable user-visible fallback.
    }
  }
  job.updatedAt = nowIso(context);
  atomicWriteJson(filePath, job);
  return job;
}

function readAllJobs(workflowId, dirs) {
  let jobsDir;
  try {
    ({ jobsDir } = getStorage(workflowId, dirs));
  } catch {
    return [];
  }
  return fs.readdirSync(jobsDir)
    .filter(filename => filename.endsWith('.json'))
    .flatMap(filename => {
      try {
        const job = rebaseJobImageUrls(
          JSON.parse(fs.readFileSync(path.join(jobsDir, filename), 'utf8')),
          workflowId,
          dirs
        );
        return job?.workflowId === workflowId ? [job] : [];
      } catch {
        return [];
      }
    });
}

function sourceUrl(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  return String(value.imageUrl || value.url || value.resultUrl || value.src || '').trim();
}

function normalizeDetailEntries(payload, objectKey, imageKeys, nodeIdKeys) {
  const objectEntries = Array.isArray(payload[objectKey]) ? payload[objectKey] : null;
  const imagesKey = imageKeys.find(key => Array.isArray(payload[key]));
  const nodeIdsKey = nodeIdKeys.find(key => Array.isArray(payload[key]));
  const raw = objectEntries || (imagesKey ? payload[imagesKey] : []);
  const nodeIds = nodeIdsKey ? payload[nodeIdsKey] : [];
  return raw
    .map((entry, index) => {
      const ratioValue = typeof entry === 'object' && entry
        ? String(entry.resultAspectRatio || entry.sourceDimensions || '')
        : '';
      const ratioParts = ratioValue.split(/[/:x×]/i).map(Number);
      const sourceWidth = Math.round(Number(entry?.sourceWidth || entry?.width || entry?.naturalWidth || ratioParts[0]));
      const sourceHeight = Math.round(Number(entry?.sourceHeight || entry?.height || entry?.naturalHeight || ratioParts[1]));
      return {
        imageUrl: sourceUrl(entry),
        sourceNodeId: typeof entry === 'object' && entry
          ? String(entry.sourceNodeId || entry.nodeId || nodeIds[index] || '')
          : String(nodeIds[index] || ''),
        order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : index,
        ...(sourceWidth > 0 && sourceHeight > 0 ? { sourceWidth, sourceHeight } : {}),
        originalIndex: index,
      };
    })
    .filter(entry => entry.imageUrl)
    .sort((left, right) => left.order - right.order || left.originalIndex - right.originalIndex);
}

function normalizeImageList(...values) {
  const flattened = values.flatMap(value => Array.isArray(value) ? value : value ? [value] : []);
  return [...new Set(flattened.map(sourceUrl).filter(Boolean))];
}

function normalizeNodeIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => String(item || '').trim()).filter(Boolean))];
}

function normalizePayload(payload) {
  const ownDetails = normalizeDetailEntries(
    payload,
    'ownDetails',
    ['ownDetailImages', 'ownImages'],
    ['ownDetailNodeIds', 'ownNodeIds']
  );
  const competitorDetails = normalizeDetailEntries(
    payload,
    'competitorDetails',
    ['competitorDetailImages', 'competitorImages'],
    ['competitorDetailNodeIds', 'competitorNodeIds']
  );
  const productImages = normalizeImageList(payload.productImages, payload.productImage);
  const selectedCharacterReferenceImages = normalizeImageList(
    payload.characterReferenceImages,
    payload.characterImages,
    payload.characterImage
  );
  const useCharacterReference = payload.useCharacterReference === true
    || payload.characterReferenceEnabled === true;
  const characterReferenceImages = useCharacterReference ? selectedCharacterReferenceImages : [];
  return {
    ownDetails,
    competitorDetails,
    productImages,
    productNodeIds: normalizeNodeIds(payload.productNodeIds),
    characterReferenceImages,
    characterReferenceNodeIds: useCharacterReference
      ? normalizeNodeIds(payload.characterNodeIds || payload.characterReferenceNodeIds)
      : [],
    useCharacterReference,
  };
}

function canonicalMediaIdentity(value) {
  const source = String(value || '').trim();
  if (!source || source.startsWith('data:')) return source;
  try {
    const parsed = new URL(source, 'http://evan.local');
    const segments = parsed.pathname.split('/').filter(Boolean).map(segment => decodeURIComponent(segment));
    const projectsIndex = segments.indexOf('projects');
    if (projectsIndex >= 0 && segments[projectsIndex + 2] === 'images') {
      return `/library/projects/*/images/${segments.slice(projectsIndex + 3).join('/')}${parsed.search}`;
    }
    return `${parsed.origin === 'http://evan.local' ? '' : parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return source;
  }
}

function requestFingerprint(normalized, config) {
  const details = entries => entries.map(entry => ({
    sourceNodeId: entry.sourceNodeId,
    order: entry.order,
    image: canonicalMediaIdentity(entry.imageUrl),
    sourceWidth: entry.sourceWidth,
    sourceHeight: entry.sourceHeight,
  }));
  return crypto.createHash('sha256').update(JSON.stringify({
    ownDetails: details(normalized.ownDetails),
    competitorDetails: details(normalized.competitorDetails),
    productImages: normalized.productImages.map(canonicalMediaIdentity),
    productNodeIds: normalized.productNodeIds,
    useCharacterReference: normalized.useCharacterReference,
    characterReferenceImages: normalized.characterReferenceImages.map(canonicalMediaIdentity),
    characterReferenceNodeIds: normalized.characterReferenceNodeIds,
    recognitionProvider: config.recognitionProvider,
    recognitionModel: config.recognitionModel,
    imageModel: config.imageModel,
    sizingMode: config.sizingMode,
    aspectRatio: config.aspectRatio,
    imageResolution: config.imageResolution,
  })).digest('hex');
}

function cancellationError() {
  return operationCancelledError('商品详情复刻任务');
}

function submittedOperationError(error) {
  const submitted = error instanceof Error ? error : new Error(String(error));
  submitted.submitted = true;
  return submitted;
}

function assertActive(job, context, signal) {
  const latest = readJob(job.id, job.workflowId, context.dirs);
  if (signal?.aborted || latest?.cancelRequested || latest?.status === 'cancelled') {
    throw cancellationError();
  }
}

function dataUrlMime(extension) {
  return ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' })[
    String(extension || '').toLowerCase()
  ] || 'image/png';
}

function resolveLocalImagePath(input, context) {
  if (!input || typeof input !== 'string' || input.startsWith('data:')) return null;
  let pathname = input.split(/[?#]/)[0];
  if (/^https?:\/\//i.test(input)) {
    const parsed = new URL(input);
    if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return null;
    pathname = parsed.pathname;
  }
  if (pathname.startsWith('/library/')) {
    const libraryRoot = path.resolve(context.libraryDir);
    const candidate = path.resolve(libraryRoot, decodeURIComponent(pathname.slice('/library/'.length)));
    if (candidate !== libraryRoot && !candidate.startsWith(`${libraryRoot}${path.sep}`)) return null;
    return fs.existsSync(candidate) ? candidate : null;
  }
  if (path.isAbsolute(pathname)) {
    const candidate = path.resolve(pathname);
    const allowedRoots = [context.libraryDir, context.projectRoot]
      .filter(Boolean)
      .map(root => path.resolve(root));
    if (!allowedRoots.some(root => candidate === root || candidate.startsWith(`${root}${path.sep}`))) return null;
    return fs.existsSync(candidate) ? candidate : null;
  }
  return null;
}

function imageInputToBuffer(input, context) {
  if (Buffer.isBuffer(input)) return input;
  if (typeof input !== 'string') return null;
  const match = input.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/s);
  if (match) return Buffer.from(match[2], 'base64');
  let filePath = null;
  try {
    filePath = resolveLocalImagePath(input, context);
  } catch {
    filePath = null;
  }
  return filePath ? fs.readFileSync(filePath) : null;
}

function imageInputToDataUrl(input, context) {
  if (typeof input === 'string' && input.startsWith('data:image/')) return input;
  const buffer = imageInputToBuffer(input, context);
  if (!buffer) return null;
  let extension = '';
  try {
    extension = path.extname(resolveLocalImagePath(input, context) || '');
  } catch {
    extension = '';
  }
  return `data:${dataUrlMime(extension)};base64,${buffer.toString('base64')}`;
}

/**
 * Base64 of the reference images, memoized for the lifetime of one job run.
 *
 * Quality control re-sends the same competitor page, product crops, logo,
 * evidence pages and character sheets on every pass — first judgement, second
 * opinion, and again after each repair — and encoding them is neither free nor
 * cached anywhere else. Only string inputs are keyed, which is what keeps the
 * candidate image itself (always passed as a Buffer) out of the cache: it is the
 * one input that differs between passes. Never persisted: this lives beside the
 * job, never on it, because writeJob would serialize megabytes of base64.
 */
const referenceDataUrlCaches = new Map();

function cachedImageInputToDataUrl(job, input, context) {
  const cache = referenceDataUrlCaches.get(job?.id);
  if (!cache || typeof input !== 'string' || !input) return imageInputToDataUrl(input, context);
  if (!cache.has(input)) cache.set(input, imageInputToDataUrl(input, context));
  return cache.get(input);
}

function numericAspectRatio(value) {
  const parts = String(value || '').split(/[/:x×]/i).map(Number);
  return parts.length >= 2 && parts[0] > 0 && parts[1] > 0
    ? parts[0] / parts[1]
    : null;
}

function closestProviderAspectRatio(modelId, width, height, fallback = '3:4') {
  const target = Number(width) > 0 && Number(height) > 0 ? Number(width) / Number(height) : null;
  const ratios = (getImageGenerationProvider(modelId)?.supportedAspectRatios || [])
    .filter(value => !['auto', '自动'].includes(String(value).toLowerCase()))
    .map(value => ({ value, ratio: numericAspectRatio(value) }))
    .filter(item => item.ratio);
  if (!target || !ratios.length) return normalizeImageAspectRatio(modelId, fallback) || fallback;
  return ratios.reduce((best, current) => (
    Math.abs(Math.log(current.ratio / target)) < Math.abs(Math.log(best.ratio / target))
      ? current
      : best
  )).value;
}

async function ensurePageSourceDimensions(job, page, context) {
  let width = Math.round(Number(page.sourceWidth) || 0);
  let height = Math.round(Number(page.sourceHeight) || 0);
  if (!(width > 0 && height > 0)) {
    const source = imageInputToBuffer(page.sourceImage, context);
    if (source) {
      try {
        const metadata = await sharp(source, { failOn: 'none' }).metadata();
        width = Math.round(Number(metadata.width) || 0);
        height = Math.round(Number(metadata.height) || 0);
      } catch {
        // The recognition provider can still process remote/data inputs. Exact
        // dimensions are also supplied by the canvas for newly imported files.
      }
    }
  }
  if (width > 0 && height > 0) {
    page.sourceWidth = width;
    page.sourceHeight = height;
    page.outputWidth = width;
    page.outputHeight = height;
    page.aspectRatio = `${width}:${height}`;
    page.resultAspectRatio = `${width}/${height}`;
  }
  page.generationAspectRatio = closestProviderAspectRatio(
    job.imageModel,
    width,
    height,
    job.aspectRatio || '3:4',
  );
  return page;
}

async function matchPageDimensions(sourceBuffer, page, context) {
  const width = Math.round(Number(page.outputWidth || page.sourceWidth) || 0);
  const height = Math.round(Number(page.outputHeight || page.sourceHeight) || 0);
  if (!(width > 0 && height > 0)) return sourceBuffer;
  if (context.matchDetailRemixDimensions) {
    const output = await context.matchDetailRemixDimensions({ sourceBuffer, width, height, page });
    return Buffer.isBuffer(output) ? output : output?.buffer;
  }
  return sharp(sourceBuffer, { failOn: 'none' })
    .resize(width, height, {
      fit: 'cover',
      position: 'centre',
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();
}

function normalizeSellingPoints(parsed) {
  const raw = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.ownSellingPoints)
      ? parsed.ownSellingPoints
    : Array.isArray(parsed?.sellingPoints)
      ? parsed.sellingPoints
      : Array.isArray(parsed?.points)
        ? parsed.points
        : [];
  return raw.flatMap((point, index) => {
    if (typeof point === 'string' && point.trim()) {
      return [{ id: `sp-${index + 1}`, title: point.trim(), description: '' }];
    }
    if (!point || typeof point !== 'object') return [];
    const title = String(point.title || point.headline || point.name || point.text || point.claim || '').trim();
    const description = String(point.description || point.detail || point.support || point.subheadline || '').trim();
    if (!title && !description) return [];
    return [{ ...point, id: String(point.id || `sp-${index + 1}`), title: title || description, description }];
  });
}

function normalizeRegion(value) {
  const region = value && typeof value === 'object' ? value : {};
  const x = Number(region.x);
  const y = Number(region.y);
  const width = Number(region.width);
  const height = Number(region.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    width: Math.max(0.001, Math.min(1, width)),
    height: Math.max(0.001, Math.min(1, height)),
  };
}

function normalizeBrandIdentity(parsed) {
  const raw = parsed?.brandIdentity || parsed?.brand || {};
  if (!raw || typeof raw !== 'object') return {};
  const name = String(raw.name || raw.brandName || '').trim();
  const slogan = String(raw.slogan || raw.tagline || '').trim();
  const logoDescription = String(raw.logoDescription || raw.logoStyle || '').trim();
  const logoSourceImageIndex = Number(raw.logoSourceImageIndex ?? raw.sourceImageIndex);
  const logoRegion = normalizeRegion(raw.logoRegion || raw.region || raw.boundingBox);
  return {
    ...(name ? { name } : {}),
    ...(slogan ? { slogan } : {}),
    ...(logoDescription ? { logoDescription } : {}),
    ...(Array.isArray(raw.primaryColors) ? { primaryColors: raw.primaryColors.map(String).filter(Boolean) } : {}),
    ...(Number.isInteger(logoSourceImageIndex) && logoSourceImageIndex >= 0
      ? { logoSourceImageIndex }
      : {}),
    ...(logoRegion ? { logoRegion } : {}),
  };
}

function mergeBrandIdentity(existing, incoming) {
  const left = existing && typeof existing === 'object' ? existing : {};
  const right = incoming && typeof incoming === 'object' ? incoming : {};
  return {
    ...left,
    ...Object.fromEntries(Object.entries(right).filter(([, value]) => (
      value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)
    ))),
  };
}

function mergeSellingPoints(existing, incoming) {
  const merged = new Map();
  for (const point of [...existing, ...incoming]) {
    const key = `${point.title}\n${point.description}`.toLocaleLowerCase();
    if (!key.trim()) continue;
    const previous = merged.get(key);
    const sourceImageIndexes = [...new Set([
      ...(previous?.sourceImageIndexes || []),
      ...(point.sourceImageIndexes || []),
    ].map(Number).filter(Number.isFinite))].sort((left, right) => left - right);
    const sourceNodeIds = [...new Set([
      ...(Array.isArray(previous?.sourceNodeIds) ? previous.sourceNodeIds : []),
      ...(Array.isArray(point.sourceNodeIds) ? point.sourceNodeIds : []),
    ].map(value => String(value || '').trim()).filter(Boolean))];
    merged.set(key, {
      ...(previous || {}),
      ...point,
      sourceImageIndexes,
      sourceNodeIds,
    });
  }
  // Recognition chunks commonly reuse IDs such as `sp-1`. Reassigning IDs
  // after the full knowledge base is merged keeps the competitor mapping
  // contract globally unique and deterministic.
  return [...merged.values()].map((point, index) => ({ ...point, id: `sp-${index + 1}` }));
}

function normalizeVerifiedFacts(parsed, chunkStart, chunkLength, ownDetails) {
  const raw = Array.isArray(parsed?.verifiedFacts)
    ? parsed.verifiedFacts
    : Array.isArray(parsed?.productFacts)
      ? parsed.productFacts
      : Array.isArray(parsed?.specifications)
        ? parsed.specifications
        : [];
  return raw.flatMap((fact, localOrder) => {
    if (!fact || typeof fact !== 'object') return [];
    const label = String(fact.label || fact.name || fact.key || '').trim();
    const value = String(fact.value || fact.exactValue || '').trim();
    if (!label || !value) return [];
    const localIndex = Number(
      fact.evidenceImageIndex
      ?? fact.sourceImageIndex
      ?? fact.sourceImageIndexes?.[0],
    );
    const evidenceRegion = normalizeRegion(
      fact.evidenceRegion || fact.sourceRegion || fact.region || fact.boundingBox,
    );
    const confidence = Number(fact.confidence);
    if (!Number.isInteger(localIndex) || localIndex < 0 || localIndex >= chunkLength) return [];
    if (!evidenceRegion || !Number.isFinite(confidence)
        || confidence < DETAIL_REMIX_STRICT_FACT_MIN_CONFIDENCE) return [];
    const evidenceImageIndex = chunkStart + localIndex;
    const evidenceImageId = String(ownDetails[evidenceImageIndex]?.sourceNodeId || '').trim();
    if (!evidenceImageId || !ownDetails[evidenceImageIndex]?.imageUrl) return [];
    const field = canonicalDetailRemixFactField(fact.field || fact.factType || fact.type, label);
    if (!field) return [];
    const normalizedValue = normalizeDetailRemixFactValue(value);
    const displayText = String(fact.displayText || '').trim()
      || `${label}\n${value}`;
    const evidence = [{
      evidenceImageIndex,
      evidenceImageId,
      evidenceRegion,
      confidence: Math.max(0, Math.min(1, confidence)),
      sourceText: displayText,
    }];
    return [{
      field,
      factType: field,
      label,
      value,
      normalizedValue,
      displayText,
      evidence,
      evidenceImageIndex,
      evidenceImageId,
      evidenceRegion,
      sourceImageIndexes: [evidenceImageIndex],
      sourceNodeIds: [evidenceImageId],
      sourceRegion: evidenceRegion,
      confidence: Math.max(0, Math.min(1, confidence)),
      localOrder,
    }];
  });
}

function mergeVerifiedFacts(existing, incoming) {
  const merged = new Map();
  for (const fact of [...(existing || []), ...(incoming || [])]) {
    const label = String(fact?.label || '').trim();
    const value = String(fact?.value || '').trim();
    if (!label || !value) continue;
    const field = canonicalDetailRemixFactField(fact.field || fact.factType, label);
    const normalizedValue = normalizeDetailRemixFactValue(fact.normalizedValue || value);
    const evidence = (Array.isArray(fact.evidence) ? fact.evidence : []).filter(item => (
      item?.evidenceImageId
      && Number.isInteger(Number(item.evidenceImageIndex))
      && normalizeRegion(item.evidenceRegion)
      && Number(item.confidence) >= DETAIL_REMIX_STRICT_FACT_MIN_CONFIDENCE
    ));
    if (!field || !normalizedValue || !evidence.length) continue;
    const key = `${field}\n${normalizedValue.toLowerCase()}`;
    const previous = merged.get(key);
    const mergedEvidence = [...(previous?.evidence || []), ...evidence]
      .reduce((items, item) => {
        const region = normalizeRegion(item.evidenceRegion);
        const identity = [
          item.evidenceImageId,
          region?.x, region?.y, region?.width, region?.height,
        ].join(':');
        if (!region || items.some(entry => entry.identity === identity)) return items;
        items.push({
          identity,
          evidenceImageIndex: Number(item.evidenceImageIndex),
          evidenceImageId: String(item.evidenceImageId),
          evidenceRegion: region,
          confidence: Math.max(0, Math.min(1, Number(item.confidence))),
          sourceText: String(item.sourceText || `${label}\n${value}`).trim(),
        });
        return items;
      }, [])
      .map(({ identity: _identity, ...item }) => item);
    const primaryEvidence = [...mergedEvidence]
      .sort((left, right) => Number(right.confidence) - Number(left.confidence))[0];
    merged.set(key, {
      ...(previous || {}),
      ...fact,
      field,
      factType: field,
      label,
      value,
      normalizedValue,
      displayText: String(fact.displayText || previous?.displayText || `${label}\n${value}`).trim(),
      evidence: mergedEvidence,
      evidenceImageIndex: primaryEvidence.evidenceImageIndex,
      evidenceImageId: primaryEvidence.evidenceImageId,
      evidenceRegion: primaryEvidence.evidenceRegion,
      sourceImageIndexes: [...new Set(mergedEvidence.map(item => item.evidenceImageIndex))].sort((left, right) => left - right),
      sourceNodeIds: [...new Set(mergedEvidence.map(item => item.evidenceImageId))],
      sourceRegion: primaryEvidence.evidenceRegion,
      confidence: primaryEvidence.confidence,
    });
  }
  return [...merged.values()]
    .sort((left, right) => (
      Number(left.sourceImageIndexes?.[0] ?? Number.MAX_SAFE_INTEGER)
      - Number(right.sourceImageIndexes?.[0] ?? Number.MAX_SAFE_INTEGER)
      || Number(left.localOrder || 0) - Number(right.localOrder || 0)
    ))
    .map((fact, index) => ({ ...fact, id: `fact-${index + 1}` }));
}

function verifiedFactCatalog(job) {
  return (Array.isArray(job.verifiedFacts) ? job.verifiedFacts : []).map(fact => ({
    id: fact.id,
    field: fact.field || fact.factType || '',
    label: fact.label || '',
    value: fact.value || '',
    normalizedValue: fact.normalizedValue || normalizeDetailRemixFactValue(fact.value),
    displayText: fact.displayText || [fact.label, fact.value].filter(Boolean).join('\n'),
  })).filter(fact => fact.id && fact.field && fact.label && fact.value);
}

function normalizeProductViews(parsed, chunkStart, chunkLength, ownDetails) {
  const raw = Array.isArray(parsed?.productViews)
    ? parsed.productViews
    : Array.isArray(parsed?.productAngles)
      ? parsed.productAngles
      : [];
  return raw.flatMap((view, localOrder) => {
    if (!view || typeof view !== 'object') return [];
    const localIndex = Number(view.sourceImageIndex ?? view.imageIndex);
    const cropRegion = normalizeRegion(view.cropRegion || view.productRegion || view.boundingBox);
    if (!Number.isInteger(localIndex) || localIndex < 0 || localIndex >= chunkLength || !cropRegion) return [];
    const sourceImageIndex = chunkStart + localIndex;
    const sourceNodeId = String(ownDetails[sourceImageIndex]?.sourceNodeId || '');
    const qualityValue = Number(view.quality ?? view.confidence);
    return [{
      sourceImageIndex,
      sourceNodeId,
      cropRegion,
      viewAngle: String(view.viewAngle || view.angle || 'unknown').trim() || 'unknown',
      visibleSides: Array.isArray(view.visibleSides) ? view.visibleSides.map(String).filter(Boolean) : [],
      description: String(view.description || view.visualDescription || '').trim(),
      quality: Number.isFinite(qualityValue) ? Math.max(0, Math.min(1, qualityValue)) : 0.5,
      localOrder,
    }];
  });
}

function mergeProductViews(existing, incoming) {
  const merged = new Map();
  for (const view of [...existing, ...incoming]) {
    const region = normalizeRegion(view?.cropRegion);
    if (!region || !Number.isInteger(Number(view?.sourceImageIndex))) continue;
    const key = [
      Number(view.sourceImageIndex),
      region.x.toFixed(4), region.y.toFixed(4), region.width.toFixed(4), region.height.toFixed(4),
    ].join(':');
    const previous = merged.get(key);
    merged.set(key, {
      ...(previous || {}),
      ...view,
      cropRegion: region,
      ...(previous?.imageUrl && !view.imageUrl ? { imageUrl: previous.imageUrl } : {}),
    });
  }
  return [...merged.values()]
    .sort((left, right) => (
      Number(left.sourceImageIndex) - Number(right.sourceImageIndex)
      || Number(left.localOrder || 0) - Number(right.localOrder || 0)
    ))
    .map((view, index) => ({ ...view, id: `pv-${index + 1}` }));
}

function productViewCatalog(job) {
  return (Array.isArray(job.productViews) ? job.productViews : [])
    .filter(view => view?.id && view?.imageUrl)
    .map(view => ({
      id: view.id,
      viewAngle: view.viewAngle || 'unknown',
      visibleSides: Array.isArray(view.visibleSides) ? view.visibleSides : [],
      description: view.description || '',
      quality: Number(view.quality) || 0,
    }));
}

function normalizePageAnalysis(parsed, { pageIndex = 0, pageCount = 1 } = {}) {
  const value = parsed?.page || parsed?.pages?.[0] || parsed?.analysis || parsed || {};
  const hasPersonValue = value.hasPerson ?? value.containsPerson ?? value.personPresent
    ?? value.person?.present ?? value.character?.present ?? value.structure?.character?.present;
  const mapped = value.mappedSellingPoints || value.sellingPointMapping || value.replacementSellingPoints
    || value.selectedSellingPoints || [];
  const mappedFacts = value.mappedFacts || value.factMapping || [];
  const selectedProductViewIds = value.selectedProductViewIds || value.productViewIds || [];
  const productInstances = Array.isArray(value.productInstances)
    ? value.productInstances
    : Array.isArray(value.productRegions)
      ? value.productRegions
      : value.productRegion && typeof value.productRegion === 'object'
        ? [value.productRegion]
        : [];
  const copySlots = Array.isArray(value.copySlots) ? value.copySlots.map((slot, index) => {
    const source = slot && typeof slot === 'object' ? slot : {};
    const role = String(source.role || 'copy').trim() || 'copy';
    const explicitPart = String(source.parameterPart || '').trim().toLowerCase();
    const parameterPart = ['label', 'value'].includes(explicitPart)
      ? explicitPart
      : /label/iu.test(role) ? 'label' : /value/iu.test(role) ? 'value' : 'none';
    return {
      ...source,
      slotId: String(source.slotId || source.id || `copy-${index + 1}`),
      role,
      field: parameterPart === 'none'
        ? String(source.field || '').trim()
        : canonicalDetailRemixFactField(source.field, source.sourceText),
      parameterPart,
    };
  }) : [];
  const strictParameterModeEligible = detailRemixAllowsStrictParameterMode(pageIndex, pageCount);
  const detectedPageMode = detailRemixPageMode({ ...value, copySlots });
  const pageMode = strictParameterModeEligible
    ? detectedPageMode
    : DETAIL_REMIX_MARKETING_MODE;
  const strictMode = pageMode === DETAIL_REMIX_STRICT_PARAMETER_MODE;
  return {
    ...value,
    // Character references are safety-sensitive: ambiguity means no reference.
    hasPerson: hasPersonValue === true,
    originalPageType: String(value.pageType || value.type || '').trim(),
    pageType: strictMode
      ? 'specification'
      : strictParameterModeEligible
        ? String(value.pageType || value.type || 'marketing').trim().toLowerCase() || 'marketing'
        : 'marketing',
    strictParameterModeEligible,
    pageMode,
    strictPageCategory: strictMode ? detailRemixStrictPageCategory({ ...value, copySlots }) : 'none',
    mappedSellingPoints: strictMode ? [] : (Array.isArray(mapped) ? mapped : []),
    mappedFacts: Array.isArray(mappedFacts) ? mappedFacts : [],
    selectedProductViewIds: Array.isArray(selectedProductViewIds)
      ? [...new Set(selectedProductViewIds.map(item => String(item || '').trim()).filter(Boolean))]
      : [],
    productInstances,
    productRegion: value.productRegion || productInstances[0] || {},
    copySlots,
    brandSlots: Array.isArray(value.brandSlots || value.logoSlots)
      ? (value.brandSlots || value.logoSlots)
      : [],
  };
}

function resolveMappedSellingPoints(analysis, ownSellingPoints, pageIndex) {
  const requested = Array.isArray(analysis?.mappedSellingPoints) ? analysis.mappedSellingPoints : [];
  const byId = new Map(ownSellingPoints.map(point => [String(point.id), point]));
  const mapped = requested.flatMap((entry, index) => {
    if (typeof entry === 'string') {
      const known = byId.get(entry);
      return known ? [known] : [];
    }
    if (!entry || typeof entry !== 'object') return [];
    const known = byId.get(String(entry.sellingPointId || entry.pointId || entry.id || ''));
    if (!known) return [];
    // The competitor-page model may only choose a verified own-selling-point
    // ID and a visual slot. Never accept replacement copy invented in this
    // second recognition pass.
    return [{
      ...entry,
      ...known,
      id: known.id,
      title: known.title,
      description: known.description,
    }];
  });
  if (mapped.length) return mapped;
  if (isDetailRemixStrictParameterPage(analysis)) return [];
  if (!ownSellingPoints.length) return [];
  return [ownSellingPoints[pageIndex % ownSellingPoints.length]];
}

function resolveMappedFacts(analysis, verifiedFacts) {
  const requested = Array.isArray(analysis?.mappedFacts) ? analysis.mappedFacts : [];
  const byId = new Map((verifiedFacts || []).map(fact => [String(fact.id), fact]));
  const slots = new Map((analysis?.copySlots || []).map(slot => [String(slot?.slotId || ''), slot]));
  const rejected = [];
  const usedSlots = new Set();
  const candidates = requested.flatMap(entry => {
    if (!entry || typeof entry !== 'object') {
      rejected.push({ reason: 'mapping_not_structured', entry });
      return [];
    }
    const known = byId.get(String(entry.factId || entry.id || ''));
    if (!known || !Array.isArray(known.evidence) || !known.evidence.length) {
      rejected.push({ reason: 'own_evidence_missing', entry });
      return [];
    }
    const displayPart = ['label', 'value'].includes(String(entry.displayPart))
      ? String(entry.displayPart)
      : '';
    const slotId = String(entry.slotId || '');
    const slot = slots.get(slotId);
    if (!displayPart || !slot || usedSlots.has(slotId)) {
      rejected.push({ reason: !slot ? 'target_slot_missing' : !displayPart ? 'display_part_invalid' : 'target_slot_duplicate', entry });
      return [];
    }
    const slotPart = String(slot.parameterPart || '').toLowerCase();
    const factField = canonicalDetailRemixFactField(known.field || known.factType, known.label);
    const slotField = canonicalDetailRemixFactField(slot.field, slot.sourceText);
    const targetRegion = normalizeRegion(slot);
    if (slotPart !== displayPart || !factField || slotField !== factField || !targetRegion) {
      rejected.push({
        reason: !targetRegion
          ? 'target_region_missing'
          : slotPart !== displayPart ? 'label_value_position_mismatch' : 'field_mismatch',
        entry,
        factField,
        slotField,
        slotPart,
      });
      return [];
    }
    const replacementText = displayPart === 'label'
      ? known.label
      : known.value;
    usedSlots.add(slotId);
    return [{
      ...entry,
      ...known,
      id: known.id,
      factId: known.id,
      label: known.label,
      value: known.value,
      displayText: known.displayText || `${known.label}\n${known.value}`,
      displayPart,
      replacementText,
      targetRegion,
    }];
  });
  const partsByFact = new Map();
  for (const mapping of candidates) {
    const parts = partsByFact.get(mapping.factId) || new Set();
    parts.add(mapping.displayPart);
    partsByFact.set(mapping.factId, parts);
  }
  const completeFactIds = new Set([...partsByFact]
    .filter(([, parts]) => parts.has('label') && parts.has('value'))
    .map(([factId]) => factId));
  const mappedFacts = candidates.filter(mapping => {
    if (completeFactIds.has(mapping.factId)) return true;
    rejected.push({ reason: 'label_value_pair_incomplete', entry: mapping });
    return false;
  });
  return { mappedFacts, rejected };
}

function isBrandOnlyCopySlot(slot, brandSlots) {
  const sourceText = String(slot?.sourceText || '').trim().normalize('NFKC').toLowerCase();
  const role = String(slot?.role || '').trim().toLowerCase();
  const brandTexts = (Array.isArray(brandSlots) ? brandSlots : [])
    .map(item => String(item?.sourceText || '').trim().normalize('NFKC').toLowerCase())
    .filter(Boolean);
  return (sourceText && brandTexts.includes(sourceText))
    || (/(?:brand|logo|品牌|标识)/iu.test(role) && !/(?:headline|title|标题)/iu.test(role));
}

function validateMarketingCopyContract(analysis, ownSellingPoints) {
  if (isDetailRemixStrictParameterPage(analysis)) return;
  const slots = Array.isArray(analysis?.copySlots) ? analysis.copySlots : [];
  const brandSlots = Array.isArray(analysis?.brandSlots) ? analysis.brandSlots : [];
  const criticalSlots = slots.filter(slot => (
    isDetailRemixMarketingLayoutSlot(slot)
    && !isBrandOnlyCopySlot(slot, brandSlots)
  ));
  if (!criticalSlots.length) return;

  const knownIds = new Set((Array.isArray(ownSellingPoints) ? ownSellingPoints : [])
    .map(point => String(point?.id || '').trim())
    .filter(Boolean));
  const mappings = Array.isArray(analysis?.mappedSellingPoints)
    ? analysis.mappedSellingPoints.filter(item => item && typeof item === 'object')
    : [];
  const mappingsBySlot = new Map();
  for (const mapping of mappings) {
    const slotId = String(mapping.slotId || '').trim();
    const entries = mappingsBySlot.get(slotId) || [];
    entries.push(mapping);
    mappingsBySlot.set(slotId, entries);
  }

  const issues = [];
  const replacementOwners = new Map();
  for (const slot of criticalSlots) {
    const slotId = String(slot?.slotId || '').trim();
    const entries = mappingsBySlot.get(slotId) || [];
    if (entries.length !== 1) {
      issues.push(`${slotId || 'unknown'}:${entries.length ? 'duplicate_mapping' : 'mapping_missing'}`);
      continue;
    }
    const mapping = entries[0];
    const sellingPointId = String(mapping.sellingPointId || mapping.pointId || mapping.id || '').trim();
    const replacementText = String(mapping.replacementText || '').trim();
    if (!knownIds.has(sellingPointId)) issues.push(`${slotId}:selling_point_unknown`);
    if (!replacementText) {
      issues.push(`${slotId}:replacement_text_missing`);
      continue;
    }
    const maximum = Math.max(0, Number(slot?.maxChars) || 0);
    if (maximum && [...replacementText].length > maximum) issues.push(`${slotId}:replacement_text_too_long`);
    const normalizedReplacement = replacementText.normalize('NFKC').replace(/\s+/gu, '');
    const previousSlotId = replacementOwners.get(normalizedReplacement);
    if (previousSlotId && previousSlotId !== slotId && analysis?.copyMappingAutoRepaired !== true) {
      issues.push(`${slotId}:replacement_text_duplicated_with_${previousSlotId}`);
    } else {
      replacementOwners.set(normalizedReplacement, slotId);
    }
  }
  if (!issues.length) return;
  const error = new Error(`营销页核心文案槽未完整保留：${issues.join('、')}`);
  error.code = 'DETAIL_REMIX_ANALYSIS_CONTRACT';
  error.copyMappingIssues = issues;
  throw error;
}

const normalizedMarketingCopy = value => String(value || '')
  .trim()
  .normalize('NFKC')
  .replace(/\s+/gu, ' ');

function fitGroundedMarketingCopy(value, maximum) {
  const source = normalizedMarketingCopy(value);
  const limit = Math.max(0, Number(maximum) || 0);
  if (!source || !limit || [...source].length <= limit) return source;
  const segments = source
    .split(/[，,。；;、｜|&＆：:\n]+/u)
    .map(item => normalizedMarketingCopy(item))
    .filter(Boolean);
  const fitting = segments
    .filter(item => [...item].length <= limit)
    .sort((left, right) => [...right].length - [...left].length);
  if (fitting.length) return fitting[0];
  return [...source].slice(0, limit).join('').replace(/[，,。；;、｜|&＆：:]+$/u, '');
}

function groundedMarketingCopyCandidates(point, slot, preferredText = '') {
  const role = String(slot?.role || '').toLowerCase();
  const wantsSupport = /(?:body|support|description|subtitle|subheadline|caption|说明|副标题)/iu.test(role);
  const roots = [
    preferredText,
    wantsSupport ? point?.description : point?.title,
    wantsSupport ? point?.title : point?.description,
  ];
  const candidates = [];
  const seen = new Set();
  for (const root of roots) {
    const source = normalizedMarketingCopy(root);
    if (!source) continue;
    const variants = [
      source,
      ...source.split(/[，,。；;、｜|&＆：:\n]+/u),
    ];
    for (const variant of variants) {
      const fitted = fitGroundedMarketingCopy(variant, slot?.maxChars);
      const key = fitted.normalize('NFKC').replace(/\s+/gu, '');
      if (!fitted || seen.has(key)) continue;
      seen.add(key);
      candidates.push(fitted);
    }
  }
  return candidates;
}

/**
 * Recognition remains the semantic planner. If both recognition attempts
 * violate only the mechanical slot contract, this deterministic fallback
 * repairs length, duplication, and missing-slot issues using grounded own
 * selling points. It never invents a claim and runs before paid generation.
 */
function repairMarketingCopyContract(analysis, ownSellingPoints) {
  if (isDetailRemixStrictParameterPage(analysis)) return { analysis, repairs: [] };
  const slots = Array.isArray(analysis?.copySlots) ? analysis.copySlots : [];
  const brandSlots = Array.isArray(analysis?.brandSlots) ? analysis.brandSlots : [];
  const criticalSlots = slots.filter(slot => (
    isDetailRemixMarketingLayoutSlot(slot)
    && !isBrandOnlyCopySlot(slot, brandSlots)
  ));
  const points = (Array.isArray(ownSellingPoints) ? ownSellingPoints : [])
    .filter(point => point?.id && (point?.title || point?.description));
  if (!criticalSlots.length || !points.length) return { analysis, repairs: [] };

  const byId = new Map(points.map(point => [String(point.id), point]));
  const mappings = Array.isArray(analysis?.mappedSellingPoints)
    ? analysis.mappedSellingPoints.filter(item => item && typeof item === 'object')
    : [];
  const firstMappingBySlot = new Map();
  for (const mapping of mappings) {
    const slotId = String(mapping.slotId || '').trim();
    if (slotId && !firstMappingBySlot.has(slotId)) firstMappingBySlot.set(slotId, mapping);
  }

  const usedTexts = new Set();
  const repairedMappings = [];
  const repairs = [];
  for (let slotIndex = 0; slotIndex < criticalSlots.length; slotIndex += 1) {
    const slot = criticalSlots[slotIndex];
    const slotId = String(slot?.slotId || '').trim();
    const existing = firstMappingBySlot.get(slotId);
    const preferredPoint = byId.get(String(existing?.sellingPointId || existing?.pointId || existing?.id || ''));
    const rotatedPoints = points.map((_, index) => points[(slotIndex + index) % points.length]);
    const candidatePoints = [
      ...(preferredPoint ? [preferredPoint] : []),
      ...rotatedPoints.filter(point => point !== preferredPoint),
    ];
    let selected = null;
    let duplicateFallback = null;
    for (const point of candidatePoints) {
      const candidates = groundedMarketingCopyCandidates(
        point,
        slot,
        point === preferredPoint ? existing?.replacementText : '',
      );
      for (const replacementText of candidates) {
        const key = replacementText.normalize('NFKC').replace(/\s+/gu, '');
        duplicateFallback ||= { point, replacementText, key };
        if (usedTexts.has(key)) continue;
        selected = { point, replacementText, key };
        break;
      }
      if (selected) break;
    }
    selected ||= duplicateFallback;
    if (!selected) continue;
    usedTexts.add(selected.key);
    repairedMappings.push({
      ...(existing || {}),
      sellingPointId: String(selected.point.id),
      slotId,
      slotRole: String(slot?.role || existing?.slotRole || 'copy'),
      replacementText: selected.replacementText,
    });
    if (!existing
        || String(existing.sellingPointId || existing.pointId || existing.id || '') !== String(selected.point.id)
        || normalizedMarketingCopy(existing.replacementText) !== selected.replacementText) {
      repairs.push({
        slotId,
        sellingPointId: String(selected.point.id),
        replacementText: selected.replacementText,
      });
    }
  }

  const criticalSlotIds = new Set(criticalSlots.map(slot => String(slot?.slotId || '').trim()));
  const untouchedMappings = mappings.filter(mapping => !criticalSlotIds.has(String(mapping.slotId || '').trim()));
  return {
    analysis: {
      ...analysis,
      mappedSellingPoints: [...untouchedMappings, ...repairedMappings],
      copyMappingAutoRepaired: true,
    },
    repairs,
  };
}

function validateCompetitorAnalysisContract(
  analysis,
  verifiedFacts,
  ownSellingPoints,
  { allowRejectedFacts = false } = {},
) {
  const resolution = resolveMappedFacts(analysis, verifiedFacts);
  if (resolution.rejected.length > 0 && !allowRejectedFacts) {
    const reasons = [...new Set(resolution.rejected.map(item => item.reason))];
    const error = new Error(`竞品参数映射未通过严格证据校验：${reasons.join('、')}`);
    error.code = 'DETAIL_REMIX_ANALYSIS_CONTRACT';
    error.rejectedMappings = resolution.rejected;
    throw error;
  }
  if (isDetailRemixStrictParameterPage(analysis)) {
    // Strict pages are closed-world contracts. Invalid, incomplete, or
    // ungrounded fact mappings are already excluded by resolveMappedFacts;
    // dropping them is safer than failing the whole page. Marketing mappings
    // are likewise ignored instead of being allowed to spill into spec cells.
    analysis.mappedSellingPoints = [];
  } else {
    validateMarketingCopyContract(analysis, ownSellingPoints);
  }
  return resolution;
}

function overlayTexts(points, copySlots = [], brandIdentity = {}, brandSlots = [], hasBrandLogo = false) {
  const expanded = points.slice(0, 3).flatMap(point => {
    const title = String(point.title || point.text || point.headline || '').trim();
    const description = String(point.description || point.detail || '').trim();
    return [
      title && { text: title, role: String(point.slotRole || 'headline') },
      description && { text: description, role: 'support' },
    ].filter(Boolean);
  });
  const slots = Array.isArray(copySlots) ? copySlots : [];
  const used = new Set();
  const sellingTexts = expanded.map((item, index) => {
    let slotIndex = slots.findIndex((slot, candidateIndex) => (
      !used.has(candidateIndex) && String(slot?.role || '') === item.role
    ));
    if (slotIndex < 0) slotIndex = slots.findIndex((_slot, candidateIndex) => !used.has(candidateIndex));
    if (slotIndex >= 0) used.add(slotIndex);
    return { ...item, slot: slotIndex >= 0 ? slots[slotIndex] : undefined };
  });
  const logoSlots = Array.isArray(brandSlots) ? brandSlots : [];
  const brandTexts = [
    !hasBrandLogo && brandIdentity?.name
      ? { text: String(brandIdentity.name), role: 'brand', slot: logoSlots[0] }
      : null,
    brandIdentity?.slogan
      ? { text: String(brandIdentity.slogan), role: 'brand-slogan', slot: logoSlots[1] }
      : null,
  ].filter(item => item?.text && item?.slot);
  return [...brandTexts, ...sellingTexts];
}

function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);
}

function wrapText(text, maxCharacters) {
  const characters = [...String(text)];
  const lines = [];
  for (let index = 0; index < characters.length; index += maxCharacters) {
    lines.push(characters.slice(index, index + maxCharacters).join(''));
  }
  return lines.slice(0, 2);
}

async function deterministicTextOverlay(sourceBuffer, texts, context, metadata = {}) {
  if (context.applyTextOverlay) {
    const output = await context.applyTextOverlay({ sourceBuffer, texts, ...metadata });
    return Buffer.isBuffer(output) ? output : output?.buffer;
  }
  if (!texts.length && !Buffer.isBuffer(metadata.brandLogoBuffer)) return sourceBuffer;
  const image = sharp(sourceBuffer, { failOn: 'none' });
  const dimensions = await image.metadata();
  const width = dimensions.width || 1024;
  const height = dimensions.height || 1365;
  const titleSize = Math.max(28, Math.round(width * 0.056));
  const secondarySize = Math.max(20, Math.round(width * 0.034));
  let y = Math.round(height * 0.1);
  const textSvg = [];
  texts.forEach((item, index) => {
    const value = typeof item === 'string' ? { text: item } : item;
    const slot = value?.slot && typeof value.slot === 'object' ? value.slot : {};
    const slotX = Number(slot.x);
    const slotY = Number(slot.y);
    const slotWidth = Number(slot.width);
    const slotHeight = Number(slot.height);
    const hasSlot = [slotX, slotY, slotWidth, slotHeight].every(Number.isFinite)
      && slotWidth > 0 && slotHeight > 0;
    const fontSize = hasSlot
      ? Math.max(18, Math.min(Math.round(height * slotHeight * 0.52), Math.round(width * 0.08)))
      : index === 0 ? titleSize : secondarySize;
    const maximumCharacters = Number(slot.maxChars) > 0
      ? Math.max(4, Math.round(Number(slot.maxChars)))
      : hasSlot ? Math.max(4, Math.round(width * slotWidth / Math.max(1, fontSize))) : index === 0 ? 14 : 20;
    const lines = wrapText(value?.text || '', maximumCharacters);
    const alignment = ['left', 'right', 'center'].includes(slot.align) ? slot.align : 'center';
    const anchor = alignment === 'left' ? 'start' : alignment === 'right' ? 'end' : 'middle';
    const x = hasSlot
      ? Math.round(width * (slotX + (alignment === 'left' ? 0 : alignment === 'right' ? slotWidth : slotWidth / 2)))
      : Math.round(width / 2);
    if (hasSlot) y = Math.round(height * slotY + fontSize);
    const fill = /^#[0-9a-f]{6}$/i.test(String(slot.color || '')) ? slot.color : '#ffffff';
    const weight = Number(slot.fontWeight) >= 600 ? 700 : 500;
    const currentLineGap = Math.round(fontSize * 1.25);
    lines.forEach(line => {
      textSvg.push(
        `<text x="${x}" y="${y}" text-anchor="${anchor}" `
        + `font-family="PingFang SC,Microsoft YaHei,Noto Sans CJK SC,sans-serif" font-size="${fontSize}" `
        + `font-weight="${weight}" fill="${fill}" stroke="#111111" stroke-width="3" paint-order="stroke">`
        + `${escapeXml(line)}</text>`
      );
      y += currentLineGap;
    });
    y += Math.round(currentLineGap * 0.2);
  });
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${textSvg.join('')}</svg>`
  );
  const composites = [];
  const brandRegion = normalizeRegion(metadata.brandSlot);
  if (Buffer.isBuffer(metadata.brandLogoBuffer) && brandRegion) {
    const targetWidth = Math.max(1, Math.round(width * brandRegion.width));
    const targetHeight = Math.max(1, Math.round(height * brandRegion.height));
    const logo = await sharp(metadata.brandLogoBuffer, { failOn: 'none' })
      .resize(targetWidth, targetHeight, { fit: 'contain', position: 'centre' })
      .png()
      .toBuffer();
    composites.push({
      input: logo,
      left: Math.max(0, Math.round(width * brandRegion.x)),
      top: Math.max(0, Math.round(height * brandRegion.y)),
    });
  }
  if (textSvg.length) composites.push({ input: svg, top: 0, left: 0 });
  return composites.length ? image.composite(composites).png().toBuffer() : image.png().toBuffer();
}

function saveImageBuffer(buffer, imageTarget, assetId) {
  const filename = `${safeSegment(assetId)}.png`;
  fs.writeFileSync(path.join(imageTarget.targetDir, filename), buffer);
  return { filename, resultUrl: `${imageTarget.urlPrefix}/${filename}` };
}

async function materializeBrandLogo(job, context) {
  if (job.brandLogoUrl || !job.brandIdentity?.logoRegion) return;
  const sourceIndex = Number(job.brandIdentity.logoSourceImageIndex);
  if (!Number.isInteger(sourceIndex) || sourceIndex < 0) return;
  const source = imageInputToBuffer(job.ownDetails?.[sourceIndex]?.imageUrl, context);
  if (!source) return;
  try {
    const image = sharp(source, { failOn: 'none' });
    const metadata = await image.metadata();
    const width = Number(metadata.width) || 0;
    const height = Number(metadata.height) || 0;
    const region = normalizeRegion(job.brandIdentity.logoRegion);
    if (!(width > 0 && height > 0) || !region) return;
    const left = Math.max(0, Math.min(width - 1, Math.floor(width * region.x)));
    const top = Math.max(0, Math.min(height - 1, Math.floor(height * region.y)));
    const cropWidth = Math.max(1, Math.min(width - left, Math.round(width * region.width)));
    const cropHeight = Math.max(1, Math.min(height - top, Math.round(height * region.height)));
    const logoBuffer = await image
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .png()
      .toBuffer();
    const { imageTarget } = getStorage(job.workflowId, context.dirs);
    const saved = saveImageBuffer(logoBuffer, imageTarget, `${job.id}-brand-logo`);
    job.brandLogoUrl = saved.resultUrl;
    job.brandIdentity.logoSourceNodeId = job.ownDetails?.[sourceIndex]?.sourceNodeId || '';
  } catch {
    // A textual brand name is still overlaid when the exact logo crop cannot
    // be recovered from the source detail image.
  }
}

async function materializeProductViews(job, context) {
  if (!Array.isArray(job.productViews) || !job.productViews.length) return;
  const { imageTarget } = getStorage(job.workflowId, context.dirs);
  for (const view of job.productViews) {
    if (view.imageUrl && imageInputToBuffer(view.imageUrl, context)) continue;
    const source = imageInputToBuffer(job.ownDetails?.[view.sourceImageIndex]?.imageUrl, context);
    const region = normalizeRegion(view.cropRegion);
    if (!source || !region) continue;
    try {
      const image = sharp(source, { failOn: 'none' });
      const metadata = await image.metadata();
      const width = Number(metadata.width) || 0;
      const height = Number(metadata.height) || 0;
      if (!(width > 0 && height > 0)) continue;
      const left = Math.max(0, Math.min(width - 1, Math.floor(width * region.x)));
      const top = Math.max(0, Math.min(height - 1, Math.floor(height * region.y)));
      const cropWidth = Math.max(1, Math.min(width - left, Math.round(width * region.width)));
      const cropHeight = Math.max(1, Math.min(height - top, Math.round(height * region.height)));
      const buffer = await image
        .extract({ left, top, width: cropWidth, height: cropHeight })
        .png()
        .toBuffer();
      const saved = saveImageBuffer(buffer, imageTarget, `${job.id}-${view.id}`);
      view.imageUrl = saved.resultUrl;
      view.width = cropWidth;
      view.height = cropHeight;
      view.materializedAt = nowIso(context);
      view.error = undefined;
    } catch (error) {
      view.error = error instanceof Error ? error.message : String(error);
    }
  }
}

function brandOverlayMetadata(job, page, context) {
  const brandSlots = Array.isArray(page.analysis?.brandSlots) ? page.analysis.brandSlots : [];
  const brandLogoBuffer = imageInputToBuffer(job.brandLogoUrl, context);
  return {
    brandLogoBuffer,
    brandSlot: brandSlots[0],
    brandIdentity: job.brandIdentity || {},
  };
}

function writeResultMetadata(imageTarget, nodeId, metadata) {
  atomicWriteJson(path.join(imageTarget.targetDir, `${safeSegment(nodeId)}.json`), {
    id: nodeId,
    type: 'images',
    createdAt: new Date().toISOString(),
    ...metadata,
  });
}

function generatedImageEntry(result) {
  if (!result) return null;
  if (Buffer.isBuffer(result)) return { buffer: result, extension: 'png' };
  if (Array.isArray(result)) return generatedImageEntry(result[0]);
  if (Array.isArray(result.images)) return generatedImageEntry(result.images[0]);
  return result;
}

async function waitForCodexResult(context, codexJobId, signal) {
  context.codexAutomation?.notify?.();
  const deadline = Date.now() + (context.codexTimeoutMs || 30 * 60_000);
  const pollInterval = context.codexPollIntervalMs || 1_500;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw cancellationError();
    const current = getCodexImageJob(context.codexJobsDir, codexJobId);
    if (current?.status === 'completed' && current.resultUrl) return { resultUrl: current.resultUrl };
    if (current?.status === 'failed') throw new Error(current.error || 'Codex 生图任务失败');
    if (current?.status === 'cancelled') throw cancellationError();
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  const timeout = new Error('Codex 生图队列等待超时；任务 ID 已保留，重启后将继续等待同一任务，不会重复提交');
  timeout.code = 'CODEX_QUEUE_TIMEOUT';
  timeout.submitted = true;
  throw timeout;
}

/**
 * Each structural retry gets its own pointer. Sharing one field would make
 * runImageGeneration find the previous attempt's remembered job id and silently
 * await the already-failed generation instead of submitting a new one.
 */
function structuralRegenerationJobField(attempt) {
  return `regenerateCodexImageJobId${Math.max(1, Number(attempt) || 1)}`;
}

function structuralRegenerationPhase(attempt) {
  return `final-regenerate-${Math.max(1, Number(attempt) || 1)}`;
}

function codexJobFieldForPhase(phase) {
  if (phase === 'blank-plate') return 'plateCodexImageJobId';
  if (phase === 'product-compose') return 'composeCodexImageJobId';
  if (phase === 'final-repair') return 'repairCodexImageJobId';
  const structural = /^final-regenerate-(\d+)$/u.exec(String(phase || ''));
  if (structural) return structuralRegenerationJobField(structural[1]);
  return 'codexImageJobId';
}

function pageForGenerationMeta(job, meta) {
  const pageIndex = Number(meta?.pageIndex);
  return Number.isInteger(pageIndex)
    ? job.pages?.find(page => Number(page.index) === pageIndex)
    : null;
}

async function runRecognition(request, context, meta) {
  if (context.runRecognition) return context.runRecognition(request, meta);
  const provider = getPromptOptimizerProvider(meta.providerId);
  if (!provider?.supportsImage) throw new Error(`识图 Provider 不可用：${meta.providerId}`);
  return provider.run(request);
}

async function runImageGeneration(request, job, context, meta, signal) {
  if (context.generateImage) return generatedImageEntry(await context.generateImage(request, meta));
  if (isGoogleFlowImageWorkflowModel(job.imageModel)) {
    return generatedImageEntry(await generateGoogleFlowWorkflowImage(request));
  }
  if (isJimengImageWorkflowModel(job.imageModel)) {
    return generatedImageEntry(await generateJimengWorkflowImage(request));
  }
  if (isGeminiWebImageModel(job.imageModel)) {
    return generatedImageEntry(await generateGeminiWebImage(request));
  }
  if (job.imageModel === 'codex-imagegen') {
    const target = getStorage(job.workflowId, context.dirs).imageTarget;
    const page = pageForGenerationMeta(job, meta);
    const jobField = codexJobFieldForPhase(meta?.phase);
    const rememberedJobId = String(page?.[jobField] || job.currentSubmission?.codexJobId || '');
    let codexJob = rememberedJobId
      ? getCodexImageJob(context.codexJobsDir, rememberedJobId)
      : null;
    if (codexJob?.status === 'cancelled') throw cancellationError();
    if (codexJob?.status === 'failed') throw new Error(codexJob.error || 'Codex 生图任务失败');
    if (!codexJob) {
      codexJob = createCodexImageJob({
        jobsDir: context.codexJobsDir,
        libraryDir: context.libraryDir,
        nodeId: request.nodeId,
        prompt: request.prompt,
        aspectRatio: request.aspectRatio,
        resolution: request.resolution,
        referenceImages: request.referenceImageInputs,
        workflowId: job.workflowId,
        projectDirName: target.projectDirName,
      });
    }
    if (page) page[jobField] = codexJob.id;
    job.currentSubmission = {
      ...(job.currentSubmission || {}),
      kind: job.currentSubmission?.kind || meta?.phase || 'codex-image',
      pageIndex: meta?.pageIndex,
      codexJobId: codexJob.id,
      submittedAt: job.currentSubmission?.submittedAt || nowIso(context),
    };
    writeJob(job, context);
    return waitForCodexResult(context, codexJob.id, signal);
  }
  throw new Error(`商品详情复刻暂不支持图片模型：${job.imageModel}`);
}

function delayBeforeRetry(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(cancellationError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, milliseconds);
    function onAbort() {
      clearTimeout(timer);
      reject(cancellationError());
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/**
 * Retry a generation only when nothing can possibly have been charged for.
 *
 * Codex submission writes a child-job id onto the page the instant a job exists,
 * so its absence is proof that no order was placed and the request may be sent
 * again. Browser-driven providers offer no such proof — a failure there can come
 * from before the prompt was sent or from after the image was already produced —
 * so those errors are surfaced untouched rather than risking a double charge.
 */
async function runImageGenerationSafely(request, job, context, meta, signal) {
  const page = pageForGenerationMeta(job, meta);
  const jobField = codexJobFieldForPhase(meta?.phase);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await runImageGeneration(request, job, context, meta, signal);
    } catch (error) {
      if (isOperationCancelled(error) || signal?.aborted) throw error;
      const provablyUnsubmitted = job.imageModel === 'codex-imagegen'
        && error?.submitted !== true
        && !page?.[jobField]
        && !job.currentSubmission?.codexJobId;
      if (!provablyUnsubmitted || attempt >= MAX_UNSUBMITTED_GENERATION_RETRIES) throw error;
      const base = Number.isFinite(Number(context.generationRetryDelayMs))
        ? Number(context.generationRetryDelayMs)
        : GENERATION_RETRY_DELAY_MS;
      await delayBeforeRetry(base * (attempt + 1), signal);
    }
  }
}

function makeGenerationRequest(job, prompt, references, nodeId, context, signal, page) {
  const provider = getImageGenerationProvider(job.imageModel);
  if (!provider) throw new Error(`未知图片模型：${job.imageModel}`);
  if (references.length > provider.maxReferenceImages) {
    throw new Error(`${provider.name} 最多支持 ${provider.maxReferenceImages} 张参考图`);
  }
  return {
    prompt,
    aspectRatio: page?.generationAspectRatio || job.aspectRatio,
    resolution: job.imageResolution,
    referenceImageInputs: references,
    libraryDir: context.libraryDir,
    timeoutMinutes: 10,
    modelId: job.imageModel,
    count: 1,
    nodeId,
    workflowId: job.workflowId,
    signal,
  };
}

async function persistRawResult(result, imageTarget, assetId, context) {
  const entry = generatedImageEntry(result);
  const buffer = entry?.buffer || imageInputToBuffer(entry?.resultUrl, context);
  if (!buffer) {
    throw new Error('图片模型未返回可读取的最终图片；为避免重复扣费，请先检查平台历史记录');
  }
  const saved = saveImageBuffer(buffer, imageTarget, assetId);
  return { ...saved, buffer, providerMetadata: entry?.metadata || {} };
}

function markBoundary(job, context, boundary) {
  job.currentSubmission = boundary;
  writeJob(job, context);
}

function clearBoundary(job, context) {
  job.currentSubmission = undefined;
  writeJob(job, context);
}

async function extractOwnSellingPoints(job, context, signal) {
  const knowledgeCurrent = Number(job.ownRecognition?.knowledgeSchemaVersion) >= DETAIL_REMIX_KNOWLEDGE_SCHEMA_VERSION;
  if ((job.ownSellingPoints?.length || job.verifiedFacts?.length)
      && job.ownRecognition?.status === 'completed'
      && knowledgeCurrent) {
    await materializeBrandLogo(job, context);
    await materializeProductViews(job, context);
    const usableProductViews = productViewCatalog(job);
    job.ownRecognition.productViewCount = usableProductViews.length;
    if (!usableProductViews.length && !job.productImages?.length) {
      throw new Error('未能从“我的详情”识别出清晰可用的产品角度；可换用更清晰的详情图，或连接一张“产品补充图”');
    }
    return;
  }
  const provider = getPromptOptimizerProvider(job.recognitionProvider);
  if (!context.runRecognition && !provider?.supportsImage) {
    throw new Error(`识图 Provider 不支持图片：${job.recognitionProvider}`);
  }
  const chunkSize = Math.max(1, Number(context.recognitionBatchSize) || 4);
  const chunks = [];
  for (let index = 0; index < job.ownDetails.length; index += chunkSize) {
    chunks.push(job.ownDetails.slice(index, index + chunkSize));
  }
  if (!chunks.length) throw new Error('至少需要一张我方详情图用于提炼卖点');
  const previousRecognition = job.ownRecognition || {};
  const mustUpgradeKnowledge = Number(previousRecognition.knowledgeSchemaVersion) < DETAIL_REMIX_KNOWLEDGE_SCHEMA_VERSION;
  job.ownRecognition = {
    ...previousRecognition,
    status: mustUpgradeKnowledge ? 'waiting' : (previousRecognition.status || 'waiting'),
    knowledgeSchemaVersion: mustUpgradeKnowledge
      ? Number(previousRecognition.knowledgeSchemaVersion) || 1
      : previousRecognition.knowledgeSchemaVersion,
    totalImages: job.ownDetails.length,
    chunks: chunks.map((chunk, index) => ({
      ...(previousRecognition.chunks?.[index] || {}),
      index,
      startIndex: index * chunkSize,
      imageCount: chunk.length,
      sourceNodeIds: chunk.map(item => item.sourceNodeId).filter(Boolean),
      status: mustUpgradeKnowledge ? 'waiting' : (previousRecognition.chunks?.[index]?.status || 'waiting'),
    })),
  };
  job.ownRecognition.processedImages = job.ownRecognition.chunks
    .filter(task => task.status === 'completed')
    .reduce((total, task) => total + (Number(task.imageCount) || 0), 0);
  job.ownRecognition.sellingPointCount = Array.isArray(job.ownSellingPoints) ? job.ownSellingPoints.length : 0;
  job.ownRecognition.productViewCount = Array.isArray(job.productViews) ? job.productViews.length : 0;
  job.ownSellingPoints = Array.isArray(job.ownSellingPoints) ? job.ownSellingPoints : [];
  job.productViews = Array.isArray(job.productViews) ? job.productViews : [];
  job.verifiedFacts = Array.isArray(job.verifiedFacts) ? job.verifiedFacts : [];

  for (let index = 0; index < chunks.length; index += 1) {
    const task = job.ownRecognition.chunks[index] || { index, status: 'waiting' };
    job.ownRecognition.chunks[index] = task;
    if (task.status === 'completed') continue;
    // Recognition is a text/image understanding call, not a paid image
    // generation order. An interrupted call is safe to repeat and must never
    // be stranded behind the provider-submission warning used for image jobs.
    if (['submitting', 'processing', 'recovery_required'].includes(task.status)) {
      task.status = 'waiting';
    }
    assertActive(job, context, signal);
    task.status = 'preparing';
    job.ownRecognition.status = 'processing';
    job.stage = 'extracting_selling_points';
    job.stageLabel = chunks.length > 1
      ? `正在识别我方卖点与产品角度 ${index + 1} / ${chunks.length}`
      : '正在识别我方卖点与产品角度';
    writeJob(job, context);
    const imageDataUrls = chunks[index].map(item => imageInputToDataUrl(item.imageUrl, context));
    if (imageDataUrls.some(value => !value)) throw new Error('无法读取我方详情图');
    task.status = 'processing';
    task.startedAt = nowIso(context);
    task.attempts = Math.max(0, Number(task.attempts) || 0) + 1;
    writeJob(job, context);
    const request = {
      systemInstruction: buildOwnSellingPointsInstruction({
        imageCount: chunks[index].length,
        chunkIndex: index,
        chunkCount: chunks.length,
      }),
      userPrompt: '提炼我方商品真实卖点，并识别图片中可复用的产品角度与紧致裁剪区域；严格返回指定 JSON。',
      imageDataUrls,
      outputSchema: DETAIL_REMIX_OWN_KNOWLEDGE_OUTPUT_SCHEMA,
      model: job.recognitionModel,
      effort: job.recognitionProvider === 'codex-cli' ? 'high' : (provider?.defaultEffort || ''),
      temperature: 0.1,
      maxTokens: 4000,
      timeoutMs: Number(context.recognitionTimeoutMs) || DETAIL_REMIX_RECOGNITION_TIMEOUT_MS,
      libraryDir: context.libraryDir,
      signal,
    };
    let raw;
    let parsed;
    try {
      raw = await runRecognition(request, context, {
        providerId: job.recognitionProvider,
        kind: 'own-selling-points',
        chunkIndex: index,
      });
      assertActive(job, context, signal);
      parsed = parseOwnSellingPointsResponse(raw);
    } catch (error) {
      if (!isOperationCancelled(error)) {
        task.lastError = error instanceof Error ? error.message : String(error);
        task.lastFailedAt = nowIso(context);
        writeJob(job, context);
      }
      throw error;
    }
    const chunkStart = index * chunkSize;
    const chunkBrand = normalizeBrandIdentity(parsed);
    if (Number.isInteger(chunkBrand.logoSourceImageIndex)
        && chunkBrand.logoSourceImageIndex >= 0
        && chunkBrand.logoSourceImageIndex < chunks[index].length) {
      chunkBrand.logoSourceImageIndex += chunkStart;
    } else {
      delete chunkBrand.logoSourceImageIndex;
      delete chunkBrand.logoRegion;
    }
    job.brandIdentity = mergeBrandIdentity(job.brandIdentity, chunkBrand);
    const chunkViews = normalizeProductViews(parsed, chunkStart, chunks[index].length, job.ownDetails);
    job.productViews = mergeProductViews(job.productViews, chunkViews);
    const chunkPoints = normalizeSellingPoints(parsed).map(point => {
      const localIndexes = [...new Set((point.sourceImageIndexes || [])
        .map(Number)
        .filter(value => Number.isInteger(value) && value >= 0 && value < chunks[index].length))];
      const sourceImageIndexes = localIndexes.map(value => chunkStart + value);
      const sourceNodeIds = [...new Set([
        ...(Array.isArray(point.sourceNodeIds) ? point.sourceNodeIds : []),
        ...sourceImageIndexes.map(value => job.ownDetails[value]?.sourceNodeId),
      ].map(value => String(value || '').trim()).filter(Boolean))];
      return { ...point, sourceImageIndexes, sourceNodeIds };
    });
    job.ownSellingPoints = mergeSellingPoints(job.ownSellingPoints, chunkPoints);
    const chunkFacts = normalizeVerifiedFacts(
      parsed,
      chunkStart,
      chunks[index].length,
      job.ownDetails,
    );
    job.verifiedFacts = mergeVerifiedFacts(job.verifiedFacts, chunkFacts);
    task.status = 'completed';
    task.completedAt = nowIso(context);
    task.response = parsed;
    job.ownRecognition.processedImages = job.ownRecognition.chunks
      .filter(item => item.status === 'completed')
      .reduce((total, item) => total + (Number(item.imageCount) || 0), 0);
    job.ownRecognition.sellingPointCount = job.ownSellingPoints.length;
    job.ownRecognition.productViewCount = job.productViews.length;
    clearBoundary(job, context);
  }
  if (!job.ownSellingPoints.length && !job.verifiedFacts.length) {
    throw new Error('未能从我方详情中提炼出可用卖点或核验参数');
  }
  job.ownRecognition.status = 'completed';
  job.ownRecognition.knowledgeSchemaVersion = DETAIL_REMIX_KNOWLEDGE_SCHEMA_VERSION;
  job.ownRecognition.processedImages = job.ownDetails.length;
  job.ownRecognition.sellingPointCount = job.ownSellingPoints.length;
  job.ownRecognition.productViewCount = job.productViews.length;
  job.ownRecognition.completedAt = nowIso(context);
  await materializeBrandLogo(job, context);
  await materializeProductViews(job, context);
  const usableProductViews = productViewCatalog(job);
  job.ownRecognition.productViewCount = usableProductViews.length;
  job.ownRecognition.verifiedFactCount = job.verifiedFacts.length;
  if (!usableProductViews.length && !job.productImages?.length) {
    throw new Error('未能从“我的详情”识别出清晰可用的产品角度；可换用更清晰的详情图，或连接一张“产品补充图”');
  }
  writeJob(job, context);
}

async function analyzeCompetitorPage(job, page, context, signal) {
  if (page.analysis
      && page.recognitionStatus === 'completed'
      && Number(page.competitorAnalysisVersion) >= DETAIL_REMIX_COMPETITOR_ANALYSIS_VERSION) return;
  if (page.analysis && page.recognitionStatus === 'completed') {
    // Recognition is inexpensive compared with image generation. Refresh old
    // analyses so a previously sparse copy map cannot silently flatten layout.
    page.analysis = undefined;
    page.mappedSellingPoints = undefined;
    page.mappedFacts = undefined;
    page.effectiveMappedFacts = undefined;
    page.factMappingAudit = undefined;
    page.recognitionStatus = 'waiting';
    page.recognitionAttempts = 0;
    page.recognitionFormatRetries = 0;
    page.recognitionContractRetries = 0;
    page.recognitionAutoRepairs = undefined;
    page.recognitionAutoRepairCount = 0;
  }
  if (['submitting', 'processing', 'recovery_required'].includes(page.recognitionStatus)) {
    page.recognitionStatus = 'waiting';
    if (['analyzing', 'recovery_required'].includes(page.status)) page.status = 'waiting';
  }
  await ensurePageSourceDimensions(job, page, context);
  const provider = getPromptOptimizerProvider(job.recognitionProvider);
  page.recognitionStatus = 'preparing';
  page.status = 'analyzing';
  job.stage = 'analyzing_competitor';
  job.stageLabel = `正在分析竞品详情 ${page.index + 1} / ${job.pages.length}`;
  writeJob(job, context);
  const imageDataUrl = imageInputToDataUrl(page.sourceImage, context);
  if (!imageDataUrl) throw new Error('无法读取竞品详情图');
  let parsed;
  let normalizedAnalysis;
  let factResolution;
  const instruction = buildCompetitorPageInstruction({
    ownSellingPoints: job.ownSellingPoints,
    ownVerifiedFacts: verifiedFactCatalog(job),
    ownBrandIdentity: job.brandIdentity,
    ownProductViews: productViewCatalog(job),
    ownProductSheet: job.preferSuppliedProductReferences ? job.productSheet : null,
    pageIndex: page.index,
    pageCount: job.pages.length,
  });
  for (let formatAttempt = 0; formatAttempt < 2; formatAttempt += 1) {
    page.recognitionStatus = 'processing';
    page.recognitionStartedAt ||= nowIso(context);
    page.recognitionAttempts = Math.max(0, Number(page.recognitionAttempts) || 0) + 1;
    writeJob(job, context);
    const request = {
      systemInstruction: instruction,
      userPrompt: formatAttempt === 0
        ? `分析这一张竞品详情图的构图、人物、产品角度和文字层级。严格遵守页面顺序：只有最后两张有资格判断 STRICT_PARAMETER_MODE，本页是 ${page.index + 1}/${job.pages.length}。严格参数的名称和值必须分别定位、同字段配对，并且只映射我方精确事实。营销页的胶囊标签、主标题、拆分标题、副标题和说明必须逐槽映射我方卖点并填写 replacementText，不能删除后压平层级。严格返回指定 JSON。`
        : `上一次回复未通过 JSON、参数证据或营销版式契约校验。严格遵守页面顺序：只有最后两张有资格判断 STRICT_PARAMETER_MODE，本页是 ${page.index + 1}/${job.pages.length}。严格参数页把参数名和值拆成独立槽，field 与 displayPart 必须一致，只映射有我方事实 ID 的完整 label/value 对；营销页为每个核心文案槽恰好输出一条已给卖点映射和适配 maxChars 的 replacementText，不能漏掉主标题、胶囊标签或副标题。只返回完全符合 Schema 的单个 JSON 对象，不要解释、不要 Markdown。`,
      imageDataUrls: [imageDataUrl],
      outputSchema: DETAIL_REMIX_COMPETITOR_OUTPUT_SCHEMA,
      model: job.recognitionModel,
      effort: job.recognitionProvider === 'codex-cli' ? 'high' : (provider?.defaultEffort || ''),
      temperature: 0.1,
      maxTokens: 3500,
      timeoutMs: Number(context.recognitionTimeoutMs) || DETAIL_REMIX_RECOGNITION_TIMEOUT_MS,
      libraryDir: context.libraryDir,
      signal,
    };
    try {
      const raw = await runRecognition(request, context, {
        providerId: job.recognitionProvider,
        kind: 'competitor-page',
        pageIndex: page.index,
        formatAttempt: formatAttempt + 1,
      });
      assertActive(job, context, signal);
      parsed = parseCompetitorPageResponse(raw);
      normalizedAnalysis = normalizePageAnalysis(parsed, {
        pageIndex: page.index,
        pageCount: job.pages.length,
      });
      factResolution = validateCompetitorAnalysisContract(
        normalizedAnalysis,
        job.verifiedFacts,
        job.ownSellingPoints,
        { allowRejectedFacts: formatAttempt > 0 },
      );
      break;
    } catch (error) {
      if (isOperationCancelled(error)) throw error;
      let finalError = error;
      page.recognitionLastError = error instanceof Error ? error.message : String(error);
      page.recognitionLastFailedAt = nowIso(context);
      const safelyRetryableRecognitionError = [
        'DETAIL_REMIX_JSON_FORMAT',
        'DETAIL_REMIX_ANALYSIS_CONTRACT',
      ].includes(error?.code);
      page.recognitionFormatRetries = Math.max(0, Number(page.recognitionFormatRetries) || 0)
        + (error?.code === 'DETAIL_REMIX_JSON_FORMAT' ? 1 : 0);
      page.recognitionContractRetries = Math.max(0, Number(page.recognitionContractRetries) || 0)
        + (error?.code === 'DETAIL_REMIX_ANALYSIS_CONTRACT' ? 1 : 0);
      writeJob(job, context);
      if (safelyRetryableRecognitionError && formatAttempt === 0) continue;
      if (error?.code === 'DETAIL_REMIX_ANALYSIS_CONTRACT' && normalizedAnalysis) {
        const repaired = repairMarketingCopyContract(normalizedAnalysis, job.ownSellingPoints);
        if (repaired.repairs.length || repaired.analysis?.copyMappingAutoRepaired === true) {
          try {
            normalizedAnalysis = repaired.analysis;
            factResolution = validateCompetitorAnalysisContract(
              normalizedAnalysis,
              job.verifiedFacts,
              job.ownSellingPoints,
              { allowRejectedFacts: true },
            );
            page.recognitionAutoRepairs = repaired.repairs;
            page.recognitionAutoRepairCount = repaired.repairs.length;
            break;
          } catch (repairError) {
            finalError = repairError;
            page.recognitionLastError = repairError instanceof Error
              ? repairError.message
              : String(repairError);
            page.recognitionLastFailedAt = nowIso(context);
          }
        }
      }
      page.recognitionStatus = 'failed';
      writeJob(job, context);
      throw finalError;
    }
  }
  if (!parsed || !normalizedAnalysis || !factResolution) throw new Error('竞品详情识别没有返回可用的结构化结果');
  page.analysis = normalizedAnalysis;
  page.analysis.sourceWidth = page.sourceWidth;
  page.analysis.sourceHeight = page.sourceHeight;
  page.mappedSellingPoints = resolveMappedSellingPoints(page.analysis, job.ownSellingPoints, page.index);
  page.mappedFacts = factResolution.mappedFacts;
  page.factMappingAudit = {
    pageMode: page.analysis.pageMode,
    strictPageCategory: page.analysis.strictPageCategory,
    acceptedCount: page.mappedFacts.length,
    rejected: factResolution.rejected,
  };
  page.recognitionStatus = 'completed';
  page.competitorAnalysisVersion = DETAIL_REMIX_COMPETITOR_ANALYSIS_VERSION;
  page.recognitionCompletedAt = nowIso(context);
  page.recognitionLastError = undefined;
  page.recognitionLastFailedAt = undefined;
  clearBoundary(job, context);
}

function resolvePageProductReferences(job, page, reservedReferenceCount = 0) {
  const provider = getImageGenerationProvider(job.imageModel);
  const availableSlots = Math.max(0, Number(provider?.maxReferenceImages || 0) - 1 - reservedReferenceCount);
  const views = Array.isArray(job.productViews) ? job.productViews.filter(view => view?.imageUrl) : [];
  const byId = new Map(views.map(view => [String(view.id), view]));
  const requestedIds = Array.isArray(page.analysis?.selectedProductViewIds)
    ? page.analysis.selectedProductViewIds.map(String)
    : [];
  const requestedViews = requestedIds.map(id => byId.get(id)).filter(Boolean);
  const requestedSet = new Set(requestedViews.map(view => String(view.id)));
  const identityComplements = [...views]
    .filter(view => !requestedSet.has(String(view.id)))
    .sort((left, right) => Number(right.quality || 0) - Number(left.quality || 0));
  // The angle-matched crop tells the model how the product should sit in the
  // competitor pose. High-quality complementary views preserve the product's
  // real construction when that pose crop is small or partially occluded.
  let selectedViews = [...requestedViews, ...identityComplements]
    .slice(0, MAX_AUTO_PRODUCT_VIEW_REFERENCES);
  if (!selectedViews.length) {
    selectedViews = [...views]
      .sort((left, right) => Number(right.quality || 0) - Number(left.quality || 0))
      .slice(0, MAX_AUTO_PRODUCT_VIEW_REFERENCES);
  }

  const supplied = (Array.isArray(job.productImages) ? job.productImages : []).map((imageUrl, index) => ({
    id: `supplement-${index + 1}`,
    imageUrl,
    viewAngle: 'user-supplied',
    description: job.productSheet && index === 0
      ? '用户提供的产品角度板'
      : '用户提供的产品补充参考',
    supplemental: true,
  }));
  // With only one product slot on most providers, a hand-built reference sheet
  // loses that slot to an auto-crop unless it is ranked first. When the user has
  // declared their own references authoritative, auto-crops leave the generation
  // set entirely: a labelled angle sheet describes every cell it carries, and an
  // extra undescribed crop alongside it only invites the model to mix sources.
  // The crops stay in the recognition catalog, which is what plans the page.
  const preferSupplied = job.preferSuppliedProductReferences === true && supplied.length > 0;
  const candidates = preferSupplied ? supplied : [...selectedViews, ...supplied];
  const seen = new Set();
  const selected = candidates.filter(item => {
    const key = canonicalMediaIdentity(item?.imageUrl);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, availableSlots);
  if (!selected.length) {
    throw new Error('本页没有可用的我方产品角度；请检查“我的详情”是否包含清晰完整的产品图');
  }
  // The declared grid only describes the first supplied image. If an auto-crop
  // still won the leading slot, the sheet manifest must not be quoted at the
  // model — it would be describing a different picture.
  page.productSheetActive = Boolean(job.productSheet && selected[0]?.id === 'supplement-1');
  page.selectedProductViewIds = selected.filter(item => !item.supplemental).map(item => item.id);
  page.selectedProductViews = selected.map(item => ({
    id: item.id,
    viewAngle: item.viewAngle || 'unknown',
    visibleSides: Array.isArray(item.visibleSides) ? item.visibleSides : [],
    description: item.description || '',
    supplemental: item.supplemental === true,
  }));
  return selected;
}

/** The product sheet manifest, but only for pages whose leading product reference is that sheet. */
function activeProductSheet(job, page) {
  return page?.productSheetActive ? (job.productSheet || null) : null;
}

function resolvePageEvidenceReferences(job, page, maximum) {
  const indexes = [...new Set((page.mappedFacts || [])
    .flatMap(fact => Array.isArray(fact?.evidence)
      ? fact.evidence.map(item => item?.evidenceImageIndex)
      : fact?.sourceImageIndexes || [])
    .map(Number)
    .filter(index => Number.isInteger(index) && index >= 0))]
    .sort((left, right) => left - right);
  return indexes.flatMap(index => {
    const source = job.ownDetails?.[index];
    return source?.imageUrl ? [{
      sourceImageIndex: index,
      sourceNodeId: source.sourceNodeId,
      imageUrl: source.imageUrl,
      label: `我的详情第 ${index + 1} 张事实证据`,
    }] : [];
  }).slice(0, Math.max(0, Number(maximum) || 0));
}

function factsSupportedByEvidenceReferences(mappedFacts, evidenceReferences) {
  const included = new Set(evidenceReferences.map(item => Number(item.sourceImageIndex)));
  return (mappedFacts || []).filter(fact => (fact.evidence || []).some(item => (
    included.has(Number(item.evidenceImageIndex))
    && String(item.evidenceImageId || '') === String(
      evidenceReferences.find(reference => Number(reference.sourceImageIndex) === Number(item.evidenceImageIndex))
        ?.sourceNodeId || '',
    )
  )));
}

async function generateBlankPlate(job, page, context, signal) {
  if (page.rawPlateUrl && page.plateUrl && page.status === 'completed') return;
  if (page.status === 'submitting'
      && !canResumeCodexSubmission(job, page, 'blank-plate', context)) {
    page.status = 'recovery_required';
    page.error = '空白详情底图在提交边界中断；系统不会自动重复提交';
    writeJob(job, context);
    return;
  }
  await ensurePageSourceDimensions(job, page, context);
  page.status = 'preparing';
  job.stage = 'generating_plates';
  job.stageLabel = `正在生成空白详情底图 ${page.index + 1} / ${job.pages.length}`;
  writeJob(job, context);
  const characterReferences = job.useCharacterReference && page.analysis?.hasPerson
    ? [...job.characterReferenceImages]
    : [];
  // Reference 1 is the competitor page strictly as a spatial/layout template.
  // Own details and products remain excluded; own copy/brand come from the
  // verified structured analysis and deterministic overlays below.
  const references = [page.sourceImage, ...characterReferences];
  const prompt = `${buildBlankDetailPrompt({
    pageAnalysis: page.analysis,
    mappedSellingPoints: page.mappedSellingPoints,
    pageIndex: page.index,
    useCharacterReference: characterReferences.length > 0,
    requireEmptyProductSlot: true,
    forbidText: true,
  })}\n\n硬性输出约束：画面中不得出现任何产品、包装、品牌标识、水印或可读文字；按分析指定位置保留自然、完整、未被人物肢体遮挡的产品空位，供后续合成。不要复制或臆造竞品产品。`;
  page.blankPrompt = prompt;
  page.generationReferenceCount = references.length;
  const { imageTarget } = getStorage(job.workflowId, context.dirs);
  let rawBuffer = page.rawPlateUrl ? imageInputToBuffer(page.rawPlateUrl, context) : null;
  if (page.rawPlateUrl && !rawBuffer) {
    throw new Error('已生成的无字详情底图无法读取；为避免重复扣费，系统不会自动重新提交');
  }
  if (!rawBuffer) {
    page.status = 'submitting';
    page.submittingAt = nowIso(context);
    markBoundary(job, context, { kind: 'blank-plate', pageIndex: page.index, submittingAt: page.submittingAt });
    const request = makeGenerationRequest(job, prompt, references, `${page.plateNodeId}-raw`, context, signal, page);
    const generated = await runImageGeneration(request, job, context, {
      phase: 'blank-plate',
      pageIndex: page.index,
      // Tests and diagnostics can inspect this without exposing image data in job JSON.
      referenceKinds: ['competitor-layout', ...characterReferences.map(() => 'character')],
    }, signal);
    assertActive(job, context, signal);
    let raw;
    try {
      raw = await persistRawResult(generated, imageTarget, `${page.plateNodeId}-raw`, {
        ...context,
        workflowIdForResolution: job.workflowId,
      });
    } catch (error) {
      throw submittedOperationError(error);
    }
    rawBuffer = raw.buffer;
    page.rawPlateUrl = raw.resultUrl;
    page.status = 'rendering_copy';
    page.generationCompletedAt = nowIso(context);
    // Once the paid provider result is durably local, a crash or typography
    // failure can resume from this raw plate without another paid submission.
    clearBoundary(job, context);
  }
  rawBuffer = await matchPageDimensions(rawBuffer, page, context);
  const normalizedRaw = saveImageBuffer(rawBuffer, imageTarget, `${page.plateNodeId}-raw`);
  page.rawPlateUrl = normalizedRaw.resultUrl;
  const brandOverlay = brandOverlayMetadata(job, page, context);
  const texts = overlayTexts(
    page.mappedSellingPoints,
    page.analysis?.copySlots,
    job.brandIdentity,
    page.analysis?.brandSlots,
    Boolean(brandOverlay.brandLogoBuffer),
  );
  const plateBuffer = await deterministicTextOverlay(rawBuffer, texts, context, {
    jobId: job.id,
    pageIndex: page.index,
    phase: 'plate',
    ...brandOverlay,
  });
  if (!Buffer.isBuffer(plateBuffer)) throw new Error('详情文案叠加没有返回有效图片');
  const plate = saveImageBuffer(plateBuffer, imageTarget, page.plateNodeId);
  page.plateUrl = plate.resultUrl;
  page.resultUrl = plate.resultUrl;
  page.status = 'completed';
  page.terminalStatus = undefined;
  page.completedAt = nowIso(context);
  page.error = undefined;
  writeResultMetadata(imageTarget, page.plateNodeId, {
    filename: plate.filename,
    prompt,
    model: job.imageModel,
    aspectRatio: page.aspectRatio || job.aspectRatio,
    generationAspectRatio: page.generationAspectRatio,
    resolution: job.imageResolution,
    width: page.outputWidth,
    height: page.outputHeight,
    sourceJobId: job.id,
    sourceNodeId: page.sourceNodeId,
    sourcePageIndex: page.index,
    detailRemixPhase: 'plate',
    rawPlateUrl: page.rawPlateUrl,
    mappedSellingPoints: page.mappedSellingPoints,
  });
  writeJob(job, context);
}

function exactCopyPlan(page) {
  return buildDetailCopyReplacementPlan({
    pageAnalysis: page.analysis,
    mappedSellingPoints: page.mappedSellingPoints,
    mappedFacts: Array.isArray(page.effectiveMappedFacts) ? page.effectiveMappedFacts : page.mappedFacts,
  });
}

async function validateFinalDetailPage(
  job,
  page,
  buffer,
  selectedProducts,
  brandReferences,
  evidenceReferences,
  characterReferences,
  context,
  signal,
) {
  const provider = getPromptOptimizerProvider(job.recognitionProvider);
  const copyPlan = exactCopyPlan(page);
  const generatedDataUrl = imageInputToDataUrl(buffer, context);
  const competitorLayoutDataUrl = cachedImageInputToDataUrl(job, page.sourceImage, context);
  const supporting = [
    competitorLayoutDataUrl,
    ...selectedProducts.map(item => item.imageUrl),
    ...brandReferences,
    ...evidenceReferences.map(item => item.imageUrl),
    ...characterReferences,
  ].map(value => String(value || '').startsWith('data:image/')
    ? value
    : cachedImageInputToDataUrl(job, value, context)).filter(Boolean);
  if (!generatedDataUrl) throw new Error('无法读取待质检的最终详情图');
  if (!competitorLayoutDataUrl) throw new Error('无法读取用于版式质检的竞品原图');
  page.validationStatus = 'processing';
  page.validationAttempts = Math.max(0, Number(page.validationAttempts) || 0) + 1;
  job.stage = 'validating_final';
  job.stageLabel = `正在质检最终详情 ${page.index + 1} / ${job.pages.length}`;
  writeJob(job, context);
  const instruction = buildFinalDetailValidationInstruction({
    pageAnalysis: page.analysis,
    copyPlan,
    ownBrandIdentity: job.brandIdentity,
    productReferenceCount: selectedProducts.length,
    hasBrandLogoReference: brandReferences.length > 0,
    evidenceReferenceCount: evidenceReferences.length,
    characterReferenceCount: characterReferences.length,
    productSheet: activeProductSheet(job, page),
  });
  let parsed;
  for (let attempt = 0; attempt < MAX_VALIDATION_CALL_ATTEMPTS; attempt += 1) {
    assertActive(job, context, signal);
    const request = {
      systemInstruction: instruction,
      userPrompt: attempt === 0
        ? '验收参考图1。逐字核对文案、参数、品牌和产品；若提供人物参考，还必须分别核对人脸、发型、服装和配饰。严格返回指定 JSON。'
        : '上一次质检结果未通过 JSON 校验。请重新检查同一组图片，只返回符合 Schema 的 JSON。',
      imageDataUrls: [generatedDataUrl, ...supporting],
      outputSchema: DETAIL_REMIX_FINAL_VALIDATION_OUTPUT_SCHEMA,
      model: job.recognitionModel,
      effort: job.recognitionProvider === 'codex-cli' ? 'high' : (provider?.defaultEffort || ''),
      temperature: 0,
      maxTokens: 1800,
      timeoutMs: Number(context.recognitionTimeoutMs) || DETAIL_REMIX_RECOGNITION_TIMEOUT_MS,
      libraryDir: context.libraryDir,
      signal,
    };
    try {
      const raw = await runRecognition(request, context, {
        providerId: job.recognitionProvider,
        kind: 'final-detail-validation',
        pageIndex: page.index,
        attempt: attempt + 1,
      });
      parsed = parseFinalDetailValidationResponse(raw);
      break;
    } catch (error) {
      if (isOperationCancelled(error)) throw error;
      if (attempt + 1 >= MAX_VALIDATION_CALL_ATTEMPTS) throw error;
      // Judging costs nothing and submits nothing. A CLI crash, a timeout or a
      // malformed answer must never condemn a page whose paid image is already
      // on disk, so every failure here is simply asked again.
      if (error?.code !== 'DETAIL_REMIX_JSON_FORMAT') {
        const base = Number.isFinite(Number(context.validationRetryDelayMs))
          ? Number(context.validationRetryDelayMs)
          : VALIDATION_RETRY_DELAY_MS;
        await delayBeforeRetry(base * (attempt + 1), signal);
      }
    }
  }
  if (!parsed) throw new Error('最终详情质检没有返回可用结果');
  const { blocking, advisory, passed, advisoryOnly } = classifyFinalDetailValidation(parsed);
  const validation = {
    ...parsed,
    passed,
    blockingFailures: blocking,
    advisoryFailures: advisory,
    advisoryOnly,
  };
  page.validation = validation;
  page.validationStatus = passed ? 'passed' : 'failed';
  page.validationCompletedAt = nowIso(context);
  writeJob(job, context);
  return validation;
}

/**
 * Second opinion on the same pixels. Only ever used when the first report named
 * nothing but aesthetic complaints — re-judging a literal wrong-number finding
 * would be pure waste, and waiving one would be wrong.
 */
async function confirmAdvisoryValidationFailure(
  job,
  page,
  buffer,
  selectedProducts,
  brandReferences,
  evidenceReferences,
  characterReferences,
  context,
  signal,
) {
  page.validationRejudgeCount = Math.max(0, Number(page.validationRejudgeCount) || 0) + 1;
  job.stage = 'revalidating_final';
  job.stageLabel = `正在复核第 ${page.index + 1} 页的主观质检判定`;
  writeJob(job, context);
  return validateFinalDetailPage(
    job,
    page,
    buffer,
    selectedProducts,
    brandReferences,
    evidenceReferences,
    characterReferences,
    context,
    signal,
  );
}

async function repairFinalDetailPage(
  job,
  page,
  rawBuffer,
  validation,
  brandReferences,
  evidenceReferences,
  characterReferences,
  context,
  signal,
) {
  const pendingRepairSubmission = Boolean(
    page.repairCodexImageJobId
      && !page.repairCompletedAt
      && Number(page.repairAttempts || 0) > 0,
  );
  const repairAttempt = pendingRepairSubmission
    ? Math.max(1, Number(page.repairAttempts) || 1)
    : Math.max(0, Number(page.repairAttempts) || 0) + 1;
  if (repairAttempt > MAX_FINAL_REPAIR_ATTEMPTS) return rawBuffer;
  const { imageTarget } = getStorage(job.workflowId, context.dirs);
  page.repairAttempts = repairAttempt;
  page.status = 'repairing_final';
  job.stage = 'repairing_final';
  job.stageLabel = `正在 AI 修复第 ${page.index + 1} 页质检问题`;
  writeJob(job, context);
  const current = saveImageBuffer(rawBuffer, imageTarget, `${page.resultNodeId}-quality-failed-${repairAttempt}`);
  page.qualityFailedCandidateUrl = current.resultUrl;
  const repairReferences = [
    current.resultUrl,
    page.sourceImage,
    ...evidenceReferences.map(item => item.imageUrl),
    ...brandReferences,
    ...characterReferences,
  ];
  const prompt = buildFinalDetailRepairPrompt({
    pageAnalysis: page.analysis,
    copyPlan: exactCopyPlan(page),
    ownBrandIdentity: job.brandIdentity,
    validation,
    evidenceReferenceCount: evidenceReferences.length,
    hasBrandLogoReference: brandReferences.length > 0,
    characterReferenceCount: characterReferences.length,
  });
  page.repairPrompt = prompt;
  page.status = 'submitting';
  page.repairSubmittingAt = nowIso(context);
  markBoundary(job, context, {
    kind: 'final-repair',
    pageIndex: page.index,
    submittingAt: page.repairSubmittingAt,
  });
  const request = makeGenerationRequest(
    job,
    prompt,
    repairReferences,
    `${page.resultNodeId}-repair-${repairAttempt}-raw`,
    context,
    signal,
    page,
  );
  const generated = await runImageGenerationSafely(request, job, context, {
    phase: 'final-repair',
    pageIndex: page.index,
    referenceKinds: [
      'quality-failed-final',
      'competitor-layout-original',
      ...evidenceReferences.map(() => 'own-fact-evidence'),
      ...brandReferences.map(() => 'own-brand-logo'),
      ...characterReferences.map(() => 'character'),
    ],
  }, signal);
  assertActive(job, context, signal);
  let persisted;
  try {
    persisted = await persistRawResult(
      generated,
      imageTarget,
      `${page.resultNodeId}-repair-${repairAttempt}-raw`,
      { ...context, workflowIdForResolution: job.workflowId },
    );
  } catch (error) {
    throw submittedOperationError(error);
  }
  page.initialRawResultUrl ||= page.rawResultUrl;
  page.rawResultUrl = persisted.resultUrl;
  page.repairCompletedAt = nowIso(context);
  clearBoundary(job, context);
  return matchPageDimensions(persisted.buffer, page, context);
}

/** Returns undefined when the caller expressed no preference, so defaults stay resolvable later. */
export function normalizeStructuralRegenerationBudget(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return Math.min(MAX_STRUCTURAL_REGENERATIONS_LIMIT, parsed);
}

function resolveStructuralRegenerationBudget(job, context) {
  const configured = [job?.maxStructuralRegenerations, context?.maxStructuralRegenerations]
    .map(normalizeStructuralRegenerationBudget)
    .find(value => value !== undefined);
  return configured === undefined ? DEFAULT_MAX_STRUCTURAL_REGENERATIONS : configured;
}

/**
 * Generate the page again from the original references instead of editing the
 * rejected candidate. An edit pass can fix a wrong word; it cannot undo garbled
 * type or a collapsed layout, because the damage is in the render itself.
 */
async function regenerateFinalDetailPage(job, page, basePrompt, references, validation, context, signal) {
  const pendingAttempt = Number(page.structuralRegenerationAttempts || 0);
  const resuming = Boolean(
    pendingAttempt > 0
      && page[structuralRegenerationJobField(pendingAttempt)]
      && !page.structuralRegenerationCompletedAt,
  );
  const attempt = resuming ? pendingAttempt : pendingAttempt + 1;
  const { imageTarget } = getStorage(job.workflowId, context.dirs);
  page.structuralRegenerationAttempts = attempt;
  page.structuralRegenerationCompletedAt = undefined;
  page.status = 'regenerating_final';
  job.stage = 'regenerating_final';
  job.stageLabel = `正在重新生成第 ${page.index + 1} 页（质检结构性失败第 ${attempt} 次）`;
  writeJob(job, context);
  // The rejected candidate stays on disk so a later manual review can compare it
  // against whatever this attempt produces.
  const rejected = saveImageBuffer(
    imageInputToBuffer(page.rawResultUrl, context),
    imageTarget,
    `${page.resultNodeId}-quality-failed-regen-${attempt}`,
  );
  page.qualityFailedCandidateUrl = rejected.resultUrl;
  const prompt = buildFinalDetailRegenerationPrompt({ basePrompt, validation, attempt });
  page.structuralRegenerationPrompt = prompt;
  page.status = 'submitting';
  page.structuralRegenerationSubmittingAt = nowIso(context);
  const phase = structuralRegenerationPhase(attempt);
  const assetId = `${page.resultNodeId}-regen-${attempt}-raw`;
  markBoundary(job, context, {
    kind: phase,
    pageIndex: page.index,
    submittingAt: page.structuralRegenerationSubmittingAt,
  });
  const request = makeGenerationRequest(job, prompt, references, assetId, context, signal, page);
  const generated = await runImageGenerationSafely(request, job, context, {
    phase,
    pageIndex: page.index,
    referenceKinds: ['structural-regeneration'],
  }, signal);
  assertActive(job, context, signal);
  let persisted;
  try {
    persisted = await persistRawResult(generated, imageTarget, assetId, {
      ...context,
      workflowIdForResolution: job.workflowId,
    });
  } catch (error) {
    throw submittedOperationError(error);
  }
  page.initialRawResultUrl ||= page.rawResultUrl;
  page.rawResultUrl = persisted.resultUrl;
  page.structuralRegenerationCompletedAt = nowIso(context);
  clearBoundary(job, context);
  return matchPageDimensions(persisted.buffer, page, context);
}

/**
 * Which submission a page is mid-flight on, decided from that page's own state.
 * Reading it off the job-wide `currentSubmission` misattributes the phase as soon
 * as more than one page holds a live child job — the resumable one then looks
 * unresumable and a paid generation is abandoned.
 */
function interruptedPhaseForPage(page) {
  const structuralAttempt = Number(page?.structuralRegenerationAttempts || 0);
  if (structuralAttempt > 0
      && page[structuralRegenerationJobField(structuralAttempt)]
      && !page.structuralRegenerationCompletedAt) {
    return structuralRegenerationPhase(structuralAttempt);
  }
  if (page?.repairCodexImageJobId && !page.repairCompletedAt) return 'final-repair';
  return 'final-detail';
}

/**
 * Everything a final-detail generation needs, derived purely from job and page
 * state. Shared by the awaited generation and by the pre-submission that queues
 * the following page while this one is being judged.
 */
function prepareFinalPageGeneration(job, page) {
  const characterReferences = job.useCharacterReference && page.analysis?.hasPerson
    ? [...job.characterReferenceImages]
    : [];
  const brandReferences = job.brandLogoUrl ? [job.brandLogoUrl] : [];
  const imageProvider = getImageGenerationProvider(job.imageModel);
  const evidenceCapacity = Math.max(
    0,
    Number(imageProvider?.maxReferenceImages || 0)
      - 1
      - characterReferences.length
      - brandReferences.length
      - 1,
  );
  const evidenceReferences = resolvePageEvidenceReferences(job, page, evidenceCapacity);
  page.effectiveMappedFacts = factsSupportedByEvidenceReferences(page.mappedFacts, evidenceReferences);
  const effectiveFactIds = new Set(page.effectiveMappedFacts.map(item => item.factId));
  page.omittedMappedFacts = (page.mappedFacts || [])
    .filter(item => !effectiveFactIds.has(item.factId))
    .map(item => ({
      factId: item.factId,
      field: item.field,
      label: item.label,
      value: item.value,
      reason: 'evidence_reference_limit',
    }));
  const selectedProducts = resolvePageProductReferences(
    job,
    page,
    characterReferences.length + brandReferences.length + evidenceReferences.length,
  );
  // One generation request receives every visual input it needs. Only the
  // exact own-detail pages that prove mapped facts are included; unrelated
  // pages remain excluded to avoid confusing the image model.
  const productReferences = selectedProducts.map(item => item.imageUrl);
  const references = [
    page.sourceImage,
    ...productReferences,
    ...brandReferences,
    ...evidenceReferences.map(item => item.imageUrl),
    ...characterReferences,
  ];
  const prompt = buildFinalDetailPrompt({
    pageAnalysis: page.analysis,
    mappedSellingPoints: page.mappedSellingPoints,
    mappedFacts: page.effectiveMappedFacts,
    pageIndex: page.index,
    productImageCount: productReferences.length,
    selectedProductViews: page.selectedProductViews,
    ownBrandIdentity: job.brandIdentity,
    hasBrandLogoReference: brandReferences.length > 0,
    ownEvidenceReferenceCount: evidenceReferences.length,
    useCharacterReference: characterReferences.length > 0,
    productSheet: activeProductSheet(job, page),
  });
  page.finalPrompt = prompt;
  page.prompt = prompt;
  page.generationReferenceCount = references.length;
  return {
    prompt,
    references,
    selectedProducts,
    brandReferences,
    evidenceReferences,
    characterReferences,
    referenceKinds: [
      'competitor-layout',
      ...selectedProducts.map(item => item.supplemental ? 'own-product-supplement' : 'own-product-auto-angle'),
      ...brandReferences.map(() => 'own-brand-logo'),
      ...evidenceReferences.map(() => 'own-fact-evidence'),
      ...characterReferences.map(() => 'character'),
    ],
  };
}

/**
 * Queue the next page's paid generation while this page is being judged.
 *
 * Only for `codex-imagegen`, where submitting is just writing a job file that a
 * single worker consumes in creation order. The worker still renders one page at
 * a time — nothing extra runs in parallel — but it stops idling through this
 * page's validation, repair and re-judge. Every submission is recorded on its own
 * page, which is what makes it recoverable and cancellable.
 */
async function presubmitNextPageGeneration(job, page, context) {
  if (job.imageModel !== 'codex-imagegen' || !context.codexJobsDir) return;
  if (context.generateImage) return;
  const next = (job.pages || []).find(candidate => (
    Number(candidate.index) > Number(page.index)
      // Only a current analysis may be pre-submitted. A stale one would be
      // re-recognized when the loop arrives, producing a different prompt than
      // the one the paid child is already carrying.
      && candidate.recognitionStatus === 'completed'
      && candidate.analysis
      && Number(candidate.competitorAnalysisVersion) >= DETAIL_REMIX_COMPETITOR_ANALYSIS_VERSION
      && !candidate.codexImageJobId
      && !candidate.rawResultUrl
      && !['completed', 'failed', 'failed_validation', 'recovery_required', 'cancelled'].includes(candidate.status)
  ));
  if (!next) return;
  try {
    // The per-page pixel size is part of the prompt; without it the page would be
    // asked for at "自动" dimensions instead of following its competitor original.
    await ensurePageSourceDimensions(job, next, context);
    const { prompt, references } = prepareFinalPageGeneration(job, next);
    const provider = getImageGenerationProvider(job.imageModel);
    if (!provider || references.length > provider.maxReferenceImages) return;
    const { imageTarget } = getStorage(job.workflowId, context.dirs);
    const codexJob = createCodexImageJob({
      jobsDir: context.codexJobsDir,
      libraryDir: context.libraryDir,
      nodeId: `${next.resultNodeId}-raw`,
      prompt,
      aspectRatio: next.generationAspectRatio || job.aspectRatio,
      resolution: job.imageResolution,
      referenceImages: references,
      workflowId: job.workflowId,
      projectDirName: imageTarget.projectDirName,
    });
    next.codexImageJobId = codexJob.id;
    next.status = 'submitting';
    next.submittingAt = nowIso(context);
    next.presubmittedAt = next.submittingAt;
    // Remembered verbatim: this is the text the paid render was made from, and
    // it is what the page must report no matter what a later rebuild produces.
    next.presubmittedPrompt = prompt;
    writeJob(job, context);
    context.codexAutomation?.notify?.();
  } catch {
    // Pre-submission is an optimization. If preparing or queueing fails, the
    // page is left untouched and submitted normally when the loop reaches it.
  }
}

async function generateFinalPage(job, page, context, signal) {
  if ((page.finalUrl || page.resultUrl) && page.status === 'completed') return;
  if (page.status === 'submitting'
      && !canResumeCodexSubmission(job, page, interruptedPhaseForPage(page), context)) {
    page.status = 'recovery_required';
    page.error = '最终详情图在提交边界中断；系统不会自动重复提交';
    writeJob(job, context);
    return;
  }
  await ensurePageSourceDimensions(job, page, context);
  page.status = 'preparing';
  job.stage = 'generating_final';
  job.stageLabel = `正在生成最终详情 ${page.index + 1} / ${job.pages.length}`;
  writeJob(job, context);

  const {
    prompt: rebuiltPrompt,
    references,
    selectedProducts,
    brandReferences,
    evidenceReferences,
    characterReferences,
    referenceKinds,
  } = prepareFinalPageGeneration(job, page);
  // When this page was queued ahead of time, the paid child already holds its own
  // prompt and the request below only awaits it. Report that text, so the stored
  // metadata always describes the render that was actually produced.
  const prompt = page.codexImageJobId && page.presubmittedPrompt
    ? page.presubmittedPrompt
    : rebuiltPrompt;
  page.finalPrompt = prompt;
  page.prompt = prompt;
  const { imageTarget } = getStorage(job.workflowId, context.dirs);
  let rawBuffer = page.rawResultUrl ? imageInputToBuffer(page.rawResultUrl, context) : null;
  if (page.rawResultUrl && !rawBuffer) {
    throw new Error('已生成的最终详情原图无法读取；为避免重复扣费，系统不会自动重新提交');
  }
  if (!rawBuffer) {
    page.status = 'submitting';
    page.submittingAt = nowIso(context);
    markBoundary(job, context, { kind: 'final-detail', pageIndex: page.index, submittingAt: page.submittingAt });
    const request = makeGenerationRequest(job, prompt, references, `${page.resultNodeId}-raw`, context, signal, page);
    const generated = await runImageGenerationSafely(request, job, context, {
      phase: 'final-detail',
      pageIndex: page.index,
      referenceKinds,
    }, signal);
    assertActive(job, context, signal);
    let raw;
    try {
      raw = await persistRawResult(generated, imageTarget, `${page.resultNodeId}-raw`, {
        ...context,
        workflowIdForResolution: job.workflowId,
      });
    } catch (error) {
      throw submittedOperationError(error);
    }
    rawBuffer = raw.buffer;
    page.rawResultUrl = raw.resultUrl;
    page.status = 'normalizing_output';
    page.generationCompletedAt = nowIso(context);
    // The paid model result already contains the final product, copy and logo.
    // No local content overlay is ever applied. A second AI edit is allowed
    // only when the independent quality gate rejects this candidate.
    clearBoundary(job, context);
    // This page's render is safely on disk and everything that follows for it —
    // validation, re-judge, repair — needs no image worker. Hand the worker the
    // next page now so it is not idle for that whole stretch.
    await presubmitNextPageGeneration(job, page, context);
  }

  rawBuffer = await matchPageDimensions(rawBuffer, page, context);
  let normalizedRaw = saveImageBuffer(rawBuffer, imageTarget, `${page.resultNodeId}-raw`);
  page.rawResultUrl = normalizedRaw.resultUrl;
  let validation = context.skipFinalValidation === true
    ? {
      passed: true,
      copyExact: true,
      brandCorrect: true,
      productCorrect: true,
      logoCorrect: true,
      logoPresentationCorrect: true,
      layoutHierarchyCorrect: true,
      visualPolishCorrect: true,
      layoutIssues: [],
      productPlacementCorrect: true,
      parameterAlignmentCorrect: true,
      unsupportedStrictFactsAbsent: true,
      characterIdentityCorrect: true,
      characterHairstyleCorrect: true,
      characterOutfitCorrect: true,
      characterAccessoriesCorrect: true,
      characterIssues: [],
      competitorRemoved: true,
      gibberishDetected: false,
      missingTexts: [],
      wrongTexts: [],
      unexpectedTexts: [],
      summary: '测试环境跳过成图质检',
    }
    : await validateFinalDetailPage(
      job,
      page,
      rawBuffer,
      selectedProducts,
      brandReferences,
      evidenceReferences,
      characterReferences,
      context,
      signal,
    );
  // A first report that names nothing but aesthetic complaints gets a second look
  // before any money is spent repairing it; judges disagree with themselves far
  // more often about polish than about a wrong model number.
  if (!validation.passed
      && validation.advisoryOnly
      && context.skipFinalValidation !== true
      && Number(page.validationRejudgeCount || 0) < MAX_VALIDATION_REJUDGE_ATTEMPTS) {
    validation = await confirmAdvisoryValidationFailure(
      job,
      page,
      rawBuffer,
      selectedProducts,
      brandReferences,
      evidenceReferences,
      characterReferences,
      context,
      signal,
    );
  }
  const maxStructuralRegenerations = resolveStructuralRegenerationBudget(job, context);
  const pendingRepairSubmission = () => Boolean(
    page.repairCodexImageJobId
      && !page.repairCompletedAt
      && Number(page.repairAttempts || 0) > 0,
  );
  const pendingRegenerationSubmission = () => {
    const attempt = Number(page.structuralRegenerationAttempts || 0);
    return Boolean(
      attempt > 0
        && page[structuralRegenerationJobField(attempt)]
        && !page.structuralRegenerationCompletedAt,
    );
  };
  // repairFinalDetailPage returns the candidate untouched once its budget is
  // spent, so an unexpected attempt count must not be able to spin this loop.
  const maxRecoveryRounds = MAX_FINAL_REPAIR_ATTEMPTS + maxStructuralRegenerations + 1;
  for (let round = 0; !validation.passed && round < maxRecoveryRounds; round += 1) {
    assertActive(job, context, signal);
    const canRepair = Number(page.repairAttempts || 0) < MAX_FINAL_REPAIR_ATTEMPTS
      || pendingRepairSubmission();
    // Only hard facts justify spending another paid image. A page whose sole
    // remaining complaint is polish is already deliverable.
    const canRegenerate = Boolean(validation.blockingFailures?.length)
      && (Number(page.structuralRegenerationAttempts || 0) < maxStructuralRegenerations
        || pendingRegenerationSubmission());
    let nextBuffer;
    if (canRepair) {
      // The targeted edit stays the first response: it is what the repair prompt
      // was written for and it preserves everything the candidate already got right.
      nextBuffer = await repairFinalDetailPage(
        job,
        page,
        rawBuffer,
        validation,
        brandReferences,
        evidenceReferences,
        characterReferences,
        context,
        signal,
      );
    } else if (canRegenerate) {
      // The edit budget is spent and hard defects survive it. Editing the same
      // damaged render again will not recover it; ask for the page afresh.
      nextBuffer = await regenerateFinalDetailPage(
        job,
        page,
        prompt,
        references,
        validation,
        context,
        signal,
      );
    } else {
      break;
    }
    rawBuffer = nextBuffer;
    normalizedRaw = saveImageBuffer(rawBuffer, imageTarget, `${page.resultNodeId}-raw`);
    page.rawResultUrl = normalizedRaw.resultUrl;
    validation = await validateFinalDetailPage(
      job,
      page,
      rawBuffer,
      selectedProducts,
      brandReferences,
      evidenceReferences,
      characterReferences,
      context,
      signal,
    );
  }
  const blockingFailures = validation.passed ? [] : (validation.blockingFailures || []);
  if (blockingFailures.length) {
    const details = [
      ...validation.missingTexts,
      ...validation.wrongTexts,
      ...validation.unexpectedTexts,
      ...validation.characterIssues,
      ...validation.layoutIssues,
    ].slice(0, 5).join('；');
    const error = new Error(`AI 成图质检未通过${details ? `：${details}` : validation.summary ? `：${validation.summary}` : ''}`);
    error.code = 'DETAIL_REMIX_QUALITY_FAILED';
    page.status = 'failed_validation';
    page.validationStatus = 'FAILED_VALIDATION';
    page.terminalStatus = 'FAILED_VALIDATION';
    page.error = error.message;
    page.errorCode = error.code;
    page.failedAt = nowIso(context);
    writeJob(job, context);
    throw error;
  }
  // Every hard fact checked out and the repair budget is spent; the page is
  // factually deliverable. Ship it flagged rather than discard a correct page
  // over a polish complaint the user can judge for themselves.
  if (!validation.passed) {
    page.validationWarnings = describeFinalDetailValidationFailures(validation.advisoryFailures);
    page.validationStatus = 'passed_with_warnings';
    page.deliveredWithWarnings = true;
  } else {
    page.validationWarnings = undefined;
    page.deliveredWithWarnings = undefined;
  }
  const final = saveImageBuffer(rawBuffer, imageTarget, page.resultNodeId);
  page.finalUrl = final.resultUrl;
  page.resultUrl = final.resultUrl;
  page.status = 'completed';
  page.terminalStatus = undefined;
  page.completedAt = nowIso(context);
  page.error = undefined;
  writeResultMetadata(imageTarget, page.resultNodeId, {
    filename: final.filename,
    prompt,
    model: job.imageModel,
    aspectRatio: page.aspectRatio || job.aspectRatio,
    generationAspectRatio: page.generationAspectRatio,
    resolution: job.imageResolution,
    width: page.outputWidth,
    height: page.outputHeight,
    sourceJobId: job.id,
    sourceNodeId: page.sourceNodeId,
    sourcePageIndex: page.index,
    detailRemixPhase: 'final',
    rawResultUrl: page.rawResultUrl,
    mappedSellingPoints: page.mappedSellingPoints,
    mappedFacts: page.effectiveMappedFacts,
    omittedMappedFacts: page.omittedMappedFacts,
    copyPlan: exactCopyPlan(page),
    validation: page.validation,
    repairAttempts: page.repairAttempts || 0,
    evidenceSourceImageIndexes: evidenceReferences.map(item => item.sourceImageIndex),
    selectedProductViewIds: page.selectedProductViewIds,
    selectedProductViews: page.selectedProductViews,
    brandIdentity: job.brandIdentity,
    brandLogoReferenceUrl: brandReferences[0],
    copySlots: page.analysis?.copySlots,
  });
  writeJob(job, context);
}

function finishFinalPhase(job, context) {
  const succeeded = job.pages.filter(page => page.status === 'completed' && (page.finalUrl || page.resultUrl)).length;
  const recovery = job.pages.filter(page => page.status === 'recovery_required').length
    + (job.ownRecognition?.status === 'recovery_required' ? 1 : 0);
  const failedValidation = job.pages.filter(page => page.status === 'failed_validation').length;
  const failed = job.pages.filter(page => ['failed', 'failed_validation'].includes(page.status)).length;
  job.resultNodeIds = job.pages
    .filter(page => page.status === 'completed' && (page.finalUrl || page.resultUrl))
    .map(page => page.resultNodeId);
  job.resultUrls = job.pages
    .filter(page => page.status === 'completed' && (page.finalUrl || page.resultUrl))
    .map(page => page.finalUrl || page.resultUrl);
  job.currentPageIndex = job.pages.length ? job.pages.length - 1 : undefined;
  job.completedAt = nowIso(context);
  if (recovery) {
    job.status = 'recovery_required';
    job.stage = 'recovery_required';
    job.stageLabel = `${recovery} 页提交状态待核对，已保留 ${succeeded} 页最终图`;
    job.error = '部分请求在提交边界中断；请先检查平台历史记录，系统不会自动重复提交';
  } else if (failed && succeeded) {
    job.status = 'partial_failed';
    job.stage = 'final_partial_failed';
    job.stageLabel = `已完成最终详情 ${succeeded} / ${job.pages.length} 页`;
    job.error = `${failed} 页失败${failedValidation ? `（其中 ${failedValidation} 页质检失败）` : ''}，已保留成功结果`;
  } else if (!succeeded) {
    job.status = 'failed';
    job.stage = failedValidation ? 'failed_validation' : 'failed';
    job.stageLabel = failedValidation ? '最终详情质检失败' : '最终详情生成失败';
    job.error = job.error || '没有成功生成任何最终详情页';
  } else {
    job.status = 'completed';
    job.stage = 'completed';
    job.stageLabel = `${succeeded} 页最终详情已完成`;
    job.error = undefined;
  }
  writeJob(job, context);
}

/**
 * Recognition concurrency is bounded by what actually runs out of process.
 * `codex-cli` spawns one child per call so a couple can overlap, but they share
 * the same account as the image worker — a wide fan-out would rate-limit the
 * very generations this is meant to unblock. `gemini-web` drives the shared
 * Chrome and must never overlap with anything.
 */
function resolveRecognitionConcurrency(job, context) {
  const configured = Number(context?.recognitionConcurrency);
  if (Number.isInteger(configured) && configured > 0) {
    return Math.min(MAX_RECOGNITION_CONCURRENCY, configured);
  }
  return job.recognitionProvider === 'codex-cli' ? DEFAULT_RECOGNITION_CONCURRENCY : 1;
}

/**
 * Analyze every remaining competitor page before the generation loop starts.
 * Recognition crosses no paid boundary, so it is safe to overlap, and getting it
 * off the critical path means the image worker is never idle waiting on a
 * page's analysis. Failures are left untouched for the serial pass to report.
 */
async function prefetchCompetitorAnalyses(job, context, signal) {
  const pending = job.pages.filter(page => (
    !['completed', 'failed', 'failed_validation', 'recovery_required', 'cancelled'].includes(page.status)
    && page.recognitionStatus !== 'completed'
  ));
  const concurrency = Math.min(resolveRecognitionConcurrency(job, context), pending.length);
  if (pending.length < 2 || concurrency < 2) return;
  let cursor = 0;
  let analyzed = 0;
  job.stage = 'analyzing_competitor';
  job.stageLabel = `正在并发分析竞品详情 0 / ${pending.length}`;
  writeJob(job, context);
  const worker = async () => {
    for (let page = pending[cursor]; page; page = pending[cursor]) {
      cursor += 1;
      assertActive(job, context, signal);
      try {
        await analyzeCompetitorPage(job, page, context, signal);
      } catch (error) {
        if (isOperationCancelled(error) || signal.aborted) throw error;
        // Leave the page exactly as it is: the serial pass re-runs analysis and
        // records the failure through the one path that knows how to report it.
      }
      analyzed += 1;
      job.stageLabel = `正在并发分析竞品详情 ${analyzed} / ${pending.length}`;
      writeJob(job, context);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

async function executeFinalPhase(job, context) {
  if (activeJobs.has(job.id)) return;
  const controller = new AbortController();
  activeJobs.set(job.id, controller);
  referenceDataUrlCaches.set(job.id, new Map());
  const { signal } = controller;
  try {
    job.phase = 'final';
    job.status = 'processing';
    job.startedAt ||= nowIso(context);
    writeJob(job, context);
    await extractOwnSellingPoints(job, context, signal);
    if (job.status === 'recovery_required') return;
    await prefetchCompetitorAnalyses(job, context, signal);

    for (const page of job.pages) {
      assertActive(job, context, signal);
      if (['completed', 'failed', 'failed_validation', 'recovery_required', 'cancelled'].includes(page.status)) continue;
      job.currentPageIndex = page.index;
      writeJob(job, context);
      try {
        await analyzeCompetitorPage(job, page, context, signal);
        if (page.status === 'recovery_required') continue;
        await generateFinalPage(job, page, context, signal);
      } catch (error) {
        if (isOperationCancelled(error) || signal.aborted) throw error;
        page.status = error?.submitted === true
          ? 'recovery_required'
          : error?.code === 'DETAIL_REMIX_QUALITY_FAILED' ? 'failed_validation' : 'failed';
        page.error = error instanceof Error ? error.message : String(error);
        page.errorCode = error?.code;
        page.failedAt = nowIso(context);
        job.currentSubmission = undefined;
        writeJob(job, context);
      }
    }
    assertActive(job, context, signal);
    finishFinalPhase(job, context);
  } catch (error) {
    const latest = readJob(job.id, job.workflowId, context.dirs);
    if (isOperationCancelled(error) || latest?.status === 'cancelled') return;
    job.currentSubmission = undefined;
    job.status = error?.submitted === true ? 'recovery_required' : 'failed';
    job.stage = job.status;
    job.stageLabel = job.status === 'recovery_required' ? '提交状态待核对' : '商品详情复刻失败';
    job.error = error instanceof Error ? error.message : String(error);
    job.failedAt = nowIso(context);
    writeJob(job, context);
  } finally {
    activeJobs.delete(job.id);
    referenceDataUrlCaches.delete(job.id);
  }
}

function finishPlatePhase(job, context) {
  const succeeded = job.pages.filter(page => page.status === 'completed').length;
  const recovery = job.pages.filter(page => page.status === 'recovery_required').length
    + (job.ownRecognition?.status === 'recovery_required' ? 1 : 0);
  const failed = job.pages.filter(page => page.status === 'failed').length;
  job.plateResultNodeIds = job.pages.filter(page => page.status === 'completed').map(page => page.plateNodeId);
  job.resultNodeIds = [...job.plateResultNodeIds];
  job.resultUrls = job.pages.filter(page => page.status === 'completed').map(page => page.plateUrl);
  job.canCompose = succeeded > 0;
  job.currentPageIndex = job.pages.length ? job.pages.length - 1 : undefined;
  job.completedAt = nowIso(context);
  if (recovery) {
    job.status = 'recovery_required';
    job.stage = 'recovery_required';
    job.stageLabel = `${recovery} 页提交状态待核对，已保留 ${succeeded} 页结果`;
    job.error = '部分请求在提交边界中断；请先检查平台历史记录，系统不会自动重复提交';
  } else if (failed && succeeded) {
    job.status = 'partial_failed';
    job.stage = 'plates_partial_failed';
    job.stageLabel = `已完成空白详情 ${succeeded} / ${job.pages.length} 页`;
    job.error = `${failed} 页失败，已保留成功结果`;
  } else if (!succeeded) {
    job.status = 'failed';
    job.stage = 'failed';
    job.stageLabel = '空白详情生成失败';
    job.error = job.error || '没有成功生成任何空白详情页';
  } else {
    job.status = 'completed';
    job.stage = 'plates_completed';
    job.stageLabel = `${succeeded} 页空白详情已完成，可继续合成产品`;
    job.error = undefined;
  }
  writeJob(job, context);
}

async function executePlatePhase(job, context) {
  if (activeJobs.has(job.id)) return;
  const controller = new AbortController();
  activeJobs.set(job.id, controller);
  const { signal } = controller;
  try {
    job.phase = 'plates';
    job.status = 'processing';
    job.startedAt ||= nowIso(context);
    writeJob(job, context);
    await extractOwnSellingPoints(job, context, signal);
    if (job.status === 'recovery_required') return;

    for (const page of job.pages) {
      assertActive(job, context, signal);
      if (page.status === 'completed' || page.status === 'failed' || page.status === 'recovery_required') continue;
      job.currentPageIndex = page.index;
      writeJob(job, context);
      try {
        await analyzeCompetitorPage(job, page, context, signal);
        if (page.status === 'recovery_required') continue;
        await generateBlankPlate(job, page, context, signal);
      } catch (error) {
        if (isOperationCancelled(error) || signal.aborted) throw error;
        page.status = error?.submitted === true ? 'recovery_required' : 'failed';
        page.error = error instanceof Error ? error.message : String(error);
        page.errorCode = error?.code;
        page.failedAt = nowIso(context);
        job.currentSubmission = undefined;
        writeJob(job, context);
      }
    }
    assertActive(job, context, signal);
    finishPlatePhase(job, context);
  } catch (error) {
    const latest = readJob(job.id, job.workflowId, context.dirs);
    if (isOperationCancelled(error) || latest?.status === 'cancelled') return;
    job.currentSubmission = undefined;
    job.status = error?.submitted === true ? 'recovery_required' : 'failed';
    job.stage = job.status;
    job.stageLabel = job.status === 'recovery_required' ? '提交状态待核对' : '商品详情复刻失败';
    job.error = error instanceof Error ? error.message : String(error);
    job.failedAt = nowIso(context);
    writeJob(job, context);
  } finally {
    activeJobs.delete(job.id);
  }
}

async function composePage(job, page, context, signal) {
  if (page.composeStatus === 'completed' && page.compositeUrl) return;
  if (page.composeStatus === 'submitting'
      && !canResumeCodexSubmission(job, page, 'product-compose', context)) {
    page.composeStatus = 'recovery_required';
    page.composeError = '产品合成在提交边界中断；系统不会自动重复提交';
    writeJob(job, context);
    return;
  }
  await ensurePageSourceDimensions(job, page, context);
  page.composeStatus = 'preparing';
  job.stage = 'composing_products';
  job.stageLabel = `正在合成产品 ${page.index + 1} / ${job.pages.length}`;
  writeJob(job, context);
  // SECURITY: stage two gets exactly the unlettered raw plate plus own product
  // images. It never receives competitor, own-detail, or character references.
  const references = [page.rawPlateUrl, ...job.productImages];
  const prompt = `${buildProductComposePrompt({
    pageAnalysis: page.analysis,
    mappedSellingPoints: page.mappedSellingPoints,
    rawPlateRole: 'reference image 1',
    productImageCount: job.productImages.length,
    forbidText: true,
    preservePlateComposition: true,
  })}\n\n硬性输出约束：参考图1仅作为无字底图；其余参考图仅是我方产品。只把我方产品自然合成到预留空位，不添加、改写或生成任何文字、品牌标识、水印，也不得改变人物身份和底图构图。`;
  page.composePrompt = prompt;
  const { imageTarget } = getStorage(job.workflowId, context.dirs);
  let rawBuffer = page.compositeRawUrl ? imageInputToBuffer(page.compositeRawUrl, context) : null;
  if (page.compositeRawUrl && !rawBuffer) {
    throw new Error('已生成的产品合成原图无法读取；为避免重复扣费，系统不会自动重新提交');
  }
  if (!rawBuffer) {
    page.composeStatus = 'submitting';
    page.composeSubmittingAt = nowIso(context);
    markBoundary(job, context, { kind: 'product-compose', pageIndex: page.index, submittingAt: page.composeSubmittingAt });
    const request = makeGenerationRequest(job, prompt, references, `${page.compositeNodeId}-raw`, context, signal, page);
    const generated = await runImageGeneration(request, job, context, {
      phase: 'product-compose',
      pageIndex: page.index,
      referenceKinds: ['raw-plate', ...job.productImages.map(() => 'own-product')],
    }, signal);
    assertActive(job, context, signal);
    let raw;
    try {
      raw = await persistRawResult(generated, imageTarget, `${page.compositeNodeId}-raw`, {
        ...context,
        workflowIdForResolution: job.workflowId,
      });
    } catch (error) {
      throw submittedOperationError(error);
    }
    rawBuffer = raw.buffer;
    page.compositeRawUrl = raw.resultUrl;
    page.composeStatus = 'rendering_copy';
    page.composeGenerationCompletedAt = nowIso(context);
    clearBoundary(job, context);
  }
  rawBuffer = await matchPageDimensions(rawBuffer, page, context);
  const normalizedRaw = saveImageBuffer(rawBuffer, imageTarget, `${page.compositeNodeId}-raw`);
  page.compositeRawUrl = normalizedRaw.resultUrl;
  const brandOverlay = brandOverlayMetadata(job, page, context);
  const texts = overlayTexts(
    page.mappedSellingPoints,
    page.analysis?.copySlots,
    job.brandIdentity,
    page.analysis?.brandSlots,
    Boolean(brandOverlay.brandLogoBuffer),
  );
  const compositeBuffer = await deterministicTextOverlay(rawBuffer, texts, context, {
    jobId: job.id,
    pageIndex: page.index,
    phase: 'composite',
    ...brandOverlay,
  });
  if (!Buffer.isBuffer(compositeBuffer)) throw new Error('合成详情文案叠加没有返回有效图片');
  const composite = saveImageBuffer(compositeBuffer, imageTarget, page.compositeNodeId);
  page.compositeUrl = composite.resultUrl;
  page.composeStatus = 'completed';
  page.composeCompletedAt = nowIso(context);
  page.composeError = undefined;
  writeResultMetadata(imageTarget, page.compositeNodeId, {
    filename: composite.filename,
    prompt,
    model: job.imageModel,
    aspectRatio: page.aspectRatio || job.aspectRatio,
    generationAspectRatio: page.generationAspectRatio,
    resolution: job.imageResolution,
    width: page.outputWidth,
    height: page.outputHeight,
    sourceJobId: job.id,
    sourcePlateNodeId: page.plateNodeId,
    sourcePageIndex: page.index,
    detailRemixPhase: 'composite',
    rawCompositeUrl: page.compositeRawUrl,
    mappedSellingPoints: page.mappedSellingPoints,
  });
  writeJob(job, context);
}

function finishCompositionPhase(job, context) {
  const eligible = job.pages.filter(page => page.rawPlateUrl);
  const succeeded = eligible.filter(page => page.composeStatus === 'completed').length;
  const recovery = eligible.filter(page => page.composeStatus === 'recovery_required').length;
  const failed = eligible.filter(page => page.composeStatus === 'failed').length;
  job.compositeResultNodeIds = eligible.filter(page => page.composeStatus === 'completed').map(page => page.compositeNodeId);
  job.resultNodeIds = [...job.compositeResultNodeIds];
  job.resultUrls = eligible.filter(page => page.composeStatus === 'completed').map(page => page.compositeUrl);
  job.currentCompositionIndex = eligible.length ? eligible.at(-1).index : undefined;
  job.completedAt = nowIso(context);
  if (recovery) {
    job.status = 'recovery_required';
    job.stage = 'recovery_required';
    job.stageLabel = `${recovery} 页产品合成状态待核对，已保留 ${succeeded} 页结果`;
    job.error = '产品合成在提交边界中断；系统不会自动重复提交';
  } else if (failed && succeeded) {
    job.status = 'partial_failed';
    job.stage = 'composition_partial_failed';
    job.stageLabel = `已完成产品合成 ${succeeded} / ${eligible.length} 页`;
    job.error = `${failed} 页合成失败，已保留成功结果`;
  } else if (!succeeded) {
    job.status = 'failed';
    job.stage = 'composition_failed';
    job.stageLabel = '产品合成失败';
    job.error = job.error || '没有成功合成任何详情页';
  } else {
    job.status = 'completed';
    job.stage = 'composition_completed';
    job.stageLabel = `${succeeded} 页最终详情已完成`;
    job.error = undefined;
  }
  writeJob(job, context);
}

async function executeCompositionPhase(job, context) {
  if (activeJobs.has(job.id)) return;
  const controller = new AbortController();
  activeJobs.set(job.id, controller);
  const { signal } = controller;
  try {
    job.phase = 'composition';
    job.status = 'processing';
    job.compositionStartedAt ||= nowIso(context);
    writeJob(job, context);
    for (const page of job.pages) {
      assertActive(job, context, signal);
      if (!page.rawPlateUrl || ['completed', 'failed', 'recovery_required'].includes(page.composeStatus)) continue;
      job.currentCompositionIndex = page.index;
      writeJob(job, context);
      try {
        await composePage(job, page, context, signal);
      } catch (error) {
        if (isOperationCancelled(error) || signal.aborted) throw error;
        page.composeStatus = error?.submitted === true ? 'recovery_required' : 'failed';
        page.composeError = error instanceof Error ? error.message : String(error);
        page.composeErrorCode = error?.code;
        job.currentSubmission = undefined;
        writeJob(job, context);
      }
    }
    assertActive(job, context, signal);
    finishCompositionPhase(job, context);
  } catch (error) {
    const latest = readJob(job.id, job.workflowId, context.dirs);
    if (isOperationCancelled(error) || latest?.status === 'cancelled') return;
    job.currentSubmission = undefined;
    job.status = error?.submitted === true ? 'recovery_required' : 'failed';
    job.stage = job.status;
    job.stageLabel = job.status === 'recovery_required' ? '提交状态待核对' : '产品合成失败';
    job.error = error instanceof Error ? error.message : String(error);
    job.failedAt = nowIso(context);
    writeJob(job, context);
  } finally {
    activeJobs.delete(job.id);
  }
}

function recognitionBoundaryKind(value) {
  return ['own-recognition', 'competitor-recognition'].includes(String(value || ''));
}

function repairInterruptedRecognition(job) {
  let changed = false;
  let retryable = false;
  let exhausted = false;
  const interruptedStates = new Set(['submitting', 'processing', 'recovery_required']);

  for (const chunk of job.ownRecognition?.chunks || []) {
    if (!interruptedStates.has(String(chunk.status))) continue;
    changed = true;
    if ((Number(chunk.attempts) || 0) < MAX_DETAIL_REMIX_RECOGNITION_ATTEMPTS) {
      chunk.status = 'waiting';
      chunk.error = undefined;
      retryable = true;
    } else {
      chunk.status = 'failed';
      chunk.error ||= chunk.lastError || '我方详情识别连续失败，请检查 Codex 登录或更换识图模型';
      exhausted = true;
    }
  }
  if (job.ownRecognition && job.ownRecognition.status !== 'completed') {
    if (retryable) job.ownRecognition.status = 'waiting';
    else if (exhausted) job.ownRecognition.status = 'failed';
  }

  for (const page of job.pages || []) {
    if (!interruptedStates.has(String(page.recognitionStatus))) continue;
    changed = true;
    if ((Number(page.recognitionAttempts) || 0) < MAX_DETAIL_REMIX_RECOGNITION_ATTEMPTS) {
      page.recognitionStatus = 'waiting';
      if (['analyzing', 'recovery_required'].includes(page.status)) page.status = 'waiting';
      page.error = undefined;
      retryable = true;
    } else {
      page.recognitionStatus = 'failed';
      page.status = 'failed';
      page.error ||= page.recognitionLastError || '竞品详情识别连续失败，请检查 Codex 登录或更换识图模型';
      exhausted = true;
    }
  }

  if (recognitionBoundaryKind(job.currentSubmission?.kind)) {
    job.currentSubmission = undefined;
    changed = true;
  }
  return { changed, retryable, exhausted };
}

function codexSubmissionFor(job, page, phase, context) {
  if (job.imageModel !== 'codex-imagegen' || !context.codexJobsDir) return null;
  const field = codexJobFieldForPhase(phase);
  const childId = String(page?.[field] || (
    Number(job.currentSubmission?.pageIndex) === Number(page?.index)
      ? job.currentSubmission?.codexJobId
      : ''
  ) || '');
  if (!childId) return null;
  const child = getCodexImageJob(context.codexJobsDir, childId);
  return child ? { child, field } : null;
}

function canResumeCodexSubmission(job, page, phase, context) {
  const current = codexSubmissionFor(job, page, phase, context);
  return Boolean(current && ['pending', 'processing', 'completed'].includes(current.child.status));
}

function markInterruptedSubmission(job, context) {
  const recognition = repairInterruptedRecognition(job);
  let changed = recognition.changed;
  let unsafeSubmission = false;

  for (const page of job.pages || []) {
    if (page.status === 'submitting') {
      const phase = Number(job.currentSubmission?.pageIndex) === Number(page.index)
        && job.currentSubmission?.kind
        ? String(job.currentSubmission.kind)
        : (Number(job.schemaVersion) >= 3 || job.phase === 'final'
            ? 'final-detail'
            : 'blank-plate');
      const codex = codexSubmissionFor(job, page, phase, context);
      if (codex && ['pending', 'processing', 'completed'].includes(codex.child.status)) {
        changed = true;
      } else if (codex && ['failed', 'cancelled'].includes(codex.child.status)) {
        page.status = 'failed';
        page.error = codex.child.error || 'Codex 生图任务未完成';
        changed = true;
      } else {
        page.status = 'recovery_required';
        page.error = phase === 'final-repair'
          ? '最终详情 AI 修复提交状态待核对'
          : Number(job.schemaVersion) >= 3
            ? '最终详情图提交状态待核对'
            : '空白详情底图提交状态待核对';
        unsafeSubmission = true;
        changed = true;
      }
    }
    if (page.composeStatus === 'submitting') {
      const codex = codexSubmissionFor(job, page, 'product-compose', context);
      if (codex && ['pending', 'processing', 'completed'].includes(codex.child.status)) {
        changed = true;
      } else if (codex && ['failed', 'cancelled'].includes(codex.child.status)) {
        page.composeStatus = 'failed';
        page.composeError = codex.child.error || 'Codex 产品合成任务未完成';
        changed = true;
      } else {
        page.composeStatus = 'recovery_required';
        page.composeError = '产品合成提交状态待核对';
        unsafeSubmission = true;
        changed = true;
      }
    }
  }

  if (job.currentSubmission && !recognitionBoundaryKind(job.currentSubmission.kind)) {
    const page = (job.pages || []).find(candidate => (
      Number(candidate.index) === Number(job.currentSubmission?.pageIndex)
    ));
    const phase = String(job.currentSubmission.kind || 'final-detail');
    const rawAlreadyLocal = phase === 'blank-plate'
      ? Boolean(page?.rawPlateUrl)
      : phase === 'product-compose'
        ? Boolean(page?.compositeRawUrl)
        : phase === 'final-repair'
          ? Boolean(page?.repairCompletedAt && page?.rawResultUrl)
          : Boolean(page?.rawResultUrl);
    if (rawAlreadyLocal) {
      job.currentSubmission = undefined;
      changed = true;
    } else {
      const codex = codexSubmissionFor(job, page, phase, context);
      if (codex && ['pending', 'processing', 'completed'].includes(codex.child.status)) {
        changed = true;
      } else if (!unsafeSubmission) {
        unsafeSubmission = true;
      }
    }
  }

  const hasUnsafePage = (job.pages || []).some(page => (
    page.status === 'recovery_required' || page.composeStatus === 'recovery_required'
  ));
  if (unsafeSubmission || hasUnsafePage) {
    job.status = 'recovery_required';
    job.stage = 'recovery_required';
    job.stageLabel = '提交边界中断，请先检查平台历史记录';
    job.error = '无法确认平台是否已接单；系统不会自动重复提交';
    if (!job.currentSubmission?.codexJobId) job.currentSubmission = undefined;
    writeJob(job, context);
    return true;
  }

  if (recognition.exhausted) {
    const recognitionError = (job.ownRecognition?.chunks || []).find(chunk => chunk.error)?.error
      || (job.pages || []).find(page => page.recognitionStatus === 'failed')?.error;
    job.status = 'failed';
    job.stage = 'failed';
    job.stageLabel = '识图连续失败';
    job.error = recognitionError
      ? `识图已连续失败两次：${recognitionError}`
      : '识图已连续失败两次，请检查 Codex 登录状态或切换识图模型后重试';
    writeJob(job, context);
  } else if (recognition.retryable || changed) {
    job.status = 'pending';
    job.stage = 'queued';
    job.stageLabel = recognition.retryable ? '识图中断，正在安全续跑' : '正在恢复同一生成任务';
    job.error = undefined;
    job.failedAt = undefined;
    writeJob(job, context);
  }
  return false;
}

function maybeResume(job, context) {
  if (!job || activeJobs.has(job.id)) return job;
  if (Number(job.schemaVersion) < DETAIL_REMIX_JOB_SCHEMA_VERSION
      && ['pending', 'processing'].includes(job.status)) {
    const predatesSinglePassPipeline = Number(job.schemaVersion) < 3;
    job.status = 'recovery_required';
    job.stage = 'recovery_required';
    job.stageLabel = '旧版生成方式已停用，请重新生成最终详情';
    job.error = predatesSinglePassPipeline
      ? '该任务创建于本地叠字/二次合成版本。为避免恢复出无字图或重复扣费，系统不会继续旧任务；请点击“重新生成最终详情”创建一次生成的新版本。'
      : '该任务创建于旧版参数证据契约。为避免恢复时混入无证据参数、发生参数错栏或重复扣费，系统不会继续旧任务；请点击“重新生成最终详情”创建严格证据链的新版本。';
    writeJob(job, context);
    return job;
  }
  if (markInterruptedSubmission(job, context)) return job;
  if (!['pending', 'processing'].includes(job.status)) return job;
  if (context.autoStart === false) return job;
  if (Number(job.schemaVersion) >= 3 || job.phase === 'final') void executeFinalPhase(job, context);
  else if (job.phase === 'composition') void executeCompositionPhase(job, context);
  else void executePlatePhase(job, context);
  return job;
}

export function createDetailRemixJob(payload, context) {
  if (!payload?.workflowId || !payload?.nodeId) throw new Error('缺少项目或商品详情复刻节点');
  const normalized = normalizePayload(payload);
  if (!normalized.ownDetails.length) throw new Error('请至少连接一张我方详情图');
  if (!normalized.competitorDetails.length) throw new Error('请至少连接一张竞品详情图');
  if (normalized.useCharacterReference && !normalized.characterReferenceImages.length) {
    throw new Error('已开启人物参考，但没有连接人物参考图');
  }
  const imageModel = String(payload.imageModel || DEFAULT_DETAIL_REMIX_IMAGE_MODEL);
  const imageProvider = getImageGenerationProvider(imageModel);
  if (!imageProvider?.supportsImageToImage) throw new Error('请选择支持参考图的图片模型');
  // Even without a standalone product upload, reserve one provider slot for
  // the angle-matched crop extracted automatically from the user's details.
  // Reserve one competitor base, at least one product angle, and one possible
  // brand-logo reference. The logo is detected later from the user's details.
  const reservedReferences = 2 + Math.max(1, normalized.productImages.length);
  if (reservedReferences > imageProvider.maxReferenceImages) {
    throw new Error(`${imageProvider.name} 每页保留竞品版式图后，最多支持 ${imageProvider.maxReferenceImages - 1} 张产品补充图`);
  }
  const maximumCharacterReferences = Math.max(0, imageProvider.maxReferenceImages - reservedReferences);
  if (normalized.useCharacterReference
      && normalized.characterReferenceImages.length > maximumCharacterReferences) {
    throw new Error(`${imageProvider.name} 每页需同时发送竞品版式图和自动产品角度，人物参考图最多支持 ${maximumCharacterReferences} 张`);
  }
  const recognitionProvider = ['gemini-web', 'codex-cli'].includes(payload.recognitionProvider)
    ? payload.recognitionProvider
    : DEFAULT_DETAIL_REMIX_RECOGNITION_PROVIDER;
  const recognition = getPromptOptimizerProvider(recognitionProvider);
  if (!context.runRecognition && !recognition?.supportsImage) {
    throw new Error(`识图 Provider 不支持图片：${recognitionProvider}`);
  }
  const recognitionModel = recognitionProvider === 'gemini-web'
    ? 'Gemini Web'
    : String(context.recognitionModel || payload.recognitionModel || recognition?.defaultModel || 'gpt-5.6-luna');
  const sizingMode = 'match-competitor';
  const aspectRatio = normalizeImageAspectRatio(imageModel, String(payload.aspectRatio || '3:4'))
    || imageProvider.supportedAspectRatios?.find(value => !['auto', '自动'].includes(String(value).toLowerCase()))
    || '3:4';
  const imageResolution = normalizeImageResolution(imageModel, payload.imageResolution ?? payload.resolution);
  const productSheet = normalizeDetailRemixProductSheet(payload.productSheet);
  const preferSuppliedProductReferences = payload.preferSuppliedProductReferences === true;
  if (productSheet && !normalized.productImages.length) {
    throw new Error('已填写产品角度板分格说明，但没有连接对应的产品参考图；请先连接那张角度板');
  }
  const immutableFingerprint = requestFingerprint(normalized, {
    recognitionProvider,
    recognitionModel,
    imageModel,
    sizingMode,
    aspectRatio,
    imageResolution,
    // The sheet layout and the priority switch both change what the model sees,
    // so a change to either must produce a new job rather than resume the old one.
    preferSuppliedProductReferences,
    productSheet: productSheet ? JSON.stringify(productSheet) : '',
  });
  const requestedId = String(payload.jobId || '').trim();
  if (requestedId) {
    const existing = readJob(requestedId, payload.workflowId, context.dirs);
    if (existing) {
      // Pre-v4 jobs have older product-input contracts. Return the exact
      // existing job (never create or resubmit it); a new button click gets a
      // fresh request ID and therefore a new auto-angle version.
      if (Number(existing.schemaVersion) < DETAIL_REMIX_JOB_SCHEMA_VERSION) return maybeResume(existing, context);
      const existingFingerprint = existing.requestFingerprint || requestFingerprint({
        ownDetails: existing.ownDetails || [],
        competitorDetails: existing.competitorDetails || [],
        productImages: existing.productImages || [],
        productNodeIds: existing.productNodeIds || [],
        characterReferenceImages: existing.useCharacterReference ? (existing.characterReferenceImages || []) : [],
        characterReferenceNodeIds: existing.useCharacterReference ? (existing.characterReferenceNodeIds || []) : [],
        useCharacterReference: existing.useCharacterReference === true,
      }, {
        recognitionProvider: existing.recognitionProvider,
        recognitionModel: existing.recognitionModel,
        imageModel: existing.imageModel,
        sizingMode: existing.sizingMode || 'match-competitor',
        aspectRatio: existing.aspectRatio,
        imageResolution: existing.imageResolution,
        preferSuppliedProductReferences: existing.preferSuppliedProductReferences === true,
        productSheet: existing.productSheet ? JSON.stringify(existing.productSheet) : '',
      });
      if (existingFingerprint !== immutableFingerprint) {
        const conflict = new Error('该重试请求 ID 已绑定另一组详情输入；请重新点击执行创建新版本');
        conflict.status = 409;
        conflict.code = 'IDEMPOTENCY_CONFLICT';
        throw conflict;
      }
      return maybeResume(existing, context);
    }
  }
  const createdAt = nowIso(context);
  const version = readAllJobs(payload.workflowId, context.dirs)
    .filter(job => job.nodeId === String(payload.nodeId))
    .reduce((maximum, job) => Math.max(maximum, Number(job.version) || 0), 0) + 1;
  const pages = normalized.competitorDetails.map((source, index) => ({
    index,
    queuePosition: index,
    sourceNodeId: source.sourceNodeId,
    sourceImage: source.imageUrl,
    sourceOrder: source.order,
    sourceWidth: source.sourceWidth,
    sourceHeight: source.sourceHeight,
    outputWidth: source.sourceWidth,
    outputHeight: source.sourceHeight,
    ...(source.sourceWidth > 0 && source.sourceHeight > 0 ? {
      aspectRatio: `${source.sourceWidth}:${source.sourceHeight}`,
      resultAspectRatio: `${source.sourceWidth}/${source.sourceHeight}`,
      generationAspectRatio: closestProviderAspectRatio(
        imageModel,
        source.sourceWidth,
        source.sourceHeight,
        aspectRatio,
      ),
    } : {}),
    resultNodeId: newId(context),
    status: 'waiting',
    recognitionStatus: 'waiting',
  }));
  const job = {
    schemaVersion: DETAIL_REMIX_JOB_SCHEMA_VERSION,
    pipelineVersion: DETAIL_REMIX_PIPELINE_VERSION,
    id: requestedId || newId(context),
    workflowId: String(payload.workflowId),
    nodeId: String(payload.nodeId),
    version,
    status: 'pending',
    phase: 'final',
    stage: 'queued',
    stageLabel: '商品详情复刻任务已创建',
    ownDetails: normalized.ownDetails,
    competitorDetails: normalized.competitorDetails,
    productViews: [],
    verifiedFacts: [],
    productImages: normalized.productImages,
    productNodeIds: normalized.productNodeIds,
    productSheet,
    preferSuppliedProductReferences,
    characterReferenceImages: normalized.characterReferenceImages,
    characterReferenceNodeIds: normalized.characterReferenceNodeIds,
    useCharacterReference: normalized.useCharacterReference,
    requestFingerprint: immutableFingerprint,
    recognitionProvider,
    recognitionModel,
    imageModel,
    sizingMode,
    aspectRatio,
    imageResolution,
    maxStructuralRegenerations: normalizeStructuralRegenerationBudget(payload.maxStructuralRegenerations),
    pages,
    pageCount: pages.length,
    plannedResultNodeIds: pages.map(page => page.resultNodeId),
    dismissedResultNodeIds: [],
    createdAt,
    updatedAt: createdAt,
  };
  writeJob(job, context);
  if (context.autoStart !== false) void executeFinalPhase(job, context);
  return job;
}

export function composeDetailRemixProducts(jobId, workflowId, payload, context) {
  const job = readJob(jobId, workflowId, context.dirs);
  if (!job) return null;
  if (Number(job.schemaVersion) >= 3 || job.phase === 'final') {
    const error = new Error('当前详情复刻已在“执行”时直接生成最终图，无需再次产品合成');
    error.status = 409;
    error.code = 'SINGLE_STAGE_JOB';
    throw error;
  }
  if (activeJobs.has(job.id)) throw new Error('当前阶段仍在执行，请完成后再合成产品');
  if (markInterruptedSubmission(job, context)) return job;
  const supplied = normalizeImageList(payload?.productImages, payload?.productImage);
  const suppliedNodeIds = normalizeNodeIds(payload?.productNodeIds);
  const productChanged = supplied.length > 0
    && (
      JSON.stringify(supplied) !== JSON.stringify(job.productImages || [])
      || (suppliedNodeIds.length > 0
        && JSON.stringify(suppliedNodeIds) !== JSON.stringify(job.productNodeIds || []))
    );
  if (supplied.length) job.productImages = supplied;
  if (suppliedNodeIds.length) job.productNodeIds = suppliedNodeIds;
  if (!job.productImages?.length) throw new Error('请至少连接一张我方产品图');
  const provider = getImageGenerationProvider(job.imageModel);
  if (job.productImages.length + 1 > provider.maxReferenceImages) {
    throw new Error(`${provider.name} 每页合成最多支持 ${provider.maxReferenceImages - 1} 张产品图`);
  }
  const eligible = job.pages.filter(page => page.rawPlateUrl);
  if (!eligible.length) throw new Error('尚无可用于产品合成的空白详情底图');
  if (productChanged) {
    for (const page of eligible) {
      page.composeStatus = 'waiting';
      page.composeError = undefined;
      page.composeErrorCode = undefined;
      page.compositeRawUrl = undefined;
      page.compositeUrl = undefined;
      page.composeCompletedAt = undefined;
    }
    job.compositionRevision = Math.max(0, Number(job.compositionRevision) || 0) + 1;
  }
  const alreadyComplete = eligible.every(page => page.composeStatus === 'completed' && page.compositeUrl);
  if (alreadyComplete) return job;
  for (const page of eligible) {
    if (!['completed', 'recovery_required'].includes(page.composeStatus)) {
      page.composeStatus = 'waiting';
      page.composeError = undefined;
    }
  }
  job.phase = 'composition';
  job.status = 'pending';
  job.schemaVersion = DETAIL_REMIX_JOB_SCHEMA_VERSION;
  job.pipelineVersion = DETAIL_REMIX_PIPELINE_VERSION;
  job.stage = 'composition_queued';
  job.stageLabel = '产品合成任务已创建';
  job.error = undefined;
  writeJob(job, context);
  if (context.autoStart !== false) void executeCompositionPhase(job, context);
  return job;
}

export function getLatestDetailRemixJob(nodeId, workflowId, context) {
  if (!nodeId || !workflowId) return null;
  const latest = readAllJobs(workflowId, context.dirs)
    .filter(job => job.nodeId === nodeId)
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0] || null;
  return maybeResume(latest, context);
}

export function getDetailRemixJob(jobId, workflowId, context) {
  return maybeResume(readJob(jobId, workflowId, context.dirs), context);
}

function exportSourcePath(resultUrl, imageTarget) {
  if (!resultUrl) return null;
  let pathname = String(resultUrl).split(/[?#]/)[0];
  try {
    pathname = new URL(String(resultUrl), 'http://evan.local').pathname;
  } catch {
    // Relative library URLs are handled by the basename fallback below.
  }
  let filename = '';
  try {
    filename = decodeURIComponent(path.basename(pathname));
  } catch {
    return null;
  }
  if (!filename || path.basename(filename) !== filename) return null;
  const candidate = path.resolve(imageTarget.targetDir, filename);
  const root = path.resolve(imageTarget.targetDir);
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) return null;
  return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
}

/** Trusted desktop-only source manifest. The renderer never supplies paths. */
/** The best surviving image for a page that never passed the gate. */
function fallbackCandidateUrl(page) {
  return page?.qualityFailedCandidateUrl || page?.rawResultUrl || '';
}

export function getDetailRemixExportManifest(jobId, workflowId, context, options = {}) {
  const job = readJob(jobId, workflowId, context.dirs);
  if (!job) return null;
  const includeCandidates = options.includeCandidates === true;
  const { imageTarget, projectRoot } = getStorage(workflowId, context.dirs);
  const dismissed = new Set(job.dismissedResultNodeIds || []);
  const pages = (job.pages || [])
    .filter(page => {
      if (dismissed.has(page.resultNodeId)) return false;
      if (page.status === 'completed' && (page.finalUrl || page.resultUrl)) return true;
      // Quality-failed pages hold a real, paid render. Exporting it is opt-in and
      // clearly labelled so a page the gate rejected is never mistaken for a
      // delivered one.
      return includeCandidates && isValidationFailedPage(page) && Boolean(fallbackCandidateUrl(page));
    })
    .sort((left, right) => (
      Number(left.queuePosition ?? left.index) - Number(right.queuePosition ?? right.index)
      || Number(left.index) - Number(right.index)
    ));
  const files = pages.map((page, order) => {
    const delivered = page.status === 'completed' && (page.finalUrl || page.resultUrl);
    const sourcePath = exportSourcePath(
      delivered ? (page.finalUrl || page.resultUrl) : fallbackCandidateUrl(page),
      imageTarget,
    );
    if (!sourcePath) {
      const error = new Error(`第 ${Number(page.index) + 1} 页最终图片文件不存在，无法完整导出`);
      error.status = 410;
      error.code = 'DETAIL_REMIX_EXPORT_SOURCE_MISSING';
      throw error;
    }
    return {
      order,
      pageIndex: Number(page.index),
      resultNodeId: String(page.resultNodeId || ''),
      sourcePath,
      ...(delivered ? {} : { candidate: true, candidateReason: String(page.error || 'AI 成图质检未通过') }),
      ...(page.deliveredWithWarnings ? { warnings: page.validationWarnings || [] } : {}),
    };
  });
  if (!files.length) {
    const empty = new Error('当前任务还没有可导出的最终详情图');
    empty.status = 409;
    empty.code = 'DETAIL_REMIX_EXPORT_EMPTY';
    throw empty;
  }
  return {
    jobId: job.id,
    workflowId: job.workflowId,
    projectName: path.basename(projectRoot),
    count: files.length,
    candidateCount: files.filter(file => file.candidate).length,
    files,
  };
}

function isValidationFailedPage(page) {
  return page?.status === 'failed_validation' || page?.terminalStatus === 'FAILED_VALIDATION';
}

/**
 * A page may be regenerated when it already produced a paid candidate: either a
 * delivered result, or a quality-failed candidate that the gate rejected. Both
 * are explicit user-initiated re-spends, never automatic.
 */
function isRegenerableDetailRemixPage(page) {
  if (!page) return false;
  if (page.status === 'completed' && (page.finalUrl || page.resultUrl)) return true;
  return isValidationFailedPage(page);
}

/** Every per-page Codex child-job pointer, including per-attempt regeneration slots. */
function pageGenerationSubmissionFields(page) {
  const dynamic = Object.keys(page || {})
    .filter(key => /^regenerateCodexImageJobId\d+$/u.test(key));
  return [
    'codexImageJobId',
    'repairCodexImageJobId',
    'plateCodexImageJobId',
    'composeCodexImageJobId',
    ...dynamic,
  ];
}

function clearPageGenerationSubmissions(page) {
  for (const field of pageGenerationSubmissionFields(page)) page[field] = undefined;
}

function pageHasGenerationSubmission(job, page) {
  if (!page) return false;
  if (
    pageGenerationSubmissionFields(page).some(field => page[field])
    || page.rawResultUrl
    || page.finalUrl
    || page.resultUrl
  ) return true;
  return Boolean(
    job.currentSubmission
    && Number(job.currentSubmission.pageIndex) === Number(page.index)
    && !recognitionBoundaryKind(job.currentSubmission.kind)
  );
}

/**
 * Retry only pages that failed before any image-generation submission. This
 * deliberately reuses the same job/result-node IDs and leaves every successful
 * page untouched. A failed provider submission is never reset here because it
 * could otherwise create a duplicate paid request.
 */
export function retryFailedDetailRemixPages(jobId, workflowId, payload, context) {
  const job = readJob(jobId, workflowId, context.dirs);
  if (!job) return null;
  if (activeJobs.has(job.id) || ['pending', 'processing'].includes(job.status)) {
    const conflict = new Error('当前任务仍在执行，不能同时重试失败页');
    conflict.status = 409;
    conflict.code = 'DETAIL_REMIX_JOB_ACTIVE';
    throw conflict;
  }
  if (Number(job.schemaVersion) < 3 || job.phase !== 'final') {
    const incompatible = new Error('旧版两阶段任务不支持失败页安全重试，请创建新的单次生成任务');
    incompatible.status = 409;
    incompatible.code = 'DETAIL_REMIX_RETRY_UNSUPPORTED';
    throw incompatible;
  }
  const requested = Array.isArray(payload?.pageIndexes)
    ? new Set(payload.pageIndexes.map(Number).filter(Number.isInteger))
    : null;
  const retryPages = (job.pages || []).filter(page => (
    page.status === 'failed'
    && !pageHasGenerationSubmission(job, page)
    && (!requested || requested.has(Number(page.index)))
  ));
  if (!retryPages.length) {
    const noSafePages = new Error('没有可安全重试的失败页；已提交过生图的页面不会自动重复提交');
    noSafePages.status = 409;
    noSafePages.code = 'DETAIL_REMIX_NO_SAFE_FAILED_PAGES';
    throw noSafePages;
  }

  const requestedAt = nowIso(context);
  for (const page of retryPages) {
    page.status = 'waiting';
    page.error = undefined;
    page.errorCode = undefined;
    page.failedAt = undefined;
    page.retryCount = Math.max(0, Number(page.retryCount) || 0) + 1;
    page.retryRequestedAt = requestedAt;
    // Every page here is proven to have never crossed the paid-generation
    // boundary. Re-run recognition under the current page-order and copy-plan
    // rules even when an older pipeline had marked recognition completed.
    page.recognitionStatus = 'waiting';
    page.recognitionAttempts = 0;
    page.recognitionFormatRetries = 0;
    page.recognitionContractRetries = 0;
    page.recognitionAutoRepairs = undefined;
    page.recognitionAutoRepairCount = 0;
    page.recognitionStartedAt = undefined;
    page.recognitionCompletedAt = undefined;
    page.recognitionLastError = undefined;
    page.recognitionLastFailedAt = undefined;
    page.competitorAnalysisVersion = undefined;
    page.analysis = undefined;
    page.mappedSellingPoints = undefined;
    page.mappedFacts = undefined;
    page.effectiveMappedFacts = undefined;
    page.omittedMappedFacts = undefined;
    page.factMappingAudit = undefined;
    page.selectedProductViewIds = undefined;
    page.selectedProductViews = undefined;
    page.finalPrompt = undefined;
    page.generationReferenceCount = undefined;
  }
  job.status = 'pending';
  job.phase = 'final';
  job.pipelineVersion = DETAIL_REMIX_PIPELINE_VERSION;
  job.stage = 'queued';
  job.stageLabel = `准备仅重试失败页（${retryPages.length} 页）`;
  job.error = undefined;
  job.failedAt = undefined;
  job.completedAt = undefined;
  job.cancelRequested = false;
  job.retryMode = 'failed-only';
  job.retryPageIndexes = retryPages.map(page => Number(page.index));
  job.retryRequestedAt = requestedAt;
  job.currentSubmission = undefined;
  writeJob(job, context);
  if (context.autoStart !== false) void executeFinalPhase(job, context);
  return job;
}

/**
 * Explicitly regenerate pages that already produced a paid candidate — delivered
 * results and quality-failed candidates alike. Quality-failed pages are terminal
 * for the automatic pipeline but must stay reachable by hand, otherwise the only
 * way to recover them is re-running the whole job. Old results are retained in
 * previousResults, while a fresh result-node ID per page prevents file overwrite
 * and keeps each new candidate independently recoverable.
 */
export function regenerateDetailRemixPages(jobId, workflowId, payload, context) {
  const job = readJob(jobId, workflowId, context.dirs);
  if (!job) return null;
  if (activeJobs.has(job.id) || ['pending', 'processing'].includes(job.status)) {
    const conflict = new Error('当前任务仍在执行，不能同时重新生成页面');
    conflict.status = 409;
    conflict.code = 'DETAIL_REMIX_JOB_ACTIVE';
    throw conflict;
  }
  if (Number(job.schemaVersion) < 3 || job.phase !== 'final') {
    const incompatible = new Error('旧版两阶段任务不支持单页重新生成，请创建新的单次生成任务');
    incompatible.status = 409;
    incompatible.code = 'DETAIL_REMIX_REGENERATE_UNSUPPORTED';
    throw incompatible;
  }
  const requestedIndexes = [
    ...(Array.isArray(payload?.pageIndexes) ? payload.pageIndexes : []),
    payload?.pageIndex,
  ].map(Number).filter(value => Number.isInteger(value) && value >= 0);
  const pageIndexes = [...new Set(requestedIndexes)].sort((left, right) => left - right);
  if (!pageIndexes.length) {
    const invalid = new Error('缺少有效的详情页序号');
    invalid.status = 400;
    invalid.code = 'DETAIL_REMIX_PAGE_INDEX_INVALID';
    throw invalid;
  }
  const pages = [];
  for (const pageIndex of pageIndexes) {
    const page = (job.pages || []).find(item => Number(item.index) === pageIndex);
    if (!page || !isRegenerableDetailRemixPage(page)) {
      const unavailable = new Error(`第 ${pageIndex + 1} 页不是可重新生成的成功结果或质检失败结果`);
      unavailable.status = 409;
      unavailable.code = 'DETAIL_REMIX_COMPLETED_PAGE_REQUIRED';
      throw unavailable;
    }
    pages.push(page);
  }

  const requestedAt = nowIso(context);
  const regeneratedValidationFailures = pages.filter(page => isValidationFailedPage(page)).length;
  for (const page of pages) {
    const previousResult = {
      resultNodeId: page.resultNodeId,
      rawResultUrl: page.rawResultUrl,
      // A quality-failed page has no finalUrl; its best candidate is kept so the
      // superseded attempt stays inspectable and exportable as a fallback.
      finalUrl: page.finalUrl,
      resultUrl: page.resultUrl,
      qualityFailedCandidateUrl: page.qualityFailedCandidateUrl,
      status: page.status,
      terminalStatus: page.terminalStatus,
      validation: page.validation,
      repairAttempts: Math.max(0, Number(page.repairAttempts) || 0),
      completedAt: page.completedAt,
      supersededAt: requestedAt,
    };
    page.previousResults = [
      ...(Array.isArray(page.previousResults) ? page.previousResults : []),
      previousResult,
    ].slice(-5);
    page.resultNodeId = newId(context);
    page.status = 'waiting';
    page.terminalStatus = undefined;
    page.error = undefined;
    page.errorCode = undefined;
    page.failedAt = undefined;
    page.completedAt = undefined;
    page.rawResultUrl = undefined;
    page.initialRawResultUrl = undefined;
    page.finalUrl = undefined;
    page.resultUrl = undefined;
    page.qualityFailedCandidateUrl = undefined;
    page.finalPrompt = undefined;
    page.prompt = undefined;
    page.generationReferenceCount = undefined;
    page.submittingAt = undefined;
    page.presubmittedAt = undefined;
    page.presubmittedPrompt = undefined;
    page.generationCompletedAt = undefined;
    clearPageGenerationSubmissions(page);
    page.repairAttempts = 0;
    page.repairPrompt = undefined;
    page.repairSubmittingAt = undefined;
    page.repairCompletedAt = undefined;
    page.structuralRegenerationAttempts = 0;
    page.structuralRegenerationPrompt = undefined;
    page.validation = undefined;
    page.validationStatus = undefined;
    page.validationAttempts = 0;
    page.validationCompletedAt = undefined;
    page.validationWarnings = undefined;
    page.deliveredWithWarnings = undefined;
    page.regenerationCount = Math.max(0, Number(page.regenerationCount) || 0) + 1;
    page.regenerationRequestedAt = requestedAt;
  }

  job.status = 'pending';
  job.phase = 'final';
  job.pipelineVersion = DETAIL_REMIX_PIPELINE_VERSION;
  job.stage = 'queued';
  job.stageLabel = pageIndexes.length === 1
    ? `准备重新生成第 ${pageIndexes[0] + 1} 页（仅此一页）`
    : `准备重新生成 ${pageIndexes.length} 页（第 ${pageIndexes.map(index => index + 1).join('、')} 页）`;
  job.error = undefined;
  job.failedAt = undefined;
  job.completedAt = undefined;
  job.cancelRequested = false;
  job.cancelSubmitted = false;
  job.retryMode = regeneratedValidationFailures === pageIndexes.length
    ? 'validation-failed-page-regeneration'
    : 'completed-page-regeneration';
  job.retryPageIndexes = [...pageIndexes];
  job.retryRequestedAt = requestedAt;
  job.currentPageIndex = pageIndexes[0];
  job.currentSubmission = undefined;
  job.resultNodeIds = (job.pages || [])
    .filter(item => item.status === 'completed' && (item.finalUrl || item.resultUrl))
    .map(item => item.resultNodeId);
  job.resultUrls = (job.pages || [])
    .filter(item => item.status === 'completed' && (item.finalUrl || item.resultUrl))
    .map(item => item.finalUrl || item.resultUrl);
  job.plannedResultNodeIds = (job.pages || []).map(item => item.resultNodeId);
  writeJob(job, context);
  if (context.autoStart !== false) void executeFinalPhase(job, context);
  return job;
}

export function cancelDetailRemixJob(jobId, workflowId, context) {
  const job = readJob(jobId, workflowId, context.dirs);
  if (!job) return null;
  if (!['pending', 'processing'].includes(job.status)) return job;
  const codexChildIds = [...new Set([
    job.currentSubmission?.codexJobId,
    // Every per-page pointer is reaped, not just the awaited one: pre-submitted
    // pages hold live paid jobs the global boundary no longer points at.
    ...(job.pages || []).flatMap(page => (
      pageGenerationSubmissionFields(page).map(field => page[field])
    )),
  ].map(value => String(value || '')).filter(Boolean))];
  let submittedChildMayContinue = false;
  const cancelledChildJobIds = [];
  if (context.codexJobsDir) {
    for (const childId of codexChildIds) {
      const before = getCodexImageJob(context.codexJobsDir, childId);
      if (before?.status === 'processing') submittedChildMayContinue = true;
      const cancelled = cancelCodexImageJob(
        context.codexJobsDir,
        childId,
        '所属商品详情复刻任务已由用户取消'
      );
      if (cancelled?.status === 'cancelled') cancelledChildJobIds.push(childId);
    }
  }
  job.cancelRequested = true;
  job.status = 'cancelled';
  job.stage = 'cancelled';
  job.stageLabel = '商品详情复刻任务已取消';
  job.cancelledChildJobIds = cancelledChildJobIds;
  job.cancelSubmitted = submittedChildMayContinue;
  job.error = submittedChildMayContinue
    ? '已停止画布等待；其中一张图在取消前已开始处理，远端可能仍会完成，但结果不会再写回画布。'
    : undefined;
  job.completedAt = nowIso(context);
  job.currentSubmission = undefined;
  if (job.ownRecognition && job.ownRecognition.status !== 'completed') {
    job.ownRecognition.status = 'cancelled';
    for (const chunk of job.ownRecognition.chunks || []) {
      if (chunk.status !== 'completed') chunk.status = 'cancelled';
    }
  }
  for (const page of job.pages || []) {
    if (!['completed', 'failed', 'recovery_required'].includes(page.status)) page.status = 'cancelled';
    if (page.recognitionStatus && page.recognitionStatus !== 'completed') page.recognitionStatus = 'cancelled';
    if (page.composeStatus && !['completed', 'failed', 'recovery_required'].includes(page.composeStatus)) {
      page.composeStatus = 'cancelled';
    }
  }
  writeJob(job, context);
  activeJobs.get(job.id)?.abort();
  return job;
}

export function dismissDetailRemixResultNodes(nodeIds, workflowId, context) {
  const wanted = [...new Set((nodeIds || []).map(String).filter(Boolean))];
  if (!workflowId || !wanted.length) return { dismissed: [] };
  const dismissed = [];
  for (const job of readAllJobs(workflowId, context.dirs)) {
    const owned = wanted.filter(nodeId => job.pages?.some(page => (
      page.resultNodeId === nodeId || page.plateNodeId === nodeId || page.compositeNodeId === nodeId
    )));
    if (!owned.length) continue;
    const before = new Set(job.dismissedResultNodeIds || []);
    owned.forEach(nodeId => before.add(nodeId));
    job.dismissedResultNodeIds = [...before];
    writeJob(job, context);
    dismissed.push(...owned);
  }
  return { dismissed: [...new Set(dismissed)] };
}

// Exported for focused state-machine tests. Production callers should use the
// CRUD functions above, which enforce restart and idempotency rules.
export const __detailRemixTest = Object.freeze({
  executeFinalPhase,
  executePlatePhase,
  executeCompositionPhase,
  readJob,
  writeJob,
  markInterruptedSubmission,
  normalizePayload,
  interruptedPhaseForPage,
  presubmitNextPageGeneration,
});
