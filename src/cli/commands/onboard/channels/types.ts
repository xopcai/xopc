/**
 * Channel Configuration Types
 * 
 * Shared types for multi-channel onboarding configuration.
 */

import type { Config } from '../../../../config/schema.js';

// DM 策略类型
export type DmPolicy = 'pairing' | 'allowlist' | 'open' | 'disabled';

// Group 策略类型  
export type GroupPolicy = 'open' | 'disabled' | 'allowlist';

/**
 * 频道配置器接口
 * 每个频道需要实现此接口
 */
export interface ChannelConfigurator {
  /** 频道唯一标识 */
  id: string;
  
  /** 显示名称 */
  name: string;
  
  /** 简短描述 */
  description: string;
  
  /**
   * 检查是否已配置
   * @param config 当前配置
   * @returns 是否已配置基本凭证
   */
  isConfigured(config: Config): boolean;
  
  /**
   * 执行配置流程
   * @param config 当前配置
   * @returns 更新后的配置
   */
  configure(config: Config): Promise<Config>;
}

/**
 * 频道状态信息
 */
export interface ChannelStatus {
  id: string;
  name: string;
  description: string;
  configured: boolean;
}
