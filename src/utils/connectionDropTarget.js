export const CONNECTION_DROP_SLOP_PX = 28;

const distanceToRect = (point, rect) => {
    const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
    const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
    return Math.hypot(dx, dy);
};

/**
 * Resolve a connection target from real screen-space node rectangles.
 * Candidates should be ordered from visually topmost to bottommost.
 */
export const resolveConnectionDropTarget = ({
    point,
    sourceNodeId,
    candidates,
    connectorTarget = null,
    slop = CONNECTION_DROP_SLOP_PX,
}) => {
    if (connectorTarget && connectorTarget.nodeId !== sourceNodeId) {
        return connectorTarget;
    }

    const uniqueCandidates = [];
    const seen = new Set();
    for (const candidate of candidates || []) {
        if (!candidate || candidate.nodeId === sourceNodeId || seen.has(candidate.nodeId)) continue;
        seen.add(candidate.nodeId);
        uniqueCandidates.push(candidate);
    }

    let best = null;
    for (const candidate of uniqueCandidates) {
        const distance = distanceToRect(point, candidate.rect);
        if (distance > slop) continue;
        if (!best || distance < best.distance) {
            best = { candidate, distance };
            if (distance === 0) break;
        }
    }

    if (!best) return null;
    const { candidate } = best;
    const centerX = candidate.rect.left + candidate.rect.width / 2;
    return {
        nodeId: candidate.nodeId,
        side: point.x < centerX ? 'left' : 'right',
    };
};
