from __future__ import annotations

import base64
from dataclasses import asdict, dataclass

from jinja2 import Template

from app.models import AnalysisResult


_TEMPLATE = Template(
    """
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Apple一致性原则评估报告</title>
  <style>
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;margin:24px;line-height:1.45;color:#111}
    .grid{display:grid;grid-template-columns:1fr;gap:16px;max-width:1100px}
    .card{border:1px solid #e6e6e6;border-radius:12px;padding:16px}
    .score{font-size:40px;font-weight:700}
    .dim{display:flex;justify-content:space-between;border-top:1px solid #eee;padding:10px 0}
    .issues{display:flex;flex-direction:column;gap:12px}
    .issue{border:1px solid #eee;border-radius:12px;padding:12px}
    .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;background:#f5f5f5}
    .imgWrap{position:relative;display:inline-block;max-width:100%}
    img{max-width:100%;border-radius:12px;border:1px solid #eee}
    svg{position:absolute;left:0;top:0}
    .box{fill:rgba(255,59,48,0.12);stroke:rgba(255,59,48,0.9);stroke-width:2}
  </style>
</head>
<body>
  <div class="grid">
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap">
        <div>
          <div style="font-size:14px;color:#666">{{ principle }}</div>
          <div style="font-size:22px;font-weight:700">一致性评估报告</div>
          <div style="font-size:13px;color:#666">文件：{{ filename }}</div>
        </div>
        <div class="score">{{ overall_score }}</div>
      </div>
      <div style="margin-top:10px;color:#666;font-size:13px">
        说明：分数由可计算的“一致性度量”生成；若启用 LLM，会对证据进行语言增强，但不会替换计算结果。
      </div>
    </div>

    <div class="card">
      <div style="font-weight:700;margin-bottom:8px">维度得分</div>
      {% for d in dimension_scores %}
        <div class="dim">
          <div>{{ d.dimension }}</div>
          <div><b>{{ d.score }}</b> <span style="color:#666;font-size:12px">{{ d.summary }}</span></div>
        </div>
      {% endfor %}
    </div>

    <div class="card">
      <div style="font-weight:700;margin-bottom:8px">问题与标注</div>
      <div class="imgWrap">
        <img src="data:image/png;base64,{{ image_b64 }}" alt="UI Screenshot" />
        <svg width="{{ width }}" height="{{ height }}" viewBox="0 0 {{ width }} {{ height }}">
          {% for b in all_boxes %}
            <rect class="box" x="{{ b.x }}" y="{{ b.y }}" width="{{ b.w }}" height="{{ b.h }}"></rect>
          {% endfor %}
        </svg>
      </div>
      <div style="margin-top:12px" class="issues">
        {% for it in issues %}
          <div class="issue">
            <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
              <div style="font-weight:700">{{ it.title }}</div>
              <div class="badge">{{ it.dimension }} · {{ it.severity }}</div>
            </div>
            <div style="margin-top:6px;font-size:13px;color:#444"><b>建议：</b>{{ it.suggestion }}</div>
            <details style="margin-top:8px">
              <summary style="cursor:pointer;color:#444">证据（展开）</summary>
              <pre style="white-space:pre-wrap;background:#fafafa;border:1px solid #eee;border-radius:10px;padding:10px;font-size:12px">{{ it.evidence | tojson }}</pre>
            </details>
          </div>
        {% endfor %}
      </div>
    </div>
  </div>
</body>
</html>
"""
)


@dataclass(frozen=True)
class RenderedReport:
    html: str


def render_report(
    *,
    result: AnalysisResult,
    filename: str,
    image_bytes: bytes,
    width: int,
    height: int,
) -> RenderedReport:
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    all_boxes = [b.model_dump() for it in result.issues for b in it.bboxes]
    html = _TEMPLATE.render(
        principle=result.principle,
        filename=filename,
        overall_score=round(result.overall_score, 1),
        dimension_scores=[d.model_dump() for d in result.dimension_scores],
        issues=[it.model_dump() for it in result.issues],
        image_b64=image_b64,
        width=width,
        height=height,
        all_boxes=all_boxes,
    )
    return RenderedReport(html=html)

