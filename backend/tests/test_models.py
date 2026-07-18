import datetime

from app.models import Capture, Task, User


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


def test_capture_defaults(db_session):
    user = User(email="captureowner@example.com", password_hash="hashed")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    capture = Capture(user_id=user.id, raw_text="buy milk and call john")
    db_session.add(capture)
    db_session.commit()
    db_session.refresh(capture)

    assert capture.status == "processing"
    assert capture.id is not None


def test_task_capture_id_nullable(db_session):
    user = User(email="taskcaptureowner@example.com", password_hash="hashed")
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    task = Task(user_id=user.id, title="Manually added task")
    db_session.add(task)
    db_session.commit()
    db_session.refresh(task)

    assert task.capture_id is None
