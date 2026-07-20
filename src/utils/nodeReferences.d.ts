export type NodeReferenceKind = 'image' | 'video' | 'audio';

export interface NodeReference {
  id: string;
  kind: NodeReferenceKind;
  label: string;
  assetName?: string;
  title: string;
  url?: string;
  previewUrl?: string;
}

interface ReferenceNodeLike {
  id: string;
  type: string;
  title?: string;
  resultUrl?: string;
  lastFrame?: string;
  mediaUrl?: string;
  assetName?: string;
}

export function collectNodeReferences(parentIds: string[] | undefined, nodes: ReferenceNodeLike[]): NodeReference[];
export function extractReferenceLabels(prompt: string, references?: NodeReference[]): Set<string>;
export function selectPromptReferences(references: NodeReference[], prompt: string): NodeReference[];

