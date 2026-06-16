// GlassAurora — F060 背景柔光层（Liquid Glass）
//
//   - minimal  → 不渲染，零开销。
//   - balanced/full → 极淡柔光：2 团大而慢的高斯模糊色斑漂移（仅 transform 动画，无 WebGL）。
//
// 立体感不在背景，而在玻璃面板本身（光向描边 + 光标 specular + 分层柔影，见 styles.css）。
// 背景只提供克制的环境光，遵循 visionOS「别堆叠花哨元素、保持简洁」。

import { useAppStore } from '../store/appStore.js';

export function GlassAurora(): JSX.Element | null {
  const quality = useAppStore((s) => s.visualQuality);
  if (quality === 'minimal') return null;

  return (
    <div className="aurora-layer" aria-hidden>
      <div className="aurora-blob aurora-b1" />
      <div className="aurora-blob aurora-b2" />
    </div>
  );
}
