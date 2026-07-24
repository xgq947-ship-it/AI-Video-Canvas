from functools import lru_cache
import os
from pathlib import Path

from dotenv import dotenv_values
from pydantic import BaseModel, ConfigDict


# 注意：本文件从 Ops-Cli 抽取而来，原布局为 Ops-Cli/src/ops_cli/config.py，
# 故原代码用 parents[2] 定位仓库根。本项目布局为 server/python/ops_cli/config.py，
# 少了 src/ 这一层，因此正确的基准是 parents[1]（= server/python）。
# 若照抄 parents[2] 会指向 server/，令 sessionhub_root 差一层目录，
# 且该错误在 `--help` 时不暴露，只在真正生成时才会出现。
PYTHON_ROOT = Path(__file__).resolve().parents[1]


def _sessionhub_root() -> str:
    return str(PYTHON_ROOT / "sessionhub")


class AppConfig(BaseModel):
    """仅保留 Google Flow / 即梦 浏览器自动化所需的配置。

    上游 Ops-Cli 中与电商后台相关的字段（含 cookie 与门店名称）已全部移除：
    本项目不涉及那些平台，也不得携带任何相关信息。
    """

    model_config = ConfigDict(extra="ignore")

    sessionhub_root: str = _sessionhub_root()
    logs_dir: Path = PYTHON_ROOT / "logs"
    runtime_dir: Path = PYTHON_ROOT / "runtime"


@lru_cache(maxsize=1)
def get_config() -> AppConfig:
    # .env 可选：默认全部走推导值，无需任何配置。
    env_path = Path.cwd() / ".env"
    raw = dotenv_values(env_path) if env_path.exists() else {}
    return AppConfig(
        sessionhub_root=(
            os.environ.get("SESSIONHUB_ROOT", "")
            or raw.get("SESSIONHUB_ROOT", "")
            or _sessionhub_root()
        ),
        logs_dir=Path(os.environ.get("EVAN_LOGS_DIR", "") or (PYTHON_ROOT / "logs")),
        runtime_dir=Path(os.environ.get("EVAN_RUNTIME_DIR", "") or (PYTHON_ROOT / "runtime")),
    )
