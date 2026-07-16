export const ZOOM_MIN: number;
export const ZOOM_MAX: number;
export const TRACKPAD_DELTA_THRESHOLD: number;
export const TRACKPAD_SENSITIVITY: number;
export const WHEEL_SENSITIVITY: number;

export function normalizeWheelDelta(deltaY: number, deltaMode?: number): number;
export function isTrackpadGesture(deltaY: number, deltaMode?: number): boolean;
export function zoomFactorFromWheel(deltaY: number, deltaMode?: number): number;
export function clampZoom(zoom: number): number;
