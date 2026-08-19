# Supabase Edge Functions 迁移包（第 2 步）

目标：把原来走本机 hook 的「无状态公共接口」迁到云端，让面板操作不再依赖本机在线；
本机 hook 收窄为「深度更新」专用通道。

## 包含的函数

| 函数 | 替代的 hook 接口 | 说明 |
| --- | --- | --- |
| `sync` | `/api/sync`、深度更新触发 | 入队云端任务（配合 `sync_tasks.sql`） |
| `state` | `/api/state`、`/api/urgency` | user_state 读写（RLS 限定本人） |
| `delete-project` | `/api/delete-project` | 云端删除 + 记录已删清单 |
| `merge-record` | `/api/merge-record` | 合并历史云端记录 |

## 部署步骤（需要你本机的 supabase CLI 与项目访问令牌）

> 状态：已部署（2026-08-19，v1，verify_jwt=true）。
> 线上 URL：https://sbbzqicwgrvikbygeysv.supabase.co/functions/v1/{sync|state|delete-project|merge-record}

```bash
# 1. 安装 CLI（如未装）：npm i -g supabase
# 2. 登录并关联项目
supabase login
supabase link --project-ref sbbzqicwgrvikbygeysv
# 3. 先执行 SQL（sync_events.sql / sync_tasks.sql）
# 4. 部署函数
supabase functions deploy sync state delete-project merge-record
# 5. 验证
curl https://sbbzqicwgrvikbygeysv.supabase.co/functions/v1/sync \
  -H "Authorization: Bearer <登录JWT>" -H "Content-Type: application/json" \
  -d '{"type":"sync"}'
```

## 面板切换

面板已接线：`delete-project`（云端删除优先，Edge 失败回退直连+本机 hook 清理）；
`state`/`merge-record` 走云端 RLS 直写（与 Edge 函数等价，跨设备生效）；
「立即同步/深度更新」走云端任务队列（`sync` Edge 函数等价入队）。
hook 仅保留 `/update` 深度更新（Codex 深度扫描）。

> 说明：`sync` Edge Function 与任务队列配合，真正执行仍在设备上（CLI worker）；
> Edge Function 只负责「云端入队 + 状态读写」，把本机依赖从「实时 push」降为「上线拉取」。
