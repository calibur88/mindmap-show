/**
 * @module host/obsidian/meta
 * @description 元数据适配器：反链索引注入与查询
 */

import type { BacklinkIndex, IBacklink, IMetaHost } from '../types';
import { makeBacklinkKey } from '../../utils/make-key';

const EMPTY_INDEX: BacklinkIndex = {
  get: () => undefined,
  getAll: () => new Map(),
};

export class ObsidianMetaHost implements IMetaHost {
  private index: BacklinkIndex = EMPTY_INDEX;

  setBacklinkIndex(index: BacklinkIndex): void {
    this.index = index;
  }

  getBacklinks(nodeId: string, filePath: string): IBacklink[] {
    return this.index.get(makeBacklinkKey(filePath, nodeId)) ?? [];
  }
}
