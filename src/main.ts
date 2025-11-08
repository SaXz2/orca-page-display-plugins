import { setupL10N, t } from "./libs/l10n";
import zhCN from "./translations/zhCN";
import { PageDisplay } from "./PageDisplay";

let pluginName: string;
let pageDisplay: PageDisplay | null = null;

export async function load(_name: string) {
  console.log("PageDisplay Plugin: 开始加载插件", _name);
  
  pluginName = _name;

  setupL10N(orca.state.locale, { "zh-CN": zhCN });

  // 注入CSS样式文件
  try {
    // 使用官方API注入CSS，参考orca-tune-theme插件的实现方式
    orca.themes.injectCSSResource(`${pluginName}/dist/styles.css`, pluginName)
    console.log(`${pluginName}: CSS样式文件注入成功`)
  } catch (error) {
    console.error(`${pluginName}: CSS样式文件注入失败:`, error)
  }

  // 创建PageDisplay实例
  console.log("PageDisplay Plugin: 创建PageDisplay实例");
  pageDisplay = new PageDisplay(pluginName);
  
  // 初始化PageDisplay
  console.log("PageDisplay Plugin: 初始化PageDisplay");
  await pageDisplay.init();
  
  console.log("PageDisplay Plugin: 插件加载完成");

  // 监听面板变化
  const { subscribe } = window.Valtio;
  let lastActivePanel = orca.state.activePanel;
  let lastRootBlock = (orca.state.panels as any)[orca.state.activePanel]?.rootBlock;
  let lastPanels = orca.state.panels;
  
  const unsubscribe = subscribe(orca.state, () => {
    // 监听关键状态变化
    const currentActivePanel = orca.state.activePanel;
    const currentRootBlock = (orca.state.panels as any)[currentActivePanel]?.rootBlock;
    const currentPanels = orca.state.panels;
    
    // 检查是否真的发生了变化
    const panelChanged = currentActivePanel !== lastActivePanel;
    const rootBlockChanged = currentRootBlock !== lastRootBlock;
    const panelsStructureChanged = currentPanels !== lastPanels;
    
    if (panelChanged || rootBlockChanged || panelsStructureChanged) {
      lastActivePanel = currentActivePanel;
      lastRootBlock = currentRootBlock;
      lastPanels = currentPanels;
      
      // 状态变化日志（可通过调试模式控制）
      if (pageDisplay?.getDebugMode()) {
        console.log(`PageDisplay: State changed - panel: ${panelChanged}, rootBlock: ${rootBlockChanged}, panels: ${panelsStructureChanged}`);
      }
      
      // 当面板或根块真正变化时更新显示
      if (pageDisplay) {
        pageDisplay.updateDisplay(); // 使用防抖的updateDisplay
      }
    }
  });

  // 存储取消订阅函数以便清理
  (window as any).__orcaPageDisplayUnsubscribe = unsubscribe;



  // 添加手动刷新命令（强制刷新并重新添加元素）
  orca.commands.registerCommand(`${pluginName}.refreshDisplay`, async () => {
    if (pageDisplay) {
      await pageDisplay.forceRefreshAndReinit();
      orca.notify("info", "页面空间显示已强制刷新并重新添加元素");
    }
  }, "刷新页面空间显示");

  console.log(`${pluginName} loaded.`);


  // 移除类型过滤相关的全局命令
// 不再需要切换类型过滤面板、全选所有类型、取消选择所有类型的命令
// 所有类型过滤功能都通过界面中的按钮来控制

  // 移除全局折叠状态命令，统一使用插件面板设置
  // 不再需要切换默认折叠状态、查看状态和调试命令
  // 所有设置都通过插件面板的"默认折叠状态"选项来控制

  // 设置插件设置模式
  await orca.plugins.setSettingsSchema(pluginName, {
    journalPageSupport: {
      label: "Journal页面支持",
      description: "启用Journal页面的块ID识别和显示功能",
      type: "boolean",
      defaultValue: true
    },
    defaultCollapsed: {
      label: "默认折叠状态",
      description: "新页面的页面空间默认是否折叠",
      type: "boolean",
      defaultValue: true
    },
    defaultGroupingMode: {
      label: "默认分组模式",
      description: "选择页面空间的默认分组方式",
      type: "singleChoice",
      defaultValue: "none",
      choices: [
        { value: "none", label: "不分组" },
        { value: "date", label: "按日期分组" }
      ]
    },
    defaultGroupingDateFormat: {
      label: "日期分组字段",
      description: "按日期分组时使用的日期字段",
      type: "singleChoice",
      defaultValue: "created",
      choices: [
        { value: "created", label: "创建日期" },
        { value: "modified", label: "修改日期" }
      ]
    },
    defaultDateGroupingType: {
      label: "日期分组类型",
      description: "按日期分组时的分组方式",
      type: "singleChoice",
      defaultValue: "period",
      choices: [
        { value: "period", label: "按时期分组" },
        { value: "daily", label: "按天分组" }
      ]
    }
  });

  // 监听设置变化
  const settingsUnsubscribe = subscribe(orca.state, () => {
    if (pageDisplay) {
      // 监听设置变化，立即同步到PageDisplay实例
      const settings = (orca.state.settings as any)[pluginName];
      if (settings) {
        if (typeof settings.journalPageSupport === 'boolean') {
          const currentValue = pageDisplay.getJournalPageSupport();
          if (currentValue !== settings.journalPageSupport) {
            console.log("PageDisplay: Journal page support setting changed:", settings.journalPageSupport);
            pageDisplay.setJournalPageSupport(settings.journalPageSupport);
            // 强制更新显示以应用新设置
            pageDisplay.forceUpdate();
          }
        }
        if (typeof settings.defaultCollapsed === 'boolean') {
          const currentValue = pageDisplay.getDefaultCollapsed();
          console.log("PageDisplay: 插件面板设置 - defaultCollapsed:", settings.defaultCollapsed, "当前值:", currentValue);
          if (currentValue !== settings.defaultCollapsed) {
            console.log("PageDisplay: 插件面板设置改变，从", currentValue, "变为", settings.defaultCollapsed);
            pageDisplay.setDefaultCollapsed(settings.defaultCollapsed);
            // 强制更新显示以应用新设置
            pageDisplay.forceUpdate();
          }
        }
        if (settings.defaultGroupingMode && ['none', 'document', 'date'].includes(settings.defaultGroupingMode)) {
          const currentConfig = pageDisplay.getGroupingConfig();
          if (currentConfig.mode !== settings.defaultGroupingMode) {
            console.log("PageDisplay: Default grouping mode setting changed:", settings.defaultGroupingMode);
            const newConfig = {
              ...currentConfig,
              mode: settings.defaultGroupingMode
            };
            pageDisplay.setGroupingConfig(newConfig);
          }
        }
        if (settings.defaultGroupingDateFormat && ['created', 'modified'].includes(settings.defaultGroupingDateFormat)) {
          const currentConfig = pageDisplay.getGroupingConfig();
          if (currentConfig.dateFormat !== settings.defaultGroupingDateFormat) {
            console.log("PageDisplay: Default grouping date format setting changed:", settings.defaultGroupingDateFormat);
            const newConfig = {
              ...currentConfig,
              dateFormat: settings.defaultGroupingDateFormat
            };
            pageDisplay.setGroupingConfig(newConfig);
          }
        }
        if (settings.defaultDateGroupingType && ['period', 'daily'].includes(settings.defaultDateGroupingType)) {
          const currentConfig = pageDisplay.getGroupingConfig();
          if (currentConfig.dateGroupingType !== settings.defaultDateGroupingType) {
            console.log("PageDisplay: Default date grouping type setting changed:", settings.defaultDateGroupingType);
            const newConfig = {
              ...currentConfig,
              dateGroupingType: settings.defaultDateGroupingType
            };
            pageDisplay.setGroupingConfig(newConfig);
          }
        }
      }
    }
  });

  // 存储设置监听器以便清理
  (window as any).__orcaPageDisplaySettingsUnsubscribe = settingsUnsubscribe;

}

export async function unload() {
  // 移除CSS样式文件
  try {
    orca.themes.removeCSSResources(pluginName)
    console.log(`${pluginName}: CSS样式文件移除成功`)
  } catch (error) {
    console.error(`${pluginName}: CSS样式文件移除失败:`, error)
  }

  // 清理PageDisplay
  if (pageDisplay) {
    pageDisplay.destroy();
    pageDisplay = null;
  }

  // 取消订阅
  if ((window as any).__orcaPageDisplayUnsubscribe) {
    (window as any).__orcaPageDisplayUnsubscribe();
    delete (window as any).__orcaPageDisplayUnsubscribe;
  }

  // 取消设置监听器
  if ((window as any).__orcaPageDisplaySettingsUnsubscribe) {
    (window as any).__orcaPageDisplaySettingsUnsubscribe();
    delete (window as any).__orcaPageDisplaySettingsUnsubscribe;
  }
}
