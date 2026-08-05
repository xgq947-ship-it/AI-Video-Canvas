/**
 * connectionHelpers.ts
 * 
 * Utility functions for calculating and rendering node connections.
 * Handles bezier curve path generation for connection lines.
 */

/**
 * Calculates a bezier curve path for a connection between two points
 * 
 * @param startX - Starting X coordinate
 * @param startY - Starting Y coordinate
 * @param endX - Ending X coordinate
 * @param endY - Ending Y coordinate
 * @param direction - Direction of the connection ('right' or 'left')
 * @returns SVG path string for the bezier curve
 * 
 * @example
 * const path = calculateConnectionPath(100, 200, 500, 200, 'right');
 * // Returns: "M 100 200 C 300 200, 300 200, 500 200"
 */
export const calculateConnectionPath = (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    direction: 'left' | 'right' = 'right'
): string => {
    const dist = Math.abs(endX - startX);
    const cpDir = direction === 'right' ? 1 : -1;

    const cp1x = startX + (dist / 2 * cpDir);
    const cp2x = endX - (dist / 2 * cpDir);

    return `M ${startX} ${startY} C ${cp1x} ${startY}, ${cp2x} ${endY}, ${endX} ${endY}`;
};

