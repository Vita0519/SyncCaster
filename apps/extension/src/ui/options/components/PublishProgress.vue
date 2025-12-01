<template>
  <div class="publish-progress">
    <!-- 总体进度 -->
    <div class="mb-6">
      <div class="flex justify-between text-sm mb-2">
        <span class="font-medium">发布进度</span>
        <span class="text-gray-500">{{ completedTargets }}/{{ totalTargets }} 个平台</span>
      </div>
      <div class="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div 
          class="h-full bg-blue-500 transition-all duration-300"
          :style="{ width: `${overallProgress}%` }"
        ></div>
      </div>
    </div>

    <!-- 当前任务 -->
    <div v-if="currentTarget" class="mb-6 p-4 bg-blue-50 rounded-lg">
      <div class="flex items-center gap-3 mb-3">
        <span class="text-2xl">{{ getPlatformIcon(currentTarget.platform) }}</span>
        <div>
          <div class="font-medium">{{ getPlatformName(currentTarget.platform) }}</div>
          <div class="text-sm text-gray-500">{{ currentTarget.progress.message }}</div>
        </div>
        <div class="ml-auto">
          <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium"
            :class="stageClass(currentTarget.progress.stage)">
            {{ stageLabel(currentTarget.progress.stage) }}
          </span>
        </div>
      </div>
      <div class="h-1.5 bg-blue-200 rounded-full overflow-hidden">
        <div 
          class="h-full bg-blue-500 transition-all duration-300"
          :style="{ width: `${currentTarget.progress.progress}%` }"
        ></div>
      </div>
      <div v-if="currentTarget.progress.detail" class="mt-2 text-xs text-gray-500">
        {{ currentTarget.progress.detail }}
      </div>
    </div>

    <!-- 已完成列表 -->
    <div class="space-y-2">
      <div 
        v-for="result in results" 
        :key="`${result.platform}-${result.accountId}`"
        class="flex items-center gap-3 p-3 rounded-lg"
        :class="result.success ? 'bg-green-50' : 'bg-red-50'"
      >
        <span class="text-xl">{{ getPlatformIcon(result.platform) }}</span>
        <div class="flex-1">
          <div class="font-medium">{{ getPlatformName(result.platform) }}</div>
          <div v-if="result.success && result.url" class="text-sm text-green-600">
            <a :href="result.url" target="_blank" class="hover:underline">
              {{ result.url }}
            </a>
          </div>
          <div v-else-if="result.error" class="text-sm text-red-600">
            {{ result.error }}
          </div>
        </div>
        <span v-if="result.success" class="text-green-500 text-xl">✓</span>
        <span v-else class="text-red-500 text-xl">✗</span>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="!currentTarget && results.length === 0" class="text-center py-8 text-gray-500">
      <div class="text-4xl mb-2">⏳</div>
      <div>等待开始发布...</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface ProgressResult {
  platform: string;
  accountId: string;
  success: boolean;
  url?: string;
  error?: string;
}

interface CurrentTarget {
  platform: string;
  accountId: string;
  progress: {
    stage: string;
    progress: number;
    message: string;
    detail?: string;
  };
}

const props = defineProps<{
  totalTargets: number;
  completedTargets: number;
  currentTarget?: CurrentTarget;
  results: ProgressResult[];
}>();

// 总体进度
const overallProgress = computed(() => {
  if (props.totalTargets === 0) return 0;
  const baseProgress = (props.completedTargets / props.totalTargets) * 100;
  const currentProgress = props.currentTarget 
    ? (props.currentTarget.progress.progress / props.totalTargets)
    : 0;
  return Math.min(100, baseProgress + currentProgress);
});

// 平台名称
function getPlatformName(platform: string): string {
  const names: Record<string, string> = {
    juejin: '掘金',
    zhihu: '知乎',
    csdn: 'CSDN',
    wechat: '微信公众号',
    jianshu: '简书',
    cnblogs: '博客园',
    '51cto': '51CTO',
    'tencent-cloud': '腾讯云',
    aliyun: '阿里云',
    segmentfault: '思否',
    bilibili: 'B站专栏',
    oschina: '开源中国',
  };
  return names[platform] || platform;
}

// 平台图标
function getPlatformIcon(platform: string): string {
  const icons: Record<string, string> = {
    juejin: '🔷',
    zhihu: '🔵',
    csdn: '📘',
    wechat: '💚',
    jianshu: '📝',
    cnblogs: '🌿',
    '51cto': '🔶',
    'tencent-cloud': '☁️',
    aliyun: '🧡',
    segmentfault: '🟢',
    bilibili: '📺',
    oschina: '🔴',
  };
  return icons[platform] || '📄';
}

// 阶段标签
function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    init: '初始化',
    auth: '验证登录',
    transform: '转换内容',
    upload_images: '上传图片',
    create_draft: '创建草稿',
    fill_content: '填充内容',
    submit: '提交发布',
    wait_redirect: '等待跳转',
    complete: '完成',
    error: '错误',
  };
  return labels[stage] || stage;
}

// 阶段样式
function stageClass(stage: string): string {
  const classes: Record<string, string> = {
    init: 'bg-gray-100 text-gray-700',
    auth: 'bg-yellow-100 text-yellow-700',
    transform: 'bg-blue-100 text-blue-700',
    upload_images: 'bg-purple-100 text-purple-700',
    create_draft: 'bg-indigo-100 text-indigo-700',
    fill_content: 'bg-cyan-100 text-cyan-700',
    submit: 'bg-orange-100 text-orange-700',
    wait_redirect: 'bg-pink-100 text-pink-700',
    complete: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700',
  };
  return classes[stage] || 'bg-gray-100 text-gray-700';
}
</script>
