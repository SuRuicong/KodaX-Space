// Markdown 渲染封装。
//
// 选 react-markdown 而不是手撸 / markdown-it：
//   - 与 React 集成原生，节点级注入安全（不走 dangerouslySetInnerHTML）
//   - rehype-highlight 一行接入语法高亮，subset 可控（不要把 150+ 语言全打进 bundle）
//   - remark-gfm 加表格 / 删除线 / task list，覆盖 LLM 常见输出格式
//
// CSP 兼容：rehype-highlight 通过 <span class="hljs-..."> 注入 class，不需要 inline style。
// 配套的 highlight.js CSS 主题在 styles.css 全局引入。

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface MarkdownProps {
  readonly content: string;
}

export function Markdown({ content }: MarkdownProps): JSX.Element {
  // 注：不用 tailwindcss/typography 的 prose class——本仓库未装 @tailwindcss/typography。
  // 每个 element 用 components 里的覆盖样式手动控制（保证 zinc-950 暗色配色一致）。
  return (
    <div className="markdown-body text-zinc-100 leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          // 代码块外壳：加 copy 按钮 + 横向滚动
          pre: ({ children }) => (
            <pre className="relative bg-zinc-950 border border-zinc-800 rounded-md p-3 overflow-x-auto text-xs">
              {children}
            </pre>
          ),
          // 行内 code：单独样式，区别于代码块
          code: ({ className, children, ...props }) => {
            const isBlock = (className ?? '').startsWith('language-');
            if (isBlock) {
              // 这里走 pre 包裹路径——hljs 注入的 class 通过 className 透传
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="bg-zinc-800 text-amber-300 px-1 py-0.5 rounded text-[11px] font-mono">
                {children}
              </code>
            );
          },
          a: ({ children, href, ...props }) => (
            // 链接：renderer 端通过 will-navigate + setWindowOpenHandler 走 shell.openExternal，
            // 这里只负责样式。具体安全策略见 main.ts。
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 underline hover:text-blue-300"
            >
              {children}
            </a>
          ),
          p: ({ children }) => <p className="my-1.5 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc list-inside my-1.5 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal list-inside my-1.5 space-y-0.5">{children}</ol>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-zinc-700 pl-3 my-2 text-zinc-400 italic">
              {children}
            </blockquote>
          ),
          h1: ({ children }) => <h1 className="text-base font-semibold mt-3 mb-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-semibold mt-2 mb-1">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-medium mt-2 mb-1">{children}</h3>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
