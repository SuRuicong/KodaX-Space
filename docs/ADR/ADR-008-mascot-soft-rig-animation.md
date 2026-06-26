# ADR-008: Mascot 资产动画策略：像素基准 + soft rig

- **Status**: Accepted
- **Date**: 2026-06-25
- **Companion**: 首页输入栏 mascot 替换与动效原型

## Context

首页原先有 dog emoji 文本占位。我们希望替换为一只来自概念图的狗 mascot，并把它缩小后放在输入栏上沿右半边常驻活动。这个 mascot 有三个同时成立的目标：

1. 静态外观必须和选定概念图里的狗保持像素级一致。
2. 运行时必须是 SVG 交付形态，便于嵌入 React/CSS、分层命名、接入动效和降级策略。
3. 动效不能出现身体裂缝、白底矩形、关节断开或“被切碎”的感觉。

调研和原型验证后确认：这三个目标不能靠“纯 SVG 路径重画”或“把可见像素硬切成身体部件”同时满足。

- 纯矢量重画会由浏览器重新光栅化，无法保证与原始位图逐像素一致。
- 把同一张扁平 PNG 的可见像素切成头、腿、尾巴再旋转，静态可以拼回 0 diff，但一动就会暴露切缝。
- 2D cutout/rig 的专业做法要求隐藏重叠区域、圆形关节端、PSD 图层或 mesh/ArtMesh 形变。单张扁平概念图不包含这些隐藏像素。

当前原型已验证：用完整原图裁剪作为 SVG 内的基准位图，静态 SVG 在 Chromium 中按原始尺寸截图后，与原图裁剪比对 `max_abs_diff = 0`、`nonzero_channels = 0`。

## Decision

Mascot 采用 **source-image soft rig**：

1. **完整位图作为基准层**。SVG 内嵌选定概念图裁剪出的完整狗图，作为 `complete-reference` 层。静态像素一致性以这个文件为唯一基准。
2. **动效只做叠加，不破坏基准层**。常驻动画使用轻量 overlay：整体呼吸、尾巴 soft echo、眨眼遮盖、局部暖光、影子 pulse。overlay 可以独立命名和启停，但不把狗的身体切开后做大幅变换。
3. **输入栏使用透明 cutout 变体**。UI 里不能露出概念图白底矩形；用于输入栏的版本需要把近白背景处理成透明，并保留足够外边距避免动效裁切。
4. **大动作使用独立 pose 或重新出源文件**。Walk、Sniff、Thinking、Success 这类姿态变化不能从站立主图硬掰；应使用独立姿态 sprite，或重新生成/绘制带隐藏重叠区域的 PSD/分层源文件，再做 rig。
5. **SVG 是交付容器，不承诺纯矢量**。本决策里的 SVG 可以包含 raster `<image>`，因为目标是视觉保真和可集成动效，不是无限缩放的纯 vector mascot。

## Rationale

- **像素保真优先级最高**。用户选中的是概念图里的那只狗，而不是“风格类似的另一只狗”。完整位图基准层能把身份稳定下来。
- **soft rig 避免切缝**。基准层始终完整存在，动画层只叠加细微变化，不会因为关节缺少隐藏像素而露出断裂。
- **复杂度适合首页常驻动效**。输入栏 mascot 不需要完整骨骼动画系统；低幅度、低频率的生命感比大幅行走更适合常驻 UI。
- **后续可扩展**。如果以后需要真正走路、嗅闻或更夸张表情，可以在同一命名约定下增加 pose sprite 或导入真正分层源文件，而不是推翻现有集成。

## 被否决的方案

| 方案                                           | 否决理由                                                      |
| ---------------------------------------------- | ------------------------------------------------------------- |
| 纯 SVG 路径临摹概念图                          | 不能保证像素级一致；渐变、抗锯齿和曲线都会由浏览器重新计算    |
| 可见像素硬切成头、腿、身体、尾巴               | 静态可做到 0 diff，但动起来会露缝，视觉上像被分裂             |
| 用单张站立图强行做 walk/sniff 大动作           | 缺少被遮住的隐藏区域和关节重叠，动作幅度越大破绽越明显        |
| 直接嵌入整张 PNG，不分层                       | 静态一致但不可控，无法独立眨眼、尾部柔动或接入 reduced motion |
| 引入 Spine/Live2D/AE 级运行时                  | 现阶段只是输入栏小 mascot，运行时和资产管线成本过高           |
| **SVG 容器 + 完整基准位图 + soft overlay rig** | 采纳                                                          |

## Implementation Guardrails

- 静态像素一致性只以无动画的 exact SVG 在原始尺寸下比对。任意缩放后的抗锯齿差异不作为 0 diff 合同。
- 动画层必须是 additive/overlay，不允许移动、裁切或隐藏完整基准层来制造动作。
- 常驻动效幅度要小：整体位移控制在数 px 内，旋转控制在低角度内，避免吸引过多注意力。
- 所有动画必须支持 `prefers-reduced-motion: reduce`；如应用已有 `q-minimal` 或类似低动效模式，也必须禁用 mascot 动画。
- 输入栏版本必须是透明 cutout，不得把概念图白底放进 composer 上沿。
- SVG 里的层命名应稳定，例如 `complete-reference`、`tail-soft-echo`、`blink-overlay`、`soft-breath-overlay`、`soft-shadow-pulse`，便于后续 CSS/React 接线。
- 默认交互行为为装饰性：`aria-hidden="true"`、`focusable="false"`、`pointer-events: none`。
- 合入前需要截图验证：静态 exact SVG vs 原裁剪 0 diff；输入栏小尺寸无白底矩形；动效关键帧无明显裂缝；reduced motion 下停止动画。

## Consequences

### 接受

- SVG 文件体积会包含 raster 数据，不会像纯路径 SVG 那样极小。
- 这不是无限缩放的品牌 vector；大幅放大时仍然受原始位图分辨率限制。
- 当前策略只适合轻量常驻生命感，不适合完整骨骼行走循环。

### 获得

- 静态视觉身份稳定，可做到概念图原样还原。
- 动态状态不会出现硬切 rig 的断裂问题。
- React/CSS 集成简单，可以按状态切换 idle/working/reduced-motion。
- 后续可以用 pose sprite 扩展一组动作，而不污染当前首页 mascot 的像素基准。

## Reconsider When

- 我们拿到真正的分层源文件，例如 PSD、Live2D ArtMesh、Spine 项目或含隐藏重叠区域的逐层 PNG。
- 首页 mascot 需要从“轻量常驻动效”升级为“明显行走、跳跃、嗅闻”等大动作。
- Electron/Chromium 对 SVG filter 或 embedded image 的性能、渲染一致性在目标机器上出现问题。
- 品牌系统要求所有 mascot 资产必须是纯矢量、可无限缩放。
- 输入栏常驻动效被用户反馈为干扰，需要降级为 hover/working-only 动效。

## References

- [Spine: How to cut your assets for animation](https://en.esotericsoftware.com/blog/How-to-cut-your-assets-for-animation)
- [Live2D Cubism: About ArtMeshes](https://docs.live2d.com/en/cubism-editor-manual/concept-of-artmesh/)
- [Adobe After Effects: Animating with Puppet tools](https://helpx.adobe.com/after-effects/using/animating-puppet-tools.html)
- [MDN: SVG `<image>`](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/image)
- [MDN: SVG `<animateTransform>`](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/animateTransform)
- [MDN: SVG `<feDisplacementMap>`](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feDisplacementMap)
- [MDN: SVG `<clipPath>`](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/clipPath)
