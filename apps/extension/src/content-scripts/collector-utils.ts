/**
 * 内容采集工具函数
 * 提供公式提取、图片归一化、DOM清洗等核心功能
 */

// ========== 类型定义 ==========
export interface CollectedImage {
  type: 'image';
  url: string;
  alt?: string;
  title?: string;
  width?: number;
  height?: number;
  source?: 'img' | 'picture' | 'noscript' | 'background';
}

export interface CollectedFormula {
  type: 'formula';
  latex: string;
  display: boolean;
  engine: 'katex' | 'mathjax2' | 'mathjax3' | 'mathml' | 'unknown';
  originalFormat?: string;
}

export interface CollectedMermaid {
  type: 'mermaid';
  code: string;
  diagramType?: string;
}

export interface ContentMetrics {
  images: number;
  formulas: number;
  tables: number;
  codeBlocks: number;
  mermaidBlocks: number;
  textLen: number;
}

export interface QualityCheck {
  pass: boolean;
  reason?: string;
  initialMetrics: ContentMetrics;
  finalMetrics: ContentMetrics;
  lossRatio: { images: number; formulas: number; tables: number; mermaid: number };
}

// ========== 质量指标计算 ==========
export function computeMetrics(html: string): ContentMetrics {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return {
    images: tmp.querySelectorAll('img, picture').length,
    formulas: tmp.querySelectorAll('.katex, mjx-container, math, [data-sync-math]').length,
    tables: tmp.querySelectorAll('table').length,
    codeBlocks: tmp.querySelectorAll('pre > code, pre[class*="language-"]').length,
    mermaidBlocks: tmp.querySelectorAll('.mermaid, [data-mermaid], pre code.language-mermaid').length,
    textLen: (tmp.textContent || '').trim().length,
  };
}

// ========== 公式提取辅助函数 ==========

/**
 * 从 KaTeX 节点提取原始 LaTeX
 * 关键：MathML 元素在不同命名空间，querySelector 可能无法匹配
 * 解决方案：使用 XMLSerializer 序列化原始 MathML，保留 annotation 标签
 */
function extractKatexTex(node: Element): string | null {
  const mathml = node.querySelector('.katex-mathml');
  if (!mathml) {
    console.log('[math] No .katex-mathml found');
    return null;
  }
  
  // 核心方法：使用 XMLSerializer 序列化原始 MathML
  // 这是最可靠的方法，因为 innerHTML/outerHTML 可能会丢失 MathML 命名空间内容
  try {
    const serializer = new XMLSerializer();
    const serialized = serializer.serializeToString(mathml);
    console.log('[math] Serialized MathML length:', serialized.length);
    
    // 调试：打印序列化内容的一部分，帮助分析格式
    if (serialized.length < 500) {
      console.log('[math] Serialized MathML:', serialized);
    } else {
      console.log('[math] Serialized MathML (first 300):', serialized.substring(0, 300));
      // 检查是否包含 annotation
      const annotationIdx = serialized.toLowerCase().indexOf('annotation');
      if (annotationIdx >= 0) {
        console.log('[math] Found annotation at:', annotationIdx, serialized.substring(annotationIdx, annotationIdx + 200));
      } else {
        console.log('[math] No annotation tag found in serialized MathML');
      }
    }
    
    // 从序列化的 XML 中提取 annotation（支持多种格式）
    // 格式1: <annotation encoding="application/x-tex">...</annotation>
    // 格式2: <m:annotation encoding="application/x-tex">...</m:annotation>
    // 格式3: <annotation>...</annotation> (无 encoding)
    // 格式4: <semantics>...<annotation>...</annotation></semantics>
    
    const annotationPatterns = [
      // 带命名空间前缀和 encoding
      /<(?:m:|math:)?annotation[^>]*encoding=["']application\/x-tex["'][^>]*>([\s\S]*?)<\/(?:m:|math:)?annotation>/i,
      // 不带命名空间但有 encoding
      /<annotation[^>]*encoding=["'][^"']*tex[^"']*["'][^>]*>([\s\S]*?)<\/annotation>/i,
      // 任何 annotation 标签
      /<(?:m:|math:)?annotation[^>]*>([\s\S]*?)<\/(?:m:|math:)?annotation>/i,
    ];
    
    for (const pattern of annotationPatterns) {
      const match = serialized.match(pattern);
      if (match && match[1]) {
        const tex = decodeHtmlEntities(match[1].trim());
        // 验证提取的内容看起来像 LaTeX
        if (tex && tex.length > 0 && /[a-zA-Z\\{}_^=]/.test(tex)) {
          console.log('[math] Found LaTeX via XMLSerializer pattern:', tex.substring(0, 80));
          return tex;
        }
      }
    }
  } catch (e) {
    console.log('[math] XMLSerializer failed:', e);
  }
  
  // 方法2：直接用 querySelector 获取 annotation
  const annotationSelectors = [
    'annotation[encoding="application/x-tex"]',
    'annotation',
  ];
  
  for (const sel of annotationSelectors) {
    try {
      const annotation = mathml.querySelector(sel);
      if (annotation && annotation.textContent) {
        const tex = annotation.textContent.trim();
        if (tex && tex.length > 0) {
          console.log('[math] Found LaTeX via querySelector:', sel, tex.substring(0, 80));
          return tex;
        }
      }
    } catch (e) {
      // 选择器可能不支持
    }
  }
  
  // 方法3：从 outerHTML 用正则提取
  const outerHtml = mathml.outerHTML || '';
  if (outerHtml) {
    const match = outerHtml.match(/<annotation[^>]*encoding=["']application\/x-tex["'][^>]*>([\s\S]*?)<\/annotation>/i);
    if (match && match[1]) {
      const tex = decodeHtmlEntities(match[1].trim());
      console.log('[math] Found LaTeX via outerHTML:', tex.substring(0, 80));
      return tex;
    }
  }
  
  // 方法4：遍历所有子元素查找 annotation（处理命名空间问题）
  const allElements = mathml.getElementsByTagName('*');
  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i];
    if (el.localName === 'annotation' || el.tagName.toLowerCase().endsWith(':annotation')) {
      const encoding = el.getAttribute('encoding') || '';
      if (encoding.includes('tex') || !encoding) {
        const tex = el.textContent?.trim();
        if (tex && tex.length > 0 && /[a-zA-Z\\{}_^]/.test(tex)) {
          console.log('[math] Found LaTeX via getElementsByTagName:', tex.substring(0, 80));
          return tex;
        }
      }
    }
  }
  
  console.log('[math] No annotation found, falling back to textContent extraction');
  
  // 方法5：从 textContent 提取（最后手段）
  // KaTeX 的 textContent 格式：渲染文本 + LaTeX 文本（拼接在一起）
  const text = mathml.textContent || '';
  console.log('[math] textContent fallback:', text.substring(0, 100));
  if (text) {
    const tex = extractLatexFromCsdnText(text);
    if (tex) {
      console.log('[math] Extracted LaTeX (special char):', tex.substring(0, 80));
      return tex;
    }
  }
  
  // 方法6：从 data 属性提取
  const dataTex = node.getAttribute('data-tex') || node.getAttribute('data-latex');
  if (dataTex && dataTex.trim()) {
    console.log('[math] Found LaTeX via data attr');
    return dataTex.trim();
  }
  
  console.log('[math] No LaTeX found in node:', node.className);
  return null;
}

/**
 * 从 CSDN 的 katex-mathml textContent 提取 LaTeX
 * 
 * KaTeX 的 textContent 格式分析：
 * - MathML 部分：渲染后的可读文本（如 "E=mc2", "dDetectGPT(x)=..."）
 * - annotation 部分：原始 LaTeX（如 "E=mc^2", "d_{\text{DetectGPT}}..."）
 * - 合并后：渲染文本 + LaTeX 文本（两者拼接在一起）
 * 
 * 核心策略：
 * 1. 对于简单公式（如 E=mc^2）：textContent = "E=mc2E=mc^2"
 *    - 前半部分是渲染文本（无特殊字符）
 *    - 后半部分是 LaTeX（有 ^ _ {} \ 等特殊字符）
 * 2. 关键：找到 LaTeX 的起始位置，而不是只找第一个特殊字符
 */
function extractLatexFromCsdnText(rawText: string): string | null {
  if (!rawText || rawText.length === 0) return null;
  
  // 清理空白字符（换行、多余空格等）
  const text = rawText.replace(/\s+/g, '').trim();
  if (!text) return null;
  
  console.log('[math] CSDN text after cleanup:', text, 'len:', text.length);
  
  const len = text.length;
  
  // 情况1：简单公式（无特殊字符），格式为 "渲染文本 + LaTeX"（完全重复）
  // 例如 "dd" -> "d", "xx" -> "x", "αα" -> "α"
  if (len >= 2 && len % 2 === 0) {
    const half = len / 2;
    const firstHalf = text.substring(0, half);
    const secondHalf = text.substring(half);
    if (firstHalf === secondHalf) {
      console.log('[math] Simple formula detected (repeated text):', secondHalf);
      return secondHalf;
    }
  }
  
  // 情况2：包含 LaTeX 特殊字符的公式
  // 策略：找到渲染文本和 LaTeX 的分界点
  // 渲染文本不包含 LaTeX 特殊字符（_ { } ^ \），LaTeX 包含这些字符
  const latexSpecialChars = /[_{}\\^]/;
  
  // 找到第一个 LaTeX 特殊字符的位置
  let firstSpecialIdx = -1;
  for (let i = 0; i < text.length; i++) {
    if (latexSpecialChars.test(text[i])) {
      firstSpecialIdx = i;
      break;
    }
  }
  
  console.log('[math] firstSpecialIdx:', firstSpecialIdx, 'char:', text[firstSpecialIdx]);
  
  if (firstSpecialIdx > 0) {
    // 渲染文本在特殊字符之前
    // 但 LaTeX 的起始位置可能在特殊字符之前（因为 LaTeX 开头可能是普通字符）
    // 
    // 例如：textContent = "E=mc2E=mc^2"
    // - 渲染文本 = "E=mc2"
    // - LaTeX = "E=mc^2"
    // - firstSpecialIdx 指向 ^，但 LaTeX 从第二个 E 开始
    //
    // 新策略：从文本开头的字符开始，在 firstSpecialIdx 之前找到它的最后一次出现
    // 这个位置就是 LaTeX 的起始位置
    
    const startChar = text[0];
    let latexStart = -1;
    
    // 从 firstSpecialIdx 向前搜索，找到 startChar 的最后一次出现
    for (let i = firstSpecialIdx - 1; i > 0; i--) {
      if (text[i] === startChar) {
        // 验证：从这个位置开始的子串应该包含特殊字符
        const candidate = text.substring(i);
        if (latexSpecialChars.test(candidate)) {
          latexStart = i;
          console.log('[math] Found LaTeX start via startChar search:', latexStart);
          break;
        }
      }
    }
    
    // 如果没找到，尝试更复杂的前缀匹配
    if (latexStart < 0) {
      const beforeSpecial = text.substring(0, firstSpecialIdx);
      
      // 尝试不同长度的渲染前缀，找到在 beforeSpecial 中重复出现的最长前缀
      for (let prefixLen = Math.min(beforeSpecial.length - 1, 20); prefixLen >= 1; prefixLen--) {
        const prefix = beforeSpecial.substring(0, prefixLen);
        // 在 beforeSpecial 中查找 prefix 的第二次出现（从位置 prefixLen 开始搜索避免重叠）
        const secondOccurrence = beforeSpecial.indexOf(prefix, prefixLen);
        if (secondOccurrence > 0) {
          const candidate = text.substring(secondOccurrence);
          if (latexSpecialChars.test(candidate)) {
            latexStart = secondOccurrence;
            console.log('[math] Found LaTeX start via prefix match:', latexStart, 'prefix:', prefix);
            break;
          }
        }
      }
    }
    
    // 如果没找到重复前缀，使用备用策略
    if (latexStart < 0) {
      // 备用策略1：假设渲染文本和 LaTeX 长度相近
      // 在 firstSpecialIdx 附近寻找分界点
      const estimatedHalf = Math.floor(len / 2);
      
      // 在估计的中点附近搜索
      for (let offset = 0; offset <= Math.min(10, estimatedHalf); offset++) {
        for (const delta of [0, -offset, offset]) {
          const candidateStart = estimatedHalf + delta;
          if (candidateStart > 0 && candidateStart < firstSpecialIdx) {
            const candidateLatex = text.substring(candidateStart);
            const renderText = text.substring(0, candidateStart);
            
            // 验证：LaTeX 应该以渲染文本的开头字符开始
            if (candidateLatex.length > 0 && renderText.length > 0) {
              // 检查开头是否匹配（至少 1-3 个字符）
              const matchLen = Math.min(3, renderText.length, candidateLatex.length);
              if (renderText.substring(0, matchLen) === candidateLatex.substring(0, matchLen)) {
                latexStart = candidateStart;
                console.log('[math] Found LaTeX start via half-point search:', latexStart);
                break;
              }
            }
          }
        }
        if (latexStart >= 0) break;
      }
    }
    
    // 如果还是没找到，使用最后的备用策略
    if (latexStart < 0) {
      // 备用策略2：从第一个特殊字符向前扩展，找到合理的起始位置
      // 对于 "E=mc2E=mc^2"，从 ^ 向前找到第二个 E
      latexStart = firstSpecialIdx;
      
      // 向前扩展直到找到与开头相同的字符序列
      const startChar = text[0];
      for (let i = firstSpecialIdx - 1; i > 0; i--) {
        if (text[i] === startChar) {
          // 验证从这里开始是否合理
          const candidateLatex = text.substring(i);
          if (latexSpecialChars.test(candidateLatex)) {
            latexStart = i;
            console.log('[math] Found LaTeX start via startChar match:', latexStart);
            break;
          }
        }
      }
    }
    
    if (latexStart > 0) {
      const latex = text.substring(latexStart);
      console.log('[math] Extracted LaTeX (improved method):', latex.substring(0, 80));
      return latex;
    }
  }
  
  // 情况3：只有反斜杠命令，没有 _ { } ^
  if (text.includes('\\')) {
    const firstBackslash = text.indexOf('\\');
    
    // 类似的策略：找到 LaTeX 的起始位置
    const beforeBackslash = text.substring(0, firstBackslash);
    let latexStart = firstBackslash;
    
    // 尝试找到渲染文本的重复
    const startChar = text[0];
    for (let i = firstBackslash - 1; i > 0; i--) {
      if (text[i] === startChar) {
        latexStart = i;
        break;
      }
    }
    
    // 如果没找到，尝试半分
    if (latexStart === firstBackslash && beforeBackslash.length > 2) {
      const estimatedHalf = Math.floor(len / 2);
      if (estimatedHalf < firstBackslash) {
        latexStart = estimatedHalf;
      }
    }
    
    const latex = text.substring(latexStart);
    if (latex && /\\[a-zA-Z]+/.test(latex)) {
      console.log('[math] Extracted LaTeX (backslash method):', latex.substring(0, 80));
      return latex;
    }
  }
  
  // 情况4：三段式格式 "渲染1 + LaTeX + 渲染2"，其中渲染1 ≈ 渲染2
  if (len >= 3) {
    for (let prefixLen = 1; prefixLen < len / 2; prefixLen++) {
      const prefix = text.substring(0, prefixLen);
      if (text.endsWith(prefix)) {
        const middle = text.substring(prefixLen, len - prefixLen);
        if (middle && middle.length > 0) {
          console.log('[math] Three-part formula detected, middle:', middle);
          return middle;
        }
      }
    }
  }
  
  // 情况5：如果文本很短（<=3字符），可能就是简单变量
  if (len <= 3 && /^[a-zA-Z0-9\u0391-\u03C9]+$/.test(text)) {
    const result = len >= 2 ? text.substring(Math.floor(len / 2)) : text;
    console.log('[math] Short formula detected:', result);
    return result;
  }
  
  return null;
}

/**
 * 解码 HTML 实体
 */
function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

/**
 * 从 MathJax 节点提取原始 LaTeX
 */
function extractMathJaxTex(node: Element): string | null {
  // 尝试从 innerHTML 用正则提取
  const html = node.innerHTML;
  const match = html.match(/<annotation[^>]*encoding=["']application\/x-tex["'][^>]*>([\s\S]*?)<\/annotation>/i);
  if (match && match[1]) {
    return decodeHtmlEntities(match[1].trim());
  }
  
  // 尝试 querySelector
  const annotation = node.querySelector('annotation[encoding="application/x-tex"]');
  if (annotation && annotation.textContent) {
    return annotation.textContent.trim();
  }
  
  // 从 data 属性
  const dataTex = node.getAttribute('data-tex') || node.getAttribute('data-latex');
  if (dataTex && dataTex.trim()) return dataTex.trim();
  
  // 从相邻 script 提取
  const prevScript = node.previousElementSibling;
  if (prevScript && prevScript.tagName === 'SCRIPT') {
    const scriptEl = prevScript as HTMLScriptElement;
    if (scriptEl.type && scriptEl.type.startsWith('math/tex')) {
      const tex = scriptEl.textContent;
      if (tex && tex.trim()) return tex.trim();
    }
  }
  
  return null;
}

// ========== 公式 DOM 预处理（核心函数） ==========

export function normalizeMathInDom(root: HTMLElement): void {
  const doc = root.ownerDocument || document;
  const processed = new WeakSet<Element>();
  
  console.log('[math] Starting normalizeMathInDom');
  
  const DS = String.fromCharCode(36); // dollar sign
  
  const createPlaceholder = (tex: string, isDisplay: boolean): HTMLElement => {
    const wrapper = doc.createElement('span');
    wrapper.setAttribute('data-sync-math', 'true');
    wrapper.setAttribute('data-tex', tex);
    wrapper.setAttribute('data-display', String(isDisplay));
    if (isDisplay) {
      wrapper.textContent = DS + DS + tex + DS + DS;
    } else {
      wrapper.textContent = DS + tex + DS;
    }
    return wrapper;
  };
  
  // 1. KaTeX 块级公式
  const displayNodes = root.querySelectorAll('.katex-display, .katex--display');
  console.log('[math] Found display nodes:', displayNodes.length);
  
  displayNodes.forEach((node) => {
    if (processed.has(node)) return;
    processed.add(node);
    node.querySelectorAll('.katex').forEach(k => processed.add(k));
    
    const tex = extractKatexTex(node);
    if (tex) {
      console.log('[math] Replacing display formula');
      node.replaceWith(createPlaceholder(tex, true));
    }
  });
  
  // 2. KaTeX 行内公式
  const inlineNodes = root.querySelectorAll('.katex');
  console.log('[math] Found inline .katex nodes:', inlineNodes.length);
  
  inlineNodes.forEach((node) => {
    if (processed.has(node)) return;
    processed.add(node);
    
    const tex = extractKatexTex(node);
    if (tex) {
      const isDisplay = !!node.closest('.katex-display, .katex--display');
      node.replaceWith(createPlaceholder(tex, isDisplay));
    }
  });
  
  // 3. MathJax v2 script
  root.querySelectorAll('script[type*="math/tex"]').forEach((script) => {
    if (processed.has(script)) return;
    processed.add(script);
    const tex = script.textContent;
    if (tex && tex.trim()) {
      const type = script.getAttribute('type') || '';
      const isDisplay = type.includes('mode=display');
      script.replaceWith(createPlaceholder(tex.trim(), isDisplay));
    }
  });
  
  // 4. MathJax v3 mjx-container
  root.querySelectorAll('mjx-container').forEach((node) => {
    if (processed.has(node)) return;
    processed.add(node);
    const tex = extractMathJaxTex(node);
    if (tex) {
      const isDisplay = node.classList.contains('MJXc-display') || node.hasAttribute('display');
      node.replaceWith(createPlaceholder(tex, isDisplay));
    }
  });
  
  // 5. MathJax v2 渲染节点
  root.querySelectorAll('.MathJax, .MathJax_Display').forEach((node) => {
    if (processed.has(node)) return;
    processed.add(node);
    const tex = (node.getAttribute('data-tex') || node.getAttribute('data-latex') || '').trim();
    if (tex) {
      const isDisplay = node.classList.contains('MathJax_Display');
      node.replaceWith(createPlaceholder(tex, isDisplay));
    }
  });
  
  // 6. 原生 MathML - 用正则从 innerHTML 提取
  root.querySelectorAll('math').forEach((node) => {
    if (processed.has(node)) return;
    if (node.closest('[data-sync-math]')) return;
    processed.add(node);
    
    const html = node.outerHTML;
    const match = html.match(/<annotation[^>]*encoding=["']application\/x-tex["'][^>]*>([\s\S]*?)<\/annotation>/i);
    if (match && match[1]) {
      const tex = decodeHtmlEntities(match[1].trim());
      const isDisplay = node.getAttribute('display') === 'block';
      node.replaceWith(createPlaceholder(tex, isDisplay));
    }
  });
  
  console.log('[math] normalizeMathInDom completed');
}

// ========== Mermaid DOM 预处理 ==========

/**
 * 预处理 DOM 中的 Mermaid 图
 * 将渲染后的 Mermaid SVG 转换为可识别的标记
 */
export function normalizeMermaidInDom(root: HTMLElement): void {
  const doc = root.ownerDocument || document;
  const processed = new WeakSet<Element>();
  
  console.log('[mermaid] Starting normalizeMermaidInDom');
  
  const createPlaceholder = (code: string, diagramType?: string): HTMLElement => {
    const wrapper = doc.createElement('pre');
    const codeEl = doc.createElement('code');
    codeEl.className = 'language-mermaid';
    codeEl.textContent = code;
    wrapper.appendChild(codeEl);
    wrapper.setAttribute('data-sync-mermaid', 'true');
    if (diagramType) {
      wrapper.setAttribute('data-diagram-type', diagramType);
    }
    return wrapper;
  };
  
  // 1. 处理带有 mermaid 类的容器
  root.querySelectorAll('.mermaid').forEach((node) => {
    if (processed.has(node)) return;
    processed.add(node);
    
    const code = extractMermaidSourceFromElement(node);
    if (code) {
      const diagramType = detectMermaidType(code);
      console.log('[mermaid] Replacing mermaid container, type:', diagramType);
      node.replaceWith(createPlaceholder(code, diagramType));
    }
  });
  
  // 2. 处理 data-mermaid 属性的元素
  root.querySelectorAll('[data-mermaid="true"], [data-processed="true"]').forEach((node) => {
    if (processed.has(node)) return;
    if (node.classList.contains('mermaid')) return; // 已处理
    processed.add(node);
    
    const code = node.getAttribute('data-mermaid-source') || extractMermaidSourceFromElement(node);
    if (code) {
      const diagramType = detectMermaidType(code);
      node.replaceWith(createPlaceholder(code, diagramType));
    }
  });
  
  // 3. 处理特定平台的 Mermaid 容器
  const platformSelectors = [
    '.mermaid-container',
    '.markdown-mermaid',
    '.mermaid-box',
    '[data-type="mermaid"]',
  ];
  
  platformSelectors.forEach((selector) => {
    root.querySelectorAll(selector).forEach((node) => {
      if (processed.has(node)) return;
      processed.add(node);
      
      const code = extractMermaidSourceFromElement(node);
      if (code) {
        const diagramType = detectMermaidType(code);
        console.log('[mermaid] Replacing platform mermaid container:', selector);
        node.replaceWith(createPlaceholder(code, diagramType));
      }
    });
  });
  
  // 4. 处理包含 Mermaid SVG 的容器
  root.querySelectorAll('svg.mermaid, svg[id^="mermaid"]').forEach((svg) => {
    const parent = svg.parentElement;
    if (!parent || processed.has(parent)) return;
    processed.add(parent);
    
    const code = extractMermaidSourceFromSvg(svg);
    if (code) {
      const diagramType = detectMermaidType(code);
      console.log('[mermaid] Replacing SVG mermaid, type:', diagramType);
      parent.replaceWith(createPlaceholder(code, diagramType));
    }
  });
  
  console.log('[mermaid] normalizeMermaidInDom completed');
}

/**
 * 从元素提取 Mermaid 源码
 * 优先从结构化数据源提取，保留原始换行和格式
 */
function extractMermaidSourceFromElement(el: Element): string | null {
  // 1. 从 data 属性提取（最可靠，保留原始格式）
  const dataSource = el.getAttribute('data-mermaid-source') 
    || el.getAttribute('data-source')
    || el.getAttribute('data-code')
    || el.getAttribute('data-graph-code');
  if (dataSource?.trim()) {
    console.log('[mermaid] Found source via data attribute');
    return dataSource.trim();
  }
  
  // 2. 从隐藏的 pre/code 元素提取（保留换行）
  const codeEl = el.querySelector('pre.mermaid-source, code.mermaid-source, [data-mermaid-code], pre[style*="display: none"], pre[style*="display:none"]');
  if (codeEl?.textContent?.trim()) {
    console.log('[mermaid] Found source via hidden code element');
    return codeEl.textContent.trim();
  }
  
  // 3. 从 script 标签提取（保留原始格式）
  const scriptEl = el.querySelector('script[type="text/mermaid"], script[type="application/mermaid"]');
  if (scriptEl?.textContent?.trim()) {
    console.log('[mermaid] Found source via script tag');
    return scriptEl.textContent.trim();
  }
  
  // 4. 检查相邻的 pre/code 元素（某些平台将源码放在相邻元素中）
  const prevSibling = el.previousElementSibling;
  if (prevSibling?.tagName === 'PRE' || prevSibling?.tagName === 'CODE') {
    const prevText = prevSibling.textContent?.trim();
    if (prevText && isMermaidCode(prevText)) {
      console.log('[mermaid] Found source via previous sibling');
      return prevText;
    }
  }
  
  // 5. 检查元素本身是否包含未渲染的源码（无 SVG 子元素）
  const svg = el.querySelector('svg');
  if (!svg && el.textContent?.trim()) {
    const text = el.textContent.trim();
    if (isMermaidCode(text)) {
      console.log('[mermaid] Found source via textContent (no SVG)');
      return text;
    }
  }
  
  // 6. 尝试从 innerHTML 提取（某些平台使用 HTML 注释存储源码）
  const htmlComment = el.innerHTML.match(/<!--\s*((?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline)[\s\S]*?)-->/i);
  if (htmlComment?.[1]?.trim()) {
    console.log('[mermaid] Found source via HTML comment');
    return htmlComment[1].trim();
  }
  
  // 7. 如果有 SVG，尝试从 SVG 重建
  if (svg) {
    const reconstructed = reconstructMermaidFromSvg(svg);
    if (reconstructed) {
      console.log('[mermaid] Reconstructed from SVG in element');
      return reconstructed;
    }
  }
  
  console.log('[mermaid] No source found for element');
  return null;
}

/**
 * 从 SVG 提取 Mermaid 源码
 * 注意：从渲染后的 SVG 很难恢复原始源码，优先使用其他方法
 */
function extractMermaidSourceFromSvg(svg: Element): string | null {
  // 1. 检查 SVG 的 data 属性（最可靠）
  const svgSource = svg.getAttribute('data-mermaid-source') 
    || svg.getAttribute('data-source')
    || svg.getAttribute('data-graph-code');
  if (svgSource?.trim()) {
    console.log('[mermaid] Found SVG source via data attribute');
    return svgSource.trim();
  }
  
  // 2. 检查父元素的 data 属性
  const parent = svg.parentElement;
  if (parent) {
    const parentSource = parent.getAttribute('data-mermaid-source') 
      || parent.getAttribute('data-source')
      || parent.getAttribute('data-graph-code');
    if (parentSource?.trim()) {
      console.log('[mermaid] Found SVG source via parent data attribute');
      return parentSource.trim();
    }
    
    // 检查父元素的相邻元素
    const parentPrev = parent.previousElementSibling;
    if (parentPrev?.tagName === 'PRE' || parentPrev?.tagName === 'CODE') {
      const prevText = parentPrev.textContent?.trim();
      if (prevText && isMermaidCode(prevText)) {
        console.log('[mermaid] Found SVG source via parent previous sibling');
        return prevText;
      }
    }
  }
  
  // 3. 检查 SVG 内的 foreignObject 或 text 元素（某些渲染器保留源码）
  const foreignObject = svg.querySelector('foreignObject');
  if (foreignObject?.textContent?.trim()) {
    const text = foreignObject.textContent.trim();
    if (isMermaidCode(text)) {
      console.log('[mermaid] Found SVG source via foreignObject');
      return text;
    }
  }
  
  // 4. 尝试从 SVG 结构重建流程图代码
  const reconstructed = reconstructMermaidFromSvg(svg);
  if (reconstructed) {
    console.log('[mermaid] Reconstructed mermaid code from SVG');
    return reconstructed;
  }
  
  // 5. 无法获取源码时，返回 null（不生成错误的占位符）
  console.log('[mermaid] Cannot extract source from SVG, skipping');
  return null;
}

/**
 * 尝试从 SVG 结构重建 Mermaid 代码
 * 这是一个有限的重建，主要针对流程图
 */
function reconstructMermaidFromSvg(svg: Element): string | null {
  try {
    // 检测图类型
    const svgClass = svg.getAttribute('class') || '';
    const svgId = svg.getAttribute('id') || '';
    
    // 提取所有节点文本
    const nodeTexts: string[] = [];
    
    // 查找流程图节点（通常在 .node 或 .nodeLabel 中）
    svg.querySelectorAll('.node, .nodeLabel, .label, g[class*="node"]').forEach((node) => {
      // 获取节点中的文本
      const textEl = node.querySelector('text, span, div, foreignObject');
      const text = textEl?.textContent?.trim() || node.textContent?.trim();
      if (text && !nodeTexts.includes(text)) {
        nodeTexts.push(text);
      }
    });
    
    // 如果没有找到节点，尝试从所有 text 元素提取
    if (nodeTexts.length === 0) {
      svg.querySelectorAll('text').forEach((textEl) => {
        const text = textEl.textContent?.trim();
        if (text && text.length > 0 && !nodeTexts.includes(text)) {
          nodeTexts.push(text);
        }
      });
    }
    
    // 如果找到了节点文本，尝试重建
    if (nodeTexts.length >= 2) {
      // 检测方向
      let direction = 'TD'; // 默认从上到下
      if (svgClass.includes('LR') || svgId.includes('LR')) {
        direction = 'LR';
      } else if (svgClass.includes('RL') || svgId.includes('RL')) {
        direction = 'RL';
      } else if (svgClass.includes('BT') || svgId.includes('BT')) {
        direction = 'BT';
      }
      
      // 生成流程图代码
      const lines: string[] = [`flowchart ${direction}`];
      
      // 为每个节点生成 ID 和标签
      const nodeIds: string[] = [];
      nodeTexts.forEach((text, index) => {
        const nodeId = `node${index}`;
        nodeIds.push(nodeId);
        lines.push(`    ${nodeId}[${text}]`);
      });
      
      // 生成连接（假设是线性流程）
      for (let i = 0; i < nodeIds.length - 1; i++) {
        lines.push(`    ${nodeIds[i]} --> ${nodeIds[i + 1]}`);
      }
      
      const result = lines.join('\n');
      console.log('[mermaid] Reconstructed flowchart:', result.substring(0, 100));
      return result;
    }
    
    return null;
  } catch (e) {
    console.error('[mermaid] Error reconstructing from SVG:', e);
    return null;
  }
}

/**
 * 检测 Mermaid 图类型
 */
function detectMermaidType(code: string): string | undefined {
  const trimmed = code.trim().toLowerCase();
  
  const types: Record<string, RegExp> = {
    'flowchart': /^(flowchart|graph)\s+(tb|bt|lr|rl|td)/i,
    'sequenceDiagram': /^sequencediagram/i,
    'classDiagram': /^classdiagram/i,
    'stateDiagram': /^statediagram/i,
    'erDiagram': /^erdiagram/i,
    'gantt': /^gantt/i,
    'pie': /^pie/i,
    'journey': /^journey/i,
    'gitGraph': /^gitgraph/i,
    'mindmap': /^mindmap/i,
    'timeline': /^timeline/i,
  };
  
  for (const [type, pattern] of Object.entries(types)) {
    if (pattern.test(trimmed)) {
      return type;
    }
  }
  
  return undefined;
}

/**
 * 检查文本是否是 Mermaid 代码
 */
function isMermaidCode(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  
  const keywords = [
    'flowchart', 'graph', 'sequencediagram', 'classdiagram',
    'statediagram', 'erdiagram', 'gantt', 'pie', 'journey',
    'gitgraph', 'mindmap', 'timeline', 'quadrantchart', 'sankey'
  ];
  
  for (const keyword of keywords) {
    if (trimmed.startsWith(keyword)) {
      return true;
    }
  }
  
  // 检查流程图语法特征
  if (/-->/g.test(text) && /\[.*\]/g.test(text)) {
    return true;
  }
  
  return false;
}

// ========== Mermaid 提取器 ==========

/**
 * 提取 DOM 中的所有 Mermaid 图
 */
export function extractMermaidBlocks(container: HTMLElement): CollectedMermaid[] {
  const mermaidBlocks: CollectedMermaid[] = [];
  
  try {
    // 注意：不要在这里调用 normalizeMermaidInDom，因为调用者已经调用过了
    
    // 提取预处理后的 Mermaid 块
    container.querySelectorAll('[data-sync-mermaid]').forEach((el) => {
      const codeEl = el.querySelector('code');
      const code = codeEl?.textContent || '';
      const diagramType = el.getAttribute('data-diagram-type') || undefined;
      
      if (code) {
        mermaidBlocks.push({
          type: 'mermaid',
          code,
          diagramType,
        });
      }
    });
    
    // 也检查 language-mermaid 代码块
    container.querySelectorAll('pre code.language-mermaid').forEach((el) => {
      if (el.closest('[data-sync-mermaid]')) return; // 已处理
      
      const code = el.textContent || '';
      if (code) {
        mermaidBlocks.push({
          type: 'mermaid',
          code,
          diagramType: detectMermaidType(code),
        });
      }
    });
  } catch (e) {
    console.error('[mermaid] Error extracting mermaid blocks:', e);
  }
  
  console.log('[mermaid] Extracted mermaid blocks:', mermaidBlocks.length);
  return mermaidBlocks;
}

// ========== 任务列表预处理 ==========

/**
 * 预处理 DOM 中的任务列表
 * 将各种平台的任务列表格式统一为标准格式
 */
export function normalizeTaskListInDom(root: HTMLElement): void {
  console.log('[tasklist] Starting normalizeTaskListInDom');
  
  // 1. 处理标准的 checkbox input
  root.querySelectorAll('li input[type="checkbox"]').forEach((checkbox) => {
    const li = checkbox.closest('li');
    if (!li) return;
    
    const input = checkbox as HTMLInputElement;
    const isChecked = input.checked || input.hasAttribute('checked');
    
    // 标记 li 为任务列表项
    li.classList.add('task-list-item');
    li.setAttribute('data-task', 'true');
    li.setAttribute('data-checked', String(isChecked));
    
    console.log('[tasklist] Found checkbox task item, checked:', isChecked);
  });
  
  // 2. 处理 GitHub 风格的任务列表（class="task-list-item"）
  root.querySelectorAll('li.task-list-item').forEach((li) => {
    if (li.hasAttribute('data-task')) return; // 已处理
    
    const checkbox = li.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    const isChecked = checkbox?.checked || 
                      checkbox?.hasAttribute('checked') ||
                      li.classList.contains('checked') ||
                      li.classList.contains('completed');
    
    li.setAttribute('data-task', 'true');
    li.setAttribute('data-checked', String(isChecked));
  });
  
  // 3. 处理某些平台使用的自定义任务列表格式
  // 例如：<li data-task="done">...</li> 或 <li class="todo-item checked">...</li>
  root.querySelectorAll('li[data-task], li.todo-item, li.todo, li.task').forEach((li) => {
    if (li.hasAttribute('data-checked')) return; // 已处理
    
    const taskAttr = li.getAttribute('data-task') || '';
    const isChecked = taskAttr === 'done' || 
                      taskAttr === 'completed' ||
                      taskAttr === 'checked' ||
                      li.classList.contains('checked') ||
                      li.classList.contains('completed') ||
                      li.classList.contains('done');
    
    li.classList.add('task-list-item');
    li.setAttribute('data-task', 'true');
    li.setAttribute('data-checked', String(isChecked));
    
    console.log('[tasklist] Found custom task item, checked:', isChecked);
  });
  
  // 4. 处理文本形式的任务标记（如 "[ ]" 或 "[x]" 开头的列表项）
  root.querySelectorAll('li').forEach((li) => {
    if (li.hasAttribute('data-task')) return; // 已处理
    
    const text = li.textContent?.trim() || '';
    const taskMatch = text.match(/^\s*\[([x ])\]\s*/i);
    
    if (taskMatch) {
      const isChecked = taskMatch[1].toLowerCase() === 'x';
      li.classList.add('task-list-item');
      li.setAttribute('data-task', 'true');
      li.setAttribute('data-checked', String(isChecked));
      
      console.log('[tasklist] Found text-based task item, checked:', isChecked);
    }
  });
  
  console.log('[tasklist] normalizeTaskListInDom completed');
}

// ========== 公式提取器 ==========
export function extractFormulas(container: HTMLElement): CollectedFormula[] {
  const formulas: CollectedFormula[] = [];
  
  normalizeMathInDom(container);
  
  container.querySelectorAll('[data-sync-math]').forEach((el) => {
    const tex = el.getAttribute('data-tex') || '';
    const isDisplay = el.getAttribute('data-display') === 'true';
    
    if (tex) {
      const DS = String.fromCharCode(36);
      formulas.push({
        type: 'formula',
        latex: tex,
        display: isDisplay,
        engine: 'unknown',
        originalFormat: isDisplay ? DS + DS + tex + DS + DS : DS + tex + DS,
      });
    }
  });
  
  console.log('[math] Extracted formulas:', formulas.length);
  return formulas;
}


// ========== 段落空白归一化 ==========
export function normalizeBlockSpacing(container: HTMLElement): void {
  const isEmptyNode = (el: HTMLElement) => {
    const text = (el.textContent || '').replace(/\u00A0/g, ' ').trim();
    if (text) return false;
    if (el.querySelector('img, picture, video, table, pre, code, [data-sync-math]')) return false;
    return true;
  };

  const compressBrs = (node: Element) => {
    const ch = Array.from(node.childNodes);
    let lastWasBr = false;
    for (const n of ch) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        if ((n as Element).tagName.toLowerCase() === 'br') {
          if (lastWasBr) { node.removeChild(n); continue; }
          lastWasBr = true;
        } else {
          lastWasBr = false;
          compressBrs(n as Element);
        }
      } else if (n.nodeType === Node.TEXT_NODE) {
        const t = n.textContent || '';
        if (/^\s+$/.test(t)) {
          const prev = n.previousSibling;
          const next = n.nextSibling;
          if ((prev && (prev as Element).tagName === 'BR') || (next && (next as Element).tagName === 'BR')) {
            node.removeChild(n);
          }
        }
      }
    }
  };

  compressBrs(container);

  container.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, blockquote, pre, figure, section, article').forEach((el) => {
    if (isEmptyNode(el as HTMLElement)) el.remove();
  });

  const trimEdges = (el: HTMLElement) => {
    while (el.firstChild && ((el.firstChild as Element).tagName === 'BR' || (el.firstChild.nodeType === Node.TEXT_NODE && /^\s*$/.test(el.firstChild.textContent || '')))) {
      el.removeChild(el.firstChild);
    }
    while (el.lastChild && ((el.lastChild as Element).tagName === 'BR' || (el.lastChild.nodeType === Node.TEXT_NODE && /^\s*$/.test(el.lastChild.textContent || '')))) {
      el.removeChild(el.lastChild);
    }
  };
  trimEdges(container);
}

// ========== 代码块高亮去壳 ==========
export function flattenCodeHighlights(container: HTMLElement): void {
  container.querySelectorAll('pre > code').forEach((code) => {
    const el = code as HTMLElement;
    const langMatch = el.className.match(/language-(\w+)/);
    const lang = langMatch ? langMatch[1] : el.getAttribute('data-lang') || '';
    const text = el.textContent || '';
    el.innerHTML = '';
    el.textContent = text;
    if (lang) el.className = 'language-' + lang;
  });
}

// ========== DOM 白名单清洗 ==========
const WHITELIST_TAGS = new Set([
  'p', 'div', 'span', 'a', 'strong', 'em', 'b', 'i', 'u',
  // 删除线标签
  'del', 's', 'strike',
  // 标题
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  // 表格
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'colgroup', 'col',
  // 代码和引用
  'pre', 'code', 'blockquote', 'figure', 'figcaption',
  // 媒体
  'img', 'picture', 'source', 'br', 'hr',
  // 上下标
  'sub', 'sup',
  // SVG（用于 Mermaid 图）- 保留整个 SVG 元素，不处理内部
  'svg',
  // 任务列表相关
  'input',
]);

export function cleanDOMWithWhitelist(container: HTMLElement): void {
  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tagName = el.tagName.toLowerCase();
      
      // SVG 元素及其子元素不处理，保持原样
      if (tagName === 'svg' || el.closest('svg')) {
        return;
      }
      
      if (!WHITELIST_TAGS.has(tagName)) {
        const parent = el.parentNode;
        if (parent) {
          const children = Array.from(el.childNodes);
          children.forEach(child => parent.insertBefore(child, el));
          el.remove();
          children.forEach(walk);
        }
        return;
      }
      
      const keepClasses = Array.from(el.classList).filter(c =>
        c.startsWith('katex') || c.startsWith('mjx') || c.includes('math') || 
        c.startsWith('language-') || c.startsWith('hljs') ||
        // Mermaid 相关类名
        c === 'mermaid' || c.includes('mermaid') ||
        // 任务列表相关类名
        c === 'task-list-item' || c === 'task-list' || c.includes('checkbox') || c.includes('todo')
      );
      el.className = keepClasses.join(' ');
      
      const keepAttrs = ['class', 'src', 'alt', 'title', 'href', 'id', 
        'data-sync-math', 'data-tex', 'data-display', 'data-lang',
        // Mermaid 相关属性
        'data-mermaid', 'data-mermaid-source', 'data-source', 'data-sync-mermaid', 'data-diagram-type',
        // 任务列表相关属性
        'type', 'checked', 'disabled', 'data-task', 'data-checked'
      ];
      Array.from(el.attributes).forEach(attr => {
        if (!keepAttrs.includes(attr.name)) el.removeAttribute(attr.name);
      });
      
      Array.from(el.childNodes).forEach(walk);
    }
  };
  walk(container);
}

// ========== 图片归一化器 ==========
function resolveUrl(src?: string | null, base?: string): string {
  if (!src) return '';
  try { return new URL(src, base || document.baseURI).href; }
  catch { return src; }
}

function parseSrcset(srcset: string | null): string {
  if (!srcset) return '';
  try {
    const candidates = srcset.split(',').map(s => s.trim());
    const parsed = candidates.map(c => {
      const parts = c.split(/\s+/);
      return { u: parts[0], width: parts[1]?.endsWith('w') ? parseInt(parts[1]) : 0 };
    });
    parsed.sort((a, b) => b.width - a.width);
    return parsed[0]?.u || '';
  } catch { return ''; }
}

export function extractAndNormalizeImages(container: HTMLElement): CollectedImage[] {
  const images: CollectedImage[] = [];
  const seen = new Set<string>();
  
  container.querySelectorAll('img').forEach((img) => {
    const el = img as HTMLImageElement;
    const src = el.getAttribute('src') || parseSrcset(el.getAttribute('srcset'))
      || el.getAttribute('data-src') || el.getAttribute('data-original')
      || el.getAttribute('data-lazy-src') || el.getAttribute('data-actualsrc');
    const url = resolveUrl(src);
    
    if (url && !seen.has(url)) {
      seen.add(url);
      images.push({
        type: 'image', url,
        alt: el.getAttribute('alt') || undefined,
        title: el.getAttribute('title') || undefined,
        width: el.naturalWidth || undefined,
        height: el.naturalHeight || undefined,
        source: 'img',
      });
      el.setAttribute('src', url);
    }
  });
  
  container.querySelectorAll('picture source').forEach((source) => {
    const url = resolveUrl(parseSrcset(source.getAttribute('srcset')));
    if (url && !seen.has(url)) {
      seen.add(url);
      images.push({ type: 'image', url, source: 'picture' });
    }
  });
  
  container.querySelectorAll('noscript').forEach((noscript) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = noscript.textContent || '';
    tmp.querySelectorAll('img').forEach((img) => {
      const url = resolveUrl(img.getAttribute('src'));
      if (url && !seen.has(url)) {
        seen.add(url);
        images.push({ type: 'image', url, source: 'noscript' });
      }
    });
  });
  
  return images;
}

// ========== 质量校验 ==========
export function checkQuality(
  initialMetrics: ContentMetrics,
  finalMetrics: ContentMetrics,
  thresholds = { images: 0.3, formulas: 0.5, tables: 0.5, mermaid: 0.5 }
): QualityCheck {
  const lossRatio = {
    images: initialMetrics.images > 0 ? (initialMetrics.images - finalMetrics.images) / initialMetrics.images : 0,
    formulas: initialMetrics.formulas > 0 ? (initialMetrics.formulas - finalMetrics.formulas) / initialMetrics.formulas : 0,
    tables: initialMetrics.tables > 0 ? (initialMetrics.tables - finalMetrics.tables) / initialMetrics.tables : 0,
    mermaid: initialMetrics.mermaidBlocks > 0 ? (initialMetrics.mermaidBlocks - finalMetrics.mermaidBlocks) / initialMetrics.mermaidBlocks : 0,
  };
  
  if (lossRatio.images > thresholds.images) {
    return { pass: false, reason: '图片丢失' + (lossRatio.images * 100).toFixed(1) + '%', initialMetrics, finalMetrics, lossRatio };
  }
  if (lossRatio.formulas > thresholds.formulas) {
    return { pass: false, reason: '公式丢失' + (lossRatio.formulas * 100).toFixed(1) + '%', initialMetrics, finalMetrics, lossRatio };
  }
  if (lossRatio.tables > thresholds.tables) {
    return { pass: false, reason: '表格丢失' + (lossRatio.tables * 100).toFixed(1) + '%', initialMetrics, finalMetrics, lossRatio };
  }
  if (lossRatio.mermaid > thresholds.mermaid) {
    return { pass: false, reason: 'Mermaid图丢失' + (lossRatio.mermaid * 100).toFixed(1) + '%', initialMetrics, finalMetrics, lossRatio };
  }
  return { pass: true, initialMetrics, finalMetrics, lossRatio };
}
