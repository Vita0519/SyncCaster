import { nanoid } from 'nanoid';
import type { LogEntry } from '@synccaster/core';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private context: string;
  private handlers: Array<(entry: LogEntry) => void> = [];

  constructor(context: string) {
    this.context = context;
  }

  addHandler(handler: (entry: LogEntry) => void) {
    this.handlers.push(handler);
  }

  removeHandler(handler: (entry: LogEntry) => void) {
    const index = this.handlers.indexOf(handler);
    if (index > -1) {
      this.handlers.splice(index, 1);
    }
  }

  log(
    level: LogLevel,
    step: string,
    message: string,
    meta?: Record<string, any>
  ) {
    const entry: LogEntry = {
      id: nanoid(),
      level,
      step: `${this.context}:${step}`,
      message,
      meta,
      timestamp: Date.now(),
    };

    // 发送给所有处理器
    this.handlers.forEach((handler) => handler(entry));

    // 同时输出到控制台
    const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    console[consoleMethod](`[${entry.step}]`, message, meta || '');
  }

  debug(step: string, message: string, meta?: Record<string, any>) {
    this.log('debug', step, message, meta);
  }

  info(step: string, message: string, meta?: Record<string, any>) {
    this.log('info', step, message, meta);
  }

  warn(step: string, message: string, meta?: Record<string, any>) {
    this.log('warn', step, message, meta);
  }

  error(step: string, message: string, meta?: Record<string, any>) {
    this.log('error', step, message, meta);
  }
}
