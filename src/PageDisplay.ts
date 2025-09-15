import type { Block, DbId, BlockRef } from "./orca.d.ts"
import { t } from "./libs/l10n"

interface PageDisplayItem {
  id: DbId
  text: string
  aliases: string[]
  isPage: boolean
  parentBlock?: Block
  _hide?: boolean
  _icon?: string
  itemType: 'tag' | 'referenced' | 'referencing-alias' | 'child-referenced-alias'
  // 搜索相关字段
  searchableText?: string  // 包含所有可搜索文本
  searchableData?: {
    text: string[]
    properties: string[]
    blockrefs: string[]
    tags: string[]
  }
}

export class PageDisplay {
  private containers: Map<string, HTMLElement> = new Map() // 支持多面板，key为面板标识
  private queryListToggleButtons: Map<string, HTMLElement> = new Map() // 支持多面板的按钮
  private pluginName: string
  private observer: MutationObserver | null = null
  private showIcons: boolean = true // 控制是否显示图标
  private isCollapsed: boolean = false // 控制折叠状态，默认展开
  private multiLine: boolean = false // 控制是否多行显示
  private multiColumn: boolean = false // 控制是否多列显示
  private lastRootBlockId: DbId | null = null // 缓存上次的根块ID
  private queryListHidden: boolean = false // 控制查询列表是否隐藏
  private updateTimeout: number | null = null // 防抖定时器
  private periodicCheckInterval: number | null = null // 定期检查定时器
  private retryCount: number = 0 // 重试计数
  private maxRetries: number = 3 // 最大重试次数
  private isInitialized: boolean = false // 初始化状态
  private debugMode: boolean = false // 调试模式
  private apiCache: Map<string, { data: any; timestamp: number }> = new Map() // API缓存
  private cacheTimeout: number = 30000 // 缓存超时时间（30秒）

  constructor(pluginName: string) {
    this.pluginName = pluginName
    this.loadSettings()
    // 临时开启调试模式用于诊断子块引用问题
    this.debugMode = true
    
    // 动态加载CSS文件
    this.loadCSS()
  }

  // 动态加载CSS文件
  private loadCSS() {
    // 检查是否已经加载过CSS
    if (document.querySelector('#page-display-styles')) {
      return
    }
 
    // 不再需要外部CSS文件，所有样式都由JavaScript处理
    console.log('PageDisplay: All styles handled by JavaScript - no external CSS needed')
  }
  
  // 应用样式类到元素
  private applyStyles(element: HTMLElement, className: string) {
    // 移除所有可能的样式类
    const styleClasses = [
      'page-display-container',
      'page-display-title-container',
      'page-display-left-content',
      'page-display-arrow',
      'page-display-title',
      'page-display-count',
      'page-display-search-icon',
      'page-display-search-container',
      'page-display-search-input',
      'page-display-list',
      'page-display-item',
      'page-display-item-icon',
      'page-display-item-text',
      'page-display-query-list-toggle'
    ]
    
    styleClasses.forEach(cls => element.classList.remove(cls))
    
    // 添加新的样式类
    element.classList.add(className)
    
    // 应用对应的样式
    this.applyClassStyles(element, className)
  }
  
  // 根据类名应用具体样式 - 简约风格
  private applyClassStyles(element: HTMLElement, className: string) {
    const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    
    // 统一的颜色规范 - 优化暗色模式
    const colors = {
      text: isDarkMode ? '#e8e8e8' : '#333333',
      textSecondary: isDarkMode ? '#b8b8b8' : '#666666',
      textMuted: isDarkMode ? '#888888' : '#999999',
      border: isDarkMode ? '#3a3a3a' : '#e0e0e0',
      background: isDarkMode ? '#1e1e1e' : '#ffffff',
      backgroundHover: isDarkMode ? '#2d2d2d' : '#f5f5f5',
      backgroundSubtle: isDarkMode ? '#252525' : '#fafafa'
    }
    
    switch (className) {
      case 'page-display-container':
        element.style.cssText = `
          margin: 12px 0;
          padding: 16px;
          background: transparent;
          border: none;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 14px;
          line-height: 1.5;
          color: ${colors.text};
        `
        break
        
      case 'page-display-title-container':
        element.style.cssText = `
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
          cursor: pointer;
        `
        break
        
      case 'page-display-left-content':
        element.style.cssText = `
          display: flex;
          align-items: center;
        `
        break
        
      case 'page-display-arrow':
        element.style.cssText = `
          margin-right: 6px;
          font-size: 10px;
          color: ${colors.textMuted};
          transition: transform 0.2s ease;
          transform: rotate(0deg);
          width: 12px;
          height: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        `
        break
        
      case 'page-display-title':
        element.style.cssText = `
          font-weight: 500;
          color: ${colors.text};
          font-size: 15px;
        `
        break
        
      case 'page-display-count':
        element.style.cssText = `
          margin-left: 8px;
          font-size: 12px;
          color: ${colors.textMuted};
          font-weight: normal;
        `
        break
        
      case 'page-display-search-icon':
        element.style.cssText = `
          font-size: 14px;
          color: ${colors.textMuted};
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          transition: all 0.2s ease;
        `
        
        // 添加悬停效果
        element.addEventListener('mouseenter', () => {
          element.style.background = colors.backgroundHover
          element.style.color = colors.text
        })
        
        element.addEventListener('mouseleave', () => {
          element.style.background = 'transparent'
          element.style.color = colors.textMuted
        })
        break
        
      case 'page-display-search-container':
        element.style.cssText = `
          margin-bottom: 12px;
          display: none;
          opacity: 0;
          transition: opacity 0.2s ease;
        `
        break
        
      case 'page-display-search-input':
        element.style.cssText = `
          width: 100%;
          padding: 8px 12px;
          border: 1px solid ${colors.border};
          border-radius: 6px;
          font-size: 14px;
          outline: none;
          background: ${colors.background};
          color: ${colors.text};
          box-sizing: border-box;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        `
        
        // 添加焦点样式
        element.addEventListener('focus', () => {
          element.style.borderColor = isDarkMode ? '#4a9eff' : '#007bff'
          element.style.boxShadow = isDarkMode ? '0 0 0 2px rgba(74, 158, 255, 0.2)' : '0 0 0 2px rgba(0, 123, 255, 0.25)'
        })
        
        element.addEventListener('blur', () => {
          element.style.borderColor = colors.border
          element.style.boxShadow = 'none'
        })
        break
        
      case 'page-display-list':
        element.style.cssText = `
          list-style: none;
          padding: 0;
          margin: 0;
          max-height: 300px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: ${isDarkMode ? '#4a4a4a' : '#c0c0c0'} transparent;
        `
        
        // 添加 WebKit 滚动条样式
        const scrollbarStyle = document.createElement('style')
        scrollbarStyle.textContent = `
          .page-display-list::-webkit-scrollbar {
            width: 6px;
          }
          .page-display-list::-webkit-scrollbar-track {
            background: transparent;
            border-radius: 3px;
          }
          .page-display-list::-webkit-scrollbar-thumb {
            background: ${isDarkMode ? '#4a4a4a' : '#c0c0c0'};
            border-radius: 3px;
            transition: background 0.2s ease;
          }
          .page-display-list::-webkit-scrollbar-thumb:hover {
            background: ${isDarkMode ? '#5a5a5a' : '#a0a0a0'};
          }
        `
        document.head.appendChild(scrollbarStyle)
        break
        
      case 'page-display-item':
        element.style.cssText = `
          position: relative;
          padding: 4px 0 4px 20px;
          cursor: pointer;
          color: ${colors.text};
          font-size: 14px;
          line-height: 1.5;
          transition: background-color 0.2s ease;
          display: flex;
          align-items: center;
        `
        break
        
      case 'page-display-item-icon':
        element.style.cssText = `
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          font-size: 14px;
          color: ${colors.textMuted};
          width: 16px;
          height: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
        `
        break
        
      case 'page-display-item-text':
        element.style.cssText = `
          color: ${colors.text};
          font-weight: normal;
          line-height: 1.5;
          flex: 1;
        `
        break
        
      case 'page-display-query-list-toggle':
        element.style.cssText = `
          width: 28px;
          height: 28px;
          background: ${colors.background};
          border: 1px solid ${colors.border};
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          margin-left: 8px;
          opacity: 0;
          transition: all 0.2s ease;
          flex-shrink: 0;
        `
        
        // 添加悬停效果
        element.addEventListener('mouseenter', () => {
          element.style.opacity = '1'
          element.style.background = colors.backgroundHover
          element.style.borderColor = isDarkMode ? '#4a9eff' : '#007bff'
          element.style.transform = 'scale(1.05)'
        })
        
        element.addEventListener('mouseleave', () => {
          element.style.opacity = '0'
          element.style.background = colors.background
          element.style.borderColor = colors.border
          element.style.transform = 'scale(1)'
        })
        break
    }
  }
  
  // 应用特殊样式（如 itemType 相关的样式） - 简约风格
  private applyItemTypeStyles(element: HTMLElement, itemType: string) {
    // 移除所有彩色竖线，保持简约风格
    // 只保留基本的缩进区分
    switch (itemType) {
      case 'parent':
      case 'referenced':
      case 'referencing':
      case 'child-referenced-alias':
        // 保持原有的 padding-left，不添加额外样式
        break
    }
  }
  
  // 应用多列样式 - 简约风格
  private applyMultiColumnStyles(element: HTMLElement) {
    element.style.display = 'grid'
    element.style.gridTemplateColumns = 'repeat(auto-fit, minmax(180px, 1fr))'
    element.style.gap = '6px'
  }
  
  // 应用单行/多行样式
  private applyLineStyles(element: HTMLElement, multiLine: boolean) {
    if (multiLine) {
      element.style.whiteSpace = 'normal'
      element.style.wordWrap = 'break-word'
    } else {
      element.style.whiteSpace = 'nowrap'
      element.style.overflow = 'hidden'
      element.style.textOverflow = 'ellipsis'
    }
  }

  // 切换图标显示状态
  public toggleIcons() {
    this.showIcons = !this.showIcons
    this.log("PageDisplay: Icons display toggled to", this.showIcons)
    
    // 保存设置
    this.saveSettings()
    
    // 如果当前面板有显示，重新创建以应用新的图标设置
    const panelId = this.getCurrentPanelId()
    const container = this.containers.get(panelId)
    if (container) {
      this.updateDisplay()
    }
  }

  // 获取图标显示状态
  public getIconsEnabled(): boolean {
    return this.showIcons
  }

  // 切换多行显示状态
  public toggleMultiLine() {
    this.multiLine = !this.multiLine
    this.log("PageDisplay: Multi-line display toggled to", this.multiLine)
    
    // 保存设置
    this.saveSettings()
    
    // 如果当前面板有显示，重新创建以应用新的多行设置
    const panelId = this.getCurrentPanelId()
    const container = this.containers.get(panelId)
    if (container) {
      this.updateDisplay()
    }
  }

  // 获取多行显示状态
  public getMultiLineEnabled(): boolean {
    return this.multiLine
  }

  // 切换多列显示状态
  public toggleMultiColumn() {
    this.multiColumn = !this.multiColumn
    this.log("PageDisplay: Multi-column display toggled to", this.multiColumn)
    
    // 保存设置
    this.saveSettings()
    
    // 如果当前面板有显示，重新创建以应用新的多列设置
    const panelId = this.getCurrentPanelId()
    const container = this.containers.get(panelId)
    if (container) {
      this.updateDisplay()
    }
  }
  

  // 获取多列显示状态
  public getMultiColumnEnabled(): boolean {
    return this.multiColumn
  }
  
  
  // 日志工具方法（仅在调试模式下输出）
  private log(...args: any[]) {
    if (this.debugMode) {
      console.log(...args)
    }
  }
  
  // 错误日志（总是输出）
  private logError(...args: any[]) {
    console.error(...args)
  }
  
  // 警告日志（总是输出）
  private logWarn(...args: any[]) {
    console.warn(...args)
  }
  
  // 获取显示状态
  public getDisplayStatus(): {
    isInitialized: boolean
    isDisplaying: boolean
    shouldDisplay: boolean
    containerExists: boolean
    hasParent: boolean
  } {
    const panelId = this.getCurrentPanelId()
    const container = this.containers.get(panelId)
    return {
      isInitialized: this.isInitialized,
      isDisplaying: this.isDisplaying(),
      shouldDisplay: this.shouldDisplay(),
      containerExists: container !== null,
      hasParent: container?.parentNode !== null
    }
  }
  
  // 切换调试模式
  public toggleDebugMode() {
    this.debugMode = !this.debugMode
    this.log("PageDisplay: Debug mode toggled to", this.debugMode)
  }
  
  // 获取调试模式状态
  public getDebugMode(): boolean {
    return this.debugMode
  }
  
  // 获取当前面板标识
  private getCurrentPanelId(): string {
    const activePanel = document.querySelector('.orca-panel.active')
    if (activePanel) {
      // 尝试获取面板的唯一标识
      const panelId = activePanel.getAttribute('data-panel-id') || 
                     activePanel.getAttribute('id') || 
                     activePanel.className
      return panelId || 'default'
    }
    return 'default'
  }
  

  // 加载设置
  private async loadSettings() {
    try {
      const settings = await orca.plugins.getData(this.pluginName, "page-display-settings")
      if (settings) {
        const parsedSettings = JSON.parse(settings)
        this.showIcons = parsedSettings.showIcons ?? true
        this.multiLine = parsedSettings.multiLine ?? false
        this.multiColumn = parsedSettings.multiColumn ?? false
        this.queryListHidden = parsedSettings.queryListHidden ?? false
        console.log("PageDisplay: Settings loaded", { showIcons: this.showIcons, multiLine: this.multiLine, multiColumn: this.multiColumn, queryListHidden: this.queryListHidden })
      }
    } catch (error) {
      console.error("PageDisplay: Failed to load settings, using defaults:", error)
      // 使用默认值，不影响功能
    }
  }

  // 保存设置
  private async saveSettings() {
    try {
      const settings = {
        showIcons: this.showIcons,
        multiLine: this.multiLine,
        multiColumn: this.multiColumn,
        queryListHidden: this.queryListHidden
      }
      await orca.plugins.setData(this.pluginName, "page-display-settings", JSON.stringify(settings))
      console.log("PageDisplay: Settings saved", settings)
    } catch (error) {
      console.error("PageDisplay: Failed to save settings:", error)
      // 保存失败不影响功能，只记录错误
    }
  }

  // 去重项目，保持唯一性
  private deduplicateItems(items: PageDisplayItem[]): PageDisplayItem[] {
    const seen = new Set<string>()
    const uniqueItems: PageDisplayItem[] = []
    
    for (const item of items) {
      // 创建唯一标识：优先使用ID，如果ID相同则使用文本内容
      const key = `${item.id}-${item.text}`
      
      if (!seen.has(key)) {
        seen.add(key)
        uniqueItems.push(item)
      } else {
        console.log("PageDisplay: Duplicate item removed", { id: item.id, text: item.text })
      }
    }
    
    return uniqueItems
  }

  // 初始化PageDisplay
  public init() {
    console.log("PageDisplay: 开始初始化");
    this.observeEditorChanges()
    console.log("PageDisplay: 已启动编辑器变化监听");
    this.startPeriodicCheck()
    console.log("PageDisplay: 已启动定期检查");
    this.updateDisplay()
    console.log("PageDisplay: 已触发显示更新");
    this.isInitialized = true
    console.log("PageDisplay: 初始化完成");
  }

  // 清理资源
  public destroy() {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
    
    // 清理定时器
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout)
      this.updateTimeout = null
    }
    
    if (this.periodicCheckInterval) {
      clearInterval(this.periodicCheckInterval)
      this.periodicCheckInterval = null
    }
    
    this.removeDisplay()
    this.isInitialized = false
  }

  // 监听编辑器变化
  private observeEditorChanges() {
    // 使用MutationObserver监听页面切换
    this.observer = new MutationObserver((mutations) => {
      // 检查是否有页面切换相关的变化
      const hasPageSwitch = mutations.some(mutation => {
        if (mutation.type === 'childList') {
        const nodes = [...mutation.addedNodes, ...mutation.removedNodes]
          return nodes.some(node => {
            if (node.nodeType !== Node.ELEMENT_NODE) return false
          
          const element = node as Element
          
            // 检查是否是页面切换相关的元素
            return this.isPageSwitchElement(element)
          })
        }
        
        if (mutation.type === 'attributes') {
          // 监听活动面板的变化
          const target = mutation.target as Element
          if (target.matches && target.matches('.orca-panel.active')) {
            return true
          }
          // 监听面板内容的变化
          if (target.closest && target.closest('#main > div > div.orca-panel.active > div:nth-child(3)')) {
            return true
          }
        }
        
        return false
      })
      
      if (hasPageSwitch) {
        this.log("PageDisplay: Page switch detected, updating display immediately")
        this.updateDisplay() // 立即更新显示
      }
    })
    
    // 尝试监听指定的页面切换元素
    const pageSwitchElement = document.querySelector("#main > div > div.orca-panel.active > div:nth-child(3)")
    if (pageSwitchElement) {
      this.log("PageDisplay: Observing page switch element")
      this.observer.observe(pageSwitchElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'id']
      })
    } else {
      this.log("PageDisplay: Page switch element not found, falling back to document.body")
      // 如果找不到指定元素，回退到监听整个文档
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
        attributes: true,
        attributeFilter: ['class', 'id']
      })
    }
    
    // 启动定期检查，确保页面切换时能及时更新
    this.startPageSwitchCheck()
  }
  
  // 启动页面切换检查
  private startPageSwitchCheck() {
    // 每500ms检查一次页面切换，提高响应速度
    setInterval(() => {
      const pageSwitchElement = document.querySelector("#main > div > div.orca-panel.active > div:nth-child(3)")
      if (pageSwitchElement && this.shouldDisplay()) {
        // 检查是否需要更新显示
        const currentRootBlockId = this.getCurrentRootBlockId()
        if (currentRootBlockId !== this.lastRootBlockId) {
          this.log("PageDisplay: Page switch detected via periodic check")
          this.updateDisplay()
        }
      }
    }, 500)
  }
  
  // 检查是否为页面切换相关元素
  private isPageSwitchElement(element: Element): boolean {
    // 检查元素本身是否是页面切换相关的
    if (element.classList?.contains('orca-panel') ||
        element.classList?.contains('orca-block-editor-none-editable') ||
        element.classList?.contains('orca-block-editor') ||
        element.classList?.contains('block-editor') ||
        element.classList?.contains('editor-container')) {
      return true
    }
    
    // 检查是否在页面切换区域内
    if (element.closest && element.closest('#main > div > div.orca-panel.active > div:nth-child(3)')) {
      return true
    }
    
    // 检查父元素
    let parent = element.parentElement
    while (parent && parent !== document.body) {
      if (parent.classList?.contains('orca-panel') ||
          parent.classList?.contains('orca-block-editor-none-editable') ||
          parent.classList?.contains('orca-block-editor') ||
          parent.classList?.contains('block-editor') ||
          parent.classList?.contains('editor-container')) {
        return true
      }
      parent = parent.parentElement
    }
    
    return false
  }
  
  // 检查是否为编辑器相关元素
  private isEditorRelatedElement(element: Element): boolean {
    // 检查元素本身
    if (element.classList?.contains('orca-block-editor-none-editable') ||
        element.classList?.contains('orca-block-editor-placeholder') ||
        element.classList?.contains('block-editor')) {
      return true
    }
    
    // 检查子元素
    if (element.querySelector?.('.orca-block-editor-none-editable') ||
        element.querySelector?.('.orca-block-editor-placeholder') ||
        element.querySelector?.('[class*="block-editor"]')) {
      return true
    }
    
    return false
  }

  // 获取当前激活面板的根块ID
  private getCurrentRootBlockId(): DbId | null {
    try {
      // 直接访问orca.state，不使用useSnapshot
      const { activePanel, panels } = orca.state
      this.log("PageDisplay: getCurrentRootBlockId - activePanel:", activePanel, "panels:", panels)
      
      // 查找当前激活的面板
      const findPanel = (panel: any): any => {
        this.log("PageDisplay: Checking panel:", panel.id, "matches activePanel:", activePanel)
        if (panel.id === activePanel) {
          this.log("PageDisplay: Found matching panel:", panel)
          return panel
        }
        if (panel.children) {
          for (const child of panel.children) {
            const found = findPanel(child)
            if (found) return found
          }
        }
        return null
      }
      
      const currentPanel = findPanel(panels)
      this.log("PageDisplay: currentPanel found:", currentPanel)
      
      if (currentPanel && currentPanel.viewArgs && currentPanel.viewArgs.blockId) {
        const blockId = currentPanel.viewArgs.blockId
        this.log("PageDisplay: Found blockId:", blockId)
        return blockId
      }
      
      this.log("PageDisplay: No blockId found in currentPanel")
      return null
    } catch (error) {
      console.error("Failed to get current root block ID:", error)
      return null
    }
  }

  // 获取子标签块
  private async getChildrenTagBlocks(blockId: DbId): Promise<Block[]> {
    try {
      // 使用 get-children-tag-blocks API 获取完整的块信息
      const childrenTagBlocks = await this.cachedApiCall("get-children-tag-blocks", blockId)
      return childrenTagBlocks || []
    } catch (error) {
      this.logError("Failed to get children tag blocks:", error)
      return []
    }
  }


  // 获取引用当前块的别名块（检查根块是否为别名块）
  private async getReferencingAliasBlocks(blockId: DbId): Promise<Block[]> {
    try {
      // 获取当前块的信息
      const currentBlock = await this.getBlockInfo(blockId)
      if (!currentBlock || !currentBlock.backRefs || currentBlock.backRefs.length === 0) {
        this.log("PageDisplay: No backRefs found for block", blockId)
        return []
      }

      // 获取所有引用当前块的块ID
      const referencingBlockIds = currentBlock.backRefs.map(backRef => backRef.from)
      this.log("PageDisplay: referencingBlockIds =", referencingBlockIds)
      
      if (referencingBlockIds.length === 0) return []
      
      // 批量获取引用块的详细信息
      const referencingBlocks = await this.cachedApiCall("get-blocks", referencingBlockIds)
      if (!referencingBlocks) return []

      // 过滤出根块是别名块的引用
      const aliasBlocks: Block[] = []
      for (const block of referencingBlocks) {
        this.log("PageDisplay: checking referencing block", block.id)
        
        // 检查是否有父块
        if (block.parent) {
          this.log("PageDisplay: block has parent, checking root block", block.parent)
          
          // 获取根块信息
          const rootBlock = await this.getBlockInfo(block.parent)
          if (rootBlock && rootBlock.aliases && rootBlock.aliases.length > 0) {
            this.log("PageDisplay: root block is alias block", rootBlock.id, rootBlock.aliases)
            aliasBlocks.push(rootBlock)
          } else {
            this.log("PageDisplay: root block is not alias block", rootBlock?.id)
          }
        } else {
          // 如果没有父块，检查当前块本身是否是别名块
          if (block.aliases && block.aliases.length > 0) {
            this.log("PageDisplay: block itself is alias block", block.id, block.aliases)
            aliasBlocks.push(block)
          }
        }
      }
      
      return aliasBlocks
    } catch (error) {
      this.logError("Failed to get referencing alias blocks:", error)
      return []
    }
  }

  // 获取子块中引用的块（当当前块不是别名块时）
  private async getChildReferencedAliasBlocks(blockId: DbId, tagBlockIds: DbId[] = []): Promise<Block[]> {
    try {
      // 获取当前块的信息
      const currentBlock = await this.getBlockInfo(blockId)
      if (!currentBlock) {
        this.log("PageDisplay: Current block not found for child referenced blocks")
        return []
      }

      // 检查当前块是否为别名块
      const isCurrentBlockAlias = currentBlock.aliases && currentBlock.aliases.length > 0
      this.log("PageDisplay: Current block is alias:", isCurrentBlockAlias, "aliases:", currentBlock.aliases)
      
      // 注释：子块引用逻辑应该始终执行，不依赖于当前块是否为别名块
      // 这个逻辑用于显示当前块的子块中引用的其他块
      this.log("PageDisplay: 执行子块引用逻辑，当前块别名状态:", isCurrentBlockAlias)

      // 检查当前块是否有子块
      if (!currentBlock.children || currentBlock.children.length === 0) {
        this.log("PageDisplay: No children found for block", blockId)
        return []
      }

      this.log("PageDisplay: Found", currentBlock.children.length, "children for block", blockId)

      // 获取所有子块的详细信息
      const childBlocks = await this.cachedApiCall("get-blocks", currentBlock.children)
      if (!childBlocks) return []

      // 收集所有子块引用的块ID
      const allReferencedBlockIds: DbId[] = []
      for (const childBlock of childBlocks) {
        if (childBlock.refs && childBlock.refs.length > 0) {
          const childReferencedIds = childBlock.refs.map((ref: any) => ref.to)
          allReferencedBlockIds.push(...childReferencedIds)
          this.log("PageDisplay: Child block", childBlock.id, "references", childReferencedIds)
        }
      }

      if (allReferencedBlockIds.length === 0) {
        this.log("PageDisplay: No referenced blocks found in children")
        return []
      }

      // 去重
      const uniqueReferencedIds = [...new Set(allReferencedBlockIds)]
      this.log("PageDisplay: Unique referenced block IDs from children:", uniqueReferencedIds)

      // 批量获取被引用块的详细信息
      const referencedBlocks = await this.cachedApiCall("get-blocks", uniqueReferencedIds)
      if (!referencedBlocks) return []

      // 过滤出被引用的块，排除标签块
      const childReferencedBlocks: Block[] = []
      for (const block of referencedBlocks) {
        // 检查是否为标签块
        const isTagBlock = tagBlockIds.includes(block.id)
        if (!isTagBlock) {
          this.log("PageDisplay: Found block referenced by children", block.id, "aliases:", block.aliases, "text:", block.text)
          childReferencedBlocks.push(block)
        } else {
          this.log("PageDisplay: Skipping tag block from child references", block.id, block.aliases)
        }
      }

      this.log("PageDisplay: Found", childReferencedBlocks.length, "blocks referenced by children")
      return childReferencedBlocks
    } catch (error) {
      this.logError("Failed to get child referenced alias blocks:", error)
      return []
    }
  }
  

  // 获取被当前块引用的块（当前块引用了哪些块）
  private async getReferencedBlocks(blockId: DbId): Promise<{ blocks: Block[], tagBlockIds: DbId[], inlineRefIds: DbId[] }> {
    try {
      this.log("PageDisplay: getReferencedBlocks called for blockId:", blockId)
      
      // 获取当前块的信息
      const currentBlock = await this.getBlockInfo(blockId)
      if (!currentBlock) {
        this.log("PageDisplay: Current block not found for referenced blocks")
        return { blocks: [], tagBlockIds: [], inlineRefIds: [] }
      }

      this.log("PageDisplay: Current block found:", {
        id: currentBlock.id,
        text: currentBlock.text,
        refs: currentBlock.refs?.length || 0,
        refsDetails: currentBlock.refs
      })

      // 1. 从当前块文本中解析标签（如 #💬番剧, #⭐五星, #我的标签）
      this.log("PageDisplay: 从当前块文本中解析标签")
      // 支持带空格的标签，匹配 #标签 格式，直到遇到逗号或行尾
      const tagMatches = (currentBlock.text || "").match(/#[^,\n]+/g) || []
      this.log("PageDisplay: 找到的标签文本:", tagMatches)
      
      // 提取标签块ID（通过别名查找）
      const tagBlockIds: DbId[] = []
      for (const tagText of tagMatches) {
        const aliasName = tagText.substring(1) // 去掉 # 符号
        this.log("PageDisplay: 处理标签:", tagText, "别名:", aliasName)
        
        try {
          const tagResult = await this.cachedApiCall("get-blockid-by-alias", aliasName)
          this.log("PageDisplay: get-blockid-by-alias 结果:", tagResult)
          
          if (tagResult && tagResult.id) {
            tagBlockIds.push(tagResult.id)
            this.log("PageDisplay: 找到标签块ID:", tagText, "->", tagResult.id)
          } else {
            this.log("PageDisplay: 未找到标签块ID:", tagText, "别名:", aliasName)
            
            // 尝试去掉空格后再次查找
            const trimmedAlias = aliasName.trim()
            if (trimmedAlias !== aliasName) {
              this.log("PageDisplay: 尝试去掉空格后的别名:", trimmedAlias)
              const trimmedResult = await this.cachedApiCall("get-blockid-by-alias", trimmedAlias)
              if (trimmedResult && trimmedResult.id) {
                tagBlockIds.push(trimmedResult.id)
                this.log("PageDisplay: 找到标签块ID (去掉空格):", tagText, "->", trimmedResult.id)
              } else {
                this.log("PageDisplay: 去掉空格后仍未找到标签块ID:", tagText)
              }
            }
          }
        } catch (error) {
          this.log("PageDisplay: 查找标签块ID失败:", tagText, error)
        }
      }
      
      this.log("PageDisplay: 最终标签块ID列表:", tagBlockIds)

      // 2. 从当前块的引用中获取被引用的块ID
      const allReferencedBlockIds: DbId[] = []
      const inlineRefIds: DbId[] = []
      
      // 检查当前块是否有引用其他块
      if (currentBlock.refs && currentBlock.refs.length > 0) {
        this.log("PageDisplay: 当前块的所有引用详情:", currentBlock.refs)
        
        // 先获取所有被引用块的详细信息
        this.log("PageDisplay: 获取所有被引用块详细信息，ID列表:", allReferencedBlockIds)
        const referencedBlocks = await this.cachedApiCall("get-blocks", allReferencedBlockIds)
        if (!referencedBlocks) {
          this.log("PageDisplay: get-blocks API returned null/undefined")
          return { blocks: [], tagBlockIds: [], inlineRefIds: [] }
        }
        
        this.log("PageDisplay: 找到被引用块数量:", referencedBlocks.length, "块:", referencedBlocks)
        
        // 分别处理不同类型的引用
        const inlineRefs: BlockRef[] = []
        const propertyRefs: BlockRef[] = []
        
        for (const ref of currentBlock.refs) {
          this.log("PageDisplay: 引用详情 - ID:", ref.id, "from:", ref.from, "to:", ref.to, "type:", ref.type, "alias:", ref.alias, "data:", ref.data)
          
          // 获取被引用块的信息
          const referencedBlock = referencedBlocks.find((block: any) => block.id === ref.to)
          const isReferencedBlockAlias = referencedBlock && referencedBlock.aliases && referencedBlock.aliases.length > 0
          
          this.log("PageDisplay: 被引用块信息 - ID:", ref.to, "是别名块:", isReferencedBlockAlias, "别名:", referencedBlock?.aliases)
          
          let isInlineRef = false
          
          // 基于DOM结构识别内联引用：data-type="r" 对应数字值
          // 根据DOM结构，内联引用的type可能是特定数字值
          if (ref.type === 0 || ref.type === 1) {
            isInlineRef = true
            this.log("PageDisplay: 通过 type 数字值识别为内联引用:", ref.type)
          }
          // 明确识别属性引用：有 data 属性且不是内联引用
          else if (ref.data && ref.data.length > 0) {
            isInlineRef = false
            this.log("PageDisplay: 通过 data 识别为属性引用:", ref.data)
          }
          // 明确识别内联引用：有 alias 属性
          else if (ref.alias) {
            isInlineRef = true
            this.log("PageDisplay: 通过 alias 识别为内联引用:", ref.alias)
          }
          // 明确识别内联引用：在标签块ID中
          else if (tagBlockIds.includes(ref.to)) {
            isInlineRef = true
            this.log("PageDisplay: 通过标签块ID识别为内联引用")
          }
          // 对于非别名块：解析 content 查找 trv/trva 片段
          else if (!isReferencedBlockAlias && referencedBlock) {
            this.log("PageDisplay: 解析非别名块的 content 查找内联引用")
            const hasInlineRefInContent = this.checkInlineRefInContent(referencedBlock, ref.to)
            if (hasInlineRefInContent) {
              isInlineRef = true
              this.log("PageDisplay: 通过 content 解析识别为内联引用")
            } else {
              isInlineRef = false
              this.log("PageDisplay: content 中未找到内联引用，识别为属性引用")
            }
          }
          // 其他情况：根据 type 值判断
          else if (ref.type !== undefined && ref.type > 0) {
            isInlineRef = false
            this.log("PageDisplay: 通过 type 识别为属性引用:", ref.type)
          }
          // 默认情况：假设是内联引用（因为大多数引用都是内联的）
          else {
            isInlineRef = true
            this.log("PageDisplay: 默认识别为内联引用")
          }
          
          if (isInlineRef) {
            inlineRefs.push(ref)
            inlineRefIds.push(ref.to)
            this.log("PageDisplay: 最终识别为内联引用:", ref)
          } else {
            propertyRefs.push(ref)
            this.log("PageDisplay: 最终识别为属性引用:", ref)
          }
        }
        
        this.log("PageDisplay: 内联引用数量:", inlineRefs.length)
        this.log("PageDisplay: 属性引用数量:", propertyRefs.length)
        this.log("PageDisplay: 内联引用块ID:", inlineRefIds)
        
        // 将所有引用都加入
        allReferencedBlockIds.push(...currentBlock.refs.map(ref => ref.to))
        this.log("PageDisplay: 所有引用块ID:", allReferencedBlockIds)
      } else {
        this.log("PageDisplay: No refs found in current block")
        return { blocks: [], tagBlockIds: [], inlineRefIds: [] }
      }
      
      // 3. 获取所有被引用块的详细信息（包括标签块和属性引用块）
      this.log("PageDisplay: 获取所有被引用块详细信息，ID列表:", allReferencedBlockIds)
      const referencedBlocks = await this.cachedApiCall("get-blocks", allReferencedBlockIds)
      if (!referencedBlocks) {
        this.log("PageDisplay: get-blocks API returned null/undefined")
        return { blocks: [], tagBlockIds: [], inlineRefIds: [] }
      }

      this.log("PageDisplay: 找到被引用块数量:", referencedBlocks.length, "块:", referencedBlocks)
      return { blocks: referencedBlocks, tagBlockIds, inlineRefIds }
    } catch (error) {
      this.logError("Failed to get referenced blocks:", error)
      return { blocks: [], tagBlockIds: [], inlineRefIds: [] }
    }
  }

  
  // 带缓存的API调用
  private async cachedApiCall(apiType: string, ...args: any[]): Promise<any> {
    const cacheKey = `${apiType}:${JSON.stringify(args)}`
    const now = Date.now()
    
    // 检查缓存
    if (this.apiCache.has(cacheKey)) {
      const cached = this.apiCache.get(cacheKey)!
      if (now - cached.timestamp < this.cacheTimeout) {
        this.log(`PageDisplay: Using cached result for ${apiType}`)
        return cached.data
      } else {
        // 缓存过期，删除
        this.apiCache.delete(cacheKey)
      }
    }
    
    // 调用API
    const result = await orca.invokeBackend(apiType, ...args)
    
    // 缓存结果
    this.apiCache.set(cacheKey, {
      data: result,
      timestamp: now
    })
    
    // 清理过期缓存
    this.cleanExpiredCache()
    
    return result
  }
  
  // 清理过期缓存
  private cleanExpiredCache() {
    const now = Date.now()
    for (const [key, value] of this.apiCache.entries()) {
      if (now - value.timestamp >= this.cacheTimeout) {
        this.apiCache.delete(key)
      }
    }
  }

  // 获取块信息
  private async getBlockInfo(blockId: DbId): Promise<Block | null> {
    try {
      const block = await this.cachedApiCall("get-block", blockId)
      return block
    } catch (error) {
      this.logError("Failed to get block info:", error)
      return null
    }
  }

  // 检查块是否为页面（通过_hide属性）
  private isPageBlock(block: Block): boolean {
    // 检查_hide属性，如果存在且为false，则为页面
    const hideProperty = block.properties?.find(prop => prop.name === "_hide")
    return hideProperty ? !hideProperty.value : true // 默认为页面
  }

  // 检查块是否是标签块
  private isTagBlock(block: Block): boolean {
    // 检查是否有标签属性
    if (!block.properties || block.properties.length === 0) {
      this.log("PageDisplay: 块没有属性，不是标签块", block.id)
      return false
    }
    
    // 查找标签属性
    const tagProperty = block.properties.find(prop => prop.name === "tag" || prop.name === "tags")
    const hasTagProperty = !!(tagProperty && tagProperty.value)
    
    this.log("PageDisplay: Checking if block is tag block", block.id, { 
      hasTagProperty,
      tagValue: tagProperty?.value,
      properties: block.properties.map(p => ({ name: p.name, value: p.value }))
    })
    
    return hasTagProperty
  }


  // 检查非别名块的 content 中是否包含内联引用
  private checkInlineRefInContent(block: Block, targetBlockId: DbId): boolean {
    this.log("PageDisplay: 检查块 content 中的内联引用 - 块ID:", block.id, "目标块ID:", targetBlockId)
    
    if (!block.content || !Array.isArray(block.content)) {
      this.log("PageDisplay: 块没有 content 或 content 不是数组")
      return false
    }
    
    this.log("PageDisplay: 块 content 片段数量:", block.content.length)
    
    // 遍历 content 片段查找 trv 或 trva 类型
    for (let i = 0; i < block.content.length; i++) {
      const fragment = block.content[i]
      this.log(`PageDisplay: 检查片段 [${i}]:`, fragment)
      
      // 检查片段类型
      if (fragment.type === 'trv' || fragment.type === 'trva') {
        this.log("PageDisplay: 找到 trv/trva 片段:", fragment)
        
        // 检查片段中是否包含目标块ID
        if (fragment.blockId === targetBlockId) {
          this.log("PageDisplay: 片段中包含目标块ID，确认为内联引用")
          return true
        }
        
        // 或者检查其他可能的字段
        if (fragment.refId === targetBlockId || fragment.to === targetBlockId) {
          this.log("PageDisplay: 片段中通过其他字段找到目标块ID，确认为内联引用")
          return true
        }
      }
    }
    
    this.log("PageDisplay: content 中未找到包含目标块ID的 trv/trva 片段")
    return false
  }

  // 检查块是否有标签属性中的块引用（旧方法，保留作为备用）
  private hasTagRefs(block: Block): boolean {
    if (!block.properties || block.properties.length === 0) {
      return false
    }
    
    // 查找标签属性
    const tagProperty = block.properties.find(prop => prop.name === "tag" || prop.name === "tags")
    if (!tagProperty || !tagProperty.value) {
      return false
    }
    
    // 检查标签属性值是否包含块引用格式
    const tagValue = String(tagProperty.value)
    
    // 检查是否包含块引用格式（如 [[block-id]] 或 #block-id）
    const hasBlockRefs = tagValue.includes('[[') && tagValue.includes(']]') || 
                        tagValue.includes('#') ||
                        tagValue.includes('@')
    
    this.log("PageDisplay: Checking tag refs for block", block.id, { 
      tagValue, 
      hasBlockRefs 
    })
    
    return hasBlockRefs
  }


  // 块ID转换为文本
  private async blockIdToText(blockId: any): Promise<string> {
    if (!blockId) {
      return ''
    }
    
    try {
      const block = await this.cachedApiCall("get-block", blockId)
      if (block) {
        const texts = []
        
        // 添加块文本
        if (block.text) {
          texts.push(block.text)
        }
        
        // 如果是别名块，添加所有别名
        if (block.aliases && block.aliases.length > 0) {
          texts.push(...block.aliases)
        }
        
        return texts.join(' ')
      }
    } catch (error) {
      this.logError(`块ID转文本失败，块ID: ${blockId}`, error)
    }
    
    return ''
  }

  // 直接使用 block.refs 解析搜索数据
  private async enhanceItemForSearch(item: PageDisplayItem, block: Block): Promise<PageDisplayItem> {
    // 收集所有可搜索的文本
    const searchableTexts = [item.text, ...item.aliases]
    
    this.log(`🔍 开始解析块 ${block.id} 的搜索数据`)
    
    try {
      // 直接使用 block.refs 获取引用信息
      if (block.refs && block.refs.length > 0) {
        this.log(`找到 ${block.refs.length} 个引用`)
        
        for (const ref of block.refs) {
          this.log(`处理引用:`, ref)
          
          // 直接使用 ref.to 作为目标块ID
          if (ref.to) {
            this.log(`使用 ref.to 作为目标块ID: ${ref.to}`)
            const refText = await this.blockIdToText(ref.to)
            if (refText) {
              this.log(`ref.to 转换为文本: ${ref.to} → ${refText}`)
              searchableTexts.push(refText)
            }
          }
          
          // 处理 ref.data 中的属性信息
          if (ref.data && Array.isArray(ref.data)) {
            this.log(`找到 ${ref.data.length} 个数据项`)
            
            for (const dataItem of ref.data) {
              this.log(`处理数据项:`, dataItem)
              
              if (dataItem.name && dataItem.value !== undefined) {
                this.log(`添加属性: ${dataItem.name} = ${dataItem.value}`)
                searchableTexts.push(dataItem.name)
                
                // 添加属性值
                if (dataItem.value !== null && dataItem.value !== undefined) {
                  if (typeof dataItem.value === 'string') {
                    searchableTexts.push(dataItem.value)
                  } else if (typeof dataItem.value === 'number') {
                    // 数字可能是块ID，尝试转换为文本
                    this.log(`尝试将数字ID ${dataItem.value} 转换为文本`)
                    const blockText = await this.blockIdToText(dataItem.value)
                    if (blockText) {
                      this.log(`数字ID ${dataItem.value} 转换为文本: ${blockText}`)
                      searchableTexts.push(blockText)
                    } else {
                      // 如果转换失败，保留原始数字
                      searchableTexts.push(dataItem.value.toString())
                    }
                  } else if (Array.isArray(dataItem.value)) {
                    // 数组中的每个元素都可能是块ID，直接转换为文本
                    const arrayTexts = []
                    for (const item of dataItem.value) {
                      if (typeof item === 'number') {
                        this.log(`尝试将数组中的数字ID ${item} 转换为文本`)
                        const itemText = await this.blockIdToText(item)
                        if (itemText) {
                          this.log(`数组中的数字ID ${item} 转换为文本: ${itemText}`)
                          arrayTexts.push(itemText)
                        } else {
                          this.log(`无法转换数字ID ${item}，保留原始值`)
                          arrayTexts.push(item.toString())
                        }
                      } else {
                        arrayTexts.push(String(item))
                      }
                    }
                    searchableTexts.push(arrayTexts.join(' '))
                  } else if (typeof dataItem.value === 'object') {
                    // 处理对象类型的值
                    const objTexts = []
                    for (const [key, val] of Object.entries(dataItem.value)) {
                      if (typeof val === 'string') {
                        objTexts.push(`${key}:${val}`)
                      } else if (typeof val === 'number') {
                        // 对象中的数字值也可能是块ID
                        this.log(`尝试将对象中的数字ID ${val} 转换为文本`)
                        const valText = await this.blockIdToText(val)
                        if (valText) {
                          this.log(`对象中的数字ID ${val} 转换为文本: ${valText}`)
                          objTexts.push(`${key}:${valText}`)
                        } else {
                          objTexts.push(`${key}:${val}`)
                        }
                      }
                    }
                    if (objTexts.length > 0) {
                      searchableTexts.push(objTexts.join(' '))
                    }
                  }
                }
              }
            }
          } else {
            this.log(`引用无数据:`, ref)
          }
        }
      } else {
        this.log(`❌ 块无引用`)
      }
    } catch (error) {
      this.logError(`解析块 ${block.id} 搜索数据失败:`, error)
    }
    
    // 添加基本属性信息（作为备用）
    if (block.properties) {
      for (const prop of block.properties) {
        // 添加非系统属性名
        const isSystemProperty = prop.name.startsWith('_') && ['_hide', '_repr', '_tags', '_color', '_asAlias'].includes(prop.name)
        if (!isSystemProperty) {
          searchableTexts.push(prop.name)
        }
        
        // 添加属性值（简单字符串化）
        if (prop.value !== null && prop.value !== undefined) {
          if (typeof prop.value === 'string') {
            searchableTexts.push(prop.value)
          } else if (typeof prop.value === 'number') {
            searchableTexts.push(prop.value.toString())
          } else if (Array.isArray(prop.value)) {
            searchableTexts.push(prop.value.join(' '))
          }
        }
      }
    }
    
    // 添加块引用别名
    if (block.refs && block.refs.length > 0) {
      for (const ref of block.refs) {
        if (ref.alias) {
          searchableTexts.push(ref.alias)
        }
      }
    }
    
    // 创建扁平化的搜索文本
    const allSearchableText = searchableTexts.join(' ')
    this.log(`🔍 块 ${block.id} 最终搜索文本:`, allSearchableText)
    
    return {
      ...item,
      searchableText: allSearchableText
    }
  }


  // 检查块是否满足条件：引用了当前根块的别名块、无父级
  private isValidBlock(block: Block, rootBlockId: DbId): boolean {
    // 1. 必须有别名
    if (!block.aliases || block.aliases.length === 0) {
      return false
    }
    
    // 2. 必须无父级
    if (block.parent) {
      return false
    }
    
    // 3. 必须引用了当前根块（通过backRefs检查）
    if (!block.backRefs || block.backRefs.length === 0) {
      return false
    }
    
    // 检查是否有引用指向当前根块
    const hasReferenceToRoot = block.backRefs.some(backRef => backRef.from === rootBlockId)
    if (!hasReferenceToRoot) {
      return false
    }
    
    return true
  }

  // 获取父块信息
  private getParentBlock(block: Block): Block | undefined {
    if (block.parent) {
      return orca.state.blocks[block.parent]
    }
    return undefined
  }


  // 更新显示（立即执行）
  public updateDisplay() {
    this.log("PageDisplay: updateDisplay called")
    
    // 清除之前的定时器
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout)
    }
    
    // 立即执行更新
      this.performUpdate()
  }
  
  // 强制更新显示（跳过防抖）
  public forceUpdate() {
    console.log("PageDisplay: Force update triggered")
    this.retryCount = 0
    this.performUpdate()
  }

  // 执行实际更新
  private async performUpdate() {
    this.log("PageDisplay: performUpdate called")
    
    const rootBlockId = this.getCurrentRootBlockId()
    this.log("PageDisplay: rootBlockId =", rootBlockId)
    
    // 如果根块ID没有变化且当前面板有显示，跳过更新
    const panelId = this.getCurrentPanelId()
    const container = this.containers.get(panelId)
    if (rootBlockId === this.lastRootBlockId && container && container.parentNode) {
      this.log("PageDisplay: Root block ID unchanged and display exists for current panel, skipping update")
      return
    }
    
    this.lastRootBlockId = rootBlockId
    
    if (!rootBlockId) {
      this.log("PageDisplay: No root block ID, removing display")
      this.removeDisplay()
      return
    }

    // 如果处于折叠状态，不显示内容
    if (this.isCollapsed) {
      this.log("PageDisplay: Collapsed state, not displaying content")
      this.removeDisplay()
      return
    }

    // 使用 get-children-tags API 获取子标签
    this.log("PageDisplay: Getting children tags for rootBlockId:", rootBlockId)
    const childrenTags = await this.getChildrenTags(rootBlockId)
    this.log("PageDisplay: childrenTags count:", childrenTags?.length || 0, "items:", childrenTags)
    
    // 获取被当前块引用的块（当前块引用了哪些块，如打开数学开发书籍时显示书籍）
    this.log("PageDisplay: Getting referenced blocks for rootBlockId:", rootBlockId)
    const referencedResult = await this.getReferencedBlocks(rootBlockId)
    const referencedBlocks = referencedResult.blocks
    const tagBlockIds = referencedResult.tagBlockIds
    const inlineRefIds = referencedResult.inlineRefIds
    this.log("PageDisplay: referencedBlocks count:", referencedBlocks?.length || 0, "items:", referencedBlocks)
    this.log("PageDisplay: tagBlockIds:", tagBlockIds)
    this.log("PageDisplay: inlineRefIds:", inlineRefIds)
    
    // 获取被引用的包含于块（从标签层级结构解析）
    this.log("PageDisplay: Getting contained in blocks from tag hierarchy")
    const containedInBlockIds = await this.getContainedInBlocks()
    this.log("PageDisplay: containedInBlockIds:", containedInBlockIds)
    
    // 获取引用当前块的别名块（检查根块是否为别名块）
    this.log("PageDisplay: Getting referencing alias blocks for rootBlockId:", rootBlockId)
    const referencingAliasBlocks = await this.getReferencingAliasBlocks(rootBlockId)
    this.log("PageDisplay: referencingAliasBlocks count:", referencingAliasBlocks?.length || 0, "items:", referencingAliasBlocks)
    
    // 获取子块中引用的别名块（当当前块没有父块时）
    this.log("PageDisplay: Getting child referenced alias blocks for rootBlockId:", rootBlockId)
    this.log("PageDisplay: tagBlockIds for filtering:", tagBlockIds)
    const childReferencedAliasBlocks = await this.getChildReferencedAliasBlocks(rootBlockId, tagBlockIds)
    this.log("PageDisplay: childReferencedAliasBlocks count:", childReferencedAliasBlocks?.length || 0, "items:", childReferencedAliasBlocks)
    
    // 详细记录每个子块引用块
    if (childReferencedAliasBlocks && childReferencedAliasBlocks.length > 0) {
      this.log("PageDisplay: 子块引用块详情:")
      childReferencedAliasBlocks.forEach((block, index) => {
        this.log(`PageDisplay: [${index}] ID: ${block.id}, 文本: ${block.text}, 别名: ${block.aliases}`)
      })
    } else {
      this.log("PageDisplay: 没有找到子块引用块")
    }

    // 将子标签转换为显示项目
    const tagItems: PageDisplayItem[] = []
    for (const tag of childrenTags) {
      this.log("PageDisplay: processing tag", tag)
      
      // 使用类型断言处理API返回的数据结构
      const tagWithName = tag as any
      
      // 检查是否有名称或别名
      const hasName = tagWithName.name || (tag.aliases && tag.aliases.length > 0)
      if (hasName) {
        const displayText = (tag.aliases && tag.aliases[0]) || tagWithName.name || tag.text || `Tag ${tag.id}`
        // 确保 aliases 数组至少包含显示文本，这样搜索就能工作
        const aliases = tag.aliases && tag.aliases.length > 0 ? tag.aliases : 
                       (tagWithName.name ? [tagWithName.name] : [displayText])
        
        const baseItem: PageDisplayItem = {
          id: tag.id,
          text: displayText,
          aliases: aliases,
          isPage: this.isPageBlock(tag),
          parentBlock: this.getParentBlock(tag),
          _hide: (tag as any)._hide,
          _icon: (tag as any)._icon,
          itemType: 'tag'
        }
        const enhancedItem = await this.enhanceItemForSearch(baseItem, tag)
        tagItems.push(enhancedItem)
        
        this.log("PageDisplay: added tag item", { id: tag.id, text: displayText, aliases })
      } else {
        this.log("PageDisplay: skipping tag (no name/aliases)", tag)
      }
    }

    // 处理被当前块引用的块（包括标签块和属性引用块）
    this.log("PageDisplay: ===== 开始处理被引用块 =====")
    this.log("PageDisplay: 被引用块总数:", referencedBlocks.length)
    
    const referencedItems: PageDisplayItem[] = []
    for (let i = 0; i < referencedBlocks.length; i++) {
      const block = referencedBlocks[i]
      this.log("PageDisplay: ===== 处理第", i + 1, "个被引用块 =====")
      this.log("PageDisplay: 被引用块ID:", block.id)
      this.log("PageDisplay: 被引用块文本:", block.text)
      this.log("PageDisplay: 被引用块别名:", block.aliases)
      this.log("PageDisplay: 被引用块属性:", block.properties)
      
      // 检查是否为标签块
      const isTagBlock = tagBlockIds.includes(block.id)
      this.log("PageDisplay: 是否为标签块:", isTagBlock)
      
      // 被引用的块显示条件：必须有别名或文本内容
      const hasName = (block.aliases && block.aliases.length > 0) || block.text
      this.log("PageDisplay: 被引用块是否有名称:", hasName)
      
      if (hasName) {
        const displayText = (block.aliases && block.aliases[0]) || block.text || `被引用块 ${block.id}`
        const aliases = block.aliases && block.aliases.length > 0 ? block.aliases : [displayText]
        
        this.log("PageDisplay: 被引用块显示文本:", displayText)
        this.log("PageDisplay: 被引用块别名列表:", aliases)
        
        let itemType: 'referenced' = 'referenced'
        
        if (isTagBlock) {
          // 标签块：使用上箭头图标
          this.log("PageDisplay: 这是标签块，使用上箭头图标")
          itemType = 'referenced'
        } else {
          // 属性引用块：使用标签图标
          this.log("PageDisplay: 这是属性引用块，使用标签图标")
          itemType = 'referenced'
        }
        
        this.log("PageDisplay: 最终项目类型:", itemType)
        
        const baseItem: PageDisplayItem = {
          id: block.id,
          text: displayText,
          aliases: aliases,
          isPage: this.isPageBlock(block),
          parentBlock: this.getParentBlock(block),
          _hide: (block as any)._hide,
          _icon: (block as any)._icon,
          itemType: itemType
        }
        const enhancedItem = await this.enhanceItemForSearch(baseItem, block)
        referencedItems.push(enhancedItem)
        
        this.log("PageDisplay: 已添加被引用项目:", { 
          id: block.id, 
          text: displayText, 
          aliases, 
          isTagBlock, 
          itemType 
        })
        this.log("PageDisplay: ================================")
      } else {
        this.log("PageDisplay: 跳过被引用块（没有名称/别名）:", block)
      }
    }
    
    this.log("PageDisplay: ===== 被引用块处理完成 =====")
    this.log("PageDisplay: 最终被引用项目数量:", referencedItems.length)

    // 处理被引用的包含于块（从标签层级结构解析）
    this.log("PageDisplay: ===== 开始处理包含于块 =====")
    const containedInItems: PageDisplayItem[] = []
    
    for (const blockId of containedInBlockIds) {
      try {
        this.log(`PageDisplay: 处理包含于块ID: ${blockId}`)
        
        // 获取块数据
        const block = await this.cachedApiCall("get-block", blockId)
        if (!block) {
          this.log(`PageDisplay: 未找到包含于块ID: ${blockId}`)
          continue
        }
        
        this.log(`PageDisplay: 包含于块文本: ${block.text}`)
        this.log(`PageDisplay: 包含于块别名: ${block.aliases}`)
        
        // 检查是否有名称或别名
        const hasName = (block.aliases && block.aliases.length > 0) || block.text
        if (hasName) {
          const displayText = (block.aliases && block.aliases[0]) || block.text || `包含于块 ${block.id}`
          const aliases = block.aliases && block.aliases.length > 0 ? block.aliases : [displayText]
          
          this.log(`PageDisplay: 包含于块显示文本: ${displayText}`)
          
          const baseItem: PageDisplayItem = {
            id: block.id,
            text: displayText,
            aliases: aliases,
            isPage: this.isPageBlock(block),
            parentBlock: this.getParentBlock(block),
            _hide: (block as any)._hide,
            _icon: (block as any)._icon,
            itemType: 'referenced' // 使用相同的类型，但会在图标分配时特殊处理
          }
          const enhancedItem = await this.enhanceItemForSearch(baseItem, block)
          containedInItems.push(enhancedItem)
          
          this.log(`PageDisplay: 已添加包含于项目: ${displayText}`)
        } else {
          this.log(`PageDisplay: 跳过包含于块（没有名称/别名）: ${blockId}`)
        }
      } catch (error) {
        this.logError(`处理包含于块 ${blockId} 失败:`, error)
      }
    }
    
    this.log("PageDisplay: ===== 包含于块处理完成 =====")
    this.log("PageDisplay: 最终包含于项目数量:", containedInItems.length)

    // 处理引用当前块的别名块（根块是别名块）
    const referencingAliasItems: PageDisplayItem[] = []
    for (const block of referencingAliasBlocks) {
      this.log("PageDisplay: processing referencing alias block", block)
      
      // 这些块已经是别名块，直接添加
      const displayText = (block.aliases && block.aliases[0]) || block.text || `Block ${block.id}`
      
      const baseItem: PageDisplayItem = {
        id: block.id,
        text: displayText,
        aliases: block.aliases || [],
        isPage: this.isPageBlock(block),
        parentBlock: this.getParentBlock(block),
        _hide: (block as any)._hide,
        _icon: (block as any)._icon,
        itemType: 'referencing-alias'
      }
      const enhancedItem = await this.enhanceItemForSearch(baseItem, block)
      referencingAliasItems.push(enhancedItem)
      
      this.log("PageDisplay: added referencing alias item", { id: block.id, text: displayText, aliases: block.aliases })
    }

    // 处理子块中引用的别名块（当当前块没有父块时）
    const childReferencedAliasItems: PageDisplayItem[] = []
    for (const block of childReferencedAliasBlocks) {
      this.log("PageDisplay: processing child referenced alias block", block)
      
      // 这些块是子块引用的别名块，添加特殊标记
      const displayText = (block.aliases && block.aliases[0]) || block.text || `子块引用别名 ${block.id}`
      
      const baseItem: PageDisplayItem = {
        id: block.id,
        text: displayText,
        aliases: block.aliases || [],
        isPage: this.isPageBlock(block),
        parentBlock: this.getParentBlock(block),
        _hide: (block as any)._hide,
        _icon: (block as any)._icon,
        itemType: 'child-referenced-alias'
      }
      const enhancedItem = await this.enhanceItemForSearch(baseItem, block)
      childReferencedAliasItems.push(enhancedItem)
      
      this.log("PageDisplay: added child referenced alias item", { id: block.id, text: displayText, aliases: block.aliases })
    }


    // 合并所有项目
    const allItems = [...tagItems, ...referencedItems, ...containedInItems, ...referencingAliasItems, ...childReferencedAliasItems]
    
    // 去重：根据ID和文本内容去重，保持唯一性
    const uniqueItems = this.deduplicateItems(allItems)
    
    // 排序：标签块和包含于块（上箭头图标）显示在最上面
    uniqueItems.sort((a, b) => {
      // 标签块和包含于块优先显示
      const aIsTagBlock = a.itemType === 'referenced' && tagBlockIds.includes(a.id)
      const bIsTagBlock = b.itemType === 'referenced' && tagBlockIds.includes(b.id)
      const aIsContainedIn = a.itemType === 'referenced' && containedInBlockIds.includes(a.id)
      const bIsContainedIn = b.itemType === 'referenced' && containedInBlockIds.includes(b.id)
      
      const aIsPriority = aIsTagBlock || aIsContainedIn
      const bIsPriority = bIsTagBlock || bIsContainedIn
      
      if (aIsPriority && !bIsPriority) return -1
      if (!aIsPriority && bIsPriority) return 1
      
      // 其他项目保持原有顺序
      return 0
    })
    
    this.log("PageDisplay: Creating display with", uniqueItems.length, "unique items (", tagItems.length, "tags +", referencedItems.length, "referenced +", containedInItems.length, "contained in +", referencingAliasItems.length, "referencing alias +", childReferencedAliasItems.length, "child referenced alias)")
    
    try {
      this.createDisplay(uniqueItems, tagBlockIds, inlineRefIds, containedInBlockIds)
      this.retryCount = 0 // 重置重试计数
      
      // 更新查询列表按钮状态
      this.updateQueryListButton()
    } catch (error) {
      this.logError("PageDisplay: Failed to create display:", error)
      this.handleDisplayError(error)
    }
  }
  
  // 处理显示错误
  private handleDisplayError(error: any) {
    this.retryCount++
    this.logWarn(`PageDisplay: Display error (attempt ${this.retryCount}/${this.maxRetries}):`, error)
    
    if (this.retryCount < this.maxRetries) {
      // 延迟重试
      setTimeout(() => {
        this.log("PageDisplay: Retrying display creation...")
        this.updateDisplay()
      }, 1000 * this.retryCount) // 递增延迟
    } else {
      this.logError("PageDisplay: Max retries reached, giving up")
      orca.notify("error", "页面空间显示失败，请尝试手动刷新")
    }
  }

  // 获取子标签
  private async getChildrenTags(blockId: DbId): Promise<Block[]> {
    try {
      const childrenTags = await this.cachedApiCall("get-children-tags", blockId)
      return childrenTags || []
    } catch (error) {
      this.logError("Failed to get children tags:", error)
      return []
    }
  }

  // 解析标签层级结构，获取被引用的包含于块
  private async getContainedInBlocks(): Promise<DbId[]> {
    try {
      this.log("开始解析标签层级结构...")
      
      // 查找标签层级结构元素
      const hierarchyElement = document.querySelector('.orca-repr-tag-hierarchy')
      if (!hierarchyElement) {
        this.log("未找到标签层级结构元素")
        return []
      }

      // 查找第一个 span.orca-repr-tag-hierarchy-text
      const firstSpan = hierarchyElement.querySelector('span.orca-repr-tag-hierarchy-text')
      if (!firstSpan) {
        this.log("未找到第一个标签层级文本元素")
        return []
      }

      const tagText = firstSpan.textContent?.trim()
      if (!tagText) {
        this.log("标签层级文本为空")
        return []
      }

      this.log(`找到标签层级文本: "${tagText}"`)

      // 通过别名查找对应的块ID
      try {
        const blockId = await this.cachedApiCall("get-blockid-by-alias", tagText)
        if (blockId && typeof blockId === 'object' && blockId.id) {
          this.log(`找到包含于块ID: ${blockId.id} (别名: ${tagText})`)
          return [blockId.id]
        } else if (typeof blockId === 'number') {
          this.log(`找到包含于块ID: ${blockId} (别名: ${tagText})`)
          return [blockId]
        } else {
          this.log(`未找到别名 "${tagText}" 对应的块ID`)
          return []
        }
      } catch (error) {
        this.logError(`查找别名 "${tagText}" 对应的块ID失败:`, error)
        return []
      }
    } catch (error) {
      this.logError("解析标签层级结构失败:", error)
      return []
    }
  }

  // 创建查询列表控制按钮
  private createQueryListToggleButton() {
    const panelId = this.getCurrentPanelId()
    
    // 移除现有按钮
    const existingButton = this.queryListToggleButtons.get(panelId)
    if (existingButton) {
      existingButton.remove()
    }

    const button = document.createElement('div')
    button.className = 'page-display-query-list-toggle'
    const icon = document.createElement('i')
    icon.className = 'ti ti-eye'
    icon.style.cssText = `
      font-size: 14px;
      color: var(--orca-color-text-1);
      transition: color 0.3s ease;
    `
    button.appendChild(icon)
    button.setAttribute('data-hidden', 'false')
    button.title = '隐藏底部查询别名块'
    
    // 使用JavaScript设置样式
    button.style.cssText = `
      position: relative;
      width: 32px;
      height: 32px;
      background: var(--orca-color-bg-2);
      border: 1px solid var(--orca-color-border);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      margin-left: 8px;
      opacity: 0;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      flex-shrink: 0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    `
    
    // 添加悬停效果
    button.addEventListener('mouseenter', () => {
      button.style.opacity = '1'
      button.style.background = 'var(--orca-color-bg-3)'
      button.style.transform = 'scale(1.08)'
      button.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)'
      button.style.borderColor = 'var(--orca-color-primary-5)'
      
      // 悬停时更新图标颜色
      const icon = button.querySelector('i')
      if (icon) {
        if (this.queryListHidden) {
          icon.style.color = 'var(--orca-color-dangerous-6)'
        } else {
          icon.style.color = 'var(--orca-color-text-1)'
        }
      }
    })
    
    button.addEventListener('mouseleave', () => {
      button.style.opacity = '0'
      button.style.background = 'var(--orca-color-bg-2)'
      button.style.transform = 'scale(1)'
      button.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)'
      button.style.borderColor = 'var(--orca-color-border)'
      
      // 鼠标离开时恢复图标颜色
      const icon = button.querySelector('i')
      if (icon) {
        if (this.queryListHidden) {
          icon.style.color = 'var(--orca-color-dangerous-5)'
        } else {
          icon.style.color = 'var(--orca-color-text-1)'
        }
      }
    })
    
    // 添加点击事件
    button.addEventListener('click', () => {
      console.log('PageDisplay: Query list toggle button clicked')
      this.toggleQueryListVisibility()
    })
    
    // 添加到 page-display-left-content 后面
    const leftContent = document.querySelector('.page-display-left-content')
    console.log('PageDisplay: leftContent found:', leftContent)
    if (leftContent && leftContent.parentNode) {
      leftContent.parentNode.insertBefore(button, leftContent.nextSibling)
      console.log('PageDisplay: Button inserted after leftContent')
    } else {
      // 如果找不到 leftContent，添加到 body
      document.body.appendChild(button)
      console.log('PageDisplay: Button added to body')
    }
    
    // 存储按钮引用
    this.queryListToggleButtons.set(panelId, button)
    console.log('PageDisplay: Query list toggle button created for panel:', panelId)
  }

  // 更新查询列表按钮状态
  private updateQueryListButton() {
    const panelId = this.getCurrentPanelId()
    const button = this.queryListToggleButtons.get(panelId)
    if (!button) return
    
    // 更新按钮状态指示
    const hasQueryList = this.hasQueryList()
    if (hasQueryList) {
      button.title = '隐藏底部查询别名块'
      // 自动应用隐藏逻辑
      this.applyQueryListHideLogic()
    } else {
      button.title = '当前页面无查询列表'
    }
  }

  // 应用查询列表隐藏逻辑
  private applyQueryListHideLogic() {
    // 检查并隐藏符合条件的元素
    document.querySelectorAll('.orca-query-list').forEach((list, listIndex) => {
      // 检查 .orca-query-list 是否包含特定块
      const hasTargetBlock = list.querySelector('.orca-block.orca-container.orca-block-postfix.orca-query-list-block-block')
      if (hasTargetBlock) {
        console.log(`PageDisplay: Found target block in query list ${listIndex}`)
        
        // 查找该列表中的 .orca-query-list-block 元素
        const queryBlocks = list.querySelectorAll('.orca-query-list-block')
        queryBlocks.forEach((queryBlock, blockIndex) => {
          // 检查该 .orca-query-list-block 是否也包含特定块
          const hasNestedTargetBlock = queryBlock.querySelector('.orca-block.orca-container.orca-block-postfix.orca-query-list-block-block')
          if (hasNestedTargetBlock) {
            // 根据持久化状态决定是否隐藏
            (queryBlock as HTMLElement).style.display = this.queryListHidden ? 'none' : ''
            console.log(`PageDisplay: Query block ${blockIndex} in list ${listIndex} display set to:`, (queryBlock as HTMLElement).style.display)
          }
        })
      }
    })
    
    // 更新按钮状态
    const panelId = this.getCurrentPanelId()
    const button = this.queryListToggleButtons.get(panelId)
    if (button) {
      button.setAttribute('data-hidden', this.queryListHidden.toString())
      
      // 更新图标颜色
      const icon = button.querySelector('i')
      if (icon) {
        if (this.queryListHidden) {
          icon.style.color = 'var(--orca-color-dangerous-5)'
        } else {
          icon.style.color = 'var(--orca-color-text-1)'
        }
      }
    }
  }

  // 创建显示元素
  private createDisplay(items: PageDisplayItem[], tagBlockIds: DbId[] = [], inlineRefIds: DbId[] = [], containedInBlockIds: DbId[] = []) {
    this.log("PageDisplay: createDisplay called with", items.length, "items")
    this.log("PageDisplay: Items details:", items)
    this.log("PageDisplay: Tag block IDs:", tagBlockIds)
    
    // 获取当前面板标识
    const panelId = this.getCurrentPanelId()
    this.log("PageDisplay: Current panel ID:", panelId)
    
    // 移除当前面板的现有显示
    this.removeDisplay(panelId)

    // 查找目标位置，支持重试
    let targetElement = this.findTargetElement()
    
    // 如果找不到目标元素，延迟重试
    if (!targetElement) {
      this.log("PageDisplay: No target element found, retrying in 500ms...")
      setTimeout(() => {
        targetElement = this.findTargetElement()
        if (targetElement) {
          this.createDisplay(items)
        } else {
          this.logError("PageDisplay: Still no target element found after retry")
          throw new Error("No target element found")
        }
      }, 500)
      return
    }

    // 创建容器
    const container = document.createElement('div')
    container.setAttribute('data-panel-id', panelId) // 标记所属面板
    this.applyStyles(container, 'page-display-container')

    // 创建标题容器
    const titleContainer = document.createElement('div')
    this.applyStyles(titleContainer, 'page-display-title-container')
    
    // 创建左侧内容容器
    const leftContent = document.createElement('div')
    this.applyStyles(leftContent, 'page-display-left-content')
    
    // 创建折叠箭头
    const arrow = document.createElement('span')
    arrow.textContent = '▶'
    this.applyStyles(arrow, 'page-display-arrow')
    
    // 设置初始状态：展开状态，箭头向下
    if (!this.isCollapsed) {
      arrow.style.transform = 'rotate(90deg)'
    }
    
    // 创建标题文本
    const title = document.createElement('div')
    title.textContent = '页面空间'
    this.applyStyles(title, 'page-display-title')
    
    // 创建页面统计信息
    const pageCount = document.createElement('span')
    this.applyStyles(pageCount, 'page-display-count')
    pageCount.textContent = '(0)'
    
    // 创建搜索图标
    const searchIcon = document.createElement('div')
    searchIcon.textContent = '🔍'
    searchIcon.className = 'page-display-search-icon'
    this.applyStyles(searchIcon, 'page-display-search-icon')
    
    leftContent.appendChild(arrow)
    leftContent.appendChild(title)
    leftContent.appendChild(pageCount)
    titleContainer.appendChild(leftContent)
    titleContainer.appendChild(searchIcon)
    container.appendChild(titleContainer)
    
    // 折叠状态和搜索状态
    let isTransitioning = false
    let isSearchVisible = false
    
    // 添加悬浮效果
    leftContent.addEventListener('mouseenter', () => {
      arrow.style.opacity = '1'
    })
    
    leftContent.addEventListener('mouseleave', () => {
      arrow.style.opacity = '0'
    })
    
    // 搜索图标悬浮效果
    searchIcon.addEventListener('mouseenter', () => {
      searchIcon.style.opacity = '1'
      searchIcon.style.background = 'var(--page-display-search-bg-hover)'
    })
    
    searchIcon.addEventListener('mouseleave', () => {
      // 鼠标移出搜索按钮时总是隐藏
      searchIcon.style.opacity = '0'
      searchIcon.style.background = 'var(--page-display-search-bg)'
    })
    
    // 标题容器悬浮效果（只在右侧区域悬浮时显示搜索图标）
    titleContainer.addEventListener('mouseenter', (e) => {
      // 检查鼠标是否在右侧区域（搜索图标区域）
      const rect = titleContainer.getBoundingClientRect()
      const mouseX = e.clientX
      const rightArea = rect.right - 40 // 右侧40px区域
      
      if (mouseX > rightArea) {
        searchIcon.style.opacity = '1'
        searchIcon.style.background = 'var(--page-display-search-bg-hover)'
      }
    })
    
    titleContainer.addEventListener('mouseleave', () => {
      // 鼠标移出标题容器时总是隐藏搜索图标
      searchIcon.style.opacity = '0'
      searchIcon.style.background = 'var(--page-display-search-bg)'
    })
    
    // 折叠/展开功能
    const toggleCollapse = () => {
      if (isTransitioning) return
      
      isTransitioning = true
      this.isCollapsed = !this.isCollapsed
      
      if (this.isCollapsed) {
        // 折叠：平滑隐藏列表
        list.style.opacity = '0'
        list.style.maxHeight = '0'
        arrow.style.transform = 'rotate(0deg)' // 折叠时箭头向右
        
        // 如果搜索框是显示的，也隐藏它
        if (isSearchVisible) {
          searchContainer.style.opacity = '0'
          searchContainer.style.maxHeight = '0'
        }
        
        // 延迟设置display为none，确保过渡完成
        setTimeout(() => {
          if (this.isCollapsed) {
            list.style.display = 'none'
            if (isSearchVisible) {
              searchContainer.style.display = 'none'
            }
          }
          isTransitioning = false
        }, 100)
      } else {
        // 展开：显示列表
        // 根据多列设置决定display样式
        if (this.multiColumn) {
          list.style.display = 'grid'
        } else {
        list.style.display = 'block'
        }
        
        // 强制重排以触发过渡
        list.offsetHeight
        
        list.style.opacity = '1'
        list.style.maxHeight = '1000px'
        arrow.style.transform = 'rotate(90deg)' // 展开时箭头向下
        
        // 搜索框只有在用户主动点击搜索图标时才显示
        // 这里不自动显示搜索框
        
        setTimeout(() => {
          isTransitioning = false
        }, 100)
      }
    }
    
    // 添加点击事件
    leftContent.addEventListener('click', toggleCollapse)
    
    // 搜索图标点击事件
    searchIcon.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleSearch()
    })
    
    // 切换搜索框显示
    const toggleSearch = () => {
      isSearchVisible = !isSearchVisible
      
      if (isSearchVisible) {
        searchContainer.style.display = 'block'
        searchContainer.style.opacity = '1'
        searchContainer.style.maxHeight = '100px'
        searchIcon.style.opacity = '1'
        searchIcon.style.background = 'var(--page-display-search-bg-hover)'
        searchInput.focus()
      } else {
        searchContainer.style.opacity = '0'
        searchContainer.style.maxHeight = '0'
        searchIcon.style.opacity = '0'
        searchIcon.style.background = 'var(--page-display-search-bg)'
        
        setTimeout(() => {
          if (!isSearchVisible) {
            searchContainer.style.display = 'none'
          }
        }, 100)
      }
    }

    // 创建搜索框（默认隐藏）
    const searchContainer = document.createElement('div')
    searchContainer.className = 'page-display-search-container'
    this.applyStyles(searchContainer, 'page-display-search-container')
    
    const searchInput = document.createElement('input')
    searchInput.type = 'text'
    searchInput.placeholder = '搜索页面、标签、属性... (支持多关键词)'
    searchInput.className = 'page-display-search-input'
    this.applyStyles(searchInput, 'page-display-search-input')
    
    // 存储原始项目数据
    const originalItems = [...items]
    
    // 简化的搜索过滤函数
    const filterItems = (searchTerm: string) => {
      if (!searchTerm.trim()) {
        return originalItems
      }
      
      // 分割搜索词，支持多关键词搜索
      const keywords = searchTerm.toLowerCase().split(/\s+/).filter(k => k.length > 0)
      
      const filteredItems = originalItems.filter(item => {
        // 如果只有一个关键词，使用 OR 逻辑（任一字段匹配）
        if (keywords.length === 1) {
          return matchesItem(item, keywords[0])
        }
        
        // 多个关键词使用 AND 逻辑（所有关键词都要匹配）
        return keywords.every(keyword => matchesItem(item, keyword))
      })
      
      return filteredItems
    }
    
    // 简化的搜索匹配逻辑
    const matchesItem = (item: PageDisplayItem, keyword: string): boolean => {
      const lowerKeyword = keyword.toLowerCase()
      
      // 使用 searchableText 进行简单匹配
      if (item.searchableText) {
        return item.searchableText.toLowerCase().includes(lowerKeyword)
      }
      
      // 回退到基本文本匹配
      return item.text.toLowerCase().includes(lowerKeyword) ||
             item.aliases.some(alias => alias.toLowerCase().includes(lowerKeyword))
    }
    
    // 更新显示的函数
    const updateDisplay = () => {
      const searchTerm = searchInput.value
      const filteredItems = filterItems(searchTerm)
      
      // 更新页面统计
      const totalCount = originalItems.length
      const filteredCount = filteredItems.length
      if (searchTerm.trim()) {
        pageCount.textContent = `(${filteredCount}/${totalCount})`
      } else {
        pageCount.textContent = `(${totalCount})`
      }
      
      // 清空现有列表
      list.innerHTML = ''
      
      // 重新创建过滤后的项目
      filteredItems.forEach(item => {
        const itemElement = document.createElement('li')
        itemElement.className = `page-display-item${this.multiLine ? ' multi-line' : ' single-line'} ${item.itemType}`
        this.applyStyles(itemElement, 'page-display-item')
        this.applyLineStyles(itemElement, this.multiLine)
        this.applyItemTypeStyles(itemElement, item.itemType)
        
        // 创建图标或无序点
        const icon = document.createElement('span')
        if (this.showIcons) {
          // 如果有自定义图标，使用自定义图标
          if (item._icon) {
            this.log(`PageDisplay: 使用自定义图标 - 项目: ${item.text}, 图标: ${item._icon}`)
            icon.textContent = item._icon
            icon.className = 'page-display-item-icon'
          } else {
            // 根据项目类型判断图标类型
            this.log(`PageDisplay: 分配图标 - 项目: ${item.text}, itemType: ${item.itemType}, _hide: ${item._hide}, ID: ${item.id}`)
            
            if (item.itemType === 'tag') {
              // 标签图标
              this.log(`PageDisplay: 分配标签图标 (ti-hash) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-hash'
            } else if (item.itemType === 'referenced') {
              // 被引用块图标（当前块引用了这个块）
              // 检查是否为标签块（通过ID比较）
              const isTagBlock = tagBlockIds.includes(item.id)
              const isInlineRef = inlineRefIds.includes(item.id)
              const isContainedIn = containedInBlockIds.includes(item.id)
              this.log(`PageDisplay: 被引用块 - ${item.text}, 是标签块: ${isTagBlock}, 是内联引用: ${isInlineRef}, 是包含于块: ${isContainedIn}, tagBlockIds: [${tagBlockIds.join(', ')}], inlineRefIds: [${inlineRefIds.join(', ')}], containedInBlockIds: [${containedInBlockIds.join(', ')}]`)
              
              if (isTagBlock || isContainedIn) {
                // 标签块或包含于块：使用上箭头图标
                this.log(`PageDisplay: 分配上箭头图标 (ti-arrow-up) - ${item.text} (${isTagBlock ? '标签块' : '包含于块'})`)
                icon.className = 'page-display-item-icon ti ti-arrow-up'
              } else if (isInlineRef) {
                // 内联引用块：使用链接图标
                this.log(`PageDisplay: 分配链接图标 (ti-link) - ${item.text}`)
                icon.className = 'page-display-item-icon ti ti-link'
              } else {
                // 属性引用块：使用对齐图标
                this.log(`PageDisplay: 分配对齐图标 (ti-align-box-center-stretch) - ${item.text}`)
                icon.className = 'page-display-item-icon ti ti-align-box-center-stretch'
              }
            } else if (item.itemType === 'referencing-alias') {
              // 引用别名块图标
              this.log(`PageDisplay: 分配右箭头图标 (ti-arrow-right) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-arrow-right'
            } else if (item.itemType === 'child-referenced-alias') {
              // 子块引用块图标
              this.log(`PageDisplay: 分配立方体图标 (ti-cube) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-cube'
            } else if (item._hide) {
              // 页面图标
              this.log(`PageDisplay: 分配文件图标 (ti-file) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-file'
            } else {
              // 默认标签图标
              this.log(`PageDisplay: 分配默认标签图标 (ti-hash) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-hash'
            }
          }
        } else {
          icon.textContent = '•'
          icon.className = 'page-display-item-icon'
        }
        this.applyStyles(icon, 'page-display-item-icon')
        itemElement.appendChild(icon)
        
        // 创建文本内容
        const text = document.createElement('span')
        text.textContent = item.text
        this.applyStyles(text, 'page-display-item-text')
        itemElement.appendChild(text)
        
        // 添加悬停效果
        itemElement.addEventListener('mouseenter', () => {
          const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          itemElement.style.backgroundColor = isDarkMode ? '#2d2d2d' : '#f5f5f5'
        })
        
        itemElement.addEventListener('mouseleave', () => {
          itemElement.style.backgroundColor = 'transparent'
        })

        // 添加点击事件
        itemElement.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          console.log("PageDisplay: Item clicked", { id: item.id, text: item.text })
          this.openBlock(item.id)
        })

        list.appendChild(itemElement)
      })
    }
    
    // 添加搜索事件监听
    searchInput.addEventListener('input', updateDisplay)
    
    searchContainer.appendChild(searchInput)
    container.appendChild(searchContainer)

    // 创建项目列表
    const list = document.createElement('ul')
    list.className = `page-display-list${this.multiColumn ? ' multi-column' : ''}`
    this.applyStyles(list, 'page-display-list')
    if (this.multiColumn) {
      this.applyMultiColumnStyles(list)
    }
    
    // 添加 WebKit 滚动条样式
    list.style.setProperty('--scrollbar-width', '6px')
    list.style.setProperty('--scrollbar-track-bg', 'transparent')
    list.style.setProperty('--scrollbar-thumb-bg', 'rgba(0, 0, 0, 0.2)')
    list.style.setProperty('--scrollbar-thumb-hover-bg', 'rgba(0, 0, 0, 0.3)')
    
    // 动态添加滚动条样式（避免重复添加）
    if (!document.querySelector('#page-display-scrollbar-style')) {
      const scrollbarStyle = document.createElement('style')
      scrollbarStyle.id = 'page-display-scrollbar-style'
      scrollbarStyle.textContent = `
        .page-display-list::-webkit-scrollbar {
          width: var(--scrollbar-width, 6px);
        }
        .page-display-list::-webkit-scrollbar-track {
          background: var(--scrollbar-track-bg, transparent);
          border-radius: 3px;
        }
        .page-display-list::-webkit-scrollbar-thumb {
          background: var(--scrollbar-thumb-bg, rgba(0, 0, 0, 0.2));
          border-radius: 3px;
          transition: background 0.2s ease;
        }
        .page-display-list::-webkit-scrollbar-thumb:hover {
          background: var(--scrollbar-thumb-hover-bg, rgba(0, 0, 0, 0.3));
        }
        .page-display-list.multi-column::-webkit-scrollbar {
          width: var(--scrollbar-width, 6px);
        }
        .page-display-list.multi-column::-webkit-scrollbar-track {
          background: var(--scrollbar-track-bg, transparent);
          border-radius: 3px;
        }
        .page-display-list.multi-column::-webkit-scrollbar-thumb {
          background: var(--scrollbar-thumb-bg, rgba(0, 0, 0, 0.2));
          border-radius: 3px;
          transition: background 0.2s ease;
        }
        .page-display-list.multi-column::-webkit-scrollbar-thumb:hover {
          background: var(--scrollbar-thumb-hover-bg, rgba(0, 0, 0, 0.3));
        }
        @media (prefers-color-scheme: dark) {
          .page-display-list::-webkit-scrollbar-thumb,
          .page-display-list.multi-column::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
          }
          .page-display-list::-webkit-scrollbar-thumb:hover,
          .page-display-list.multi-column::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.3);
          }
        }
      `
      document.head.appendChild(scrollbarStyle)
    }

    container.appendChild(list)
    
    // 初始显示所有项目
    updateDisplay()

    // 插入到目标位置 - 在 placeholder 的下方
    const placeholderElement = targetElement.querySelector('.orca-block-editor-placeholder')
    this.log("PageDisplay: placeholderElement =", placeholderElement)
    
    if (placeholderElement) {
      this.log("PageDisplay: Inserting after placeholder")
      placeholderElement.parentNode?.insertBefore(container, placeholderElement.nextSibling)
    } else {
      this.log("PageDisplay: Inserting at end of target element")
      // 如果找不到 placeholder，就插入到父元素的末尾
      targetElement.appendChild(container)
    }
    
    // 存储容器引用
    this.containers.set(panelId, container)
    
    this.log("PageDisplay: Container inserted, parent =", container.parentNode)
    this.log("PageDisplay: Container visible =", container.offsetHeight > 0)
    
    // 创建查询列表控制按钮
    this.createQueryListToggleButton()
    this.updateQueryListButton()
  }
  
  // 开始定期检查
  private startPeriodicCheck() {
    if (this.periodicCheckInterval) {
      clearInterval(this.periodicCheckInterval)
    }
    
    this.periodicCheckInterval = window.setInterval(() => {
      this.checkDisplayHealth()
    }, 30000) // 每30秒检查一次
  }
  
  // 检查显示健康状态
  private checkDisplayHealth() {
    if (!this.isInitialized) return
    
    const shouldDisplay = this.shouldDisplay()
    const isDisplaying = this.isDisplaying()
    
    if (shouldDisplay && !isDisplaying) {
      this.log("PageDisplay: Health check detected missing display, attempting recovery")
      this.retryCount = 0 // 重置重试计数
      this.updateDisplay()
    }
  }
  
  // 检查是否应该显示
  private shouldDisplay(): boolean {
    const rootBlockId = this.getCurrentRootBlockId()
    return rootBlockId !== null && !this.isCollapsed && this.isInitialized
  }
  
  // 检查是否正在显示
  private isDisplaying(): boolean {
    const panelId = this.getCurrentPanelId()
    const container = this.containers.get(panelId)
    return container !== undefined && 
           container.parentNode !== null && 
           container.offsetHeight > 0
  }

  // 检查是否存在查询列表
  private hasQueryList(): boolean {
    const queryList = document.querySelector('.orca-query-list')
    if (!queryList) {
      console.log('PageDisplay: No .orca-query-list found')
      return false
    }
    
    const queryListBlock = queryList.querySelector('.orca-block.orca-container.orca-block-postfix.orca-query-list-block-block')
    const hasBlock = queryListBlock !== null
    console.log('PageDisplay: hasQueryList result:', hasBlock, 'queryList:', queryList, 'block:', queryListBlock)
    return hasBlock
  }

  // 切换查询列表显示状态
  private toggleQueryListVisibility() {
    console.log('PageDisplay: Toggling query list visibility')
    
    // 切换持久化状态
    this.queryListHidden = !this.queryListHidden
    console.log('PageDisplay: New hidden state:', this.queryListHidden)
    
    // 应用新的状态
    this.applyQueryListHideLogic()
    
    // 保存设置
    this.saveSettings()
    
    // 显示通知
    const status = this.queryListHidden ? "隐藏" : "显示"
    orca.notify("info", `底部查询别名块已${status}`)
  }

  // 查找目标元素 - 支持多种查找策略，优先查找当前活跃面板
  private findTargetElement(): Element | null {
    const strategies = [
      // 策略1: 查找当前活跃面板中的编辑器容器
      () => {
        const activePanel = document.querySelector('.orca-panel.active')
        if (activePanel) {
          this.log("PageDisplay: 找到活跃面板，在其中查找目标元素")
          const noneEditableElement = activePanel.querySelector('.orca-block-editor-none-editable')
          if (noneEditableElement) {
            const placeholderElement = noneEditableElement.querySelector('.orca-block-editor-placeholder')
            if (placeholderElement) {
              this.log("PageDisplay: 在活跃面板中找到目标元素")
              return noneEditableElement
            }
          }
        }
        return null
      },
      // 策略2: 查找当前活跃面板中的任何包含placeholder的编辑器元素
      () => {
        const activePanel = document.querySelector('.orca-panel.active')
        if (activePanel) {
          const placeholderElement = activePanel.querySelector('.orca-block-editor-placeholder')
          if (placeholderElement) {
            this.log("PageDisplay: 在活跃面板中找到placeholder元素")
            return placeholderElement.closest('[class*="block-editor"]') || placeholderElement.parentElement
          }
        }
        return null
      },
      // 策略3: 查找当前活跃面板中的编辑器相关容器
      () => {
        const activePanel = document.querySelector('.orca-panel.active')
        if (activePanel) {
          const editorElement = activePanel.querySelector('[class*="block-editor"]') ||
                               activePanel.querySelector('[class*="editor"]') ||
                               activePanel.querySelector('.editor-container')
          if (editorElement) {
            this.log("PageDisplay: 在活跃面板中找到编辑器容器")
            return editorElement
          }
        }
        return null
      },
      // 策略4: 降级到全局查找（兼容单面板模式）
      () => {
    const noneEditableElement = document.querySelector('.orca-block-editor-none-editable')
        if (noneEditableElement) {
          const placeholderElement = noneEditableElement.querySelector('.orca-block-editor-placeholder')
          if (placeholderElement) {
            return noneEditableElement
          }
        }
      return null
      },
      // 策略5: 查找任何包含placeholder的编辑器元素
      () => {
        const placeholderElement = document.querySelector('.orca-block-editor-placeholder')
        if (placeholderElement) {
          return placeholderElement.closest('[class*="block-editor"]') || placeholderElement.parentElement
        }
        return null
      },
      // 策略6: 查找任何编辑器相关容器
      () => {
        return document.querySelector('[class*="block-editor"]') ||
               document.querySelector('[class*="editor"]') ||
               document.querySelector('.editor-container')
      },
      // 策略7: 降级到body
      () => document.body
    ]
    
    for (let i = 0; i < strategies.length; i++) {
      try {
        const element = strategies[i]()
        if (element) {
          this.log(`PageDisplay: Target element found using strategy ${i + 1}:`, element)
          return element
        }
      } catch (error) {
        this.logWarn(`PageDisplay: Strategy ${i + 1} failed:`, error)
      }
    }
    
    this.logWarn("PageDisplay: All strategies failed to find target element")
      return null
    }

  // 移除显示
  private removeDisplay(panelId?: string) {
    if (panelId) {
      // 移除指定面板的显示
      const container = this.containers.get(panelId)
      if (container && container.parentNode) {
        this.log(`PageDisplay: Removing display for panel ${panelId}`)
        container.parentNode.removeChild(container)
        this.containers.delete(panelId)
      }
      
      // 移除指定面板的查询列表按钮
      const button = this.queryListToggleButtons.get(panelId)
      if (button && button.parentNode) {
        button.parentNode.removeChild(button)
        this.queryListToggleButtons.delete(panelId)
      }
    } else {
      // 移除所有面板的显示
      this.log("PageDisplay: Removing all displays")
      for (const [id, container] of this.containers.entries()) {
        if (container.parentNode) {
          container.parentNode.removeChild(container)
        }
      }
      this.containers.clear()
      
      // 移除所有查询列表按钮
      for (const [id, button] of this.queryListToggleButtons.entries()) {
        if (button.parentNode) {
          button.parentNode.removeChild(button)
        }
      }
      this.queryListToggleButtons.clear()
    }
  }

  // 打开块
  private async openBlock(blockId: DbId) {
    try {
      console.log("PageDisplay: Attempting to open block", blockId)
      
      // 方法1: 使用 orca.nav.goTo (推荐方法)
      if (orca.nav && orca.nav.goTo) {
        try {
          console.log("PageDisplay: Using orca.nav.goTo to open block")
          orca.nav.goTo("block", { blockId: blockId })
          console.log("PageDisplay: Successfully opened block with orca.nav.goTo")
          return
        } catch (navError) {
          console.log("PageDisplay: orca.nav.goTo failed, trying alternative methods:", navError)
        }
      }
      
      // 方法2: 使用 orca.nav.openInLastPanel (在新面板中打开)
      if (orca.nav && orca.nav.openInLastPanel) {
        try {
          console.log("PageDisplay: Using orca.nav.openInLastPanel to open block")
          orca.nav.openInLastPanel("block", { blockId: blockId })
          console.log("PageDisplay: Successfully opened block with orca.nav.openInLastPanel")
          return
        } catch (panelError) {
          console.log("PageDisplay: orca.nav.openInLastPanel failed, trying editor commands:", panelError)
        }
      }
      
      // 方法3: 尝试使用 core.editor.focusIn 命令
      if (orca.commands && orca.commands.invokeEditorCommand) {
        try {
          console.log("PageDisplay: Trying core.editor.focusIn command")
          await orca.commands.invokeEditorCommand("core.editor.focusIn", null, blockId)
          console.log("PageDisplay: Successfully opened block with focusIn")
          return
        } catch (focusError) {
          console.log("PageDisplay: focusIn failed, trying openOnTheSide:", focusError)
        }
      }
      
      // 方法4: 尝试使用 core.editor.openOnTheSide 命令
      if (orca.commands && orca.commands.invokeEditorCommand) {
        try {
          console.log("PageDisplay: Trying core.editor.openOnTheSide command")
          await orca.commands.invokeEditorCommand("core.editor.openOnTheSide", null, blockId)
          console.log("PageDisplay: Successfully opened block with openOnTheSide")
          return
        } catch (sideError) {
          console.log("PageDisplay: openOnTheSide failed:", sideError)
        }
      }
      
      // 如果所有方法都失败
      console.error("PageDisplay: All methods failed to open block")
      orca.notify("error", "无法打开块，请检查块ID是否正确")
      
    } catch (error) {
      console.error("PageDisplay: Failed to open block:", error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      const errorStack = error instanceof Error ? error.stack : undefined
      console.error("PageDisplay: Error details:", {
        blockId,
        errorMessage,
        errorStack
      })
      orca.notify("error", `打开块失败: ${errorMessage}`)
    }
  }
}
