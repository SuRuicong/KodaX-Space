# KodaX Manta Pulse：SVG + TUI 资源包

这是一套可直接编辑、嵌入和运行的源文件，不是位图描摹。标识采用「蝠鲼 / Manta」方向：宽翼代表跨环境与多 Provider 协作，中央四芒核心代表聚焦推理，纵向脊线与尾迹代表任务从意图到结果的连续流动。

## 目录

### `svg/` 静态标识

- `kodax-manta-mark.svg`：主彩色标识，透明背景。
- `kodax-manta-mark-mono.svg`：单色填充版，内联时支持 `currentColor`。
- `kodax-manta-mark-monoline.svg`：极简线框版，适合小尺寸、状态栏和雕刻。
- `kodax-manta-app-icon.svg`：512×512 圆角应用图标。
- `kodax-manta-favicon.svg`：64×64 简化版。
- `kodax-manta-symbols.svg`：可通过 `<use>` 使用的 SVG symbol 集合。

### `svg/motion/` 动态 SVG

每个状态均为独立 SVG，可直接用 `<img>`、`<object>` 或内联 SVG 展示：

- `idle`：呼吸、轻摆与水波。
- `thinking`：核心聚焦与轨道节点。
- `scan`：声呐扫描。
- `streaming`：流式输出。
- `tool`：工具调用火花。
- `agents`：多 Agent 分裂 / 汇合。
- `success`：完成闪耀。
- `warning`：琥珀脉冲。
- `error`：红色故障与恢复反馈。

示例：

```html
<img
  src="/brand/kodax-manta-kit/svg/motion/kodax-manta-thinking.svg"
  width="96"
  alt="KodaX 正在思考"
/>
```

双击打开 `web/motion-gallery.html`，可以一次查看全部动态状态。动态 SVG 内置 `prefers-reduced-motion` 降级。

## TUI 文件

### 零依赖终端演示

```bash
node tui/manta-ansi-demo.mjs --state cycle --unicode --label
node tui/manta-ansi-demo.mjs --state thinking --ascii
node tui/manta-ansi-demo.mjs --state tool --compact
node tui/manta-ansi-demo.mjs --state success --once --no-color
```

支持：

- ASCII 与 Unicode 两套字符。
- 完整版和 compact 版。
- truecolor、256 色和 16 色终端。
- `NO_COLOR` 环境变量。
- `idle / loading / active / thinking / tool / agents / success / warning / error` 状态。

### Ink / React 组件

`KodaXManta.tsx` 可直接放入 KodaX 的 Ink REPL：

```tsx
import {KodaXManta} from './KodaXManta.js';

<KodaXManta
  state="thinking"
  charset="ascii"
  compact={false}
  showLabel
/>
```

`manta-frames.ts` 是类型化帧生成器；`manta-frames.mjs` 是无需构建即可运行的同等版本。设置 `KODAX_REDUCED_MOTION=1` 可停止 Ink 动画。

## 建议的状态映射

| KodaX 事件 | 动画状态 |
|---|---|
| 空闲 / 就绪 | `idle` |
| 等待模型响应 | `loading` |
| 流式 Token 输出 | `active` / `streaming` |
| 推理或规划 | `thinking` |
| 执行工具 | `tool` |
| 子任务或 Agent Team | `agents` |
| 完成 | `success` |
| 权限提示或可恢复问题 | `warning` |
| 硬错误 | `error` |

## 生产建议

- 16–24 px 场景优先使用 `favicon.svg` 或 `mark-monoline.svg`。
- Dock / Taskbar 使用 `app-icon.svg`，普通页面保持透明背景。
- 完成、警告、错误动画在演示文件中循环；正式 UI 中建议将强调动画设为单次播放。
- SVG 使用标准路径和 CSS 动画，可继续在 Figma、Illustrator、Inkscape 或代码中调整。
