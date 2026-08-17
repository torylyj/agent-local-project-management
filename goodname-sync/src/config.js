// Supabase 配置（anon key 是公开的，安全性由 RLS 保证）
export const SUPABASE_URL = 'https://sbbzqicwgrvikbygeysv.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNiYnpxaWN3Z3J2aWtieWdleXN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNTc0OTYsImV4cCI6MjEwMTkzMzQ5Nn0.nsVOQLJxu8atiTjFvyhINxdGBh7txTPif3Xg_dMS-Nc';

// 本地密钥配置（~/.goodname/config.json）
import fs from 'fs';
import path from 'path';
import os from 'os';

export const CONFIG_PATH = path.join(os.homedir(), '.goodname', 'config.json');

export function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveConfig(obj) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(obj, null, 2), 'utf-8');
  return CONFIG_PATH;
}

// 多 Agent 平台数据根目录（每个平台都会扫描面板兼容文件；WorkBuddy 额外解析会话追踪）
export const AGENT_ROOTS = [
  { label: 'codex', paths: ['~/.codex/visualizations', '~/Documents/Codex'] },
  { label: 'cursor', paths: ['~/.cursor', '~/Documents/Cursor'] },
  { label: 'workbuddy', paths: ['~/.workbuddy'] },
  { label: 'dumate (百度搭子)', paths: ['~/.dumate', '~/.du-mate', '~/.baidu-dazhi', '~/.baidu-dazi'] },
  { label: 'qclaw', paths: ['~/.qclaw', '~/.QClaw'] },
  { label: 'autoclaw / openclaw', paths: ['~/.openclaw', '~/.autoclaw', '~/.auto-claw'] },
];

export const DEFAULT_SEARCH_ROOTS = AGENT_ROOTS;

export const PANEL_FILENAMES = ['codex-project-tracker.html', '项目进度总览.html', 'panel-data.json'];
export const DATA_FILENAMES = ['data.json'];

// WorkBuddy 会话与追踪目录（用于把 WorkBuddy 会话解析成项目）
export const WORKBUDDY_DIR = '~/.workbuddy';
