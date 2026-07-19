/**
 * One-off migration: organizes every existing workflow's media into its own
 * per-project folder (library/images|videos/{assetsDirName}/), using the same
 * logic the server now runs automatically on every workflow save.
 *
 * Safe to re-run: it copies (never moves) from the flat pool and is a no-op
 * for anything already organized.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { organizeWorkflowAssets } from '../server/utils/projectAssets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const LIBRARY_DIR = path.join(ROOT, 'library');
const WORKFLOWS_DIR = path.join(LIBRARY_DIR, 'workflows');
const IMAGES_DIR = path.join(LIBRARY_DIR, 'images');
const VIDEOS_DIR = path.join(LIBRARY_DIR, 'videos');

const files = fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith('.json'));
let organizedCount = 0;

for (const file of files) {
    const filePath = path.join(WORKFLOWS_DIR, file);
    const workflow = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const { changed } = organizeWorkflowAssets(workflow, { imagesDir: IMAGES_DIR, videosDir: VIDEOS_DIR });
    if (changed) {
        fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2));
        organizedCount++;
        console.log(`organized: ${workflow.title || workflow.id} -> library/images|videos/${workflow.assetsDirName}/`);
    } else {
        console.log(`skip (already organized / nothing to do): ${workflow.title || workflow.id}`);
    }
}

console.log(`\nDone. ${organizedCount}/${files.length} workflow(s) organized.`);
