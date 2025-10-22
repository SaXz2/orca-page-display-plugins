import { setupL10N, t } from "./libs/l10n";
import zhCN from "./translations/zhCN";
import { PageDisplay } from "./PageDisplay";

let pluginName: string;
let pageDisplay: PageDisplay | null = null;

export async function load(_name: string) {
  console.log("PageDisplay Plugin: 开始加载插件", _name);
  
  pluginName = _name;

  setupL10N(orca.state.locale, { "zh-CN": zhCN });

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

  // 注册全局命令
  orca.commands.registerCommand(`${pluginName}.toggleIcons`, () => {
    if (pageDisplay) {
      pageDisplay.toggleIcons();
      const status = pageDisplay.getIconsEnabled() ? "显示" : "隐藏";
      orca.notify("info", `页面空间图标已${status}`);
    }
  }, "切换页面空间图标显示");

  orca.commands.registerCommand(`${pluginName}.toggleMultiLine`, () => {
    if (pageDisplay) {
      pageDisplay.toggleMultiLine();
      const status = pageDisplay.getMultiLineEnabled() ? "启用" : "禁用";
      orca.notify("info", `页面空间多行显示已${status}`);
    }
  }, "切换页面空间多行显示");

  orca.commands.registerCommand(`${pluginName}.toggleMultiColumn`, () => {
    if (pageDisplay) {
      pageDisplay.toggleMultiColumn();
      const status = pageDisplay.getMultiColumnEnabled() ? "启用" : "禁用";
      orca.notify("info", `页面空间多列显示已${status}`);
    }
  }, "切换页面空间多列显示");


  // 添加手动刷新命令（强制刷新并重新添加元素）
  orca.commands.registerCommand(`${pluginName}.refreshDisplay`, async () => {
    if (pageDisplay) {
      await pageDisplay.forceRefreshAndReinit();
      orca.notify("info", "页面空间显示已强制刷新并重新添加元素");
    }
  }, "刷新页面空间显示");

  console.log(`${pluginName} loaded.`);

  // 添加反链别名块查询切换命令
  orca.commands.registerCommand(`${pluginName}.toggleBackrefAliasQuery`, () => {
    if (pageDisplay) {
      pageDisplay.toggleBackrefAliasQuery();
      const status = pageDisplay.getBackrefAliasQueryEnabled() ? "启用" : "禁用";
      orca.notify("info", `反链别名块查询已${status}`);
    }
  }, "切换反链别名块查询");
}

export async function unload() {
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
}
