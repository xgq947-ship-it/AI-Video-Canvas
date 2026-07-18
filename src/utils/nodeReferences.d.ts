export type NodeReferenceKind = 'image' | 'video' | 'audio';

export interface NodeReference {
  id: string;
  kind: NodeReferenceKind;
  index: number;
  label: string;
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
}

export function collectNodeReferences(parentIds: string[] | undefined, nodes: ReferenceNodeLike[]): NodeReference[];
export function extractReferenceLabels(prompt: string): Set<string>;
export function selectPromptReferences(references: NodeReference[], prompt: string): NodeReference[];

