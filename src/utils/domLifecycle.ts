/**
 * domLifecycle —— DOM 监听/观察的统一注册与回收中心
 *
 * 解决三类问题：
 *  1. 注册与清理不对称：document / window 上的监听器忘记 removeEventListener，
 *     每次重载插件都会叠加一份，最终形成"同一个回调被调用 N 次"的风暴。
 *  2. 观察范围过大：直接 observe(document.body, {subtree:true}) 会让每次任何
 *     DOM 变动都唤醒插件，在 2 万块的库上就是持续掉帧。
 *  3. 无节流：多个 observer 各自立即执行回调，一帧内触发几十次布局读取。
 *
 * 使用方式：
 *   domLifecycle.install();                        // 插件启动时一次
 *   const w = domLifecycle.watch({ ... });         // 代替 new MutationObserver
 *   const off = domLifecycle.onDoc('click', fn);   // 代替 document.addEventListener
 *   domLifecycle.releaseAll();                     // 插件卸载时一次
 *
 * 设计要点：
 *  - 所有回调经同一个调度器合并，一帧最多 flush 一次；
 *  - document / window 的 addEventListener 被一层薄壳接管：自动去重（同一个
 *    函数重复注册只保留一份）、自动登记，releaseAll 时全部移除；
 *  - watch 的目标用"解析函数"表示，目标节点被重建（Orca 切换仓库/重建面板区）
 *    时会在下一次 flush 自动重新挂载；
 *  - 单个 flush 内突变记录过多时进入"风暴保护"，本轮只处理结构变化，属性变化
 *    合并成一次通知，并记录一次日志，避免日志本身成为负担。
 */

import { simpleVerbose } from "./logUtils";

export type Disposer = () => void;

/** 与 MutationObserver 同名方法的返回值，便于直接替换旧字段类型 */
export interface DomWatch {
  readonly name: string;
  disconnect: Disposer;
  /** 主动丢弃排队的记录（卸载时用） */
  flush: () => void;
}

export interface WatchSpec {
  /** 逻辑名，同名重复 watch 会先释放旧的（防止重入堆积） */
  name: string;
  /** 目标解析函数：每次需要挂载/重挂载时调用 */
  resolve: () => Element | null | undefined;
  options: MutationObserverInit;
  handler: (records: MutationRecord[]) => void | Promise<void>;
  /** 逐条预过滤，返回 false 的记录直接丢弃（在合并前执行，最省） */
  filter?: (record: MutationRecord) => boolean;
  /** 合并窗口：默认 16ms（一帧）；0 表示同步执行 */
  throttleMs?: number;
}

interface WatchEntry {
  spec: WatchSpec;
  observer: MutationObserver;
  target: Element | null;
  pending: MutationRecord[];
  timer: number | null;
  lastFlush: number;
}

const FN_IDS = new WeakMap<Function, number>();
let fnSeq = 0;
function fnId(fn: unknown): number {
  if (typeof fn !== "function") return -1;
  let id = FN_IDS.get(fn as Function);
  if (id === undefined) {
    id = ++fnSeq;
    FN_IDS.set(fn as Function, id);
  }
  return id;
}

function captureOf(options?: boolean | AddEventListenerOptions): boolean {
  if (typeof options === "boolean") return options;
  return !!(options && (options as AddEventListenerOptions).capture);
}

/** 单条记录是否值得唤醒插件：结构变化总是值得，属性变化只认指定过滤 */
function recordCost(record: MutationRecord): number {
  if (record.type === "childList") {
    return 1 + record.addedNodes.length + record.removedNodes.length;
  }
  return 1;
}

class DomLifecycle {
  private installed = false;
  private patchedTargets = new WeakSet<EventTarget>();
  private watches = new Map<string, WatchEntry>();
  private docOff: Disposer[] = [];
  private winOff: Disposer[] = [];
  private docSeen = new Set<string>();
  private winSeen = new Set<string>();
  private flushScheduled = false;
  private stormMode = false;
  private attachTimer: number | null = null;
  private lastLogAt = 0;

  /** 统计（调试用：window.__orcaTabsDomStats()） */
  readonly stats = {
    mutations: 0,
    flushes: 0,
    dropped: 0,
    reattached: 0,
    duplicateListeners: 0,
    watchers: 0,
    names: [] as string[],
  };

  install(): void {
    if (this.installed) return;
    this.installed = true;
    this.patchEventTarget(document as unknown as EventTarget, "doc");
    this.patchEventTarget(window as unknown as EventTarget, "win");
    try {
      (window as any).__orcaTabsDomStats = () => ({
        ...this.stats,
        names: Array.from(this.watches.keys()),
        attachState: Array.from(this.watches.values()).map((w) => ({
          name: w.spec.name,
          target: w.target ? (w.target.id || w.target.className || w.target.tagName) : null,
          connected: !!w.target?.isConnected,
          pending: w.pending.length,
        })),
      });
    } catch {
      /* 忽略 */
    }
    simpleVerbose("🧩 domLifecycle 已接管 document/window 监听");
  }

  /**
   * 接管 document / window 的监听注册：
   *  - 同一个 (type, fn, capture) 只真正注册一次，重复调用直接忽略；
   *  - 全部登记在案，releaseAll 一次性摘掉。
   */
  private patchEventTarget(target: EventTarget, kind: "doc" | "win"): void {
    if (this.patchedTargets.has(target)) return;
    this.patchedTargets.add(target);
    const seen = kind === "doc" ? this.docSeen : this.winSeen;
    const offs = kind === "doc" ? this.docOff : this.winOff;
    const origAdd = target.addEventListener.bind(target) as EventTarget["addEventListener"];
    const origRemove = target.removeEventListener.bind(target) as EventTarget["removeEventListener"];

    const wrappedAdd: EventTarget["addEventListener"] = ((type: string, listener: any, options?: any) => {
      const key = `${type}|${fnId(listener)}|${captureOf(options) ? 1 : 0}`;
      if (typeof listener === "function" && seen.has(key)) {
        // 已有的同一监听：不重复注册（同等去重）
        this.stats.duplicateListeners++;
        return;
      }
      if (typeof listener === "function") seen.add(key);
      origAdd(type, listener, options as any);
      offs.push(() => {
        try {
          origRemove(type, listener, options as any);
        } catch {
          /* 忽略 */
        }
        if (typeof listener === "function") seen.delete(key);
      });
    }) as EventTarget["addEventListener"];

    const wrappedRemove: EventTarget["removeEventListener"] = ((type: string, listener: any, options?: any) => {
      const key = `${type}|${fnId(listener)}|${captureOf(options) ? 1 : 0}`;
      seen.delete(key);
      origRemove(type, listener, options as any);
    }) as EventTarget["removeEventListener"];

    try {
      Object.defineProperty(target, "addEventListener", {
        configurable: true,
        writable: true,
        value: wrappedAdd,
      });
      Object.defineProperty(target, "removeEventListener", {
        configurable: true,
        writable: true,
        value: wrappedRemove,
      });
    } catch (err) {
      simpleVerbose("⚠️ domLifecycle 无法接管 EventTarget:", err);
    }
  }

  /** 显式注册 document 监听（即使没走 install 也能回收） */
  onDoc(type: string, handler: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): Disposer {
    document.addEventListener(type, handler, options as any);
    const capture = captureOf(options);
    return () => document.removeEventListener(type, handler, { capture } as any);
  }

  onWin(type: string, handler: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): Disposer {
    window.addEventListener(type, handler, options as any);
    const capture = captureOf(options);
    return () => window.removeEventListener(type, handler, { capture } as any);
  }

  /** 代替 new MutationObserver + observe */
  watch(spec: WatchSpec): DomWatch {
    // 同名重复注册：先释放旧的，绝对不会叠加
    this.release(spec.name);

    const entry: WatchEntry = {
      spec,
      observer: new MutationObserver((records) => this.enqueue(spec.name, records)),
      target: null,
      pending: [],
      timer: null,
      lastFlush: 0,
    };
    this.watches.set(spec.name, entry);
    this.stats.watchers = this.watches.size;
    this.attach(entry);

    const self = this;
    return {
      name: spec.name,
      disconnect() {
        self.release(spec.name);
      },
      flush() {
        self.runHandlers([spec.name], true);
      },
    };
  }

  private attach(entry: WatchEntry): void {
    let target: Element | null | undefined = null;
    try {
      target = entry.spec.resolve();
    } catch {
      target = null;
    }
    if (!target) {
      // 目标暂时不存在（面板区尚未创建）：留一个轻量重试，避免永久漏挂
      entry.target = null;
      this.startAttachRetry();
      return;
    }
    if (entry.target === target) return;
    try {
      entry.observer.disconnect();
      entry.observer.observe(target, entry.spec.options);
      entry.target = target;
      this.stats.reattached += 1;
    } catch (err) {
      simpleVerbose(`⚠️ domLifecycle watch[${entry.spec.name}] 挂载失败:`, err);
      entry.target = null;
    }
  }

  /** 有 watcher 目标不存在时的轻量重试（1.5s，最多 40 次，约 1 分钟） */
  private startAttachRetry(): void {
    if (this.attachTimer !== null) return;
    let tries = 0;
    this.attachTimer = window.setInterval(() => {
      tries += 1;
      let stillMissing = false;
      for (const entry of this.watches.values()) {
        if (!entry.target || !entry.target.isConnected) {
          this.attach(entry);
          if (!entry.target) stillMissing = true;
        }
      }
      if (!stillMissing || tries > 40) {
        if (this.attachTimer !== null) {
          window.clearInterval(this.attachTimer);
          this.attachTimer = null;
        }
      }
    }, 1500);
  }

  private enqueue(name: string, records: MutationRecord[]): void {
    const entry = this.watches.get(name);
    if (!entry) return;
    const filter = entry.spec.filter;
    for (const record of records) {
      this.stats.mutations++;
      if (filter && !filter(record)) {
        this.stats.dropped++;
        continue;
      }
      entry.pending.push(record);
    }
    if (entry.pending.length === 0) return;
    this.schedule();
  }

  private schedule(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    const run = () => {
      this.flushScheduled = false;
      this.runHandlers(Array.from(this.watches.keys()), false);
    };
    if (typeof document !== "undefined" && document.hidden) {
      // 窗口不可见时降频，避免后台空转
      window.setTimeout(run, 250);
    } else {
      requestAnimationFrame(run);
    }
  }

  private runHandlers(names: string[], force: boolean): void {
    this.stats.flushes++;
    for (const name of names) {
      const entry = this.watches.get(name);
      if (!entry) continue;
      const spec = entry.spec;

      // 目标被重建（切换仓库、面板区重绘）→ 重新挂载，并保持监听不丢
      if (!entry.target || !entry.target.isConnected) {
        this.attach(entry);
        if (entry.target) this.stats.reattached++;
      }

      if (entry.pending.length === 0 && !force) continue;

      // 风暴保护：单轮记录过多时，属性类只通知一次，避免重复读布局
      const total = entry.pending.reduce((sum, r) => sum + recordCost(r), 0);
      let records = entry.pending;
      entry.pending = [];
      if (total > 3000 && !this.stormMode) {
        this.stormMode = true;
        const now = Date.now();
        if (now - this.lastLogAt > 10000) {
          this.lastLogAt = now;
          simpleVerbose(`🌪️ DOM 风暴保护：watch[${name}] 单轮 ${total} 条变化，本轮合并通知`);
        }
      }
      if (total > 3000) {
        const structural = records.filter((r) => r.type === "childList");
        records = structural.length > 0 ? structural.slice(0, 3000) : records.slice(0, 3000);
      }

      entry.lastFlush = Date.now();
      try {
        const ret = spec.handler(records) as any;
        if (ret && typeof ret.catch === "function") {
          ret.catch((err: unknown) => console.warn(`[orca-tabs] watch[${name}] 异步回调异常:`, err));
        }
      } catch (err) {
        console.warn(`[orca-tabs] watch[${name}] 回调异常:`, err);
      }
    }
    if (this.flushScheduled === false) {
      // 风暴结束后解除标记
      this.stormMode = false;
    }
  }

  release(name: string): void {
    const entry = this.watches.get(name);
    if (!entry) return;
    try {
      entry.observer.disconnect();
    } catch {
      /* 忽略 */
    }
    if (entry.timer !== null) {
      window.clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.pending = [];
    entry.target = null;
    this.watches.delete(name);
    this.stats.watchers = this.watches.size;
  }

  /** 插件卸载时调用：观察者 + 全部 document/window 监听一次性摘掉 */
  releaseAll(): void {
    if (this.attachTimer !== null) {
      window.clearInterval(this.attachTimer);
      this.attachTimer = null;
    }
    for (const name of Array.from(this.watches.keys())) this.release(name);
    for (const off of this.docOff.splice(0)) {
      try {
        off();
      } catch {
        /* 忽略 */
      }
    }
    for (const off of this.winOff.splice(0)) {
      try {
        off();
      } catch {
        /* 忽略 */
      }
    }
    this.docSeen.clear();
    this.winSeen.clear();
  }

  uninstall(): void {
    this.releaseAll();
    this.installed = false;
  }
}

export const domLifecycle = new DomLifecycle();

/** 便捷：只观察"面板容器"这一层，而不是整个 body */
export function panelsContainer(): Element | null {
  return (
    document.querySelector(".orca-panels-container") ||
    document.querySelector("section#main") ||
    document.getElementById("main") ||
    null
  );
}

/** 判断一条记录是否发生在面板区域内（用于大范围观察时的预过滤） */
export function isPanelish(node: Node | null): boolean {
  if (!node) return false;
  const el = (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement);
  if (!el) return false;
  return !!(
    el.closest(".orca-panels-container") ||
    el.closest("section#main") ||
    el.classList.contains("orca-panel") ||
    el.classList.contains("orca-panels-row") ||
    el.classList.contains("orca-hideable")
  );
}

export default domLifecycle;
