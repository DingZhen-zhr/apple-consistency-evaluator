from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path

# Load .env file if present (for DEEPSEEK_API_KEY etc.)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

from fastapi import FastAPI, File, UploadFile
from fastapi import HTTPException
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware

from app.analyzers.base import AnalyzerContext
from app.analyzers.color_consistency import ColorConsistencyAnalyzer
from app.analyzers.component_style import ComponentStyleConsistencyAnalyzer
from app.analyzers.spacing_grid import SpacingGridConsistencyAnalyzer
from app.analyzers.typography import TypographyConsistencyAnalyzer
from app.visual_complexity import VisualComplexityAnalyzer
from app.image_utils import load_image_from_bytes
from app.models import AnalysisResult
from app.multi_screen import cross_screen_issues
from app.reporting.report import render_report
from app.scoring import score_dimensions, score_from_features, score_overall

from app.ai.schemas import AiExplainRequest
from app.ai.explain import explain_with_ai


ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = ROOT / "frontend"
RUNS_DIR = ROOT / "runs"


app = FastAPI(title="Apple Consistency UI Evaluator", version="0.2.0")

_allow_origins_env = os.getenv("CORS_ALLOW_ORIGINS", "").strip()
if _allow_origins_env:
    allow_origins = [o.strip() for o in _allow_origins_env.split(",") if o.strip()]
    allow_origin_regex = None
else:
    allow_origins = ["*"]
    allow_origin_regex = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_origin_regex=allow_origin_regex,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

if FRONTEND_DIR.exists():
    app.mount("/ui", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


@app.get("/")
def index():
    return RedirectResponse(url="/ui/")


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/ai/explain")
async def ai_explain(req: AiExplainRequest):
    try:
        resp = await explain_with_ai(req)
        return resp.model_dump()
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI explain failed: {e}")


@app.post("/api/analyze")
async def analyze(files: list[UploadFile] = File(...)):
    start = time.time()

    # Consistency analyzers (return (issues, features))
    consistency_analyzers = [
        ColorConsistencyAnalyzer(),
        SpacingGridConsistencyAnalyzer(),
        TypographyConsistencyAnalyzer(),
        ComponentStyleConsistencyAnalyzer(),
    ]
    # Clarity analyzer
    clarity_analyzer = VisualComplexityAnalyzer()

    images_rgb = []
    filenames = []
    first_image_bytes = None
    first_ctx = None

    per_screen_meta = []
    all_issues = []

    # Accumulate features across screens (will average them)
    feature_accum: dict[str, list[float]] = {}

    for idx, f in enumerate(files):
        data = await f.read()
        if idx == 0:
            first_image_bytes = data
        loaded = load_image_from_bytes(data)
        filename = f.filename or f"upload_{idx+1}.png"
        ctx = AnalyzerContext(
            image_rgb=loaded.rgb,
            width=loaded.width,
            height=loaded.height,
            filename=filename,
        )
        if idx == 0:
            first_ctx = ctx

        screen_issues = []
        screen_features: dict = {}

        # Run consistency analyzers
        for a in consistency_analyzers:
            issues_a, features_a = a.analyze(ctx)
            screen_issues.extend(issues_a)
            screen_features.update(features_a)

        # Run clarity analyzer
        issues_c, features_c = clarity_analyzer.analyze(ctx)
        screen_issues.extend(issues_c)
        screen_features.update(features_c)

        all_issues.extend(screen_issues)

        # Accumulate feature values for averaging
        for key, val in screen_features.items():
            if isinstance(val, (int, float)) and not isinstance(val, bool):
                feature_accum.setdefault(key, []).append(float(val))

        images_rgb.append(loaded.rgb)
        filenames.append(filename)
        per_screen_meta.append(
            {
                "file": filename,
                "width": loaded.width,
                "height": loaded.height,
                "issue_count": len(screen_issues),
                "features": screen_features,
            }
        )

    # Average features across all screens
    avg_features = {k: round(sum(v) / len(v), 2) for k, v in feature_accum.items() if v}

    # Compute axis scores
    axis_scores = score_from_features(avg_features)

    # Cross-screen consistency
    all_issues.extend(cross_screen_issues(filenames=filenames, images_rgb=images_rgb))

    # Dimension scores
    all_dimensions = [a.dimension for a in consistency_analyzers] + ["VisualComplexity"]
    if len(files) > 1:
        all_dimensions.append("CrossScreenConsistency")

    dim_scores = score_dimensions(
        issues=all_issues,
        expected_dimensions=all_dimensions,
        features=avg_features,
    )
    overall = score_overall(dim_scores)

    result = AnalysisResult(
        overall_score=overall,
        clarity_score=axis_scores["clarity_score"],
        consistency_score=axis_scores["consistency_score"],
        dimension_scores=dim_scores,
        issues=all_issues,
        meta={
            "analyzed_files": filenames,
            "per_screen": per_screen_meta,
            "elapsed_ms": int((time.time() - start) * 1000),
            "features": avg_features,
            "axis_scores": axis_scores,
        },
    )

    report = render_report(
        result=result,
        filename=first_ctx.filename if first_ctx else "upload.png",
        image_bytes=first_image_bytes or b"",
        width=first_ctx.width if first_ctx else 0,
        height=first_ctx.height if first_ctx else 0,
    )

    run_id = uuid.uuid4().hex[:12]
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "result.json").write_text(
        json.dumps(result.model_dump(), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (run_dir / "report.html").write_text(report.html, encoding="utf-8")
    if first_image_bytes:
        (run_dir / "input_1.png").write_bytes(first_image_bytes)

    return {
        "run_id": run_id,
        "result": result.model_dump(),
        "artifacts": {
            "report_url": f"/api/runs/{run_id}/report.html",
            "result_url": f"/api/runs/{run_id}/result.json",
        },
    }


@app.post("/api/report", response_class=HTMLResponse)
async def report(files: list[UploadFile] = File(...)):
    payload = await analyze(files=files)
    run_id = payload["run_id"]
    return FileResponse(
        path=str(RUNS_DIR / run_id / "report.html"),
        media_type="text/html; charset=utf-8",
        filename="report.html",
    )


@app.get("/api/runs/{run_id}/report.html")
def get_report(run_id: str):
    path = RUNS_DIR / run_id / "report.html"
    return FileResponse(path=str(path), media_type="text/html; charset=utf-8", filename="report.html")


@app.get("/api/runs/{run_id}/result.json")
def get_result(run_id: str):
    path = RUNS_DIR / run_id / "result.json"
    return FileResponse(path=str(path), media_type="application/json; charset=utf-8", filename="result.json")