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
  VIDEO_EDITOR: 'Video Editor',
  PRODUCT_SCENE_REPLACE: 'Product Scene Replace',
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

  // RENDER 可接收：视频镜头 / 视频编辑 / 音轨(配音·音效·BGM) / 字幕
  if (childType === NODE.RENDER) {
    return (
      parentType === NODE.VIDEO ||
      parentType === NODE.VIDEO_EDITOR ||
      AUDIO_KINDS.includes(parentType) ||
      parentType === NODE.SUBTITLE
    );
  }

  // 配音节点还可连向 VIDEO，作为 Seedance 2.0 的人物音色参考。
  // SFX / BGM / 字幕仍只能连向 RENDER。
  if (parentType === NODE.AUDIO && childType === NODE.VIDEO) return true;
  if (AUDIO_KINDS.includes(parentType) || parentType === NODE.SUBTITLE) return false;

  // TEXT → IMAGE / VIDEO（提示词）或 AUDIO / SUBTITLE（台词文本）
  if (parentType === NODE.TEXT) {
    return (
      childType === NODE.IMAGE ||
      childType === NODE.VIDEO ||
      childType === NODE.AUDIO ||
      childType === NODE.SUBTITLE
    );
  }

  // 非 TEXT 来源不能连向音轨 / 字幕
  if (AUDIO_KINDS.includes(childType) || childType === NODE.SUBTITLE) return false;

  // 产品场景替换只接收图片类输入；输出仍可进入后续图片/视频链路。
  if (childType === NODE.PRODUCT_SCENE_REPLACE) {
    return parentType === NODE.IMAGE || parentType === NODE.IMAGE_EDITOR;
  }

  if (parentType === NODE.VIDEO) return childType === NODE.VIDEO || childType === NODE.VIDEO_EDITOR;
  if (parentType === NODE.IMAGE) return childType === NODE.IMAGE || childType === NODE.VIDEO || childType === NODE.IMAGE_EDITOR;
  if (parentType === NODE.IMAGE_EDITOR) return childType === NODE.IMAGE || childType === NODE.VIDEO || childType === NODE.IMAGE_EDITOR;
  if (parentType === NODE.PRODUCT_SCENE_REPLACE) return childType === NODE.IMAGE || childType === NODE.VIDEO || childType === NODE.IMAGE_EDITOR;
  if (parentType === NODE.VIDEO_EDITOR) return childType === NODE.VIDEO;

  return true;
};
