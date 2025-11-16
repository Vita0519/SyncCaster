<template>
  <div>
    <h2 class="text-2xl font-bold text-gray-800 mb-6">任务中心</h2>

    <n-card>
      <n-tabs type="line">
        <n-tab-pane name="running" tab="进行中">
          <n-empty v-if="runningJobs.length === 0" description="暂无进行中的任务" />
          <div v-else class="space-y-4">
            <n-card v-for="job in runningJobs" :key="job.id" size="small">
              <div class="mb-2">任务 ID: {{ job.id }}</div>
              <n-progress type="line" :percentage="job.progress" />
            </n-card>
          </div>
        </n-tab-pane>

        <n-tab-pane name="pending" tab="待执行">
          <n-empty v-if="pendingJobs.length === 0" description="暂无待执行任务" />
          <n-list v-else>
            <n-list-item v-for="job in pendingJobs" :key="job.id">
              任务 ID: {{ job.id }}
              <template #suffix>
                <n-button size="small" @click="startJob(job.id)">开始</n-button>
              </template>
            </n-list-item>
          </n-list>
        </n-tab-pane>

        <n-tab-pane name="completed" tab="已完成">
          <n-empty v-if="completedJobs.length === 0" description="暂无已完成任务" />
          <n-list v-else>
            <n-list-item v-for="job in completedJobs" :key="job.id">
              任务 ID: {{ job.id }}
            </n-list-item>
          </n-list>
        </n-tab-pane>
      </n-tabs>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { db } from '@synccaster/core';

const runningJobs = ref<any[]>([]);
const pendingJobs = ref<any[]>([]);
const completedJobs = ref<any[]>([]);

onMounted(async () => {
  await loadJobs();
});

async function loadJobs() {
  try {
    runningJobs.value = await db.jobs.where('state').equals('RUNNING').toArray();
    pendingJobs.value = await db.jobs.where('state').equals('PENDING').toArray();
    completedJobs.value = await db.jobs.where('state').equals('DONE').toArray();
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
</script>
