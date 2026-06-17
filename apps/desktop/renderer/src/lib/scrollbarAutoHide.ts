// Overlay 自动隐藏滚动条控制器 —— macOS / Linear 式「滚才浮现、停就隐去」。
//
// 分工：
//   - 视觉在 styles.css：::-webkit-scrollbar-thumb 静止全透明，
//     [data-scrolling="true"] 或 hover 滚动条 gutter 时才浮现，空闲后淡出。
//   - 行为在这里：任意原生滚动容器产生 scroll 事件 → 打 data-scrolling=true，
//     空闲 IDLE_MS 后移除属性，CSS 过渡负责淡入淡出。
//
// scroll 事件不冒泡，必须用 capture 在 document 层统一收，一处覆盖全部滚动容器
// （侧栏 / dashboard / 对话流 / 文件树 / 终端 viewport …），新增容器零接入成本。

const IDLE_MS = 700;

// 每个滚动容器一个空闲计时器；WeakMap 让容器卸载后自动回收，不泄漏。
const timers = new WeakMap<Element, number>();

function resolveScrollEl(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target;
  // document / window 级滚动的事件 target 是 document，落到 documentElement。
  if (target === document || target === window) return document.documentElement;
  return null;
}

function onScroll(e: Event): void {
  const el = resolveScrollEl(e.target);
  if (!el) return;

  el.setAttribute('data-scrolling', 'true');

  const prev = timers.get(el);
  if (prev !== undefined) window.clearTimeout(prev);

  const id = window.setTimeout(() => {
    el.removeAttribute('data-scrolling');
    timers.delete(el);
  }, IDLE_MS);
  timers.set(el, id);
}

let installed = false;

/**
 * 全局安装一次（在 renderer bootstrap 调用）。幂等。
 * passive: 不阻塞滚动主线程；capture: scroll 不冒泡，靠捕获阶段统一拦截。
 */
export function installScrollbarAutoHide(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
}
