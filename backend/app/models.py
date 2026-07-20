import datetime

from sqlalchemy import BigInteger, Boolean, Column, Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=True)
    google_id = Column(String, unique=True, nullable=True, index=True)
    google_calendar_refresh_token = Column(String, nullable=True)
    telegram_chat_id = Column(BigInteger, unique=True, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)

    tasks = relationship("Task", back_populates="user", cascade="all, delete-orphan")


class Capture(Base):
    __tablename__ = "captures"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    raw_text = Column(String, nullable=False)
    status = Column(String, nullable=False, default="processing")
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    capture_id = Column(Integer, ForeignKey("captures.id"), nullable=True, index=True)
    title = Column(String, nullable=False)
    priority = Column(Integer, nullable=False, default=3)
    deadline = Column(Date, nullable=True)
    scheduled_at = Column(DateTime, nullable=True)
    google_event_id = Column(String, nullable=True)
    reminder_sent_at = Column(DateTime, nullable=True)
    last_overdue_nudge_at = Column(DateTime, nullable=True)
    status = Column(String, nullable=False, default="confirmed")
    created_at = Column(DateTime, default=datetime.datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.datetime.utcnow,
        onupdate=datetime.datetime.utcnow,
        nullable=False,
    )

    user = relationship("User", back_populates="tasks")


class TelegramLinkCode(Base):
    __tablename__ = "telegram_link_codes"

    code = Column(String, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, nullable=False, default=False)
