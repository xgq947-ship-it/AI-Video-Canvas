export interface Viewport {
    x: number;
    y: number;
    zoom: number;
}

export interface RectLike {
    left: number;
    top: number;
    width?: number;
    height?: number;
}

export interface Point {
    x: number;
    y: number;
}

export function screenToPane(screenX: number, screenY: number, rect: RectLike): Point;
export function paneToCanvas(paneX: number, paneY: number, viewport: Viewport): Point;
export function canvasToPane(canvasX: number, canvasY: number, viewport: Viewport): Point;
export function screenToCanvas(screenX: number, screenY: number, rect: RectLike, viewport: Viewport): Point;
export function canvasToScreen(canvasX: number, canvasY: number, rect: RectLike, viewport: Viewport): Point;
export function canvasViewCenter(rect: RectLike, viewport: Viewport): Point;

export const DEFAULT_NODE_WIDTH: number;
export const VIDEO_NODE_WIDTH: number;
export const DEFAULT_NODE_HEIGHT: number;
export function centerNodeAt(point: Point, nodeWidth?: number, nodeHeight?: number): Point;

export interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

export const FIT_VIEWPORT_PADDING: number;
export function computeFitViewport(
    rect: RectLike,
    box: Box,
    options?: { padding?: number; minZoom?: number; maxZoom?: number }
): Viewport;
