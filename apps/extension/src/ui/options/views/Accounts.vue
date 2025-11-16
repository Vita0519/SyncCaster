<template>
  <div>
    <div class="flex-between mb-6">
      <h2 class="text-2xl font-bold text-gray-800">账号管理</h2>
      <n-button type="primary" @click="addAccount">
        ➕ 添加账号
      </n-button>
    </div>

    <n-card title="已绑定账号">
      <n-empty v-if="accounts.length === 0" description="暂无绑定账号" />
      <n-list v-else>
        <n-list-item v-for="account in accounts" :key="account.id">
          <template #prefix>
            <n-avatar :src="account.avatar" />
          </template>
          <n-thing :title="account.nickname">
            <template #description>
              {{ getPlatformName(account.platform) }}
            </template>
          </n-thing>
          <template #suffix>
            <n-switch v-model:value="account.enabled" @update:value="toggleAccount(account)" />
          </template>
        </n-list-item>
      </n-list>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { db, type Account } from '@synccaster/core';

const accounts = ref<Account[]>([]);

onMounted(async () => {
  await loadAccounts();
});

async function loadAccounts() {
  try {
    accounts.value = await db.accounts.toArray();
  } catch (error) {
    console.error('Failed to load accounts:', error);
  }
}

function getPlatformName(platform: string) {
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

async function toggleAccount(account: Account) {
  await db.accounts.update(account.id, {
    enabled: account.enabled,
    updatedAt: Date.now(),
  });
}

function addAccount() {
  alert('添加账号功能待实现');
}
</script>
