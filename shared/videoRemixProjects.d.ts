import type { NodeData } from '../src/types';
import type { VideoRemixState } from './videoRemix.js';

export const VIDEO_REMIX_PROJECTS_SCHEMA_VERSION: 1;

export interface VideoRemixProject {
  schemaVersion: 1;
  id: string;
  title: string;
  state: VideoRemixState;
  createdAt: string;
  updatedAt: string;
  sourceCanvasNodeId?: string;
  finalCanvasNodeId?: string;
  canvasMigrationVersion?: number;
  canvasAnalysisNodeId?: string;
}

export function createVideoRemixProject(
  overrides?: Partial<VideoRemixProject> & { videoRemix?: VideoRemixState },
  now?: string
): VideoRemixProject;

export function normalizeVideoRemixProjects(
  values: unknown,
  now?: string
): VideoRemixProject[];

export function migrateLegacyVideoRemixNodes(
  nodes: NodeData[] | unknown,
  existingProjects: unknown,
  now?: string
): {
  nodes: NodeData[];
  videoRemixes: VideoRemixProject[];
  migrated: boolean;
  legacyNodeIds: string[];
};

export function videoRemixProjectAsNode(project: VideoRemixProject): NodeData;
