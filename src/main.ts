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


  // 添加类型过滤面板切换命令
  orca.commands.registerCommand(`${pluginName}.toggleTypeFilters`, () => {
    if (pageDisplay) {
      pageDisplay.toggleTypeFilters();
      const status = pageDisplay.getTypeFiltersVisible() ? "显示" : "隐藏";
      orca.notify("info", `类型过滤面板已${status}`);
    }
  }, "切换类型过滤面板");

  // 添加全选类型过滤命令
  orca.commands.registerCommand(`${pluginName}.selectAllTypeFilters`, () => {
    if (pageDisplay) {
      pageDisplay.setAllTypeFilters(true);
      orca.notify("info", "已选择所有类型");
    }
  }, "全选所有类型");

  // 添加全不选类型过滤命令
  orca.commands.registerCommand(`${pluginName}.selectNoneTypeFilters`, () => {
    if (pageDisplay) {
      pageDisplay.setAllTypeFilters(false);
      orca.notify("info", "已取消选择所有类型");
    }
  }, "取消选择所有类型");

  // 设置插件设置模式
  await orca.plugins.setSettingsSchema(pluginName, {
    journalPageSupport: {
      label: "Journal页面支持",
      description: "启用Journal页面的块ID识别和显示功能",
      type: "boolean",
      defaultValue: true
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
