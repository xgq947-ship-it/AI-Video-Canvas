---
name: twitcanva-codex-images
description: Process pending Codex image-generation jobs from the Evan/TwitCanva AI canvas without an OpenAI API key. Use whenever the canvas starts a Codex image job, the user asks to generate pending canvas images, process the Codex image queue, run AI manga image generation, or diagnose a Codex canvas image that remains waiting.
---

# TwitCanva Codex Images

Use the built-in `image_gen` tool to service the current Evan project queue. This workflow uses the user's own Codex/ChatGPT entitlement and does not call the OpenAI API directly.

## Locate the project

The Codex worker starts with the Evan repository as its working directory. Use the current working directory as the project root; never rely on a user-specific absolute path. Confirm that both files exist before processing:

```text
scripts/codex-image-queue.mjs
library/codex-image-jobs/
```

## Process the queue

1. List interrupted jobs, then pending jobs:

   ```bash
   node scripts/codex-image-queue.mjs list --status processing
   node scripts/codex-image-queue.mjs list
   ```

   Resume processing jobs first so an interrupted run cannot leave the canvas waiting.

2. Process jobs oldest first. Claim a pending job before generation; an already-processing job does not need another claim:

   ```bash
   node scripts/codex-image-queue.mjs claim <jobId>
   ```

3. Read the claimed job. Treat `prompt`, `aspectRatio`, `resolution`, and `outputSpec` as the requested output. For every entry in `references`, inspect its `filePath` with `view_image` before generating. References guide the result; they are not edit targets unless the prompt explicitly requests an edit.

4. Generate exactly one output with the built-in `image_gen` tool. Preserve named characters, clothing, facial identity, products, and visual style from the listed references. Do not use an API or CLI image-generation fallback and do not request `OPENAI_API_KEY`.

5. Optionally inspect dimensions:

   ```bash
   node scripts/codex-image-queue.mjs verify <jobId> --image <generated-image-path>
   ```

   Do not retry or alter a valid image solely because its dimensions differ from the preferred aspect ratio; completion performs the project's safe normalization.

6. Complete the exact claimed job:

   ```bash
   node scripts/codex-image-queue.mjs complete <jobId> --image <generated-image-path>
   ```

   The queue command places the output in the job's project-specific image directory and returns its canvas URL. Legacy jobs without project metadata remain compatible with `library/images`.

7. Continue until no pending jobs remain. When the queue first becomes empty, wait briefly and check both `processing` and `pending` once more. Finish only after two consecutive empty checks. If a job cannot be generated, release the canvas from its loading state:

   ```bash
   node scripts/codex-image-queue.mjs fail <jobId> --message "<short reason>"
   ```

## Safety and regeneration

- Complete only the claimed `jobId`; never substitute another node's output.
- Never overwrite or delete an earlier generated image.
- Do not add an earlier unsatisfactory result as a reference unless the job explicitly lists it.
- Do not edit source code, configuration, credentials, unrelated projects, or arbitrary library files while servicing the queue.
- Use `node scripts/codex-image-queue.mjs show <jobId>` when diagnosing one job.

Valid states are `pending`, `processing`, `completed`, and `failed`.
