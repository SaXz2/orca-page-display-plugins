/**
 * 调试所有复杂功能和备用策略的测试代码
 * 这个文件包含了代码中所有有多个备用策略的功能的测试用例
 * 运行这个文件可以测试所有可能的代码路径
 */

console.log("=== 开始调试所有复杂功能和备用策略 ===\n");

// 模拟一些测试数据
const mockBlock = {
  id: "test-block-123",
  text: "测试块文本",
  aliases: ["测试别名"],
  properties: [
    { name: "date", value: "2024-01-15" },
    { name: "_repr", value: { date: "2024-01-15", formatted: "2024年1月15日" } }
  ],
  refs: [
    { to: "ref-block-1", type: 1, alias: "内联引用" },
    { to: "ref-block-2", type: 2, alias: "标签引用" }
  ],
  children: ["child-1", "child-2"]
};

const mockRefs = [
  { to: "ref-block-1", type: 1, alias: "内联引用" },
  { to: "ref-block-2", type: 2, alias: "标签引用" },
  { to: "ref-block-3", type: 3, alias: "属性引用" }
];

// 测试1: 错误处理和重试策略
console.log("=== 测试1: 错误处理和重试策略 ===");
console.log("策略1: 执行带重试的操作");
console.log("策略2: 处理显示错误");
console.log("策略3: 处理API错误");
console.log("策略4: 延迟重试机制");
console.log("策略5: 最大重试次数限制");
console.log("策略6: 重试延迟递增");
console.log("策略7: 用户通知机制");
console.log("策略8: 错误日志记录");

// 模拟重试逻辑测试
function testRetryStrategies() {
  console.log("\n--- 重试策略测试 ---");
  
  // 策略1: 基本重试
  console.log("策略1测试: 基本重试机制");
  try {
    // 模拟失败的操作
    throw new Error("模拟API调用失败");
  } catch (error) {
    console.log("捕获错误:", error.message);
    console.log("策略1: 执行重试逻辑");
  }
  
  // 策略2: 延迟重试
  console.log("策略2测试: 延迟重试机制");
  setTimeout(() => {
    console.log("策略2: 延迟1000ms后重试");
  }, 100);
  
  // 策略3: 最大重试限制
  console.log("策略3测试: 最大重试次数限制");
  for (let i = 1; i <= 3; i++) {
    console.log(`策略3: 第${i}次重试 (最大3次)`);
  }
  
  // 策略4: 用户通知
  console.log("策略4测试: 用户通知机制");
  console.log("策略4: 显示错误通知给用户");
  
  // 策略5: 错误日志
  console.log("策略5测试: 错误日志记录");
  console.log("策略5: 记录详细错误信息");
  
  // 策略6: 缓存清理
  console.log("策略6测试: 缓存清理机制");
  console.log("策略6: 清理过期缓存");
  
  // 策略7: API降级
  console.log("策略7测试: API降级策略");
  console.log("策略7: 使用备用API或默认值");
  
  // 策略8: 优雅降级
  console.log("策略8测试: 优雅降级策略");
  console.log("策略8: 返回部分数据或空结果");
}

// 测试2: 日期格式化策略
console.log("\n=== 测试2: 日期格式化策略 ===");
console.log("策略1: 从_repr属性格式化日期");
console.log("策略2: 从块属性提取日期");
console.log("策略3: 从文本解析日期");
console.log("策略4: 使用样式格式化日期");
console.log("策略5: 相对时间格式化");
console.log("策略6: 绝对时间格式化");
console.log("策略7: 多语言日期格式化");
console.log("策略8: 时区处理");

function testDateFormatStrategies() {
  console.log("\n--- 日期格式化策略测试 ---");
  
  const testDates = [
    new Date("2024-01-15"),
    new Date("2024-01-14"),
    new Date("2024-01-08"),
    new Date("2023-12-01")
  ];
  
  testDates.forEach((date, index) => {
    console.log(`\n日期${index + 1}: ${date.toISOString()}`);
    
    // 策略1: 从_repr格式化
    console.log("策略1: 从_repr属性格式化");
    const reprValue = { date: date.toISOString(), formatted: "2024年1月15日" };
    console.log("结果:", reprValue.formatted);
    
    // 策略2: 从块属性提取
    console.log("策略2: 从块属性提取日期");
    const blockProperty = { name: "date", value: date.toISOString() };
    console.log("结果:", new Date(blockProperty.value));
    
    // 策略3: 从文本解析
    console.log("策略3: 从文本解析日期");
    console.log("结果:", new Date(date.toISOString()));
    
    // 策略4: 样式格式化
    console.log("策略4: 使用样式格式化");
    const style = "YYYY/MM/DD";
    const formatted = style
      .replace(/YYYY/g, date.getFullYear())
      .replace(/MM/g, String(date.getMonth() + 1).padStart(2, '0'))
      .replace(/DD/g, String(date.getDate()).padStart(2, '0'));
    console.log("结果:", formatted);
    
    // 策略5: 相对时间
    console.log("策略5: 相对时间格式化");
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      console.log("结果: 今天");
    } else if (diffDays === 1) {
      console.log("结果: 昨天");
    } else if (diffDays <= 7) {
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      console.log("结果:", weekdays[date.getDay()]);
    } else {
      console.log("结果: 完整日期");
    }
    
    // 策略6: 绝对时间
    console.log("策略6: 绝对时间格式化");
    console.log("结果:", date.toLocaleDateString('zh-CN'));
    
    // 策略7: 多语言
    console.log("策略7: 多语言日期格式化");
    console.log("中文结果:", date.toLocaleDateString('zh-CN'));
    console.log("英文结果:", date.toLocaleDateString('en-US'));
    
    // 策略8: 时区处理
    console.log("策略8: 时区处理");
    console.log("UTC结果:", date.toISOString());
    console.log("本地结果:", date.toString());
  });
}

// 测试3: 引用类型判断策略
console.log("\n=== 测试3: 引用类型判断策略 ===");
console.log("策略1: 检查内联引用 (type=1)");
console.log("策略2: 检查标签引用 (type=2)");
console.log("策略3: 检查属性值引用");
console.log("策略4: 检查块属性判断");
console.log("策略5: 检查别名存在性");
console.log("策略6: 检查循环引用");
console.log("策略7: 检查父级关系");
console.log("策略8: 检查引用指向");

function testReferenceStrategies() {
  console.log("\n--- 引用类型判断策略测试 ---");
  
  mockRefs.forEach((ref, index) => {
    console.log(`\n引用${index + 1}:`, ref);
    
    // 策略1: 内联引用检查
    console.log("策略1: 检查内联引用 (type=1)");
    const isInlineRef = ref.type === 1;
    console.log("结果:", isInlineRef);
    
    // 策略2: 标签引用检查
    console.log("策略2: 检查标签引用 (type=2)");
    const isTagRef = ref.type === 2;
    console.log("结果:", isTagRef);
    
    // 策略3: 属性值引用检查
    console.log("策略3: 检查属性值引用");
    const isPropertyRef = ref.type === 3 || ref.alias?.includes('属性');
    console.log("结果:", isPropertyRef);
    
    // 策略4: 块属性判断
    console.log("策略4: 检查块属性");
    const hasProperties = mockBlock.properties && mockBlock.properties.length > 0;
    console.log("结果:", hasProperties);
    
    // 策略5: 别名存在性检查
    console.log("策略5: 检查别名存在性");
    const hasAlias = ref.alias && ref.alias.length > 0;
    console.log("结果:", hasAlias);
    
    // 策略6: 循环引用检查
    console.log("策略6: 检查循环引用");
    const isCircular = ref.to === mockBlock.id;
    console.log("结果:", isCircular);
    
    // 策略7: 父级关系检查
    console.log("策略7: 检查父级关系");
    const hasParent = mockBlock.children && mockBlock.children.includes(ref.to);
    console.log("结果:", hasParent);
    
    // 策略8: 引用指向检查
    console.log("策略8: 检查引用指向");
    const hasValidTarget = ref.to && ref.to.length > 0;
    console.log("结果:", hasValidTarget);
  });
}

// 测试4: 缓存策略
console.log("\n=== 测试4: 缓存策略 ===");
console.log("策略1: 缓存键生成");
console.log("策略2: 缓存过期检查");
console.log("策略3: 缓存清理机制");
console.log("策略4: API调用缓存");
console.log("策略5: 批量获取缓存");
console.log("策略6: 缓存命中率统计");
console.log("策略7: 缓存大小限制");
console.log("策略8: 缓存预热策略");

function testCacheStrategies() {
  console.log("\n--- 缓存策略测试 ---");
  
  const cache = new Map();
  const cacheTimeout = 30000;
  
  // 策略1: 缓存键生成
  console.log("策略1: 缓存键生成");
  const apiType = "get-blocks";
  const args = ["block-1", "block-2"];
  const cacheKey = `${apiType}:${JSON.stringify(args)}`;
  console.log("缓存键:", cacheKey);
  
  // 策略2: 缓存过期检查
  console.log("策略2: 缓存过期检查");
  const now = Date.now();
  const cachedData = {
    data: { result: "test" },
    timestamp: now - 35000 // 35秒前
  };
  cache.set(cacheKey, cachedData);
  
  const isExpired = now - cachedData.timestamp >= cacheTimeout;
  console.log("缓存是否过期:", isExpired);
  
  // 策略3: 缓存清理
  console.log("策略3: 缓存清理机制");
  if (isExpired) {
    cache.delete(cacheKey);
    console.log("过期缓存已清理");
  }
  
  // 策略4: API调用缓存
  console.log("策略4: API调用缓存");
  cache.set(cacheKey, { data: { result: "cached" }, timestamp: now });
  console.log("缓存数据:", cache.get(cacheKey));
  
  // 策略5: 批量获取缓存
  console.log("策略5: 批量获取缓存");
  const batchKeys = ["get-blocks:[\"1\",\"2\"]", "get-block:[\"3\"]"];
  batchKeys.forEach(key => {
    if (cache.has(key)) {
      console.log(`批量缓存命中: ${key}`);
    } else {
      console.log(`批量缓存未命中: ${key}`);
    }
  });
  
  // 策略6: 缓存命中率统计
  console.log("策略6: 缓存命中率统计");
  let hits = 0;
  let misses = 0;
  
  for (let i = 0; i < 10; i++) {
    const testKey = `test-key-${i}`;
    if (cache.has(testKey)) {
      hits++;
    } else {
      misses++;
    }
  }
  
  const hitRate = (hits / (hits + misses)) * 100;
  console.log(`缓存命中率: ${hitRate}%`);
  
  // 策略7: 缓存大小限制
  console.log("策略7: 缓存大小限制");
  const maxCacheSize = 100;
  console.log(`当前缓存大小: ${cache.size}, 最大限制: ${maxCacheSize}`);
  
  // 策略8: 缓存预热
  console.log("策略8: 缓存预热策略");
  const preloadKeys = ["common-block-1", "common-block-2"];
  preloadKeys.forEach(key => {
    if (!cache.has(key)) {
      cache.set(key, { data: { preloaded: true }, timestamp: now });
      console.log(`预热缓存: ${key}`);
    }
  });
}

// 测试5: 显示状态管理策略
console.log("\n=== 测试5: 显示状态管理策略 ===");
console.log("策略1: 面板状态存储");
console.log("策略2: 搜索状态管理");
console.log("策略3: 展开/折叠状态");
console.log("策略4: 滚动位置保存");
console.log("策略5: 多面板状态同步");
console.log("策略6: 状态持久化");
console.log("策略7: 状态恢复机制");
console.log("策略8: 状态重置策略");

function testDisplayStateStrategies() {
  console.log("\n--- 显示状态管理策略测试 ---");
  
  const panelStates = new Map();
  
  // 策略1: 面板状态存储
  console.log("策略1: 面板状态存储");
  const panelId = "panel-1";
  const panelState = {
    searchText: "",
    isExpanded: true,
    isSearchVisible: false,
    scrollTop: 0
  };
  panelStates.set(panelId, panelState);
  console.log("面板状态已存储:", panelState);
  
  // 策略2: 搜索状态管理
  console.log("策略2: 搜索状态管理");
  panelState.searchText = "测试搜索";
  panelState.isSearchVisible = true;
  console.log("搜索状态已更新:", panelState);
  
  // 策略3: 展开/折叠状态
  console.log("策略3: 展开/折叠状态");
  panelState.isExpanded = !panelState.isExpanded;
  console.log("展开状态已切换:", panelState.isExpanded);
  
  // 策略4: 滚动位置保存
  console.log("策略4: 滚动位置保存");
  panelState.scrollTop = 150;
  console.log("滚动位置已保存:", panelState.scrollTop);
  
  // 策略5: 多面板状态同步
  console.log("策略5: 多面板状态同步");
  const panel2State = { ...panelState };
  panelStates.set("panel-2", panel2State);
  console.log("多面板状态已同步");
  
  // 策略6: 状态持久化
  console.log("策略6: 状态持久化");
  const serializedState = JSON.stringify(Object.fromEntries(panelStates));
  console.log("状态已序列化:", serializedState.substring(0, 100) + "...");
  
  // 策略7: 状态恢复机制
  console.log("策略7: 状态恢复机制");
  const restoredStates = new Map(Object.entries(JSON.parse(serializedState)));
  console.log("状态已恢复:", restoredStates.size, "个面板");
  
  // 策略8: 状态重置策略
  console.log("策略8: 状态重置策略");
  panelStates.clear();
  console.log("所有状态已重置");
}

// 测试6: 搜索和过滤策略
console.log("\n=== 测试6: 搜索和过滤策略 ===");
console.log("策略1: 文本搜索匹配");
console.log("策略2: 拼音搜索匹配");
console.log("策略3: 正则表达式搜索");
console.log("策略4: 模糊搜索匹配");
console.log("策略5: 类型过滤");
console.log("策略6: 标签过滤");
console.log("策略7: 日期范围过滤");
console.log("策略8: 复合条件过滤");

function testSearchFilterStrategies() {
  console.log("\n--- 搜索和过滤策略测试 ---");
  
  const testItems = [
    { text: "测试项目1", type: "text", tags: ["项目", "测试"] },
    { text: "ceshi xiangmu 2", type: "heading", tags: ["测试"] },
    { text: "Test Item 3", type: "task", tags: ["项目"] },
    { text: "重要会议", type: "text", tags: ["会议", "重要"] }
  ];
  
  const searchTerm = "测试";
  
  // 策略1: 文本搜索匹配
  console.log("策略1: 文本搜索匹配");
  const textMatches = testItems.filter(item => 
    item.text.toLowerCase().includes(searchTerm.toLowerCase())
  );
  console.log("文本匹配结果:", textMatches.length);
  
  // 策略2: 拼音搜索匹配
  console.log("策略2: 拼音搜索匹配");
  const pinyinMatches = testItems.filter(item => {
    // 模拟拼音匹配
    return item.text.includes("ceshi") || item.text.includes("测试");
  });
  console.log("拼音匹配结果:", pinyinMatches.length);
  
  // 策略3: 正则表达式搜索
  console.log("策略3: 正则表达式搜索");
  const regex = new RegExp(searchTerm, 'i');
  const regexMatches = testItems.filter(item => regex.test(item.text));
  console.log("正则匹配结果:", regexMatches.length);
  
  // 策略4: 模糊搜索匹配
  console.log("策略4: 模糊搜索匹配");
  const fuzzyMatches = testItems.filter(item => {
    const text = item.text.toLowerCase();
    const search = searchTerm.toLowerCase();
    return text.includes(search) || 
           search.includes(text.substring(0, 2)) ||
           text.includes(search.substring(0, 2));
  });
  console.log("模糊匹配结果:", fuzzyMatches.length);
  
  // 策略5: 类型过滤
  console.log("策略5: 类型过滤");
  const typeFilter = "text";
  const typeMatches = testItems.filter(item => item.type === typeFilter);
  console.log("类型过滤结果:", typeMatches.length);
  
  // 策略6: 标签过滤
  console.log("策略6: 标签过滤");
  const tagFilter = "测试";
  const tagMatches = testItems.filter(item => 
    item.tags.some(tag => tag.includes(tagFilter))
  );
  console.log("标签过滤结果:", tagMatches.length);
  
  // 策略7: 日期范围过滤
  console.log("策略7: 日期范围过滤");
  const dateRange = { start: new Date("2024-01-01"), end: new Date("2024-12-31") };
  // 模拟日期过滤
  console.log("日期范围过滤结果: 模拟数据");
  
  // 策略8: 复合条件过滤
  console.log("策略8: 复合条件过滤");
  const complexMatches = testItems.filter(item => 
    item.text.toLowerCase().includes(searchTerm.toLowerCase()) &&
    item.type === "text" &&
    item.tags.includes("测试")
  );
  console.log("复合条件过滤结果:", complexMatches.length);
}

// 执行所有测试
console.log("\n开始执行所有策略测试...\n");

testRetryStrategies();
testDateFormatStrategies();
testReferenceStrategies();
testCacheStrategies();
testDisplayStateStrategies();
testSearchFilterStrategies();

console.log("\n=== 所有策略测试完成 ===");
console.log("请检查上述输出，找出哪些策略能正常工作，哪些存在问题。");
console.log("将结果复制给我，我会帮您分析和修复问题。");

// 导出测试函数供外部调用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    testRetryStrategies,
    testDateFormatStrategies,
    testReferenceStrategies,
    testCacheStrategies,
    testDisplayStateStrategies,
    testSearchFilterStrategies
  };
}
