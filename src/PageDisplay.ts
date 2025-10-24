import type { Block, DbId, BlockRef } from "./orca.d.ts"
import pinyinMatch from 'pinyin-match'

/**
 * 标签信息接口
 */
interface TagInfo {
  name: string
  icon?: string
  _icon?: string
}

/**
 * 子块信息接口
 */
interface ChildBlockInfo {
  id: DbId
  text: string
  aliases: string[]
  level: number // 层级深度
}

/**
 * 日期过滤配置接口
 */
interface DateFilterConfig {
  enabled: boolean
  startDate?: Date
  endDate?: Date
  relativeDate?: 'today' | 'yesterday' | 'last7days' | 'last30days' | 'last90days' | 'thisYear'
  dateField: 'created' | 'modified' // 按创建日期还是修改日期过滤
}

/**
 * 排序字段类型
 */
type SortField = 'created' | 'modified' | 'name'

/**
 * 排序方向类型
 */
type SortOrder = 'asc' | 'desc'

/**
 * 排序配置接口
 */
interface SortConfig {
  field: SortField
  order: SortOrder
}

/**
 * 面板状态接口
 */
interface PanelState {
  searchText: string
  isExpanded: boolean
  isSearchVisible: boolean
  typeFilters: Record<string, boolean>
  dateFilter: DateFilterConfig
  scrollTop: number
  sortConfig: SortConfig
}

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
   * 从块中提取标签信息
   * @param block 块对象
   * @returns 标签数组
   */
  private extractTagsFromBlock(block: Block): string[] {
    const tags: string[] = []
    
    // 从properties中提取标签
    if (block.properties && block.properties.length > 0) {
      for (const prop of block.properties) {
        // 检查是否为标签属性
        if (prop.name === 'tag' || prop.name === 'tags') {
          if (prop.value) {
            if (Array.isArray(prop.value)) {
              tags.push(...prop.value)
            } else if (typeof prop.value === 'string') {
              // 如果是字符串，按逗号分割
              const tagList = prop.value.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0)
              tags.push(...tagList)
            }
          }
        }
      }
    }
    
    // 从aliases中提取可能的标签（以#开头的别名）
    if (block.aliases && block.aliases.length > 0) {
      for (const alias of block.aliases) {
        if (alias.startsWith('#')) {
          tags.push(alias.substring(1)) // 去掉#符号
        }
      }
    }
    
    // 从文本内容中提取标签（#标签格式）
    if (block.text) {
      const tagMatches = block.text.match(/#[\w\u4e00-\u9fa5：:]+/g)
      if (tagMatches) {
        for (const tagMatch of tagMatches) {
          const tag = tagMatch.substring(1) // 去掉#符号
          if (!tags.includes(tag)) {
            tags.push(tag)
          }
        }
      }
    }
    
    return [...new Set(tags)] // 去重
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
   * 获取统一的颜色规范 - 使用Orca原生变量
   */
  private getColors() {
    return {
      text: 'var(--orca-color-text-1)',
      textSecondary: 'var(--orca-color-text-2)',
      textMuted: 'var(--orca-color-text-2)',
      border: 'var(--orca-color-border)',
      background: 'var(--orca-color-bg-1)',
      backgroundHover: 'var(--orca-color-bg-2)',
      backgroundSubtle: 'var(--orca-color-bg-3)',
      highlightBg: 'var(--orca-color-result-highlight)',
      highlightText: 'var(--orca-color-text-1)',
      primary: 'var(--orca-color-primary-5)',
      primaryLight: 'var(--orca-color-primary-3)',
      primaryBg: 'var(--orca-color-primary-1)'
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
      'page-display-filter-icon',
      'page-display-date-filter-icon',
      'page-display-sort-icon',
      'page-display-icons-toggle-icon',
      'page-display-multiline-toggle-icon',
      'page-display-multicolumn-toggle-icon',
      'page-display-search-container',
      'page-display-search-input',
      'page-display-list',
      'page-display-item',
      'page-display-item-icon',
      'page-display-item-text',
      'page-display-highlight',
      'page-display-query-list-hidden'
    ]
    
    styleClasses.forEach(cls => element.classList.remove(cls))
    
    // 添加新的样式类
    element.classList.add(className)
    
    // 应用对应的样式
    this.applyClassStyles(element, className)
  }

  /**
   * 根据类名应用具体样式 - 优化为只添加CSS类名
   */
  private applyClassStyles(element: HTMLElement, className: string) {
    // 现在只添加CSS类名，样式由CSS文件处理
    // 这样可以更好地维护样式，避免内联样式的问题
    
    switch (className) {
      case 'page-display-container':
        // 不需要设置内联样式，CSS文件已经处理了所有样式
        break
        
      case 'page-display-title-container':
        // 不需要设置内联样式，CSS文件已经处理了所有样式
        break
        
      case 'page-display-left-content':
        // CSS文件已处理
        break
        
      case 'page-display-arrow':
        // CSS文件已处理
        break
        
      case 'page-display-title':
        // CSS文件已处理
        break
        
      case 'page-display-count':
        // CSS文件已处理
        break
        
      case 'page-display-search-icon':
        // CSS文件已处理
        break
        
      case 'page-display-filter-icon':
      case 'page-display-date-filter-icon':
      case 'page-display-sort-icon':
      case 'page-display-icons-toggle-icon':
      case 'page-display-multiline-toggle-icon':
      case 'page-display-multicolumn-toggle-icon':
        // CSS文件已处理
        break
        
      case 'page-display-search-container':
        // CSS文件已处理
        break
        
      case 'page-display-search-input':
        // CSS文件已处理，包括焦点样式
        break
        
      case 'page-display-list':
        // CSS文件已处理，包括滚动条样式
        break
        
      case 'page-display-item':
        // CSS文件已处理
        break
        
      case 'page-display-item-icon':
      case 'page-display-item-text':
      case 'page-display-highlight':
        // CSS文件已处理
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
 * 面板状态接口
 */
interface PanelState {
  /** 搜索内容 */
  searchText: string
  /** 是否展开 */
  isExpanded: boolean
  /** 是否显示搜索框 */
  isSearchVisible: boolean
  /** 类型过滤状态 */
  typeFilters: Record<string, boolean>
  /** 滚动位置 */
  scrollTop: number
}

/**
 * 页面显示项目类型
 */
type PageDisplayItemType = 'tag' | 'referenced-tag' | 'property-ref-alias' | 'property-ref-block' | 'contained-in' | 'inline-ref' | 'referencing-alias' | 'child-referenced-alias' | 'child-referenced-tag-alias' | 'child-referenced-inline' | 'backref-alias-blocks' | 'backref' | 'recursive-backref' | 'recursive-backref-alias' | 'page-direct-children' | 'page-recursive-children'

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
  /** 创建时间 */
  created?: number
  /** 修改时间 */
  modified?: number
  /** 搜索相关字段 */
  /** 包含所有可搜索文本的字符串 */
  searchableText?: string
  /** 结构化的搜索数据 */
  searchableData?: SearchableData
  /** 子块信息（用于显示匹配的子块内容） */
  childBlocksInfo?: ChildBlockInfo[]
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
  /** 属性引用块ID列表 */
  propertyRefIds: DbId[]
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
  /** 子块引用标签别名块列表 */
  childReferencedTagAliasBlocks: Block[]
  /** 子块引用内联块列表 */
  childReferencedInlineBlocks: Block[]
  /** 页面直接子块列表 */
  pageDirectChildren: Block[]
  /** 页面递归子块列表 */
  pageRecursiveChildren: Block[]
  /** 反链中的别名块列表 */
  backrefAliasBlocks: Block[]
  /** 直接反链块列表 */
  backrefBlocks: Block[]
  /** 递归反链块列表 */
  recursiveBackrefBlocks: Block[]
  /** 递归反链别名块列表 */
  recursiveBackrefAliasBlocks: Block[]
}

/**
 * 页面空间显示插件主类
 * 负责在页面空间中显示当前块的相关信息，包括标签、引用关系等
 */
export class PageDisplay {
  /** 多面板支持：存储每个面板的显示容器，key为面板标识 */
  private containers: Map<string, HTMLElement> = new Map()
  /** 多面板支持：存储每个面板的状态，包括搜索内容、展开状态等 */
  private panelStates: Map<string, PanelState> = new Map()
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
  /** 控制默认折叠状态，新页面默认是否折叠 */
  private defaultCollapsed: boolean = true
  /** 控制是否多行显示项目文本 */
  private multiLine: boolean = false
  /** 控制是否多列显示项目 */
  private multiColumn: boolean = false
  /** 显示模式 */
  private displayMode: DisplayMode = 'flat'
  /** 可用显示模式列表 */
  private readonly DISPLAY_MODES: DisplayMode[] = ['flat', 'grouped']
  /** 控制是否支持Journal页面，默认启用 */
  private journalPageSupport: boolean = true
  /** Journal页面块ID缓存，key为日期字符串，value为块ID */
  private journalBlockCache: Map<string, DbId> = new Map()
  /** Journal页面块ID缓存时间戳 */
  private journalBlockCacheTimestamps: Map<string, number> = new Map()
  /** Journal页面缓存有效期（10分钟） */
  private readonly JOURNAL_CACHE_DURATION = 10 * 60 * 1000
  
  // === 状态管理属性 ===
  /** 缓存上次的根块ID，用于避免重复更新 */
  private lastRootBlockId: DbId | null = null
  /** 控制反链别名块查询是否开启，默认关闭 */
  private backrefAliasQueryEnabled: boolean = true
  /** 防抖定时器，避免频繁更新 */
  private updateTimeout: number | null = null
  /** 懒加载批次大小 */
  private readonly LAZY_LOAD_BATCH_SIZE = 120
  /** 懒加载阈值，超过此数量自动启用懒加载 */
  private readonly LAZY_LOAD_THRESHOLD = 70
  /** 当前显示的批次 */
  private currentBatch: number = 0
  /** 滚动加载观察器 */
  private scrollObserver: IntersectionObserver | null = null
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
  
  // === 日期格式配置 ===
  /** 日期格式主题配置 */
  private readonly THEME = 12
  
  /**
   * 获取日期格式字符串
   * @returns 日期格式字符串
   */
  private getDateFormat(): string {
    // 根据 THEME 值返回对应的日期格式
    switch (this.THEME) {
      case 12:
        return 'yyyy-MM-dd'
      default:
        return 'yyyy-MM-dd'
    }
  }
  
  // === 类型过滤控制属性 ===
  /** 控制类型过滤面板是否显示 */
  private showTypeFilters: boolean = false
  /** 类型过滤状态，key为类型，value为是否显示 */
  private typeFilters: Map<PageDisplayItemType, boolean> = new Map()
  
  // === 日期过滤控制属性 ===
  /** 控制日期过滤面板是否显示 */
  private showDateFilters: boolean = false
  /** 日期过滤配置 */
  private dateFilterConfig: DateFilterConfig = {
    enabled: false,
    dateField: 'created'
  }
  
  // === 缓存相关属性已移至ApiService ===

  /**
   * 构造函数
   * @param pluginName 插件名称，用于数据存储和API调用
   */
  constructor(pluginName: string) {
    this.pluginName = pluginName
    this.logger = new Logger(false) // 关闭调试模式
    this.styleManager = new StyleManager()
    this.apiService = new ApiService(this.logger)
    this.errorHandler = new ErrorHandler(this.logger, this.maxRetries)
    // 加载用户设置
    this.settingsReady = this.loadSettings()
    // 调试模式默认关闭
    this.debugMode = false
    
    // 初始化类型过滤状态，默认所有类型都显示
    this.initializeTypeFilters()
    
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

  /**
   * 获取面板状态
   * @param panelId 面板ID
   * @returns 面板状态，如果不存在则返回默认状态
   */
  private getPanelState(panelId: string): PanelState {
    if (!this.panelStates.has(panelId)) {
      this.panelStates.set(panelId, {
        searchText: '',
        isExpanded: !this.defaultCollapsed,
        isSearchVisible: false,
        typeFilters: {},
        dateFilter: {
          enabled: false,
          dateField: 'created'
        },
        scrollTop: 0,
        sortConfig: {
          field: 'created',
          order: 'desc'
        }
      })
    }
    return this.panelStates.get(panelId)!
  }

  /**
   * 保存面板状态
   * @param panelId 面板ID
   * @param state 面板状态
   */
  private savePanelState(panelId: string, state: PanelState) {
    this.panelStates.set(panelId, state)
  }

  /**
   * 恢复面板状态到DOM
   * @param panelId 面板ID
   * @param container 容器元素
   */
  private restorePanelState(panelId: string, container: HTMLElement) {
    const state = this.getPanelState(panelId)
    
    // 恢复搜索框状态
    const searchInput = container.querySelector('.page-display-search-input') as HTMLInputElement
    if (searchInput) {
      searchInput.value = state.searchText
    }
    
    // 恢复展开状态
    const list = container.querySelector('.page-display-list') as HTMLElement
    const arrow = container.querySelector('.page-display-arrow') as HTMLElement
    if (list && arrow) {
      if (state.isExpanded) {
        list.style.display = this.multiColumn ? 'grid' : 'block'
        list.style.opacity = '1'
        list.style.maxHeight = '1000px'
        arrow.innerHTML = '<i class="ti ti-chevron-down"></i>'
      } else {
        list.style.display = 'none'
        list.style.opacity = '0'
        list.style.maxHeight = '0'
        arrow.innerHTML = '<i class="ti ti-chevron-right"></i>'
      }
    }
    
    // 恢复搜索框显示状态
    const searchContainer = container.querySelector('.page-display-search-container') as HTMLElement
    if (searchContainer) {
      if (state.isSearchVisible) {
        searchContainer.style.display = 'block'
        searchContainer.style.opacity = '1'
        searchContainer.style.maxHeight = '100px'
      } else {
        searchContainer.style.display = 'none'
        searchContainer.style.opacity = '0'
        searchContainer.style.maxHeight = '0'
      }
    }
    
    // 如果有搜索内容，确保搜索框值正确（避免重复触发）
    if (state.searchText && state.searchText.trim()) {
      if (searchInput && searchInput.value !== state.searchText) {
        searchInput.value = state.searchText
        // 延迟触发搜索，确保DOM完全渲染
        setTimeout(() => {
          const inputEvent = new Event('input', { bubbles: true })
          searchInput.dispatchEvent(inputEvent)
        }, 50)
      }
    }
    
    // 恢复滚动位置 - 在内容渲染前就设置，避免闪烁
    if (state.scrollTop > 0) {
      const list = container.querySelector('.page-display-list') as HTMLElement
      if (list) {
        // 立即设置滚动位置，避免闪烁
        list.scrollTop = state.scrollTop
        
        // 如果内容还没完全渲染，再次设置确保位置正确
        setTimeout(() => {
          if (list.scrollTop !== state.scrollTop) {
            list.scrollTop = state.scrollTop
          }
        }, 50)
      }
    }
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
    
    // 强制更新显示以应用新的图标设置
    this.forceUpdate()
  }

  /**
   * 获取图标显示状态
   * @returns 是否显示图标
   */
  public getIconsEnabled(): boolean {
    return this.showIcons
  }

  /**
   * 设置Journal页面支持状态
   * @param enabled 是否启用Journal页面支持
   */
  public setJournalPageSupport(enabled: boolean): void {
    console.log("PageDisplay: Setting journalPageSupport to:", enabled)
    this.journalPageSupport = enabled
    this.saveSettings()
    
    // 无论启用还是禁用，都强制更新显示以应用新设置
    this.forceUpdate()
  }

  /**
   * 获取Journal页面支持状态
   * @returns 是否启用Journal页面支持
   */
  public getJournalPageSupport(): boolean {
    return this.journalPageSupport
  }

  /**
   * 设置图标显示状态
   * @param enabled 是否显示图标
   */
  public setIconsEnabled(enabled: boolean): void {
    this.showIcons = enabled
    this.saveSettings()
    this.forceUpdate()
  }

  /**
   * 设置多行显示状态
   * @param enabled 是否多行显示
   */
  public setMultiLine(enabled: boolean): void {
    this.multiLine = enabled
    this.saveSettings()
    this.forceUpdate()
  }

  /**
   * 设置多列显示状态
   * @param enabled 是否多列显示
   */
  public setMultiColumn(enabled: boolean): void {
    this.multiColumn = enabled
    this.saveSettings()
    this.forceUpdate()
  }

  /**
   * 设置显示模式
   * @param mode 显示模式
   */
  public setDisplayMode(mode: 'flat' | 'grouped'): void {
    this.displayMode = mode
    this.saveSettings()
    this.forceUpdate()
  }

  /**
   * 切换多行显示状态
   * 控制项目文本是否以多行形式显示
   */
  public toggleMultiLine() {
    this.multiLine = !this.multiLine
    
    // 保存设置到本地存储
    this.saveSettings()
    
    // 强制更新显示以应用新的多行设置
    this.forceUpdate()
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
    
    // 强制更新显示以应用新的多列设置
    this.forceUpdate()
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
   * 从块中提取标签信息（包含颜色和图标）
   * @param block 块对象
   * @returns 标签信息数组
   */
  private extractTagsFromBlock(block: Block): TagInfo[] {
    const tags: TagInfo[] = []
    
    // 从properties中提取标签
    if (block.properties && block.properties.length > 0) {
      for (const prop of block.properties) {
        // 检查是否为标签属性
        if (prop.name === 'tag' || prop.name === 'tags') {
          if (prop.value) {
            if (Array.isArray(prop.value)) {
              // 处理数组形式的标签
              for (const tagValue of prop.value) {
                if (typeof tagValue === 'string') {
                  tags.push({ name: tagValue })
                } else if (typeof tagValue === 'object' && tagValue !== null) {
                  // 处理对象形式的标签，可能包含颜色和图标
                  const tagObj = tagValue as any
                  tags.push({
                    name: tagObj.name || tagObj.text || String(tagValue),
                    icon: tagObj.icon || tagObj._icon
                  })
                }
              }
            } else if (typeof prop.value === 'string') {
              // 如果是字符串，按逗号分割
              const tagList = prop.value.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0)
              for (const tagName of tagList) {
                tags.push({ name: tagName })
              }
            }
          }
        }
      }
    }
    
    // 从aliases中提取可能的标签（以#开头的别名）
    if (block.aliases && block.aliases.length > 0) {
      for (const alias of block.aliases) {
        if (alias.startsWith('#')) {
          tags.push({ name: alias.substring(1) }) // 去掉#符号
        }
      }
    }
    
    // 从文本内容中提取标签（#标签格式）
    if (block.text) {
      const tagMatches = block.text.match(/#[\w\u4e00-\u9fa5：:]+/g)
      if (tagMatches) {
        for (const tagMatch of tagMatches) {
          const tag = tagMatch.substring(1) // 去掉#符号
          if (!tags.some(t => t.name === tag)) {
            tags.push({ name: tag })
          }
        }
      }
    }
    
    // 去重
    const uniqueTags: TagInfo[] = []
    const seenNames = new Set<string>()
    for (const tag of tags) {
      if (!seenNames.has(tag.name)) {
        seenNames.add(tag.name)
        uniqueTags.push(tag)
      }
    }
    
    return uniqueTags
  }

  /**
   * 创建标签元素
   * @param tags 标签信息数组
   * @returns 标签容器元素
   */
  private createTagElements(tags: TagInfo[]): HTMLElement | null {
    if (!tags || tags.length === 0) {
      return null
    }

    const tagContainer = document.createElement('div')
    tagContainer.className = 'page-display-tags-container'

    for (const tag of tags) {
      const tagElement = document.createElement('div')
      tagElement.className = 'page-display-tag'

      // 移除颜色逻辑，使用默认样式

      // 创建标签内容
      const tagContent = document.createElement('span')
      tagContent.className = 'page-display-tag-content'
      tagContent.textContent = `#${tag.name}`

      // 添加图标
      if (tag.icon) {
        const iconElement = document.createElement('span')
        iconElement.className = `ti ${tag.icon} page-display-tag-icon`
        tagElement.appendChild(iconElement)
      }

      tagElement.appendChild(tagContent)

      // 添加点击事件
      tagElement.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        
        // 检查是否按下了Shift键
        if (e.shiftKey) {
          // Shift+点击：在侧面板打开标签块
          this.openTagInSidePanel(tag.name)
        } else {
          // 普通点击：在当前面板打开标签块
          this.openTag(tag.name)
        }
      })

      tagContainer.appendChild(tagElement)
    }

    return tagContainer
  }


  /**
   * 为列表项包装器添加标签显示（在面包屑下方）
   * @param itemWrapper 列表项包装器元素
   * @param blockId 块ID
   */
  private async addTagsToItemWrapper(itemWrapper: HTMLElement, blockId: DbId): Promise<void> {
    try {
      const block = await this.apiService.getBlock(blockId)
      if (block) {
        const tags = this.extractTagsFromBlock(block)
        if (tags.length > 0) {
          const tagContainer = this.createTagElements(tags)
          if (tagContainer) {
            itemWrapper.appendChild(tagContainer)
          }
        }
      }
    } catch (error) {
      this.logger.error("Failed to get block for tags:", error)
    }
  }

  /**
   * 为列表项添加标签显示
   * @param itemElement 列表项元素
   * @param blockId 块ID
   */
  private async addTagsToItem(itemElement: HTMLElement, blockId: DbId): Promise<void> {
    try {
      const block = await this.apiService.getBlock(blockId)
      if (block) {
        const tags = this.extractTagsFromBlock(block)
        if (tags.length > 0) {
          const tagContainer = this.createTagElements(tags)
          if (tagContainer) {
            itemElement.appendChild(tagContainer)
          }
        }
      }
    } catch (error) {
      this.logger.error("Failed to get block for tags:", error)
    }
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


  // === 类型过滤相关方法 ===
  
  /**
   * 初始化类型过滤状态
   * 默认所有类型都显示
   */
  private initializeTypeFilters(): void {
    const allTypes: PageDisplayItemType[] = [
      'tag', 'referenced-tag', 'property-ref-alias', 'property-ref-block', 'contained-in', 'inline-ref', 'page-direct-children', 'page-recursive-children', 'referencing-alias', 'child-referenced-alias', 'child-referenced-tag-alias', 'child-referenced-inline',
      'backref-alias-blocks', 'backref', 'recursive-backref', 'recursive-backref-alias'
    ]
    
    allTypes.forEach(type => {
      this.typeFilters.set(type, true) // 默认都显示
    })
  }

  /**
   * 切换类型过滤面板显示状态
   */
  public toggleTypeFilters(): void {
    this.showTypeFilters = !this.showTypeFilters
    this.saveSettings()
    
    // 如果当前面板有显示，重新创建以应用新的过滤面板设置
    const panelId = this.getCurrentPanelId()
    const container = this.containers.get(panelId)
    if (container) {
      this.updateDisplay()
    }
  }

  /**
   * 获取类型过滤面板显示状态
   * @returns 是否显示类型过滤面板
   */
  public getTypeFiltersVisible(): boolean {
    return this.showTypeFilters
  }

  /**
   * 设置特定类型的显示状态
   * @param type 类型
   * @param visible 是否显示
   */
  public setTypeFilter(type: PageDisplayItemType, visible: boolean): void {
    this.typeFilters.set(type, visible)
    this.saveSettings()
    
    // 注意：不在这里调用updateDisplay，由调用方决定何时更新
  }

  /**
   * 获取特定类型的显示状态
   * @param type 类型
   * @returns 是否显示
   */
  public getTypeFilter(type: PageDisplayItemType): boolean {
    return this.typeFilters.get(type) ?? true
  }

  /**
   * 切换特定类型的显示状态
   * @param type 类型
   */
  public toggleTypeFilter(type: PageDisplayItemType): void {
    const currentState = this.getTypeFilter(type)
    this.setTypeFilter(type, !currentState)
  }

  /**
   * 设置所有类型的显示状态
   * @param visible 是否显示所有类型
   */
  public setAllTypeFilters(visible: boolean): void {
    this.typeFilters.forEach((_, type) => {
      this.typeFilters.set(type, visible)
    })
    this.saveSettings()
    
    // 注意：不在这里调用updateDisplay，由调用方决定何时更新
  }

  /**
   * 获取所有类型的过滤状态
   * @returns 类型过滤状态映射
   */
  public getAllTypeFilters(): Map<PageDisplayItemType, boolean> {
    return new Map(this.typeFilters)
  }

  // === 日期过滤相关方法 ===
  
  /**
   * 切换日期过滤面板显示状态
   */
  public toggleDateFilters(): void {
    this.showDateFilters = !this.showDateFilters
    this.saveSettings()
    
    // 如果当前面板有显示，重新创建以应用新的过滤面板设置
    const panelId = this.getCurrentPanelId()
    const container = this.containers.get(panelId)
    if (container) {
      this.updateDisplay()
    }
  }

  /**
   * 获取日期过滤面板显示状态
   * @returns 是否显示日期过滤面板
   */
  public getDateFiltersVisible(): boolean {
    return this.showDateFilters
  }

  /**
   * 设置日期过滤配置
   * @param config 日期过滤配置
   */
  public setDateFilterConfig(config: DateFilterConfig): void {
    this.dateFilterConfig = config
    this.saveSettings()
  }

  /**
   * 获取日期过滤配置
   * @returns 日期过滤配置
   */
  public getDateFilterConfig(): DateFilterConfig {
    return this.dateFilterConfig
  }

  /**
   * 应用日期过滤
   * @param items 要过滤的项目列表
   * @returns 过滤后的项目列表
   */
  private applyDateFilter(items: PageDisplayItem[]): PageDisplayItem[] {
    if (!this.dateFilterConfig.enabled) {
      return items
    }

    const now = new Date()
    let startDate: Date | null = null
    let endDate: Date | null = null

    // 处理相对日期
    if (this.dateFilterConfig.relativeDate) {
      switch (this.dateFilterConfig.relativeDate) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
          break
        case 'yesterday':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
          endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          break
        case 'last7days':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          endDate = now
          break
        case 'last30days':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          endDate = now
          break
        case 'last90days':
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
          endDate = now
          break
        case 'thisYear':
          startDate = new Date(now.getFullYear(), 0, 1)
          endDate = new Date(now.getFullYear() + 1, 0, 1)
          break
      }
    } else {
      // 使用绝对日期
      startDate = this.dateFilterConfig.startDate || null
      endDate = this.dateFilterConfig.endDate || null
    }

    if (!startDate && !endDate) {
      return items
    }

    return items.filter(item => {
      // 获取项目的日期（创建或修改日期）
      const itemDate = this.getItemDate(item)
      if (!itemDate) {
        return false
      }

      // 检查日期范围
      if (startDate && itemDate < startDate) {
        return false
      }
      if (endDate && itemDate >= endDate) {
        return false
      }

      return true
    })
  }

  /**
   * 获取项目的日期
   * @param item 项目
   * @returns 项目日期
   */
  private getItemDate(item: PageDisplayItem): Date | null {
    if (this.dateFilterConfig.dateField === 'created') {
      return item.created ? new Date(item.created) : null
    } else {
      return item.modified ? new Date(item.modified) : null
    }
  }

  /**
   * 创建类型过滤控制面板
   * @returns 类型过滤面板元素
   */
  private createTypeFilterPanel(): HTMLElement {
    const panel = document.createElement('div')
    panel.className = 'page-display-type-filter-panel'
    this.applyStyles(panel, 'page-display-type-filter-panel')
    
    // 设置初始显示状态和透明度过渡
    panel.style.cssText = `
      display: ${this.showTypeFilters ? 'block' : 'none'};
      opacity: ${this.showTypeFilters ? '1' : '0'};
      visibility: ${this.showTypeFilters ? 'visible' : 'hidden'};
      transition: opacity 0.3s ease, visibility 0.3s ease, transform 0.3s ease;
      transform: translateY(${this.showTypeFilters ? '0' : '-10px'});
    `
    
    // 创建面板标题和按钮容器
    const titleContainer = document.createElement('div')
    titleContainer.className = 'page-display-type-filter-title-container'
    this.applyStyles(titleContainer, 'page-display-type-filter-title-container')
    
    // 设置flex布局，标题在左，按钮在右
    titleContainer.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      padding: 8px;
    `
    
    // 创建标题
    const title = document.createElement('div')
    title.className = 'page-display-type-filter-title'
    title.textContent = '类型过滤'
    this.applyStyles(title, 'page-display-type-filter-title')
    
    // 创建标题右侧的按钮
    const titleButtons = document.createElement('div')
    titleButtons.className = 'page-display-type-filter-title-buttons'
    this.applyStyles(titleButtons, 'page-display-type-filter-title-buttons')
    
    // 设置按钮水平排列
    titleButtons.style.cssText = `
      display: flex;
      gap: 4px;
      align-items: center;
    `
    
    const selectAllBtn = document.createElement('button')
    selectAllBtn.textContent = '全选'
    selectAllBtn.className = 'page-display-type-filter-title-btn'
    
    // 设置按钮样式 - 使用 CSS 变量适配主题
    selectAllBtn.style.cssText = `
      padding: 3px 6px;
      font-size: 11px;
      background: var(--orca-color-bg-2);
      color: var(--orca-color-text-1);
      border: var(--orca-border-general);
      border-radius: 3px;
      cursor: pointer;
      transition: all 0.2s;
    `
    
    // 添加悬浮效果
    selectAllBtn.addEventListener('mouseenter', () => {
      selectAllBtn.style.background = 'var(--orca-color-bg-3)'
    })
    selectAllBtn.addEventListener('mouseleave', () => {
      selectAllBtn.style.background = 'var(--orca-color-bg-2)'
    })
    selectAllBtn.addEventListener('click', () => {
      optionsContainer.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        (checkbox as HTMLInputElement).checked = true
      })
    })
    
    const selectNoneBtn = document.createElement('button')
    selectNoneBtn.textContent = '全不选'
    selectNoneBtn.className = 'page-display-type-filter-title-btn'
    
    // 应用相同的按钮样式
    selectNoneBtn.style.cssText = selectAllBtn.style.cssText
    selectNoneBtn.addEventListener('mouseenter', () => {
      selectNoneBtn.style.background = 'var(--orca-color-bg-3)'
    })
    selectNoneBtn.addEventListener('mouseleave', () => {
      selectNoneBtn.style.background = 'var(--orca-color-bg-2)'
    })
    selectNoneBtn.addEventListener('click', () => {
      optionsContainer.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        (checkbox as HTMLInputElement).checked = false
      })
    })
    
    const confirmBtn = document.createElement('button')
    confirmBtn.textContent = '确认'
    confirmBtn.className = 'page-display-type-filter-confirm-btn'
    
    // 设置确认按钮样式 - 使用 Orca 主题色
    confirmBtn.style.cssText = `
      padding: 3px 6px;
      font-size: 11px;
      background: var(--orca-color-primary-5);
      color: var(--orca-color-bg-1);
      border: 1px solid var(--orca-color-primary-6);
      border-radius: 3px;
      cursor: pointer;
      transition: all 0.2s;
    `
    
    confirmBtn.addEventListener('mouseenter', () => {
      confirmBtn.style.background = 'var(--orca-color-primary-6)'
    })
    confirmBtn.addEventListener('mouseleave', () => {
      confirmBtn.style.background = 'var(--orca-color-primary-5)'
    })
    confirmBtn.addEventListener('click', () => {
      // 应用所有复选框的状态
      optionsContainer.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        const input = checkbox as HTMLInputElement
        const type = input.id.replace('type-filter-', '') as PageDisplayItemType
        this.setTypeFilter(type, input.checked)
      })
      
      // 强制更新显示
      this.forceUpdate()
      
      // 隐藏面板 - 立即设置display为none，避免空白区域
      this.toggleTypeFilters()
      
      // 延迟隐藏面板，确保forceUpdate完成后再隐藏
      setTimeout(() => {
        panel.style.display = 'none'
        panel.style.opacity = '0'
        panel.style.visibility = 'hidden'
        panel.style.transform = 'translateY(-10px)'
      }, 0)
    })
    
    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = '取消'
    cancelBtn.className = 'page-display-type-filter-cancel-btn'
    
    // 设置取消按钮样式 - 使用 CSS 变量适配主题
    cancelBtn.style.cssText = `
      padding: 3px 6px;
      font-size: 11px;
      background: var(--orca-color-bg-2);
      color: var(--orca-color-text-1);
      border: var(--orca-border-general);
      border-radius: 3px;
      cursor: pointer;
      transition: all 0.2s;
    `
    
    cancelBtn.addEventListener('mouseenter', () => {
      cancelBtn.style.background = 'var(--orca-color-bg-3)'
    })
    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.style.background = 'var(--orca-color-bg-2)'
    })
    cancelBtn.addEventListener('click', () => {
      // 恢复原始状态
      optionsContainer.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        const input = checkbox as HTMLInputElement
        const type = input.id.replace('type-filter-', '') as PageDisplayItemType
        input.checked = this.getTypeFilter(type)
      })
      // 隐藏面板 - 立即设置display为none，避免空白区域
      this.toggleTypeFilters()
      panel.style.display = 'none'
      panel.style.opacity = '0'
      panel.style.visibility = 'hidden'
      panel.style.transform = 'translateY(-10px)'
    })
    
    titleButtons.appendChild(selectAllBtn)
    titleButtons.appendChild(selectNoneBtn)
    titleButtons.appendChild(confirmBtn)
    titleButtons.appendChild(cancelBtn)
    
    titleContainer.appendChild(title)
    titleContainer.appendChild(titleButtons)
    
    // 创建过滤选项容器 - 使用水平多列布局
    const optionsContainer = document.createElement('div')
    optionsContainer.className = 'page-display-type-filter-options'
    
    // 直接设置内联样式确保布局正确
    optionsContainer.style.cssText = `
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-top: 10px;
      padding: 8px;
    `
    
    // 类型配置 - 重新组织为更紧凑的布局
const typeConfigs = [
  { type: 'referenced-tag', label: '被引用的标签块', icon: 'ti-arrow-up' },
  { type: 'contained-in', label: '包含于父块', icon: 'ti-arrow-up' },
  { type: 'tag', label: '包含于子标签', icon: 'ti-hash' },
  { type: 'inline-ref', label: '内联引用', icon: 'ti-link' },
  { type: 'property-ref-alias', label: '别名属性引用', icon: 'ti-align-box-center-stretch' },
  { type: 'property-ref-block', label: '块属性引用', icon: 'ti-align-box-center-stretch' },
  { type: 'page-direct-children', label: '页面直接子块', icon: 'ti-folder' },
  { type: 'page-recursive-children', label: '页面递归子块', icon: 'ti-folder-tree' },
  { type: 'child-referenced-alias', label: '页面内联别名', icon: 'ti-cube' },
  { type: 'child-referenced-tag-alias', label: '页面标签', icon: 'ti-hash' },
  { type: 'child-referenced-inline', label: '页面内联块引用', icon: 'ti-link' },
  { type: 'backref-alias-blocks', label: '递归直接反链别名属性', icon: 'ti-zoom-question' },
  { type: 'referencing-alias', label: '直接反链别名', icon: 'ti-arrow-right' },
  { type: 'backref', label: '直接反链块', icon: 'ti-arrow-down' },
  { type: 'recursive-backref', label: '递归反链块', icon: 'ti-arrow-down-right' },
  { type: 'recursive-backref-alias', label: '递归反链别名', icon: 'ti-arrow-right' }
]
    
    // 创建每个类型的复选框 - 更紧凑的布局
    typeConfigs.forEach(config => {
      const option = document.createElement('div')
      option.className = 'page-display-type-filter-option'
      
      // 设置选项样式 - 使用 CSS 变量适配主题
      option.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px;
        border-radius: 4px;
        background: var(--orca-color-bg-2);
        transition: background 0.2s;
      `
      
      // 添加悬浮效果
      option.addEventListener('mouseenter', () => {
        option.style.background = 'var(--orca-color-bg-3)'
      })
      option.addEventListener('mouseleave', () => {
        option.style.background = 'var(--orca-color-bg-2)'
      })
      
      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.id = `type-filter-${config.type}`
      checkbox.checked = this.getTypeFilter(config.type as PageDisplayItemType)
      checkbox.className = 'page-display-type-filter-checkbox'
      
      // 设置复选框样式
      checkbox.style.cssText = `
        margin: 0;
        margin-right: 6px;
        cursor: pointer;
      `
      
      const label = document.createElement('label')
      label.htmlFor = `type-filter-${config.type}`
      label.className = 'page-display-type-filter-label'
      
      // 设置标签样式 - 使用 CSS 变量适配主题
      label.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        cursor: pointer;
        font-size: 12px;
        color: var(--orca-color-text-1);
        user-select: none;
      `
      
      // 创建标签内容 - 更紧凑
      const labelContent = document.createElement('div')
      labelContent.className = 'page-display-type-filter-label-content'
      
      // 设置标签内容样式
      labelContent.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
      `
      
      // 添加图标 - 使用 CSS 变量适配主题
      const icon = document.createElement('span')
      icon.className = `ti ${config.icon}`
      icon.style.cssText = `
        font-size: 12px;
        color: var(--orca-color-text-2);
      `
      
      // 添加文本 - 使用 CSS 变量适配主题
      const text = document.createElement('span')
      text.textContent = config.label
      text.style.cssText = `
        font-size: 12px;
        color: var(--orca-color-text-1);
      `
      
      labelContent.appendChild(icon)
      labelContent.appendChild(text)
      label.appendChild(labelContent)
      
      // 不添加实时更新事件监听器，改为在确认时统一处理
      
      option.appendChild(checkbox)
      option.appendChild(label)
      optionsContainer.appendChild(option)
    })
    
    
    panel.appendChild(titleContainer)
    panel.appendChild(optionsContainer)
    
    return panel
  }

  /**
   * 更新类型过滤面板中的复选框状态
   * @param panel 过滤面板元素
   */
  private updateTypeFilterPanelCheckboxes(panel: HTMLElement): void {
    const checkboxes = panel.querySelectorAll('input[type="checkbox"]')
    checkboxes.forEach((checkbox) => {
      const input = checkbox as HTMLInputElement
      const type = input.id.replace('type-filter-', '') as PageDisplayItemType
      input.checked = this.getTypeFilter(type)
    })
  }

  /**
   * 创建日期过滤控制面板
   * @returns 日期过滤面板元素
   */
  private createDateFilterPanel(): HTMLElement {
    const panel = document.createElement('div')
    panel.className = 'page-display-date-filter-panel'
    this.applyStyles(panel, 'page-display-date-filter-panel')
    
    // 设置初始显示状态和透明度过渡，使用虎鲸笔记原生样式变量
    panel.style.cssText = `
      display: ${this.showDateFilters ? 'block' : 'none'};
      opacity: ${this.showDateFilters ? '1' : '0'};
      visibility: ${this.showDateFilters ? 'visible' : 'hidden'};
      transition: opacity 0.3s ease, visibility 0.3s ease, transform 0.3s ease;
      transform: translateY(${this.showDateFilters ? '0' : '-10px'});
      background: var(--orca-color-bg-1);
      border: var(--orca-border-general);
      border-radius: var(--orca-radius-lg);
      box-shadow: var(--orca-shadow-popup);
      padding: var(--orca-spacing-lg);
      min-width: 300px;
      z-index: var(--orca-zindex-modal);
      font-family: var(--orca-fontfamily-ui);
      color: var(--orca-color-text-1);
    `
    
    // 创建面板标题和按钮容器
    const titleContainer = document.createElement('div')
    titleContainer.className = 'page-display-date-filter-title-container'
    this.applyStyles(titleContainer, 'page-display-date-filter-title-container')
    
    // 设置flex布局，标题在左，按钮在右，使用虎鲸笔记原生样式变量
    titleContainer.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--orca-spacing-md);
      padding: var(--orca-spacing-sm);
      border-bottom: var(--orca-border-separator);
    `
    
    // 创建标题
    const title = document.createElement('div')
    title.className = 'page-display-date-filter-title'
    title.textContent = '日期过滤'
    this.applyStyles(title, 'page-display-date-filter-title')
    
    // 设置标题样式，使用虎鲸笔记原生样式变量
    title.style.cssText = `
      font-size: var(--orca-fontsize-md);
      font-weight: var(--orca-fontweight-lg);
      color: var(--orca-color-text-1);
    `
    
    // 创建标题右侧的按钮
    const titleButtons = document.createElement('div')
    titleButtons.className = 'page-display-date-filter-title-buttons'
    this.applyStyles(titleButtons, 'page-display-date-filter-title-buttons')
    
    // 设置按钮水平排列，使用虎鲸笔记原生样式变量
    titleButtons.style.cssText = `
      display: flex;
      gap: var(--orca-spacing-xs);
      align-items: center;
    `
    
    const clearBtn = document.createElement('button')
    clearBtn.textContent = '清除'
    clearBtn.className = 'page-display-date-filter-clear-btn'
    
    // 设置按钮样式，使用虎鲸笔记原生样式变量
    clearBtn.style.cssText = `
      padding: var(--orca-spacing-xs) var(--orca-spacing-sm);
      font-size: var(--orca-fontsize-2xs);
      font-weight: var(--orca-fontweight-md);
      background: var(--orca-color-bg-2);
      color: var(--orca-color-text-1);
      border: var(--orca-border-general);
      border-radius: var(--orca-radius-sm);
      cursor: pointer;
      transition: all 0.2s ease;
      font-family: var(--orca-fontfamily-ui);
    `
    
    // 添加悬浮效果，使用虎鲸笔记原生颜色变量
    clearBtn.addEventListener('mouseenter', () => {
      clearBtn.style.background = 'var(--orca-color-bg-3)'
      clearBtn.style.borderColor = 'var(--orca-color-primary-3)'
    })
    clearBtn.addEventListener('mouseleave', () => {
      clearBtn.style.background = 'var(--orca-color-bg-2)'
      clearBtn.style.borderColor = 'var(--orca-color-border)'
    })
    clearBtn.addEventListener('click', () => {
      // 清除所有日期过滤设置
      this.dateFilterConfig = {
        enabled: false,
        dateField: 'created'
      }
      this.saveSettings()
      this.forceUpdate()
      this.toggleDateFilters()
    })
    
    const confirmBtn = document.createElement('button')
    confirmBtn.textContent = '确认'
    confirmBtn.className = 'page-display-date-filter-confirm-btn'
    
    // 设置确认按钮样式，使用虎鲸笔记原生样式变量
    confirmBtn.style.cssText = `
      padding: var(--orca-spacing-xs) var(--orca-spacing-sm);
      font-size: var(--orca-fontsize-2xs);
      font-weight: var(--orca-fontweight-md);
      background: var(--orca-color-success-5);
      color: var(--orca-color-white);
      border: 1px solid var(--orca-color-success-5);
      border-radius: var(--orca-radius-sm);
      cursor: pointer;
      transition: all 0.2s ease;
      font-family: var(--orca-fontfamily-ui);
    `
    
    confirmBtn.addEventListener('mouseenter', () => {
      confirmBtn.style.background = 'var(--orca-color-success-6)'
      confirmBtn.style.borderColor = 'var(--orca-color-success-6)'
    })
    confirmBtn.addEventListener('mouseleave', () => {
      confirmBtn.style.background = 'var(--orca-color-success-5)'
      confirmBtn.style.borderColor = 'var(--orca-color-success-5)'
    })
    confirmBtn.addEventListener('click', () => {
      // 应用日期过滤设置
      this.forceUpdate()
      this.toggleDateFilters()
    })
    
    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = '取消'
    cancelBtn.className = 'page-display-date-filter-cancel-btn'
    
    // 设置取消按钮样式，使用虎鲸笔记原生样式变量
    cancelBtn.style.cssText = `
      padding: var(--orca-spacing-xs) var(--orca-spacing-sm);
      font-size: var(--orca-fontsize-2xs);
      font-weight: var(--orca-fontweight-md);
      background: var(--orca-color-dangerous-5);
      color: var(--orca-color-white);
      border: 1px solid var(--orca-color-dangerous-5);
      border-radius: var(--orca-radius-sm);
      cursor: pointer;
      transition: all 0.2s ease;
      font-family: var(--orca-fontfamily-ui);
    `
    
    cancelBtn.addEventListener('mouseenter', () => {
      cancelBtn.style.background = 'var(--orca-color-dangerous-6)'
      cancelBtn.style.borderColor = 'var(--orca-color-dangerous-6)'
    })
    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.style.background = 'var(--orca-color-dangerous-5)'
      cancelBtn.style.borderColor = 'var(--orca-color-dangerous-5)'
    })
    cancelBtn.addEventListener('click', () => {
      // 隐藏面板
      this.toggleDateFilters()
    })
    
    titleButtons.appendChild(clearBtn)
    titleButtons.appendChild(confirmBtn)
    titleButtons.appendChild(cancelBtn)
    
    titleContainer.appendChild(title)
    titleContainer.appendChild(titleButtons)
    
    // 创建日期过滤选项容器
    const optionsContainer = document.createElement('div')
    optionsContainer.className = 'page-display-date-filter-options'
    
    // 设置样式，使用虎鲸笔记原生样式变量
    optionsContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: var(--orca-spacing-md);
      margin-top: var(--orca-spacing-md);
      padding: var(--orca-spacing-sm);
    `
    
    // 启用日期过滤复选框
    const enableContainer = document.createElement('div')
    enableContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: var(--orca-spacing-sm);
      padding: var(--orca-spacing-sm);
      background: var(--orca-color-bg-2);
      border-radius: var(--orca-radius-sm);
      border: var(--orca-border-general);
    `
    
    const enableCheckbox = document.createElement('input')
    enableCheckbox.type = 'checkbox'
    enableCheckbox.id = 'date-filter-enable'
    enableCheckbox.checked = this.dateFilterConfig.enabled
    enableCheckbox.style.cssText = `
      margin: 0;
      cursor: pointer;
    `
    
    const enableLabel = document.createElement('label')
    enableLabel.htmlFor = 'date-filter-enable'
    enableLabel.textContent = '启用日期过滤'
    enableLabel.style.cssText = `
      cursor: pointer;
      font-size: var(--orca-fontsize-sm);
      font-weight: var(--orca-fontweight-md);
      color: var(--orca-color-text-1);
      user-select: none;
      font-family: var(--orca-fontfamily-ui);
    `
    
    enableContainer.appendChild(enableCheckbox)
    enableContainer.appendChild(enableLabel)
    
    // 日期字段选择
    const dateFieldContainer = document.createElement('div')
    dateFieldContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: var(--orca-spacing-sm);
      padding: var(--orca-spacing-sm);
      background: var(--orca-color-bg-2);
      border-radius: var(--orca-radius-sm);
      border: var(--orca-border-general);
    `
    
    const dateFieldLabel = document.createElement('label')
    dateFieldLabel.textContent = '按日期字段:'
    dateFieldLabel.style.cssText = `
      font-size: var(--orca-fontsize-sm);
      font-weight: var(--orca-fontweight-md);
      color: var(--orca-color-text-1);
      user-select: none;
      font-family: var(--orca-fontfamily-ui);
    `
    
    const dateFieldSelect = document.createElement('select')
    dateFieldSelect.id = 'date-filter-field'
    dateFieldSelect.value = this.dateFilterConfig.dateField
    dateFieldSelect.style.cssText = `
      padding: var(--orca-spacing-xs) var(--orca-spacing-sm);
      font-size: var(--orca-fontsize-sm);
      font-weight: var(--orca-fontweight-md);
      background: var(--orca-color-bg-1);
      color: var(--orca-color-text-1);
      border: var(--orca-border-general);
      border-radius: var(--orca-radius-sm);
      cursor: pointer;
      font-family: var(--orca-fontfamily-ui);
    `
    
    const createdOption = document.createElement('option')
    createdOption.value = 'created'
    createdOption.textContent = '创建日期'
    
    const modifiedOption = document.createElement('option')
    modifiedOption.value = 'modified'
    modifiedOption.textContent = '修改日期'
    
    dateFieldSelect.appendChild(createdOption)
    dateFieldSelect.appendChild(modifiedOption)
    
    dateFieldContainer.appendChild(dateFieldLabel)
    dateFieldContainer.appendChild(dateFieldSelect)
    
    // 相对日期选择，使用虎鲸笔记原生样式变量
    const relativeDateContainer = document.createElement('div')
    relativeDateContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: var(--orca-spacing-sm);
      padding: var(--orca-spacing-sm);
      background: var(--orca-color-bg-2);
      border-radius: var(--orca-radius-sm);
      border: var(--orca-border-general);
    `
    
    const relativeDateLabel = document.createElement('label')
    relativeDateLabel.textContent = '相对日期:'
    relativeDateLabel.style.cssText = `
      font-size: var(--orca-fontsize-sm);
      font-weight: var(--orca-fontweight-md);
      color: var(--orca-color-text-1);
      user-select: none;
      font-family: var(--orca-fontfamily-ui);
    `
    
    const relativeDateSelect = document.createElement('select')
    relativeDateSelect.id = 'date-filter-relative'
    relativeDateSelect.value = this.dateFilterConfig.relativeDate || ''
    relativeDateSelect.style.cssText = `
      padding: var(--orca-spacing-xs) var(--orca-spacing-sm);
      font-size: var(--orca-fontsize-sm);
      font-weight: var(--orca-fontweight-md);
      background: var(--orca-color-bg-1);
      color: var(--orca-color-text-1);
      border: var(--orca-border-general);
      border-radius: var(--orca-radius-sm);
      cursor: pointer;
      font-family: var(--orca-fontfamily-ui);
    `
    
    const relativeOptions = [
      { value: '', text: '无' },
      { value: 'today', text: '今天' },
      { value: 'yesterday', text: '昨天' },
      { value: 'last7days', text: '最近7天' },
      { value: 'last30days', text: '最近30天' },
      { value: 'last90days', text: '最近90天' },
      { value: 'thisYear', text: '今年' }
    ]
    
    relativeOptions.forEach(option => {
      const optionElement = document.createElement('option')
      optionElement.value = option.value
      optionElement.textContent = option.text
      relativeDateSelect.appendChild(optionElement)
    })
    
    relativeDateContainer.appendChild(relativeDateLabel)
    relativeDateContainer.appendChild(relativeDateSelect)
    
    // 绝对日期选择，使用虎鲸笔记原生样式变量
    const absoluteDateContainer = document.createElement('div')
    absoluteDateContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: var(--orca-spacing-sm);
      padding: var(--orca-spacing-sm);
      background: var(--orca-color-bg-2);
      border-radius: var(--orca-radius-sm);
      border: var(--orca-border-general);
    `
    
    const absoluteDateLabel = document.createElement('div')
    absoluteDateLabel.textContent = '绝对日期范围:'
    absoluteDateLabel.style.cssText = `
      font-size: var(--orca-fontsize-sm);
      font-weight: var(--orca-fontweight-md);
      color: var(--orca-color-text-1);
      user-select: none;
      font-family: var(--orca-fontfamily-ui);
    `
    
    const dateRangeContainer = document.createElement('div')
    dateRangeContainer.style.cssText = `
      display: flex;
      gap: var(--orca-spacing-sm);
      align-items: center;
    `
    
    const startDateInput = document.createElement('input')
    startDateInput.type = 'date'
    startDateInput.id = 'date-filter-start'
    startDateInput.value = this.dateFilterConfig.startDate ? this.dateFilterConfig.startDate.toISOString().split('T')[0] : ''
    startDateInput.style.cssText = `
      padding: var(--orca-spacing-xs) var(--orca-spacing-sm);
      font-size: var(--orca-fontsize-sm);
      font-weight: var(--orca-fontweight-md);
      background: var(--orca-color-bg-1);
      color: var(--orca-color-text-1);
      border: var(--orca-border-general);
      border-radius: var(--orca-radius-sm);
      cursor: pointer;
      font-family: var(--orca-fontfamily-ui);
    `
    
    const endDateInput = document.createElement('input')
    endDateInput.type = 'date'
    endDateInput.id = 'date-filter-end'
    endDateInput.value = this.dateFilterConfig.endDate ? this.dateFilterConfig.endDate.toISOString().split('T')[0] : ''
    endDateInput.style.cssText = `
      padding: var(--orca-spacing-xs) var(--orca-spacing-sm);
      font-size: var(--orca-fontsize-sm);
      font-weight: var(--orca-fontweight-md);
      background: var(--orca-color-bg-1);
      color: var(--orca-color-text-1);
      border: var(--orca-border-general);
      border-radius: var(--orca-radius-sm);
      cursor: pointer;
      font-family: var(--orca-fontfamily-ui);
    `
    
    const startLabel = document.createElement('label')
    startLabel.textContent = '开始:'
    startLabel.style.cssText = `
      font-size: var(--orca-fontsize-xs);
      font-weight: var(--orca-fontweight-md);
      color: var(--orca-color-text-1);
      user-select: none;
      font-family: var(--orca-fontfamily-ui);
    `
    
    const endLabel = document.createElement('label')
    endLabel.textContent = '结束:'
    endLabel.style.cssText = `
      font-size: var(--orca-fontsize-xs);
      font-weight: var(--orca-fontweight-md);
      color: var(--orca-color-text-1);
      user-select: none;
      font-family: var(--orca-fontfamily-ui);
    `
    
    dateRangeContainer.appendChild(startLabel)
    dateRangeContainer.appendChild(startDateInput)
    dateRangeContainer.appendChild(endLabel)
    dateRangeContainer.appendChild(endDateInput)
    
    absoluteDateContainer.appendChild(absoluteDateLabel)
    absoluteDateContainer.appendChild(dateRangeContainer)
    
    // 添加事件监听器
    enableCheckbox.addEventListener('change', () => {
      this.dateFilterConfig.enabled = enableCheckbox.checked
    })
    
    dateFieldSelect.addEventListener('change', () => {
      this.dateFilterConfig.dateField = dateFieldSelect.value as 'created' | 'modified'
    })
    
    relativeDateSelect.addEventListener('change', () => {
      this.dateFilterConfig.relativeDate = relativeDateSelect.value as any || undefined
    })
    
    startDateInput.addEventListener('change', () => {
      this.dateFilterConfig.startDate = startDateInput.value ? new Date(startDateInput.value) : undefined
    })
    
    endDateInput.addEventListener('change', () => {
      this.dateFilterConfig.endDate = endDateInput.value ? new Date(endDateInput.value) : undefined
    })
    
    // 组装面板
    optionsContainer.appendChild(enableContainer)
    optionsContainer.appendChild(dateFieldContainer)
    optionsContainer.appendChild(relativeDateContainer)
    optionsContainer.appendChild(absoluteDateContainer)
    
    panel.appendChild(titleContainer)
    panel.appendChild(optionsContainer)
    
    return panel
  }

  /**
   * 创建排序控制面板
   * @returns 排序面板元素
   */
  private createSortPanel(): HTMLElement {
    const panel = document.createElement('div')
    panel.className = 'page-display-sort-panel'
    this.applyStyles(panel, 'page-display-sort-panel')
    
    // 设置初始显示状态和透明度过渡，使用虎鲸笔记原生样式变量
    panel.style.cssText = `
      display: none;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.3s ease, visibility 0.3s ease, transform 0.3s ease;
      transform: translateY(-10px);
      background: var(--orca-color-bg-1);
      border: var(--orca-border-general);
      border-radius: var(--orca-radius-lg);
      box-shadow: var(--orca-shadow-popup);
      padding: var(--orca-spacing-lg);
      min-width: 200px;
      z-index: var(--orca-zindex-modal);
      font-family: var(--orca-fontfamily-ui);
      color: var(--orca-color-text-1);
    `
    
    // 创建面板标题
    const title = document.createElement('div')
    title.textContent = '排序选项'
    title.style.cssText = `
      font-size: var(--orca-fontsize-md);
      font-weight: var(--orca-fontweight-lg);
      color: var(--orca-color-text-1);
      margin-bottom: var(--orca-spacing-md);
      padding-bottom: var(--orca-spacing-sm);
      border-bottom: var(--orca-border-separator);
    `
    
    // 创建排序字段选择容器
    const sortFieldContainer = document.createElement('div')
    sortFieldContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: var(--orca-spacing-sm);
      margin-bottom: var(--orca-spacing-md);
    `
    
    const sortFieldLabel = document.createElement('div')
    sortFieldLabel.textContent = '排序字段:'
    sortFieldLabel.style.cssText = `
      font-size: var(--orca-fontsize-sm);
      font-weight: var(--orca-fontweight-md);
      color: var(--orca-color-text-1);
    `
    
    // 创建排序字段单选按钮组
    const sortFieldOptions = [
      { value: 'created', label: '创建时间' },
      { value: 'modified', label: '修改时间' },
      { value: 'name', label: '名称' }
    ]
    
    const sortFieldRadioGroup = document.createElement('div')
    sortFieldRadioGroup.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: var(--orca-spacing-xs);
    `
    
    sortFieldOptions.forEach(option => {
      const radioContainer = document.createElement('div')
      radioContainer.style.cssText = `
        display: flex;
        align-items: center;
        gap: var(--orca-spacing-xs);
        padding: var(--orca-spacing-xs);
        border-radius: var(--orca-radius-sm);
        cursor: pointer;
        transition: background 0.2s ease;
      `
      
      radioContainer.addEventListener('mouseenter', () => {
        radioContainer.style.background = 'var(--orca-color-bg-2)'
      })
      radioContainer.addEventListener('mouseleave', () => {
        radioContainer.style.background = 'transparent'
      })
      
      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = 'sort-field'
      radio.value = option.value
      radio.id = `sort-field-${option.value}`
      radio.style.cssText = `
        margin: 0;
        cursor: pointer;
      `
      
      const label = document.createElement('label')
      label.htmlFor = `sort-field-${option.value}`
      label.textContent = option.label
      label.style.cssText = `
        cursor: pointer;
        font-size: var(--orca-fontsize-sm);
        color: var(--orca-color-text-1);
        user-select: none;
      `
      
      radioContainer.appendChild(radio)
      radioContainer.appendChild(label)
      sortFieldRadioGroup.appendChild(radioContainer)
    })
    
    sortFieldContainer.appendChild(sortFieldLabel)
    sortFieldContainer.appendChild(sortFieldRadioGroup)
    
    // 创建排序方向选择容器
    const sortOrderContainer = document.createElement('div')
    sortOrderContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: var(--orca-spacing-sm);
      margin-bottom: var(--orca-spacing-md);
    `
    
    const sortOrderLabel = document.createElement('div')
    sortOrderLabel.textContent = '排序方向:'
    sortOrderLabel.style.cssText = `
      font-size: var(--orca-fontsize-sm);
      font-weight: var(--orca-fontweight-md);
      color: var(--orca-color-text-1);
    `
    
    // 创建排序方向单选按钮组
    const sortOrderOptions = [
      { value: 'desc', label: '降序' },
      { value: 'asc', label: '升序' }
    ]
    
    const sortOrderRadioGroup = document.createElement('div')
    sortOrderRadioGroup.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: var(--orca-spacing-xs);
    `
    
    sortOrderOptions.forEach(option => {
      const radioContainer = document.createElement('div')
      radioContainer.style.cssText = `
        display: flex;
        align-items: center;
        gap: var(--orca-spacing-xs);
        padding: var(--orca-spacing-xs);
        border-radius: var(--orca-radius-sm);
        cursor: pointer;
        transition: background 0.2s ease;
      `
      
      radioContainer.addEventListener('mouseenter', () => {
        radioContainer.style.background = 'var(--orca-color-bg-2)'
      })
      radioContainer.addEventListener('mouseleave', () => {
        radioContainer.style.background = 'transparent'
      })
      
      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = 'sort-order'
      radio.value = option.value
      radio.id = `sort-order-${option.value}`
      radio.style.cssText = `
        margin: 0;
        cursor: pointer;
      `
      
      const label = document.createElement('label')
      label.htmlFor = `sort-order-${option.value}`
      label.textContent = option.label
      label.style.cssText = `
        cursor: pointer;
        font-size: var(--orca-fontsize-sm);
        color: var(--orca-color-text-1);
        user-select: none;
      `
      
      radioContainer.appendChild(radio)
      radioContainer.appendChild(label)
      sortOrderRadioGroup.appendChild(radioContainer)
    })
    
    sortOrderContainer.appendChild(sortOrderLabel)
    sortOrderContainer.appendChild(sortOrderRadioGroup)
    
    // 创建按钮容器
    const buttonsContainer = document.createElement('div')
    buttonsContainer.style.cssText = `
      display: flex;
      gap: 4px;
      justify-content: flex-end;
      align-items: center;
    `
    
    // 创建取消按钮
    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = '取消'
    cancelBtn.className = 'page-display-sort-cancel-btn'
    cancelBtn.style.cssText = `
      padding: 3px 6px;
      font-size: 11px;
      background: rgba(239, 68, 68, 0.2);
      color: white;
      border: 1px solid rgba(239, 68, 68, 0.4);
      border-radius: 3px;
      cursor: pointer;
      transition: all 0.2s;
    `
    
    cancelBtn.addEventListener('mouseenter', () => {
      cancelBtn.style.background = 'rgba(239, 68, 68, 0.3)'
    })
    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.style.background = 'rgba(239, 68, 68, 0.2)'
    })
    
    // 创建确认按钮
    const confirmBtn = document.createElement('button')
    confirmBtn.textContent = '确认'
    confirmBtn.className = 'page-display-sort-confirm-btn'
    confirmBtn.style.cssText = `
      padding: 3px 6px;
      font-size: 11px;
      background: rgba(34, 197, 94, 0.2);
      color: white;
      border: 1px solid rgba(34, 197, 94, 0.4);
      border-radius: 3px;
      cursor: pointer;
      transition: all 0.2s;
    `
    
    confirmBtn.addEventListener('mouseenter', () => {
      confirmBtn.style.background = 'rgba(34, 197, 94, 0.3)'
    })
    confirmBtn.addEventListener('mouseleave', () => {
      confirmBtn.style.background = 'rgba(34, 197, 94, 0.2)'
    })
    
    buttonsContainer.appendChild(confirmBtn)
    buttonsContainer.appendChild(cancelBtn)
    
    // 组装面板
    panel.appendChild(title)
    panel.appendChild(sortFieldContainer)
    panel.appendChild(sortOrderContainer)
    panel.appendChild(buttonsContainer)
    
    return panel
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
        this.backrefAliasQueryEnabled = parsedSettings.backrefAliasQueryEnabled ?? true
        this.journalPageSupport = parsedSettings.journalPageSupport ?? true
        this.defaultCollapsed = parsedSettings.defaultCollapsed ?? true
        console.log("PageDisplay: Loaded journalPageSupport setting:", this.journalPageSupport)
        console.log("PageDisplay: Loaded defaultCollapsed setting:", this.defaultCollapsed)
        const savedMode = parsedSettings.displayMode
        if (savedMode === 'flat' || savedMode === 'grouped') {
          this.displayMode = savedMode
        }
        // 加载类型过滤设置
        if (parsedSettings.typeFilters) {
          this.typeFilters = new Map(
            Object.entries(parsedSettings.typeFilters).map(([key, value]) => [key as PageDisplayItemType, value as boolean])
          )
        }
        this.showTypeFilters = parsedSettings.showTypeFilters ?? false
        
        // 加载日期过滤设置
        if (parsedSettings.dateFilterConfig) {
          this.dateFilterConfig = {
            enabled: parsedSettings.dateFilterConfig.enabled ?? false,
            startDate: parsedSettings.dateFilterConfig.startDate ? new Date(parsedSettings.dateFilterConfig.startDate) : undefined,
            endDate: parsedSettings.dateFilterConfig.endDate ? new Date(parsedSettings.dateFilterConfig.endDate) : undefined,
            relativeDate: parsedSettings.dateFilterConfig.relativeDate,
            dateField: parsedSettings.dateFilterConfig.dateField ?? 'created'
          }
        }
        this.showDateFilters = parsedSettings.showDateFilters ?? false
        
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
        backrefAliasQueryEnabled: this.backrefAliasQueryEnabled,
        journalPageSupport: this.journalPageSupport,
        defaultCollapsed: this.defaultCollapsed,
        // 保存类型过滤设置
        typeFilters: Object.fromEntries(this.typeFilters),
        showTypeFilters: this.showTypeFilters,
        // 保存日期过滤设置
        dateFilterConfig: {
          enabled: this.dateFilterConfig.enabled,
          startDate: this.dateFilterConfig.startDate?.toISOString(),
          endDate: this.dateFilterConfig.endDate?.toISOString(),
          relativeDate: this.dateFilterConfig.relativeDate,
          dateField: this.dateFilterConfig.dateField
        },
        showDateFilters: this.showDateFilters,
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
   * HTML转义函数，防止XSS攻击
   * @param text 需要转义的文本
   * @returns 转义后的安全文本
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  /**
   * 高亮搜索关键词（支持拼音搜索）
   * @param text 原始文本
   * @param keywords 搜索关键词数组
   * @returns 包含高亮标签的HTML字符串
   */
  private highlightSearchTerms(text: string, keywords: string[]): string {
    if (!keywords || keywords.length === 0) {
      return this.escapeHtml(text)
    }

    this.log(`开始高亮处理 - 原文: "${text}", 关键词: [${keywords.join(', ')}]`)

    // 收集所有需要高亮的范围
    const highlightRanges: Array<{start: number, end: number, type: 'text' | 'pinyin'}> = []
    
    // 对每个关键词进行处理
    keywords.forEach(keyword => {
      if (keyword.trim()) {
        const lowerText = text.toLowerCase()
        const lowerKeyword = keyword.toLowerCase()
        
        // 普通文本匹配
        let index = 0
        while ((index = lowerText.indexOf(lowerKeyword, index)) !== -1) {
          highlightRanges.push({
            start: index,
            end: index + keyword.length,
            type: 'text'
          })
          index += keyword.length
        }
        
        // 拼音匹配
        try {
          const pinyinRanges = this.getPinyinMatchRanges(text, keyword)
          
          pinyinRanges.forEach(range => {
            // 检查是否与已有的文本匹配范围重叠
            const hasOverlap = highlightRanges.some(existing => 
              (range.start < existing.end && range.end > existing.start)
            )
            
            if (!hasOverlap) {
              highlightRanges.push({
                start: range.start,
                end: range.end,
                type: 'pinyin'
              })
            }
          })
        } catch (error) {
          this.logError("拼音匹配失败:", error)
        }
      }
    })
    
    // 合并重叠的范围
    const mergedRanges = this.mergeHighlightRanges(highlightRanges)
    
    // 从后往前应用高亮，避免位置偏移
    let result = text
    mergedRanges.sort((a, b) => b.start - a.start)
    
    mergedRanges.forEach(range => {
      const before = result.substring(0, range.start)
      const matched = result.substring(range.start, range.end)
      const after = result.substring(range.end)
      
      // 不需要转义匹配的文本，因为我们要返回HTML
      const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      const highlightBg = isDarkMode ? '#ffd700' : '#ffeb3b'
      const highlightText = '#000000'
      result = before + `<mark class="page-display-highlight" style="background-color: ${highlightBg} !important; color: ${highlightText} !important; padding: 1px 2px; border-radius: 2px; font-weight: 500; display: inline;">${matched}</mark>` + after
    })
    
    this.log(`最终高亮结果: "${result}"`)
    return result
  }

  /**
   * 合并重叠的高亮范围
   * @param ranges 高亮范围数组
   * @returns 合并后的范围数组
   */
  private mergeHighlightRanges(ranges: Array<{start: number, end: number, type: 'text' | 'pinyin'}>): Array<{start: number, end: number}> {
    if (ranges.length === 0) return []
    
    // 按起始位置排序
    ranges.sort((a, b) => a.start - b.start)
    
    const merged: Array<{start: number, end: number}> = []
    let current = ranges[0]
    
    for (let i = 1; i < ranges.length; i++) {
      const next = ranges[i]
      
      // 如果当前范围与下一个范围重叠或相邻，合并它们
      if (next.start <= current.end) {
        current.end = Math.max(current.end, next.end)
      } else {
        // 不重叠，添加当前范围并开始新的范围
        merged.push({ start: current.start, end: current.end })
        current = next
      }
    }
    
    // 添加最后一个范围
    merged.push({ start: current.start, end: current.end })
    
    return merged
  }

  /**
   * 检查文本是否匹配拼音搜索
   * @param text 要检查的文本
   * @param pinyinQuery 拼音查询字符串
   * @returns 是否匹配
   */
  private matchesPinyin(text: string, pinyinQuery: string): boolean {
    if (!text || !pinyinQuery) {
      return false
    }

    try {
      // 使用pinyin-match库进行拼音匹配
      const match = pinyinMatch.match(text, pinyinQuery)
      return match !== false
    } catch (error) {
      this.logError("拼音匹配失败:", error)
      return false
    }
  }

  /**
   * 获取文本中匹配拼音的字符范围（改进版）
   * @param text 要检查的文本
   * @param pinyinQuery 拼音查询字符串
   * @returns 匹配的字符位置数组
   */
  private getPinyinMatchRanges(text: string, pinyinQuery: string): Array<{start: number, end: number}> {
    if (!text || !pinyinQuery) {
      return []
    }

    try {
      // 检测是否是首字母查询（如 "bl", "zhw" 等）
      const isInitialQuery = /^[a-z]+$/.test(pinyinQuery.toLowerCase().replace(/\s+/g, ''))
      
      // 如果是首字母查询，尝试扩展匹配连续的字符
      if (isInitialQuery && pinyinQuery.length >= 2) {
        const expandedRanges = this.getExpandedPinyinRanges(text, pinyinQuery)
        if (expandedRanges.length > 0) {
          return expandedRanges
        }
      }
      
      // 使用pinyin-match库获取匹配范围
      const match = pinyinMatch.match(text, pinyinQuery)
      
      if (match === false) {
        // 没有匹配，尝试更宽松的匹配策略
        return this.getLoosePinyinMatchRanges(text, pinyinQuery)
      }

          const ranges: Array<{start: number, end: number}> = []
      
      // pinyin-match 返回 [startIndex, endIndex] 表示第一个匹配的位置
      if (Array.isArray(match) && match.length === 2 && typeof match[0] === 'number' && typeof match[1] === 'number') {
        const startIndex = match[0]
        const endIndex = match[1]
        
        // 提取第一个匹配的子串
        const matchedSubstring = text.substring(startIndex, endIndex)
        
        // 防止空字符串导致无限循环
        if (matchedSubstring.length === 0) {
          return ranges
        }
        
        // 在整个文本中查找所有该子串的出现位置
        let index = 0
        while ((index = text.indexOf(matchedSubstring, index)) !== -1) {
          ranges.push({
            start: index,
            end: index + matchedSubstring.length
          })
          index += matchedSubstring.length
        }
      } else if (Array.isArray(match) && match.length > 0) {
        // 处理其他数组格式（字符串数组）
        match.forEach((matchedText: any) => {
          if (typeof matchedText === 'string' && matchedText.length > 0) {
            // 在原文中查找该匹配文本的所有出现位置
              let index = 0
              while ((index = text.indexOf(matchedText, index)) !== -1) {
                ranges.push({
                  start: index,
                  end: index + matchedText.length
                })
                index += matchedText.length
              }
          }
        })
        } else if (typeof match === 'string') {
        // 如果返回的是字符串，在原文中查找所有出现位置
          const matchStr = match as string
        if (matchStr.length > 0) {
          let index = 0
          while ((index = text.indexOf(matchStr, index)) !== -1) {
            ranges.push({
              start: index,
              end: index + matchStr.length
            })
            index += matchStr.length
          }
        }
      }
      
      return ranges
    } catch (error) {
      this.logError("获取拼音匹配范围失败:", error)
      return []
    }
  }

  /**
   * 扩展拼音首字母匹配，尝试匹配连续的多个字符
   * 例如 "bl" 应该匹配 "哔哩" 而不只是 "哔"
   * 
   * 策略：
   * - 短查询（1-3个字符）：按首字母匹配
   * - 长查询（4+个字符）：按音节分解匹配（例如 "bili" → "bi" + "li" 匹配 "哔哩"）
   */
  private getExpandedPinyinRanges(text: string, query: string): Array<{start: number, end: number}> {
    const lowerQuery = query.toLowerCase()
    
    // 策略1: 如果查询较短（1-3个字符），按首字母匹配
    if (lowerQuery.length <= 3) {
      return this.matchByInitials(text, lowerQuery)
    }
    
    // 策略2: 如果查询较长（4+字符），按音节分解匹配
    return this.matchPinyinSyllables(text, lowerQuery)
  }

  /**
   * 音节分解匹配：将查询按拼音音节分解来匹配连续的字符
   * 例如 "bili" 分解为 "bi" + "li"，匹配 "哔" + "哩" = "哔哩"
   */
  private matchPinyinSyllables(text: string, query: string): Array<{start: number, end: number}> {
    const ranges: Array<{start: number, end: number}> = []
    
    // 遍历文本的每个位置
    for (let i = 0; i < text.length; i++) {
      let queryPos = 0  // 当前在查询字符串中的位置
      let charCount = 0 // 匹配了几个字符
      
      // 从位置 i 开始，尝试逐字符匹配音节
      for (let j = i; j < text.length && queryPos < query.length; j++) {
        const char = text[j]
        
        // 尝试用当前字符匹配查询的剩余部分
        const syllableLength = this.tryMatchCharPinyin(char, query.substring(queryPos))
        
        if (syllableLength > 0) {
          // 匹配成功，移动查询位置
          queryPos += syllableLength
          charCount++
        } else {
          // 匹配失败，跳出
          break
        }
      }
      
      // 如果查询字符串完全匹配完了
      if (queryPos === query.length && charCount > 0) {
        ranges.push({
          start: i,
          end: i + charCount
        })
        // 跳过已匹配的部分
        i += charCount - 1
      }
    }
    
    return ranges
  }

  /**
   * 尝试用单个字符匹配查询的前缀音节
   * @param char 要匹配的单个字符
   * @param queryPrefix 查询字符串的前缀部分
   * @returns 如果匹配成功，返回匹配的音节长度（如 "bi" 返回 2）；否则返回 0
   */
  private tryMatchCharPinyin(char: string, queryPrefix: string): number {
    // 尝试不同长度的音节（从长到短，优先匹配更长的音节）
    // 拼音音节最长6个字母（如 zhuang），最短1个字母
    for (let len = Math.min(6, queryPrefix.length); len >= 1; len--) {
      const syllable = queryPrefix.substring(0, len)
      
      try {
        // 使用 pinyin-match 检查字符是否匹配这个音节
        const match = pinyinMatch.match(char, syllable)
        
        // 如果匹配且是完整匹配（从开头到结尾）
        if (match !== false && Array.isArray(match)) {
          const matchStart = match[0]
          const matchEnd = match[1]
          
          // 匹配必须从字符开头开始，并且覆盖整个字符
          // pinyin-match 返回闭区间 [startIndex, endIndex]，单字符匹配返回 [0, 0]
          if (matchStart === 0 && matchEnd === 0) {
            return len
          }
        }
      } catch (error) {
        // 忽略错误，继续尝试
      }
    }
    
    return 0 // 没有匹配
  }

  /**
   * 按拼音首字母匹配连续字符
   */
  private matchByInitials(text: string, query: string): Array<{start: number, end: number}> {
    const ranges: Array<{start: number, end: number}> = []
    const queryChars = query.split('')
    
    // 遍历文本，尝试找到连续字符的拼音首字母匹配
    for (let i = 0; i < text.length; i++) {
      let matchLength = 0
      let queryIndex = 0
      
      // 从当前位置开始，尝试匹配连续的字符
      for (let j = i; j < text.length && queryIndex < queryChars.length; j++) {
        const char = text[j]
        const targetInitial = queryChars[queryIndex]
        
        // 检查当前字符的拼音首字母是否匹配
        if (this.checkPinyinInitial(char, targetInitial)) {
          matchLength++
          queryIndex++
        } else {
          // 不匹配，跳出
          break
        }
      }
      
      // 如果成功匹配了所有查询字符
      if (queryIndex === queryChars.length && matchLength > 0) {
        ranges.push({
          start: i,
          end: i + matchLength
        })
        // 跳过已匹配的部分
        i += matchLength - 1
      }
    }
    
    return ranges
  }

  /**
   * 检查字符的拼音首字母是否匹配目标字母
   */
  private checkPinyinInitial(char: string, targetInitial: string): boolean {
    try {
      // 使用 pinyin-match 检查单个字符
      const match = pinyinMatch.match(char, targetInitial)
      // 如果匹配且是从开头匹配的
      if (match !== false && Array.isArray(match) && match[0] === 0) {
        return true
      }
      return false
    } catch (error) {
      return false
    }
  }

  /**
   * 宽松的拼音匹配策略
   * 当pinyin-match库无法找到精确匹配时，使用更宽松的匹配策略
   * @param text 要检查的文本
   * @param pinyinQuery 拼音查询字符串
   * @returns 匹配的字符位置数组
   */
  private getLoosePinyinMatchRanges(text: string, pinyinQuery: string): Array<{start: number, end: number}> {
    if (!text || !pinyinQuery) {
      return []
    }

    try {
      // 移除空格，将查询转换为连续拼音
      const cleanQuery = pinyinQuery.replace(/\s+/g, '').toLowerCase()
      
      // 尝试不同的匹配策略
      const strategies = [
        // 策略1: 直接使用清理后的查询
        () => this.tryPinyinMatch(text, cleanQuery),
        // 策略2: 尝试部分匹配
        () => this.tryPartialPinyinMatch(text, cleanQuery),
        // 策略3: 尝试字符级匹配
        () => this.tryCharacterPinyinMatch(text, cleanQuery)
      ]
      
      for (const strategy of strategies) {
        const ranges = strategy()
        if (ranges.length > 0) {
          return ranges
        }
      }
      
      return []
    } catch (error) {
      this.logError("宽松拼音匹配失败:", error)
      return []
    }
  }

  /**
   * 尝试拼音匹配
   */
  private tryPinyinMatch(text: string, query: string): Array<{start: number, end: number}> {
    try {
      const match = pinyinMatch.match(text, query)
      if (match !== false) {
        return this.convertMatchToRanges(text, match)
      }
    } catch (error) {
      this.log(`tryPinyinMatch失败:`, error)
    }
    return []
  }

  /**
   * 尝试部分拼音匹配
   */
  private tryPartialPinyinMatch(text: string, query: string): Array<{start: number, end: number}> {
    // 如果查询长度大于2，尝试截取前几个字符进行匹配
    if (query.length > 2) {
      const partialQuery = query.substring(0, Math.max(2, query.length - 1))
      return this.tryPinyinMatch(text, partialQuery)
    }
    return []
  }

  /**
   * 尝试字符级拼音匹配
   */
  private tryCharacterPinyinMatch(text: string, query: string): Array<{start: number, end: number}> {
    const ranges: Array<{start: number, end: number}> = []
    
    // 将查询按字符分割，尝试匹配每个字符
    for (let i = 0; i < query.length; i++) {
      const charQuery = query[i]
      try {
        const match = pinyinMatch.match(text, charQuery)
        if (match !== false) {
          const charRanges = this.convertMatchToRanges(text, match)
          ranges.push(...charRanges)
        }
      } catch (error) {
        // 忽略字符级匹配错误
      }
    }
    
    return ranges
  }

  /**
   * 将匹配结果转换为范围数组
   */
  private convertMatchToRanges(text: string, match: any): Array<{start: number, end: number}> {
    const ranges: Array<{start: number, end: number}> = []
    
    if (Array.isArray(match) && match.length > 0) {
      // 遍历所有匹配的文本片段
      match.forEach((matchedText: any) => {
        if (typeof matchedText === 'string' && matchedText.length > 0) {
          // 在原文中查找该匹配文本的所有出现位置
          let index = 0
          while ((index = text.indexOf(matchedText, index)) !== -1) {
            ranges.push({
              start: index,
              end: index + matchedText.length
            })
            index += matchedText.length
          }
        }
      })
    } else if (typeof match === 'string') {
      // 如果返回的是字符串，在原文中查找所有出现位置
      const matchStr = match as string
      if (matchStr.length > 0) {
      let index = 0
      while ((index = text.indexOf(matchStr, index)) !== -1) {
        ranges.push({
          start: index,
          end: index + matchStr.length
        })
        index += matchStr.length
        }
      }
    }
    
    return ranges
  }

  /**
   * 去重项目，保持唯一性
   * 根据ID和文本内容去重，避免显示相同项目
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
      'referenced-tag': [],
      'property-ref-alias': [],
      'property-ref-block': [],
      'contained-in': [],
      'inline-ref': [],
      'page-direct-children': [],
      'page-recursive-children': [],
      'referencing-alias': [],
      'child-referenced-alias': [],
      'child-referenced-tag-alias': [],
      'child-referenced-inline': [],
      'backref-alias-blocks': [],
      'backref': [],
      'recursive-backref': [],
      'recursive-backref-alias': []
    } as DisplayGroupsMap
  }


  private buildGroupedItems(
    source: Record<PageDisplayItemType, PageDisplayItem[]>,
    tagBlockIds: DbId[],
    containedInBlockIds: DbId[]
  ): DisplayGroupsMap {
    const result = this.createEmptyGroups()
    const seen = new Set<string>()

    const groupTypes: PageDisplayItemType[] = ['tag', 'referenced-tag', 'property-ref-alias', 'property-ref-block', 'contained-in', 'inline-ref', 'page-direct-children', 'page-recursive-children', 'referencing-alias', 'recursive-backref-alias', 'child-referenced-alias', 'child-referenced-tag-alias', 'child-referenced-inline', 'backref-alias-blocks', 'backref', 'recursive-backref']
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

    // 删除 referenced 类型后，不再需要排序 referenced 组

    return result
  }

  /**
   * 根据用户自定义排序配置比较两个项目
   * @param a 第一个项目
   * @param b 第二个项目
   * @param sortConfig 排序配置
   * @returns 比较结果（负数、0或正数）
   */
  private compareItemsByUserSort(a: PageDisplayItem, b: PageDisplayItem, sortConfig: SortConfig): number {
    let compareResult = 0
    
    if (sortConfig.field === 'created') {
      const aCreated = a.created || 0
      const bCreated = b.created || 0
      compareResult = aCreated - bCreated
    } else if (sortConfig.field === 'modified') {
      const aModified = a.modified || 0
      const bModified = b.modified || 0
      compareResult = aModified - bModified
    } else if (sortConfig.field === 'name') {
      const aName = a.text.toLowerCase()
      const bName = b.text.toLowerCase()
      compareResult = aName.localeCompare(bName, 'zh-CN')
    }
    
    // 应用排序方向
    return sortConfig.order === 'asc' ? compareResult : -compareResult
  }

  private sortReferencedGroup(items: PageDisplayItem[], tagBlockIds: DbId[], containedInBlockIds: DbId[]): void {
    items.sort((a, b) => {
      const aIsContainedIn = containedInBlockIds.includes(a.id)
      const bIsContainedIn = containedInBlockIds.includes(b.id)
      const aIsTag = tagBlockIds.includes(a.id)
      const bIsTag = tagBlockIds.includes(b.id)

      // 第一级判断：包含于块(非子标签) - 最高优先级
      const aIsContainedInNotTag = aIsContainedIn && !aIsTag
      const bIsContainedInNotTag = bIsContainedIn && !bIsTag
      
      if (aIsContainedInNotTag && !bIsContainedInNotTag) return -1  // 包含于块(非子标签)最高优先级
      if (!aIsContainedInNotTag && bIsContainedInNotTag) return 1
      if (aIsContainedInNotTag && bIsContainedInNotTag) return 0  // 都是包含于块(非子标签)，保持原顺序
      
      // 第二级判断：包含于块(是子标签)
      const aIsContainedInTag = aIsContainedIn && aIsTag
      const bIsContainedInTag = bIsContainedIn && bIsTag
      
      if (aIsContainedInTag && !bIsContainedInTag) return -1  // 包含于块(是子标签)次优先
      if (!aIsContainedInTag && bIsContainedInTag) return 1
      if (aIsContainedInTag && bIsContainedInTag) return 0  // 都是包含于块(是子标签)，保持原顺序
      
      // 第三级判断：标签块
      if (aIsTag && !bIsTag) return -1  // 标签块第三优先
      if (!aIsTag && bIsTag) return 1
      
      return 0  // 其他保持原顺序
    })
  }

  private cloneGroupedItems(grouped: DisplayGroupsMap): DisplayGroupsMap {
    const clone = this.createEmptyGroups()
    const groupTypes: PageDisplayItemType[] = ['tag', 'referenced-tag', 'property-ref-alias', 'property-ref-block', 'contained-in', 'inline-ref', 'page-direct-children', 'page-recursive-children', 'referencing-alias', 'recursive-backref-alias', 'child-referenced-alias', 'child-referenced-tag-alias', 'backref-alias-blocks', 'backref', 'recursive-backref']
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
    
    // 清理滚动观察器
    if (this.scrollObserver) {
      this.scrollObserver.disconnect()
      this.scrollObserver = null
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
      
      if (currentPanel && currentPanel.viewArgs) {
        // 检查是否为Journal页面
        if (currentPanel.view === "journal" && currentPanel.viewArgs.date) {
          // 对于Journal页面，先尝试从缓存获取，如果没有缓存则返回特殊标识
          if (this.journalPageSupport) {
            const journalBlockId = this.getJournalBlockIdSync(currentPanel.viewArgs.date)
            if (journalBlockId) {
              return journalBlockId
            } else {
              // 没有缓存，返回特殊标识，后续异步获取
              return -1 as DbId
            }
          } else {
            return null
          }
        }
        
        // 普通块页面
        if (currentPanel.viewArgs.blockId) {
          const blockId = currentPanel.viewArgs.blockId
          return blockId
        }
      }
      
      return null
    } catch (error) {
      console.error("Failed to get current root block ID:", error)
      return null
    }
  }

  /**
   * 同步获取Journal页面的块ID（带缓存）
   * @param date 日期信息
   * @returns Journal页面的块ID，如果获取失败则返回null
   */
  private getJournalBlockIdSync(date: any): DbId | null {
    try {
      const dateKey = typeof date === 'string' ? date : JSON.stringify(date)
      
      // 检查缓存
      const now = Date.now()
      if (this.journalBlockCache.has(dateKey)) {
        const cacheTimestamp = this.journalBlockCacheTimestamps.get(dateKey)
        if (cacheTimestamp && now - cacheTimestamp < this.JOURNAL_CACHE_DURATION) {
          const cachedBlockId = this.journalBlockCache.get(dateKey)
          this.log("PageDisplay: Using cached journal block ID:", cachedBlockId)
          return cachedBlockId || null
        } else {
          // 缓存过期，清理
          this.journalBlockCache.delete(dateKey)
          this.journalBlockCacheTimestamps.delete(dateKey)
        }
      }
      
      // 如果没有缓存，返回null，让异步方法处理
      return null
    } catch (error) {
      this.logError("Failed to get cached journal block ID:", error)
      return null
    }
  }

  /**
   * 异步获取Journal页面的块ID（带缓存）
   * 通过日期信息调用get-journal-block API获取对应的块ID
   * @returns Journal页面的块ID，如果获取失败则返回null
   */
  private async getJournalBlockId(): Promise<DbId | null> {
    try {
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
      
      if (currentPanel && currentPanel.view === "journal" && currentPanel.viewArgs && currentPanel.viewArgs.date) {
        const date = currentPanel.viewArgs.date
        const dateKey = typeof date === 'string' ? date : JSON.stringify(date)
        
        // 调用get-journal-block API获取Journal块ID
        const journalBlock = await this.safeApiCall(
          async () => {
            return await orca.invokeBackend("get-journal-block", date)
          },
          "Failed to get journal block:",
          null
        )
        
        if (journalBlock && journalBlock.id) {
          // 缓存结果
          const now = Date.now()
          this.journalBlockCache.set(dateKey, journalBlock.id)
          this.journalBlockCacheTimestamps.set(dateKey, now)
          
          this.log("PageDisplay: Journal block ID obtained and cached:", journalBlock.id)
          return journalBlock.id
        } else {
          this.log("PageDisplay: No journal block found for date:", date)
          return null
        }
      }
      
      return null
    } catch (error) {
      this.logError("Failed to get journal block ID:", error)
      return null
    }
  }

  /**
   * 获取当前页面的折叠状态
   * @returns 当前页面是否处于折叠状态，如果页面没有保存状态则使用默认折叠设置
   */
  private getCurrentPageCollapseState(): boolean {
    const rootBlockId = this.getCurrentRootBlockId()
    if (!rootBlockId) return this.defaultCollapsed
    
    // 如果页面有保存的折叠状态，使用保存的状态
    if (this.pageCollapseStates.has(rootBlockId)) {
      return this.pageCollapseStates.get(rootBlockId)!
    }
    
    // 如果页面没有保存的折叠状态，使用默认折叠设置
    return this.defaultCollapsed
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

  /**
   * 获取默认折叠状态
   * @returns 是否默认折叠
   */
  public getDefaultCollapsed(): boolean {
    return this.defaultCollapsed
  }

  /**
   * 设置默认折叠状态
   * @param collapsed 是否默认折叠
   */
  public setDefaultCollapsed(collapsed: boolean): void {
    this.defaultCollapsed = collapsed
    this.saveSettings()
    this.log(`PageDisplay: 默认折叠状态已设置为: ${collapsed ? '折叠' : '展开'}`)
  }

  /**
   * 切换默认折叠状态
   */
  public toggleDefaultCollapsed(): void {
    this.setDefaultCollapsed(!this.defaultCollapsed)
    const status = this.defaultCollapsed ? "折叠" : "展开"
    orca.notify("info", `新页面默认状态已设置为${status}`)
  }

  /**
   * 获取当前页面的折叠状态信息（调试用）
   */
  public getCurrentPageCollapseInfo(): {
    rootBlockId: DbId | null
    hasSavedState: boolean
    savedState: boolean | null
    defaultCollapsed: boolean
    finalState: boolean
  } {
    const rootBlockId = this.getCurrentRootBlockId()
    const hasSavedState = rootBlockId ? this.pageCollapseStates.has(rootBlockId) : false
    const savedState = rootBlockId ? (this.pageCollapseStates.get(rootBlockId) ?? null) : null
    const finalState = this.getCurrentPageCollapseState()
    
    return {
      rootBlockId,
      hasSavedState,
      savedState,
      defaultCollapsed: this.defaultCollapsed,
      finalState
    }
  }

  // 获取子标签块
  private async getChildrenTagBlocks(blockId: DbId): Promise<Block[]> {
    return this.safeApiCall(
      () => this.cachedApiCall("get-children-tag-blocks", blockId),
      "Failed to get children tag blocks:",
      []
    )
  }


  // 获取引用当前块的别名块（检查根块是否为别名块）
  private async getReferencingAliasBlocks(blockId: DbId): Promise<Block[]> {
    return this.safeApiCall(
      async () => {
        // 获取当前块的信息
        const currentBlock = await this.apiService.getBlock(blockId)
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
            const rootBlock = await this.apiService.getBlock(block.parent)
            if (rootBlock && rootBlock.aliases && rootBlock.aliases.length > 0) {
              // 排除自身块
              if (rootBlock.id !== blockId) {
                aliasBlocks.push(rootBlock)
              }
            }
          } else {
            // 如果没有父块，检查当前块本身是否是别名块
            if (block.aliases && block.aliases.length > 0) {
              aliasBlocks.push(block)
            }
          }
        }
        
        return aliasBlocks
      },
      "Failed to get referencing alias blocks:",
      []
    )
  }

  // 获取反链中引用的别名块（终极优化版 - 最多2次API调用）
  private async getBackrefAliasBlocks(blockId: DbId): Promise<Block[]> {
    return this.safeApiCall(
      async () => {
        if (!blockId) return []
        
        // 获取当前块信息
        const currentBlock = await this.apiService.getBlock(blockId)
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
      },
      "Failed to get backref alias blocks:",
      []
    )
  }

  // 获取直接的反链块（引用当前块的块）
  private async getBackrefBlocks(blockId: DbId): Promise<Block[]> {
    return this.safeApiCall(
      async () => {
        if (!blockId) return []
        
        // 获取当前块信息
        const currentBlock = await this.apiService.getBlock(blockId)
        if (!currentBlock?.backRefs?.length) return []

        // 获取反链块ID
        const backrefBlockIds = currentBlock.backRefs.map(backRef => backRef.from).filter(id => id != null)
        if (backrefBlockIds.length === 0) return []
        
        // 批量获取反链块
        const backrefBlocks = await this.cachedApiCall("get-blocks", backrefBlockIds)
        if (!backrefBlocks?.length) return []
        
        // 排除自身块
        return backrefBlocks.filter((block: any) => block.id !== blockId)
      },
      "Failed to get backref blocks:",
      []
    )
  }

  // 递归获取所有子标签的反链块
  private async getRecursiveBackrefBlocks(blockId: DbId): Promise<Block[]> {
    try {
      if (!blockId) return []
      
      const allBackrefBlocks = new Set<DbId>()
      const processedBlocks = new Set<DbId>()
      
      // 递归获取子标签的反链块
      await this.collectRecursiveBackrefs(blockId, allBackrefBlocks, processedBlocks)
      
      if (allBackrefBlocks.size === 0) return []
      
      // 批量获取所有反链块
      const backrefBlocks = await this.cachedApiCall("get-blocks", Array.from(allBackrefBlocks))
      if (!backrefBlocks?.length) return []
      
      // 排除自身块和别名块
      return backrefBlocks.filter((block: any) => 
        block.id !== blockId && 
        (!block.aliases || block.aliases.length === 0)
      )

    } catch (error) {
      this.logError("Failed to get recursive backref blocks:", error)
      return []
    }
  }

  // 递归收集子标签的反链块
  private async collectRecursiveBackrefs(
    blockId: DbId, 
    allBackrefBlocks: Set<DbId>, 
    processedBlocks: Set<DbId>
  ): Promise<void> {
    try {
      // 避免循环引用
      if (processedBlocks.has(blockId)) return
      processedBlocks.add(blockId)
      
      // 获取当前块的子标签
      const childrenTags = await this.apiService.getChildrenTags(blockId)
      if (!childrenTags?.length) return
      
      // 遍历每个子标签
      for (const childTag of childrenTags) {
        // 获取子标签的反链块
        const childBackrefs = await this.getBackrefBlocks(childTag.id)
        if (childBackrefs?.length) {
          childBackrefs.forEach(block => allBackrefBlocks.add(block.id))
        }
        
        // 递归处理子标签的子标签
        await this.collectRecursiveBackrefs(childTag.id, allBackrefBlocks, processedBlocks)
      }
      
    } catch (error) {
      this.logError("Failed to collect recursive backrefs:", error)
    }
  }

  // 递归获取所有子标签的反链块中的别名块
  private async getRecursiveBackrefAliasBlocks(blockId: DbId): Promise<Block[]> {
    try {
      if (!blockId) return []
      
      const allBackrefAliasBlocks = new Set<DbId>()
      const processedBlocks = new Set<DbId>()
      
      // 递归获取子标签的反链块中的别名块
      await this.collectRecursiveBackrefAliases(blockId, allBackrefAliasBlocks, processedBlocks)
      
      if (allBackrefAliasBlocks.size === 0) return []
      
      // 批量获取所有反链别名块
      const backrefAliasBlocks = await this.cachedApiCall("get-blocks", Array.from(allBackrefAliasBlocks))
      if (!backrefAliasBlocks?.length) return []
      
      // 排除自身块
      return backrefAliasBlocks.filter((block: any) => block.id !== blockId)

    } catch (error) {
      this.logError("Failed to get recursive backref alias blocks:", error)
      return []
    }
  }

  // 递归收集子标签的反链块中的别名块
  private async collectRecursiveBackrefAliases(
    blockId: DbId, 
    allBackrefAliasBlocks: Set<DbId>, 
    processedBlocks: Set<DbId>
  ): Promise<void> {
    try {
      // 避免循环引用
      if (processedBlocks.has(blockId)) return
      processedBlocks.add(blockId)
      
      // 获取当前块的子标签
      const childrenTags = await this.apiService.getChildrenTags(blockId)
      if (!childrenTags?.length) return
      
      // 遍历每个子标签
      for (const childTag of childrenTags) {
        // 获取子标签的反链块
        const childBackrefs = await this.getBackrefBlocks(childTag.id)
        if (childBackrefs?.length) {
          // 只收集别名块
          childBackrefs.forEach(block => {
            if (block.aliases && block.aliases.length > 0) {
              allBackrefAliasBlocks.add(block.id)
            }
          })
        }
        
        // 递归处理子标签的子标签
        await this.collectRecursiveBackrefAliases(childTag.id, allBackrefAliasBlocks, processedBlocks)
      }
      
    } catch (error) {
      this.logError("Failed to collect recursive backref aliases:", error)
    }
  }

  // 获取子块中引用的别名块（只识别内联引用）
  private async getChildReferencedAliasBlocks(blockId: DbId, tagBlockIds: DbId[] = []): Promise<Block[]> {
    try {
      // 获取当前块的信息
      const currentBlock = await this.apiService.getBlock(blockId)
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

      // 收集所有子块引用的块ID，同时记录引用类型信息
      const allReferencedBlockIds: DbId[] = []
      const refTypeMap: Map<DbId, any[]> = new Map() // 存储块ID对应的引用信息
      
      for (const childBlock of childBlocks) {
        if (childBlock.refs && childBlock.refs.length > 0) {
          for (const ref of childBlock.refs) {
            const refTo = ref.to
            allReferencedBlockIds.push(refTo)
            
            // 记录引用类型信息
            if (!refTypeMap.has(refTo)) {
              refTypeMap.set(refTo, [])
            }
            refTypeMap.get(refTo)!.push(ref)
          }
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

      // 过滤出被引用的块，排除标签块、属性值别名块和自身块
      const childReferencedBlocks: Block[] = []
      this.log(`PageDisplay: 开始过滤子块引用的别名块，总共 ${referencedBlocks.length} 个块`)
      
      for (const block of referencedBlocks) {
        // 排除自身块
        if (block.id === blockId) {
          this.log(`PageDisplay: 排除自身块 - ${block.id}`)
          continue
        }
        
        // 检查是否为标签块
        const isTagBlock = tagBlockIds.includes(block.id)
        if (isTagBlock) {
          this.log(`PageDisplay: 排除标签块 - ${block.id}: ${block.aliases?.[0] || block.text}`)
          continue
        }
        
        // 检查是否为内联引用（ref.type=1）
        const refsForThisBlock = refTypeMap.get(block.id) || []
        this.log(`PageDisplay: 检查块 ${block.id} 的引用类型:`, refsForThisBlock)
        
        const isInlineRef = this.isInlineReferenceType1(refsForThisBlock)
        if (!isInlineRef) {
          this.log(`PageDisplay: 排除非内联引用 - ${block.id}: ${block.aliases?.[0] || block.text}`)
          continue
        }
        
        // 通过 refs 类型判断是否为属性值别名块
        const isPropertyValueRef = this.isPropertyValueRef(refsForThisBlock)
        if (isPropertyValueRef) {
          this.log(`PageDisplay: 通过refs类型排除属性值别名块 - ${block.id}: ${block.aliases?.[0] || block.text}`)
          continue
        }
        
        // 备用检查：通过块属性判断是否为属性值的别名块
        const isPropertyValueAlias = this.isPropertyValueAliasBlock(block)
        if (isPropertyValueAlias) {
          this.log(`PageDisplay: 通过块属性排除属性值别名块 - ${block.id}: ${block.aliases?.[0] || block.text}`)
          continue
        }
        
        // 检查是否有别名（别名块必须有别名）
        const hasAlias = block.aliases && block.aliases.length > 0
        if (!hasAlias) {
          this.log(`PageDisplay: 排除非别名块 - ${block.id}: ${block.text}`)
          continue
        }
        
        this.log(`PageDisplay: 保留子块引用的别名块 - ${block.id}: ${block.aliases?.[0] || block.text}`)
        childReferencedBlocks.push(block)
      }

      return childReferencedBlocks
    } catch (error) {
      this.logError("Failed to get child referenced alias blocks:", error)
      return []
    }
  }

  // 获取子块中引用的标签别名块
  private async getChildReferencedTagAliasBlocks(blockId: DbId, tagBlockIds: DbId[] = []): Promise<Block[]> {
    try {
      // 获取当前块的信息
      const currentBlock = await this.apiService.getBlock(blockId)
      if (!currentBlock) {
        return []
      }

      // 检查当前块是否有子块
      if (!currentBlock.children || currentBlock.children.length === 0) {
        return []
      }

      // 获取所有子块的详细信息
      const childBlocks = await this.cachedApiCall("get-blocks", currentBlock.children)
      if (!childBlocks) return []

      // 收集所有子块引用的块ID，同时记录引用类型信息
      const allReferencedBlockIds: DbId[] = []
      const refTypeMap: Map<DbId, any[]> = new Map() // 存储块ID对应的引用信息
      
      for (const childBlock of childBlocks) {
        if (childBlock.refs && childBlock.refs.length > 0) {
          for (const ref of childBlock.refs) {
            const refTo = ref.to
            allReferencedBlockIds.push(refTo)
            
            // 记录引用类型信息
            if (!refTypeMap.has(refTo)) {
              refTypeMap.set(refTo, [])
            }
            refTypeMap.get(refTo)!.push(ref)
          }
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

      // 过滤出被引用的标签块
      const childReferencedTagBlocks: Block[] = []
      this.log(`PageDisplay: 开始过滤子块引用的标签别名块，总共 ${referencedBlocks.length} 个块`)
      
      for (const block of referencedBlocks) {
        // 排除自身块
        if (block.id === blockId) {
          this.log(`PageDisplay: 排除自身块 - ${block.id}`)
          continue
        }
        
        // 检查这个块是否被标签引用（ref.type = 2）
        const refsForThisBlock = refTypeMap.get(block.id) || []
        this.log(`PageDisplay: 检查块 ${block.id} 的引用类型:`, refsForThisBlock)
        
        const isTagReference = this.isTagReference(refsForThisBlock)
        if (!isTagReference) {
          this.log(`PageDisplay: 排除非标签引用 - ${block.id}: ${block.aliases?.[0] || block.text}`)
          continue
        }
        
        this.log(`PageDisplay: 保留子块引用的标签别名块 - ${block.id}: ${block.aliases?.[0] || block.text}`)
        childReferencedTagBlocks.push(block)
      }

      return childReferencedTagBlocks
    } catch (error) {
      this.logError("Failed to get child referenced tag alias blocks:", error)
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
  /**
   * 从块文本中解析标签并获取标签块ID
   */
  private async parseTagsFromText(text: string): Promise<DbId[]> {
    const tagMatches = (text || "").match(/#[^,\n]+/g) || []
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
            }
          }
        }
      } catch (error) {
        // 忽略错误，继续处理下一个标签
      }
    }
    
    return tagBlockIds
  }

  /**
   * 处理块的引用，分类为内联引用和属性引用
   */
  private async processReferences(currentBlock: Block, tagBlockIds: DbId[]): Promise<{
    referencedBlocks: Block[]
    inlineRefIds: DbId[]
    propertyRefIds: DbId[]
  } | null> {
    if (!currentBlock.refs || currentBlock.refs.length === 0) {
      this.log("PageDisplay: No refs found in current block")
      return null
    }

    // 收集所有引用ID
    const allReferencedBlockIds = currentBlock.refs.map(ref => ref.to)
    this.log("PageDisplay: 所有引用块ID:", allReferencedBlockIds)
    
    // 获取所有被引用块的详细信息
    const referencedBlocks = await this.cachedApiCall("get-blocks", allReferencedBlockIds)
    if (!referencedBlocks) {
      return null
    }
    
    // 分别处理不同类型的引用
    const inlineRefIds: DbId[] = []
    const propertyRefIds: DbId[] = []
    
    for (const ref of currentBlock.refs) {
      const referencedBlock = referencedBlocks.find((block: any) => block.id === ref.to)
      const isReferencedBlockAlias = referencedBlock && referencedBlock.aliases && referencedBlock.aliases.length > 0
      
      let isInlineRef = false
      
      // 基于DOM结构识别内联引用：data-type="r" 对应数字值
      if (ref.type === 0 || ref.type === 1) {
        isInlineRef = true
      }
      // 明确识别属性引用：有 data 属性且不是内联引用
      else if (ref.data && ref.data.length > 0) {
        this.log(`PageDisplay: 识别为属性引用 - ref.to: ${ref.to}, data:`, ref.data)
        isInlineRef = false
      }
      // 明确识别内联引用：有 alias 属性
      else if (ref.alias) {
        isInlineRef = true
      }
      // 明确识别标签引用：type = 2
      else if (ref.type === 2) {
        this.log(`PageDisplay: 识别为标签引用 - ref.to: ${ref.to}, type: ${ref.type}`)
        isInlineRef = false
        // 标签引用需要特殊处理，添加到标签块ID列表中
        if (!tagBlockIds.includes(ref.to)) {
          tagBlockIds.push(ref.to)
        }
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
      else if (ref.type !== undefined && ref.type > 2) {
        this.log(`PageDisplay: 根据type值识别为属性引用 - ref.to: ${ref.to}, type: ${ref.type}`)
        isInlineRef = false
      }
      // 默认情况：假设是内联引用（因为大多数引用都是内联的）
      else {
        isInlineRef = true
      }
      
      if (ref.type === 2) {
        // 标签引用不添加到任何引用列表中，因为已经在上面添加到tagBlockIds中
        this.log(`PageDisplay: 标签引用已处理 - ref.to: ${ref.to}`)
      } else if (isInlineRef) {
        inlineRefIds.push(ref.to)
      } else {
        propertyRefIds.push(ref.to)
      }
    }
    
    this.log("PageDisplay: 属性引用数量:", propertyRefIds.length)
    this.log("PageDisplay: 内联引用块ID:", inlineRefIds)
    this.log("PageDisplay: 属性引用块ID:", propertyRefIds)
    
    return { referencedBlocks, inlineRefIds, propertyRefIds }
  }

  private async getReferencedBlocks(blockId: DbId): Promise<ReferencedBlocksResult> {
    try {
      // 获取当前块的信息
      const currentBlock = await this.apiService.getBlock(blockId)
      if (!currentBlock) {
        return { blocks: [], tagBlockIds: [], inlineRefIds: [], propertyRefIds: [] }
      }

      // 1. 从当前块文本中解析标签
      const tagBlockIds = await this.parseTagsFromText(currentBlock.text || "")
      

      // 2. 处理引用
      const refResult = await this.processReferences(currentBlock, tagBlockIds)
      if (!refResult) {
        return { blocks: [], tagBlockIds: [], inlineRefIds: [], propertyRefIds: [] }
      }
      
      const { referencedBlocks, inlineRefIds, propertyRefIds } = refResult

      // 排除自身块
      const filteredBlocks = referencedBlocks.filter((block: any) => block.id !== blockId)
      
      this.log("PageDisplay: 找到被引用块数量:", filteredBlocks.length, "块:", filteredBlocks)
      return { blocks: filteredBlocks, tagBlockIds, inlineRefIds, propertyRefIds }
    } catch (error) {
      this.logError("Failed to get referenced blocks:", error)
      return { blocks: [], tagBlockIds: [], inlineRefIds: [], propertyRefIds: [] }
    }
  }

  
  // 带缓存的API调用（委托给API服务）
  private async cachedApiCall(apiType: string, ...args: any[]): Promise<any> {
    return this.apiService.call(apiType, ...args)
  }

  /**
   * 统一的API调用包装器，包含错误处理
   */
  private async safeApiCall<T>(
    apiCall: () => Promise<T>,
    errorMessage: string,
    fallbackValue: T
  ): Promise<T> {
    try {
      return await apiCall()
    } catch (error) {
      this.logError(errorMessage, error)
      return fallbackValue
    }
  }

  // 获取块信息（委托给API服务）

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

  /**
   * 检查引用是否为内联引用
   * 通过 refs 的类型信息来判断是否为内联引用
   * @param refs 引用信息数组
   * @returns 是否为内联引用
   */
  private isInlineReference(refs: any[]): boolean {
    if (!refs || refs.length === 0) {
      return false
    }
    
    this.log("PageDisplay: 检查引用类型，refs:", refs)
    
    // 检查是否有内联引用的特征
    for (const ref of refs) {
      this.log("PageDisplay: 检查单个引用:", ref)
      
      // 检查 type 值（内联引用的 type 通常是 0 或 1）
      if (ref.type === 0 || ref.type === 1) {
        this.log("PageDisplay: 通过type值识别为内联引用", ref.to, { type: ref.type })
        return true
      }
      
      // 检查是否有 alias 属性（内联引用通常有 alias）
      if (ref.alias) {
        this.log("PageDisplay: 通过alias属性识别为内联引用", ref.to)
        return true
      }
      
      // 检查是否为标签引用（标签引用不是内联引用）
      if (ref.type === 2) {
        this.log("PageDisplay: 排除标签引用", ref.to, { type: ref.type })
        continue
      }
      
      // 检查是否有明确的属性值引用特征
      const hasData = ref.data && ref.data.length > 0
      const hasPropertyValueType = ref.type !== undefined && ref.type > 2
      const hasPropertyValueFlag = ref.propertyValue || ref.isPropertyValue
      
      if (hasData || hasPropertyValueType || hasPropertyValueFlag) {
        this.log("PageDisplay: 识别为属性值引用，不是内联引用", ref.to, { type: ref.type, hasData, hasPropertyValueType, hasPropertyValueFlag })
        continue
      }
      
      // 其他情况认为是内联引用
      this.log("PageDisplay: 默认认为是内联引用", ref.to, { type: ref.type })
      return true
    }
    
    this.log("PageDisplay: 所有引用都不符合内联引用条件")
    return false
  }

  /**
   * 检查引用是否为属性值引用
   * 通过 refs 的类型信息来判断是否为属性值引用
   * @param refs 引用信息数组
   * @returns 是否为属性值引用
   */
  private isPropertyValueRef(refs: any[]): boolean {
    if (!refs || refs.length === 0) {
      return false
    }
    
    this.log("PageDisplay: 检查是否为属性值引用，refs:", refs)
    
    // 检查是否有属性值引用的特征
    for (const ref of refs) {
      this.log("PageDisplay: 检查单个引用是否为属性值引用:", ref)
      
      // 检查是否有 data 属性（属性引用通常有 data 属性）
      if (ref.data && ref.data.length > 0) {
        this.log("PageDisplay: 通过data属性识别为属性值引用", ref.to, { data: ref.data })
        return true
      }
      
      // 检查 type 值（属性引用的 type 通常大于 1，因为 0 和 1 是内联引用）
      if (ref.type !== undefined && ref.type > 1) {
        this.log("PageDisplay: 通过type值识别为属性值引用", ref.to, { type: ref.type })
        return true
      }
      
      // 检查是否有特定的属性值引用标记
      if (ref.propertyValue || ref.isPropertyValue) {
        this.log("PageDisplay: 通过标记识别为属性值引用", ref.to)
        return true
      }
    }
    
    this.log("PageDisplay: 不是属性值引用")
    return false
  }


  /**
   * 检查引用是否为内联引用（ref.type=1）
   * 专门用于子块引用的内联引用判断
   * @param refs 引用信息数组
   * @returns 是否为内联引用
   */
  private isInlineReferenceType1(refs: any[]): boolean {
    if (!refs || refs.length === 0) {
      return false
    }
    
    this.log("PageDisplay: 检查是否为内联引用（type=1），refs:", refs)
    
    // 检查是否有 ref.type=1 的引用
    for (const ref of refs) {
      this.log("PageDisplay: 检查单个引用是否为内联引用（type=1）:", ref)
      
      if (ref.type === 1) {
        this.log("PageDisplay: 通过type=1识别为内联引用", ref.to, { type: ref.type })
        return true
      }
    }
    
    this.log("PageDisplay: 没有找到type=1的内联引用")
    return false
  }

  // 获取子块中引用的内联块（排除别名块）
  private async getChildReferencedInlineBlocks(blockId: DbId, tagBlockIds: DbId[] = []): Promise<Block[]> {
    try {
      this.log(`PageDisplay: 开始获取子块内联块引用，块ID: ${blockId}`)
      
      // 获取当前块的信息
      const currentBlock = await this.apiService.getBlock(blockId)
      if (!currentBlock) {
        this.log(`PageDisplay: 无法获取当前块信息: ${blockId}`)
        return []
      }

      this.log(`PageDisplay: 当前块信息:`, { id: currentBlock.id, text: currentBlock.text, children: currentBlock.children })

      // 检查当前块是否有子块
      if (!currentBlock.children || currentBlock.children.length === 0) {
        this.log(`PageDisplay: 当前块没有子块: ${blockId}`)
        return []
      }

      // 获取所有子块的详细信息
      const childBlocks = await this.cachedApiCall("get-blocks", currentBlock.children)
      if (!childBlocks) {
        this.log(`PageDisplay: 无法获取子块信息`)
        return []
      }

      this.log(`PageDisplay: 获取到 ${childBlocks.length} 个子块`)

      // 收集所有子块引用的块ID，同时记录引用类型信息
      const allReferencedBlockIds: DbId[] = []
      const refTypeMap: Map<DbId, any[]> = new Map() // 存储块ID对应的引用信息
      
      for (const childBlock of childBlocks) {
        if (childBlock.refs && childBlock.refs.length > 0) {
          for (const ref of childBlock.refs) {
            const refTo = ref.to
            allReferencedBlockIds.push(refTo)
            
            // 记录引用类型信息
            if (!refTypeMap.has(refTo)) {
              refTypeMap.set(refTo, [])
            }
            refTypeMap.get(refTo)!.push(ref)
          }
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

      // 过滤出被引用的内联块（排除别名块）
      const childReferencedInlineBlocks: Block[] = []
      this.log(`PageDisplay: 开始过滤子块引用的内联块，总共 ${referencedBlocks.length} 个块`)
      
      for (const block of referencedBlocks) {
        // 排除自身块
        if (block.id === blockId) {
          this.log(`PageDisplay: 排除自身块 - ${block.id}`)
          continue
        }
        
        // 排除别名块（别名块应该在 child-referenced-alias 中处理）
        const hasAlias = block.aliases && block.aliases.length > 0
        this.log(`PageDisplay: 检查块 ${block.id} 是否有别名:`, { hasAlias, aliases: block.aliases, text: block.text })
        if (hasAlias) {
          this.log(`PageDisplay: 排除别名块 - ${block.id}: ${block.aliases?.[0] || block.text}`)
          continue
        }
        
        // 检查这个块是否被内联引用（ref.type=1）
        const refsForThisBlock = refTypeMap.get(block.id) || []
        this.log(`PageDisplay: 检查块 ${block.id} 的引用类型:`, refsForThisBlock)
        
        const isInlineRef = this.isInlineReferenceType1(refsForThisBlock)
        if (!isInlineRef) {
          this.log(`PageDisplay: 排除非内联引用 - ${block.id}: ${block.text}`)
          continue
        }
        
        // 排除标签块（通过块属性判断）
        const isTagBlock = this.isTagBlock(block)
        if (isTagBlock) {
          this.log(`PageDisplay: 排除标签块 - ${block.id}: ${block.text}`)
          continue
        }
        
        // 排除属性值引用
        const isPropertyValueRef = this.isPropertyValueRef(refsForThisBlock)
        if (isPropertyValueRef) {
          this.log(`PageDisplay: 排除属性值引用 - ${block.id}: ${block.text}`)
          continue
        }
        
        this.log(`PageDisplay: 保留子块引用的内联块 - ${block.id}: ${block.text}`)
        childReferencedInlineBlocks.push(block)
      }

      return childReferencedInlineBlocks
    } catch (error) {
      this.logError("Failed to get child referenced inline blocks:", error)
      return []
    }
  }

  // 处理子块引用的内联块
  private async processChildReferencedInlineItems(childReferencedInlineBlocks: Block[]): Promise<PageDisplayItem[]> {
    const childReferencedInlineItems: PageDisplayItem[] = []
    for (const block of childReferencedInlineBlocks) {
      this.log("PageDisplay: processing child referenced inline block", block)
      const hasName = (block.aliases && block.aliases.length > 0) || block.text
      if (hasName) {
        const displayText = (block.aliases && block.aliases[0]) || block.text || `子块内联引用 ${block.id}`
        const enhancedItem = await this.createPageDisplayItem(block, 'child-referenced-inline', displayText)
        childReferencedInlineItems.push(enhancedItem)
        this.log("PageDisplay: added child referenced inline item", { id: block.id, text: displayText })
      } else {
        this.log("PageDisplay: skipping child referenced inline block (no name/aliases)", block)
      }
    }
    return childReferencedInlineItems
  }

  /**
   * 检查引用是否为标签引用
   * 通过 refs 的类型信息来判断是否为标签引用
   * @param refs 引用信息数组
   * @returns 是否为标签引用
   */
  private isTagReference(refs: any[]): boolean {
    if (!refs || refs.length === 0) {
      return false
    }
    
    this.log("PageDisplay: 检查是否为标签引用，refs:", refs)
    
    // 检查是否有标签引用的特征
    for (const ref of refs) {
      this.log("PageDisplay: 检查单个引用是否为标签引用:", ref)
      
      // 检查 type 值（标签引用的 type 是 2）
      if (ref.type === 2) {
        this.log("PageDisplay: 通过type=2识别为标签引用", ref.to, { type: ref.type })
        return true
      }
    }
    
    this.log("PageDisplay: 不是标签引用")
    return false
  }

  /**
   * 检查块是否是属性值的别名块
   * 属性值的别名块通常有特定的属性特征，如属性值相关的属性
   * @param block 要检查的块
   * @returns 是否为属性值的别名块
   */
  private isPropertyValueAliasBlock(block: Block): boolean {
    // 检查是否有属性
    if (!block.properties || block.properties.length === 0) {
      return false
    }
    
    // 检查是否有属性值相关的属性
    // 属性值的别名块通常有特定的属性名称模式
    const propertyValuePatterns = [
      'value', 'values', 'property-value', 'prop-value',
      'attribute-value', 'attr-value', 'data-value'
    ]
    
    const hasPropertyValueAttribute = block.properties.some(prop => 
      propertyValuePatterns.some(pattern => 
        prop.name.toLowerCase().includes(pattern.toLowerCase())
      )
    )
    
    if (hasPropertyValueAttribute) {
      this.log("PageDisplay: 识别为属性值别名块", block.id, {
        properties: block.properties.map(p => ({ name: p.name, value: p.value }))
      })
      return true
    }
    
    // 检查是否有特定的属性值内容模式
    // 属性值的别名块可能有特定的文本内容模式
    const textContent = block.text || ''
    const aliasContent = block.aliases?.[0] || ''
    const contentToCheck = textContent || aliasContent
    
    // 检查是否包含属性值相关的关键词
    const propertyValueKeywords = ['值', 'value', '属性值', 'property value']
    const hasPropertyValueKeywords = propertyValueKeywords.some(keyword =>
      contentToCheck.toLowerCase().includes(keyword.toLowerCase())
    )
    
    if (hasPropertyValueKeywords) {
      this.log("PageDisplay: 通过关键词识别为属性值别名块", block.id, {
        text: textContent,
        alias: aliasContent
      })
      return true
    }
    
    return false
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
    let finalDisplayText = displayText || 
      (block.aliases && block.aliases[0]) || 
      block.text || 
      `块 ${block.id}`
    
    // 检查是否为日期块并格式化（仅对特定类型生效）
    this.log("PageDisplay: Checking if block is date block:", { 
      blockId: block.id, 
      text: block.text, 
      itemType: itemType,
      properties: block.properties 
    })
    
    // 只对属性引用类型（别名属性引用和块属性引用）进行日期格式化
    if ((itemType === 'property-ref-alias' || itemType === 'property-ref-block') && this.isDateBlock(block)) {
      this.log("PageDisplay: Block is property reference and identified as date block, formatting...")
      const formattedText = this.formatDateBlock(block, finalDisplayText)
      this.log("PageDisplay: Date formatting result:", { 
        original: finalDisplayText, 
        formatted: formattedText 
      })
      finalDisplayText = formattedText
    } else {
      this.log("PageDisplay: Block is not eligible for date formatting")
    }
    
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
      itemType: itemType,
      created: (block as any).created,
      modified: (block as any).modified
    }
    
    return await this.enhanceItemForSearch(baseItem, block)
  }

  /**
   * 检查是否为日期块
   * @param block 块数据
   * @returns 是否为日期块
   */
  private isDateBlock(block: Block): boolean {
    this.log("PageDisplay: isDateBlock check for block:", { 
      id: block.id, 
      text: block.text, 
      properties: block.properties 
    })
    
    // 检查块是否有日期相关的属性
    if (block.properties && block.properties.length > 0) {
      // 首先检查 _repr 属性中的 date 字段
      const reprProperty = block.properties.find(prop => prop.name === '_repr')
      if (reprProperty && reprProperty.value) {
        this.log("PageDisplay: Found _repr property:", reprProperty.value)
        if (typeof reprProperty.value === 'object' && reprProperty.value.date) {
          this.log("PageDisplay: _repr has date field, this is a date block")
          return true
        }
        // 也检查 keyi=12 的情况
        if (typeof reprProperty.value === 'object' && reprProperty.value.keyi === 12) {
          this.log("PageDisplay: _repr has keyi=12, this is a date block")
          return true
        }
      }
      
      // 检查其他日期相关属性
      const dateProperties = block.properties.find(prop => 
        prop.name === 'date' || 
        prop.name === 'created' || 
        prop.name === 'modified' ||
        prop.name === 'time'
      )
      if (dateProperties && dateProperties.value) {
        this.log("PageDisplay: Found date property:", dateProperties)
        return true
      }
    }
    
    // 检查文本内容是否包含日期格式
    if (block.text) {
      // 匹配常见的日期格式
      const datePatterns = [
        /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
        /^\d{4}\/\d{2}\/\d{2}$/, // YYYY/MM/DD
        /^\d{2}-\d{2}-\d{4}$/, // MM-DD-YYYY
        /^\d{2}\/\d{2}\/\d{4}$/, // MM/DD/YYYY
        /^\d{4}年\d{1,2}月\d{1,2}日$/, // 中文日期格式
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, // ISO 8601
      ]
      
      const textMatches = datePatterns.some(pattern => pattern.test(block.text?.trim() || ''))
      if (textMatches) {
        this.log("PageDisplay: Text matches date pattern")
        return true
      }
    }
    
    this.log("PageDisplay: Block is not identified as date block")
    return false
  }

  /**
   * 格式化日期块
   * @param block 日期块数据
   * @param originalText 原始文本
   * @returns 格式化后的文本
   */
  private formatDateBlock(block: Block, originalText: string): string {
    try {
      this.log("PageDisplay: formatDateBlock called with:", { 
        blockId: block.id, 
        originalText, 
        properties: block.properties 
      })
      
      // 首先尝试从 _repr 属性中获取格式化的日期
      if (block.properties && block.properties.length > 0) {
        const reprProperty = block.properties.find(prop => prop.name === '_repr')
        if (reprProperty && reprProperty.value) {
          this.log("PageDisplay: Found _repr property:", reprProperty.value)
          // 检查 _repr 中是否有 date 字段或 keyi=12 的格式化信息
          if (typeof reprProperty.value === 'object' && 
              (reprProperty.value.date || reprProperty.value.keyi === 12)) {
            this.log("PageDisplay: Found _repr with date field or keyi=12:", reprProperty.value)
            
            // 使用 _repr 中的格式化信息
            const formattedDate = this.formatDateFromRepr(block, reprProperty.value)
            if (formattedDate) {
              this.log("PageDisplay: Successfully formatted date from _repr:", formattedDate)
              return formattedDate
            }
          }
        }
        
        // 如果 _repr 没有提供格式化，尝试从其他日期属性中获取日期
        const dateProperty = block.properties.find(prop => 
          prop.name === 'date' || 
          prop.name === 'created' || 
          prop.name === 'modified' ||
          prop.name === 'time'
        )
        if (dateProperty && dateProperty.value) {
          this.log("PageDisplay: Found date property:", dateProperty)
          const date = new Date(dateProperty.value)
          if (!isNaN(date.getTime())) {
            const formatted = this.formatDate(date)
            this.log("PageDisplay: Formatted date from property:", formatted)
            return formatted
          }
        }
      }
      
      // 尝试从文本中解析日期
      const date = new Date(originalText)
      if (!isNaN(date.getTime())) {
        const formatted = this.formatDate(date)
        this.log("PageDisplay: Formatted date from text:", formatted)
        return formatted
      }
      
      // 如果无法解析，返回原始文本
      this.log("PageDisplay: Could not format date, returning original text")
      return originalText
    } catch (error) {
      this.logError("Failed to format date block:", error)
      return originalText
    }
  }

  /**
   * 从 _repr 属性中格式化日期
   * @param block 块数据
   * @param reprValue _repr 属性的值
   * @returns 格式化后的日期字符串
   */
  private formatDateFromRepr(block: Block, reprValue: any): string | null {
    try {
      // 检查 _repr 结构并提取日期信息
      if (reprValue && typeof reprValue === 'object') {
        this.log("PageDisplay: _repr value:", reprValue)
        
        // 首先检查 _repr 中的 date 字段
        if (reprValue.date) {
          this.log("PageDisplay: Found date field in _repr:", reprValue.date)
          const date = new Date(reprValue.date)
          if (!isNaN(date.getTime())) {
            const formatted = this.formatDate(date)
            this.log("PageDisplay: Formatted date from _repr.date:", formatted)
            return formatted
          }
        }
        
        // 如果 _repr 包含格式化的日期信息（直接使用）
        if (reprValue.formatted) {
          this.log("PageDisplay: Using formatted date from _repr:", reprValue.formatted)
          return reprValue.formatted
        }
        
        // 如果 _repr 包含样式格式（如 YYYY/MM/DD）
        if (reprValue.style || reprValue.format) {
          const style = reprValue.style || reprValue.format
          this.log("PageDisplay: Found date style format:", style)
          
          // 尝试从块的其他属性或文本中获取实际日期值
          const actualDate = this.extractDateFromBlock(block, reprValue)
          if (actualDate) {
            return this.formatDateWithStyle(actualDate, style)
          }
        }
        
        // 如果 _repr 包含日期值
        if (reprValue.value) {
          const date = new Date(reprValue.value)
          if (!isNaN(date.getTime())) {
            return this.formatDate(date)
          }
        }
        
        // 如果 _repr 包含时间戳
        if (reprValue.timestamp) {
          const date = new Date(reprValue.timestamp)
          if (!isNaN(date.getTime())) {
            return this.formatDate(date)
          }
        }
        
        // 如果 _repr 本身就是日期格式字符串
        if (typeof reprValue === 'string') {
          const date = new Date(reprValue)
          if (!isNaN(date.getTime())) {
            return this.formatDate(date)
          }
        }
      }
      
      return null
    } catch (error) {
      this.logError("Failed to format date from _repr:", error)
      return null
    }
  }

  /**
   * 从块中提取实际日期值
   * @param block 块数据
   * @param reprValue _repr 属性值
   * @returns 日期对象或 null
   */
  private extractDateFromBlock(block: Block, reprValue: any): Date | null {
    try {
      // 首先尝试从 _repr 的各个字段中提取日期
      const possibleDateFields = ['value', 'date', 'timestamp', 'time', 'created', 'modified']
      
      for (const field of possibleDateFields) {
        if (reprValue && reprValue[field]) {
          const date = new Date(reprValue[field])
          if (!isNaN(date.getTime())) {
            this.log(`PageDisplay: Found date in _repr.${field}:`, date)
            return date
          }
        }
      }
      
      // 如果 _repr 中没有日期，尝试从块的其他属性中获取
      if (block.properties && block.properties.length > 0) {
        const dateProperty = block.properties.find(prop => 
          prop.name === 'date' || 
          prop.name === 'created' || 
          prop.name === 'modified' ||
          prop.name === 'time' ||
          prop.name === 'timestamp'
        )
        if (dateProperty && dateProperty.value) {
          const date = new Date(dateProperty.value)
          if (!isNaN(date.getTime())) {
            this.log(`PageDisplay: Found date in block property ${dateProperty.name}:`, date)
            return date
          }
        }
      }
      
      // 最后尝试从块文本中解析日期
      if (block.text) {
        const date = new Date(block.text)
        if (!isNaN(date.getTime())) {
          this.log("PageDisplay: Found date in block text:", date)
          return date
        }
      }
      
      return null
    } catch (error) {
      this.logError("Failed to extract date from block:", error)
      return null
    }
  }

  /**
   * 使用指定样式格式化日期
   * @param date 日期对象
   * @param style 样式格式（如 YYYY/MM/DD）
   * @returns 格式化后的日期字符串
   */
  private formatDateWithStyle(date: Date, style: string): string {
    try {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')
      const seconds = String(date.getSeconds()).padStart(2, '0')
      
      // 替换样式中的占位符
      let formatted = style
        .replace(/YYYY/g, year.toString())
        .replace(/MM/g, month)
        .replace(/DD/g, day)
        .replace(/HH/g, hours)
        .replace(/mm/g, minutes)
        .replace(/ss/g, seconds)
      
      this.log("PageDisplay: Formatted date with style:", { original: style, result: formatted })
      return formatted
    } catch (error) {
      this.logError("Failed to format date with style:", error)
      return this.formatDate(date) // 回退到默认格式化
    }
  }

  /**
   * 格式化日期为可读格式
   * @param date 日期对象
   * @returns 格式化后的日期字符串
   */
  private formatDate(date: Date): string {
    const dateFormat = this.getDateFormat()
    this.log("PageDisplay: Formatting date with format:", { date, format: dateFormat })
    
    // 使用配置的日期格式
    if (dateFormat === 'yyyy-MM-dd') {
      return this.formatRelativeDate(date)
    }
    
    // 默认格式（回退）
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
  }

  /**
   * 格式化相对日期
   * @param date 日期对象
   * @returns 格式化后的相对日期字符串
   */
  private formatRelativeDate(date: Date): string {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    
    const diffTime = targetDate.getTime() - today.getTime()
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24))
    
    // 获取周几信息
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    const weekday = weekdays[date.getDay()]
    
    this.log("PageDisplay: Relative date calculation:", { 
      date, 
      today, 
      diffDays, 
      weekday
    })
    
    // 根据天数差返回相对日期
    if (diffDays === 0) {
      return `今天 ${weekday}`
    } else if (diffDays === 1) {
      return `明天 ${weekday}`
    } else if (diffDays === 2) {
      return `后天 ${weekday}`
    } else if (diffDays === 3) {
      return `大后天 ${weekday}`
    } else if (diffDays === -1) {
      return `昨天 ${weekday}`
    } else if (diffDays === -2) {
      return `前天 ${weekday}`
    } else if (diffDays === -3) {
      return `大前天 ${weekday}`
    } else {
      // 超过3天的日期，使用自然语言表达
      return this.formatNaturalRelativeDate(date, now, weekday)
    }
  }

  /**
   * 格式化自然相对日期
   * @param date 目标日期
   * @param now 当前日期
   * @param weekday 周几
   * @returns 自然相对日期字符串
   */
  private formatNaturalRelativeDate(date: Date, now: Date, weekday: string): string {
    const yearDiff = date.getFullYear() - now.getFullYear()
    const monthDiff = (date.getFullYear() - now.getFullYear()) * 12 + (date.getMonth() - now.getMonth())
    const dayDiff = Math.floor((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    
    // 获取完整日期格式
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const fullDate = `${year}-${month}-${day}`
    
    this.log("PageDisplay: Natural relative date calculation:", { 
      date, 
      now, 
      yearDiff, 
      monthDiff, 
      dayDiff, 
      weekday,
      fullDate
    })
    
    // 处理年份差异
    if (yearDiff < 0) {
      // 过去的年份
      const absYearDiff = Math.abs(yearDiff)
      if (absYearDiff === 1) {
        return `${fullDate} 前年 ${weekday}`
      } else if (absYearDiff === 2) {
        return `${fullDate} 前两年 ${weekday}`
      } else if (absYearDiff === 3) {
        return `${fullDate} 前三年 ${weekday}`
      } else if (absYearDiff <= 5) {
        return `${fullDate} 前${absYearDiff}年 ${weekday}`
      } else {
        // 超过5年，只显示日期
        return `${fullDate} ${weekday}`
      }
    } else if (yearDiff > 0) {
      // 未来的年份
      if (yearDiff === 1) {
        return `${fullDate} 明年 ${weekday}`
      } else if (yearDiff === 2) {
        return `${fullDate} 后年 ${weekday}`
      } else if (yearDiff <= 5) {
        return `${fullDate} ${yearDiff}年后 ${weekday}`
      } else {
        // 超过5年，只显示日期
        return `${fullDate} ${weekday}`
      }
    }
    
    // 同一年内，处理月份差异
    if (monthDiff < 0) {
      // 过去的月份
      const absMonthDiff = Math.abs(monthDiff)
      if (absMonthDiff === 1) {
        return `${fullDate} 上个月 ${weekday}`
      } else if (absMonthDiff === 2) {
        return `${fullDate} 前两个月 ${weekday}`
      } else if (absMonthDiff === 3) {
        return `${fullDate} 前三个月 ${weekday}`
      } else if (absMonthDiff === 6) {
        return `${fullDate} 半年前 ${weekday}`
      } else if (absMonthDiff < 12) {
        return `${fullDate} 前${absMonthDiff}个月 ${weekday}`
      }
    } else if (monthDiff > 0) {
      // 未来的月份
      if (monthDiff === 1) {
        return `${fullDate} 下个月 ${weekday}`
      } else if (monthDiff === 2) {
        return `${fullDate} 两个月后 ${weekday}`
      } else if (monthDiff === 3) {
        return `${fullDate} 三个月后 ${weekday}`
      } else if (monthDiff === 6) {
        return `${fullDate} 半年后 ${weekday}`
      } else if (monthDiff < 12) {
        return `${fullDate} ${monthDiff}个月后 ${weekday}`
      }
    }
    
    // 同一个月内，处理天数差异
    if (dayDiff < 0) {
      // 过去的天数
      const absDayDiff = Math.abs(dayDiff)
      if (absDayDiff === 7) {
        return `${fullDate} 前一周 ${weekday}`
      } else if (absDayDiff === 14) {
        return `${fullDate} 前两周 ${weekday}`
      } else if (absDayDiff === 15) {
        return `${fullDate} 半个月前 ${weekday}`
      } else if (absDayDiff < 30) {
        return `${fullDate} 前${absDayDiff}天 ${weekday}`
      }
    } else if (dayDiff > 0) {
      // 未来的天数
      if (dayDiff === 7) {
        return `${fullDate} 一周后 ${weekday}`
      } else if (dayDiff === 14) {
        return `${fullDate} 两周后 ${weekday}`
      } else if (dayDiff === 15) {
        return `${fullDate} 半个月后 ${weekday}`
      } else if (dayDiff < 30) {
        return `${fullDate} ${dayDiff}天后 ${weekday}`
      }
    }
    
    // 默认显示完整日期
    return `${fullDate} ${weekday}`
  }

  /**
   * 获取日期的周数
   * @param date 日期对象
   * @returns 周数
   */
  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
    const dayNum = d.getUTCDay() || 7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum)
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  }

  /**
   * 获取页面的直接子块
   * @param blockId 页面块ID
   * @returns 直接子块列表
   */
  private async getPageDirectChildren(blockId: DbId): Promise<Block[]> {
    try {
      this.log("PageDisplay: Getting page direct children for block:", blockId)
      
      // 先获取当前块的完整信息
      const currentBlock = await this.cachedApiCall("get-block", blockId)
      if (!currentBlock || !currentBlock.children || currentBlock.children.length === 0) {
        this.log("PageDisplay: No direct children found")
        return []
      }
      
      // 使用 get-blocks API 获取子块信息
      const childBlocks = await this.cachedApiCall("get-blocks", currentBlock.children)
      if (!childBlocks || !Array.isArray(childBlocks)) {
        this.log("PageDisplay: Failed to get child blocks")
        return []
      }
      
      this.log("PageDisplay: Found direct children:", childBlocks.length)
      return childBlocks
    } catch (error) {
      this.logError("Failed to get page direct children:", error)
      return []
    }
  }

  /**
   * 获取页面的递归子块（包括子块的子块）
   * @param blockId 页面块ID
   * @returns 递归子块列表
   */
  private async getPageRecursiveChildren(blockId: DbId): Promise<Block[]> {
    try {
      this.log("PageDisplay: Getting page recursive children for block:", blockId)
      
      const allChildren: Block[] = []
      const visited = new Set<DbId>()
      
      // 递归获取所有子块
      const collectChildren = async (parentId: DbId) => {
        if (visited.has(parentId)) {
          return // 避免循环引用
        }
        visited.add(parentId)
        
        // 先获取父块的完整信息
        const parentBlock = await this.cachedApiCall("get-block", parentId)
        if (!parentBlock || !parentBlock.children || parentBlock.children.length === 0) {
          return
        }
        
        // 使用 get-blocks API 获取子块信息
        const childBlocks = await this.cachedApiCall("get-blocks", parentBlock.children)
        if (childBlocks && Array.isArray(childBlocks)) {
          for (const child of childBlocks) {
            allChildren.push(child)
            // 递归获取子块的子块
            await collectChildren(child.id)
          }
        }
      }
      
      await collectChildren(blockId)
      
      this.log("PageDisplay: Found recursive children:", allChildren.length)
      return allChildren
    } catch (error) {
      this.logError("Failed to get page recursive children:", error)
      return []
    }
  }

  /**
   * 处理页面直接子块项目
   * @param pageDirectChildren 页面直接子块列表
   * @returns 页面直接子块显示项目列表
   */
  private async processPageDirectChildrenItems(pageDirectChildren: Block[]): Promise<PageDisplayItem[]> {
    const pageDirectChildrenItems: PageDisplayItem[] = []
    for (const block of pageDirectChildren) {
      const hasName = (block.aliases && block.aliases.length > 0) || block.text
      if (hasName) {
        const displayText = (block.aliases && block.aliases[0]) || block.text || `页面直接子块 ${block.id}`
        const enhancedItem = await this.createPageDisplayItem(block, 'page-direct-children', displayText)
        pageDirectChildrenItems.push(enhancedItem)
      }
    }
    return pageDirectChildrenItems
  }

  /**
   * 处理页面递归子块项目
   * @param pageRecursiveChildren 页面递归子块列表
   * @returns 页面递归子块显示项目列表
   */
  private async processPageRecursiveChildrenItems(pageRecursiveChildren: Block[]): Promise<PageDisplayItem[]> {
    const pageRecursiveChildrenItems: PageDisplayItem[] = []
    for (const block of pageRecursiveChildren) {
      const hasName = (block.aliases && block.aliases.length > 0) || block.text
      if (hasName) {
        const displayText = (block.aliases && block.aliases[0]) || block.text || `页面递归子块 ${block.id}`
        const enhancedItem = await this.createPageDisplayItem(block, 'page-recursive-children', displayText)
        pageRecursiveChildrenItems.push(enhancedItem)
      }
    }
    return pageRecursiveChildrenItems
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

  /**
   * 检查项目类型是否需要递归子内容搜索
   * 所有块类型都支持递归子内容搜索，包括别名块和普通块
   */
  private shouldIncludeChildrenInSearch(itemType: PageDisplayItemType): boolean {
    // 所有块类型都支持递归子内容搜索
    return true
  }

  /**
   * 查找匹配搜索词的子块（支持拼音搜索）
   * @param childBlocksInfo 子块信息列表
   * @param searchTerm 搜索词
   * @returns 匹配的子块列表
   */
  private findMatchingChildren(childBlocksInfo: ChildBlockInfo[], searchTerm: string): ChildBlockInfo[] {
    const keywords = searchTerm.toLowerCase().split(/\s+/).filter(k => k.length > 0)
    
    return childBlocksInfo.filter(child => {
      // 检查子块文本是否匹配（普通搜索）
      const textMatch = child.text && child.text.toLowerCase().includes(searchTerm.toLowerCase())
      
      // 检查子块别名是否匹配（普通搜索）
      const aliasMatch = child.aliases.some(alias => 
        alias.toLowerCase().includes(searchTerm.toLowerCase())
      )
      
      // 检查是否匹配任何关键词（普通搜索）
      const keywordMatch = keywords.some(keyword => {
        const textContains = child.text && child.text.toLowerCase().includes(keyword)
        const aliasContains = child.aliases.some(alias => alias.toLowerCase().includes(keyword))
        return textContains || aliasContains
      })
      
      // 检查拼音匹配
      const pinyinTextMatch = child.text && this.matchesPinyin(child.text, searchTerm)
      const pinyinAliasMatch = child.aliases.some(alias => this.matchesPinyin(alias, searchTerm))
      const pinyinKeywordMatch = keywords.some(keyword => {
        const textPinyinMatch = child.text && this.matchesPinyin(child.text, keyword)
        const aliasPinyinMatch = child.aliases.some(alias => this.matchesPinyin(alias, keyword))
        return textPinyinMatch || aliasPinyinMatch
      })
      
      return textMatch || aliasMatch || keywordMatch || pinyinTextMatch || pinyinAliasMatch || pinyinKeywordMatch
    })
  }


  /**
   * 递归获取块的所有子块内容（用于搜索）
   * @param blockId 块ID
   * @param level 当前层级深度
   * @returns 所有子块的文本内容和详细信息
   */
  private async getChildrenTextForSearch(blockId: DbId, level: number = 0): Promise<{ texts: string[], childBlocks: ChildBlockInfo[] }> {
    const texts: string[] = []
    const childBlocks: ChildBlockInfo[] = []
    
    try {
      // 获取当前块
      const block = await this.cachedApiCall("get-block", blockId)
      if (!block || !block.children || block.children.length === 0) {
        return { texts, childBlocks }
      }
      
      // 获取所有子块
      const childBlocksData = await this.cachedApiCall("get-blocks", block.children)
      if (!childBlocksData || !Array.isArray(childBlocksData)) {
        return { texts, childBlocks }
      }
      
      // 遍历子块
      for (const child of childBlocksData) {
        const childInfo: ChildBlockInfo = {
          id: child.id,
          text: child.text || '',
          aliases: child.aliases || [],
          level: level + 1
        }
        
        // 添加子块信息
        childBlocks.push(childInfo)
        
        // 添加子块文本到搜索文本
        if (child.text) {
          texts.push(child.text)
        }
        
        // 添加子块别名到搜索文本
        if (child.aliases && child.aliases.length > 0) {
          texts.push(...child.aliases)
        }
        
        // 递归获取子块的子块内容
        if (child.children && child.children.length > 0) {
          const grandchildResult = await this.getChildrenTextForSearch(child.id, level + 1)
          texts.push(...grandchildResult.texts)
          childBlocks.push(...grandchildResult.childBlocks)
        }
      }
      
      this.log(`🔍 块 ${blockId} 递归获取到 ${texts.length} 个子内容，${childBlocks.length} 个子块信息`)
    } catch (error) {
      this.logError(`获取块 ${blockId} 子内容失败:`, error)
    }
    
    return { texts, childBlocks }
  }

  // 直接使用 block.refs 解析搜索数据
  /**
   * 增强项目搜索数据
   * 为项目添加可搜索的文本数据，包括块内容、属性、引用等
   * 对于特殊别名块类型，会递归包含子块内容
   * @param item 要增强的项目
   * @param block 对应的块数据
   * @returns 增强后的项目
   */
  private async enhanceItemForSearch(item: PageDisplayItem, block: Block): Promise<PageDisplayItem> {
    // 收集所有可搜索的文本
    const searchableTexts = [item.text, ...item.aliases]
    let childBlocksInfo: ChildBlockInfo[] = []
    
    this.log(`🔍 开始解析块 ${block.id} 的搜索数据，类型: ${item.itemType}`)
    
    // 检查是否需要递归子内容搜索
    const needChildrenSearch = this.shouldIncludeChildrenInSearch(item.itemType)
    if (needChildrenSearch) {
      this.log(`🔍 块 ${block.id} 类型 ${item.itemType} 需要递归子内容搜索`)
      const childrenResult = await this.getChildrenTextForSearch(block.id)
      if (childrenResult.texts.length > 0) {
        searchableTexts.push(...childrenResult.texts)
        childBlocksInfo = childrenResult.childBlocks
        this.log(`🔍 块 ${block.id} 添加了 ${childrenResult.texts.length} 个子内容到搜索文本，${childBlocksInfo.length} 个子块信息`)
      }
    }
    
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
      searchableText: allSearchableText,
      childBlocksInfo: childBlocksInfo // 添加子块信息
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
      const parentBlock = orca.state.blocks[block.parent]
      if (parentBlock) {
        return parentBlock
      } else {
        // 如果父块不在状态中，记录日志但不返回undefined
        this.log("PageDisplay: Parent block not found in state", { 
          blockId: block.id, 
          parentId: block.parent 
        })
      }
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

    let rootBlockId = this.getCurrentRootBlockId()
    this.log("rootBlockId =", rootBlockId)
    
    // 检查是否需要跳过更新（除非强制更新）
    if (!force && this.shouldSkipUpdate(rootBlockId)) {
      return
    }
    
    // 处理Journal页面的特殊情况（当没有缓存时）
    if (rootBlockId === -1) {
      if (!this.journalPageSupport) {
        this.log("PageDisplay: Journal page support is disabled, removing display")
        this.removeDisplay()
        return
      }
      
      this.log("PageDisplay: Journal page cache miss, getting journal block ID")
      const journalBlockId = await this.getJournalBlockId()
      if (journalBlockId) {
        rootBlockId = journalBlockId
        this.log("PageDisplay: Journal block ID obtained:", rootBlockId)
      } else {
        this.log("PageDisplay: No journal block found, removing display")
        this.removeDisplay()
        return
      }
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

    let rootBlockId = this.getCurrentRootBlockId()
    const currentPanelId = this.getCurrentPanelId()
    this.log("rootBlockId =", rootBlockId, "currentPanelId =", currentPanelId)
    
    // 检查当前面板是否需要跳过更新
    if (this.shouldSkipCurrentPanelUpdate(rootBlockId, currentPanelId)) {
      return
    }
    
    // 处理Journal页面的特殊情况（当没有缓存时）
    if (rootBlockId === -1) {
      if (!this.journalPageSupport) {
        this.log("PageDisplay: Journal page support is disabled, removing current panel display")
        this.removeDisplay(currentPanelId)
        return
      }
      
      this.log("PageDisplay: Journal page cache miss in current panel, getting journal block ID")
      const journalBlockId = await this.getJournalBlockId()
      if (journalBlockId) {
        rootBlockId = journalBlockId
        this.log("PageDisplay: Journal block ID obtained:", rootBlockId)
      } else {
        this.log("PageDisplay: No journal block found, removing current panel display")
        this.removeDisplay(currentPanelId)
        return
      }
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
    
    // 先获取被引用块结果，以便获取标签块ID列表
    const referencedResult = await this.getReferencedBlocks(rootBlockId)
    const { tagBlockIds } = referencedResult

    // 并行加载所有数据，根据设置决定是否执行反链别名块查询
    const [
      childrenTags,
      containedInBlockIds,
      referencingAliasBlocks,
      childReferencedAliasBlocks,
      childReferencedTagAliasBlocks,
      childReferencedInlineBlocks,
      pageDirectChildren,
      pageRecursiveChildren,
      backrefAliasBlocks,
      backrefBlocks,
      recursiveBackrefBlocks,
      recursiveBackrefAliasBlocks
    ] = await Promise.all([
      this.apiService.getChildrenTags(rootBlockId),
      this.getContainedInBlocks(),
      this.getReferencingAliasBlocks(rootBlockId),
      this.getChildReferencedAliasBlocks(rootBlockId, tagBlockIds),
      this.getChildReferencedTagAliasBlocks(rootBlockId, tagBlockIds),
      this.getChildReferencedInlineBlocks(rootBlockId, tagBlockIds),
      this.getPageDirectChildren(rootBlockId),
      this.getPageRecursiveChildren(rootBlockId),
      this.backrefAliasQueryEnabled ? this.getBackrefAliasBlocks(rootBlockId) : Promise.resolve([]),
      this.getBackrefBlocks(rootBlockId),
      this.getRecursiveBackrefBlocks(rootBlockId),
      this.getRecursiveBackrefAliasBlocks(rootBlockId)
    ])
    
    const result: GatheredData = {
      childrenTags,
      referencedResult,
      containedInBlockIds,
      referencingAliasBlocks,
      childReferencedAliasBlocks,
      childReferencedTagAliasBlocks,
      childReferencedInlineBlocks,
      pageDirectChildren,
      pageRecursiveChildren,
      backrefAliasBlocks,
      backrefBlocks,
      recursiveBackrefBlocks,
      recursiveBackrefAliasBlocks
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
    this.journalBlockCache.clear()
    this.journalBlockCacheTimestamps.clear()
  }

  /**
   * 清理过期缓存
   */
  private clearExpiredCache(): void {
    const now = Date.now()
    
    // 清理普通缓存
    for (const [blockId, timestamp] of this.cacheTimestamps.entries()) {
      if (now - timestamp > this.CACHE_DURATION) {
        this.dataCache.delete(blockId)
        this.cacheTimestamps.delete(blockId)
      }
    }
    
    // 清理Journal页面缓存
    for (const [dateKey, timestamp] of this.journalBlockCacheTimestamps.entries()) {
      if (now - timestamp > this.JOURNAL_CACHE_DURATION) {
        this.journalBlockCache.delete(dateKey)
        this.journalBlockCacheTimestamps.delete(dateKey)
      }
    }
  }

  /**
   * 处理数据并转换为显示项目（优化版）
   */
  private async processDataToItems(data: GatheredData): Promise<ProcessedItemsResult> {
    const { childrenTags, referencedResult, containedInBlockIds, referencingAliasBlocks, childReferencedAliasBlocks, childReferencedTagAliasBlocks, childReferencedInlineBlocks, pageDirectChildren, pageRecursiveChildren, backrefAliasBlocks, backrefBlocks, recursiveBackrefBlocks, recursiveBackrefAliasBlocks } = data
    const { blocks: referencedBlocks, tagBlockIds, inlineRefIds, propertyRefIds } = referencedResult

    const promises = [] as Promise<PageDisplayItem[]>[]

    promises.push(childrenTags?.length ? this.processTagItems(childrenTags) : Promise.resolve([]))
    promises.push(referencedBlocks?.length ? this.processReferencedItems(referencedBlocks, tagBlockIds, inlineRefIds, containedInBlockIds, propertyRefIds) : Promise.resolve([]))
    promises.push(containedInBlockIds?.length ? this.processContainedInItems(containedInBlockIds) : Promise.resolve([]))
    promises.push(referencingAliasBlocks?.length ? this.processReferencingAliasItems(referencingAliasBlocks) : Promise.resolve([]))
    promises.push(childReferencedAliasBlocks?.length ? this.processChildReferencedAliasItems(childReferencedAliasBlocks) : Promise.resolve([]))
    promises.push(childReferencedTagAliasBlocks?.length ? this.processChildReferencedTagAliasItems(childReferencedTagAliasBlocks) : Promise.resolve([]))
    promises.push(childReferencedInlineBlocks?.length ? this.processChildReferencedInlineItems(childReferencedInlineBlocks) : Promise.resolve([]))
    promises.push(pageDirectChildren?.length ? this.processPageDirectChildrenItems(pageDirectChildren) : Promise.resolve([]))
    promises.push(pageRecursiveChildren?.length ? this.processPageRecursiveChildrenItems(pageRecursiveChildren) : Promise.resolve([]))
    promises.push(backrefAliasBlocks?.length ? this.processBackrefAliasItems(backrefAliasBlocks) : Promise.resolve([]))
    promises.push(backrefBlocks?.length ? this.processBackrefItems(backrefBlocks) : Promise.resolve([]))
    promises.push(recursiveBackrefBlocks?.length ? this.processRecursiveBackrefItems(recursiveBackrefBlocks) : Promise.resolve([]))
    promises.push(recursiveBackrefAliasBlocks?.length ? this.processRecursiveBackrefAliasItems(recursiveBackrefAliasBlocks) : Promise.resolve([]))

    const [tagItems, referencedItems, containedInItems, referencingAliasItems, childReferencedAliasItems, childReferencedTagAliasItems, childReferencedInlineItems, pageDirectChildrenItems, pageRecursiveChildrenItems, backrefAliasItems, backrefItems, recursiveBackrefItems, recursiveBackrefAliasItems] = await Promise.all(promises)

    this.log(`PageDisplay: 数据处理完成 - tagItems: ${tagItems.length}, referencedItems: ${referencedItems.length}, containedInItems: ${containedInItems.length}, referencingAliasItems: ${referencingAliasItems.length}, childReferencedAliasItems: ${childReferencedAliasItems.length}, childReferencedTagAliasItems: ${childReferencedTagAliasItems.length}, childReferencedInlineItems: ${childReferencedInlineItems.length}, pageDirectChildrenItems: ${pageDirectChildrenItems.length}, pageRecursiveChildrenItems: ${pageRecursiveChildrenItems.length}, backrefAliasItems: ${backrefAliasItems.length}, backrefItems: ${backrefItems.length}, recursiveBackrefItems: ${recursiveBackrefItems.length}, recursiveBackrefAliasItems: ${recursiveBackrefAliasItems.length}`)

    // 将referencedItems按类型分开
    const referencedItemsByType = referencedItems.reduce((acc, item) => {
      if (!acc[item.itemType]) {
        acc[item.itemType] = []
      }
      acc[item.itemType].push(item)
      return acc
    }, {} as Record<PageDisplayItemType, PageDisplayItem[]>)

    const groupSource: Record<PageDisplayItemType, PageDisplayItem[]> = {
      tag: tagItems, // 只包含子标签
      'referenced-tag': referencedItemsByType['referenced-tag'] || [], // 被引用的标签块
      'property-ref-alias': referencedItemsByType['property-ref-alias'] || [], // 别名属性引用
      'property-ref-block': referencedItemsByType['property-ref-block'] || [], // 块属性引用
      'contained-in': containedInItems,
      'inline-ref': referencedItemsByType['inline-ref'] || [],
      'page-direct-children': pageDirectChildrenItems, // 页面直接子块
      'page-recursive-children': pageRecursiveChildrenItems, // 页面递归子块
      'referencing-alias': referencingAliasItems,
      'child-referenced-alias': childReferencedAliasItems,
      'child-referenced-tag-alias': childReferencedTagAliasItems,
      'child-referenced-inline': childReferencedInlineItems,
      'backref-alias-blocks': backrefAliasItems,
      'backref': backrefItems,
      'recursive-backref': recursiveBackrefItems,
      'recursive-backref-alias': recursiveBackrefAliasItems
    }

    const groupedItems = this.buildGroupedItems(groupSource, tagBlockIds, containedInBlockIds)
    const uniqueItems: PageDisplayItem[] = []

    const groupTypes: PageDisplayItemType[] = ['tag', 'referenced-tag', 'property-ref-alias', 'property-ref-block', 'contained-in', 'inline-ref', 'page-direct-children', 'page-recursive-children', 'referencing-alias', 'recursive-backref-alias', 'child-referenced-alias', 'child-referenced-tag-alias', 'child-referenced-inline', 'backref-alias-blocks', 'backref', 'recursive-backref']
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
  private async processReferencedItems(referencedBlocks: Block[], tagBlockIds: DbId[], inlineRefIds: DbId[], containedInBlockIds: DbId[], propertyRefIds: DbId[]): Promise<PageDisplayItem[]> {
    const referencedItems: PageDisplayItem[] = []
    
    for (const block of referencedBlocks) {
      this.log("PageDisplay: processing referenced block", block)
      
      // 检查是否为标签块
      const isTagBlock = tagBlockIds.includes(block.id)
      const isInlineRef = inlineRefIds.includes(block.id)
      const isContainedIn = containedInBlockIds.includes(block.id)
      const isPropertyRef = propertyRefIds.includes(block.id)
      
      // 被引用的块显示条件：必须有别名或文本内容，但属性引用块例外
      const hasName = (block.aliases && block.aliases.length > 0) || block.text
      const isPropertyRefBlock = isPropertyRef
      
      if (hasName || isPropertyRefBlock) {
        const displayText = (block.aliases && block.aliases[0]) || block.text || (isPropertyRefBlock ? `属性引用块 ${block.id}` : `被引用块 ${block.id}`)
        
        // 根据引用类型确定itemType
        let itemType: PageDisplayItemType
        if (isTagBlock) {
          itemType = 'referenced-tag' // 被引用的标签块
        } else if (isContainedIn) {
          // 包含于块现在由 processContainedInItems 单独处理，这里跳过
          this.log(`PageDisplay: skipping contained-in block in referenced processing: ${block.id}`)
          continue
        } else if (isInlineRef) {
          itemType = 'inline-ref' // 内联引用
        } else if (isPropertyRef) {
          // 属性引用块根据是否有别名分类
          const hasAlias = block.aliases && block.aliases.length > 0
          if (hasAlias) {
            itemType = 'property-ref-alias' // 别名属性引用
            this.log(`PageDisplay: 设置为别名属性引用 (property-ref-alias) - ${block.id}: ${displayText}`)
          } else {
            itemType = 'property-ref-block' // 块属性引用
            this.log(`PageDisplay: 设置为块属性引用 (property-ref-block) - ${block.id}: ${displayText}`)
          }
        } else {
          // 如果都不匹配，跳过这个块
          this.log(`PageDisplay: 跳过未分类的引用块 - ${block.id}: ${displayText}`)
          continue
        }
        
        const enhancedItem = await this.createPageDisplayItem(block, itemType, displayText)
        referencedItems.push(enhancedItem)
        
        this.log("PageDisplay: added referenced item", { id: block.id, text: displayText, isTagBlock, isInlineRef, isContainedIn, isPropertyRef, itemType })
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
    
    this.log(`PageDisplay: 开始处理包含于项目，共 ${containedInBlockIds.length} 个块ID`)
    
    for (const blockId of containedInBlockIds) {
      try {
        this.log(`PageDisplay: processing contained in block ID: ${blockId}`)
        
        // 获取块数据
        const block = await this.cachedApiCall("get-block", blockId)
        if (!block) {
          this.log(`PageDisplay: block not found for ID: ${blockId}`)
          continue
        }
        
        this.log(`PageDisplay: 获取到块数据:`, block)
        
        // 检查是否有名称或别名
        const hasName = (block.aliases && block.aliases.length > 0) || block.text
        if (hasName) {
          const displayText = (block.aliases && block.aliases[0]) || block.text || `包含于块 ${block.id}`
          const enhancedItem = await this.createPageDisplayItem(block, 'contained-in', displayText)
          
          // 确保包含于块有正确的标识
          enhancedItem._hide = false // 确保显示
          enhancedItem.itemType = 'contained-in' // 确保类型正确
          
          containedInItems.push(enhancedItem)
          
          this.log(`PageDisplay: added contained in item: ${displayText}, itemType: ${enhancedItem.itemType}`)
        } else {
          this.log(`PageDisplay: skipping contained in block (no name/aliases): ${blockId}`)
        }
      } catch (error) {
        this.logError(`Failed to process contained in block ${blockId}:`, error)
      }
    }
    
    this.log(`PageDisplay: 处理完成，共生成 ${containedInItems.length} 个包含于项目`)
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
   * 处理子块引用标签别名项目
   */
  private async processChildReferencedTagAliasItems(childReferencedTagAliasBlocks: Block[]): Promise<PageDisplayItem[]> {
    const childReferencedTagAliasItems: PageDisplayItem[] = []
    
    for (const block of childReferencedTagAliasBlocks) {
      this.log("PageDisplay: processing child referenced tag alias block", block)
      
      // 检查是否有名称或别名
      const hasName = (block.aliases && block.aliases.length > 0) || block.text
      if (hasName) {
        const displayText = (block.aliases && block.aliases[0]) || block.text || `子块标签别名 ${block.id}`
        const enhancedItem = await this.createPageDisplayItem(block, 'child-referenced-tag-alias', displayText)
        childReferencedTagAliasItems.push(enhancedItem)
        
        this.log("PageDisplay: added child referenced tag alias item", { id: block.id, text: displayText })
      } else {
        this.log("PageDisplay: skipping child referenced tag alias block (no name/aliases)", block)
      }
    }
    
    return childReferencedTagAliasItems
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
   * 处理直接反链块项目
   */
  private async processBackrefItems(backrefBlocks: Block[]): Promise<PageDisplayItem[]> {
    const backrefItems: PageDisplayItem[] = []
    
    for (const block of backrefBlocks) {
      this.log("PageDisplay: processing backref block", block)
      
      const displayText = (block.aliases && block.aliases[0]) || block.text || `反链块 ${block.id}`
      const enhancedItem = await this.createPageDisplayItem(block, 'backref', displayText)
      backrefItems.push(enhancedItem)
      
      this.log("PageDisplay: added backref item", { id: block.id, text: displayText, aliases: block.aliases })
    }
    
    return backrefItems
  }

  /**
   * 处理递归反链块项目
   */
  private async processRecursiveBackrefItems(recursiveBackrefBlocks: Block[]): Promise<PageDisplayItem[]> {
    const recursiveBackrefItems: PageDisplayItem[] = []
    
    for (const block of recursiveBackrefBlocks) {
      this.log("PageDisplay: processing recursive backref block", block)
      
      const displayText = (block.aliases && block.aliases[0]) || block.text || `递归反链块 ${block.id}`
      const enhancedItem = await this.createPageDisplayItem(block, 'recursive-backref', displayText)
      recursiveBackrefItems.push(enhancedItem)
      
      this.log("PageDisplay: added recursive backref item", { id: block.id, text: displayText, aliases: block.aliases })
    }
    
    return recursiveBackrefItems
  }

  /**
   * 处理递归反链别名块项目
   */
  private async processRecursiveBackrefAliasItems(recursiveBackrefAliasBlocks: Block[]): Promise<PageDisplayItem[]> {
    const recursiveBackrefAliasItems: PageDisplayItem[] = []
    
    for (const block of recursiveBackrefAliasBlocks) {
      this.log("PageDisplay: processing recursive backref alias block", block)
      
      const displayText = (block.aliases && block.aliases[0]) || block.text || `递归反链别名块 ${block.id}`
      const enhancedItem = await this.createPageDisplayItem(block, 'recursive-backref-alias', displayText)
      recursiveBackrefAliasItems.push(enhancedItem)
      
      this.log("PageDisplay: added recursive backref alias item", { id: block.id, text: displayText, aliases: block.aliases })
    }
    
    return recursiveBackrefAliasItems
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
        
        // 查找标签层级结构元素 - 尝试多种选择器策略
        let hierarchyElement = this.findTagHierarchyElement()
        
        if (!hierarchyElement) {
          this.log(`尝试 ${attempt}: 未找到标签层级结构元素`)
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay))
            continue
          }
          return []
        }

        // 查找标签层级文本元素 - 使用多种选择器
        const tagText = this.extractTagHierarchyText(hierarchyElement)
        if (!tagText) {
          this.log(`尝试 ${attempt}: 标签层级文本为空`)
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay))
            continue
          }
          return []
        }

        this.log(`找到标签层级文本: "${tagText}"`)

        // 通过别名查找对应的块ID - 改进错误处理
        try {
          const blockIdResult = await this.findBlockIdByAlias(tagText)
          if (blockIdResult) {
            this.log(`找到包含于块ID: ${blockIdResult} (别名: ${tagText})`)
            return [blockIdResult]
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

  /**
   * 查找标签层级结构元素 - 使用多种选择器策略
   */
  private findTagHierarchyElement(): HTMLElement | null {
    // 策略1: 直接查找标准选择器
    let element = document.querySelector('.orca-repr-tag-hierarchy') as HTMLElement
    if (element) {
      return element
    }

    // 策略2: 在活动面板中查找
    const activePanel = document.querySelector('.orca-panel.active')
    if (activePanel) {
      element = activePanel.querySelector('.orca-repr-tag-hierarchy') as HTMLElement
      if (element) {
        return element
      }
    }

    // 策略3: 查找所有可能的层级结构元素
    const allElements = document.querySelectorAll('.orca-repr-tag-hierarchy')
    
    for (const el of allElements) {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        return el as HTMLElement
      }
    }

    // 策略4: 尝试更通用的选择器
    const genericSelectors = [
      '[class*="tag-hierarchy"]',
      '[class*="hierarchy"]',
      '[class*="tag"]',
      '.tag-hierarchy',
      '.hierarchy'
    ]

    for (const selector of genericSelectors) {
      element = document.querySelector(selector) as HTMLElement
      if (element && element.textContent && element.textContent.trim()) {
        return element
      }
    }

    return null
  }

  /**
   * 提取标签层级文本
   */
  private extractTagHierarchyText(element: HTMLElement): string | null {
    // 策略1: 查找标准文本元素
    let textElement = element.querySelector('span.orca-repr-tag-hierarchy-text')
    if (textElement) {
      const text = textElement.textContent?.trim()
      if (text) {
        return text
      }
    }

    // 策略2: 查找任何包含文本的span元素
    const spans = element.querySelectorAll('span')
    for (const span of spans) {
      const text = span.textContent?.trim()
      if (text && text.length > 0 && text.length < 100) { // 合理的文本长度
        return text
      }
    }

    // 策略3: 直接使用元素的文本内容
    const directText = element.textContent?.trim()
    if (directText && directText.length > 0 && directText.length < 100) {
      return directText
    }

    return null
  }

  /**
   * 通过别名查找块ID - 改进错误处理
   */
  private async findBlockIdByAlias(alias: string): Promise<DbId | null> {
    try {
      const result = await this.cachedApiCall("get-blockid-by-alias", alias)
      
      // 处理不同的返回格式
      if (result && typeof result === 'object' && result.id) {
        return result.id
      } else if (typeof result === 'number') {
        return result
      } else if (typeof result === 'string') {
        const numResult = parseInt(result, 10)
        if (!isNaN(numResult)) {
          return numResult
        }
      }
      
      return null
    } catch (error) {
      this.logError(`查找别名 "${alias}" 对应的块ID失败:`, error)
      return null
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
    arrow.innerHTML = '<i class="ti ti-chevron-right"></i>'
    this.applyStyles(arrow, 'page-display-arrow')
    
    // 设置初始状态：根据当前页面状态设置箭头方向
    if (!this.getCurrentPageCollapseState()) {
      arrow.innerHTML = '<i class="ti ti-chevron-down"></i>'
    }
    
    // 创建标题文本
    const title = document.createElement('div')
    title.textContent = '页面空间'
    this.applyStyles(title, 'page-display-title')
    
    // 创建页面统计信息
    const pageCount = document.createElement('span')
    this.applyStyles(pageCount, 'page-display-count')
    pageCount.textContent = '(0)'
    
    // 创建功能按钮容器
    const functionButtonsContainer = document.createElement('div')
    functionButtonsContainer.className = 'page-display-function-buttons-container'
    functionButtonsContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: 4px;
      opacity: 0;
      transition: opacity 0.2s ease;
      flex-shrink: 0;
    `
    
    // 创建刷新图标
    const refreshIcon = document.createElement('div')
    refreshIcon.innerHTML = '<i class="ti ti-refresh"></i>'
    refreshIcon.className = 'page-display-refresh-icon'
    this.applyStyles(refreshIcon, 'page-display-refresh-icon')
    refreshIcon.title = '刷新页面空间'
    
    // 创建搜索图标
    const searchIcon = document.createElement('div')
    searchIcon.innerHTML = '<i class="ti ti-search"></i>'
    searchIcon.className = 'page-display-search-icon'
    this.applyStyles(searchIcon, 'page-display-search-icon')
    
    // 创建类型过滤图标
    const filterIcon = document.createElement('div')
    filterIcon.innerHTML = '<i class="ti ti-settings"></i>'
    filterIcon.className = 'page-display-filter-icon'
    this.applyStyles(filterIcon, 'page-display-filter-icon')
    
    // 创建日期过滤图标
    const dateFilterIcon = document.createElement('div')
    dateFilterIcon.innerHTML = '<i class="ti ti-calendar"></i>'
    dateFilterIcon.className = 'page-display-date-filter-icon'
    this.applyStyles(dateFilterIcon, 'page-display-date-filter-icon')
    
    // 创建图标显示切换按钮
    const iconsToggleIcon = document.createElement('div')
    iconsToggleIcon.innerHTML = this.showIcons ? '<i class="ti ti-eye"></i>' : '<i class="ti ti-eye-off"></i>'
    iconsToggleIcon.className = 'page-display-icons-toggle-icon'
    this.applyStyles(iconsToggleIcon, 'page-display-icons-toggle-icon')
    iconsToggleIcon.title = this.showIcons ? '隐藏图标' : '显示图标'
    
    // 创建多行显示切换按钮
    const multiLineToggleIcon = document.createElement('div')
    multiLineToggleIcon.innerHTML = '<i class="ti ti-layout-rows"></i>'
    multiLineToggleIcon.className = 'page-display-multiline-toggle-icon'
    this.applyStyles(multiLineToggleIcon, 'page-display-multiline-toggle-icon')
    multiLineToggleIcon.title = this.multiLine ? '单行显示' : '多行显示'
    
    // 创建多列显示切换按钮
    const multiColumnToggleIcon = document.createElement('div')
    multiColumnToggleIcon.innerHTML = '<i class="ti ti-layout-grid"></i>'
    multiColumnToggleIcon.className = 'page-display-multicolumn-toggle-icon'
    this.applyStyles(multiColumnToggleIcon, 'page-display-multicolumn-toggle-icon')
    multiColumnToggleIcon.title = this.multiColumn ? '单列显示' : '多列显示'
    
    // 创建排序图标
    const sortIcon = document.createElement('div')
    // 从面板状态中获取当前排序配置，设置初始图标
    const initialState = this.getPanelState(targetPanelId)
    const initialSortConfig = initialState.sortConfig || { field: 'created', order: 'desc' }
    const initialIcon = initialSortConfig.order === 'asc' ? 'ti-sort-ascending' : 'ti-sort-descending'
    sortIcon.innerHTML = `<i class="ti ${initialIcon}"></i>`
    sortIcon.className = 'page-display-sort-icon'
    this.applyStyles(sortIcon, 'page-display-sort-icon')
    sortIcon.title = '排序选项'
    
    // 将所有按钮添加到容器中
    functionButtonsContainer.appendChild(refreshIcon)
    functionButtonsContainer.appendChild(searchIcon)
    functionButtonsContainer.appendChild(filterIcon)
    functionButtonsContainer.appendChild(dateFilterIcon)
    functionButtonsContainer.appendChild(sortIcon)
    functionButtonsContainer.appendChild(iconsToggleIcon)
    functionButtonsContainer.appendChild(multiLineToggleIcon)
    functionButtonsContainer.appendChild(multiColumnToggleIcon)
    
    leftContent.appendChild(arrow)
    leftContent.appendChild(title)
    leftContent.appendChild(pageCount)
    titleContainer.appendChild(leftContent)
    titleContainer.appendChild(functionButtonsContainer)
    
    container.appendChild(titleContainer)
    
    // 创建类型过滤控制面板
    const typeFilterPanel = this.createTypeFilterPanel()
    container.appendChild(typeFilterPanel)
    
    // 创建日期过滤控制面板
    const dateFilterPanel = this.createDateFilterPanel()
    container.appendChild(dateFilterPanel)
    
    // 创建排序控制面板
    const sortPanel = this.createSortPanel()
    container.appendChild(sortPanel)
    
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
    
    // 刷新图标点击事件
    refreshIcon.addEventListener('click', async (e) => {
      e.preventDefault()
      e.stopPropagation()
      
      // 添加旋转动画
      const icon = refreshIcon.querySelector('i')
      if (icon) {
        icon.style.transition = 'transform 0.5s ease'
        icon.style.transform = 'rotate(360deg)'
        
        // 动画结束后重置
        setTimeout(() => {
          icon.style.transform = 'rotate(0deg)'
        }, 500)
      }
      
      // 强制刷新当前面板数据
      try {
        // 先清除所有缓存（包括 API 服务缓存）
        this.clearCache()
        this.apiService.clearCache()
        // 然后强制更新
        await this.performUpdate(true)
      } catch (error) {
        this.logError('刷新页面空间失败:', error)
      }
    })
    
    // 搜索图标点击事件
    
    // 过滤图标点击事件
    filterIcon.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      
      // 添加点击反馈
      filterIcon.style.transform = 'scale(0.95)'
      setTimeout(() => {
        filterIcon.style.transform = 'scale(1)'
      }, 100)
      
      this.toggleTypeFilters()
      
      if (this.showTypeFilters) {
        // 显示面板 - 使用透明度过渡
        typeFilterPanel.style.display = 'block'
        // 强制重排以确保初始状态正确
        typeFilterPanel.offsetHeight
        typeFilterPanel.style.opacity = '1'
        typeFilterPanel.style.visibility = 'visible'
        typeFilterPanel.style.transform = 'translateY(0)'
        
        // 更新复选框状态
        this.updateTypeFilterPanelCheckboxes(typeFilterPanel)
      } else {
        // 隐藏面板 - 立即设置display为none，避免空白区域
        typeFilterPanel.style.display = 'none'
        typeFilterPanel.style.opacity = '0'
        typeFilterPanel.style.visibility = 'hidden'
        typeFilterPanel.style.transform = 'translateY(-10px)'
      }
    })
    
    // 日期过滤图标点击事件
    dateFilterIcon.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      
      // 添加点击反馈
      dateFilterIcon.style.transform = 'scale(0.95)'
      setTimeout(() => {
        dateFilterIcon.style.transform = 'scale(1)'
      }, 100)
      
      this.toggleDateFilters()
      
      if (this.showDateFilters) {
        // 显示面板 - 使用透明度过渡
        dateFilterPanel.style.display = 'block'
        // 强制重排以确保初始状态正确
        dateFilterPanel.offsetHeight
        dateFilterPanel.style.opacity = '1'
        dateFilterPanel.style.visibility = 'visible'
        dateFilterPanel.style.transform = 'translateY(0)'
      } else {
        // 隐藏面板 - 立即设置display为none，避免空白区域
        dateFilterPanel.style.display = 'none'
        dateFilterPanel.style.opacity = '0'
        dateFilterPanel.style.visibility = 'hidden'
        dateFilterPanel.style.transform = 'translateY(-10px)'
      }
    })
    
    // 排序图标点击事件
    let isSortPanelVisible = false
    sortIcon.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      
      // 添加点击反馈
      sortIcon.style.transform = 'scale(0.95)'
      setTimeout(() => {
        sortIcon.style.transform = 'scale(1)'
      }, 100)
      
      isSortPanelVisible = !isSortPanelVisible
      
      if (isSortPanelVisible) {
        // 显示面板 - 使用透明度过渡
        sortPanel.style.display = 'block'
        // 强制重排以确保初始状态正确
        sortPanel.offsetHeight
        sortPanel.style.opacity = '1'
        sortPanel.style.visibility = 'visible'
        sortPanel.style.transform = 'translateY(0)'
        sortIcon.style.background = 'var(--page-display-search-bg-hover)'
        
        // 从面板状态中恢复当前设置
        const currentState = this.getPanelState(targetPanelId)
        const sortConfig = currentState.sortConfig || { field: 'created', order: 'desc' }
        
        // 设置单选按钮的选中状态
        const fieldRadio = sortPanel.querySelector(`#sort-field-${sortConfig.field}`) as HTMLInputElement
        if (fieldRadio) {
          fieldRadio.checked = true
        }
        
        const orderRadio = sortPanel.querySelector(`#sort-order-${sortConfig.order}`) as HTMLInputElement
        if (orderRadio) {
          orderRadio.checked = true
        }
      } else {
        // 隐藏面板 - 立即设置display为none，避免空白区域
        sortPanel.style.display = 'none'
        sortPanel.style.opacity = '0'
        sortPanel.style.visibility = 'hidden'
        sortPanel.style.transform = 'translateY(-10px)'
        sortIcon.style.background = 'var(--page-display-search-bg)'
      }
    })
    
    // 排序面板的确认按钮事件
    const sortConfirmBtn = sortPanel.querySelector('.page-display-sort-confirm-btn') as HTMLButtonElement
    if (sortConfirmBtn) {
      sortConfirmBtn.addEventListener('click', () => {
        // 获取选中的排序字段和方向
        const selectedField = sortPanel.querySelector('input[name="sort-field"]:checked') as HTMLInputElement
        const selectedOrder = sortPanel.querySelector('input[name="sort-order"]:checked') as HTMLInputElement
        
        if (selectedField && selectedOrder) {
          const currentState = this.getPanelState(targetPanelId)
          currentState.sortConfig = {
            field: selectedField.value as SortField,
            order: selectedOrder.value as SortOrder
          }
          this.savePanelState(targetPanelId, currentState)
          
          // 更新排序图标，根据排序方向显示不同图标
          const icon = sortIcon.querySelector('i')
          if (icon) {
            icon.className = selectedOrder.value === 'asc' ? 'ti ti-sort-ascending' : 'ti ti-sort-descending'
          }
          
          // 触发更新显示
          updateDisplay()
        }
        
        // 隐藏面板
        isSortPanelVisible = false
        sortPanel.style.display = 'none'
        sortPanel.style.opacity = '0'
        sortPanel.style.visibility = 'hidden'
        sortPanel.style.transform = 'translateY(-10px)'
        sortIcon.style.background = 'var(--page-display-search-bg)'
      })
    }
    
    // 排序面板的取消按钮事件
    const sortCancelBtn = sortPanel.querySelector('.page-display-sort-cancel-btn') as HTMLButtonElement
    if (sortCancelBtn) {
      sortCancelBtn.addEventListener('click', () => {
        // 隐藏面板
        isSortPanelVisible = false
        sortPanel.style.display = 'none'
        sortPanel.style.opacity = '0'
        sortPanel.style.visibility = 'hidden'
        sortPanel.style.transform = 'translateY(-10px)'
        sortIcon.style.background = 'var(--page-display-search-bg)'
      })
    }
    
    // 图标显示切换按钮事件
    iconsToggleIcon.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      
      // 添加点击反馈
      iconsToggleIcon.style.transform = 'scale(0.95)'
      setTimeout(() => {
        iconsToggleIcon.style.transform = 'scale(1)'
      }, 100)
      
      this.toggleIcons()
      iconsToggleIcon.title = this.showIcons ? '隐藏图标' : '显示图标'
      // 使用更平滑的图标切换，避免innerHTML重新设置
      const icon = iconsToggleIcon.querySelector('i')
      if (icon) {
        icon.className = this.showIcons ? 'ti ti-eye' : 'ti ti-eye-off'
      }
    })
    
    // 多行显示切换按钮事件
    multiLineToggleIcon.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      
      // 添加点击反馈
      multiLineToggleIcon.style.transform = 'scale(0.95)'
      setTimeout(() => {
        multiLineToggleIcon.style.transform = 'scale(1)'
      }, 100)
      
      this.toggleMultiLine()
      multiLineToggleIcon.title = this.multiLine ? '单行显示' : '多行显示'
      // 使用更平滑的图标切换，避免innerHTML重新设置
      const icon = multiLineToggleIcon.querySelector('i')
      if (icon) {
        icon.className = this.multiLine ? 'ti ti-layout-line' : 'ti ti-layout-rows'
      }
    })
    
    // 多列显示切换按钮事件
    multiColumnToggleIcon.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      
      // 添加点击反馈
      multiColumnToggleIcon.style.transform = 'scale(0.95)'
      setTimeout(() => {
        multiColumnToggleIcon.style.transform = 'scale(1)'
      }, 100)
      
      this.toggleMultiColumn()
      multiColumnToggleIcon.title = this.multiColumn ? '单列显示' : '多列显示'
      // 使用更平滑的图标切换，避免innerHTML重新设置
      const icon = multiColumnToggleIcon.querySelector('i')
      if (icon) {
        icon.className = this.multiColumn ? 'ti ti-layout-columns' : 'ti ti-layout-grid'
      }
    })
    
    // 标题容器的悬浮效果 - 显示/隐藏功能按钮
    titleContainer.addEventListener('mouseenter', () => {
      // 鼠标进入标题容器时显示功能按钮
      functionButtonsContainer.style.opacity = '1'
    })
    
    titleContainer.addEventListener('mouseleave', () => {
      // 鼠标离开标题容器时隐藏功能按钮
      functionButtonsContainer.style.opacity = '0'
    })
    
    // 功能按钮容器的悬浮效果
    functionButtonsContainer.addEventListener('mouseenter', () => {
      // 鼠标进入功能按钮容器时，所有按钮都显示悬浮效果
      const buttons = functionButtonsContainer.querySelectorAll('[class*="page-display-"]')
      buttons.forEach(button => {
        (button as HTMLElement).style.background = 'var(--page-display-search-bg-hover)'
      })
    })
    
    functionButtonsContainer.addEventListener('mouseleave', () => {
      // 鼠标离开功能按钮容器时，恢复所有按钮的默认样式
      const buttons = functionButtonsContainer.querySelectorAll('[class*="page-display-"]')
      buttons.forEach(button => {
        (button as HTMLElement).style.background = 'var(--page-display-search-bg)'
      })
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
        arrow.innerHTML = '<i class="ti ti-chevron-right"></i>' // 折叠时箭头向右
        
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
        arrow.innerHTML = '<i class="ti ti-chevron-down"></i>' // 展开时箭头向下
        
        // 搜索框只有在用户主动点击搜索图标时才显示
        // 这里不自动显示搜索框
        
        setTimeout(() => {
          isTransitioning = false
        }, 100)
      }
      
      // 保存展开状态
      const currentState = this.getPanelState(targetPanelId)
      currentState.isExpanded = !newCollapsed
      this.savePanelState(targetPanelId, currentState)
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
        // 显示搜索框
        searchContainer.style.display = 'block'
        // 强制重排以确保初始状态正确
        searchContainer.offsetHeight // Trigger reflow
        searchContainer.style.opacity = '1'
        searchContainer.style.maxHeight = '100px'
        searchIcon.style.background = 'var(--page-display-search-bg-hover)'
        searchInput.focus()
      } else {
        // 隐藏搜索框 - 使用流畅的过渡效果
        searchContainer.style.opacity = '0'
        searchContainer.style.maxHeight = '0'
        searchIcon.style.background = 'var(--page-display-search-bg)'
        
        // 延迟后完全隐藏，避免卡顿
        setTimeout(() => {
          if (!isSearchVisible) {
            searchContainer.style.display = 'none'
          }
        }, 200) // 与transition时间一致
      }
      
      // 保存搜索框显示状态
      const currentState = this.getPanelState(targetPanelId)
      currentState.isSearchVisible = isSearchVisible
      this.savePanelState(targetPanelId, currentState)
    }

    // 创建搜索框（默认隐藏）
    const searchContainer = document.createElement('div')
    searchContainer.className = 'page-display-search-container'
    this.applyStyles(searchContainer, 'page-display-search-container')
    
    const searchInput = document.createElement('input')
    searchInput.type = 'text'
    searchInput.placeholder = '搜索页面、标签、属性... (支持拼音、多关键词、OR逻辑: 项目|会议)'
    searchInput.className = 'page-display-search-input'
    this.applyStyles(searchInput, 'page-display-search-input')
    
    // 存储原始项目数据 - 使用传入的items，这些已经包含了所有项目
    const originalItems = [...items]
    
    // 简化的搜索过滤函数
    const filterItems = (searchTerm: string) => {
      if (!searchTerm.trim()) {
        return originalItems
      }
      
      // 检查是否包含OR逻辑（使用|分隔符）
      if (searchTerm.includes('|')) {
        // 支持OR逻辑：使用|分隔符
        const orKeywords = searchTerm.toLowerCase().split('|').map(k => k.trim()).filter(k => k.length > 0)
        
        const filteredItems = originalItems.filter(item => {
          // OR逻辑：任一关键词匹配即可
          return orKeywords.some(keyword => matchesItem(item, keyword))
        })
        
        return filteredItems
      } else {
        // 原有的AND逻辑：使用空格分隔符
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
    }
    
    // 简化的搜索匹配逻辑（支持拼音搜索）
    const matchesItem = (item: PageDisplayItem, keyword: string): boolean => {
      const lowerKeyword = keyword.toLowerCase()
      
      // 普通文本匹配
      const textMatch = item.text.toLowerCase().includes(lowerKeyword)
      const aliasMatch = item.aliases.some(alias => alias.toLowerCase().includes(lowerKeyword))
      const searchableTextMatch = item.searchableText ? item.searchableText.toLowerCase().includes(lowerKeyword) : false
      
      // 拼音匹配
      const pinyinTextMatch = this.matchesPinyin(item.text, keyword)
      const pinyinAliasMatch = item.aliases.some(alias => this.matchesPinyin(alias, keyword))
      const pinyinSearchableTextMatch = item.searchableText ? this.matchesPinyin(item.searchableText, keyword) : false
      
      return textMatch || aliasMatch || searchableTextMatch || pinyinTextMatch || pinyinAliasMatch || pinyinSearchableTextMatch
    }
    
    // 更新显示的函数
    const updateDisplay = () => {
      const searchTerm = searchInput.value
      let filteredItems = filterItems(searchTerm)
      
      // 重置懒加载批次
      this.currentBatch = 0
      
      // 应用类型过滤
      const beforeTypeFilterCount = filteredItems.length
      filteredItems = filteredItems.filter(item => {
        const isVisible = this.getTypeFilter(item.itemType)
        if (!isVisible) {
          this.log(`PageDisplay: 过滤掉类型 ${item.itemType} 的项目: ${item.text}`)
        }
        return isVisible
      })
      this.log(`PageDisplay: 类型过滤前: ${beforeTypeFilterCount} 项, 类型过滤后: ${filteredItems.length} 项`)
      
      // 应用日期过滤
      const beforeDateFilterCount = filteredItems.length
      filteredItems = this.applyDateFilter(filteredItems)
      this.log(`PageDisplay: 日期过滤前: ${beforeDateFilterCount} 项, 日期过滤后: ${filteredItems.length} 项`)
      
      // 获取用户自定义排序配置
      const currentState = this.getPanelState(targetPanelId)
      const sortConfig = currentState.sortConfig || { field: 'created', order: 'desc' }
      
      // 应用完整的排序逻辑：保留原有的类型优先级，在同一优先级内应用用户排序
      filteredItems = filteredItems.sort((a, b) => {
        const aIsContainedIn = containedInBlockIds.includes(a.id)
        const bIsContainedIn = containedInBlockIds.includes(b.id)
        const aIsTag = tagBlockIds.includes(a.id)
        const bIsTag = tagBlockIds.includes(b.id)
        
        // 第一级判断：包含于块(非子标签) - 最高优先级
        const aIsContainedInNotTag = aIsContainedIn && !aIsTag
        const bIsContainedInNotTag = bIsContainedIn && !bIsTag
        
        if (aIsContainedInNotTag && !bIsContainedInNotTag) return -1
        if (!aIsContainedInNotTag && bIsContainedInNotTag) return 1
        
        // 如果都是包含于块(非子标签)，在同一优先级内应用用户自定义排序
        if (aIsContainedInNotTag && bIsContainedInNotTag) {
          return this.compareItemsByUserSort(a, b, sortConfig)
        }
        
        // 第二级判断：包含于块(是子标签)
        const aIsContainedInTag = aIsContainedIn && aIsTag
        const bIsContainedInTag = bIsContainedIn && bIsTag
        
        if (aIsContainedInTag && !bIsContainedInTag) return -1
        if (!aIsContainedInTag && bIsContainedInTag) return 1
        
        // 如果都是包含于块(是子标签)，在同一优先级内应用用户自定义排序
        if (aIsContainedInTag && bIsContainedInTag) {
          return this.compareItemsByUserSort(a, b, sortConfig)
        }
        
        // 第三级判断：标签块
        if (aIsTag && !bIsTag) return -1
        if (!aIsTag && bIsTag) return 1
        
        // 如果都是标签块，或都是其他类型，应用用户自定义排序
        return this.compareItemsByUserSort(a, b, sortConfig)
      })
      
      // 更新页面统计
      const totalCount = originalItems.length
      const filteredCount = filteredItems.length
      
      // 添加调试日志
      this.log(`PageDisplay: 计数更新 - 总数: ${totalCount}, 过滤后: ${filteredCount}, 搜索词: "${searchTerm}"`)
      
      if (searchTerm.trim()) {
        pageCount.textContent = `(${filteredCount}/${totalCount})`
      } else {
        pageCount.textContent = `(${filteredCount})`
      }
      
      // 清空现有列表
      list.innerHTML = ''
      
      // 检查是否需要懒加载
      if (filteredItems.length > this.LAZY_LOAD_THRESHOLD) {
        renderItemsWithLazyLoading(list, filteredItems, searchInput, tagBlockIds, inlineRefIds, containedInBlockIds)
      } else {
        // 直接渲染所有项目
        renderItems(list, filteredItems, searchInput, tagBlockIds, inlineRefIds, containedInBlockIds)
      }
    }
    
    // 使用懒加载渲染项目列表
    const renderItemsWithLazyLoading = (list: HTMLElement, items: PageDisplayItem[], searchInput: HTMLInputElement, tagBlockIds: DbId[], inlineRefIds: DbId[], containedInBlockIds: DbId[]) => {
      // 检查页面是否处于折叠状态，如果折叠则不进行懒加载
      if (this.getCurrentPageCollapseState()) {
        this.log("PageDisplay: 页面处于折叠状态，跳过懒加载")
        return
      }

      // 清理之前的观察器
      if (this.scrollObserver) {
        this.scrollObserver.disconnect()
        this.scrollObserver = null
      }

      // 计算当前应该显示的所有项目（从开始到当前批次）
      const endIndex = (this.currentBatch + 1) * this.LAZY_LOAD_BATCH_SIZE
      const itemsToShow = items.slice(0, Math.min(endIndex, items.length))
      
      // 渲染所有应该显示的项目
      renderItems(list, itemsToShow, searchInput, tagBlockIds, inlineRefIds, containedInBlockIds)

      // 更新页面计数 - 显示当前已加载的数量
      const searchTerm = searchInput.value
      const totalCount = items.length
      const displayedCount = itemsToShow.length
      
      if (searchTerm.trim()) {
        pageCount.textContent = `(${displayedCount}/${totalCount})`
      } else {
        pageCount.textContent = `(${displayedCount})`
      }

      // 如果还有更多项目，添加滚动加载触发器（隐藏）
      if (endIndex < items.length) {
        addScrollLoadTrigger(list, items, searchInput, tagBlockIds, inlineRefIds, containedInBlockIds)
      }
    }
    
    // 添加滚动加载触发器（隐藏）
    const addScrollLoadTrigger = (list: HTMLElement, items: PageDisplayItem[], searchInput: HTMLInputElement, tagBlockIds: DbId[], inlineRefIds: DbId[], containedInBlockIds: DbId[]) => {
      // 检查页面是否处于折叠状态，如果折叠则不创建触发器
      if (this.getCurrentPageCollapseState()) {
        this.log("PageDisplay: 页面处于折叠状态，跳过创建滚动触发器")
        return
      }

      // 创建隐藏的加载触发器元素
      const loadTrigger = document.createElement('li')
      loadTrigger.className = 'page-display-scroll-trigger'
      loadTrigger.style.cssText = `
        height: 1px;
        visibility: hidden;
        pointer-events: none;
      `
      
      list.appendChild(loadTrigger)

      // 创建Intersection Observer
      this.scrollObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              // 再次检查折叠状态，防止在观察过程中页面被折叠
              if (this.getCurrentPageCollapseState()) {
                this.log("PageDisplay: 页面已折叠，取消懒加载")
                return
              }
              
              // 当触发器进入视口时，加载下一批
              this.currentBatch++
              
              // 立即重新渲染
              renderItemsWithLazyLoading(list, items, searchInput, tagBlockIds, inlineRefIds, containedInBlockIds)
            }
          })
        },
        {
          root: null,
          rootMargin: '50px', // 提前50px开始加载
          threshold: 0.1
        }
      )

      // 开始观察触发器
      this.scrollObserver.observe(loadTrigger)
    }
    
    // 渲染项目列表（支持懒加载）
    const renderItems = (list: HTMLElement, items: PageDisplayItem[], searchInput: HTMLInputElement, tagBlockIds: DbId[], inlineRefIds: DbId[], containedInBlockIds: DbId[]) => {
      // 创建层级信息显示元素
      const hierarchyInfo = this.createHierarchyInfoElement(items)
      if (hierarchyInfo) {
        list.appendChild(hierarchyInfo)
      }
      
      items.forEach(item => {
        // 创建条目包装容器
        const itemWrapper = document.createElement('div')
        itemWrapper.className = 'page-display-item-wrapper'
        this.applyStyles(itemWrapper, 'page-display-item-wrapper')
        
        // 创建面包屑容器
        const breadcrumbContainer = this.createBreadcrumbContainer(item)
        if (breadcrumbContainer) {
          itemWrapper.appendChild(breadcrumbContainer)
        }
        
        // 添加标签显示到面包屑下方
        this.addTagsToItemWrapper(itemWrapper, item.id)
        
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
            } else if (item.itemType === 'referenced-tag') {
              // 被引用的标签块图标
              this.log(`PageDisplay: 分配被引用标签块图标 (ti-arrow-up) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-arrow-up'
            } else if (item.itemType === 'property-ref-alias') {
              // 别名属性引用图标
              this.log(`PageDisplay: 分配对齐图标 (ti-align-box-center-stretch) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-align-box-center-stretch'
            } else if (item.itemType === 'property-ref-block') {
              // 块属性引用图标
              this.log(`PageDisplay: 分配对齐图标 (ti-align-box-center-stretch) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-align-box-center-stretch'
            } else if (item.itemType === 'contained-in') {
              // 包含于块图标（当前块被包含在这个块中）
              this.log(`PageDisplay: 分配包含于块图标 (ti-arrow-up) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-arrow-up'
            } else if (item.itemType === 'inline-ref') {
              // 内联引用块图标
              this.log(`PageDisplay: 分配链接图标 (ti-link) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-link'
            } else if (item.itemType === 'referencing-alias') {
              // 引用别名块图标
              this.log(`PageDisplay: 分配右箭头图标 (ti-arrow-right) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-arrow-right'
            } else if (item.itemType === 'child-referenced-alias') {
              // 子块引用块图标
              this.log(`PageDisplay: 分配立方体图标 (ti-cube) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-cube'
            } else if (item.itemType === 'child-referenced-tag-alias') {
              // 子块引用标签别名图标
              this.log(`PageDisplay: 分配标签图标 (ti-hash) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-hash'
            } else if (item.itemType === 'child-referenced-inline') {
              // 子块引用内联块图标
              this.log(`PageDisplay: 分配链接图标 (ti-link) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-link'
            } else if (item.itemType === 'page-direct-children') {
              // 页面直接子块图标
              this.log(`PageDisplay: 分配文件夹图标 (ti-folder) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-folder'
            } else if (item.itemType === 'page-recursive-children') {
              // 页面递归子块图标
              this.log(`PageDisplay: 分配文件夹树图标 (ti-folder-tree) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-folder-tree'
            } else if (item.itemType === 'backref-alias-blocks') {
              // 反链中的别名块图标
              this.log(`PageDisplay: 分配问号放大镜图标 (ti-zoom-question) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-zoom-question'
            } else if (item.itemType === 'backref') {
              // 直接反链块图标
              this.log(`PageDisplay: 分配下箭头图标 (ti-arrow-down) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-arrow-down'
            } else if (item.itemType === 'recursive-backref') {
              // 递归反链块图标
              this.log(`PageDisplay: 分配右下箭头图标 (ti-arrow-down-right) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-arrow-down-right'
            } else if (item.itemType === 'recursive-backref-alias') {
              // 递归反链别名块图标
              this.log(`PageDisplay: 分配右箭头图标 (ti-arrow-right) - ${item.text}`)
              icon.className = 'page-display-item-icon ti ti-arrow-right'
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
        
        // 检查是否有搜索关键词需要高亮
        const searchTerm = searchInput.value.trim()
        if (searchTerm) {
          const keywords = searchTerm.toLowerCase().split(/\s+/).filter(k => k.length > 0)
          const highlightedText = this.highlightSearchTerms(item.text, keywords)
          this.log(`高亮调试 - 原文: "${item.text}", 搜索词: "${searchTerm}", 关键词: [${keywords.join(', ')}], 高亮结果: "${highlightedText}"`)
          text.innerHTML = highlightedText
        } else {
          text.textContent = item.text
        }
        
        this.applyStyles(text, 'page-display-item-text')
        itemElement.appendChild(text)
        
        // 标签已经添加到itemWrapper中，不需要在这里添加
        
        // 如果有搜索词且项目有子块信息，显示匹配的子块内容
        if (searchTerm && item.childBlocksInfo && item.childBlocksInfo.length > 0) {
          const matchedChildren = this.findMatchingChildren(item.childBlocksInfo, searchTerm)
          if (matchedChildren.length > 0) {
            // 创建一个包装容器来包含主内容和子块内容
            const contentWrapper = document.createElement('div')
            contentWrapper.style.cssText = `
              display: flex;
              flex-direction: column;
              width: 100%;
            `
            
            // 将原有的文本内容移动到包装容器中
            const textWrapper = document.createElement('div')
            textWrapper.style.cssText = `
              display: flex;
              align-items: center;
              width: 100%;
            `
            textWrapper.appendChild(icon)
            textWrapper.appendChild(text)
            
            contentWrapper.appendChild(textWrapper)
            
            // 创建子块内容容器
            const childContent = document.createElement('div')
            childContent.className = 'page-display-child-content'
            this.applyStyles(childContent, 'page-display-child-content')
            
            // 创建展开/收起状态
            let isExpanded = false
            const maxDisplay = 3
            
            // 创建子块元素的函数
            const createChildElement = (child: ChildBlockInfo) => {
              const childElement = document.createElement('div')
              childElement.style.cssText = `
                margin-bottom: 2px;
                padding: 4px 6px;
                background: var(--orca-color-bg-2);
                border-radius: 3px;
                font-size: 14px;
                width: 100%;
                display: block;
                cursor: pointer;
                transition: background-color 0.2s ease;
              `
              
              // 高亮搜索词
              const childText = child.text || child.aliases[0] || `子块 ${child.id}`
              const highlightedText = this.highlightSearchTerms(childText, searchTerm.toLowerCase().split(/\s+/).filter(k => k.length > 0))
              childElement.innerHTML = highlightedText
              
              // 添加悬停效果
              childElement.addEventListener('mouseenter', () => {
                const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
                childElement.style.backgroundColor = isDarkMode ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)'
              })
              
              childElement.addEventListener('mouseleave', () => {
                childElement.style.backgroundColor = 'var(--orca-color-bg-2)'
              })
              
              // 添加点击事件
              childElement.addEventListener('click', (e) => {
                e.preventDefault()
                e.stopPropagation()
                
                this.log(`PageDisplay: 点击子块 ${child.id}，跳转到子块`)
                
                // 检查是否按下了Shift键
                if (e.shiftKey) {
                  // Shift+点击：在侧面板打开子块
                  this.openBlockInSidePanel(child.id)
                } else {
                  // 普通点击：直接跳转到子块
                  this.openBlock(child.id)
                }
              })
              
              return childElement
            }
            
            // 渲染子块的函数
            const renderChildren = (showAll: boolean) => {
              // 清空现有内容
              childContent.innerHTML = ''
              
              const displayCount = showAll ? matchedChildren.length : Math.min(maxDisplay, matchedChildren.length)
              
              for (let i = 0; i < displayCount; i++) {
                const child = matchedChildren[i]
                const childElement = createChildElement(child)
                childContent.appendChild(childElement)
              }
              
              // 如果还有更多匹配的子块，显示展开/收起按钮
              if (matchedChildren.length > maxDisplay) {
                const toggleElement = document.createElement('div')
                toggleElement.style.cssText = `
                  font-style: italic;
                  color: var(--orca-color-text-3);
                  font-size: 12px;
                  margin-top: 2px;
                  cursor: pointer;
                  padding: 4px 6px;
                  border-radius: 3px;
                  transition: background-color 0.2s ease;
                `
                
                const updateToggleText = () => {
                  if (isExpanded) {
                    toggleElement.textContent = `收起 (显示前 ${maxDisplay} 个)`
                  } else {
                    toggleElement.textContent = `展开全部 (共 ${matchedChildren.length} 个匹配项)`
                  }
                }
                
                updateToggleText()
                
                // 添加悬停效果
                toggleElement.addEventListener('mouseenter', () => {
                  const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
                  toggleElement.style.backgroundColor = isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'
                })
                
                toggleElement.addEventListener('mouseleave', () => {
                  toggleElement.style.backgroundColor = 'transparent'
                })
                
                // 添加点击事件
                toggleElement.addEventListener('click', (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  
                  isExpanded = !isExpanded
                  renderChildren(isExpanded)
                })
                
                childContent.appendChild(toggleElement)
              }
            }
            
            // 初始渲染
            renderChildren(false)
            
            contentWrapper.appendChild(childContent)
            
            // 清空原有内容并添加新的包装容器
            itemElement.innerHTML = ''
            itemElement.appendChild(contentWrapper)
          }
        }
        
        // 添加悬停效果
        itemElement.addEventListener('mouseenter', () => {
          const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          itemElement.style.backgroundColor = isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'
        })
        
        itemElement.addEventListener('mouseleave', () => {
          itemElement.style.backgroundColor = 'transparent'
        })

        // 添加点击事件
        itemElement.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          
          // 检查是否按下了Shift键
          if (e.shiftKey) {
            // Shift+点击：在侧面板打开
            this.openBlockInSidePanel(item.id)
          } else {
            // 普通点击：在当前面板打开
            this.openBlock(item.id)
          }
        })

        // 将条目元素添加到包装容器中
        itemWrapper.appendChild(itemElement)
        
        // 将包装容器添加到列表中
        list.appendChild(itemWrapper)
      })
    }
    
    // 添加搜索事件监听
    searchInput.addEventListener('input', () => {
      updateDisplay()
      // 保存搜索状态
      const currentState = this.getPanelState(targetPanelId)
      currentState.searchText = searchInput.value
      this.savePanelState(targetPanelId, currentState)
    })
    
    searchContainer.appendChild(searchInput)
    container.appendChild(searchContainer)

    // 创建项目列表
    const list = document.createElement('ul')
    list.className = `page-display-list${this.multiColumn ? ' multi-column' : ''}`
    this.applyStyles(list, 'page-display-list')
    if (this.multiColumn) {
      this.applyMultiColumnStyles(list)
    }
    
    // 预设滚动位置，避免闪烁
    const currentPanelState = this.getPanelState(targetPanelId)
    if (currentPanelState.scrollTop > 0) {
      list.scrollTop = currentPanelState.scrollTop
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
    
    // 添加滚动事件监听器来保存滚动位置
    list.addEventListener('scroll', () => {
      const currentState = this.getPanelState(targetPanelId)
      currentState.scrollTop = list.scrollTop
      this.savePanelState(targetPanelId, currentState)
    })
    
    // 在初始显示前设置搜索内容，避免闪烁
    const initialPanelState = this.getPanelState(targetPanelId)
    if (initialPanelState.searchText && initialPanelState.searchText.trim()) {
      searchInput.value = initialPanelState.searchText
    }
    
    // 初始显示所有项目
    updateDisplay()
    
    // 根据当前页面的折叠状态设置初始显示
    if (this.getCurrentPageCollapseState()) {
      list.style.display = 'none'
      list.style.opacity = '0'
      list.style.maxHeight = '0'
      arrow.innerHTML = '<i class="ti ti-chevron-right"></i>'
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
    
    // 恢复面板状态
    this.restorePanelState(targetPanelId, container)
    
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
      
    } else {
      // 移除所有面板的显示
      this.log("PageDisplay: Removing all displays")
      for (const [id, container] of this.containers.entries()) {
        if (container.parentNode) {
          container.parentNode.removeChild(container)
        }
      }
      this.containers.clear()
      
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
   * 在侧面板中打开指定的块
   * @param blockId 块ID
   */
  private openBlockInSidePanel(blockId: DbId): void {
    this.log(`PageDisplay: Opening block ${blockId} in side panel`)
    
    try {
      // 使用orca.nav.openInLastPanel在侧面板打开块
      orca.nav.openInLastPanel("block", { blockId })
      this.log(`PageDisplay: Successfully opened block ${blockId} in side panel`)
    } catch (error) {
      console.error("PageDisplay: Failed to open block in side panel:", error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      orca.notify("error", `在侧面板打开块失败: ${errorMessage}`)
    }
  }

  /**
   * 打开标签块
   * @param tagName 标签名称
   */
  private async openTag(tagName: string): Promise<void> {
    this.log(`PageDisplay: Opening tag ${tagName}`)
    
    try {
      // 通过别名查找标签对应的块ID
      const blockId = await this.findBlockIdByAlias(tagName)
      if (blockId) {
        // 使用找到的块ID打开标签块
        orca.nav.goTo("block", { blockId: blockId })
        this.log(`PageDisplay: Successfully opened tag ${tagName} with blockId ${blockId}`)
      } else {
        orca.notify("warn", `未找到标签 "${tagName}" 对应的块`)
        this.log(`PageDisplay: Tag ${tagName} not found`)
      }
    } catch (error) {
      console.error("PageDisplay: Failed to open tag:", error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      orca.notify("error", `打开标签失败: ${errorMessage}`)
    }
  }

  /**
   * 在侧面板中打开标签块
   * @param tagName 标签名称
   */
  private async openTagInSidePanel(tagName: string): Promise<void> {
    this.log(`PageDisplay: Opening tag ${tagName} in side panel`)
    
    try {
      // 通过别名查找标签对应的块ID
      const blockId = await this.findBlockIdByAlias(tagName)
      if (blockId) {
        // 使用找到的块ID在侧面板打开标签块
        orca.nav.openInLastPanel("block", { blockId: blockId })
        this.log(`PageDisplay: Successfully opened tag ${tagName} in side panel with blockId ${blockId}`)
      } else {
        orca.notify("warn", `未找到标签 "${tagName}" 对应的块`)
        this.log(`PageDisplay: Tag ${tagName} not found`)
      }
    } catch (error) {
      console.error("PageDisplay: Failed to open tag in side panel:", error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      orca.notify("error", `在侧面板打开标签失败: ${errorMessage}`)
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

  /**
   * 创建面包屑容器元素
   * @param item 页面显示项目
   * @returns 面包屑容器元素或null
   */
  private createBreadcrumbContainer(item: PageDisplayItem): HTMLElement | null {
    // 创建面包屑容器
    const breadcrumbContainer = document.createElement('div')
    breadcrumbContainer.className = 'page-display-breadcrumb-container'
    this.applyStyles(breadcrumbContainer, 'page-display-breadcrumb-container')

    // 创建面包屑层级元素
    const breadcrumbLevel = document.createElement('div')
    breadcrumbLevel.className = 'page-display-breadcrumb-level'
    this.applyStyles(breadcrumbLevel, 'page-display-breadcrumb-level')

    // 先尝试同步获取面包屑文本（作为快速显示）
    const breadcrumbText = this.getBreadcrumbTextForItem(item)
    if (breadcrumbText) {
      breadcrumbLevel.textContent = breadcrumbText
      breadcrumbLevel.style.opacity = '0.8' // 稍微透明，表示可能不完整
      breadcrumbContainer.appendChild(breadcrumbLevel)
      
      // 即使有同步结果，也尝试异步更新以获得更完整的信息
      this.loadBreadcrumbAsync(item, breadcrumbLevel)
      return breadcrumbContainer
    }

    // 如果没有同步获取到，显示加载状态并异步获取
    breadcrumbLevel.textContent = '加载中...'
    breadcrumbLevel.style.opacity = '0.6'
    breadcrumbContainer.appendChild(breadcrumbLevel)

    // 异步获取面包屑
    this.loadBreadcrumbAsync(item, breadcrumbLevel)

    return breadcrumbContainer
  }


  /**
   * 异步加载面包屑
   * @param item 页面显示项目
   * @param breadcrumbLevel 面包屑元素
   */
  private async loadBreadcrumbAsync(item: PageDisplayItem, breadcrumbLevel: HTMLElement): Promise<void> {
    try {
      this.log("PageDisplay: Loading breadcrumb asynchronously for item", { itemId: item.id })
      
      // 获取当前块信息
      const block = await this.cachedApiCall("get-block", item.id)
      if (!block || !block.parent) {
        // 没有父级，隐藏面包屑容器
        this.hideBreadcrumbContainer(breadcrumbLevel)
        return
      }

      // 异步构建面包屑路径
      const breadcrumbPath = await this.buildBreadcrumbPathAsync(block.parent)
      
      if (breadcrumbPath && breadcrumbPath.length > 0) {
        // 创建交互式面包屑
        this.createInteractiveBreadcrumb(breadcrumbLevel, breadcrumbPath)
        breadcrumbLevel.style.opacity = '1'
      } else {
        // 没有面包屑路径，隐藏面包屑容器
        this.hideBreadcrumbContainer(breadcrumbLevel)
      }
    } catch (error) {
      this.log("PageDisplay: Error loading breadcrumb", error)
      // 加载失败，隐藏面包屑容器
      this.hideBreadcrumbContainer(breadcrumbLevel)
    }
  }

  /**
   * 创建交互式面包屑
   * @param breadcrumbLevel 面包屑元素
   * @param breadcrumbPath 面包屑路径数组
   */
  private createInteractiveBreadcrumb(breadcrumbLevel: HTMLElement, breadcrumbPath: Array<{id: DbId, text: string}>): void {
    // 清空原有内容
    breadcrumbLevel.innerHTML = ''
    
    breadcrumbPath.forEach((item, index) => {
      // 创建层级元素
      const levelElement = document.createElement('span')
      levelElement.className = 'page-display-breadcrumb-level-item'
      levelElement.textContent = item.text
      levelElement.setAttribute('data-block-id', item.id.toString())
      
      // 添加点击事件
      levelElement.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        this.log("PageDisplay: Breadcrumb level clicked", { blockId: item.id, text: item.text })
        
        // 检查是否按下了Shift键
        if (e.shiftKey) {
          // Shift+点击：在侧面板打开
          this.openBlockInSidePanel(item.id)
        } else {
          // 普通点击：在当前面板打开
          this.openBlock(item.id)
        }
      })
      
      // 添加悬停效果
      levelElement.addEventListener('mouseenter', () => {
        levelElement.style.backgroundColor = 'var(--orca-color-bg-2)'
        levelElement.style.cursor = 'pointer'
      })
      
      levelElement.addEventListener('mouseleave', () => {
        levelElement.style.backgroundColor = 'transparent'
      })
      
      breadcrumbLevel.appendChild(levelElement)
      
      // 添加分隔符（除了最后一个）
      if (index < breadcrumbPath.length - 1) {
        const separator = document.createElement('span')
        separator.className = 'page-display-breadcrumb-separator'
        separator.textContent = ' › '
        separator.style.color = 'var(--orca-color-text-3)'
        separator.style.margin = '0 4px'
        breadcrumbLevel.appendChild(separator)
      }
    })
  }

  /**
   * 隐藏面包屑容器
   * @param breadcrumbLevel 面包屑元素
   */
  private hideBreadcrumbContainer(breadcrumbLevel: HTMLElement): void {
    const breadcrumbContainer = breadcrumbLevel.parentElement
    if (breadcrumbContainer && breadcrumbContainer.classList.contains('page-display-breadcrumb-container')) {
      // 隐藏整个面包屑容器
      breadcrumbContainer.style.display = 'none'
    }
  }

  /**
   * 异步构建面包屑路径
   * @param parentId 父块ID
   * @returns 面包屑路径数组，包含块ID和显示文本
   */
  private async buildBreadcrumbPathAsync(parentId: DbId): Promise<Array<{id: DbId, text: string}>> {
    const path: Array<{id: DbId, text: string}> = []
    let currentId = parentId
    const visited = new Set<DbId>() // 防止循环引用

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      
      try {
        // 通过API获取块信息
        const currentBlock = await this.cachedApiCall("get-block", currentId)
        if (!currentBlock) {
          this.log("PageDisplay: Block not found via API", { blockId: currentId })
          break
        }

        // 获取当前块的显示文本
        let blockText = (currentBlock.aliases && currentBlock.aliases[0]) || currentBlock.text || `块 ${currentBlock.id}`
        
        // 格式化日期（如果是日期块）
        if (this.isDateBlock(currentBlock)) {
          blockText = this.formatDateBlock(currentBlock, blockText)
        }

        // 将当前块信息添加到路径开头
        path.unshift({ id: currentId, text: blockText })

        // 获取父块ID
        if (currentBlock.parent) {
          currentId = currentBlock.parent
        } else {
          break
        }
      } catch (error) {
        this.log("PageDisplay: Error fetching block", { blockId: currentId, error })
        break
      }
    }

    return path
  }

  /**
   * 为条目获取面包屑文本
   * @param item 页面显示项目
   * @returns 面包屑文本或null
   */
  private getBreadcrumbTextForItem(item: PageDisplayItem): string | null {
    // 首先尝试使用已有的parentBlock
    if (item.parentBlock) {
      return this.getParentBreadcrumbText(item.parentBlock)
    }

    // 如果没有parentBlock，尝试从全局状态获取块信息
    const block = orca.state.blocks[item.id]
    if (block && block.parent) {
      // 尝试从全局状态获取父块
      const parentBlock = orca.state.blocks[block.parent]
      if (parentBlock) {
        return this.getParentBreadcrumbText(parentBlock)
      } else {
        // 如果父块不在状态中，尝试直接构建面包屑路径
        this.log("PageDisplay: Building breadcrumb for item without parent in state", {
          itemId: item.id,
          parentId: block.parent
        })
        return this.buildBreadcrumbFromParentId(block.parent)
      }
    }

    return null
  }

  /**
   * 从父块ID构建面包屑路径
   * @param parentId 父块ID
   * @returns 面包屑文本或null
   */
  private buildBreadcrumbFromParentId(parentId: DbId): string | null {
    const path: string[] = []
    let currentId = parentId
    const visited = new Set<DbId>() // 防止循环引用

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      
      const currentBlock = orca.state.blocks[currentId]
      if (!currentBlock) {
        // 如果块不在状态中，尝试获取
        this.log("PageDisplay: Block not in state, attempting to fetch", { blockId: currentId })
        break
      }

      // 获取当前块的显示文本
      let blockText = (currentBlock.aliases && currentBlock.aliases[0]) || currentBlock.text || `块 ${currentBlock.id}`
      
      // 格式化日期（如果是日期块）
      if (this.isDateBlock(currentBlock)) {
        blockText = this.formatDateBlock(currentBlock, blockText)
      }

      // 将当前块文本添加到路径开头
      path.unshift(blockText)

      // 获取父块ID
      if (currentBlock.parent) {
        currentId = currentBlock.parent
      } else {
        break
      }
    }

    return path.length > 0 ? path.join(' › ') : null
  }

  /**
   * 获取父块的面包屑文本
   * @param parentBlock 父块对象
   * @returns 面包屑文本
   */
  private getParentBreadcrumbText(parentBlock: Block): string {
    if (!parentBlock) {
      return ''
    }

    // 递归获取完整的面包屑路径
    const breadcrumbPath = this.getBreadcrumbPath(parentBlock)
    return breadcrumbPath.join(' › ')
  }

  /**
   * 递归获取面包屑路径
   * @param block 当前块
   * @returns 面包屑路径数组
   */
  private getBreadcrumbPath(block: Block): string[] {
    const path: string[] = []
    let currentBlock = block

    while (currentBlock) {
      // 获取当前块的显示文本
      let blockText = (currentBlock.aliases && currentBlock.aliases[0]) || currentBlock.text || `块 ${currentBlock.id}`
      
      // 格式化日期（如果是日期块）
      if (this.isDateBlock(currentBlock)) {
        blockText = this.formatDateBlock(currentBlock, blockText)
      }

      // 将当前块文本添加到路径开头
      path.unshift(blockText)

      // 获取父块
      const parentBlock = this.getParentBlock(currentBlock)
      if (!parentBlock) {
        break
      }

      currentBlock = parentBlock
    }

    return path
  }

  /**
   * 创建层级信息显示元素
   * @param items 页面显示项目列表
   * @returns 层级信息元素或null
   */
  private createHierarchyInfoElement(items: PageDisplayItem[]): HTMLElement | null {
    if (!items || items.length === 0) {
      return null
    }

    // 计算层级统计信息
    const hierarchyStats = this.calculateHierarchyStats(items)
    
    // 如果没有层级信息，不显示
    if (hierarchyStats.totalLevels <= 1) {
      return null
    }

    // 创建层级信息容器
    const hierarchyInfo = document.createElement('div')
    hierarchyInfo.className = 'page-display-hierarchy-info'
    this.applyStyles(hierarchyInfo, 'page-display-hierarchy-info')

    // 创建图标
    const icon = document.createElement('span')
    icon.className = 'page-display-hierarchy-icon ti ti-hierarchy-2'
    this.applyStyles(icon, 'page-display-hierarchy-icon')

    // 创建文本内容
    const text = document.createElement('span')
    text.className = 'page-display-hierarchy-text'
    this.applyStyles(text, 'page-display-hierarchy-text')
    text.textContent = `层级结构: ${hierarchyStats.totalLevels} 层, 共 ${hierarchyStats.totalItems} 个项目`

    // 创建层级数量标签
    const levelBadge = document.createElement('span')
    levelBadge.className = 'page-display-hierarchy-level'
    this.applyStyles(levelBadge, 'page-display-hierarchy-level')
    levelBadge.textContent = hierarchyStats.totalLevels.toString()

    // 组装元素
    hierarchyInfo.appendChild(icon)
    hierarchyInfo.appendChild(text)
    hierarchyInfo.appendChild(levelBadge)

    // 添加点击事件，显示详细层级信息
    hierarchyInfo.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.showHierarchyDetails(hierarchyStats)
    })

    // 添加悬停效果
    hierarchyInfo.addEventListener('mouseenter', () => {
      hierarchyInfo.style.cursor = 'pointer'
    })

    return hierarchyInfo
  }

  /**
   * 计算层级统计信息
   * @param items 页面显示项目列表
   * @returns 层级统计信息
   */
  private calculateHierarchyStats(items: PageDisplayItem[]): {
    totalLevels: number
    totalItems: number
    levelDistribution: Record<number, number>
    maxLevel: number
  } {
    const levelDistribution: Record<number, number> = {}
    let maxLevel = 0
    let totalLevels = 0

    items.forEach(item => {
      // 从childBlocksInfo中获取层级信息
      if (item.childBlocksInfo && item.childBlocksInfo.length > 0) {
        item.childBlocksInfo.forEach(child => {
          const level = child.level || 0
          levelDistribution[level] = (levelDistribution[level] || 0) + 1
          maxLevel = Math.max(maxLevel, level)
        })
      }
    })

    // 计算总层数（从0开始，所以+1）
    totalLevels = maxLevel + 1

    return {
      totalLevels,
      totalItems: items.length,
      levelDistribution,
      maxLevel
    }
  }

  /**
   * 显示详细层级信息
   * @param stats 层级统计信息
   */
  private showHierarchyDetails(stats: {
    totalLevels: number
    totalItems: number
    levelDistribution: Record<number, number>
    maxLevel: number
  }): void {
    // 创建详细信息弹窗
    const details = document.createElement('div')
    details.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--orca-color-bg-1);
      border: var(--orca-border-general);
      border-radius: var(--orca-radius-lg);
      box-shadow: var(--orca-shadow-popup);
      padding: var(--orca-spacing-lg);
      z-index: var(--orca-zindex-modal);
      max-width: 400px;
      max-height: 300px;
      overflow-y: auto;
      font-family: var(--orca-fontfamily-ui);
    `

    // 创建标题
    const title = document.createElement('div')
    title.textContent = '层级结构详情'
    title.style.cssText = `
      font-size: var(--orca-fontsize-md);
      font-weight: var(--orca-fontweight-lg);
      color: var(--orca-color-text-1);
      margin-bottom: var(--orca-spacing-md);
      border-bottom: var(--orca-border-general);
      padding-bottom: var(--orca-spacing-sm);
    `

    // 创建层级分布信息
    const levelInfo = document.createElement('div')
    levelInfo.innerHTML = `
      <div style="margin-bottom: var(--orca-spacing-sm);">
        <strong>总层数:</strong> ${stats.totalLevels}
      </div>
      <div style="margin-bottom: var(--orca-spacing-sm);">
        <strong>总项目:</strong> ${stats.totalItems}
      </div>
      <div style="margin-bottom: var(--orca-spacing-sm);">
        <strong>层级分布:</strong>
      </div>
    `

    // 添加每层的详细信息
    for (let level = 0; level <= stats.maxLevel; level++) {
      const count = stats.levelDistribution[level] || 0
      const levelDiv = document.createElement('div')
      levelDiv.style.cssText = `
        display: flex;
        justify-content: space-between;
        padding: var(--orca-spacing-xs) var(--orca-spacing-sm);
        background: var(--orca-color-bg-2);
        border-radius: var(--orca-radius-sm);
        margin-bottom: var(--orca-spacing-xs);
        font-size: var(--orca-fontsize-sm);
      `
      levelDiv.innerHTML = `
        <span>第 ${level} 层</span>
        <span style="color: var(--orca-color-primary-3); font-weight: var(--orca-fontweight-lg);">${count} 项</span>
      `
      levelInfo.appendChild(levelDiv)
    }

    // 创建关闭按钮
    const closeButton = document.createElement('button')
    closeButton.textContent = '关闭'
    closeButton.style.cssText = `
      width: 100%;
      padding: var(--orca-spacing-sm);
      margin-top: var(--orca-spacing-md);
      background: var(--orca-color-primary-3);
      color: var(--orca-color-primary-5);
      border: none;
      border-radius: var(--orca-radius-sm);
      cursor: pointer;
      font-family: var(--orca-fontfamily-ui);
      font-size: var(--orca-fontsize-sm);
      font-weight: var(--orca-fontweight-md);
    `

    closeButton.addEventListener('click', () => {
      document.body.removeChild(details)
    })

    // 组装弹窗
    details.appendChild(title)
    details.appendChild(levelInfo)
    details.appendChild(closeButton)

    // 添加到页面
    document.body.appendChild(details)

    // 点击背景关闭
    details.addEventListener('click', (e) => {
      if (e.target === details) {
        document.body.removeChild(details)
      }
    })
  }
}


