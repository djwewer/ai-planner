from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.captures.service import CaptureProcessingError, process_capture
from app.database import get_db
from app.models import User
from app.schemas import CaptureResponse
from app.security import get_current_user

router = APIRouter(prefix="/captures", tags=["captures"])


class CaptureCreate(BaseModel):
    raw_text: str = Field(min_length=1)


@router.post("", response_model=CaptureResponse, status_code=status.HTTP_201_CREATED)
def create_capture(
    payload: CaptureCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        result = process_capture(current_user, payload.raw_text, source="web", db=db)
    except CaptureProcessingError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Не вдалося обробити, спробуйте ще раз",
        )
    return {"kind": result.kind, "tasks": result.tasks, "task": result.task}
