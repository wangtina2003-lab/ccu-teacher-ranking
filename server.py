from datetime import datetime, timedelta, timezone
from flask import Flask, jsonify, request
from flask_cors import CORS
from pathlib import Path
from threading import Lock, Thread
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright
import json
import re

app = Flask(__name__)
CORS(app)

BASE_DIR = Path(__file__).resolve().parent
TEACHERS_PATH = BASE_DIR / "teachers.json"
CACHE_PATH = BASE_DIR / "views_cache.json"
CACHE_TTL = timedelta(minutes=5)

with TEACHERS_PATH.open("r", encoding="utf-8") as f:
    teachers = json.load(f)

_cache_lock = Lock()
_refresh_lock = Lock()
_cached_views = {}
_cached_keywords = {}
_cached_baselines = {}
_cache_updated_at = None

if CACHE_PATH.exists():
    with CACHE_PATH.open("r", encoding="utf-8") as f:
        cache = json.load(f)
    _cached_views = cache["views"]
    _cached_keywords = cache.get("keywords", {})
    _cache_updated_at = cache["updated_at"]
    _cached_baselines = cache.get("baselines", {})
    if not _cached_baselines and _cache_updated_at:
        baseline_date = datetime.fromisoformat(_cache_updated_at).astimezone().date().isoformat()
        _cached_baselines = {
            teacher_name: {"views": views, "date": baseline_date}
            for teacher_name, views in _cached_views.items()
        }


def extract_research_keywords(page):
    for heading in page.locator("h3").all():
        if heading.inner_text().strip() != "研究領域":
            continue

        section_text = heading.locator("xpath=..").inner_text()
        research_text = section_text.replace("研究領域", "", 1)
        keywords = [
            keyword.strip(" \t\r\n‧•·・、,，;；")
            for keyword in re.split(r"[‧•·・]|\r?\n+|[,，;；]", research_text)
        ]
        return [keyword for keyword in keywords if keyword][:5]

    return []


def extract_view_count(page):
    try:
        page.wait_for_function(
            r"""() => {
                const counter = document.querySelector(".PtStatistic i");
                return counter && /\d/.test(counter.textContent || "");
            }""",
            timeout=12000,
        )
    except PlaywrightTimeoutError:
        body_text = page.inner_text("body")
        match = re.search(r"瀏覽數\s*[：:]\s*([\d,]+)", body_text)
        if match:
            return int(match.group(1).replace(",", ""))
        raise ValueError("教師官網未提供可辨識的瀏覽數") from None

    counter_text = page.locator(".PtStatistic i").inner_text()
    match = re.search(r"\d[\d,]*", counter_text)
    if match:
        return int(match.group(0).replace(",", ""))

    raise ValueError("教師官網未提供可辨識的瀏覽數")


def fetch_all_views_with_browser(teachers):
    views_map = {}
    keywords_map = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
            page = context.new_page()

            for teacher in teachers:
                views = None
                try:
                    page.goto(teacher["url"], wait_until="domcontentloaded", timeout=15000)
                    views = extract_view_count(page)
                    keywords_map[teacher["name"]] = extract_research_keywords(page)
                    print(f"✅ 【{teacher['name']}】 精準點閱數: {views}")
                except Exception as e:
                    app.logger.exception("教師【%s】資料擷取失敗", teacher["name"])
                    keywords_map[teacher["name"]] = []

                views_map[teacher["name"]] = views
        finally:
            browser.close()

    return views_map, keywords_map


def refresh_cache():
    global _cached_views, _cached_keywords, _cached_baselines, _cache_updated_at

    try:
        fetched_views, keywords = fetch_all_views_with_browser(teachers)
        with _cache_lock:
            views = _cached_views.copy()
            baselines = {
                teacher_name: baseline.copy()
                for teacher_name, baseline in _cached_baselines.items()
            }

        failed_teachers = []
        for teacher_name, fetched_count in fetched_views.items():
            if fetched_count is None:
                failed_teachers.append(teacher_name)
                if views.get(teacher_name, 0) <= 0:
                    views.pop(teacher_name, None)
                continue
            views[teacher_name] = fetched_count
            baseline = baselines.get(teacher_name)
            if baseline is None or fetched_count < baseline["views"]:
                baselines[teacher_name] = {
                    "views": fetched_count,
                    "date": datetime.now().astimezone().date().isoformat(),
                }

        updated_at = datetime.now(timezone.utc).isoformat()
        cache = {
            "views": views,
            "keywords": keywords,
            "baselines": baselines,
            "updated_at": updated_at,
        }

        temporary_path = CACHE_PATH.with_suffix(".tmp")
        temporary_path.write_text(
            json.dumps(cache, ensure_ascii=False),
            encoding="utf-8",
        )
        temporary_path.replace(CACHE_PATH)

        with _cache_lock:
            _cached_views = views
            _cached_keywords = keywords
            _cached_baselines = baselines
            _cache_updated_at = updated_at
        if failed_teachers:
            app.logger.warning(
                "以下教師瀏覽數擷取失敗，已保留既有有效數據（若有）：%s",
                "、".join(failed_teachers),
            )
        app.logger.info("教師瀏覽數快取已更新")
    except Exception:
        app.logger.exception("背景更新教師瀏覽數失敗")
    finally:
        _refresh_lock.release()


def start_background_refresh():
    if not _refresh_lock.acquire(blocking=False):
        return

    try:
        Thread(target=refresh_cache, daemon=True).start()
    except Exception:
        _refresh_lock.release()
        raise


def cache_is_stale(updated_at):
    if not updated_at:
        return True
    last_update = datetime.fromisoformat(updated_at)
    if last_update.tzinfo is None:
        last_update = last_update.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - last_update > CACHE_TTL


@app.route("/api/teachers", methods=["GET"])
def get_teacher_data():
    with _cache_lock:
        views_map = _cached_views.copy()
        keywords_map = _cached_keywords.copy()
        baselines_map = {
            teacher_name: baseline.copy()
            for teacher_name, baseline in _cached_baselines.items()
        }
        updated_at = _cache_updated_at

    force_refresh = request.args.get("refresh") == "1"
    if force_refresh or cache_is_stale(updated_at):
        start_background_refresh()

    results = []
    category_totals = {}
    today = datetime.now().astimezone().date()

    for teacher in teachers:
        views = views_map.get(teacher["name"])
        baseline = baselines_map.get(teacher["name"])
        average_daily_views = None
        baseline_date = None
        if baseline is not None:
            baseline_date = baseline["date"]
            if views is not None:
                elapsed_days = max(1, (today - datetime.fromisoformat(baseline_date).date()).days)
                average_daily_views = max(0, views - baseline["views"]) / elapsed_days

        results.append({
            "name": teacher["name"],
            "category": teacher["category"],
            "url": teacher["url"],
            "views": views,
            "average_daily_views": average_daily_views,
            "baseline_date": baseline_date,
            "keywords": keywords_map.get(teacher["name"], []),
        })

        category = teacher["category"]
        category_totals[category] = category_totals.get(category, 0) + (views or 0)

    results.sort(
        key=lambda item: (
            item["views"] is None,
            -(item["views"] or 0),
        )
    )
    total_views = sum(category_totals.values())

    return jsonify({
        "status": "success" if updated_at else "loading",
        "cache_ready": updated_at is not None,
        "refreshing": _refresh_lock.locked(),
        "updated_at": updated_at,
        "total_views": total_views,
        "teachers": results,
        "categories": category_totals,
    })


if __name__ == "__main__":
    print("🚀 中正企管教師瀏覽數 API 伺服器已啟動 (http://127.0.0.1:5000)...")
    app.run(debug=True, port=5000)