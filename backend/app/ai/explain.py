from __future__ import annotations

import json

from app.ai.deepseek_client import DeepSeekClient
from app.ai.schemas import AiExplainRequest, AiExplainResponse


SYSTEM = """你是一个极其严谨的移动端 UI/UX 设计评估专家，专门根据 Apple 的 Consistency（一致性）原则做“可执行”的问题诊断。
你必须：
- 用结构化方式解释“为什么这是问题”（必须引用输入 evidence 数字/字段名）
- 给出可以直接照抄的改动建议（必须有明确数值、阈值、或规则；禁止‘适当’‘优化一下’等模糊词）
- 输出必须是 JSON（不要输出 Markdown）
"""


def _build_user_prompt(req: AiExplainRequest) -> str:
    result = req.result or {}
    meta = result.get("meta") or {}
    per_screen = (meta.get("per_screen") or [{}])[:1]
    features = (per_screen[0].get("features") or {}) if isinstance(per_screen[0], dict) else {}
    issues = result.get("issues") or []
    dim_scores = result.get("dimension_scores") or []
    overall = result.get("overall_score")

    # Keep the prompt compact but information-dense.
    payload = {
        "goal": req.goal,
        "principle": req.principle,
        "overall_score": overall,
        "dimension_scores": dim_scores,
        "issues": issues[:30],
        "features": features,
        "notes": {
            "constraints": [
                "建议必须具体到数值/规则/阈值",
                "每条建议需要说明依据（从 features 或 issues.evidence 中引用字段）",
                "如果 evidence 不足，要给出‘需要补采样/需要结构信息’的明确补充建议",
            ]
        },
    }

    return f"""请根据下面的评估证据，生成“论文级”的详尽原因分析与可执行建议。

你需要输出一个 JSON 对象，包含：
- summary: 3-6 条要点，总结一致性强弱与最关键证据（每条要引用字段）
- axis_explanation: 解释双轴含义，并把 features -> x/y 的逻辑用人话说清楚（必须引用 features 字段）
- problems: 数组，每个元素必须含
  - title
  - principle_mapping（对应 Consistency 的哪条）
  - evidence（引用字段和值）
  - why_it_matters（影响：可理解性/可预测性/可学习性/可维护性）
  - fixes: 数组，每条 fix 必须是“动作 + 参数”，例如 margin 从 10px -> 16px，radius 统一为 12dp 等
- what_to_measure_next: 如果现有证据无法支撑精确建议，列出下一步应该补测什么（也要具体）
- markdown: 把上述内容渲染成 Markdown 字符串（用于前端展示）

证据 JSON：
{json.dumps(payload, ensure_ascii=False)}
"""


async def explain_with_ai(req: AiExplainRequest) -> AiExplainResponse:
    client = DeepSeekClient.from_env()
    user = _build_user_prompt(req)
    out = await client.chat_json(system=SYSTEM, user=user, max_tokens=1600)

    md = out.get("markdown")
    if not isinstance(md, str) or not md.strip():
        md = "AI 未返回 markdown 字段（可能是输出被截断）。请重试或降低图片/问题数量。"
    return AiExplainResponse(ok=True, markdown=md, data=out)

