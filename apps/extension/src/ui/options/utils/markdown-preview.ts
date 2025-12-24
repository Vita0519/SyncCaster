/**
 * Markdown 实时预览渲染器
 * 
 * 功能特性：
 * - 标准 Markdown 语法支持（GFM）
 * - 斜体文本支持（*text* 和 _text_）
 * - 嵌套列表正确渲染
 * - 行内数学公式 $...$ 和块级公式 $$...$$
 * - Mermaid 图表渲染
 * - 代码高亮
 * - 任务列表
 */

import { marked, type RendererExtension, type TokenizerExtension, type Tokens } from 'marked';
import hljs from 'highlight.js';
import katex from 'katex';
import mermaid from 'mermaid';

import 'highlight.js/styles/github.css';
import 'katex/dist/katex.min.css';

let configured = false;
let mermaidInitialized = false;
let mermaidIdCounter = 0;

function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 初始化 Mermaid
 */
function initMermaid() {
  if (mermaidInitialized) return;
  try {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      fontFamily: 'inherit',
    });
    mermaidInitialized = true;
  } catch {
    // Mermaid 初始化失败，静默处理
  }
}

/**
 * 渲染 Mermaid 图表（异步）
 */
async function renderMermaidAsync(code: string, id: string): Promise<string> {
  try {
    initMermaid();
    const { svg } = await mermaid.render(id, code);
    return svg;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    return `<div class="mermaid-error">Mermaid 渲染失败: ${escapeHtml(errMsg)}</div>`;
  }
}

function ensureConfigured() {
  if (configured) return;

  // 数学公式块 tokenizer
  const mathBlock: TokenizerExtension = {
    name: 'mathBlock',
    level: 'block',
    start(src) {
      const index = src.indexOf('$$');
      return index >= 0 ? index : undefined;
    },
    tokenizer(src) {
      const match = /^\$\$([\s\S]+?)\$\$(?:\n|$)/.exec(src);
      if (!match) return;
      return {
        type: 'mathBlock',
        raw: match[0],
        text: match[1].trim(),
      };
    },
  };

  // 行内数学公式 tokenizer - 改进版，正确处理边界
  const mathInline: TokenizerExtension = {
    name: 'mathInline',
    level: 'inline',
    start(src) {
      // 查找第一个 $ 符号（但不是 $$）
      for (let i = 0; i < src.length; i++) {
        if (src[i] === '$') {
          // 跳过 $$
          if (src[i + 1] === '$') {
            i++;
            continue;
          }
          // 确保不是转义的 $
          if (i === 0 || src[i - 1] !== '\\') {
            return i;
          }
        }
      }
      return undefined;
    },
    tokenizer(src) {
      // 跳过 $$ 开头（块级公式）
      if (src.startsWith('$$')) return;
      
      // 匹配 $...$ 格式的行内公式
      // 改进正则：允许公式内容包含空格，但不允许换行，且结尾 $ 后不能紧跟数字
      const match = /^\$([^\n$]+?)\$(?!\d)/.exec(src);
      if (!match) return;
      
      // 确保公式内容不为空且不全是空格
      const content = match[1];
      if (!content || !content.trim()) return;
      
      return {
        type: 'mathInline',
        raw: match[0],
        text: content.trim(),
      };
    },
  };

  // 数学公式块渲染器
  const mathBlockRenderer: RendererExtension = {
    name: 'mathBlock',
    renderer(token) {
      const text = String((token as unknown as { text: string }).text ?? '');
      try {
        return `<div class="md-math md-math-block">${katex.renderToString(text, { displayMode: true, throwOnError: false })}</div>`;
      } catch {
        return `<div class="md-math md-math-block md-math-error">${escapeHtml(text)}</div>`;
      }
    },
  };

  // 行内数学公式渲染器
  const mathInlineRenderer: RendererExtension = {
    name: 'mathInline',
    renderer(token) {
      const text = String((token as unknown as { text: string }).text ?? '');
      try {
        return `<span class="md-math md-math-inline">${katex.renderToString(text, { displayMode: false, throwOnError: false })}</span>`;
      } catch {
        return `<span class="md-math md-math-inline md-math-error">${escapeHtml(text)}</span>`;
      }
    },
  };

  const renderer = new marked.Renderer();
  
  // 表格包装器
  const originalTable = renderer.table;
  renderer.table = function (token) {
    return `<div class="md-table-wrap">${originalTable.call(this, token)}</div>`;
  };

  // 代码块渲染器 - 支持 Mermaid
  renderer.code = function ({ text, lang }) {
    const source = text ?? '';
    const language = (lang || '').toLowerCase().trim();

    // Mermaid 代码块特殊处理
    if (language === 'mermaid') {
      const mermaidId = `mermaid-${++mermaidIdCounter}`;
      // 返回占位符，稍后异步渲染
      return `<div class="md-mermaid" data-mermaid-id="${mermaidId}" data-mermaid-code="${escapeHtml(source)}"><pre class="mermaid-source"><code>${escapeHtml(source)}</code></pre><div class="mermaid-loading">图表加载中...</div></div>`;
    }

    const langForHighlight = lang && hljs.getLanguage(lang) ? lang : 'plaintext';

    let highlighted = escapeHtml(source);
    try {
      highlighted =
        langForHighlight === 'plaintext'
          ? hljs.highlightAuto(source).value
          : hljs.highlight(source, { language: langForHighlight }).value;
    } catch {
      // fallback to escaped source
    }

    return `<pre class="hljs md-code-block"><code class="hljs language-${langForHighlight}">${highlighted}</code></pre>`;
  };

  // 列表渲染器 - 确保正确处理嵌套
  renderer.list = function (token: Tokens.List) {
    const tag = token.ordered ? 'ol' : 'ul';
    const startAttr = token.ordered && token.start !== 1 ? ` start="${token.start}"` : '';
    
    let body = '';
    for (const item of token.items) {
      body += this.listitem(item);
    }
    
    return `<${tag}${startAttr}>\n${body}</${tag}>\n`;
  };

  // 列表项渲染器 - 支持任务列表和嵌套
  // 注意：marked GFM 模式会自动在 text 中插入 checkbox HTML，
  // 所以这里不需要手动添加 checkbox，只需正确处理 tokens
  renderer.listitem = function (item: Tokens.ListItem) {
    let content = '';
    
    // 递归处理子 tokens（包括嵌套列表）
    if (item.tokens && item.tokens.length > 0) {
      for (const token of item.tokens) {
        if (token.type === 'text') {
          // 处理文本 token，可能包含内联元素（如斜体、粗体等）
          const textToken = token as Tokens.Text;
          if (textToken.tokens && textToken.tokens.length > 0) {
            content += this.parser.parseInline(textToken.tokens);
          } else {
            // 没有子 tokens 时，需要重新解析以处理内联格式（如 _斜体_）
            content += this.parser.parseInline(marked.Lexer.lexInline(textToken.text));
          }
        } else if (token.type === 'list') {
          // 嵌套列表
          content += this.list(token as Tokens.List);
        } else if (token.type === 'paragraph') {
          // 段落（松散列表）
          content += this.parser.parseInline((token as Tokens.Paragraph).tokens);
        } else {
          // 其他类型，使用 parser 处理
          content += this.parser.parse([token]);
        }
      }
    }
    
    const className = item.task ? ' class="task-list-item"' : '';
    return `<li${className}>${content}</li>\n`;
  };

  // 使用扩展
  const originalEmStrong = marked.Tokenizer.prototype.emStrong;

  marked.use({
    tokenizer: {
      emStrong(src: string, maskedSrc: string, prevChar?: string) {
        const token = originalEmStrong.call(this as any, src, maskedSrc, prevChar);
        if (token) return token;

        // Fix: allow `_text_` emphasis after non-ASCII chars (e.g. Chinese)
        if (!src.startsWith('_') || src.startsWith('__')) return;
        if (!prevChar || prevChar.charCodeAt(0) <= 0x7f) return;

        const match = /^_([^\s_](?:[^\n]*?[^\s_])?)_/.exec(src);
        if (!match) return;

        const nextChar = src[match[0].length];
        if (nextChar && /[A-Za-z0-9_]/.test(nextChar)) return;

        return {
          type: 'em',
          raw: match[0],
          text: match[1],
          tokens: (this as any).lexer.inlineTokens(match[1]),
        } as Tokens.Em;
      },
    },
    extensions: [mathBlock, mathInline, mathBlockRenderer, mathInlineRenderer],
  });
  
  marked.setOptions({
    gfm: true,
    breaks: true,
    pedantic: false,
    renderer,
  });

  configured = true;
}

/**
 * 渲染 Markdown 预览（同步）
 */
export function renderMarkdownPreview(markdown: string): string {
  ensureConfigured();
  return marked.parse(markdown, { async: false }) as string;
}

/**
 * 渲染 Markdown 预览并处理 Mermaid 图表（异步）
 * 返回 HTML 后，需要调用 processMermaidInContainer 来渲染图表
 */
export async function renderMarkdownPreviewAsync(markdown: string): Promise<string> {
  ensureConfigured();
  const html = marked.parse(markdown, { async: false }) as string;
  return html;
}

/**
 * 处理容器中的 Mermaid 图表
 * 在 DOM 更新后调用此函数来渲染 Mermaid 图表
 */
export async function processMermaidInContainer(container: HTMLElement): Promise<void> {
  const mermaidElements = container.querySelectorAll('.md-mermaid[data-mermaid-code]');
  
  for (const el of mermaidElements) {
    const code = el.getAttribute('data-mermaid-code');
    const id = el.getAttribute('data-mermaid-id');
    
    if (!code || !id) continue;
    
    // 检查是否已渲染
    if (el.querySelector('.mermaid-rendered')) continue;
    
    try {
      const svg = await renderMermaidAsync(code, id);
      const renderedDiv = document.createElement('div');
      renderedDiv.className = 'mermaid-rendered';
      renderedDiv.innerHTML = svg;
      
      // 隐藏源码和加载提示
      const source = el.querySelector('.mermaid-source');
      const loading = el.querySelector('.mermaid-loading');
      if (source) (source as HTMLElement).style.display = 'none';
      if (loading) (loading as HTMLElement).style.display = 'none';
      
      el.appendChild(renderedDiv);
    } catch {
      const loading = el.querySelector('.mermaid-loading');
      if (loading) {
        loading.textContent = 'Mermaid 渲染失败';
        loading.classList.add('mermaid-error');
      }
    }
  }
}

/**
 * 重置 Mermaid ID 计数器（用于测试）
 */
export function resetMermaidIdCounter(): void {
  mermaidIdCounter = 0;
}
