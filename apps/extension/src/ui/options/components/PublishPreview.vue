<template>
  <div class="publish-preview">
    <!-- 预览标签页 -->
    <div class="flex border-b mb-4">
      <button
        v-for="platform in platforms"
        :key="platform.id"
        class="px-4 py-2 text-sm font-medium transition-colors"
        :class="activePlatform === platform.id 
          ? 'border-b-2 border-blue-500 text-blue-600' 
          : 'text-gray-500 hover:text-gray-700'"
        @click="activePlatform = platform.id"
      >
        {{ platform.icon }} {{ platform.name }}
      </button>
    </div>

    <!-- 预览内容 -->
    <div class="preview-content bg-gray-50 rounded-lg p-4 min-h-[300px]">
      <!-- 平台特定样式提示 -->
      <div class="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
        <strong>{{ currentPlatform?.name }}</strong> 预览
        <span v-if="currentPlatform?.notes" class="ml-2 text-yellow-600">
          · {{ currentPlatform.notes }}
        </span>
      </div>

      <!-- 标题预览 -->
      <h1 class="text-2xl font-bold mb-4 text-gray-900">{{ title }}</h1>

      <!-- 内容预览 -->
      <div 
        class="prose prose-sm max-w-none"
        :class="previewClass"
        v-html="previewHtml"
      ></div>

      <!-- 元信息预览 -->
      <div v-if="tags?.length || categories?.length" class="mt-6 pt-4 border-t">
        <div v-if="tags?.length" class="flex flex-wrap gap-2 mb-2">
          <span class="text-sm text-gray-500">标签：</span>
          <span 
            v-for="tag in tags" 
            :key="tag"
            class="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded"
          >
            {{ tag }}
          </span>
        </div>
        <div v-if="categories?.length" class="flex flex-wrap gap-2">
          <span class="text-sm text-gray-500">分类：</span>
          <span 
            v-for="cat in categories" 
            :key="cat"
            class="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded"
          >
            {{ cat }}
          </span>
        </div>
      </div>
    </div>

    <!-- 平台差异说明 -->
    <div class="mt-4 text-sm text-gray-500">
      <div v-if="currentPlatform?.warnings?.length" class="space-y-1">
        <div v-for="(warning, idx) in currentPlatform.warnings" :key="idx" class="flex items-start gap-2">
          <span class="text-yellow-500">⚠️</span>
          <span>{{ warning }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { marked } from 'marked';

const props = defineProps<{
  title: string;
  content: string;
  tags?: string[];
  categories?: string[];
  selectedPlatforms: string[];
}>();

const activePlatform = ref('');

// 平台配置
const platformConfigs: Record<string, {
  id: string;
  name: string;
  icon: string;
  notes?: string;
  warnings?: string[];
  previewClass?: string;
}> = {
  juejin: {
    id: 'juejin',
    name: '掘金',
    icon: '🔷',
    notes: '支持 Markdown + LaTeX',
    previewClass: 'preview-juejin',
  },
  zhihu: {
    id: 'zhihu',
    name: '知乎',
    icon: '🔵',
    notes: '富文本编辑器',
    warnings: ['LaTeX 公式需要去除 $ 符号'],
    previewClass: 'preview-zhihu',
  },
  csdn: {
    id: 'csdn',
    name: 'CSDN',
    icon: '📘',
    notes: '支持 Markdown',
    previewClass: 'preview-csdn',
  },
  wechat: {
    id: 'wechat',
    name: '微信公众号',
    icon: '💚',
    notes: '富文本编辑器',
    warnings: ['不支持 LaTeX 公式', '图片需要上传到微信服务器'],
    previewClass: 'preview-wechat',
  },
  jianshu: {
    id: 'jianshu',
    name: '简书',
    icon: '📝',
    notes: '支持 Markdown',
    warnings: ['不支持 LaTeX 公式'],
    previewClass: 'preview-jianshu',
  },
  cnblogs: {
    id: 'cnblogs',
    name: '博客园',
    icon: '🌿',
    notes: '支持 Markdown + LaTeX',
    previewClass: 'preview-cnblogs',
  },
  segmentfault: {
    id: 'segmentfault',
    name: '思否',
    icon: '🟢',
    notes: '支持 Markdown',
    warnings: ['LaTeX 语法略有不同'],
    previewClass: 'preview-segmentfault',
  },
  bilibili: {
    id: 'bilibili',
    name: 'B站专栏',
    icon: '📺',
    notes: '富文本编辑器',
    warnings: ['不支持 LaTeX 公式'],
    previewClass: 'preview-bilibili',
  },
};

// 当前选中的平台列表
const platforms = computed(() => {
  return props.selectedPlatforms
    .map(id => platformConfigs[id])
    .filter(Boolean);
});

// 当前预览的平台
const currentPlatform = computed(() => {
  return platformConfigs[activePlatform.value];
});

// 预览样式类
const previewClass = computed(() => {
  return currentPlatform.value?.previewClass || '';
});

// 预览 HTML
const previewHtml = computed(() => {
  if (!props.content) return '<p class="text-gray-400">暂无内容</p>';
  try {
    return marked(props.content);
  } catch (error) {
    return `<pre class="text-red-500">Markdown 解析失败</pre>`;
  }
});

// 初始化激活平台
watch(() => props.selectedPlatforms, (newVal) => {
  if (newVal.length > 0 && !newVal.includes(activePlatform.value)) {
    activePlatform.value = newVal[0];
  }
}, { immediate: true });
</script>

<style scoped>
/* 平台特定预览样式 */
.preview-juejin {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.preview-zhihu {
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
  line-height: 1.8;
}

.preview-wechat {
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif;
  font-size: 15px;
  line-height: 1.75;
}

.preview-csdn {
  font-family: 'Microsoft YaHei', sans-serif;
}
</style>
