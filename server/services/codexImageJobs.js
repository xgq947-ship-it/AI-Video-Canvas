import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const ASPECT_RATIO_PATTERN = /^(\d+):(\d+)$/;

function parseAspectRatio(value) {
    if (!value || value === 'Auto') return null;
    const match = String(value).match(ASPECT_RATIO_PATTERN);
    if (!match) throw new Error(`Invalid aspect ratio: ${value}`);
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!width || !height) throw new Error(`Invalid aspect ratio: ${value}`);
    return { label: `${width}:${height}`, width, height, value: width / height };
}

function buildOutputSpec(aspectRatio, resolution) {
    const ratio = parseAspectRatio(aspectRatio);
    if (!ratio) {
        return {
            aspectRatio: 'Auto',
            resolution: resolution || 'Auto',
            enforceExactAspectRatio: false,
            instruction: 'Use the composition and dimensions best suited to the prompt.'
        };
    }
    const orientation = ratio.width === ratio.height ? 'square' : ratio.width > ratio.height ? 'landscape' : 'portrait';
    return {
        aspectRatio: ratio.label,
        ratioWidth: ratio.width,
        ratioHeight: ratio.height,
        orientation,
        resolution: resolution || 'Auto',
        enforceExactAspectRatio: false,
        tolerance: 0.005,
        instruction: `Prefer a ${orientation} image near ${ratio.label} aspect ratio, but preserve the generated composition if the model returns different dimensions.`
    };
}

export async function inspectCodexImageOutput({ imagePath, aspectRatio }) {
    const ratio = parseAspectRatio(aspectRatio);
    const metadata = await sharp(imagePath).metadata();
    if (!metadata.width || !metadata.height) throw new Error('Generated image has no readable dimensions');
    const actualRatio = metadata.width / metadata.height;
    const exactMatch = !ratio || metadata.width * ratio.height === metadata.height * ratio.width;
    return {
        requestedAspectRatio: ratio?.label || 'Auto',
        width: metadata.width,
        height: metadata.height,
        actualRatio,
        matches: exactMatch,
        withinTolerance: !ratio || Math.abs(actualRatio - ratio.value) / ratio.value <= 0.005
    };
}

async function writeAspectRatioSafeImage({ sourceImage, destination, aspectRatio }) {
    const inspection = await inspectCodexImageOutput({ imagePath: sourceImage, aspectRatio });
    fs.copyFileSync(sourceImage, destination);
    return {
        inspection,
        outputWidth: inspection.width,
        outputHeight: inspection.height,
        adjusted: false,
        adjustmentMode: inspection.matches ? 'none' : 'accepted-source-ratio'
    };
}

function writeJsonAtomic(filePath, value) {
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2));
    fs.renameSync(temporaryPath, filePath);
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function safeSegment(value) {
    return String(value || 'node').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'node';
}

function jobPath(jobsDir, jobId) {
    return path.join(jobsDir, 'jobs', `${safeSegment(jobId)}.json`);
}

function assertInside(baseDir, candidatePath) {
    const base = path.resolve(baseDir);
    const candidate = path.resolve(candidatePath);
    if (candidate !== base && !candidate.startsWith(`${base}${path.sep}`)) {
        throw new Error('Reference image must be inside the project library');
    }
    return candidate;
}

function extensionForDataUrl(dataUrl) {
    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i);
    if (!match) return null;
    return match[1].toLowerCase() === 'jpeg' ? '.jpg' : `.${match[1].toLowerCase()}`;
}

function resolveLibraryReference(reference, libraryDir) {
    if (typeof reference !== 'string' || !reference.trim()) return null;

    if (reference.startsWith('data:')) {
        const extension = extensionForDataUrl(reference);
        if (!extension) return null;
        const base64 = reference.replace(/^data:image\/[^;]+;base64,/i, '');
        return { buffer: Buffer.from(base64, 'base64'), extension, source: 'embedded' };
    }

    let pathname = reference.split('?')[0];
    if (reference.startsWith('http://') || reference.startsWith('https://')) {
        const parsed = new URL(reference);
        pathname = parsed.pathname;
    }

    if (!pathname.startsWith('/library/')) return null;

    const relativePath = decodeURIComponent(pathname.slice('/library/'.length));
    const absolutePath = assertInside(libraryDir, path.join(libraryDir, relativePath));
    if (!fs.existsSync(absolutePath)) return null;

    const extension = path.extname(absolutePath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) return null;
    return { filePath: absolutePath, extension, source: reference };
}

function materializeReferences({ references, jobsDir, libraryDir, jobId }) {
    if (!Array.isArray(references) || references.length === 0) return [];

    const referenceDir = path.join(jobsDir, 'references', safeSegment(jobId));
    fs.mkdirSync(referenceDir, { recursive: true });

    return references.flatMap((reference, index) => {
        const resolved = resolveLibraryReference(reference, libraryDir);
        if (!resolved) return [];

        const filename = `reference-${String(index + 1).padStart(2, '0')}${resolved.extension}`;
        const destination = path.join(referenceDir, filename);
        if (resolved.buffer) {
            fs.writeFileSync(destination, resolved.buffer);
        } else {
            fs.copyFileSync(resolved.filePath, destination);
        }

        return [{
            index,
            source: resolved.source,
            filePath: destination
        }];
    });
}

export function ensureCodexImageJobDirs(jobsDir) {
    ['jobs', 'references'].forEach(name => {
        fs.mkdirSync(path.join(jobsDir, name), { recursive: true });
    });
}

export function listCodexImageJobs(jobsDir, status) {
    ensureCodexImageJobDirs(jobsDir);
    const dir = path.join(jobsDir, 'jobs');
    return fs.readdirSync(dir)
        .filter(filename => filename.endsWith('.json'))
        .map(filename => readJson(path.join(dir, filename)))
        .filter(job => !status || job.status === status)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function getCodexImageJob(jobsDir, jobId) {
    ensureCodexImageJobDirs(jobsDir);
    const filePath = jobPath(jobsDir, jobId);
    if (!fs.existsSync(filePath)) return null;
    return readJson(filePath);
}

export function createCodexImageJob({
    jobsDir,
    libraryDir,
    nodeId,
    prompt,
    aspectRatio = 'Auto',
    resolution = 'Auto',
    referenceImages = []
}) {
    if (!nodeId || typeof nodeId !== 'string') throw new Error('nodeId is required');
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) throw new Error('prompt is required');

    ensureCodexImageJobDirs(jobsDir);
    const previousAttempts = listCodexImageJobs(jobsDir)
        .filter(job => job.nodeId === nodeId)
        .map(job => Number(job.attempt) || 0);
    const attempt = Math.max(0, ...previousAttempts) + 1;
    const now = new Date().toISOString();
    const id = `codex_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const references = materializeReferences({
        references: referenceImages,
        jobsDir,
        libraryDir,
        jobId: id
    });

    const normalizedAspectRatio = parseAspectRatio(aspectRatio)?.label || 'Auto';
    const normalizedResolution = resolution || 'Auto';
    const job = {
        schemaVersion: 2,
        id,
        type: 'codex-image-generation',
        nodeId,
        attempt,
        status: 'pending',
        prompt: prompt.trim(),
        aspectRatio: normalizedAspectRatio,
        resolution: normalizedResolution,
        outputSpec: buildOutputSpec(normalizedAspectRatio, normalizedResolution),
        references,
        createdAt: now,
        updatedAt: now
    };
    writeJsonAtomic(jobPath(jobsDir, id), job);
    return job;
}

export function claimCodexImageJob(jobsDir, jobId) {
    const job = getCodexImageJob(jobsDir, jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    if (job.status !== 'pending') throw new Error(`Job is not pending: ${job.status}`);

    const now = new Date().toISOString();
    const updated = { ...job, status: 'processing', claimedAt: now, updatedAt: now };
    writeJsonAtomic(jobPath(jobsDir, jobId), updated);
    return updated;
}

export async function completeCodexImageJob({ jobsDir, imagesDir, jobId, sourceImage }) {
    const job = getCodexImageJob(jobsDir, jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    if (!['pending', 'processing'].includes(job.status)) {
        throw new Error(`Job cannot be completed from status: ${job.status}`);
    }

    const absoluteSource = path.resolve(sourceImage);
    if (!fs.existsSync(absoluteSource) || !fs.statSync(absoluteSource).isFile()) {
        throw new Error(`Generated image not found: ${absoluteSource}`);
    }
    const extension = path.extname(absoluteSource).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) throw new Error(`Unsupported image extension: ${extension}`);

    fs.mkdirSync(imagesDir, { recursive: true });
    const nodeSegment = safeSegment(job.nodeId);
    const filename = `codex_${nodeSegment}_v${String(job.attempt).padStart(3, '0')}_${job.id.slice(-8)}${extension}`;
    const destination = path.join(imagesDir, filename);
    const normalizedOutput = await writeAspectRatioSafeImage({
        sourceImage: absoluteSource,
        destination,
        aspectRatio: job.aspectRatio
    });

    const now = new Date().toISOString();
    const resultUrl = `/library/images/${filename}`;
    const updated = {
        ...job,
        status: 'completed',
        resultUrl,
        resultPath: destination,
        sourceDimensions: {
            width: normalizedOutput.inspection.width,
            height: normalizedOutput.inspection.height
        },
        outputDimensions: {
            width: normalizedOutput.outputWidth,
            height: normalizedOutput.outputHeight
        },
        aspectRatioVerified: true,
        aspectRatioAdjusted: normalizedOutput.adjusted,
        aspectRatioAdjustmentMode: normalizedOutput.adjustmentMode,
        completedAt: now,
        updatedAt: now
    };
    writeJsonAtomic(jobPath(jobsDir, jobId), updated);

    const metadata = {
        id: job.id,
        filename,
        prompt: job.prompt,
        model: 'codex-built-in-imagegen',
        nodeId: job.nodeId,
        attempt: job.attempt,
        aspectRatio: job.aspectRatio,
        sourceDimensions: updated.sourceDimensions,
        outputDimensions: updated.outputDimensions,
        aspectRatioAdjusted: updated.aspectRatioAdjusted,
        createdAt: now,
        type: 'images'
    };
    writeJsonAtomic(path.join(imagesDir, `${job.id}.json`), metadata);
    return updated;
}

export function failCodexImageJob(jobsDir, jobId, message) {
    const job = getCodexImageJob(jobsDir, jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    if (job.status === 'completed') throw new Error('Completed jobs cannot be failed');

    const now = new Date().toISOString();
    const updated = {
        ...job,
        status: 'failed',
        error: String(message || 'Codex image generation failed'),
        failedAt: now,
        updatedAt: now
    };
    writeJsonAtomic(jobPath(jobsDir, jobId), updated);
    return updated;
}
