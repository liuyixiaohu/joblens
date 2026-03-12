# LinkedIn Job Filter Userscript — 开发教训总结

> 从 v1.0 到 v3.10 的开发过程中积累的经验教训。
> 适用于：Tampermonkey/Greasemonkey userscript 开发、LinkedIn DOM 操作、动态页面交互。

---

## 1. LinkedIn 页面架构特征（非反爬，但影响脚本）

| 特征 | 原因 | 对脚本的影响 |
|---|---|---|
| `display: contents` wrapper div | 现代 CSS 布局优化（避免多余 div 干扰 grid/flex） | 元素 `getBoundingClientRect()` 返回 0×0，但 DOM 查询（`querySelectorAll`、`textContent`）正常 |
| 动态 class 名（`_8aba1085`） | CSS Modules / build tool hash | 不能用 class 名选择卡片，需要用语义化属性（如 `aria-label`） |
| 渐进式渲染 | 性能优化，先渲染 DOM 骨架再填充文本 | 文本检测不能在 DOM 首次出现时一次性完成，需要重复检查 |
| 虚拟列表 (list virtualization) | 滚动性能优化，回收不可见卡片 DOM | DOM 元素会被替换成新对象，WeakSet 引用失效 |
| SPA 路由 | React SPA 标准做法 | URL 变化不触发 `load` 事件，需要 MutationObserver 检测 |

**结论**：LinkedIn 的 DOM 复杂性来自大型 React SPA + 现代 CSS + 性能优化的组合，不是刻意反爬。`aria-label` 等无障碍属性反而是可靠的选择器。

---

## 2. `display: contents` — 分离检测与显示

**问题**：`display: contents` 元素在 DOM 中完整存在（`querySelectorAll`、`textContent` 正常），但在 CSS 中"消失"（无 layout box，宽高=0）。

**教训**：对同一个元素同时做"文本检测"和"视觉操作"时，如果该元素可能是 `display: contents`，必须分离两个职责：

- **Scope 元素**（文本检测）：保持 `display: contents` 元素，`textContent` 涵盖全部卡片内容
- **Display 元素**（badge/border 显示）：用 `getComputedStyle(el).display !== "contents"` 找第一个有 layout box 的后代

```js
// 判断 display:contents 用 getComputedStyle，不用 getBoundingClientRect
// getComputedStyle 不受滚动位置和虚拟化影响
function getVisibleEl(card) {
  if (getComputedStyle(card).display !== "contents") return card;
  for (const child of card.children) {
    if (getComputedStyle(child).display !== "contents") return child;
  }
  return card;
}
```

**v3.7 犯的错误**：让 `getJobCards()` 直接返回可见元素，导致文本检测范围缩小 → 漏检和误检。

---

## 3. 子字符串匹配的 Greedy-First 陷阱

**问题**：`getActiveCard()` 用 `detailTitle.includes(cardTitle)` 找当前活跃卡片，第一个匹配就返回。

**场景**：
- 详情面板标题：`"Intern the Otsuka Way 2026 - Marketing Intern"`
- 卡片列表中 Kimley-Horn 的标题 `"Marketing Intern"` 排在 Otsuka 前面
- `"intern the otsuka way 2026 - marketing intern".includes("marketing intern")` → true
- 返回了错误的卡片！

**教训**：当多个候选项都满足子字符串匹配时，"第一个匹配"策略不安全。改为：
1. **优先精确匹配**（如 URL 中的 jobId）
2. **最长匹配**（更长的标题更具体）

```js
// 错误：greedy first match
for (const card of cards) {
  if (detailTitle.includes(cardTitle)) return card; // 短标题先命中
}

// 正确：best match (longest)
let bestCard = null, bestLen = 0;
for (const card of cards) {
  if (detailTitle.includes(cardTitle) && cardTitle.length > bestLen) {
    bestLen = cardTitle.length;
    bestCard = card;
  }
}
```

---

## 4. Map Key 碰撞 — 用唯一 ID 而非名称

**问题**：`labeledJobs` Map 用职位标题作 key（如 `"Marketing Intern"`），不同公司的同名职位共享一个 key。

**场景**：
1. Scan 发现某公司的 "Intern, Marketing" 是 Reposted → 存入 Map
2. LinkedIn 虚拟列表重建 DOM
3. `refreshBadges()` 看到 CommScope 的 "Intern, Marketing" 标题匹配 → 错误恢复 Reposted 标签

**教训**：凡是需要唯一标识的场景，用实体 ID（如 jobId）而非名称。名称不唯一。

```js
// 错误：用标题做 key
labeledJobs.set("Marketing Intern", reasons); // 多个职位共享！

// 正确：用 jobId 做 key
function getJobKey(card) {
  const link = card.querySelector('a[href*="/jobs/view/"]');
  if (link) {
    const m = link.href.match(/\/jobs\/view\/(\d+)/);
    if (m) return "id:" + m[1]; // 全局唯一
  }
  return title + "|" + company; // fallback
}
```

---

## 5. 渐进式渲染与 processedCards 的时序问题

**问题**：LinkedIn 先渲染 DOM 骨架，后填充文本（如 "Applied"）。`processedCards.add(card)` 在文本出现前执行，后续 MutationObserver 触发时卡片已被跳过。

**教训**：对于可能延迟出现的文本（如 "Applied"），检测逻辑不能被 `processedCards` 守卫包裹。

```js
// 错误：Applied 检查在 processedCards 保护内
if (processedCards.has(card)) return;
processedCards.add(card);
if (cardHasAppliedText(card)) ... // 此时文本可能还没渲染

// 正确：Applied 检查在 processedCards 之外，每次都重新检查
if (!card.dataset.ljReasons?.includes("applied")) {
  if (cardHasAppliedText(card)) labelCard(card, "applied");
}
if (processedCards.has(card)) return;
processedCards.add(card);
// 其他一次性检查...
```

---

## 6. 竞态条件与去重

**问题**：`refreshBadges()`（1s 防抖）和 `filterJobCards()`（200ms 防抖）近乎同时运行，都尝试标记同一张卡片，导致重复 badge。

**教训**：
- 多个异步路径写同一个 DOM 时，需要在写入端做幂等检查（`dataset.ljReasons.includes(reason)`）
- 在恢复路径末尾将卡片加入 `processedCards`，阻止检测路径重复处理

---

## 7. `textContent` vs `innerText` vs leaf node 检查

| 方法 | 特点 | 适用场景 |
|---|---|---|
| `el.textContent` | 包含所有后代文本（含隐藏元素），不触发 reflow | 快速粗略检查（如 `includes("reposted")`） |
| `el.innerText` | 只返回可见文本，按渲染换行，触发 reflow | 提取文本行（如公司名、职位名） |
| leaf node 遍历 | 精确检查单个文本节点 | 精确匹配（如区分 "Applied" vs "Applied Materials"） |

**"Applied" 检测用 leaf node**：`el.textContent.trim() === "Applied"` 且 `el.children.length === 0`，避免匹配 "Applied Materials"。

---

## 8. 卡片定位策略：Dismiss 按钮上溯法

LinkedIn 每张卡片都有 `<button aria-label="Dismiss [job title] job">`。利用这个锚点：

1. 找到所有 Dismiss 按钮
2. 从按钮向上遍历 DOM，找到"边界元素"（父节点包含 >1 个 Dismiss 按钮的那个子节点）
3. 边界元素 = 单张卡片的完整 DOM 范围

```
container (25 dismiss buttons)
  └── card_wrapper (1 dismiss button) ← 这就是"卡片"
      └── ... card content ...
          └── <button aria-label="Dismiss ... job">
```

**注意**：`parentElement.querySelectorAll(...)` 搜索整个子树，所以 `display: contents` 不影响计数。

---

## 9. CSS 选择器 vs Inline Style

**CSS 选择器**（如 `[data-lj-filtered]`）对 `display: contents` 元素无视觉效果（元素无 box）。需要用 **inline style** 在可见子元素上设置 `borderLeft`、`position: relative` 等。

CSS 规则可以保留作为 fallback（对本身可见的卡片仍然生效），但核心显示逻辑必须走 JS inline style。

---

## 10. MutationObserver 防抖策略

LinkedIn 页面 DOM 变化频繁（每次鼠标移动都可能触发）。不同操作需要不同的防抖时间：

| 操作 | 防抖时间 | 原因 |
|---|---|---|
| `filterJobCards()` | 200ms | 快速响应新卡片出现 |
| `checkDetailPanel()` | 600ms | 等待详情面板内容加载 |
| `refreshBadges()` | 1000ms | 低优先级恢复，避免频繁 DOM 查询 |

**注意**：三者共享一个 MutationObserver，用独立的 `setTimeout` 变量防抖。

---

## 11. 正则表达式注意事项

- `aria-label` 匹配用 `*=`（子字符串）：`'button[aria-label*="Dismiss"]'`
- 提取标题用非贪婪匹配：`/^Dismiss\s+(.+?)\s+job$/`（`.+?` 确保最短匹配）
- No Sponsor 关键词用 `|` 组合成一个大正则，预编译为 `RegExp` 对象（避免每次检测都重建）

---

## 12. WeakSet vs Map 的选择

- **`processedCards`**（WeakSet）：跟踪已处理的 DOM 元素。DOM 元素被 GC 时自动清除，无内存泄漏。
- **`labeledJobs`**（Map）：跨 DOM 替换持久化标签。用 jobId 做 key，不随 DOM 元素销毁而丢失。
- **`scannedCards`**（WeakSet）：跟踪已扫描的卡片，避免重复扫描。

**教训**：WeakSet 适合"只要 DOM 在就跟踪"的场景；Map 适合"即使 DOM 被替换也要记住"的场景。

---

## 13. LinkedIn 多种链接格式 — 不要硬编码 URL 模式

**问题**：脚本只查找 `/jobs/view/12345` 格式的链接来提取 jobId。但 LinkedIn 搜索结果页的卡片使用 `/jobs/search-results/?currentJobId=12345` 格式。

**场景**：
- 所有卡片链接路径为 `/jobs/search-results/`，jobId 藏在查询参数 `currentJobId` 中
- `getJobKey()` 找不到 `/jobs/view/` → 回退到 `title|company` key → 碰撞风险
- `getActiveCard()` 用 jobId 匹配失败 → 回退到标题匹配 → 可能匹配错误的卡片

**教训**：提取 jobId 时需要兼容多种 URL 格式：

```js
function getCardJobId(card) {
  const links = card.querySelectorAll("a");
  for (const link of links) {
    // 格式1: /jobs/view/12345
    const viewMatch = link.href.match(/\/jobs\/view\/(\d+)/);
    if (viewMatch) return viewMatch[1];
    // 格式2: ?currentJobId=12345
    try {
      const u = new URL(link.href);
      const id = u.searchParams.get("currentJobId");
      if (id) return id;
    } catch {}
  }
  return null;
}
```

---

## 14. "最长匹配"的反面 — 超集标题误匹配

**问题**：`getActiveCard()` 的"最长匹配"策略在 v3.9 修复了短标题误匹配（"Marketing Intern" 匹配了 "Intern the Otsuka Way 2026 - Marketing Intern"），但引入了新问题。

**场景**：
- 详情面板标题：`"Product Management Intern"`（Sloan Valve）
- 卡片 #4 标题：`"Product Management Intern"`（len=25，精确匹配）
- 卡片 #11 标题：`"Commercial & Product Management Intern"`（len=38，包含详情标题）
- 最长匹配选了 #11（Balchem），但正确答案是 #4（Sloan Valve）

**教训**：最长匹配假设"更长 = 更具体"，但当长标题是短标题的超集时，反而更不精确。正确策略：

1. **精确匹配最优先**（标题完全相同）
2. **子字符串匹配中选长度差最小的**（最接近的比最长的更可能正确）

```js
// 错误：最长匹配（超集标题会赢）
if (cardTitle.length > bestLen) { bestCard = card; }

// 正确：精确匹配优先，然后选长度差最小的
if (cardTitle === detailTitle) { return card; } // 精确匹配
const diff = Math.abs(cardTitle.length - detailTitle.length);
if (diff < bestDiff) { bestCard = card; } // 最接近匹配
```

---

## 15. `display:contents` 元素不可点击 — clickCard 策略

**问题**：`clickCard()` 在找不到 `div[role="button"]` 时直接 `card.click()`。但 `display:contents` 元素无 layout box，`.click()` 可能不触发 LinkedIn 的 UI 响应。

**教训**：点击 fallback 链应该找有 layout box 的元素：

```
div[role="button"] > 卡片内链接 > 可见子元素(getVisibleEl) > card 本身
```

LinkedIn 搜索结果页多数卡片无 `div[role="button"]`，但都有链接元素（`<a>`），点击链接可以可靠地触发卡片选中。
