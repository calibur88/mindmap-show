/**
 * @module settings/schema
 * @description 插件设置的形状定义。纯数据，不依赖宿主
 */

/** 默认打开的视图 */
export type DefaultView = 'explore' | 'panorama';

/** 插件设置。只存偏好，不存任何业务数据 */
export interface MmsSettings {
  /** 打开 .mms 时默认进入的视图 */
  defaultView: DefaultView;
  /** 是否在左栏显示解析警告 */
  showDebugWarnings: boolean;
  /** 探索视图树边线宽（像素） */
  exploreLineWidth: number;
  /** 全景视图树边线宽（像素） */
  panoramaLineWidth: number;
  /** 跨文件引用虚线线宽（像素） */
  crossLineWidth: number;
  /** 探索视图：同一父节点下子节点之间的间距（像素） */
  exploreNodeGap: number;
  /** 探索视图：相邻层之间的间距（像素） */
  exploreLevelGap: number;
  /** 全景视图：子节点之间的间距（像素） */
  panoramaNodeGap: number;
  /** 全景视图：相邻层之间的间距（像素） */
  panoramaLevelGap: number;
}
