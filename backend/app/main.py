from fastapi import FastAPI

from app.auth.router import router as auth_router

app = FastAPI(title="AI Planner API")

app.include_router(auth_router)


@app.get("/health")
def health():
    return {"status": "ok"}
