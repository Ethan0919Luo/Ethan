# 部署适配包 · v1

这个包用来把一个**已经在本地跑通**的 Flask 项目，改造成可以部署到「上线」平台的形态。

使用方法：

1. 把 `check.py` 复制到项目根目录
2. 把本文件放进项目根目录（或直接把下面这段提示词发给 AI）
3. 对 AI 说：

> 读 DEPLOY-KIT.md，按里面的规则改造这个项目。只做部署适配，不要改业务逻辑和页面样式。改完运行 `python check.py`，直到全部通过。

---

## 给 AI 的任务说明

你的任务是**部署适配**，不是重构。严格遵守：

- 不改业务逻辑、路由含义、页面结构和样式
- 不升级依赖主版本，不更换框架
- 不删除任何现有功能
- 不重写前端，除非某条规则明确要求

## 硬性规则

### 1. 入口固定为根目录 `app.py`，变量名必须是 `app`

```python
app = Flask(__name__)
```

线上启动命令固定：`gunicorn app:app`。文件不能叫 `main.py`、`server.py`，变量不能叫 `application`。

### 2. 删除 `app.run(...)`

```diff
- if __name__ == "__main__":
-     app.run(host="0.0.0.0", port=5000, debug=True)
```

本地调试改用命令行：

```
flask --app app run --port 5000
```

### 3. 必须提供 `/healthz`

```python
@app.get("/healthz")
def healthz():
    return "ok", 200
```

不要在里面查数据库或调外部接口，它是部署脚本判断"启动成功"用的。

### 4. 依赖必须锁定版本

`requirements.txt` 每一行都要 `==`：

```
flask==3.0.3
gunicorn==22.0.0
```

### 5. 数据只能写 `DATA_DIR`

```python
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "database.json"
```

不要写 `open("database.json")`、`Path("data.json")` 这类相对根目录的路径——部署后代码目录会被新版本覆盖。

如果项目里已有数据文件，首次启动时迁移过去：

```python
def migrate_legacy():
    legacy = BASE_DIR / "database.json"
    if legacy.exists() and not DB_PATH.exists():
        DB_PATH.write_bytes(legacy.read_bytes())
```

### 6. `.gitignore` 必须忽略数据与虚拟环境

```
__pycache__/
*.pyc
.venv/
venv/
data/
.DS_Store
```

### 7. 目录结构

```
app.py
requirements.txt
.gitignore
templates/
static/
```

`render_template()` 用到的页面必须在 `templates/`。

### 8. 仓库必须是公开（public）

平台按公开仓库匿名拉取，私有仓库需要额外配置，v1 不支持。

### 9. 初始数据只能作种子，不能覆盖线上数据

代码目录每次部署都会被整体替换，只有 `DATA_DIR` 会保留。因此：

- 仓库里**不得提交** `*.db`、`*.sqlite`、`data/*.json` 等运行时数据
- 需要预置题库、词表这类初始内容时，放进 `seeds/` 目录，随代码更新
- 播种必须在 `DATA_DIR` 里**没有数据时**才执行，已有数据一律不动

```python
import json
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "database.json"
SEED_PATH = BASE_DIR / "seeds" / "questions.json"

def seed_if_empty():
    if DB_PATH.exists():
        return                      # 线上已有数据，绝不覆盖
    seed = json.loads(SEED_PATH.read_text(encoding="utf-8")) if SEED_PATH.exists() else []
    DB_PATH.write_text(json.dumps({"questions": seed}, ensure_ascii=False), encoding="utf-8")
```

需要给线上补充题库时，用“按 id 合并”而不是整份替换：

```python
def merge_seed():
    db = json.loads(DB_PATH.read_text(encoding="utf-8")) if DB_PATH.exists() else {"questions": []}
    known = {q["id"] for q in db["questions"]}
    seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    db["questions"] += [q for q in seed if q["id"] not in known]
    DB_PATH.write_text(json.dumps(db, ensure_ascii=False), encoding="utf-8")
```

禁止的写法：

```python
shutil.copy("database.json", DATA_DIR / "database.json")   # 每次启动都覆盖线上数据
DB_PATH.write_text(SEED_PATH.read_text())                  # 无条件重写
```

## 禁止事项

- 不要引入 Docker、Procfile、任何部署脚本（如 `deploy.sh`），平台不执行它们
- 不要修改端口配置，端口由平台分配
- 不要添加 `.env`、密钥、数据库文件到仓库
- 不要为了让检查通过而伪造 `/healthz`（比如返回写死的内容但不经过路由）

## 完成标准

```
$ python check.py
✓ 规则 1  根目录存在 app.py
...
全部检查项通过，可以提交到 GitHub 了
```

然后本地启动一次，确认页面还能正常打开、数据还能正常读写：

```
pip install -r requirements.txt
flask --app app run --port 5000
```

## 改动清单（让 AI 最后输出）

完成后请列出：

1. 改了哪些文件
2. 每条规则对应的改动位置
3. `python check.py` 的最终输出
