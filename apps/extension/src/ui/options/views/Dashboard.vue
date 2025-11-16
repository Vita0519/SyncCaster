<template>
  <div>
    <h2 class="text-2xl font-bold text-gray-800 mb-6">仪表盘</h2>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-4 gap-4 mb-6">
      <n-card>
        <n-statistic label="总文章数" :value="stats.totalPosts" />
      </n-card>
      <n-card>
        <n-statistic label="已发布" :value="stats.publishedPosts" />
      </n-card>
      <n-card>
        <n-statistic label="绑定账号" :value="stats.accounts" />
      </n-card>
      <n-card>
        <n-statistic label="待执行任务" :value="stats.pendingJobs" />
      </n-card>
    </div>

    <!-- 最近活动 -->
    <n-card title="最近活动" class="mb-6">
      <n-empty v-if="recentActivities.length === 0" description="暂无活动记录" />
      <n-timeline v-else>
        <n-timeline-item
          v-for="activity in recentActivities"
          :key="activity.id"
          :time="formatTime(activity.timestamp)"
          :type="getActivityType(activity.type)"
        >
          {{ activity.message }}
        </n-timeline-item>
      </n-timeline>
    </n-card>

    <!-- 快速操作 -->
    <n-card title="快速操作">
      <div class="flex gap-4">
        <n-button type="primary" @click="createNewPost">
          ✍️ 新建文章
        </n-button>
        <n-button @click="manageAccounts">
          👤 管理账号
        </n-button>
        <n-button @click="viewTasks">
          ⚙️ 查看任务
        </n-button>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { db } from '@synccaster/core';

const stats = ref({
  totalPosts: 0,
  publishedPosts: 0,
  accounts: 0,
  pendingJobs: 0,
});

const recentActivities = ref<any[]>([]);

onMounted(async () => {
  await loadStats();
});

async function loadStats() {
  try {
    stats.value.totalPosts = await db.posts.count();
    stats.value.accounts = await db.accounts.count();
    stats.value.pendingJobs = await db.jobs.where('state').equals('PENDING').count();
    
    const published = await db.platformMaps.where('status').equals('PUBLISHED').toArray();
    stats.value.publishedPosts = new Set(published.map(p => p.postId)).size;
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleString('zh-CN');
}

function getActivityType(type: string) {
  const types: Record<string, any> = {
    success: 'success',
    error: 'error',
    warning: 'warning',
    info: 'info',
  };
  return types[type] || 'default';
}

function createNewPost() {
  window.location.hash = 'posts';
}

function manageAccounts() {
  window.location.hash = 'accounts';
}

function viewTasks() {
  window.location.hash = 'tasks';
}
</script>
