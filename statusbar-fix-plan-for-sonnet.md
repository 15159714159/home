# 修复 iOS 26 standalone 底部 62pt 空条 —— 放弃 black-translucent 方案

## 已确诊的现象（真机诊断面板数据，勿再重复排查）

设备 iOS 26.6，standalone: true。屏幕高 874pt，但 innerHeight / visualViewport.height /
100dvh / #app 实高全部 = 812，恰好差 62pt（该机型状态栏高度）。web 视图被系统
「按扣除状态栏的高度定尺寸，却锚定在屏幕顶端」：顶部内容钻进状态栏底下，
底部露出 62pt 的原生背景（manifest background_color 的颜色），**在网页画布之外，
任何 CSS/JS 都够不着**。env(safe-area-inset-bottom) = 0 也证实系统认为视图底边
不贴屏幕底。

根因：`apple-mobile-web-app-status-bar-style: black-translucent` 在 iOS 26 已被
Apple 官方弃用且行为损坏（Safari 调试器有弃用警告；26.x 上透明状态栏效果丢失，
只剩这个错位布局）。**没有前端手段能在保留 black-translucent 的同时修掉这条空缝**，
所以方案是整体放弃它，改走「状态栏占位 + 配色融合」路线。

## 改动内容（文件：index.html + manifest.webmanifest）

### 第 1 步：换状态栏模式
把 `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
的 content 改为 `default`。此模式下 web 视图从状态栏下方开始、一直铺到屏幕底，
62pt 空条消失（这正是"其他 app 能直达底部"的原因——它们没用 black-translucent）。

### 第 2 步：中和 safe-top 体系（关键，漏了会顶部双倍留白）
default 模式下页面不再延伸到状态栏底下，env(safe-area-inset-top) 恒为 0，
现有 --safe-top 体系必须跟着中和：

1. `setupSafeAreaFallback()`：整个函数改为直接
   `document.documentElement.style.setProperty('--safe-top', '0px'); return;`
   （standalone + default 模式下强设 44px 的冷启动兜底不但无用还有害）。
   函数壳和调用点保留，将来若 Apple 修好 translucent 可回退。
2. 全文其余 `env(safe-area-inset-top)` 引用不用动——default 模式下它们自然为 0，
   `--safe-top` 又被上一条强设为 0，各处 `calc(0 + 58px)` 等固定偏移正常生效。
3. **逐个检查**所有用到 `--safe-top` / `safe-area-inset-top` 的规则（topbar、
   #page-chat padding、遮罩渐变、.space-section、.plan-section 等），确认在
   0 值下顶部间距视觉合理；若某处因原先默认按 20px 兜底而显得太挤，
   把该处的固定偏移量 +20px，不要恢复 safe-top 变量。

### 第 3 步：状态栏配色融合
default 模式下状态栏背景由系统渲染，取 manifest 的 background_color。
把 manifest.webmanifest 的 `background_color` 和 `theme_color` 从 `#b2c8d6`
改为与 --chat-bg 一致的 `#b2c8d6`→实际取 index.html :root 里 --chat-bg 的当前值
（浅色模式）。若两值本就相同则不动。暗色模式下状态栏颜色无法跟随切换，
这是 default 模式的已知代价，接受即可，不要为此引入 JS hack。

### 第 4 步：诊断代码处理
`setupViewportDebug()`（左上角绿字面板 + 底部红线）**本轮保留**，用户要靠它
验证修复；红线在修好后应贴住屏幕物理底边、面板 inner.h 应 ≈ 874-62=812 且
底下无异色条。用户确认修好后再整段删除该函数及其调用（函数注释里已标临时）。

### 明确不要做的事
- 不要动 setupAppHeightFix()（量高兜底，default 模式下无害）。
- 不要动任何 safe-area-inset-bottom 相关 padding（视图贴底后它们恢复真实值，
  home 指示条避让正好靠它们）。
- 不要尝试 viewport meta、100dvh→100svh、position:fixed 之类的花样——空条在
  网页画布之外，已验证 CSS 够不到。
- 改完 commit + push，然后停下等用户真机验证；不要自行启动浏览器/Playwright。

## 用户侧验证步骤（写给用户，Sonnet 改完原样转告）
部署后：删旧桌面图标 → Safari 打开页面并刷新 → 重新添加到主屏幕 → 打开。
看三点：① 底部异色空条是否消失、红线是否贴住屏幕底边；② 顶部状态栏下
内容是否不再被压住、间距是否正常；③ 键盘弹出收起一轮后底部是否依旧正常。
