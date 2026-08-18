#!/usr/bin/env python3
"""项目管理面板 · data.json 校验器

用法：
    python3 validate.py            # 校验当前目录的 data.json
    python3 validate.py data.json  # 或指定文件

退出码：0 = 通过（可能有警告），1 = 存在错误。
"""

import json
import re
import sys
from pathlib import Path

STATUSES = {"done", "doing", "todo", "hold", "blocked"}
PRIS = {"high", "mid", "low"}
REVIEWS = {"agent_draft", "user_confirmed"}

errors = []
warnings = []


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def is_iso(s):
    return isinstance(s, str) and re.match(r"^\d{4}-\d{2}-\d{2}T", s) is not None


def check_project(pr, tag, months, seen):
    for key in ["id", "name", "date", "month", "cat", "status", "progress", "tokens", "updated", "intro"]:
        if key not in pr:
            err(f"{tag} 缺少字段 {key}")
    if pr.get("id") in seen:
        err(f"{tag} id 重复：{pr.get('id')}")
    seen.add(pr.get("id"))
    if pr.get("status") not in STATUSES:
        err(f"{tag} status 无效：{pr.get('status')}（应为 done/doing/todo/hold/blocked）")
    if not isinstance(pr.get("progress"), (int, float)) or not (0 <= pr["progress"] <= 100):
        err(f"{tag} progress 必须是 0-100 的数字")
    if not isinstance(pr.get("tokens"), (int, float)):
        err(f"{tag} tokens 必须是数字")
    if not isinstance(pr.get("month"), int) or not (0 <= pr["month"] < len(months)):
        err(f"{tag} month 越界：{pr.get('month')}（有效 0~{len(months) - 1}）")
    if "review" in pr and pr["review"] not in REVIEWS:
        err(f"{tag} review 无效：{pr['review']}（应为 agent_draft/user_confirmed）")
    for i, m in enumerate(pr.get("milestones", [])):
        if not all(k in m for k in ("date", "text", "done")):
            err(f"{tag}.milestones[{i}] 缺少 date/text/done")
    for i, n in enumerate(pr.get("next", [])):
        if "text" not in n:
            err(f"{tag}.next[{i}] 缺少 text")
        if n.get("p") not in PRIS:
            err(f"{tag}.next[{i}] p 无效：{n.get('p')}（应为 high/mid/low）")
    for i, c in enumerate(pr.get("criteria", [])):
        if not all(k in c for k in ("done", "text")):
            err(f"{tag}.criteria[{i}] 缺少 done/text")
    if not isinstance(pr.get("files", []), list):
        err(f"{tag}.files 必须是数组")


def _check_top_level(data, months):
    """检查顶层字段与 months 结构。"""
    for key in ["updated", "months", "projects", "topics", "news"]:
        if key not in data:
            err(f"缺少顶层字段 {key}")
    if not isinstance(data.get("months", []), list) or not data.get("months"):
        err("months 必须是非空数组")
    if "updatedAt" in data and not is_iso(data["updatedAt"]):
        warn("updatedAt 不是有效 ISO 时间（如 2026-08-06T10:00:00+08:00）")
    if not isinstance(data.get("projects", []), list):
        err("projects 必须是数组")


def _check_empty(data, months):
    """检查 empty 空对话条目。"""
    eseen = set()
    for i, e in enumerate(data.get("empty", [])):
        tag = f"empty[{i}]"
        for key in ["id", "label", "date", "count", "note"]:
            if key not in e:
                err(f"{tag} 缺少字段 {key}")
        if e.get("id") in eseen:
            err(f"{tag} id 重复：{e.get('id')}")
        eseen.add(e.get("id"))
        if not isinstance(e.get("month"), int) or not (0 <= e["month"] < len(months)):
            err(f"{tag} month 越界：{e.get('month')}（有效 0~{len(months) - 1}）")
        if not isinstance(e.get("count"), int):
            err(f"{tag} count 必须是整数")


def _check_topics(data):
    """检查 topics 创作选题结构。"""
    for i, t in enumerate(data.get("topics", [])):
        tag = f"topics[{i}]"
        for key in ["title", "type", "desc", "project"]:
            if key not in t:
                err(f"{tag} 缺少字段 {key}")
        if not isinstance(t.get("plan", []), list):
            err(f"{tag} plan 必须是数组")


def _check_news(data):
    """检查 news 新闻条目结构。"""
    for i, n in enumerate(data.get("news", [])):
        tag = f"news[{i}]"
        for key in ["date", "source", "title", "url"]:
            if key not in n:
                err(f"{tag} 缺少字段 {key}")
        url = n.get("url", "")
        if url and not str(url).startswith("http"):
            err(f"{tag} url 必须是 http(s) 链接")


def main(path="data.json"):
    p = Path(path)
    if not p.exists():
        err(f"找不到 {path}")
        return False
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        err(f"JSON 解析失败：{e}")
        return False

    months = data.get("months", [])
    _check_top_level(data, months)
    seen = set()
    for i, pr in enumerate(data.get("projects", [])):
        check_project(pr, f"projects[{i}]", months, seen)
    if data.get("current") is not None:
        check_project(data["current"], "current", months, seen)
    _check_empty(data, months)
    _check_topics(data)
    _check_news(data)

    print(f"校验完成：{len(errors)} 个错误，{len(warnings)} 个警告")
    for w in warnings:
        print("  ⚠", w)
    for e in errors:
        print("  ✗", e)
    return not errors


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "data.json"
    sys.exit(0 if main(target) else 1)
