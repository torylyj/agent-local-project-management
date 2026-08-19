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

面板目前默认仍走 hook + 云端任务队列（未部署时不能切换到 Edge Function）。
部署完成后，把面板里对应的 fetch/状态读写调用改为 Edge Function 地址（当前代码尚未接线，
属待办：`panel.template.js` 中为每个接口加一个 base URL 常量，部署后一键切换），
hook 仅保留 `/update` 深度更新。

> 说明：`sync` Edge Function 与任务队列配合，真正执行仍在设备上（CLI worker）；
> Edge Function 只负责「云端入队 + 状态读写」，把本机依赖从「实时 push」降为「上线拉取」。
