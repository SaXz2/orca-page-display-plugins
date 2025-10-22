import type { Block, DbId, BlockRef } from "./orca.d.ts"
import { t } from "./libs/l10n"

/**
 * 错误处理器类
 * 负责统一处理各种错误情况，包括重试逻辑和用户通知
 */
class ErrorHandler {
  private maxRetries: number = 3
  private retryDelay: number = 1000
  private logger: Logger

  constructor(logger: Logger, maxRetries: number = 3) {
    this.logger = logger
    this.maxRetries = maxRetries
  }

  /**
   * 执行带重试的操作
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    retryCount: number = 0
  ): Promise<T | null> {
    try {
      return await operation()
    } catch (error) {
      this.logger.error(`${operationName} failed (attempt ${retryCount + 1}/${this.maxRetries}):`, error)
      
      if (retryCount < this.maxRetries - 1) {
        // 延迟重试
        await this.delay(this.retryDelay * (retryCount + 1))
        return this.executeWithRetry(operation, operationName, retryCount + 1)
      } else {
        this.logger.error(`${operationName} failed after ${this.maxRetries} attempts`)
        return null
      }
    }
  }

  /**
   * 处理显示错误
   */
  handleDisplayError(error: any, retryCount: number, maxRetries: number, onRetry: () => void) {
    this.logger.warn(`Display error (attempt ${retryCount}/${maxRetries}):`, error)
    
    if (retryCount < maxRetries) {
      // 延迟重试
      setTimeout(() => {
        this.logger.debug("Retrying display creation...")
        onRetry()
      }, this.retryDelay * retryCount)
    } else {
      this.logger.error("Max retries reached, giving up")
      orca.notify("error", "页面空间显示失败，请尝试手动刷新")
    }
  }

  /**
   * 处理API错误
   */
  handleApiError(error: any, apiName: string): void {
    this.logger.error(`API ${apiName} failed:`, error)
  }

  /**
   * 延迟执行
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 设置最大重试次数
   */
  setMaxRetries(maxRetries: number) {
    this.maxRetries = maxRetries
  }

  /**
   * 设置重试延迟
   */
  setRetryDelay(delay: number) {
    this.retryDelay = delay
  }
}

/**
 * API服务类
 * 负责管理所有与Orca后端的API调用，包括缓存、错误处理和重试逻辑
 */
class ApiService {
  private cache: Map<string, { data: any; timestamp: number }> = new Map()
  private cacheTimeout: number = 30000 // 30秒
  private logger: Logger

  constructor(logger: Logger) {
    this.logger = logger
  }

  /**
   * 带缓存的API调用
   */
  async call(apiType: string, ...args: any[]): Promise<any> {
    const cacheKey = `${apiType}:${JSON.stringify(args)}`
    const now = Date.now()
    
    // 检查缓存
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!
      if (now - cached.timestamp < this.cacheTimeout) {
        this.logger.debug(`Using cached result for ${apiType}`)
        return cached.data
      } else {
        // 缓存过期，删除
        this.cache.delete(cacheKey)
      }
    }
    
    // 调用API
    const result = await orca.invokeBackend(apiType, ...args)
    
    // 缓存结果
    this.cache.set(cacheKey, {
      data: result,
      timestamp: now
    })
    
    // 清理过期缓存
    this.cleanExpiredCache()
    
    return result
  }

  /**
   * 清理过期缓存
   */
  private cleanExpiredCache() {
    const now = Date.now()
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp >= this.cacheTimeout) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * 获取块信息
   */
  async getBlock(blockId: DbId): Promise<Block | null> {
    try {
      return await this.call("get-block", blockId)
    } catch (error) {
      this.logger.error("Failed to get block info:", error)
      return null
    }
  }

  /**
   * 批量获取块信息
   */
  async getBlocks(blockIds: DbId[]): Promise<Block[]> {
    try {
      return await this.call("get-blocks", blockIds) || []
    } catch (error) {
      this.logger.error("Failed to get blocks:", error)
      return []
    }
  }

  /**
   * 获取子标签
   */
  async getChildrenTags(blockId: DbId): Promise<Block[]> {
    try {
      return await this.call("get-children-tags", blockId) || []
    } catch (error) {
      this.logger.error("Failed to get children tags:", error)
      return []
    }
  }

  /**
   * 获取子标签块
   */
  async getChildrenTagBlocks(blockId: DbId): Promise<Block[]> {
    try {
      return await this.call("get-children-tag-blocks", blockId) || []
    } catch (error) {
      this.logger.error("Failed to get children tag blocks:", error)
      return []
    }
  }

  /**
   * 通过别名获取块ID
   */
  async getBlockIdByAlias(alias: string): Promise<{ id: DbId } | null> {
    try {
      return await this.call("get-blockid-by-alias", alias)
    } catch (error) {
      this.logger.error(`Failed to get block ID by alias "${alias}":`, error)
      return null
    }
  }

  /**
   * 清除所有缓存
   */
  clearCache() {
    this.cache.clear()
  }

  /**
   * 设置缓存超时时间
   */
  setCacheTimeout(timeout: number) {
    this.cacheTimeout = timeout
  }
}

/**
 * 日志管理器类
 * 负责管理页面显示插件的所有日志记录
 */
class Logger {
  private debugMode: boolean = false
  private pluginName: string = 'PageDisplay'

  constructor(debugMode: boolean = false) {
    this.debugMode = debugMode
  }

  setDebugMode(debugMode: boolean) {
    this.debugMode = debugMode
  }

  /**
   * 调试日志（仅在调试模式下输出）
   */
  debug(...args: any[]) {
    if (this.debugMode) {
      console.log(`[${this.pluginName}]`, ...args)
    }
  }

  /**
   * 信息日志（总是输出）
   */
  info(...args: any[]) {
    console.log(`[${this.pluginName}]`, ...args)
  }

  /**
   * 警告日志（总是输出）
   */
  warn(...args: any[]) {
    console.warn(`[${this.pluginName}]`, ...args)
  }

  /**
   * 错误日志（总是输出）
   */
  error(...args: any[]) {
    console.error(`[${this.pluginName}]`, ...args)
  }

  /**
   * 性能日志（仅在调试模式下输出）
   */
  performance(message: string, startTime: number) {
    if (this.debugMode) {
      const duration = Date.now() - startTime
      console.log(`[${this.pluginName}] ⏱️ ${message}: ${duration}ms`)
    }
  }
}

/**
 * 样式管理器类
 * 负责管理页面显示插件的所有样式相关逻辑
 */
class StyleManager {
  /**
   * 检测当前是否为暗色模式
   */
  private isDarkMode(): boolean {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  /**
   * 获取统一的颜色规范
   */
  private getColors() {
    const isDarkMode = this.isDarkMode()
    return {
      text: isDarkMode ? '#e8e8e8' : '#333333',
      textSecondary: isDarkMode ? '#b8b8b8' : '#666666',
      textMuted: isDarkMode ? '#888888' : '#999999',
      border: isDarkMode ? '#3a3a3a' : '#e0e0e0',
      background: isDarkMode ? '#1e1e1e' : '#ffffff',
      backgroundHover: isDarkMode ? '#2d2d2d' : '#f5f5f5',
      backgroundSubtle: isDarkMode ? '#252525' : '#fafafa'
    }
  }

  /**
   * 应用样式类到元素
   * 先清理旧的样式类，再添加新的样式类并应用对应样式
   */
  applyStyles(element: HTMLElement, className: string) {
    // 移除所有可能的样式类，避免样式冲突
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

  /**
   * 根据类名应用具体样式
   */
  private applyClassStyles(element: HTMLElement, className: string) {
    const colors = this.getColors()
    
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
          const isDarkMode = this.isDarkMode()
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
          scrollbar-color: ${this.isDarkMode() ? '#4a4a4a' : '#c0c0c0'} transparent;
        `
        
        // 添加 WebKit 滚动条样式
        this.addScrollbarStyles()
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
          element.style.borderColor = this.isDarkMode() ? '#4a9eff' : '#007bff'
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

  /**
   * 添加滚动条样式
   */
  private addScrollbarStyles() {
    if (document.querySelector('#page-display-scrollbar-style')) {
      return // 避免重复添加
    }

    const isDarkMode = this.isDarkMode()
    const scrollbarStyle = document.createElement('style')
    scrollbarStyle.id = 'page-display-scrollbar-style'
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
  }

  /**
   * 应用项目类型样式
   */
  applyItemTypeStyles(element: HTMLElement, itemType: string) {
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

  /**
   * 应用多列样式
   */
  applyMultiColumnStyles(element: HTMLElement) {
    element.style.display = 'grid'
    element.style.gridTemplateColumns = 'repeat(auto-fit, minmax(180px, 1fr))'
    element.style.gap = '6px'
  }

  /**
   * 应用多行/单行样式
   */
  applyLineStyles(element: HTMLElement, multiLine: boolean) {
    if (multiLine) {
      // 多行显示：允许换行，不截断文本
      element.style.whiteSpace = 'normal'
      element.style.wordWrap = 'break-word'
    } else {
      // 单行显示：截断长文本
      element.style.whiteSpace = 'nowrap'
      element.style.overflow = 'hidden'
      element.style.textOverflow = 'ellipsis'
    }
  }
}

/**
 * 页面显示项目类型
 */
type PageDisplayItemType = 'tag' | 'referenced' | 'referencing-alias' | 'child-referenced-alias' | 'backref-alias-blocks'

type DisplayMode = 'flat' | 'grouped'
type DisplayGroupsMap = Record<PageDisplayItemType, PageDisplayItem[]>
interface DisplayGroupDefinition {
  type: PageDisplayItemType
  title: string
  icon: string
}

/**
 * 搜索数据结构
 */
interface SearchableData {
  /** 文本内容数组 */
  text: string[]
  /** 属性值数组 */
  properties: string[]
  /** 块引用数组 */
  blockrefs: string[]
  /** 标签数组 */
  tags: string[]
}

/**
 * 页面显示项目接口
 * 用于在页面空间中显示的各种类型的块项目
 */
interface PageDisplayItem {
  /** 块的唯一标识符 */
  id: DbId
  /** 块的主要显示文本 */
  text: string
  /** 块的别名列表，用于搜索和显示 */
  aliases: string[]
  /** 是否为页面块 */
  isPage: boolean
  /** 父块引用（如果存在） */
  parentBlock?: Block
  /** 是否隐藏该项目 */
  _hide?: boolean
  /** 自定义图标 */
  _icon?: string
  /** 项目类型 */
  itemType: PageDisplayItemType
  /** 搜索相关字段 */
  /** 包含所有可搜索文本的字符串 */
  searchableText?: string
  /** 结构化的搜索数据 */
  searchableData?: SearchableData
}

/**
 * 引用块结果接口
 */
interface ReferencedBlocksResult {
  /** 被引用的块列表 */
  blocks: Block[]
  /** 标签块ID列表 */
  tagBlockIds: DbId[]
  /** 内联引用块ID列表 */
  inlineRefIds: DbId[]
}

/**
 * 处理后的项目数据接口
 */
interface ProcessedItemsResult {
  /** 处理后的项目列表 */
  items: PageDisplayItem[]
  /** 分组后的项目列表 */
  groupedItems: DisplayGroupsMap
  /** 标签块ID列表 */
  tagBlockIds: DbId[]
  /** 内联引用块ID列表 */
  inlineRefIds: DbId[]
  /** 包含于块ID列表 */
  containedInBlockIds: DbId[]
}

/**
 * 收集的数据接口
 */
interface GatheredData {
  /** 子标签 */
  childrenTags: Block[]
  /** 被引用块结果 */
  referencedResult: ReferencedBlocksResult
  /** 包含于块ID列表 */
  containedInBlockIds: DbId[]
  /** 引用别名块列表 */
  referencingAliasBlocks: Block[]
  /** 子块引用别名块列表 */
  childReferencedAliasBlocks: Block[]
  /** 反链中的别名块列表 */
  backrefAliasBlocks: Block[]
}

/**
 * 页面空间显示插件主类
 * 负责在页面空间中显示当前块的相关信息，包括标签、引用关系等
 */
export class PageDisplay {
  /** 多面板支持：存储每个面板的显示容器，key为面板标识 */
  private containers: Map<string, HTMLElement> = new Map()
  /** 多面板支持：存储每个面板的查询列表切换按钮 */
  private queryListToggleButtons: Map<string, HTMLElement> = new Map()
  /** 插件名称，用于数据存储和API调用 */
  private pluginName: string
  /** 设置加载完成的任务 */
  private settingsReady: Promise<void>
  /** DOM变化观察器，用于监听页面变化 */
  private observer: MutationObserver | null = null
  /** 标签层级观察器 */
  private tagHierarchyObserver: MutationObserver | null = null
  /** 样式管理器 */
  private styleManager: StyleManager
  /** 日志管理器 */
  private logger: Logger
  /** API服务 */
  private apiService: ApiService
  /** 错误处理器 */
  private errorHandler: ErrorHandler
  /** 数据缓存 */
  private dataCache: Map<DbId, GatheredData> = new Map()
  /** 缓存时间戳 */
  private cacheTimestamps: Map<DbId, number> = new Map()
  /** 缓存有效期（5分钟） */
  private readonly CACHE_DURATION = 5 * 60 * 1000
  
  // === 显示控制属性 ===
  /** 控制是否显示图标，默认显示 */
  private showIcons: boolean = true
  /** 控制每个页面的折叠状态，key为页面ID，默认展开 */
  private pageCollapseStates: Map<DbId, boolean> = new Map()
  /** 控制是否多行显示项目文本 */
  private multiLine: boolean = false
  /** 控制是否多列显示项目 */
  private multiColumn: boolean = false
  /** 显示模式 */
  private displayMode: DisplayMode = 'flat'
  /** 可用显示模式列表 */
  private readonly DISPLAY_MODES: DisplayMode[] = ['flat', 'grouped']
  
  // === 状态管理属性 ===
  /** 缓存上次的根块ID，用于避免重复更新 */
  private lastRootBlockId: DbId | null = null
  /** 控制查询列表是否隐藏 */
  private queryListHidden: boolean = false
  /** 控制反链别名块查询是否开启，默认关闭 */
  private backrefAliasQueryEnabled: boolean = false
  /** 防抖定时器，避免频繁更新 */
  private updateTimeout: number | null = null
  /** 定期检查定时器，用于检测页面变化 */
  private periodicCheckInterval: number | null = null
  /** 页面切换检查定时器 */
  private pageSwitchCheckInterval: number | null = null

  // === 错误处理和重试属性 ===
  /** 当前重试次数 */
  private retryCount: number = 0
  /** 最大重试次数 */
  private maxRetries: number = 3
  /** 初始化状态标志 */
  private isInitialized: boolean = false
  /** 调试模式开关 */
  private debugMode: boolean = false
  
  // === 缓存相关属性已移至ApiService ===

  /**
   * 构造函数
   * @param pluginName 插件名称，用于数据存储和API调用
   */
  constructor(pluginName: string) {
    this.pluginName = pluginName
    this.logger = new Logger(false)
    this.styleManager = new StyleManager()
    this.apiService = new ApiService(this.logger)
    this.errorHandler = new ErrorHandler(this.logger, this.maxRetries)
    // 加载用户设置
    this.settingsReady = this.loadSettings()
    // 调试模式默认关闭
    this.debugMode = false
    
    // 清理过期缓存
    this.clearExpiredCache()
    
    // 动态加载CSS文件
    this.loadCSS()
    
    // 设置DOM观察器，监听页面变化
    this.setupDOMObserver()
  }

  /**
   * 动态加载CSS文件
   * 检查是否已经加载过样式，避免重复加载
   */
  private loadCSS() {
    // 检查是否已经加载过CSS
    if (document.querySelector('#page-display-styles')) {
      return
    }
 
    // 不再需要外部CSS文件，所有样式都由JavaScript处理
  }
  
  /**
   * 应用样式类到元素
   * 委托给样式管理器处理
   * @param element 目标DOM元素
   * @param className 要应用的样式类名
   */
  private applyStyles(element: HTMLElement, className: string) {
    this.styleManager.applyStyles(element, className)
  }
  
  /**
   * 应用项目类型样式
   * 委托给样式管理器处理
   * @param element 目标DOM元素
   * @param itemType 项目类型
   */
  private applyItemTypeStyles(element: HTMLElement, itemType: string) {
    this.styleManager.applyItemTypeStyles(element, itemType)
  }
  
  /**
   * 应用多列样式
   * 委托给样式管理器处理
   * @param element 目标DOM元素
   */
  private applyMultiColumnStyles(element: HTMLElement) {
    this.styleManager.applyMultiColumnStyles(element)
  }
  
  /**
   * 应用多行/单行样式
   * 委托给样式管理器处理
   * @param element 目标DOM元素
   * @param multiLine 是否多行显示
   */
  private applyLineStyles(element: HTMLElement, multiLine: boolean) {
    this.styleManager.applyLineStyles(element, multiLine)
  }

  // 切换图标显示状态
  /**
   * 切换图标显示状态
   * 控制是否在页面空间显示项目中显示图标
   */
  public toggleIcons() {
    this.showIcons = !this.showIcons
    
    // 保存设置到本地存储
    this.saveSettings()
    
    // 如果当前面板有显示，重新创建以应用新的图标设置
    const panelId = this.getCurrentPanelId()
    const container = this.containers.get(panelId)
    if (container) {
      this.updateDisplay()
    }
  }

  /**
   * 获取图标显示状态
   * @returns 是否显示图标
   */
  public getIconsEnabled(): boolean {
    return this.showIcons
  }

  /**
   * 切换多行显示状态
   * 控制项目文本是否以多行形式显示
   */
  public toggleMultiLine() {
    this.multiLine = !this.multiLine
    
    // 保存设置到本地存储
    this.saveSettings()
    
    // 如果当前面板有显示，重新创建以应用新的多行设置
    const panelId = this.getCurrentPanelId()
    const container = this.containers.get(panelId)
    if (container) {
      this.updateDisplay()
    }
  }

  /**
   * 获取多行显示状态
   * @returns 是否启用多行显示
   */
  public getMultiLineEnabled(): boolean {
    return this.multiLine
  }

  /**
   * 切换多列显示状态
   * 控制项目是否以多列形式显示
   */
  public toggleMultiColumn() {
    this.multiColumn = !this.multiColumn
    
    // 保存设置到本地存储
    this.saveSettings()
    
    // 如果当前面板有显示，重新创建以应用新的多列设置
    const panelId = this.getCurrentPanelId()
    const container = this.containers.get(panelId)
    if (container) {
      this.updateDisplay()
    }
  }
  

  /**
   * 获取多列显示状态
   * @returns 是否启用多列显示
   */
  public getMultiColumnEnabled(): boolean {
    return this.multiColumn
  }
  
  
  // 日志工具方法（委托给日志管理器）
  private log(...args: any[]) {
    this.logger.debug(...args)
  }
  
  private logError(...args: any[]) {
    this.logger.error(...args)
  }
  
  private logWarn(...args: any[]) {
    this.logger.warn(...args)
  }
  
  /**
   * 获取当前显示状态
   * @returns 包含所有显示状态信息的状态对象
   */
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
  
  /**
   * 切换调试模式
   * 控制是否输出详细的调试信息
   */
  public toggleDebugMode() {
    this.debugMode = !this.debugMode
    this.logger.setDebugMode(this.debugMode)
  }
  
  /**
   * 获取调试模式状态
   * @returns 是否启用调试模式
   */
  public getDebugMode(): boolean {
    return this.debugMode
  }

  // 切换反链别名块查询状态
  public toggleBackrefAliasQuery(): void {
    this.backrefAliasQueryEnabled = !this.backrefAliasQueryEnabled
    this.saveSettings()
    
    // 清除缓存，因为查询逻辑发生了变化
    this.clearCache()
    
    // 强制更新显示
    this.forceUpdate()
  }

  // 获取反链别名块查询状态
  public getBackrefAliasQueryEnabled(): boolean {
    return this.backrefAliasQueryEnabled
  }
  
  /**
   * 获取当前面板标识
   * 为多面板支持生成唯一的面板标识符
   * @returns 当前面板的唯一标识符
   */
  private getCurrentPanelId(): string {
    const activePanel = document.querySelector('.orca-panel.active')
    if (activePanel) {
      // 优先使用 data-panel-id，然后回退到 id，最后使用 className
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
        this.backrefAliasQueryEnabled = parsedSettings.backrefAliasQueryEnabled ?? false
        const savedMode = parsedSettings.displayMode
        if (savedMode === 'flat' || savedMode === 'grouped') {
          this.displayMode = savedMode
        }
        // 加载页面折叠状态
        if (parsedSettings.pageCollapseStates) {
          this.pageCollapseStates = new Map(
            Object.entries(parsedSettings.pageCollapseStates).map(([key, value]) => [Number(key), value as boolean])
          )
        }
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
        displayMode: this.displayMode,
        queryListHidden: this.queryListHidden,
        backrefAliasQueryEnabled: this.backrefAliasQueryEnabled,
        // 保存页面折叠状态
        pageCollapseStates: Object.fromEntries(this.pageCollapseStates)
      }
      await orca.plugins.setData(this.pluginName, "page-display-settings", JSON.stringify(settings))
    } catch (error) {
      console.error("PageDisplay: Failed to save settings:", error)
      // 保存失败不影响功能，只记录错误
    }
  }

  /**
   * 去重项目，保持唯一性
   * 根据ID和文本内容去重，避免重复显示相同项目
   * @param items 原始项目列表
   * @returns 去重后的项目列表
   */
  private getItemKey(item: PageDisplayItem): string {
    return `${item.id}-${item.text}`
  }

  private deduplicateItems(items: PageDisplayItem[]): PageDisplayItem[] {
    const seen = new Set<string>()
    const uniqueItems: PageDisplayItem[] = []

    for (const item of items) {
      const key = this.getItemKey(item)

      if (!seen.has(key)) {
        seen.add(key)
        uniqueItems.push(item)
      }
    }

    return uniqueItems
  }

  private createEmptyGroups(): DisplayGroupsMap {
    return {
      tag: [],
      referenced: [],
      'referencing-alias': [],
      'child-referenced-alias': [],
      'backref-alias-blocks': []
    } as DisplayGroupsMap
  }


  private buildGroupedItems(
    source: Record<PageDisplayItemType, PageDisplayItem[]>,
    tagBlockIds: DbId[],
    containedInBlockIds: DbId[]
  ): DisplayGroupsMap {
    const result = this.createEmptyGroups()
    const seen = new Set<string>()

    const groupTypes: PageDisplayItemType[] = ['tag', 'referenced', 'referencing-alias', 'child-referenced-alias', 'backref-alias-blocks']
    for (const type of groupTypes) {
      const groupItems = source[type] ?? []
      for (const item of groupItems) {
        const key = this.getItemKey(item)
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
        result[type].push(item)
      }
    }

    this.sortReferencedGroup(result.referenced, tagBlockIds, containedInBlockIds)

    return result
  }

  private sortReferencedGroup(items: PageDisplayItem[], tagBlockIds: DbId[], containedInBlockIds: DbId[]): void {
    items.sort((a, b) => {
      const aIsPriority = tagBlockIds.includes(a.id) || containedInBlockIds.includes(a.id)
      const bIsPriority = tagBlockIds.includes(b.id) || containedInBlockIds.includes(b.id)

      if (aIsPriority && !bIsPriority) return -1
      if (!aIsPriority && bIsPriority) return 1
      return 0
    })
  }

  private cloneGroupedItems(grouped: DisplayGroupsMap): DisplayGroupsMap {
    const clone = this.createEmptyGroups()
    const groupTypes: PageDisplayItemType[] = ['tag', 'referenced', 'referencing-alias', 'child-referenced-alias', 'backref-alias-blocks']
    for (const type of groupTypes) {
      clone[type] = [...(grouped[type] ?? [])]
    }
    return clone
  }

  private groupItemsByType(items: PageDisplayItem[]): DisplayGroupsMap {
    const grouped = this.createEmptyGroups()
    for (const item of items) {
      grouped[item.itemType]?.push(item)
    }
    return grouped
  }

  public getDisplayMode(): DisplayMode {
    return this.displayMode
  }

  public getDisplayModeLabel(mode: DisplayMode = this.displayMode): string {
    switch (mode) {
      case 'grouped':
        return '分组模式'
      default:
        return '列表模式'
    }
  }

  public cycleDisplayMode(): DisplayMode {
    const currentIndex = this.DISPLAY_MODES.indexOf(this.displayMode)
    const nextIndex = (currentIndex + 1) % this.DISPLAY_MODES.length
    const nextMode = this.DISPLAY_MODES[nextIndex]
    this.applyDisplayMode(nextMode)
    return nextMode
  }

  private applyDisplayMode(mode: DisplayMode) {
    if (this.displayMode === mode) {
      return
    }

    this.displayMode = mode
    void this.saveSettings()

    if (this.isInitialized) {
      this.forceUpdate()
    }
  }

  /**
   * 初始化PageDisplay插件
   * 启动编辑器变化监听、定期检查和显示更新
   */
  public async init(): Promise<void> {
    await this.settingsReady.catch(() => undefined)

    this.observeEditorChanges()
    this.startPeriodicCheck()
    this.updateDisplay()
    this.isInitialized = true
  }

  /**
   * 清理资源
   * 断开观察器、清理定时器、移除DOM元素
   */
  public destroy() {
    // 断开DOM观察器
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
    
    // 清理防抖定时器
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout)
      this.updateTimeout = null
    }
    
    // 清理定期检查定时器
    if (this.periodicCheckInterval) {
      clearInterval(this.periodicCheckInterval)
      this.periodicCheckInterval = null
    }
    
    if (this.pageSwitchCheckInterval) {
      clearInterval(this.pageSwitchCheckInterval)
      this.pageSwitchCheckInterval = null
    }

    if (this.tagHierarchyObserver) {
      this.tagHierarchyObserver.disconnect()
      this.tagHierarchyObserver = null
    }

    // 移除所有显示元素
    this.removeDisplay()
    this.isInitialized = false
  }

  /**
   * 监听编辑器变化
   * 使用MutationObserver监听页面变化，检测页面切换等事件
   */
  private observeEditorChanges() {
    if (this.observer) {
      this.observer.disconnect()
    }

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
        // 面板切换时，只更新当前聚焦面板的显示，保持其他面板的显示状态
        this.updateCurrentPanelDisplay()
      }
    })
    
    // 尝试监听指定的页面切换元素
    const pageSwitchElement = document.querySelector("#main > div > div.orca-panel.active > div:nth-child(3)")
    if (pageSwitchElement) {
      this.observer.observe(pageSwitchElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'id']
      })
    } else {
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
    if (this.pageSwitchCheckInterval) {
      clearInterval(this.pageSwitchCheckInterval)
    }

    this.pageSwitchCheckInterval = window.setInterval(() => {
      const pageSwitchElement = document.querySelector("#main > div > div.orca-panel.active > div:nth-child(3)")
      if (pageSwitchElement && this.shouldDisplay()) {
        const currentRootBlockId = this.getCurrentRootBlockId()
        if (currentRootBlockId !== this.lastRootBlockId) {
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
  /**
   * 获取当前根块ID
   * 通过分析DOM结构找到当前活动的根块ID
   * @returns 当前根块ID，如果未找到则返回null
   */
  private getCurrentRootBlockId(): DbId | null {
    try {
      // 直接访问orca.state，不使用useSnapshot
      const { activePanel, panels } = orca.state
      
      // 查找当前激活的面板
      const findPanel = (panel: any): any => {
        if (panel.id === activePanel) {
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
      
      if (currentPanel && currentPanel.viewArgs && currentPanel.viewArgs.blockId) {
        const blockId = currentPanel.viewArgs.blockId
        return blockId
      }
      
      return null
    } catch (error) {
      console.error("Failed to get current root block ID:", error)
      return null
    }
  }

  /**
   * 获取当前页面的折叠状态
   * @returns 当前页面是否处于折叠状态，默认为false（展开）
   */
  private getCurrentPageCollapseState(): boolean {
    const rootBlockId = this.getCurrentRootBlockId()
    if (!rootBlockId) return false
    return this.pageCollapseStates.get(rootBlockId) || false
  }

  /**
   * 设置当前页面的折叠状态
   * @param collapsed 是否折叠
   */
  private setCurrentPageCollapseState(collapsed: boolean): void {
    const rootBlockId = this.getCurrentRootBlockId()
    if (rootBlockId) {
      this.pageCollapseStates.set(rootBlockId, collapsed)
      // 保存设置到本地存储
      this.saveSettings()
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
        return []
      }

      // 获取所有引用当前块的块ID
      const referencingBlockIds = currentBlock.backRefs.map(backRef => backRef.from)
      
      if (referencingBlockIds.length === 0) return []
      
      // 批量获取引用块的详细信息
      const referencingBlocks = await this.cachedApiCall("get-blocks", referencingBlockIds)
      if (!referencingBlocks) return []

      // 过滤出根块是别名块的引用，排除自身块
      const aliasBlocks: Block[] = []
      for (const block of referencingBlocks) {
        // 排除自身块
        if (block.id === blockId) {
          continue
        }
        
        // 检查是否有父块
        if (block.parent) {
          
          // 获取根块信息
          const rootBlock = await this.getBlockInfo(block.parent)
          if (rootBlock && rootBlock.aliases && rootBlock.aliases.length > 0) {
            // 排除自身块
            if (rootBlock.id !== blockId) {
              aliasBlocks.push(rootBlock)
            }
          } else {
          }
        } else {
          // 如果没有父块，检查当前块本身是否是别名块
          if (block.aliases && block.aliases.length > 0) {
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

  // 获取反链中引用的别名块（终极优化版 - 最多2次API调用）
  private async getBackrefAliasBlocks(blockId: DbId): Promise<Block[]> {
    try {
      if (!blockId) return []
      
      // 获取当前块信息
      const currentBlock = await this.getBlockInfo(blockId)
      if (!currentBlock?.backRefs?.length) return []

      // 1. 获取反链块ID
      const backrefBlockIds = currentBlock.backRefs.map(backRef => backRef.from).filter(id => id != null)
      if (backrefBlockIds.length === 0) return []
      
      // 2. 批量获取反链块
      const backrefBlocks = await this.cachedApiCall("get-blocks", backrefBlockIds)
      if (!backrefBlocks?.length) return []
      
      // 3. 收集所有需要查询的块ID（子块 + 被引用块）
      const allBlockIds = new Set<DbId>()
      
      backrefBlocks.forEach((block: any) => {
        // 添加子块ID
        if (block.children?.length) {
          block.children.forEach((childId: any) => allBlockIds.add(childId))
        }
        // 添加被引用块ID
        if (block.refs?.length) {
          block.refs.forEach((ref: any) => {
            if (ref.to) allBlockIds.add(ref.to)
          })
        }
      })
      
      // 4. 一次性获取所有块
      if (allBlockIds.size === 0) return []
      
      const allBlocks = await this.cachedApiCall("get-blocks", Array.from(allBlockIds))
      if (!allBlocks?.length) return []
      
      // 5. 从子块中收集额外的被引用块ID
      const additionalReferencedIds = new Set<DbId>()
      allBlocks.forEach((block: any) => {
        if (block.refs?.length) {
          block.refs.forEach((ref: any) => {
            if (ref.to) additionalReferencedIds.add(ref.to)
          })
        }
      })
      
      // 6. 获取额外的被引用块
      if (additionalReferencedIds.size > 0) {
        const additionalBlocks = await this.cachedApiCall("get-blocks", Array.from(additionalReferencedIds))
        if (additionalBlocks?.length) {
          allBlocks.push(...additionalBlocks)
        }
      }
      
      // 7. 筛选别名块，排除自身块
      return allBlocks.filter((block: any) => 
        block?.aliases?.length > 0 && block.id !== blockId
      )

    } catch (error) {
      this.logError("Failed to get backref alias blocks:", error)
      return []
    }
  }


  // 获取子块中引用的块（当当前块不是别名块时）
  private async getChildReferencedAliasBlocks(blockId: DbId, tagBlockIds: DbId[] = []): Promise<Block[]> {
    try {
      // 获取当前块的信息
      const currentBlock = await this.getBlockInfo(blockId)
      if (!currentBlock) {
        return []
      }

      // 检查当前块是否为别名块
      const isCurrentBlockAlias = currentBlock.aliases && currentBlock.aliases.length > 0
      
      // 注释：子块引用逻辑应该始终执行，不依赖于当前块是否为别名块
      // 这个逻辑用于显示当前块的子块中引用的其他块

      // 检查当前块是否有子块
      if (!currentBlock.children || currentBlock.children.length === 0) {
        return []
      }


      // 获取所有子块的详细信息
      const childBlocks = await this.cachedApiCall("get-blocks", currentBlock.children)
      if (!childBlocks) return []

      // 收集所有子块引用的块ID
      const allReferencedBlockIds: DbId[] = []
      for (const childBlock of childBlocks) {
        if (childBlock.refs && childBlock.refs.length > 0) {
          const childReferencedIds = childBlock.refs.map((ref: any) => ref.to)
          allReferencedBlockIds.push(...childReferencedIds)
        }
      }

      if (allReferencedBlockIds.length === 0) {
        return []
      }

      // 去重
      const uniqueReferencedIds = [...new Set(allReferencedBlockIds)]

      // 批量获取被引用块的详细信息
      const referencedBlocks = await this.cachedApiCall("get-blocks", uniqueReferencedIds)
      if (!referencedBlocks) return []

      // 过滤出被引用的块，排除标签块和自身块
      const childReferencedBlocks: Block[] = []
      for (const block of referencedBlocks) {
        // 排除自身块
        if (block.id === blockId) {
          continue
        }
        
        // 检查是否为标签块
        const isTagBlock = tagBlockIds.includes(block.id)
        if (!isTagBlock) {
          childReferencedBlocks.push(block)
        } else {
        }
      }

      return childReferencedBlocks
    } catch (error) {
      this.logError("Failed to get child referenced alias blocks:", error)
      return []
    }
  }
  

  // 获取被当前块引用的块（当前块引用了哪些块）
  /**
   * 获取被引用的块
   * 分析当前块引用的其他块，包括标签块、属性引用块和内联引用块
   * @param blockId 当前块ID
   * @returns 包含被引用块、标签块ID和内联引用ID的对象
   */
  private async getReferencedBlocks(blockId: DbId): Promise<ReferencedBlocksResult> {
    try {
      
      // 获取当前块的信息
      const currentBlock = await this.getBlockInfo(blockId)
      if (!currentBlock) {
        return { blocks: [], tagBlockIds: [], inlineRefIds: [] }
      }


      // 1. 从当前块文本中解析标签（如 #💬番剧, #⭐五星, #我的标签）
      // 支持带空格的标签，匹配 #标签 格式，直到遇到逗号或行尾
      const tagMatches = (currentBlock.text || "").match(/#[^,\n]+/g) || []
      
      // 提取标签块ID（通过别名查找）
      const tagBlockIds: DbId[] = []
      for (const tagText of tagMatches) {
        const aliasName = tagText.substring(1) // 去掉 # 符号
        
        try {
          const tagResult = await this.cachedApiCall("get-blockid-by-alias", aliasName)
          
          if (tagResult && tagResult.id) {
            tagBlockIds.push(tagResult.id)
          } else {
            
            // 尝试去掉空格后再次查找
            const trimmedAlias = aliasName.trim()
            if (trimmedAlias !== aliasName) {
              const trimmedResult = await this.cachedApiCall("get-blockid-by-alias", trimmedAlias)
              if (trimmedResult && trimmedResult.id) {
                tagBlockIds.push(trimmedResult.id)
              } else {
              }
            }
          }
        } catch (error) {
        }
      }
      

      // 2. 从当前块的引用中获取被引用的块ID
      const allReferencedBlockIds: DbId[] = []
      const inlineRefIds: DbId[] = []
      
      // 检查当前块是否有引用其他块
      if (currentBlock.refs && currentBlock.refs.length > 0) {
        
        // 先获取所有被引用块的详细信息
        const referencedBlocks = await this.cachedApiCall("get-blocks", allReferencedBlockIds)
        if (!referencedBlocks) {
          return { blocks: [], tagBlockIds: [], inlineRefIds: [] }
        }
        
        
        // 分别处理不同类型的引用
        const inlineRefs: BlockRef[] = []
        const propertyRefs: BlockRef[] = []
        
        for (const ref of currentBlock.refs) {
          
          // 获取被引用块的信息
          const referencedBlock = referencedBlocks.find((block: any) => block.id === ref.to)
          const isReferencedBlockAlias = referencedBlock && referencedBlock.aliases && referencedBlock.aliases.length > 0
          
          
          let isInlineRef = false
          
          // 基于DOM结构识别内联引用：data-type="r" 对应数字值
          // 根据DOM结构，内联引用的type可能是特定数字值
          if (ref.type === 0 || ref.type === 1) {
            isInlineRef = true
          }
          // 明确识别属性引用：有 data 属性且不是内联引用
          else if (ref.data && ref.data.length > 0) {
            isInlineRef = false
          }
          // 明确识别内联引用：有 alias 属性
          else if (ref.alias) {
            isInlineRef = true
          }
          // 明确识别内联引用：在标签块ID中
          else if (tagBlockIds.includes(ref.to)) {
            isInlineRef = true
          }
          // 对于非别名块：解析 content 查找 trv/trva 片段
          else if (!isReferencedBlockAlias && referencedBlock) {
            const hasInlineRefInContent = this.checkInlineRefInContent(referencedBlock, ref.to)
            if (hasInlineRefInContent) {
              isInlineRef = true
            } else {
              isInlineRef = false
            }
          }
          // 其他情况：根据 type 值判断
          else if (ref.type !== undefined && ref.type > 0) {
            isInlineRef = false
          }
          // 默认情况：假设是内联引用（因为大多数引用都是内联的）
          else {
            isInlineRef = true
          }
          
          if (isInlineRef) {
            inlineRefs.push(ref)
            inlineRefIds.push(ref.to)
          } else {
            propertyRefs.push(ref)
          }
        }
        
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

      // 排除自身块
      const filteredBlocks = referencedBlocks.filter((block: any) => block.id !== blockId)
      
      this.log("PageDisplay: 找到被引用块数量:", filteredBlocks.length, "块:", filteredBlocks)
      return { blocks: filteredBlocks, tagBlockIds, inlineRefIds }
    } catch (error) {
      this.logError("Failed to get referenced blocks:", error)
      return { blocks: [], tagBlockIds: [], inlineRefIds: [] }
    }
  }

  
  // 带缓存的API调用（委托给API服务）
  private async cachedApiCall(apiType: string, ...args: any[]): Promise<any> {
    return this.apiService.call(apiType, ...args)
  }

  // 获取块信息（委托给API服务）
  private async getBlockInfo(blockId: DbId): Promise<Block | null> {
    return this.apiService.getBlock(blockId)
  }

  // 检查块是否为页面（通过_hide属性）
  /**
   * 检查是否为页面块
   * 判断给定的块是否为页面类型的块
   * @param block 要检查的块
   * @returns 是否为页面块
   */
  private isPageBlock(block: Block): boolean {
    // 检查_hide属性，如果存在且为false，则为页面
    const hideProperty = block.properties?.find(prop => prop.name === "_hide")
    return hideProperty ? !hideProperty.value : true // 默认为页面
  }

  /**
   * 检查块是否是标签块
   * 通过检查块的属性来判断是否为标签块
   * @param block 要检查的块
   * @returns 是否为标签块
   */
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



  // 块ID转换为文本
  /**
   * 创建PageDisplayItem的通用方法
   * 统一处理所有类型的块到PageDisplayItem的转换
   * @param block 块数据
   * @param itemType 项目类型
   * @param displayText 显示文本（可选，默认从块数据生成）
   * @returns 增强后的PageDisplayItem
   */
  private async createPageDisplayItem(
    block: Block, 
    itemType: PageDisplayItemType, 
    displayText?: string
  ): Promise<PageDisplayItem> {
    const finalDisplayText = displayText || 
      (block.aliases && block.aliases[0]) || 
      block.text || 
      `块 ${block.id}`
    
    const aliases = block.aliases && block.aliases.length > 0 ? 
      block.aliases : 
      [finalDisplayText]
    
    const baseItem: PageDisplayItem = {
      id: block.id,
      text: finalDisplayText,
      aliases: aliases,
      isPage: this.isPageBlock(block),
      parentBlock: this.getParentBlock(block),
      _hide: (block as any)._hide,
      _icon: (block as any)._icon,
      itemType: itemType
    }
    
    return await this.enhanceItemForSearch(baseItem, block)
  }

  /**
   * 将块ID转换为文本表示
   * 将数字ID转换为可读的文本，优先使用别名
   * @param blockId 要转换的块ID
   * @returns 文本表示
   */
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
  /**
   * 增强项目搜索数据
   * 为项目添加可搜索的文本数据，包括块内容、属性、引用等
   * @param item 要增强的项目
   * @param block 对应的块数据
   * @returns 增强后的项目
   */
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
  /**
   * 获取父块
   * 从块的属性中提取父块信息
   * @param block 要获取父块的块
   * @returns 父块对象，如果不存在则返回undefined
   */
  private getParentBlock(block: Block): Block | undefined {
    if (block.parent) {
      return orca.state.blocks[block.parent]
    }
    return undefined
  }


  // 更新显示（立即执行）
  /**
   * 更新显示（带防抖）
   * 使用100ms防抖避免频繁更新
   */
  public updateDisplay() {
    this.log("PageDisplay: updateDisplay called")

    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout)
    }

    this.updateTimeout = window.setTimeout(() => {
      this.updateTimeout = null
      this.performUpdate().catch((error) => {
        this.logError("PageDisplay: updateDisplay failed:", error)
      })
    }, 100)
  }

  /**
   * 更新当前面板的显示
   * 只更新当前聚焦面板的显示，不影响其他面板
   */
  private updateCurrentPanelDisplay() {
    this.log("PageDisplay: updateCurrentPanelDisplay called")

    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout)
    }

    this.updateTimeout = window.setTimeout(() => {
      this.updateTimeout = null
      this.performCurrentPanelUpdate().catch((error) => {
        this.logError("PageDisplay: updateCurrentPanelUpdate failed:", error)
      })
    }, 100)
  }
  
  /**
   * 强制更新显示（跳过防抖）
   * 立即执行更新，用于需要立即响应的场景
   */
  public forceUpdate() {
    this.retryCount = 0
    this.performUpdate(true) // 强制更新，跳过shouldSkipUpdate检查
  }

  /**
   * 强制刷新并重新添加元素（暴力解决bug）
   * 完全清理现有元素并重新初始化
   */
  public async forceRefreshAndReinit(): Promise<void> {
    this.log("PageDisplay: 强制刷新并重新添加元素")
    
    // 1. 清理所有现有元素
    this.removeDisplay()
    
    // 2. 清理缓存
    this.clearCache()
    
    // 3. 重置状态
    this.lastRootBlockId = null
    this.retryCount = 0
    
    // 4. 重新初始化
    await this.init()
    
    this.log("PageDisplay: 强制刷新完成")
  }

  /**
   * 执行实际更新
   * 获取当前块信息，处理各种类型的引用关系，创建显示内容
   * @param force 是否强制更新，跳过shouldSkipUpdate检查
   */
  private async performUpdate(force: boolean = false) {
    this.log("performUpdate called", force ? "(forced)" : "")

    await this.settingsReady.catch(() => undefined)

    const rootBlockId = this.getCurrentRootBlockId()
    this.log("rootBlockId =", rootBlockId)
    
    // 检查是否需要跳过更新（除非强制更新）
    if (!force && this.shouldSkipUpdate(rootBlockId)) {
      return
    }
    
    this.lastRootBlockId = rootBlockId
    
    if (!rootBlockId) {
      this.log("PageDisplay: No root block ID, removing display")
      this.removeDisplay()
      return
    }

    // 获取所有需要的数据
    const data = await this.gatherAllData(rootBlockId)
    
    // 处理数据并创建显示项目
    const items = await this.processDataToItems(data)
    
    // 创建显示（无论是否折叠都要创建，折叠状态在创建时处理）
    this.createDisplayFromItems(items, data)
  }

  /**
   * 执行当前面板更新逻辑
   * 只更新当前聚焦面板的显示，保持其他面板的显示状态
   */
  private async performCurrentPanelUpdate() {
    this.log("performCurrentPanelUpdate called")

    await this.settingsReady.catch(() => undefined)

    const rootBlockId = this.getCurrentRootBlockId()
    const currentPanelId = this.getCurrentPanelId()
    this.log("rootBlockId =", rootBlockId, "currentPanelId =", currentPanelId)
    
    // 检查当前面板是否需要跳过更新
    if (this.shouldSkipCurrentPanelUpdate(rootBlockId, currentPanelId)) {
      return
    }
    
    this.lastRootBlockId = rootBlockId
    
    if (!rootBlockId) {
      this.log("PageDisplay: No root block ID, removing current panel display")
      this.removeDisplay(currentPanelId)
      return
    }

    // 获取所有需要的数据
    const data = await this.gatherAllData(rootBlockId)
    
    // 处理数据并创建显示项目
    const items = await this.processDataToItems(data)
    
    // 只更新当前面板的显示
    this.createCurrentPanelDisplay(items, data, currentPanelId)
  }

  /**
   * 检查是否应该跳过更新
   */
  private shouldSkipUpdate(rootBlockId: DbId | null): boolean {
    const panelId = this.getCurrentPanelId()
    const container = this.containers.get(panelId)
    
    if (rootBlockId === this.lastRootBlockId && container && container.parentNode) {
      this.log("Root block ID unchanged and display exists for current panel, skipping update")
      return true
    }
    
    return false
  }

  /**
   * 检查当前面板是否应该跳过更新
   */
  private shouldSkipCurrentPanelUpdate(rootBlockId: DbId | null, panelId: string): boolean {
    const container = this.containers.get(panelId)
    
    if (rootBlockId === this.lastRootBlockId && container && container.parentNode) {
      this.log("Root block ID unchanged and display exists for current panel, skipping current panel update")
      return true
    }
    
    return false
  }

  /**
   * 收集所有需要的数据（修复版）
   */
  private async gatherAllData(rootBlockId: DbId): Promise<GatheredData> {
    // 检查缓存
    const now = Date.now()
    const cachedData = this.dataCache.get(rootBlockId)
    const cacheTime = this.cacheTimestamps.get(rootBlockId)
    
    if (cachedData && cacheTime && (now - cacheTime) < this.CACHE_DURATION) {
      this.log("PageDisplay: 使用缓存数据")
      return cachedData
    }
    
    // 并行加载所有数据，根据设置决定是否执行反链别名块查询
    const [
      childrenTags,
      referencedResult,
      containedInBlockIds,
      referencingAliasBlocks,
      childReferencedAliasBlocks,
      backrefAliasBlocks
    ] = await Promise.all([
      this.getChildrenTags(rootBlockId),
      this.getReferencedBlocks(rootBlockId),
      this.getContainedInBlocks(),
      this.getReferencingAliasBlocks(rootBlockId),
      this.getChildReferencedAliasBlocks(rootBlockId, []),
      this.backrefAliasQueryEnabled ? this.getBackrefAliasBlocks(rootBlockId) : Promise.resolve([])
    ])
    
    const result: GatheredData = {
      childrenTags,
      referencedResult,
      containedInBlockIds,
      referencingAliasBlocks,
      childReferencedAliasBlocks,
      backrefAliasBlocks
    }
    
    // 缓存数据
    this.dataCache.set(rootBlockId, result)
    this.cacheTimestamps.set(rootBlockId, now)
    
    return result
  }

  /**
   * 清理缓存
   */
  private clearCache(): void {
    this.dataCache.clear()
    this.cacheTimestamps.clear()
  }

  /**
   * 清理过期缓存
   */
  private clearExpiredCache(): void {
    const now = Date.now()
    for (const [blockId, timestamp] of this.cacheTimestamps.entries()) {
      if (now - timestamp > this.CACHE_DURATION) {
        this.dataCache.delete(blockId)
        this.cacheTimestamps.delete(blockId)
      }
    }
  }

  /**
   * 处理数据并转换为显示项目（优化版）
   */
  private async processDataToItems(data: GatheredData): Promise<ProcessedItemsResult> {
    const { childrenTags, referencedResult, containedInBlockIds, referencingAliasBlocks, childReferencedAliasBlocks, backrefAliasBlocks } = data
    const { blocks: referencedBlocks, tagBlockIds, inlineRefIds } = referencedResult

    const promises = [] as Promise<PageDisplayItem[]>[]

    promises.push(childrenTags?.length ? this.processTagItems(childrenTags) : Promise.resolve([]))
    promises.push(referencedBlocks?.length ? this.processReferencedItems(referencedBlocks, tagBlockIds) : Promise.resolve([]))
    promises.push(containedInBlockIds?.length ? this.processContainedInItems(containedInBlockIds) : Promise.resolve([]))
    promises.push(referencingAliasBlocks?.length ? this.processReferencingAliasItems(referencingAliasBlocks) : Promise.resolve([]))
    promises.push(childReferencedAliasBlocks?.length ? this.processChildReferencedAliasItems(childReferencedAliasBlocks) : Promise.resolve([]))
    promises.push(backrefAliasBlocks?.length ? this.processBackrefAliasItems(backrefAliasBlocks) : Promise.resolve([]))

    const [tagItems, referencedItems, containedInItems, referencingAliasItems, childReferencedAliasItems, backrefAliasItems] = await Promise.all(promises)

    const groupSource: Record<PageDisplayItemType, PageDisplayItem[]> = {
      tag: tagItems,
      referenced: referencedItems,
      'referencing-alias': referencingAliasItems,
      'child-referenced-alias': childReferencedAliasItems,
      'backref-alias-blocks': backrefAliasItems
    }

    const groupedItems = this.buildGroupedItems(groupSource, tagBlockIds, containedInBlockIds)
    const uniqueItems: PageDisplayItem[] = []

    const groupTypes: PageDisplayItemType[] = ['tag', 'referenced', 'referencing-alias', 'child-referenced-alias', 'backref-alias-blocks']
    for (const type of groupTypes) {
      uniqueItems.push(...groupedItems[type])
    }

    return {
      items: uniqueItems,
      groupedItems,
      tagBlockIds,
      inlineRefIds,
      containedInBlockIds
    }
  }

  /**
   * 处理标签项目
   */
  private async processTagItems(childrenTags: Block[]): Promise<PageDisplayItem[]> {
    const tagItems: PageDisplayItem[] = []
    for (const tag of childrenTags) {
      this.log("PageDisplay: processing tag", tag)
      
      // 使用类型断言处理API返回的数据结构
      const tagWithName = tag as any
      
      // 检查是否有名称或别名
      const hasName = tagWithName.name || (tag.aliases && tag.aliases.length > 0)
      if (hasName) {
        const displayText = (tag.aliases && tag.aliases[0]) || tagWithName.name || tag.text || `Tag ${tag.id}`
        const enhancedItem = await this.createPageDisplayItem(tag, 'tag', displayText)
        tagItems.push(enhancedItem)
        
        this.log("PageDisplay: added tag item", { id: tag.id, text: displayText, aliases: tag.aliases })
      } else {
        this.log("PageDisplay: skipping tag (no name/aliases)", tag)
      }
    }
    return tagItems
  }

  /**
   * 处理被引用项目
   */
  private async processReferencedItems(referencedBlocks: Block[], tagBlockIds: DbId[]): Promise<PageDisplayItem[]> {
    const referencedItems: PageDisplayItem[] = []
    
    for (const block of referencedBlocks) {
      this.log("PageDisplay: processing referenced block", block)
      
      // 检查是否为标签块
      const isTagBlock = tagBlockIds.includes(block.id)
      
      // 被引用的块显示条件：必须有别名或文本内容
      const hasName = (block.aliases && block.aliases.length > 0) || block.text
      
      if (hasName) {
        const displayText = (block.aliases && block.aliases[0]) || block.text || `被引用块 ${block.id}`
        const enhancedItem = await this.createPageDisplayItem(block, 'referenced', displayText)
        referencedItems.push(enhancedItem)
        
        this.log("PageDisplay: added referenced item", { id: block.id, text: displayText, isTagBlock })
      } else {
        this.log("PageDisplay: skipping referenced block (no name/aliases)", block)
      }
    }
    
    return referencedItems
  }

  /**
   * 处理包含于项目
   */
  private async processContainedInItems(containedInBlockIds: DbId[]): Promise<PageDisplayItem[]> {
    const containedInItems: PageDisplayItem[] = []
    
    for (const blockId of containedInBlockIds) {
      try {
        this.log(`PageDisplay: processing contained in block ID: ${blockId}`)
        
        // 获取块数据
        const block = await this.cachedApiCall("get-block", blockId)
        if (!block) {
          this.log(`PageDisplay: block not found for ID: ${blockId}`)
          continue
        }
        
        // 检查是否有名称或别名
        const hasName = (block.aliases && block.aliases.length > 0) || block.text
        if (hasName) {
          const displayText = (block.aliases && block.aliases[0]) || block.text || `包含于块 ${block.id}`
          const enhancedItem = await this.createPageDisplayItem(block, 'referenced', displayText)
          containedInItems.push(enhancedItem)
          
          this.log(`PageDisplay: added contained in item: ${displayText}`)
        } else {
          this.log(`PageDisplay: skipping contained in block (no name/aliases): ${blockId}`)
        }
      } catch (error) {
        this.logError(`Failed to process contained in block ${blockId}:`, error)
      }
    }
    
    return containedInItems
  }

  /**
   * 处理引用别名项目
   */
  private async processReferencingAliasItems(referencingAliasBlocks: Block[]): Promise<PageDisplayItem[]> {
    const referencingAliasItems: PageDisplayItem[] = []
    
    for (const block of referencingAliasBlocks) {
      this.log("PageDisplay: processing referencing alias block", block)
      
      const displayText = (block.aliases && block.aliases[0]) || block.text || `Block ${block.id}`
      const enhancedItem = await this.createPageDisplayItem(block, 'referencing-alias', displayText)
      referencingAliasItems.push(enhancedItem)
      
      this.log("PageDisplay: added referencing alias item", { id: block.id, text: displayText, aliases: block.aliases })
    }
    
    return referencingAliasItems
  }

  /**
   * 处理子块引用别名项目
   */
  private async processChildReferencedAliasItems(childReferencedAliasBlocks: Block[]): Promise<PageDisplayItem[]> {
    const childReferencedAliasItems: PageDisplayItem[] = []
    
    for (const block of childReferencedAliasBlocks) {
      this.log("PageDisplay: processing child referenced alias block", block)
      
      const displayText = (block.aliases && block.aliases[0]) || block.text || `子块引用别名 ${block.id}`
      const enhancedItem = await this.createPageDisplayItem(block, 'child-referenced-alias', displayText)
      childReferencedAliasItems.push(enhancedItem)
      
      this.log("PageDisplay: added child referenced alias item", { id: block.id, text: displayText, aliases: block.aliases })
    }
    
    return childReferencedAliasItems
  }

  /**
   * 处理反链中的别名块项目
   */
  private async processBackrefAliasItems(backrefAliasBlocks: Block[]): Promise<PageDisplayItem[]> {
    const backrefAliasItems: PageDisplayItem[] = []
    
    for (const block of backrefAliasBlocks) {
      this.log("PageDisplay: processing backref alias block", block)
      
      const displayText = (block.aliases && block.aliases[0]) || block.text || `反链别名 ${block.id}`
      const enhancedItem = await this.createPageDisplayItem(block, 'backref-alias-blocks', displayText)
      backrefAliasItems.push(enhancedItem)
      
      this.log("PageDisplay: added backref alias item", { id: block.id, text: displayText, aliases: block.aliases })
    }
    
    return backrefAliasItems
  }

  /**
   * 从处理后的项目创建显示
   */
  private createDisplayFromItems(items: ProcessedItemsResult, data: GatheredData) {
    const { items: uniqueItems, groupedItems, tagBlockIds, inlineRefIds, containedInBlockIds } = items
    
    this.log("PageDisplay: Creating display with", uniqueItems.length, "unique items")
    
    try {
      this.createDisplay(uniqueItems, groupedItems, tagBlockIds, inlineRefIds, containedInBlockIds)
      this.retryCount = 0 // 重置重试计数
      
      // 更新查询列表按钮状态
      this.updateQueryListButton()
    } catch (error) {
      this.logError("PageDisplay: Failed to create display:", error)
      this.handleDisplayError(error)
    }
  }

  /**
   * 为当前面板创建显示
   * 只更新指定面板的显示，不影响其他面板
   */
  private createCurrentPanelDisplay(items: ProcessedItemsResult, data: GatheredData, panelId: string) {
    const { items: uniqueItems, groupedItems, tagBlockIds, inlineRefIds, containedInBlockIds } = items
    
    this.log("PageDisplay: Creating current panel display with", uniqueItems.length, "unique items for panel", panelId)
    
    try {
      this.createDisplayForPanel(uniqueItems, groupedItems, tagBlockIds, inlineRefIds, containedInBlockIds, panelId)
      this.retryCount = 0 // 重置重试计数
      
      // 更新当前面板的查询列表按钮状态
      this.updateQueryListButton()
    } catch (error) {
      this.logError("PageDisplay: Failed to create current panel display:", error)
      this.handleDisplayError(error)
    }
  }
  
  // 处理显示错误（委托给错误处理器）
  private handleDisplayError(error: any) {
    this.retryCount++
    this.errorHandler.handleDisplayError(error, this.retryCount, this.maxRetries, () => {
      this.updateDisplay()
    })
  }

  // 获取子标签（委托给API服务）
  private async getChildrenTags(blockId: DbId): Promise<Block[]> {
    return this.apiService.getChildrenTags(blockId)
  }

  /**
   * 解析标签层级结构，获取被引用的包含于块
   * 从DOM中解析标签层级结构，找到包含于块并获取其ID
   * @returns 包含于块的ID数组
   */
  private async getContainedInBlocks(): Promise<DbId[]> {
    const maxRetries = 3
    const retryDelay = 500 // 500ms
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.log(`开始解析标签层级结构... (尝试 ${attempt}/${maxRetries})`)
        
        // 查找标签层级结构元素 - 尝试多种选择器
        let hierarchyElement = document.querySelector('.orca-repr-tag-hierarchy')
        
        // 如果没找到，尝试在活动面板中查找
        if (!hierarchyElement) {
          const activePanel = document.querySelector('.orca-panel.active')
          if (activePanel) {
            hierarchyElement = activePanel.querySelector('.orca-repr-tag-hierarchy')
            this.log("在活动面板中查找标签层级结构元素")
          }
        }
        
        // 如果还是没找到，尝试查找所有可能的层级结构元素
        if (!hierarchyElement) {
          const allHierarchyElements = document.querySelectorAll('.orca-repr-tag-hierarchy')
          this.log(`找到 ${allHierarchyElements.length} 个标签层级结构元素`)
          
          // 选择第一个可见的元素
          for (const element of allHierarchyElements) {
            const rect = element.getBoundingClientRect()
            if (rect.width > 0 && rect.height > 0) {
              hierarchyElement = element
              this.log("选择第一个可见的标签层级结构元素")
              break
            }
          }
        }
        
        if (!hierarchyElement) {
          this.log(`尝试 ${attempt}: 未找到标签层级结构元素`)
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay))
            continue
          }
          return []
        }

        // 查找第一个 span.orca-repr-tag-hierarchy-text
        const firstSpan = hierarchyElement.querySelector('span.orca-repr-tag-hierarchy-text')
        if (!firstSpan) {
          this.log(`尝试 ${attempt}: 未找到第一个标签层级文本元素`)
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay))
            continue
          }
          return []
        }

        const tagText = firstSpan.textContent?.trim()
        if (!tagText) {
          this.log(`尝试 ${attempt}: 标签层级文本为空`)
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay))
            continue
          }
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
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay))
            continue
          }
          return []
        }
      } catch (error) {
        this.logError(`解析标签层级结构失败 (尝试 ${attempt}):`, error)
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay))
          continue
        }
        return []
      }
    }
    
    return []
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
      this.toggleQueryListVisibility()
    })
    
    // 添加到 page-display-left-content 后面
    const leftContent = document.querySelector('.page-display-left-content')
    if (leftContent && leftContent.parentNode) {
      leftContent.parentNode.insertBefore(button, leftContent.nextSibling)
    } else {
      // 如果找不到 leftContent，添加到 body
      document.body.appendChild(button)
    }
    
    // 存储按钮引用
    this.queryListToggleButtons.set(panelId, button)
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
        
        // 查找该列表中的 .orca-query-list-block 元素
        const queryBlocks = list.querySelectorAll('.orca-query-list-block')
        queryBlocks.forEach((queryBlock, blockIndex) => {
          // 检查该 .orca-query-list-block 是否也包含特定块
          const hasNestedTargetBlock = queryBlock.querySelector('.orca-block.orca-container.orca-block-postfix.orca-query-list-block-block')
          if (hasNestedTargetBlock) {
            // 根据持久化状态决定是否隐藏
            (queryBlock as HTMLElement).style.display = this.queryListHidden ? 'none' : ''
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

  /**
   * 创建显示元素
   * 根据项目列表创建完整的页面空间显示界面
   * @param items 要显示的项目列表
   * @param tagBlockIds 标签块ID列表，用于图标分配
   * @param inlineRefIds 内联引用块ID列表，用于图标分配
   * @param containedInBlockIds 包含于块ID列表，用于图标分配
   */
  private createDisplay(items: PageDisplayItem[], groupedItems: DisplayGroupsMap, tagBlockIds: DbId[] = [], inlineRefIds: DbId[] = [], containedInBlockIds: DbId[] = [], panelId?: string) {
    this.log("PageDisplay: createDisplay called with", items.length, "items")
    this.log("PageDisplay: Items details:", items)
    this.log("PageDisplay: Tag block IDs:", tagBlockIds)
    
    // 获取面板标识（使用传入的panelId或当前面板ID）
    const targetPanelId = panelId || this.getCurrentPanelId()
    this.log("PageDisplay: Target panel ID:", targetPanelId)
    
    // 移除目标面板的现有显示
    this.removeDisplay(targetPanelId)

    // 查找目标位置，支持重试
    let targetElement = this.findTargetElement()
    
    // 如果找不到目标元素，延迟重试
    if (!targetElement) {
      this.log("PageDisplay: No target element found, retrying in 500ms...")
      setTimeout(() => {
        targetElement = this.findTargetElement()
        if (targetElement) {
          this.createDisplay(items, groupedItems)
        } else {
          this.logError("PageDisplay: Still no target element found after retry")
          throw new Error("No target element found")
        }
      }, 500)
      return
    }

    // 创建容器
    const container = document.createElement('div')
    container.setAttribute('data-panel-id', targetPanelId) // 标记所属面板
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
    
    // 设置初始状态：根据当前页面状态设置箭头方向
    if (!this.getCurrentPageCollapseState()) {
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
      const currentCollapsed = this.getCurrentPageCollapseState()
      const newCollapsed = !currentCollapsed
      this.setCurrentPageCollapseState(newCollapsed)
      
      if (newCollapsed) {
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
          if (this.getCurrentPageCollapseState()) {
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
            } else if (item.itemType === 'backref-alias-blocks') {
              // 反链中的别名块图标
              this.log(`PageDisplay: 分配问号放大镜图标 (ti-zoom-question) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-zoom-question'
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
    
    // 根据当前页面的折叠状态设置初始显示
    if (this.getCurrentPageCollapseState()) {
      list.style.display = 'none'
      list.style.opacity = '0'
      list.style.maxHeight = '0'
      arrow.style.transform = 'rotate(0deg)'
      if (searchContainer.style.display !== 'none') {
        searchContainer.style.display = 'none'
        searchContainer.style.opacity = '0'
        searchContainer.style.maxHeight = '0'
      }
    }

    // 插入到目标位置 - 在 placeholder 的下方
    const placeholderElement = targetElement.querySelector('.orca-block-editor-placeholder')
    this.log("PageDisplay: placeholderElement found:", placeholderElement !== null)
    this.log("PageDisplay: targetElement:", targetElement)
    
    let insertSuccess = false
    let insertMethod = ""
    
    if (placeholderElement) {
      try {
        this.log("PageDisplay: Checking parentNode and nextSibling...")
        const parentNode = placeholderElement.parentNode
        const nextSibling = placeholderElement.nextSibling
        
        this.log("PageDisplay: parentNode:", parentNode)
        this.log("PageDisplay: nextSibling:", nextSibling)
        
        if (parentNode) {
          if (nextSibling) {
            // nextSibling存在，正常插入
            this.log("PageDisplay: Inserting before nextSibling")
            parentNode.insertBefore(container, nextSibling)
            insertMethod = "insertBefore-nextSibling"
          } else {
            // nextSibling为null，插入到父元素末尾
            this.log("PageDisplay: nextSibling is null, appending to parent")
            parentNode.appendChild(container)
            insertMethod = "appendChild-parent"
          }
          insertSuccess = true
        } else {
          this.logWarn("PageDisplay: parentNode is null, falling back to targetElement")
          targetElement.appendChild(container)
          insertMethod = "appendChild-targetElement"
          insertSuccess = true
        }
      } catch (error) {
        this.logError("PageDisplay: Insert before failed:", error)
        // 插入失败，回退到targetElement
        targetElement.appendChild(container)
        insertMethod = "appendChild-fallback"
        insertSuccess = true
      }
    } else {
      this.log("PageDisplay: No placeholder found, inserting at end of target element")
      targetElement.appendChild(container)
      insertMethod = "appendChild-noPlaceholder"
      insertSuccess = true
    }
    
    // 验证插入是否成功
    if (insertSuccess) {
      setTimeout(() => {
        const stillInDOM = document.contains(container)
        const hasParent = container.parentNode !== null
        const containerVisible = container.offsetHeight > 0
        
        this.log(`PageDisplay: Insert verification (${insertMethod}):`)
        this.log("  - Still in DOM:", stillInDOM)
        this.log("  - Has parent:", hasParent)
        this.log("  - Parent element:", container.parentNode)
        this.log("  - Container visible:", containerVisible)
        
        if (!stillInDOM) {
          this.logError("PageDisplay: Container was removed from DOM! Attempting recovery...")
          // 尝试重新插入到相同的目标位置
          setTimeout(() => {
            if (targetElement && !document.contains(container)) {
              try {
                targetElement.appendChild(container)
                this.log("PageDisplay: Recovery insert attempted")
              } catch (recoveryError) {
                this.logError("PageDisplay: Recovery insert failed:", recoveryError)
              }
            }
          }, 100)
        }
      }, 50) // 等待DOM稳定
    }
    
    // 存储容器引用
    this.containers.set(targetPanelId, container)
    
    this.log("PageDisplay: Container inserted using method:", insertMethod)
    this.log("PageDisplay: Container parent:", container.parentNode)
    this.log("PageDisplay: Container visible:", container.offsetHeight > 0)
    
    // 创建查询列表控制按钮
    this.createQueryListToggleButton()
    this.updateQueryListButton()
  }

  /**
   * 为指定面板创建显示元素
   * 只影响指定面板，不影响其他面板
   * @param items 要显示的项目列表
   * @param tagBlockIds 标签块ID列表
   * @param inlineRefIds 内联引用块ID列表
   * @param containedInBlockIds 包含于块ID列表
   * @param panelId 目标面板ID
   */
  private createDisplayForPanel(items: PageDisplayItem[], groupedItems: DisplayGroupsMap, tagBlockIds: DbId[] = [], inlineRefIds: DbId[] = [], containedInBlockIds: DbId[] = [], panelId: string) {
    this.log("PageDisplay: createDisplayForPanel called with", items.length, "items for panel", panelId)
    
    // 移除指定面板的现有显示
    this.removeDisplay(panelId)
    
    // 复用createDisplay的逻辑，但指定面板ID
    this.createDisplay(items, groupedItems, tagBlockIds, inlineRefIds, containedInBlockIds, panelId)
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
  
  /**
   * 检查是否应该显示
   * 判断当前是否应该显示页面空间内容
   * @returns 是否应该显示
   */
  private shouldDisplay(): boolean {
    const rootBlockId = this.getCurrentRootBlockId()
    return rootBlockId !== null && this.isInitialized
  }
  
  /**
   * 检查是否正在显示
   * 判断当前是否有显示内容
   * @returns 是否正在显示
   */
  private isDisplaying(): boolean {
    const panelId = this.getCurrentPanelId()
    const container = this.containers.get(panelId)
    if (!container || !container.parentNode) {
      return false
    }
    
    // 检查容器是否在DOM中且可见
    const isInDOM = document.contains(container)
    const hasParent = container.parentNode !== null
    
    // 即使容器被折叠（display: none），只要容器存在且已插入DOM，就认为正在显示
    // 因为折叠状态是用户的选择，不应该影响"是否正在显示"的判断
    return isInDOM && hasParent
  }

  // 检查是否存在查询列表
  private hasQueryList(): boolean {
    const queryList = document.querySelector('.orca-query-list')
    if (!queryList) {
      return false
    }
    
    const queryListBlock = queryList.querySelector('.orca-block.orca-container.orca-block-postfix.orca-query-list-block-block')
    const hasBlock = queryListBlock !== null
    return hasBlock
  }

  // 切换查询列表显示状态
  private toggleQueryListVisibility() {
    // 切换持久化状态
    this.queryListHidden = !this.queryListHidden
    
    // 应用新的状态
    this.applyQueryListHideLogic()
    
    // 保存设置
    this.saveSettings()
    
    // 显示通知
    const status = this.queryListHidden ? "隐藏" : "显示"
    orca.notify("info", `底部查询别名块已${status}`)
  }

  // 查找目标元素 - 支持多种查找策略，优先查找当前活跃面板
  /**
   * 查找目标元素
   * 在页面空间中查找合适的位置插入显示元素
   * @returns 目标DOM元素，如果未找到则返回null
   */
  private findTargetElement(): Element | null {
    const strategies = [
      // 策略1: 查找当前活跃面板中的orca-hideable容器（非隐藏状态）
      () => {
        const activePanel = document.querySelector('.orca-panel.active')
        if (activePanel) {
          this.log("PageDisplay: 找到活跃面板，查找orca-hideable容器")
          // 查找非隐藏的orca-hideable
          const hideableElements = activePanel.querySelectorAll('.orca-hideable')
          for (const hideableElement of hideableElements) {
            // 检查是否包含hidden类
            if (!hideableElement.classList.contains('orca-hideable-hidden')) {
              this.log("PageDisplay: 找到非隐藏的orca-hideable:", hideableElement)
              const noneEditableElement = hideableElement.querySelector('.orca-block-editor-none-editable')
              if (noneEditableElement) {
                const placeholderElement = noneEditableElement.querySelector('.orca-block-editor-placeholder')
                if (placeholderElement) {
                  this.log("PageDisplay: 在orca-hideable中找到目标元素")
                  return noneEditableElement
                }
              }
            } else {
              this.log("PageDisplay: 隐藏的orca-hideable，跳过:", hideableElement)
            }
          }
        }
        return null
      },
      // 策略2: 查找当前活跃面板中的编辑器容器
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
      // 策略3: 查找当前活跃面板中的任何包含placeholder的编辑器元素
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
      // 策略4: 查找当前活跃面板中的编辑器相关容器
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
      // 策略5: 降级到全局查找（兼容单面板模式）
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
      // 策略6: 查找任何包含placeholder的编辑器元素
      () => {
        const placeholderElement = document.querySelector('.orca-block-editor-placeholder')
        if (placeholderElement) {
          return placeholderElement.closest('[class*="block-editor"]') || placeholderElement.parentElement
        }
        return null
      },
      // 策略7: 查找任何编辑器相关容器
      () => {
        return document.querySelector('[class*="block-editor"]') ||
               document.querySelector('[class*="editor"]') ||
               document.querySelector('.editor-container')
      },
      // 策略8: 降级到body
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

  /**
   * 移除显示
   * 移除指定面板或所有面板的显示内容
   * @param panelId 可选的面板ID，如果不提供则移除所有面板
   */
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
      
      // 方法1: 使用 orca.nav.goTo (推荐方法)
      if (orca.nav && orca.nav.goTo) {
        try {
          orca.nav.goTo("block", { blockId: blockId })
          return
        } catch (navError) {
        }
      }
      
      // 方法2: 使用 orca.nav.openInLastPanel (在新面板中打开)
      if (orca.nav && orca.nav.openInLastPanel) {
        try {
          orca.nav.openInLastPanel("block", { blockId: blockId })
          return
        } catch (panelError) {
        }
      }
      
      // 方法3: 尝试使用 core.editor.focusIn 命令
      if (orca.commands && orca.commands.invokeEditorCommand) {
        try {
          await orca.commands.invokeEditorCommand("core.editor.focusIn", null, blockId)
          return
        } catch (focusError) {
        }
      }
      
      // 方法4: 尝试使用 core.editor.openOnTheSide 命令
      if (orca.commands && orca.commands.invokeEditorCommand) {
        try {
          await orca.commands.invokeEditorCommand("core.editor.openOnTheSide", null, blockId)
          return
        } catch (sideError) {
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

  /**
   * 设置DOM观察器
   * 监听页面变化，当标签层级结构出现时自动更新显示
   */
  private setupDOMObserver() {
    if (this.tagHierarchyObserver) {
      this.tagHierarchyObserver.disconnect()
    }

    this.tagHierarchyObserver = new MutationObserver((mutations) => {
      let shouldUpdate = false

      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element
              if (element.querySelector?.('.orca-repr-tag-hierarchy') ||
                  element.classList?.contains('orca-repr-tag-hierarchy')) {
                this.log('检测到新的标签层级结构元素，准备更新显示')
                shouldUpdate = true
              }
            }
          })
        }
      })

      if (shouldUpdate) {
        setTimeout(() => {
          this.log('DOM变化触发显示更新')
          this.updateDisplay()
        }, 100)
      }
    })

    if (!document.body) {
      return
    }

    this.tagHierarchyObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false
    })

    this.log('DOM观察器已启动')
  }
}
