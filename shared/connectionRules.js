/**
 * shared/connectionRules.js
 *
 * 画布节点连接合法性规则（纯函数，基于节点类型字符串，便于前端与测试共用）。
 * 类型字符串与 src/types.ts 的 NodeType 枚举取值一致。
 */

export const NODE = {
  TEXT: 'Text',
  IMAGE: 'Image',
  VIDEO: 'Video',
  AUDIO: 'Audio',
  IMAGE_EDITOR: 'Image Editor',
  PRODUCT_SCENE_REPLACE: 'Product Scene Replace',
  VIDEO_ANALYSIS: 'Video Analysis',
  VIDEO_REMIX: 'Video Remix',
  REFERENCE_VIDEO: 'Reference Video',
  SCRIPT_INPUT: 'Script Input',
  STICKMAN_DIRECTOR: 'Stickman Director',
  STORYBOARD: 'Storyboard',
  STORYBOARD_COMPARE: 'Storyboard Compare',
  FLOW_BATCH_VIDEO: 'Flow Batch Video',
  VIDEO_MERGE: 'Video Merge',
  SFX: 'SFX',
  BGM: 'BGM',
  SUBTITLE: 'Subtitle',
  RENDER: 'Render',
};

const AUDIO_KINDS = [NODE.AUDIO, NODE.SFX, NODE.BGM];

/**
 * 判断 parent → child 连接是否合法。规则见 docs/AI漫剧0-1工作流.md「连接规则」。
 * @param {string} parentType
 * @param {string} childType
 * @returns {boolean}
 */
export const isValidNodeConnection = (parentType, childType) => {
  // RENDER 是终点，不能作为任何节点的父（输出）
  if (parentType === NODE.RENDER) return false;
  // 任何节点都不能连向 TEXT（文本不接收输入）
  if (childType === NODE.TEXT) return false;

  // Stickman Video Director workflow ports.
  if (childType === NODE.STICKMAN_DIRECTOR) {
    return parentType === NODE.SCRIPT_INPUT || parentType === NODE.VIDEO_ANALYSIS || parentType === NODE.VIDEO || parentType === NODE.REFERENCE_VIDEO;
  }
  if (childType === NODE.STORYBOARD || childType === NODE.STORYBOARD_COMPARE) {
    return parentType === NODE.STICKMAN_DIRECTOR;
  }
  if (childType === NODE.FLOW_BATCH_VIDEO) {
    return parentType === NODE.STORYBOARD || parentType === NODE.STORYBOARD_COMPARE;
  }
  if (childType === NODE.VIDEO_MERGE) return parentType === NODE.FLOW_BATCH_VIDEO;
  if (childType === NODE.SCRIPT_INPUT) return parentType === NODE.VIDEO || parentType === NODE.REFERENCE_VIDEO;
  if (childType === NODE.REFERENCE_VIDEO) return false;
  if (parentType === NODE.VIDEO_MERGE) return false;

  // Video Analysis only accepts media references on its fixed input ports.
  // Port assignment is handled by the canvas connection layer; this rule only
  // guards the node-level type boundary.
  if (childType === NODE.VIDEO_ANALYSIS) {
    return parentType === NODE.VIDEO || parentType === NODE.REFERENCE_VIDEO || parentType === NODE.IMAGE || parentType === NODE.IMAGE_EDITOR;
  }

  // The analysis result is a workflow source for ordinary image/video nodes
  // and for the final render node. Reference images are inherited through the
  // analysis node instead of being connected to every shot node.
  if (parentType === NODE.VIDEO_ANALYSIS) {
    return childType === NODE.IMAGE || childType === NODE.VIDEO || childType === NODE.RENDER || childType === NODE.STICKMAN_DIRECTOR;
  }

  // RENDER 可接收：视频镜头 / 音轨(配音·音效·BGM) / 字幕
  if (childType === NODE.RENDER) {
    return (
      parentType === NODE.VIDEO ||
      AUDIO_KINDS.includes(parentType) ||
      parentType === NODE.SUBTITLE
    );
  }

  // Video Remix 已提升为项目级工作区；旧节点只用于加载迁移，不能再参与画布连线。
  if (childType === NODE.VIDEO_REMIX || parentType === NODE.VIDEO_REMIX) return false;

  // 配音节点还可连向 VIDEO，作为 Seedance 2.0 的人物音色参考。
  // SFX / BGM / 字幕仍只能连向 RENDER。
  if (parentType === NODE.AUDIO && childType === NODE.VIDEO) return true;
  if (AUDIO_KINDS.includes(parentType) || parentType === NODE.SUBTITLE) return false;

  // TEXT → IMAGE / VIDEO（提示词）或 AUDIO / SUBTITLE（台词文本）
  if (parentType === NODE.TEXT) {
    return (
      childType === NODE.IMAGE ||
      childType === NODE.VIDEO ||
      childType === NODE.PRODUCT_SCENE_REPLACE ||
      childType === NODE.AUDIO ||
      childType === NODE.SUBTITLE
    );
  }

  // 非 TEXT 来源不能连向音轨 / 字幕
  if (AUDIO_KINDS.includes(childType) || childType === NODE.SUBTITLE) return false;

  // 产品短视频生成接收两张图片和一个文本提示词。
  if (childType === NODE.PRODUCT_SCENE_REPLACE) {
    return parentType === NODE.IMAGE || parentType === NODE.IMAGE_EDITOR;
  }

  if (parentType === NODE.VIDEO) {
    return childType === NODE.VIDEO;
  }
  if (parentType === NODE.IMAGE) return childType === NODE.IMAGE || childType === NODE.VIDEO || childType === NODE.IMAGE_EDITOR;
  if (parentType === NODE.IMAGE_EDITOR) return childType === NODE.IMAGE || childType === NODE.VIDEO || childType === NODE.IMAGE_EDITOR;
  if (parentType === NODE.PRODUCT_SCENE_REPLACE) return childType === NODE.IMAGE || childType === NODE.VIDEO || childType === NODE.IMAGE_EDITOR;
  return true;
};
