# 恢复沉浸式状态栏（black-translucent）—— 按 SNUG 归档配方，对照页先行

## 背景

本项目 iOS standalone 底部 62pt 空条已通过「status-bar-style 改 default」修复
（见 statusbar-fix-plan-for-sonnet.md，提交 69f9fe5/ea34da4）。现在用户想找回
沉浸式效果（内容延伸到状态栏底下、时钟电量悬浮在内容上）。依据是用户另一项目
（SNUG）2026-07 的实战归档，其核心结论（对照实验实测，非猜测）：

1. `viewport-fit=cover` 必须有（已有）；
2. `apple-mobile-web-app-status-bar-style` 用 `black-translucent`；
3. **HTML 里不能挂 `<link rel="manifest">`** —— iOS 读到 manifest link 就会无
   视 black-translucent。安装/standalone/图标/名字全靠 apple 系 meta，不受影响；
4. **不能有 theme-color meta**（静态或 JS 动态创建的都不行）——本项目目前没有，
   保持没有即可；注意 `updateThemeColorFromBg()` 现在只设 body 背景色，没碰
   meta，不要顺手"完善"成写 meta。

风险提示：本项目在没有 manifest 的时期也出过空条，但当时从未严格执行
「删图标重加」，历史结论不可信。因此必须走对照页流程，不许直接改主站。

## 第一阶段：对照页（只做这个，做完停下等用户真机验证）

新建 `statusbar-test.html`（根目录，和 index.html 同级），要求：

- 纯静态、无任何框架/外部 JS/外部 CSS；
- head 只有这四行 + title：
  ```html
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  ```
  **不挂 manifest link，不放 theme-color。**
- body：一个从 (0,0) 铺满全屏的醒目渐变背景（`position:fixed; inset:0`，配
  `height:100dvh` 的兜底），顶部若被状态栏叠住能一眼看出（渐变顶端放一条
  对比色横带）；
- 页面中央用大号等宽字实时汇报（内联 script，几行即可）：
  `navigator.standalone`、`env(safe-area-inset-top)` 实测值（探针元素法）、
  `env(safe-area-inset-bottom)` 实测值、`innerHeight`、`screen.height`；
- 底部画一条 4px 红线（`position:fixed;bottom:0`）标记视图底边。

commit + push 后停下，告知用户验证步骤：
> Safari 打开 `/statusbar-test.html` → 添加到主屏幕 → 从新图标打开。
> 判定标准：① 渐变顶到屏幕最上沿、时钟悬浮其上；② inset-top 报约 59
> （灵动岛机型）或 44/47（刘海机型），不是 0；③ inset-bottom 报 34；
> ④ innerHeight ≈ screen.height（874，而不是 812）；⑤ 红线贴屏幕物理底边。
> 五条全过 = 配方在 iOS 26.6 上成立，进入第二阶段。

## 第二阶段：改主站（仅在对照页五条全过后执行）

index.html：
1. 删除 `<link rel="manifest" href="manifest.webmanifest">` 这一行
   （manifest.webmanifest 文件保留在盘上，不删文件）；
2. `apple-mobile-web-app-status-bar-style` 的 content 从 `default` 改回
   `black-translucent`；
3. `setupSafeAreaFallback()`：撤销「强设 --safe-top: 0px」，恢复成原来的
   探针测量逻辑（git 历史里有：探针元素读 env(safe-area-inset-top)，首帧
   <20 时先兜底 44px、300ms 后复测校正。可从提交 69f9fe5 的父提交找回原函数体）；
4. `#composerStack` 的 `padding-bottom: calc(env(safe-area-inset-bottom,0px)+6px)`
   保留不动（沉浸模式下 env 恢复真实值，正好生效）；
5. `setupAppHeightFix()` 保留不动（Math.max 量高在沉浸模式下无害）；
6. 左上角诊断面板 `setupViewportDebug()` 本轮保留，用户确认主站沉浸成功后，
   下一轮再整段删除（函数 + init 里的调用 + statusbar-test.html 一起清）。

commit + push 后停下，告知用户：删主站旧图标 → 清 Safari 网站数据 →
Safari 重开页面刷新 → 重新添加到主屏幕 → 验证同上五条 + 键盘弹收一轮不跳。

## 若对照页失败（五条有任何一条不过）

说明 iOS 26.6 已封死此路（或该机型行为变了）：不动主站任何东西，删掉
statusbar-test.html，commit + push，向用户报告失败即可。主站维持 default
模式的正常状态，零损失。

## 禁止事项

- 禁止跳过第一阶段直接改主站；
- 禁止在两个阶段之间自行启动浏览器/Playwright 验证——所有真机验证由用户完成；
- 禁止整串覆写 viewport meta（SNUG 踩坑一：JS 重写 viewport 字符串漏掉
  viewport-fit=cover，HTML 写对也白搭）；
- 禁止新增 theme-color meta；
- 禁止改动聊天同步、消息渲染等无关代码。
