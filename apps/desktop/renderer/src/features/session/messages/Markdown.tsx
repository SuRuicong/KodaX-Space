// Markdown 渲染封装。
//
// 选 react-markdown 而不是手撸 / markdown-it：
//   - 与 React 集成原生，节点级注入安全（不走 dangerouslySetInnerHTML）
//   - rehype-highlight 一行接入语法高亮，subset 可控（不要把 150+ 语言全打进 bundle）
//   - remark-gfm 加表格 / 删除线 / task list，覆盖 LLM 常见输出格式
//
// **2026-05 排版升级**：原 alpha.1 版本 `list-inside` + 全 text-sm heading 导致:
//   - 嵌套 list 不缩进 (`<ul><li>foo<ul><li>bar` 渲染成两条同高 bullet,失去层级感)
//   - H1/H2/H3 全 14-16px,跟正文没有视觉差异,长文档结构全平
//   - 段落间距太挤,长 prose 看上去像一块墙
// 重写为标准排版规则: list 用 outside + pl,heading 阶梯放大,p 加呼吸,补 hr/strong/em/table。
//
// CSP 兼容：rehype-highlight 通过 <span class="hljs-..."> 注入 class，不需要 inline style。
// 配套的 highlight.js CSS 主题在 styles.css 全局引入。

import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface MarkdownProps {
  readonly content: string;
}

export function Markdown({ content }: MarkdownProps): JSX.Element {
  // 注：不用 tailwindcss/typography 的 prose class——本仓库未装 @tailwindcss/typography。
  // 每个 element 用 components 里的覆盖样式手动控制。
  // 全 zinc-100 文字 + styles.css light-override 自动翻成深色,亮暗双主题都吃得下。
  return (
    <div className="markdown-body text-zinc-100 leading-relaxed text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          // ---- 代码 ----
          pre: ({ children }) => (
            <pre className="relative bg-zinc-950 border border-zinc-800 rounded-md p-3 my-2.5 overflow-x-auto text-xs leading-relaxed">
              {children}
            </pre>
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = (className ?? '').startsWith('language-');
            if (isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="bg-zinc-800 text-amber-300 px-1 py-0.5 rounded text-[12px] font-mono">
                {children}
              </code>
            );
          },

          // ---- 链接 ----
          a: ({ children, href, ...props }) => (
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 underline decoration-blue-400/40 underline-offset-2"
            >
              {children}
            </a>
          ),

          // ---- 段落 + 排版 ----
          // my-2 让段落之间有"呼吸"，单段也不会太紧贴边。
          p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
          // hr 给一条淡线分隔大块,跟段落 my-2 协调
          hr: () => <hr className="my-4 border-t border-zinc-800" />,
          strong: ({ children }) => <strong className="font-semibold text-zinc-50">{children}</strong>,
          em: ({ children }) => <em className="italic text-zinc-200">{children}</em>,
          del: ({ children }) => <del className="text-zinc-500 line-through">{children}</del>,

          // ---- 列表 ----
          // list-outside + pl-5: bullet 在文字左侧外,文字保持对齐;嵌套 ul/ol 通过 ml-* 自动二级缩进
          // marker 用 zinc-500 让 bullet 弱化,文字才是主角
          ul: ({ children }) => (
            <ul className="my-2 ml-5 list-disc list-outside space-y-1 marker:text-zinc-500">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 ml-5 list-decimal list-outside space-y-1 marker:text-zinc-500">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="pl-1 leading-relaxed">{children}</li>,

          // ---- 引用 ----
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-zinc-700 pl-3 text-zinc-400 italic [&>p]:my-1.5">
              {children}
            </blockquote>
          ),

          // ---- 标题阶梯 ----
          // H1 ~ H4 用明显的字号阶梯,LLM 输出"## Steps" "### Phase 1" 时一眼能看出层级
          h1: ({ children }) => (
            <h1 className="mt-4 mb-2 text-xl font-semibold text-zinc-50 border-b border-zinc-800 pb-1">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-4 mb-2 text-lg font-semibold text-zinc-50">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3 mb-1.5 text-base font-semibold text-zinc-100">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mt-3 mb-1 text-sm font-semibold text-zinc-100">{children}</h4>
          ),
          h5: ({ children }) => (
            <h5 className="mt-2 mb-1 text-sm font-medium text-zinc-200">{children}</h5>
          ),
          h6: ({ children }) => (
            <h6 className="mt-2 mb-1 text-xs font-medium text-zinc-300 uppercase tracking-wider">
              {children}
            </h6>
          ),

          // ---- GFM Table ----
          // remark-gfm 把 | a | b | 解析成 table;这里给 cell border + zebra stripe 让数据可读
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-md border border-zinc-800">
              <table className="w-full text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-zinc-900 text-zinc-300 text-[11px] uppercase tracking-wider">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-zinc-800">{children}</tbody>
          ),
          tr: ({ children }) => <tr>{children}</tr>,
          th: ({ children }) => (
            <th className="px-2.5 py-1.5 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="px-2.5 py-1.5 align-top">{children as ReactNode}</td>
          ),

          // ---- GFM task list (实际由 li 渲染,但 checkbox 单独定制让对齐更好) ----
          input: ({ type, checked, disabled, ...rest }) => {
            if (type === 'checkbox') {
              return (
                <input
                  type="checkbox"
                  checked={!!checked}
                  disabled={disabled ?? true}
                  readOnly
                  className="mr-2 align-middle accent-emerald-500"
                  {...rest}
                />
              );
            }
            return <input type={type} {...rest} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
