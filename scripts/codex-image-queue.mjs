#!/usr/bin/env node
import path from 'path';
import { fileURLToPath } from 'url';
import {
    claimCodexImageJob,
    completeCodexImageJob,
    failCodexImageJob,
    getCodexImageJob,
    inspectCodexImageOutput,
    listCodexImageJobs
} from '../server/services/codexImageJobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');
const libraryDir = path.join(projectDir, 'library');
const jobsDir = path.join(libraryDir, 'codex-image-jobs');
const imagesDir = path.join(libraryDir, 'images');

const args = process.argv.slice(2);
const command = args[0] || 'list';

function option(name) {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}

function print(value) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

try {
    if (command === 'list') {
        const status = option('--status') || 'pending';
        print(listCodexImageJobs(jobsDir, status));
    } else if (command === 'show') {
        const job = getCodexImageJob(jobsDir, args[1]);
        if (!job) throw new Error(`Job not found: ${args[1]}`);
        print(job);
    } else if (command === 'claim') {
        let jobId = args[1];
        if (!jobId || jobId === '--next') {
            jobId = listCodexImageJobs(jobsDir, 'pending')[0]?.id;
        }
        if (!jobId) throw new Error('No pending Codex image jobs');
        print(claimCodexImageJob(jobsDir, jobId));
    } else if (command === 'complete') {
        const jobId = args[1];
        const sourceImage = option('--image');
        if (!jobId || !sourceImage) throw new Error('Usage: complete <jobId> --image <path>');
        print(await completeCodexImageJob({ jobsDir, imagesDir, jobId, sourceImage }));
    } else if (command === 'verify') {
        const jobId = args[1];
        const sourceImage = option('--image');
        if (!jobId || !sourceImage) throw new Error('Usage: verify <jobId> --image <path>');
        const job = getCodexImageJob(jobsDir, jobId);
        if (!job) throw new Error(`Job not found: ${jobId}`);
        print(await inspectCodexImageOutput({ imagePath: sourceImage, aspectRatio: job.aspectRatio }));
    } else if (command === 'fail') {
        const jobId = args[1];
        if (!jobId) throw new Error('Usage: fail <jobId> --message <reason>');
        print(failCodexImageJob(jobsDir, jobId, option('--message')));
    } else {
        throw new Error('Commands: list, show, claim, verify, complete, fail');
    }
} catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
}
