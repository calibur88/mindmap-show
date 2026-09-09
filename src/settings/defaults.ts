/**
 * @module settings/defaults
 * @description 插件设置默认值。纯数据
 */

import type { MmsSettings } from './schema';

/** 默认线条宽度。探索视图略粗以保证清晰度，全景视图略细避免压字 */
export const DEFAULT_SETTINGS: Readonly<MmsSettings> = {
  defaultView: 'explore',
  showDebugWarnings: true,
  exploreLineWidth: 2,
  panoramaLineWidth: 1.5,
  crossLineWidth: 1.5,
  // M4：加大默认间距，避免"矩形挨太近"问题
  exploreNodeGap: 36,
  exploreLevelGap: 100,
  panoramaNodeGap: 18,
  panoramaLevelGap: 48,
  collapsedFolders: [],
};
