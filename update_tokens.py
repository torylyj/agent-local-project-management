#!/usr/bin/env python3
"""按 Codex 会话用量回写项目管理面板的项目 Token。

口径：会话累计（含缓存输入）= input_tokens + cached_input_tokens +
      cache_write_input_tokens + output_tokens + reasoning_output_tokens。

用法：
    python3 update_tokens.py <面板源文件.html> [会话目录，默认 ~/.codex/sessions]

原理：读取 ~/.codex/sessions/**/*.jsonl 的 session_meta.cwd 与
      payload.info.total_token_usage，按会话工作目录归属到面板项目
      （项目 dir 与会话 cwd 互相包含即匹配），随后回写源文件中各项目的
      tokens 字段。默认排除维护服务自身的会话（cwd 含 /.codex）；
      如另有本地维护目录，可追加到 EXCLUDE_DIR_MARKS。
"""

import json
import re
import sys
from pathlib import Path

# 需要排除的会话工作目录特征（维护服务自身等），可按需追加
EXCLUDE_DIR_MARKS = ("/.codex",)


def session_total(path):
    """返回单个会话最后一次累计的用量总和；无记录返回 None。"""
    last = None
    try:
        for line in open(path, encoding="utf-8"):
            try:
                d = json.loads(line)
            except Exception:
                continue
            info = (d.get("payload") or {}).get("info") or {}
            if isinstance(info, dict) and info.get("total_token_usage"):
                last = info["total_token_usage"]
    except Exception:
        return None
    if not last:
        return None
    keys = ("input_tokens", "cached_input_tokens", "cache_write_input_tokens",
            "output_tokens", "reasoning_output_tokens")
    return sum(last.get(k, 0) for k in keys)


def month_key(path):
    """从会话文件路径解析年份-月份，如 .../sessions/2026/08/05/... -> 2026-08"""
    parts = path.parts
    try:
        i = parts.index("sessions")
        return parts[i + 1] + "-" + parts[i + 2]
    except Exception:
        return None


def _collect_id_dirs(src):
    """解析面板源：项目 id -> 项目 dir（取每个 dir 前最近的 id 字段）。"""
    id_dirs = {}
    for m in re.finditer(r"dir: '([^']+)'", src):
        before = src[:m.start()]
        im = list(re.finditer(r"id: '([A-Za-z0-9_]+)'", before))
        if im:
            id_dirs[im[-1].group(1)] = m.group(1)
    return id_dirs


def _collect_groups(sessions_dir):
    """按会话工作目录聚合 Token 用量，同时统计月份累计。"""
    groups = {}
    monthly = {}
    for f in sessions_dir.rglob("*.jsonl"):
        cwd = None
        try:
            for line in open(f, encoding="utf-8"):
                try:
                    d = json.loads(line)
                except Exception:
                    continue
                if d.get("type") == "session_meta":
                    cwd = (d.get("payload") or {}).get("cwd", "")
                    break
        except Exception:
            continue
        if not cwd or any(mark in cwd for mark in EXCLUDE_DIR_MARKS):
            continue  # 排除维护服务自身会话
        t = session_total(f)
        if t:
            groups[cwd] = groups.get(cwd, 0) + t
            ym = month_key(Path(f))
            if ym:
                monthly[ym] = monthly.get(ym, 0) + t
    return groups, monthly


def _assign_projects(groups, id_dirs):
    """归属项目：会话 cwd 与项目 dir 互相包含即匹配，返回（归属, 未归属）。"""
    per_project = {}
    unmatched = []
    for cwd, total in groups.items():
        matched = None
        for pid, pdir in id_dirs.items():
            if cwd == pdir or cwd.startswith(pdir) or pdir.startswith(cwd):
                matched = pid
                break
        if matched:
            per_project[matched] = per_project.get(matched, 0) + total
        else:
            unmatched.append((cwd, total))
    return per_project, unmatched


def _write_back(src, per_project):
    """回写各项目 tokens 字段，返回更新后的源码。"""
    for pid, val in per_project.items():
        if pid == "now":
            pat = re.compile(r"(const current = \{[^}]{0,4000}?tokens: )(\d+|null)", re.S)
        else:
            pat = re.compile(r"(\{ id: '" + re.escape(pid) + r"'[^}]{0,4000}?tokens: )(\d+|null)", re.S)
        src, n = pat.subn(lambda m: m.group(1) + str(val), src)
        if not n:
            print("WARN: 未能回写", pid)
    return src


def _write_monthly(src, monthly):
    """回写月度用量（保留历史月份，仅更新有会话数据的月份）。"""
    mt_match = re.search(r"const MONTHLY_TOKENS = (\{[^}]*\})", src)
    mt = {}
    if mt_match:
        for k, v in re.findall(r"'([\d-]+)':\s*(\d+)", mt_match.group(1)):
            mt[k] = int(v)
    for ym, val in monthly.items():
        mt[ym] = val
    if mt:
        body = ", ".join("'%s': %d" % (k, mt[k]) for k in sorted(mt))
        src, n = re.subn(
            r"const MONTHLY_TOKENS = \{[^}]*\}",
            "const MONTHLY_TOKENS = { " + body + " }",
            src,
        )
        if n:
            print("月度回写：")
            for k in sorted(mt):
                print("  %s: %d" % (k, mt[k]))
    return src


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src_path = Path(sys.argv[1])
    sessions_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path.home() / ".codex/sessions"
    src = src_path.read_text(encoding="utf-8")

    id_dirs = _collect_id_dirs(src)
    groups, monthly = _collect_groups(sessions_dir)
    per_project, unmatched = _assign_projects(groups, id_dirs)
    src = _write_back(src, per_project)
    src = _write_monthly(src, monthly)
    src_path.write_text(src, encoding="utf-8")

    print("回写完成：")
    for pid in sorted(per_project):
        print("  %s: %d" % (pid, per_project[pid]))
    for cwd, total in sorted(unmatched):
        print("  未归属（建议新建项目）: %s = %d" % (cwd, total))


if __name__ == "__main__":
    main()
