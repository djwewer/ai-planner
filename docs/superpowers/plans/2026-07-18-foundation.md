# AI Planner — Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a deployable backend (FastAPI + Postgres, Dockerized, behind the existing Traefik reverse proxy) with email/password and Google OAuth auth plus basic task CRUD, and a minimal Next.js frontend (login/signup, a task list you can manage by hand) deployed to Vercel — a working, testable skeleton with no AI, voice, calendar sync, or Telegram yet.

**Architecture:** FastAPI service using SQLAlchemy 2.0 + Alembic against PostgreSQL, JWT bearer-token auth (email/password via passlib/bcrypt, plus "Sign in with Google" via Authlib). Next.js (App Router, TypeScript) frontend using a thin fetch-based API client and a React context holding the JWT in `localStorage`.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic, PostgreSQL 16, Authlib, PyJWT, passlib+bcrypt, pytest; Next.js (TypeScript, App Router, no CSS framework); Docker Compose; Traefik (already running on the VPS).

## Global Constraints

- Frontend is Next.js (React) on Vercel, mobile-first responsive; primary manual test targets are iOS Safari and Android Chrome.
- Backend is a single FastAPI (Python) service on the existing Hostinger VPS.
- The VPS already runs Docker with Traefik as reverse proxy — do not introduce Nginx; use Traefik labels for routing/HTTPS.
- Database is self-hosted PostgreSQL on the same VPS.
- Auth supports both email/password (bcrypt-hashed) and "Sign in with Google" (OAuth/OIDC), issuing JWT session tokens.
- No AI triage, no voice capture, no Google Calendar sync, no Telegram bot in this plan — those are Plans 2–5.

---

## File Structure

```
backend/
  app/
    main.py              # FastAPI app, middleware, router registration, /health
    config.py             # pydantic Settings (env-driven)
    database.py            # SQLAlchemy engine/session/Base/get_db
    models.py               # User, Task ORM models
    schemas.py                # Pydantic request/response schemas
    security.py                 # password hashing, JWT, get_current_user
    auth/
      router.py                 # /auth/* endpoints (signup, login, me, google)
      google_oauth.py            # Authlib OAuth client registration
    tasks/
      router.py                  # /tasks CRUD endpoints
  alembic/
    env.py
    versions/0001_initial.py
  alembic.ini
  tests/
    conftest.py
    test_health.py
    test_models.py
    test_security.py
    test_auth.py
    test_tasks.py
  requirements.txt
  pytest.ini
  Dockerfile
  entrypoint.sh
  .env.example
docker-compose.yml
.gitignore
frontend/
  app/
    layout.tsx
    page.tsx
    login/page.tsx
    signup/page.tsx
    auth/callback/page.tsx
    tasks/page.tsx
  lib/
    api.ts
    auth-context.tsx
  .env.local.example
```

---

### Task 1: Backend scaffold — health endpoint, test setup, Postgres via Docker Compose

**Files:**
- Create: `backend/requirements.txt`
- Create: `backend/pytest.ini`
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_health.py`
- Create: `docker-compose.yml`
- Create: `backend/.env.example`
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: FastAPI app object at `app.main:app`, route `GET /health -> {"status": "ok"}`

- [ ] **Step 1: Create the repo-level `.gitignore`**

```
# .gitignore
backend/venv/
backend/__pycache__/
backend/**/__pycache__/
backend/.env
backend/*.egg-info/
frontend/node_modules/
frontend/.next/
frontend/.env.local
.DS_Store
```

- [ ] **Step 2: Create `backend/requirements.txt`**

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
sqlalchemy==2.0.35
alembic==1.13.2
psycopg2-binary==2.9.9
pydantic==2.9.2
pydantic-settings==2.5.2
passlib==1.7.4
bcrypt==4.0.1
pyjwt==2.9.0
authlib==1.3.2
httpx==0.27.2
itsdangerous==2.2.0
python-multipart==0.0.9
pytest==8.3.3
```

- [ ] **Step 3: Set up the virtualenv and install dependencies**

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Expected: install completes with no errors.

- [ ] **Step 4: Create `backend/pytest.ini`**

```ini
[pytest]
pythonpath = .
```

- [ ] **Step 5: Create `backend/app/__init__.py` and `backend/tests/__init__.py`**

Both files are empty — they just mark the directories as Python packages.

- [ ] **Step 6: Write the failing test for `/health`**

`backend/tests/conftest.py`:
```python
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)
```

`backend/tests/test_health.py`:
```python
def test_health_returns_ok(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 7: Run the test to verify it fails**

```bash
cd backend
pytest tests/test_health.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.main'` (or import error), since `app/main.py` doesn't exist yet.

- [ ] **Step 8: Create `backend/app/main.py`**

```python
from fastapi import FastAPI

app = FastAPI(title="AI Planner API")


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 9: Run the test to verify it passes**

```bash
pytest tests/test_health.py -v
```

Expected: PASS.

- [ ] **Step 10: Create `backend/.env.example`**

```
DATABASE_URL=postgresql://planner:planner@localhost:5432/planner
JWT_SECRET=change-me-to-a-random-secret
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=10080
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:8000/auth/google/callback
FRONTEND_URL=http://localhost:3000
```

- [ ] **Step 11: Create the repo-root `docker-compose.yml` with the Postgres service**

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: planner
      POSTGRES_PASSWORD: planner
      POSTGRES_DB: planner
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

volumes:
  postgres_data:
```

- [ ] **Step 12: Start Postgres and verify it's healthy**

```bash
cd "$(git rev-parse --show-toplevel)"
docker compose up -d postgres
docker compose exec postgres pg_isready -U planner
```

Expected: `/var/run/postgresql:5432 - accepting connections`.

- [ ] **Step 13: Commit**

```bash
git add .gitignore docker-compose.yml backend/requirements.txt backend/pytest.ini \
  backend/app/__init__.py backend/app/main.py backend/tests/__init__.py \
  backend/tests/conftest.py backend/tests/test_health.py backend/.env.example
git commit -m "feat: backend scaffold with health endpoint and Postgres via Docker Compose"
```

---

### Task 2: Database models and Alembic migration

**Files:**
- Create: `backend/app/config.py`
- Create: `backend/app/database.py`
- Create: `backend/app/models.py`
- Modify: `backend/tests/conftest.py`
- Create: `backend/tests/test_models.py`
- Create: `backend/alembic.ini`, `backend/alembic/env.py`, `backend/alembic/script.py.mako`, `backend/alembic/versions/0001_initial.py`

**Interfaces:**
- Consumes: nothing new
- Produces: `app.config.settings`, `app.database.Base`, `app.database.get_db`, `app.database.engine`, `app.models.User` (`id`, `email`, `password_hash`, `google_id`, `created_at`), `app.models.Task` (`id`, `user_id`, `title`, `priority` default `3`, `deadline`, `status` default `"confirmed"`, `created_at`, `updated_at`)

- [ ] **Step 1: Create `backend/app/config.py`**

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = ""
    frontend_url: str = "http://localhost:3000"

    class Config:
        env_file = ".env"


settings = Settings()
```

- [ ] **Step 2: Create `backend/app/database.py`**

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 3: Create `backend/app/models.py`**

```python
import datetime

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=True)
    google_id = Column(String, unique=True, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    tasks = relationship("Task", back_populates="user", cascade="all, delete-orphan")


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    priority = Column(Integer, nullable=False, default=3)
    deadline = Column(Date, nullable=True)
    status = Column(String, nullable=False, default="confirmed")
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
        nullable=False,
    )

    user = relationship("User", back_populates="tasks")
```

- [ ] **Step 4: Rewrite `backend/tests/conftest.py` to use a real (in-memory) SQLite DB per test**

```python
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET", "test-secret")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app

engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def _reset_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db_session():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 5: Write the failing model test**

`backend/tests/test_models.py`:
```python
import datetime

from app.models import Task, User


def test_user_defaults(db_session):
    user = User(email="model@example.com", password_hash="hashed")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    assert user.id is not None
    assert isinstance(user.created_at, datetime.datetime)


def test_task_defaults(db_session):
    user = User(email="taskowner@example.com", password_hash="hashed")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    task = Task(user_id=user.id, title="Write the plan")
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)

    assert task.priority == 3
    assert task.status == "confirmed"
    assert task.deadline is None
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd backend
pytest tests/ -v
```

Expected: all tests PASS (the `/health` test still passes; the two new model tests pass).

- [ ] **Step 7: Scaffold Alembic**

```bash
cd backend
alembic init alembic
```

Expected output lists created files: `alembic.ini`, `alembic/env.py`, `alembic/script.py.mako`, `alembic/versions/`.

- [ ] **Step 8: Replace the generated `backend/alembic/env.py` with this content**

```python
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app import models  # noqa: F401  registers models on Base.metadata
from app.config import settings
from app.database import Base

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

- [ ] **Step 9: Write the migration by hand at `backend/alembic/versions/0001_initial.py`**

```python
"""initial users and tasks tables

Revision ID: 0001
Revises:
Create Date: 2026-07-18
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(), nullable=True),
        sa.Column("google_id", sa.String(), nullable=True, unique=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"])
    op.create_index("ix_users_google_id", "users", ["google_id"])

    op.create_table(
        "tasks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("deadline", sa.Date(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="confirmed"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_tasks_user_id", "tasks", ["user_id"])


def downgrade() -> None:
    op.drop_table("tasks")
    op.drop_table("users")
```

- [ ] **Step 10: Run the migration against the real Postgres container and verify**

```bash
cd backend
cp .env.example .env
docker compose -f ../docker-compose.yml up -d postgres
alembic upgrade head
docker compose -f ../docker-compose.yml exec postgres psql -U planner -d planner -c '\dt'
```

Expected: the `\dt` output lists `users` and `tasks` tables.

- [ ] **Step 11: Commit**

```bash
git add backend/app/config.py backend/app/database.py backend/app/models.py \
  backend/tests/conftest.py backend/tests/test_models.py backend/alembic.ini \
  backend/alembic/env.py backend/alembic/script.py.mako backend/alembic/versions/0001_initial.py
git commit -m "feat: add User/Task models and initial Alembic migration"
```

---

### Task 3: Security utilities — password hashing and JWT

**Files:**
- Create: `backend/app/security.py`
- Create: `backend/tests/test_security.py`

**Interfaces:**
- Consumes: `app.config.settings`, `app.database.get_db`, `app.models.User`
- Produces: `hash_password(password: str) -> str`, `verify_password(password: str, password_hash: str) -> bool`, `create_access_token(user_id: int) -> str`, `decode_access_token(token: str) -> int`, `get_current_user` (FastAPI dependency, returns `app.models.User`)

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_security.py`:
```python
import pytest

from app.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


def test_hash_and_verify_password():
    hashed = hash_password("password123")
    assert hashed != "password123"
    assert verify_password("password123", hashed) is True
    assert verify_password("wrongpassword", hashed) is False


def test_create_and_decode_access_token():
    token = create_access_token(user_id=42)
    assert decode_access_token(token) == 42


def test_decode_invalid_token_raises():
    from fastapi import HTTPException

    with pytest.raises(HTTPException):
        decode_access_token("not-a-real-token")
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend
pytest tests/test_security.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.security'`.

- [ ] **Step 3: Create `backend/app/security.py`**

```python
import datetime

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(user_id: int) -> str:
    expire = datetime.datetime.utcnow() + datetime.timedelta(
        minutes=settings.jwt_expire_minutes
    )
    payload = {"sub": str(user_id), "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> int:
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    return int(payload["sub"])


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    user_id = decode_access_token(token)
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )
    return user
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pytest tests/test_security.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/security.py backend/tests/test_security.py
git commit -m "feat: add password hashing and JWT utilities"
```

---

### Task 4: Email/password auth endpoints

**Files:**
- Create: `backend/app/auth/__init__.py`
- Create: `backend/app/auth/router.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_auth.py`

**Interfaces:**
- Consumes: `app.security.hash_password`, `verify_password`, `create_access_token`, `get_current_user`; `app.schemas` (new file, see below); `app.models.User`
- Produces: `POST /auth/signup`, `POST /auth/login` (both return `{"access_token": str, "token_type": "bearer"}`), `GET /auth/me` (returns `{"id": int, "email": str}`); router object `app.auth.router.router`

- [ ] **Step 1: Create `backend/app/schemas.py`**

```python
import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: EmailStr

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TaskCreate(BaseModel):
    title: str = Field(min_length=1)
    priority: int = Field(default=3, ge=1, le=4)
    deadline: Optional[datetime.date] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    priority: Optional[int] = Field(default=None, ge=1, le=4)
    deadline: Optional[datetime.date] = None
    status: Optional[str] = None


class TaskOut(BaseModel):
    id: int
    title: str
    priority: int
    deadline: Optional[datetime.date]
    status: str
    created_at: datetime.datetime
    updated_at: datetime.datetime

    class Config:
        from_attributes = True
```

- [ ] **Step 2: Write the failing auth tests**

`backend/tests/test_auth.py`:
```python
def test_signup_returns_token(client):
    response = client.post(
        "/auth/signup", json={"email": "test@example.com", "password": "password123"}
    )
    assert response.status_code == 200
    body = response.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"


def test_signup_duplicate_email_rejected(client):
    client.post(
        "/auth/signup", json={"email": "dup@example.com", "password": "password123"}
    )
    response = client.post(
        "/auth/signup", json={"email": "dup@example.com", "password": "password123"}
    )
    assert response.status_code == 400


def test_login_with_correct_password(client):
    client.post(
        "/auth/signup", json={"email": "login@example.com", "password": "password123"}
    )
    response = client.post(
        "/auth/login", json={"email": "login@example.com", "password": "password123"}
    )
    assert response.status_code == 200
    assert "access_token" in response.json()


def test_login_with_wrong_password_rejected(client):
    client.post(
        "/auth/signup", json={"email": "wrong@example.com", "password": "password123"}
    )
    response = client.post(
        "/auth/login", json={"email": "wrong@example.com", "password": "wrongpass"}
    )
    assert response.status_code == 401


def test_me_requires_valid_token(client):
    response = client.get("/auth/me")
    assert response.status_code == 401

    signup = client.post(
        "/auth/signup", json={"email": "me@example.com", "password": "password123"}
    )
    token = signup.json()["access_token"]
    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["email"] == "me@example.com"
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd backend
pytest tests/test_auth.py -v
```

Expected: FAIL — `404 Not Found` for `/auth/signup` (router not registered yet / doesn't exist).

- [ ] **Step 4: Create `backend/app/auth/__init__.py`** (empty file)

- [ ] **Step 5: Create `backend/app/auth/router.py`**

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.schemas import Token, UserCreate, UserLogin, UserOut
from app.security import create_access_token, get_current_user, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=Token)
def signup(payload: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered"
        )
    user = User(email=payload.email, password_hash=hash_password(payload.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return Token(access_token=create_access_token(user.id))


@router.post("/login", response_model=Token)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if user is None or user.password_hash is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    return Token(access_token=create_access_token(user.id))


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
```

- [ ] **Step 6: Register the router in `backend/app/main.py`**

```python
from fastapi import FastAPI

from app.auth.router import router as auth_router

app = FastAPI(title="AI Planner API")

app.include_router(auth_router)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd backend
pytest tests/ -v
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas.py backend/app/auth/__init__.py backend/app/auth/router.py \
  backend/app/main.py backend/tests/test_auth.py
git commit -m "feat: add email/password signup, login, and /auth/me endpoints"
```

---

### Task 5: Google OAuth login

Before writing code: create OAuth credentials in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) — an OAuth 2.0 Client ID of type "Web application". Set an **Authorized redirect URI** matching `GOOGLE_REDIRECT_URI` (`http://localhost:8000/auth/google/callback` for local dev) and an **Authorized JavaScript origin** matching `FRONTEND_URL` (`http://localhost:3000`). Put the resulting client ID/secret into `backend/.env`.

**Files:**
- Create: `backend/app/auth/google_oauth.py`
- Modify: `backend/app/auth/router.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_auth_google.py`

**Interfaces:**
- Consumes: `app.config.settings`, `app.schemas.Token`-style redirect pattern (this endpoint redirects rather than returning JSON)
- Produces: `GET /auth/google/login` (redirects to Google), `GET /auth/google/callback` (redirects to `{FRONTEND_URL}/auth/callback?token=...`), `app.auth.google_oauth.oauth` (Authlib `OAuth` registry with a `google` client)

- [ ] **Step 1: Create `backend/app/auth/google_oauth.py`**

```python
from authlib.integrations.starlette_client import OAuth

from app.config import settings

oauth = OAuth()
oauth.register(
    name="google",
    client_id=settings.google_client_id,
    client_secret=settings.google_client_secret,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/test_auth_google.py`:
```python
from unittest.mock import AsyncMock

from app.auth import google_oauth
from app.models import User


def test_google_callback_creates_new_user(client, monkeypatch):
    fake_token = {"userinfo": {"sub": "google-123", "email": "googleuser@example.com"}}
    monkeypatch.setattr(
        google_oauth.oauth.google,
        "authorize_access_token",
        AsyncMock(return_value=fake_token),
    )

    response = client.get("/auth/google/callback", follow_redirects=False)

    assert response.status_code in (302, 307)
    assert "/auth/callback?token=" in response.headers["location"]


def test_google_callback_reuses_existing_user(client, monkeypatch, db_session):
    existing = User(email="already@example.com", google_id="google-999")
    db_session.add(existing)
    db_session.commit()

    fake_token = {"userinfo": {"sub": "google-999", "email": "already@example.com"}}
    monkeypatch.setattr(
        google_oauth.oauth.google,
        "authorize_access_token",
        AsyncMock(return_value=fake_token),
    )

    response = client.get("/auth/google/callback", follow_redirects=False)
    assert response.status_code in (302, 307)
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd backend
pytest tests/test_auth_google.py -v
```

Expected: FAIL — `404 Not Found` for `/auth/google/callback`.

- [ ] **Step 4: Rewrite `backend/app/auth/router.py` to add the Google endpoints**

```python
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.auth.google_oauth import oauth
from app.config import settings
from app.database import get_db
from app.models import User
from app.schemas import Token, UserCreate, UserLogin, UserOut
from app.security import create_access_token, get_current_user, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=Token)
def signup(payload: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered"
        )
    user = User(email=payload.email, password_hash=hash_password(payload.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return Token(access_token=create_access_token(user.id))


@router.post("/login", response_model=Token)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if user is None or user.password_hash is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    return Token(access_token=create_access_token(user.id))


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.get("/google/login")
async def google_login(request: Request):
    return await oauth.google.authorize_redirect(request, settings.google_redirect_uri)


@router.get("/google/callback")
async def google_callback(request: Request, db: Session = Depends(get_db)):
    token = await oauth.google.authorize_access_token(request)
    userinfo = token.get("userinfo")
    if userinfo is None:
        userinfo = await oauth.google.parse_id_token(request, token)
    google_id = userinfo["sub"]
    email = userinfo["email"]

    user = db.query(User).filter(User.google_id == google_id).first()
    if user is None:
        user = db.query(User).filter(User.email == email).first()
    if user is None:
        user = User(email=email, google_id=google_id)
        db.add(user)
    elif user.google_id is None:
        user.google_id = google_id
    db.commit()
    db.refresh(user)

    access_token = create_access_token(user.id)
    return RedirectResponse(url=f"{settings.frontend_url}/auth/callback?token={access_token}")
```

- [ ] **Step 5: Rewrite `backend/app/main.py` to add `SessionMiddleware` (required by Authlib for OAuth state) and CORS**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.auth.router import router as auth_router
from app.config import settings

app = FastAPI(title="AI Planner API")

app.add_middleware(SessionMiddleware, secret_key=settings.jwt_secret)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd backend
pytest tests/ -v
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/auth/google_oauth.py backend/app/auth/router.py backend/app/main.py \
  backend/tests/test_auth_google.py
git commit -m "feat: add Google OAuth login and callback"
```

---

### Task 6: Task CRUD endpoints

**Files:**
- Create: `backend/app/tasks/__init__.py`
- Create: `backend/app/tasks/router.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_tasks.py`

**Interfaces:**
- Consumes: `app.security.get_current_user`, `app.models.Task`/`User`, `app.schemas.TaskCreate`/`TaskUpdate`/`TaskOut`
- Produces: `POST /tasks` (201), `GET /tasks` (200, list), `PATCH /tasks/{id}` (200), `DELETE /tasks/{id}` (204); router object `app.tasks.router.router`

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_tasks.py`:
```python
def _signup_and_get_token(client, email="taskuser@example.com"):
    response = client.post("/auth/signup", json={"email": email, "password": "password123"})
    return response.json()["access_token"]


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_create_and_list_tasks(client):
    token = _signup_and_get_token(client)
    create = client.post(
        "/tasks",
        json={"title": "Write plan", "priority": 1, "deadline": "2026-07-20"},
        headers=_auth_headers(token),
    )
    assert create.status_code == 201
    task = create.json()
    assert task["title"] == "Write plan"
    assert task["priority"] == 1
    assert task["status"] == "confirmed"

    listing = client.get("/tasks", headers=_auth_headers(token))
    assert listing.status_code == 200
    assert len(listing.json()) == 1


def test_update_task_marks_done(client):
    token = _signup_and_get_token(client)
    create = client.post("/tasks", json={"title": "Finish MVP"}, headers=_auth_headers(token))
    task_id = create.json()["id"]

    update = client.patch(
        f"/tasks/{task_id}", json={"status": "done"}, headers=_auth_headers(token)
    )
    assert update.status_code == 200
    assert update.json()["status"] == "done"


def test_delete_task(client):
    token = _signup_and_get_token(client)
    create = client.post("/tasks", json={"title": "Temporary"}, headers=_auth_headers(token))
    task_id = create.json()["id"]

    delete = client.delete(f"/tasks/{task_id}", headers=_auth_headers(token))
    assert delete.status_code == 204

    listing = client.get("/tasks", headers=_auth_headers(token))
    assert listing.json() == []


def test_cannot_access_another_users_task(client):
    token_a = _signup_and_get_token(client, email="usera@example.com")
    token_b = _signup_and_get_token(client, email="userb@example.com")

    create = client.post("/tasks", json={"title": "Private"}, headers=_auth_headers(token_a))
    task_id = create.json()["id"]

    response = client.patch(
        f"/tasks/{task_id}", json={"status": "done"}, headers=_auth_headers(token_b)
    )
    assert response.status_code == 404
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd backend
pytest tests/test_tasks.py -v
```

Expected: FAIL — `404 Not Found` for `POST /tasks`.

- [ ] **Step 3: Create `backend/app/tasks/__init__.py`** (empty file)

- [ ] **Step 4: Create `backend/app/tasks/router.py`**

```python
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Task, User
from app.schemas import TaskCreate, TaskOut, TaskUpdate
from app.security import get_current_user

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(
    payload: TaskCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = Task(user_id=current_user.id, **payload.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.get("", response_model=List[TaskOut])
def list_tasks(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(Task)
        .filter(Task.user_id == current_user.id)
        .order_by(Task.created_at.desc())
        .all()
    )


def _get_owned_task(task_id: int, current_user: User, db: Session) -> Task:
    task = db.query(Task).filter(Task.id == task_id).first()
    if task is None or task.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(
    task_id: int,
    payload: TaskUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_owned_task(task_id, current_user, db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    task = _get_owned_task(task_id, current_user, db)
    db.delete(task)
    db.commit()
```

- [ ] **Step 5: Register the router in `backend/app/main.py`** (add the import and `include_router` call)

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.auth.router import router as auth_router
from app.config import settings
from app.tasks.router import router as tasks_router

app = FastAPI(title="AI Planner API")

app.add_middleware(SessionMiddleware, secret_key=settings.jwt_secret)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(tasks_router)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd backend
pytest tests/ -v
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/app/tasks/__init__.py backend/app/tasks/router.py backend/app/main.py \
  backend/tests/test_tasks.py
git commit -m "feat: add task CRUD endpoints"
```

---

### Task 7: Dockerize the backend and wire it into Traefik

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/entrypoint.sh`
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: entire backend app from Tasks 1–6
- Produces: a `backend` container reachable at `http://localhost:8000` locally and, on the VPS, via Traefik at whatever `Host()` rule is configured

- [ ] **Step 1: Create `backend/Dockerfile`**

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
```

- [ ] **Step 2: Create `backend/entrypoint.sh`**

```bash
#!/bin/sh
set -e

alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- [ ] **Step 3: Rewrite the repo-root `docker-compose.yml` to add the `backend` service**

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: planner
      POSTGRES_PASSWORD: planner
      POSTGRES_DB: planner
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  backend:
    build: ./backend
    restart: unless-stopped
    env_file:
      - ./backend/.env
    depends_on:
      - postgres
    ports:
      - "8000:8000"
    networks:
      - default
      - traefik
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.ai-planner-api.rule=Host(`api.ai-planner.example.com`)"
      - "traefik.http.routers.ai-planner-api.entrypoints=websecure"
      - "traefik.http.routers.ai-planner-api.tls.certresolver=letsencrypt"
      - "traefik.http.services.ai-planner-api.loadbalancer.server.port=8000"

volumes:
  postgres_data:

networks:
  traefik:
    external: true
```

**Note:** replace `api.ai-planner.example.com` with your real subdomain, and `letsencrypt` with your actual Traefik certificate resolver name once you deploy (Task 11) — check your existing Traefik container's compose file or static config for the resolver name and confirm the external network is actually named `traefik` (`docker network ls` on the VPS). The `ports: 8000:8000` mapping is only needed for local dev convenience; it can stay since Traefik will still be the public entry point on the VPS as long as port 8000 isn't otherwise exposed to the internet.

- [ ] **Step 4: Build and start the full local stack, then verify**

```bash
cd "$(git rev-parse --show-toplevel)"
docker compose up -d --build
curl http://localhost:8000/health
```

Expected: `{"status":"ok"}`.

```bash
docker compose logs backend | grep -i "alembic"
```

Expected: log output shows the Alembic upgrade ran (no errors) before Uvicorn started.

- [ ] **Step 5: Commit**

```bash
git add backend/Dockerfile backend/entrypoint.sh docker-compose.yml
git commit -m "feat: dockerize backend and add Traefik routing labels"
```

---

### Task 8: Frontend scaffold

**Files:**
- Create: `frontend/` (via `create-next-app`)
- Create: `frontend/.env.local.example`
- Modify: `frontend/app/page.tsx`
- Create: `frontend/lib/api.ts`

**Interfaces:**
- Consumes: backend `GET /health`
- Produces: `api.get/post/patch/delete<T>(path, body?) -> Promise<T>` in `frontend/lib/api.ts`; `ApiError` class with `.status` and `.message`

- [ ] **Step 1: Scaffold the Next.js app**

```bash
cd "$(git rev-parse --show-toplevel)"
npx create-next-app@latest frontend --ts --eslint --app --no-tailwind --no-src-dir --import-alias "@/*" --use-npm
```

Expected: `frontend/` is created with a working Next.js app (`frontend/app/page.tsx`, `frontend/package.json`, etc.), no interactive prompts.

- [ ] **Step 2: Create `frontend/.env.local.example`**

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

- [ ] **Step 3: Copy it to the real local env file**

```bash
cd frontend
cp .env.local.example .env.local
```

- [ ] **Step 4: Create `frontend/lib/api.ts`**

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL as string;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.detail ?? "Request failed");
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
```

- [ ] **Step 5: Replace `frontend/app/page.tsx` with a backend-connectivity check**

```tsx
"use client";

import { useEffect, useState } from "react";

export default function HomePage() {
  const [status, setStatus] = useState("checking...");

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`)
      .then((res) => res.json())
      .then((data) => setStatus(data.status))
      .catch(() => setStatus("unreachable"));
  }, []);

  return <p>Backend status: {status}</p>;
}
```

- [ ] **Step 6: Run both servers and verify manually**

```bash
# terminal 1, repo root
docker compose up -d
# terminal 2
cd frontend
npm run dev
```

Open `http://localhost:3000` in a browser. Expected: page shows "Backend status: ok".

- [ ] **Step 7: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add frontend
git commit -m "feat: scaffold Next.js frontend with API client and backend health check"
```

---

### Task 9: Frontend auth pages

**Files:**
- Create: `frontend/lib/auth-context.tsx`
- Modify: `frontend/app/layout.tsx`
- Modify: `frontend/app/page.tsx`
- Create: `frontend/app/login/page.tsx`
- Create: `frontend/app/signup/page.tsx`
- Create: `frontend/app/auth/callback/page.tsx`

**Interfaces:**
- Consumes: `frontend/lib/api.ts` (`api.get/post`, `ApiError`); backend `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`, `GET /auth/google/login`
- Produces: `AuthProvider` component, `useAuth()` hook returning `{ user: {id, email} | null, loading: boolean, setToken(token: string): void, logout(): void }`

- [ ] **Step 1: Create `frontend/lib/auth-context.tsx`**

```tsx
"use client";

import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "./api";

type User = { id: number; email: string };

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  setToken: (token: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  async function loadUser() {
    const token = localStorage.getItem("token");
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.get<User>("/auth/me");
      setUser(me);
    } catch {
      localStorage.removeItem("token");
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setToken(token: string) {
    localStorage.setItem("token", token);
    loadUser();
  }

  function logout() {
    localStorage.removeItem("token");
    setUser(null);
    router.push("/login");
  }

  return (
    <AuthContext.Provider value={{ user, loading, setToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

- [ ] **Step 2: Rewrite `frontend/app/layout.tsx` to wrap the app in `AuthProvider`**

```tsx
import { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth-context";

export const metadata = {
  title: "AI Planner",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Create `frontend/app/login/page.tsx`**

```tsx
"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { setToken } = useAuth();
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result = await api.post<{ access_token: string }>("/auth/login", {
        email,
        password,
      });
      setToken(result.access_token);
      router.push("/tasks");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    }
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  return (
    <main>
      <h1>Log in</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p>{error}</p>}
        <button type="submit">Log in</button>
      </form>
      <a href={`${apiUrl}/auth/google/login`}>Sign in with Google</a>
      <p>
        No account? <a href="/signup">Sign up</a>
      </p>
    </main>
  );
}
```

- [ ] **Step 4: Create `frontend/app/signup/page.tsx`**

```tsx
"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { setToken } = useAuth();
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result = await api.post<{ access_token: string }>("/auth/signup", {
        email,
        password,
      });
      setToken(result.access_token);
      router.push("/tasks");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Signup failed");
    }
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;

  return (
    <main>
      <h1>Sign up</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password (min 8 characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        {error && <p>{error}</p>}
        <button type="submit">Sign up</button>
      </form>
      <a href={`${apiUrl}/auth/google/login`}>Sign up with Google</a>
      <p>
        Already have an account? <a href="/login">Log in</a>
      </p>
    </main>
  );
}
```

- [ ] **Step 5: Create `frontend/app/auth/callback/page.tsx`**

```tsx
"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

function AuthCallbackInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { setToken } = useAuth();

  useEffect(() => {
    const token = params.get("token");
    if (token) {
      setToken(token);
      router.push("/tasks");
    } else {
      router.push("/login");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  return <p>Signing you in…</p>;
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <AuthCallbackInner />
    </Suspense>
  );
}
```

- [ ] **Step 6: Rewrite `frontend/app/page.tsx` to redirect based on auth state**

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      router.push(user ? "/tasks" : "/login");
    }
  }, [loading, user, router]);

  return <p>Loading…</p>;
}
```

- [ ] **Step 7: Manually verify in the browser**

With `docker compose up -d` (backend) and `npm run dev` (frontend) running:
1. Visit `http://localhost:3000` → redirected to `/login`.
2. Go to `/signup`, create an account → redirected to `/tasks` (a 404 page is fine for now, it's built in Task 10).
3. Log out is not wired to a button yet — instead, open dev tools, clear `localStorage`, reload `/` → redirected back to `/login`.
4. Log back in with the same email/password at `/login` → redirected to `/tasks`.

Expected: all four steps behave as described, no console errors.

- [ ] **Step 8: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add frontend/lib/auth-context.tsx frontend/app/layout.tsx frontend/app/page.tsx \
  frontend/app/login/page.tsx frontend/app/signup/page.tsx frontend/app/auth/callback/page.tsx
git commit -m "feat: add frontend auth pages and auth context"
```

---

### Task 10: Frontend tasks page

**Files:**
- Create: `frontend/app/tasks/page.tsx`

**Interfaces:**
- Consumes: `useAuth()`, `api.get/post/patch/delete`; backend `POST /tasks`, `GET /tasks`, `PATCH /tasks/{id}`, `DELETE /tasks/{id}`
- Produces: `/tasks` page — the last piece needed for Plan 1 to be a complete, usable loop

- [ ] **Step 1: Create `frontend/app/tasks/page.tsx`**

```tsx
"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type Task = {
  id: number;
  title: string;
  priority: number;
  deadline: string | null;
  status: string;
};

export default function TasksPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState(3);
  const [deadline, setDeadline] = useState("");

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (user) {
      api.get<Task[]>("/tasks").then(setTasks);
    }
  }, [user]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const task = await api.post<Task>("/tasks", {
      title,
      priority,
      deadline: deadline || null,
    });
    setTasks([task, ...tasks]);
    setTitle("");
    setDeadline("");
  }

  async function toggleDone(task: Task) {
    const updated = await api.patch<Task>(`/tasks/${task.id}`, {
      status: task.status === "done" ? "confirmed" : "done",
    });
    setTasks(tasks.map((t) => (t.id === task.id ? updated : t)));
  }

  async function handleDelete(task: Task) {
    await api.delete(`/tasks/${task.id}`);
    setTasks(tasks.filter((t) => t.id !== task.id));
  }

  if (loading || !user) return <p>Loading…</p>;

  return (
    <main>
      <h1>Tasks</h1>
      <button onClick={logout}>Log out</button>
      <form onSubmit={handleCreate}>
        <input
          placeholder="Task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
          <option value={1}>P1 - Urgent</option>
          <option value={2}>P2 - High</option>
          <option value={3}>P3 - Medium</option>
          <option value={4}>P4 - Low</option>
        </select>
        <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        <button type="submit">Add task</button>
      </form>
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            <input
              type="checkbox"
              checked={task.status === "done"}
              onChange={() => toggleDone(task)}
            />
            <span>{task.title}</span>
            <span> P{task.priority}</span>
            {task.deadline && <span> due {task.deadline}</span>}
            <button onClick={() => handleDelete(task)}>Delete</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Manually verify in the browser**

With backend and frontend running, log in, then on `/tasks`:
1. Create a task with a title, priority, and deadline → it appears at the top of the list.
2. Check its checkbox → it stays checked after a page reload (status persisted as `done`).
3. Uncheck it → reverts to unchecked (status back to `confirmed`).
4. Delete it → disappears from the list and stays gone after reload.
5. Click "Log out" → redirected to `/login`.

Expected: all five behave as described, no console errors.

- [ ] **Step 3: Also check mobile layout**, per this project's mobile-first requirement — open Chrome DevTools device toolbar (or a real Android/iPhone on the same network pointed at your dev machine's LAN IP) and confirm the login, signup, and tasks forms are usable (inputs full-width and tappable, no horizontal overflow) at a 375px-wide viewport.

Expected: no horizontal scrolling, all inputs/buttons reachable and tappable.

- [ ] **Step 4: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add frontend/app/tasks/page.tsx
git commit -m "feat: add tasks page with create, complete, and delete"
```

---

### Task 11: Deploy backend to the VPS and frontend to Vercel

**Files:** none (deployment/config only)

**Interfaces:** none new — this task makes the existing system reachable over the internet

- [ ] **Step 1: Push the repo to a git remote** (GitHub/GitLab) if not already done, since both Vercel and the VPS deploy from git.

- [ ] **Step 2: On the VPS, clone the repo next to your existing Traefik setup**

```bash
git clone <your-repo-url> ai-planner
cd ai-planner/backend
cp .env.example .env
```

Edit `.env` with real values: a strong random `JWT_SECRET`, the real `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI=https://api.<your-domain>/auth/google/callback`, and `FRONTEND_URL=https://<your-vercel-domain>`.

- [ ] **Step 3: Update the Traefik router rule in `docker-compose.yml`** to your real API subdomain (replace `api.ai-planner.example.com`) and confirm the cert resolver name matches your existing Traefik config.

- [ ] **Step 4: Start the stack on the VPS**

```bash
cd ai-planner
docker compose up -d --build
```

- [ ] **Step 5: Verify the backend is reachable over HTTPS**

```bash
curl -I https://api.<your-domain>/health
```

Expected: `HTTP/2 200`.

- [ ] **Step 6: In the Google Cloud Console, add the production redirect URI** (`https://api.<your-domain>/auth/google/callback`) and JavaScript origin (`https://<your-vercel-domain>`) to the OAuth client created in Task 5.

- [ ] **Step 7: Deploy the frontend to Vercel**

In the Vercel dashboard, import the repo, set the project root directory to `frontend/`, and add an environment variable `NEXT_PUBLIC_API_URL=https://api.<your-domain>`. Deploy.

- [ ] **Step 8: End-to-end verification on the live deployment**

On a real phone (iPhone Safari and Android Chrome, per the mobile-first requirement):
1. Visit the Vercel URL → redirected to `/login`.
2. Sign up with email/password → redirected to `/tasks`.
3. Create a task, mark it done, delete it — confirm each persists across a page reload.
4. Log out, then log back in via "Sign in with Google" — confirm it creates/reuses the account and lands on `/tasks`.

Expected: all steps succeed with no errors, on both browsers.

- [ ] **Step 9: Commit the Traefik rule change from Step 3** (the only file change in this task)

```bash
git add docker-compose.yml
git commit -m "chore: point Traefik router at production API subdomain"
```

---

## Self-Review Notes

- **Spec coverage:** Auth (email/password + Google OAuth) → Tasks 3–5. Task CRUD → Task 6. Mobile-first frontend → Tasks 8–10, checked explicitly in Task 10 Step 3. Deployment (Vercel + VPS/Traefik/Postgres) → Tasks 7 and 11. AI triage, voice, Google Calendar sync, and Telegram are intentionally out of scope — covered by Plans 2–5.
- **Type/signature consistency:** `TaskOut`/`TaskCreate`/`TaskUpdate` fields match the `Task` model columns and what the frontend `Task` type and forms send/read. `Token.access_token` matches what both `/auth/signup`/`/auth/login` return and what the frontend reads in `setToken(result.access_token)`. `useAuth()` return shape matches every page that destructures it.
- **No placeholders:** every step has complete file contents or an exact command with expected output; environment-specific values (domain names, OAuth credentials) are called out explicitly with instructions, not left as unexplained TBDs.
