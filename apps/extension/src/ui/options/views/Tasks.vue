<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-2xl font-bold text-gray-800">任务中心</h2>
      <button
        @click="loadJobs"
        class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        🔄 刷新
      </button>
    </div>

    <div class="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <!-- 所有任务列表 -->
      <div v-if="allJobs.length === 0" class="text-center py-12 text-gray-500">
        <div class="text-5xl mb-4">📋</div>
        <div class="text-lg">暂无任务</div>
        <div class="text-sm mt-2">发布文章后任务将显示在这里</div>
      </div>

      <div v-else class="space-y-4">
        <div
          v-for="job in allJobs"
          :key="job.id"
          class="border rounded-lg p-4 hover:shadow-md transition-shadow"
          :class="{
            'border-blue-500 bg-blue-50': job.state === 'RUNNING',
            'border-green-500 bg-green-50': job.state === 'DONE',
            'border-yellow-500 bg-yellow-50': job.state === 'PENDING',
            'border-red-500 bg-red-50': job.state === 'FAILED'
          }"
        >
          <!-- 任务头部 -->
          <div class="flex items-start justify-between mb-3">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-1">
                <span class="font-semibold text-gray-800">{{ getPostTitle(job.postId) }}</span>
                <span
                  class="px-2 py-1 text-xs rounded-full"
                  :class="{
                    'bg-blue-600 text-white': job.state === 'RUNNING',
                    'bg-green-600 text-white': job.state === 'DONE',
                    'bg-yellow-600 text-white': job.state === 'PENDING',
                    'bg-red-600 text-white': job.state === 'FAILED'
                  }"
                >
                  {{ getStateLabel(job.state) }}
                </span>
              </div>
              <div class="text-sm text-gray-600">
                发布到 {{ job.targets.length }} 个平台：
                {{ job.targets.map((t: any) => getPlatformName(t.platform)).join('、') }}
              </div>
              <div class="text-xs text-gray-500 mt-1">
                {{ formatTime(job.createdAt) }}
              </div>
            </div>

            <!-- 操作按钮 -->
            <div class="flex gap-2">
              <button
                v-if="job.state === 'PENDING'"
                @click="startJob(job.id)"
                class="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                开始
              </button>
              <button
                @click="deleteJob(job.id)"
                class="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
              >
                删除
              </button>
            </div>
          </div>

          <!-- 进度条 -->
          <div v-if="job.state === 'RUNNING'" class="mb-3">
            <div class="flex items-center justify-between text-sm mb-1">
              <span class="text-gray-600">进度</span>
              <span class="font-semibold">{{ Math.round(job.progress) }}%</span>
            </div>
            <div class="w-full bg-gray-200 rounded-full h-2">
              <div
                class="bg-blue-600 h-2 rounded-full transition-all"
                :style="{ width: `${job.progress}%` }"
              ></div>
            </div>
          </div>

          <!-- 错误信息 -->
          <div v-if="job.state === 'FAILED' && job.error" class="mt-2 p-2 bg-red-100 rounded text-sm text-red-800">
            ❌ {{ job.error }}
          </div>

          <!-- 日志 -->
          <details v-if="job.logs && job.logs.length > 0" class="mt-3">
            <summary class="text-sm text-gray-600 cursor-pointer hover:text-gray-800">
              查看日志 ({{ job.logs.length }})
            </summary>
            <div class="mt-2 space-y-1 max-h-48 overflow-y-auto">
              <div
                v-for="log in job.logs"
                :key="log.id"
                class="text-xs p-2 rounded"
                :class="{
                  'bg-gray-100': log.level === 'info',
                  'bg-yellow-100': log.level === 'warn',
                  'bg-red-100': log.level === 'error'
                }"
              >
                <span class="text-gray-500">{{ formatLogTime(log.timestamp) }}</span>
                <span class="mx-2">{{ log.message }}</span>
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { db } from '@synccaster/core';

const allJobs = ref<any[]>([]);
const posts = ref<Map<string, any>>(new Map());
let refreshInterval: number | null = null;

onMounted(async () => {
  await loadJobs();
  // 每3秒自动刷新
  refreshInterval = window.setInterval(() => {
    loadJobs();
  }, 3000);
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});

async function loadJobs() {
  try {
    // 加载所有任务，按创建时间倒序
    const jobs = await db.jobs.toArray();
    allJobs.value = jobs.sort((a, b) => b.createdAt - a.createdAt);
    
    console.log('已加载任务:', allJobs.value.length, allJobs.value);
    
    // 加载关联的文章
    const postIds = [...new Set(jobs.map(j => j.postId))];
    for (const postId of postIds) {
      if (!posts.value.has(postId)) {
        const post = await db.posts.get(postId);
        if (post) {
          posts.value.set(postId, post);
        }
      }
    }
  } catch (error) {
    console.error('Failed to load jobs:', error);
  }
}

async function startJob(jobId: string) {
  try {
    await chrome.runtime.sendMessage({
      type: 'START_JOB',
      data: { jobId },
    });
    await loadJobs();
  } catch (error) {
    console.error('Failed to start job:', error);
  }
}

async function deleteJob(jobId: string) {
  if (!confirm('确定要删除这个任务吗？')) {
    return;
  }
  
  try {
    await db.jobs.delete(jobId);
    await loadJobs();
  } catch (error) {
    console.error('Failed to delete job:', error);
  }
}

function getPostTitle(postId: string): string {
  const post = posts.value.get(postId);
  return post?.title || '未命名文章';
}

function getPlatformName(platform: string): string {
  const names: Record<string, string> = {
    wechat: '微信公众号',
    zhihu: '知乎',
    juejin: '掘金',
    csdn: 'CSDN',
    jianshu: '简书',
    medium: 'Medium',
    toutiao: '今日头条',
  };
  return names[platform] || platform;
}

function getStateLabel(state: string): string {
  const labels: Record<string, string> = {
    PENDING: '待执行',
    RUNNING: '进行中',
    DONE: '已完成',
    FAILED: '失败',
    PAUSED: '已暂停',
  };
  return labels[state] || state;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  // 小于1分钟
  if (diff < 60000) {
    return '刚刚';
  }
  // 小于1小时
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} 分钟前`;
  }
  // 小于1天
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} 小时前`;
  }
  // 显示日期
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatLogTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
</script>
