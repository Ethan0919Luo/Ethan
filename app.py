import json
import os
import secrets
import threading
from datetime import datetime
from pathlib import Path

from flask import (
    Flask,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "database.json"

app = Flask(__name__)


def load_secret_key():
    """优先读环境变量；否则在 DATA_DIR 生成并持久化，避免把密钥写进仓库。"""
    env_key = os.environ.get("SECRET_KEY")
    if env_key:
        return env_key
    key_path = DATA_DIR / "secret_key"
    if key_path.exists():
        value = key_path.read_text(encoding="utf-8").strip()
        if value:
            return value
    value = secrets.token_hex(32)
    key_path.write_text(value, encoding="utf-8")
    return value


app.secret_key = load_secret_key()

_db_lock = threading.Lock()


def load_db():
    if not DB_PATH.exists():
        return {"users": {}}
    try:
        db = json.loads(DB_PATH.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {"users": {}}
    if not isinstance(db, dict) or not isinstance(db.get("users"), dict):
        return {"users": {}}
    return db


def save_db(db):
    DB_PATH.write_text(
        json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def ranked_users(db):
    users = [
        {"username": name, **info}
        for name, info in db["users"].items()
    ]
    users.sort(key=lambda u: (-int(u.get("laps", 0)), u["username"]))
    return users


def valid_username(name):
    if not (2 <= len(name) <= 16):
        return False
    return all(ch.isalnum() or ch == "_" for ch in name)


@app.get("/")
def index():
    username = session.get("user")
    if not username:
        return redirect(url_for("login"))
    db = load_db()
    me = db["users"].get(username, {})
    return render_template("index.html", username=username, my_laps=me.get("laps", 0))


@app.get("/register")
def register_page():
    if session.get("user"):
        return redirect(url_for("index"))
    return render_template("register.html", error=None)


@app.post("/register")
def register():
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")
    confirm = request.form.get("confirm", "")

    error = None
    if not valid_username(username):
        error = "用户名需为 2-16 位字母、数字、下划线或中文"
    elif len(password) < 6:
        error = "密码至少 6 位"
    elif password != confirm:
        error = "两次输入的密码不一致"

    if error:
        return render_template("register.html", error=error), 400

    with _db_lock:
        db = load_db()
        if username in db["users"]:
            error = "该用户名已被占用"
        else:
            db["users"][username] = {
                "password": generate_password_hash(password),
                "laps": 0,
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
            save_db(db)

    if error:
        return render_template("register.html", error=error), 400

    session["user"] = username
    return redirect(url_for("index"))


@app.get("/login")
def login_page():
    if session.get("user"):
        return redirect(url_for("index"))
    return render_template("login.html", error=None)


@app.post("/login")
def login():
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")

    with _db_lock:
        db = load_db()
        info = db["users"].get(username)

    if not info or not check_password_hash(info.get("password", ""), password):
        return render_template("login.html", error="用户名或密码不正确"), 400

    session["user"] = username
    return redirect(url_for("index"))


@app.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.get("/leaderboard")
def leaderboard():
    db = load_db()
    return render_template(
        "leaderboard.html",
        users=ranked_users(db)[:100],
        me=session.get("user"),
    )


@app.get("/api/leaderboard")
def api_leaderboard():
    db = load_db()
    users = ranked_users(db)
    me = session.get("user")
    rows = [
        {
            "rank": idx + 1,
            "username": u["username"],
            "laps": int(u.get("laps", 0)),
            "is_me": u["username"] == me,
        }
        for idx, u in enumerate(users[:20])
    ]
    my_laps = 0
    my_rank = None
    for idx, u in enumerate(users):
        if u["username"] == me:
            my_laps = int(u.get("laps", 0))
            my_rank = idx + 1
            break
    return jsonify({"rows": rows, "my_laps": my_laps, "my_rank": my_rank})


@app.post("/api/score")
def api_score():
    username = session.get("user")
    if not username:
        return jsonify({"error": "未登录"}), 401

    payload = request.get_json(silent=True) or {}
    try:
        laps = int(payload.get("laps", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "圈数不合法"}), 400
    laps = max(0, min(laps, 9999))

    with _db_lock:
        db = load_db()
        info = db["users"].get(username)
        if info is None:
            return jsonify({"error": "用户不存在"}), 404
        if laps > int(info.get("laps", 0)):
            info["laps"] = laps
            info["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            save_db(db)
        best = int(info.get("laps", 0))

    users = ranked_users(db)
    rank = next(
        (idx + 1 for idx, u in enumerate(users) if u["username"] == username), None
    )
    return jsonify({"ok": True, "laps": best, "rank": rank})


@app.get("/api/me")
def api_me():
    username = session.get("user")
    if not username:
        return jsonify({"error": "未登录"}), 401
    db = load_db()
    info = db["users"].get(username, {})
    return jsonify({"username": username, "laps": int(info.get("laps", 0))})


@app.get("/healthz")
def healthz():
    return "ok", 200
