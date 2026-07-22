export function dataUrlToBlob(dataUrl: string): Blob;
export function snapshotImageSource(snapshot: string | Blob): {
    src: string;
    release: () => void;
};
