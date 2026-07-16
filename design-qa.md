**Source visual truth**

- `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-233c3ed2-63b3-4933-bd5f-1720de3bed7f.png`
- Supporting states: `codex-clipboard-cfe87e6a-4c1e-4ed2-bbf5-b71075fc5cbe.png`, `codex-clipboard-0058ba90-eb42-4477-ab5a-d95f364c76b4.png`
- Overflow regression references: `codex-clipboard-629a71ca-5818-45a2-93e0-e0d239b02ff6.png`, `codex-clipboard-637e44f0-1a83-4b48-8542-7e7e8469bf9a.png`
- Asset deletion reference: `codex-clipboard-d310bb88-3430-42cf-b70e-a5064bfd1c65.png`

**Implementation evidence**

- Screenshot: `sidebar-implementation.png`
- Combined comparison: `sidebar-comparison.png`
- Overflow fix screenshot: `sidebar-panel-fixed.png`
- Narrow sidebar screenshot: `sidebar-300px.png`
- Local image deletion screenshot: `sidebar-delete-image-confirm.png`
- Viewport: 1280 x 720
- State: dark theme, expanded sidebar, Canvas tab, empty current canvas

**Full-view comparison evidence**

The combined comparison confirms the same persistent left-rail composition, dark surface hierarchy, project header, Canvas/Assets tabs, scrollable content region, and fixed footer navigation. The implementation keeps the application's real TwitCanva logo and existing canvas controls instead of copying the source product's branding.

**Focused region comparison evidence**

The left sidebar was reduced from 390 px to 300 px after user review. Typography, tab treatment, separators, icon sizing, empty-state hierarchy, and footer alignment remain readable at the narrower width.

**Findings**

- No actionable P0, P1, or P2 mismatch remains.
- P3: The TwitCanva purple logo differs from the white reference logo. This is intentional product-brand preservation.
- P3: The source populated Canvas state contains many thumbnail rows, while the implementation evidence shows the matching empty state because the current unsaved canvas has zero nodes. The populated Assets state was separately verified with real local image records.

**Required fidelity surfaces**

- Fonts and typography: passed. Existing system sans stack, weights, truncation, line height, and muted hierarchy match the product and reference density.
- Spacing and layout rhythm: passed. Sidebar width, header/tabs/content/footer segmentation, row radii, padding, and fixed footer remain consistent.
- Colors and visual tokens: passed. Near-black canvas, #151515 sidebar, neutral borders, selected surfaces, and muted foregrounds match the reference direction.
- Image quality and asset fidelity: passed. The implementation uses the existing TwitCanva logo and actual library thumbnails; no placeholder imagery or handcrafted icons replace visible assets.
- Copy and content: passed. Labels are localized and correspond to real project concepts and actions.

**Interactions tested**

- Project menu opens and exposes return, all projects, create, and delete states.
- Canvas and Assets tabs switch correctly.
- Personal assets load from the local backend.
- Asset search filters the visible list.
- Sidebar collapses to a narrow rail and expands again.
- Expanded footer now retains only the useful Workflows and AI Storyboard actions.
- Workflow panel opens at x=410, y=200 with a 700 x 317 visible rect inside the 1280 x 720 viewport.
- Browser console errors checked: none.
- Personal image overflow menu exposes a local-delete action, requires a second confirmation, and can be cancelled without changing the asset list.
- The confirmation surface remains fully visible inside the 1280 x 720 viewport (`x=57`, `y=373`, `width=210`, `height=118`).
- Backend deletion was verified with an isolated temporary fixture: both the image file and its metadata JSON were removed. No user asset was deleted during QA.

**Comparison history**

1. Initial capture exposed the empty-start panel centered across the whole viewport, partially underneath the new sidebar.
2. Fixed the content offset so the start panel centers within the remaining canvas.
3. Post-fix capture confirms the sidebar and canvas no longer overlap.
4. The bottom-triggered workflow panel originally extended beyond the viewport. The panel now clamps its top, left, and width to the available canvas; the post-fix screenshot confirms its full 700 x 317 surface is visible. Redundant History and Asset footer shortcuts were removed because those functions are already available in the Assets tab.
5. User feedback identified the 390 px sidebar as too wide. It was reduced to 300 px, all canvas and panel offsets were centralized around the new constant, and browser evidence confirms `clientWidth=299`, `scrollWidth=299` with no horizontal overflow in normal or expanded-search states.

**Implementation checklist**

- Persistent project sidebar integrated with the current app.
- Real workflow, node, generated-asset, and curated-library data connected.
- Search, filtering, selection, node location, project menu, and collapse behavior implemented.
- Personal image deletion synchronizes the sidebar state with removal of the local media file and metadata record.
- Production build and automated tests passed.

final result: passed

---

## Canvas minimap QA — 2026-07-16

**Source visual truth**

- `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-7c43d904-b744-4202-9a92-fce13efba585.png`
- Expanded reference: `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-a0a1f979-f6ab-4bec-a8f6-b5ce128d6a36.png`
- Full-canvas placement reference: `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-ab4a0f25-7c29-4a83-a0dc-876aaf951431.png`

**Implementation evidence**

- Expanded state: `canvas-minimap-expanded.png`
- Collapsed state: `canvas-minimap-collapsed.png`
- Full comparison: `canvas-minimap-full-comparison.png`
- Focused comparison: `canvas-minimap-focused-comparison.png`
- Viewport: 1280 x 720
- State: dark theme, expanded sidebar, 8-node AI manga workflow, minimap expanded

**Full-view comparison evidence**

The combined full view confirms the same bottom-left placement beside the canvas rail, dark floating surface, compact navigation control, and minimap positioned directly above its trigger. The source contains a much larger 444-node production canvas while the implementation evidence uses the application's generated 8-node workflow, so node density is intentionally content-dependent.

**Focused region comparison evidence**

The combined focused comparison confirms the reference pattern: rounded dark overview panel, simplified node rectangles, a contrasting viewport outline, selected map button, nearby zoom percentage, and an attached control bar. The implementation retains the existing zoom slider because it is a working product control; unrelated reference-app toolbar buttons were not copied.

**Findings**

- No actionable P0, P1, or P2 mismatch remains.
- P3: The implementation overview is slightly shorter than the expanded reference. This keeps more of the active canvas visible while preserving the same information hierarchy.

**Required fidelity surfaces**

- Fonts and typography: passed. Existing product system font and compact 12 px control labels remain consistent.
- Spacing and layout rhythm: passed. The map, 8 px inter-surface gap, rounded panel, and bottom-left offset match the reference pattern without overlapping the sidebar.
- Colors and visual tokens: passed. Neutral dark surfaces, gray node blocks, white viewport outline, and active control surface match the current product theme.
- Image quality and asset fidelity: passed. The minimap is a live visualization of actual node geometry rather than a raster placeholder.
- Copy and content: passed. Tooltip and accessibility labels use Chinese copy: `画布小地图` and `画布缩放`.

**Interactions tested**

- Minimap button opens and closes the overview; `aria-pressed` updates between `true` and `false`.
- Eight live nodes render as overview rectangles.
- Current visible canvas renders as an outlined viewport rectangle.
- Clicking the minimap moved the canvas transform from `translate(90px, 82px)` to `translate(31.25px, 82px)` at 62% zoom.
- Drag behavior is implemented with pointer capture so navigation continues while the pointer is held.
- Browser interaction completed without a runtime exception or visible error overlay.

**Comparison history**

1. Initial implementation matched the reference composition and interaction model; the first combined full and focused comparisons found no P0/P1/P2 issue, so no blocking visual correction loop was required.

**Implementation checklist**

- Live node distribution connected to current canvas state.
- Live viewport outline connected to pan and zoom state.
- Click-and-drag minimap navigation implemented.
- Expand/collapse control and tooltip implemented.
- Production build and 30 automated tests passed.

final result: passed
