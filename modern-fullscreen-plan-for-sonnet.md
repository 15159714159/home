# 沉浸式第二轮：走现代默认路线（去掉全部 apple 老标签）—— 对照页先行

## 依据（实测，非猜想）

用户提供的真机可全屏的参照站 https://springbrand.ai/aifriend/night/bar 的完整
head 配置只有两行，页面全文 0 个 "apple" 字样、无 manifest link、无 safe-area：

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/>
<meta name="theme-color" content="#09080a"/>
```

结论：iOS 16.4+ 添加到主屏幕默认即以 web app 全屏打开，iOS 26 上
**坏掉的是 apple-mobile-web-app-* 老标签路线**（我们前两轮 default/
black-translucent 都在这条死路上）。现代路线 = 什么都不声明。

## 第一阶段：对照页（做完 push 即停，等用户真机验证）

新建 `statusbar-test.html`，head 仅：charset + 
`<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">`
+ `<meta name="theme-color" content="#b2c8d6">` + title。
**禁止出现任何 apple-* meta 和 manifest link。**
body 同上一轮测试页：全屏渐变 + 顶部对比色横带 + 中央实时汇报
navigator.standalone / matchMedia('(display-mode: standalone)').matches /
inset-top / inset-bottom / innerHeight / screen.height + 底部 4px 红线。
（注意多报一项 display-mode——现代路线下 navigator.standalone 可能为 false，
不能再拿它当唯一判据。）

用户验证（Safari 打开 → 添加到主屏幕 → 新图标打开）：
① 渐变顶到屏幕最上沿；② inset-top ≈ 59/62 非 0；③ inset-bottom = 34；
④ **innerHeight ≈ 874（硬指标）**；⑤ 红线贴物理底边。

## 第二阶段：改主站（五条全过后执行）

index.html：
1. **删除**这三行：apple-mobile-web-app-capable、mobile-web-app-capable、
   apple-mobile-web-app-status-bar-style；apple-mobile-web-app-title 保留
   （只影响图标名，无害）；manifest link 保持已删状态（文件留盘）；
2. 新增 `<meta name="theme-color" content="#b2c8d6">`（与聊天背景融合）；
3. JS 里所有 `navigator.standalone === true` 的守卫（setupSafeAreaFallback、
   setupAppHeightFix）改为
   `navigator.standalone === true || matchMedia('(display-mode: standalone)').matches`；
4. setupSafeAreaFallback 恢复探针测量逻辑（从提交 69f9fe5 的父提交找回），
   撤销强设 0px；
5. composer 的 `env(safe-area-inset-bottom)+6px` 与 setupAppHeightFix 保留；
6. 诊断面板保留到用户确认成功，下轮连同测试页一起删。

用户验证同上五条 + 键盘弹收不跳（删旧图标→清站点数据→重加，老规矩）。

## 若对照页失败
不动主站，删测试页，报告失败。主站维持现状零损失。

## 禁止
跳过第一阶段；自行启动浏览器验证；整串覆写 viewport；动无关代码。
