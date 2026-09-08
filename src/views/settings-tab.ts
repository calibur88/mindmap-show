/**
 * @module views/settings-tab
 * @description 插件设置面板。只写偏好，不写业务数据
 *
 * 数字字段只校验"正数"：解析失败或非正数拒绝，任意大小/精度的正数都接受
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type MmsPlugin from '../main';
import type { DefaultView } from '../settings/schema';

/** 把输入框值转成正数。返回 null 代表输入无效（空、非法、≤0、NaN） */
function parsePositive(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

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
          .onChange(async (value) => {
            await this.plugin.updateSettings({ defaultView: value as DefaultView });
          });
      });

    new Setting(this.containerEl)
      .setName('显示调试警告')
      .setDesc('在左栏展示全部 .mms 文件的解析警告')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showDebugWarnings).onChange(async (value) => {
          await this.plugin.updateSettings({ showDebugWarnings: value });
        });
      });

    // ---------------------- 视觉：线条宽度 ----------------------
    this.containerEl.createEl('h3', { text: '视觉 · 线条宽度' });

    const lineWidthDesc = '节点之间连线的粗细（像素，正数即可）';

    new Setting(this.containerEl)
      .setName('探索视图树边线宽')
      .setDesc(lineWidthDesc)
      .addText((text) => {
        text.setValue(String(this.plugin.settings.exploreLineWidth)).onChange(async (raw) => {
          const value = parsePositive(raw);
          if (value === null) return;
          await this.plugin.updateSettings({ exploreLineWidth: value });
        });
      });

    new Setting(this.containerEl)
      .setName('全景视图树边线宽')
      .setDesc(lineWidthDesc)
      .addText((text) => {
        text.setValue(String(this.plugin.settings.panoramaLineWidth)).onChange(async (raw) => {
          const value = parsePositive(raw);
          if (value === null) return;
          await this.plugin.updateSettings({ panoramaLineWidth: value });
        });
      });

    new Setting(this.containerEl)
      .setName('跨文件引用线宽')
      .setDesc('「<=>」虚线连线的粗细（像素，正数即可）')
      .addText((text) => {
        text.setValue(String(this.plugin.settings.crossLineWidth)).onChange(async (raw) => {
          const value = parsePositive(raw);
          if (value === null) return;
          await this.plugin.updateSettings({ crossLineWidth: value });
        });
      });

    // ---------------------- 视觉：节点间距 ----------------------
    this.containerEl.createEl('h3', { text: '视觉 · 节点间距' });

    const gapDesc = '像素，正数即可';

    new Setting(this.containerEl)
      .setName('探索视图·子节点间距')
      .setDesc(`同一父节点下子节点之间的纵向距离（${gapDesc}）`)
      .addText((text) => {
        text.setValue(String(this.plugin.settings.exploreNodeGap)).onChange(async (raw) => {
          const value = parsePositive(raw);
          if (value === null) return;
          await this.plugin.updateSettings({ exploreNodeGap: value });
        });
      });

    new Setting(this.containerEl)
      .setName('探索视图·层级间距')
      .setDesc(`父子节点之间的横向距离（${gapDesc}）`)
      .addText((text) => {
        text.setValue(String(this.plugin.settings.exploreLevelGap)).onChange(async (raw) => {
          const value = parsePositive(raw);
          if (value === null) return;
          await this.plugin.updateSettings({ exploreLevelGap: value });
        });
      });

    new Setting(this.containerEl)
      .setName('全景视图·子节点间距')
      .setDesc(`同一父节点下子节点之间的纵向距离（${gapDesc}）`)
      .addText((text) => {
        text.setValue(String(this.plugin.settings.panoramaNodeGap)).onChange(async (raw) => {
          const value = parsePositive(raw);
          if (value === null) return;
          await this.plugin.updateSettings({ panoramaNodeGap: value });
        });
      });

    new Setting(this.containerEl)
      .setName('全景视图·层级间距')
      .setDesc(`父子节点之间的横向距离（${gapDesc}）`)
      .addText((text) => {
        text.setValue(String(this.plugin.settings.panoramaLevelGap)).onChange(async (raw) => {
          const value = parsePositive(raw);
          if (value === null) return;
          await this.plugin.updateSettings({ panoramaLevelGap: value });
        });
      });
  }
}
