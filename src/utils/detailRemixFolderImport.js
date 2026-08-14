const naturalPathCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base',
});

export const DETAIL_REMIX_IMPORT_NODE_WIDTH = 365;
export const DETAIL_REMIX_IMPORT_COLUMN_GAP = 80;
export const DETAIL_REMIX_IMPORT_ROW_GAP = 140;
export const DETAIL_REMIX_IMPORT_CONTROLLER_GAP = 160;
export const DETAIL_REMIX_IMPORT_LAYOUT_VERSION = 2;

const text = value => String(value || '').trim();

export function detailRemixFolderFilePath(file) {
  return text(file?.webkitRelativePath || file?.relativePath || file?.name).replaceAll('\\', '/');
}

export function isVisibleDetailRemixFolderFile(file) {
  const relativePath = detailRemixFolderFilePath(file);
  if (!relativePath) return false;
  return !relativePath.split('/').some(part => (
    part.startsWith('.')
    || part === '__MACOSX'
    || part.toLowerCase() === 'thumbs.db'
  ));
}

/** Stable page order: nested relative path first, with numeric filename sorting. */
export function sortDetailRemixFolderFiles(files) {
  return [...(Array.isArray(files) ? files : [])]
    .filter(isVisibleDetailRemixFolderFile)
    .sort((left, right) => naturalPathCollator.compare(
      detailRemixFolderFilePath(left),
      detailRemixFolderFilePath(right),
    ));
}

export function detailRemixFolderName(files, fallback = '未命名文件夹') {
  const paths = sortDetailRemixFolderFiles(files).map(detailRemixFolderFilePath);
  const first = paths[0] || '';
  if (!first.includes('/')) return fallback;
  const firstSegment = first.split('/')[0];
  return paths.every(value => value.split('/')[0] === firstSegment)
    ? firstSegment
    : fallback;
}

/**
 * Both source sets are placed above the controller as single horizontal rows.
 * Row spacing is derived from the actual tallest image, so long detail images
 * cannot grow into the neighbouring row after their real ratio is loaded.
 */
export function buildDetailRemixFolderRowPlacements(controller, rows = {}) {
  const own = Array.isArray(rows.own) ? rows.own : [];
  const competitor = Array.isArray(rows.competitor) ? rows.competitor : [];
  const controllerCenterX = Number(controller?.x || 0) + 230;
  const step = DETAIL_REMIX_IMPORT_NODE_WIDTH + DETAIL_REMIX_IMPORT_COLUMN_GAP;
  const ratio = node => {
    const value = String(node?.resultAspectRatio || node?.aspectRatio || '3:4');
    const separator = value.includes('/') ? '/' : ':';
    const [width, height] = value.split(separator).map(Number);
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
      ? width / height
      : 3 / 4;
  };
  const height = node => DETAIL_REMIX_IMPORT_NODE_WIDTH / ratio(node);
  const rowHeight = nodes => nodes.reduce((maximum, node) => Math.max(maximum, height(node)), 0);
  const competitorHeight = rowHeight(competitor);
  const ownHeight = rowHeight(own);
  const controllerY = Number(controller?.y || 0);
  const competitorY = competitor.length
    ? controllerY - DETAIL_REMIX_IMPORT_CONTROLLER_GAP - competitorHeight
    : undefined;
  const ownY = own.length
    ? competitor.length
      ? competitorY - DETAIL_REMIX_IMPORT_ROW_GAP - ownHeight
      : controllerY - DETAIL_REMIX_IMPORT_CONTROLLER_GAP - ownHeight
    : undefined;
  const place = (nodes, y) => {
    const startX = controllerCenterX
      - (nodes.length * DETAIL_REMIX_IMPORT_NODE_WIDTH + Math.max(0, nodes.length - 1) * DETAIL_REMIX_IMPORT_COLUMN_GAP) / 2;
    return nodes.map((node, index) => ({ id: node.id, x: startX + index * step, y }));
  };
  return {
    own: place(own, ownY),
    competitor: place(competitor, competitorY),
  };
}

export function buildDetailRemixFolderPlacements(controller, role, count) {
  const total = Math.max(0, Number(count) || 0);
  const rows = {
    own: role === 'own' ? Array.from({ length: total }, (_, index) => ({ id: `own-${index}` })) : [],
    competitor: role === 'competitor'
      ? Array.from({ length: total }, (_, index) => ({ id: `competitor-${index}` }))
      : [],
  };
  return buildDetailRemixFolderRowPlacements(controller, rows)[role].map(({ x, y }) => ({ x, y }));
}

/** Reflow only the active folder imports; replaced/archived canvas images stay untouched. */
export function reflowDetailRemixFolderNodes(nodes, controllerId) {
  const controller = nodes.find(node => node?.id === controllerId);
  if (!controller) return nodes;
  const refs = controller.detailRemix?.inputRefs || {};
  const byId = new Map(nodes.map(node => [node.id, node]));
  const importedForRole = (ids, role) => ids
    .map(id => byId.get(id))
    .filter(node => (
      node?.detailRemixImport?.controllerNodeId === controllerId
      && node?.detailRemixImport?.role === role
    ));
  const own = importedForRole(refs.ownDetailNodeIds || [], 'own');
  const competitor = importedForRole(refs.competitorDetailNodeIds || [], 'competitor');
  const layout = buildDetailRemixFolderRowPlacements(controller, { own, competitor });
  const placementById = new Map([...layout.own, ...layout.competitor].map(item => [item.id, item]));
  return nodes.map(node => {
    const placement = placementById.get(node.id);
    return placement ? {
      ...node,
      x: placement.x,
      y: placement.y,
      detailRemixImport: {
        ...node.detailRemixImport,
        layoutVersion: DETAIL_REMIX_IMPORT_LAYOUT_VERSION,
      },
    } : node;
  });
}

/** One-time migration for folders imported before ratio-aware spacing existed. */
export function migrateDetailRemixFolderLayouts(nodes) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const controllerIds = nodes
    .filter(controller => {
      const refs = controller?.detailRemix?.inputRefs;
      if (!refs) return false;
      const activeIds = [
        ...(refs.ownDetailNodeIds || []),
        ...(refs.competitorDetailNodeIds || []),
      ];
      return activeIds.some(id => {
        const imported = byId.get(id)?.detailRemixImport;
        return imported?.controllerNodeId === controller.id
          && Number(imported.layoutVersion || 0) < DETAIL_REMIX_IMPORT_LAYOUT_VERSION;
      });
    })
    .map(controller => controller.id);
  return controllerIds.reduce(
    (current, controllerId) => reflowDetailRemixFolderNodes(current, controllerId),
    nodes,
  );
}
