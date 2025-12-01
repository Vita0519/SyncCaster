/**
 * 发布进度管理器
 * 实时跟踪和广播发布进度
 */
import { db } from '@synccaster/core';
import type { PublishProgress, PublishStage } from '@synccaster/adapters';

/**
 * 任务进度状态
 */
export interface JobProgress {
  jobId: string;
  postId: string;
  totalTargets: number;
  completedTargets: number;
  currentTarget?: {
    platform: string;
    accountId: string;
    progress: PublishProgress;
  };
  results: Array<{
    platform: string;
    accountId: string;
    success: boolean;
    url?: string;
    error?: string;
  }>;
  startedAt: number;
  updatedAt: number;
}

/**
 * 进度监听器
 */
type ProgressListener = (progress: JobProgress) => void;

/**
 * 发布进度管理器
 */
class PublishProgressManager {
  private jobs = new Map<string, JobProgress>();
  private listeners = new Map<string, Set<ProgressListener>>();

  /**
   * 初始化任务进度
   */
  initJob(jobId: string, postId: string, targets: Array<{ platform: string; accountId: string }>) {
    const progress: JobProgress = {
      jobId,
      postId,
      totalTargets: targets.length,
      completedTargets: 0,
      results: [],
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.jobs.set(jobId, progress);
    this.broadcast(jobId, progress);
  }

  /**
   * 更新当前目标进度
   */
  updateTargetProgress(
    jobId: string,
    platform: string,
    accountId: string,
    progress: PublishProgress
  ) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.currentTarget = { platform, accountId, progress };
    job.updatedAt = Date.now();
    this.broadcast(jobId, job);
  }

  /**
   * 完成一个目标
   */
  completeTarget(
    jobId: string,
    platform: string,
    accountId: string,
    result: { success: boolean; url?: string; error?: string }
  ) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.results.push({ platform, accountId, ...result });
    job.completedTargets++;
    job.currentTarget = undefined;
    job.updatedAt = Date.now();
    this.broadcast(jobId, job);
  }

  /**
   * 完成任务
   */
  completeJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.updatedAt = Date.now();
    this.broadcast(jobId, job);

    // 延迟清理
    setTimeout(() => {
      this.jobs.delete(jobId);
      this.listeners.delete(jobId);
    }, 60000); // 1分钟后清理
  }

  /**
   * 获取任务进度
   */
  getJobProgress(jobId: string): JobProgress | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * 订阅进度更新
   */
  subscribe(jobId: string, listener: ProgressListener): () => void {
    if (!this.listeners.has(jobId)) {
      this.listeners.set(jobId, new Set());
    }
    this.listeners.get(jobId)!.add(listener);

    // 立即发送当前状态
    const current = this.jobs.get(jobId);
    if (current) {
      listener(current);
    }

    // 返回取消订阅函数
    return () => {
      this.listeners.get(jobId)?.delete(listener);
    };
  }

  /**
   * 广播进度更新
   */
  private broadcast(jobId: string, progress: JobProgress) {
    const listeners = this.listeners.get(jobId);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(progress);
        } catch (e) {
          console.error('Progress listener error:', e);
        }
      });
    }

    // 同时通过 chrome.runtime 广播
    try {
      chrome.runtime.sendMessage({
        type: 'PUBLISH_PROGRESS',
        data: progress,
      }).catch(() => {
        // 忽略无接收者的错误
      });
    } catch (e) {
      // 忽略
    }
  }
}

// 导出单例
export const progressManager = new PublishProgressManager();

/**
 * 创建进度回调
 */
export function createProgressCallback(
  jobId: string,
  platform: string,
  accountId: string
): (progress: PublishProgress) => void {
  return (progress: PublishProgress) => {
    progressManager.updateTargetProgress(jobId, platform, accountId, progress);
  };
}
