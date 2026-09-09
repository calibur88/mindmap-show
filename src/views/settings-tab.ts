/**
 * @module views/settings-tab
 * @description 插件设置面板。只写偏好，不写业务数据
 *
 * 数字字段只校验"正数"：解析失败或非正数拒绝落盘，任意大小/精度的正数都接受；
 * 无效输入在失焦时把显示值恢复为当前生效值，避免输入框停留无效内容让人误以为已生效
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type MmsPlugin from '../main';
import type { DefaultView, MmsSettings } from '../settings/schema';

/** 把输入框值转成正数。返回 null 代表输入无效（空、非法、≤0、NaN、Infinity） */
function parsePositive(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** MmsSettings 中数值类型的键 */
type NumericSettingKey = {
  [K in keyof MmsSettings]: MmsSettings[K] extends number ? K : never;
}[keyof MmsSettings];

export class MmsSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: MmsPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();

    new Setting(this.containerEl)
      .setName('默认视图')
      .setDesc('打开 .mms 文件时进入哪个视图')
      .addDropdown((dropdown) => {
        dropdown
          .addOptions({ explore: '探索视图（可折叠交互）', panorama: '全景视图（静态全量）' })
          .setValue(this.plugin.settings.defaultView)
          .onChange((value) => {
            this.plugin.updateSettings({ defaultView: value as DefaultView });
          });
      });

    new Setting(this.containerEl)
      .setName('显示调试警告')
      .setDesc('在左栏展示全部 .mms 文件的解析警告')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showDebugWarnings).onChange((value) => {
          this.plugin.updateSettings({ showDebugWarnings: value });
        });
      });

    // ---------------------- 视觉：线条宽度 ----------------------
    this.containerEl.createEl('h3', { text: '视觉 · 线条宽度' });

    const lineWidthDesc = '节点之间连线的粗细（像素，正数即可）';
    this.addPositiveNumber('探索视图树边线宽', lineWidthDesc, 'exploreLineWidth');
    this.addPositiveNumber('全景视图树边线宽', lineWidthDesc, 'panoramaLineWidth');
    this.addPositiveNumber('跨文件引用线宽', '「<=>」虚线连线的粗细（像素，正数即可）', 'crossLineWidth');

    // ---------------------- 视觉：节点间距 ----------------------
    this.containerEl.createEl('h3', { text: '视觉 · 节点间距' });

    const gapDesc = '像素，正数即可';
    this.addPositiveNumber('探索视图·子节点间距', `同一父节点下子节点之间的纵向距离（${gapDesc}）`, 'exploreNodeGap');
    this.addPositiveNumber('探索视图·层级间距', `父子节点之间的横向距离（${gapDesc}）`, 'exploreLevelGap');
    this.addPositiveNumber('全景视图·子节点间距', `同一父节点下子节点之间的纵向距离（${gapDesc}）`, 'panoramaNodeGap');
    this.addPositiveNumber('全景视图·层级间距', `父子节点之间的横向距离（${gapDesc}）`, 'panoramaLevelGap');
  }

  /** 正数输入框：无效输入不落盘，失焦时恢复显示为当前生效值 */
  private addPositiveNumber(name: string, desc: string, key: NumericSettingKey): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        const current = (): number => this.plugin.settings[key];
        text.setValue(String(current()));
        text.onChange((raw) => {
          const value = parsePositive(raw);
          if (value === null) return;
          this.plugin.updateSettings({ [key]: value } as Partial<MmsSettings>);
        });
        text.inputEl.addEventListener('blur', () => {
          if (parsePositive(text.inputEl.value) === null) text.inputEl.value = String(current());
        });
      });
  }
}
