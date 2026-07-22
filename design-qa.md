# 模型与密钥入口清理：视觉 QA

- Source visual truth:
  - `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-39a68b08-4d6f-4fc1-8f3e-c1dd5b61e595.png`
  - `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-37fa857a-83f3-4a01-b5e2-0d765868b5ca.png`
  - `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-7eac2349-984a-43ea-a866-9d5f19ab0c7c.png`
  - `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-beb981cd-6413-4c97-9b32-4da0db5a7b11.png`
  - `/var/folders/rp/tm3c_gz979b___tds5nnyz740000gn/T/codex-clipboard-90f1d02d-374e-4d80-8188-438a6d9716fa.png`
- Implementation screenshots:
  - `output/design-qa/image-models-clean.png`
  - `output/design-qa/video-models-clean.png`
  - `output/design-qa/clean-api-settings.png`
  - `output/design-qa/tts-providers-clean.png`
- Combined comparison evidence:
  - `output/design-qa/compare-recommend.png`
  - `output/design-qa/compare-api-settings.png`
- Browser viewport: 1280 x 720 CSS px, device scale factor 1.
- State: dark theme; image/video model menus, API settings modal, and audio-node provider state inspected independently.

## Findings

No actionable P0/P1/P2 mismatch.

- Typography and spacing: removing recommendation badges leaves model rows aligned and readable, without empty badge gaps.
- Image model list: Kling V1.5 and the KLING AI section are absent; retained Google Flow image models remain selectable.
- Video model list: all recommendation labels are absent; Kling and Hailuo groups are absent; Google Flow Veo 3.1 Lite and the five Jimeng variants remain available.
- API settings: Kling 3.0, Hailuo 2.3, Kling-compatible image credentials, and MiniMax voice configuration cards are absent. DeepSeek, Google, OpenAI, and Seedance settings remain.
- Audio node: MiniMax is absent, and legacy/default behavior resolves to “仅导入音频”.

The supplied screenshots show removal targets rather than a full-page reference. Focused menu and settings comparisons therefore verify content removal, row continuity, and absence of orphaned sections.

## Interaction and console checks

- Created image, video, and audio nodes in the real local application.
- Opened image and video model dropdowns and inspected their DOM-visible options.
- Opened API key settings and verified all targeted provider cards are absent.
- Verified no `推荐`, Kling, Hailuo, or MiniMax labels remain in the relevant rendered states.
- Browser console: no errors; one pre-existing Tailwind CDN production warning.

## Comparison history

- Initial implementation pass satisfied the requested removal states; no visual correction loop was required.

## Follow-up polish

- None required for this scoped cleanup.

final result: passed
