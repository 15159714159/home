# 气泡皮肤重建方案：用官方 contentInsets 替换全部手调补丁

> 执行者注意：本方案是「重建」而非「微调」。现有 bubbleSpec 里的
> shiftX/shiftY、stretchW/stretchH、textX/textY、zoneShiftX/zoneShiftY
> 全部是在错误地基上打的视觉补丁，本次**全部删除**，不保留、不迁移。

## 背景与根因

文件：`index.html`（本目录），气泡皮肤相关代码在两处：
1. `bubbleSpec()` 函数与 `CHAT_THEMES` 数组（约 1963–2078 行）
2. `buildChatThemeCSS()` 函数（约 2338–2389 行）

根因：现有实现把 border-image 的 cap 切片值同时用作文字 padding
（`padding = border`，见 buildChatThemeCSS 的 rule() 内）。但 cap 尺寸由
装饰图案几何决定（尾巴/缎带有多大），与文字安全区是两组独立数据。
KakaoTalk 官方主题 CSS 中这两组值本来就是分开的两个字段：

- `-ios-background-image: 'xxx.png' <leftCap>px <topCap>px;` → 九宫格切片
- `-ios-title-edgeinsets: <top>px <left>px <bottom>px <right>px;` → 文字内边距
  （**注意顺序是 上 左 下 右**，与 CSS padding 的 上右下左 不同，映射时别搞反）

四套主题的官方数值已从原始 .ktheme 提取完毕，见下方数据表，**不需要目测调参**。

## 新的 bubbleSpec 设计

```js
// 全部参数来自官方 KakaoTalkTheme.css，单位 @1x point；素材是 @3x 图。
// insets: [top, left, bottom, right]，即官方 -ios-title-edgeinsets 原文顺序。
function bubbleSpec(file, w, h, leftCap, topCap, insets) {
  const STRETCH = 3; // 可拉伸带宽/高（原生像素）。iOS 老 API 的拉伸带是 1pt，@3x 即 3px。
  const left = leftCap * 3, top = topCap * 3;
  const right = Math.max(0, w - left - STRETCH);
  const bottom = Math.max(0, h - top - STRETCH);
  return {
    file,
    slice: [top, right, bottom, left],            // border-image-slice（原图像素）
    border: [top / 3, right / 3, bottom / 3, left / 3], // ::before 的 border-width（CSS px）
    // padding 顺序转换：官方 上左下右 → CSS 上右下左
    padding: [insets[0], insets[3], insets[2], insets[1]],
    // 防止短消息把四角切片挤变形：最小尺寸 = 两侧固定角之和 + 拉伸带
    minW: (left + right + STRETCH) / 3,
    minH: (top + bottom + STRETCH) / 3,
  };
}
```

要点：
- **删除**旧的 CONTENT_W/CONTENT_H/ZONE_SHIFT_X/ZONE_SHIFT_Y 常量及 12 参数签名。
  BUBBLE_SCALE 若仍为 1 可一并删除（当前没有非 1 的使用）。
- STRETCH=3 是 iOS 语义的忠实还原（1pt）。旧注释说「压到 1 个原生像素会拉花」，
  1 原生 px ≠ 1pt，3px 才是对等值。若某套皮肤长消息拉伸处仍有花纹撕裂，
  只允许调这一个全局常量（如 6/9），禁止再引入 per-bubble 补丁参数。

## buildChatThemeCSS 的修改

保留现有 `::before` 承载 border-image、本体只放文字的结构，但：

1. `.msg-bubble` 的 `padding` 改用 `spec.padding`（不再等于 border 值）；
2. **删除**本体和 `::before` 上的两个 `transform: translate(...)`（textX/textY 已废除）；
3. `min-width/min-height` 改用新的 `spec.minW/minH`（不再是原图全尺寸——
   这就是旧版单字消息也撑出巨大空气泡的原因）；
4. `font-size: 15px; line-height: 21px;` 保持不变；
5. `::before` 的 `border-width` 仍用 `spec.border`，其余 border-image 三行不动。

## 四套主题的完整数据表（全部来自官方 CSS，勿改动）

调用格式：`bubbleSpec(file, w, h, leftCap, topCap, [top, left, bottom, right])`
w/h 沿用代码中现有值（即 @3x PNG 实际像素尺寸，已验证过）。

### kakao-bb0ding02（뽀딩이）
| 气泡 | w×h | leftCap | topCap | insets 上左下右 |
|---|---|---|---|---|
| sendFirst    | 264×204 | 34 | 51 | 35 29 16 47 |
| sendGroup    | 264×144 | 34 | 31 | 15 29 15 47 |
| receiveFirst | 267×189 | 54 | 46 | 30 48 16 29 |
| receiveGroup | 258×144 | 54 | 31 | 16 48 14 26 |

### tenshichi-clean
| 气泡 | w×h | leftCap | topCap | insets 上左下右 |
|---|---|---|---|---|
| sendFirst    | 240×210 | 25 | 47 | 39 18 15 49 |
| sendGroup    | 240×132 | 25 | 21 | 13 18 15 49 |
| receiveFirst | 180×201 | 35 | 44 | 36 29 15 18 |
| receiveGroup | 180×132 | 35 | 21 | 13 29 15 18 |

### bear-bunny（토끼와 글루미베어）
| 气泡 | w×h | leftCap | topCap | insets 上左下右 |
|---|---|---|---|---|
| sendFirst    | 189×236 | 12 | 60 | 50 9 9 34 |
| sendGroup    | 189×134 | 20 | 19 | 9 9 16 34 |
| receiveFirst | 168×215 | 40 | 52 | 42 27 9 9 |
| receiveGroup | 168×134 | 40 | 19 | 9 27 16 9 |

### baby-gloomy-bear-pink（베이비 글루미베어 핑크）
| 气泡 | w×h | leftCap | topCap | insets 上左下右 |
|---|---|---|---|---|
| sendFirst    | 236×209 | 17 | 50 | 40 9 10 50 |
| sendGroup    | 236×118 | 20 | 20 | 9 9 10 50 |
| receiveFirst | 175×179 | 50 | 45 | 31 30 9 9 |
| receiveGroup | 175×115 | 40 | 19 | 9 30 9 9 |

自检：send 类气泡 right inset 最大（尾巴在右），receive 类 left inset 最大
（尾巴在左），上表全部符合，可作为抄写正确性的快速校验。

## 预期效果与验收

- 单字消息：气泡紧贴文字（如토끼 send 上下边距仅 9px 量级），不再出现原图大小的空壳。
- 官方 insets 有的比装饰角小，文字会部分压在拉伸区/装饰之上——这是 KakaoTalk
  原版的正常渲染效果，**不是 bug，不要为此加回偏移参数**。
- 验收方式：改完后停下，由用户本人打开页面逐套查看。**不要自行启动浏览器/
  Playwright 验证**（用户明确要求过）。

## 明确的禁止事项

- 禁止保留或迁移任何旧的手调参数（shift/stretch/text/zoneShift）。
- 禁止修改数据表中的官方数值来"调好看"。若视觉不对，先怀疑抄写/映射错误
  （尤其 insets 上左下右 → padding 上右下左 的顺序转换），再怀疑 STRETCH。
- 除上述两个函数及 CHAT_THEMES 的 bubbles 字段外，不动其他代码
  （尤其聊天同步、消息渲染逻辑）。
