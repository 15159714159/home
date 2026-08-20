# 主站沉浸式最终方案：状态栏颜色采样融合（iOS 26 实测机制）

## 已验证的机制（2026-08-21 真机三轮实验定案，不要重新怀疑）

iOS 26.6 上主屏 web app 的视口恒为「屏幕高 − 状态栏高」（本机 874−62=812），
没有任何配置能改变——apple 老标签三轮全灭。真正的「沉浸感」来自：
**iOS 26 不读 theme-color，状态栏颜色改为自动采样页面根元素（html）的背景色**。
测试页给 html 设了与渐变顶端同色的背景后，状态栏与页面无缝融合（用户确认
"对味"）。参照站 springbrand.ai 的全屏观感就是这么来的（整页深黑）。

因此主站方案 = 让 html 根元素的背景色始终等于聊天页顶部的视觉颜色。

## 改动清单（index.html + manifest 处理）

### 1. head 清理
- 删除 `<meta name="apple-mobile-web-app-capable">`、
  `<meta name="mobile-web-app-capable">`、
  `<meta name="apple-mobile-web-app-status-bar-style">` 三行
  （测试页无任何 apple 标签仍 standalone:true，实测无副作用；
  留着 status-bar-style 反而可能把系统拽回坏掉的老路径）。
- `apple-mobile-web-app-title` 保留（只影响图标名）。
- `<link rel="manifest">` 删除（此机制下无用；manifest.webmanifest 文件留盘）。
- theme-color meta：现在没有就保持没有（iOS 26 不读；本项目只服务 iOS）。

### 2. 状态栏颜色 = html 根元素背景色（核心）
现有 `setThemeColorMeta(content)` 只设 `document.body.style.backgroundColor`。
改为同时设 html 与 body：
```js
function setThemeColorMeta(content) {
  document.documentElement.style.backgroundColor = content;
  document.body.style.backgroundColor = content;
}
```

### 3. 采样点从「整图平均」改为「顶部条带平均」
`updateThemeColorFromBg()` 现在取背景图 16×16 全图平均色——但状态栏贴的是
图的**顶端**，整图平均在上下色差大的背景图上会穿帮。改为只平均顶部条带：
canvas 仍 16×16 绘制全图，但读像素改为 `ctx.getImageData(0, 0, 16, 2)`
（顶部约 12% 高度），其余逻辑不变。

### 4. 无背景图时的兜底（default 主题 + 暗色模式）
`updateThemeColorFromBg(null)` 分支现在取 `--chat-bg` 设置——确认该分支
在改动 2 之后同样走新的 setThemeColorMeta（html+body 同设）。暗色模式切换
时会重新调用（loadDarkMode/toggle 路径里已有调用则不动；若没有，在暗色
切换处补一次 updateThemeColorFromBg 的现行调用链，不要新造机制）。

### 5. 不要动的东西
- `--safe-top` 强设 0px：保留（此模式下视图从状态栏下方开始，页面不被
  时钟压住，inset-top 实测就是 0）；
- composer 的 `calc(env(safe-area-inset-bottom,0px)+6px)`：保留（inset-bottom
  实测 34，正常生效）；
- `setupAppHeightFix()`：保留；
- JS 里 `navigator.standalone === true` 守卫：保留（实测此模式下仍为 true）。

### 6. 收尾清理（同一轮一起做）
- 删除 `setupViewportDebug()` 整个函数及 init 里的调用（绿字面板+红线）；
- 删除 `statusbar-test.html`；
- 删除仓库里历史方案文档若用户同意可留着不动（不强制）。

## 预期效果与验收（改完 commit+push 停下，用户真机验证）
用户操作：删旧图标 → 清 15159714159.github.io 站点数据 → Safari 重开刷新
→ 重新添加到主屏幕。
验收：① 状态栏颜色与聊天页顶部无缝（时钟悬浮感）；② 换聊天主题（kakao 皮肤
带背景图）后状态栏颜色跟着变；③ 暗色模式切换后状态栏跟着变深；④ 底部无
空条、输入栏距底边正常；⑤ 键盘弹收一轮布局不跳。

## 禁止
- 不要恢复任何 apple status-bar meta 或 manifest link"再试试"；
- 不要自行启动浏览器/Playwright 验证；
- 不要动聊天同步、消息渲染、气泡皮肤等无关代码。
