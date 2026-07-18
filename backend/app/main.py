from fastapi import FastAPI

app = FastAPI(title="AI Planner API")


@app.get("/health")
def health():
    return {"status": "ok"}
